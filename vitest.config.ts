import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    // tests/runtime/** and tests/auth/** are STANDALONE scripts, not vitest
    // suites: they call process.exit() at the end and print their own report.
    // package.json runs them directly (`bun run test:runtime`, `npx tsx
    // tests/auth/*.test.ts`). The `tests/**/*.test.ts` glob swept them in, so
    // vitest reported "No test suite found in file" and reported phantom
    // failures that had nothing to do with the code under test.
    //
    //   tests/runtime/**              standalone DB-backed scripts
    //   tests/auth/**                 standalone scripts (package.json test:all)
    //   tests/sticker-print-helpers*  imports `bun:test` → must run via `bun test`
    //   tests/custom-fields-acceptance standalone script hitting the real DB
    exclude: [
      'node_modules/**',
      '.next/**',
      'tests/runtime/**',
      'tests/auth/**',
      'tests/sticker-print-helpers.test.ts',
      'tests/custom-fields-acceptance.test.ts',
    ],
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
