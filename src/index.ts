import "./instrumentation.js"; // Should be run first to be able to instrument the code later
import { AppDataSource, initializationDBMutex } from "./db/data-source.js";  //!\ This import needs to be the first one!
import { createAlphClient } from "./services/alephium.js";
import { TokenManager } from "./tokens/tokenManager.js";
import { EnvConfig, readMnemonic } from "./config.js";
import { runTelegram } from "./telegram/bot.js";
import { Token } from "./db/token.js";
import { User } from "./db/user.js";

import * as dotenv from "dotenv";
import { metrics, ValueType } from "@opentelemetry/api";

dotenv.config();

console.log(`Proceeding in the ${EnvConfig.network}`);

const userRepository = AppDataSource.getRepository(User);
const tokenRepository = AppDataSource.getRepository(Token);

const meter = metrics.getMeter('userRepository');

initializationDBMutex.waitForUnlock()
.then(async () => {

  const tokenManager = new TokenManager(tokenRepository);

  const alphClient = await createAlphClient(readMnemonic, userRepository, EnvConfig.fullnode, tokenManager, EnvConfig.operator);

  // Add some gauge metrics
  meter.createObservableGauge('tipalph_nb_users', {
    description: "Current number of users of TipALPH",
    unit: 'users',
    valueType: ValueType.INT,
  }).addCallback(async observableResult => {
    const currentNbUser = await userRepository.count()
    observableResult.observe(currentNbUser);
  });

  meter.createObservableGauge('tipalph_nb_tokens', {
    description: "Current number of registered tokens in TipALPH",
    unit: 'tokens',
    valueType: ValueType.INT,
  }).addCallback(async observableResult => {
    const currentNbToken = await tokenRepository.count()
    observableResult.observe(currentNbToken);
  });

  runTelegram(alphClient, userRepository, tokenManager);
})
.catch(err => console.error("Failed to start:", err))
