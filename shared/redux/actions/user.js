import config from 'app-config'
import moment from 'moment/moment'
import { request, constants, ethToken } from 'helpers'

import actions from 'redux/actions'
import { getState } from 'redux/core'

import reducers from 'redux/core/reducers'
import * as bip39 from 'bip39'



const sign = async () => {
  let mnemonic = localStorage.getItem(constants.privateKeyNames.twentywords)

  if (!mnemonic) {
    mnemonic = bip39.generateMnemonic()
    localStorage.setItem(constants.privateKeyNames.twentywords, mnemonic)
  }

  const mnemonicKeys = {
    btc: localStorage.getItem(constants.privateKeyNames.btcMnemonic),
    eth: localStorage.getItem(constants.privateKeyNames.ethMnemonic),
  }

  if (mnemonic !== `-`) {
    if (!mnemonicKeys.btc) mnemonicKeys.btc = actions.btc.sweepToMnemonic(mnemonic)
    if (!mnemonicKeys.eth) mnemonicKeys.eth = actions.eth.sweepToMnemonic(mnemonic)
  }
  // Sweep-Switch
  let btcNewSmsMnemonicKey = localStorage.getItem(constants.privateKeyNames.btcSmsMnemonicKeyMnemonic)
  try { btcNewSmsMnemonicKey = JSON.parse( btcNewSmsMnemonicKey ) } catch (e) {}
  if (!(btcNewSmsMnemonicKey instanceof Array)) {
    localStorage.setItem(constants.privateKeyNames.btcSmsMnemonicKeyMnemonic, JSON.stringify([]))
  }

  let btcNewMultisigOwnerKey = localStorage.getItem(constants.privateKeyNames.btcMultisigOtherOwnerKeyMnemonic)
  try { btcNewMultisigOwnerKey = JSON.parse( btcNewMultisigOwnerKey ) } catch (e) {}
  if (!(btcNewMultisigOwnerKey instanceof Array)) {
    localStorage.setItem(constants.privateKeyNames.btcMultisigOtherOwnerKeyMnemonic, JSON.stringify([]))
  }

  const btcPrivateKey = localStorage.getItem(constants.privateKeyNames.btc)
  const btcMultisigPrivateKey = localStorage.getItem(constants.privateKeyNames.btcMultisig)
  const bchPrivateKey = localStorage.getItem(constants.privateKeyNames.bch)
  const ltcPrivateKey = localStorage.getItem(constants.privateKeyNames.ltc)
  const ethPrivateKey = localStorage.getItem(constants.privateKeyNames.eth)
  // const qtumPrivateKey        = localStorage.getItem(constants.privateKeyNames.qtum)
  // const xlmPrivateKey = localStorage.getItem(constants.privateKeyNames.xlm)

  const isEthKeychainActivated = !!localStorage.getItem(constants.privateKeyNames.ethKeychainPublicKey)
  const isBtcKeychainActivated = !!localStorage.getItem(constants.privateKeyNames.btcKeychainPublicKey)
  const isBtcMultisigKeychainActivated = !!localStorage.getItem(constants.privateKeyNames.btcMultisigKeychainPublicKey)

  const _ethPrivateKey = isEthKeychainActivated ? await actions.eth.loginWithKeychain() : actions.eth.login(ethPrivateKey, mnemonic, mnemonicKeys)
  const _btcPrivateKey = isBtcKeychainActivated ? await actions.btc.loginWithKeychain() : actions.btc.login(btcPrivateKey, mnemonic, mnemonicKeys)

  // btc multisig with 2fa (2of3)
  const btcSMSServerKey = config.swapContract.protectedBtcKey
  let btcSmsPublicKeys = [ btcSMSServerKey ]
  let btcSmsMnemonicKey = localStorage.getItem(constants.privateKeyNames.btcSmsMnemonicKey)
  try { btcSmsMnemonicKey = JSON.parse( btcSmsMnemonicKey ) } catch (e) {}
  if (btcSmsMnemonicKey instanceof Array && btcSmsMnemonicKey.length > 0) {
    btcSmsPublicKeys.push(btcSmsMnemonicKey[0])
  }
  const _btcMultisigSMSPrivateKey = actions.btcmultisig.login_SMS(_btcPrivateKey, btcSmsPublicKeys)

  // btc multisig 2of2 user manual sign
  let btcMultisigOwnerKey = localStorage.getItem(constants.privateKeyNames.btcMultisigOtherOwnerKey)
  try { btcMultisigOwnerKey = JSON.parse( btcMultisigOwnerKey ) } catch (e) {}
  const _btcMultisigPrivateKey = actions.btcmultisig.login_USER(_btcPrivateKey, btcMultisigOwnerKey)
  await actions.btcmultisig.signToUserMultisig()
  actions.bch.login(bchPrivateKey)
  // actions.usdt.login(btcPrivateKey)
  actions.ltc.login(ltcPrivateKey)
  // actions.qtum.login(qtumPrivateKey)
  // actions.xlm.login(xlmPrivateKey)

  // if inside actions.token.login to call web3.eth.accounts.privateKeyToAccount passing public key instead of private key
  // there will not be an error, but the address returned will be wrong
  // if (!isEthKeychainActivated) {
    Object.keys(config.erc20)
      .forEach(name => {
        actions.token.login(_ethPrivateKey, config.erc20[name].address, name, config.erc20[name].decimals, config.erc20[name].fullName)
      })
  // }
  reducers.user.setTokenSigned(true)
  // await actions.nimiq.login(_ethPrivateKey)

  // const getReputation = actions.user.getReputation()

  await getReputation()
}

const getReputation = async () => {
  
  const btcReputationPromise = actions.btc.getReputation()
  const ethReputationPromise = actions.eth.getReputation()

  Promise.all([
    btcReputationPromise,
    ethReputationPromise,
  ])
    .then(([btcReputation, ethReputation]) => {
      const totalReputation = Number(btcReputation) + Number(ethReputation)

      if (Number.isInteger(totalReputation)) {
        reducers.ipfs.set({ reputation: totalReputation })
      }
      else {
        reducers.ipfs.set({ reputation: null })
      }
    })
    .catch((error) => {
      console.error(`unknown reputation`, error)
    })
}



const getBalances = () => {
  const {
    user: {
      isTokenSigned,
    }
  } = getState()

  actions.eth.getBalance()
  actions.btc.getBalance()
  actions.btcmultisig.getBalance() // SMS-Protected
  actions.btcmultisig.getBalanceUser() //Other user confirm
  // actions.bch.getBalance()
  actions.ltc.getBalance()
  // actions.usdt.getBalance()
  // actions.qtum.getBalance()
  // actions.xlm.getBalance()

  if (isTokenSigned) {
    Object.keys(config.erc20)
      .forEach(name => {
        actions.token.getBalance(name)
      })
  }
  // actions.nimiq.getBalance()
}

const getExchangeRate = (sellCurrency, buyCurrency) => {
  console.log('actions.user.getExchangeRate', sellCurrency, buyCurrency)
  if (buyCurrency.toLowerCase() === 'usd') {
    return new Promise((resolve, reject) => {
      let dataKey = sellCurrency.toLowerCase()
      switch (sellCurrency.toLowerCase()) {
        case 'btc (sms-protected)':
        case 'btc (multisig)':
          dataKey = 'btc'
          break
        default:
      }
      const { user } = getState()
      if (user[`${dataKey}Data`] && user[`${dataKey}Data`].infoAboutCurrency) {
        const currencyData = user[`${dataKey}Data`]
        resolve(currencyData.infoAboutCurrency.price_usd)
      } else {
        resolve(1)
      }
    })
  }
  return new Promise((resolve, reject) => {
    const url = `https://api.cryptonator.com/api/full/${sellCurrency}-${buyCurrency}`

    request.get(url, { cacheResponse: 60000 }).then(({ ticker: { price: exchangeRate } }) => {
      resolve(exchangeRate)
    })
      .catch(() => {
        if (constants.customEcxchangeRate[sellCurrency.toLowerCase()] !== undefined) {
          resolve(constants.customEcxchangeRate[sellCurrency])
        } else {
          resolve(1)
        }
      })
  })
}

const getDemoMoney = process.env.MAINNET ? () => { } : () => {
  // googe bitcoin (or rinkeby) faucet
  request.get('https://swap.wpmix.net/demokeys.php', {})
    .then((r) => {
      window.localStorage.clear()
      localStorage.setItem(constants.privateKeyNames.btc, r[0])
      localStorage.setItem(constants.privateKeyNames.eth, r[1])
      localStorage.setItem(constants.localStorage.demoMoneyReceived, true)
      window.location.reload()
    })
}


const getInfoAboutCurrency = (currencyNames) => 

  new Promise((resolve, reject) => {
    const url = 'https://noxon.wpmix.net/cursAll.php';
    reducers.user.setIsFetching({ isFetching: true })

    request.get(url, {
      cacheResponse: 60*60*1000, // кеш 1 час
    }).then((answer) => {
      let infoAboutBTC = answer.data.filter( currencyInfo => {
        if (currencyInfo.symbol.toLowerCase() === 'btc') return true
      })
      const btcPrice = (
        infoAboutBTC
        && infoAboutBTC.length
        && infoAboutBTC[0].quote
        && infoAboutBTC[0].quote.USD
        && infoAboutBTC[0].quote.USD.price
      ) ? infoAboutBTC[0].quote.USD.price : 7000 

      answer.data.map(currencyInfoItem => {
        if (currencyNames.includes(currencyInfoItem.symbol)) {
          if (currencyInfoItem.quote && currencyInfoItem.quote.USD) {
            const priceInBtc = currencyInfoItem.quote.USD.price / btcPrice
            const currencyInfo = {
              ... currencyInfoItem.quote.USD,
              price_usd: currencyInfoItem.quote.USD.price,
              price_btc: priceInBtc,
            }

            switch(currencyInfoItem.symbol) {
              case 'BTC': {
                reducers.user.setInfoAboutCurrency({name: 'btcData', infoAboutCurrency: currencyInfo})
                reducers.user.setInfoAboutCurrency({name: 'btcMnemonicData', infoAboutCurrency: currencyInfo}) // Sweep (for future)
                reducers.user.setInfoAboutCurrency({name: 'btcMultisigSMSData', infoAboutCurrency: currencyInfo})
                reducers.user.setInfoAboutCurrency({name: 'btcMultisigUserData', infoAboutCurrency: currencyInfo})
                reducers.user.setInfoAboutCurrency({name: 'btcMultisigG2FAData', infoAboutCurrency: currencyInfo})
                break;
              }
              case 'ETH': {
                reducers.user.setInfoAboutCurrency({name: 'ethData', infoAboutCurrency: currencyInfo})
                reducers.user.setInfoAboutCurrency({name: 'ethMnemonicData', infoAboutCurrency: currencyInfo}) // Sweep (for future)
                break;
              }
              case 'LTC': {
                reducers.user.setInfoAboutCurrency({name: 'ltcData', infoAboutCurrency: currencyInfo})
                reducers.user.setInfoAboutCurrency({name: 'ltcMnemonicData', infoAboutCurrency: currencyInfo}) // Sweep (for future)
                break;
              }
              case 'BCH': {
                reducers.user.setInfoAboutCurrency({name: 'bchData', infoAboutCurrency: currencyInfo})
                reducers.user.setInfoAboutCurrency({name: 'bchMnemonicData', infoAboutCurrency: currencyInfo}) // Sweep (for future)
                break;
              }
              default: reducers.user.setInfoAboutCurrency({name: `${currencyInfoItem.symbol.toLowerCase()}Data`, infoAboutCurrency: currencyInfo})
            }
          }
        }
      })
      resolve(true);
    }).catch((error) => {
      reject(error)
    }).finally( () =>  reducers.user.setIsFetching({ isFetching: false }))
  })

const pullTransactions = transactions => {
  console.log('pullTransactions', transactions)
  let data = [].concat([], ...transactions).sort((a, b) => b.date - a.date).filter((item) => item)
  reducers.history.setTransactions(data)
}

const delay = (ms) => new Promise(resolve => setTimeout(() => resolve(true), ms))

const setTransactions = async () => {
  const isBtcSweeped = actions.btc.isSweeped()
  const isLtcSweeped = true // actions.ltc.isSweeped()
  const isEthSweeped = actions.eth.isSweeped()

  try {
    // @ToDo - make in like query
    const mainTokens = await Promise.all([
      actions.btc.getTransaction(),
      ... (isBtcSweeped) ? [] : [actions.btc.getTransaction(actions.btc.getSweepAddress())],
      actions.btc.getInvoices(),
      ... (isBtcSweeped) ? [] : [actions.btc.getInvoices(actions.btc.getSweepAddress())],
      actions.btcmultisig.getTransactionSMS(),
      actions.btcmultisig.getInvoicesSMS(),
      actions.btcmultisig.getTransactionUser(),
      actions.btcmultisig.getInvoicesUser(),
      actions.bch.getTransaction(),
      // actions.usdt.getTransaction(),
      actions.eth.getTransaction(),
      ... (isEthSweeped) ? [] : [actions.eth.getTransaction(actions.eth.getSweepAddress())],
      actions.eth.getInvoices(),
      ... (isEthSweeped) ? [] : [actions.eth.getTransaction(actions.eth.getSweepAddress())],
      actions.ltc.getTransaction(),
    ])

    await new Promise(async resolve => {
      const ercArray = await Promise.all(Object.keys(config.erc20)
        .map(async (name, index) => {
          await delay(650 * index)
          const res = await actions.token.getTransaction(null, name)
          // console.log('name - ', name, '\n', '\n', res)
          return res
        }))
      return resolve(ercArray)
    }).then((ercTokens) => {
      pullTransactions([...mainTokens, ...ercTokens])
    })
  } catch (error) {
    console.error('getTransError: ', error)
  }
}

const getText = () => {
  const { user: { ethData, btcData, /* xlmData, */bchData, ltcData } } = getState()


  let text = `
  You will need this instruction only in case of emergency (if you lost your keys) \r\n
  please do NOT waste your time and go back to swap.online\r\n
  \r\n
  \r\n
  \r\n
  \r\n
${window.location.hostname} emergency only instruction
\r\n
#ETHEREUM
\r\n
Ethereum address: ${ethData.address}  \r\n
Private key: ${ethData.privateKey}\r\n
\r\n
How to access tokens and ethers: \r\n
1. Go here https://www.myetherwallet.com/#send-transaction \r\n
2. Select 'Private key'\r\n
3. paste private key to input and click "unlock"\r\n
\r\n
# BITCOIN\r\n
\r\n
Bitcoin address: ${btcData.address}\r\n
Private key: ${btcData.privateKey}\r\n
\r\n
1. Go to blockchain.info\r\n
2. login\r\n
3. Go to settings > addresses > import\r\n
4. paste private key and click "Ok"\r\n
\r\n
* We don\`t store your private keys and will not be able to restore them!
\r\n
#LITECOIN
\r\n
Litecoin address: ${ltcData.address}  \r\n
Private key: ${ltcData.privateKey}\r\n
\r\n
1. Go to blockchain.info\r\n
2. login\r\n
3. Go to settings > addresses > import\r\n
4. paste private key and click "Ok"\r\n
\r\n
# BITCOINCASH\r\n
\r\n
Bitcoin Cash address: ${bchData.address}\r\n
Private key: ${bchData.privateKey}\r\n
\r\n
1. Go to blockchain.info\r\n
2. login\r\n
3. Go to settings > addresses > import\r\n
4. paste private key and click "Ok"\r\n
`
  /*
  # XLM\r\n
  \r\n
  XLM Private Key: ${xlmData.keypair.secret()}\r\n
  Address name: ${xlmData.address}\r\n
  \r\n
  `
  */

  return text
}

export const isOwner = (addr, currency) => {
  console.log('isOwner', addr, currency)
  if (ethToken.isEthToken({ name: currency })) {
    console.log('isToken')
    if (actions.eth.getAllMyAddresses().indexOf(addr.toLowerCase()) !== -1) return true
    const {
      user: {
        ethData: {
          address,
        },
      },
    } = getState()

    return addr === address
  }

  if (currency.toLowerCase() === `btc` && actions.btc.getAllMyAddresses().indexOf(addr.toLowerCase()) !== -1) return true
  if (currency.toLowerCase() === `eth` && actions.eth.getAllMyAddresses().indexOf(addr.toLowerCase()) !== -1) return true

  const name = `${currency.toLowerCase()}Data`
  const { user } = getState()

  if(!user[name]) {
    return false
  }

  const {address} = user[name]

  if(!address) {
    return false
  }

  return addr === address
}


const downloadPrivateKeys = () => {
  const element = document.createElement('a')
  const text = getText()
  const message = 'Check your browser downloads'

  element.setAttribute('href', `data:text/plaincharset=utf-8,${encodeURIComponent(text)}`)
  element.setAttribute('download', `${window.location.hostname}_keys_${moment().format('DD.MM.YYYY')}.txt`)

  element.style.display = 'none'
  document.body.appendChild(element)
  element.click()
  document.body.removeChild(element)

  actions.notifications.show(constants.notifications.Message, {
    message,
  })

  localStorage.setItem(constants.localStorage.privateKeysSaved, true)
}

window.downloadPrivateKeys = downloadPrivateKeys

const getAuthData = (name) => {
  const { user } = getState()
  return user[`${name}Data`]
}

export default {
  sign,
  getBalances,
  getDemoMoney,
  setTransactions,
  downloadPrivateKeys,
  getText,
  isOwner,
  getExchangeRate,
  getReputation,
  getInfoAboutCurrency,
  getAuthData,
}
