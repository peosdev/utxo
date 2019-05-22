
module.exports = {

    eos_conn_info : {
        httpEndpoint: 'https://eos.greymass.com',
        chainId: 'e70aaab8997e1dfce58fbfac80cbbb8fecec7b99cf982a9444273cbc64c41473',

        keyProvider : [],
        sign        : true,
        broadcast   : true,
        expireInSeconds: 60,
    },

    wallet_URL: 'http://unix:~/eosio-wallet/keosd.sock:',

    active_public_key : '',
    
    contract_info: {
        code: 'netpeostoken',
        symbol: 'PEOS'
    },

}
