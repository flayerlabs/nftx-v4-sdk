import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const entrypoints = [
  {
    name: '@flayerlabs/nftx-v4-sdk',
    file: 'dist/index.js',
    expectedExports: [
      'SDK_NAME',
      'AccountMismatchError',
      'ChainMismatchError',
      'classifyError',
      'ContractNotDeployedError',
      'InvalidInputError',
      'isUserRejection',
      'NftxSdkError',
      'OperatorNotContractError',
      'TxRevertedError',
      'UnsupportedChainError',
      'UserRejectedError',
      'WalletError',
      'getAddressFor',
      'getContract',
      'getContracts',
      'hasContract',
      'isSupportedChain',
      'BUY_QUOTE_BUFFER_BPS',
      'DEFAULT_SLIPPAGE_BPS',
      'MAX_SAFE_SLIPPAGE_BPS',
      'NFTX_V4_DYNAMIC_FEE',
      'NFTX_V4_TICK_SPACING',
      'NATIVE_ESCROW_TOKEN',
      'ONE_VTOKEN_WEI',
      'PROTOCOL',
      'formatUnits',
      'parseUnits',
      'toBigInt',
      'assertSafeSlippageForFloor',
      'bpsToPercent',
      'maxSpendWithSlippage',
      'grossUpForSlippage',
      'nativeCurrency',
      'nativeWeiToPoolUnits',
      'poolUnitsToNativeWei',
      'ARC_CHAIN_ID',
      'minOutWithSlippage',
      'percentToBps',
      'Percent',
      'MAX_UINT256',
      'parseAddress',
      'parsePositiveAmount',
      'parseTokenId',
      'parseTokenIds',
      'isInputCurrency0',
      'nftxV4PoolKey',
      'poolKeysEqual',
      'sortCurrencies',
      'Vault',
      'floorBuyQuoteParams',
      'floorSellQuoteParams',
      'priceImpactBps',
      'tokenBuyCostQuoteParams',
      'tokenSwapInputCurrency',
      'tokenSwapQuoteParams',
      'tokenSwapExactOutQuoteParams',
      'INITIAL_PLAN_STATE',
      'approveErc20',
      'approveErc721ForAll',
      'buildBuyFromPoolPlan',
      'buildDepositForTokenPlan',
      'buildListAboveFloorPlan',
      'buildMixedBuyPlan',
      'buildSellToPoolPlan',
      'buildSwapNftsPlan',
      'buyNft',
      'buyTokens',
      'redeemFloor',
      'sellNft',
      'sellTokens',
      'tokenRequirement',
      'withdrawEscrow',
      'encodeBatchCalls',
      'encodedCallValueToBigInt',
      'executableSteps',
      'planStepToCall',
      'runBatch',
      'runStagedPlan',
      'ReadNftxSdk',
      'createNftxSdk',
      'ReadWriteNftxSdk',
      'createCallGuard',
      'nftStandard',
      'authoriseNftsSteps',
      'readPunkOffers',
      'readKittyApprovals',
      'punkListingsAtRisk',
      'routedSwapQuoteRequest',
      'prepareRoutedSwap',
      'resolveRoutedSwap',
    ],
  },
  {
    name: '@flayerlabs/nftx-v4-sdk/abi',
    file: 'dist/abi/index.js',
    expectedExports: [
      'nftxZapAbi',
      'v4QuoterAbi',
      'lockerAbi',
      'listingsAbi',
      'collectionTokenAbi',
      'flEthAbi',
      'erc721Abi',
      'nftxV4HookAbi',
      'tokenEscrowAbi',
      'cryptoPunksAbi',
      'cryptoKittiesAbi',
      'universalRouterAbi',
    ],
  },
  {
    name: '@flayerlabs/nftx-v4-sdk/addresses',
    file: 'dist/addresses/index.js',
    expectedExports: [
      'ADDRESS_TABLES',
      'getAddressFor',
      'getContract',
      'getContracts',
      'hasContract',
      'isSupportedChain',
    ],
  },
  {
    name: '@flayerlabs/nftx-v4-sdk/constants',
    file: 'dist/constants/index.js',
    expectedExports: [
      'PROTOCOL',
      'BUY_QUOTE_BUFFER_BPS',
      'DEFAULT_SLIPPAGE_BPS',
      'MAX_SAFE_SLIPPAGE_BPS',
      'NFTX_V4_DYNAMIC_FEE',
      'NFTX_V4_TICK_SPACING',
      'ONE_VTOKEN_WEI',
    ],
  },
]

const failures = []

for (const entrypoint of entrypoints) {
  const filePath = resolve(entrypoint.file)

  if (!existsSync(filePath)) {
    failures.push(`${entrypoint.name}: missing ${entrypoint.file}`)
    continue
  }

  const moduleExports = await import(pathToFileURL(filePath).href)
  const actual = Object.keys(moduleExports)
  const missing = entrypoint.expectedExports.filter((name) => !actual.includes(name))
  const unexpected = actual.filter((name) => !entrypoint.expectedExports.includes(name))

  if (missing.length > 0) {
    failures.push(`${entrypoint.name}: missing exports ${missing.join(', ')}`)
  }
  if (unexpected.length > 0) {
    failures.push(`${entrypoint.name}: unexpected exports ${unexpected.join(', ')}`)
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Package exports smoke test passed.')
