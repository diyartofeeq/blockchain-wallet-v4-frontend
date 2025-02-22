import { ethers, Signer } from 'ethers'

import { NftAsset, NftOrdersType, SellOrder } from '@core/network/api/nfts/types'

import { wyvernExchange_ABI } from './abis'
import {
  _atomicMatch,
  _authorizeOrder,
  _buyOrderValidationAndApprovals,
  _cancelOrder,
  _makeMatchingOrder,
  _makeSellOrder,
  _sellOrderValidationAndApprovals,
  _signMessage,
  _validateOrderWyvern,
  assignOrdersToSides,
  getOrderHash
} from './utils'

export const cancelNftListing = async (sellOrder: SellOrder, signer: Signer) => {
  const cancelled = await _cancelOrder({ sellOrder, signer })
  return cancelled
}

export const fulfillNftSellOrder = async (
  asset: NftAsset,
  signer: Signer,
  provider: ethers.providers.Provider
) => {
  // 1. use the _makeSellOrder to create the object & initialize the proxy contract for this sale.
  const accountAddress = await signer.getAddress()
  const order = await _makeSellOrder({
    accountAddress,
    asset,
    buyerAddress: '0x0000000000000000000000000000000000000000',
    expirationTime: 0,
    extraBountyBasisPoints: 0,
    paymentTokenAddress: '0x0000000000000000000000000000000000000000',
    quantity: 1,
    startAmount: 0.1,
    waitForHighestBid: false
  })
  // 2. Validation of sell order fields & Transaction Approvals (Proxy initialized here if needed also)
  const validatedAndApproved = await _sellOrderValidationAndApprovals({ order, signer })
  console.log(`Successful approvals and validations?: ${validatedAndApproved}`)
  // 3. Compute hash of the order and output {...order, hash:hash(order)}
  const hashedOrder = {
    ...order,
    hash: getOrderHash(order)
  }
  // 4. Obtain a signature from the signer (using the mnemonic & Ethers JS) over the hash and message.
  let signature
  try {
    signature = await _authorizeOrder(hashedOrder, signer, provider)
  } catch (error) {
    console.error(error)
    throw new Error('You declined to authorize your auction')
  }

  const orderWithSignature = {
    ...hashedOrder,
    ...signature
  }
  console.log('next up, try to post this to the OpenSea API:')
  console.log(orderWithSignature)
  // 5. Send to the OpenSea post order route.
  return orderWithSignature
}

export const fulfillNftOrder = async (order: NftOrdersType['orders'][0], signer: Signer) => {
  const contract = new ethers.Contract(
    '0x7be8076f4ea4a4ad08075c2508e481d6c946d12b',
    wyvernExchange_ABI,
    signer
  )
  const accountAddress = await signer.getAddress()
  // TODO: If its an english auction bid above the basePrice include an offer property in the _makeMatchingOrder call
  const matchingOrder = _makeMatchingOrder({
    accountAddress,
    order,
    recipientAddress: accountAddress
  })
  let { buy, sell } = assignOrdersToSides(order, matchingOrder)
  const signature = await _signMessage({ message: buy.hash, signer })
  buy = {
    ...buy,
    ...signature
  }
  console.log(buy)
  // Perform buy order validations (abstracted away from _atomicMatch because english auction bids don't hit that function)
  // await _buyOrderValidationAndApprovals({ order: buy, signer })
  // Is an english auction sale
  if (order.waitingForBestCounterOrder) {
    await _buyOrderValidationAndApprovals({ order: buy, signer })
    console.log('Post buy order to OpenSea API because its an english auction')
    console.log(buy)
    // return buy
  }
  // Is a dutch auction TODO: Find out why validations fail for buy order validations
  else if (order.saleKind === 1) {
    throw new Error('Dutch auctions not currently supported')
    // await _atomicMatch({ buy, sell, signer })
  }
  // Is a fixed price sale
  else {
    const isSellValid = await _validateOrderWyvern({ order: sell, signer })
    if (!isSellValid) throw new Error('Sell order is invalid')
    const isBuyValid = await _validateOrderWyvern({ order: buy, signer })
    if (!isBuyValid) throw new Error('Buy order is invalid')
    const matchPrice = await contract.calculateMatchPrice_(
      [
        buy.exchange,
        buy.maker,
        buy.taker,
        buy.feeRecipient,
        buy.target,
        buy.staticTarget,
        buy.paymentToken,
        sell.exchange,
        sell.maker,
        sell.taker,
        sell.feeRecipient,
        sell.target,
        sell.staticTarget,
        sell.paymentToken
      ],
      [
        buy.makerRelayerFee.toString(),
        buy.takerRelayerFee.toString(),
        buy.makerProtocolFee.toString(),
        buy.takerProtocolFee.toString(),
        buy.basePrice.toString(),
        buy.extra.toString(),
        buy.listingTime.toString(),
        buy.expirationTime.toString(),
        // TODO FIXME: this is a hack
        buy.salt.toString(),
        sell.makerRelayerFee.toString(),
        sell.takerRelayerFee.toString(),
        sell.makerProtocolFee.toString(),
        sell.takerProtocolFee.toString(),
        sell.basePrice.toString(),
        sell.extra.toString(),
        sell.listingTime.toString(),
        sell.expirationTime.toString(),
        sell.salt.toString()
      ],
      [
        buy.feeMethod,
        buy.side,
        buy.saleKind,
        buy.howToCall,
        sell.feeMethod,
        sell.side,
        sell.saleKind,
        sell.howToCall
      ],
      buy.calldata,
      sell.calldata,
      buy.replacementPattern,
      sell.replacementPattern,
      buy.staticExtradata,
      sell.staticExtradata
    )
    await _atomicMatch({ buy, sell, signer })
  }
}

// https://codesandbox.io/s/beautiful-euclid-nd7s8?file=/src/index.ts
// metamask https://etherscan.io/tx/0xb52c163434d85e79a63e34cadbfb980d928e4e70129284ae084d9ad992ba9778
// bc.com https://etherscan.io/tx/0xdb0620e6e1b186f4f84e4740b2453506b61416d79fd7de01a6e7ed2f9e5e3623
