import helpers, { apiLooper, constants, api, cacheStorageGet, cacheStorageSet } from 'helpers'
import { getState } from 'redux/core'
import actions from 'redux/actions'
import web3 from 'helpers/web3'
import reducers from 'redux/core/reducers'
import config from 'app-config'
import referral from './referral'
import { web3Override } from 'keychain.js'
import { pubToAddress } from 'ethereumjs-util'
import * as hdkey from 'ethereumjs-wallet/hdkey'
import * as bip39 from 'bip39'
import typeforce from "swap.app/util/typeforce";

const getRandomMnemonicWords = () => bip39.generateMnemonic()
const validateMnemonicWords = (mnemonic) => bip39.validateMnemonic(mnemonic)

const sweepToMnemonic = (mnemonic, path) => {
  const wallet = getWalletByWords(mnemonic, path)
  localStorage.setItem(constants.privateKeyNames.ethMnemonic, wallet.privateKey)
  return wallet.privateKey
}

const isSweeped = () => {
  const {
    user: {
      ethData,
      ethMnemonicData,
    },
  } = getState()

  if (ethMnemonicData
    && ethMnemonicData.address
    && ethData
    && ethData.address
    && ethData.address.toLowerCase() !== ethMnemonicData.address.toLowerCase()
  ) return false

  return true
}

const getAllMyAddresses = () => {
  const {
    user: {
      ethData,
      ethMnemonicData,
    },
  } = getState()

  const retData = [ethData.address.toLowerCase()]

  if (ethMnemonicData
    && ethMnemonicData.address
    && ethMnemonicData.address.toLowerCase() !== ethData.address.toLowerCase()
  ) retData.push(ethMnemonicData.address.toLowerCase())

  return retData
}

const getSweepAddress = () => {
  const {
    user: {
      ethMnemonicData,
    },
  } = getState()

  if (ethMnemonicData && ethMnemonicData.address) return ethMnemonicData.address
  return false
}

const getPrivateKeyByAddress = (address) => {
  const {
    user: {
      ethData: {
        address: oldAddress,
        privateKey,
      },
      ethMnemonicData: {
        address: mnemonicAddress,
        privateKey: mnemonicKey,
      }
    },
  } = getState()

  if (oldAddress === address) return privateKey
  if (mnemonicAddress === address) return mnemonicKey
}

const getWalletByWords = (mnemonic, path) => {
  const seed = bip39.mnemonicToSeedSync(mnemonic)
  const hdwallet = hdkey.fromMasterSeed(seed);
  const wallet = hdwallet.derivePath((path) ? path : "m/44'/60'/0'/0/0").getWallet();

  return {
    mnemonic,
    address: `0x${wallet.getAddress().toString('Hex')}`,
    publicKey: `0x${wallet.pubKey.toString('Hex')}`,
    privateKey: `0x${wallet.privKey.toString('Hex')}`,
    wallet,
  }
}


const login = (privateKey, mnemonic, mnemonicKeys) => {
  let sweepToMnemonicReady = false

  if (privateKey 
    && mnemonic 
    && mnemonicKeys 
    && mnemonicKeys.eth === privateKey
  ) sweepToMnemonicReady = true

  if (!privateKey && mnemonic) sweepToMnemonicReady = true

  let data

  if (privateKey) {
    data = web3.eth.accounts.privateKeyToAccount(privateKey)
  }
  else {
    console.info('Created account Ethereum ...')
    // data = web3.eth.accounts.create()
    if (!mnemonic) mnemonic = bip39.generateMnemonic()
    const accData = getWalletByWords(mnemonic)
    console.log('Eth. Generated walled from random 12 words')
    console.log(accData)
    privateKey = accData.privateKey
    data = web3.eth.accounts.privateKeyToAccount(privateKey)
    localStorage.setItem(constants.privateKeyNames.ethMnemonic, privateKey)
  }

  localStorage.setItem(constants.privateKeyNames.eth, data.privateKey)

  web3.eth.accounts.wallet.add(data.privateKey)
  data.isMnemonic = sweepToMnemonicReady

  reducers.user.setAuthData({ name: 'ethData', data })

  window.getEthAddress = () => data.address
  referral.newReferral(data.address)

  console.info('Logged in with Ethereum', data)

  if (!sweepToMnemonicReady) {
    // Auth with our mnemonic account
    if (mnemonic === `-`) {
      console.error('Sweep. Cant auth. Need new mnemonic or enter own for re-login')
      return
    }

    if (!mnemonicKeys
      || !mnemonicKeys.eth
    ) {
      console.error('Sweep. Cant auth. Login key undefined')
      return
    }

    const mnemonicData = web3.eth.accounts.privateKeyToAccount(mnemonicKeys.eth)
    web3.eth.accounts.wallet.add(mnemonicKeys.eth)
    mnemonicData.isMnemonic = sweepToMnemonicReady

    console.info('Logged in with Ethereum Mnemonic', mnemonicData)
    reducers.user.addWallet({
      name: 'ethMnemonicData',
      data: {
        currency: 'ETH',
        fullName: 'Ethereum (New)',
        balance: 0,
        isBalanceFetched: false,
        balanceError: null,
        infoAboutCurrency: null,
        ...mnemonicData,
      }
    })
    new Promise(async(resolve) => {
      const balance = await fetchBalance(mnemonicData.address)
      reducers.user.setAuthData({
        name: 'ethMnemonicData',
        data: {
          balance,
          isBalanceFetched: true,
        },
      })
      resolve(true)
    })
  }

  return data.privateKey
}

const loginWithKeychain = async () => {
  const web3OverrideFunctions = web3Override(web3)
  web3.eth.accounts.sign = web3OverrideFunctions.sign
  web3.eth.accounts.signTransaction = web3OverrideFunctions.signTransaction

  const selectedKey = await actions.keychain.login('ETH')
  if (!selectedKey) { // user cancelled key selection or other error
    return null
  }
  const data = { privateKey: selectedKey, address: `0x${pubToAddress(`0x${selectedKey}`).toString('hex')}` }

  reducers.user.setAuthData({ name: 'ethData', data })
  localStorage.setItem(constants.privateKeyNames.ethKeychainPublicKey, selectedKey)
  localStorage.removeItem(constants.privateKeyNames.eth)

  window.getEthAddress = () => data.address

  console.info('Logged in with Ethereum', data)

  await getBalance()
  await getReputation()
  return selectedKey
}

const isETHAddress = (address) => {
  const { user: { ethData } } = getState()
  if (ethData && ethData.address && ethData.address.toLowerCase() === address.toLowerCase()) return ethData
}

const getBalance = () => {
  const { user: { ethData: { address } } } = getState()

  const balanceInCache = cacheStorageGet('currencyBalances', `eth_${address}`)
  if (balanceInCache !== false) return balanceInCache

  return web3.eth.getBalance(address)
    .then(result => {
      const amount = web3.utils.fromWei(result)

      cacheStorageSet('currencyBalances', `eth_${address}`, amount, 30)
      reducers.user.setBalance({ name: 'ethData', amount })
      return amount
    })
    .catch((e) => {
      reducers.user.setBalanceError({ name: 'ethData' })
    })
}

const getReputation = () => Promise.resolve(0)

const fetchBalance = (address) =>
  web3.eth.getBalance(address)
    .then(result => Number(web3.utils.fromWei(result)))
    .catch((e) => {
      console.log('Web3 doesn\'t work please again later ', e.error)
    })

const getInvoices = (address) => {
  const { user: { ethData: { userAddress } } } = getState()

  address = address || userAddress

  return actions.invoices.getInvoices({
    currency: 'ETH',
    address,
  })
}

const getTx = (txRaw) => {

  return txRaw.transactionHash
}

const getLinkToInfo = (tx) => {

  if(!tx) {
    return
  }

  return `https://etherscan.io/tx/${tx}`
}

const getTransaction = (address, ownType) =>
  new Promise((resolve) => {
    const { user: { ethData: { address: userAddress } } } = getState()
    address = address || userAddress

    if(!typeforce.isCoinAddress['ETH'](address)) {
      resolve([])
    }

    const type = (ownType) ? ownType : 'eth'

    const url = `?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc&apikey=RHHFPNMAZMD6I4ZWBZBF6FA11CMW9AXZNM`

    return apiLooper.get('etherscan', url)
      .then((res) => {
        const transactions = res.result
          .filter((item) => item.value > 0).map((item) => ({
            type,
            confirmations: item.confirmations,
            hash: item.hash,
            status: item.blockHash != null ? 1 : 0,
            value: web3.utils.fromWei(item.value),
            address: item.to,
            canEdit: address === userAddress,
            date: item.timeStamp * 1000,
            direction: address.toLowerCase() === item.to.toLowerCase() ? 'in' : 'out',
          }))

        resolve(transactions)
      })
      .catch(() => {
        resolve([])
      })
  })

const send = ({ from, to, amount, gasPrice, gasLimit, speed } = {}) =>
  new Promise(async (resolve, reject) => {
    //const { user: { ethData: { privateKey } } } = getState()
    const privateKey = getPrivateKeyByAddress(from)

    gasPrice = gasPrice || await helpers.eth.estimateGasPrice({ speed })
    gasLimit = gasLimit || constants.defaultFeeRates.eth.limit.send

    const params = {
      to: String(to).trim(),
      gasPrice,
      gas: gasLimit,
      value: web3.utils.toWei(String(amount)),
    }

    const result = await web3.eth.accounts.signTransaction(params, privateKey)
    const receipt = web3.eth.sendSignedTransaction(result.rawTransaction)
      .on('transactionHash', (hash) => {
        const txId = `${config.link.etherscan}/tx/${hash}`
        console.log('tx', txId)
        actions.loader.show(true, { txId })
      })
      .on('error', (err) => {
        reject(err)
      })

    resolve(receipt)
  })

export default {
  send,
  login,
  loginWithKeychain,
  getBalance,
  fetchBalance,
  getTransaction,
  getReputation,
  getInvoices,
  getTx,
  getLinkToInfo,
  isETHAddress,
  getWalletByWords,
  getRandomMnemonicWords,
  validateMnemonicWords,
  sweepToMnemonic,
  isSweeped,
  getSweepAddress,
  getAllMyAddresses,
}
