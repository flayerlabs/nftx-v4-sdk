import {
  buildListAboveFloorPlan,
  buildMixedBuyPlan,
  encodedCallValueToBigInt,
  type EncodedCall,
  type ListingPayoutQuote,
  type ListingTaxInput,
  type PlanState,
  type PlanStep,
  tokenBuyCostQuoteParams,
  withdrawEscrow,
} from '@flayerlabs/nftx-v4-sdk'
import { tokenEscrowAbi } from '@flayerlabs/nftx-v4-sdk/abi'
import { getAddressFor } from '@flayerlabs/nftx-v4-sdk/addresses'
import { ONE_VTOKEN_WEI } from '@flayerlabs/nftx-v4-sdk/constants'
import type { Address } from 'viem'

declare const address: Address
declare const call: EncodedCall

const context = { chainId: 1 }
const listing: ListingTaxInput = {
  owner: address,
  created: 1,
  duration: 604_800,
  floorMultiple: 150,
}
const quote: ListingPayoutQuote = {
  tax: 1n,
  netTokens: ONE_VTOKEN_WEI - 1n,
  amountOut: 1n,
  minOut: 1n,
}
const plans: PlanStep[][] = [
  buildListAboveFloorPlan(context, {
    account: address,
    owner: address,
    collection: address,
    items: [{ tokenId: 1n, floorMultiple: listing.floorMultiple }],
    duration: listing.duration,
    created: listing.created,
    isApprovedForAll: false,
  }),
  buildMixedBuyPlan(context, {
    account: address,
    collection: address,
    tokenIds: [1n],
    depositTokenIds: [],
    collectionToken: address,
    recipient: address,
    isApprovedForAll: false,
    tokenContributionWei: 0n,
    quotedEthCostWei: 1n,
    slippageBps: 0,
  }),
  [
    withdrawEscrow(context, {
      source: 'listings',
      recipient: address,
      token: address,
      amount: 1n,
    }),
  ],
]

const callsId: PlanState['callsId'] = '0xcalls'
const value: bigint = encodedCallValueToBigInt(call)

void [
  callsId,
  getAddressFor(1, 'nftxZap'),
  plans,
  quote,
  tokenBuyCostQuoteParams,
  tokenEscrowAbi,
  value,
]
