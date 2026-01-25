import { isValidAddress } from "@alephium/web3";

describe("groupless address support", () => {
  const p2pkGrouped = "3cUqhqEgt8qFAokkD7qRsy9Q2Q9S1LEiSdogbBmaq7CnshB8BdjfK:1";
  const p2pkGroupless = "3cUqhqEgt8qFAokkD7qRsy9Q2Q9S1LEiSdogbBmaq7CnshB8BdjfK";
  const p2hmpkGrouped = "CSYxX7pdWvrbqAQFfHaUsrL4xpgXKktsQF2yJ8P53AmCyGiNbU:0";
  const p2hmpkGroupless = "CSYxX7pdWvrbqAQFfHaUsrL4xpgXKktsQF2yJ8P53AmCyGiNbU";
  const p2pkhLegacy = "1GUgKXvPNkgEa6MBDXsKMGvpyyJnzwVMc1Zrzz2N78PiL";

  it("accepts grouped and groupless P2PK/P2HMPK addresses", () => {
    expect(isValidAddress(p2pkGrouped)).toBe(true);
    expect(isValidAddress(p2pkGroupless)).toBe(true);
    expect(isValidAddress(p2hmpkGrouped)).toBe(true);
    expect(isValidAddress(p2hmpkGroupless)).toBe(true);
  });

  it("accepts legacy P2PKH addresses", () => {
    expect(isValidAddress(p2pkhLegacy)).toBe(true);
  });
});

