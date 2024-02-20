import { EnvConfig } from "./config";

class TransactionState {
    readonly stateText: string;
    readonly stateEmoji: string;

    constructor(text: string, emoji: string) {
        this.stateText = text;
        this.stateEmoji = emoji;
    }

    toString(): string {
        return `${this.stateEmoji} ${this.stateText}`;
    }
}

const TransactionStatePending = new TransactionState("pending", "&#8987;");
const TransactionStateConfirmed = new TransactionState("confirmed", "&#9989;");
const TransactionStateFailed = new TransactionState("failed", "&#10060;");
export { TransactionStatePending, TransactionStateConfirmed, TransactionStateFailed }

type DisplayFunction = (a: string) => void;

export class TransactionStatus{
    private readonly baseMsg: string;
    private txId: string;
    private state: TransactionState;
    private htmlDisplayer: DisplayFunction;

    constructor(baseMsg: string, htmlDisplayer?: DisplayFunction, currentState: TransactionState = TransactionStatePending) {
        this.baseMsg = baseMsg;
        this.state = currentState;
        this.htmlDisplayer = htmlDisplayer;
    }

    setDisplayUpdate(htmlDisplayer: DisplayFunction): TransactionStatus {
        this.htmlDisplayer = htmlDisplayer;
        return this;
    }

    setPending(): TransactionStatus {
        this.state = TransactionStatePending;
        return this;
    }

    setConfirmed(): TransactionStatus {
        this.state = TransactionStateConfirmed;
        return this;
    }

    setFailed(): TransactionStatus {
        this.state = TransactionStateFailed;
        return this;
    }

    setTransactionId(txId: string): TransactionStatus {
        this.txId = txId;
        return this;
    }

    private genTxIdText(): string {
        let txIdText = "";
        if (undefined !== EnvConfig.explorerAddress() && undefined !== this.txId)
            txIdText = ` (<a href="${EnvConfig.explorerAddress()}/transactions/${this.txId}">tx</a>)`;
        return txIdText;
    }

    private genUpdateMsg(): string {
        return `${this.baseMsg}\n<b>Status</b>: ${this.state}${this.genTxIdText()}`;
    }

    displayUpdate() {
        if (undefined !== this.htmlDisplayer)
            this.htmlDisplayer(this.genUpdateMsg());
    }

    toString(): string {
        return this.genUpdateMsg();
    }
}