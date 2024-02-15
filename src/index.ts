import { AppDataSource } from "./db/data-source.js";  //!\ This import needs to be the first one!
import { runTelegram } from "./telegram.js";
import { createAlphClient } from "./alephium.js";

import * as dotenv from 'dotenv';
import { EnvConfig, readMnemonic } from "./config.js";
import { User } from "./db/user.js";

dotenv.config();

if (EnvConfig.isDevEnv) {
  console.log("Proceeding in dev environment");
}

const userRepository = AppDataSource.getRepository(User);

// TODO: Ensure that we have at least 4 addresses for collecting withdrawal fees

createAlphClient(EnvConfig.fullnode.addr(), readMnemonic(), userRepository)
  .then(alphClient => {

    runTelegram(alphClient, userRepository);
  });
