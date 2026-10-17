/**
 * master-template.ts — Master Data 3 ชั้น ตาม section 6 ของพิมพ์เขียว
 *
 * 1. Global Template (organizationId = null)
 *    - ข้อมูลตัวอย่างที่ช่วยให้องค์กรใหม่เริ่มต้นเร็ว
 *    - ไม่ใช่ข้อมูลธุรกิจของทุกองค์กร
 *    - ห้าม Tenant แก้ Row ที่เป็น Global ตรง ๆ
 *
 * 2. Organization Master (organizationId = 'PILOT' หรืออื่นๆ)
 *    - ข้อมูลที่องค์กรกำหนดเอง
 *    - Site, Department, ยี่ห้อที่ใช้จริง, รุ่นที่มีจริง, Supplier
 *
 * 3. Legacy Reference (LegacyReference table)
 *    - ข้อมูลเชื่อมกลับไปยัง Code หรือ Record ของระบบเดิม
 *    - asset_no, ProductCode, WorkOrderNo, MasterItemID
 *
 * Strategy:
 *   - เมื่อองค์กรใหม่เลือก "ใช้ Global Template" → copy เป็นรายการของ Organization ใหม่
 *   - ห้ามให้ Tenant แก้ Row ที่เป็น Global ตรง ๆ
 *   - แต่ละ copy มี organizationId = org ของ Tenant ใหม่
 */

import { db } from './db'

/**
 * Copy Global Template MasterItems to a new organization.
 * Only copies rows where organizationId IS NULL (global template).
 *
 * @param targetOrganizationId — the org to copy into
 * @param categories — optional: only copy these categories (default: all)
 * @returns count of copied items
 */
export async function copyGlobalTemplateToOrg(
  targetOrganizationId: string,
  categories?: string[],
): Promise<number> {
  const where: any = { organizationId: null, active: true }
  if (categories && categories.length > 0) {
    where.category = { in: categories }
  }

  const globalItems = await db.masterItem.findMany({ where })

  let copied = 0
  for (const item of globalItems) {
    // Check if org already has this category+code
    const existing = await db.masterItem.findFirst({
      where: {
        organizationId: targetOrganizationId,
        category: item.category,
        code: item.code,
      },
    })
    if (existing) continue // Skip — already exists in org

    // Copy with new ID + target org
    await db.masterItem.create({
      data: {
        category: item.category,
        code: item.code,
        label: item.label,
        organizationId: targetOrganizationId,
        brand: item.brand,
        model: item.model,
        deviceType: item.deviceType,
        parentRef: item.parentRef,
        displayLabel: item.displayLabel,
        siteCode: item.siteCode,
        active: true,
        isDemo: false,
      },
    })
    copied++
  }

  return copied
}

/**
 * Get MasterItems for an organization — returns BOTH org-specific + global template.
 * Global items are read-only (Tenant can view but not edit).
 *
 * @param organizationId
 * @param category — optional filter
 */
export async function getMasterItemsForOrg(
  organizationId: string,
  category?: string,
) {
  const where: any = {
    OR: [
      { organizationId }, // org-specific
      { organizationId: null }, // global template
    ],
    active: true,
  }
  if (category) where.category = category

  return db.masterItem.findMany({
    where,
    orderBy: [{ category: 'asc' }, { label: 'asc' }],
  })
}

/**
 * Promote a Pilot MasterItem to Global Template.
 * Used by admin to clean Pilot data → make it available as template for new orgs.
 *
 * Strategy:
 *   1. Set organizationId = null (becomes global)
 *   2. Clean personal/org-specific data (siteCode, etc.)
 *   3. Audit log the promotion
 */
export async function promoteToGlobalTemplate(
  masterItemId: string,
  cleanedData?: { siteCode?: string | null },
): Promise<void> {
  const item = await db.masterItem.findUnique({ where: { id: masterItemId } })
  if (!item) throw new Error('MasterItem not found')

  await db.masterItem.update({
    where: { id: masterItemId },
    data: {
      organizationId: null, // becomes global
      siteCode: cleanedData?.siteCode ?? null, // clean org-specific
    },
  })
}

/**
 * Check if a MasterItem is a Global Template (read-only for tenants).
 */
export function isGlobalTemplate(item: { organizationId: string | null }): boolean {
  return item.organizationId === null
}
