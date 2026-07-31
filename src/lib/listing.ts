import type { Address } from 'viem'

import { InvalidInputError } from '../errors'
import { parseAddress } from './validate'

export interface ListingTermsInput {
  owner: Address
  created: number
  duration: number
  floorMultiple: number
}

export type ListingTerms = ListingTermsInput

export function parseUintNumber(
  value: number,
  bits: 16 | 32 | 40,
  label: string,
  positive = false,
): number {
  const max = 2 ** bits - 1
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > max) {
    throw new InvalidInputError(
      `${label} must be ${positive ? 'a positive' : 'an'} uint${bits} value.`,
    )
  }
  return value
}

/** Validate the tuple shared by createListings and getListingTaxRequired. */
export function parseListingTerms(input: ListingTermsInput): ListingTerms {
  const floorMultiple = parseUintNumber(input.floorMultiple, 16, 'floorMultiple', true)
  if (floorMultiple <= 100) {
    throw new InvalidInputError('floorMultiple must be above 100 for an active listing.')
  }
  return {
    owner: parseAddress(input.owner, 'listing.owner'),
    created: parseUintNumber(input.created, 40, 'created'),
    duration: parseUintNumber(input.duration, 32, 'duration', true),
    floorMultiple,
  }
}
