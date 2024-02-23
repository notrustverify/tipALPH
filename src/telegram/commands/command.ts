import * as Typegram from '@telegraf/types';
import { Context } from 'telegraf';

export class Command {
    readonly name: string;
    readonly description: string;
    readonly usages: string[];
    readonly process: (ctx: Context<Typegram.Update.MessageUpdate>) => any;

    // If usageWithoutCommand is provided, should end in `
    constructor(name: string, description: string, process: (ctx: Context<Typegram.Update.MessageUpdate>) => any, usage?: string) {
        this.name = name;
        this.description = description;
        this.process = process;
        this.usage = usage
    }

    getHelpMessage(): string {
        return "`/" + this.name + "`" + ` _${this.description}_`;
    }
}