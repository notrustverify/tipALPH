import { Telegraf, Context, Telegram } from 'telegraf';
import { Repository } from 'typeorm';
import * as Typegram from '@telegraf/types';

import { ErrorTypes, GeneralError, genLogMessageErrorWhile, genUserMessageErrorWhile, NetworkError, NotEnoughFundsError } from '../error.js';
import { Command } from './command.js';
import { AlphClient } from '../alephium.js';
import { EnvConfig } from '../config.js';
import { User } from '../db/user.js';

let bot: Telegraf;

export async function runTelegram(alphClient: AlphClient, userRepository: Repository<User>) {
  console.log("Starting Telegram bot...");
  
  bot = new Telegraf(EnvConfig.telegram.bot.token);

  let commands: Command[];

  /**
   * Utility functions
   */

  const replyTo = (ctx: Context<Typegram.Update.MessageUpdate>, lastMsg: Typegram.Message, newText: string) => {
    ctx.telegram.editMessageText(lastMsg.chat.id, lastMsg.message_id, undefined, newText);
  };

  const getUserFromTgId = (userId: number): Promise<User> => {
    return userRepository.findOneBy({ telegramId: userId });
  }

  /**
   * Command functions
   */

  const startFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    console.log("start");
    const username = ctx.from.username;
    const userId = ctx.message.from.id;

    // Initial message
    await ctx.reply(`Hi ${username}!`);

    // Creation of wallet
    let user = new User(userId, username);
    user = await ctx.reply("Initializing a new wallet...")
    .then(lastTgMsg => {
      console.log(`Attempt to register "${user.telegramUsername}" (id: ${user.telegramId})`);
      return alphClient.registerUser(user)
      .then(user => {
        replyTo(ctx, lastTgMsg, "A new wallet has been initialized!");
        return user;
      })
      .catch((err) => {
        if (ErrorTypes.USER_ALREADY_REGISTERED !== err) {
          console.error(genLogMessageErrorWhile("initilize wallet (UN-EXPECTED)", err, user));
          return null;
        }
        replyTo(ctx, lastTgMsg, "You already have an initialized account!");
        return getUserFromTgId(userId);
      });
    });

    if (null === user) {
      ctx.reply(genUserMessageErrorWhile("ensuring the initialization of your account"));
      return;
    }

    // Display balance
    sendBalanceMessage(ctx, user);
  };

  const addressFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    const user = await getUserFromTgId(ctx.message.from.id);
    if (null === user) {
      ctx.reply(ErrorTypes.UN_INITIALIZED_WALLET);
      return;
    }
    sendAddressMessage(ctx, user);
  };

  const sendAddressMessage = (ctx: Context<Typegram.Update.MessageUpdate>, user: User) => {
    ctx.replyWithHTML(`Your address is ${user.address}.\nYou can see its status <a href="https://${EnvConfig.network}.alephium.org/addresses/${user.address}">here</a> and your balance with /balance.`);
  };
  
  const sendBalanceMessage = (ctx: Context<Typegram.Update.MessageUpdate>, user: User) => {
    alphClient.getUserBalance(user)
    .then(userBalance => ctx.reply(`Your account currently holds: ${userBalance} ALPH`))
    .catch(err => {
      ctx.reply(genUserMessageErrorWhile("retrieving your account balance"));
      console.error(genLogMessageErrorWhile("fetch balance", err, user));
    });
  };

  const balanceFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.update.message.chat.type) {
      return;
    }

    return getUserFromTgId(ctx.message.from.id).then(user => {
      if (null === user) {
        ctx.reply(ErrorTypes.UN_INITIALIZED_WALLET);
        return;
      }
      sendBalanceMessage(ctx, user);
    });
  };
  
  const tipFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {

    const tipSender = await getUserFromTgId(ctx.message.from.id);
    if (null === tipSender) {
      ctx.reply(ErrorTypes.UN_INITIALIZED_WALLET);
      return;
    }

    if (!("text" in ctx.message))
      return;
    
    // TODO: ensure that tipping command is valid

    // Determine who is the receiver from the message type and reply
    const isReply = "reply_to_message" in ctx.message && undefined !== ctx.message.reply_to_message;

    const messageText = ctx.message.text as string;
    const payload: string = messageText.replace(`/tip@${ctx.me}`, "").replace("/tip", "").trim();
    const tipAmountRegex = /^\d+(?:\.\d+)?$/;

    // These are the values that we are trying to determine
    let receiverTgId: number;
    let amountAsString: string;

    let args: RegExpMatchArray;
    if (isReply && (args = payload.match(tipAmountRegex)) && 1 == args.length) {
      receiverTgId = ctx.message.reply_to_message.from.id;
      amountAsString = args[0];
    }
    else {
      ctx.reply("Wrong tipping format, sorry.");
      return;
    }

    console.log(`${tipSender.telegramId} tips ${amountAsString} ALPH to ${receiverTgId}`);

    // Now that we know the sender, receiver and amount, we can proceed to the transfer

    let previousReply = await ctx.reply("Tipping in progress");
    getUserFromTgId(receiverTgId).then(tipReceiver => {
      if (null === tipReceiver) {
        ctx.reply("This user has no wallet yet.");  // TODO: should handle this case in the future
        return;
      }
      alphClient.transferFromUserToUser(tipSender, tipReceiver, amountAsString)
      .then(txId => {
        ctx.replyWithHTML(`Tipping completed (<a href="https://${EnvConfig.network}.alephium.org/transactions/${txId}">tx</a>).`);
      })
      .catch((err) => {
        if (err instanceof NetworkError) {
          console.error(genLogMessageErrorWhile("tipping", err.message, tipSender));
        }
        else if (err instanceof NotEnoughFundsError) {
          console.error(genLogMessageErrorWhile("tipping", err.message, tipSender));
        }
        else {
          console.error(new GeneralError("failed to tip", {
            error: err,
            context: { "sender_id": tipSender.id, "received_id": tipReceiver.id, "amount": amountAsString }
          }));
        }

        replyTo(ctx, previousReply, "Tipping failed.");
      });
    });
  };

  const withdrawFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.message.chat.type)
      return;

    if (!("text" in ctx.message))
      return;

    console.log("withdraw");

    const sender = await getUserFromTgId(ctx.message.from.id);

    const messageText = ctx.message.text as string;
    const payload: string = messageText.replace(`/withdraw@${ctx.me}`, "").replace("/withdraw", "").trim();
    const sendAmountDestRegex = /^(\d+(?:\.\d+)?) ([a-zA-Z0-9]{45})$/;

    // These are the values that we are trying to determine
    let amountAsString: string;
    let destinationAddress: string;

    let args: RegExpMatchArray;
    if ((args = payload.match(sendAmountDestRegex)) && 3 == args.length) {
      amountAsString = args[1];
      destinationAddress = args[2];
    }
    else {
      ctx.reply("Wrong withdrawal format, sorry.");
      return;
    }

    let lastMsg = await ctx.reply("Withdrawal status: started");

    console.log(`${sender.telegramId} sends ${amountAsString} ALPH to ${destinationAddress}`);

    alphClient.sendAmountToAddressFrom(sender, amountAsString, destinationAddress)
    .then(txId => {
      console.log("Validated!");
      replyTo(ctx, lastMsg, "Withdrawal status: confirmed");
      ctx.replyWithHTML(`<a href="${EnvConfig.network}.alephium.org/transactions/${txId}">Transaction</a>`);
    })
    .catch((err) => {
      if (err instanceof NetworkError) {
        console.error(genLogMessageErrorWhile("withdrawal", err.message, sender));
      }
      else if (err instanceof NotEnoughFundsError) {
        console.error(genLogMessageErrorWhile("withdrawal", err.message, sender));
      }
      else {
        console.error(new GeneralError("withdrawal", { error: err, context: { sender, amountAsString, destinationAddress } }));
      }

      replyTo(ctx, lastMsg, "Withdrawal status: failed");
    });
  };

  const consolidateUTXOFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.message.chat.type)
      return;

    console.log("Consolidate UTXO");
    let lastMsg = await ctx.reply("Consolidation status: started");
    const user = await getUserFromTgId(ctx.message.from.id);
    alphClient.consolidateIfRequired(user)
    .then(txIds => {
      if (undefined === txIds) {
        console.log("Consolidation aborted (not required)")
        replyTo(ctx, lastMsg, "Consolidation status: aborted (not required)");
        return;
      }
      console.log("Validated!");
      replyTo(ctx, lastMsg, "Consolidation status: confirmed");
      ctx.replyWithHTML(`<a href="${EnvConfig.network}.alephium.org/transactions/${txIds}">Transaction</a>`);
    })
    .catch((err) => {
      if (err instanceof NetworkError) {
        console.error(genLogMessageErrorWhile("consolidating utxo", err.message, user));
      }
      else if (err instanceof NotEnoughFundsError) {
        console.error(genLogMessageErrorWhile("consolidating utxo", err.message, user));
      }
      else {
        console.error(new GeneralError("consolidating utxo", { error: err, context: { user } }));
      }

      replyTo(ctx, lastMsg, "Consolidation status: failed");
    });
  };
  
  const privacyFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.message.chat.type)
      return;

    console.log("privacy");
    let privacyMessage = `I, ${ctx.me} 🤖, hereby promise that I will only collect your:\n`;
    privacyMessage += "\t\t- Telegram ID\n";
    privacyMessage += "\t\t- Telegram username\n";
    privacyMessage += "\nThese are associated it with an Alephium address and an ID that I use to remember you\n";
    privacyMessage += "This is the minimal amount of data I need to know and store in order to enable you to tip other Alephium enthusiasts.\n";
    privacyMessage += "\nWhile I receive every message that is sent in the chats I am in (to allow you to command me), I do not consider them if they are not for me.";
    privacyMessage += "\nIf you want me to forget about you and delete the data I have about you, you can run /forgetme";
    ctx.reply(privacyMessage);
  };
  
  const forgetmeFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.message.chat.type)
      return;

    console.log("forgetme");
    ctx.reply("This feature will be added soon™️. Thank your for your patience.\nIf you cannot wait, please reach my creators, the admins of @NoTrustVerify");
  };

  const helpFct = (ctx: Context<Typegram.Update.MessageUpdate>) => {
    console.log("help");
    let helpMessage = "Here is the list of things that I can do:\n\n";
    helpMessage += commands.map(c => c.getHelpMessage()).join("\n");
    ctx.reply(helpMessage);
  };

  /**
   * Middlewares
   */

  // Ensure that bot is registered
  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    if (0 === (await userRepository.count())) {
      await alphClient.registerUser(new User(ctx.botInfo.id, ctx.botInfo.username));
    }
    await next();
  });

  // Middleware filters out messages that are not text
  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    if (ctx.message !== undefined && 'text' in ctx.message) {
      await next();
    }
  });

  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    if (!ctx.message.from.is_bot) {
      await next();
    }
  });

  // This middleware allows to restrict to Admin UIDs and prevent Bots from exchanging message to prepare overruling the world
  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    const adminUIDs = EnvConfig.telegram.admin.users;
    const isAdmin: boolean = (ctx.update["message"] && adminUIDs.includes(ctx.update["message"]["from"]["id"])) || (ctx.update["edited_message"] && adminUIDs.includes(ctx.update["edited_message"]["from"]["id"]))
    if (!ctx.from)
      throw new Error("from field is not present in the update")
    if (!ctx.from.is_bot && process.env.TG_ADMIN_UIDS && isAdmin) {
      await next();
    }
    else {
      console.log(`${ctx.update["message"]["from"]["id"]} wants to join!`);
    }
  });

  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    console.time(`Processing update ${ctx.update.update_id} from ${ctx.from!.id}`);
    await next() // runs next middleware
    console.timeEnd(`Processing update ${ctx.update.update_id} from ${ctx.from!.id}`);
  });


  /**
   * Linking of functions with commands
   */

  commands = [
    new Command("start", "Initialize your account with the bot", startFct),
    new Command("address", "Display the address of your account", addressFct),
    new Command("balance", "Display the balance of your account", balanceFct),
    new Command("tip", "Allow you to tip other users", tipFct),
    new Command("withdraw", "Sends a given amount to a given address (bot takes fees!)", withdrawFct),
    new Command("consolidate", "Consolidate these UTXO", consolidateUTXOFct),
    new Command("privacy", "Display the data protection policy of the bot", privacyFct),
    new Command("forgetme", "Ask the bot to forget about you", forgetmeFct),
    new Command("help", "Display the help message of the bot", helpFct),
  ];

  for (let cmd of commands)
    bot.command(cmd.name, cmd.process);

  /**
   * Signal handling and start of signal
   */

  const propagateSignal = (signal: string) => {
    console.log(`Stopping Telegram bot after receiving ${signal}`);
    bot.stop(signal);
  }
  process.once('SIGINT', () => propagateSignal('SIGINT'));
  process.once('SIGTERM', () => propagateSignal('SIGTERM'));

  // TODO: could be filtered to only receive certain updates
  // https://telegraf.js.org/interfaces/Telegraf.LaunchOptions.html#allowedUpdates
  bot.launch({ dropPendingUpdates: true });

  const myCommands = commands.map(cmd => {return { "command": cmd.name, "description": cmd.description }});
  bot.telegram.setMyCommands(myCommands, { scope: { type: "all_private_chats" } }); // Should be Typegram.BotCommandScopeAllPrivateChats or sth similar
}