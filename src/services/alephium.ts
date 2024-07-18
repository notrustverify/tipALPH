import { NodeProvider, Destination, DUST_AMOUNT, web3, isValidAddress } from "@alephium/web3";
import { PrivateKeyWallet, deriveHDWalletPrivateKey } from "@alephium/web3-wallet";
import { Balance, Confirmed, MemPooled, TxNotFound } from "@alephium/web3/dist/src/api/api-alephium";
import { Repository } from "typeorm";
import { Mutex } from "async-mutex";

import { TokenAmount, UserBalance, sumUserBalance } from "../tokens/tokenAmount.js";
import { TokenManager } from "../tokens/tokenManager.js";
import { TransactionStatus } from "../transactionStatus.js";
import { EnvConfig, FullNodeConfig, OperatorConfig } from "../config.js";
import * as Error from "../error.js";
import { User } from "../db/user.js";
import { delay } from "../utils.js";

export class AlphClient {
  private readonly nodeProvider: NodeProvider;
  private readonly mnemonicReader: () => string;
  private userStore: Repository<User>;
  private tokenManager: TokenManager;
  private operatorConfig: OperatorConfig;
  private registerMutex: Mutex;

  constructor(nodeProvider: NodeProvider, mnemonicReader: () => string, userStore: Repository<User>, tokenManager: TokenManager, operatorConfig: OperatorConfig) {
    this.nodeProvider = nodeProvider;
    this.mnemonicReader = mnemonicReader;
    this.userStore = userStore;
    this.tokenManager = tokenManager;
    this.operatorConfig = operatorConfig;
    this.registerMutex = new Mutex();
  }

  private async waitTxConfirmed(txId: string, nbConfirmations: number, timeIntervallInMilliseconds: number): Promise<boolean> {
    let txStatus: Confirmed | MemPooled | TxNotFound

    for(;;) { // Equivalent of while(true) but satisfies the linter
      txStatus = await this.nodeProvider.transactions.getTransactionsStatus({ txId });

      switch(txStatus.type) {
        case "TxNotfound":
          return Promise.reject("Tx Not Found");
        case "MemPooled":
          if (0 <= nbConfirmations)
            return Promise.resolve(true);
          break;
        case "Confirmed":
          console.log((<Confirmed>txStatus).chainConfirmations)
          if (nbConfirmations <= (<Confirmed>txStatus).chainConfirmations)
            return Promise.resolve(true);
          break;
      }

      await delay(timeIntervallInMilliseconds);
    }
  }

  async registerUser(newUser: User): Promise<User> {
    return this.registerMutex.runExclusive(async () => { // Should use Result<> instead of returning error when user already exists.
      if (await this.userStore.existsBy({ telegramId: newUser.telegramId })) {
        return Promise.reject(Error.ErrorTypes.USER_ALREADY_REGISTERED);
      }
      const userWithId = await this.userStore.save(newUser);
      userWithId.address = this.deriveUserAddress(userWithId);
      return this.userStore.save(userWithId);
    });
  }

  private deriveUserIterator(user: User): number {
    return user.id;
  }

  private deriveUserAddress(user: User): string {
    return this.getUserWallet(user).address
  }

  private adaptError(err: Error): Error {
    if (Error.alphErrorIsNetworkError(err))
      return new Error.NetworkError(err);
    else if (Error.alphErrorIsNotEnoughFundsError(err))
      return new Error.NotEnoughFundsError(err);
    else if (Error.alphErrorIsNotEnoughBalanceForFeeError(err))
      return new Error.NotEnoughBalanceForFeeError(err);
    else if (Error.alphErrorIsNotEnoughApprovedBalanceForAddress(err))
      return new Error.NotEnoughApprovedBalanceForAddressError(err);
    else if (Error.alphErrorIsNotEnoughALPHForTransactionOutputError(err))
      return new Error.NotEnoughALPHForTransactionOutputError(err);
    else if (Error.alphErrorIsNotEnoughALPHForALPHAndTokenChangeOutputError(err))
      return new Error.NotEnoughALPHForALPHAndTokenChangeOutputError(err);
    else
      return err;
  }

  getUserWallet(user: User): PrivateKeyWallet {
    const userPrivateKey = deriveHDWalletPrivateKey(this.mnemonicReader(), 'default', this.deriveUserIterator(user));
    return new PrivateKeyWallet({ privateKey: userPrivateKey, nodeProvider: this.nodeProvider });
  }

  private async convertAddressBalanceToUserBalance(balance: Balance): Promise<UserBalance> {
    const alphToken = await this.tokenManager.getTokenBySymbol("ALPH");
    const userBalance = [new TokenAmount(balance.balance, alphToken)];

    if ("tokenBalances" in balance && undefined !== balance.tokenBalances && balance.tokenBalances.length > 0) {
      const userTokens = await Promise.allSettled(balance.tokenBalances.map(async (t) => this.tokenManager.getTokenAmountFromIdAmount(t.id, t.amount)));
      const recognisedToken = userTokens.filter(t => "fulfilled" === t.status);
      userBalance.push(...recognisedToken.map((t: PromiseFulfilledResult<TokenAmount>) => t.value));
      if (userTokens.length != recognisedToken.length)
        console.log("un-recognised tokens:\n"+ userTokens.filter(t => "rejected" === t.status).map((t: PromiseRejectedResult) => t.reason).join("\n"));
    }
    return userBalance;
  }

  async getUserBalance(user: User): Promise<UserBalance> {
    return this.nodeProvider.addresses.getAddressesAddressBalance(user.address)
    .then(balance => this.convertAddressBalanceToUserBalance(balance))
    .catch(err => {
      if (Error.alphErrorIsNetworkError(err))
        return Promise.reject(new Error.NetworkError(err));
      else {
        console.error(err);
        return Promise.reject(new Error.GeneralError("failed to fetch user balance", { error: err, context: { user } }));
      }
    });
  }

  async transferFromUserToUser(sender: User, receiver: User, tokenAmount: TokenAmount, txStatus?: TransactionStatus): Promise<string> {
    const senderWallet = this.getUserWallet(sender);

    const newTx = await senderWallet.signAndSubmitTransferTx({
      signerAddress: (await senderWallet.getSelectedAccount()).address,
      destinations: [
        {
          address: receiver.address,
          attoAlphAmount: tokenAmount.token.isALPH() ? tokenAmount.amount : DUST_AMOUNT,
          ...{ tokens: tokenAmount.token.isALPH() ? [] : [{ id: tokenAmount.token.id, amount: tokenAmount.amount }]}
        }
      ]
    })
    .catch((err) => Promise.reject(this.adaptError(err)));
    
    if (undefined !== txStatus && !EnvConfig.isOnDevNet())
      txStatus.setTransactionId(newTx.txId).displayUpdate();

    await this.waitTxConfirmed(newTx.txId, EnvConfig.bot.nbConfirmationsInternalTransfer, 1000);

    // Check for consolidation from time to time
    this.consolidateIfRequired(sender).catch(console.error);
    this.consolidateIfRequired(receiver).catch(console.error);

    return newTx.txId;
  }

  async sendAmountToAddressFrom(user: User, tokenAmount: TokenAmount, destinationAddress: string, txStatus?: TransactionStatus): Promise<string> {
    if (!isValidAddress(destinationAddress))
      return Promise.reject(new Error.InvalidAddressError(destinationAddress));

    const userWallet = this.getUserWallet(user);

    const destinations: Destination[] = [];

    if (this.operatorConfig.fees > 0) {
      const tokenAmountOperatorFee = tokenAmount.substractAndGetPercentage(this.operatorConfig.fees);
      const operatorFeesAddress = this.operatorConfig.addressesByGroup[userWallet.group];
      console.log(`Collecting ${tokenAmountOperatorFee.toString()} (${this.operatorConfig.fees}%) fees on ${operatorFeesAddress} (group ${userWallet.group})`);
      destinations.push({
        address: operatorFeesAddress,
        attoAlphAmount: tokenAmountOperatorFee.token.isALPH() ? tokenAmountOperatorFee.amount : DUST_AMOUNT,
        ...{ tokens: tokenAmountOperatorFee.token.isALPH() ? [] : [{ id: tokenAmountOperatorFee.token.id, amount: tokenAmountOperatorFee.amount }]}
      });
    }

    destinations.push({
      address: destinationAddress,
      attoAlphAmount: tokenAmount.token.isALPH() ? tokenAmount.amount : DUST_AMOUNT,
      ...{ tokens: tokenAmount.token.isALPH() ? [] : [{ id: tokenAmount.token.id, amount: tokenAmount.amount }]}
    });

    const newTx = await userWallet.signAndSubmitTransferTx({
      signerAddress: (await userWallet.getSelectedAccount()).address,
      destinations,
    })
    .catch((err) => Promise.reject(this.adaptError(err)));
    
    if (undefined !== txStatus && !EnvConfig.isOnDevNet())
      txStatus.setTransactionId(newTx.txId).displayUpdate();

    await this.waitTxConfirmed(newTx.txId, EnvConfig.bot.nbConfirmationsExternalTransfer, 1000);

    // Check for consolidation from time to time
    this.consolidateIfRequired(user).catch(console.error);

    return newTx.txId;
  }

  async consolidateIfRequired(user: User): Promise<string> {
    console.log(`Checking if consolidation is required for user ${user.id}`);
    const userWallet = this.getUserWallet(user);
    return this.nodeProvider.addresses.getAddressesAddressBalance(userWallet.address, { mempool: EnvConfig.bot.considerMempool })
    .then(async (addressBalance) => { 
      if (addressBalance.utxoNum < EnvConfig.bot.nbUTXOBeforeConsolidation) {
        console.log(`No need to consolidate. Only ${addressBalance.utxoNum} for wallet of user id:${user.id}`);
        return;
      }
      console.log(`Consolidation UTXO for user ${user.id}`);
      const tx = (await this.consolidateUTXO(userWallet)).join(", ");
      console.log(`Consolidated in txId ${tx}`);
      return tx;
    })
    .catch((err) => Promise.reject(this.adaptError(err)));
  }

  // Inspired from https://github.com/alephium/alephium-web3/blob/master/test/exchange.test.ts#L60
  async consolidateUTXO(userWallet: PrivateKeyWallet): Promise<string[]> {
    return this.nodeProvider.transactions.postTransactionsSweepAddressBuild({
      fromPublicKey: userWallet.publicKey,
      toAddress: userWallet.address,
    })
    .then(sweepResults => 
      sweepResults.unsignedTxs.map(tx => userWallet.signAndSubmitUnsignedTx({ signerAddress: userWallet.address, unsignedTx: tx.unsignedTx }))
    )
    .then(promises => Promise.all(promises))
    .then(txResults => txResults.map(tx => tx.txId))
    .catch((err) => Promise.reject(this.adaptError(err)));
  }

  async getTotalTokenAmount(): Promise<UserBalance> {
    const totalNbrUsers = await this.userStore.count();
    let totalTokenAmount: UserBalance = [];
    let currentUserSet: User[];
    let currentUserBalance: UserBalance[];
    
    const userBuffer = 30;
    for (let i = 0; i < totalNbrUsers; i += userBuffer) {
      currentUserSet = await this.userStore.find({ skip: userBuffer*i, take: userBuffer });
      currentUserBalance = await Promise.all(currentUserSet.map(u => this.getUserBalance(u)));
      currentUserBalance.push(totalTokenAmount);
      totalTokenAmount = sumUserBalance(currentUserBalance);
    }
    return totalTokenAmount;
  }

  async getTotalTokenAmountFromAddresses(addresses: string[]): Promise<UserBalance> {
    const addressesBalance = await Promise.all(addresses.map(a =>
      this.nodeProvider.addresses.getAddressesAddressBalance(a, { mempool: EnvConfig.bot.considerMempool }).then(balance => this.convertAddressBalanceToUserBalance(balance))));
    return sumUserBalance(addressesBalance);
  }
}

export async function createAlphClient(mnemonicReader: () => string, userStore: Repository<User>, fullnodeInfo: FullNodeConfig, tokenManager: TokenManager, operatorConfig: OperatorConfig): Promise<AlphClient> {
  console.log(`Using ${fullnodeInfo.addr()} as fullnode${fullnodeInfo.apiKey ? " with API key!" : ""}`);
  const nodeProvider = fullnodeInfo.apiKey ? new NodeProvider(fullnodeInfo.addr(), fullnodeInfo.apiKey) : new NodeProvider(fullnodeInfo.addr());
  web3.setCurrentNodeProvider(nodeProvider);

  // Attempt to connect to fullnode (without using the Alephium SDK)
  let selfCliqueReq: Response;
  try {
    selfCliqueReq = await fetch(`${fullnodeInfo.addr()}/infos/self-clique`, fullnodeInfo.apiKey ? {headers: { "X-API-KEY": fullnodeInfo.apiKey } } : {});
    if (200 !== selfCliqueReq.status)
      return Promise.reject(`fullnode returned ${selfCliqueReq.status} (not 200 OK)`);
  }
  catch (err) {
    return Promise.reject("fullnode is not reachable");
  }
  
  let selfCliqueContent: unknown;
  try {
    selfCliqueContent = await selfCliqueReq.json();
  }
  catch {
    return Promise.reject("fullnode replied non-json body");
  }
  
  if (!selfCliqueContent["selfReady"]) {
    console.error(selfCliqueContent);
    return Promise.reject("fullnode is not ready");
  }
  
  if (!selfCliqueContent["synced"]) {
    console.error(selfCliqueContent);
    return Promise.reject("fullnode is not synced");
  }

  console.log("NodeProvider is ready and synced!");

  return new AlphClient(nodeProvider, mnemonicReader, userStore, tokenManager, operatorConfig);
}