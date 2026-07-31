# NFTX v4 SDK - Agent Instructions

## Project Shape

This repository is the standalone npm package for `@flayerlabs/nftx-v4-sdk`.
It is not the frontend app and should not inherit Next.js, React, Tailwind, or shadcn conventions.

## Toolchain

- Package manager: pnpm, pinned by `packageManager` in `package.json`.
- Language: TypeScript, strict mode.
- Build: `tsdown`, ESM-only, output to `dist`.
- Tests: Vitest, globals disabled.
- Package checks: `publint` and `@arethetypeswrong/cli`.
- Release metadata: Changesets.

## Source Layout

```text
src/abi/          Contract ABIs and ABI hash manifest
src/addresses/    Chain-aware contract address tables and resolution
src/client/       Read and read/write SDK facades
src/constants/    Protocol constants
src/encoders/     Pure plan-step and calldata encoders
src/entities/     Immutable SDK value objects
src/execution/    Sequential and ERC-5792 execution helpers
src/lib/          Shared validation
src/math/         Amount and slippage helpers
src/plan/         Plan-step types
src/pool/         Pool-key and quote parameter helpers
test/             Integration and parity tests
```

Keep tests colocated as `*.test.ts` when they test a source module.
Use `test/integration` or `test/parity` for opt-in external-state checks.

## Public API Discipline

- `src/index.ts` is the public root export surface.
- Subpath exports are limited to `/abi`, `/addresses`, and `/constants` unless package metadata and README are updated together.
- Preserve ESM-only packaging unless there is an explicit plan to support CJS.
- Keep `viem` as a peer dependency and dev dependency.
- Do not expose internal helpers accidentally through root exports.

## ABI Discipline

- Treat ABI changes as contract-surface changes.
- Run the ABI hash check after editing any `src/abi/*.ts` file.
- If an ABI change is intentional, verify the source, regenerate `src/abi/abi-hashes.json`, and include a Changeset explaining the contract-surface change.

## Generated Artifacts

Do not commit:

- `node_modules/`
- `dist/`
- `coverage/`
- `*.tsbuildinfo`
- `*.tgz`
- local env files or caches

The npm package publishes `dist` via the package `files` list, but generated output should still be rebuilt by CI and release tooling.

## Verification

Before considering package work done, run the relevant subset of:

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:abi-hashes
pnpm build
pnpm check:exports
pnpm check:package
pnpm pack:dry-run
```

Run the full set before release-oriented changes.

## Release Rules

- Use Changesets for user-visible package changes.
- Do not publish from this repo until npm org access, trusted publishing or token handling, and mainnet-readiness status are confirmed.
- Do not add secrets to this repository.

## Git Conventions

- Branches: `chore/<description>`, `feat/<description>`, `fix/<description>`.
- Commits: conventional format, for example `chore(package): prepare npm metadata`.
- Keep generated artifacts out of staged changes.
