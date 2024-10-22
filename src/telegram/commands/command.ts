import { Attributes, Counter, Histogram, metrics, ValueType } from '@opentelemetry/api';
import * as Typegram from "telegraf/types";
import { Context } from "telegraf";

type ProcessOutcome = void | Promise<unknown>

const meter = metrics.getMeter('telegram');

export class Command {
    readonly name: string;
    readonly description: string;
    readonly isPrivate: boolean;
    readonly usage: string;
    readonly aliases: string[];
    readonly _process: (ctx: Context<Typegram.Update.MessageUpdate>) => ProcessOutcome;
    readonly cmdCounter: Counter<Attributes>;
    readonly cmdDuration: Histogram<Attributes>;
    readonly aliasCounter: Map<string, Counter<Attributes>>;

    // If usageWithoutCommand is provided, should end in `
    constructor(name: string, description: string, process: (ctx: Context<Typegram.Update.MessageUpdate>) => ProcessOutcome, isPrivate: boolean, usage?: string, aliases: string[] = []) {
        this.name = name;
        this.description = description;
        this._process = process;
        this.isPrivate = isPrivate;
        this.usage = usage!;
        
        this.cmdCounter = meter.createCounter(`telegram.${name}.counter`,{
            description: `A counter for the number of times the ${name} command has been called`,
            valueType: ValueType.INT,
        });

        this.cmdDuration = meter.createHistogram(`telegram.${name}.duration`, {
            description: `A distribution of the bot response times for the ${name} command`,
            unit: 'milliseconds',
            valueType: ValueType.DOUBLE,
        });

        this.aliasCounter = new Map<string, Counter<Attributes>>;
        for (const alias of aliases) {
            this.aliasCounter.set(alias, meter.createCounter(`telegram.${name}.alias.${alias}.counter`,{
                description: `A counter for the number of times the ${alias} alias of the ${name} command has been called`,
                valueType: ValueType.INT,
            }));
        }
    }

    getProcess(alias?: string) {
        const cmdCounter = alias ? this.aliasCounter.get(alias) : this.cmdCounter;

        return (ctx: Context<Typegram.Update.MessageUpdate>) => {
            cmdCounter.add(1);
            const t0 = performance.now();
            
            this._process(ctx);

            const t1 = performance.now();
            this.cmdDuration.record(t1 - t0);
        }
    }

    getAliases(): string[] {
        return Array.from(this.aliasCounter.keys())
    }

    getHelpMessage(): string {
        return "`/" + this.name + "`" + ` _${this.description}_`;
    }

    getTelegramCommandMenuEntry() {
        return { "command": this.name, "description": this.description }
    }
}