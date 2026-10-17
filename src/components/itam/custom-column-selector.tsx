'use client'

/**
 * CustomColumnSelector — เลือกคอลัมน์ที่จะแสดงในตารางรายงาน
 *
 * Features:
 *   - เลือก/ยกเลิกคอลัมน์ได้ (checkbox)
 *   - ลากเรียงลำดับได้ (up/down buttons)
 *   - บันทึกการเลือกใน localStorage
 *   - Reset เป็นค่าเริ่มต้นได้
 *
 * Usage:
 *   <CustomColumnSelector
 *     storageKey="reports-device-columns"
 *     columns={[
 *       { key: 'assetCode', label: 'รหัส', default: true },
 *       { key: 'name', label: 'ชื่อ', default: true },
 *     ]}
 *     selected={selectedColumns}
 *     onChange={setSelectedColumns}
 *   />
 */

import * as React from 'react'
import { Settings2, ChevronUp, ChevronDown, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'

export interface ColumnDef {
  key: string
  label: string
  default?: boolean
}

interface Props {
  storageKey: string
  columns: ColumnDef[]
  selected: string[]
  onChange: (selected: string[]) => void
}

export function CustomColumnSelector({ storageKey, columns, selected, onChange }: Props) {
  const [open, setOpen] = React.useState(false)

  // Load from localStorage on mount
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as string[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          onChange(parsed)
          return
        }
      }
    } catch { /* ignore */ }
    // Default: use columns with default=true
    const defaults = columns.filter((c) => c.default).map((c) => c.key)
    onChange(defaults.length > 0 ? defaults : columns.map((c) => c.key))
  }, [storageKey])

  // Save to localStorage when changed
  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(selected))
    } catch { /* ignore */ }
  }, [storageKey, selected])

  const toggle = (key: string) => {
    if (selected.includes(key)) {
      onChange(selected.filter((k) => k !== key))
    } else {
      onChange([...selected, key])
    }
  }

  const moveUp = (key: string) => {
    const idx = selected.indexOf(key)
    if (idx > 0) {
      const next = [...selected]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      onChange(next)
    }
  }

  const moveDown = (key: string) => {
    const idx = selected.indexOf(key)
    if (idx < selected.length - 1) {
      const next = [...selected]
      ;[next[idx + 1], next[idx]] = [next[idx], next[idx + 1]]
      onChange(next)
    }
  }

  const reset = () => {
    const defaults = columns.filter((c) => c.default).map((c) => c.key)
    onChange(defaults.length > 0 ? defaults : columns.map((c) => c.key))
  }

  // Get ordered columns (selected first, then unselected)
  const orderedColumns = [
    ...selected.map((k) => columns.find((c) => c.key === k)).filter(Boolean),
    ...columns.filter((c) => !selected.includes(c.key)),
  ] as ColumnDef[]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Settings2 className="h-3.5 w-3.5" />
          ปรับคอลัมน์
          {selected.length > 0 && (
            <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] dark:bg-slate-700">
              {selected.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">เลือกคอลัมน์</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={reset}>
            <RotateCcw className="mr-1 h-3 w-3" />
            ค่าเริ่มต้น
          </Button>
        </div>
        <Separator className="mb-2" />
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {orderedColumns.map((col) => {
            const isSelected = selected.includes(col.key)
            const idx = selected.indexOf(col.key)
            return (
              <div
                key={col.key}
                className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggle(col.key)}
                  className="h-4 w-4"
                />
                <Label className="flex-1 cursor-pointer text-xs">{col.label}</Label>
                {isSelected && (
                  <div className="flex gap-0.5">
                    <button
                      onClick={() => moveUp(col.key)}
                      disabled={idx === 0}
                      className="rounded p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 dark:hover:text-slate-200"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => moveDown(col.key)}
                      disabled={idx === selected.length - 1}
                      className="rounded p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-30 dark:hover:text-slate-200"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
