import { test, expect, loginAndBoot, apiAuthHeaders, vtext } from './_helpers'

/**
 * Device management E2E — exercises the core flows:
 *   1. Devices page loads with the table
 *   2. Create new device -> appears in the table
 *   3. Delete device -> removed from the table
 *
 * UI notes (matches devices-page.tsx as of 2026-10):
 *   - Every page stays mounted (KeepAlivePage, display:none when inactive),
 *     so assertions scope to the devices page container or use vtext().
 *   - The add form is a FULL-PAGE overlay (z-[300], NOT a <dialog>):
 *     heading "เพิ่มอุปกรณ์ใหม่", required Site/Code/Name/Brand/Model/Type.
 *     Brand/Model/Type are Combobox inputs (type free text + Enter commits).
 *     Site is a Radix Select (#dev-site). Save button "บันทึกอุปกรณ์".
 *   - Delete confirm is an AlertDialog, button "ลบอุปกรณ์".
 */

const E2E_PREFIX = 'E2E-DEV'
const stamp = () => Date.now().toString(36).toUpperCase()
const uniqueAssetCode = () => `${E2E_PREFIX}-${stamp()}`

/** Scope to the visible devices page (excludes display:none KeepAlive copies). */
function devicesPage(page: Parameters<typeof vtext>[0]) {
  return page.locator('div.flex.h-full.flex-col.p-3').filter({ visible: true }).first()
}

test.describe('Device Management', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginAndBoot(page, request)
    // Devices page is lazily compiled — first navigation can take 30s+.
    // The sidebar button can be visible-but-not-yet-clickable during the
    // post-login compile burst, so retry the click a few times.
    const navBtn = page.getByRole('button', { name: 'จัดการอุปกรณ์' }).first()
    await expect(navBtn).toBeVisible({ timeout: 30_000 })
    for (let i = 0; i < 3; i++) {
      try {
        await navBtn.click({ timeout: 10_000 })
        break
      } catch {
        if (i === 2) throw new Error('devices nav click failed after 3 attempts')
        await page.waitForTimeout(2_000)
      }
    }
    const scope = devicesPage(page)
    await expect(scope.getByRole('heading', { name: 'จัดการอุปกรณ์' })).toBeVisible({ timeout: 30_000 })
    await expect(scope.getByText('รหัสทรัพย์สิน').first()).toBeVisible({ timeout: 30_000 })
  })

  test('devices page loads with the table', async ({ page }) => {
    const scope = devicesPage(page)
    await expect(scope.getByRole('table').first()).toBeVisible({ timeout: 15_000 })
    const rowCount = await scope.locator('tbody tr').count()
    expect(rowCount).toBeGreaterThan(0)
  })

  test('create new device -> appears in table', async ({ page }) => {
    const scope = devicesPage(page)

    // Open the full-page add form (header button "เพิ่มอุปกรณ์").
    await scope.getByRole('button', { name: 'เพิ่มอุปกรณ์' }).first().click()
    await expect(page.getByRole('heading', { name: /เพิ่มอุปกรณ์ใหม่/ })).toBeVisible({ timeout: 10_000 })

    const assetCode = uniqueAssetCode()
    // 1. Site (Radix Select #dev-site) — required. Pick the first real option.
    await page.locator('#dev-site').click()
    const siteOption = page.getByRole('option').first()
    await expect(siteOption).toBeVisible({ timeout: 10_000 })
    const siteValue = (await siteOption.textContent())?.trim() ?? ''
    expect(siteValue.length).toBeGreaterThan(0)
    await siteOption.click()

    // 2. Asset code + name (plain inputs).
    await page.locator('#dev-assetCode').fill(assetCode)
    await page.locator('#dev-name').fill('E2E Test Printer')

    // 3. Type / Brand / Model are Combobox inputs: fill free text, Enter commits.
    // combobox "เลือกหรือพิมพ์ประเภท เช่น PRINTER LASER"
    const typeBox = page.getByRole('combobox', { name: /เลือกหรือพิมพ์ประเภท/ })
    await typeBox.click()
    await typeBox.fill('PRINTER')
    await page.keyboard.press('Enter')

    // combobox "เลือกหรือพิมพ์แบรนด์ เช่น BROTHER"
    const brandBox = page.getByRole('combobox', { name: /เลือกหรือพิมพ์แบรนด์/ })
    await brandBox.click()
    await brandBox.fill('HP')
    await page.keyboard.press('Enter')

    // combobox "เลือกรุ่น เช่น HL-L5210DN"
    const modelBox = page.getByRole('combobox', { name: /เลือกรุ่น/ })
    await modelBox.click()
    await modelBox.fill('LaserJet Test')
    await page.keyboard.press('Enter')

    // Save the form (sticky header button "บันทึกอุปกรณ์").
    // IMPORTANT: start listening for the POST *before* clicking — otherwise the
    // request often completes before the listener attaches and we race to null.
    const postPromise = page
      .waitForResponse(
        (r) => r.url().includes('/api/devices') && r.request().method() === 'POST' && r.ok(),
        { timeout: 15_000 },
      )
      .catch(() => null)
    await page.getByRole('button', { name: 'บันทึกอุปกรณ์' }).first().click()

    // Toast confirms success.
    await expect(vtext(page, 'เพิ่มอุปกรณ์ใหม่แล้ว')).toBeVisible({ timeout: 15_000 })

    // Verify via the API (source of truth — avoids search/pagination timing),
    // then confirm the UI search finds it.
    const created = await postPromise
    expect(created, 'POST /api/devices should succeed').toBeTruthy()

    // Search for the new asset code in the table.
    // Devices search is immediate (no debounce) but the refetch + render
    // takes a moment — press Enter to commit, then wait for the row.
    const searchBox = scope.locator('input[placeholder*="ค้นหา"]').first()
    await searchBox.fill(assetCode)
    await searchBox.press('Enter')
    // Poll: the new row may take a refetch cycle to appear.
    await expect.poll(async () => {
      return await scope.locator('tbody').getByText(assetCode).count()
    }, { timeout: 20_000 }).toBeGreaterThan(0)
    await expect(scope.locator('tbody').getByText(assetCode).first()).toBeVisible({ timeout: 5_000 })
  })

  test('delete device -> removed from table', async ({ page, request }) => {
    // Create a throwaway device via the API so we can delete it via the UI
    // without depending on the previous test's state.
    const headers = await apiAuthHeaders(request)
    const assetCode = uniqueAssetCode()
    const res = await request.post('/api/devices', {
      headers,
      data: {
        assetCode,
        name: 'E2E Delete Target',
        brand: 'HP',
        model: 'LaserJet Test',
        type: 'PRINTER',
        status: 'Active',
        site: 'UDH',
      },
    })
    expect(res.ok(), 'API create should succeed for setup').toBeTruthy()

    const scope = devicesPage(page)

    // Find the row with our asset code (search if it is not on page 1).
    let row = scope.locator('tr', { hasText: assetCode }).first()
    if (!(await row.isVisible().catch(() => false))) {
      const searchBox = scope.locator('input[placeholder*="ค้นหา"]').first()
      await searchBox.fill(assetCode)
      await searchBox.press('Enter')
      row = scope.locator('tr', { hasText: assetCode }).first()
    }
    await expect(row).toBeVisible({ timeout: 15_000 })

    // The row action button has aria-label 'ลบอุปกรณ์นี้'.
    await row.getByRole('button', { name: 'ลบอุปกรณ์นี้' }).click({ timeout: 5_000 })

    // Confirm the AlertDialog — button text is 'ลบอุปกรณ์'.
    await page.getByRole('alertdialog').getByRole('button', { name: 'ลบอุปกรณ์', exact: true }).click({ timeout: 5_000 })

    // Toast confirms deletion.
    await expect(vtext(page, 'ลบอุปกรณ์แล้ว')).toBeVisible({ timeout: 10_000 })

    // The asset code should no longer appear in the table.
    await page.waitForTimeout(500)
    await expect(scope.locator('tbody').getByText(assetCode)).toHaveCount(0)
  })
})

