import { type Address, getAddress, type Hex, type WalletClient } from 'viem'

import { type ContractOverrides, getAddressFor } from '../addresses/resolve'
import { InvalidInputError, WalletError } from '../errors'
import {
  buyNft,
  buyTokens as encodeBuyTokens,
  redeemFloor,
  sellNft,
  sellTokens as encodeSellTokens,
  type TradeEncoderContext,
} from '../encoders/zap'
import { MAX_SAFE_SLIPPAGE_BPS, BUY_QUOTE_BUFFER_BPS } from '../constants/pool'
import {
  type BatchDeps,
  type CallsStatusResult,
  type EncodedCall,
  encodeBatchCalls,
  encodedCallValueToBigInt,
  executableSteps,
  type PlanReceipt,
  type PlanWalletSnapshot,
  runBatch,
  runStagedPlan,
  type StagedPlanDeps,
} from '../execution/index'
import { type BigIntish, toBigInt } from '../math/amount'
import { maxSpendWithSlippage, minOutWithSlippage } from '../math/slippage'
import type { PlanState, PlanStep } from '../plan/types'
import { parseAddress, parsePositiveAmount } from '../lib/validate'
import { createCallGuard } from './guards'
import { ReadNftxSdk, type ReadNftxSdkConfig } from './read'

export interface ReadWriteNftxSdkConfig extends ReadNftxSdkConfig {
  walletClient: WalletClient
}

export interface WriteOptions {
  /** `submit` executes (default); `calldata` returns the encoded calls, unsent. */
  mode?: 'submit' | 'calldata'
  /** Refuse to run unless the wallet supports an ERC-5792 atomic batch. */
  requireAtomic?: boolean
}

/** The result of a write: either a terminal plan state, or the encoded calls. */
export type WriteResult =
  | { mode: 'submit'; state: PlanState }
  | { mode: 'calldata'; chainId: number; account: Address; calls: EncodedCall[] }

export interface BuyNftsInput {
  collection: Address
  tokenIds: readonly BigIntish[]
  /**
   * Floor-buy cap, or exact listed-buy ETH input. A listed buy returns unused
   * purchasing power as collection tokens, not ETH.
   */
  maxSpend?: BigIntish
  bufferBps?: number
  /** Allow a caller-supplied floor-buy cap above the SDK safe bound. */
  allowUnsafe?: boolean
  /** Above-floor listed buy (requires a caller-priced exact ETH input). */
  listed?: boolean
  minTokensReceived?: BigIntish
}

export interface SellNftsInput {
  collection: Address
  tokenIds: readonly BigIntish[]
  minOut?: BigIntish
  slippageBps?: number
  allowUnsafe?: boolean
}

export interface BuyTokensInput {
  collection: Address
  amountInWei: BigIntish
  minOut?: BigIntish
  slippageBps?: number
  allowUnsafe?: boolean
}

export interface SellTokensInput {
  collection: Address
  amountInWei: BigIntish
  minOut?: BigIntish
  slippageBps?: number
  allowUnsafe?: boolean
  maxApproval?: boolean
}

/**
 * The batteries-included write surface. Quote-then-execute: a write re-quotes via
 * the Read layer only if the caller didn't supply a min/max, builds the plan via
 * the pure encoders, runs the GUARD LAYER, then executes (probe-then-choose
 * atomic vs sequential) or returns guarded calldata. Error contract: input
 * validation, reads, quotes, and calldata guards THROW typed errors before any
 * submit; submit-mode execution failures are folded into the terminal `PlanState`.
 */
export class ReadWriteNftxSdk extends ReadNftxSdk {
  protected readonly walletClient: WalletClient
  protected readonly account: Address

  constructor(config: ReadWriteNftxSdkConfig) {
    super(config)
    const account = config.walletClient.account?.address
    if (!account) throw new WalletError('walletClient has no account.')
    this.walletClient = config.walletClient
    this.account = getAddress(account)
  }

  private encoderCtx(): TradeEncoderContext {
    return { chainId: this.chainId, ...(this.overrides ? { contracts: this.overrides } : {}) }
  }

  private zapAddress(): Address {
    return getAddressFor(this.chainId, 'nftxZap', this.overrides)
  }

  private assertMaxSpendWithinSafeBound(
    quotedAmountIn: bigint,
    maxSpend: bigint,
    allowUnsafe: boolean,
  ): void {
    if (allowUnsafe) return
    const safeCap = maxSpendWithSlippage(quotedAmountIn, MAX_SAFE_SLIPPAGE_BPS)
    if (maxSpend > safeCap) {
      throw new InvalidInputError(
        `maxSpend exceeds the safe ${MAX_SAFE_SLIPPAGE_BPS} bps bound for the current quote; pass allowUnsafe to override.`,
      )
    }
  }

  private assertMinOutWithinSafeBound(
    quotedAmountOut: bigint,
    minOut: bigint,
    allowUnsafe: boolean,
  ): void {
    if (allowUnsafe) return
    const safeFloor = minOutWithSlippage(quotedAmountOut, MAX_SAFE_SLIPPAGE_BPS)
    if (minOut < safeFloor) {
      throw new InvalidInputError(
        `minOut is below the safe ${MAX_SAFE_SLIPPAGE_BPS} bps bound for the current quote; pass allowUnsafe to override.`,
      )
    }
  }

  // ── Write methods ─────────────────────────────────────────────────────────

  async buyNfts(input: BuyNftsInput, opts?: WriteOptions): Promise<WriteResult> {
    const collection = parseAddress(input.collection, 'collection')
    const ctx = this.encoderCtx()
    let steps: PlanStep[]
    if (input.listed) {
      if (input.maxSpend == null) {
        throw new InvalidInputError(
          'Listed buys require an explicit maxSpend derived from their listing terms.',
        )
      }
      steps = [
        buyNft(ctx, {
          collection,
          tokenIds: input.tokenIds,
          maxSpend: input.maxSpend,
          ...(input.minTokensReceived != null
            ? { minTokensReceived: input.minTokensReceived }
            : {}),
        }),
      ]
    } else {
      let maxSpend: bigint
      if (input.maxSpend != null) {
        maxSpend = parsePositiveAmount(input.maxSpend, 'maxSpend')
        const amountIn = await this.quoteFloorBuy(collection, input.tokenIds.length)
        this.assertMaxSpendWithinSafeBound(amountIn, maxSpend, input.allowUnsafe ?? false)
      } else {
        const bufferBps = input.bufferBps ?? BUY_QUOTE_BUFFER_BPS
        if (!input.allowUnsafe && bufferBps > MAX_SAFE_SLIPPAGE_BPS) {
          throw new InvalidInputError(
            `bufferBps exceeds the safe maximum of ${MAX_SAFE_SLIPPAGE_BPS} bps; pass allowUnsafe to override.`,
          )
        }
        const amountIn = await this.quoteFloorBuy(collection, input.tokenIds.length)
        maxSpend = maxSpendWithSlippage(amountIn, bufferBps)
      }
      steps = [redeemFloor(ctx, { collection, tokenIds: input.tokenIds, maxSpend })]
    }
    return this.executeOrEncode(steps, opts)
  }

  async sellNfts(input: SellNftsInput, opts?: WriteOptions): Promise<WriteResult> {
    const collection = parseAddress(input.collection, 'collection')
    const zap = this.zapAddress()
    const minOut =
      input.minOut != null
        ? parsePositiveAmount(input.minOut, 'minOut')
        : (
            await this.quoteSellNftsWithSlippage(collection, input.tokenIds.length, {
              ...(input.slippageBps != null ? { slippageBps: input.slippageBps } : {}),
              ...(input.allowUnsafe != null ? { allowUnsafe: input.allowUnsafe } : {}),
            })
          ).minOut
    if (input.minOut != null) {
      const amountOut = await this.quoteSellNfts(collection, input.tokenIds.length)
      this.assertMinOutWithinSafeBound(amountOut, minOut, input.allowUnsafe ?? false)
    }
    const isApprovedForAll = await this.isApprovedForAll(collection, this.account, zap)
    const steps = sellNft(this.encoderCtx(), {
      collection,
      tokenIds: input.tokenIds,
      minOut,
      isApprovedForAll,
    })
    return this.executeOrEncode(steps, opts)
  }

  async buyTokens(input: BuyTokensInput, opts?: WriteOptions): Promise<WriteResult> {
    const collection = parseAddress(input.collection, 'collection')
    const amountInWei = toBigInt(input.amountInWei, 'amountInWei')
    const minOut =
      input.minOut != null
        ? parsePositiveAmount(input.minOut, 'minOut')
        : (
            await this.quoteTokenSwapWithSlippage('buy', collection, amountInWei, {
              ...(input.slippageBps != null ? { slippageBps: input.slippageBps } : {}),
              ...(input.allowUnsafe != null ? { allowUnsafe: input.allowUnsafe } : {}),
            })
          ).minOut
    if (input.minOut != null) {
      const amountOut = await this.quoteTokenSwap('buy', collection, amountInWei)
      this.assertMinOutWithinSafeBound(amountOut, minOut, input.allowUnsafe ?? false)
    }
    const steps = [encodeBuyTokens(this.encoderCtx(), { collection, amountInWei, minOut })]
    return this.executeOrEncode(steps, opts)
  }

  async sellTokens(input: SellTokensInput, opts?: WriteOptions): Promise<WriteResult> {
    const collection = parseAddress(input.collection, 'collection')
    const amountInWei = toBigInt(input.amountInWei, 'amountInWei')
    const zap = this.zapAddress()
    const callerMinOut =
      input.minOut != null ? parsePositiveAmount(input.minOut, 'minOut') : undefined
    const vault = await this.resolveVault(collection)
    const minOut =
      callerMinOut != null
        ? callerMinOut
        : (
            await this.quoteTokenSwapWithSlippage('sell', collection, amountInWei, {
              vault,
              ...(input.slippageBps != null ? { slippageBps: input.slippageBps } : {}),
              ...(input.allowUnsafe != null ? { allowUnsafe: input.allowUnsafe } : {}),
            })
          ).minOut
    if (callerMinOut != null) {
      const amountOut = await this.quoteTokenSwap('sell', collection, amountInWei, { vault })
      this.assertMinOutWithinSafeBound(amountOut, minOut, input.allowUnsafe ?? false)
    }
    const vToken = vault.collectionToken
    const allowance = await this.allowance(vToken, this.account, zap)
    const steps = encodeSellTokens(this.encoderCtx(), {
      collection,
      vToken,
      amountInWei,
      minOut,
      vTokenApprovedToZap: allowance >= amountInWei,
      ...(input.maxApproval != null ? { maxApproval: input.maxApproval } : {}),
    })
    return this.executeOrEncode(steps, opts)
  }

  // ── Execute / encode ──────────────────────────────────────────────────────

  private async executeOrEncode(steps: PlanStep[], opts?: WriteOptions): Promise<WriteResult> {
    if ((opts?.mode ?? 'submit') === 'calldata') {
      // Calldata mode is held to the same target/operator/account/chain guards
      // as submit mode. It skips simulation only because the call may be
      // broadcast later/elsewhere and must be re-simulated before sending (T10).
      const guard = createCallGuard({
        chainId: this.chainId,
        publicClient: this.publicClient,
        walletClient: this.walletClient,
        expectedAccount: this.account,
        simulate: false,
        ...(this.overrides ? { contracts: this.overrides } : {}),
      })
      for (const step of steps) if (!step.skip) await guard(step)
      return {
        mode: 'calldata',
        chainId: this.chainId,
        account: this.account,
        calls: encodeBatchCalls(steps),
      }
    }
    return { mode: 'submit', state: await this.executePlan(steps, opts?.requireAtomic ?? false) }
  }

  private async executePlan(steps: PlanStep[], requireAtomic: boolean): Promise<PlanState> {
    const atomic = await this.probeAtomic()
    if (requireAtomic && !atomic) {
      throw new WalletError('Atomic execution required, but the wallet does not support ERC-5792.')
    }
    const wallet: PlanWalletSnapshot = {
      isConnected: true,
      address: this.account,
      ...(this.walletClient.chain ? { chainId: this.walletClient.chain.id } : {}),
    }
    const guardBase = {
      chainId: this.chainId,
      publicClient: this.publicClient,
      walletClient: this.walletClient,
      expectedAccount: this.account,
      ...(this.overrides ? { contracts: this.overrides } : {}),
    }

    if (atomic && executableSteps(steps).length >= 2) {
      const deps: BatchDeps = {
        wallet,
        chainId: this.chainId,
        switchChain: (id) => this.doSwitchChain(id),
        assertCallSafe: createCallGuard({ ...guardBase, simulate: false }),
        sendCalls: (calls) => this.doSendCalls(calls),
        waitForCallsStatus: (id) => this.doWaitForCallsStatus(id),
      }
      return runBatch(steps, deps)
    }

    const deps: StagedPlanDeps = {
      wallet,
      chainId: this.chainId,
      switchChain: (id) => this.doSwitchChain(id),
      assertCallSafe: createCallGuard({ ...guardBase, simulate: true }),
      writeContract: (step) => this.doWriteContract(step),
      waitForReceipt: (hash) => this.doWaitForReceipt(hash),
    }
    return runStagedPlan(steps, deps)
  }

  // ── viem adapters (mockable in tests) ─────────────────────────────────────

  protected async probeAtomic(): Promise<boolean> {
    try {
      const caps = (await this.walletClient.getCapabilities({
        account: this.account,
      } as Parameters<WalletClient['getCapabilities']>[0])) as Record<
        number,
        { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } }
      >
      const chainCaps = caps[this.chainId]
      return (
        chainCaps?.atomic?.status === 'supported' ||
        chainCaps?.atomic?.status === 'ready' ||
        chainCaps?.atomicBatch?.supported === true
      )
    } catch {
      return false
    }
  }

  protected async doSwitchChain(id: number): Promise<void> {
    await this.walletClient.switchChain({ id })
  }

  protected async doWriteContract(step: PlanStep): Promise<string> {
    return this.walletClient.writeContract({
      address: step.address,
      abi: step.abi,
      functionName: step.functionName,
      args: step.args,
      account: this.account,
      chain: this.walletClient.chain,
      ...(step.value !== undefined ? { value: step.value } : {}),
    } as unknown as Parameters<WalletClient['writeContract']>[0])
  }

  protected async doWaitForReceipt(hash: string): Promise<PlanReceipt> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: hash as Hex })
    return { status: receipt.status, transactionHash: receipt.transactionHash }
  }

  protected async doSendCalls(calls: EncodedCall[]): Promise<{ id: string }> {
    const res = await this.walletClient.sendCalls({
      account: this.account,
      chain: this.walletClient.chain,
      calls: calls.map((c) => ({ to: c.to, data: c.data, value: encodedCallValueToBigInt(c) })),
      forceAtomic: true,
    } as Parameters<WalletClient['sendCalls']>[0])
    return { id: typeof res === 'string' ? res : (res as { id: string }).id }
  }

  protected async doWaitForCallsStatus(id: string): Promise<CallsStatusResult> {
    const s = (await this.walletClient.waitForCallsStatus({
      id,
    } as Parameters<WalletClient['waitForCallsStatus']>[0])) as {
      status?: string
      statusCode?: number
      atomic?: boolean
      receipts?: { transactionHash: string; status?: 'success' | 'reverted' }[]
    }
    const status: CallsStatusResult['status'] =
      s.status === 'success' || s.status === 'failure'
        ? s.status
        : s.statusCode != null && s.statusCode >= 200 && s.statusCode < 300
          ? 'success'
          : 'pending'
    return {
      status,
      ...(s.atomic != null ? { atomic: s.atomic } : {}),
      ...(s.statusCode != null ? { statusCode: s.statusCode } : {}),
      ...(s.receipts
        ? {
            receipts: s.receipts.map((r) => ({
              transactionHash: r.transactionHash,
              ...(r.status ? { status: r.status } : {}),
            })),
          }
        : {}),
    }
  }
}
