import { NodeProvider, convertAlphAmountWithDecimals, prettifyAttoAlphAmount, web3 } from "@alephium/web3";
import { PrivateKeyWallet, deriveHDWalletPrivateKey } from "@alephium/web3-wallet";
//import { waitTxConfirmed } from "@alephium/cli";
//import { testNodeWallet } from "@alephium/web3-test";
//import { User } from './db/user.js';

export class AlphClient {
  private readonly nodeProvider: NodeProvider;
  private readonly mnemonic: string;            // TODO: replace by secure storage
  //private userStore: User;

  constructor(nodeProvider: NodeProvider, mnemonic: string, /*userStore: User*/) {
    this.nodeProvider = nodeProvider;
    this.mnemonic = mnemonic;
    //this.userStore = userStore;
    web3.setCurrentNodeProvider(nodeProvider);
  }

  getUserWallet(userIterator: number): PrivateKeyWallet {
    const userPrivateKey = deriveHDWalletPrivateKey(this.mnemonic, 'default', userIterator);
    return new PrivateKeyWallet({ privateKey: userPrivateKey, nodeProvider: this.nodeProvider });
  }

  getUserAddress(userIterator: number): string {
    return this.getUserWallet(userIterator).address
  }

  async getUserBalance(userIterator: number): Promise<string> {
    const userAddress = this.getUserAddress(userIterator);
    const balance = await this.nodeProvider.addresses.getAddressesAddressBalance(userAddress);
    const prettyBalance = prettifyAttoAlphAmount(balance.balance);
    if (!prettyBalance)
      throw new Error("result of prettying alph amount is undefined!");
    return prettyBalance;
  }

  /*
  async provisionUserAccount(userIterator: number, nbAlph: number): Promise<string> {
    
    const userWallet = this.getUserWallet(userIterator);

    // deposit 1 ALPH for each user
    const testWallet = await testNodeWallet();

    const newTx = await testWallet.signAndSubmitTransferTx({
      signerAddress: (await testWallet.getSelectedAccount()).address,
      destinations: [
        { address: userWallet.address, attoAlphAmount: convertAlphAmountWithDecimals(nbAlph) }
      ]
    });
    
    // Check if UTXO consolidation should be performed or not
    
    return newTx.txId;
  }
  */

  async transfertAmount(fromWallet: PrivateKeyWallet, toAddress: string, amount: number): Promise<string> {
    const newTx = await fromWallet.signAndSubmitTransferTx({
      signerAddress: (await fromWallet.getSelectedAccount()).address,
      destinations: [
        { address: toAddress, attoAlphAmount: convertAlphAmountWithDecimals(amount)! }
      ]
    });

    /*
    const nodeProvider = web3.getCurrentNodeProvider();
    await waitTxConfirmed(nodeProvider, newTx.txId, 1, 1000);
    */

    // Check if UTXO consolidation should be performed or not
    
    return newTx.txId;
  }

  /*
  async consolidateUTXOForUser(userIterator: number) {
    const userWallet = this.getUserWallet(userIterator);

    this.nodeProvider.wallets.postWalletsWalletNameSweepActiveAddress
    // TODO: implement UTXO consolidation
  }
  */

  /*
  async createPrivateKeyWallet() {
    const privateKey = deriveHDWalletPrivateKey(this.mnemonic, 'default', undefined);
    console.log(`PrivKey: ${privateKey}`);

    const pkWallet = new PrivateKeyWallet({ privateKey, nodeProvider: this.nodeProvider });
    const account = await pkWallet.getSelectedAccount();
    await this.displayAccountDetails(account);

    // deposit 1 ALPH for each user
    const testWallet = await testNodeWallet();

    let newPrivateKey;
    let newPkWallet;
    for (let i = 0; i < 5; i++) {
      newPrivateKey = deriveHDWalletPrivateKey(this.mnemonic, 'default', i);
      newPkWallet = new PrivateKeyWallet({ privateKey: newPrivateKey, nodeProvider: this.nodeProvider });
      await this.displayAccountDetails(pkWallet.account)

      const newTx = await testWallet.signAndSubmitTransferTx({
        signerAddress: (await testWallet.getSelectedAccount()).address,
        destinations: [
          { address: newPkWallet.address, attoAlphAmount: convertAlphAmountWithDecimals('1.0')! }
        ]
      })
      this.nodeProvider.addresses.getAddressesAddressBalance(newPkWallet.address).then(b => console.log("NewBalance: ", b.balanceHint, " after transaction:"));
      console.log(newTx.txId, " groups ", newTx.fromGroup, " -> ", newTx.toGroup, "\n");
    }
  }

  async displayAccountDetails(account: Account) {
    console.log(`PubKey:  ${account.publicKey}`);
    console.log(`Address: ${account.address}`);
    console.log(`Group: ${account.group}`);
    const balance = await this.nodeProvider.addresses.getAddressesAddressBalance(account.address);
    console.log("Balance: ", balance);
  }

  async tryToGetTestWallet(): Promise<boolean> {
    console.log("Attempt to getTestWallet!");
    const testWallet = await testNodeWallet();
    const testWalletAccount = await testWallet.getSelectedAccount();
    const amount = await this.nodeProvider.addresses.getAddressesAddressBalance(testWalletAccount.address)
    console.log(amount);
    return undefined !== amount;
  }
  */
}

export async function createAlphClient(fullnodeAddr: string, mnemonic: string/*, userStore: User*/): Promise<AlphClient> {
  const nodeProvider = new NodeProvider(fullnodeAddr);

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

  return new AlphClient(nodeProvider, mnemonic/*, userStore*/);
}