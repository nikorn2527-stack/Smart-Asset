'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Pencil, Trash2, Loader2, Package, Printer } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { GovernmentPolicySettings } from '@/components/government/policy-settings'

interface AssetCategory {
  id: string
  code: string
  name: string
  usefulLifeYears: number
  depreciationMethod: string
  decliningRate: number | null
  minCapitalizeValue: number | null
  salvageValuePct: number
  active: boolean
}

const METHOD_LABELS: Record<string, string> = {
  STRAIGHT_LINE: 'เส้นตรง',
  DECLINING_BALANCE: 'ลดต้นทุนทบต้น',
}

export function AssetCategorySection() {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [printing, setPrinting] = React.useState(false)
  const [groupMode, setGroupMode] = React.useState<'site' | 'type'>('site')
  const [form, setForm] = React.useState({
    code: '', name: '', usefulLifeYears: '5', depreciationMethod: 'STRAIGHT_LINE',
    decliningRate: '', minCapitalizeValue: '10000', salvageValuePct: '0', active: true,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: async () => {
      const res = await fetch('/api/settings/asset-categories')
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ categories: AssetCategory[] }>
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        code: form.code, name: form.name,
        usefulLifeYears: Number(form.usefulLifeYears),
        depreciationMethod: form.depreciationMethod,
        decliningRate: form.decliningRate ? Number(form.decliningRate) : null,
        minCapitalizeValue: form.minCapitalizeValue ? Number(form.minCapitalizeValue) : null,
        salvageValuePct: Number(form.salvageValuePct),
        active: form.active,
      }
      if (editingId) {
        const res = await fetch(`/api/settings/asset-categories/${editingId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error('Failed')
      } else {
        const res = await fetch('/api/settings/asset-categories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || 'Failed')
        }
      }
    },
    onSuccess: () => {
      toast.success(editingId ? 'แก้ไขแล้ว' : 'สร้างแล้ว')
      qc.invalidateQueries({ queryKey: ['asset-categories'] })
      setDialogOpen(false)
      setEditingId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/settings/asset-categories/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
    },
    onSuccess: () => {
      toast.success('ปิดใช้งานแล้ว')
      qc.invalidateQueries({ queryKey: ['asset-categories'] })
    },
  })

  function openAdd() {
    setEditingId(null)
    setForm({ code: '', name: '', usefulLifeYears: '5', depreciationMethod: 'STRAIGHT_LINE',
      decliningRate: '', minCapitalizeValue: '10000', salvageValuePct: '0', active: true })
    setDialogOpen(true)
  }

  function openEdit(cat: AssetCategory) {
    setEditingId(cat.id)
    setForm({
      code: cat.code, name: cat.name,
      usefulLifeYears: String(cat.usefulLifeYears),
      depreciationMethod: cat.depreciationMethod,
      decliningRate: cat.decliningRate ? String(cat.decliningRate) : '',
      minCapitalizeValue: cat.minCapitalizeValue ? String(cat.minCapitalizeValue) : '',
      salvageValuePct: String(cat.salvageValuePct),
      active: cat.active,
    })
    setDialogOpen(true)
  }

  const categories = data?.categories ?? []

  // ── Phase 3.2: Asset Register print ──
  // Opens /api/reports/asset-register in a new tab. The endpoint returns
  // text/html (a printable asset register) and auto-opens the browser
  // print dialog. groupMode lets the user pick "group by site" vs "by type".
  async function handlePrintRegister() {
    if (printing) return
    setPrinting(true)
    try {
      // Bearer token can't be sent in headers for window.open — fall back
      // to the `t` query param that auth-middleware's extractBearer()
      // recognizes. Matches the pattern in license-management-section.tsx.
      const token = useAuthStore.getState()?.token
      const params = new URLSearchParams({ groupBy: groupMode })
      if (token) params.set('t', token)
      const url = `/api/reports/asset-register?${params.toString()}`
      const w = window.open(url, '_blank', 'noopener,noreferrer')
      if (!w) {
        toast.error('เบราว์เซอร์บล็อกการเปิดหน้าต่าง — กรุณาอนุญาต pop-up แล้วลองอีกครั้ง')
      } else {
        toast.success('กำลังเปิดทะเบียนทรัพย์สินในแท็บใหม่ — กด Ctrl/Cmd+P เพื่อพิมพ์เป็น PDF')
      }
    } catch (e) {
      toast.error('เปิดทะเบียนไม่สำเร็จ')
    } finally {
      // Give the browser a moment to open the tab before re-enabling the button
      setTimeout(() => setPrinting(false), 800)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Package className="h-4 w-4 text-[#f97316]" />
          หมวดหมู่สินทรัพย์ ({categories.length})
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => window.open('/government/register', '_blank', 'noopener,noreferrer')}>ทะเบียนคุมราชการ</Button>
          <Select value={groupMode} onValueChange={(v) => setGroupMode(v as 'site' | 'type')}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="site">จัดกลุ่มตามสาขา</SelectItem>
              <SelectItem value="type">จัดกลุ่มตามประเภท</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={handlePrintRegister}
            disabled={printing}
            title="พิมพ์รายการทะเบียนทรัพย์สินทั้งหมดเป็น PDF"
            className="border-[#f97316]/40 text-[#c2410c] hover:bg-[#fff7ed] dark:border-[#f97316]/30 dark:text-[#fdba74] dark:hover:bg-[#431407]"
          >
            {printing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Printer className="mr-1 h-3.5 w-3.5" />}
            พิมพ์ทะเบียนทรัพย์สิน
          </Button>
          <Button size="sm" onClick={openAdd} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
            <Plus className="mr-1 h-3.5 w-3.5" /> เพิ่ม
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <GovernmentPolicySettings/>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#f97316]" /></div>
        ) : categories.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            ยังไม่มีหมวดหมู่สินทรัพย์ — กด "เพิ่ม" เพื่อสร้าง
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">รหัส</TableHead>
                  <TableHead className="text-xs">ชื่อ</TableHead>
                  <TableHead className="text-xs">อายุ (ปี)</TableHead>
                  <TableHead className="text-xs">วิธีคำนวณ</TableHead>
                  <TableHead className="text-xs">ซาก (%)</TableHead>
                  <TableHead className="text-xs">สถานะ</TableHead>
                  <TableHead className="text-xs"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => (
                  <TableRow key={cat.id}>
                    <TableCell className="font-mono text-xs">{cat.code}</TableCell>
                    <TableCell className="text-xs">{cat.name}</TableCell>
                    <TableCell className="text-xs">{cat.usefulLifeYears}</TableCell>
                    <TableCell className="text-xs">{METHOD_LABELS[cat.depreciationMethod] ?? cat.depreciationMethod}</TableCell>
                    <TableCell className="text-xs">{cat.salvageValuePct}%</TableCell>
                    <TableCell>
                      <Badge variant={cat.active ? 'default' : 'secondary'} className="text-[10px]">
                        {cat.active ? 'ใช้งาน' : 'ปิด'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {/* `size` accepts 'icon' | 'sm' | 'default' | 'lg' —
                            'ghost' is a variant, not a size. */}
                        <Button size="icon" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit(cat)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 p-0 text-rose-500"
                          onClick={() => deleteMutation.mutate(cat.id)} disabled={deleteMutation.isPending}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่สินทรัพย์'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">รหัส *</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="IT-COMPUTER" className="text-sm font-mono" disabled={!!editingId} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">ชื่อหมวดหมู่ *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="คอมพิวเตอร์" className="text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">อายุใช้งาน (ปี)</Label>
                <Input type="number" value={form.usefulLifeYears}
                  onChange={(e) => setForm({ ...form, usefulLifeYears: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">วิธีคำนวณ</Label>
                <Select value={form.depreciationMethod} onValueChange={(v) => setForm({ ...form, depreciationMethod: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STRAIGHT_LINE">เส้นตรง</SelectItem>
                    <SelectItem value="DECLINING_BALANCE">ลดต้นทุนทบต้น</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">อัตราลด (%)</Label>
                <Input type="number" value={form.decliningRate}
                  onChange={(e) => setForm({ ...form, decliningRate: e.target.value })}
                  placeholder="30" className="text-sm"
                  disabled={form.depreciationMethod !== 'DECLINING_BALANCE'} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">ทุนขั้นต่ำ (฿)</Label>
                <Input type="number" value={form.minCapitalizeValue}
                  onChange={(e) => setForm({ ...form, minCapitalizeValue: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">ซาก (%)</Label>
                <Input type="number" value={form.salvageValuePct}
                  onChange={(e) => setForm({ ...form, salvageValuePct: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label className="text-xs">ใช้งาน</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>ยกเลิก</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
              className="bg-[#f97316] text-white hover:bg-[#ea580c]">
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
