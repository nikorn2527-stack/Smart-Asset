'use client'

// ============================================================
// TemplatePrintDialog — print a work order using a template
// (Task ID: VISUAL-TEMPLATE-EDITOR, PART 3)
// ============================================================
// Workflow:
//   1. If the WO already has printTemplateId → use that template
//      automatically (skip the picker, but allow "เปลี่ยนเทมเพลต").
//   2. Otherwise → show a picker of "work-order" templates.
//   3. After choosing (or auto-selecting), call
//      POST /api/templates/[id]/render?workOrderId=… and open the
//      returned HTML in a new window.
//   4. "ติ๊ก" checkbox:
//        ☑ ใช้เทมเพลตนี้สำหรับใบงานนี้ทุกครั้ง
//           → PATCH /api/work-orders/[id]/print-template
//        ☑ ใช้เทมเพลตนี้สำหรับใบงานทั้งหมด
//           → also set template.isDefault=true
// ============================================================

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuthStore } from '@/store/auth-store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Printer,
  FileText,
  Star,
  Search,
  Check,
  Eye,
  Loader2,
} from 'lucide-react'

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────

interface DocumentTemplate {
  id: string
  name: string
  type: string
  category: string | null
  content: string
  isActive: boolean
  isDefault: boolean
  isFixed: boolean
  createdAt: string
  updatedAt: string
}

interface TemplatePrintDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  workOrderId: string
  woNumber?: string | null
  /** ID of the template already fixed for this WO. */
  fixedTemplateId?: string | null
}

// ─────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────

export function TemplatePrintDialog({
  open,
  onOpenChange,
  workOrderId,
  woNumber,
  fixedTemplateId,
}: TemplatePrintDialogProps) {
  const qc = useQueryClient()
  const [search, setSearch] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [rememberForWo, setRememberForWo] = React.useState(false)
  const [rememberForAll, setRememberForAll] = React.useState(false)
  const [rendering, setRendering] = React.useState(false)
  const [savingChoice, setSavingChoice] = React.useState(false)
  const [showPicker, setShowPicker] = React.useState(false)
  // ── In-page print container (Task ID: PRINT-MEDIA-QUERY-012) ──
  // Rendered template HTML is injected into a hidden `.print-only` div,
  // then window.print() fires on the SAME page (no new tab/window).
  const [printHtml, setPrintHtml] = React.useState('')

  // ── Fetch work-order templates ──
  const templatesQuery = useQuery<DocumentTemplate[]>({
    queryKey: ['templates', 'work-order'],
    queryFn: async () => {
      const res = await fetch('/api/templates?type=work-order', {
        headers: useAuthStore.getState()?.token
          ? { Authorization: `Bearer ${useAuthStore.getState()!.token}` }
          : {},
      })
      if (!res.ok) throw new Error('โหลดเทมเพลตไม่สำเร็จ')
      const j = await res.json()
      return (j.templates ?? []) as DocumentTemplate[]
    },
    enabled: open,
    staleTime: 30_000,
  })

  const templates = templatesQuery.data ?? []

  // ── Reset state on open ──
  React.useEffect(() => {
    if (open) {
      setSearch('')
      setRememberForWo(false)
      setRememberForAll(false)
      setRendering(false)
      setSavingChoice(false)
      // If the WO has a fixed template, use it directly
      if (fixedTemplateId) {
        setSelectedId(fixedTemplateId)
        setShowPicker(false)
      } else {
        // Auto-pick the default (or the first) template
        const def = templates.find((t) => t.isDefault)
        const first = templates[0]
        setSelectedId(def?.id ?? first?.id ?? null)
        setShowPicker(true)
      }
    } else {
      setShowPicker(false)
    }
  }, [open])

  // Also re-evaluate when templates load (after the effect above ran)
  React.useEffect(() => {
    if (!open) return
    if (fixedTemplateId) return
    if (selectedId) return
    if (templates.length === 0) return
    const def = templates.find((t) => t.isDefault)
    setSelectedId(def?.id ?? templates[0].id)
  }, [open, templates, selectedId, fixedTemplateId])

  const selected = templates.find((t) => t.id === selectedId) ?? null
  const filtered = templates.filter((t) =>
    !search.trim()
      ? true
      : t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.category ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  // ── Save the "remember" choice (and optionally promote default) ──
  async function saveChoice(templateId: string | null) {
    if (!templateId) return
    setSavingChoice(true)
    try {
      const res = await fetch(
        `/api/work-orders/${workOrderId}/print-template`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(useAuthStore.getState()?.token
              ? { Authorization: `Bearer ${useAuthStore.getState()!.token}` }
              : {}),
          },
          body: JSON.stringify({
            printTemplateId: templateId,
            setAsDefault: rememberForAll,
          }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'บันทึกการเลือกไม่สำเร็จ')
      }
      qc.invalidateQueries({ queryKey: ['work-order', workOrderId] })
      qc.invalidateQueries({ queryKey: ['work-orders'] })
      qc.invalidateQueries({ queryKey: ['templates'] })
      if (rememberForWo) {
        toast.success('จำเทมเพลตสำหรับใบงานนี้แล้ว')
      }
      if (rememberForAll) {
        toast.success('ตั้งเป็นเทมเพลตเริ่มต้นสำหรับใบงานทั้งหมดแล้ว')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingChoice(false)
    }
  }

  // ── Render & print ──
  // The `openNewTab` flag is kept for call-site clarity (เปิดพรีวิว vs พิมพ์)
  // but both paths now use the in-page `.print-only` container — no new
  // tab/window is opened (Task ID: PRINT-MEDIA-QUERY-012).
  async function handlePrint(_openNewTab: boolean) {
    if (!selectedId) {
      toast.error('กรุณาเลือกเทมเพลตก่อน')
      return
    }
    setRendering(true)
    try {
      const res = await fetch(`/api/templates/${selectedId}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(useAuthStore.getState()?.token
            ? { Authorization: `Bearer ${useAuthStore.getState()!.token}` }
            : {}),
        },
        body: JSON.stringify({ workOrderId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'เรนเดอร์เทมเพลตไม่สำเร็จ')
      }
      const { html } = (await res.json()) as { html: string }
      // Save the user's remember choice (in the background)
      if (rememberForWo || rememberForAll) {
        void saveChoice(selectedId)
      }
      // ── Inject into hidden print container + fire window.print()
      // on the SAME page (Task ID: PRINT-MEDIA-QUERY-012). ──
      setPrintHtml(html)
      setTimeout(() => window.print(), 50)
      setTimeout(() => setPrintHtml(''), 1000)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'พิมพ์ไม่สำเร็จ')
    } finally {
      setRendering(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Printer className="h-5 w-5 text-orange-500" />
            พิมพ์ใบงาน {woNumber ? `— ${woNumber}` : ''}
          </DialogTitle>
          <DialogDescription className="text-xs">
            เลือกเทมเพลตที่จะใช้พิมพ์ หรือติ๊กเพื่อจำสำหรับครั้งถัดไป
          </DialogDescription>
        </DialogHeader>

        {/* === Body === */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950">
          {/* Fixed-template banner */}
          {fixedTemplateId && !showPicker ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40">
              <div className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-emerald-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                    ใบงานนี้ Fix กับเทมเพลต:{' '}
                    <span className="font-semibold">
                      {selected?.name ?? '—'}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                    จะใช้เทมเพลตนี้โดยอัตโนมัติทุกครั้ง
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950"
                      onClick={() => setShowPicker(true)}
                    >
                      เปลี่ยนเทมเพลต
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
                      onClick={async () => {
                        await saveChoice(null)
                        toast.success('ล้างการจำเทมเพลตแล้ว')
                        onOpenChange(false)
                      }}
                    >
                      ล้างการจำ
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Search */}
              <div className="mb-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ค้นหาเทมเพลต…"
                    className="h-9 pl-8"
                  />
                </div>
                {fixedTemplateId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowPicker(false)}
                  >
                    ยกเลิก
                  </Button>
                )}
              </div>

              {/* Templates list */}
              {templatesQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
                  <FileText className="h-10 w-10 text-muted-foreground/40" />
                  <p>ยังไม่มีเทมเพลตใบงาน</p>
                  <p className="text-xs">
                    สร้างเทมเพลตที่หน้า &quot;เทมเพลตเอกสาร&quot; → เลือกประเภท
                    &quot;ใบแจ้งซ่อม&quot;
                  </p>
                </div>
              ) : (
                <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                  {filtered.map((t) => {
                    const isSel = t.id === selectedId
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedId(t.id)}
                        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all ${
                          isSel
                            ? 'border-orange-400 bg-orange-50 shadow-sm dark:border-orange-700 dark:bg-orange-950/40'
                            : 'border-border bg-card hover:border-orange-300 hover:bg-orange-50/50 dark:hover:border-orange-800 dark:hover:bg-orange-950/20'
                        }`}
                      >
                        <div
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                            isSel
                              ? 'border-orange-500 bg-orange-500 text-white'
                              : 'border-muted-foreground/30'
                          }`}
                        >
                          {isSel && <Check className="h-3 w-3" />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">
                              {t.name}
                            </span>
                            {t.isDefault && (
                              <Badge
                                variant="outline"
                                className="border-orange-200 bg-orange-100 px-1.5 py-0 text-[10px] text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
                              >
                                <Star className="mr-0.5 h-2.5 w-2.5" />
                                ค่าเริ่มต้น
                              </Badge>
                            )}
                            {t.isFixed && (
                              <Badge
                                variant="outline"
                                className="border-emerald-200 bg-emerald-100 px-1.5 py-0 text-[10px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              >
                                Fix
                              </Badge>
                            )}
                          </div>
                          {t.category && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {t.category}
                            </p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Remember checkboxes */}
              {selected && (
                <div className="mt-4 space-y-2 rounded-lg border border-orange-200 bg-orange-50/40 p-3 dark:border-orange-800 dark:bg-orange-950/20">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300">
                    จดจำเทมเพลต
                  </Label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={rememberForWo}
                      onCheckedChange={(v) =>
                        setRememberForWo(v === true)
                      }
                    />
                    <span>
                      ใช้เทมเพลตนี้สำหรับใบงานนี้ทุกครั้ง
                      <span className="ml-1 text-xs text-muted-foreground">
                        (พิมพ์ครั้งถัดไปใช้เทมเพลตเดิมอัตโนมัติ)
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={rememberForAll}
                      onCheckedChange={(v) => {
                        setRememberForAll(v === true)
                        if (v === true) setRememberForWo(true)
                      }}
                    />
                    <span>
                      ใช้เทมเพลตนี้สำหรับใบงานทั้งหมด
                      <span className="ml-1 text-xs text-muted-foreground">
                        (ตั้งเป็นค่าเริ่มต้นของประเภทใบแจ้งซ่อม)
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </>
          )}
        </div>

        {/* === Footer === */}
        <DialogFooter className="border-t bg-card px-5 py-3">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {selected ? (
                <>
                  เลือก: <span className="font-medium">{selected.name}</span>
                </>
              ) : (
                'ยังไม่ได้เลือกเทมเพลต'
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePrint(true)}
                disabled={!selected || rendering || savingChoice}
              >
                {rendering ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                )}
                เปิดพรีวิว
              </Button>
              <Button
                size="sm"
                onClick={() => handlePrint(false)}
                disabled={!selected || rendering || savingChoice}
                className="bg-orange-500 hover:bg-orange-600"
              >
                {rendering ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Printer className="mr-1.5 h-3.5 w-3.5" />
                )}
                พิมพ์
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {/* ── Hidden print container (Task ID: PRINT-MEDIA-QUERY-012) ──
           Injects the rendered template HTML and is revealed only in
           @media print via the global `.print-only` rule in globals.css.
           Rendered OUTSIDE the Dialog so it is not clipped by the
           Dialog's portal overlay. */}
      {printHtml && (
        <div
          className="print-only"
          dangerouslySetInnerHTML={{ __html: printHtml }}
          aria-hidden
        />
      )}
    </>
  )
}
