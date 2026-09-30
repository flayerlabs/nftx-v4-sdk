import {
  buildListAboveFloorPlan,
  buildMixedBuyPlan,
  encodedCallValueToBigInt,
  type EncodedCall,
  type ListingPayoutQuote,
  type ListingTaxInput,
  type PlanState,
  type PlanStep,
  prepareRoutedSwap,
  resolveRoutedSwap,
  routedSwapQuoteRequest,
  type RoutedSwapCalldataRequest,
  type RoutedSwapIntent,
  type TrustedRoutedSwapProvider,
  tokenBuyCostQuoteParams,
  withdrawEscrow,
} from '@flayerlabs/nftx-v4-sdk'
import { tokenEscrowAbi } from '@flayerlabs/nftx-v4-sdk/abi'
import { getAddressFor } from '@flayerlabs/nftx-v4-sdk/addresses'
import { ONE_VTOKEN_WEI } from '@flayerlabs/nftx-v4-sdk/constants'
import type { Address } from 'viem'

declare const address: Address
declare const call: EncodedCall
declare const provider: TrustedRoutedSwapProvider

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

async function routedSwapTypes() {
  const intent: RoutedSwapIntent = {
    chainId: 1,
    account: address,
    tokenIn: address,
    tokenOut: address,
    amountIn: 1n,
    slippageBps: 100,
    permitAmount: 'FULL',
  }
  const contracts = {
    permit2: getAddressFor(1, 'permit2'),
    universalRouter: getAddressFor(1, 'universalRouter'),
  }
  const request = routedSwapQuoteRequest(intent)
  const quote = await provider.requestQuote(request, intent.chainId)
  const prepared = prepareRoutedSwap(intent, quote, null, contracts)
  const simulateTransaction: RoutedSwapCalldataRequest['simulateTransaction'] = false
  const step: PlanStep = await resolveRoutedSwap({
    intent,
    quote,
    contracts,
    provider,
    approvalsPending: prepared.approvalSteps.length > 0,
  })
  return { step, simulateTransaction }
}

void [
  callsId,
  getAddressFor(1, 'nftxZap'),
  plans,
  quote,
  routedSwapTypes,
  tokenBuyCostQuoteParams,
  tokenEscrowAbi,
  value,
]
