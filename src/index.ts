import { AppDataSource, initializationDBMutex } from "./db/data-source.js";  //!\ This import needs to be the first one!
import { EnvConfig, readMnemonic } from "./config.js";
import { createAlphClient } from "./alephium.js";
import { TokenManager } from './tokenManager.js';
import { runTelegram } from "./telegram/bot.js";
import { Token } from './db/token.js';
import { User } from "./db/user.js";

import * as dotenv from 'dotenv';

dotenv.config();

console.log(`Proceeding in the ${EnvConfig.network}`);

const userRepository = AppDataSource.getRepository(User);
const tokenRepository = AppDataSource.getRepository(Token);

const tokenManager = new TokenManager(tokenRepository);

initializationDBMutex.waitForUnlock()
.then(async () => {
  if (1 >= await tokenManager.getNumberTokens()) { // Nothing or the ALPH token
    await tokenRepository.save(new Token(''.padStart(64, '0'), "Alephium", "ALPH", 18));
    await tokenManager.updateTokenDB();
  }
})
.then(async () => {
  const alphClient = await createAlphClient(readMnemonic, userRepository, EnvConfig.fullnode, tokenManager);

  runTelegram(alphClient, userRepository, tokenManager);
})
.catch(err => console.error("Failed to start:", err))
