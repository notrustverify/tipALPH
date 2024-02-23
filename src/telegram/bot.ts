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

  const getUserFromTgId = (telegramId: number): Promise<User> => userRepository.findOneBy({ telegramId });

  const getUserFromTgUsername = (telegramUsername: string): Promise<User> => userRepository.findOneBy({ telegramUsername });
  
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
      ctx.reply(ErrorTypes.UN_INITIALIZED_WALLET, { parse_mode: "Markdown" });
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
      ctx.reply(ErrorTypes.UN_INITIALIZED_WALLET, { parse_mode: "Markdown" });
      return;
    }
    
    sendBalanceMessage(ctx, user);
  };
  
  const usageTip = "To tip @user 1 ALPH, either:\n - tag it: `/tip 1 @user`\n - reply to one of user's message with: `/tip 1`\nYou can also add a reason in the end of each command.";
  const tipFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if (!("text" in ctx.message))
      return;
    
    const sender = await getUserFromTgId(ctx.message.from.id);
    if (null === sender) {
      ctx.reply(ErrorTypes.UN_INITIALIZED_WALLET, { parse_mode: "Markdown" });
      return;
    }

    const isReply = "reply_to_message" in ctx.message && undefined !== ctx.message.reply_to_message;

    const messageText = ctx.message.text as string;
    const payload: string = messageText.replace(`/tip@${ctx.me}`, "").replace("/tip", "").trim();
    const tipAmountUserRegex = /^(\d+(?:[.,]\d+)?)\s+@([a-zA-Z0-9_]{4,32})(?:\s+(.*))?/;
    const tipAmountRegex = /^(\d+(?:[.,]\d+)?)(?:\s+(.*))?/;

    // These are the values that we are trying to determine
    let receiver: User
    let amountAsString: string;
    let msgToReplyTo: number;
    let motive: string;
    let wasNewAccountCreated = false;

    let args: RegExpMatchArray;
    console.log(`Payload: "${payload}"`);
    console.log("isReply?", "reply_to_message" in ctx.message, undefined !== ctx.message.reply_to_message, "=>", isReply);
    console.log(ctx.message);
    console.log(payload.match(tipAmountUserRegex));
    console.log(payload.match(tipAmountRegex));
    if (!isReply && (args = payload.match(tipAmountUserRegex)) && (3 >= args.length || 4 <= args.length)) {
      amountAsString = args[1];
      receiver = await getUserFromTgUsername(args[2]);
      if (null === receiver) {
        console.log("User does not exist. Cannot create an account.");
        ctx.reply("This user hasn't initialized their wallet yet.. You can initialize a wallet for this user by tipping in response.");
        return;
      }
      if (4 === args.length && undefined !== args[3])
        motive = args[3];
    }
    else if (isReply && (args = payload.match(tipAmountRegex)) && (2 >= args.length || 3 <= args.length)) {
      amountAsString = args[1];
      if (3 === args.length && undefined !== args[2]) {
        if (args[2].startsWith("@")) { // If a user is tipped, we remove it from the motive (or do not consider the motive)
          let endOfUserTag: number;
          if ((endOfUserTag = args[2].indexOf(" ")) > 0)
            motive = args[2].substring(endOfUserTag).trim();
        }
        else
          motive = args[2];
      }
      msgToReplyTo = ctx.message.reply_to_message.message_id;

      receiver = await getUserFromTgId(ctx.message.reply_to_message.from.id);
      if (null === receiver) {
        console.log("User does not exists, attempt creating an account");
        const newUser = new User(ctx.message.reply_to_message.from.id, ctx.message.reply_to_message.from.username);
        try {
          receiver = await alphClient.registerUser(newUser);
          wasNewAccountCreated = true;
          console.log(`"${sender.telegramUsername}" (id: ${sender.telegramId}) created a wallet for "${receiver.telegramUsername}" (id: ${receiver.telegramId}) by tipping!`);
        }
        catch (err) {
          console.error(new GeneralError("failed to register new user while tipping", {
            error: err,
            context: { newUser, sender, amountAsString }
          }))
          ctx.reply(`An error occured while creating a new wallet for ${newUser.telegramUsername}`);
          return;
        }
      }
    }
    else {
      ctx.reply(usageTip, { parse_mode: "Markdown" });
      return;
    }

    // As AlphClient only allow for . as delimiter
    amountAsString = amountAsString.replace(",", ".");

    console.log(`${sender.telegramId} tips ${amountAsString} ALPH to ${receiver.telegramId} (Motive: "${motive}")`);

    const txStatus = new TransactionStatus(`@${sender.telegramUsername} tipped @${receiver.telegramUsername}`, amountAsString);
    console.log("msgToReplyTo: ", msgToReplyTo);
    const setResponseTo = undefined !== msgToReplyTo ? { reply_to_message_id: msgToReplyTo } : {};
    let previousReply = await ctx.replyWithHTML(txStatus.toString(), setResponseTo);
    txStatus.setDisplayUpdate((async (update: string) => editLastMsgWith(ctx, previousReply, update)));

    // Now that we know the sender, receiver and amount, we can proceed to the transfer
    alphClient.transferFromUserToUser(sender, receiver, amountAsString, txStatus)
    .then(txId => {
      txStatus.setConfirmed().setTransactionId(txId).displayUpdate();
      /*  // If we want to warn users about ins and outs
      if ("private" !== ctx.chat.type) {
        ctx.telegram.sendMessage(sender.telegramId, `You successfully tipped ${amountAsString} ALPH to ${receiver.telegramUsername}`);
      }
      if (ctx.botInfo.id != receiver.telegramId)
        ctx.telegram.sendMessage(receiver.telegramId, `You received ${amountAsString} ALPH from ${sender.telegramUsername}`);
      */
      if (wasNewAccountCreated)
        ctx.reply(`@${receiver.telegramUsername}!` + " You received a tip! Send `/start` on @" + ctx.me + " to access your account!", { parse_mode: "Markdown" });

      // If sender tipped by tagging, receiver should get a notification (if not bot) (receiver might not be in the chat where tip was ordered)
      if (!isReply && ctx.botInfo.id != receiver.telegramId)
        ctx.telegram.sendMessage(receiver.telegramId, `You received ${amountAsString} ALPH from @${sender.telegramUsername}${txStatus.genTxIdText()}`, {parse_mode: "HTML"});
    })
    .catch((err) => {
      if (err instanceof NetworkError) {
        console.error(genLogMessageErrorWhile("tipping", err.message, sender));
      }
      else if (err instanceof NotEnoughFundsError) {
        console.error(genLogMessageErrorWhile("tipping", err.message, sender));
        ctx.telegram.sendMessage(sender.telegramId, `You cannot send ${prettifyAttoAlphAmount(err.requiredFunds())} ALPH to ${receiver.telegramUsername}, since you only have ${prettifyAttoAlphAmount(err.actualFunds())} ALPH`);
      }
      else {
        console.error(new GeneralError("failed to tip", {
          error: err,
          context: { "sender_id": sender.id, "received_id": receiver.id, "amount": amountAsString }
        }));
      }

      txStatus.setFailed().displayUpdate();
    });
  };

  const usageWithdrawal = "Send `/withdraw 1 your-alph-address`\nto withdraw 1 ALPH to _your-alph-address_.\nThe bot takes 3% fees on withdrawals.";
  const withdrawFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.message.chat.type || !("text" in ctx.message))
      return;

    console.log("withdraw");

    const sender = await getUserFromTgId(ctx.message.from.id);
    if (null === sender) {
      ctx.reply(ErrorTypes.UN_INITIALIZED_WALLET, { parse_mode: "Markdown" });
      return;
    }

    const messageText = ctx.message.text as string;
    const payload: string = messageText.replace(`/withdraw@${ctx.me}`, "").replace("/withdraw", "").trim();
    const sendAmountDestRegex = /^(\d+(?:[.,]\d+)?) ([a-zA-Z0-9]+)$/;

    // These are the values that we are trying to determine
    let amountAsString: string;
    let destinationAddress: string;

    let args: RegExpMatchArray;
    if ((args = payload.match(sendAmountDestRegex)) && 3 === args.length) {
      amountAsString = args[1];
      destinationAddress = args[2];
    }
    else {
      ctx.reply(usageWithdrawal, { parse_mode: "Markdown" });
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
        ctx.reply(`The provided address (${err.invalidAddress()}) seems invalid.`);
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
    if ("message" in ctx && 'text' in ctx.message)
      await next();
  });

  // This middleware to restrict to Admin UIDs, if desired
  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    const adminUIDs = EnvConfig.telegram.admin.users;
    if (!EnvConfig.bot.onlyAllowAdmins || 0 === adminUIDs.length) { // If no admin is specified, we allow everyone
      await next();
    }
    else {
      const isAdmin: boolean = ("message" in ctx.update && adminUIDs.includes(ctx.update.message.from.id));// || ("edited_message" in ctx.update && adminUIDs.includes(ctx.update["edited_message"]["from"]["id"]))
      if (process.env.TG_ADMIN_UIDS && isAdmin)
        await next();
      else  // If whitelist but user attempts to use anyway, we display its id, to be added
        console.log(`"${ctx.message.from.username}" (id: ${ctx.message.from.id}) wants to join!`);
    }
  });

  // Prevent Bots from exchanging messages to prepare overruling the world
  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    if ("from" in ctx && !ctx.from.is_bot)
      await next();
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
    new Command("tip", "tip amount to a user", tipFct, usageTip),
    new Command("withdraw", "send amount to the ALPH address (bot takes fees!)", withdrawFct, usageWithdrawal),
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