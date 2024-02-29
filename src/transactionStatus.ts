import { TokenAmount } from "./tokens/tokenAmount.js";
import { EnvConfig } from "./config.js";

enum TransactionState {
    PENDING = "&#8987;",
    CONFIRMED = "&#9989;",
    FAILED = "&#10060;"
}

type DisplayFunction = (a: string) => void;

export class TransactionStatus{
    private readonly baseMsg: string;
    private readonly tokenAmount: TokenAmount;
    private txId: string;
    private state: TransactionState;
    private htmlDisplayer: DisplayFunction;

    constructor(baseMsg: string, tokenAmount: TokenAmount, htmlDisplayer?: DisplayFunction, currentState: TransactionState = TransactionState.PENDING) {
        this.baseMsg = baseMsg;
        this.tokenAmount = tokenAmount;
        this.state = currentState;
        this.htmlDisplayer = htmlDisplayer;
    }

    setDisplayUpdate(htmlDisplayer: DisplayFunction): TransactionStatus {
        this.htmlDisplayer = htmlDisplayer;
        return this;
    }

    setPending(): TransactionStatus {
        this.state = TransactionState.PENDING;
        return this;
    }

    setConfirmed(): TransactionStatus {
        this.state = TransactionState.CONFIRMED;
        return this;
    }

    setFailed(): TransactionStatus {
        this.state = TransactionState.FAILED;
        return this;
    }

    setTransactionId(txId: string): TransactionStatus {
        this.txId = txId;
        return this;
    }

    genTxIdText(): string {
        let txIdText = "";
        if (undefined !== EnvConfig.explorerAddress() && undefined !== this.txId)
            txIdText = ` (<a href="${EnvConfig.explorerAddress()}/transactions/${this.txId}">tx</a>)`;
        return txIdText;
    }

    private genUpdateMsg(): string {
        return `${this.baseMsg}\n${this.tokenAmount.toString()} ${this.state}${this.genTxIdText()}`;
    }

    async displayUpdate() {
        if (undefined !== this.htmlDisplayer)
            return await Promise.resolve(this.htmlDisplayer(this.genUpdateMsg()));
    }

    toString(): string {
        return this.genUpdateMsg();
    }
}