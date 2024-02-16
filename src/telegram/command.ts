import * as Typegram from '@telegraf/types';
import { Context } from 'telegraf';

export class Command {
    readonly name: string;
    readonly description: string;
    readonly usageStr?: string;
    readonly process: (ctx: Context<Typegram.Update.MessageUpdate>) => any;

    constructor(name: string, description: string, process: (ctx: Context<Typegram.Update.MessageUpdate>) => any, usage?: string) {
        this.name = name;
        this.description = description;
        this.usageStr = usage;
        this.process = process;
    }

    isValid(invocation: string): boolean {
        return true;
    }

    usage(): string {
        return `/${this.name} ${this.usageStr}`;
    }

    getHelpMessage(): string {
        return `/${this.name} ${this.description}`;
    }
}