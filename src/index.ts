import { AppDataSource, initializationDBMutex } from "./db/data-source";  //!\ This import needs to be the first one!
import { EnvConfig, readMnemonic } from "./config";
import { createAlphClient } from "./services/alephium";
import { TokenManager } from "./tokens/tokenManager";
import { runTelegram } from "./telegram/bot";
import { Token } from "./db/token";
import { User } from "./db/user";

import * as dotenv from "dotenv";

dotenv.config();

console.log(`Proceeding in the ${EnvConfig.network}`);

const userRepository = AppDataSource.getRepository(User);
const tokenRepository = AppDataSource.getRepository(Token);

initializationDBMutex.waitForUnlock()
.then(async () => {
  const tokenManager = new TokenManager(tokenRepository);

  const alphClient = await createAlphClient(readMnemonic, userRepository, EnvConfig.fullnode, tokenManager);

  runTelegram(alphClient, userRepository, tokenManager);
})
.catch(err => console.error("Failed to start:", err))
