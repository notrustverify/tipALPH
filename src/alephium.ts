import { PrivateKeyWallet, deriveHDWalletPrivateKey } from "@alephium/web3-wallet";
import { NodeProvider, convertAlphAmountWithDecimals, prettifyAttoAlphAmount } from "@alephium/web3";
import { waitTxConfirmed } from "@alephium/cli";
import { Repository } from "typeorm";
import { Mutex } from 'async-mutex';

import { EnvConfig, FullNodeConfig } from "./config.js";
import { ErrorTypes, GeneralError, NetworkError, NotEnoughFundsError, alphErrorIsNetworkError, alphErrorIsNotEnoughFundsError } from "./error.js";
import { User } from "./db/user.js";

const NUM_UTXO_BEFORE_CONSOLIDATE = 50;

export class AlphClient {
  private readonly nodeProvider: NodeProvider;
  private readonly mnemonicReader: () => string;    // TODO: replace by secure storage
  private userStore: Repository<User>;
  private registerMutex: Mutex;

  constructor(nodeProvider: NodeProvider, mnemonicReader: () => string, userStore: Repository<User>) {
    this.nodeProvider = nodeProvider;
    this.mnemonicReader = mnemonicReader;
    this.userStore = userStore;
    this.registerMutex = new Mutex();
  }

  private async registerUserExclusive(newUser: User): Promise<User> { // Should use Result<> instead of returning error when user already exists.
    if (await this.userStore.existsBy({ telegramId: newUser.telegramId })) {
      return Promise.reject(ErrorTypes.USER_ALREADY_REGISTERED);
    }
    let userWithId = await this.userStore.save(newUser);
    userWithId.address = this.deriveUserAddress(userWithId);
    return this.userStore.save(userWithId);
  }

  async registerUser(newUser: User): Promise<User> {
    return this.registerMutex.runExclusive(() => this.registerUserExclusive(newUser));
  }

  private deriveUserIterator(user: User): number {
    return user.id;
  }

  private deriveUserAddress(user: User): string {
    return this.getUserWallet(user).address
  }

  getUserWallet(user: User): PrivateKeyWallet {
    const userPrivateKey = deriveHDWalletPrivateKey(this.mnemonicReader(), 'default', this.deriveUserIterator(user));
    return new PrivateKeyWallet({ privateKey: userPrivateKey, nodeProvider: this.nodeProvider });
  }

  async getUserBalance(user: User): Promise<string> {
    return this.nodeProvider.addresses.getAddressesAddressBalance(user.address)
    .then(balance => prettifyAttoAlphAmount(balance.balance))
    .catch(err => {
      if (alphErrorIsNetworkError(err))
        return Promise.reject(new NetworkError(err));
      else
        return Promise.reject(new GeneralError("failed to fetch user balance", { error: err, context: { user } }));
    });
  }

  async transferFromUserToUser(sender: User, receiver: User, amount: string): Promise<string> {
    const senderWallet = this.getUserWallet(sender);

    const newTx = await senderWallet.signAndSubmitTransferTx({
      signerAddress: (await senderWallet.getSelectedAccount()).address,
      destinations: [
        { address: receiver.address, attoAlphAmount: convertAlphAmountWithDecimals(amount) }
      ]
    })
    .catch((err) => {
      if (alphErrorIsNetworkError(err))
        return Promise.reject(new NetworkError(err));
      else if (alphErrorIsNotEnoughFundsError(err))
        return Promise.reject(new NotEnoughFundsError(err));
      else
        return Promise.reject(err);
    });
    
    await waitTxConfirmed(this.nodeProvider, newTx.txId, 1, 1000);

    // Check for consolidation from time to time
    this.consolidateIfRequired(sender).catch(console.error);
    this.consolidateIfRequired(receiver).catch(console.error);

    return newTx.txId;
  }

  async sendAmountToAddressFrom(user: User, amount: string, destinationAddress: string): Promise<string> {
    const userWallet = this.getUserWallet(user);

    const attoAlphAmount = convertAlphAmountWithDecimals(amount);
    const destinations = [
      { address: destinationAddress, attoAlphAmount },
    ]

    if (undefined !== EnvConfig.operator.address) {
      const operatorPart = attoAlphAmount/BigInt(100) * BigInt(EnvConfig.operator.fees);
      console.log(`Collecting ${operatorPart} (${EnvConfig.operator.fees}%) fees on ${EnvConfig.operator.address}`);
      destinations.push({ address: EnvConfig.operator.address, attoAlphAmount: operatorPart });
    }
    const newTx = await userWallet.signAndSubmitTransferTx({
      signerAddress: (await userWallet.getSelectedAccount()).address,
      destinations,
    })
    .catch((err) => {
      if (alphErrorIsNetworkError(err))
        return Promise.reject(new NetworkError(err));
      else if (alphErrorIsNotEnoughFundsError(err))
        return Promise.reject(new NotEnoughFundsError(err));
      else
        return Promise.reject(err);
    });
    
    await waitTxConfirmed(this.nodeProvider, newTx.txId, 1, 1000);

    // Check for consolidation from time to time
    this.consolidateIfRequired(user).catch(console.error);

    return newTx.txId;
  }

  async consolidateIfRequired(user: User): Promise<string> {
    const userWallet = this.getUserWallet(user);
    return this.nodeProvider.addresses.getAddressesAddressBalance(userWallet.address, { mempool: true })
    .then(async (addressBalance) => { 
      if (addressBalance.utxoNum < NUM_UTXO_BEFORE_CONSOLIDATE) {
        console.log(`No need to consolidate. Only ${addressBalance.utxoNum} for this user wallet`);
        return;
      }
      const tx = await this.consolidateUTXO(userWallet)[0]; 
      console.log(tx);
      return tx;
    })
    .catch((err) => {
      if (alphErrorIsNetworkError(err))
        return Promise.reject(new NetworkError(err));
      else
        return Promise.reject(err);
    });
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
    .catch((err) => {
      if (alphErrorIsNetworkError(err))
        return Promise.reject(new NetworkError(err));
      else
        return Promise.reject(err);
    });
  }
}

export async function createAlphClient(mnemonicReader: () => string, userStore: Repository<User>, fullnodeInfo: FullNodeConfig): Promise<AlphClient> {
  console.log(`Using ${fullnodeInfo.addr()} as fullnode${fullnodeInfo.apiKey ? " with API key!" : ""}`);
  const nodeProvider = fullnodeInfo.apiKey ? new NodeProvider(fullnodeInfo.addr(), fullnodeInfo.apiKey) : new NodeProvider(fullnodeInfo.addr());

  // Attempt to connect to fullnode (without using the Alephium SDK)
  let selfCliqueReq: Response;
  try {
    selfCliqueReq = await fetch(`${fullnodeInfo.addr()}/infos/self-clique`);
    if (200 !== selfCliqueReq.status)
      return Promise.reject(`fullnode returned ${selfCliqueReq.status} (not 200 OK)`);
  }
  catch (err) {
    return Promise.reject("fullnode is not reachable");
  }
  
  let selfCliqueContent: any;
  try {
    selfCliqueContent = await selfCliqueReq.json();
  }
  catch {
    return Promise.reject("fullnode replied non-json body");
  }
  
  if (!selfCliqueContent.selfReady) {
    console.error(selfCliqueContent);
    return Promise.reject("fullnode is not ready");    
  }
  
  if (!selfCliqueContent.synced) {
    console.error(selfCliqueContent);
    return Promise.reject("fullnode is not synced");
  }

  console.log("NodeProvider is ready and synced!");

  return new AlphClient(nodeProvider, mnemonicReader, userStore);
}