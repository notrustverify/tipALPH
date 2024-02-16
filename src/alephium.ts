import { PrivateKeyWallet, deriveHDWalletPrivateKey } from "@alephium/web3-wallet";
import { NodeProvider, SignTransferTxResult, convertAlphAmountWithDecimals, prettifyAttoAlphAmount } from "@alephium/web3";
import { waitTxConfirmed } from "@alephium/cli";
import { Repository } from "typeorm";
import { Mutex } from 'async-mutex';
import { User } from "./db/user.js";

export class AlphClient {
  private readonly nodeProvider: NodeProvider;
  private readonly mnemonic: string;            // TODO: replace by secure storage
  private userStore: Repository<User>;
  private registerMutex: Mutex;

  constructor(nodeProvider: NodeProvider, mnemonic: string, userStore: Repository<User>) {
    this.nodeProvider = nodeProvider;
    this.mnemonic = mnemonic;
    this.userStore = userStore;
    this.registerMutex = new Mutex();
  }

  private async registerUserExclusive(newUser: User): Promise<User> {
    console.log("Attempting to store", newUser);
    if (await this.userStore.existsBy({ telegramId: newUser.telegramId })) {
      return Promise.reject("user already registered!");
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
    const userPrivateKey = deriveHDWalletPrivateKey(this.mnemonic, 'default', this.deriveUserIterator(user));
    return new PrivateKeyWallet({ privateKey: userPrivateKey, nodeProvider: this.nodeProvider });
  }

  async getUserBalance(user: User): Promise<string> {
    const balance = await this.nodeProvider.addresses.getAddressesAddressBalance(user.address);
    return prettifyAttoAlphAmount(balance.balance);
  }

  async transferFromUserToUser(sender: User, receiver: User, amount: string): Promise<string> {
    const senderWallet = this.getUserWallet(sender);
    let newTx: SignTransferTxResult;
    try {
      newTx = await senderWallet.signAndSubmitTransferTx({
        signerAddress: (await senderWallet.getSelectedAccount()).address,
        destinations: [
          { address: receiver.address, attoAlphAmount: convertAlphAmountWithDecimals(amount)! }
        ]
      });
    }
    catch (err) {
      return Promise.reject("not enough money");
    }

    await waitTxConfirmed(this.nodeProvider, newTx.txId, 1, 1000);

    return newTx.txId;
  }

  async consolidateUTXO(user: User) {
    
  }
}

export async function createAlphClient(fullnodeAddr: string, mnemonic: string, userStore: Repository<User>): Promise<AlphClient> {
  const nodeProvider = new NodeProvider(fullnodeAddr);

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  let isAvailable = false;
  do {
    try {
      await nodeProvider.infos.getInfosSelfClique();
      isAvailable = true;
    } catch(err) {
      if (err.message !== "fetch failed") {
        throw err;
      }
      console.log("Waiting for NodeProvider to be ready...");
      await delay(2500);
    }
  } while (!isAvailable)
  console.log("NodeProvider is ready!");

  return new AlphClient(nodeProvider, mnemonic, userStore);
}