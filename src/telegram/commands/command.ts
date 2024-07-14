import * as Typegram from "telegraf/types";
import { Context } from "telegraf";

export class Command {
    readonly name: string;
    readonly description: string;
    readonly isPrivate: boolean;
    readonly usage: string;
    readonly process: (ctx: Context<Typegram.Update.MessageUpdate>) => any;

    // If usageWithoutCommand is provided, should end in `
    constructor(name: string, description: string, process: (ctx: Context<Typegram.Update.MessageUpdate>) => any, isPrivate: boolean, usage?: string) {
        this.name = name;
        this.description = description;
        this.process = process;
        this.isPrivate = isPrivate;
        this.usage = usage
    }

    getHelpMessage(): string {
        return "`/" + this.name + "`" + ` _${this.description}_`;
    }

    getTelegramCommandMenuEntry() {
        return { "command": this.name, "description": this.description }
    }
}