/**
 * Shared helpers for Stock UI tabs.
 *
 * Used by:
 *   - stock-dashboard.tsx
 *   - stock-inventory.tsx
 *   - stock-in-form.tsx
 *   - stock-out-form.tsx
 *   - stock-pending.tsx
 *   - stock-purchase-orders.tsx
 *   - stock-history.tsx
 *   - stock-summary.tsx
 *   - index.tsx
 *
 * Field names match the Prisma schema (camelCase): StockItem.productCode,
 * StockTransaction.type (IN/OUT/ADJUST), StockTransaction.approvalStatus
 * (PENDING/APPROVED/REJECTED), PurchaseOrder, PurchaseOrderItem.
 */

import { useAuthStore } from '@/store/auth-store'

// ── Types (mirror Prisma models; only fields the UI uses) ───────────────

export interface StockItem {
  id: string
  productCode: string
  productName: string
  category: string | null
  brand: string | null
  model: string | null
  unit: string
  quantity: number
  minQuantity: number
  maxQuantity: number
  unitCost: number | null
  totalValue: number | null
  location: string | null
  site: string | null
  compatibleDevices: string | null
  remark: string | null
  active: boolean
  lastUpdated: string | null
  createdAt: string
  updatedAt: string
  transactions?: StockTransaction[]
}

export interface StockTransaction {
  id: string
  txnNumber: string | null
  stockItemId: string
  productCode: string | null
  productName: string | null
  type: string // IN | OUT | ADJUST
  quantity: number
  unit: string | null
  balanceAfter: number
  reason: string | null
  requester: string | null
  department: string | null
  purpose: string | null
  approver: string | null
  approvedAt: string | null
  workOrderId: string | null
  workOrderNo: string | null
  deviceId: string | null
  cost: number | null
  unitCost: number | null
  vendor: string | null
  receiver: string | null
  purchaseOrderNo: string | null
  txnDate: string
  performedBy: string | null
  remark: string | null
  sourceKey: string | null
  processedFlag: string | null
  approvalStatus: string | null
  approvalMode: string | null
  autoApproveAt: string | null
  rejectReason: string | null
  createdAt: string
  stockItem?: {
    productCode: string
    productName: string
    unit: string
    quantity: number
    active: boolean
  }
}

export interface PurchaseOrder {
  id: string
  poNumber: string | null
  orderDate: string
  supplier: string | null
  status: string
  totalValue: number | null
  createdBy: string | null
  remark: string | null
  createdAt: string
  updatedAt: string
  items?: PurchaseOrderItem[]
}

export interface PurchaseOrderItem {
  id: string
  purchaseOrderId: string
  stockItemId: string
  quantityOrdered: number
  quantityReceived: number
  unitPrice: number | null
  totalValue: number | null
  stockItem?: {
    id: string
    productCode: string
    productName: string
    unit: string
    unitCost: number | null
  }
}

// ── Color theme ────────────────────────────────────────────────────────

export const ORANGE = '#f97316'
export const ORANGE_HOVER = '#ea580c'
export const TEAL = '#0d9488'
export const TEAL_HOVER = '#0f766e'

/** Tailwind class for the primary orange button (matching the existing UI). */
export const PRIMARY_BTN =
  'bg-[#f97316] hover:bg-[#ea580c] text-white'
export const ACCENT_BTN =
  'bg-[#0d9488] hover:bg-[#0f766e] text-white'

// ── Constants ──────────────────────────────────────────────────────────

/**
 * Category labels — maps DB values to Thai labels.
 * Now uses ProductCategory codes (PCAT-xxx) from MasterItem as the primary
 * system. Legacy codes (INK, TONER, etc.) are kept as fallbacks.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  // ProductCategory codes (from MasterItem — imported via Excel)
  'PCAT-001': 'หมึกและโทนเนอร์',
  'PCAT-002': 'ดรัมและชุดสร้างภาพ',
  'PCAT-003': 'ชุดบำรุงรักษา',
  'PCAT-004': 'อะไหล่ชุดป้อนกระดาษ',
  'PCAT-005': 'อะไหล่เครื่องสแกน',
  'PCAT-006': 'ฉลากและสติ๊กเกอร์',
  'PCAT-007': 'กระดาษ',
  'PCAT-008': 'วัสดุสำนักงาน',
  'PCAT-009': 'อุปกรณ์คอมพิวเตอร์และอุปกรณ์ต่อพ่วง',
  'PCAT-010': 'อุปกรณ์เครือข่าย',
  'PCAT-011': 'อะไหล่และวัสดุอื่น ๆ',
  // Legacy codes (fallback)
  INK: 'หมึกพิมพ์',
  TONER: 'ผงหมึก (Toner)',
  DRUM: 'ดรัม (Drum)',
  PAPER_MEDIA: 'กระดาษ',
  MAINTENANCE_KIT: 'ชุดบำรุงรักษา',
  STICKER_LABEL: 'สติกเกอร์/ฉลาก',
  OTHER: 'อื่น ๆ',
}

export function categoryLabel(cat: string | null | undefined): string {
  if (!cat) return 'อื่น ๆ'
  return CATEGORY_LABELS[cat] ?? cat
}

/**
 * Build category options from a list of distinct categories (from DB).
 * Always includes "ทุกหมวดหมู่" as the first option.
 */
export function buildCategoryOptions(categories: string[]): { value: string; label: string }[] {
  return [
    { value: 'all', label: 'ทุกหมวดหมู่' },
    ...categories.sort().map((c) => ({ value: c, label: categoryLabel(c) })),
  ]
}

/**
 * Build site options from API data (from /api/sites).
 * The API returns { sites: [{ id, code, name, ... }] } — we map to { value, label }.
 * Always includes "ทุกสาขา" as the first option.
 */
export function buildSiteOptions(
  sites: { code: string; name?: string | null }[] | { SiteCode: string; SiteName?: string | null }[],
): { value: string; label: string }[] {
  // Normalize: accept both { code, name } (API format) and { SiteCode, SiteName } (Prisma format)
  const normalized = sites.map((s) => {
    const code = (s as { code?: string; SiteCode?: string }).code ?? (s as { SiteCode?: string }).SiteCode ?? ''
    const name = (s as { name?: string; SiteName?: string }).name ?? (s as { SiteName?: string }).SiteName ?? null
    return { code: String(code), name }
  })
  return [
    { value: 'all', label: 'ทุกสาขา' },
    ...normalized
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((s) => ({
        value: s.code,
        label: `${s.code} — ${s.name ?? s.code}`,
      })),
  ]
}

export const TYPE_LABELS: Record<string, string> = {
  IN: 'รับเข้า',
  OUT: 'เบิกออก',
  ADJUST: 'ปรับปรุง',
}

export const TYPE_BADGES: Record<string, string> = {
  IN: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
  OUT: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  ADJUST: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800',
}

export const APPROVAL_LABELS: Record<string, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ปฏิเสธ',
}

export const APPROVAL_BADGES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
}

export const PO_STATUS_LABELS: Record<string, string> = {
  open: 'เปิด',
  partial: 'รับบางส่วน',
  received: 'รับครบแล้ว',
  cancelled: 'ยกเลิก',
}

export const PO_STATUS_BADGES: Record<string, string> = {
  open: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800',
  partial: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  received: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
  cancelled: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
}

// ── Format helpers ─────────────────────────────────────────────────────

export function formatBaht(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatInt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('th-TH')
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleString('th-TH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isLow(item: { minQuantity: number; quantity: number }): boolean {
  return item.minQuantity > 0 && item.quantity <= item.minQuantity
}

export function isOutOfStock(item: { quantity: number }): boolean {
  return item.quantity <= 0
}

export function truncate(s: string | null | undefined, n = 40): string {
  if (!s) return '—'
  return s.length > n ? s.slice(0, n) + '…' : s
}

// ── Auth headers ───────────────────────────────────────────────────────

/**
 * แปะ Bearer token ให้กับ /api/stock-items/* และ /api/purchase-orders
 * (ไม่ได้อยู่ใต้ /api/itam/* ที่มี global interceptor ครอบไว้)
 */
export function getAuthHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (typeof window !== 'undefined') {
    const token = useAuthStore.getState()?.token
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  if (extra) {
    const merged = new Headers(extra)
    merged.forEach((value, key) => {
      headers[key] = value
    })
  }
  return headers
}

/**
 * Convenience wrapper — calls fetch with auth headers attached and returns
 * parsed JSON. Throws Error with the server-supplied `error` message on
 * non-2xx responses.
 */
export async function authFetch<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const headers = getAuthHeaders(init?.headers as HeadersInit | undefined) as Record<string, string>
  const res = await fetch(url, { ...init, headers })
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) {
    const message = json?.error || `Request failed (${res.status})`
    throw new Error(message)
  }
  return json as T
}

// ── Query key factory ──────────────────────────────────────────────────

export const stockKeys = {
  all: ['stock-items'] as const,
  list: (params: Record<string, unknown>) => ['stock-items', 'list', params] as const,
  detail: (id: string) => ['stock-items', 'detail', id] as const,
  pending: (params: Record<string, unknown>) => ['stock-items', 'pending', params] as const,
  pendingSettings: ['stock-items', 'pending', 'settings'] as const,
  recentTxns: ['stock-items', 'recent-txns'] as const,
  poList: (params: Record<string, unknown>) => ['purchase-orders', 'list', params] as const,
  poDetail: (id: string) => ['purchase-orders', 'detail', id] as const,
}
