import {Number256, convertAmountWithDecimals, number256ToBigint, number256ToNumber, prettifyTokenAmount } from "@alephium/web3";

import { Token } from "../db/token";
import { groupBy } from "../utils";

export class TokenAmount {
    amount: bigint;
    readonly token: Token;

    constructor(amount: Number256, token: Token, needConversionToDecimals: boolean = false) {
        this.amount = needConversionToDecimals ? convertAmountWithDecimals(amount.toString(), token.decimals) : number256ToBigint(amount);
        this.token = token;
    }

    private computeAmountPercentage(percentage: bigint): bigint {
        return this.amount*percentage/BigInt(100);
    }

    // Used to collect operator fees
    public substractAndGetPercentage(percentage: number): TokenAmount {
        const amountPercentage = this.computeAmountPercentage(BigInt(percentage));
        this.amount -= amountPercentage;
        return new TokenAmount(amountPercentage, this.token);
    }

    public getPercentage(percentage: number): TokenAmount {
        return new TokenAmount(this.computeAmountPercentage(BigInt(percentage)), this.token);
    }

    public amountAsNumber(): number {
        return number256ToNumber(this.amount, this.token.decimals);
    }

    public toString = () : string => `${prettifyTokenAmount(this.amount, this.token.decimals).replaceAll(",", "'")} $${this.token.symbol}`;

    public toJSON(): string {
        return JSON.stringify(this);
    }
}

export type UserBalance = TokenAmount[];

function sumSimilarTokenAmounts(tokenAmounts: TokenAmount[]): TokenAmount {
    if (0 === tokenAmounts.length)
        return undefined;

    return tokenAmounts.reduce((prevTA, currTA, currIndex, listOfTA) => {
        return new TokenAmount(prevTA.amount + currTA.amount, prevTA.token);
    }, new TokenAmount(BigInt(0), tokenAmounts[0].token));
}

function sumTokenAmounts(tokenAmounts: TokenAmount[]): UserBalance {
    const groupedTokenAmount = groupBy(tokenAmounts, t => t.token.symbol);
    const totalTokenAmounts = Object.keys(groupedTokenAmount).map(k => sumSimilarTokenAmounts(groupedTokenAmount[k]));
    return totalTokenAmounts;
}

export function sumUserBalance(userBalance: UserBalance[]): UserBalance {
    return sumTokenAmounts(userBalance.flat());
}