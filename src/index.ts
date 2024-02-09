import { AppDataSource } from "./db/data-source.js";  //!\ This import needs to be the first one!
import { runTelegram } from "./telegram.js";
import { createAlphClient } from "./alephium.js";

import * as dotenv from 'dotenv';
import { EnvConfig } from "./config.js";
import { User } from "./db/user.js";

dotenv.config();

if (EnvConfig.isDevEnv) {
  console.log("Proceeding in dev environment");
}

const userRepository = AppDataSource.getRepository(User);

createAlphClient(EnvConfig.fullnode.addr(), EnvConfig.wallet.mnemonic)
  .then(alphClient => {

    runTelegram(alphClient, userRepository)
  
  });
