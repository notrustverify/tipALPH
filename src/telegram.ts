import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { Repository } from 'typeorm';
import * as Typegram from '@telegraf/types';
//import { Message, Update } from '@telegraf/types';
import { AlphClient } from './alephium.js';
import { EnvConfig } from './config.js';
import { User } from './db/user.js';


let bot: Telegraf;
const tipAmountRegex = /^\d+\.?\d*$/;
//const tipAmountUserRegex = /(\d+\.?\d*)\s+(?:\B@(?=.{5,32}\b)([a-zA-Z0-9][_\-a-zA-Z0-9]*))?/;

const CANNOT_REGISTER_RN = "For some reason, I cannot register you at the moment, I apologize. Please try again later or reach my creators.";
const CANNOT_RETRIEVE_USER_OBJ = (userObject: string) => `Oops, error happend while retreiving your ${userObject}. Please retry later or reach my creators.`;

export function runTelegram(alphClient: AlphClient, userRepository: Repository<User>) {
  console.log("Starting Telegram bot...");
  
  bot = new Telegraf(EnvConfig.telegram.bot.token);

  // Middleware filters out messages that are not text
  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    if (ctx.message !== undefined && 'text' in ctx.message) {
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

  // This bot prints messages for debug purposes.
  /*
  bot.use(async (ctx, next) => {
    let shouldProcess = false;
    let action;
    let scope = "message";

    if (ctx.update["edited_message"]) {
      action = `edited a message.`;
      scope = "edited_message";
    }
    else if (ctx.update["message"]["text"]) {
      action = `sent "${ctx.update["message"]["text"]}"`;
      shouldProcess = true;
    }
    else if (ctx.update["message"]["sticker"]) {
      action = `sent sticker for emoji ${ctx.update["message"]["sticker"]["emoji"]}`;
    }
    else if (ctx.update["message"]["document"]) {
      action = `sent a document named "${ctx.update["message"]["document"]["file_name"]}"`;
    }
    else {
      action = "did something... (check logs)";
      console.log(ctx.update);
    }
    console.log(`"${ctx.update[scope]["from"]["username"]}" (id: ${ctx.update[scope]["from"]["id"]}) in ${ctx.update[scope]["chat"]["type"]}:${ctx.update[scope]["chat"]["id"]} ${action}`);
    
    if (shouldProcess)
      await next();
  })
  */

  bot.use(async (ctx: Context<Typegram.Update>, next) => {
    console.time(`Processing update ${ctx.update.update_id} from ${ctx.from!.id}`);
    await next() // runs next middleware
    console.timeEnd(`Processing update ${ctx.update.update_id} from ${ctx.from!.id}`);
  });


  bot.hears('hi', (ctx) => ctx.reply('Hey there'));

  bot.start(async (ctx) => {
    if ("private" !== ctx.update.message.chat.type) {
      return;
    }

    const username = ctx.from.username;
    const userId = ctx.message.from.id;
    
    let welcomeMessage = `Hello ${username ? username : "there"} !`;
    
    if (EnvConfig.isDevEnv) {
      welcomeMessage += "\n/!\\ This bot is on the devnet!! /!\\";
    }

    ctx.reply(welcomeMessage);

    // Check if user is registered    
    let userIterator = await userRepository.findOneBy({ telegramId: userId }).then(u => null != u ? u.id : undefined);
    if (undefined === userIterator) {
      ctx.reply("It seems you do not have an wallet yet. Creating one...");

      const newUser = new User(userId, username!);
      await userRepository.save(newUser);
      userIterator = newUser.id; // Register client in DB (ct) (userId, username);
      if (undefined === userIterator) {
        console.error(`Failed to register user ${userId}`);
        ctx.reply(CANNOT_REGISTER_RN);
        return;
      }
    }

    const userAddress = alphClient.getUserAddress(userIterator);
    if (!userAddress) {
      console.log(`Failed to create wallet address for user "${userId}".`);
      ctx.reply(CANNOT_RETRIEVE_USER_OBJ("wallet address"));
      return;
    }

    ctx.reply(`Your address is:\n${userAddress}\nYou can check its status here: https://testnet.alephium.org/addresses/${userAddress}.`);
  });

  bot.command("balance", async (ctx) => {
    if ("private" !== ctx.update.message.chat.type) {
      return;
    }

    const userId = ctx.message.from.id;

    // Check if user is registered
    const userIterator = await userRepository.findOneBy({ telegramId: userId }).then(u => null != u ? u.id : undefined);
    if (undefined === userIterator) {
      ctx.reply("It seems you do not have an wallet yet. Run /start to create one");
      return;
    }

    const userBalance = await alphClient.getUserBalance(userIterator);
    if (undefined === userBalance) {
      console.log(`Failed to retrieve balance for user "${userId}".`);
      ctx.reply(CANNOT_RETRIEVE_USER_OBJ("account balance"));
      return;
    }

    ctx.reply(`Your account currently holds: ${userBalance} ALPH`);
  });

  bot.help((ctx) => {
    let helpMessage = "Here is some help about me:\n\nYou can send:\n";
    helpMessage += "- \"hi\" to get an answer\n";
    helpMessage += "- /start to initialize your account (or ensure it has been)\n";
    helpMessage += "- /tip <amount> in reply to a message to tip <amount> ALPH to its sender";
    //helpMessage += "- /tip <amount> <@username>` to tip <amount> ALPH to @username (only work in chats where @username is present)";
    ctx.reply(helpMessage);
    /*
    ctx.reply('Send /start to receive a greeting');
    ctx.reply('Send /tip <amount> in reply to a message to tip <amount> ALPH to its sender');
    //ctx.reply('Send `/tip <amount> <@username>` to tip <amount> ALPH to @username (only work in chats where @username is present)');
    ctx.reply('Send "hi" to get an answer');
    */
  });

  bot.command('tip', async (ctx) => {
    const payload = ctx.payload.trim()

    const senderID = ctx.message.from.id;
    const senderUsername = ctx.update.message.from.username;
    const senderIterator = await userRepository.findOneBy({ telegramId: senderID }).then(u => null != u ? u.id : undefined);
    if (undefined === senderIterator) {
      ctx.reply("You do not have an account yet. Please initiate a chat with me, provision your acount and try again!");
      return
    }

    const senderWallet = alphClient.getUserWallet(senderIterator);

    let receiverID = 0;
    let receiverUsername = "???";
    let receiverAddress;
    let amount;
    
    // Determine who is the receiver from the message type and reply
    const isReply = undefined !== ctx.update.message.reply_to_message;

    let args;

    console.log(ctx);
    
    if (isReply && (args = payload.match(tipAmountRegex)) && args.length == 1) {
      receiverUsername = ctx.update.message.reply_to_message!.from!.username!;
      receiverID = ctx.update.message.reply_to_message!.from!.id;
      const receiverIterator = await userRepository.findOneBy({ telegramId: senderID }).then(u => null != u ? u.id : undefined);
      if (undefined === receiverIterator) {
        ctx.reply(`This user has not wallet yet. @${receiverUsername}, if you want to receive this thip, initiate a chat with me, provision your acount and you'll be able to receive it!`);
        return
      }
      receiverAddress = alphClient.getUserAddress(receiverIterator);
      amount = args[0];
      console.log(`tipping ${receiverUsername} ${amount} ALPH by reply`);
    } /*// For now, we only accept tips by direct reply
    else if (!isReply && (args = payload.match(tipAmountUserRegex)) && args.length == 3) {
      receiverUsername = args[2];
      console.log("Valid");
      console.log(ctx.update);
      console.log(ctx.update.message.entities);
      ctx.reply(`tipping ${receiverUsername}`);
    }*/
    else {
      console.log("Wrong format!");
      console.log(isReply, args)
      ctx.reply("Wrong format..");
      return;
    }

    // Does the sender have enough funds?
    const senderBalance = await alphClient.getUserBalance(senderIterator);
    console.log(`${senderUsername} wants to send ${amount} ALPH to ${receiverUsername} but has only ${senderBalance}`);
    if (senderBalance <= amount) {
      ctx.reply("You do not have enough funds, I cannot make this transfer, sorry.");
      console.log(`${senderUsername} wants to send ${amount} ALPH to ${receiverUsername} but has only ${senderBalance}`);
      return;
    }

    // Process request
    const txId = await alphClient.transfertAmount(senderWallet, receiverAddress, amount).catch(r => {
      console.log("Failed to process transaction.");
      if (r.toString().indexOf("Not enough balance") >= 0) {
        ctx.reply("Not enough funds, sorry.");
      }
      else {
        ctx.reply("An error occured.");
      }
      return;
    });

    if (undefined !== txId) {
      console.log(`${senderUsername} (id: ${senderID}) is tipping ${receiverUsername} (id: ${receiverID})${isReply ? " by reply" : ""}!`);
      ctx.reply(`${senderUsername} tipped ${receiverUsername} ${amount} ALPH.\nTx ID: ${txId}`);
    }
  });

  bot.command('privacy', (ctx: Context<Typegram.Update>) => {
    let privacyMessage = `I, ${ctx.me} 🤖, hereby promise that I will only collect your:\n`;
    privacyMessage += "\t\t- Telegram ID\n";
    privacyMessage += "\t\t- Telegram username\n";
    privacyMessage += "\nThese are associated it with an Alephium address and an ID that I use to remember you\n";
    privacyMessage += "This is the minimal amount of data I need to know and store in order to enable you to tip other Alephium enthusiasts.\n";
    privacyMessage += "\nWhile I receive every message that is sent in the chats I am in (to allow you to command me), I do not consider them if they are not for me. "
    privacyMessage += "\nIf you want me to forget about you and delete the data I have about you, you can run /forgetme";
    ctx.reply(privacyMessage);
  });

  bot.command("forgetme", (ctx: Context<Typegram.Update>) => {
    if ("private" === ctx.message!.chat.type) {
      ctx.reply("This feature will be added soon™️. Thank your for your patience.\nIf you cannot wait, please reach my creators, the admins of @NoTrustVerify");
    }
    else {
      ctx.reply(`I'm afraid I cannot let you do that here... Please try in our private discussion: @${ctx.me}`);
    }
  });

  // Quit allow to ask bot to leave the channel
  /*
  bot.command('quit', (ctx: Context<Typegram.Update>) => {
    console.log(`Quit: will leave (is not private)? ${ctx.message.chat.type !== "private"}`);
    const commandSender = ctx.from!.id;
    if ("private" === ctx.message.chat.type) {
      // Explicit usage
      console.log(`${commandSender} tried to ask bot to leave private chat`)
    }

    // Should check here if user is admin

    ctx.telegram.leaveChat(ctx.message.chat.id);// Context shortcut
    ctx.leaveChat();
  });
  */

  bot.on(message("text"), (ctx) => {
    console.log(`${ctx.message.from.username} sent "${ctx.update.message.text}"`);
    ctx.reply(`Received: "${ctx.update.message.text}"`);
  });

  process.once('SIGINT', () => {
    console.log("Stopping Telegram bot after receiving SIGINT");
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    console.log("Stopping Telegram bot after receiving SIGTERM");
    bot.stop('SIGTERM');
  });

  bot.launch();
}