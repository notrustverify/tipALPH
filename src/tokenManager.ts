import { Number256, convertAmountWithDecimals, number256ToBigint, prettifyTokenAmount } from '@alephium/web3';
import { Repository } from 'typeorm';

import { EnvConfig } from './config.js';
import { Token } from './db/token.js';

export class TokenAmount {
    amount: bigint;
    readonly token: Token;

    constructor(amount: Number256, token: Token) {
        this.amount = number256ToBigint(amount);
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

    public toString = () : string => `${prettifyTokenAmount(this.amount, this.token.decimals).replaceAll(",", "'")} $${this.token.symbol}`;
}

export type UserBalance = TokenAmount[];

export const ALPHSymbol = "ALPH";

export class TokenManager {
    tokenRepository: Repository<Token>;

    constructor(tokenRepository: Repository<Token>) {
        this.tokenRepository = tokenRepository;
    }

    async getTokenBySymbol(symbol: string): Promise<Token> {
        return this.tokenRepository.findOneBy({ symbol });
    }

    async getTokenByCaseInsensitiveSymbol(caseInsensitiveSymbol: string): Promise<Token> {
        return this.tokenRepository.createQueryBuilder().where("LOWER(symbol) = :s", { s: `${ caseInsensitiveSymbol.toLowerCase() }` }).getOne();
    }

    async getTokenById(id: string): Promise<Token> {
        return this.tokenRepository.findOneBy({ id });
    }

    async getTokenAmountFromIdAmount(id: string, amount: string): Promise<TokenAmount> {
        const token = await this.getTokenById(id);
        if (null === token) {
            return Promise.reject(`could not find token with id: "${id}" (amount: ${amount})`);
        }
        return new TokenAmount(amount, token);
    }

    async getTokenAmountByTokenSymbol(tokenSymbol: string, amount: string): Promise<TokenAmount> {
        const token = await this.getTokenByCaseInsensitiveSymbol(tokenSymbol);
        if (null === token) {
            return undefined;
        }
        return new TokenAmount(convertAmountWithDecimals(amount, token.decimals), token);
    }

    async getNumberTokens() {
        return await this.tokenRepository.count();
    }

    async getTokens(): Promise<Token[]> {
        return await this.tokenRepository.find();
    }

    async updateTokenDB() {
        if (EnvConfig.isOnDevNet()) {
            console.log("Cannot update token list for devnet");
            return;
        }
        const tokenListURL = `https://github.com/alephium/token-list/raw/master/tokens/${EnvConfig.network}.json`;
        const tokenListReq = await fetch(tokenListURL);
        const tokenList = await tokenListReq.json();
        const tokens = tokenList.tokens.map(t => new Token(t.id, t.name, t.symbol, t.decimals, t.description, t.logoURI));
        const ret = await this.tokenRepository.save(tokens);
        console.log(`Updated ${ret.length} tokens`);
    }
}