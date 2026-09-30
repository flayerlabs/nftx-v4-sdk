import { isSupportedChain } from '../addresses/resolve'
import { InvalidInputError, UnsupportedChainError } from '../errors'

export const ARC_CHAIN_ID = 5042

export interface NativeCurrency {
  readonly symbol: 'ETH' | 'USDC'
  /** Wallet balances and zap parameters always use 18 decimals. */
  readonly nativeDecimals: 18
  /** Quoter amounts and reserves use the pool currency's decimals. */
  readonly poolDecimals: 18 | 6
  readonly poolScale: bigint
  readonly wrapped: boolean
}

const ETH: NativeCurrency = Object.freeze({
  symbol: 'ETH',
  nativeDecimals: 18,
  poolDecimals: 18,
  poolScale: 1n,
  wrapped: true,
})

const ARC_USDC: NativeCurrency = Object.freeze({
  symbol: 'USDC',
  nativeDecimals: 18,
  poolDecimals: 6,
  poolScale: 10n ** 12n,
  wrapped: false,
})

/** Arc's native and ERC20 USDC interfaces share one balance. */
export function nativeCurrency(chainId: number): NativeCurrency {
  if (!isSupportedChain(chainId)) throw new UnsupportedChainError(chainId)
  return chainId === ARC_CHAIN_ID ? ARC_USDC : ETH
}

function assertAmount(amount: bigint): void {
  if (typeof amount !== 'bigint' || amount < 0n) {
    throw new InvalidInputError('Currency amount must be a non-negative bigint.')
  }
}

/** Convert the pool currency leg of a quote or reserve to native wei. */
export function poolUnitsToNativeWei(chainId: number, poolUnits: bigint): bigint {
  const { poolScale } = nativeCurrency(chainId)
  assertAmount(poolUnits)
  return poolUnits * poolScale
}

/** Convert native wei for a Quoter input, rounding down to whole pool units. */
export function nativeWeiToPoolUnits(chainId: number, nativeWei: bigint): bigint {
  const { poolScale } = nativeCurrency(chainId)
  assertAmount(nativeWei)
  return nativeWei / poolScale
}
