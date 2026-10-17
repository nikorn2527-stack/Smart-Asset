'use client'

/**
 * MobileMeterReading — mobile-first "จดมิเตอร์" (Meter Reading) screen.
 *
 * Flow:
 *   1. On mount, fetch:
 *        GET /api/meter/reminders              → unread assetCodes + cycle
 *        GET /api/devices?limit=500            → all devices
 *      Then filter client-side for `meterRequired === true` and annotate
 *      each device with `readThisCycle` using the unread set.
 *
 *   2. Sticky search bar — filter by assetCode OR serialNumber; supports
 *      "last 4-5 digits of serial number" matching (case-insensitive,
 *      suffix-aware).
 *
 *   3. Progress card: "จดแล้ว X / ทั้งหมด Y (เหลือ Z เครื่อง)" with a
 *      Progress bar (X = total − unread, Y = total, Z = unread).
 *
 *   4. List of meter-required devices (cards). Tap a card → expands an
 *      inline form with:
 *        - device info (assetCode, name, brand/model, serial, site, mode)
 *        - last reading (BW + Color) from device.lastMeterBw/lastMeterColor
 *        - input field(s):
 *            * TOTAL mode  → single field (meterBw)
 *            * BW_COLOR    → two fields (meterBw + meterColor)
 *        - auto-calculated delta (Δ = new − prev)
 *        - warning UI if reading < previous (RESET detection)
 *        - remark textarea — required when RESET detected
 *        - Save button (large, emerald) + Skip button (gray)
 *
 *   5. Submit → POST /api/itam/meter-readings
 *        Body: { assetCode, meterBw, meterColor?, readingDate?, remark?,
 *                confirmReset? }
 *      On 409 with `needConfirmReset: true` → show confirmation UI inside
 *      the expanded card, require remark, then re-POST with
 *      `confirmReset: true`.
 *
 *   6. After save → mark device as read locally, auto-open the next unread
 *      device (if any), refresh progress.
 *
 * Touch targets: every button is h-12 (≥44px); inputs are h-12.
 *
 * Responsive: full-width on phones (max-w-md wrapper from the shell);
 * device list uses `max-h-[60vh] overflow-y-auto` so the expanded form
 * stays reachable without pushing the bottom nav off-screen.
 *
 * Accessibility:
 *   - All inputs have <Label> (with htmlFor) + aria-required.
 *   - Touch-friendly hit areas (≥44px).
 *   - Error messages announced via role="alert".
 *   - Loading state has aria-busy + a spinner.
 *
 * API contract (Bearer token attached by the global fetch interceptor in
 * app/page.tsx — covers /api/devices, /api/itam/*, /api/meter/reminders
 * is unauthenticated):
 *   GET    /api/devices?search=&limit=&page=
 *        → { devices: Device[], total, page, limit, totalPages }
 *        Device shape (selected fields used here):
 *          id, assetCode, name, brand, model, type, serialNumber, status,
 *          site, building, location, meterRequired, meterMode,
 *          lastMeterBw, lastMeterColor, lastReadingMonth
 *   GET    /api/meter/reminders
 *        → { hasActiveCycle, cycle, reminders: [{device, lastReadingDate,
 *             daysOverdue}], totalRead, totalUnread, count }
 *   POST   /api/itam/meter-readings
 *          body: { assetCode, meterBw, meterColor?, readingDate?,
 *                  readingMonth?, remark?, confirmReset? }
 *        → 201 { reading, reset, pagesBw, pagesColor, readingType,
 *                modeSwitched, isInitial, updated }
 *        → 409 { needConfirmReset: true, prevMeterBw, prevMeterColor,
 *                newMeterBw, newMeterColor, message }
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  Search,
  X,
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Gauge,
  Save,
  SkipForward,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Hash,
  RotateCcw,
  Inbox,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth-store'
import { useLang } from '@/store/i18n-store'
import { useKeyboardAware } from '@/hooks/use-keyboard-aware'
import { matchesSuffixOrContains } from '@/lib/suffix-search'
import { addToQueue } from '@/lib/offline-queue'
import { bearerHeaders } from '@/lib/http-headers'

// ── Types ─────────────────────────────────────────────────────────────

interface MeterDevice {
  id: string
  assetCode: string
  name: string
  brand: string | null
  model: string | null
  type: string | null
  serialNumber: string | null
  site: string | null
  building: string | null
  // /api/devices returns `department` (Device.department); it backs the
  // free-text filter below.
  department: string | null
  location: string | null
  meterRequired: boolean
  meterMode: string | null // 'TOTAL' | 'BW_COLOR' | null
  lastMeterBw: number
  lastMeterColor: number
  lastReadingMonth: string | null
}

interface RemindersResponse {
  hasActiveCycle: boolean
  cycle: {
    id: string
    name: string | null
    startDate: string
    endDate: string
    status: string
  } | null
  reminders: Array<{
    device: {
      id: string
      assetCode: string
    }
    lastReadingDate: string | null
    daysOverdue: number
  }>
  totalRead: number
  totalUnread: number
  count: number
}

interface DevicesResponse {
  devices: MeterDevice[]
  total: number
  page: number
  limit: number
  totalPages: number
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | {
      kind: 'confirm-reset'
      message: string
      prevMeterBw: number
      prevMeterColor: number
      newMeterBw: number
      newMeterColor: number
    }
  | { kind: 'saved'; readingType: string; pagesBw: number; pagesColor: number }
  | { kind: 'error'; message: string }

// ── Constants ─────────────────────────────────────────────────────────

const PAGE_SIZE = 500 // pull all meter-required devices in one shot

// ── Component ─────────────────────────────────────────────────────────

export function MobileMeterReading() {
  // ── Data state ──
  const [devices, setDevices] = React.useState<MeterDevice[]>([])
  const [unreadSet, setUnreadSet] = React.useState<Set<string>>(new Set())
  const [cycle, setCycle] = React.useState<RemindersResponse['cycle']>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // ── UI state ──
  const [searchTerm, setSearchTerm] = React.useState('')
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  // Read set (assetCodes successfully saved this session — used to drive
  // the progress bar locally without re-fetching the reminders endpoint
  // after every save).
  const [readLocally, setReadLocally] = React.useState<Set<string>>(new Set())
  const { lang } = useLang()

  const user = useAuthStore((s) => s.user)
  const listRef = React.useRef<HTMLDivElement>(null)

  // ── Fetch devices + reminders on mount ──
  const loadData = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [devRes, remRes] = await Promise.all([
        fetch(`/api/devices?${new URLSearchParams({ limit: String(PAGE_SIZE), page: '1' }).toString()}`, {
          headers: bearerHeaders(useAuthStore.getState()?.token),
        }),
        fetch('/api/meter/reminders', {
          headers: bearerHeaders(useAuthStore.getState()?.token),
        }),
      ])
      if (!devRes.ok) {
        const j = await devRes.json().catch(() => ({}))
        throw new Error(j.error ?? 'โหลดรายการอุปกรณ์ไม่สำเร็จ')
      }
      const devJson = (await devRes.json()) as DevicesResponse
      // Filter to meter-required devices only (server ignores meterRequired
      // query param, so we filter client-side).
      const meterDevices = (devJson.devices ?? []).filter((d) => d.meterRequired === true)
      setDevices(meterDevices)

      // Reminders endpoint is best-effort — don't fail the whole load if it
      // errors (some installs may not have an active cycle).
      if (remRes.ok) {
        const remJson = (await remRes.json()) as RemindersResponse
        const set = new Set<string>()
        for (const r of remJson.reminders ?? []) {
          if (r.device?.assetCode) set.add(r.device.assetCode)
        }
        setUnreadSet(set)
        setCycle(remJson.cycle)
      } else {
        setUnreadSet(new Set())
        setCycle(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  // ── Derived progress ──
  const total = devices.length
  // unread = unreadSet minus what we've saved locally this session
  const unread = React.useMemo(() => {
    const out = new Set<string>()
    for (const code of unreadSet) {
      if (!readLocally.has(code)) out.add(code)
    }
    // Also count any device that has no entry in unreadSet as "read" only
    // if it's not in readLocally — but the simpler interpretation is:
    // total - unread_set = read. We trust the reminders endpoint.
    return out
  }, [unreadSet, readLocally])
  const readCount = Math.max(0, total - unread.size)
  const pct = total > 0 ? Math.round((readCount / total) * 100) : 0

  // ── Filtered device list ──
  const filtered = React.useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return devices
    // ── SUFFIX-AWARE SEARCH (USER-FEEDBACK, using shared helper) ──
    // Numeric short queries (1-6 digits): match the SUFFIX of assetCode /
    // serialNumber. Non-numeric/longer queries: legacy `.includes()`.
    return devices.filter((d) => {
      if (matchesSuffixOrContains(d.assetCode, q)) return true
      if (matchesSuffixOrContains(d.serialNumber, q)) return true
      // Free-text fields — always contains.
      return (
        (d.brand ?? '').toLowerCase().includes(q) ||
        (d.model ?? '').toLowerCase().includes(q) ||
        (d.department ?? '').toLowerCase().includes(q)
      )
    })
  }, [devices, searchTerm])

  // Sort: unread first, then by assetCode asc.
  const sorted = React.useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aUnread = unread.has(a.assetCode) ? 0 : 1
      const bUnread = unread.has(b.assetCode) ? 0 : 1
      if (aUnread !== bUnread) return aUnread - bUnread
      return a.assetCode.localeCompare(b.assetCode)
    })
  }, [filtered, unread])

  // ── After saving a device, auto-open the next unread one ──
  function openNextUnread(afterAssetCode: string) {
    const idx = sorted.findIndex((d) => d.assetCode === afterAssetCode)
    if (idx === -1) {
      setExpandedId(null)
      return
    }
    // Search forward for the next unread device.
    for (let i = idx + 1; i < sorted.length; i++) {
      if (unread.has(sorted[i].assetCode)) {
        setExpandedId(sorted[i].id)
        // Scroll the new card into view (after the next paint).
        setTimeout(() => {
          const el = listRef.current?.querySelector(
            `[data-device-id="${sorted[i].id}"]`,
          )
          if (el && 'scrollIntoView' in el) {
            ;(el as HTMLElement).scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            })
          }
        }, 60)
        return
      }
    }
    // None after — try from the start.
    for (let i = 0; i < idx; i++) {
      if (unread.has(sorted[i].assetCode)) {
        setExpandedId(sorted[i].id)
        setTimeout(() => {
          const el = listRef.current?.querySelector(
            `[data-device-id="${sorted[i].id}"]`,
          )
          if (el && 'scrollIntoView' in el) {
            ;(el as HTMLElement).scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            })
          }
        }, 60)
        return
      }
    }
    // No more unread — collapse the form.
    setExpandedId(null)
    toast.success('จดมิเตอร์ครบทุกเครื่องแล้ว')
  }

  // ── Render: loading ──
  if (loading) {
    return <LoadingState />
  }

  // ── Render: error ──
  if (error) {
    return <ErrorState message={error} onRetry={() => void loadData()} />
  }

  // ── Render: empty ──
  if (total === 0) {
    return <EmptyState onRefresh={() => void loadData()} />
  }

  // ── Render: main ──
  return (
    <div className="flex flex-col gap-3">
      {/* ── Progress + cycle info + current month ── */}
      <Card className="gap-0 py-0">
        <CardContent className="px-0 py-0">
          <div className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300">
                  <Gauge className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none">
                    จดมิเตอร์รอบนี้
                  </p>
                  {cycle?.name ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {cycle.name}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      ยังไม่มีรอบจดมิเตอร์ที่เปิดอยู่
                    </p>
                  )}
                  {/* Show current month — prevents wrong month saves */}
                  <p className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    เดือนที่จด: {(() => {
                      const now = new Date()
                      const thMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
                      return thMonths[now.getMonth()] + ' ' + (now.getFullYear() + 543)
                    })()}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadData()}
                aria-label="รีเฟรช"
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3">
              <div className="flex items-end justify-between gap-2">
                <p className="text-sm font-medium">
                  จดแล้ว{' '}
                  <span className="font-mono text-emerald-600">{readCount}</span>
                  <span className="text-muted-foreground"> / ทั้งหมด </span>
                  <span className="font-mono">{total}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  เหลือ {unread.size} เครื่อง
                </p>
              </div>
              <Progress
                value={pct}
                className="mt-2 h-2 bg-emerald-100 dark:bg-emerald-950/40"
              />
              <p className="mt-1 text-right text-[11px] text-muted-foreground">
                {pct}%
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Sticky search bar ── */}
      <div className="sticky top-14 z-10 -mx-3 bg-background/95 px-3 pb-1 pt-2 backdrop-blur">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            inputMode="search"
            autoComplete="off"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="รหัสอุปกรณ์ / Serial (4-5 หลักท้าย)"
            aria-label="ค้นหาอุปกรณ์ที่ต้องจดมิเตอร์"
            className="h-12 rounded-lg pl-9 pr-9 text-base"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="ล้างคำค้นหา"
              className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">
          แสดง {sorted.length} เครื่อง{searchTerm ? ' (กรองจากคำค้น)' : ''}
        </p>
      </div>

      {/* ── Device list ── */}
      <div ref={listRef} className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {sorted.map((d) => {
            const expanded = expandedId === d.id
            const isUnread = unread.has(d.assetCode)
            return (
              <motion.div
                key={d.id}
                layout
                initial={false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                data-device-id={d.id}
              >
                <Card
                  className={cn(
                    'gap-0 py-0 transition-colors',
                    expanded && 'ring-2 ring-emerald-300 dark:ring-emerald-700',
                  )}
                >
                  <CardContent className="px-0 py-0">
                    {/* Header row (tap to expand) */}
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(expanded ? null : d.id)
                      }
                      aria-expanded={expanded}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <div
                        className={cn(
                          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
                          isUnread
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
                        )}
                      >
                        {isUnread ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm font-semibold text-orange-600">
                            {d.assetCode}
                          </span>
                          <span className="truncate text-sm font-medium">
                            {d.name}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {[d.brand, d.model].filter(Boolean).join(' ') || '—'}
                          {d.serialNumber ? ` · S/N ${d.serialNumber}` : ''}
                          {d.site ? ` · ${d.site}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {d.meterMode && (
                          <Badge variant="outline" className="text-[10px]">
                            {d.meterMode === 'BW_COLOR' ? 'BW+สี' : 'รวม'}
                          </Badge>
                        )}
                        {isUnread ? (
                          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 text-[10px]">
                            ยังไม่จด
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px]">
                            จดแล้ว
                          </Badge>
                        )}
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    {/* Expanded form */}
                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          key="form"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeOut' }}
                          className="overflow-hidden border-t"
                        >
                          <MeterReadingForm
                            device={d}
                            user={user}
                            onSaved={() => {
                              setReadLocally((prev) => {
                                const next = new Set(prev)
                                next.add(d.assetCode)
                                return next
                              })
                              // Auto-open the next unread device.
                              setTimeout(() => openNextUnread(d.assetCode), 350)
                            }}
                            onSkip={() => {
                              setExpandedId(null)
                              setTimeout(() => openNextUnread(d.assetCode), 100)
                            }}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {sorted.length === 0 && (
          <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">ไม่พบอุปกรณ์ที่ตรงกัน</p>
            <p className="mt-1 text-xs text-muted-foreground">
              ลองพิมพ์รหัสอุปกรณ์ หรือ Serial Number 4-5 หลักท้าย
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-component: Meter reading form (inline) ─────────────────────────

interface MeterReadingFormProps {
  device: MeterDevice
  user: ReturnType<typeof useAuthStore.getState>['user']
  onSaved: () => void
  onSkip: () => void
}

function MeterReadingForm({ device, user, onSaved, onSkip }: MeterReadingFormProps) {
  const { lang } = useLang()
  const isBwColor = (device.meterMode ?? '').toUpperCase() === 'BW_COLOR'
  const prevBw = device.lastMeterBw ?? 0
  const prevColor = device.lastMeterColor ?? 0

  const [meterBw, setMeterBw] = React.useState('')
  const [meterColor, setMeterColor] = React.useState('')
  const [remark, setRemark] = React.useState('')
  const [saveState, setSaveState] = React.useState<SaveState>({ kind: 'idle' })
  // Tracks whether we are inside the needConfirmReset 2-step flow — set to
  // true when the server returns `needConfirmReset: true`, and kept `true`
  // while we re-POST with `confirmReset: true` so the Reset button UI
  // remains visible during the 'saving' state.
  const [confirmingReset, setConfirmingReset] = React.useState(false)

  // Reset form when device changes
  React.useEffect(() => {
    setMeterBw('')
    setMeterColor('')
    setRemark('')
    setSaveState({ kind: 'idle' })
    setConfirmingReset(false)
  }, [device.id])

  const bwNum = parseReading(meterBw)
  const colorNum = parseReading(meterColor)
  const deltaBw = bwNum === null ? null : bwNum - prevBw
  const deltaColor = colorNum === null ? null : colorNum - prevColor

  // RESET detection: new reading is less than the previous reading.
  const isReset =
    bwNum !== null && bwNum < prevBw
      ? true
      : isBwColor && colorNum !== null && colorNum < prevColor

  // Validation
  const bwValid = bwNum !== null && bwNum >= 0
  const colorValid = !isBwColor || (colorNum !== null && colorNum >= 0)
  const remarkRequired = isReset
  const remarkValid = !remarkRequired || remark.trim().length > 0
  const canSubmit = bwValid && colorValid && remarkValid && saveState.kind !== 'saving'

  // ── Submit ──
  async function submit(confirmReset = false) {
    if (bwNum === null) {
      setSaveState({ kind: 'error', message: 'กรุณากรอกเลขมิเตอร์' })
      return
    }
    if (isBwColor && colorNum === null) {
      setSaveState({ kind: 'error', message: 'กรุณากรอกเลขมิเตอร์สี' })
      return
    }
    if (isReset && !remark.trim()) {
      setSaveState({
        kind: 'error',
        message: 'มิเตอร์ลดลง — กรุณากรอกหมายเหตุอธิบายการ reset',
      })
      return
    }

    setSaveState({ kind: 'saving' })
    // Declare outside try so the catch block can read it for offline-queue fallback.
    let body: Record<string, unknown> | null = null
    try {
      body = {
        assetCode: device.assetCode,
        meterBw: bwNum,
        meterColor: isBwColor ? (colorNum ?? 0) : 0,
        readingDate: new Date().toISOString().slice(0, 10),
        readingMonth: new Date().toISOString().slice(0, 7),
      }
      if (remark.trim()) body.remark = remark.trim()
      if (confirmReset) body.confirmReset = true
      // actor info for audit
      if (user?.email) body.actor = user.email

      const res = await fetch('/api/itam/meter-readings', {
        method: 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      })

      // ── needConfirmReset 2-step flow ──
      if (res.status === 409) {
        const j = (await res.json().catch(() => ({}))) as {
          needConfirmReset?: boolean
          message?: string
          prevMeterBw?: number
          prevMeterColor?: number
          newMeterBw?: number
          newMeterColor?: number
          error?: string
        }
        if (j.needConfirmReset) {
          setSaveState({
            kind: 'confirm-reset',
            message: j.message ?? 'มิเตอร์ลดลง — ยืนยันการ reset',
            prevMeterBw: j.prevMeterBw ?? prevBw,
            prevMeterColor: j.prevMeterColor ?? prevColor,
            newMeterBw: j.newMeterBw ?? bwNum,
            newMeterColor: j.newMeterColor ?? (colorNum ?? 0),
          })
          setConfirmingReset(true)
          return
        }
        throw new Error(j.error ?? j.message ?? 'บันทึกไม่สำเร็จ')
      }

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? 'บันทึกไม่สำเร็จ')
      }

      const json = (await res.json()) as {
        readingType?: string
        pagesBw?: number
        pagesColor?: number
        reset?: boolean
      }
      setSaveState({
        kind: 'saved',
        readingType: json.readingType ?? 'MONTHLY',
        pagesBw: json.pagesBw ?? 0,
        pagesColor: json.pagesColor ?? 0,
      })
      setConfirmingReset(false)
      toast.success(
        `บันทึกมิเตอร์ ${device.assetCode} แล้ว (BW ${json.pagesBw ?? 0} / สี ${json.pagesColor ?? 0})`,
      )
      onSaved()
    } catch (e) {
      // Offline queue fallback — only when the network is actually down,
      // not on server-side errors (e.g. needConfirmReset 409 is handled above).
      // Skip queueing during the confirmReset 2-step flow because the user
      // needs to see the confirmation prompt, not a "queued" toast.
      if (!navigator.onLine && body && !confirmReset) {
        addToQueue({
          url: '/api/itam/meter-readings',
          method: 'POST',
          body,
          label: `จดมิเตอร์: ${device.assetCode} BW ${bwNum ?? 0}${isBwColor ? ` / สี ${colorNum ?? 0}` : ''}`,
        })
        toast.success('บันทึกไว้ในคิว จะส่งอัตโนมัติเมื่อออนไลน์')
        // Collapse the expanded form so the technician can move to the next
        // device; the queue retry will create the reading when online.
        onSaved()
        return
      }
      setSaveState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ',
      })
      setConfirmingReset(false)
    }
  }

  // ── Auto-focus the first input on mount ──
  const bwInputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    bwInputRef.current?.focus()
  }, [])

  // ── Render ──
  return (
    <div className="space-y-4 p-4">
      {/* Device info */}
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-xs">
        <InfoRow icon={<Hash className="h-3 w-3" />} label="รหัสอุปกรณ์" value={device.assetCode} mono />
        <InfoRow label="Serial" value={device.serialNumber ?? '—'} mono />
        <InfoRow label="ยี่ห้อ/รุ่น" value={[device.brand, device.model].filter(Boolean).join(' ') || '—'} />
        <InfoRow icon={<Building2 className="h-3 w-3" />} label="สาขา/ที่ตั้ง" value={[device.site, device.building, device.location].filter(Boolean).join(' · ') || '—'} />
      </div>

      {/* Previous reading */}
      <div className="rounded-lg border bg-background p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          มิเตอร์ครั้งก่อน
        </p>
        <div className="mt-1.5 flex items-center gap-4">
          <div>
            <span className="text-xs text-muted-foreground">BW</span>{' '}
            <span className="font-mono text-base font-semibold">{prevBw.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
          </div>
          {isBwColor && (
            <div>
              <span className="text-xs text-muted-foreground">สี</span>{' '}
              <span className="font-mono text-base font-semibold text-orange-600">
                {prevColor.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
              </span>
            </div>
          )}
          {device.lastReadingMonth && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              {device.lastReadingMonth}
            </Badge>
          )}
        </div>
      </div>

      {/* BW input */}
      <div className="space-y-1.5">
        <Label htmlFor={`mr-bw-${device.id}`} className="text-sm font-medium">
          เลขมิเตอร์{isBwColor ? ' (ขาวดำ)' : ''} <span className="text-rose-500">*</span>
        </Label>
        <Input
          id={`mr-bw-${device.id}`}
          ref={bwInputRef}
          type="number"
          inputMode="numeric"
          autoComplete="off"
          value={meterBw}
          onChange={(e) => setMeterBw(e.target.value)}
          placeholder="0"
          className="h-12 text-lg font-mono"
          aria-required="true"
        />
        {deltaBw !== null && (
          <p
            className={cn(
              'text-xs',
              deltaBw < 0
                ? 'text-rose-600'
                : deltaBw === 0
                  ? 'text-muted-foreground'
                  : 'text-emerald-600',
            )}
          >
            ผลต่าง: {deltaBw >= 0 ? '+' : ''}{deltaBw.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} หน้า
          </p>
        )}
      </div>

      {/* Color input (BW_COLOR mode only) */}
      {isBwColor && (
        <div className="space-y-1.5">
          <Label htmlFor={`mr-color-${device.id}`} className="text-sm font-medium">
            เลขมิเตอร์สี <span className="text-rose-500">*</span>
          </Label>
          <Input
            id={`mr-color-${device.id}`}
            type="number"
            inputMode="numeric"
            autoComplete="off"
            value={meterColor}
            onChange={(e) => setMeterColor(e.target.value)}
            placeholder="0"
            className="h-12 text-lg font-mono"
            aria-required="true"
          />
          {deltaColor !== null && (
            <p
              className={cn(
                'text-xs',
                deltaColor < 0
                  ? 'text-rose-600'
                  : deltaColor === 0
                    ? 'text-muted-foreground'
                    : 'text-emerald-600',
              )}
            >
              ผลต่างสี: {deltaColor >= 0 ? '+' : ''}{deltaColor.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} หน้า
            </p>
          )}
        </div>
      )}

      {/* RESET warning */}
      {isReset && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium">ตรวจพบมิเตอร์ลดลง</p>
            <p className="mt-0.5 text-xs">
              ระบบจะบันทึกเป็นประเภท <span className="font-mono">RESET</span>{' '}
              — กรุณากรอกหมายเหตุอธิบายเหตุผล (เช่น เปลี่ยนหมึก/รีเซ็ตเครื่อง)
            </p>
          </div>
        </div>
      )}

      {/* Remark */}
      <div className="space-y-1.5">
        <Label htmlFor={`mr-remark-${device.id}`} className="text-sm font-medium">
          หมายเหตุ{' '}
          {remarkRequired ? (
            <span className="text-rose-500">*</span>
          ) : (
            <span className="text-muted-foreground">(ถ้ามี)</span>
          )}
        </Label>
        <Textarea
          id={`mr-remark-${device.id}`}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder={remarkRequired ? 'อธิบายเหตุผลที่มิเตอร์ลดลง' : 'หมายเหตุเพิ่มเติม'}
          rows={2}
          maxLength={500}
          className="min-h-16 text-base"
          aria-required={remarkRequired}
        />
      </div>

      {/* Confirm-reset banner (server-returned) */}
      {saveState.kind === 'confirm-reset' && (
        <div
          role="alert"
          className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> ต้องยืนยันการ reset
          </p>
          <p className="mt-1 text-xs">{saveState.message}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-background/60 p-2">
              <p className="text-muted-foreground">BW ก่อนหน้า</p>
              <p className="font-mono font-semibold">{saveState.prevMeterBw.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</p>
            </div>
            <div className="rounded bg-background/60 p-2">
              <p className="text-muted-foreground">BW ที่จะบันทึก</p>
              <p className="font-mono font-semibold text-rose-600">{saveState.newMeterBw.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {saveState.kind === 'error' && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{saveState.message}</span>
        </div>
      )}

      {/* Saved (transient) */}
      {saveState.kind === 'saved' && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium">บันทึกแล้ว</p>
            <p className="mt-0.5 text-xs">
              ประเภท {saveState.readingType} · ใช้ไป BW {saveState.pagesBw.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} / สี {saveState.pagesColor.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} หน้า
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      {saveState.kind !== 'saved' && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
            disabled={saveState.kind === 'saving'}
            className="h-12"
          >
            <SkipForward className="mr-2 h-4 w-4" />
            ข้าม
          </Button>
          {confirmingReset ? (
            <Button
              type="button"
              onClick={() => void submit(true)}
              disabled={!canSubmit}
              aria-busy={saveState.kind === 'saving'}
              className="h-12 bg-rose-500 text-base font-semibold hover:bg-rose-600"
            >
              {saveState.kind === 'saving' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังยืนยัน…
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  ยืนยัน Reset
                </>
              )}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void submit(false)}
              disabled={!canSubmit}
              aria-busy={saveState.kind === 'saving'}
              className="h-12 bg-emerald-500 text-base font-semibold hover:bg-emerald-600"
            >
              {saveState.kind === 'saving' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  กำลังบันทึก…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  บันทึก
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────

function InfoRow({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 truncate text-xs font-medium',
          mono && 'font-mono',
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-3">
      <Card className="gap-0 py-0">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="mt-3 h-2 w-full rounded-full" />
        </CardContent>
      </Card>
      <Skeleton className="h-12 w-full rounded-lg" />
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="gap-0 py-0">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-200 bg-rose-50/50 p-8 text-center dark:border-rose-900 dark:bg-rose-950/20">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-300">
        <AlertCircle className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
          โหลดข้อมูลไม่สำเร็จ
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
      <Button type="button" variant="outline" onClick={onRetry} className="h-11">
        <RotateCcw className="mr-2 h-4 w-4" />
        ลองอีกครั้ง
      </Button>
    </div>
  )
}

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/30 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Gauge className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-medium">ยังไม่มีอุปกรณ์ที่ต้องจดมิเตอร์</p>
        <p className="mt-1 text-xs text-muted-foreground">
          อุปกรณ์ที่ตั้งค่า <span className="font-mono">meterRequired</span> จะปรากฏที่นี่
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onRefresh} className="h-11">
        <RefreshCw className="mr-2 h-4 w-4" />
        รีเฟรช
      </Button>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Parse a meter reading input; returns null if empty/invalid. */
function parseReading(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.floor(n)
}
