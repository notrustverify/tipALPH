import { AppDataSource, initializationDBMutex } from "./db/data-source.js";  //!\ This import needs to be the first one!
import { runTelegram } from "./telegram/bot.js";
import { createAlphClient } from "./alephium.js";
import { User } from "./db/user.js";

import { EnvConfig, readMnemonic } from "./config.js";
import * as dotenv from 'dotenv';

dotenv.config();

console.log(`Proceeding in the ${EnvConfig.network}`);

const userRepository = AppDataSource.getRepository(User);

initializationDBMutex.waitForUnlock()
.then(async () => {
  const alphClient = await createAlphClient(readMnemonic, userRepository, EnvConfig.fullnode);
  runTelegram(alphClient, userRepository);
}).catch(err => console.error("Failed to start:", err))
