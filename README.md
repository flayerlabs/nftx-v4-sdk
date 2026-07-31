# @flayerlabs/nftx-v4-sdk

Strict TypeScript SDK for NFTX v4 on Ethereum and Base. It provides canonical
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

The SDK ships Ethereum mainnet only, pinned to the NFTX v3.0.0 release and
verified against the live deployment. Base returns as an additional entry in
`ADDRESS_TABLES` once its new contracts are deployed.

| Chain | ID | Trade and plan surface | Notes |
| --- | ---: | --- | --- |
| Ethereum | 1 | NFTXZap, Locker, Listings, escrow, quotes | NFTX v3.0.0 deployment |

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
