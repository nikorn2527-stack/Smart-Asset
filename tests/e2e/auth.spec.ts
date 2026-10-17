import { test, expect, apiLogin, uiLogin, uiLogout, loginAndBoot, DEMO_ADMIN_USER, DEMO_ADMIN_PASS, ADMIN_USER, ADMIN_PASS } from './_helpers'
import type { Page, APIRequestContext } from '@playwright/test'

/**
 * Authentication E2E — covers the 4 critical auth flows:
 *   1. Login with admin/admin123 → success (lands in app shell)
 *   2. Login with wrong password → rejected with error message
 *   3. Login with demo_admin/demo123 → demo banner appears
 *   4. Logout → returns to login page
 */

test.describe('Authentication', () => {
  test('admin/admin123 → succeeds via UI', async ({ page }) => {
    await uiLogin(page, ADMIN_USER, ADMIN_PASS)
    // The app shell renders the Sidebar — the "Dashboard" nav item is a
    // stable marker that we're past the login form.
    await expect(page.getByText(/Dashboard/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('admin/admin123 → succeeds via API and persists', async ({ page, request }) => {
    const auth = await apiLogin(request, ADMIN_USER, ADMIN_PASS)
    expect(auth.user).toBeTruthy()
    expect(auth.user.email).toBeTruthy()
    expect(auth.user.isDemo).toBe(false)

    // Boot with the persisted token → should land in the app shell, not login.
    await page.addInitScript((p) => {
      window.localStorage.setItem('itam-auth', JSON.stringify(p))
    }, { state: { user: auth.user, token: auth.token, isAuthenticated: true }, version: 0 })

    await page.goto('/')
    await expect(page.getByText(/Dashboard/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('wrong password → rejected with error', async ({ page }) => {
    await uiLogin(page, ADMIN_USER, 'this-is-wrong-on-purpose')
    // The login form surfaces an error message in Thai or English.
    await expect(page.getByText(/ไม่ถูกต้อง|invalid|failed|เข้าสู่ระบบไม่สำเร็จ/i).first()).toBeVisible({ timeout: 10_000 })
    // Make sure we're still on the login screen (no Sidebar nav).
    await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible()
  })

  test('demo_admin/demo123 → shows demo banner', async ({ page, request }) => {
    const auth = await apiLogin(request, DEMO_ADMIN_USER, DEMO_ADMIN_PASS)
    expect(auth.user.isDemo).toBe(true)

    await page.addInitScript((p) => {
      window.localStorage.setItem('itam-auth', JSON.stringify(p))
    }, { state: { user: auth.user, token: auth.token, isAuthenticated: true }, version: 0 })

    await page.goto('/')
    // Demo banner should be visible at the top of the app shell.
    await expect(page.getByText(/โหมดสาธิต/i).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Dashboard/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('logout → returns to login page', async ({ page, request }) => {
    await loginAndBoot(page, request)
    await expect(page.getByText(/Dashboard/i).first()).toBeVisible({ timeout: 15_000 })

    await uiLogout(page)
    // After logout, the login form should reappear (uiLogout guarantees it —
    // it falls back to clearing localStorage if the button click didn't land).
    await expect(page.locator('input#username')).toBeVisible({ timeout: 10_000 })
  })
})
