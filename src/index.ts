import { AppDataSource } from "./db/data-source.js";  //!\ This import needs to be the first one!
import { runTelegram } from "./telegram/bot.js";
import { createAlphClient } from "./alephium.js";
import { User } from "./db/user.js";

import { EnvConfig, readMnemonic } from "./config.js";
import * as dotenv from 'dotenv';

dotenv.config();

if (EnvConfig.isDevEnv) {
  console.log("Proceeding in dev environment");
}

const userRepository = AppDataSource.getRepository(User);

// TODO: Ensure that we have at least 4 addresses for collecting withdrawal fees

createAlphClient(readMnemonic, userRepository, EnvConfig.fullnode)
  .then(alphClient => {
    runTelegram(alphClient, userRepository);
  })
  .catch(err => {
    console.error("Failed to start:", err);
  });
