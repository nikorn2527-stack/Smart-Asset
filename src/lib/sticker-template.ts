/**
 * sticker-template.ts — pure helpers for the Sticker System.
 *
 * This module is server-safe (it uses `qrcode` lazily inside an async render
 * function). Pure types + constants live here so the client editor component
 * can import them without bundling server-only code.
 */

import QRCode from 'qrcode'
import { generateStickerQrData } from '@/lib/smart-qr'

// ─── Types ────────────────────────────────────────────────────────────────

export type StickerElementType = 'text' | 'image' | 'qr' | 'rect'

export type OverflowMode = 'clip' | 'visible'

export interface StickerCanvas {
  width: number   // in mm
  height: number  // in mm
  unit: 'mm'
}

export interface StickerElement {
  id: string
  type: StickerElementType
  /** X position in mm (top-left origin) */
  x: number
  /** Y position in mm (top-left origin) */
  y: number
  /** Width in mm */
  width: number
  /** Height in mm */
  height: number
  /** Opacity 0–1 */
  opacity?: number
  /** Stacking order (higher = front) */
  zIndex?: number
  /** Rotation in degrees */
  rotation?: number
  // Text-only props
  fontSize?: number   // pt
  fontWeight?: number // 100..900
  color?: string      // hex / css color
  align?: 'left' | 'center' | 'right'
  /** Vertical alignment for text elements */
  valign?: 'top' | 'center' | 'bottom'
  /** For text: the text content with {{variables}}. For image: src url. For qr: data to encode. */
  content?: string
  /** Optional source identifier (e.g. for image — same as content but kept separate to allow future ref types) */
  source?: string
  // Rect-only props
  background?: string
  border?: string
  borderRadius?: number
}

export interface StickerTemplate {
  id: string
  name: string
  isDefault: boolean
  canvas: StickerCanvas
  overflow: OverflowMode
  elements: StickerElement[]
}

export interface StickerSettings {
  companyName: string
  /**
   * Generic org-name field shown on the sticker header (right side).
   * Renamed from `hospitalName` → `orgName` in HOSPITALNAME-TERMINOLOGY-FIX-019
   * so the field name no longer implies a hospital (it stores any org name).
   * DB storage key is now `stickerOrgName` (with backward-compat read of
   * the old `stickerHospitalName` key — see sticker-settings-store.ts).
   */
  orgName: string
  /**
   * Terminology used for assets on sticker labels (e.g. "ครุภัณฑ์" / "ทรัพย์สิน").
   * Used by the `{{AssetTerminology}}` template variable so default sticker
   * templates can read it instead of hardcoding "ครุภัณฑ์". Populated at
   * runtime from OrganizationProfile.assetTerminology by the
   * `/api/itam/sticker/settings` GET route.
   */
  assetTerminology?: string
  footerNote: string
  hotline: string
  lineOALink: string
}

export const DEFAULT_STICKER_SETTINGS: StickerSettings = {
  companyName: 'Your Organization',
  orgName: 'ชื่อองค์กร',  // generic — user sets their own name in Settings
  assetTerminology: 'ครุภัณฑ์',
  footerNote: 'ห้ามนำอุปกรณ์ออกจากพื้นที่ — กรุณาติดต่อ IT หากพบปัญหา',
  hotline: '000-000-0000',
  lineOALink: '@your-org',
}

// ─── 19 supported variables (mirror of Apps Script Section 6 + {{QrUrl}}) ─
export const STICKER_VARIABLES: string[] = [
  '{{companyName}}',
  '{{orgName}}',
  '{{AssetTerminology}}',
  '{{AssetNo}}',
  '{{AssetSiteCode}}',
  '{{Serial}}',
  '{{Type}}',
  '{{Brand}}',
  '{{Model}}',
  '{{Building}}',
  '{{Floor}}',
  '{{Room}}',
  '{{Department}}',
  '{{DepartmentCode}}',
  '{{Location}}',
  '{{Site}}',
  '{{ContractNo}}',
  '{{Vendor}}',
  '{{hotline}}',
  '{{footerNote}}',
  '{{lineOA}}',
  '{{DeviceStatus}}',
  '{{CurrentAssignee}}',
  '{{WarrantyEnd}}',
  '{{PurchaseDate}}',
  '{{PurchasePrice}}',
  '{{Ip}}',
  '{{Mac}}',
  '{{QrUrl}}',
  // License variables (auto-generated based on device's licenses)
  '{{LicenseCount}}',
  '{{LicenseList}}',
  '{{License1_Software}}',
  '{{License1_Key}}',
  '{{License1_Type}}',
  '{{License1_Expiry}}',
  '{{License2_Software}}',
  '{{License2_Key}}',
  '{{License2_Type}}',
  '{{License2_Expiry}}',
  '{{License3_Software}}',
  '{{License3_Key}}',
  '{{License3_Type}}',
  '{{License3_Expiry}}',
]

// ─── Sample device used by the editor Preview modal ───────────────────────
export const SAMPLE_DEVICE: StickerDeviceData = {
  // Sample cuid so {{QrUrl}} renders a real-looking URL in the editor preview.
  id: 'clxxxxxxxxxxxxxxxxxxxxxxxx',
  assetCode: 'IT-00001',
  assetSiteCode: 'UDH-00001',
  serialNumber: 'SN12345678',
  type: 'PRINTER',
  brand: 'HP',
  model: 'LaserJet Pro M404',
  building: 'อาคาร A',
  floor: '1',
  room: 'ห้อง 101',
  department: 'ฝ่ายเทคโนโลยีสารสนเทศ',
  departmentCode: 'IT-001',
  location: 'ห้องประชุม 1',
  site: 'สำนักงานใหญ่',
  contractNo: 'CTR-2025-001',
  vendor: 'Your Vendor Co.,Ltd',
  status: 'Active',
  currentAssignee: 'คุณสมชาย',
  warrantyEnd: '2025-12-31',
  purchaseDate: '2024-01-15',
  purchasePrice: '15000',
  ip: '192.168.1.10',
  mac: 'AA:BB:CC:DD:EE:FF',
  // Sample licenses for {{LicenseList}} and {{LicenseN_*}} variables
  licenses: [
    { software: 'Microsoft Office 365', licenseKey: 'XXXX-XXXX-XXXX', licenseType: 'Subscription', expiryDate: '2025-12-31' },
    { software: 'Adobe Acrobat Pro', licenseKey: 'YYYY-YYYY-YYYY', licenseType: 'Volume', expiryDate: '2026-06-30' },
  ],
}

// ─── License data for multi-license sticker variables ───────────────────
export interface StickerLicenseData {
  software: string
  licenseKey: string | null
  licenseType: string | null
  expiryDate: string | null
}

// ─── Device data shape used for variable substitution ────────────────────
export interface StickerDeviceData {
  /** Full device id (cuid) — needed to generate Smart QR URL for {{QrUrl}}. */
  id?: string
  assetCode: string
  assetSiteCode: string | null
  serialNumber: string | null
  type: string | null
  brand: string | null
  model: string | null
  building: string | null
  floor: string | null
  room: string | null
  department: string | null
  departmentCode: string | null
  location: string | null
  site: string | null
  contractNo: string | null
  vendor: string | null
  status: string | null
  currentAssignee: string | null
  warrantyEnd: string | null
  purchaseDate: string | null
  purchasePrice: string | number | null
  ip: string | null
  mac: string | null
  /** Licenses associated with this device (for {{LicenseList}}, {{LicenseN_*}}) */
  licenses?: StickerLicenseData[]
}

/**
 * Convert a raw device record (from DB or API) into a StickerDeviceData
 * object suitable for sticker template rendering.
 *
 * This is the SINGLE SOURCE OF TRUTH for field mapping. Previously,
 * there were 3 separate implementations:
 *   1. sticker-print-dialog.tsx deviceToStickerData() — 19 fields ✅
 *   2. api/itam/sticker/render/route.ts — 14 fields ❌ (missing 9)
 *   3. api/itam/sticker/bulk-render/route.ts — 14 fields ❌ (missing 9)
 *
 * The API routes were missing: room, status, currentAssignee, warrantyEnd,
 * purchaseDate, purchasePrice, ip, mac, licenses — causing printed stickers
 * to show blank where the preview showed data (because the dialog used #1
 * but print used #2/#3).
 *
 * Now all 3 callers use this shared function, so preview and print always
 * match.
 *
 * @param d — any object with device fields (Prisma Device row or API response)
 * @param licenses — optional array of license data for {{LicenseList}} etc.
 */
export function deviceToStickerData<T extends Record<string, unknown>>(
  d: T,
  licenses: StickerLicenseData[] = [],
): StickerDeviceData {
  return {
    id: (d.id as string) ?? undefined,
    assetCode: (d.assetCode as string) ?? '',
    assetSiteCode: (d.assetSiteCode as string) ?? null,
    serialNumber: (d.serialNumber as string) ?? null,
    type: (d.type as string) ?? null,
    brand: (d.brand as string) ?? null,
    model: (d.model as string) ?? null,
    building: (d.building as string) ?? null,
    floor: (d.floor as string) ?? null,
    room: (d.room as string) ?? null,
    department: (d.department as string) ?? null,
    departmentCode: (d.departmentCode as string) ?? null,
    location: (d.location as string) ?? null,
    site: (d.site as string) ?? null,
    contractNo: (d.contractNo as string) ?? null,
    vendor: (d.vendor as string) ?? null,
    status: (d.status as string) ?? null,
    currentAssignee: (d.currentAssignee as string) ?? null,
    warrantyEnd: (d.warrantyEnd as string) ?? null,
    purchaseDate: (d.purchaseDate as string) ?? null,
    purchasePrice: (d.purchasePrice as string | number | null) ?? null,
    ip: (d.ip as string) ?? null,
    mac: (d.mac as string) ?? null,
    licenses,
  }
}

// ─── ID generator ────────────────────────────────────────────────────────
let _seq = 0
export function genElementId(prefix = 'el'): string {
  _seq += 1
  return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}`
}

export function genTemplateId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ─── Build the 17-element default template (matches Apps Script) ──────────
// Accepts an optional `canvas` so the same template can be re-laid out for
// different sticker sizes (A4, A5, label sizes, custom). When omitted, the
// original 75.2 × 36 mm default canvas is used (backward-compat with all
// existing callers — e.g. `getStickerTemplates()` seeding).
export function buildDefaultTemplate(canvas?: StickerCanvas): StickerTemplate {
  const c = canvas ?? { width: 75.2, height: 36, unit: 'mm' }
  const W = c.width
  const H = c.height
  // Scale factor relative to the original 75.2 × 36 design. We scale by the
  // smaller axis so fonts stay readable on any aspect ratio.
  const u = Math.min(W / 75.2, H / 36)
  const elements: StickerElement[] = [
    // 1 — header bar
    {
      id: genElementId(),
      type: 'rect',
      x: 0, y: 0, width: W, height: 5 * u,
      background: '#f97316',
      zIndex: 0,
    },
    // 2 — companyName (left of header)
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: 0.6 * u, width: 40 * u, height: 3.8 * u,
      content: '{{companyName}}',
      fontSize: 9, fontWeight: 800, color: '#ffffff', align: 'left',
      zIndex: 1,
    },
    // 3 — orgName (right of header) — generic org name (renamed from hospitalName)
    {
      id: genElementId(),
      type: 'text',
      x: W - 33.2 * u, y: 0.6 * u, width: 32 * u, height: 3.8 * u,
      content: '{{orgName}}',
      fontSize: 6.5, fontWeight: 600, color: '#ffffff', align: 'right',
      zIndex: 1,
    },
    // 4 — AssetNo label
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: 6 * u, width: 30 * u, height: 2 * u,
      content: 'Asset No.',
      fontSize: 5, fontWeight: 500, color: '#64748b', align: 'left',
      zIndex: 1,
    },
    // 5 — AssetNo value (large)
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: 8 * u, width: 45 * u, height: 4 * u,
      content: '{{AssetNo}}',
      fontSize: 11, fontWeight: 800, color: '#f97316', align: 'left',
      zIndex: 1,
    },
    // 6 — AssetSiteCode label
    {
      id: genElementId(),
      type: 'text',
      x: W - 28.2 * u, y: 6 * u, width: 27 * u, height: 2 * u,
      content: 'Site Code',
      fontSize: 5, fontWeight: 500, color: '#64748b', align: 'right',
      zIndex: 1,
    },
    // 7 — AssetSiteCode value
    {
      id: genElementId(),
      type: 'text',
      x: W - 28.2 * u, y: 8 * u, width: 27 * u, height: 4 * u,
      content: '{{AssetSiteCode}}',
      fontSize: 10, fontWeight: 800, color: '#0d9488', align: 'right',
      zIndex: 1,
    },
    // 8 — Brand + Model
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: 12.5 * u, width: Math.min(50 * u, W - 25 * u), height: 2.5 * u,
      content: '{{Brand}} {{Model}}',
      fontSize: 6.5, fontWeight: 700, color: '#1e293b', align: 'left',
      zIndex: 1,
    },
    // 9 — Type + Serial
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: 15 * u, width: Math.min(50 * u, W - 25 * u), height: 2.5 * u,
      content: '{{Type}} · SN: {{Serial}}',
      fontSize: 5.5, fontWeight: 500, color: '#475569', align: 'left',
      zIndex: 1,
    },
    // 10 — Site / Building / Floor
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: 17.5 * u, width: Math.min(50 * u, W - 25 * u), height: 2.5 * u,
      content: '{{Site}} / อาคาร {{Building}} / ชั้น {{Floor}}',
      fontSize: 5.5, fontWeight: 500, color: '#475569', align: 'left',
      zIndex: 1,
    },
    // 11 — Department
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: 20 * u, width: Math.min(50 * u, W - 25 * u), height: 2.5 * u,
      content: '{{Department}} ({{DepartmentCode}})',
      fontSize: 5.5, fontWeight: 500, color: '#475569', align: 'left',
      zIndex: 1,
    },
    // 12 — Location
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: 22.5 * u, width: Math.min(50 * u, W - 25 * u), height: 2.5 * u,
      content: 'ที่ตั้ง: {{Location}}',
      fontSize: 5.5, fontWeight: 500, color: '#475569', align: 'left',
      zIndex: 1,
    },
    // 13 — Contract / Vendor
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: 25 * u, width: Math.min(50 * u, W - 25 * u), height: 2.5 * u,
      content: 'สัญญา: {{ContractNo}} · ผู้ขาย: {{Vendor}}',
      fontSize: 5, fontWeight: 500, color: '#64748b', align: 'left',
      zIndex: 1,
    },
    // 14 — hotline + "สแกน QR เพื่อแจ้งซ่อม"
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: 27.5 * u, width: Math.min(50 * u, W - 25 * u), height: 2.5 * u,
      content: 'สแกน QR เพื่อแจ้งซ่อม · โทร {{hotline}}',
      fontSize: 5.5, fontWeight: 700, color: '#f97316', align: 'left',
      zIndex: 1,
    },
    // 15 — QR code (right side, below header)
    // Uses {{QrUrl}} (Smart QR URL) so phone cameras open the ITAM repair
    // page on scan. Legacy templates using {{AssetNo}} still work.
    {
      id: genElementId(),
      type: 'qr',
      x: W - 22.2 * u, y: 13 * u, width: 21 * u, height: 21 * u,
      content: '{{QrUrl}}',
      zIndex: 1,
    },
    // 16 — footer divider
    {
      id: genElementId(),
      type: 'rect',
      x: 1.5 * u, y: H - 5.5 * u, width: W - 3 * u, height: 0.2 * u,
      background: '#cbd5e1',
      zIndex: 0,
    },
    // 17 — footerNote
    {
      id: genElementId(),
      type: 'text',
      x: 1.5 * u, y: H - 5 * u, width: W - 3 * u, height: 4 * u,
      content: '{{footerNote}}',
      fontSize: 4.5, fontWeight: 500, color: '#94a3b8', align: 'center',
      zIndex: 1,
    },
  ]

  return {
    id: 'tpl-default',
    name: 'เทมเพลตเริ่มต้น (Default)',
    isDefault: true,
    canvas: c,
    overflow: 'clip',
    elements,
  }
}

// ─── Minimal template — org name + asset code + brand/model + QR only ────
export function buildMinimalTemplate(canvas: StickerCanvas): StickerTemplate {
  const W = canvas.width
  const H = canvas.height
  const headerH = Math.max(4, H * 0.12)
  const qrSize = Math.min(W * 0.32, (H - headerH) * 0.85)
  const qrX = W - qrSize - W * 0.025
  const qrY = headerH + Math.max(0, ((H - headerH) - qrSize) / 2)
  const leftW = Math.max(10, qrX - W * 0.025)
  const startX = W * 0.025
  const rowH = Math.max(2.5, H * 0.08)

  const elements: StickerElement[] = [
    { id: genElementId(), type: 'rect', x: 0, y: 0, width: W, height: headerH, background: '#f97316', zIndex: 0 },
    {
      id: genElementId(), type: 'text',
      x: startX, y: headerH * 0.2, width: W * 0.7, height: headerH * 0.6,
      content: '{{companyName}}', fontSize: Math.max(7, headerH * 0.65),
      fontWeight: 800, color: '#ffffff', align: 'left', zIndex: 1,
    },
    {
      id: genElementId(), type: 'text',
      x: startX, y: headerH + H * 0.04, width: leftW, height: rowH * 1.5,
      content: '{{AssetNo}}', fontSize: Math.max(11, H * 0.14),
      fontWeight: 800, color: '#f97316', align: 'left', zIndex: 1,
    },
    {
      id: genElementId(), type: 'text',
      x: startX, y: headerH + H * 0.04 + rowH * 1.5, width: leftW, height: rowH,
      content: '{{orgName}}', fontSize: Math.max(6, H * 0.08),
      fontWeight: 600, color: '#1e293b', align: 'left', zIndex: 1,
    },
    {
      id: genElementId(), type: 'text',
      x: startX, y: headerH + H * 0.04 + rowH * 2.5, width: leftW, height: rowH,
      content: '{{Brand}} {{Model}}', fontSize: Math.max(6, H * 0.08),
      fontWeight: 500, color: '#475569', align: 'left', zIndex: 1,
    },
    {
      id: genElementId(), type: 'qr',
      x: qrX, y: qrY, width: qrSize, height: qrSize,
      content: '{{QrUrl}}', zIndex: 1,
    },
  ]

  return {
    id: 'tpl-minimal',
    name: 'มินิมอล (Minimal)',
    isDefault: false,
    canvas,
    overflow: 'clip',
    elements,
  }
}

// ─── QR-only template — asset code + large QR + scan hint ─────────────────
export function buildQrOnlyTemplate(canvas: StickerCanvas): StickerTemplate {
  const W = canvas.width
  const H = canvas.height
  const topH = Math.max(6, H * 0.18)
  const bottomH = Math.max(4, H * 0.12)
  const qrSize = Math.min(W * 0.7, H - topH - bottomH - 2)
  const qrX = (W - qrSize) / 2
  const qrY = topH + Math.max(0, (H - topH - bottomH - qrSize) / 2)

  const elements: StickerElement[] = [
    {
      id: genElementId(), type: 'text',
      x: W * 0.05, y: topH * 0.2, width: W * 0.9, height: topH * 0.7,
      content: '{{AssetNo}}', fontSize: Math.max(10, topH * 0.6),
      fontWeight: 800, color: '#f97316', align: 'center', zIndex: 1,
    },
    {
      id: genElementId(), type: 'qr',
      x: qrX, y: qrY, width: qrSize, height: qrSize,
      content: '{{QrUrl}}', zIndex: 1,
    },
    {
      id: genElementId(), type: 'text',
      x: W * 0.05, y: H - bottomH, width: W * 0.9, height: bottomH * 0.9,
      content: 'สแกน QR เพื่อแจ้งซ่อม', fontSize: Math.max(6, bottomH * 0.5),
      fontWeight: 700, color: '#475569', align: 'center', zIndex: 1,
    },
  ]

  return {
    id: 'tpl-qr-only',
    name: 'เฉพาะ QR (QR Only)',
    isDefault: false,
    canvas,
    overflow: 'clip',
    elements,
  }
}

// ─── Compact template — key fields (asset / brand / site / location) + QR ─
export function buildCompactTemplate(canvas: StickerCanvas): StickerTemplate {
  const W = canvas.width
  const H = canvas.height
  const headerH = Math.max(4, H * 0.12)
  const qrSize = Math.min(W * 0.32, (H - headerH) * 0.7)
  const qrX = W - qrSize - W * 0.025
  const qrY = headerH + Math.max(0, ((H - headerH) - qrSize) / 2)
  const leftW = Math.max(10, qrX - W * 0.025)
  const startX = W * 0.025
  const rowH = Math.max(2.5, H * 0.085)
  let y = headerH + H * 0.03

  function nextRow(content: string, fontSize: number, fontWeight: number, color: string): StickerElement {
    const el: StickerElement = {
      id: genElementId(), type: 'text',
      x: startX, y, width: leftW, height: rowH,
      content, fontSize, fontWeight, color, align: 'left', zIndex: 1,
    }
    y += rowH + 0.5
    return el
  }

  const elements: StickerElement[] = [
    { id: genElementId(), type: 'rect', x: 0, y: 0, width: W, height: headerH, background: '#f97316', zIndex: 0 },
    {
      id: genElementId(), type: 'text',
      x: startX, y: headerH * 0.2, width: W * 0.7, height: headerH * 0.6,
      content: '{{companyName}}', fontSize: Math.max(7, headerH * 0.65),
      fontWeight: 800, color: '#ffffff', align: 'left', zIndex: 1,
    },
    {
      id: genElementId(), type: 'text',
      x: startX, y, width: leftW, height: rowH * 1.5,
      content: '{{AssetNo}}', fontSize: Math.max(11, H * 0.14),
      fontWeight: 800, color: '#f97316', align: 'left', zIndex: 1,
    },
  ]
  y += rowH * 1.5 + 0.5
  elements.push(
    nextRow('{{orgName}}', Math.max(6, H * 0.08), 600, '#1e293b'),
    nextRow('{{Brand}} {{Model}}', Math.max(6, H * 0.08), 500, '#475569'),
    nextRow('{{Type}} · SN: {{Serial}}', Math.max(5.5, H * 0.07), 500, '#64748b'),
    nextRow('{{Site}} / อาคาร {{Building}} / ชั้น {{Floor}}', Math.max(5.5, H * 0.07), 500, '#475569'),
    nextRow('{{Department}} ({{DepartmentCode}})', Math.max(5.5, H * 0.07), 500, '#475569'),
  )
  elements.push({
    id: genElementId(), type: 'qr',
    x: qrX, y: qrY, width: qrSize, height: qrSize,
    content: '{{QrUrl}}', zIndex: 1,
  })

  return {
    id: 'tpl-compact',
    name: 'กระชับ (Compact)',
    isDefault: false,
    canvas,
    overflow: 'clip',
    elements,
  }
}

// ─── Detailed template — default + contract/vendor + hotline (larger) ────
// Same as default but laid out for medium-large canvases (>= A7) — for very
// small label sizes, fall back to compact instead.
export function buildDetailedTemplate(canvas: StickerCanvas): StickerTemplate {
  const W = canvas.width
  const H = canvas.height
  const headerH = Math.max(5, H * 0.13)
  const qrSize = Math.min(W * 0.3, (H - headerH) * 0.55)
  const qrX = W - qrSize - W * 0.025
  const qrY = headerH + Math.max(0, ((H - headerH) - qrSize) / 2)
  const leftW = Math.max(15, qrX - W * 0.025)
  const startX = W * 0.025
  const rowH = Math.max(2.5, H * 0.075)
  let y = headerH + H * 0.03

  function nextRow(content: string, fontSize: number, fontWeight: number, color: string): StickerElement {
    const el: StickerElement = {
      id: genElementId(), type: 'text',
      x: startX, y, width: leftW, height: rowH,
      content, fontSize, fontWeight, color, align: 'left', zIndex: 1,
    }
    y += rowH + 0.4
    return el
  }

  const elements: StickerElement[] = [
    { id: genElementId(), type: 'rect', x: 0, y: 0, width: W, height: headerH, background: '#f97316', zIndex: 0 },
    {
      id: genElementId(), type: 'text',
      x: startX, y: headerH * 0.2, width: W * 0.7, height: headerH * 0.6,
      content: '{{companyName}}', fontSize: Math.max(7, headerH * 0.65),
      fontWeight: 800, color: '#ffffff', align: 'left', zIndex: 1,
    },
    {
      id: genElementId(), type: 'text',
      x: W - qrX, y: headerH * 0.2, width: qrX - W * 0.025, height: headerH * 0.6,
      content: '{{orgName}}', fontSize: Math.max(6, headerH * 0.5),
      fontWeight: 600, color: '#ffffff', align: 'right', zIndex: 1,
    },
    {
      id: genElementId(), type: 'text',
      x: startX, y, width: leftW, height: rowH * 1.5,
      content: '{{AssetNo}}', fontSize: Math.max(11, H * 0.13),
      fontWeight: 800, color: '#f97316', align: 'left', zIndex: 1,
    },
    {
      id: genElementId(), type: 'text',
      x: qrX, y, width: qrSize, height: rowH,
      content: '{{AssetSiteCode}}', fontSize: Math.max(7, H * 0.09),
      fontWeight: 700, color: '#0d9488', align: 'right', zIndex: 1,
    },
  ]
  y += rowH * 1.5 + 0.5
  elements.push(
    nextRow('{{Brand}} {{Model}}', Math.max(7, H * 0.08), 700, '#1e293b'),
    nextRow('{{Type}} · SN: {{Serial}}', Math.max(6, H * 0.07), 500, '#475569'),
    nextRow('{{Site}} / อาคาร {{Building}} / ชั้น {{Floor}}', Math.max(6, H * 0.07), 500, '#475569'),
    nextRow('{{Department}} ({{DepartmentCode}})', Math.max(6, H * 0.07), 500, '#475569'),
    nextRow('ที่ตั้ง: {{Location}}', Math.max(6, H * 0.07), 500, '#475569'),
    nextRow('สัญญา: {{ContractNo}} · ผู้ขาย: {{Vendor}}', Math.max(5.5, H * 0.06), 500, '#64748b'),
    nextRow('สแกน QR เพื่อแจ้งซ่อม · โทร {{hotline}}', Math.max(6, H * 0.07), 700, '#f97316'),
  )
  elements.push({
    id: genElementId(), type: 'qr',
    x: qrX, y: qrY, width: qrSize, height: qrSize,
    content: '{{QrUrl}}', zIndex: 1,
  })
  // Footer note + divider
  elements.push(
    {
      id: genElementId(), type: 'rect',
      x: startX, y: H - H * 0.13, width: W - 2 * startX, height: 0.2,
      background: '#cbd5e1', zIndex: 0,
    },
    {
      id: genElementId(), type: 'text',
      x: startX, y: H - H * 0.1, width: W - 2 * startX, height: H * 0.09,
      content: '{{footerNote}}', fontSize: Math.max(4.5, H * 0.05),
      fontWeight: 500, color: '#94a3b8', align: 'center', zIndex: 1,
    },
  )

  return {
    id: 'tpl-detailed',
    name: 'ละเอียด (Detailed)',
    isDefault: false,
    canvas,
    overflow: 'clip',
    elements,
  }
}

// ─── Sticker size presets (paper / label sizes) ────────────────────────────
export interface StickerSizePreset {
  id: string
  label: string
  /** Width in mm (0 means "use custom width field") */
  width: number
  /** Height in mm (0 means "use custom height field") */
  height: number
}

export const STICKER_SIZE_PRESETS: StickerSizePreset[] = [
  { id: 'default', label: '75.2 × 36 mm (default)', width: 75.2, height: 36 },
  { id: 'a4', label: 'A4 (210 × 297 mm)', width: 210, height: 297 },
  { id: 'a5', label: 'A5 (148 × 210 mm)', width: 148, height: 210 },
  { id: 'a7', label: 'A7 (74 × 105 mm)', width: 74, height: 105 },
  { id: 'label-50x30', label: 'Label 50 × 30 mm', width: 50, height: 30 },
  { id: 'label-60x40', label: 'Label 60 × 40 mm', width: 60, height: 40 },
  { id: 'label-100x50', label: 'Label 100 × 50 mm', width: 100, height: 50 },
  { id: 'square-50', label: 'Square 50 × 50 mm', width: 50, height: 50 },
  // ── Continuous label tape widths (Brother PT-P950NW / Dymo) ──
  // Height = 0 means "auto" (continuous feed — height follows content)
  { id: 'tape-12', label: 'เทปม้วน 12 mm (Brother/Dymo)', width: 12, height: 0 },
  { id: 'tape-18', label: 'เทปม้วน 18 mm', width: 18, height: 0 },
  { id: 'tape-24', label: 'เทปม้วน 24 mm', width: 24, height: 0 },
  { id: 'tape-29', label: 'เทปม้วน 29 mm', width: 29, height: 0 },
  { id: 'tape-36', label: 'เทปม้วน 36 mm (Brother PT-P950NW)', width: 36, height: 0 },
  { id: 'tape-50', label: 'เทปม้วน 50 mm', width: 50, height: 0 },
  { id: 'custom', label: 'กำหนดเอง...', width: 0, height: 0 },
]

// ─── Sticker template presets (form layouts) ──────────────────────────────
export interface StickerTemplatePreset {
  id: string
  label: string
  /** Returns a fresh StickerTemplate laid out for the given canvas size. */
  build: (canvas: StickerCanvas) => StickerTemplate
}

export const STICKER_TEMPLATE_PRESETS: StickerTemplatePreset[] = [
  { id: 'default', label: 'ดีฟอลต์ (ครบทุกฟิลด์)', build: (c) => buildDefaultTemplate(c) },
  { id: 'minimal', label: 'มินิมอล (เฉพาะ asset + ชื่อ + QR)', build: (c) => buildMinimalTemplate(c) },
  { id: 'qr-only', label: 'เฉพาะ QR (สำหรับสแกน)', build: (c) => buildQrOnlyTemplate(c) },
  { id: 'compact', label: 'กระชับ (ฟิลด์สำคัญ)', build: (c) => buildCompactTemplate(c) },
  { id: 'detailed', label: 'ละเอียด (รวม contract + vendor)', build: (c) => buildDetailedTemplate(c) },
]

// ─── Resolve a (presetId, customW, customH) tuple into a StickerCanvas ────
export function resolveStickerCanvas(
  presetId: string,
  customWidth: number,
  customHeight: number,
): StickerCanvas {
  if (presetId === 'custom') {
    const w = Math.max(10, Math.min(500, Number(customWidth) || 75.2))
    const h = Math.max(10, Math.min(500, Number(customHeight) || 36))
    return { width: w, height: h, unit: 'mm' }
  }
  const preset = STICKER_SIZE_PRESETS.find((p) => p.id === presetId)
  if (!preset || preset.width <= 0) {
    return { width: 75.2, height: 36, unit: 'mm' }
  }
  // Continuous label tape (height=0): use a default height of 36mm
  // The actual height will be determined by the printer (continuous feed).
  // We use 36mm as a reasonable default for preview — the @page CSS will
  // tell the printer the exact dimensions.
  if (preset.height <= 0) {
    return { width: preset.width, height: 36, unit: 'mm' }
  }
  return { width: preset.width, height: preset.height, unit: 'mm' }
}

// ─── Build License1-3 variables from device.licenses array ─────────────
function buildLicenseVars(licenses: StickerLicenseData[] | undefined): Record<string, string> {
  const v: Record<string, string> = {}
  if (!licenses || licenses.length === 0) return v
  for (let i = 0; i < Math.min(3, licenses.length); i++) {
    const lic = licenses[i]
    const n = i + 1
    v[`{{License${n}_Software}}`] = lic.software || ''
    v[`{{License${n}_Key}}`] = lic.licenseKey || ''
    v[`{{License${n}_Type}}`] = lic.licenseType || ''
    v[`{{License${n}_Expiry}}`] = lic.expiryDate || ''
  }
  return v
}

// ─── Variable substitution ────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, '&#96;')
}

export function substituteVariables(
  text: string,
  device: StickerDeviceData | null,
  settings: StickerSettings,
): string {
  const v: Record<string, string> = {
    '{{companyName}}': settings.companyName || '',
    '{{orgName}}': settings.orgName || '',
    '{{AssetTerminology}}': settings.assetTerminology || 'ครุภัณฑ์',
    '{{AssetNo}}': device?.assetCode || '',
    '{{AssetSiteCode}}': device?.assetSiteCode || '',
    '{{Serial}}': device?.serialNumber || '',
    '{{Type}}': device?.type || '',
    '{{Brand}}': device?.brand || '',
    '{{Model}}': device?.model || '',
    '{{Building}}': device?.building || '',
    '{{Floor}}': device?.floor || '',
    '{{Room}}': device?.room || '',
    '{{Department}}': device?.department || '',
    '{{DepartmentCode}}': device?.departmentCode || '',
    '{{Location}}': device?.location || '',
    '{{Site}}': device?.site || '',
    '{{ContractNo}}': device?.contractNo || '',
    '{{Vendor}}': device?.vendor || '',
    '{{hotline}}': settings.hotline || '',
    '{{footerNote}}': settings.footerNote || '',
    '{{lineOA}}': settings.lineOALink || '',
    '{{DeviceStatus}}': device?.status || '',
    '{{CurrentAssignee}}': device?.currentAssignee || '',
    '{{WarrantyEnd}}': device?.warrantyEnd || '',
    '{{PurchaseDate}}': device?.purchaseDate || '',
    '{{PurchasePrice}}': device?.purchasePrice != null ? `฿${Number(device.purchasePrice).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
    '{{Ip}}': device?.ip || '',
    '{{Mac}}': device?.mac || '',
    '{{QrUrl}}': device?.id
      ? generateStickerQrData('d', device.id, 'repair')
      : device?.assetCode || '',
    // ── License variables (auto-generated from device.licenses) ──
    '{{LicenseCount}}': device?.licenses?.length ? String(device.licenses.length) : '0',
    '{{LicenseList}}': device?.licenses?.length
      ? device.licenses.map((l, i) => `${i + 1}. ${l.software}${l.licenseKey ? ` (${l.licenseKey})` : ''}${l.expiryDate ? ` หมดอายุ: ${l.expiryDate}` : ''}`).join('\n')
      : '',
    // License1-3: auto-generate from device.licenses array
    ...buildLicenseVars(device?.licenses),
  }
  let out = text
  for (const [k, val] of Object.entries(v)) {
    out = out.split(k).join(val)
  }
  return out
}

// ─── Render a single element to HTML ─────────────────────────────────────
function renderElement(
  el: StickerElement,
  device: StickerDeviceData | null,
  settings: StickerSettings,
  qrCache: Map<string, string>,
): string {
  const opacity = el.opacity ?? 1
  const zIndex = el.zIndex ?? 0
  const rotation = el.rotation ?? 0
  const baseStyle = [
    'position:absolute',
    `left:${el.x}mm`,
    `top:${el.y}mm`,
    `width:${el.width}mm`,
    `height:${el.height}mm`,
    `opacity:${opacity}`,
    `z-index:${zIndex}`,
    rotation ? `transform:rotate(${rotation}deg)` : '',
  ].filter(Boolean).join(';')

  if (el.type === 'text') {
    const raw = el.content ?? ''
    const substituted = substituteVariables(raw, device, settings)
    const fontSize = el.fontSize ?? 6
    const fontWeight = el.fontWeight ?? 500
    const color = el.color ?? '#1e293b'
    const align = el.align ?? 'left'
    const valign = el.valign ?? 'top'
    // Use flexbox for both horizontal + vertical alignment.
    // flex-direction:column + justify-content controls vertical (valign).
    // text-align controls horizontal (align) for multi-line text.
    const justifyCss = valign === 'center' ? 'center' : valign === 'bottom' ? 'flex-end' : 'flex-start'
    // white-space: pre-wrap so multi-line content (\n) is preserved.
    return `<div class="stk-el stk-text" style="${baseStyle};display:flex;flex-direction:column;justify-content:${justifyCss};font-size:${fontSize}pt;font-weight:${fontWeight};color:${color};text-align:${align};overflow:hidden;line-height:1.15;white-space:pre-wrap;word-break:break-word"><span style="display:block;width:100%">${escapeHtml(substituted)}</span></div>`
  }

  if (el.type === 'rect') {
    const bg = el.background ?? 'transparent'
    const border = el.border ?? 'none'
    const radius = el.borderRadius ?? 0
    return `<div class="stk-el stk-rect" style="${baseStyle};background:${bg};border:${border};border-radius:${radius}mm"></div>`
  }

  if (el.type === 'image') {
    const src = el.source || el.content || ''
    if (!src) {
      return `<div class="stk-el stk-image" style="${baseStyle};background:#f1f5f9;border:1px dashed #cbd5e1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:6pt">(image)</div>`
    }
    return `<img class="stk-el stk-image" src="${escapeAttr(src)}" alt="" style="${baseStyle};object-fit:contain" />`
  }

  if (el.type === 'qr') {
    // QR data: substitute variables into the content (e.g. '{{AssetNo}}')
    const data = substituteVariables(el.content ?? '', device, settings) || device?.assetCode || ''
    const cached = qrCache.get(data)
    if (cached) {
      return `<img class="stk-el stk-qr" src="${cached}" alt="QR" style="${baseStyle};object-fit:contain" />`
    }
    // No cached QR — render a placeholder (the caller should pre-generate QRs)
    return `<div class="stk-el stk-qr" style="${baseStyle};background:#f8fafc;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:5pt">QR</div>`
  }

  return ''
}

// ─── Pre-generate QR codes for all QR elements in a template ─────────────
export async function preGenerateQrCodes(
  template: StickerTemplate,
  device: StickerDeviceData | null,
  settings: StickerSettings,
): Promise<Map<string, string>> {
  const cache = new Map<string, string>()
  const dataKeys = new Set<string>()
  for (const el of template.elements) {
    if (el.type !== 'qr') continue
    const data = substituteVariables(el.content ?? '', device, settings) || device?.assetCode || ''
    if (!data) continue
    dataKeys.add(data)
  }
  for (const data of dataKeys) {
    try {
      const url = await QRCode.toDataURL(data, {
        margin: 1,
        width: 240,
        errorCorrectionLevel: 'M',
      })
      cache.set(data, url)
    } catch {
      // skip on error
    }
  }
  return cache
}

// ─── Render full sticker HTML (inside container) ─────────────────────────
export async function renderStickerFromTemplate(
  device: StickerDeviceData | null,
  template: StickerTemplate,
  settings: StickerSettings,
  options: { qrCache?: Map<string, string> } = {},
): Promise<{ html: string; qrDataUrls: Record<string, string> }> {
  // 1) Pre-generate QR codes (or use provided cache)
  const qrCache = options.qrCache ?? await preGenerateQrCodes(template, device, settings)

  // 2) Sort elements by zIndex then by id for stable order
  const sorted = [...template.elements].sort((a, b) => {
    const za = a.zIndex ?? 0
    const zb = b.zIndex ?? 0
    if (za !== zb) return za - zb
    return a.id.localeCompare(b.id)
  })

  // 3) Render
  const body = sorted
    .map((el) => renderElement(el, device, settings, qrCache))
    .filter(Boolean)
    .join('\n')

  const overflowCss = template.overflow === 'visible' ? 'visible' : 'hidden'

  const html = `<div class="stk-sticker" style="position:relative;width:${template.canvas.width}mm;height:${template.canvas.height}mm;background:#ffffff;overflow:${overflowCss};box-sizing:border-box;font-family:'Sukhumvit Set','Noto Sans Thai','Tahoma','Segoe UI',sans-serif">${body}</div>`

  // Convert Map → plain object for JSON serialization
  const qrDataUrls: Record<string, string> = {}
  for (const [k, v] of qrCache.entries()) qrDataUrls[k] = v

  return { html, qrDataUrls }
}

// ─── Auto-calculate columns for bulk print ───────────────────────────────
// A4 portrait = 210mm × 297mm. A4 landscape = 297mm × 210mm.
// We pick orientation based on which dimension of the page best fits.
export function calculateGridColumns(
  templateWidth: number,
  pageWidth: number,
  gap: number = 4,
  margin: number = 8,
): number {
  if (templateWidth <= 0) return 1
  const usable = pageWidth - 2 * margin + gap
  const cols = Math.floor(usable / (templateWidth + gap))
  return Math.max(1, cols)
}

// ─── Build a full standalone print document HTML ─────────────────────────
//
// Page-size strategy (STICKER-CUSTOM-SIZE):
//   - 'auto' (default): if the sticker canvas is large (>= A5 area), use the
//     canvas itself as the page (one sticker per page, label-printer mode).
//     Otherwise use A4 with a grid layout (cols × auto-rows).
//   - 'a4':    always A4 with grid.
//   - 'canvas': always canvas-size page (one sticker per page).
//
// The `@page` size + orientation are set to match the chosen page size, and
// the .page grid uses the canvas dimensions for the cells.
export type StickerPageSizeMode = 'auto' | 'a4' | 'canvas'

export function buildPrintDocument(
  stickersHtml: string[],
  template: StickerTemplate,
  cols: number,
  options: { pageSizeMode?: StickerPageSizeMode } = {},
): string {
  const { width, height } = template.canvas
  // Page orientation: if width > height, use landscape
  const orientation = width > height ? 'landscape' : 'portrait'
  const gap = 4
  const margin = 8

  const mode: StickerPageSizeMode = options.pageSizeMode ?? 'auto'
  // ALWAYS use canvas-as-page mode: each sticker prints on its own page
  // sized exactly to the sticker's canvas dimensions. This matches the
  // old Apps Script app behavior and works correctly with label printers
  // (Brother PT-P950NW etc.) which expect the page size to match the
  // label size.
  const useCanvasAsPage = true

  let pageWidthMm: number
  let pageHeightMm: number
  let pageMarginMm: number
  let colsEffective: number
  let pageGapMm: number

  if (useCanvasAsPage) {
    // One sticker per page; canvas == page.
    pageWidthMm = width
    pageHeightMm = height
    pageMarginMm = 0
    colsEffective = 1
    pageGapMm = 0
  } else {
    // A4 sheet with grid layout.
    pageWidthMm = orientation === 'landscape' ? 297 : 210
    pageHeightMm = orientation === 'landscape' ? 210 : 297
    pageMarginMm = margin
    colsEffective = Math.max(1, cols)
    pageGapMm = gap
  }

  // CSS `@page size` keyword. Use 'A4' for the standard sheet; otherwise
  // emit explicit mm dimensions (works for label printers + non-standard sizes).
  const pageSizeCss =
    useCanvasAsPage
      ? `${pageWidthMm}mm ${pageHeightMm}mm`
      : `A4 ${orientation}`

  // Build the grid CSS. When using canvas-as-page, the grid is 1 column (no
  // gap); otherwise it's a real grid with the requested cols.
  const gridTemplate = useCanvasAsPage
    ? `grid-template-columns: ${width}mm; grid-auto-rows: ${height}mm; gap: 0;`
    : `grid-template-columns: repeat(${colsEffective}, ${width}mm); grid-auto-rows: ${height}mm; gap: ${pageGapMm}mm;`

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>สติกเกอร์อุปกรณ์ IT</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: "Sukhumvit Set","Noto Sans Thai","Tahoma","Segoe UI",sans-serif;
    color: #1e293b;
    background: #ffffff;
  }
  .page {
    padding: ${pageMarginMm}mm;
    display: grid;
    ${gridTemplate}
    justify-content: start;
  }
  .stk-sticker {
    border: 1px dashed #cbd5e1;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .stk-sticker + .stk-sticker { /* keep spacing tidy */ }
  @media print {
    @page {
      size: ${pageSizeCss};
      margin: ${pageMarginMm}mm;
    }
    body { background: #ffffff; }
    .page { padding: 0; gap: ${pageGapMm}mm; }
    .stk-sticker { border: none; }
  }
  /* screen preview tweak */
  @media screen {
    body { background: #e2e8f0; padding: 12px; }
    .page { background: #ffffff; box-shadow: 0 4px 12px rgba(15,23,42,0.08); }
  }
</style>
</head>
<body>
  <div class="page">
    ${stickersHtml.join('\n')}
  </div>
</body>
</html>`
}

// ─── Sanitize/normalize an incoming template object ───────────────────────
export function normalizeTemplate(input: unknown): StickerTemplate {
  const obj = (input ?? {}) as Partial<StickerTemplate>
  const canvas = (obj.canvas ?? {}) as Partial<StickerCanvas>
  return {
    id: String(obj.id ?? genTemplateId()),
    name: String(obj.name ?? 'เทมเพลตใหม่').slice(0, 100),
    isDefault: !!obj.isDefault,
    canvas: {
      width: Number(canvas.width) > 0 ? Number(canvas.width) : 75.2,
      height: Number(canvas.height) > 0 ? Number(canvas.height) : 36,
      unit: 'mm',
    },
    overflow: obj.overflow === 'visible' ? 'visible' : 'clip',
    elements: Array.isArray(obj.elements)
      ? obj.elements.map((el) => normalizeElement(el))
      : [],
  }
}

export function normalizeElement(input: unknown): StickerElement {
  const el = (input ?? {}) as Partial<StickerElement>
  return {
    id: String(el.id ?? genElementId()),
    type: (['text', 'image', 'qr', 'rect'].includes(el.type as string)
      ? (el.type as StickerElementType)
      : 'text'),
    x: Number(el.x) || 0,
    y: Number(el.y) || 0,
    width: Number(el.width) || 10,
    height: Number(el.height) || 4,
    opacity: typeof el.opacity === 'number' ? Math.min(1, Math.max(0, el.opacity)) : 1,
    zIndex: typeof el.zIndex === 'number' ? el.zIndex : 0,
    rotation: typeof el.rotation === 'number' ? el.rotation : 0,
    fontSize: typeof el.fontSize === 'number' ? el.fontSize : 6,
    fontWeight: typeof el.fontWeight === 'number' ? el.fontWeight : 500,
    color: typeof el.color === 'string' ? el.color : '#1e293b',
    align: (['left', 'center', 'right'].includes(el.align as string)
      ? (el.align as 'left' | 'center' | 'right')
      : 'left'),
    content: typeof el.content === 'string' ? el.content : '',
    source: typeof el.source === 'string' ? el.source : '',
    background: typeof el.background === 'string' ? el.background : '',
    border: typeof el.border === 'string' ? el.border : '',
    borderRadius: typeof el.borderRadius === 'number' ? el.borderRadius : 0,
  }
}

// ─── Paper size presets (mirror of Apps Script dropdown) ─────────────────
export interface PaperPreset {
  label: string
  width: number
  height: number
}
export const PAPER_PRESETS: PaperPreset[] = [
  { label: '75.2 × 36 mm', width: 75.2, height: 36 },
  { label: '50 × 30 mm', width: 50, height: 30 },
  { label: '70 × 40 mm', width: 70, height: 40 },
  { label: '100 × 50 mm', width: 100, height: 50 },
]

// ─── Check whether an element exceeds the canvas bounds ──────────────────
export function elementExceedsBounds(el: StickerElement, canvas: StickerCanvas): boolean {
  return (
    el.x < 0 ||
    el.y < 0 ||
    el.x + el.width > canvas.width + 0.01 ||
    el.y + el.height > canvas.height + 0.01
  )
}
