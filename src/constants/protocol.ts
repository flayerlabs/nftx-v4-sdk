/**
 * Protocol constants (typed defaults). Most of these are also on-chain config
 * (`Listings.listingConfig`, `TaxCalculator`) the SDK can read at runtime; these
 * literals are the documented defaults for offline validation.
 *
 * RE-VERIFY against deployed contracts / protocol docs before a consuming feature
 * ships. The vault-initialization minimum used to live here as
 * `MINIMUM_TOKEN_IDS = 10`; the live mainnet Locker no longer exposes that
 * constant and defers the threshold to its launch gate (`minimumTokenIds()`,
 * currently `0`), so a literal cannot represent it — read it on-chain instead.
 */
export const PROTOCOL = {
  /** Listing duration bounds (seconds). */
  MIN_LIQUID_DURATION_SECONDS: 604_800, // 7d
  MAX_LIQUID_DURATION_SECONDS: 15_552_000, // 180d
  MIN_DUTCH_DURATION_SECONDS: 86_400, // 1d
  MAX_DUTCH_DURATION_SECONDS: 604_799, // 6.99d
  /** Dutch decay window appended after a liquid listing expires. */
  LIQUID_DUTCH_DURATION_SECONDS: 345_600, // 4d

  /** Floor multiples in hundredths: 100 = 1.00x. */
  MIN_FLOOR_MULTIPLE: 100,
  MAX_FLOOR_MULTIPLE: 1_000,
  /** Harberger tax softening kink (2.00x). */
  FLOOR_MULTIPLE_KINK: 200,

  KEEPER_REWARD_WEI: 50_000_000_000_000_000n, // 0.05 ETH
  MAX_PROTECTED_TOKEN_AMOUNT_WEI: 950_000_000_000_000_000n, // 0.95 ETH
  UTILIZATION_KINK_WEI: 800_000_000_000_000_000n, // 0.8 ETH
  MAX_SHUTDOWN_TOKENS_WEI: 4_000_000_000_000_000_000n, // 4 ETH
  SHUTDOWN_QUORUM_PERCENT: 50,
} as const
