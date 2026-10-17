'use client'

/**
 * DeviceSetChildrenSection — ส่วน "อุปกรณ์ในชุด"
 *
 * Device Set (Task ID 9, Phase 2) คือกลไก group อุปกรณ์เข้าด้วยกันผ่าน
 * self-FK `parentDeviceId` บนตาราง Device — เช่น "เครื่องพิมพ์ห้องจ่ายยา" เป็น
 * parent และมี children คือ UPS, network card, ถาดกระดาษเสริม
 *
 * Component นี้แสดง:
 *   1. `DeviceSetChildrenSection` — รายการอุปกรณ์ในชุด (children ของ device นี้)
 *   2. `DeviceSetParentBanner` — แบนเนอร์ "อุปกรณ์นี้อยู่ในชุดของ: …"
 *      (แสดงเฉพาะเมื่อ device นี้เป็น child มี parentDeviceId)
 *
 * รองรับทั้งโหมด controlled (ผู้เรียกส่ง `initialChildren` มาเลย — เช่นกรณี
 * device-detail-sheet fetch ผ่าน react-query อยู่แล้ว) และโหมด self-fetch
 * (ถ้าไม่ส่ง `initialChildren` component จะยิง GET /api/devices?parentDeviceId=… เอง)
 *
 * ใช้ normalizeStatus จาก src/lib/status-utils.ts เพื่อ map status string ที่หลากหลาย
 * (Active / ACTIVE / ใช้งาน / ปกติ) ให้เป็น canonical value ก่อน render badge สี
 */

import * as React from 'react'
import {
  Box,
  Layers3,
  Link2,
  ExternalLink,
  ArrowUpRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { normalizeStatus } from '@/lib/status-utils'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

// ── Types ───────────────────────────────────────────────────────────
export interface DeviceSetChild {
  id: string
  assetCode: string
  name: string
  brand?: string | null
  model?: string | null
  type: string
  status: string
  setPosition?: number | null
}

export interface DeviceSetChildrenSectionProps {
  /** ID ของ parent device ที่ต้องการดู children */
  deviceId: string
  /** ชื่อชุด (ถ้ามี) — แสดงเป็น badge ข้าง header */
  setLabel?: string | null
  /**
   * ถ้าผู้เรียก fetch children มาแล้ว (เช่น react-query ใน device-detail-sheet)
   * ส่งผ่าน prop นี้มาเลย — component จะข้ามการ fetch เอง
   */
  initialChildren?: DeviceSetChild[]
  /** โหลดอยู่? (เฉพาะกรณีส่ง initialChildren — ใช้สำหรับ loading state) */
  loading?: boolean
  /** คลิก child row → callback */
  onChildClick?: (childId: string) => void
  /** Auth token (ถ้าไม่ส่ง จะดึงจาก useAuthStore เอง) */
  token?: string | null
}

export interface DeviceSetParentBannerProps {
  /** Parent device ที่อ้างอิง — ใช้สร้างปุ่ม "ไปที่อุปกรณ์หลัก" */
  parentDevice: {
    id: string
    assetCode: string
    name: string
  }
  /** ชื่อชุดของ device ปัจจุบัน (child) — แสดงใต้ parent name */
  setLabel?: string | null
  /** ตำแหน่งของ device นี้ในชุด (child) */
  setPosition?: number | null
  /** คลิก "ไปที่อุปกรณ์หลัก" → callback */
  onOpenParent?: (parentId: string) => void
}

// ── Status → color mapping (uses normalizeStatus for canonical form) ──
function statusBadgeClassFor(canonical: string): string {
  switch (canonical) {
    case 'Active':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
    case 'Spare':
      return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
    case 'In Repair':
      return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800'
    case 'Inactive':
      return 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600'
    case 'Retired':
    case 'Disposed':
      return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800'
    case 'Lost':
      return 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800'
    default:
      // Unknown canonical (e.g. 'In Stock') — neutral slate
      return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  }
}

function statusLabelFor(canonical: string): string {
  // Map canonical → Thai label (อิงจาก DEVICE_STATUS_OPTIONS ใน types.ts แต่ขยายรองรับ
  // canonical values ทั้งหมดที่ normalizeStatus อาจ return)
  const map: Record<string, string> = {
    Active: 'ใช้งานอยู่',
    Inactive: 'ไม่ใช้งาน',
    'In Repair': 'ส่งซ่อม',
    Spare: 'สำรอง',
    Retired: 'ปลดระวาง',
    Disposed: 'จำหน่าย',
    Lost: 'สูญหาย',
  }
  return map[canonical] ?? canonical
}

// ── DeviceSetChildrenSection ────────────────────────────────────────
export function DeviceSetChildrenSection({
  deviceId,
  setLabel,
  initialChildren,
  loading: initialLoading,
  onChildClick,
  token: tokenProp,
}: DeviceSetChildrenSectionProps) {
  const authToken = useAuthStore((s) => s.token)
  const token = tokenProp !== undefined ? tokenProp : authToken

  const [fetchedChildren, setFetchedChildren] = React.useState<DeviceSetChild[]>([])
  const [fetchLoading, setFetchLoading] = React.useState(false)
  const [fetchedSetLabel, setFetchedSetLabel] = React.useState<string | null>(null)

  // ── Self-fetch mode: ถ้าไม่ได้ส่ง initialChildren มา ให้ fetch เอง ──
  // ใช้ GET /api/devices?parentDeviceId=<id> ที่รองรับ Device Set filter
  // (เพิ่มใน PUBLIC-QR-PHASE-1 — ดู src/app/api/devices/route.ts บรรทัด 73-145)
  //
  // ใช้ `let cancelled` flag แทนการ setFetchLoading(true) ใน effect body โดยตรง
  // เพื่อหลีกเลี่ยง react-hooks/set-state-in-effect warning — setState ทั้งหมด
  // เกิดขึ้นใน callback ของ fetch (async, ไม่ใช่ synchronous ใน effect body)
  const shouldSelfFetch = initialChildren === undefined

  React.useEffect(() => {
    if (!shouldSelfFetch || !deviceId) return
    let cancelled = false
    // Mark loading ผ่าน microtask defer ไม่ใช่ synchronous setState
    Promise.resolve().then(() => {
      if (!cancelled) setFetchLoading(true)
    })
    fetch(`/api/devices?parentDeviceId=${encodeURIComponent(deviceId)}&limit=100`, {
      headers: bearerHeaders(token),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fetch failed'))))
      .then((json: { devices?: Array<DeviceSetChild & { setLabel?: string | null }> }) => {
        if (cancelled) return
        const list = (json.devices ?? []).slice()
        // Sort by setPosition ถ้ามี (null ไปอยู่ท้าย); ถ้าไม่มีเลยใช้ลำดับที่ได้จาก API
        list.sort((a, b) => {
          const pa = typeof a.setPosition === 'number' ? a.setPosition : Number.MAX_SAFE_INTEGER
          const pb = typeof b.setPosition === 'number' ? b.setPosition : Number.MAX_SAFE_INTEGER
          return pa - pb
        })
        setFetchedChildren(list)
        // Pick setLabel จาก child ตัวแรกที่มีค่า (fallback)
        setFetchedSetLabel(list.find((c) => c.setLabel)?.setLabel ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setFetchedChildren([])
      })
      .finally(() => {
        if (cancelled) return
        setFetchLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [deviceId, shouldSelfFetch, token])

  const children = shouldSelfFetch ? fetchedChildren : initialChildren ?? []
  const loading = shouldSelfFetch ? fetchLoading : Boolean(initialLoading)
  // ใช้ setLabel ที่ส่งเข้ามาเป็นหลัก ถ้าไม่มีค่อย fallback ไปใช้ setLabel ที่ fetch ได้จาก children
  const effectiveSetLabel = setLabel !== undefined ? setLabel : fetchedSetLabel

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Layers3 className="h-4 w-4 text-[#0d9488] dark:text-[#14b8a6]" />
          <span>อุปกรณ์ในชุด</span>
          {effectiveSetLabel ? (
            <span className="truncate text-xs font-normal text-slate-500 dark:text-slate-400">
              : {effectiveSetLabel}
            </span>
          ) : null}
          <span className="text-xs font-normal text-muted-foreground">
            ({children.length})
          </span>
        </CardTitle>
        {effectiveSetLabel && (
          <Badge className="border-[#0d9488]/30 bg-[#0d9488]/10 text-[10px] text-[#0d9488] dark:border-[#14b8a6]/30 dark:bg-[#14b8a6]/10 dark:text-[#14b8a6]">
            📦 {effectiveSetLabel}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="py-4 text-center text-xs text-muted-foreground">กำลังโหลด...</p>
        ) : children.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 py-6 text-center dark:border-slate-700">
            <Box className="h-8 w-8 text-slate-300 dark:text-slate-400" />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              ยังไม่มีอุปกรณ์ในชุด
            </span>
            <span className="px-6 text-[10px] text-slate-400 dark:text-slate-500">
              อุปกรณ์ในชุด = เครื่องเสริมที่อ้างอิงเครื่องนี้เป็น parent (เช่น UPS, network card, ถาดกระดาษเสริม)
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {children.map((child, idx) => {
              const canonical = normalizeStatus(child.status)
              const position =
                typeof child.setPosition === 'number' ? child.setPosition : idx + 1
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => onChildClick?.(child.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-2.5 text-left transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50"
                  title="เปิดรายละเอียดอุปกรณ์ในชุด"
                >
                  {/* Position badge */}
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-teal-50 text-xs font-semibold text-teal-600 dark:bg-teal-950/40 dark:text-teal-300">
                    #{position}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* assetCode (monospace, primary) */}
                      <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {child.assetCode}
                      </span>
                      {/* status badge (color-coded via normalizeStatus) */}
                      <Badge
                        className={`px-1.5 py-0 text-[10px] ${statusBadgeClassFor(canonical)}`}
                      >
                        {statusLabelFor(canonical)}
                      </Badge>
                    </div>
                    {/* name (bold) */}
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {child.name}
                    </div>
                    {/* brand + model + type chip */}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                      {(child.brand || child.model) && (
                        <span className="truncate">
                          {child.brand ?? ''}
                          {child.brand && child.model ? ' ' : ''}
                          {child.model ?? ''}
                        </span>
                      )}
                      {child.type && (
                        <Badge
                          variant="outline"
                          className="px-1.5 py-0 text-[10px] text-slate-600 dark:text-slate-300"
                        >
                          {child.type}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-slate-400 dark:text-slate-500" />
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── DeviceSetParentBanner ───────────────────────────────────────────
/**
 * แบนเนอร์ "อุปกรณ์นี้อยู่ในชุดของ: …"
 * แสดงเฉพาะเมื่อ device ปัจจุบันมี parentDeviceId (เป็น child ของ set)
 *
 * คลิก → onOpenParent(parentId) — ปกติจะ close sheet ปัจจุบันแล้วเปิด parent
 */
export function DeviceSetParentBanner({
  parentDevice,
  setLabel,
  setPosition,
  onOpenParent,
}: DeviceSetParentBannerProps) {
  return (
    <button
      type="button"
      onClick={() => onOpenParent?.(parentDevice.id)}
      className="flex w-full items-center gap-2 rounded-md border border-[#0d9488]/40 bg-[#0d9488]/5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[#0d9488]/10 dark:border-[#14b8a6]/40 dark:bg-[#14b8a6]/10 dark:hover:bg-[#14b8a6]/15"
      title="เปิดรายละเอียดอุปกรณ์หลักในชุด"
    >
      <Link2 className="h-4 w-4 flex-shrink-0 text-[#0d9488] dark:text-[#14b8a6]" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-[#0d9488] dark:text-[#14b8a6]">
          🔗 อุปกรณ์นี้อยู่ในชุดของ
        </div>
        <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
          {parentDevice.name}
          {' '}
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
            ({parentDevice.assetCode})
          </span>
          {typeof setPosition === 'number' && (
            <Badge className="ml-2 border-[#0d9488]/30 bg-[#0d9488]/10 text-[10px] text-[#0d9488] dark:border-[#14b8a6]/30 dark:bg-[#14b8a6]/10 dark:text-[#14b8a6]">
              ตำแหน่ง #{setPosition}
            </Badge>
          )}
        </div>
        {setLabel && (
          <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            📦 ชุด: {setLabel}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        tabIndex={-1}
        className="h-7 gap-1 px-2 text-xs text-[#0d9488] hover:bg-[#0d9488]/10 dark:text-[#14b8a6] dark:hover:bg-[#14b8a6]/15"
        // ป้องกัน double-trigger เพราะทั้ง button นอกและ Button ใน onClick ทั้งคู่
        onClick={(e) => {
          e.stopPropagation()
          onOpenParent?.(parentDevice.id)
        }}
      >
        ไปที่อุปกรณ์หลัก
        <ArrowUpRight className="h-3 w-3" />
      </Button>
      <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-slate-400 dark:text-slate-500" />
    </button>
  )
}
