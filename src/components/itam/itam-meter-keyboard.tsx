'use client'

/**
 * itam-meter-keyboard.tsx — Phase 3: Keyboard-driven meter reading page.
 *
 * Layout (single viewport, no scroll):
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ Progress + จดแล้ว X/Y + latest compact result + keyboard hints     │
 *   ├─────────────────────────────┬──────────────────────────────────────┤
 *   │ Search box + device list    │  Selected device + meter inputs      │
 *   │   ↑↓ / Enter navigation     │  · current meter / delta / reset      │
 *   │                             │  · save → next device                 │
 *   └─────────────────────────────┴──────────────────────────────────────┘
 *
 * Latest result is intentionally compact in the top summary; the full
 * history remains available in the separate ประวัติมิเตอร์ tab.
 *
 * Global keys (only active when this page is mounted):
 *   ↑ / ArrowUp    → select previous device in the list
 *   ↓ / ArrowDown  → select next device
 *   Enter (search) → execute search (the search input has focus by default)
 *   Enter (meter)  → save reading, focus next unread device, refocus input
 *   Escape         → clear search / unfocus
 *   Tab            → move between search ↔ first meter input
 */

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Search, Keyboard, ArrowUp, ArrowDown, CornerDownLeft, CheckCircle2, AlertTriangle, Loader2, RefreshCw, X, Lock, QrCode, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { downloadCsv, dateStamp } from '@/lib/csv'
import { useAppStore } from '@/store/app-store'
import { useLang } from '@/store/i18n-store'
import { formatMonthThai } from './types'

/**
 * Default meter month for a fresh session: the current calendar month.
 *
 * Deliberately unchanged from the previous behaviour — collecting a DIFFERENT
 * month (e.g. closing September while running the round in early October) is a
 * decision the operator makes in the picker, never something the app decides
 * silently on their behalf.
 */
function currentMeterMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** Shift a `YYYY-MM` month by `delta` months (negative = earlier). */
function shiftMeterMonth(month: string, delta: number): string {
  const m = String(month).match(/^(\d{4})-(\d{2})$/)
  if (!m) return month
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface UnreadDevice {
  id: string
  assetCode: string
  type: string | null
  brand: string | null
  model: string | null
  serialNumber: string | null
  site: string | null
  building: string | null
  floor: string | null
  department: string | null
  departmentCode: string | null
  location: string | null
  meterMode: string | null
  meterRequired: boolean
  assetSiteCode: string | null
  readThisMonth: boolean
  readAt: string | null
  readBy: string | null
  lastMeterBw: number
  lastMeterColor: number
  lastReadingDate: string | null
}

interface UnreadResponse {
  month: string
  total: number
  read: number
  unread: number
  devices: UnreadDevice[]
}

interface RecentlyKeyed {
  assetCode: string
  name: string
  meterBw: number
  meterColor: number
  meterMode: 'TOTAL' | 'BW_COLOR'
  delta: number
  at: number
  reset: boolean
}

function fmtTime(ts: number, lang: 'th' | 'en' = 'th'): string {
  const d = new Date(ts)
  return d.toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDateTime(ts: number, lang: 'th' | 'en' = 'th'): string {
  return new Date(ts).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

function deviceLabel(d: { brand: string | null; model: string | null; assetCode: string }): string {
  const name = `${d.brand || ''} ${d.model || ''}`.trim()
  return name || d.assetCode
}

export function ItamMeterKeyboard() {
  const qc = useQueryClient()
  const { lang } = useLang()
  const [searchInput, setSearchInput] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [bwInput, setBwInput] = React.useState('')
  const [colorInput, setColorInput] = React.useState('')
  const [remark, setRemark] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [latest, setLatest] = React.useState<RecentlyKeyed | null>(null)
  const [recent, setRecent] = React.useState<RecentlyKeyed[]>([])
  const [focus, setFocus] = React.useState<'search' | 'meter'>('search')

  // ── Pending device (from QR scan or dashboard quick-action) ──
  // When the user scans a QR code or clicks a "จดมิเตอร์" button on a specific
  // device, the store sets pendingDeviceId. We pre-select that device and
  // jump straight to meter input — no search needed.
  const pendingDeviceId = useAppStore((s) => s.pendingDeviceId)
  const clearPendingDeviceId = useAppStore((s) => s.clearPendingDeviceId)
  // SPRINT-3 #2: listen for QR scan results — fill search input + focus
  const qrScanNonce = useAppStore((s) => s.qrScanNonce)
  const lastQrScan = useAppStore((s) => s.lastQrScan)
  const clearLastQrScan = useAppStore((s) => s.clearLastQrScan)

  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const bwInputRef = React.useRef<HTMLInputElement>(null)
  const colorInputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  // SPRINT-3 #2: when a QR scan comes in, populate the search box with the
  // scanned asset code and let the existing debounce + select-first effect
  // jump to that device automatically.
  React.useEffect(() => {
    if (qrScanNonce === 0) return
    if (!lastQrScan) return
    setSearchInput(lastQrScan)
    // Clear the scan value so we don't re-trigger on re-renders
    clearLastQrScan()
    // The debounce effect (below) will update `search` and `selectedIndex`
    // Focus will move to the meter input automatically once the device is
    // selected (existing pendingDeviceId logic OR the user pressing Enter).
  }, [qrScanNonce, lastQrScan, clearLastQrScan])

  // Debounce the search input → search state (200ms).
  React.useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setSelectedIndex(0)
    }, 200)
    return () => clearTimeout(t)
  }, [searchInput])

  const [targetMonth, setTargetMonth] = React.useState(() => currentMeterMonth())

  const { data, isLoading, refetch, isFetching } = useQuery<UnreadResponse>({
    queryKey: ['itam-meter-keyboard', search, targetMonth],
    queryFn: async () => {
      const q = search ? `&search=${encodeURIComponent(search)}` : ''
      // `month` decides WHICH month is being collected. It is a first-class
      // choice (not derived from today's date) because the collection window
      // does not have to match the calendar month — e.g. October's round may
      // close September, and a printer installed on the 28th should start in
      // the following month rather than being back-dated.
      const res = await fetch(
        `/api/itam/meter-readings/unread?limit=500&includeRead=1&month=${encodeURIComponent(targetMonth)}${q}`,
      )
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const devices = data?.devices ?? []
  const total = data?.total ?? 0
  const read = data?.read ?? 0
  const unread = data?.unread ?? 0

  // ── Pre-select pending device (from QR scan or quick-action) ──
  // When a pendingDeviceId is set, find it in the loaded list and select it,
  // then jump focus to the meter input. This makes the flow: scan QR →
  // (page loads) → device already selected → just type meter → Enter.
  React.useEffect(() => {
    if (!pendingDeviceId || devices.length === 0) return
    const idx = devices.findIndex((d) => d.assetCode === pendingDeviceId)
    if (idx >= 0) {
      setSelectedIndex(idx)
      setFocus('meter')
      // Scroll the selected item into view
      setTimeout(() => {
        const el = listRef.current?.querySelector(`[data-idx="${idx}"]`)
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 50)
      toast.success(`เลือกอุปกรณ์ ${pendingDeviceId} แล้ว — พิมพ์มิเตอร์แล้วกด Enter`)
      clearPendingDeviceId()
    }
  }, [pendingDeviceId, devices, clearPendingDeviceId])
  const pct = total > 0 ? Math.round((read / total) * 100) : 0

  // The selected device (clamped to the visible list).
  const selected = devices[selectedIndex] ?? null

  // When the selected device changes, reset the inputs (and put focus on the
  // BW input when the user is in "meter" mode).
  React.useEffect(() => {
    if (!selected) {
      setBwInput('')
      setColorInput('')
      setRemark('')
      return
    }
    // Pre-fill the new input with the last meter value (Apps Script behavior —
    // user types over it or appends to it).
    setBwInput(String(selected.lastMeterBw || ''))
    setColorInput(String(selected.lastMeterColor || ''))
    setRemark('')
  }, [selected?.assetCode])

  // When focus target flips to "meter", jump into the BW input.
  React.useEffect(() => {
    if (focus === 'meter' && selected) {
      const t = setTimeout(() => {
        const el = bwInputRef.current
        if (el) {
          el.focus()
          el.select()
        }
      }, 30)
      return () => clearTimeout(t)
    }
    if (focus === 'search') {
      // After save, search is cleared so `selected` becomes null. We still
      // want to focus the search box so the user can type the next query
      // immediately. Dependency on `focus` alone (not selected.assetCode)
      // ensures this fires even when selected doesn't change.
      const t = setTimeout(() => searchInputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [focus, selected?.assetCode])

  // Scroll the selected row into view in the list.
  React.useEffect(() => {
    if (!listRef.current) return
    const row = listRef.current.querySelector<HTMLElement>(`[data-row-idx="${selectedIndex}"]`)
    if (row) row.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // ─── Global keyboard handler ─────────────────────────────────────────
  //   • ↑/↓ move selection (regardless of focus, but only when not editing text)
  //   • Enter in search → keep focus in search (already filtered by debounce)
  //   • Enter in BW input → if BW_COLOR, focus color; otherwise save
  //   • Enter in color input → save
  //   • Escape → clear search / blur meter
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
      const inTextField = tag === 'input' || tag === 'textarea'

      // ArrowUp / ArrowDown — always handle (so the user can navigate the
      // list even while typing in the search box).
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(devices.length - 1, i + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(0, i - 1))
        return
      }

      if (e.key === 'Escape') {
        if (inTextField) {
          // First Escape blurs the field; second clears the value.
          ;(e.target as HTMLElement).blur()
        } else if (searchInput) {
          setSearchInput('')
          setSearch('')
        }
        return
      }

      if (e.key === 'Enter') {
        if (focus === 'search') {
          // Enter in the search box → jump to the meter input of the first hit.
          e.preventDefault()
          if (devices.length > 0) {
            setSelectedIndex(0)
            setFocus('meter')
          }
          return
        }
        // focus === 'meter'
        const isColor = (selected?.meterMode || 'TOTAL').toUpperCase() === 'BW_COLOR'
        if (isColor && document.activeElement === bwInputRef.current) {
          // Move to color input.
          e.preventDefault()
          colorInputRef.current?.focus()
          colorInputRef.current?.select()
          return
        }
        // Otherwise Enter saves.
        e.preventDefault()
        void saveReading()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [devices.length, focus, searchInput, selected])

  async function saveReading() {
    if (!selected) return
    const bwNum = Number(bwInput)
    if (!bwInput || !Number.isFinite(bwNum)) {
      toast.error('กรุณากรอกค่ามิเตอร์')
      bwInputRef.current?.focus()
      return
    }
    const colorNum = colorInput ? Number(colorInput) : 0
    const isReset = bwNum < selected.lastMeterBw || colorNum < selected.lastMeterColor
    if (isReset && !remark.trim()) {
      toast.error('ค่าใหม่น้อยกว่าค่าก่อนหน้า (RESET) — กรุณาระบุหมายเหตุ')
      return
    }
    try {
      setSaving(true)
      const res = await fetch('/api/itam/meter-readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetCode: selected.assetCode,
          meterBw: bwNum,
          meterColor: colorNum,
          prevMeterBw: selected.lastMeterBw,
          prevMeterColor: selected.lastMeterColor,
          remark: remark.trim() || (isReset ? 'RESET' : null),
          readingType: isReset ? 'RESET' : 'MONTHLY',
          // Write into the month the operator picked, NOT the server's "today".
          // Without this the picker would only change which devices are listed
          // while every reading still landed in the current calendar month —
          // which is exactly the silent mis-filing the picker exists to prevent.
          readingMonth: targetMonth,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Save failed')
      }
      const j = await res.json()
      const pagesBw: number = j.pagesBw ?? Math.max(0, bwNum - selected.lastMeterBw)
      const pagesColor: number = j.pagesColor ?? Math.max(0, colorNum - selected.lastMeterColor)

      // Only publish a result after the API has confirmed the reading was saved.
      // The same object powers the prominent primary result and the secondary history.
      const savedReading: RecentlyKeyed = {
        assetCode: selected.assetCode,
        name: deviceLabel(selected),
        meterBw: bwNum,
        meterColor: colorNum,
        meterMode: isColorMode ? 'BW_COLOR' : 'TOTAL',
        delta: pagesBw + pagesColor,
        at: Date.now(),
        reset: Boolean(j.reset ?? isReset),
      }
      setLatest(savedReading)
      setRecent((prev) => [savedReading, ...prev].slice(0, 5))

      toast.success(
        `บันทึกมิเตอร์ ${selected.assetCode} · +${((pagesBw ?? 0) + (pagesColor ?? 0)).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} แผ่น`,
        { description: isReset ? '⚠️ RESET' : undefined },
      )

      // Legacy-app flow: immediately clear all inputs + return focus to the
      // SEARCH box (before awaiting query invalidation) so the user can start
      // typing the next search query without delay. No mouse needed.
      setBwInput('')
      setColorInput('')
      setRemark('')
      setSearchInput('')
      setSearch('')
      setSelectedIndex(0)
      setFocus('search')

      // Invalidate queries (refetch happens in background; the search box is
      // already focused so the user can type the next query immediately).
      void qc.invalidateQueries({ queryKey: ['itam-meter-keyboard'] })
      void qc.invalidateQueries({ queryKey: ['itam-readings'] })
      void qc.invalidateQueries({ queryKey: ['itam-dashboard'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // The global handler already does the right thing (jumps to meter input).
      // But because the global listener has the latest `devices` in its closure,
      // we don't need to do anything here. Still, prevent form submit.
      e.preventDefault()
    }
  }

  async function forceCloseMonth() {
    if (!selected) return
    const confirmed = window.confirm(
      `ปิดเดือนด้วยค่ามิเตอร์เดิมสำหรับ ${selected.assetCode}?\n\n` +
      `จะใช้ค่าล่าสุด BW=${(selected.lastMeterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ` +
      `เป็นค่าปิดเดือนนี้ (pages=0)\n` +
      `เหมาะสำหรับเครื่องที่จดไม่ได้จริง เช่น เครื่องพัง/ส่งซ่อม/ถอนแล้ว\n\n` +
      `ยืนยัน?`,
    )
    if (!confirmed) return
    try {
      setSaving(true)
      const res = await fetch('/api/itam/meter-readings/force-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetCode: selected.assetCode,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Force-close failed')
      }
      const j = await res.json()
      toast.success(
        `ปิดเดือน ${selected.assetCode} ด้วยค่ามิเตอร์เดิม (BW=${j.reusedFrom?.meterBw ?? 0})`,
        { description: 'ไม่มีการใช้กระดาษเพิ่มเติม (pages=0)' },
      )
      // Clear inputs and return to search
      setBwInput('')
      setColorInput('')
      setRemark('')
      setSearchInput('')
      setSearch('')
      setSelectedIndex(0)
      setFocus('search')
      void qc.invalidateQueries({ queryKey: ['itam-meter-keyboard'] })
      void qc.invalidateQueries({ queryKey: ['itam-readings'] })
      void qc.invalidateQueries({ queryKey: ['itam-dashboard'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  function exportUnread() {
    if (!devices.length) {
      toast.error('ไม่มีรายการที่จะส่งออก')
      return
    }
    const rows = devices.map((d) => ({
      assetCode: d.assetCode,
      brand: d.brand || '',
      model: d.model || '',
      serialNumber: d.serialNumber || '',
      site: d.site || '',
      building: d.building || '',
      floor: d.floor || '',
      department: d.department || '',
      meterMode: d.meterMode || 'TOTAL',
      lastMeterBw: d.lastMeterBw,
      lastMeterColor: d.lastMeterColor,
      readThisMonth: d.readThisMonth ? 'YES' : 'NO',
    }))
    const headers = Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
    downloadCsv(`unread-meters-${dateStamp()}.csv`, rows, headers)
  }

  const isColorMode = (selected?.meterMode || 'TOTAL').toUpperCase() === 'BW_COLOR'
  const bwNum = bwInput ? Number(bwInput) : NaN
  const colorNum = colorInput ? Number(colorInput) : 0
  const bwDelta = selected && Number.isFinite(bwNum) ? bwNum - selected.lastMeterBw : 0
  const colorDelta = selected && Number.isFinite(colorNum) ? colorNum - selected.lastMeterColor : 0
  const isReset = selected && (bwDelta < 0 || colorDelta < 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 p-3 dark:bg-slate-950 md:p-4">
      {/* Top: progress summary + compact latest result */}
      <Card className="mb-3 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                จดแล้ว <span className="text-[#f97316]">{(read ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
                <span className="mx-1 text-slate-400">/</span>
                ทั้งหมด {(total ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
              </span>
              <span className="text-xs text-slate-400">
                เหลือ <span className="font-medium text-slate-600 dark:text-slate-300">{(unread ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-300">
                คีย์ล่าสุด <span className="font-semibold text-emerald-600 dark:text-emerald-400">{recent.length}</span>
              </span>
              {isFetching && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
            </div>
            <Progress value={pct} className="h-2 bg-slate-200 dark:bg-slate-800" />
            {latest && (
              <div
                role="status"
                aria-live="polite"
                className="mt-1 truncate text-[11px] text-emerald-700 dark:text-emerald-300"
                title={`${latest.assetCode} · BW ${(latest.meterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} · Color ${latest.meterMode === 'BW_COLOR' ? (latest.meterColor ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB') : '—'} · Δ ${(latest.delta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} · ${fmtDateTime(latest.at, lang)}`}
              >
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                ล่าสุด {latest.assetCode} · BW {(latest.meterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} · Color {latest.meterMode === 'BW_COLOR' ? (latest.meterColor ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB') : '—'} · Δ {latest.delta > 0 ? '+' : ''}{(latest.delta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} · {fmtTime(latest.at, lang)} · {latest.reset ? 'RESET' : 'บันทึกสำเร็จ'}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Which month is being collected. Explicit, because the collection
                round does not have to match the calendar month: October's round
                may close September, and a device installed on the 28th should
                start in the following month instead of being back-dated. */}
            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs text-slate-500 dark:text-slate-400">เดือนที่จด</span>
              <Input
                type="month"
                value={targetMonth}
                onChange={(e) => {
                  const v = e.target.value
                  if (/^\d{4}-\d{2}$/.test(v)) setTargetMonth(v)
                }}
                aria-label="เดือนที่จดมิเตอร์"
                className="h-7 w-[7.5rem] border-0 px-1 py-0 text-xs font-medium shadow-none focus-visible:ring-1 dark:bg-slate-800"
              />
              <span className="whitespace-nowrap text-xs font-medium text-slate-700 dark:text-slate-200">
                {formatMonthThai(targetMonth)}
              </span>
              <button
                type="button"
                onClick={() => setTargetMonth((m) => shiftMeterMonth(m, -1))}
                title="ย้อนเดือนก่อนหน้า"
                aria-label="เดือนก่อนหน้า"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setTargetMonth((m) => shiftMeterMonth(m, 1))}
                title="เดือนถัดไป"
                aria-label="เดือนถัดไป"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              className="dark:bg-slate-800 dark:border-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" /> รีเฟรช
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={exportUnread}
              className="dark:bg-slate-800 dark:border-slate-700"
            >
              ส่งออก CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main split — left: search+list, right: input+recent */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_1fr] gap-3 lg:grid-cols-[1fr_1.05fr] lg:grid-rows-1">
        {/* Left: search + list */}
        <Card className="flex min-h-0 flex-col border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            {/* ── Recent 10 readings — STICKY at top of right panel ── */}
            {recent.length > 0 && (
              <div className="mb-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-2 dark:border-emerald-800 dark:bg-emerald-950/20">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    ✅ บันทึกล่าสุด ({Math.min(recent.length, 10)}/{recent.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setRecent([])}
                    className="text-[10px] text-slate-400 hover:text-rose-500"
                  >
                    ล้าง
                  </button>
                </div>
                <div className="itam-scroll max-h-32 space-y-1 overflow-y-auto">
                  {recent.slice(0, 10).map((r, i) => (
                    <div
                      key={r.assetCode + r.at}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] ${
                        i === 0
                          ? 'bg-emerald-100/80 dark:bg-emerald-950/40'
                          : 'bg-white/50 dark:bg-slate-800/30'
                      }`}
                    >
                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{r.assetCode}</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        BW {(r.meterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        {r.meterMode === 'BW_COLOR' && ` · สี ${(r.meterColor ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}`}
                      </span>
                      <span className={`ml-auto font-mono ${r.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                        Δ {r.delta > 0 ? '+' : ''}{(r.delta ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                      </span>
                      {r.reset && <span className="text-[9px] text-amber-600">RESET</span>}
                      <span className="text-[9px] text-slate-400">{fmtTime(r.at, lang)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Device search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                ref={searchInputRef}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setFocus('search')}
                placeholder="พิมพ์ Serial / Asset No. / รุ่น / แผนก แล้วกด Enter"
                className="h-11 pl-9 pr-12 text-base font-medium dark:bg-slate-800 dark:border-slate-700"
              />
              {/* SPRINT-3 #2: QR scan button — opens scanner, on scan fills
                  the search input + jumps to meter input automatically */}
              <button
                type="button"
                onClick={() => {
                  // Open the global QR scanner (defined in app-store)
                  useAppStore.getState().setQrScannerOpen(true)
                }}
                aria-label="สแกน QR เพื่อค้นอุปกรณ์"
                title="สแกน QR เพื่อค้นอุปกรณ์"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:bg-[#f97316]/10 hover:text-[#f97316] dark:text-slate-400 dark:hover:bg-[#f97316]/20"
              >
                <QrCode className="h-5 w-5" />
              </button>
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('')
                    setSearch('')
                    searchInputRef.current?.focus()
                  }}
                  className="absolute right-10 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                  aria-label="ล้างคำค้นหา"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="text-[11px] text-slate-400">
              ↑↓ เลือกเครื่อง · Enter ไปที่ช่องกรอก · Esc ล้าง · {devices.length} รายการ
            </div>

            <div
              ref={listRef}
              className="itam-scroll min-h-0 max-h-[42vh] flex-1 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800 lg:max-h-[55vh]"
            >
              {isLoading ? (
                <div className="space-y-1 p-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : devices.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <CheckCircle2 className="mb-2 h-8 w-8 text-emerald-500" />
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    จดครบทุกเครื่องแล้ว
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    ไม่มีเครื่องที่ต้องจดมิเตอร์ในเดือนนี้
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {devices.map((d, i) => {
                    const active = i === selectedIndex
                    return (
                      <li
                        key={d.id}
                        data-idx={i}
                        data-row-idx={i}
                        onClick={() => {
                          setSelectedIndex(i)
                          setFocus('meter')
                        }}
                        className={`cursor-pointer px-3 py-2 transition-colors ${
                          active
                            ? 'border-l-4 border-[#f97316] bg-orange-50/80 dark:bg-orange-950/30'
                            : 'border-l-4 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`font-mono text-xs font-semibold ${active ? 'text-[#f97316]' : 'text-slate-700 dark:text-slate-200'}`}>
                                {d.assetCode}
                              </span>
                              {/* SERIAL-FIRST (USER-FEEDBACK): show serial number
                                  prominently in the list so field operators can
                                  match the device they're standing in front of
                                  by reading the sticker on the machine. */}
                              {d.serialNumber && (
                                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400" title={`Serial: ${d.serialNumber}`}>
                                  SN: {d.serialNumber}
                                </span>
                              )}
                              {d.readThisMonth && (
                                <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px]">
                                  ✓ จดแล้ว
                                </Badge>
                              )}
                              {d.meterMode && d.meterMode.toUpperCase() === 'BW_COLOR' && (
                                <Badge variant="outline" className="text-[10px] text-teal-700 dark:text-teal-300">
                                  BW+สี
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                              {deviceLabel(d)} · {d.site || '—'} · {d.department || '—'}
                            </div>
                          </div>
                          <div className="text-right text-[10px] text-slate-400">
                            <div>มิเตอร์ {(d.lastMeterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div>
                            {d.lastMeterColor > 0 && <div>สี {(d.lastMeterColor ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</div>}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right: selected device + meter input */}
        <Card className="flex min-h-0 max-h-[55vh] flex-col border-slate-200 dark:border-slate-800 dark:bg-slate-900 lg:max-h-none">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <AnimatePresence mode="wait">
              {!selected ? (
                <motion.div
                  key="meter-empty-state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-1 flex-col items-center justify-center text-center text-slate-400"
                >
                  <Keyboard className="mb-2 h-10 w-10 text-slate-300 dark:text-slate-400" />
                  <div className="text-sm">เลือกเครื่องจากรายการด้านซ้าย หรือพิมพ์ค้นหาแล้วกด Enter</div>
                </motion.div>
              ) : (
                <motion.div
                  key={selected.assetCode}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  className="itam-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
                >
                  {/* Device header */}
                  <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-[#f97316] px-2 py-0.5 font-mono text-sm font-bold text-white">
                          {selected.assetCode}
                        </span>
                        {selected.assetSiteCode && (
                          <span className="font-mono text-xs text-slate-500">{selected.assetSiteCode}</span>
                        )}
                      </div>
                      <Badge
                        className={
                          isColorMode
                            ? 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-950 dark:text-teal-300'
                            : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
                        }
                      >
                        {isColorMode ? 'BW_COLOR' : 'TOTAL'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                      {deviceLabel(selected)}
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-slate-500 dark:text-slate-400">
                      <div>สาขา: {selected.site || '—'}</div>
                      <div>แผนก: {selected.department || '—'}</div>
                      <div>อาคาร/ชั้น: {selected.building || '—'} / {selected.floor || '—'}</div>
                      <div>ที่ตั้ง: {selected.location || '—'}</div>
                      <div>Serial: <span className="font-mono">{selected.serialNumber || '—'}</span></div>
                      <div>เดือน: <span className="font-mono">{data?.month || '—'}</span></div>
                    </div>
                  </div>

                  {/* Last reading context — SPRINT-3 #2: make it BIG for sanity check */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md border-2 border-[#f97316]/30 bg-[#f97316]/5 p-3 dark:border-[#f97316]/40 dark:bg-[#f97316]/10">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-[#f97316]">
                        ค่ามิเตอร์ล่าสุด (BW)
                      </div>
                      <div className="font-mono text-2xl font-bold text-slate-800 dark:text-slate-100 sm:text-3xl">
                        {(selected.lastMeterBw ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        {isColorMode && (
                          <span className="ml-1 text-xs text-teal-600 dark:text-teal-300">/ {(selected.lastMeterColor ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {selected.lastReadingDate ? new Date(selected.lastReadingDate).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB') : 'ยังไม่เคยจด'}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 p-2 dark:border-slate-800">
                      <div className="text-[10px] uppercase text-slate-400">ส่วนต่าง (เดี๋ยวนี้)</div>
                      <div className={`font-mono text-base font-semibold ${
                        bwDelta + colorDelta < 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : bwDelta + colorDelta > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-500 dark:text-slate-300'
                      }`}>
                        {(bwDelta + colorDelta) > 0 ? '+' : ''}{((bwDelta ?? 0) + (colorDelta ?? 0)).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                      </div>
                      <div className="text-[10px] text-slate-400">แผ่นที่จะใช้</div>
                    </div>
                  </div>

                  {/* Meter input form */}
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">
                          ค่ามิเตอร์{isColorMode ? ' ขาวดำ' : ''} <span className="text-rose-500">*</span>
                        </Label>
                        <Input
                          ref={bwInputRef}
                          type="number"
                          inputMode="numeric"
                          value={bwInput}
                          onChange={(e) => setBwInput(e.target.value)}
                          onFocus={(e) => { setFocus('meter'); e.target.select() }}
                          placeholder="เช่น 5000"
                          className={`h-12 text-lg font-mono tabular-nums dark:bg-slate-800 dark:border-slate-700 ${
                            bwDelta < 0 ? 'border-amber-400 focus-visible:ring-amber-200 dark:border-amber-600' : ''
                          }`}
                        />
                      </div>
                      {isColorMode && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">ค่ามิเตอร์ สี</Label>
                          <Input
                            ref={colorInputRef}
                            type="number"
                            inputMode="numeric"
                            value={colorInput}
                            onChange={(e) => setColorInput(e.target.value)}
                            onFocus={(e) => { setFocus('meter'); e.target.select() }}
                            placeholder="เช่น 1200"
                            className={`h-12 text-lg font-mono tabular-nums dark:bg-slate-800 dark:border-slate-700 ${
                              colorDelta < 0 ? 'border-amber-400 focus-visible:ring-amber-200 dark:border-amber-600' : ''
                            }`}
                          />
                        </div>
                      )}
                    </div>

                    {isReset && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>ค่าใหม่น้อยกว่าค่าก่อนหน้า (RESET) — กรุณาระบุหมายเหตุ</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label className="text-xs">หมายเหตุ {isReset && <span className="text-rose-500">*</span>}</Label>
                      <Textarea
                        value={remark}
                        onChange={(e) => setRemark(e.target.value)}
                        rows={2}
                        placeholder={isReset ? 'เหตุผลที่ค่าลดลง (RESET)' : 'หมายเหตุ (ถ้ามี)'}
                        className="text-xs dark:bg-slate-800 dark:border-slate-700"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Always-visible action bar (OUTSIDE scrollable motion.div) ── */}
            {selected && (
              <div className="flex flex-shrink-0 flex-col gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Button
                    onClick={saveReading}
                    disabled={saving || !Number.isFinite(bwNum) || (isReset && !remark.trim())}
                    className="flex-1 bg-[#f97316] text-white hover:bg-[#ea580c]"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> กำลังบันทึก...
                      </>
                    ) : (
                      <>
                        <CornerDownLeft className="mr-1.5 h-4 w-4" /> บันทึก + ถัดไป
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={forceCloseMonth}
                    disabled={saving}
                    title="ปิดเดือนด้วยค่ามิเตอร์เดิม — ใช้กับเครื่องที่จดไม่ได้จริง เช่น พัง/ส่งซ่อม/ถอนแล้ว"
                    aria-label="ปิดเดือนด้วยค่ามิเตอร์เดิม"
                    className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40"
                  >
                    <Lock className="mr-1.5 h-4 w-4" /> ปิดเดือนเดิม
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setFocus('search')}
                    className="dark:bg-slate-800 dark:border-slate-700"
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1"><ArrowUp className="h-3 w-3" />/<ArrowDown className="h-3 w-3" /> เลือกเครื่อง</span>
                    <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> บันทึก</span>
                  </div>
                  <span>Enter ในช่องค้นหา → กระโดดไปที่ช่องกรอก</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
