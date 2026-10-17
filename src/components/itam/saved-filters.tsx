'use client'

/**
 * SavedFilters — persist named filter combinations to localStorage.
 *
 * Why this exists:
 *   Google Apps Script has no persistent UI state — every page reload wipes
 *   the user's filter choices. Next.js + localStorage can save named filter
 *   "presets" the user builds and re-uses, plus auto-restore the last-used
 *   filter on page load.
 *
 * Shape:
 *   • SavedFilter { id, name, createdAt, filters: { search, status, type } }
 *   • Stored under key 'itam.saved-filters.v1' as a JSON array
 *   • Last-used filter stored under 'itam.last-filter.v1' (auto-applied on mount)
 *
 * UX:
 *   • Below the toolbar, render saved-filter chips: [📌 Active only @ HQ] [×]
 *   • "⭐ บันทึกตัวกรอง" button → small inline dialog → name → save
 *   • Click a chip → apply filters immediately
 *   • × on chip → delete
 *   • "ล้างตัวกรอง" → reset to defaults
 */

import * as React from 'react'
import { Star, Trash2, X, Bookmark, RotateCcw, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'

export interface FilterCombo {
  search: string
  status: string
  type: string
}

export interface SavedFilter {
  id: string
  name: string
  createdAt: number
  filters: FilterCombo
}

const STORAGE_KEY = 'itam.saved-filters.v1'
const LAST_FILTER_KEY = 'itam.last-filter.v1'
const MAX_SAVED = 30

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function safeWrite(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (err) { console.error('[saved-filters]', err) }
}

function loadSaved(): SavedFilter[] {
  return safeRead<SavedFilter[]>(STORAGE_KEY, [])
}

function loadLast(): FilterCombo | null {
  return safeRead<FilterCombo | null>(LAST_FILTER_KEY, null)
}

function describeFilter(f: FilterCombo): string {
  const parts: string[] = []
  if (f.search) parts.push(`"${f.search}"`)
  if (f.status && f.status !== 'all') parts.push(f.status)
  if (f.type && f.type !== 'all') parts.push(f.type)
  return parts.length ? parts.join(' · ') : 'ทุกอุปกรณ์'
}

interface SavedFiltersProps {
  /** Current filter combo. */
  current: FilterCombo
  /** Called when the user picks a saved filter or restores the last one. */
  onApply: (filters: FilterCombo) => void
  /** Called when the user clears all filters. */
  onReset?: () => void
}

export function SavedFilters({ current, onApply, onReset }: SavedFiltersProps) {
  const [saved, setSaved] = React.useState<SavedFilter[]>([])
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [manageOpen, setManageOpen] = React.useState(false)
  const [restoredLast, setRestoredLast] = React.useState(false)

  // Hydrate from localStorage on mount
  React.useEffect(() => {
    setSaved(loadSaved())
  }, [])

  // Auto-restore last-used filter on mount (only once)
  React.useEffect(() => {
    if (restoredLast) return
    const last = loadLast()
    if (last) {
      onApply(last)
    }
    setRestoredLast(true)
  }, [])

  // Persist current filter as "last used" whenever it changes
  React.useEffect(() => {
    if (!restoredLast) return
    safeWrite(LAST_FILTER_KEY, current)
  }, [current, restoredLast])

  function persist(next: SavedFilter[]) {
    setSaved(next)
    safeWrite(STORAGE_KEY, next)
  }

  function openSave() {
    setNewName(describeFilter(current).slice(0, 40))
    setSaveOpen(true)
  }

  function confirmSave() {
    const name = newName.trim()
    if (!name) {
      toast.error('กรุณาตั้งชื่อตัวกรอง')
      return
    }
    if (saved.length >= MAX_SAVED) {
      toast.error(`บันทึกได้สูงสุด ${MAX_SAVED} รายการ`)
      return
    }
    const entry: SavedFilter = {
      id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      createdAt: Date.now(),
      filters: { ...current },
    }
    persist([entry, ...saved])
    setSaveOpen(false)
    setNewName('')
    toast.success(`บันทึกตัวกรอง "${name}" แล้ว`)
  }

  function applyFilter(f: SavedFilter) {
    onApply({ ...f.filters })
    toast.success(`ใช้ตัวกรอง "${f.name}"`)
  }

  function deleteFilter(id: string) {
    persist(saved.filter((f) => f.id !== id))
  }

  function handleReset() {
    onReset?.()
    onApply({ search: '', status: 'all', type: 'all' })
    toast.info('ล้างตัวกรองทั้งหมด')
  }

  const hasActiveFilter =
    !!current.search || (current.status && current.status !== 'all') || (current.type && current.type !== 'all')

  // Don't render the chip strip if there's nothing to show (no saved filters
  // and no active filter) — keeps the UI clean for first-time users.
  if (saved.length === 0 && !hasActiveFilter) {
    return (
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <Bookmark className="h-3 w-3" />
          ยังไม่มีตัวกรองที่บันทึกไว้ — ตั้งค่าตัวกรองแล้วกด ⭐ เพื่อบันทึก
        </span>
        <Button size="sm" variant="ghost" onClick={openSave} className="h-6 px-2 text-[11px]">
          <Star className="h-3 w-3" /> บันทึกตัวกรอง
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
        <Bookmark className="h-3 w-3" />
        <span className="hidden sm:inline">ตัวกรองล่าสุด:</span>
      </span>
      {saved.slice(0, 8).map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => applyFilter(f)}
          title={`${f.name} — ${describeFilter(f.filters)}`}
          className="group inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[11px] font-medium text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300 dark:hover:bg-orange-950/60"
        >
          <Star className="h-2.5 w-2.5" />
          <span className="max-w-[120px] truncate">{f.name}</span>
          <span
            role="button"
            tabIndex={0}
            aria-label={`ลบตัวกรอง ${f.name}`}
            onClick={(e) => {
              e.stopPropagation()
              deleteFilter(f.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                deleteFilter(f.id)
              }
            }}
            className="-mr-1 ml-0.5 rounded-full p-0.5 text-orange-400 opacity-0 transition group-hover:opacity-100 hover:bg-orange-200 hover:text-orange-800 dark:hover:bg-orange-900 dark:hover:text-orange-100"
          >
            <X className="h-2.5 w-2.5" />
          </span>
        </button>
      ))}
      {saved.length > 8 && (
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
        >
          +{saved.length - 8} รายการ
        </button>
      )}
      {hasActiveFilter && (
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <RotateCcw className="h-2.5 w-2.5" /> ล้าง
        </button>
      )}
      <Button size="sm" variant="ghost" onClick={openSave} className="h-6 px-2 text-[11px] text-slate-600 dark:text-slate-300">
        <Star className="h-3 w-3" /> บันทึก
      </Button>

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Star className="h-4 w-4 text-[#f97316]" /> บันทึกตัวกรอง
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">ชื่อตัวกรอง</label>
              <Input
                autoFocus
                placeholder="เช่น Active only · HQ · PRINTER"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmSave()
                }}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <div className="mb-1 font-semibold text-slate-700 dark:text-slate-200">ตัวกรองที่จะบันทึก:</div>
              <div className="space-y-0.5">
                <div>คำค้น: <span className="font-mono">{current.search || '—'}</span></div>
                <div>สถานะ: <span className="font-mono">{current.status || 'all'}</span></div>
                <div>ประเภท: <span className="font-mono">{current.type || 'all'}</span></div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} className="dark:bg-slate-800 dark:border-slate-700">
              ยกเลิก
            </Button>
            <Button onClick={confirmSave} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
              <Check className="h-4 w-4" /> บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage (all saved) dialog */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Bookmark className="h-4 w-4 text-[#f97316]" /> ตัวกรองที่บันทึกไว้ ({saved.length})
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 space-y-1.5 overflow-y-auto py-2">
            {saved.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">ยังไม่มีตัวกรองที่บันทึกไว้</div>
            ) : (
              saved.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{f.name}</div>
                    <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{describeFilter(f.filters)}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      applyFilter(f)
                      setManageOpen(false)
                    }}
                    className="h-7 px-2 text-[11px]"
                  >
                    ใช้
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteFilter(f.id)}
                    className="h-7 w-7 p-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    aria-label={`ลบตัวกรอง ${f.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOpen(false)} className="dark:bg-slate-800 dark:border-slate-700">
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
