'use client'

/**
 * PrintTemplateSelectionDialog — lets the user choose which template
 * to use before printing/exporting. Shows a list of available templates
 * for the requested type, with a preview and "select" action.
 *
 * Used by:
 *   • Sticker print buttons (devices page, device detail sheet)
 *   • Work order print buttons
 *   • Stock print buttons
 *   • Report export buttons
 *
 * Usage:
 *   <PrintTemplateSelectionDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     templateType="sticker"
 *     onSelect={(template) => handlePrint(template)}
 *   />
 */
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileText, Star, Eye, Plus, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

export interface PrintTemplate {
  id: string
  name: string
  type: string
  category: string | null
  content: string
  isActive: boolean
  isDefault: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Template type to filter by (sticker, work-order, stock-out, etc.) */
  templateType: string
  /** Called when user selects a template */
  onSelect: (template: PrintTemplate) => void
  /** Optional: label for the action button (default: "พิมพ์") */
  actionLabel?: string
  /** Optional: show "สร้างเทมเพลตใหม่" button that navigates to template editor */
  onCreateNew?: () => void
}

export function PrintTemplateSelectionDialog({
  open,
  onOpenChange,
  templateType,
  onSelect,
  actionLabel = 'พิมพ์',
  onCreateNew,
}: Props) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const { data: templates, isLoading } = useQuery<PrintTemplate[]>({
    queryKey: ['print-templates', templateType],
    queryFn: async () => {
      const res = await fetch(`/api/templates?type=${templateType}`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) return []
      const json = await res.json()
      return (json.templates ?? []) as PrintTemplate[]
    },
    enabled: open,
    staleTime: 10_000,
  })

  // Auto-select the default template when dialog opens
  React.useEffect(() => {
    if (open && templates && templates.length > 0 && !selectedId) {
      const defaultTpl = templates.find((t) => t.isDefault)
      setSelectedId(defaultTpl?.id ?? templates[0].id)
    }
    if (!open) {
      setSelectedId(null)
    }
  }, [open, templates, selectedId])

  function handleSelect() {
    if (!selectedId) {
      toast.error('กรุณาเลือกเทมเพลต')
      return
    }
    const selected = templates?.find((t) => t.id === selectedId)
    if (!selected) {
      toast.error('ไม่พบเทมเพลตที่เลือก')
      return
    }
    onSelect(selected)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#f97316]" />
            เลือกเทมเพลตก่อนพิมพ์
          </DialogTitle>
          <DialogDescription>
            เลือกเทมเพลตที่ต้องการใช้สำหรับการพิมพ์ / ส่งออก
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))
          ) : !templates || templates.length === 0 ? (
            <div className="rounded-lg border border-slate-200 p-6 text-center dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                ยังไม่มีเทมเพลตประเภท "{templateType}" ในระบบ
              </p>
              {onCreateNew && (
                <Button
                  type="button"
                  size="sm"
                  className="mt-3 bg-[#f97316] text-white hover:bg-[#ea580c]"
                  onClick={() => {
                    onOpenChange(false)
                    onCreateNew()
                  }}
                >
                  <Plus className="h-4 w-4" />
                  สร้างเทมเพลตใหม่
                </Button>
              )}
            </div>
          ) : (
            <ScrollArea className="max-h-[50vh]">
              <div className="space-y-1.5 pr-2">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setSelectedId(tpl.id)}
                    className={
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all ' +
                      (selectedId === tpl.id
                        ? 'border-[#f97316] bg-[#f97316]/5 ring-1 ring-[#f97316] dark:border-[#fb923c] dark:bg-[#fb923c]/5'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50')
                    }
                  >
                    {/* Radio indicator */}
                    <div
                      className={
                        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ' +
                        (selectedId === tpl.id
                          ? 'border-[#f97316] bg-[#f97316]'
                          : 'border-slate-300 dark:border-slate-600')
                      }
                    >
                      {selectedId === tpl.id && <Check className="h-3 w-3 text-white" />}
                    </div>

                    {/* Template info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                          {tpl.name}
                        </span>
                        {tpl.isDefault && (
                          <Badge className="flex-shrink-0 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
                            <Star className="mr-1 h-2.5 w-2.5" />
                            ค่าเริ่มต้น
                          </Badge>
                        )}
                      </div>
                      {tpl.category && (
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {tpl.category}
                        </div>
                      )}
                    </div>

                    {/* Preview indicator */}
                    <Eye className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="gap-2">
          {onCreateNew && templates && templates.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false)
                onCreateNew()
              }}
              className="mr-auto"
            >
              <Plus className="h-4 w-4" />
              สร้างใหม่
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={handleSelect}
            disabled={!selectedId}
            className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
