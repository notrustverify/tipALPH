import { DataSource } from "typeorm";
import { Mutex } from "async-mutex";
import "reflect-metadata"; // Required by Typeorm

import { EnvConfig } from "../config.js";
import { Token } from './token.js'
import { User } from "./user.js";

export const initializationDBMutex = new Mutex();
initializationDBMutex.acquire();

export const AppDataSource = new DataSource({
    type: "sqlite",
    database: EnvConfig.database.path(),
    entities: [User, Token],
    synchronize: true,
    logging: false,
    migrations: ["./migrations/1708944182700-AddTokenTable.ts"],
});

// to initialize the initial connection with the database, register all entities
// and "synchronize" database schema, call "initialize()" method of a newly created database
// once in your application bootstrap
AppDataSource.initialize()
  .then((appDataSource) => {
      // here you can start to work with your database
      console.log(`Initialized connection to database: ${appDataSource.options.database}`);
  })
  .catch((error) => {
    throw new Error(`failed to initialize connection to the database: ${error}`);
  })
  .finally(() => {
    initializationDBMutex.release();
  });