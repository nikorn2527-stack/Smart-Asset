'use client'

/**
 * public-device-card.tsx — Sanitized device info card shown when a public
 * user scans a Smart QR (no staff auth).
 *
 * Fetches `/api/public/devices/[shortId]?action=...` (no auth required)
 * and renders a mobile-first card with:
 *   - Device icon (by type), name, brand + model
 *   - Asset code badge (monospace) + Site code badge
 *   - Location section (site · building · floor · room · department)
 *   - Public-status badge (color-coded)
 *   - Accessories count (if any)
 *   - Latest 3 work orders (clickable → /wo/[woNumber])
 *   - "เครื่องนี้ถูกแทนที่แล้ว" banner if replacedBy is set
 *   - Site contact (hotline tel: + LINE OA)
 *   - Action buttons (depends on `action` prop):
 *       📱 แจ้งซ่อมด้วย LINE  (Tier 1/2 — green primary)
 *       📞 แจ้งซ่อมด้วยเบอร์มือถือ (Tier 3 — outline)
 *       🔐 เข้าสู่ระบบพนักงาน (ghost)
 *     When action === 'view' → hide repair buttons (info only)
 *     When action === 'meter' | 'transfer' | 'sticker' → show
 *     "ต้องเข้าสู่ระบบพนักงาน" notice + button to staff login
 *
 * Loading + error states included.
 *
 * Parent (the QR router page) wires up the 3 callbacks:
 *   onLoginLine()        → redirect to /api/auth/line/login
 *   onShowRepairForm(t)  → swap card for PublicRepairForm (tier = 'line' | 'anonymous')
 *   onStaffLogin()       → redirect to / (staff login)
 */

import * as React from 'react'
import Link from 'next/link'
import {
  Monitor,
  Laptop,
  Printer,
  ScanLine,
  Network,
  Server,
  Tablet,
  Smartphone,
  Camera,
  BatteryCharging,
  Box,
  Cpu,
  Router,
  HardDrive,
  Tv,
  Wifi,
  Phone,
  MessageCircle,
  MapPin,
  Building2,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Wrench,
  Eye,
  Gauge,
  Printer as PrinterIcon,
  ArrowLeftRight,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { QrAction } from '@/lib/smart-qr'

// ── Types ───────────────────────────────────────────────────────────────

export interface PublicDeviceData {
  assetCode: string | null
  name: string | null
  brand: string | null
  model: string | null
  type: string | null
  status: string
  site: string | null
  building: string | null
  floor: string | null
  room: string | null
  location: string | null
  department: string | null
  assetSiteCode: string | null
  displayLabel: string | null
  serialMasked: string | null
  assigned: boolean
  meterRequired: boolean
  meterMode: string | null
  warrantyEnd: string | null
  replacedBy: {
    assetCode: string | null
    name: string | null
    brand: string | null
    model: string | null
    status: string
  } | null
  replacedAt: string | null
  openWorkOrderCount: number
  latestWorkOrders: Array<{
    woNumber: string
    subject: string | null
    status: string
    createdAt: string | null
  }>
  siteContact: {
    siteCode: string
    siteName: string | null
    hotline: string | null
    lineOA: string | null
    liffId: string | null
  } | null
  accessoriesCount: number
  actions: {
    allowed: QrAction[]
    requested: QrAction | null
    allowedRequested: boolean
  }
}

export interface PublicDeviceCardProps {
  shortId: string
  /** QR action from URL query — controls which buttons are shown. */
  action?: QrAction
  /** Parent handles redirect to /api/auth/line/login. */
  onLoginLine?: () => void
  /** Parent swaps this card for PublicRepairForm (tier = 'line' | 'anonymous'). */
  onShowRepairForm?: (tier: 'line' | 'anonymous') => void
  /** Parent redirects to staff login (/). */
  onStaffLogin?: () => void
  /** Optional className for the outer wrapper. */
  className?: string
}

// ── Device type → icon lookup ───────────────────────────────────────────
//
// We pre-build JSX nodes (rather than returning a component type from a
// function) so we don't trigger the `react-hooks/static-components` rule
// ("Cannot create components during render"). `pickDeviceIconNode` is a
// pure lookup that returns a stable React element — same pattern as
// `TYPE_ICON_MAP` in src/components/itam/reports-section.tsx.

const DEVICE_ICON_FALLBACK = <Box className="h-7 w-7" />

function pickDeviceIconNode(type: string | null | undefined): React.ReactNode {
  if (!type) return DEVICE_ICON_FALLBACK
  const t = type.toLowerCase()
  if (t.includes('laptop') || t.includes('notebook')) return <Laptop className="h-7 w-7" />
  if (t.includes('printer') || t.includes('พิมพ์')) return <Printer className="h-7 w-7" />
  if (t.includes('scan')) return <ScanLine className="h-7 w-7" />
  if (t.includes('server') || t.includes('แม่ข่าย')) return <Server className="h-7 w-7" />
  if (t.includes('network') || t.includes('switch') || t.includes('router')) return <Router className="h-7 w-7" />
  if (t.includes('tablet') || t.includes('ipad')) return <Tablet className="h-7 w-7" />
  if (t.includes('phone') || t.includes('smartphone') || t.includes('มือถือ')) return <Smartphone className="h-7 w-7" />
  if (t.includes('camera') || t.includes('กล้อง')) return <Camera className="h-7 w-7" />
  if (t.includes('ups') || t.includes('battery')) return <BatteryCharging className="h-7 w-7" />
  if (t.includes('monitor') || t.includes('จอ') || t.includes('display')) return <Monitor className="h-7 w-7" />
  if (t.includes('desktop') || t.includes('pc') || t.includes('คอม')) return <Monitor className="h-7 w-7" />
  if (t.includes('cpu') || t.includes('rack')) return <Cpu className="h-7 w-7" />
  if (t.includes('harddisk') || t.includes('storage') || t.includes('nas')) return <HardDrive className="h-7 w-7" />
  if (t.includes('tv') || t.includes('television')) return <Tv className="h-7 w-7" />
  if (t.includes('wifi') || t.includes('access point')) return <Wifi className="h-7 w-7" />
  if (t.includes('network')) return <Network className="h-7 w-7" />
  return DEVICE_ICON_FALLBACK
}

// ── Status → badge class ────────────────────────────────────────────────

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'Active':
      return 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
    case 'In Repair':
      return 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
    case 'Disposed':
      return 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
    default:
      return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'Active':
      return 'ใช้งานปกติ'
    case 'In Repair':
      return 'กำลังซ่อม'
    case 'Disposed':
      return 'ตัดจำหน่ายแล้ว'
    default:
      return status
  }
}

// ── WO status badge (small) ─────────────────────────────────────────────

function woStatusBadgeClass(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
    case 'IN_PROGRESS':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
    case 'WAITING_PARTS':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
    case 'COMPLETED':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    case 'CANCELLED':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
    case 'PENDING_REVIEW':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function woStatusLabel(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'รอดำเนินการ'
    case 'IN_PROGRESS':
      return 'กำลังซ่อม'
    case 'WAITING_PARTS':
      return 'รออะไหล่'
    case 'COMPLETED':
      return 'เสร็จแล้ว'
    case 'CANCELLED':
      return 'ยกเลิก'
    case 'PENDING_REVIEW':
      return 'รอเจ้าหน้าที่ติดต่อกลับ'
    default:
      return status
  }
}

// ── Component ───────────────────────────────────────────────────────────

export function PublicDeviceCard({
  shortId,
  action = 'repair',
  onLoginLine,
  onShowRepairForm,
  onStaffLogin,
  className,
}: PublicDeviceCardProps) {
  const [data, setData] = React.useState<PublicDeviceData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchData = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/public/devices/${encodeURIComponent(shortId)}?action=${action}`,
        { cache: 'no-store' },
      )
      if (res.status === 404) {
        setData(null)
        setError('ไม่พบอุปกรณ์')
        return
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setData(null)
        setError(j.error ?? `HTTP ${res.status}`)
        return
      }
      const json = (await res.json()) as { data?: PublicDeviceData }
      setData(json.data ?? null)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [shortId, action])

  React.useEffect(() => {
    fetchData()
  }, [fetchData])

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className={cn('mx-auto w-full max-w-md', className)}>
        <Card className="gap-0 py-0">
          <CardHeader className="gap-2 p-4">
            <Skeleton className="h-12 w-12 rounded-lg" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Error state ──
  if (error || !data) {
    return (
      <div className={cn('mx-auto w-full max-w-md', className)}>
        <Card className="gap-0 py-0">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <AlertCircle className="h-12 w-12 text-rose-500" />
            <div>
              <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                {error ?? 'ไม่พบอุปกรณ์'}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                ไม่พบข้อมูลอุปกรณ์สำหรับ QR Code นี้ —
                อาจถูกลบหรือย้ายแล้ว
              </p>
              {shortId && (
                <p className="mt-2 font-mono text-xs text-slate-400">
                  ID: {shortId}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              onClick={fetchData}
              className="mt-2 h-10"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              ลองใหม่
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const DeviceIconNode = pickDeviceIconNode(data.type)

  // Action flag derived from API: is repair allowed for this device?
  const repairAllowed = data.actions.allowed.includes('repair')
  const isViewOnly = action === 'view'
  const needsStaffLogin =
    action === 'meter' || action === 'transfer' || action === 'sticker'

  // Build LINE OA URL — if lineOA looks like a URL use as-is;
  // if it starts with @ treat as a LINE @username → https://line.me/R/ti/p/@...
  // otherwise wrap as https://line.me/R/ti/p/@<value>
  function buildLineOAUrl(raw: string): string | null {
    const v = raw.trim()
    if (!v) return null
    if (/^https?:\/\//i.test(v)) return v
    if (v.startsWith('@')) return `https://line.me/R/ti/p/${encodeURIComponent(v)}`
    // Numeric/basic ID — assume @username
    return `https://line.me/R/ti/p/@${encodeURIComponent(v)}`
  }

  const lineOAUrl = data.siteContact?.lineOA
    ? buildLineOAUrl(data.siteContact.lineOA)
    : null
  const hotline = data.siteContact?.hotline?.trim() || null
  const hotlineDigits = hotline ? hotline.replace(/[^\d+]/g, '') : null

  return (
    <div className={cn('mx-auto w-full max-w-md', className)}>
      <Card className="gap-0 overflow-hidden py-0">
        {/* ── Header: device icon + name + brand/model ── */}
        <CardHeader className="gap-3 bg-gradient-to-br from-[#fff7ed] to-white p-4 dark:from-orange-950/30 dark:to-card">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f97316]/10 text-[#f97316] ring-1 ring-[#f97316]/20">
              {DeviceIconNode}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">
                {data.name || data.assetCode || 'อุปกรณ์'}
              </h1>
              {(data.brand || data.model) && (
                <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                  {[data.brand, data.model].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>

          {/* Asset code + site badges */}
          <div className="flex flex-wrap items-center gap-2">
            {data.assetCode && (
              <Badge
                variant="outline"
                className="border-[#f97316]/30 bg-[#fff7ed] px-2.5 py-1 font-mono text-sm font-bold text-[#ea580c] dark:bg-orange-950/40 dark:text-orange-300"
              >
                {data.assetCode}
              </Badge>
            )}
            {data.assetSiteCode && (
              <Badge
                variant="outline"
                className="border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <Building2 className="mr-1 h-3 w-3" />
                {data.assetSiteCode}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn('px-2.5 py-1 text-xs font-semibold', statusBadgeClass(data.status))}
            >
              {statusLabel(data.status)}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-4">
          {/* ── "เครื่องนี้ถูกแทนที่แล้ว" banner ── */}
          {data.replacedBy && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    อุปกรณ์นี้ถูกแทนที่แล้ว
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
                    กรุณาสแกน QR บนเครื่องใหม่:
                  </p>
                  {data.replacedBy.assetCode && (
                    <p className="mt-1 font-mono text-xs font-bold text-amber-800 dark:text-amber-200">
                      {data.replacedBy.assetCode}
                      {data.replacedBy.name ? ` · ${data.replacedBy.name}` : ''}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Location section ── */}
          {(data.site ||
            data.building ||
            data.floor ||
            data.room ||
            data.location ||
            data.department) && (
            <section className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <MapPin className="h-3.5 w-3.5" />
                ตำแหน่งที่ตั้ง
              </h2>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/40">
                {data.siteContact?.siteName && (
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    {data.siteContact.siteName}
                    {data.site && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        ({data.site})
                      </span>
                    )}
                  </p>
                )}
                {!data.siteContact?.siteName && data.site && (
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    {data.site}
                  </p>
                )}
                {(data.building || data.floor || data.room) && (
                  <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                    {[data.building, data.floor && `ชั้น ${data.floor}`, data.room && `ห้อง ${data.room}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {data.location && (
                  <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                    {data.location}
                  </p>
                )}
                {data.department && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    แผนก: {data.department}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ── Quick facts (serial masked + assignment) ── */}
          {(data.serialMasked || data.assigned !== undefined) && (
            <section className="grid grid-cols-2 gap-2">
              {data.serialMasked && (
                <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800/40">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">
                    S/N
                  </p>
                  <p className="font-mono text-sm font-medium text-slate-700 dark:text-slate-200">
                    {data.serialMasked}
                  </p>
                </div>
              )}
              <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800/40">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  สถานะการใช้งาน
                </p>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {data.assigned ? 'มีผู้ใช้งาน' : 'ว่าง'}
                </p>
              </div>
            </section>
          )}

          {/* ── Accessories count ── */}
          {data.accessoriesCount > 0 && (
            <section className="flex items-center gap-2 rounded-lg border border-[#f97316]/20 bg-[#fff7ed] p-2.5 text-sm dark:border-orange-900 dark:bg-orange-950/20">
              <Sparkles className="h-4 w-4 shrink-0 text-[#f97316]" />
              <span className="text-slate-700 dark:text-slate-200">
                อุปกรณ์ต่อพ่วง:{' '}
                <span className="font-bold text-[#ea580c] dark:text-orange-300">
                  {data.accessoriesCount}
                </span>{' '}
                รายการ
              </span>
            </section>
          )}

          {/* ── Latest work orders ── */}
          {data.latestWorkOrders.length > 0 && (
            <section className="space-y-2">
              <h2 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <span>ใบงานล่าสุด</span>
                {data.openWorkOrderCount > 0 && (
                  <Badge className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    เปิดอยู่ {data.openWorkOrderCount}
                  </Badge>
                )}
              </h2>
              <ul className="space-y-1">
                {data.latestWorkOrders.map((wo) => (
                  <li key={wo.woNumber}>
                    <Link
                      href={`/wo/${encodeURIComponent(wo.woNumber)}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-slate-800"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs font-bold text-[#ea580c] dark:text-orange-300">
                          {wo.woNumber}
                        </p>
                        {wo.subject && (
                          <p className="mt-0.5 truncate text-slate-700 dark:text-slate-200">
                            {wo.subject}
                          </p>
                        )}
                        {wo.createdAt && (
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            {wo.createdAt}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          woStatusBadgeClass(wo.status),
                        )}
                      >
                        {woStatusLabel(wo.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Site contact ── */}
          {(hotline || lineOAUrl) && (
            <>
              <Separator />
              <section className="space-y-2">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <Phone className="h-3.5 w-3.5" />
                  ติดต่อสาขา
                </h2>
                <div className="grid grid-cols-1 gap-2">
                  {hotline && (
                    <a
                      href={`tel:${hotlineDigits}`}
                      className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 transition-colors hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <Phone className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                          โทรสายด่วน
                        </p>
                        <p className="truncate font-medium text-emerald-900 dark:text-emerald-100">
                          {hotline}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-emerald-500" />
                    </a>
                  )}
                  {lineOAUrl && (
                    <a
                      href={lineOAUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg border border-[#06C755]/30 bg-[#06C755]/10 p-3 transition-colors hover:bg-[#06C755]/20"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#06C755] text-white">
                        <MessageCircle className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase tracking-wide text-[#06C755]">
                          LINE Official Account
                        </p>
                        <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                          {data.siteContact?.lineOA}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-[#06C755]" />
                    </a>
                  )}
                </div>
              </section>
            </>
          )}

          {/* ── "ต้องเข้าสู่ระบบพนักงาน" notice (for meter/sticker/transfer) ── */}
          {needsStaffLogin && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="flex-1">
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    ต้องเข้าสู่ระบบพนักงาน
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
                    ฟังก์ชันนี้ ({actionLabel(action)}) สำหรับพนักงานเท่านั้น —
                    กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ
                  </p>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => onStaffLogin?.()}
                    className="mt-2 h-9 bg-amber-600 hover:bg-amber-700"
                  >
                    เข้าสู่ระบบพนักงาน
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>

        {/* ── Sticky footer with action buttons ── */}
        {!isViewOnly && !needsStaffLogin && (
          <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            {/* Primary: repair via LINE (Tier 1/2) */}
            {repairAllowed && (
              <Button
                size="lg"
                onClick={() => onShowRepairForm?.('line')}
                className="h-12 bg-[#06C755] text-base font-semibold text-white hover:bg-[#05b04a]"
              >
                <MessageCircle className="mr-2 h-5 w-5" />
                แจ้งซ่อมด้วย LINE
              </Button>
            )}
            {/* Secondary: repair via phone (Tier 3) */}
            {repairAllowed && (
              <Button
                size="lg"
                variant="outline"
                onClick={() => onShowRepairForm?.('anonymous')}
                className="h-12 border-[#f97316] text-base font-semibold text-[#ea580c] hover:bg-[#fff7ed] dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/30"
              >
                <Phone className="mr-2 h-5 w-5" />
                แจ้งซ่อมด้วยเบอร์มือถือ
              </Button>
            )}
            {/* Tertiary: staff login */}
            <Button
              size="lg"
              variant="ghost"
              onClick={() => onStaffLogin?.()}
              className="h-11 text-base text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              เข้าสู่ระบบพนักงาน
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────

function actionLabel(action: QrAction): string {
  switch (action) {
    case 'repair':
      return 'แจ้งซ่อม'
    case 'view':
      return 'ดูข้อมูล'
    case 'meter':
      return 'จดมิเตอร์'
    case 'sticker':
      return 'พิมพ์สติกเกอร์'
    case 'transfer':
      return 'ย้ายอุปกรณ์'
    default:
      return action
  }
}

// ── Action button icon helper (currently unused but exported for future) ──
export function actionIcon(action: QrAction): React.ComponentType<{ className?: string }> {
  switch (action) {
    case 'repair':
      return Wrench
    case 'view':
      return Eye
    case 'meter':
      return Gauge
    case 'sticker':
      return PrinterIcon
    case 'transfer':
      return ArrowLeftRight
    default:
      return Eye
  }
}
