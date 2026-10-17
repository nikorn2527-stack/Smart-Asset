'use client'

/**
 * MasterItemMergeDialog.tsx — รวมรายการ MasterItem ที่ซ้ำกัน
 * ตาม section 16: Merge รายการเดิมมี Audit และเหตุผล
 *
 * Feature:
 *   - เลือก MasterItem หลายรายการที่ต้องการรวม
 *   - เลือก "canonical" item (เก็บ) + ระบุ reason
 *   - ย้าย LegacyReference จาก duplicate → canonical
 *   - ลบ duplicate (soft delete → active=false)
 *   - Audit log การ merge
 */
import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GitMerge, Loader2, AlertTriangle } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'

interface MasterItemMergeProps {
  items: Array<{ id: string; code: string; label: string; category: string }>
  open: boolean
  onOpenChange: (v: boolean) => void
  onMerged?: () => void
}

export function MasterItemMergeDialog({ items, open, onOpenChange, onMerged }: MasterItemMergeProps) {
  const token = useAuthStore((s) => s.token)
  const [canonicalId, setCanonicalId] = React.useState<string>('')
  const [reason, setReason] = React.useState<string>('')
  const [confirmText, setConfirmText] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setCanonicalId('')
      setReason('')
      setConfirmText('')
    }
  }, [open])

  const mergeMutation = useMutation({
    mutationFn: async () => {
      const duplicates = items.filter(i => i.id !== canonicalId)
      const res = await fetch('/api/master-items/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          canonicalId,
          duplicateIds: duplicates.map(d => d.id),
          reason,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Merge failed' }))
        throw new Error(err.error || 'Merge failed')
      }
      return res.json()
    },
    onSuccess: (data) => {
      toast.success(`รวมรายการสำเร็จ — ย้าย ${data.merged} LegacyReferences`)
      onOpenChange(false)
      onMerged?.()
    },
    onError: (e: any) => toast.error(e.message || 'รวมรายการไม่สำเร็จ'),
  })

  const duplicates = items.filter(i => i.id !== canonicalId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5 text-[#f97316]" />
            รวมรายการที่ซ้ำกัน
          </DialogTitle>
          <DialogDescription>
            เลือกรายการหลัก (canonical) ที่จะเก็บไว้ — รายการอื่นจะถูกปิดใช้งาน
            และ LegacyReference จะถูกย้ายไปยังรายการหลัก
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Items to merge */}
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              รายการที่จะรวม ({items.length} รายการ):
            </p>
            <div className="space-y-1">
              {items.map(item => (
                <div key={item.id} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{item.code}</span>
                  <span className="text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Canonical selection */}
          <div className="space-y-2">
            <Label>เลือกรายการหลัก (เก็บ) *</Label>
            <Select value={canonicalId} onValueChange={setCanonicalId}>
              <SelectTrigger><SelectValue placeholder="เลือกรายการที่จะเก็บไว้..." /></SelectTrigger>
              <SelectContent>
                {items.map(item => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.code} — {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canonicalId && duplicates.length > 0 && (
              <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                จะปิดใช้งาน {duplicates.length} รายการ: {duplicates.map(d => d.code).join(', ')}
              </div>
            )}
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label>เหตุผลในการรวม *</Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="เช่น: รายการซ้ำกัน ใช้ BRD-0001 เป็นหลัก"
              rows={2}
            />
          </div>

          {/* Confirmation */}
          <div className="space-y-2">
            <Label>พิมพ์ "MERGE" เพื่อยืนยัน *</Label>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="MERGE"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button
            onClick={() => mergeMutation.mutate()}
            disabled={
              mergeMutation.isPending ||
              !canonicalId ||
              !reason ||
              confirmText !== 'MERGE'
            }
            className="bg-[#f97316] text-white hover:bg-[#ea580c]"
          >
            {mergeMutation.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <GitMerge className="mr-1 h-4 w-4" />
            )}
            รวมรายการ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
