# Alephium fullnode

This folder hosts the configuration files and data for both dev and test alephium networks.

## The various Alephium networks

**Devnet**: A full blockchain on your computer, a single node, no history. Usefull for developing. Does not require any internet connection.

**Testnet**: A fullnode connected and synchronised with the other fullnode on the alephium test network. Allow tests in almost real condition (result of actions can be checked on the [Testnet explorer](https://testnet.alephium.org)).

**Mainnet**: The blockchain with the real stuff, in production.

## Blockchain history

Both testnet and mainnet requires to be up-to-date with the current blockchain state. For this purpose, a node on these network will download the history of blocks and validate them individually. The downloading part can be speeded up by downloading manually a previous snapshot of the chain. The fullnode will still need to check the consistency of the data at its first boot, which will take some time.

Please refer to the [related Alephium documentation](https://docs.alephium.org/full-node/loading-snapshot) for instructions on downloading a previous snapshot of the blockchain.
