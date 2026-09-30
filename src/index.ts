// @flayerlabs/nftx-v4-sdk — public entry point.
//
// Re-exports only; no side effects (package.json sets "sideEffects": false).
// The factory and Read/ReadWrite classes are re-exported here as their units
// land; the foundation (errors, addresses, constants, math, validation) is
// available both here and via the `./abi` `./addresses` `./constants` subpaths.

export const SDK_NAME = '@flayerlabs/nftx-v4-sdk' as const

// Errors — the typed surface consumers catch.
export {
  AccountMismatchError,
  ChainMismatchError,
  classifyError,
  ContractNotDeployedError,
  InvalidInputError,
  isUserRejection,
  type NftxErrorCode,
  NftxSdkError,
  OperatorNotContractError,
  TxRevertedError,
  UnsupportedChainError,
  UserRejectedError,
  WalletError,
} from './errors'

// Address resolution (capability-aware).
export {
  type ChainContracts,
  type ChainId,
  type ContractEntry,
  type ContractKey,
  type ContractOverrides,
  type ContractStatus,
  getAddressFor,
  getContract,
  getContracts,
  hasContract,
  isSupportedChain,
} from './addresses/index'

// Constants.
export {
  BUY_QUOTE_BUFFER_BPS,
  DEFAULT_SLIPPAGE_BPS,
  MAX_SAFE_SLIPPAGE_BPS,
  NFTX_V4_DYNAMIC_FEE,
  NFTX_V4_TICK_SPACING,
  ONE_VTOKEN_WEI,
  PROTOCOL,
} from './constants/index'

// Math + value objects.
export { type BigIntish, formatUnits, parseUnits, toBigInt } from './math/amount'
export {
  assertSafeSlippageForFloor,
  bpsToPercent,
  maxSpendWithSlippage,
  grossUpForSlippage,
  minOutWithSlippage,
  percentToBps,
} from './math/slippage'
export { Percent } from './entities/percent'

// Input validation.
export {
  MAX_UINT256,
  parseAddress,
  parsePositiveAmount,
  parseTokenId,
  parseTokenIds,
  type TokenIdsOptions,
} from './lib/validate'

// Pool keys + the resolved Vault value object.
export {
  isInputCurrency0,
  nftxV4PoolKey,
  type PoolKeyParams,
  poolKeysEqual,
  sortCurrencies,
  type V4PoolKey,
} from './pool/poolKey'
export { Vault, type VaultParams } from './entities/vault'
export {
  floorBuyQuoteParams,
  floorSellQuoteParams,
  priceImpactBps,
  type QuoteExactSingleParams,
  type TokenSwapSide,
  tokenBuyCostQuoteParams,
  tokenSwapInputCurrency,
  tokenSwapQuoteParams,
  tokenSwapExactOutQuoteParams,
} from './pool/quoteParams'

// Plan types (the in-process executor/UI artifact).
export {
  type ExecutionPath,
  INITIAL_PLAN_STATE,
  type PlanState,
  type PlanStatus,
  type PlanStep,
  type PlanStepStatus,
  type PlanStepView,
} from './plan/types'

// Pure trade encoders (return PlanStep[]).
export {
  approveErc20,
  approveErc721ForAll,
  type BuyNftParams,
  buyNft,
  type BuyTokensParams,
  buyTokens,
  type Erc20ApprovalParams,
  type Erc721ApprovalParams,
  type RedeemFloorParams,
  redeemFloor,
  type SellNftParams,
  sellNft,
  type SellTokensParams,
  sellTokens,
  type TradeEncoderContext,
  NATIVE_ESCROW_TOKEN,
  type TokenEscrowSource,
  type WithdrawEscrowParams,
  withdrawEscrow,
  buildBuyFromPoolPlan,
  type BuyFromPoolPlanInput,
  buildDepositForTokenPlan,
  type DepositForTokenPlanInput,
  buildListAboveFloorPlan,
  type ListAboveFloorPlanInput,
  type ListedTarget,
  type ListingEthPayout,
  type ListingPlanItem,
  buildMixedBuyPlan,
  type MixedBuyPlanInput,
  buildSellToPoolPlan,
  type SellToPoolPlanInput,
  buildSwapNftsPlan,
  type SwapNftsPlanInput,
  type TokenRequirement,
  type TokenRequirementInput,
  tokenRequirement,
} from './encoders/index'

// Execution engine (pure, dependency-injected runners).
export {
  type BatchDeps,
  type CallsStatusResult,
  type EncodedCall,
  encodeBatchCalls,
  encodedCallValueToBigInt,
  executableSteps,
  type PlanReceipt,
  type PlanWalletSnapshot,
  planStepToCall,
  runBatch,
  runStagedPlan,
  type StagedPlanDeps,
} from './execution/index'

// Read client (resolution + reads + quoting via an injected PublicClient).
export {
  type ListingPayoutQuote,
  type ListingTaxInput,
  ReadNftxSdk,
  type ReadNftxSdkConfig,
  type ResolveVaultOptions,
} from './client/read'

// Ergonomic facade — factory + ReadWrite class + guard layer.
export { createNftxSdk, type CreateNftxSdkConfig } from './client/factory'
export {
  type BuyNftsInput,
  type BuyTokensInput,
  ReadWriteNftxSdk,
  type ReadWriteNftxSdkConfig,
  type SellNftsInput,
  type SellTokensInput,
  type WriteOptions,
  type WriteResult,
} from './client/readWrite'
export { type CallGuardConfig, createCallGuard } from './client/guards'

// NFT authorization across ERC721 and legacy collections.
export {
  nftStandard,
  authoriseNftsSteps,
  readPunkOffers,
  readKittyApprovals,
  punkListingsAtRisk,
  type NftStandard,
  type NftApproval,
  type TokenAuthorisation,
  type PunkOfferVerdict,
} from './encoders/nftApproval'

// Routed token swaps through an explicitly trusted quote/calldata provider.
export {
  routedSwapQuoteRequest,
  prepareRoutedSwap,
  resolveRoutedSwap,
  type ResolveRoutedSwapInput,
} from './swap/routedSwap'
export type {
  RoutedSwapIntent,
  RoutedSwapQuote,
  RoutedSwapApproval,
  RoutedSwapContracts,
  RoutedSwapTransaction,
  RoutedSwapQuoteRequest,
  RoutedSwapCalldataRequest,
  TrustedRoutedSwapProvider,
} from './swap/types'
export type { RoutedSwapPermitTypedData } from './swap/permit'

export {
  nativeCurrency,
  nativeWeiToPoolUnits,
  poolUnitsToNativeWei,
  ARC_CHAIN_ID,
  type NativeCurrency,
} from './math/currency'
