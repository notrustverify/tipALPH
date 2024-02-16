import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';

config({ path: ['.env', "./data/.env"] });
const MNEMONIC_FILE = "bot_mnemonic.txt";
const SECRET_FOLDER = [`/run/secrets`, `./secrets/`];

export const EnvConfig = {
  fullnode: {
    protocol: process.env.FULLNODE_PROTOCOL as string,
    host: process.env.FULLNODE_HOST as string,
    port: Number(process.env.FULLNODE_PORT),
    addr: () => `${EnvConfig.fullnode.protocol}://${EnvConfig.fullnode.host}:${EnvConfig.fullnode.port}`,
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
  network: process.env.NETWORK as string || "testnet",
  isDevEnv: undefined !== process.env.DEV && Boolean(process.env.DEV),
} as const;

export const readMnemonic = () => {
  for (let secretFolder of SECRET_FOLDER) {
    const secretFile = `${secretFolder}/${MNEMONIC_FILE}`;
    if (existsSync(secretFile))
      return readFileSync(secretFile, {flag: 'r', encoding: 'utf8'});
  }
  throw new Error("mnemonic not found!");
};