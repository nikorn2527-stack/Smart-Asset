'use client'

/**
 * CustomFieldManager.tsx — หน้าจัดการ Custom Field Definitions
 *
 * ตามภาคผนวก B section B.7:
 *   GET /api/custom-fields/definitions?targetEntity=Device
 *   POST /api/custom-fields/definitions
 *
 * ใช้ใน Settings → Custom Fields tab
 */
import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Tag, Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'integer', label: 'Integer' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'DateTime' },
  { value: 'select', label: 'Select (single)' },
  { value: 'multiselect', label: 'Multi-Select' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
]

const TARGET_ENTITIES = [
  { value: 'Device', label: 'อุปกรณ์ (Device)' },
  { value: 'WorkOrder', label: 'ใบงาน (Work Order)' },
  { value: 'StockItem', label: 'สต็อก (Stock Item)' },
  { value: 'MasterItem', label: 'ข้อมูลมาตรฐาน (Master Item)' },
]

export function CustomFieldManager() {
  const token = useAuthStore((s) => s.token)
  const qc = useQueryClient()
  const [targetEntity, setTargetEntity] = React.useState('Device')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingDef, setEditingDef] = React.useState<any | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['custom-field-defs-manage', targetEntity],
    queryFn: async () => {
      const res = await fetch(`/api/custom-fields/definitions?targetEntity=${targetEntity}&includeOptions=true`, {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Soft delete via PATCH — not implemented in API yet, so use direct update
      // For now: skip delete (เก็บไว้ทำทีหลัง)
    },
  })

  const definitions = data?.definitions || []

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-[#f97316]" />
            Custom Fields — จัดการฟิลด์เพิ่มเติม
          </CardTitle>
          <CardDescription>
            สร้างฟิลด์เพิ่มเติมสำหรับ Entity ต่างๆ — แยกตามองค์กร (Organization-scoped)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Entity selector */}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Target Entity</Label>
              <Select value={targetEntity} onValueChange={setTargetEntity}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_ENTITIES.map(e => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => { setEditingDef(null); setDialogOpen(true) }}
              className="gap-1.5 bg-[#f97316] text-white hover:bg-[#ea580c]"
            >
              <Plus className="h-4 w-4" />
              สร้างฟิลด์ใหม่
            </Button>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : definitions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
              <Tag className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-muted-foreground">
                ยังไม่มี Custom Field สำหรับ {targetEntity}
              </p>
              <p className="text-xs text-muted-foreground">กด "สร้างฟิลด์ใหม่" เพื่อเริ่มต้น</p>
            </div>
          ) : (
            <div className="space-y-2">
              {definitions.map((def: any) => (
                <div
                  key={def.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono dark:bg-slate-800">
                        {def.key}
                      </code>
                      <span className="text-sm font-medium">{def.label}</span>
                      {def.required && (
                        <Badge variant="outline" className="text-[9px] text-rose-600">Required</Badge>
                      )}
                      {!def.active && (
                        <Badge variant="outline" className="text-[9px] text-slate-400">Inactive</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {def.fieldType} {def.section ? `· ${def.section}` : ''} {def.description ? `· ${def.description}` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setEditingDef(def); setDialogOpen(true) }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <DefinitionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        targetEntity={targetEntity}
        editing={editingDef}
      />
    </div>
  )
}

function DefinitionDialog({
  open,
  onOpenChange,
  targetEntity,
  editing,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  targetEntity: string
  editing: any | null
}) {
  const token = useAuthStore((s) => s.token)
  const qc = useQueryClient()
  const [form, setForm] = React.useState({
    key: '',
    label: '',
    description: '',
    fieldType: 'text',
    required: false,
    section: '',
    placeholder: '',
    options: [] as Array<{ value: string; label: string }>,
  })

  React.useEffect(() => {
    if (editing) {
      setForm({
        key: editing.key || '',
        label: editing.label || '',
        description: editing.description || '',
        fieldType: editing.fieldType || 'text',
        required: editing.required || false,
        section: editing.section || '',
        placeholder: editing.placeholder || '',
        options: (editing.options || []).map((o: any) => ({ value: o.value, label: o.label })),
      })
    } else {
      setForm({
        key: '', label: '', description: '', fieldType: 'text',
        required: false, section: '', placeholder: '', options: [],
      })
    }
  }, [editing])

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/custom-fields/definitions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...form,
          targetEntity,
          options: form.fieldType === 'select' || form.fieldType === 'multiselect' ? form.options : undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(err.error || 'Failed to create')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('สร้าง Custom Field แล้ว')
      qc.invalidateQueries({ queryKey: ['custom-field-defs-manage', targetEntity] })
      qc.invalidateQueries({ queryKey: ['custom-field-defs', targetEntity] })
      onOpenChange(false)
    },
    onError: (e: any) => toast.error(e.message || 'สร้างไม่สำเร็จ'),
  })

  const isSelectType = form.fieldType === 'select' || form.fieldType === 'multiselect'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'แก้ไข Custom Field' : `สร้าง Custom Field สำหรับ ${targetEntity}`}
          </DialogTitle>
          <DialogDescription>
            ฟิลด์นี้จะใช้ได้เฉพาะในองค์กรของคุณเท่านั้น
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Key (snake_case) *</Label>
              <Input
                value={form.key}
                onChange={e => setForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
                placeholder="asset_owner"
                disabled={!!editing}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Label (ชื่อแสดงผล) *</Label>
              <Input
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="ผู้รับผิดชอบ"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Field Type *</Label>
              <Select value={form.fieldType} onValueChange={v => setForm(f => ({ ...f, fieldType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Section</Label>
              <Input
                value={form.section}
                onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
                placeholder="ข้อมูลทั่วไป"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="อธิบายการใช้งาน..."
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={form.required}
              onCheckedChange={v => setForm(f => ({ ...f, required: v }))}
            />
            <Label className="text-xs">Required (บังคับกรอก)</Label>
          </div>

          {isSelectType && (
            <div className="space-y-2">
              <Label className="text-xs">Options (สำหรับ {form.fieldType})</Label>
              {form.options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={opt.value}
                    onChange={e => {
                      const newOpts = [...form.options]
                      newOpts[i] = { ...opt, value: e.target.value }
                      setForm(f => ({ ...f, options: newOpts }))
                    }}
                    placeholder="value"
                    className="text-xs"
                  />
                  <Input
                    value={opt.label}
                    onChange={e => {
                      const newOpts = [...form.options]
                      newOpts[i] = { ...opt, label: e.target.value }
                      setForm(f => ({ ...f, options: newOpts }))
                    }}
                    placeholder="label"
                    className="text-xs"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setForm(f => ({ ...f, options: f.options.filter((_, j) => j !== i) }))}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setForm(f => ({ ...f, options: [...f.options, { value: '', label: '' }] }))}
              >
                + เพิ่ม Option
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.key || !form.label}
            className="bg-[#f97316] text-white hover:bg-[#ea580c]"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'สร้าง'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
