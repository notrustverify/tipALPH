import { config } from 'dotenv';

config({ path: ['.env', "./data/.env"] });

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
      users: (process.env.TG_ADMIN_UIDS as string || "").split(",").map(v => Number(v)),
    },
  },
  wallet: {
    mnemonic: process.env.MNEMONIC as string,
  },
  database: {
    path: process.env.DB_PATH as string,
  },
  isDevEnv: undefined !== process.env.DEV && Boolean(process.env.DEV),
} as const;