//import { AppDataSource } from "../src/db/data-source";
import { DataSource, Repository } from "typeorm"
import * as bip39 from "bip39";
import "reflect-metadata"; // Required by Typeorm

import { AlphClient, createAlphClient } from "../src/services/alephium";
import { EnvConfig, FullNodeConfig } from "../src/config";
import * as Error from "../src/error";
import { User } from "../src/db/user";
import { Token } from "../src/db/token";
import { TokenManager } from "../src/tokens/tokenManager";

import * as dotenv from "dotenv";

dotenv.config();

// https://gist.github.com/Ciantic/be6a8b8ca27ee15e2223f642b5e01549
export const AppDataSource = new DataSource({
  type: "sqlite",
  database: ":memory:",
  dropSchema: true,
  entities: [User, Token],
  synchronize: true,
  logging: false,
});

let alphClient: AlphClient;
const testMnemonic = bip39.generateMnemonic(256);
let userRepository: Repository<User>;
let tokenRepository: Repository<Token>;
let tokenManager: TokenManager;

beforeAll(async () => {
  console.log(`Initializing account with mnemonic:\n${testMnemonic}`);

  await AppDataSource.initialize();
  userRepository = AppDataSource.getRepository(User);
  tokenRepository = AppDataSource.getRepository(Token);

  tokenManager = new TokenManager(tokenRepository);

  alphClient = await createAlphClient(() => testMnemonic, userRepository, EnvConfig.fullnode, tokenManager);
});

describe('Regarding NodeProvider', function () {
  it("should fail if NodeProvider is un-available", () => {
    const fullNodeConfig: FullNodeConfig = {
      protocol: "http",
      host: "11",
      port: 22,
      addr: () => "http://11:22",
    }
    expect(createAlphClient(() => testMnemonic, userRepository, fullNodeConfig, tokenManager)).rejects.not.toThrow();
  });
});

describe('Test AlphClient', function () {

  it ("database should be empty before tests", async () => {
    expect(userRepository.find()).resolves.toStrictEqual([]);
    expect(userRepository.count()).resolves.toEqual(0);
  });

  // Create a bunch of users
  let testUsers: User[] = [];
  for (let i = 0; i < 3; i++)
  testUsers.push(new User(i, `${i}`));

  it("should not return balance for unregistered users", async () => {
      
  });

  it("new users should be able to register", async () => {
    for (let i = 0; i < testUsers.length; i++) {
      let u = testUsers[i];
      let registerPromise = alphClient.registerUser(u);
      let storedU = await registerPromise;
      expect(storedU.id).toBeGreaterThanOrEqual(i);
      expect(storedU.telegramId).toEqual(u.telegramId);
      expect(storedU.telegramUsername).toEqual(u.telegramUsername);
    };
    expect(userRepository.count()).resolves.toEqual(testUsers.length);
  });

  it("users should not be able to register twice", async () => {
    for (let i = 0; i< testUsers.length; i++) {
      await expect(alphClient.registerUser(testUsers[i])).rejects.toEqual(Error.ErrorTypes.USER_ALREADY_REGISTERED);
    }
    await expect(userRepository.count()).resolves.toEqual(testUsers.length);
  });

  it('should work', async function () {
    alphClient;
    return true;
  });

});
