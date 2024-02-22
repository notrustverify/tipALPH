import { prettifyAttoAlphAmount } from '@alephium/web3';
import { Telegraf, Context } from 'telegraf';
import * as Typegram from '@telegraf/types';
import { Repository } from 'typeorm';

import { ErrorTypes, GeneralError, genLogMessageErrorWhile, genUserMessageErrorWhile, InvalidAddressError, NetworkError, NotEnoughFundsError } from '../error.js';
import { TransactionStatus } from '../transactionStatus.js';
import { Command } from './commands/command.js';
import { AlphClient } from '../alephium.js';
import { EnvConfig } from '../config.js';
import { User } from '../db/user.js';

let bot: Telegraf;

export const editLastMsgWith = async (ctx: Context<Typegram.Update.MessageUpdate>, lastMsg: Typegram.Message, newText: string, isHTML: boolean = true, linkPreview: boolean = true) => {
  const parse_mode = isHTML ? "HTML" : "Markdown";
  await ctx.telegram.editMessageText(lastMsg.chat.id, lastMsg.message_id, undefined, newText, { parse_mode, disable_web_page_preview: linkPreview }).catch(console.error);
};

export async function runTelegram(alphClient: AlphClient, userRepository: Repository<User>) {
  console.log("Starting Telegram bot...");
  
  bot = new Telegraf(EnvConfig.telegram.bot.token);

  let commands: Command[];

  /**
   * Utility functions
   */

  const getUserFromTgId = (userId: number): Promise<User> => {
    return userRepository.findOneBy({ telegramId: userId });
  }

  /**
   * Command functions
   */

  const startFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.update.message.chat.type) {
      return;
    }
    console.log("start");
    const username = ctx.from.username;
    const userId = ctx.message.from.id;

    // Initial message
    let msg = `Hi ${username}!\n\n`;
    msg += `With @${ctx.me}, you can tip ALPH to other telegram users!\n`;
    msg += "Please bear in mind that:\n";
    msg += " - the bot is still in alpha\n";
    msg += " - the wallet linked to your account is custodial (we hold the mnemonic) so please do not put too much money on it";
    await ctx.reply(msg);

    // Creation of wallet
    let user = new User(userId, username);
    user = await ctx.reply("Initializing a new wallet...")
    .then(lastTgMsg => {
      console.log(`Attempt to register "${user.telegramUsername}" (id: ${user.telegramId})`);
      return alphClient.registerUser(user)
      .then(user => {
        console.log(`Registered "${user.telegramUsername}" (id: ${user.telegramId})`);
        let msg = `Your wallet has been initialized!\nHere's your adresse:\n<code>${user.address}</code>\n`;
        msg += "Ask users to <code>/tip</code> you or send ALPH to it.\n",
        msg += "Download the <a href='https://alephium.org/#wallets'>wallets</a>!";
        editLastMsgWith(ctx, lastTgMsg, msg);
        return user;
      })
      .catch((err) => {
        if (ErrorTypes.USER_ALREADY_REGISTERED !== err) {
          console.error(genLogMessageErrorWhile("initilize wallet (UN-EXPECTED)", err, user));
          return null;
        }
        editLastMsgWith(ctx, lastTgMsg, "You already have an initialized account!");
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
    const link = undefined !== EnvConfig.explorerAddress() ? `its status <a href="${EnvConfig.explorerAddress()}/addresses/${user.address}">here</a> and ` : "";
    ctx.replyWithHTML(`Your address is <code>${user.address}</code>.\nYou can see ${link}your balance with /balance.`);
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

    const user = await getUserFromTgId(ctx.message.from.id);
    if (null === user) {
      ctx.reply(ErrorTypes.UN_INITIALIZED_WALLET);
      return;
    }
    
    sendBalanceMessage(ctx, user);
  };
  
  const tipFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {

    const tipSender = await getUserFromTgId(ctx.message.from.id);
    if (null === tipSender) {
      ctx.reply(ErrorTypes.UN_INITIALIZED_WALLET);
      return;
    }

    if (!("text" in ctx.message))
      return;

    // Determine who is the receiver from the message type and reply
    const isReply = "reply_to_message" in ctx.message && undefined !== ctx.message.reply_to_message;

    const messageText = ctx.message.text as string;
    const payload: string = messageText.replace(`/tip@${ctx.me}`, "").replace("/tip", "").trim();
    const tipAmountRegex = /^\d+(?:[.,]\d*)?$/;

    // These are the values that we are trying to determine
    let receiverTgId: number;
    let receiverTgUsername: string;
    let amountAsString: string;

    let args: RegExpMatchArray;
    args = payload.match(tipAmountRegex);
    console.log(args);
    if (isReply && (args = payload.match(tipAmountRegex)) && 1 == args.length) {
      console.log(args.length);
      receiverTgId = ctx.message.reply_to_message.from.id;
      receiverTgUsername = ctx.message.reply_to_message.from.username;
      amountAsString = args[0];
    }
    else {
      console.log(`Got: "${payload}", resulting in ${args}`);
      ctx.reply("Wrong tipping format, sorry.");
      return;
    }

    // As AlphClient only allow for . as delimiter
    amountAsString = amountAsString.replace(",", ".");

    console.log(`${tipSender.telegramId} tips ${amountAsString} ALPH to ${receiverTgId}`);

    const txStatus = new TransactionStatus(`@${tipSender.telegramUsername} tipped @${receiverTgUsername}`, amountAsString);
    let previousReply = await ctx.replyWithHTML(txStatus.toString(), { reply_to_message_id: ctx.message.message_id });
    txStatus.setDisplayUpdate((async (update: string) => editLastMsgWith(ctx, previousReply, update)));

    // Now that we know the sender, receiver and amount, we can proceed to the transfer
    getUserFromTgId(receiverTgId).then(tipReceiver => {
      if (null === tipReceiver) {
        ctx.reply("This user has no wallet yet.");  // TODO: should handle this case in the future
        return;
      }
      alphClient.transferFromUserToUser(tipSender, tipReceiver, amountAsString, txStatus)
      .then(txId => {
        txStatus.setConfirmed().setTransactionId(txId).displayUpdate();
        /*  // If we want to warn users about ins and outs
        if ("private" !== ctx.chat.type) {
          ctx.telegram.sendMessage(tipSender.telegramId, `You successfully tipped ${amountAsString} ALPH to ${tipReceiver.telegramUsername}`);
        }
        if (ctx.botInfo.id != tipReceiver.telegramId)
          ctx.telegram.sendMessage(tipReceiver.telegramId, `You received ${amountAsString} ALPH from ${tipSender.telegramUsername}`);
        */
      })
      .catch((err) => {
        if (err instanceof NetworkError) {
          console.error(genLogMessageErrorWhile("tipping", err.message, tipSender));
        }
        else if (err instanceof NotEnoughFundsError) {
          console.error(genLogMessageErrorWhile("tipping", err.message, tipSender));
          ctx.telegram.sendMessage(tipSender.telegramId, `You cannot send ${prettifyAttoAlphAmount(err.requiredFunds())} ALPH to ${tipReceiver.telegramUsername}, since you only have ${prettifyAttoAlphAmount(err.actualFunds())} ALPH`);
        }
        else {
          console.error(new GeneralError("failed to tip", {
            error: err,
            context: { "sender_id": tipSender.id, "received_id": tipReceiver.id, "amount": amountAsString }
          }));
        }

        txStatus.setFailed().displayUpdate();
      });
    });
  };

  const withdrawFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.message.chat.type || !("text" in ctx.message))
      return;

    console.log("withdraw");

    const sender = await getUserFromTgId(ctx.message.from.id);

    const messageText = ctx.message.text as string;
    const payload: string = messageText.replace(`/withdraw@${ctx.me}`, "").replace("/withdraw", "").trim();
    const sendAmountDestRegex = /^(\d+(?:[.,]\d+)?) ([a-zA-Z0-9]{45})$/;

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

    // As AlphClient only allow for . as delimiter
    amountAsString = amountAsString.replace(",", ".");

    const txStatus = new TransactionStatus(`Withdrawal to ${destinationAddress}`, amountAsString);
    let lastMsg = await ctx.replyWithHTML(txStatus.toString(), { reply_to_message_id: ctx.message.message_id });
    txStatus.setDisplayUpdate((async (update: string) => editLastMsgWith(ctx, lastMsg, update)));

    console.log(`${sender.telegramId} sends ${amountAsString} ALPH to ${destinationAddress}`);

    alphClient.sendAmountToAddressFrom(sender, amountAsString, destinationAddress, txStatus)
    .then(txId => {
      console.log("Withdraw successfull!");
      txStatus.setConfirmed().setTransactionId(txId).displayUpdate();
    })
    .catch((err) => {
      if (err instanceof NetworkError) {
        console.error(genLogMessageErrorWhile("withdrawal", err.message, sender));
      }
      else if (err instanceof InvalidAddressError) {
        ctx.reply(`The provided address (${err.invalidAddress}) seems invalid.`);
        console.error(genLogMessageErrorWhile("withdrawal", err, sender));
      }
      else if (err instanceof NotEnoughFundsError) {
        console.error(genLogMessageErrorWhile("withdrawal", err.message, sender));
        ctx.reply(`You cannot withdraw ${prettifyAttoAlphAmount(err.requiredFunds())} ALPH, since you only have ${prettifyAttoAlphAmount(err.actualFunds())} ALPH`, { reply_to_message_id: ctx.message.message_id });
      }
      else {
        console.error(new GeneralError("withdrawal", { error: err, context: { sender, amountAsString, destinationAddress } }));
      }

      txStatus.setFailed().displayUpdate();
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
    let helpMessage = "Here is the list of commands that I handle:\n\n";
    helpMessage += commands.map(c => c.getHelpMessage()).join("\n");
    ctx.reply(helpMessage, {parse_mode: "Markdown"});
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
    console.time(`Processing update ${ctx.update.update_id} from ${ctx.from.id}`);
    await next() // runs next middleware
    console.timeEnd(`Processing update ${ctx.update.update_id} from ${ctx.from.id}`);
  });


  /**
   * Linking of functions with commands
   */

  commands = [
    new Command("start", "initialize your account with the bot", startFct),
    new Command("address", "display the address of your account", addressFct),
    new Command("balance", "display the balance of your account", balanceFct),
    new Command("tip", "in response of a message to tip amount to its owner", tipFct, "`<amount>`"),
    new Command("withdraw", "sends amount to the ALPH address (bot takes fees!)", withdrawFct, "`<amount> <ALPH_address>`"),
    new Command("privacy", "display the data protection policy of the bot", privacyFct),
    new Command("forgetme", "ask the bot to forget about you", forgetmeFct),
    new Command("help", "display help", helpFct),
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