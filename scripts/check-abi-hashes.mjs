#!/usr/bin/env node
// ABI-drift gate: hashes every src/abi/*.ts and compares to the committed
// abi-hashes.json. Any ABI change makes this fail, forcing a manifest update —
// which is a reviewable diff and (in CI) a required Changeset. Run with --write
// to regenerate the manifest after a deliberate ABI change.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const abiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'abi')
const manifestPath = join(abiDir, 'abi-hashes.json')

const files = readdirSync(abiDir)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts'))
  .sort()

const current = {}
for (const f of files) {
  current[f] = createHash('sha256').update(readFileSync(join(abiDir, f))).digest('hex')
}

if (process.argv.includes('--write')) {
  writeFileSync(manifestPath, JSON.stringify(current, null, 2) + '\n')
  console.log(`Wrote ${manifestPath} (${files.length} ABIs).`)
  process.exit(0)
}

const committed = JSON.parse(readFileSync(manifestPath, 'utf8'))
const drift = []
for (const f of new Set([...Object.keys(current), ...Object.keys(committed)])) {
  if (current[f] !== committed[f]) drift.push(f)
}

if (drift.length > 0) {
  console.error('ABI drift detected (hash mismatch) in:')
  for (const f of drift) console.error(`  - ${f}`)
  console.error('\nIf intentional: re-verify the ABI on-chain, then run')
  console.error('  pnpm check:abi-hashes --write')
  console.error('and include a Changeset describing the contract-surface change.')
  process.exit(1)
}

console.log(`ABI hashes OK (${files.length} ABIs match the manifest).`)
