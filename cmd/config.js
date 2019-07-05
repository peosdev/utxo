
module.exports = {

    eos_conn_info : {
        httpEndpoint: 'https://eos.greymass.com',
        chainId: 
            //'e70aaab8997e1dfce58fbfac80cbbb8fecec7b99cf982a9444273cbc64c41473',
            'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906',

        keyProvider : [],
        sign        : true,
        broadcast   : true,
        expireInSeconds: 60,
    },

    wallet_URL: 'http://unix:~/eosio-wallet/keosd.sock:',

    active_public_key : '',
    
    contract_info: {
        code: 'thepeostoken',
        symbol: 'PEOS'
    },

}
