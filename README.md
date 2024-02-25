# TipAlph

This repository hosts the code of @TipAlphBot, a bot that allows you to send and receive Alephium with Telegram!   
This project was developed as part of the [Alephium Hackathon](https://medium.com/@alephium/alephium-1-hackathon-pioneers-918643251741).

This project uses Node lts/hydrogen (v18.19.0) and NPM (v10.2.3).

## Dependencies

_To be added soon_.

## How to deploy

The only supported way to deploy the code actually is using Docker, as the code uses Docker secrets.   
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

## How to develop

To work on the bot, we suggest to use the devnet. It allows for faster testing and better testing conditions (easier generation of tokens).   
Follow the same procedure as for deployment, but specify a fullnode on the testnet and "NETWORK=testnet" in the .env file. The provided fees collection address and mnemonic for the wallets should also be on the testnet. We would advise you to use a different database as well, if you previously deployed on a database.

There is multiple way of running the code application:

* using `npm run start`: will transpile the Typescript into Javacript and use node to execute it
* using `npm run dev`: will directly execute the Typescript code using `tsx`
* using `npm run watch`: as `npm run dev` but in watch mode (will reload the program if a file changed or ENTER is pressed)
* as a docker container (see below)

These are defined in the _package.json_ file.

## Building the docker container

We provide a Dockerfile to build the container. The easiest way to build a new image is by running the `npm run package` commands, which takes care of settings the appropriate tags for you.

To create a docker container from the freshly built image, we recommend using the provided docker-compose.yml file with the required configuration. Once you provided the required [dependencies](#dependencies), simply do a `docker compose up` to spin a new container.

## License

The code in this repository (without the dependencies it relies on), is released under the GNU GENERAL PUBLIC LICENSE v3 or later license.
