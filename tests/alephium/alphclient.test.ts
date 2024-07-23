import { Repository } from "typeorm";
import * as bip39 from "bip39";

import { AlphClient, createAlphClient } from "../../src/services/alephium";
import { User } from "../../src/db/user";
import { TokenManager } from "../../src/tokens/tokenManager";
import { FullNodeConfig, OperatorConfig } from "../../src/config";

const testMnemonic = bip39.generateMnemonic(256);
let userRepository: Repository<User>;
let tokenManager: TokenManager;
let operatorConfig: OperatorConfig;

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