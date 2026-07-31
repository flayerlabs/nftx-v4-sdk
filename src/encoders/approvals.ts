import type { Address } from 'viem'

import { collectionTokenAbi } from '../abi/collectionToken'
import { erc721Abi } from '../abi/erc721'
import { type BigIntish, toBigInt } from '../math/amount'
import { InvalidInputError } from '../errors'
import { parseAddress } from '../lib/validate'
import type { PlanStep } from '../plan/types'

/**
 * Approval encoders. ERC721 `setApprovalForAll` grants the operator control of
 * the whole collection (a high-blast-radius approval — threat T8). ERC20 approval
 * defaults to the EXACT amount, not `MAX_UINT256` (threat T6). The operator /
 * spender is always supplied by the caller from the resolver, never by an
 * untrusted source.
 */

export interface Erc721ApprovalParams {
  collection: Address
  operator: Address
  id?: string
  label?: string
  /** Skip when a fresh `isApprovedForAll` read already shows the operator approved. */
  skip?: boolean
}

export function approveErc721ForAll(params: Erc721ApprovalParams): PlanStep {
  const operator = parseAddress(params.operator, 'operator')
  return {
    id: params.id ?? 'approve',
    label: params.label ?? 'Approve NFTs',
    address: parseAddress(params.collection, 'collection'),
    abi: erc721Abi,
    functionName: 'setApprovalForAll',
    args: [operator, true],
    approvalTarget: operator,
    replaySafe: true,
    ...(params.skip !== undefined ? { skip: params.skip } : {}),
  }
}

export interface Erc20ApprovalParams {
  token: Address
  spender: Address
  id?: string
  label?: string
  /** Exact amount to approve (wei). Pass a deliberately large value only behind an opt-in. */
  amount: BigIntish
  skip?: boolean
}

export function approveErc20(params: Erc20ApprovalParams): PlanStep {
  const amount = toBigInt(params.amount, 'approval amount')
  if (amount < 0n) throw new InvalidInputError('Approval amount cannot be negative.')
  const spender = parseAddress(params.spender, 'spender')
  return {
    id: params.id ?? 'approve',
    label: params.label ?? 'Approve token',
    address: parseAddress(params.token, 'token'),
    abi: collectionTokenAbi,
    functionName: 'approve',
    args: [spender, amount],
    approvalTarget: spender,
    replaySafe: true,
    ...(params.skip !== undefined ? { skip: params.skip } : {}),
  }
}
