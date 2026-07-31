/**
 * Uniswap-v4 pool constants for NFTX collection pools, plus trade defaults.
 *
 * Every NFTX v4 collection pool is created by the same hook with identical
 * params, so only the vToken (currency) is per-collection. These values are
 * documented as PER-DEPLOYMENT (not assumed identical across every future
 * chain): for any value-bearing path the canonical pool key is read on-chain via
 * `NFTXV4Hook.getCollectionPoolKey` and local derivation is only a cross-checked
 * fast path (see B1).
 */

/** v4 `LPFeeLibrary.DYNAMIC_FEE_FLAG` — NFTX v4 pools price via their hook. */
export const NFTX_V4_DYNAMIC_FEE = 0x800000

/** Tick spacing shared by every NFTX v4 collection pool (per current deployments). */
export const NFTX_V4_TICK_SPACING = 60

/** 1 NFT ↔ 1e18 collection tokens (the vToken is an 18-decimal ERC20). */
export const ONE_VTOKEN_WEI = 10n ** 18n

/** Default slippage tolerance in basis points (0.50%). */
export const DEFAULT_SLIPPAGE_BPS = 50

/**
 * Headroom (basis points) added to a *quoted* pool-buy cap. A pool redeem buys a
 * whole vToken from the v4 pool, so its real cost is the Quoter's exact-output
 * amount — which drifts block-to-block between the quote and execution. This
 * buffer absorbs that drift; the NFTXZap refunds unused ETH, so over-capping
 * never overpays.
 */
export const BUY_QUOTE_BUFFER_BPS = 300

/**
 * Maximum slippage (bps) the SDK accepts without an explicit unsafe opt-in. A
 * looser bound is the MEV exposure ceiling (the Zap entrypoints have no
 * deadline), so the guard layer rejects more than this unless overridden.
 */
export const MAX_SAFE_SLIPPAGE_BPS = 5_000
