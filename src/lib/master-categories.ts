/**
 * master-categories.ts — Master Data Catalog configuration
 *
 * ตามพิมพ์เขียว section 7: แบ่ง MasterItem เป็น 4 กลุ่มหลัก
 *   1. Core (ใช้ในทุก module)
 *   2. Device (อุปกรณ์)
 *   3. Repair (งานซ่อม)
 *   4. Stock (สต็อก)
 *
 * แต่ละหมวดย่อยมี: key (ใช้ใน MasterItem.category), label (แสดงผล), group (กลุ่มใหญ่)
 */

export type MasterGroupKey = 'core' | 'device' | 'repair' | 'stock'

export interface MasterCategoryDef {
  /** key ใน MasterItem.category column */
  key: string
  /** ชื่อที่แสดงผล (TH) */
  label: string
  /** ชื่อที่แสดงผล (EN) */
  labelEn: string
  /** กลุ่มใหญ่ */
  group: MasterGroupKey
  /** ลำดับการแสดงผลภายในกลุ่ม */
  sortOrder: number
  /** มี parent relation ไหม (เช่น Model → Brand|DeviceType, Department → Affiliation) */
  hasParent?: boolean
  /** อธิบายการใช้งาน */
  description?: string
}

export const MASTER_GROUPS: Array<{ key: MasterGroupKey; label: string; labelEn: string; icon: string }> = [
  { key: 'core', label: 'หมวดหลัก', labelEn: 'Core', icon: '🏢' },
  { key: 'device', label: 'อุปกรณ์', labelEn: 'Device', icon: '💻' },
  { key: 'repair', label: 'งานซ่อม', labelEn: 'Repair', icon: '🔧' },
  { key: 'stock', label: 'สต็อก', labelEn: 'Stock', icon: '📦' },
]

export const MASTER_CATEGORIES: MasterCategoryDef[] = [
  // ── Core (section 7.1) ──────────────────────────────────────────────
  { key: 'Site', label: 'สาขา', labelEn: 'Site', group: 'core', sortOrder: 1, description: 'ทุก Module' },
  { key: 'Department', label: 'หน่วยงาน', labelEn: 'Department', group: 'core', sortOrder: 2, hasParent: true, description: 'มีสังกัด (Affiliation)' },
  { key: 'Affiliation', label: 'สังกัด/กลุ่มงาน', labelEn: 'Affiliation', group: 'core', sortOrder: 3, description: 'โครงสร้างองค์กร' },
  { key: 'Building', label: 'อาคาร', labelEn: 'Building', group: 'core', sortOrder: 4, description: 'Location' },
  { key: 'Floor', label: 'ชั้น', labelEn: 'Floor', group: 'core', sortOrder: 5, description: 'Location' },
  { key: 'Room', label: 'ห้อง/สถานที่', labelEn: 'Room/Location', group: 'core', sortOrder: 6, description: 'Device, Work Order' },
  { key: 'Status', label: 'สถานะ', labelEn: 'Status', group: 'core', sortOrder: 7, description: 'ทุก Module ตามบริบท' },
  { key: 'Priority', label: 'ความสำคัญ', labelEn: 'Priority', group: 'core', sortOrder: 8, description: 'Work Order' },
  { key: 'Unit', label: 'หน่วย', labelEn: 'Unit', group: 'core', sortOrder: 9, description: 'Stock (ชิ้น, กล่อง, ...)' },
  { key: 'CostCenter', label: 'Cost Center', labelEn: 'Cost Center', group: 'core', sortOrder: 10 },

  // ── Device (section 7.2) ───────────────────────────────────────────
  { key: 'AssetCategory', label: 'หมวดสินทรัพย์', labelEn: 'Asset Category', group: 'device', sortOrder: 1, description: 'หมวดใหญ่ของสินทรัพย์' },
  { key: 'DeviceType', label: 'ประเภทอุปกรณ์', labelEn: 'Device Type', group: 'device', sortOrder: 2, hasParent: true, description: 'มี parent = AssetCategory' },
  { key: 'DeviceGroup', label: 'กลุ่มอุปกรณ์', labelEn: 'Device Group', group: 'device', sortOrder: 3, description: 'COMPANY, LEASED, DEPT, PERSONAL' },
  { key: 'Brand', label: 'ยี่ห้อ', labelEn: 'Brand', group: 'device', sortOrder: 4, hasParent: true, description: 'มี parent = DeviceType' },
  { key: 'Model', label: 'รุ่น', labelEn: 'Model', group: 'device', sortOrder: 5, hasParent: true, description: 'parent = "Brand|DeviceType"' },
  { key: 'Condition', label: 'สภาพ', labelEn: 'Condition', group: 'device', sortOrder: 6, description: 'New, Used, Refurbished' },
  { key: 'OwnershipType', label: 'ประเภทกรรมสิทธิ์', labelEn: 'Ownership Type', group: 'device', sortOrder: 7, description: 'เช่า, ซื้อ, ยืม' },
  { key: 'WarrantyType', label: 'ประเภทรับประกัน', labelEn: 'Warranty Type', group: 'device', sortOrder: 8 },
  { key: 'ContractType', label: 'ประเภทสัญญา', labelEn: 'Contract Type', group: 'device', sortOrder: 9 },
  { key: 'ContractNo', label: 'เลขที่สัญญา', labelEn: 'Contract No', group: 'device', sortOrder: 10, description: 'อ้างอิงสัญญา specific' },

  // ── Repair (section 7.3) ───────────────────────────────────────────
  { key: 'RepairGroup', label: 'กลุ่มงานซ่อม', labelEn: 'Repair Group', group: 'repair', sortOrder: 1, description: 'IT-PRN, IT-COM, IT-NET, ...' },
  { key: 'RepairProblem', label: 'อาการ/ปัญหา', labelEn: 'Repair Problem', group: 'repair', sortOrder: 2, hasParent: true, description: 'parent = RepairGroup' },
  { key: 'RepairResolution', label: 'วิธีแก้ไข', labelEn: 'Repair Resolution', group: 'repair', sortOrder: 3, hasParent: true, description: 'parent = RepairGroup' },
  { key: 'RepairPriority', label: 'ความเร่งด่วนซ่อม', labelEn: 'Repair Priority', group: 'repair', sortOrder: 4 },
  { key: 'WorkOrderStatus', label: 'สถานะใบงาน', labelEn: 'Work Order Status', group: 'repair', sortOrder: 5 },
  { key: 'ServiceChannel', label: 'ช่องทางบริการ', labelEn: 'Service Channel', group: 'repair', sortOrder: 6, description: 'QR, LINE, Phone, Walk-in' },

  // ── Stock (section 7.4) ────────────────────────────────────────────
  { key: 'StockCategory', label: 'หมวดสต็อก', labelEn: 'Stock Category', group: 'stock', sortOrder: 1 },
  { key: 'StockUnit', label: 'หน่วยสต็อก', labelEn: 'Stock Unit', group: 'stock', sortOrder: 2, description: 'ชิ้น, กล่อง, แพ็ค' },
  { key: 'StockPurpose', label: 'วัตถุประสงค์สต็อก', labelEn: 'Stock Purpose', group: 'stock', sortOrder: 3, description: 'ซ่อม, สำรอง, บริจาค' },
  { key: 'StockStatus', label: 'สถานะสต็อก', labelEn: 'Stock Status', group: 'stock', sortOrder: 4 },
  { key: 'TransactionType', label: 'ประเภทธุรกรรม', labelEn: 'Transaction Type', group: 'stock', sortOrder: 5, description: 'IN, OUT, ADJUST, TRANSFER' },
  { key: 'Supplier', label: 'ผู้จำหน่าย', labelEn: 'Supplier', group: 'stock', sortOrder: 6 },
  { key: 'Product', label: 'สินค้า', labelEn: 'Product', group: 'stock', sortOrder: 7, description: 'Legacy — ใช้ StockItem แทน' },
  { key: 'ProductCategory', label: 'หมวดสินค้า', labelEn: 'Product Category', group: 'stock', sortOrder: 8, description: 'Legacy — ใช้ StockCategory' },
  { key: 'Purpose', label: 'วัตถุประสงค์ (legacy)', labelEn: 'Purpose (legacy)', group: 'stock', sortOrder: 9, description: 'Legacy — ใช้ StockPurpose' },
  { key: 'StockSource', label: 'แหล่งสต็อก', labelEn: 'Stock Source', group: 'stock', sortOrder: 10 },
]

/**
 * Get categories by group.
 */
export function getCategoriesByGroup(group: MasterGroupKey): MasterCategoryDef[] {
  return MASTER_CATEGORIES.filter(c => c.group === group).sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Get all category keys for a group.
 */
export function getCategoryKeys(group: MasterGroupKey): string[] {
  return MASTER_CATEGORIES.filter(c => c.group === group).map(c => c.key)
}

/**
 * Find a category definition by key.
 */
export function findCategory(key: string): MasterCategoryDef | undefined {
  return MASTER_CATEGORIES.find(c => c.key === key)
}

/**
 * Check if a category key is known (in the catalog).
 * Legacy categories from the old app that aren't in the catalog will return false.
 */
export function isKnownCategory(key: string): boolean {
  return MASTER_CATEGORIES.some(c => c.key === key)
}
