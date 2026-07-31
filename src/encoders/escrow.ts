import { zeroAddress, type Address } from 'viem'

import { tokenEscrowAbi } from '../abi/tokenEscrow'
import { getAddressFor } from '../addresses/resolve'
import { parseAddress, parseAddressAllowZero, parsePositiveAmount } from '../lib/validate'
import type { BigIntish } from '../math/amount'
import type { PlanStep } from '../plan/types'
import type { TradeEncoderContext } from './zap'

/** Protocol contracts that each maintain an independent token escrow ledger. */
export type TokenEscrowSource = 'listings' | 'nftxV4Hook'

/** The token sentinel used by TokenEscrow for native ETH balances. */
export const NATIVE_ESCROW_TOKEN: Address = zeroAddress

export interface WithdrawEscrowParams {
  source: TokenEscrowSource
  /** Destination only; the contract debits the connected caller's balance. */
  recipient: Address
  /** ERC20 address, or {@link NATIVE_ESCROW_TOKEN} for native ETH. */
  token: Address
  /** A positive full or partial withdrawal amount. */
  amount: BigIntish
  id?: string
  label?: string
}

/** Build one economic (non-replay-safe) withdrawal from a protocol escrow ledger. */
export function withdrawEscrow(
  ctx: TradeEncoderContext,
  params: WithdrawEscrowParams,
): PlanStep {
  const source = getAddressFor(ctx.chainId, params.source, ctx.contracts)
  const recipient = parseAddress(params.recipient, 'recipient')
  const token = parseAddressAllowZero(params.token, 'token')
  const amount = parsePositiveAmount(params.amount, 'amount')
  return {
    id: params.id ?? `claim-${source}-${token}`,
    label: params.label ?? 'Claim escrow',
    address: source,
    abi: tokenEscrowAbi,
    functionName: 'withdraw',
    args: [recipient, token, amount],
  }
}
