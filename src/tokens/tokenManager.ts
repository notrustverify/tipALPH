import { convertAmountWithDecimals } from '@alephium/web3';
import { Repository } from 'typeorm';
import { Mutex } from 'async-mutex';
import { CronJob } from 'cron';

import { TokenAmount } from './tokenAmount.js';
import { EnvConfig } from '../config.js';
import { Token } from '../db/token.js';

export const ALPHSymbol = "ALPH";

export class TokenManager {
    private readonly tokenRepository: Repository<Token>;
    private readonly updateTokenMutex: Mutex;
    private readonly cronjob: CronJob;

    constructor(tokenRepository: Repository<Token>) {
        this.updateTokenMutex = new Mutex();

        console.log("UpdateTokenDB cron: initialised and started");
        this.cronjob = new CronJob("0 0 * * * *", () => {
            this.updateTokenDB();
        }, null, true, "Europe/London", null, true);

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
        if (null === token)
            return Promise.reject(`could not find token with id: "${id}" (amount: ${amount})`);
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
        await this.updateTokenMutex.acquire();
        console.log("Starting token update");

        if (EnvConfig.isOnDevNet()) {
            console.log("Cannot update token list for devnet");
            this.updateTokenMutex.release();
            return;
        }

        const nbTokens = await this.getNumberTokens();
        if (0 === nbTokens) { // If no token are stored, we add the ALPH
            await this.tokenRepository.save(new Token(''.padStart(64, '0'), "Alephium", "ALPH", 18));
        }

        const tokenListURL = `https://github.com/alephium/token-list/raw/master/tokens/${EnvConfig.network}.json`;
        const tokenListReq = await fetch(tokenListURL);
        const tokenList = await tokenListReq.json();
        const tokens = tokenList.tokens.map((t: any) => new Token(t.id, t.name, t.symbol, t.decimals, t.description, t.logoURI));
        const ret = await this.tokenRepository.save(tokens);
        console.log(`Updated ${ret.length} tokens (${nbTokens} before)`);

        this.updateTokenMutex.release();
    }

    lastTokenUpdate(): number { // In seconds
        return (+Date.now() - +this.cronjob.lastDate())/1000;
    }

    nextTokenUpdate(): number { // In seconds
        return (+this.cronjob.nextDate() - +Date.now())/1000;
    }

    stopCron() {
        this.cronjob.stop();
        console.log("UpdateTokenDB cron: stopped");
    }
}