'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AlertTriangle, Loader2, ClipboardList } from 'lucide-react'
import type { Device, Cycle } from './types'
import { useAuthStore } from '@/store/auth-store'
import { useLang } from '@/store/i18n-store'
import { bearerHeaders } from '@/lib/http-headers'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  devices: Device[]
  activeCycle: Cycle | null
}

interface RowState {
  newReading: string
  remark: string
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function BulkMeterDialog({
  open,
  onOpenChange,
  devices,
  activeCycle,
}: Props) {
  const { lang } = useLang()
  const qc = useQueryClient()
  const [readingDate, setReadingDate] = React.useState<string>(todayISO())
  const [rows, setRows] = React.useState<Record<string, RowState>>({})
  const [saving, setSaving] = React.useState(false)

  // Reset the form when the dialog opens (or when the device list changes)
  React.useEffect(() => {
    if (open) {
      const init: Record<string, RowState> = {}
      for (const d of devices) {
        init[d.id] = {
          // BUG-METER-003 fix: prefer lastMeterBw (canonical API field)
          newReading: String(d.lastMeterBw ?? d.lastMeterReading ?? 0),
          remark: '',
        }
      }
      setRows(init)
      setReadingDate(todayISO())
    }
  }, [open, devices])

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  // Only show meterable devices that are active or spare (skip disposed/repair)
  const eligibleDevices = React.useMemo(
    () =>
      devices.filter(
        (d) =>
          d.type === 'PRINTER' ||
          d.type === 'COPIER' ||
          d.type === 'MFP',
      ),
    [devices],
  )

  // Compute per-row validation/delta info
  const rowMeta = React.useMemo(() => {
    const map = new Map<
      string,
      {
        prev: number
        next: number | null
        delta: number
        isReset: boolean
        isExceed: boolean
        needsRemark: boolean
        changed: boolean
        valid: boolean
      }
    >()
    for (const d of eligibleDevices) {
      const r = rows[d.id]
      // BUG-METER-003 fix: prefer lastMeterBw (canonical API field)
      const prev = d.lastMeterBw ?? d.lastMeterReading ?? 0
      const trimmed = (r?.newReading ?? '').trim()
      const nextNum = trimmed === '' ? null : Number(trimmed)
      const next = nextNum !== null && Number.isFinite(nextNum) ? nextNum : null
      const delta = next !== null ? next - prev : 0
      const isReset = next !== null && next < prev
      const isExceed = next !== null && delta > 20000
      const remarkEmpty = !(r?.remark ?? '').trim()
      const needsRemark = isReset && remarkEmpty
      const changed = next !== null && next !== prev
      const valid = next !== null && !needsRemark
      map.set(d.id, {
        prev,
        next,
        delta,
        isReset,
        isExceed,
        needsRemark,
        changed,
        valid,
      })
    }
    return map
  }, [eligibleDevices, rows])

  const changedCount = React.useMemo(
    () =>
      Array.from(rowMeta.values()).filter((m) => m.changed && m.valid).length,
    [rowMeta],
  )
  const hasInvalidChange = React.useMemo(
    () =>
      Array.from(rowMeta.values()).some(
        (m) => m.changed && !m.valid,
      ),
    [rowMeta],
  )

  const canSave = changedCount > 0 && !hasInvalidChange && !saving

  async function handleSave() {
    if (!canSave) return
    // BUG-METER-002 fix: explicit pre-save validation. Previously rows with
    // needsRemark=true were silently filtered out (filter `m.meta.valid`)
    // — user clicked "บันทึก" and nothing happened, no feedback. Now we
    // surface a clear toast explaining which rows need a RESET remark.
    const invalidRows = eligibleDevices
      .map((d) => ({ device: d, meta: rowMeta.get(d.id)! }))
      .filter((m) => m.meta.changed && !m.meta.valid)
    if (invalidRows.length > 0) {
      const sample = invalidRows.slice(0, 3).map((m) => m.device.assetCode).join(', ')
      toast.error(
        `ต้องแก้ ${invalidRows.length} แถว: ค่ามิเตอร์ลดลงต้องระบุหมายเหตุ RESET (เช่น ${sample}${invalidRows.length > 3 ? ' และอีก ' + (invalidRows.length - 3) + ' แถว' : ''})`,
      )
      return
    }
    const toSave = eligibleDevices
      .map((d) => ({ device: d, meta: rowMeta.get(d.id)! }))
      .filter((m) => m.meta.changed && m.meta.valid)

    if (toSave.length === 0) return

    setSaving(true)
    try {
      const results = await Promise.allSettled(
        toSave.map(({ device, meta }) =>
          fetch('/api/meter', {
            method: 'POST',
            headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              deviceId: device.id,
              reading: meta.next,
              date: readingDate,
              remark: rows[device.id]?.remark?.trim() || null,
              cycleId: activeCycle?.id ?? null,
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const j = await res.json().catch(() => ({}))
              throw new Error(j.error ?? 'Save failed')
            }
            return res.json()
          }),
        ),
      )

      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - succeeded

      if (failed === 0) {
        toast.success(`บันทึก ${succeeded} เครื่องสำเร็จ`)
      } else if (succeeded === 0) {
        toast.error(`บันทึกล้มเหลวทั้ง ${failed} เครื่อง`)
      } else {
        toast.warning(`บันทึก ${succeeded} สำเร็จ, ${failed} ล้มเหลว`)
      }

      onOpenChange(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['devices-meter'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['meter-reminders'] }),
        qc.invalidateQueries({ queryKey: ['active-cycle'] }),
        qc.invalidateQueries({ queryKey: ['devices'] }),
        qc.invalidateQueries({ queryKey: ['device-meter'] }),
      ])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <ClipboardList className="h-5 w-5 text-[#f97316]" />
            📝 จดมิเตอร์หลายเครื่อง
          </DialogTitle>
          <DialogDescription>
            กรอกค่ามิเตอร์หลายเครื่องพร้อมกัน แล้วบันทึกทีเดียว
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Shared date input */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Label
                htmlFor="bulk-reading-date"
                className="text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                วันที่จด (ใช้กับทุกเครื่อง) *
              </Label>
              <Input
                id="bulk-reading-date"
                type="date"
                value={readingDate}
                onChange={(e) => setReadingDate(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              ทั้งหมด <span className="font-semibold">{eligibleDevices.length}</span> เครื่อง · เปลี่ยนแปลง{' '}
              <span className="font-semibold text-[#f97316]">{changedCount}</span> เครื่อง
            </div>
          </div>

          {/* Scrollable rows */}
          <div className="itam-scroll max-h-[50vh] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-50/90 backdrop-blur-sm dark:bg-slate-900/90">
                <TableRow>
                  <TableHead className="text-slate-600 dark:text-slate-300">รหัส</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">ชื่ออุปกรณ์</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-300">ค่าล่าสุด</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-300">ค่ามิเตอร์ใหม่</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-300">ส่วนต่าง</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligibleDevices.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-slate-400 dark:text-slate-500"
                    >
                      ไม่พบอุปกรณ์ที่ต้องจดมิเตอร์
                    </TableCell>
                  </TableRow>
                ) : (
                  eligibleDevices.map((d) => {
                    const m = rowMeta.get(d.id)!
                    const rowBg = m.changed
                      ? m.isReset
                        ? 'bg-amber-50/60 dark:bg-amber-950/20'
                        : m.isExceed
                          ? 'bg-rose-50/60 dark:bg-rose-950/20'
                          : 'bg-emerald-50/40 dark:bg-emerald-950/15'
                      : ''
                    return (
                      <TableRow key={d.id} className={rowBg}>
                        <TableCell className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
                          {d.assetCode}
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate text-slate-700 dark:text-slate-200">
                          {d.name}
                          <div className="text-[10px] text-slate-400 dark:text-slate-500">
                            {d.brand} {d.model} · {d.site}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {m.prev.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            inputMode="numeric"
                            value={rows[d.id]?.newReading ?? ''}
                            onChange={(e) =>
                              updateRow(d.id, { newReading: e.target.value })
                            }
                            className={
                              'ml-auto w-28 text-right ' +
                              (m.isReset
                                ? 'border-amber-400 focus-visible:ring-amber-200 dark:border-amber-600'
                                : m.isExceed
                                  ? 'border-rose-400 focus-visible:ring-rose-200 dark:border-rose-600'
                                  : m.changed
                                    ? 'border-emerald-300 focus-visible:ring-emerald-200 dark:border-emerald-700'
                                    : '')
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {!m.changed ? (
                            <span className="text-xs text-slate-300 dark:text-slate-400">—</span>
                          ) : (
                            <Badge
                              className={
                                'tabular-nums transition-colors hover:scale-105 ' +
                                (m.delta < 0
                                  ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  : m.isExceed
                                    ? 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                    : 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300')
                              }
                            >
                              {m.delta > 0 ? '+' : ''}
                              {m.delta.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                            </Badge>
                          )}
                          {m.isExceed && (
                            <AlertTriangle className="ml-1 inline h-3 w-3 text-rose-500" />
                          )}
                        </TableCell>
                        <TableCell>
                          {m.isReset ? (
                            <div className="flex flex-col gap-1">
                              <Textarea
                                value={rows[d.id]?.remark ?? ''}
                                onChange={(e) =>
                                  updateRow(d.id, { remark: e.target.value })
                                }
                                placeholder="เหตุผลที่ค่าลดลง (RESET) *"
                                rows={1}
                                className={
                                  'min-h-[36px] text-xs ' +
                                  (m.needsRemark
                                    ? 'border-amber-400 dark:border-amber-600'
                                    : '')
                                }
                              />
                              {m.needsRemark && (
                                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                  ต้องระบุหมายเหตุ
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300 dark:text-slate-400">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {hasInvalidChange && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                มีเครื่องที่ค่าใหม่น้อยกว่าค่าก่อนหน้า (RESET) แต่ยังไม่ได้ระบุหมายเหตุ — กรุณาระบุหมายเหตุก่อนบันทึก
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            ยกเลิก
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              `บันทึก (${changedCount} เครื่อง)`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
