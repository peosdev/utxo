#!/usr/bin/env node

const program = require('commander');
const Eos     = require('eosjs');
const { PublicKey , sha256 } = require('eosjs-ecc')
const Config  = require('./config');
const read    = require('read');
const request = require('request');
const Promise = require('bluebird')
const Conf = require('conf');


Config.wallet_URL = Config.wallet_URL.replace('~', process.env.HOME);

const config = new Conf({
    configName: 'clpeosconfig',
    cwd: './',
    schema: {
        wallet_name: {
            type: 'string',
            default: ''
        }
    }
});

function getChainInfo() {
    return new Promise((resolve, reject) => {
        const options = {
            method: "GET",
            url: Config.eos_conn_info.httpEndpoint + "/v1/chain/get_info",
        }
        request(options, function (err, res, body) {
            if (err) reject(err);
            else resolve(JSON.parse(body));
        })
    })
}

function getAcount(account) {
    let body = {
        account_name: account
    }
    return new Promise((resolve, reject) => {
        const options = {
            method: "GET",
            url: Config.eos_conn_info.httpEndpoint + "/v1/chain/get_account",
            body: JSON.stringify(body)
        }
        request(options, function (err, res, body) {
            if (err) reject(err);
            else resolve(JSON.parse(body));
        })
    })
}

function getKeyAcount(key) {
    let body = {
        public_key: key
    }
    return new Promise((resolve, reject) => {
        const options = {
            method: "GET",
            url: Config.eos_conn_info.httpEndpoint + "/v1/history/get_key_accounts",
            body: JSON.stringify(body)
        }
        request(options, function (err, res, body) {
            if (err) reject(err);
            else resolve(JSON.parse(body).account_names);
        })
    })
}

function getCurrencyBalance(code, account_name, symbol) {

    return new Promise((resolve, reject) => {
        const body = {
            account : account_name, 
            code    : code, 
            symbol  : symbol
        }

        const options = {
            method: "POST",
            url: Config.eos_conn_info.httpEndpoint + "/v1/chain/get_currency_balance",
            body: JSON.stringify(body) 
        }

        request(options, function (err, res, body) {
            if (err) reject(err);
            else resolve(JSON.parse(body));
        })
    })
}

async function getActiveKey(account) {
    let data = await getAcount(account)
    if (!data.permissions) {
        return
    }

    for (p of data.permissions) {
        if (p.perm_name == 'active') {
            return p.required_auth.keys[0].key
        }
    }
}

function getWalletKeyList() {
    return new Promise((resolve, reject) => {
        const options = {
            method: "POST",
            url: Config.wallet_URL + "/v1/wallet/get_public_keys",
        }
        request(options, function (err, res, body) {
            if (err) reject(err);
            else {
                body = JSON.parse(body)
                if (!Array.isArray(body)) {
                    console.log('ERROR: Locked wallet')
                    resolve([])
                    return
                }
                resolve(body);
            }
        })
    })
}

function createKey() {
    return new Promise((resolve, reject) => {
        let body = 
            [program.name || config.get('wallet_name'), ""]
    
        const options = {
            method: "POST",
            url: Config.wallet_URL + "/v1/wallet/create_key",
            body: JSON.stringify(body)
        }

        request(options, function (err, res, body) {
            if (err) reject(err);
            else {
                let key = JSON.parse(body)
                if (typeof(key) != 'string') {
                    reject('failed')
                } else {
                    resolve(key);
                }
            }
        })
    })
}

var eos = null;

async function signProvider(buf, sign) {
    return new Promise((resolve, reject) => {
        const body = [
            buf.transaction,
            [Config.active_public_key],
            Config.eos_conn_info.chainId
        ];
        const options = {
            method: "POST",
            url: Config.wallet_URL + "/v1/wallet/sign_transaction",
            body: JSON.stringify(body)
        }
        request(options, function (err, res, body) {
            if (err) reject(err);
            else {
                resolve(JSON.parse(body).signatures);
            }
        })
    })
}

async function signDigest(digest, key) {
    return new Promise((resolve, reject) => {
        const body = [
            digest,
            key
        ];
        const options = {
            method: "POST",
            url: Config.wallet_URL + "/v1/wallet/sign_digest",
            body: JSON.stringify(body)
        }
        request(options, function (err, res, body) {
            if (err) {
                console.log(err)
                reject(err);
            } else {
                resolve(JSON.parse(body));
            }
        })
    })
}

async function makeTransactionHeader(expireInSeconds, callback) {
    let info = await eos.getInfo({});
    chainDate = new Date(info.head_block_time + 'Z')
    expiration = new Date(chainDate.getTime() + expireInSeconds * 1000)
    expiration = expiration.toISOString().split('.')[0]

    let block = await eos.getBlock(info.last_irreversible_block_num);
    let header = {
        expiration: expiration,
        ref_block_num: info.last_irreversible_block_num & 0xFFFF,
        ref_block_prefix: block.ref_block_prefix,

        net_usage_words: 0,
        max_cpu_usage_ms: 0,
        delay_sec: 0,
        context_free_actions: [],
        actions: [],
        signatures: [],
        transaction_extensions: []
    }

    callback(null, header);
}

function makeVerifyActions(account_name, signatures) {
    let actions = [];

    for (let i = 0; i < signatures.length; i++) {
        let action = {
            account: Config.contract_info.code,
            name: 'verifysig',
            data: {
                owner: account_name,
                sig: `${signatures[i]}`
            }
        };

        actions.push(action);
    }

    return actions;
}

function makeTransferAction(account_name, inputs, outputs) {
    let action = {
        account: Config.contract_info.code,
        name: 'transferutxo',
        data: {
            payer: account_name,
            inputs,
            outputs
        },
        authorization: [{
            actor: account_name,
            permission: 'active'
        }]
    };
    return action;
}

function makeLoadAction(from, key, amount) {
    let action = {
        account: Config.contract_info.code,
        name: 'loadutxo',
        data: {
            from: from,
            pk: key,
            quantity: amount
        },
        authorization: [{
            actor: from,
            permission: 'active'
        }]
    };
    return action;
}

function fixBufferEndianForEOS(buf) {
    let ret = ''
    
    for(let i = 15 ; i >= 0 ; --i) {
        ret += buf[i]
    }

    for(let i = 31 ; i >= 16 ; --i) {
        ret += buf[i]
    }

    ret = Buffer.from(ret, 'binary')
    
    return ret
}

function getAmount(asset, symbol) {
    symbol = symbol || 'PEOS';
    let a = asset.split(' ');
    if (a[1] !== symbol) 
        return 0.0;
    return parseFloat(a[0])
} 

function formatAmount(asset, symbol) {
    return `${asset.toFixed(4)} ${symbol || 'PEOS'}`
}

async function getUTXOsForKey(pk) {
    let hash = fixBufferEndianForEOS(sha256(PublicKey.fromString(pk).toBuffer(), 'binary')).toString('hex')
    return new Promise((resolve, reject) => {
        let body = {
            "json": true,
            "code": Config.contract_info.code,
            "scope": Config.contract_info.code,
            "table": "utxos",
            "table_key": "",
            "lower_bound": hash,
            "upper_bound": hash,
            "limit": 1000,
            "key_type": "sha256",
            "index_position": "2",
            "encode_type": "hex",
            "reverse": false,
            "show_payer": false
        }
        const options = {
            method: "GET",
            url: Config.eos_conn_info.httpEndpoint + "/v1/chain/get_table_rows",
            body: JSON.stringify(body)
        }
        request(options, function (err, res, body) {
            if (err) { reject(err); return; }

            let rows = JSON.parse(body).rows
            if (rows !== undefined) {
                resolve(rows);
            } else {
                resolve([])
            }
        })
    })
}

async function getOwnedUTXOs() {
    let keys = await getWalletKeyList();

    let utxos = []

    for(let key of keys) {
        let ks = await getUTXOsForKey(key);
        utxos = utxos.concat(ks)
    }

    return utxos
}

async function getWalletBalance() {
    let utxos = await getOwnedUTXOs()
    let balance = 0.0;

    for (utxo of utxos) {
        balance += getAmount(utxo.amount)
    }

    return balance
}

async function getWalletUTXOForAmount(amount) {
    let all_utxos = await getOwnedUTXOs()
    all_utxos.sort((a, b) => {return getAmount(a.amount) - getAmount(b.amount)});

    let balance = 0.0;
    let utxos = []

    for (utxo of all_utxos) {
        balance += getAmount(utxo.amount)
        utxos.push({id: utxo.id, pk: utxo.pk})
        if (balance >= amount) {
            break
        }
    }

    return [utxos, balance]
}

async function init() {
    const chainInfo = await getChainInfo();
    if (chainInfo.chain_id !== Config.eos_conn_info.chainId) {
        console.error('ERROR: Check chain_id!');
        return;
    }
    
    Config.eos_conn_info.signProvider = signProvider;
    Config.eos_conn_info.transactionHeaders = makeTransactionHeader; 

    eos = Eos(Config.eos_conn_info);
}

async function loadutxo(from, to, amount) {
    let key = await getActiveKey(from)
    if (!key) {
        console.error("ERROR: Can't find key for account:", from)
        return
    }

    await init();

    Config.active_public_key = key

    if (to === 'new') {
        try {
            to = await createKey()
            console.log(`Generated new key ${to}`)
        } catch (err) {
            console.error('ERROR: Failed to generate new key. (locked wallet?)')
            return
        }
    } 

    if(!PublicKey.isValid(to)) {
        console.error("ERROR: Invalid to address")
        return
    }

    let loadAction = makeLoadAction(from, to, amount)

    await eos.transaction({ actions: [loadAction] })
        .then(async (ret) => {
            console.log('Transfer success (Id: ' + ret.transaction_id + ' )');
        })
        .catch((err) => {
            console.error('ERROR: transfer failed:', err)
        })
}

function int2le(data)
{
    const b = Buffer.allocUnsafe(8);
     b[0] = data & 0xFF;
     b[1] = (data >> 8) & 0xFF;
     b[2] = (data >> 16) & 0xFF;
     b[3] = (data >> 24) & 0xFF;
     b[4] = 0; // TODO: handle 64bits in javascript joy
     b[5] = 0;
     b[6] = 0;
     b[7] = 0;
     return b;
}

async function transferutxo(to, amount, cmd) {
    if (!cmd.auth && !cmd.save) {
        console.error("ERROR: No authenticating EOS account. Use --auth <account> or --save to save for relay.")
        return
    }

    await init();

    if (to === 'new') {
        try {
            to = await createKey()
            console.log(`Generated new key ${to}`)
        } catch (err) {
            console.error('ERROR: Failed to generate new key. (locked wallet?)')
            return
        }
    }

    let outputs = []

    if(PublicKey.isValid(to)) {
        outputs.push({ pk:to, account: '', quantity: amount })
    } else {
        outputs.push({ pk:'EOS5VFSVbso9eZn8vzLWbsWBMV1K4sYsZnxnePnMayJtMaksMU8my', account: to, quantity: amount })
    }

    let amountNum = getAmount(amount)
    if (amountNum <= 0) {
        console.log("ERROR: Nothing to send")
        return
    }

    let ret = await getWalletUTXOForAmount(amountNum)
    let utxos = ret[0]
    let change = ret[1] - amountNum

    if (change > 0) {
        let changeAddress = await createKey()
        outputs.push({ pk:changeAddress, account:"", quantity: `${change.toFixed(4)} PEOS` })
    }

    if (change < 0) {
        console.log('ERROR: Insufficient balance')
        return
    }

    let buf = eos.fc.toBuffer('uint8', outputs.length)
    for (o of outputs) {
        buf = Buffer.concat([buf, 
            eos.fc.toBuffer('public_key', o.pk), 
            eos.fc.toBuffer('name', o.account), 
            eos.fc.toBuffer('asset', o.quantity)])
    }

    let outputDigest = fixBufferEndianForEOS(sha256(buf, 'binary'))

    let utxoIds = []
    await Promise.map(utxos, async (u)=>{
        let buf = Buffer.concat([int2le(u.id), outputDigest])
        let digest = sha256(buf)

        let sig = await signDigest(digest, u.pk)
        
        utxoIds.push({
            id: u.id,
            sig 
        })
    })
    
    console.assert(change >= 0, "Negative change! " + change)

    let tranferAction = makeTransferAction(cmd.auth || '', utxoIds, outputs)

    if (cmd.auth) {
        let key = await getActiveKey(cmd.auth)
        if (!key) {
            console.error("ERROR: Can't find key for account:", cmd.auth)
            return
        }
        Config.active_public_key = key
    
        await eos.transaction({ actions: [tranferAction] })
            .then(async (ret) => {
                console.log('Transfer success (Id: ' + ret.transaction_id + ' )');
            })
            .catch((err) => {
                console.log('ERROR: transfer failed:', err)
            })
    } else {
        console.log(JSON.stringify(tranferAction))
    }
}

async function relayAction(auth, action) {
    if (!auth) {
        console.error("ERROR: No authenticating EOS account.")
        return
    }

    if (!action) {
        console.error("ERROR: No action.")
        return
    }

    let actionJson

    try {
        actionJson = JSON.parse(action)
        actionJson.data.payer = auth
        actionJson.authorization[0].actor = auth    
    } catch (err) {
        console.error('ERROR: Action not valid: ', err.message)
        return
    }

    await init();

    let key = await getActiveKey(auth)
    if (!key) {
        console.error("ERROR: Can't find key for account:", auth)
        return
    }
    Config.active_public_key = key

    await eos.transaction({ actions: [actionJson] })
        .then(async (ret) => {
            console.log('Transfer success (Id: ' + ret.transaction_id + ' )');
        })
        .catch((err) => {
            console.log('ERROR: transfer failed:', err)
        })
}

async function tranferAction(from, to, amount, cmd) {
    if (from === 'utxo') {
        await transferutxo(to, amount, cmd)
    } else {
        await loadutxo(from, to, amount)
    }
}

async function getReceiveKey(cmd) {
    if(cmd.reuse) {
        let keys = await getWalletKeyList();

        for(let key of keys) {
            if((await getUTXOsForKey(key)).length === 0) {
                return key
            }
        }
    }

    return await createKey()
}

async function getAllAccounts(cmd) {
    let code = cmd.code || 'eosio.token'
    let symbol = cmd.symbol || 'EOS'
    let exclude = (cmd.exclude || '').split(',')
    let keys = await getWalletKeyList();

    let sum = 0

    for(let key of keys) {
        let accounts = await getKeyAcount(key)
        for(let account of accounts) {
            if (exclude.includes(account)){
                continue
            }
            let balance = await getCurrencyBalance(code, account, symbol)
            if (balance.length == 0) {
                continue
            }
            let amount = parseFloat(balance[0].split(' ')[0])
            sum += amount
            console.log(account, amount, symbol)
        }
    }

    console.log('Total:', sum)
}

async function _main() {
    program
    .version('0.1', '-v --version')
    .description('UTXO wallet for pEOS. Learn more at https://peos.one')
    .option('-n, --name <wallet>', 'EOS wallet name', config.get('wallet_name'))

    program
    .command('balance')
    .option('-u, --utxo', 'Report all UTXOS')
    .action(async function (cmd) {
        if (cmd.utxo) {
            let utxos = await getOwnedUTXOs()
            console.log('+---------+-------------------------------------------------------+----------------------+')
            console.log('| Id      | Address                                               | Amount               |')
            console.log('+---------+-------------------------------------------------------+----------------------+')
            for (utxo of utxos) {
                console.log(`| ${utxo.id.toFixed(0).padEnd(8)}| ${utxo.pk} | ${utxo.amount.padStart(20)} |`)
            }
            console.log('+---------+-------------------------------------------------------+----------------------+')
        } else {
            let balance = await getWalletBalance()
            console.log(`Wallet balance: ${formatAmount(balance)}`)
        }
    })

    program
    .command('receive')
    .option('-r, --reuse', 'Reuse unsued keys in the wallet')
    .action(async (cmd) => {
        let key = await getReceiveKey(cmd)
        console.log(`Receive address: ${key}`)
    })

    program
    .command('transfer <from> <to> <amount>')
    .option('-a, --auth <account>', 'Authenticating EOS account')
    .option('-s, --save', 'Save the transaction for later relay')
    .action(tranferAction)

    program
    .command('relay <auth> <action>')
    .action(relayAction)

    program
    .command('set <variable> <value>')
    .action((variable, value, cmd)=>{
        config.set(variable, value)
    })

    program
    .command('get <variable> ')
    .action((variable, value, cmd)=>{
        console.log(config.get(variable))
    })

    program
    .command('all')
    .option('-s, --symbol <symbol>', 'Token symbol')
    .option('-c, --code <code>', 'Token contract')
    .option('-e, --exclude <accounts>', 'Comma separated accounts to exclude')
    .action((cmd)=>{
        getAllAccounts(cmd)
    })
 
    program.parse(process.argv)    

    if (!program.args.length) program.help();
}

_main();

