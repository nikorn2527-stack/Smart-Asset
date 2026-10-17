'use client'

/**
 * ItamStock — re-export of the new tabbed Stock UI.
 *
 * The original 1349-line inventory-only component has been split into 8
 * focused tab components under ./stock/. This file simply re-exports
 * `StockTabs` as `ItamStock` so that existing imports
 * (e.g. src/app/page.tsx) continue to work without changes.
 *
 *   import { ItamStock } from '@/components/itam/itam-stock'
 *
 * Tabs (matching the Apps Script original):
 *   1. ภาพรวม (Dashboard)
 *   2. คลังสินค้า (Inventory)
 *   3. รับเข้า (Stock-In)
 *   4. เบิกออก (Stock-Out)
 *   5. รออนุมัติ (Pending Approval)
 *   6. ใบสั่งซื้อ (Purchase Orders)
 *   7. ประวัติ (History)
 *   8. สรุป (Summary)
 */

export { StockTabs as ItamStock } from './stock'
export { default } from './stock'
