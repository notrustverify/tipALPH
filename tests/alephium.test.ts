//import { AppDataSource } from "../src/db/data-source";
import { DataSource, Repository } from "typeorm"
import * as bip39 from "bip39";
import "reflect-metadata"; // Required by Typeorm

import { testNodeWallet } from '@alephium/web3-test'

import { AlphClient, createAlphClient } from "../src/services/alephium";
import { FullNodeConfig, EnvConfig } from "../src/config";
import * as Error from "../src/error";
import { User } from "../src/db/user";
import { Token } from "../src/db/token";
import { TokenManager } from "../src/tokens/tokenManager";

import * as dotenv from "dotenv";
import { convertAlphAmountWithDecimals, DEFAULT_GAS_ALPH_AMOUNT, isValidAddress, prettifyExactAmount, prettifyTokenAmount, web3 } from "@alephium/web3";
import { roundToSixDecimals, roundToThreeDecimals, roundToTwoDecimals } from "./utils";

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
const nbUsersToHaveRepresentativeSample = 20;

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

describe('AlphClient creation', () => {
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

describe('Relative to users', () => {

  let distributedAmount: number;

  describe("pre-check", () => {
    it("database should be empty before tests", async () => {
      expect.assertions(2);
      await expect(userRepository.find()).resolves.toStrictEqual([]);
      await expect(userRepository.count()).resolves.toEqual(0);
    });
  });

  // Create a bunch of users
  let testUsers: User[] = [];
  let unstoredUsers: User[] = [];
  for (let i = 0; i < nbUsersToHaveRepresentativeSample; i++)
    unstoredUsers.push(new User(i, `${i}`));

  distributedAmount = 10;

  describe("test actions", () => {
    it("new users should be able to register", async () => {

      expect.assertions(5*unstoredUsers.length + 2);

      for (let i = 0; i < unstoredUsers.length; i++) {
        let u = unstoredUsers[i];

        // Register the user
        let storedU = await alphClient.registerUser(u);
        expect(storedU.telegramId).toEqual(u.telegramId);
        expect(storedU.telegramUsername).toEqual(u.telegramUsername);
        expect(storedU.address).not.toBeNull();
        expect(storedU.address).not.toBeUndefined();
        expect(isValidAddress(storedU.address)).toBeTruthy()
      }

      await expect(userRepository.count()).resolves.toEqual(nbUsersToHaveRepresentativeSample);

      // Now that we generated enough users, we only keep one user per group (since no need for more)
      let doWeHaveAUserForthisGroup: [boolean, boolean, boolean, boolean] = [false, false, false, false]
      for (let i = 0; doWeHaveAUserForthisGroup.some(v => !v) && i < unstoredUsers.length; i++) {
        let u = unstoredUsers[i];
        let userGroup = await web3.getCurrentNodeProvider().addresses.getAddressesAddressGroup(u.address);
        if (!doWeHaveAUserForthisGroup[userGroup.group]) {
          doWeHaveAUserForthisGroup[userGroup.group] = true;
          testUsers.push(u);
        }
      }
      expect(doWeHaveAUserForthisGroup.every(v => v)).toBeTruthy();
    });
    
    it("should be a representative set of users", async () => {
      let doWeHaveAUserForthisGroup: [boolean, boolean, boolean, boolean] = [false, false, false, false]
      for (let i = 0; doWeHaveAUserForthisGroup.some(v => !v) && i < testUsers.length; i++) {
        let group = await web3.getCurrentNodeProvider().addresses.getAddressesAddressGroup(testUsers[i].address)
        doWeHaveAUserForthisGroup[group.group] = true
      }
      expect(doWeHaveAUserForthisGroup.every(v => v)).toBeTruthy()
    })

    it("users should not be able to register twice", async () => {
      expect.assertions(testUsers.length + 1 + 1);
      expect(testUsers.length).toBeGreaterThan(0);
      const previousCount = await userRepository.count();
      for (let i = 0; i < testUsers.length; i++) {
        await expect(alphClient.registerUser(testUsers[i])).rejects.toEqual(Error.ErrorTypes.USER_ALREADY_REGISTERED);
      }
      await expect(userRepository.count()).resolves.toEqual(previousCount);
    });

    // deposit some ALPH for each user
    it('users should be able to receive ALPH', async () => {
      expect.assertions(3*testUsers.length + 1);
      expect(testUsers.length).toBeGreaterThan(0);

      const testWallet = await testNodeWallet();

      for (const user of testUsers) {
        await testWallet.signAndSubmitTransferTx({
          signerAddress: (await testWallet.getSelectedAccount()).address,
          destinations: [
            { address: user.address, attoAlphAmount: convertAlphAmountWithDecimals(distributedAmount.toString())! }
          ]
        }).catch(console.error)
      }

      // check user balance
      for (const user of testUsers) {
        const userBalance = await alphClient.getUserBalance(user)
        expect(userBalance.length).toEqual(1);
        expect(userBalance[0].amountAsNumber()).toEqual(distributedAmount)
        expect(userBalance[0].token.id).toEqual("0000000000000000000000000000000000000000000000000000000000000000")
      }
    });

    it('should be able to tip any other users', async () => {
      const tippedAmount = 1;
      const tokenAmount = await tokenManager.getTokenAmountByTokenSymbol("ALPH", `${tippedAmount}`);
      expect.assertions(testUsers.length * (testUsers.length - 1 + 2*3) + 1)
      expect(testUsers.length).toBeGreaterThan(0);
      
      for (let i = 0; i < testUsers.length; i++) {
        let user = testUsers[i];
        for (const otherUser of testUsers) {
          if (user.id === otherUser.id)
            continue;
          await expect(alphClient.transferFromUserToUser(user, otherUser, tokenAmount)).resolves.toMatch(/.+/);
        }
        
        // check user balance
        const userBalance = await alphClient.getUserBalance(user);
        expect(userBalance.length).toEqual(1);
        const expectedAmount = distributedAmount - (testUsers.length-1)*(tippedAmount + DEFAULT_GAS_ALPH_AMOUNT) + i;
        // explication:       amountBeforeTipping - forEach tip (consider the amount tipped + gaz fee) + amount retreived by user having tipped previously (user 2 will have 1 more than user 1 during this evaluation since user 1 already sent back the tip from user 2) 
        expect(userBalance[0].amountAsNumber()).toEqual(roundToThreeDecimals(expectedAmount));
        expect(userBalance[0].token.id).toEqual("0000000000000000000000000000000000000000000000000000000000000000");
      }

      // Everyone should just have lost the gaz fee
      for (const user of testUsers) {
        const userBalance = await alphClient.getUserBalance(user);
        expect(userBalance.length).toEqual(1);
        const expectedAmount = distributedAmount - (testUsers.length-1)*(DEFAULT_GAS_ALPH_AMOUNT);
        // explication:       amountBeforeTipping - forEach tip: gaz fee only (since they all sent 1 to each other, they all retreived the 1's they sent)
        expect(userBalance[0].amountAsNumber()).toEqual(roundToThreeDecimals(expectedAmount))
        expect(userBalance[0].token.id).toEqual("0000000000000000000000000000000000000000000000000000000000000000")
      }
    });

    describe("should successfully send small tips", () => {
      const smallTipsRange: number[] = [0.1, 0.08, 0.05, 0.03, 0.02, 0.01, 0.005];
      it.each(smallTipsRange)("of %s ALPH", async smallTip => {
        expect.assertions(testUsers.length*((testUsers.length-1) + 3) + 1);
        expect(testUsers.length).toBeGreaterThan(0);

        // Check the initial balance before test
        const initialBalance: number[] = [];
        for (const user of testUsers) {
          const userBalance = await alphClient.getUserBalance(user);
          initialBalance.push(userBalance[0].amountAsNumber());
        }

        const tokenAmount = await tokenManager.getTokenAmountByTokenSymbol("ALPH", `${smallTip}`);
        for (let i = 0; i < testUsers.length; i++) {
          let user = testUsers[i];
          for (const otherUser of testUsers) {
            if (user.id === otherUser.id)
              continue;
            await expect(alphClient.transferFromUserToUser(user, otherUser, tokenAmount)).resolves.toMatch(/.+/);
          }
        }

        // Everyone should just have lost the gaz fee
        for (let i = 0; i < testUsers.length; i++) {
          const userBalance = await alphClient.getUserBalance(testUsers[i]);
          expect(userBalance.length).toEqual(1);
          expect(roundToThreeDecimals(userBalance[0].amountAsNumber())).toEqual(roundToThreeDecimals(initialBalance[i] - (testUsers.length-1)*DEFAULT_GAS_ALPH_AMOUNT))
          expect(userBalance[0].token.id).toEqual("0000000000000000000000000000000000000000000000000000000000000000")
        }
      });
    });
  });
});
