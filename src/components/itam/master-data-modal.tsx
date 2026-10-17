'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { MASTER_CATEGORIES, type MasterItem } from './types'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

export interface MasterFormState {
  id?: string
  category: string
  code: string
  label: string
  parentRef: string
  displayLabel: string
  siteCode: string
}

export const EMPTY_MASTER_FORM: MasterFormState = {
  category: 'Brand',
  code: '',
  label: '',
  parentRef: '',
  displayLabel: '',
  siteCode: '',
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial?: MasterItem | null
  fixedCategory?: string
}

export function MasterDataModal({
  open,
  onOpenChange,
  initial,
  fixedCategory,
}: Props) {
  const qc = useQueryClient()
  const [form, setForm] = React.useState<MasterFormState>(EMPTY_MASTER_FORM)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      if (initial) {
        setForm({
          id: initial.id,
          category: initial.category,
          code: initial.code,
          label: initial.label,
          parentRef: initial.parentRef ?? '',
          displayLabel: initial.displayLabel ?? '',
          siteCode: initial.siteCode ?? '',
        })
      } else {
        setForm({
          ...EMPTY_MASTER_FORM,
          category: fixedCategory ?? 'Brand',
        })
      }
    }
  }, [open, initial, fixedCategory])

  async function save() {
    if (!form.code || !form.label || !form.category) {
      toast.error('กรุณากรอกหมวดหมู่ รหัส และชื่อ')
      return
    }
    try {
      setSaving(true)
      const payload = {
        category: form.category,
        code: form.code,
        label: form.label,
        parentRef: form.parentRef || null,
        displayLabel: form.displayLabel || null,
        siteCode: form.siteCode || null,
      }
      const isEdit = Boolean(form.id)
      const url = isEdit ? `/api/master/${form.id}` : '/api/master'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Save failed')
      }
      toast.success(isEdit ? 'แก้ไขรายการแล้ว' : 'เพิ่มรายการใหม่แล้ว')
      onOpenChange(false)
      await qc.invalidateQueries({ queryKey: ['master'] })
      await qc.invalidateQueries({ queryKey: ['master-all'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-slate-800 dark:text-slate-100">
            {form.id ? '✏️ แก้ไขข้อมูลมาตรฐาน' : '➕ เพิ่มข้อมูลมาตรฐาน'}
          </DialogTitle>
          <DialogDescription>
            ข้อมูลมาตรฐานใช้สำหรับ dropdown และการอ้างอิงในระบบ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">หมวดหมู่ *</Label>
            {fixedCategory ? (
              <Input value={fixedCategory} disabled />
            ) : (
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MASTER_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">รหัส *</Label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="เช่น HP, PRINTER, IT"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">ชื่อ *</Label>
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ParentRef
              </Label>
              <Input
                value={form.parentRef}
                onChange={(e) =>
                  setForm({ ...form, parentRef: e.target.value })
                }
                placeholder="เช่น HP|PRINTER"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                SiteCode
              </Label>
              <Input
                value={form.siteCode}
                onChange={(e) => setForm({ ...form, siteCode: e.target.value })}
                placeholder="เช่น HQ"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              DisplayLabel
            </Label>
            <Input
              value={form.displayLabel}
              onChange={(e) =>
                setForm({ ...form, displayLabel: e.target.value })
              }
              placeholder="ชื่อที่แสดงผล (ถ้าว่างจะใช้ชื่อ)"
            />
          </div>
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
            onClick={save}
            disabled={saving}
            className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
