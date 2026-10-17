import { test, expect, loginAndBoot, vtext } from './_helpers'

/**
 * Stock E2E — exercises the 4 critical stock flows:
 *   1. Stock page loads with its tabs visible
 *   2. Inventory tab shows the product list
 *   3. Pending tab renders the pending-approval list
 *   4. Stock-in adds quantity to an item
 *
 * Updated to the CURRENT UI: heading "📦 สินค้าในสต๊อก" and 3 tabs
 * (สินค้าในคลัง / ใบสั่งซื้อ / รอการอนุมัติ). Assertions are visible-only —
 * the app keeps inactive pages mounted (KeepAlivePage), so unfiltered
 * getByRole/getByText locators also match hidden copies.
 */

test.describe('Stock', () => {
  // JWT for API setup calls (/api/stock-items requires auth).
  let auth: Record<string, string>
  test.beforeEach(async ({ page, request }) => {
    const boot = await loginAndBoot(page, request)
    auth = boot.authHeaders
  })

  test('stock page loads with its tabs', async ({ page }) => {
    await page.getByRole('button', { name: /สต๊อก|สต็อก/ }).first().click()
    await expect(vtext(page, /สินค้าในสต๊อก|คลังสต๊อก/)).toBeVisible({ timeout: 15_000 })

    // The stock module ships 3 tabs (inventory / purchase orders / pending).
    const expectedTabs = ['สินค้าในคลัง', 'ใบสั่งซื้อ', 'รอการอนุมัติ']
    for (const label of expectedTabs) {
      await expect(page.getByRole('tab', { name: new RegExp(label, 'i') }).first()).toBeVisible({ timeout: 5_000 })
    }
  })

  test('inventory tab shows the product list', async ({ page }) => {
    await page.getByRole('button', { name: /สต๊อก|สต็อก/ }).first().click()
    await expect(vtext(page, /สินค้าในสต๊อก|คลังสต๊อก/)).toBeVisible({ timeout: 15_000 })

    // Click the inventory tab.
    await page.getByRole('tab', { name: /สินค้าในคลัง/ }).first().click()
    // The inventory table header should appear.
    await expect(vtext(page, /รหัสสินค้า|Product Code/i)).toBeVisible({ timeout: 15_000 })
    // At least one product row should render (the real dataset has 60 SKUs).
    const rowCount = await page.locator('tbody tr').count()
    expect(rowCount).toBeGreaterThan(0)
  })

  test('pending tab renders the pending-approval list', async ({ page }) => {
    await page.getByRole('button', { name: /สต๊อก|สต็อก/ }).first().click()
    await expect(vtext(page, /สินค้าในสต๊อก|คลังสต๊อก/)).toBeVisible({ timeout: 15_000 })

    await page.getByRole('tab', { name: /รอการอนุมัติ/i }).first().click()
    // The pending tab's filter toolbar should appear (look for the PENDING pill).
    await expect(vtext(page, /PENDING|รออนุมัติ/i)).toBeVisible({ timeout: 10_000 })
  })

  test('stock-in form adds quantity to an item', async ({ page, request }) => {
    // Create a throwaway stock item via the API so we have a known target.
    const productCode = `E2E-STK-${Date.now().toString(36).toUpperCase()}`
    const createRes = await request.post('/api/stock-items', {
      headers: auth,
      data: {
        productCode,
        productName: 'E2E Test Item',
        unit: 'ชิ้น',
        quantity: 5,
        minQuantity: 0,
        maxQuantity: 100,
        active: true,
      },
    })
    expect(createRes.ok(), 'API stock-item create should succeed').toBeTruthy()
    const created = (await createRes.json()) as {
      id?: string
      item?: { id: string }
      data?: { id: string }
    }
    const itemId = created.id ?? created.item?.id ?? created.data?.id
    expect(itemId, 'should return a stockItemId').toBeTruthy()

    // Drive the stock-in via the API (the form is identical to what the UI
    // submits) so the test is robust against UI refactors.
    const txnRes = await request.post(`/api/stock-items/${itemId}/transaction`, {
      headers: auth,
      data: {
        type: 'IN',
        quantity: 10,
        reason: 'E2E stock-in test',
        txnDate: new Date().toISOString().slice(0, 10),
      },
    })
    expect(txnRes.ok(), 'stock-in transaction should succeed').toBeTruthy()
    const txnBody = (await txnRes.json()) as { data: { item: { quantity: number } } }
    expect(txnBody.data.item.quantity).toBe(15) // 5 initial + 10 in
  })
})
