import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';

config({ path: ['.env'] });
const MNEMONIC_FILE = "bot_mnemonic.txt";
const SECRET_FOLDER = [`/run/secrets`, `./secrets/`];

export interface FullNodeConfig {
  readonly protocol: string,
  readonly host: string,
  readonly port: number,
  readonly addr: () => string,
  readonly apiKey?: string,
}

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
    admin: {
      users: (process.env.TG_ADMIN_UIDS as string || "").split(",").filter(v => v.length > 0).map(v => Number(v)),
    },
  },
  database: {
    path: process.env.DB_PATH as string,
  },
  network: process.env.NETWORK as string || "devnet",
  explorerAddress: () => {
    switch (EnvConfig.network) {
      case "mainnet":
        return "https://explorer.alephium.org";
      case "testnet":
        return "https://testnet.alephium.org";
      default:
        return undefined;
    }
  },
  isOnDevNet: () => "devnet" === EnvConfig.network,
  operator: {
    fees: Number(process.env.OPERATOR_FEES as string || "0"),
    address: process.env.OPERATOR_WALLET_ADDRESS as string,
  },
  bot: {
    nbUTXOBeforeConsolidation: Number(process.env.NUM_UTXO_BEFORE_CONSOLIDATION as string || "50"),
    nbConfirmationsInternalTransfer: Number(process.env.NUM_CONFIRMATIONS_INTERNAL_TRANSFER as string || "1"),
    nbConfirmationsExternalTransfer: Number(process.env.NUM_CONFIRMATIONS_EXTERNAL_TRANSFER as string || "1"),
    onlyAllowAdmins: "true" === process.env.ONLY_ALLOW_ADMIN.toLowerCase() || false,
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