# TipAlph

This repository hosts the code of @TipAlphBot, a bot that allows you to send and receive Alephium with Telegram!

## Deploying

To deploy the bot:

1. create a bot by chatting with [Bot Father](https://t.me/botfather) and get your bot token
2. get Alephium related elements:
   1. get a fresh mnemonic for the wallet hosting everybody's address. Make sure to not create and new address on this wallet.
   2. get an address for collecting the operator's fees (if you want some)
3. clone this repository `git clone https://github.com/notrustverify/tipALPH`
4. copy the `.env.example` into `.env` file: `cp .env.example .env`
5. change the variable in the `.env` file according to your setup (fullnode address, …) and insert the bot token and the address for fees in the `.env` file
6. copy your freshly created mnemonic in a file named `bot_mnemonic.txt` in the `secrets` folder
7. create a new TipAlph docker image with `npm run package`
8. run `docker compose up -d` to run the fresh docker image.

On the logs (with `docker compose logs -f`), you should see a successful connection to the database as well as a ready and synced NodeProvider.   
The telegram bot should now be available.

## Develop

To work on the bot, we suggest to use the devnet. It allows for faster testing and better testing conditions (easier generation of tokens).   
Follow the same procedure as for deployment, but specify a fullnode on the testnet and "NETWORK=testnet" in the .env file. The provided fees collection address and mnemonic for the wallets should also be on the testnet. We would advise you to use a different database as well, if you previously deployed on a database.