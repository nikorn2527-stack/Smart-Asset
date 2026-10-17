'use client'

/**
 * ReplaceDeviceDialog — "เปลี่ยนเครื่องหลัก" dialog.
 *
 * Lets a staff user replace an old device with a new (already-registered)
 * device. Migrates accessories, Device Set children, active assignments,
 * active PM schedules (and optionally licenses) to the new device, and
 * marks the old device as "Replaced".
 *
 * Difference from the existing "เครื่องทดแทน" flow in the Lifecycle action
 * dialog:
 *   - That flow (replace-on-withdraw) is for emergency swap-outs where the
 *     spare device is moved to the same location + status set to ACTIVE.
 *   - This flow is for permanent replacement where the new device already
 *     has its own location/asset code and we just migrate the "logical"
 *     ownership (accessories, assignments, etc.) to it.
 *
 * Used by: DeviceDetailSheet → footer action button "เปลี่ยนเครื่องหลัก".
 */

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, RefreshCw, Search, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useAuthStore } from '@/store/auth-store'
import type { Device } from './types'
import { bearerHeaders } from '@/lib/http-headers'

interface ReplaceDeviceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The old device that will be replaced. */
  oldDevice: Device | null | undefined
  /** Called after a successful replace — used to refresh parent lists. */
  onReplaced?: (data: {
    oldDeviceId: string
    newDeviceId: string
    movedCounts: {
      accessories: number
      children: number
      assignments: number
      pmSchedules: number
      licenses: number
    }
  }) => void
}

// ── Move-toggle row ────────────────────────────────────────────────────
interface MoveOption {
  key: 'moveAccessories' | 'moveChildren' | 'moveAssignments' | 'movePMSchedules' | 'moveLicenses'
  label: string
  description: string
  defaultChecked: boolean
}

const MOVE_OPTIONS: MoveOption[] = [
  {
    key: 'moveAccessories',
    label: 'อุปกรณ์ต่อพ่วง (Accessories)',
    description: 'คีย์บอร์ด, เมาส์, จอ, สาย, UPS — โอน parentDeviceId ไปเครื่องใหม่',
    defaultChecked: true,
  },
  {
    key: 'moveChildren',
    label: 'อุปกรณ์ในชุด (Device Set children)',
    description: 'อุปกรณ์ที่อ้างอิงเครื่องนี้เป็น parent — โอน parentDeviceId ไปเครื่องใหม่',
    defaultChecked: true,
  },
  {
    key: 'moveAssignments',
    label: 'การมอบหมาย (Active assignments)',
    description: 'ผู้ใช้งานปัจจุบัน — โอนเฉพาะที่ status="active" (เก็บประวัติเดิมไว้)',
    defaultChecked: true,
  },
  {
    key: 'movePMSchedules',
    label: 'แผน PM (Active PM schedules)',
    description: 'แผนบำรุงรักษาป้องกัน — โอนเฉพาะที่ active=true',
    defaultChecked: true,
  },
  {
    key: 'moveLicenses',
    label: 'ลิขสิทธิ์ซอฟต์แวร์ (Licenses)',
    description: '⚠️ ปิดเป็นค่าเริ่มต้น — license จะถูก deactivate บนเครื่องเดิม (ไม่ย้ายไปเครื่องใหม่)',
    defaultChecked: false,
  },
]

interface CandidateDevice {
  id: string
  assetCode: string
  name: string
  brand: string | null
  model: string | null
  type: string | null
  status: string
  site: string | null
  serialNumber: string | null
}

export function ReplaceDeviceDialog({
  open,
  onOpenChange,
  oldDevice,
  onReplaced,
}: ReplaceDeviceDialogProps) {
  const token = useAuthStore((s) => s.token)
  const qc = useQueryClient()

  // ── Search + candidate selection ──
  const [search, setSearch] = React.useState('')
  const [candidates, setCandidates] = React.useState<CandidateDevice[]>([])
  const [searching, setSearching] = React.useState(false)
  const [selectedNewId, setSelectedNewId] = React.useState<string | null>(null)

  // ── Move toggles ──
  const [moveFlags, setMoveFlags] = React.useState<Record<MoveOption['key'], boolean>>({
    moveAccessories: true,
    moveChildren: true,
    moveAssignments: true,
    movePMSchedules: true,
    moveLicenses: false,
  })

  // ── Reason + submission ──
  const [reason, setReason] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [successData, setSuccessData] = React.useState<{
    oldDeviceId: string
    newDeviceId: string
    movedCounts: {
      accessories: number
      children: number
      assignments: number
      pmSchedules: number
      licenses: number
    }
  } | null>(null)

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setSearch('')
      setCandidates([])
      setSelectedNewId(null)
      setMoveFlags({
        moveAccessories: true,
        moveChildren: true,
        moveAssignments: true,
        movePMSchedules: true,
        moveLicenses: false,
      })
      setReason('')
      setSuccessData(null)
    }
  }, [open])

  // ── Debounced search for candidate devices ──
  React.useEffect(() => {
    if (!open || !oldDevice) return
    const q = search.trim()
    if (q.length < 2) {
      setCandidates([])
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: q, limit: '10', excludeReplaced: '1' })
        const res = await fetch(`/api/devices?${params.toString()}`, {
          headers: bearerHeaders(token),
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const json = (await res.json()) as { devices?: CandidateDevice[] }
        if (cancelled) return
        // Filter out the old device itself + already-replaced devices
        const filtered = (json.devices ?? []).filter(
          (d) => d.id !== oldDevice.id && d.status !== 'Replaced',
        )
        setCandidates(filtered)
      } catch {
        if (!cancelled) setCandidates([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, search, oldDevice, token])

  async function handleSubmit() {
    if (!oldDevice || !selectedNewId) return
    // ── Validate reason (spec: required, min 5 chars) ──
    const trimmedReason = reason.trim()
    if (trimmedReason.length < 5) {
      toast.error('กรุณาระบุเหตุผลในการเปลี่ยนเครื่องอย่างน้อย 5 ตัวอักษร')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/devices/${oldDevice.id}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          newDeviceId: selectedNewId,
          ...moveFlags,
          reason: trimmedReason,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: {
          oldDeviceId: string
          newDeviceId: string
          movedCounts: {
            accessories: number
            children: number
            assignments: number
            pmSchedules: number
            licenses: number
          }
        }
        error?: string
      }
      if (!res.ok || !json.data) {
        throw new Error(json.error ?? 'เปลี่ยนเครื่องหลักไม่สำเร็จ')
      }
      setSuccessData(json.data)
      toast.success(`เปลี่ยนเครื่องหลักเรียบร้อย — โอน ${sumMoved(json.data.movedCounts)} รายการไปยังเครื่องใหม่`)
      // Invalidate queries so lists refresh
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['device-detail', oldDevice.id] }),
        qc.invalidateQueries({ queryKey: ['device-detail', json.data.newDeviceId] }),
        qc.invalidateQueries({ queryKey: ['devices'] }),
        qc.invalidateQueries({ queryKey: ['device-assignments', oldDevice.id] }),
        qc.invalidateQueries({ queryKey: ['device-assignments', json.data.newDeviceId] }),
        qc.invalidateQueries({ queryKey: ['device-licenses', oldDevice.id] }),
        qc.invalidateQueries({ queryKey: ['device-licenses', json.data.newDeviceId] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ])
      onReplaced?.(json.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เปลี่ยนเครื่องหลักไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  function sumMoved(m: {
    accessories: number
    children: number
    assignments: number
    pmSchedules: number
    licenses: number
  }): number {
    return m.accessories + m.children + m.assignments + m.pmSchedules + m.licenses
  }

  const selectedCandidate = candidates.find((c) => c.id === selectedNewId) ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-lg dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <RefreshCw className="h-5 w-5 text-[#f97316]" />
            🔄 เปลี่ยนเครื่องหลัก
          </DialogTitle>
          <DialogDescription>
            แทนที่ <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{oldDevice?.assetCode}</span>
            {' '}({oldDevice?.name}) ด้วยเครื่องใหม่ — โอนอุปกรณ์ต่อพ่วง/ชุด/การมอบหมาย/แผน PM ไปเครื่องใหม่
          </DialogDescription>
        </DialogHeader>

        {successData ? (
          // ── Success state ──
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-6 text-center dark:border-emerald-800 dark:bg-emerald-950/40">
              <CheckCircle2 className="h-12 w-12 text-emerald-600 dark:text-emerald-400" />
              <div className="text-base font-semibold text-emerald-800 dark:text-emerald-200">
                เปลี่ยนเครื่องหลักเรียบร้อย
              </div>
              <div className="text-xs text-emerald-700 dark:text-emerald-300">
                สถานะเครื่องเดิมถูกตั้งเป็น "Replaced" — ข้อมูลถูกโอนไปยังเครื่องใหม่แล้ว
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                สรุปรายการที่โอน
              </h4>
              <ul className="space-y-1.5 text-sm">
                <MovedRow label="อุปกรณ์ต่อพ่วง" count={successData.movedCounts.accessories} />
                <MovedRow label="อุปกรณ์ในชุด" count={successData.movedCounts.children} />
                <MovedRow label="การมอบหมาย (active)" count={successData.movedCounts.assignments} />
                <MovedRow label="แผน PM (active)" count={successData.movedCounts.pmSchedules} />
                <MovedRow
                  label="ลิขสิทธิ์ซอฟต์แวร์"
                  count={successData.movedCounts.licenses}
                  suffix={moveFlags.moveLicenses ? '' : ' (deactivate บนเครื่องเดิม)'}
                />
              </ul>
              <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                เครื่องเดิม ID: <span className="font-mono">{successData.oldDeviceId}</span>
                <br />
                เครื่องใหม่ ID: <span className="font-mono">{successData.newDeviceId}</span>
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              ℹ️ License, Work Order, ประวัติมิเตอร์ ยังคงอยู่กับเครื่องเดิมเพื่อเก็บประวัติ
            </p>
          </div>
        ) : (
          // ── Form state ──
          <div className="itam-scroll max-h-[68vh] space-y-4 overflow-y-auto pr-1">
            {/* Warning banner */}
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <strong>⚠️ การเปลี่ยนเครื่องหลักจะตั้งสถานะเครื่องเดิมเป็น &quot;Replaced&quot;</strong>
                <br />
                <span className="text-amber-700 dark:text-amber-300">
                  การกระทำนี้ไม่สามารถย้อนกลับได้ — อุปกรณ์ต่อพ่วง/ชุด/การมอบหมาย/แผน PM ที่เลือกจะถูกโอนไปยังเครื่องใหม่ทันที
                </span>
              </div>
            </div>

            {/* New device picker */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ค้นหาเครื่องใหม่ (เครื่องสำรองที่จะใช้แทน) *
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="ค้นหาด้วยรหัสอุปกรณ์ / ชื่อ / ยี่ห้อ / SN..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                  autoFocus
                />
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                💡 พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา — ระบบจะกรองเครื่องที่ถูก Replace แล้วออกอัตโนมัติ
              </p>

              {/* Candidates list */}
              <div className="itam-scroll max-h-44 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
                {searching ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400 dark:text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> กำลังค้นหา...
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                    {search.trim().length < 2
                      ? 'พิมพ์เพื่อค้นหา'
                      : 'ไม่พบเครื่องที่ตรงกับเงื่อนไข'}
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {candidates.map((c) => {
                      const isSelected = c.id === selectedNewId
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedNewId(c.id)}
                            className={
                              'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ' +
                              (isSelected
                                ? 'bg-[#f97316]/10 dark:bg-[#f97316]/20'
                                : '')
                            }
                          >
                            <div
                              className={
                                'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ' +
                                (isSelected
                                  ? 'border-[#f97316] bg-[#f97316]'
                                  : 'border-slate-300 dark:border-slate-600')
                              }
                            >
                              {isSelected && <CheckCircle2 className="h-3 w-3 text-white" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-slate-800 dark:text-slate-100">
                                {c.name}
                              </div>
                              <div className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                                {c.assetCode} · {c.brand ?? '—'} {c.model ?? ''}
                              </div>
                            </div>
                            <Badge className="ml-auto border-slate-200 bg-slate-100 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {c.status}
                            </Badge>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {selectedCandidate && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <strong>เลือกเครื่องใหม่:</strong> {selectedCandidate.name}
                  {' '}
                  <span className="font-mono">({selectedCandidate.assetCode})</span>
                  {selectedCandidate.site && (
                    <span className="text-emerald-700 dark:text-emerald-300">
                      {' '}· สาขา: {selectedCandidate.site}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Move toggles */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                รายการที่จะโอนไปเครื่องใหม่
              </Label>
              <div className="space-y-1.5 rounded-md border border-slate-200 p-2 dark:border-slate-700">
                {MOVE_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <Checkbox
                      checked={moveFlags[opt.key]}
                      onCheckedChange={(checked) =>
                        setMoveFlags((prev) => ({ ...prev, [opt.key]: checked === true }))
                      }
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                        {opt.label}
                      </div>
                      <div className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                        {opt.description}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                เหตุผลในการเปลี่ยนเครื่องหลัก <span className="text-rose-500">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น เครื่องพิมพ์เน่า ซื้อเครื่องใหม่มาแทน / จำหน่ายเครื่องเดิม / เปลี่ยนรุ่น"
                rows={2}
                required
                minLength={5}
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                อย่างน้อย 5 ตัวอักษร — จะบันทึกใน audit log เพื่อความสามารถย้อนกลับไปตรวจสอบได้
                {reason.trim().length > 0 && reason.trim().length < 5 && (
                  <span className="ml-1 text-rose-500">
                    ({reason.trim().length}/5 — สั้นเกินไป)
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {successData ? (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="w-full"
            >
              ปิด
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                ยกเลิก
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || !selectedNewId || !oldDevice || reason.trim().length < 5}
                className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    กำลังเปลี่ยน...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-1.5 h-4 w-4" />
                    ยืนยันการเปลี่ยนเครื่อง
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Helper: render a moved-item row in the success summary ──
function MovedRow({ label, count, suffix }: { label: string; count: number; suffix?: string }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="flex items-center gap-1.5">
        {count > 0 ? (
          <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            {count} รายการ
          </Badge>
        ) : (
          <Badge className="border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            ไม่มี
          </Badge>
        )}
        {suffix && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">{suffix}</span>
        )}
      </span>
    </li>
  )
}
