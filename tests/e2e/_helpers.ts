/**
 * Shared helpers for ITAM E2E tests.
 *
 * The app's auth uses /api/itam/auth/login (POST { username, password }) →
 * returns { token, user }. The token is persisted in localStorage under the
 * `itam-auth` key (zustand persist) — so once we set it, the app shell
 * boots straight into the authenticated view on the next page load.
 */

import { test as base, expect, type Page, type Locator, type APIRequestContext } from '@playwright/test'

// ── Credentials ─────────────────────────────────────────────────────
export const ADMIN_USER = process.env.E2E_ADMIN_USER || 'admin'
// Seed scripts (seed-real-data.ts / create-demo-users.js / reset-all-passwords.ts)
// and all docs set the admin password to test1234 — match the real DB default.
export const ADMIN_PASS = process.env.E2E_ADMIN_PASS || 'test1234'
export const DEMO_ADMIN_USER = process.env.E2E_DEMO_ADMIN_USER || 'demo_admin'
export const DEMO_ADMIN_PASS = process.env.E2E_DEMO_ADMIN_PASS || 'demo123'

// ── Persisted auth shape (zustand `persist` middleware) ─────────────
interface PersistedAuth {
  state: {
    user: Record<string, unknown> | null
    token: string | null
    isAuthenticated: boolean
  }
  version?: number
}

/**
 * Log in via the API directly (one round-trip) and inject the resulting
 * token + user into localStorage so the next page load is authenticated.
 *
 * Returns the auth response body so callers can inspect the user object
 * (e.g. for asserting `isDemo`).
 */
export async function apiLogin(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<{ token: string; user: Record<string, unknown> }> {
  const res = await request.post('/api/itam/auth/login', {
    data: { username, password },
  })
  expect(res.ok(), `login should succeed for ${username}`).toBeTruthy()
  const body = (await res.json()) as { token: string; user: Record<string, unknown> }
  expect(body.token, 'login should return a JWT').toBeTruthy()
  expect(body.user, 'login should return a user object').toBeTruthy()
  return body
}

/**
 * Boot the page with a pre-authenticated localStorage so the very first
 * render goes straight into the app shell (skipping the login form).
 */
export async function bootAuthenticated(
  page: Page,
  auth: { token: string; user: Record<string, unknown> },
): Promise<void> {
  const payload: PersistedAuth = {
    state: {
      user: auth.user as PersistedAuth['state']['user'],
      token: auth.token,
      isAuthenticated: true,
    },
    version: 0,
  }
  await page.addInitScript((p) => {
    try {
      window.localStorage.setItem('itam-auth', JSON.stringify(p))
    } catch {
      /* ignore */
    }
  }, payload)
  await page.goto('/')
}

/**
 * Convenience: log in via the API and boot the page authenticated, all in
 * one call. Useful for tests that don't need to exercise the login form
 * itself.
 */
export async function loginAndBoot(
  page: Page,
  request: APIRequestContext,
  username = ADMIN_USER,
  password = ADMIN_PASS,
): Promise<{ token: string; user: Record<string, unknown>; authHeaders: Record<string, string> }> {
  const auth = await apiLogin(request, username, password)
  await bootAuthenticated(page, auth)
  // authHeaders: specs attach the JWT to their own API setup calls —
  // /api/devices, /api/stock-items, /api/work-orders/:id/assign REQUIRE
  // auth, so a bare setup request 401s before the UI is ever reached.
  return { ...auth, authHeaders: { Authorization: `Bearer ${auth.token}` } }
}

/**
 * Login via the API and return just the Authorization headers (no page
 * boot). For specs that need a JWT for API-only setup/teardown calls.
 */
export async function apiAuthHeaders(
  request: APIRequestContext,
  username = ADMIN_USER,
  password = ADMIN_PASS,
): Promise<Record<string, string>> {
  const auth = await apiLogin(request, username, password)
  return { Authorization: `Bearer ${auth.token}` }
}

/**
 * A text locator restricted to VISIBLE matches.
 *
 * The app keeps every page mounted (KeepAlivePage — inactive pages are
 * display:none, not unmounted), so getByText() matches both the visible
 * copy on the active page AND hidden copies on inactive pages. `.first()`
 * on an unfiltered locator routinely lands on a hidden element and the
 * assertion fails even though the UI is fine.
 */
export function vtext(scope: Page | Locator, target: string | RegExp) {
  return scope.getByText(target).filter({ visible: true }).first()
}

/**
 * Drive the actual login UI (type into the username/password fields and
 * click "เข้าสู่ระบบ"). Used by tests that specifically exercise the
 * login form flow (e.g. wrong-password rejection).
 */
export async function uiLogin(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/')
  await page.locator('input#username').fill(username)
  await page.locator('input#password').fill(password)
  // exact name — the login screen also renders a "เข้าสู่ระบบด้วย Passkey"
  // button, and a regex match hits both (strict-mode violation).
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
}

/**
 * Click the logout button in the sidebar (top of the user menu). Tolerates
 * the button being inside a popover — falls back to the keyboard shortcut
 * path if the click doesn't land.
 */
export async function uiLogout(page: Page): Promise<void> {
  // The sidebar renders an "ออกจากระบบ" button (desktop sidebar or inside
  // the user menu). Try clicking it, then make sure we actually land back
  // on the login form — otherwise fall back to clearing localStorage.
  await page
    .getByRole('button', { name: /ออกจากระบบ|logout|Log ?out/i })
    .first()
    .click({ timeout: 5_000 })
    .catch(() => undefined)
  const onLogin = await page
    .locator('input#username')
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (!onLogin) {
    // Fallback: clear localStorage and reload (server-side blacklist is
    // best-effort — the client just needs to forget the token).
    await page.evaluate(() => window.localStorage.removeItem('itam-auth'))
    await page.reload()
    await page.locator('input#username').waitFor({ state: 'visible', timeout: 15_000 })
  }
}

// ── Custom test fixture: pre-authenticated `page` ───────────────────
// Tests that import `test` from this file get a `page` that's already
// authenticated as admin — saves 4 lines of boilerplate per test.
//
// NOTE: The lint rule `react-hooks/rules-of-hooks` misfires on Playwright's
// `use()` callback (it looks like a React Hook to the linter). The whole
// file is lint-clean except for this one false positive.
/* eslint-disable react-hooks/rules-of-hooks */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page, request }, use) => {
    await loginAndBoot(page, request)
    await use(page)
  },
})
/* eslint-enable react-hooks/rules-of-hooks */

export { expect }
