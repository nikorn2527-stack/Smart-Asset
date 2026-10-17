'use client'

/**
 * WoOptionsSection — admin UI for Work-Order dropdown options:
 * subjects (หัวข้อปัญหา), buildings (อาคาร/ฝ่าย), and resolutions
 * (ผลการแก้ไข).
 *
 * Backed by:
 *   GET    /api/settings/options          → { subjects, buildings, resolutions }
 *   POST   /api/settings/options          { type, value, group?, defaultPriority? }
 *   DELETE /api/settings/options/[id]
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ListChecks, Plus, RefreshCw, Trash2, Building2, Wrench, CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'

type OptType = 'subject' | 'building' | 'resolution'

interface BaseOpt {
  id: string
  group: string
  value: string
}
interface SubjectOpt extends BaseOpt {
  default_priority: string
}
interface OptionsResponse {
  subjects: SubjectOpt[]
  buildings: BaseOpt[]
  resolutions: BaseOpt[]
}

const PRIORITIES = ['ปกติ', 'ปานกลาง', 'สูง', 'ด่วน'] as const

function authHeaders(extra?: HeadersInit): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (typeof window !== 'undefined') {
    const t = useAuthStore.getState()?.token
    if (t) h['Authorization'] = `Bearer ${t}`
  }
  if (extra) {
    const m = new Headers(extra)
    m.forEach((v, k) => { h[k] = v })
  }
  return h
}

export function WoOptionsSection() {
  const qc = useQueryClient()
  const [addType, setAddType] = React.useState<OptType>('subject')
  const [addOpen, setAddOpen] = React.useState(false)
  const [form, setForm] = React.useState({
    value: '',
    group: '',
    defaultPriority: 'ปกติ' as string,
  })
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; label: string } | null>(null)

  const { data, isLoading, isFetching } = useQuery<OptionsResponse>({
    queryKey: ['wo-options-admin'],
    queryFn: async () => {
      const res = await fetch('/api/settings/options')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 30_000,
  })

  const subjects = data?.subjects ?? []
  const buildings = data?.buildings ?? []
  const resolutions = data?.resolutions ?? []

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/options', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          type: addType,
          value: form.value.trim(),
          group: form.group.trim() || undefined,
          defaultPriority: addType === 'subject' ? form.defaultPriority : undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Failed')
      return j
    },
    onSuccess: () => {
      toast.success('เพิ่มตัวเลือกแล้ว')
      setAddOpen(false)
      setForm({ value: '', group: '', defaultPriority: 'ปกติ' })
      qc.invalidateQueries({ queryKey: ['wo-options-admin'] })
      qc.invalidateQueries({ queryKey: ['wo-options'] }) // refresh work-orders-page too
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    },
  })

  function handleDelete(id: string, label: string) {
    setDeleteTarget({ id, label })
  }

  function confirmDelete() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    fetch(`/api/settings/options/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Failed')
        toast.success('ลบแล้ว')
        qc.invalidateQueries({ queryKey: ['wo-options-admin'] })
        qc.invalidateQueries({ queryKey: ['wo-options'] })
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'ลบไม่สำเร็จ')
      })
      .finally(() => setDeleteTarget(null))
  }

  function openAdd(type: OptType) {
    setAddType(type)
    setForm({
      value: '',
      group: '',
      defaultPriority: 'ปกติ',
    })
    setAddOpen(true)
  }

  function submitAdd() {
    if (!form.value.trim()) {
      toast.error('กรุณาระบุค่า')
      return
    }
    addMutation.mutate()
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Toolbar — FIXED */}
      <div className="flex flex-shrink-0 items-center justify-between rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <ListChecks className="h-4 w-4 text-[#f97316]" />
          ตัวเลือกทั้งหมดถูกใช้ในหน้า &quot;แจ้งซ่อม&quot; และ &quot;พิมพ์ใบงาน&quot;
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ['wo-options-admin'] })}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">รีเฟรช</span>
        </Button>
      </div>

      {/* Tabs — 3 sections in tabs (instead of stacking vertically) */}
      <Tabs defaultValue="subjects" className="flex min-h-0 flex-1 flex-col gap-3">
        <TabsList className="flex flex-shrink-0 flex-wrap gap-1 sm:grid sm:grid-cols-3">
          <TabsTrigger value="subjects" onClick={() => {}} className="gap-1.5">
            <Wrench className="h-3.5 w-3.5 text-[#f97316]" /> หัวข้อปัญหา
            <Badge variant="outline" className="ml-1 text-[10px]">{subjects.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="buildings" onClick={() => {}} className="gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-teal-500" /> อาคาร/ฝ่าย
            <Badge variant="outline" className="ml-1 text-[10px]">{buildings.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="resolutions" onClick={() => {}} className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> ผลการแก้ไข
            <Badge variant="outline" className="ml-1 text-[10px]">{resolutions.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* Subjects tab */}
        <TabsContent value="subjects" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <Card className="flex h-full flex-col overflow-hidden border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="flex flex-shrink-0 flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4 text-[#f97316]" /> หัวข้อปัญหา
                <Badge variant="outline" className="ml-1 text-[10px]">{subjects.length} รายการ</Badge>
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openAdd('subject')}
              >
                <Plus className="h-4 w-4" /> เพิ่ม
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden">
              <div className="itam-scroll h-full overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="h-8 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">หมวด</th>
                      <th className="h-8 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">หัวข้อ</th>
                      <th className="h-8 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">ความเร่งด่วน</th>
                      <th className="h-8 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={`s-${i}`}>
                          <td className="px-3 py-2"><Skeleton className="h-4 w-20" /></td>
                          <td className="px-3 py-2"><Skeleton className="h-4 w-40" /></td>
                          <td className="px-3 py-2"><Skeleton className="h-4 w-16" /></td>
                          <td className="px-3 py-2"><Skeleton className="h-6 w-8" /></td>
                        </tr>
                      ))
                    ) : subjects.length === 0 ? (
                      <tr><td colSpan={4} className="py-6 text-center text-xs text-slate-400">ไม่มีข้อมูล</td></tr>
                    ) : (
                      subjects.map((s) => (
                        <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-3 py-2 text-xs">
                            <Badge variant="outline" className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{s.group}</Badge>
                          </td>
                          <td className="px-3 py-2 text-sm">{s.value}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">{s.default_priority}</td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(s.id, s.value)}
                              className="text-rose-500 hover:bg-rose-50"
                              aria-label={`ลบ ${s.value}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Buildings tab */}
        <TabsContent value="buildings" className="mt-0 min-h-0 flex-1 overflow-auto">
          <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-teal-500" /> อาคาร / ฝ่าย
                <Badge variant="outline" className="ml-1 text-[10px]">{buildings.length} รายการ</Badge>
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openAdd('building')}
              >
                <Plus className="h-4 w-4" /> เพิ่ม
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => <Skeleton key={`b-${i}`} className="h-7 w-28 rounded-full" />)
                ) : buildings.length === 0 ? (
                  <div className="text-xs text-slate-400">ไม่มีข้อมูล</div>
                ) : (
                  buildings.map((b) => (
                    <Badge
                      key={b.id}
                      variant="outline"
                      className="gap-1 bg-teal-50 px-3 py-1.5 text-xs text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                    >
                      <Building2 className="h-3 w-3" />
                      <span className="text-[10px] text-slate-400">{b.group}:</span>
                      {b.value}
                      <button
                        type="button"
                        onClick={() => handleDelete(b.id, b.value)}
                        className="ml-1 rounded-full p-0.5 hover:bg-teal-100 dark:hover:bg-teal-900"
                        aria-label={`ลบ ${b.value}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Resolutions tab */}
        <TabsContent value="resolutions" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <Card className="flex h-full flex-col overflow-hidden border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="flex flex-shrink-0 flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> ผลการแก้ไข
                <Badge variant="outline" className="ml-1 text-[10px]">{resolutions.length} รายการ</Badge>
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openAdd('resolution')}
              >
                <Plus className="h-4 w-4" /> เพิ่ม
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden">
              <div className="itam-scroll h-full overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="h-8 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">หมวด</th>
                      <th className="h-8 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">ผลการแก้ไข</th>
                      <th className="h-8 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={`r-${i}`}>
                          <td className="px-3 py-2"><Skeleton className="h-4 w-24" /></td>
                          <td className="px-3 py-2"><Skeleton className="h-4 w-48" /></td>
                          <td className="px-3 py-2"><Skeleton className="h-6 w-8" /></td>
                        </tr>
                      ))
                    ) : resolutions.length === 0 ? (
                      <tr><td colSpan={3} className="py-6 text-center text-xs text-slate-400">ไม่มีข้อมูล</td></tr>
                    ) : (
                      resolutions.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-3 py-2 text-xs">
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{r.group}</Badge>
                          </td>
                          <td className="px-3 py-2 text-sm">{r.value}</td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(r.id, r.value)}
                              className="text-rose-500 hover:bg-rose-50"
                              aria-label={`ลบ ${r.value}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4 text-[#f97316]" /> เพิ่มตัวเลือก
            </DialogTitle>
            <DialogDescription>
              {addType === 'subject' && 'เพิ่มหัวข้อปัญหาสำหรับใบแจ้งซ่อม'}
              {addType === 'building' && 'เพิ่มอาคาร/ฝ่าย สำหรับ dropdown ในการแจ้งซ่อม'}
              {addType === 'resolution' && 'เพิ่มผลการแก้ไขสำหรับปิดงาน'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                {addType === 'subject' && 'หัวข้อปัญหา *'}
                {addType === 'building' && 'อาคาร/ฝ่าย *'}
                {addType === 'resolution' && 'ผลการแก้ไข *'}
              </Label>
              <Input
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">หมวดหมู่ (Group)</Label>
              <Input
                value={form.group}
                onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                placeholder={addType === 'building' ? 'ทั่วไป / ฝ่าย' : 'อาการทั่วไป / Printer / Network...'}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
            {addType === 'subject' && (
              <div className="space-y-1.5">
                <Label className="text-xs">ความเร่งด่วนเริ่มต้น</Label>
                <Select
                  value={form.defaultPriority}
                  onValueChange={(v) => setForm((f) => ({ ...f, defaultPriority: v }))}
                >
                  <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addMutation.isPending}>
              ยกเลิก
            </Button>
            <Button
              onClick={submitAdd}
              disabled={addMutation.isPending}
              className="bg-[#f97316] text-white hover:bg-[#ea580c]"
            >
              {addMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบ</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการลบ "{deleteTarget?.label ?? ''}" ใช่หรือไม่? การกระทำนี้ไม่สามารถยกเลิกได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                confirmDelete()
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              ลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
