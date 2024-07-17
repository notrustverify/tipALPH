//import { AppDataSource } from "../src/db/data-source";
import { DataSource, Repository } from "typeorm"
import * as bip39 from "bip39";
import "reflect-metadata"; // Required by Typeorm
import * as dotenv from "dotenv";
import { convertAlphAmountWithDecimals, DEFAULT_GAS_ALPH_AMOUNT, isValidAddress, node, NodeProvider, number256ToNumber, web3 } from "@alephium/web3";

import { testNodeWallet } from "@alephium/web3-test";

import { AlphClient, createAlphClient } from "../src/services/alephium";
import { FullNodeConfig, OperatorConfig } from "../src/config";
import * as Error from "../src/error";
import { User } from "../src/db/user";
import { Token } from "../src/db/token";
import { TokenManager } from "../src/tokens/tokenManager";
import { roundToThreeDecimals } from "./utils";
import { TokenAmount } from "../src/tokens/tokenAmount";
import { deriveHDWalletPrivateKey, PrivateKeyWallet } from "@alephium/web3-wallet";

dotenv.config();

type GroupAddresses = readonly [string, string, string, string]

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
let operatorConfig: OperatorConfig;
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

  const nodeProvider = fullnodeConfig.apiKey ? new NodeProvider(fullnodeConfig.addr(), fullnodeConfig.apiKey) : new NodeProvider(fullnodeConfig.addr());
  const addresses: GroupAddresses = await ((async (): Promise<GroupAddresses> => {
    const otherMnemonic = bip39.generateMnemonic(256);
    let addresses: [string, string, string, string] = ["", "", "", ""];
    
    for (let i = 0; addresses.some(p => p.length == 0); i++) {
      let pk = new PrivateKeyWallet({ privateKey: deriveHDWalletPrivateKey(otherMnemonic, 'default', i), nodeProvider: nodeProvider });
      let addressGroup = await nodeProvider.addresses.getAddressesAddressGroup(pk.address);
      if (0 == addresses[addressGroup.group].length)
        addresses[addressGroup.group] = pk.address;
    }

    return addresses;
  })());
  operatorConfig = { fees: 3, addressesByGroup: addresses };

  alphClient = await createAlphClient(() => testMnemonic, userRepository, fullnodeConfig, tokenManager, operatorConfig);
});

describe("AlphClient creation", () => {
  it("should fail if NodeProvider is un-available", async () => {
    const fullNodeConfig: FullNodeConfig = {
      protocol: "http",
      host: "11",
      port: 22,
      addr: () => "http://11:22",
    };
    expect.assertions(1);
    await expect(createAlphClient(() => testMnemonic, userRepository, fullNodeConfig, tokenManager, operatorConfig)).rejects.not.toThrow();
  });

  it ("should succeed if NodeProvider is available and ready", async () => {
    const fullnodeConfig: FullNodeConfig = {
      protocol: "http",
      host: "127.0.0.1",
      port: 22973,
      addr: () => "http://127.0.0.1:22973"
    };
    expect.assertions(1);
    await expect(createAlphClient(() => testMnemonic, userRepository, fullnodeConfig, tokenManager, operatorConfig)).resolves.toBeInstanceOf(AlphClient);
  });

});

describe("Relative to users", () => {

  let distributedAmount: number = 10;

  describe("pre-check", () => {
    it("database should be empty before tests", async () => {
      expect.assertions(2);
      await expect(userRepository.find()).resolves.toStrictEqual([]);
      await expect(userRepository.count()).resolves.toEqual(0);
    });
  });

  // Create a bunch of users
  let testUsers: User[] = [];
  let storedUsers: User[] = [];
  for (let i = 0; i < nbUsersToHaveRepresentativeSample; i++)
    storedUsers.push(new User(i, `${i}`));

  describe("test actions", () => {
    it("new users should be able to register", async () => {

      expect.assertions(5*storedUsers.length + 2);

      for (let i = 0; i < storedUsers.length; i++) {
        let u = storedUsers[i];

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
      for (let i = 0; doWeHaveAUserForthisGroup.some(v => !v) && i < storedUsers.length; i++) {
        let u = storedUsers[i];
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
    it("users should be able to receive ALPH", async () => {
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
        expect(userBalance[0].amountAsNumber()).toEqual(distributedAmount);
        expect(userBalance[0].token.isALPH()).toBeTruthy();
      }
    });

    // This test is independant from the others 
    it("should not be able to tip more than it have", async () => {
      const testWallet = await testNodeWallet();
      const providedAmount: number = 2;
      const providedTokenAmount: TokenAmount = await tokenManager.getTokenAmountByTokenSymbol("ALPH", providedAmount.toString());

      expect.assertions(3 + 1 + (testUsers.length)*2);

      // Create new user
      const u = new User(storedUsers.length, `${storedUsers.length}`)
      await expect(alphClient.registerUser(u)).resolves.not.toBeNull();
      const uBalance = await alphClient.getUserBalance(u);
      expect(uBalance.length).toBe(1);
      expect(uBalance[0].amountAsNumber()).toBe(0)

      // Should fail as user has no ALPH
      for (let i = 0; i < testUsers.length; i++)
        await alphClient.transferFromUserToUser(u, testUsers[i], providedTokenAmount).catch(err => expect(err.message).toMatch(/not enough funds/));

      // Give it some ALPH
      await expect(testWallet.signAndSubmitTransferTx({
        signerAddress: (await testWallet.getSelectedAccount()).address,
        destinations: [
          { address: u.address, attoAlphAmount: convertAlphAmountWithDecimals(providedAmount.toString())! }
        ]
      }).catch(console.error)).resolves.not.toBeUndefined();

      // Should fail as user cannot afford gaz
      for (let i = 0; i < testUsers.length; i++)
        await alphClient.transferFromUserToUser(u, testUsers[i], providedTokenAmount).catch(err => expect(err.message).toMatch(/not enough funds/));
    });

    it("should be able to tip any other users", async () => {
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
        expect(userBalance[0].token.isALPH()).toBeTruthy();
      }

      // Everyone should just have lost the gaz fee
      for (const user of testUsers) {
        const userBalance = await alphClient.getUserBalance(user);
        expect(userBalance.length).toEqual(1);
        const expectedAmount = distributedAmount - (testUsers.length-1)*(DEFAULT_GAS_ALPH_AMOUNT);
        // explication:       amountBeforeTipping - forEach tip: gaz fee only (since they all sent 1 to each other, they all retreived the 1's they sent)
        expect(userBalance[0].amountAsNumber()).toEqual(roundToThreeDecimals(expectedAmount))
        expect(userBalance[0].token.isALPH()).toBeTruthy();
      }
    });

    describe("should successfully send small tips", () => {
      const smallTipsRange: number[] = [0.1, 0.08, 0.05, 0.03, 0.02, 0.01, 0.005, 0.001];
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
          const balanceDiff = initialBalance[i] - (testUsers.length-1)*DEFAULT_GAS_ALPH_AMOUNT - userBalance[0].amountAsNumber();
          expect(balanceDiff).toBeLessThan(DEFAULT_GAS_ALPH_AMOUNT);
          expect(userBalance[0].token.isALPH()).toBeTruthy();
        }
      });
    });

    it("should be able to withdraw to any address (including its own)", async () => {
      expect.assertions(2 + testUsers.length*(testUsers.length + 3) + 2*operatorConfig.addressesByGroup.length);
      expect(operatorConfig.addressesByGroup.length).toEqual(4);
      expect(testUsers.length).toBeGreaterThan(0);

      // Check the initial balance before test
      const initialBalance: number[] = [];
      for (const user of testUsers) {
        const userBalance = await alphClient.getUserBalance(user);
        initialBalance.push(userBalance[0].amountAsNumber());
      }

      const nodeProvider = web3.getCurrentNodeProvider();
      const nbALPHDecimals = (await tokenManager.getAlphToken()).decimals;
      // Ensure that no fee has been taken so far
      for (const feeAddress of operatorConfig.addressesByGroup) {
        const feeAddressBalance = await nodeProvider.addresses.getAddressesAddressBalance(feeAddress);
        expect(number256ToNumber(feeAddressBalance.balance, nbALPHDecimals)).toEqual(0);
      }
      
      const withdrawAmount = 1;
      const tokenAmount = await tokenManager.getTokenAmountByTokenSymbol("ALPH", withdrawAmount.toString());
      const operatorFeeTokenAmount = tokenAmount.getPercentage(operatorConfig.fees);

      for (const user of testUsers)
        for (const otherUser of testUsers)
          await expect(alphClient.sendAmountToAddressFrom(user, tokenAmount, otherUser.address)).resolves.toMatch(/.+/);

      // Check if operator correctly took its fees
      for (let i = 0; i < operatorConfig.addressesByGroup.length; i++) {
        const expectedAmount = testUsers.length*(operatorFeeTokenAmount.amountAsNumber());
        
        const feeAddressBalance = await nodeProvider.addresses.getAddressesAddressBalance(operatorConfig.addressesByGroup[i]);
        // We expect a variation between what is expected and what is really taken
        const diffBetweenActualAndExpectation = number256ToNumber(feeAddressBalance.balance, nbALPHDecimals) - expectedAmount;
        console.warn(`Fee address ${i}: expected: ${expectedAmount}, observed: ${number256ToNumber(feeAddressBalance.balance, nbALPHDecimals)}`)
        expect(Math.abs(diffBetweenActualAndExpectation)).toBeLessThanOrEqual(withdrawAmount/2);  // TODO: find better bound
      }

      // Everyone should just have lost the gaz and operator fee
      for (let i = 0; i < testUsers.length; i++) {
        // check user balance
        const userBalance = await alphClient.getUserBalance(testUsers[i]);
        expect(userBalance.length).toEqual(1);
        const expectedAmount = initialBalance[i] - testUsers.length*withdrawAmount + testUsers.length*(withdrawAmount - DEFAULT_GAS_ALPH_AMOUNT - operatorFeeTokenAmount.amountAsNumber());
        // explication:       
        const diffBetweenActualAndExpectation = userBalance[0].amountAsNumber() - expectedAmount;
        console.warn(`User ${i}: expected: ${expectedAmount}, observed: ${userBalance[0].amountAsNumber()}`);
        expect(Math.abs(diffBetweenActualAndExpectation)).toBeLessThanOrEqual(withdrawAmount/2);   // TODO: find better bound
        expect(userBalance[0].token.isALPH()).toBeTruthy();
      }
    });

    /*
    describe("should be able to withdraw small amounts", () => {
      const smallAmounts: number[] = [0.1, 0.08, 0.05, 0.03, 0.02, 0.01];
      it.each(smallAmounts)("of %s ALPH", async withdrawAmount => {
        expect(testUsers.length).toBeGreaterThan(0);

        // Check the initial balance before test
        const initialBalance: number[] = [];
        for (const user of testUsers) {
          const userBalance = await alphClient.getUserBalance(user);
          initialBalance.push(userBalance[0].amountAsNumber());
        }
        
        for (const withdrawAmount of smallWithdrawAmounts) {
          const tokenAmount = await tokenManager.getTokenAmountByTokenSymbol("ALPH", `${withdrawAmount}`);

          for (let i = 0; i < testUsers.length; i++) {
            let user = testUsers[i];
            for (const otherUser of testUsers) {
              if (user.id === otherUser.id)
                continue;
              await expect(alphClient.sendAmountToAddressFrom(user, tokenAmount, otherUser.address)).resolves.toMatch(/.+/);
            }
          }
        }

        // Everyone should just have lost the gaz fee
        for (let i = 0; i < testUsers.length; i++) {
          // check user balance
          const userBalance = await alphClient.getUserBalance(testUsers[i]);
          expect(userBalance.length).toEqual(1);
          const expectedAmount = initialBalance[i] - smallWithdrawAmounts.map(v => (testUsers.length-1)*(DEFAULT_GAS_ALPH_AMOUNT + v*EnvConfig.operator.fees)).reduce((p: number, c: number) => p+c, 0.0);
          // explication:      amountBeforeTipping - sum of (forEach amount: (operator percentage and the gaz fees) * number of addresses withdrawn to)
          expect(userBalance[0].amountAsNumber()).toEqual(roundToSixDecimals(expectedAmount));
          expect(userBalance[0].token.isALPH()).toBeTruthy();
        }
      });
    });
    */
  });
});
