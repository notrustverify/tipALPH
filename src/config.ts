import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";

config({ path: ['.env'] });
const MNEMONIC_FILE = "bot_mnemonic.txt";
const SECRET_FOLDER = [`/run/secrets`, `./secrets/`];

// Adapted from https://stackoverflow.com/a/16259739
(function(){
  if(console.log){
      var old = console.log;
      console.log = function(){
          Array.prototype.unshift.call(arguments, new Date());
          old.apply(this, arguments)
      }
  }  
})();

(function(){
  if(console.error){
      var old = console.error;
      console.error = function(){
          Array.prototype.unshift.call(arguments, new Date());
          old.apply(this, arguments)
      }
  }  
})();

export interface FullNodeConfig {
  readonly protocol: string,
  readonly host: string,
  readonly port: number,
  readonly addr: () => string,
  readonly apiKey?: string,
}

export interface OperatorConfig {
  readonly fees: number
  readonly addressesByGroup: readonly [string, string, string, string]
}

const enum NETWORK {
  DEVNET = "devnet",
  TESTNET = "testnet",
  MAINNET = "mainnet"
};
const NETWORKS = [NETWORK.DEVNET, NETWORK.TESTNET, NETWORK.MAINNET];

export const EnvConfig = {
  fullnode: {
    protocol: process.env.FULLNODE_PROTOCOL as string,
    host: process.env.FULLNODE_HOST as string,
    port: Number(process.env.FULLNODE_PORT),
    addr: () => `${EnvConfig.fullnode.protocol}://${EnvConfig.fullnode.host}:${EnvConfig.fullnode.port}`,
    apiKey: process.env.FULLNODE_API_KEY as string,
  },
  telegram: {
    bot: {
      token: process.env.TG_BOT_TOKEN as string || "",
    },
    admins: (process.env.TG_ADMIN_UIDS as string || "").split(",").filter(v => v.length > 0).map(v => Number(v)),
  },
  database: {
    path: () => process.env.DB_PATH as string || `./data/${EnvConfig.network}.database.sqlite`,
  },
  // Using an array allows to pre-process elements
  network: [process.env.NETWORK as string || ""].map((n: string) => NETWORKS.map(network => network.toString()).includes(n.toLowerCase()) ? n : NETWORK.DEVNET)[0],
  explorerAddress: () => {
    switch (EnvConfig.network) {
      case NETWORK.MAINNET:
        return "https://explorer.alephium.org";
      case NETWORK.TESTNET:
        return "https://testnet.alephium.org";
      default:
        return undefined;
    }
  },
  isOnDevNet: () => NETWORK.DEVNET === EnvConfig.network,
  operator: {
    fees: Number(process.env.OPERATOR_FEES as string || "0"),
    addressesByGroup: [
        process.env.OPERATOR_WALLET_ADDRESS_G0 as string,
        process.env.OPERATOR_WALLET_ADDRESS_G1 as string,
        process.env.OPERATOR_WALLET_ADDRESS_G2 as string,
        process.env.OPERATOR_WALLET_ADDRESS_G3 as string,
    ],
  },
  bot: {
    nbUTXOBeforeConsolidation: Number(process.env.NUM_UTXO_BEFORE_CONSOLIDATION as string || "50"),
    nbConfirmationsInternalTransfer: Number(process.env.NUM_CONFIRMATIONS_INTERNAL_TRANSFER as string || "1"),
    nbConfirmationsExternalTransfer: Number(process.env.NUM_CONFIRMATIONS_EXTERNAL_TRANSFER as string || "1"),
    considerMempool: "true" === (process.env.CONSIDER_MEMPOOL as string || "false").toLowerCase(),
    onlyAllowAdmins: "true" === (process.env.ONLY_ALLOW_ADMIN as string || "false").toLowerCase(),
  }
} as const;

export const readMnemonic = () => {
  for (let secretFolder of SECRET_FOLDER) {
    const secretFile = `${secretFolder}/${MNEMONIC_FILE}`;
    if (existsSync(secretFile))
      return readFileSync(secretFile, {flag: 'r', encoding: 'utf8'});
  }
  throw new Error("mnemonic not found!");
};