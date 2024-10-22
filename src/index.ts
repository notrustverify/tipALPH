import "./instrumentation.js"; // Should be run first to be able to instrument the code later
import { AppDataSource, initializationDBMutex } from "./db/data-source.js";  //!\ This import needs to be the first one!
import { createAlphClient } from "./services/alephium.js";
import { TokenManager } from "./tokens/tokenManager.js";
import { EnvConfig, readMnemonic } from "./config.js";
import { runTelegram } from "./telegram/bot.js";
import { Token } from "./db/token.js";
import { User } from "./db/user.js";

import * as dotenv from "dotenv";

dotenv.config();

console.log(`Proceeding in the ${EnvConfig.network}`);

const userRepository = AppDataSource.getRepository(User);
const tokenRepository = AppDataSource.getRepository(Token);

initializationDBMutex.waitForUnlock()
.then(async () => {

  const tokenManager = new TokenManager(tokenRepository);

  const alphClient = await createAlphClient(readMnemonic, userRepository, EnvConfig.fullnode, tokenManager, EnvConfig.operator);

  runTelegram(alphClient, userRepository, tokenManager);
})
.catch(err => console.error("Failed to start:", err))
