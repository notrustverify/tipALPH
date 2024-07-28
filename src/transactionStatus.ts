import { EnvConfig } from "./config.js";

enum TransactionState {
    PENDING = "&#8987;",
    CONFIRMED = "&#9989;",
    FAILED = "&#10060;"
}

type DisplayFunction = (a: string) => void;

export function genTxIdText(txId?: string): string {
    let txIdText = "";
    if (undefined !== EnvConfig.explorerAddress() && undefined !== txId)
        txIdText = `(<a href="${EnvConfig.explorerAddress()}/transactions/${txId}">tx</a>)`;
    return txIdText;
}

class TransactionStepStatus {
    private readonly stepMsg: string;
    private txId: string;
    private state: TransactionState;

    constructor(stepMsg: string, currentState: TransactionState = TransactionState.PENDING) {
        this.stepMsg = stepMsg;
        this.state = currentState;
    }

    setPending(): TransactionStepStatus {
        this.state = TransactionState.PENDING;
        return this;
    }

    setConfirmed(): TransactionStepStatus {
        this.state = TransactionState.CONFIRMED;
        return this;
    }

    setFailed(): TransactionStepStatus {
        this.state = TransactionState.FAILED;
        return this;
    }

    setTransactionId(txId: string): TransactionStepStatus {
        this.txId = txId;
        return this;
    }

    genTxIdText(): string {
        return undefined !== this.txId ? ` ${genTxIdText(this.txId)}` : "";
    }

    genUpdateMsg(): string {
        return `${this.stepMsg} ${this.state}${this.genTxIdText()}`;
    }
}

export class TransactionStatus {
    private readonly baseMsg: string;
    //private readonly stepMsg: string;
    private transactionsSteps: TransactionStepStatus[];
    private currentStepIndex: number = 0;
    //private txId: string;
    //private state: TransactionState;
    private htmlDisplayer: DisplayFunction;

    constructor(baseMsg: string, stepMsg: string | string[], htmlDisplayer?: DisplayFunction, currentState: TransactionState = TransactionState.PENDING) {
        this.baseMsg = baseMsg;

        if (typeof stepMsg === "string")
            this.transactionsSteps = [new TransactionStepStatus(stepMsg, currentState)];
        else
            this.transactionsSteps = stepMsg.map(s => new TransactionStepStatus(s, currentState));

        //this.state = currentState;
        this.htmlDisplayer = htmlDisplayer;
    }

    setDisplayUpdate(htmlDisplayer: DisplayFunction): TransactionStatus {
        this.htmlDisplayer = htmlDisplayer;
        return this;
    }

    setPending(stepNumber?: number): TransactionStatus {
        const stepToChange = this.getStepToChange(stepNumber);
        if (stepToChange >= 0 && stepToChange < this.transactionsSteps.length)
            this.transactionsSteps[stepToChange].setPending();
        return this;
    }

    setConfirmed(stepNumber?: number): TransactionStatus {
        const stepToChange = this.getStepToChange(stepNumber);
        if (stepToChange >= 0 && stepToChange < this.transactionsSteps.length)
            this.transactionsSteps[stepToChange].setConfirmed();
        return this;
    }

    setFailed(stepNumber?: number): TransactionStatus {
        for (let s = this.getStepToChange(stepNumber); s >= 0 && s < this.transactionsSteps.length; s++) {
            this.transactionsSteps[s].setFailed();
        }
        return this;
    }

    setTransactionId(txId: string, stepNumber?: number): TransactionStatus {
        //this.txId = txId;
        const stepToChange = this.getStepToChange(stepNumber);
        if (stepToChange >= 0 && stepToChange < this.transactionsSteps.length)
            this.transactionsSteps[stepToChange].setTransactionId(txId);
        return this;
    }

    nextStep(): TransactionStatus {
        this.currentStepIndex++;
        return this;
    }

    private getStepToChange(stepNumber?: number): number {
        return undefined === stepNumber ? this.currentStepIndex : stepNumber;
    }

    private genUpdateMsg(): string {
        return `${this.baseMsg}\n${this.transactionsSteps.map(t => (this.transactionsSteps.length > 1 ? " &#8226; " : "") + t.genUpdateMsg()).join("\n")}`;
    }

    async displayUpdate() {
        if (undefined !== this.htmlDisplayer)
            return await Promise.resolve(this.htmlDisplayer(this.genUpdateMsg()));
    }

    toString(): string {
        return this.genUpdateMsg();
    }
}