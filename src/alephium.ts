import { PrivateKeyWallet, deriveHDWalletPrivateKey } from "@alephium/web3-wallet";
import { NodeProvider, convertAlphAmountWithDecimals, prettifyAttoAlphAmount } from "@alephium/web3";
import { waitTxConfirmed } from "@alephium/cli";
import { Repository } from "typeorm";
import { Mutex } from 'async-mutex';

import { FullNodeConfig } from "./config.js";
import { ErrorTypes, GeneralError, NetworkError, NotEnoughFundsError, alphErrorIsNetworkError, alphErrorIsNotEnoughFundsError } from "./error.js";
import { User } from "./db/user.js";

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
        { address: receiver.address, attoAlphAmount: convertAlphAmountWithDecimals(amount)! }
      ]
    })
    .catch((err) => {
      if (alphErrorIsNetworkError(err))
        return Promise.reject(new NetworkError(err));
      else if (alphErrorIsNotEnoughFundsError(err))
        return Promise.reject(new NotEnoughFundsError(err))
      else
        return Promise.reject(err);
    });
    
    await waitTxConfirmed(this.nodeProvider, newTx.txId, 1, 1000);

    return newTx.txId;
  }

  async sendAmountToAddressFrom(user: User, amount: number, address: string): Promise<string> {
    return "hum";
  }

  async consolidateUTXO(user: User) {
    
  }
}

export async function createAlphClient(mnemonicReader: () => string, userStore: Repository<User>, fullnodeInfo: FullNodeConfig): Promise<AlphClient> {
  console.log(`Using ${fullnodeInfo.addr()} as fullnode${fullnodeInfo.apiKey ? " with API key!" : ""}`);
  const nodeProvider = fullnodeInfo.apiKey ? new NodeProvider(fullnodeInfo.addr(), fullnodeInfo.apiKey) : new NodeProvider(fullnodeInfo.addr());

  // Attempt to connect to fullnode
  try {
    const nodeProviderInfos = await nodeProvider.infos.getInfosSelfClique();
    if (!nodeProviderInfos.synced) {
      return Promise.reject("fullnode is not synced");
    }
  }
  catch (err) {
    if (!alphErrorIsNetworkError(err)) {
      throw err;
    }
    return Promise.reject("fullnode is not available");
  }
  console.log("NodeProvider is ready and synced!");

  return new AlphClient(nodeProvider, mnemonicReader, userStore);
}