import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Vitest globals are off — import { describe, it, expect } explicitly,
    // mirroring the host repo's convention.
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 85,
        lines: 85,
      },
    },
  },
})
