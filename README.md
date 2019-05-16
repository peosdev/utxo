# EOS UTXO Implementation

Repo with UTXO implentation for PEOS

For more information visit https://peos.one

## /contract/

The source code of the contract that handles the PEOS token. 

## /cmd/

The command line utility `clpeos` provides an interface to the UTXO 
enabled PEOS smart contract. 

The utility uses the original EOSIO wallet to store your keys, so that
must be installed and setup. It is advised to create a new wallet for this purpose and set that in the configuration file.  