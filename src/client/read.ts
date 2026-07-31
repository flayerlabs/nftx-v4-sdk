import {
  BaseError,
  ContractFunctionRevertedError,
  decodeAbiParameters,
  type Address,
  type PublicClient,
  zeroAddress,
} from 'viem'

import { collectionTokenAbi } from '../abi/collectionToken'
import { erc721Abi } from '../abi/erc721'
import { listingsAbi } from '../abi/listings'
import { lockerAbi } from '../abi/locker'
import { nftxV4HookAbi } from '../abi/nftxV4Hook'
import { tokenEscrowAbi } from '../abi/tokenEscrow'
import { v4QuoterAbi } from '../abi/v4Quoter'
import { type ContractOverrides, getAddressFor } from '../addresses/resolve'
import type { ContractKey } from '../addresses/tables'
import { BUY_QUOTE_BUFFER_BPS, DEFAULT_SLIPPAGE_BPS, ONE_VTOKEN_WEI } from '../constants/pool'
import { Vault } from '../entities/vault'
import { classifyError, InvalidInputError } from '../errors'
import {
  type ListingTermsInput,
  parseListingTerms,
} from '../lib/listing'
import { parseAddress, parseAddressAllowZero } from '../lib/validate'
import type { TokenEscrowSource } from '../encoders/escrow'
import { type BigIntish, toBigInt } from '../math/amount'
import {
  assertSafeSlippageForFloor,
  maxSpendWithSlippage,
  minOutWithSlippage,
} from '../math/slippage'
import { nftxV4PoolKey, poolKeyAbiParameter, poolKeysEqual, type V4PoolKey } from '../pool/poolKey'
import {
  floorBuyQuoteParams,
  floorSellQuoteParams,
  tokenBuyCostQuoteParams,
  type QuoteExactSingleParams,
  type TokenSwapSide,
  tokenSwapQuoteParams,
} from '../pool/quoteParams'

export interface ReadNftxSdkConfig {
  chainId: number
  publicClient: PublicClient
  contracts?: ContractOverrides
}

export interface ResolveVaultOptions {
  /**
   * Cross-check the locally-derived pool key against the on-chain hook key and
   * hard-fail on mismatch. Default true — keep it on for any value-bearing path
   * (a silently-wrong key → wrong quote / empty pool → revert or mis-fill).
   */
  verifyPoolKey?: boolean
}

export type ListingTaxInput = ListingTermsInput

export interface ListingPayoutQuote {
  tax: bigint
  netTokens: bigint
  amountOut: bigint
  minOut: bigint
}

const LISTING_TAX_QUOTE_CONCURRENCY = 6

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index]!, index)
    }
  }

  const workers = Array.from({ length: Math.min(limit, values.length) }, () => worker())
  await Promise.all(workers)
  return results
}

/**
 * The read surface — resolution + reads via an injected viem `PublicClient`, no
 * wallet required. Money-path reads validate their inputs and resolve canonical
 * protocol contracts before touching RPC.
 */
export class ReadNftxSdk {
  readonly chainId: number
  protected readonly publicClient: PublicClient
  protected readonly overrides: ContractOverrides | undefined

  constructor(config: ReadNftxSdkConfig) {
    this.chainId = config.chainId
    this.publicClient = config.publicClient
    this.overrides = config.contracts
  }

  /** Resolve a contract address for the active chain (throws if absent/undeployed). */
  protected addressOf(key: ContractKey): Address {
    return getAddressFor(this.chainId, key, this.overrides)
  }

  /** The collection's ERC20 vToken (zero address when not initialized). */
  async collectionToken(collection: Address): Promise<Address> {
    return this.publicClient.readContract({
      address: this.addressOf('locker'),
      abi: lockerAbi,
      functionName: 'collectionToken',
      args: [parseAddress(collection, 'collection')],
    })
  }

  /** True when the collection has an initialized NFTX v4 vault. */
  async collectionInitialized(collection: Address): Promise<boolean> {
    const vToken = await this.collectionToken(collection)
    return vToken.toLowerCase() !== zeroAddress
  }

  /** The pool's native pair token (flETH), read from the hook. */
  async nativeToken(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.addressOf('nftxV4Hook'),
      abi: nftxV4HookAbi,
      functionName: 'nativeToken',
    })
  }

  /** Locally derive the pool key for a vToken (no RPC) — the offline fast path. */
  getPoolKey(vToken: Address): V4PoolKey {
    return nftxV4PoolKey(
      parseAddress(vToken, 'vToken'),
      this.addressOf('flEth'),
      this.addressOf('nftxV4Hook'),
    )
  }

  /** The canonical pool key from the on-chain hook (the authority for money paths). */
  async getCanonicalPoolKey(collection: Address): Promise<V4PoolKey> {
    // The hook returns `abi.encode(PoolKey)` as `bytes` (NFTXV4Hook.sol), so the
    // read yields raw bytes that we decode into the pool-key tuple.
    const encoded = await this.publicClient.readContract({
      address: this.addressOf('nftxV4Hook'),
      abi: nftxV4HookAbi,
      functionName: 'getCollectionPoolKey',
      args: [parseAddress(collection, 'collection')],
    })
    const [key] = decodeAbiParameters([poolKeyAbiParameter], encoded)
    return {
      currency0: key.currency0,
      currency1: key.currency1,
      fee: key.fee,
      tickSpacing: key.tickSpacing,
      hooks: key.hooks,
    }
  }

  /**
   * Resolve a collection to an immutable {@link Vault}: its vToken + pool key.
   * Reads the vToken, derives the key locally, and (by default) cross-checks it
   * against the on-chain hook key, hard-failing on mismatch.
   */
  async resolveVault(collection: Address, options: ResolveVaultOptions = {}): Promise<Vault> {
    const { verifyPoolKey = true } = options
    const c = parseAddress(collection, 'collection')
    const vToken = await this.collectionToken(c)
    if (vToken.toLowerCase() === zeroAddress) {
      throw new InvalidInputError(`Collection ${c} is not an initialized NFTX v4 vault.`)
    }
    const localKey = nftxV4PoolKey(vToken, this.addressOf('flEth'), this.addressOf('nftxV4Hook'))
    if (verifyPoolKey) {
      const canonical = await this.getCanonicalPoolKey(c)
      if (!poolKeysEqual(localKey, canonical)) {
        throw new InvalidInputError(
          `Derived pool key for ${c} does not match the on-chain hook key — refusing a value-bearing path.`,
        )
      }
    }
    return Vault.create({
      chainId: this.chainId,
      collection: c,
      collectionToken: vToken,
      poolKey: localKey,
    })
  }

  /** ERC721 operator approval (lets the plan builder skip a redundant approval). */
  async isApprovedForAll(collection: Address, owner: Address, operator: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: parseAddress(collection, 'collection'),
      abi: erc721Abi,
      functionName: 'isApprovedForAll',
      args: [parseAddress(owner, 'owner'), parseAddress(operator, 'operator')],
    })
  }

  /** ERC20 allowance of `owner` to `spender` for `token`. */
  async allowance(token: Address, owner: Address, spender: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: parseAddress(token, 'token'),
      abi: collectionTokenAbi,
      functionName: 'allowance',
      args: [parseAddress(owner, 'owner'), parseAddress(spender, 'spender')],
    })
  }

  /** ERC20 balance of `account` for `token`. */
  async balanceOf(token: Address, account: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: parseAddress(token, 'token'),
      abi: collectionTokenAbi,
      functionName: 'balanceOf',
      args: [parseAddress(account, 'account')],
    })
  }

  /** Authoritative balance in the Listings or NFTXV4Hook escrow ledger. */
  async escrowBalance(
    source: TokenEscrowSource,
    account: Address,
    token: Address,
  ): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addressOf(source),
      abi: tokenEscrowAbi,
      functionName: 'balances',
      args: [
        parseAddress(account, 'account'),
        parseAddressAllowZero(token, 'token'),
      ],
    })
  }

  // ── Quoting (Uniswap v4 Quoter via eth_call simulation) ───────────────────

  /** Reuse a caller-supplied vault when it matches; otherwise resolve fresh. */
  private async vaultFor(collection: Address, vault?: Vault): Promise<Vault> {
    if (
      vault &&
      vault.chainId === this.chainId &&
      vault.collection.toLowerCase() === collection.toLowerCase()
    ) {
      return vault
    }
    return this.resolveVault(collection)
  }

  /**
   * Read a Quoter exact-single result. The Quoter is `nonpayable` on-chain, so we
   * `simulateContract` (an `eth_call` that discards the state change and returns
   * the decoded tuple). A revert (uninitialized / illiquid pool) becomes a typed
   * `InvalidInputError`, never an unhandled throw.
   */
  private async simulateQuote(
    functionName: 'quoteExactOutputSingle' | 'quoteExactInputSingle',
    params: QuoteExactSingleParams,
  ): Promise<bigint> {
    const quoter = this.addressOf('quoter')
    try {
      const { result } = await this.publicClient.simulateContract({
        address: quoter,
        abi: v4QuoterAbi,
        functionName,
        args: [params],
      })
      return result[0]
    } catch (cause) {
      if (!(cause instanceof BaseError)) throw classifyError(cause)
      const reverted = cause.walk((error) => error instanceof ContractFunctionRevertedError)
      if (!reverted) throw classifyError(cause)
      throw new InvalidInputError(
        'No quote available — the pool may be uninitialized or illiquid.',
        { cause },
      )
    }
  }

  /** Exact-output cost (flETH `amountIn`) to buy `count` whole floor NFTs from the pool. */
  async quoteFloorBuy(
    collection: Address,
    count: BigIntish,
    opts?: { vault?: Vault },
  ): Promise<bigint> {
    const c = parseAddress(collection, 'collection')
    const n = toBigInt(count, 'count')
    if (n <= 0n) throw new InvalidInputError('count must be greater than zero.')
    const vault = await this.vaultFor(c, opts?.vault)
    return this.simulateQuote(
      'quoteExactOutputSingle',
      floorBuyQuoteParams(vault.poolKey, vault.collectionToken, n),
    )
  }

  /** Floor-buy cost plus a `maxSpend` cap (buffer headroom; the zap refunds overage). */
  async quoteFloorBuyWithSlippage(
    collection: Address,
    count: BigIntish,
    opts?: { bufferBps?: number; vault?: Vault },
  ): Promise<{ amountIn: bigint; maxSpend: bigint }> {
    const amountIn = await this.quoteFloorBuy(collection, count, opts)
    return {
      amountIn,
      maxSpend: maxSpendWithSlippage(amountIn, opts?.bufferBps ?? BUY_QUOTE_BUFFER_BPS),
    }
  }

  /** Exact-output flETH cost to buy an arbitrary collection-token amount. */
  async quoteTokenBuyCost(
    collection: Address,
    tokensOutWei: BigIntish,
    opts?: { vault?: Vault },
  ): Promise<bigint> {
    const c = parseAddress(collection, 'collection')
    const amount = toBigInt(tokensOutWei, 'tokensOutWei')
    const vault = await this.vaultFor(c, opts?.vault)
    return this.simulateQuote(
      'quoteExactOutputSingle',
      tokenBuyCostQuoteParams(vault.poolKey, vault.collectionToken, amount),
    )
  }

  /** Arbitrary exact-output token cost plus a slippage-safe max-spend cap. */
  async quoteTokenBuyCostWithSlippage(
    collection: Address,
    tokensOutWei: BigIntish,
    opts?: { bufferBps?: number; vault?: Vault },
  ): Promise<{ amountIn: bigint; maxSpend: bigint }> {
    const amountIn = await this.quoteTokenBuyCost(collection, tokensOutWei, opts)
    return {
      amountIn,
      maxSpend: maxSpendWithSlippage(amountIn, opts?.bufferBps ?? BUY_QUOTE_BUFFER_BPS),
    }
  }

  /** Exact-input flETH payout (`amountOut`) for selling `count` whole NFTs to the pool. */
  async quoteSellNfts(
    collection: Address,
    count: BigIntish,
    opts?: { vault?: Vault },
  ): Promise<bigint> {
    const c = parseAddress(collection, 'collection')
    const n = toBigInt(count, 'count')
    if (n <= 0n) throw new InvalidInputError('count must be greater than zero.')
    const vault = await this.vaultFor(c, opts?.vault)
    return this.simulateQuote(
      'quoteExactInputSingle',
      floorSellQuoteParams(
        vault.poolKey,
        vault.collectionToken,
        this.addressOf('flEth'),
        n,
      ),
    )
  }

  /** NFT-sell payout plus a slippage-floored `minOut`. */
  async quoteSellNftsWithSlippage(
    collection: Address,
    count: BigIntish,
    opts?: { slippageBps?: number; allowUnsafe?: boolean; vault?: Vault },
  ): Promise<{ amountOut: bigint; minOut: bigint }> {
    const slippageBps = opts?.slippageBps ?? DEFAULT_SLIPPAGE_BPS
    assertSafeSlippageForFloor(slippageBps, opts?.allowUnsafe ?? false)
    const amountOut = await this.quoteSellNfts(collection, count, opts)
    return { amountOut, minOut: minOutWithSlippage(amountOut, slippageBps) }
  }

  /** Exact-input swap output for a token buy (flETH→vToken) or sell (vToken→flETH). */
  async quoteTokenSwap(
    side: TokenSwapSide,
    collection: Address,
    amountIn: BigIntish,
    opts?: { vault?: Vault },
  ): Promise<bigint> {
    const c = parseAddress(collection, 'collection')
    const amount = toBigInt(amountIn, 'amountIn')
    if (amount <= 0n) throw new InvalidInputError('amountIn must be greater than zero.')
    const vault = await this.vaultFor(c, opts?.vault)
    return this.simulateQuote(
      'quoteExactInputSingle',
      tokenSwapQuoteParams(
        side,
        vault.poolKey,
        vault.collectionToken,
        this.addressOf('flEth'),
        amount,
      ),
    )
  }

  /** Token-swap output plus a slippage-floored `minOut`. */
  async quoteTokenSwapWithSlippage(
    side: TokenSwapSide,
    collection: Address,
    amountIn: BigIntish,
    opts?: { slippageBps?: number; allowUnsafe?: boolean; vault?: Vault },
  ): Promise<{ amountOut: bigint; minOut: bigint }> {
    const slippageBps = opts?.slippageBps ?? DEFAULT_SLIPPAGE_BPS
    assertSafeSlippageForFloor(slippageBps, opts?.allowUnsafe ?? false)
    const amountOut = await this.quoteTokenSwap(side, collection, amountIn, opts)
    return { amountOut, minOut: minOutWithSlippage(amountOut, slippageBps) }
  }

  /** Prepaid collection-token tax for one prospective above-floor listing. */
  async quoteListingTax(collection: Address, input: ListingTaxInput): Promise<bigint> {
    const c = parseAddress(collection, 'collection')
    const listing = parseListingTerms(input)
    try {
      const { result } = await this.publicClient.simulateContract({
        address: this.addressOf('listings'),
        abi: listingsAbi,
        functionName: 'getListingTaxRequired',
        args: [listing, c],
      })
      return result
    } catch (cause) {
      throw classifyError(cause)
    }
  }

  /**
   * Quote what a set of new listings releases immediately: on-chain tax,
   * net collection tokens, pool ETH output, and the slippage-floored payout.
   */
  async quoteListingPayout(
    collection: Address,
    inputs: readonly ListingTaxInput[],
    opts?: {
      slippageBps?: number
      allowUnsafe?: boolean
      vault?: Vault
    },
  ): Promise<ListingPayoutQuote> {
    if (inputs.length === 0) throw new InvalidInputError('Nothing selected to list.')
    const groups = new Map<string, { input: ListingTaxInput; count: number }>()
    for (const raw of inputs) {
      const input = parseListingTerms(raw)
      const key = [
        input.owner.toLowerCase(),
        input.created,
        input.duration,
        input.floorMultiple,
      ].join(':')
      const group = groups.get(key)
      if (group) group.count += 1
      else groups.set(key, { input, count: 1 })
    }
    const taxes = await mapWithConcurrency(
      [...groups.values()],
      LISTING_TAX_QUOTE_CONCURRENCY,
      async ({ input, count }) => {
        const tax = await this.quoteListingTax(collection, input)
        return tax * BigInt(count)
      },
    )
    const tax = taxes.reduce((total, value) => total + value, 0n)
    const netTokens = BigInt(inputs.length) * ONE_VTOKEN_WEI - tax
    if (netTokens <= 0n) {
      throw new InvalidInputError('Listing tax leaves no collection-token payout.')
    }
    const vault = await this.vaultFor(parseAddress(collection, 'collection'), opts?.vault)
    const amountOut = await this.quoteTokenSwap('sell', collection, netTokens, { vault })
    const slippageBps = opts?.slippageBps ?? DEFAULT_SLIPPAGE_BPS
    assertSafeSlippageForFloor(slippageBps, opts?.allowUnsafe ?? false)
    return {
      tax,
      netTokens,
      amountOut,
      minOut: minOutWithSlippage(amountOut, slippageBps),
    }
  }
}
