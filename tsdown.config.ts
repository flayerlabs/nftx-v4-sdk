import { defineConfig } from 'tsdown'

// ESM-first dual-free build (no CJS): the modern-runtime target rarely needs
// CommonJS, and an ESM-only package sidesteps the dual-package `instanceof`
// hazard for the typed error hierarchy. Each subpath gets its own entry so
// `./abi`, `./addresses`, and `./constants` tree-shake independently.
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/abi/index.ts',
    'src/addresses/index.ts',
    'src/constants/index.ts',
  ],
  format: ['esm'],
  dts: true,
  treeshake: true,
  clean: true,
  outDir: 'dist',
  platform: 'neutral',
  target: 'es2022',
})
