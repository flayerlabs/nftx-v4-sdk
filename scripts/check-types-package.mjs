import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const attwBin = process.platform === 'win32' ? 'attw.cmd' : 'attw'

const result = spawnSync(attwBin, ['--pack', '--profile', 'esm-only'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NPM_CONFIG_CACHE: resolve('.npm-cache'),
    npm_config_cache: resolve('.npm-cache'),
  },
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
