/**
 * smart-qr.ts — Smart QR Code System
 *
 * ออกแบบ QR Code ให้ฉลาดขึ้น:
 *   1. URL-based encoding — สแกนแล้วเปิด URL ได้ทันที (ทุกเบราว์เซอร์)
 *   2. Action-aware — สแกนแล้วรู้ว่าจะทำอะไร (แจ้งซ่อม, ดูข้อมูล, จดมิเตอร์)
 *   3. Context-aware — รู้ว่าเป็นอุปกรณ์หลักหรืออุปกรณ์ต่อพ่วง
 *   4. Trackable — เก็บประวัติการสแกน (audit log)
 *
 * QR Format:
 *   https://itam-next-js.vercel.app/qr/{type}/{id}?action={action}
 *
 *   type:     d = device (อุปกรณ์หลัก)
 *             a = accessory (อุปกรณ์ต่อพ่วง)
 *             s = site (สาขา)
 *             w = workorder (ใบงาน)
 *   id:       รหัสอุปกรณ์/accessory/site/workorder (short ID — 6 ตัวท้ายของ cuid)
 *   action:   repair = แจ้งซ่อม (default)
 *             view = ดูข้อมูล
 *             meter = จดมิเตอร์
 *             sticker = พิมพ์สติกเกอร์
 *             transfer = ย้ายอุปกรณ์
 *
 * ตัวอย่าง:
 *   https://itam-next-js.vercel.app/qr/d/a1b2c3?action=repair
 *   https://itam-next-js.vercel.app/qr/a/x9y8z7?action=view
 *   https://itam-next-js.vercel.app/qr/d/a1b2c3?action=meter
 *
 * Legacy QR (ยังรองรับของเดิม):
 *   - เลขทะเบียนเครื่อง (assetCode) เช่น "1081" หรือ "DEMO-DEV-001"
 *   - Serial number เช่น "PHCFD06265"
 *   - URL เดิมเช่น "?assetNo=1081" หรือ "?serial=PHCFD06265"
 */

export type QrType = 'd' | 'a' | 's' | 'w'
export type QrAction = 'repair' | 'view' | 'meter' | 'sticker' | 'transfer'

export interface SmartQrPayload {
  type: QrType
  id: string
  action: QrAction
  /** Full URL if it was a URL-based QR */
  url?: string
  /** Raw scanned value (for legacy support) */
  raw: string
  /** True if this is a legacy QR (not smart URL format) */
  isLegacy: boolean
}

function qrIdentifier(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid QR identifier')
  return id
}
const QR_ACTIONS: QrAction[] = ['repair', 'view', 'meter', 'sticker', 'transfer']
function qrAction(value: string | null): QrAction {
  return QR_ACTIONS.includes(value as QrAction) ? value as QrAction : 'repair'
}

/**
 * Generate a Smart QR URL for a device.
 * @param deviceId Full device ID (cuid) — preserved in full so printed QR identity cannot collide
 * @param action What should happen when scanned
 * @param baseUrl Optional base URL (defaults to current origin)
 */
export function generateDeviceQrUrl(
  deviceId: string,
  action: QrAction = 'repair',
  baseUrl?: string,
): string {
  const shortId = qrIdentifier(deviceId)
  const base = baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}/qr/d/${shortId}?action=${action}`
}

/**
 * Generate a Smart QR URL for an accessory.
 */
export function generateAccessoryQrUrl(
  accessoryId: string,
  action: QrAction = 'view',
  baseUrl?: string,
): string {
  const shortId = qrIdentifier(accessoryId)
  const base = baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}/qr/a/${shortId}?action=${action}`
}

/**
 * Generate QR data for sticker printing (URL string to encode).
 */
export function generateStickerQrData(
  type: QrType,
  id: string,
  action: QrAction = 'view',
  baseUrl?: string,
): string {
  const shortId = qrIdentifier(id)
  const base = baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}/qr/${type}/${shortId}?action=${action}`
}

/**
 * Parse a scanned QR value into a SmartQrPayload.
 *
 * Handles:
 *   1. Smart QR URLs: https://...vercel.app/qr/d/a1b2c3?action=repair
 *   2. Legacy asset codes: "1081", "DEMO-DEV-001"
 *   3. Legacy serial numbers: "PHCFD06265"
 *   4. Legacy URLs: "?assetNo=1081", "?serial=PHCFD06265"
 */
export function parseSmartQr(rawValue: string): SmartQrPayload {
  const raw = rawValue.trim()
  if (/^(https?:\/\/|\/|\?)/i.test(raw)) {
    try {
      const url = new URL(raw, 'https://qr.local')
      const match = /^\/qr\/([dasw])\/([A-Za-z0-9_-]{1,128})\/?$/i.exec(url.pathname)
      if (match) return { type: match[1].toLowerCase() as QrType, id: match[2], action: qrAction(url.searchParams.get('action')), url: raw, raw, isLegacy: false }
      for (const key of ['assetNo', 'assetCode', 'asset_no', 'serial']) {
        const id = url.searchParams.get(key)
        if (id) return { type: 'd', id, action: 'repair', url: raw, raw, isLegacy: true }
      }
    } catch { /* Malformed scans fall back to text; do not crash the scanner. */ }
  }
  return { type: 'd', id: raw, action: 'repair', raw, isLegacy: true }
}

/**
 * Resolve a SmartQrPayload to a device ID by querying the API.
 *
 * For Smart QR: use short ID to find full device ID
 * For Legacy: search by assetCode or serialNumber
 */
export async function resolveQrToDevice(
  payload: SmartQrPayload,
  token: string | null,
): Promise<{ deviceId: string; accessoryId?: string; notFound: boolean }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  if (!payload.isLegacy && payload.type === 'd') {
    // Smart QR — resolve short ID to full device ID
    const res = await fetch(`/api/devices/resolve?shortId=${encodeURIComponent(payload.id)}`, {
      headers,
    })
    if (res.ok) {
      const data = await res.json()
      if (data.deviceId) return { deviceId: data.deviceId, notFound: false }
    }
    return { deviceId: '', notFound: true }
  }

  if (!payload.isLegacy && payload.type === 'a') {
    // Smart QR — resolve accessory short ID
    const res = await fetch(`/api/devices/accessories/resolve?shortId=${encodeURIComponent(payload.id)}`, {
      headers,
    })
    if (res.ok) {
      const data = await res.json()
      if (data.accessoryId && data.parentDeviceId) {
        return { deviceId: data.parentDeviceId, accessoryId: data.accessoryId, notFound: false }
      }
    }
    return { deviceId: '', notFound: true }
  }

  // Exact/unique legacy identity; fuzzy search must never choose a repair target.
  const res = await fetch(`/api/devices/resolve?shortId=${encodeURIComponent(payload.id)}`, { headers })
  if (res.ok) {
    const data = await res.json()
    if (data.deviceId) return { deviceId: data.deviceId, notFound: false }
  }

  return { deviceId: '', notFound: true }
}

/**
 * Get the label for a QR action (for UI display).
 */
export function getActionLabel(action: QrAction): string {
  const labels: Record<QrAction, string> = {
    repair: 'แจ้งซ่อม',
    view: 'ดูข้อมูล',
    meter: 'จดมิเตอร์',
    sticker: 'พิมพ์สติกเกอร์',
    transfer: 'ย้ายอุปกรณ์',
  }
  return labels[action] ?? action
}

/**
 * Get the icon name for a QR type.
 */
export function getTypeLabel(type: QrType): string {
  const labels: Record<QrType, string> = {
    d: 'อุปกรณ์',
    a: 'อุปกรณ์ต่อพ่วง',
    s: 'สาขา',
    w: 'ใบงาน',
  }
  return labels[type] ?? type
}
