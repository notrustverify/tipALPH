//import { AppDataSource } from "../src/db/data-source";
import { DataSource, Repository } from "typeorm"
import * as bip39 from "bip39";
import "reflect-metadata"; // Required by Typeorm

import { testNodeWallet } from '@alephium/web3-test'

import { AlphClient, createAlphClient } from "../src/services/alephium";
import { EnvConfig, FullNodeConfig } from "../src/config";
import * as Error from "../src/error";
import { User } from "../src/db/user";
import { Token } from "../src/db/token";
import { TokenManager } from "../src/tokens/tokenManager";

import * as dotenv from "dotenv";
import { convertAlphAmountWithDecimals } from "@alephium/web3";
import assert from "assert";

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
  const fullnodeConfig: FullNodeConfig = {
    protocol: "http",
    host: "127.0.0.1",
    port: 22973,
    addr: () => "http://127.0.0.1:22973"
  };
  alphClient = await createAlphClient(() => testMnemonic, userRepository, fullnodeConfig, tokenManager);
});

describe('AlphClient creation', function () {
  it("should fail if NodeProvider is un-available", async () => {
    const fullNodeConfig: FullNodeConfig = {
      protocol: "http",
      host: "11",
      port: 22,
      addr: () => "http://11:22",
    };
    expect.assertions(1);
    await expect(createAlphClient(() => testMnemonic, userRepository, fullNodeConfig, tokenManager)).rejects.not.toThrow();
  });

  it ("should succeed if NodeProvider is available and ready", async () => {
    const fullnodeConfig: FullNodeConfig = {
      protocol: "http",
      host: "127.0.0.1",
      port: 22973,
      addr: () => "http://127.0.0.1:22973"
    };
    expect.assertions(1);
    await expect(createAlphClient(() => testMnemonic, userRepository, fullnodeConfig, tokenManager)).resolves.toBeInstanceOf(AlphClient);
  });

});

describe('Relative to users', function () {

  it("database should be empty before tests", async () => {
    expect.assertions(2);
    await expect(userRepository.find()).resolves.toStrictEqual([]);
    await expect(userRepository.count()).resolves.toEqual(0);
  });

  // Create a bunch of users
  let testUsers: User[] = [];
  for (let i = 0; i < 4; i++)
    testUsers.push(new User(i, `${i}`));

  it("should not return balance for unregistered users", async () => {
      
  });

  it("new users should be able to register", async () => {
    expect.assertions(2*testUsers.length + 1);
    for (const u of testUsers) {
      let storedU = await alphClient.registerUser(u);
      expect(storedU.telegramId).toEqual(u.telegramId);
      expect(storedU.telegramUsername).toEqual(u.telegramUsername);
    };
    await expect(userRepository.count()).resolves.toEqual(testUsers.length);
  });

  it("users should not be able to register twice", async () => {
    expect.assertions(testUsers.length + 1);
    for (let i = 0; i < testUsers.length; i++) {
      await expect(alphClient.registerUser(testUsers[i])).rejects.toEqual(Error.ErrorTypes.USER_ALREADY_REGISTERED);
    }
    await expect(userRepository.count()).resolves.toEqual(testUsers.length);
  });

  // deposit some ALPH for each user
  it('users should be able to receive ALPH', async () => {
    expect.assertions(3*testUsers.length);

    const testWallet = await testNodeWallet();
    const distributedAmount = 2.5;

    for (const user of testUsers) {
      await testWallet.signAndSubmitTransferTx({
        signerAddress: (await testWallet.getSelectedAccount()).address,
        destinations: [
          { address: user.address, attoAlphAmount: convertAlphAmountWithDecimals(distributedAmount.toString())! }
        ]
      })
    }

    // check user balance
    for (const user of testUsers) {
      const userBalance = await alphClient.getUserBalance(user)
      expect(userBalance.length).toEqual(1);
      expect(userBalance[0].amountAsNumber()).toEqual(distributedAmount)
      expect(userBalance[0].token.id).toEqual("0000000000000000000000000000000000000000000000000000000000000000")
    }

  });

});
