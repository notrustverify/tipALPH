import * as Typegram from '@telegraf/types';
import { Context } from 'telegraf';

export class Command {
    readonly name: string;
    readonly description: string;
    readonly usage: string;
    readonly process: (ctx: Context<Typegram.Update.MessageUpdate>) => any;

    // If usageWithCommand is provided, should end in `
    constructor(name: string, description: string, process: (ctx: Context<Typegram.Update.MessageUpdate>) => any, usageWithoutCommand?: string) {
        this.name = name;
        this.description = description;
        this.process = process;

        this.usage = "`/" + name;
        if (undefined !== usageWithoutCommand) {
            if (usageWithoutCommand.startsWith("`")) {
                usageWithoutCommand = usageWithoutCommand.substring(1);
            }
            this.usage += " " + usageWithoutCommand;
        }
        else {
            this.usage += "`";
        }
    }

    getHelpMessage(): string {
        return this.usage + ` _${this.description}_`;
    }
}