import { Number256 } from "@alephium/web3";

import { User } from "./db/user.js";

export enum ErrorTypes {
    UN_INITIALIZED_WALLET = "It seems that you haven't initialized your wallet yet. Hit `Start` in DM with me to do it!",
    USER_ALREADY_REGISTERED = "user already registered",
}

export function genUserMessageErrorWhile(action: string): string {
    return `An error occured while ${action}. Please try again later.`;
}

export function genLogMessageErrorWhile(action: string, err: Error | string, user?: User): string {
    return `failed to ${action} for ${user} (err: ${err})`
}

// From https://medium.com/with-orus/the-5-commandments-of-clean-error-handling-in-typescript-93a9cbdf1af5
type Jsonable = string | number | boolean | null | undefined | readonly Jsonable[] | { readonly [key: string]: Jsonable } | { toJSON(): Jsonable }
export class GeneralError extends Error {
  public readonly context?: Jsonable

  constructor(message: string, options: { error?: Error, context?: Jsonable } = {}) {
    const { error, context } = options;

    super(message, error );
    this.name = this.constructor.name;

    this.context = context;
  }
}

export function alphErrorIsNetworkError(value: Error): boolean {
  return (value instanceof Error) && "message" in value && undefined !== value.message && value.message == "fetch failed";
}

export class NetworkError extends GeneralError {
  constructor(error?: Error) {
    super("network error", { error });
  }
}

const alphAPIErrorRegex = /^[API Error] - /;

export function alphErrorIsAPIError(err: Error): boolean {
  let args: RegExpMatchArray
  return (args = alphAPIErrorRegex.exec(err.message)) && 1 == args.length;
}

export class AlphAPIError extends GeneralError {
  constructor(message: string, options: { error?: Error, context?: Jsonable } = {}) {
    super(message, options);
  }
}

const notEnoughBalanceForFeeRegex = /^\[API Error\] - Not enough balance for fee, maybe transfer a smaller amount$/;
export function alphErrorIsNotEnoughBalanceForFeeError(err: Error): boolean {
  if (!(err instanceof Error) || !("message" in err) || undefined === err.message) {
    console.error("Expected NotEnoughBalanceForFeeError: instead got", err);
    return false;
  }
  return null !== notEnoughBalanceForFeeRegex.exec(err.message);
}

export class NotEnoughBalanceForFeeError extends AlphAPIError {
  constructor(error?: Error) {
    super("not enough balance for fee", { error });
  }
}

const notEnoughALPHForTransactionOutput = /^\[API Error\] - Not enough ALPH for transaction output$/;
export function alphErrorIsNotEnoughALPHForTransactionOutputError(err: Error): boolean {
  if (!(err instanceof Error) || !("message" in err) || undefined === err.message) {
    console.error("Expected NotEnoughALPHForTransactionOutputError: instead got", err);
    return false;
  }
  return null !== notEnoughALPHForTransactionOutput.exec(err.message);
}

export class NotEnoughALPHForTransactionOutputError extends AlphAPIError {
  constructor(error?: Error) {
    super("not enough balance for fee", { error });
  }
}

const notEnoughFundsRegex = /^\[API Error\] - Not enough balance: got (\d+), expected (\d+)$/;
export function alphErrorIsNotEnoughFundsError(err: Error): boolean {
  if (!(err instanceof Error) || !("message" in err) || undefined === err.message) {
    console.error("Expected NotEnoughFundsError: instead got", err);
    return false;
  }
  let numbers: RegExpMatchArray;
  numbers = notEnoughFundsRegex.exec(err.message);
  return null !== numbers && 3 === numbers.length;
}

export class NotEnoughFundsError extends AlphAPIError {
  constructor(error?: Error) {
    let args = notEnoughFundsRegex.exec(error.message);
    super("not enough funds error", {
      error, context: { actualFunds: args[1], requiredFunds: args[2] }
    });
  }

  actualFunds(): Number256 {
    return BigInt(this.context["actualFunds"]);
  }

  requiredFunds(): Number256 {
    return BigInt(this.context["requiredFunds"]);
  }
}

const notEnoughALPHForALPHAndTokenChangeOutput = /^\[API Error\] - Not enough ALPH for ALPH and token change output, expected (\d+), got (\d+)$/;
export function alphErrorIsNotEnoughALPHForALPHAndTokenChangeOutputError(err: Error): boolean {
  if (!(err instanceof Error) || !("message" in err) || undefined === err.message) {
    console.error("Expected NotEnoughALPHForALPHAndTokenChangeOutputError: instead got", err);
    return false;
  }
  let numbers: RegExpMatchArray;
  numbers = notEnoughALPHForALPHAndTokenChangeOutput.exec(err.message);
  return null !== numbers && 3 === numbers.length;
}

export class NotEnoughALPHForALPHAndTokenChangeOutputError extends AlphAPIError {
  constructor(error?: Error) {
    let args = notEnoughALPHForALPHAndTokenChangeOutput.exec(error.message);
    super("not enough ALPH for ALPH and token change output error", {
      error, context: { expectedFunds: args[1], actualFunds: args[2] }
    });
  }

  actualFunds(): Number256 {
    return BigInt(this.context["actualFunds"]);
  }

  expectedFunds(): Number256 {
    return BigInt(this.context["expectedFunds"]);
  }
}

const notEnoughALPHForTokenChangeOutputRegex = /^\[API Error\] - Not enough ALPH for token change output, expected (\d+), got (\d+)$/;
export function alphErrorIsNotEnoughALPHForTokenChangeOutputError(err: Error): boolean {
  if (!(err instanceof Error) || !("message" in err) || undefined === err.message) {
    console.error("Expected NotEnoughALPHForTokenChangeOutputError: instead got", err);
    return false;
  }
  let numbers: RegExpMatchArray;
  numbers = notEnoughALPHForTokenChangeOutputRegex.exec(err.message);
  return null !== numbers && 3 === numbers.length;
}

export class NotEnoughALPHForTokenChangeOutputError extends AlphAPIError {
  constructor(error?: Error) {
    let args = notEnoughALPHForTokenChangeOutputRegex.exec(error.message);
    super("not enough ALPH for token change output error", {
      error, context: { expectedFunds: args[1], actualFunds: args[2] }
    });
  }

  actualFunds(): Number256 {
    return BigInt(this.context["actualFunds"]);
  }

  expectedFunds(): Number256 {
    return BigInt(this.context["expectedFunds"]);
  }
}

const notEnoughApprovedBalanceForAddress = /^\[API Error\] - Execution error when estimating gas for tx script or contract: Not enough approved balance for address ([\d|\w]+), tokenId: (\w+), expected: (\d+), got: (\d+)$/;
export function alphErrorIsNotEnoughApprovedBalanceForAddress(err: Error): boolean {
  if (!(err instanceof Error) || !("message" in err) || undefined === err.message) {
    console.error("Expected NotEnoughApprovedBalanceForAddressError: instead got", err);
    return false;
  }
  let numbers: RegExpMatchArray;
  numbers = notEnoughApprovedBalanceForAddress.exec(err.message);
  return null !== numbers && 5 === numbers.length;
}

export class NotEnoughApprovedBalanceForAddressError extends AlphAPIError {
  constructor(error?: Error) {
    let args = notEnoughApprovedBalanceForAddress.exec(error.message);
    super("not enough approved balance of token for address error", {
      error, context: { address: args[1], token: args[2], expectedFunds: args[3], actualFunds: args[4] }
    });
  }

  address(): string {
    return this.context["address"];
  }

  token(): string {
    return this.context["token"];
  }

  actualFunds(): string {
    return this.context["actualFunds"];
  }

  expectedFunds(): string {
    return this.context["expectedFunds"];
  }
}

export class InvalidAddressError extends GeneralError {
  constructor(invalidAddress: string) {
    super("invalid adress error", { context: { invalidAddress } });
  }

  invalidAddress(): string {
    return this.context["invalidAddress"];
  }
}