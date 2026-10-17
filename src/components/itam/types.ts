// Shared client-side types for ITAM app

export interface Device {
  id: string
  assetCode: string
  name: string
  brand: string
  model: string
  type: string
  serialNumber: string | null
  status: string
  site: string
  department: string | null
  departmentCode: string | null
  parentRef: string | null
  displayLabel: string | null
  location: string | null
  // โ”€โ”€ เธฃเธซเธฑเธชเธเธฃเธฐเธเธณ Site โ”€โ”€
  assetSiteCode?: string | null
  // โ”€โ”€ เธเนเธญเธกเธนเธฅเธ—เธตเนเธ•เธฑเนเธ โ”€โ”€
  building: string | null
  floor: string | null
  room: string | null
  // โ”€โ”€ เน€เธเธฃเธทเธญเธเนเธฒเธข โ”€โ”€
  ip: string | null
  mac: string | null
  remoteId: string | null
  // โ”€โ”€ เธเธฒเธฃเธเธทเนเธญ/เธฃเธฑเธเธเธฃเธฐเธเธฑเธ โ”€โ”€
  purchaseDate: string | null
  warrantyMonths: number
  warrantyEnd: string | null
  vendor: string | null
  contractNo: string | null
  uninstallDate: string | null
  // โ”€โ”€ เธกเธดเน€เธ•เธญเธฃเน โ”€โ”€
  meterRequired: boolean
  meterMode: string | null
  lastReadingMonth?: string | null
  // โ”€โ”€ Cascading master-data FKs (NEW โ€” populated by CascadingDropdown) โ”€โ”€
  typeId?: string | null
  brandId?: string | null
  modelId?: string | null
  // โ”€โ”€ เธญเธทเนเธเน โ”€โ”€
  costCenter: string | null
  deviceGroup: string | null
  remark: string | null
  /**
   * Last meter reading (BW) โ€” derived from the latest MeterReading row by
   * GET /api/devices (NOT the Device.lastMeterBw column, which may be
   * stale). Kept for backward-compat with older UI code that reads
   * `d.lastMeterReading`. Newer code should prefer `lastMeterBw`.
   */
  lastMeterReading: number
  /** Latest BW meter value โ€” the canonical field returned by the API. */
  lastMeterBw: number
  /** Latest color meter value โ€” the canonical field returned by the API. */
  lastMeterColor: number
  currentAssignee: string | null
  purchasePrice: number | null
  salvageValue: number | null
  usefulLife: number | null
  // โ”€โ”€ Device Set (Task ID 9) โ”€โ”€
  /** Self-FK to parent device if this device is part of a "set" (e.g. UPS attached to a printer). */
  parentDeviceId?: string | null
  /** Optional label for the whole set (e.g. "เธเธธเธ”เน€เธเธฃเธทเนเธญเธเธเธดเธกเธเนเธซเนเธญเธเธเนเธฒเธขเธขเธฒ"). */
  setLabel?: string | null
  /** 1-based position within the set. */
  setPosition?: number | null
  // โ”€โ”€ Device Replacement โ”€โ”€
  /** Self-FK to the device that replaced this one (if any). */
  replacedById?: string | null
  /** When this device was replaced (set together with replacedById). */
  replacedAt?: string | null
  /** Demo-data tag โ€” true for seeded demo records (used by replace API guard). */
  isDemo?: boolean
  createdAt: string
  updatedAt: string
}

export interface LicenseRecord {
  id: string
  licenseId: string | null
  assetCode: string | null
  software: string
  licenseType: string | null
  licenseKey: string | null
  quantity: number
  expiryDate: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface Assignment {
  id: string
  deviceId: string
  assignee: string
  assigneeRole: string | null
  department: string | null
  checkoutDate: string
  expectedReturnDate: string | null
  actualReturnDate: string | null
  status: string // 'active' | 'returned'
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface MasterItem {
  id: string
  category: string
  code: string
  label: string
  parentRef: string | null
  displayLabel: string | null
  siteCode: string | null
  createdAt: string
  updatedAt: string
}

export interface MeterReading {
  id: string
  deviceId: string
  reading: number
  prevReading: number
  date: string
  remark: string | null
  delta: number
  cycleId: string | null
  createdAt: string
  device?: Pick<Device, 'id' | 'name' | 'assetCode' | 'brand' | 'model'>
}

export interface Cycle {
  id: string
  name: string
  startDate: string
  endDate: string
  status: string
  /** Optional site code โ€” null means "all sites" (a global cycle). */
  site?: string | null
  createdAt: string
  updatedAt: string
}

export interface Site {
  id: string
  code: string
  name: string
  /** Optional โ€” only present when reading from the legacy `Site` table. */
  createdAt?: string
  /** Optional โ€” populated when reading from SiteAttribute. */
  lineOa?: string | null
  hotline?: string | null
  paperRateBw?: number | null
  paperRateColor?: number | null
}

export interface SiteRate {
  id: string
  siteCode: string
  siteName: string
  bwRate: number
  colorRate: number
  createdAt: string
  updatedAt: string
}

/**
 * เธ•เธฃเธงเธเธชเธญเธเธงเนเธฒ user เธเธเธเธตเนเธชเธฒเธกเธฒเธฃเธ–เน€เธฅเธทเธญเธเธเธฃเธญเธ Site เนเธ”เนเธซเธฃเธทเธญเนเธกเน
 *
 * เธซเธฅเธฑเธเธเธฒเธฃ:
 *   - superadmin / admin (allowedSites === 'ALL') โ’ เน€เธฅเธทเธญเธเนเธ”เน (เน€เธซเนเธเธ—เธธเธ site)
 *   - user เธ—เธตเนเธกเธต allowedSites เน€เธเนเธ list เธเธญเธ site codes:
 *       - เธ–เนเธฒเธกเธตเนเธเน 1 site โ’ เธเนเธญเธ dropdown (เนเธกเนเธกเธตเธเธฃเธฐเนเธขเธเธเน เน€เธเธฃเธฒเธฐเน€เธซเนเธเนเธเน site เน€เธ”เธตเธขเธง)
 *       - เธ–เนเธฒเธกเธต 2+ sites โ’ เนเธชเธ”เธ dropdown (เน€เธฅเธทเธญเธเธเธฃเธญเธเนเธ”เน)
 *   - user เธ—เธตเนเนเธกเนเธกเธต allowedSites เน€เธฅเธข โ’ เธเนเธญเธ dropdown (fail-closed)
 *
 * เนเธเนเนเธเธ—เธธเธเธซเธเนเธฒเธ—เธตเนเธกเธต Site filter dropdown เน€เธเธทเนเธญเธเธงเธเธเธธเธกเธเธฒเธฃเนเธชเธ”เธเธเธฅ
 * เธ•เธฒเธกเธชเธดเธ—เธเธดเนเธเธญเธ user โ€” เนเธกเนเนเธเนเนเธเน superadmin เธ–เธถเธเธเธฐเน€เธซเนเธ
 */
export function canSelectSite(user: {
  role: string
  allowedSites: string | null
}): boolean {
  const role = user.role?.toLowerCase() ?? ''
  if (role === 'superadmin' || role === 'admin') return true
  const raw = String(user.allowedSites ?? '').trim()
  if (!raw) return false
  // allowedSites format: comma-separated site codes ("UDH,NKP" or "UDH")
  const sites = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return sites.length > 1
}

/**
 * เธ”เธถเธเธฃเธฒเธขเธเธฒเธฃ site codes เธ—เธตเน user เธชเธฒเธกเธฒเธฃเธ–เน€เธเนเธฒเธ–เธถเธเนเธ”เน
 * เธเธทเธเธเนเธฒ null เธ–เนเธฒ user เน€เธเนเธ superadmin/admin (เน€เธซเนเธเธ—เธธเธ site)
 */
export function getAllowedSiteCodes(user: {
  role: string
  allowedSites: string | null
}): string[] | null {
  const role = user.role?.toLowerCase() ?? ''
  if (role === 'superadmin' || role === 'admin') return null
  const raw = String(user.allowedSites ?? '').trim()
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export type WarrantyStatus = 'active' | 'expiring' | 'expired' | 'unknown'

export interface WarrantyEntry {
  id: string
  assetCode: string
  name: string
  brand: string
  model: string
  site: string
  purchaseDate: string | null
  warrantyMonths: number
  warrantyExpiry: string | null
  status: WarrantyStatus
  daysUntilExpiry: number | null
}

export interface WarrantySummary {
  active: number
  expiring: number
  expired: number
  unknown: number
}

export interface CostAnalyticsRow {
  id: string
  assetCode: string
  name: string
  site: string
  sheets: number
  rate: number
  cost: number
}

export interface CostAnalyticsBySite {
  site: string
  cost: number
  sheets: number
}

export interface CostAnalyticsData {
  devices: CostAnalyticsRow[]
  totalCost: number
  totalSheets: number
  bySite: CostAnalyticsBySite[]
  range: {
    key: string
    start: string | null
    end: string | null
  }
}

// ---- Search result types ----
export interface SearchDeviceResult {
  type: 'device'
  id: string
  title: string
  subtitle: string
  url: null
}
export interface SearchMasterResult {
  type: 'master'
  id: string
  title: string
  subtitle: string
}
export interface SearchMeterResult {
  type: 'meter'
  id: string
  title: string
  subtitle: string
  deviceId: string
}
export interface SearchAuditResult {
  type: 'audit'
  id: string
  title: string
  subtitle: string
}
export interface SearchSiteResult {
  type: 'site'
  id: string
  title: string
  subtitle: string
}
// QA-ROUND-G feature: work-order + stock results from /api/search
export interface SearchWorkOrderResult {
  type: 'workorder'
  id: string
  title: string
  subtitle: string
}
export interface SearchStockResult {
  type: 'stock'
  id: string
  title: string
  subtitle: string
}
export interface SearchResults {
  devices: SearchDeviceResult[]
  master: SearchMasterResult[]
  workOrders: SearchWorkOrderResult[]
  stock: SearchStockResult[]
  meter: SearchMeterResult[]
  audit: SearchAuditResult[]
  sites: SearchSiteResult[]
}

// ---- Warranty helpers (client-side, used by devices-page and detail sheet) ----

/** Add `months` to a YYYY-MM-DD string, clamping to last day of target month. */
export function addMonthsISO(iso: string, months: number): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const d = new Date(iso.slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  const day = d.getDate()
  d.setMonth(d.getMonth() + months)
  if (d.getDate() < day) d.setDate(0)
  return d.toISOString().slice(0, 10)
}

export function computeWarranty(
  purchaseDate: string | null,
  warrantyMonths: number,
): {
  expiry: string | null
  status: WarrantyStatus
  daysUntilExpiry: number | null
} {
  const expiry = purchaseDate
    ? addMonthsISO(purchaseDate, warrantyMonths)
    : null
  if (!expiry) {
    return { expiry: null, status: 'unknown', daysUntilExpiry: null }
  }
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const exp = new Date(expiry + 'T00:00:00')
  const diffMs = exp.getTime() - today.getTime()
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24))
  if (days < 0) return { expiry, status: 'expired', daysUntilExpiry: days }
  if (days <= 30) return { expiry, status: 'expiring', daysUntilExpiry: days }
  return { expiry, status: 'active', daysUntilExpiry: days }
}

export function warrantyBadgeClass(status: WarrantyStatus): string {
  switch (status) {
    case 'active':
      return 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 transition-colors hover:scale-105'
    case 'expiring':
      return 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 transition-colors hover:scale-105 animate-pulse'
    case 'expired':
      return 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300 transition-colors hover:scale-105'
    case 'unknown':
    default:
      return 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 transition-colors hover:scale-105'
  }
}

export function warrantyLabel(status: WarrantyStatus): string {
  switch (status) {
    case 'active':
      return 'เธฃเธฑเธเธเธฃเธฐเธเธฑเธ'
    case 'expiring':
      return 'เนเธเธฅเนเธซเธกเธ”'
    case 'expired':
      return 'เธซเธกเธ”เนเธฅเนเธง'
    case 'unknown':
    default:
      return 'เนเธกเนเธฃเธฐเธเธธ'
  }
}

export function formatThaiDate(iso: string | null, lang: 'th' | 'en' = 'th'): string {
  if (!iso) return 'โ€”'
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

const MONTH_NAMES_TH = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];
const MONTH_NAMES_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Format YYYY-MM or YYYY-MM-DD as Thai month name + Buddhist year. */
export function formatMonthThai(value: string | null | undefined, lang: 'th' | 'en' = 'th'): string {
  if (!value) return '-'
  const s = String(value).trim()
  const m = s.match(/^(\d{4})-(\d{1,2})/)
  if (!m) return s
  const year = parseInt(m[1], 10)
  const monthIdx = parseInt(m[2], 10) - 1
  if (monthIdx < 0 || monthIdx > 11) return s
  const buddhistYear = lang === 'th' ? year + 543 : year
  const monthNames = lang === 'th' ? MONTH_NAMES_TH : MONTH_NAMES_EN
  return monthNames[monthIdx] + ' ' + buddhistYear
}

/** Format a datetime/iso string for compact display (e.g. table "เธญเธฑเธเน€เธ”เธ•เธฅเนเธฒเธชเธธเธ”"). */
export function formatDateTime(iso: string | null | undefined, lang: 'th' | 'en' = 'th'): string {
  if (!iso) return 'โ€”'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function formatBaht(value: number | null | undefined, lang: 'th' | 'en' = 'th'): string {
  // Defense-in-depth: never crash on null/undefined/NaN. Returns 'เธฟ0.00'
  // instead of throwing "Cannot read properties of undefined (reading
  // 'toLocaleString')". This protects 70+ call sites across the app
  // (stock, repairs, reports, dashboard, depreciation) from API field-name
  // drift or missing data.
  if (value == null || !Number.isFinite(value)) return 'เธฟ0.00'
  return `เธฟ${value.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export interface DashboardData {
  totals: { total: number; active: number; spare: number; repair: number }
  byStatus: Array<{ name: string; raw: string; value: number }>
  byType: Array<{ name: string; value: number }>
  topUsage: Array<{ id: string; name: string; assetCode: string; value: number }>
  recentActivity: Array<{
    id: string
    deviceName: string
    assetCode: string
    reading: number
    delta: number
    date: string
    remark: string | null
  }>
  paperThisMonth?: number
  range?: {
    key: string
    label: string
    start: string | null
    end: string | null
  }
}

export type DashboardRangeKey = 'month' | '30d' | 'quarter' | 'all'

export const DASHBOARD_RANGE_OPTIONS: {
  value: DashboardRangeKey
  label: string
  kpiLabel: string
  /** i18n key for the human label (resolved via t() at render time). */
  labelKey: string
  /** i18n key for the KPI card label (resolved via t() at render time). */
  kpiLabelKey: string
}[] = [
  { value: 'month', label: 'เน€เธ”เธทเธญเธเธเธตเน', kpiLabel: 'เธเธฃเธฐเธ”เธฒเธฉเน€เธ”เธทเธญเธเธเธตเน', labelKey: 'dash.range.month', kpiLabelKey: 'dash.range.kpi_month' },
  { value: '30d', label: '30 เธงเธฑเธเธฅเนเธฒเธชเธธเธ”', kpiLabel: 'เธเธฃเธฐเธ”เธฒเธฉ 30 เธงเธฑเธ', labelKey: 'dash.range.30d', kpiLabelKey: 'dash.range.kpi_30d' },
  { value: 'quarter', label: 'เนเธ•เธฃเธกเธฒเธชเธเธตเน', kpiLabel: 'เธเธฃเธฐเธ”เธฒเธฉเนเธ•เธฃเธกเธฒเธชเธเธตเน', labelKey: 'dash.range.quarter', kpiLabelKey: 'dash.range.kpi_quarter' },
  { value: 'all', label: 'เธ—เธฑเนเธเธซเธกเธ”', kpiLabel: 'เธเธฃเธฐเธ”เธฒเธฉเธ—เธฑเนเธเธซเธกเธ”', labelKey: 'dash.range.all', kpiLabelKey: 'dash.range.kpi_all' },
]

export interface AuditLog {
  id: string
  action: string
  entity: string
  entityId: string | null
  summary: string
  detail: string | null
  actor: string
  createdAt: string
}

export interface DeviceTransfer {
  id: string
  deviceId: string
  fromSite: string | null
  toSite: string
  fromDept: string | null
  toDept: string | null
  fromDeptCode: string | null
  toDeptCode: string | null
  reason: string | null
  transferDate: string
  createdAt: string
}

// ---- Lifecycle / Replacement planning ----
export type LifecycleRecommendation = 'replace' | 'monitor' | 'ok'

export interface LifecycleDevice {
  id: string
  assetCode: string
  name: string
  brand: string
  model: string
  site: string
  status: string
  purchaseDate: string | null
  ageInMonths: number
  warrantyStatus: WarrantyStatus
  warrantyExpiry: string | null
  replacementScore: number // 0-100
  recommendation: LifecycleRecommendation
}

export interface LifecycleSummary {
  total: number
  replace: number
  monitor: number
  ok: number
  avgAge: number
}

export interface LifecycleData {
  devices: LifecycleDevice[]
  summary: LifecycleSummary
}

export const DEVICE_STATUS_OPTIONS = [
  { value: 'active', label: 'เนเธเนเธเธฒเธเธญเธขเธนเน' },
  { value: 'spare', label: 'เธชเธณเธฃเธญเธ' },
  { value: 'repair', label: 'เธชเนเธเธเนเธญเธก' },
  { value: 'disposed', label: 'เธ•เธฑเธ”เธเธญเธเธญเธญเธ' },
] as const

export const MASTER_CATEGORIES = [
  'Department',
  'Status',
  'DeviceGroup',
  'DeviceClassification',
  'Site',
  'Affiliation',
  'RepairGroup',
  'RepairRequest',
  'RepairResolution',
  'Building',
  'Floor',
  'ContractNo',
  'Product',
  'ProductCategory',
  'Purpose',
  'StockSource',
  'Supplier',
] as const

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800 transition-colors hover:scale-105'
    case 'spare':
      return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 transition-colors hover:scale-105'
    case 'repair':
      return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800 transition-colors hover:scale-105'
    case 'disposed':
      return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800 transition-colors hover:scale-105'
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 transition-colors hover:scale-105'
  }
}

export function statusLabel(status: string): string {
  return DEVICE_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status
}

// ---- Depreciation tracking (straight-line) ----
export type DepreciationStatus = 'depreciated' | 'depreciating' | 'new'

export interface DepreciationDevice {
  id: string
  assetCode: string
  name: string
  brand: string
  model: string
  site: string
  purchasePrice: number
  salvageValue: number
  usefulLife: number
  purchaseDate: string | null
  ageInMonths: number
  annualDepreciation: number
  accumulatedDepreciation: number
  currentValue: number
  depreciationPercent: number
  status: DepreciationStatus
}

export interface DepreciationSummary {
  totalValue: number
  totalOriginal: number
  totalDepreciated: number
  avgDepreciationPercent: number
  fullyDepreciatedCount: number
  deviceCount: number
}

export interface DepreciationData {
  devices: DepreciationDevice[]
  summary: DepreciationSummary
}

export function depreciationBadgeClass(status: DepreciationStatus): string {
  switch (status) {
    case 'depreciated':
      return 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
    case 'depreciating':
      return 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
    case 'new':
    default:
      return 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
  }
}

export function depreciationLabel(status: DepreciationStatus): string {
  switch (status) {
    case 'depreciated':
      return 'เธซเธกเธ”เธญเธฒเธขเธธเธเธฒเธฃเนเธเนเธเธฒเธ'
    case 'depreciating':
      return 'เธเธณเธฅเธฑเธเน€เธชเธทเนเธญเธก'
    case 'new':
    default:
      return 'เนเธซเธกเน'
  }
}

// ---- Scheduled Reports ----
export type ReportType =
  | 'dashboard_summary'
  | 'cycle'
  | 'audit'
  | 'utilization'

export interface ReportListItem {
  id: string
  type: ReportType
  title: string
  rangeKey: string | null
  format: string
  createdAt: string
}

export interface ReportDetail extends ReportListItem {
  filters: unknown
  data: unknown
}

export const REPORT_TYPE_OPTIONS: {
  value: ReportType
  label: string
  icon: string
  supportsRange: boolean
}[] = [
  {
    value: 'dashboard_summary',
    label: 'เธชเธฃเธธเธ Dashboard',
    icon: 'LayoutDashboard',
    supportsRange: true,
  },
  { value: 'cycle', label: 'เธฃเธญเธเธเธ”เธกเธดเน€เธ•เธญเธฃเน', icon: 'Gauge', supportsRange: true },
  {
    value: 'audit',
    label: 'เธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธฃเนเธเนเธเธฒเธ',
    icon: 'History',
    supportsRange: true,
  },
  {
    value: 'utilization',
    label: 'เธเธฒเธฃเนเธเนเธเธฒเธเธญเธธเธเธเธฃเธ“เน',
    icon: 'Activity',
    supportsRange: true,
  },
]

export function reportTypeLabel(type: string): string {
  return (
    REPORT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type
  )
}

/** Returns a Thai relative-time string like "เน€เธกเธทเนเธญเธชเธฑเธเธเธฃเธนเน" / "5 เธเธฒเธ—เธตเธ—เธตเนเนเธฅเนเธง" / "2 เธเธก. เธ—เธตเนเนเธฅเนเธง" / "3 เธงเธฑเธเธ—เธตเนเนเธฅเนเธง". */
export function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return iso
    const now = Date.now()
    const diff = Math.max(0, now - then)
    const sec = Math.floor(diff / 1000)
    if (sec < 60) return 'เน€เธกเธทเนเธญเธชเธฑเธเธเธฃเธนเน'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min} เธเธฒเธ—เธตเธ—เธตเนเนเธฅเนเธง`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr} เธเธก. เธ—เธตเนเนเธฅเนเธง`
    const day = Math.floor(hr / 24)
    if (day < 30) return `${day} เธงเธฑเธเธ—เธตเนเนเธฅเนเธง`
    const mo = Math.floor(day / 30)
    if (mo < 12) return `${mo} เน€เธ”เธทเธญเธเธ—เธตเนเนเธฅเนเธง`
    const yr = Math.floor(mo / 12)
    return `${yr} เธเธตเธ—เธตเนเนเธฅเนเธง`
  } catch {
    return iso
  }
}

/**
 * BUG-REPORTS-003 fix: null-safe toLocaleString wrapper.
 * Prevents TypeError when value is null/undefined (common in report data
 * where aggregation returns null for empty results).
 *
 * Usage: replace `value.toLocaleString('th-TH')` with `safeLocaleString(value)`
 */
export function safeLocaleString(value: number | null | undefined, lang: 'th' | 'en' = 'th'): string {
  if (value == null || !Number.isFinite(value)) return '0'
  return value.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')
}
