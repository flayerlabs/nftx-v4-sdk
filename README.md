# @flayerlabs/nftx-v4-sdk

Strict TypeScript SDK for NFTX v4 across Ethereum, Base, Robinhood Chain, Ink,
Arbitrum One and Arc. It provides chain-aware
deployments, contract ABIs, quotes, pure transaction plans, guarded calldata,
and viem-backed execution without taking a dependency on React or wagmi.

> Pre-1.0: the public surface may change between minor versions. The SDK has
> not had an external security review — see [SECURITY.md](SECURITY.md) before
> using it to move funds.

## Install

```sh
pnpm add @flayerlabs/nftx-v4-sdk viem
```

`viem` is a peer dependency (`>=2.31 <3`). The package is ESM-only and requires
Node.js 18 or newer.

## Create a client

```ts
import { createNftxSdk } from '@flayerlabs/nftx-v4-sdk'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETHEREUM_RPC_URL),
})

const sdk = createNftxSdk({ publicClient })
const quote = await sdk.quoteFloorBuyWithSlippage(collectionAddress, 1n)
```

Pass a chain-matched viem `WalletClient` to get the guarded read/write facade:

```ts
const sdk = createNftxSdk({ publicClient, walletClient })

const result = await sdk.buyNfts({
  collection: collectionAddress,
  tokenIds: [123n],
  maxSpend: quote.maxSpend,
})
```

Writes default to submission. `{ mode: 'calldata' }` returns guarded,
JSON-safe `{ to, data, value }` calls without broadcasting.

## Build transaction plans

The pure builders take a chain context and return ordered `PlanStep[]` values.
They perform no RPC and can be handed to an application-owned transaction
queue.

```ts
import { buildSwapNftsPlan } from '@flayerlabs/nftx-v4-sdk'

const steps = buildSwapNftsPlan(
  { chainId: 1 },
  {
    account,
    collection,
    tokenIds: [2140n],
    listedItems: [{ tokenId: 2142n, floorMultiple: 126 }],
    depositTokenIds: [900n],
    collectionToken,
    recipient: account,
    isApprovedForAll: false,
  },
)
```

Approval steps expose `approvalTarget` for guard checks and `replaySafe: true`
for queue recovery. Deposits, fills, redeems, swaps, buys, sells, listings, and
escrow withdrawals are economic steps and are not replay-safe.

An ETH-funded floor redeem is exact-output: it passes a slippage-adjusted
`maxSpend` cap and the zap refunds unused ETH. A specific/listed buy is
different in the v3 zap: `buyNFTWithETH` exact-inputs all `msg.value`, fills the
listing, and leaves any price-improvement overage as surplus collection tokens
in the recipient wallet rather than refunding ETH. Mixed baskets that buy a
collection-token shortfall with `buyTokensWithETH` have the same exact-input,
surplus-token behaviour. Consumer UI should make this distinction visible.

## Supported deployments

The trading address book follows the frontend snapshot at `8676fb6`, checked
against deployed code and Locker/hook/zap/Uniswap wiring. Ethereum retains its
v3.0.0 zap; later protocol releases also have a newer zap at a different address.
This release follows the frontend's trading targets rather than migrating its
transactions to that newer zap.

| Chain | ID | Trade and plan surface | Notes |
| --- | ---: | --- | --- |
| Ethereum | 1 | NFTXZap, Locker, Listings, escrow, quotes | NFTX v3.0.0 deployment |
| Base | 8453 | Same trading surface | Current CREATE3 deployment |
| Robinhood Chain | 4663 | Same trading surface | No shutdown or range-curve deployment |
| Ink | 57073 | Same trading surface | No shutdown or range-curve deployment |
| Arbitrum One | 42161 | Same trading surface | No shutdown or range-curve deployment |
| Arc | 5042 | Same trading surface | Native USDC; no shutdown or range curve |
| Base Sepolia | 84532 | Same trading surface | Legacy test deployment |
| Ethereum Sepolia | 11155111 | Same trading surface | Mock flETH |
| Robinhood testnet | 46630 | Same trading surface | Mock flETH |

Base Sepolia uses the native token returned by its live hook,
`0xD2AeC1992b576762726a4e0a201df18D28BF06A6`; this corrects the frontend
snapshot's different flETH address.

On Arc, wallet values, zap parameters and client quote results use 18-decimal
native USDC. The pool currency uses 6 decimals. `nativeWeiToPoolUnits` rounds
input down; exact-output native quotes round the requested output up to a pool
unit. Arc does not wrap its native currency. Low-level pool quote helpers take
raw pool units; the client performs the conversions.

Resolve capabilities instead of assuming every contract exists:

```ts
import { getAddressFor, hasContract } from '@flayerlabs/nftx-v4-sdk/addresses'

if (hasContract(chainId, 'nftxZap')) {
  const zap = getAddressFor(chainId, 'nftxZap')
}
```

## Public surface

- NFTX v4 contract addresses and focused ABIs.
- Vault and Uniswap v4 pool-key resolution.
- Exact-input and exact-output quotes with slippage bounds.
- Listing-tax and listing-payout quotes.
- NFTXZap floor/listed NFT and collection-token trades.
- Exact-output token quotes and explicit minimum-output bounds for direct swaps.
- Uniswap-routed token swap preparation, Permit2 typed data and calldata resolution.
- ERC721, CryptoPunks and CryptoKitties authorization reads and plan builders.
- Locker deposit, redeem, and `swapBatch` plans.
- Listings fill and create plans, including optional ETH payout.
- Listings and NFTXV4Hook escrow reads and withdrawal plans.
- Sequential and ERC-5792 execution helpers.
- Typed errors, call guards, and JSON-safe calldata encoding.

Subpath exports are intentionally limited:

```ts
import { createNftxSdk, buildMixedBuyPlan } from '@flayerlabs/nftx-v4-sdk'
import { tokenEscrowAbi } from '@flayerlabs/nftx-v4-sdk/abi'
import { getAddressFor } from '@flayerlabs/nftx-v4-sdk/addresses'
import { DEFAULT_SLIPPAGE_BPS } from '@flayerlabs/nftx-v4-sdk/constants'
```

Vault creation, liquidity management, shutdown, and the full listing lifecycle
are not yet public write APIs. Indexer discovery, React state, wagmi hooks,
notifications, and application recovery policy remain consumer concerns.

## Token swaps

Direct swaps use `sdk.buyTokens()` and `sdk.sellTokens()`. Their `minOut` input
is passed unchanged to the zap, subject to the existing fresh-quote safety
check. `quoteTokenSwapExactOut(side, collection, amountOut)` estimates the
input for a desired output in either direction; `grossUpForSlippage` can derive
the expected output that covers a typed minimum after slippage. The zap still
executes exact input, so output-based quoting does not promise exact-output
settlement or an ETH refund.

Routed swaps use three small helpers:

1. `routedSwapQuoteRequest(intent)` creates an exact-input quote request.
2. `prepareRoutedSwap(intent, quote, approval, contracts)` returns exact-amount
   approval steps and optional `permitTypedData` to sign with viem.
3. `resolveRoutedSwap({ intent, quote, contracts, provider, signature })` returns
   a write `PlanStep`, refreshing a stale quote while preserving its output floor.

Use `getAddressFor(chainId, 'permit2')` and
`getAddressFor(chainId, 'universalRouter')` for the contract pair. Run approvals
and wait for their successful receipts, sign any returned Permit2 payload, then
resolve and execute the swap through `runStagedPlan` with `createCallGuard`.
These helpers do not broadcast or add an API, React or wallet-framework dependency.

`TrustedRoutedSwapProvider` is an explicit trust boundary. Its calldata method
receives the confirmed minimum output and must verify router command economics:
the spend, token pair, recipient and on-chain output minimum. The SDK checks
the quote, exact permit, account, chain, router, native value and deadlines; it
does not decode Uniswap's nested commands. A provider that only forwards opaque
third-party calldata does not meet this contract. API chain availability belongs
to the provider, and its selected router version must match the address supplied.
Routed swaps support exact-input `CLASSIC` Universal Router routes, matching the
frontend's token-trading flow. Standalone wrap/unwrap routes are rejected before
signing because they use different contract entrypoints.

## Legacy NFT authorization

`sdk.nftApproval(collection, owner, operator, tokenIds)` returns the fresh
authorization state used by pure sell, deposit, swap and listing builders via
their optional `approval` input. Existing `isApprovedForAll` inputs remain
supported for standard ERC721 collections. Punks require a zero-price offer per
token; Kitties require a per-token approval.

`punkListingsAtRisk(approval)` reports paid offers an authorization would replace.
Pure builders leave consent to the application. `sdk.sellNfts` requires
`allowPunkOfferOverwrite: true` when paid offers exist or their state cannot be
read; obtain the owner's consent before setting it. A nonzero collection token
now proves registration only: `collectionInitialized()` reads the Locker's
actual initialization state.

## Execution safety

- All addresses, token IDs, amounts, slippage values, and listing terms are
  validated before encoding.
- Write guards re-check chain, account, target bytecode, protocol identity, and
  approval targets.
- ERC20 approvals default to the exact amount.
- Listed NFT IDs use owner-safe singleton groups unless owner grouping is known.
- Plan IDs must be unique.
- ERC-5792 `callsId` and receipt hashes are preserved for reconciliation.
- Only status code 500 is treated as a definite batch revert; partial or
  ambiguous outcomes must be reconciled before retrying.

The SDK does not replace protocol deployment verification, an external security
review, or application-level risk controls. See [SECURITY.md](SECURITY.md).

## Development

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:abi-hashes
pnpm build
pnpm check:exports
pnpm check:package
pnpm pack:dry-run
```

The default suite is deterministic and network-free. The fork integration suite
is opt-in; see `.env.example` for the variables it needs.

The trade settlement suite requires a local Ethereum anvil fork pinned to block
25731800. Point `SDK_TRADE_FORK_RPC_URL` at that local node; the suite refuses
public RPC URLs and exercises token buy/sell, Punk sale and Kitty authorization using
the frontend's pinned holders. All writes stay on the local fork.

After an intentional `src/abi/*.ts` change, verify the canonical contract
source and run:

```sh
pnpm check:abi-hashes --write
```

Commit the manifest update and a Changeset explaining the contract-surface
change.

## Release process

Versioning happens locally through Changesets; publishing happens in CI.

```sh
pnpm changeset          # describe the change
pnpm version-packages   # bump version + write CHANGELOG, consumes changesets
git commit -am "chore(release): version packages"
git push
```

Then run the **Release** workflow from the Actions tab and type `publish` to
confirm. It re-runs `pnpm check`, refuses to publish an unversioned package or
one with unconsumed changesets, and publishes with npm trusted publishing
(OIDC) so no npm token is stored in the repository.

Publishing from a laptop is not supported: `publishConfig.provenance` requires
a cloud CI runner, so provenance can only be generated by the workflow.

## License

MIT.
