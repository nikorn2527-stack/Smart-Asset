/**
 * Code Service — สร้าง Canonical Code ใหม่ตาม section 8 ของพิมพ์เขียว
 *
 * Code ใหม่เป็นรูปแบบง่าย ไม่ผูกความหมายที่อาจเปลี่ยน:
 *   AST-000001, BRD-0001, MDL-0001, TYP-0001, DEP-0001, STK-0001, WO-2026-0001
 *
 * Code ใหม่ไม่เปลี่ยนเมื่อแก้ Label หรือย้าย Site
 */

export type CodeEntity =
  | 'AST' // Asset (Device)
  | 'WO'  // Work Order
  | 'STK' // Stock Item
  | 'PO'  // Purchase Order
  | 'BRD' // Brand
  | 'MDL' // Model
  | 'TYP' // DeviceType
  | 'DEP' // Department
  | 'AFF' // Affiliation
  | 'BLD' // Building
  | 'FLR' // Floor
  | 'ROM' // Room
  | 'STA' // Status
  | 'PRI' // Priority
  | 'UNT' // Unit
  | 'CCT' // CostCenter
  | 'ASC' // AssetCategory
  | 'DGP' // DeviceGroup
  | 'SIT' // Site
  | 'SUP' // Supplier
  | 'RGP' // RepairGroup
  | 'RPB' // RepairProblem
  | 'RXS' // RepairResolution
  | 'RPP' // RepairPriority
  | 'CND' // Condition
  | 'OWN' // OwnershipType
  | 'WTY' // WarrantyType
  | 'CTT' // ContractType
  | 'CTN' // ContractNo
  | 'WOS' // WorkOrderStatus
  | 'SCH' // ServiceChannel
  | 'SCC' // StockCategory
  | 'SU'  // StockUnit
  | 'SPU' // StockPurpose
  | 'SSS' // StockStatus
  | 'TT'  // TransactionType

/**
 * Build a canonical code from a prefix + sequence number + padding.
 *
 * Example:
 *   buildCanonicalCode('AST', 1, 6) → 'AST-000001'
 *   buildCanonicalCode('BRD', 1, 4) → 'BRD-0001'
 *   buildCanonicalCode('WO', 1, 5, 2026) → 'WO-2026-00001'
 */
export function buildCanonicalCode(
  prefix: CodeEntity | string,
  seq: number,
  padding: number = 4,
  year?: number,
): string {
  const paddedSeq = String(seq).padStart(padding, '0')
  if (year) {
    return `${prefix}-${year}-${paddedSeq}`
  }
  return `${prefix}-${paddedSeq}`
}

/**
 * Parse a canonical code back into its components.
 * Returns null if the code doesn't match the expected format.
 *
 * Example:
 *   parseCanonicalCode('AST-000001') → { prefix: 'AST', seq: 1, year: undefined }
 *   parseCanonicalCode('WO-2026-00001') → { prefix: 'WO', seq: 1, year: 2026 }
 */
export function parseCanonicalCode(code: string): {
  prefix: string
  seq: number
  year?: number
} | null {
  // Match: PREFIX-YYYY-SEQ or PREFIX-SEQ
  const match = code.match(/^([A-Z]+)(?:-(\d{4}))?-(\d+)$/)
  if (!match) return null
  const [, prefix, yearStr, seqStr] = match
  return {
    prefix,
    seq: parseInt(seqStr, 10),
    year: yearStr ? parseInt(yearStr, 10) : undefined,
  }
}

/**
 * Map MasterItem category → canonical code prefix.
 * Used when generating new MasterItem codes for a category.
 */
export const CATEGORY_CODE_PREFIX: Record<string, CodeEntity> = {
  Site: 'SIT',
  Department: 'DEP',
  Affiliation: 'AFF',
  Building: 'BLD',
  Floor: 'FLR',
  Room: 'ROM',
  Status: 'STA',
  Priority: 'PRI',
  Unit: 'UNT',
  CostCenter: 'CCT',
  AssetCategory: 'ASC',
  DeviceType: 'TYP',
  DeviceGroup: 'DGP',
  Brand: 'BRD',
  Model: 'MDL',
  Condition: 'CND',
  OwnershipType: 'OWN',
  WarrantyType: 'WTY',
  ContractType: 'CTT',
  ContractNo: 'CTN',
  RepairGroup: 'RGP',
  RepairProblem: 'RPB',
  RepairResolution: 'RXS',
  RepairPriority: 'RPP',
  WorkOrderStatus: 'WOS',
  ServiceChannel: 'SCH',
  StockCategory: 'SCC',
  StockUnit: 'SU',
  StockPurpose: 'SPU',
  StockStatus: 'SSS',
  TransactionType: 'TT',
  Supplier: 'SUP',
}

/**
 * Get the prefix for a MasterItem category.
 */
export function getPrefixForCategory(category: string): string {
  return CATEGORY_CODE_PREFIX[category] || 'ITM'
}

/**
 * Check if a code is in canonical format (PREFIX-SEQ or PREFIX-YEAR-SEQ).
 * Note: MD-xxxx is the LEGACY format, NOT canonical — it's explicitly excluded.
 */
export function isCanonicalCode(code: string): boolean {
  // MD-xxxx is legacy, not canonical
  if (isLegacyCode(code)) return false
  return parseCanonicalCode(code) !== null
}

/**
 * Check if a code is a legacy MD-xxxx format.
 */
export function isLegacyCode(code: string): boolean {
  return /^MD-\d{4}$/.test(code)
}
