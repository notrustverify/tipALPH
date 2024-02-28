import { prettifyAttoAlphAmount } from '@alephium/web3';
import { Telegraf, Context, Composer } from 'telegraf';
import * as Typegram from '@telegraf/types';
import { Repository } from 'typeorm';

import { ErrorTypes, GeneralError, genLogMessageErrorWhile, genUserMessageErrorWhile, InvalidAddressError, NetworkError, NotEnoughALPHForALPHAndTokenChangeOutputError, NotEnoughALPHForTokenChangeOutputError, NotEnoughALPHForTransactionOutputError, NotEnoughBalanceForFeeError, NotEnoughFundsError } from '../error.js';
import { TransactionStatus } from '../transactionStatus.js';
import { Command } from './commands/command.js';
import { AlphClient } from '../alephium.js';
import { EnvConfig } from '../config.js';
import { User } from '../db/user.js';
import { ALPHSymbol, TokenAmount, TokenManager } from '../tokenManager.js';

let bot: Telegraf;

export const editLastMsgWith = async (ctx: Context<Typegram.Update.MessageUpdate>, lastMsg: Typegram.Message, newText: string, isHTML: boolean = true, linkPreview: boolean = true) => {
  const parse_mode = isHTML ? "HTML" : "Markdown";
  await ctx.telegram.editMessageText(lastMsg.chat.id, lastMsg.message_id, undefined, newText, { parse_mode, disable_web_page_preview: linkPreview }).catch(console.error);
};

export async function runTelegram(alphClient: AlphClient, userRepository: Repository<User>, tokenManager: TokenManager) {
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
    await ctx.sendMessage(msg);

    // Creation of wallet
    let user = new User(userId, username);
    user = await ctx.sendMessage("Initializing a new wallet...")
    .then(lastTgMsg => {
      console.log(`Attempt to register "${user.telegramUsername}" (id: ${user.telegramId})`);
      return alphClient.registerUser(user)
      .then(user => {
        console.log(`Registered "${user.telegramUsername}" (id: ${user.telegramId})`);
        let msg = `Your wallet has been initialized!\nHere's your adresse:\n<code>${user.address}</code>\n`;
        msg += "Ask users to <code>/tip</code> you or send some tokens to it.\n",
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
      ctx.sendMessage(genUserMessageErrorWhile("ensuring the initialization of your account"));
      return;
    }

    // Display balance
    sendBalanceMessage(ctx, user);
  };

  const addressFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.update.message.chat.type) {
      return;
    }
    const user = await getUserFromTgId(ctx.message.from.id);
    if (null === user) {
      ctx.sendMessage(ErrorTypes.UN_INITIALIZED_WALLET, { parse_mode: "Markdown" });
      return;
    }
    sendAddressMessage(ctx, user);
  };

  const sendAddressMessage = (ctx: Context<Typegram.Update.MessageUpdate>, user: User) => {
    const link = undefined !== EnvConfig.explorerAddress() ? `its status <a href="${EnvConfig.explorerAddress()}/addresses/${user.address}">here</a> and ` : "";
    ctx.sendMessage(`Your address is <code>${user.address}</code>.\nYou can see ${link}your balance with /balance.`, { parse_mode: "HTML" });
  };
  
  const sendBalanceMessage = (ctx: Context<Typegram.Update.MessageUpdate>, user: User) => {
    alphClient.getUserBalance(user)
    .then(userBalance => {
      let balanceMsg = "Your account currently holds:"
      if (1 === userBalance.length && userBalance[0].token.isALPH())
        ctx.sendMessage(`${balanceMsg} ${userBalance[0].toString()}`);
      else {
        balanceMsg += "\n";
        balanceMsg += userBalance.map(u => ` &#8226; ${u.toString()}`).join("\n");
        ctx.sendMessage(balanceMsg, { parse_mode: "HTML" });
      }
    })
    .catch(err => {
      ctx.sendMessage(genUserMessageErrorWhile("retrieving your account balance"));
      console.error(genLogMessageErrorWhile("fetch balance", err, user));
    });
  };

  const balanceFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.update.message.chat.type) {
      return;
    }

    const user = await getUserFromTgId(ctx.message.from.id);
    if (null === user) {
      ctx.sendMessage(ErrorTypes.UN_INITIALIZED_WALLET, { parse_mode: "Markdown" });
      return;
    }
    
    sendBalanceMessage(ctx, user);
  };
  
  let usageTip = "To tip @user 1 $TOKEN, either:\n - tag it: `/tip 1 $TOKEN @user`\n - reply to one of user's message with: `/tip 1 $TOKEN`\n";
  usageTip += "If you want to tip $ALPH, you can omit the $TOKEN\n";
  usageTip += "You can also add a reason in the end of each command.";
  const tipFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if (!("text" in ctx.message))
      return;
    
    const sender = await getUserFromTgId(ctx.message.from.id);
    if (null === sender) {
      ctx.sendMessage(ErrorTypes.UN_INITIALIZED_WALLET, { parse_mode: "Markdown" });
      return;
    }

    const isReply = "reply_to_message" in ctx.message && undefined !== ctx.message.reply_to_message; // && "supergroup" !== ctx.chat.type;

    const messageText = ctx.message.text as string;
    const payload: string = messageText.trim();
    const tipAmountUserRegex = /^\/tip(?:\@\w+)?\s+(?<amountAsString>\d+(?:[.,]\d+)?)(?:\s+\$(?<tokenSymbol>[a-zA-Z]{2,}))?\s+@(?<receiverUsername>[a-zA-Z0-9_]{4,32})(?:\s+(?<reason>.*))?/;
    const tipAmountRegex = /^\/tip(?:\@\w+)?\s+(?<amountAsString>\d+(?:[.,]\d+)?)(?:\s+\$(?<tokenSymbol>[a-zA-Z]{2,}))?(?:\s+(?<reason>.*))?/;

    // These are the values that we are trying to determine
    let amountAsString: string;
    let tokenSymbol: string;
    let receiverUsername: string;
    let reason: string;

    let receiver: User;
    let msgToReplyTo: number;
    let wasNewAccountCreated = false;

    let args: RegExpMatchArray;
    console.log(ctx.message);
    console.log(`Payload: "${payload}"`);
    console.log("isReply?", "reply_to_message" in ctx.message, undefined !== ctx.message.reply_to_message, "supergroup" !== ctx.chat.type, "=>", isReply);
    console.log(tipAmountUserRegex.exec(payload));
    console.log(tipAmountRegex.exec(payload));
    if (!isReply && (args = tipAmountUserRegex.exec(payload)) && undefined !== args.groups && ({ amountAsString, tokenSymbol, receiverUsername, reason } = args.groups) && undefined !== amountAsString && undefined !== receiverUsername) {
      console.log("By tagging", amountAsString, tokenSymbol, receiverUsername, reason);

      receiver = await getUserFromTgUsername(receiverUsername);
      if (null === receiver) {
        console.log("User does not exist. Cannot create an account.");
        ctx.sendMessage("This user hasn't initialized their wallet yet.. You can initialize a wallet for this user by tipping in response.");
        return;
      }

    }
    else if (isReply && (args = payload.match(tipAmountRegex)) && undefined !== args.groups && ({ amountAsString, tokenSymbol, reason } = args.groups) && undefined !== amountAsString) {
      console.log("By reply", amountAsString, tokenSymbol, reason);

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
          ctx.sendMessage(`An error occured while creating a new wallet for ${newUser.telegramUsername}`);
          return;
        }
      }

      msgToReplyTo = ctx.message.reply_to_message.message_id;
    }
    else {
      ctx.sendMessage(usageTip, { parse_mode: "Markdown" });
      return;
    }

    // If token is undefined, consider it is ALPH
    tokenSymbol = undefined === tokenSymbol ? ALPHSymbol : tokenSymbol;

    const tokenAmount = await tokenManager.getTokenAmountByTokenSymbol(tokenSymbol, amountAsString);
    if (undefined == tokenAmount) {
      ctx.sendMessage("The token is invalid", { reply_to_message_id: msgToReplyTo });
      return;
    }

    // As AlphClient only allow for . as delimiter
    amountAsString = amountAsString.replace(",", ".");

    console.log(`${sender.telegramId} tips ${tokenAmount.toString()} to ${receiver.telegramId} (Motive: "${reason}")`);

    const txStatus = new TransactionStatus(`@${sender.telegramUsername} tipped @${receiver.telegramUsername}`, tokenAmount);
    const setResponseTo = undefined !== msgToReplyTo ? { reply_to_message_id: msgToReplyTo } : { };
    let previousReply = await ctx.sendMessage(txStatus.toString(), { parse_mode: "HTML", ...setResponseTo });
    txStatus.setDisplayUpdate((async (update: string) => editLastMsgWith(ctx, previousReply, update)));

    // Now that we know the sender, receiver and amount, we can proceed to the transfer
    alphClient.transferFromUserToUser(sender, receiver, tokenAmount, txStatus)
    .then(txId => {
      txStatus.setConfirmed().setTransactionId(txId).displayUpdate();

      /*
       * We eventually notify people that received tips
       */
      if (wasNewAccountCreated)
        ctx.sendMessage(`@${receiver.telegramUsername}!` + " You received a tip! Hit `Start` on @" + ctx.me + " to access your account!", { parse_mode: "Markdown" });
      // If sender tipped by tagging, receiver should get a notification (if not bot) (receiver might not be in the chat where tip was ordered)
      else if (!isReply && ctx.botInfo.id != receiver.telegramId)
        ctx.telegram.sendMessage(receiver.telegramId, `You received ${tokenAmount.toString()} from @${sender.telegramUsername}${txStatus.genTxIdText()}`, { parse_mode: "HTML" });
    
    })
    .catch((err) => {
      console.log(err);
      if (err instanceof NetworkError) {
        console.error(genLogMessageErrorWhile("tipping", err.message, sender));
      }
      else if (err instanceof NotEnoughFundsError) {
        console.error(genLogMessageErrorWhile("tipping", err.message, sender));
        const requiredTokenAmount = new TokenAmount(err.requiredFunds(), tokenAmount.token);
        const actualTokenAmount = new TokenAmount(err.actualFunds(), tokenAmount.token);
        ctx.telegram.sendMessage(sender.telegramId, `You cannot send ${requiredTokenAmount.toString()} to ${receiver.telegramUsername}, since you only have ${actualTokenAmount.toString()}`);
      }
      else if (err instanceof NotEnoughBalanceForFeeError) {
        console.error(genLogMessageErrorWhile("tipping", err.message, sender));
        ctx.telegram.sendMessage(sender.telegramId, `You do not have enough balance to handle the gas fees. You can maybe try again with a lower amount.`);
      }
      else if (err instanceof NotEnoughALPHForTransactionOutputError) {
        console.error(genLogMessageErrorWhile("tipping", err.message, sender));
        ctx.telegram.sendMessage(sender.telegramId, `You do not have enough $ALPH to make that transaction.`);        
      }
      else if (err instanceof NotEnoughALPHForALPHAndTokenChangeOutputError) {
        console.error(genLogMessageErrorWhile("tipping", err.message, sender));
        ctx.telegram.sendMessage(sender.telegramId, "You do not have enough $ALPH to transfer this token");
      }
      else if (err instanceof NotEnoughALPHForTokenChangeOutputError) {
        console.error(genLogMessageErrorWhile("tipping", err.message, sender));
        ctx.telegram.sendMessage(sender.telegramId, "You cannot make that tip since you need to keep funds to take out your $ALPH and token.");
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

  const usageWithdrawal = "Send `/withdraw 1 your-alph-address`\nto withdraw 1 ALPH to _your-alph-address_." + (EnvConfig.operator.fees > 0 ? `\nThe bot takes ${EnvConfig.operator.fees}% fees on withdrawals.` : "");
  const withdrawFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.message.chat.type || !("text" in ctx.message))
      return;

    console.log("withdraw");

    const sender = await getUserFromTgId(ctx.message.from.id);
    if (null === sender) {
      ctx.sendMessage(ErrorTypes.UN_INITIALIZED_WALLET, { parse_mode: "Markdown" });
      return;
    }

    const messageText = ctx.message.text as string;
    const payload: string = messageText.trim();
    const sendAmountDestRegex = /^\/withdraw(?:\@\w+)?\s+(?<amountAsString>\d+(?:[.,]\d+)?)(?:\s+\$(?<tokenSymbol>[a-zA-Z]{2,}))?\s+(?<destinationAddress>[a-zA-Z0-9]+)$/;

    // These are the values that we are trying to determine
    let amountAsString: string;
    let tokenSymbol: string
    let destinationAddress: string;

    let args: RegExpMatchArray;
    args = sendAmountDestRegex.exec(payload);
    console.log(args);
    if (null === (args = sendAmountDestRegex.exec(payload)) || !("groups" in args) || !args.groups || !({ amountAsString, tokenSymbol, destinationAddress } = args.groups) || undefined === amountAsString || undefined === destinationAddress) {
      console.log(null === (args = sendAmountDestRegex.exec(payload)));
      console.log(!("groups" in args))
      console.log(!args.groups);
      console.log(!({ amountAsString, tokenSymbol, destinationAddress } = args.groups));
      console.log(undefined === amountAsString);
      console.log(undefined === destinationAddress);
      ctx.sendMessage(usageWithdrawal, { parse_mode: "Markdown" });
      return;
    }
    ctx.sendMessage(amountAsString + " " + tokenSymbol + " " + destinationAddress)

    const msgToReplyTo = ctx.message.message_id;

    // If token is undefined, consider it is ALPH
    tokenSymbol = undefined === tokenSymbol ? ALPHSymbol : tokenSymbol;
    const tokenAmount = await tokenManager.getTokenAmountByTokenSymbol(tokenSymbol, amountAsString);
    if (undefined == tokenAmount) {
      ctx.sendMessage("The token is invalid or does not exist.", { reply_to_message_id: msgToReplyTo });
      return;
    }

    // As AlphClient only allow for . as delimiter
    amountAsString = amountAsString.replace(",", ".");

    const txStatus = new TransactionStatus(`Withdrawal to ${destinationAddress}`, tokenAmount);
    let lastMsg = await ctx.sendMessage(txStatus.toString(), { reply_to_message_id: msgToReplyTo, parse_mode: "HTML" });
    txStatus.setDisplayUpdate((async (update: string) => editLastMsgWith(ctx, lastMsg, update)));

    console.log(`${sender.telegramId} sends ${tokenAmount.toString()} to ${destinationAddress}`);

    alphClient.sendAmountToAddressFrom(sender, tokenAmount, destinationAddress, txStatus)
    .then(txId => {
      console.log("Withdraw successfull!");
      txStatus.setConfirmed().setTransactionId(txId).displayUpdate();
    })
    .catch((err) => {
      if (err instanceof NetworkError) {
        console.error(genLogMessageErrorWhile("withdrawal", err.message, sender));
      }
      else if (err instanceof InvalidAddressError) {
        ctx.sendMessage(`The provided address (${err.invalidAddress()}) seems invalid.`);
        console.error(genLogMessageErrorWhile("withdrawal", err, sender));
      }
      else if (err instanceof NotEnoughFundsError) {
        console.error(genLogMessageErrorWhile("withdrawal", err.message, sender));
        ctx.sendMessage(`You cannot withdraw ${prettifyAttoAlphAmount(err.requiredFunds())} ALPH, since you only have ${prettifyAttoAlphAmount(err.actualFunds())} ALPH`, { reply_to_message_id: ctx.message.message_id });
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
    ctx.sendMessage(privacyMessage);
  };
  
  const forgetmeFct = async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    if ("private" !== ctx.message.chat.type)
      return;

    console.log("forgetme");
    ctx.sendMessage("This feature will be added soon™️. Thank your for your patience.\nIf you cannot wait, please reach my creators, the admins of @NoTrustVerify");
  };

  const helpFct = (ctx: Context<Typegram.Update.MessageUpdate>) => {
    console.log("help");
    let helpMessage = "Here is the list of commands that I handle:\n\n";
    helpMessage += commands.map(c => c.getHelpMessage()).join("\n");
    ctx.sendMessage(helpMessage, {parse_mode: "Markdown"});
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

  // Middleware filters out messages that are forwarded
  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    if (!("forward_origin" in ctx.message && undefined !== ctx.message.forward_origin))
      await next();
  });

  // This middleware to restrict to Admin UIDs, if desired
  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    const adminUIDs = EnvConfig.telegram.admins;
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
    if ("from" in ctx && undefined !== ctx.from && !ctx.from.is_bot)
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

  const adminBot = new Composer();
  adminBot.command("stats", async (ctx: Context<Typegram.Update.MessageUpdate>) => {
    console.log("stats");
    let msgStats = "Here are some stats:\n\n";
    msgStats += await userRepository.count() + " accounts created";
    ctx.sendMessage(msgStats);
  });

  bot.use(Composer.acl(EnvConfig.telegram.admins, adminBot));

  /**
   * Signal handling and start of signal
   */

  const propagateSignal = (signal: string) => {
    console.log(`Stopping Telegram bot after receiving ${signal}`);
    bot.stop(signal);
  }
  process.once('SIGINT', () => propagateSignal('SIGINT'));
  process.once('SIGTERM', () => propagateSignal('SIGTERM'));

  // Filter to only receive messages updates
  // https://telegraf.js.org/interfaces/Telegraf.LaunchOptions.html#allowedUpdates
  bot.launch({ dropPendingUpdates: true, allowedUpdates: ["message"] });

  const myCommands = commands.map(cmd => {return { "command": cmd.name, "description": cmd.description }});
  bot.telegram.setMyCommands(myCommands, { scope: { type: "all_private_chats" } }); // Should be Typegram.BotCommandScopeAllPrivateChats or sth similar
}