'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, FileText, Star, LayoutTemplate } from 'lucide-react'
import type { DocumentTemplate } from '@/lib/document-template'

// Persistent last-selection in localStorage
const LAST_TPL_KEY = 'itam.lastDocTemplateId'

export interface DocumentTemplatePickerResult {
  /** 'standard' = use legacy layout (no template); 'template' = use the selected template */
  mode: 'standard' | 'template'
  /** When mode === 'template', the id of the selected template */
  templateId?: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when the user picks an option. Receives null if they cancel. */
  onSelect: (result: DocumentTemplatePickerResult | null) => void
  /** Title shown above the list (e.g. "ส่งออก PDF") */
  title?: string
}

interface PickerData {
  templates: DocumentTemplate[]
  activeId: string | null
  enabled: boolean
}

/**
 * Document Template Picker — shown when the user clicks "PDF" or "Custom → PDF".
 *
 * If document templates are disabled in settings, callers should bypass this
 * picker entirely and use the standard layout. This component assumes the
 * caller has already verified `enabled === true`.
 */
export function DocumentTemplatePicker({
  open,
  onOpenChange,
  onSelect,
  title = 'เลือกเทมเพลตเอกสาร PDF',
}: Props) {
  const { data, isLoading } = useQuery<PickerData>({
    queryKey: ['document-templates'],
    queryFn: async () => {
      const res = await fetch('/api/itam/document-templates')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: open,
  })

  const templates = data?.templates ?? []
  const activeId = data?.activeId ?? null

  // Last selection from localStorage (or activeId fallback)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!open) return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(LAST_TPL_KEY)
    } catch (e) { console.error(String(e)) }
    if (stored && templates.some((t) => t.id === stored)) {
      setSelectedId(stored)
    } else if (activeId) {
      setSelectedId(activeId)
    } else if (templates[0]) {
      setSelectedId(templates[0].id)
    } else {
      setSelectedId(null)
    }
  }, [open, templates, activeId])

  function confirm() {
    if (selectedId === '__standard__') {
      try { window.localStorage.setItem(LAST_TPL_KEY, '__standard__') } catch (e) { console.error(String(e)) }
      onSelect({ mode: 'standard' })
    } else if (selectedId) {
      try { window.localStorage.setItem(LAST_TPL_KEY, selectedId) } catch (e) { console.error(String(e)) }
      onSelect({ mode: 'template', templateId: selectedId })
    } else {
      toast.error('กรุณาเลือกเทมเพลต')
      return
    }
    onOpenChange(false)
  }

  function cancel() {
    onSelect(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) cancel(); onOpenChange(o) }}>
      <DialogContent className="sm:max-w-lg dark:border-slate-800 dark:bg-slate-900 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <LayoutTemplate className="h-5 w-5 text-[#f97316]" /> {title}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[#f97316]" />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              เลือกเทมเพลตที่จะใช้สำหรับส่งออก PDF หรือใช้ layout มาตรฐาน (ตารางอย่างเดียว ไม่มีส่วนหัว/สรุป/ลายเซ็น)
            </p>

            <div className="itam-scroll max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
              {/* Standard layout option */}
              <button
                type="button"
                onClick={() => setSelectedId('__standard__')}
                className={[
                  'flex w-full items-center gap-3 rounded-md border p-3 text-left transition',
                  selectedId === '__standard__'
                    ? 'border-[#f97316] bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30'
                    : 'border-slate-200 hover:border-orange-300 dark:border-slate-700 dark:hover:border-orange-700',
                ].join(' ')}
              >
                <FileText className="h-5 w-5 flex-shrink-0 text-slate-500 dark:text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    ใช้ layout มาตรฐาน
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    ตารางอย่างเดียว — ไม่มีเทมเพลต
                  </div>
                </div>
                {selectedId === '__standard__' && (
                  <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[9px] dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">
                    ✓ เลือก
                  </Badge>
                )}
              </button>

              {/* Template list */}
              {templates.map((t) => {
                const isSel = selectedId === t.id
                const isActive = activeId === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={[
                      'flex w-full items-center gap-3 rounded-md border p-3 text-left transition',
                      isSel
                        ? 'border-[#f97316] bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30'
                        : 'border-slate-200 hover:border-orange-300 dark:border-slate-700 dark:hover:border-orange-700',
                    ].join(' ')}
                  >
                    <LayoutTemplate className="h-5 w-5 flex-shrink-0 text-[#f97316]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                        {t.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                        {t.isDefault && (
                          <Badge className="bg-teal-100 text-teal-800 border-teal-300 text-[9px] dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800">
                            เริ่มต้น
                          </Badge>
                        )}
                        {isActive && (
                          <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[9px] dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">
                            <Star className="h-2.5 w-2.5" /> ใช้งาน
                          </Badge>
                        )}
                        <span className="font-mono text-slate-400">
                          {t.canvas.width}×{t.canvas.height}mm · {t.table.columns.length} คอลัมน์
                        </span>
                      </div>
                    </div>
                    {isSel && (
                      <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[9px] dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">
                        ✓ เลือก
                      </Badge>
                    )}
                  </button>
                )
              })}

              {templates.length === 0 && (
                <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400 dark:border-slate-700">
                  ยังไม่มีเทมเพลตในระบบ — ใช้ layout มาตรฐาน
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={cancel}>ยกเลิก</Button>
          <Button
            onClick={confirm}
            disabled={isLoading || !selectedId}
            className="bg-[#f97316] text-white hover:bg-[#ea580c]"
          >
            ส่งออก PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Convenience helper — fetches document template enabled flag + count.
 * Returns:
 *   - 'disabled' — templates disabled OR no templates exist
 *   - 'single'   — enabled AND exactly 1 template (use it directly, no picker)
 *   - 'multi'    — enabled AND 2+ templates (show picker)
 */
export async function getDocumentTemplateMode(): Promise<'disabled' | 'single' | 'multi'> {
  try {
    const res = await fetch('/api/itam/document-templates')
    if (!res.ok) return 'disabled'
    const j = (await res.json()) as PickerData
    if (!j.enabled) return 'disabled'
    if (j.templates.length === 0) return 'disabled'
    if (j.templates.length === 1) return 'single'
    return 'multi'
  } catch {
    return 'disabled'
  }
}

/**
 * Convenience helper — fetches the active document template id (or the first
 * template's id if no active is set). Returns null if templates are disabled
 * or no template exists.
 */
export async function getActiveDocumentTemplateIdForExport(): Promise<string | null> {
  try {
    const res = await fetch('/api/itam/document-templates')
    if (!res.ok) return null
    const j = (await res.json()) as PickerData
    if (!j.enabled || j.templates.length === 0) return null
    return j.activeId ?? j.templates[0].id ?? null
  } catch {
    return null
  }
}

/**
 * @deprecated Use getDocumentTemplateMode() instead — kept for backwards-compat.
 */
export async function isDocumentTemplateEnabled(): Promise<boolean> {
  const mode = await getDocumentTemplateMode()
  return mode !== 'disabled'
}
