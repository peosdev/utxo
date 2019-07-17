const Promise = require('bluebird')
const HDKey = require('hdkey')
const ecc = require('eosjs-ecc')

let hdkey
let config

function initFromMasterSeed(conf, seed) {
    config = conf
    hdkey = HDKey.fromMasterSeed(Buffer.from(seed, 'hex'))
}

function getKey(sequence) {
    let key = hdkey.derive(`m/44/543523/0/0/${sequence}`)
    return ecc.PrivateKey(key.privateKey)
}

function getWalletKeyList() {
    let ret = []
    for(let i = 0 ; i < config.get('wallet_hd_index') ; ++i) {
        ret.push(getKey(i).toPublic().toString())
    }
    return ret
}

function createKey() {
    let index = config.get('wallet_hd_index')

    let pkey = getKey(index).toPublic().toString()

    config.set('wallet_hd_index', index + 1)

    return pkey
}

function getPrivKeyForPublic(pkey) {
    for(let i = 0 ; i < config.get('wallet_hd_index') ; ++i) {
        let key = getKey(i)
        if (key.toPublic().toString() == pkey) {
            return key
        }
    }
}

function signDigest(digest, key) {
    let pkey = getPrivKeyForPublic(key)
    return ecc.sign(digest, pkey)
}

module.exports = {
    initFromMasterSeed,
    getKey,
    getWalletKeyList,
    createKey,
    signDigest
}
