import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for ITAM E2E tests.
 *
 * The dev server runs on http://localhost:3000 (Next.js default). The
 * `TEST_URL` env override is honoured so the same suite can be pointed at
 * a staging deployment (e.g. the Vercel preview) without code changes.
 *
 * Run:  bun run test:e2e          (headless)
 *       bun run test:e2e:ui       (interactive mode)
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // serial — the suite shares a single dev server + DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // single worker — demo data + writes can race otherwise
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: process.env.TEST_URL || 'http://localhost:3000',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    // Dev-mode Turbopack compiles routes on demand; on a slow (virtual)
    // filesystem the first `goto` of a route can take well over 15s.
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
