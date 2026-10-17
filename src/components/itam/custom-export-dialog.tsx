'use client'

/**
 * CustomExportDialog — lets the user pick which columns to export, reorder
 * them, and choose between CSV / Excel / PDF formats. Selection persists
 * in localStorage so the same set is reused next time.
 *
 * Used by:
 *   • devices-page.tsx (replaces the simple `exportCsv` for the "ส่งออก CSV"
 *     button — clicking opens this dialog instead of immediately downloading)
 *
 * Architecture:
 *   • Column list = `availableColumns` prop (caller defines what's exportable)
 *   • Selected columns = ordered list in `selected` state
 *   • Reorder via up/down arrow buttons (drag-and-drop was considered but
 *     adds ~30KB of lib weight for marginal UX gain on a list of ~30 items)
 *   • Format = 'csv' | 'xlsx' | 'pdf' — each handled by a different helper
 *   • `onExport(columns, format)` callback — caller fetches data + triggers
 *     the actual download using the chosen columns
 */
import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { useLang } from '@/store/i18n-store'
import {
  Download,
  FileSpreadsheet,
  FileText,
  ArrowUp,
  ArrowDown,
  X,
  CheckCheck,
  RotateCcw,
} from 'lucide-react'

export interface ExportColumn {
  key: string
  label: string
  /** Optional group label for visual grouping in the picker. */
  group?: string
}

export type ExportFormat = 'csv' | 'xlsx' | 'pdf'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** All columns that can be exported. */
  availableColumns: ExportColumn[]
  /** Caller fetches data and triggers the actual download. */
  onExport: (columns: ExportColumn[], format: ExportFormat) => Promise<void> | void
  /** localStorage key for persisting selection. Caller namespaces per-page. */
  storageKey: string
  /** Default selected column keys (used when no persisted selection). */
  defaultSelectedKeys?: string[]
  /** Total row count shown in the dialog footer (for context). */
  totalRows?: number
}

export function CustomExportDialog({
  open,
  onOpenChange,
  availableColumns,
  onExport,
  storageKey,
  defaultSelectedKeys,
  totalRows,
}: Props) {
  const { lang } = useLang()
  // Persisted selection: ordered list of column keys
  const [selectedKeys, setSelectedKeys] = React.useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        // Filter to only keys that exist in availableColumns
        const valid = parsed.filter((k) => availableColumns.some((c) => c.key === k))
        if (valid.length > 0) return valid
      }
    } catch (e) { console.error(String(e)) }
    return defaultSelectedKeys ?? availableColumns.map((c) => c.key)
  })
  const [format, setFormat] = React.useState<ExportFormat>('csv')
  const [exporting, setExporting] = React.useState(false)
  const [filterQuery, setFilterQuery] = React.useState('')

  // Persist selection whenever it changes
  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(selectedKeys))
    } catch (e) { console.error(String(e)) }
  }, [selectedKeys, storageKey])

  // Group columns for the picker
  const grouped = React.useMemo(() => {
    const filtered = filterQuery.trim()
      ? availableColumns.filter(
          (c) =>
            c.label.toLowerCase().includes(filterQuery.toLowerCase())
            || c.key.toLowerCase().includes(filterQuery.toLowerCase()),
        )
      : availableColumns
    const groups = new Map<string, ExportColumn[]>()
    for (const col of filtered) {
      const g = col.group ?? 'อื่นๆ'
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g)!.push(col)
    }
    return Array.from(groups.entries())
  }, [availableColumns, filterQuery])

  const toggleColumn = (key: string) => {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key)
      }
      return [...prev, key]
    }
    )
  }

  const moveColumn = (key: string, direction: 'up' | 'down') => {
    setSelectedKeys((prev) => {
      const idx = prev.indexOf(key)
      if (idx === -1) return prev
      const newIdx = direction === 'up' ? idx - 1 : idx + 1
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
      return next
    })
  }

  const selectAll = () => setSelectedKeys(availableColumns.map((c) => c.key))
  const deselectAll = () => setSelectedKeys([])
  const resetToDefault = () => {
    setSelectedKeys(defaultSelectedKeys ?? availableColumns.map((c) => c.key))
    try {
      localStorage.removeItem(storageKey)
    } catch (e) { console.error(String(e)) }
  }

  const selectedColumns = React.useMemo(
    () =>
      selectedKeys
        .map((k) => availableColumns.find((c) => c.key === k))
        .filter((c): c is ExportColumn => Boolean(c)),
    [selectedKeys, availableColumns],
  )

  const handleExport = async () => {
    if (selectedColumns.length === 0) {
      toast.error('กรุณาเลือกอย่างน้อย 1 คอลัมน์')
      return
    }
    try {
      setExporting(true)
      await onExport(selectedColumns, format)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งออกไม่สำเร็จ')
    } finally {
      setExporting(false)
    }
  }

  const formatLabels: Record<ExportFormat, { label: string; icon: React.ReactNode; desc: string }> = {
    csv: {
      label: 'CSV',
      icon: <Download className="h-4 w-4" />,
      desc: 'เปิดใน Excel/Google Sheets รองรับภาษาไทย',
    },
    xlsx: {
      label: 'Excel',
      icon: <FileSpreadsheet className="h-4 w-4" />,
      desc: 'ไฟล์ .xlsx มี header styling',
    },
    pdf: {
      label: 'PDF',
      icon: <FileText className="h-4 w-4" />,
      desc: 'เหมาะสำหรับพิมพ์ (≤500 แถว)',
    },
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-[#f97316]" />
            ส่งออกข้อมูลแบบกำหนดเอง
          </DialogTitle>
          <DialogDescription>
            เลือกคอลัมน์และจัดลำดับตามต้องการ — การตั้งค่าจะบันทึกอัตโนมัติสำหรับครั้งต่อไป
            {typeof totalRows === 'number' && (
              <span className="ml-2 inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {totalRows.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* SPRINT-3 #5: Export Presets — one-click column selection */}
        <div className="flex flex-wrap gap-1.5 rounded-md bg-slate-50 p-2 dark:bg-slate-800/50">
          <span className="self-center text-[11px] font-medium text-slate-500 dark:text-slate-400">Preset:</span>
          <button
            type="button"
            onClick={() => {
              // IT Report — focus on asset + location + status
              const itKeys = availableColumns
                .filter(c => ['assetCode', 'name', 'type', 'brand', 'model', 'site', 'department', 'status', 'location', 'building', 'floor'].includes(c.key))
                .map(c => c.key)
              setSelectedKeys(itKeys)
              localStorage.setItem(storageKey, JSON.stringify(itKeys))
            }}
            className="rounded-md border border-[#f97316]/30 bg-white px-2 py-1 text-[11px] font-medium text-[#f97316] transition-colors hover:bg-[#f97316]/10 dark:bg-slate-900 dark:border-[#f97316]/40"
          >
            📋 IT Report
          </button>
          <button
            type="button"
            onClick={() => {
              // Finance Report — focus on cost + depreciation
              const finKeys = availableColumns
                .filter(c => ['assetCode', 'name', 'site', 'purchaseDate', 'purchasePrice', 'salvageValue', 'usefulLife', 'warrantyEnd', 'vendor', 'contractNo', 'status'].includes(c.key))
                .map(c => c.key)
              setSelectedKeys(finKeys)
              localStorage.setItem(storageKey, JSON.stringify(finKeys))
            }}
            className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:bg-slate-900 dark:border-emerald-700 dark:text-emerald-300"
          >
            💰 Finance
          </button>
          <button
            type="button"
            onClick={selectAll}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300"
          >
            📦 Full Export
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* ── LEFT: Available columns ── */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800">
            <div className="border-b border-slate-200 p-3 dark:border-slate-800">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  คอลัมน์ทั้งหมด ({availableColumns.length})
                </Label>
                <div className="flex gap-1 text-xs">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="rounded px-2 py-0.5 text-[#f97316] hover:bg-[#f97316]/10"
                  >
                    เลือกทั้งหมด
                  </button>
                  <button
                    type="button"
                    onClick={deselectAll}
                    className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    ล้าง
                  </button>
                </div>
              </div>
              <Input
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="ค้นหาคอลัมน์..."
                className="h-8 text-sm"
              />
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {grouped.map(([group, cols]) => (
                <div key={group} className="mb-2">
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {group}
                  </div>
                  {cols.map((col) => {
                    const checked = selectedKeys.includes(col.key)
                    return (
                      <label
                        key={col.key}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleColumn(col.key)}
                          className="border-slate-300 data-[state=checked]:bg-[#f97316] data-[state=checked]:border-[#f97316] data-[state=checked]:text-white dark:border-slate-600"
                        />
                        <span className="text-slate-700 dark:text-slate-300">
                          {col.label}
                        </span>
                        <span className="ml-auto font-mono text-[10px] text-slate-400 dark:text-slate-500">
                          {col.key}
                        </span>
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Selected columns (ordered) + format ── */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800">
            <div className="border-b border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  คอลัมน์ที่เลือก ({selectedColumns.length})
                </Label>
                <button
                  type="button"
                  onClick={resetToDefault}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  title="รีเซ็ตเป็นค่าเริ่มต้น"
                >
                  <RotateCcw className="h-3 w-3" />
                  รีเซ็ต
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                ลำดับจากบนลงล่าง = ลำดับคอลัมน์ในไฟล์ที่ส่งออก (ซ้าย → ขวา)
              </p>
            </div>
            <div className="max-h-[40vh] overflow-y-auto p-2">
              {selectedColumns.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  ยังไม่ได้เลือกคอลัมน์ — เลือกจากรายการด้านซ้าย
                </div>
              ) : (
                selectedColumns.map((col, idx) => (
                  <div
                    key={col.key}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-[#f97316]/10 text-[10px] font-bold text-[#f97316] dark:bg-[#fb923c]/10 dark:text-[#fb923c]">
                      {idx + 1}
                    </span>
                    <span className="flex-1 truncate text-slate-700 dark:text-slate-300">
                      {col.label}
                    </span>
                    <div className="flex flex-shrink-0 gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveColumn(col.key, 'up')}
                        disabled={idx === 0}
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                        aria-label="เลื่อนขึ้น"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveColumn(col.key, 'down')}
                        disabled={idx === selectedColumns.length - 1}
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                        aria-label="เลื่อนลง"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleColumn(col.key)}
                        className="rounded p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/40"
                        aria-label={`เอา ${col.label} ออก`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Format selector ── */}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            รูปแบบไฟล์
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(formatLabels) as ExportFormat[]).map((fmt) => {
              const info = formatLabels[fmt]
              const isActive = format === fmt
              return (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setFormat(fmt)}
                  className={
                    'flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-all ' +
                    (isActive
                      ? 'border-[#f97316] bg-[#f97316]/5 text-[#f97316] ring-1 ring-[#f97316] dark:border-[#fb923c] dark:bg-[#fb923c]/5 dark:text-[#fb923c]'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800')
                  }
                >
                  {info.icon}
                  <span className="text-sm font-medium">{info.label}</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    {info.desc}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            ยกเลิก
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting || selectedColumns.length === 0}
            className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            {exporting ? (
              <>กำลังส่งออก...</>
            ) : (
              <>
                <CheckCheck className="h-4 w-4" />
                ส่งออก {selectedColumns.length} คอลัมน์ ({formatLabels[format].label})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
