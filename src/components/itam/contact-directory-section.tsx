'use client'

/**
 * ContactDirectorySection — admin UI for the guest contact directory.
 *
 * Backed by:
 *   GET    /api/settings/contact-directory
 *   POST   /api/settings/contact-directory
 *   DELETE /api/settings/contact-directory/[id]
 *
 * Stored as a JSON array in AppSetting 'contactDirectory'. Each entry
 * uses snake_case keys so it stays compatible with `lib/guest-validation.ts`.
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { BookUser, Plus, RefreshCw, Trash2, Phone, Search, Hash } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'

interface ContactEntry {
  id: string
  full_name: string
  phone_primary?: string
  employee_code?: string
  department?: string
  active: boolean
  note?: string
  createdAt?: string
}

interface ListResponse {
  data: ContactEntry[]
}

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

export function ContactDirectorySection() {
  const qc = useQueryClient()
  const [search, setSearch] = React.useState('')
  const [addOpen, setAddOpen] = React.useState(false)
  const [form, setForm] = React.useState({
    fullName: '',
    phonePrimary: '',
    employeeCode: '',
    department: '',
    note: '',
    active: true,
  })
  const [deleteTarget, setDeleteTarget] = React.useState<ContactEntry | null>(null)

  const { data, isLoading, isFetching } = useQuery<ListResponse>({
    queryKey: ['contact-directory'],
    queryFn: async () => {
      const res = await fetch('/api/settings/contact-directory', {
        headers: authHeaders(),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to load')
      }
      return res.json()
    },
    staleTime: 30_000,
  })

  const entries = data?.data ?? []
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) =>
      [
        e.full_name,
        e.phone_primary ?? '',
        e.employee_code ?? '',
        e.department ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [entries, search])

  const addMutation = useMutation({
    mutationFn: async (payload: {
      fullName: string
      phonePrimary: string
      employeeCode?: string
      department?: string
      note?: string
      active: boolean
    }) => {
      // BUG-SETTINGS-011 fix: pass payload as argument to mutate() instead
      // of capturing `form` in the closure. Previously the mutationFn
      // captured `form` at hook creation time — when the user typed in
      // the input, the form state updated in React but the mutationFn
      // still saw the old empty `form.fullName`, causing submitAdd's
      // toast error to fire even after the user typed a name.
      const res = await fetch('/api/settings/contact-directory', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Failed')
      return j
    },
    onSuccess: () => {
      toast.success('เพิ่มผู้ติดต่อแล้ว')
      setAddOpen(false)
      setForm({
        fullName: '',
        phonePrimary: '',
        employeeCode: '',
        department: '',
        note: '',
        active: true,
      })
      qc.invalidateQueries({ queryKey: ['contact-directory'] })
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    },
  })

  function handleDelete(e: ContactEntry) {
    setDeleteTarget(e)
  }

  function confirmDelete() {
    if (!deleteTarget) return
    const e = deleteTarget
    fetch(`/api/settings/contact-directory/${encodeURIComponent(e.id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Failed')
        toast.success('ลบแล้ว')
        qc.invalidateQueries({ queryKey: ['contact-directory'] })
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'ลบไม่สำเร็จ')
      })
      .finally(() => setDeleteTarget(null))
  }

  function submitAdd() {
    // BUG-SETTINGS-011 fix: read form state fresh at call time + pass to
    // mutate() as argument (not captured in mutationFn closure).
    const payload = {
      fullName: form.fullName.trim(),
      phonePrimary: form.phonePrimary.trim(),
      employeeCode: form.employeeCode.trim() || undefined,
      department: form.department.trim() || undefined,
      note: form.note.trim() || undefined,
      active: form.active,
    }
    if (!payload.fullName) {
      toast.error('กรุณาระบุชื่อ-นามสกุล')
      return
    }
    if (!payload.phonePrimary) {
      toast.error('กรุณาระบุเบอร์โทร')
      return
    }
    addMutation.mutate(payload)
  }

  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookUser className="h-4 w-4 text-[#f97316]" /> สมุดผู้ติดต่อ
          <Badge variant="outline" className="ml-1 text-[10px]">
            {entries.length} รายการ
          </Badge>
        </CardTitle>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          ผู้แจ้งซ่อม (Guest) ต้องมีชื่อและเบอร์โทรตรงกับสมุดนี้จึงจะแจ้งซ่อมได้
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อ / เบอร์ / รหัสพนักงาน / แผนก"
              className="pl-7 dark:bg-slate-800 dark:border-slate-700"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ['contact-directory'] })}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              className="bg-[#f97316] text-white hover:bg-[#ea580c]"
            >
              <Plus className="h-4 w-4" /> เพิ่มผู้ติดต่อ
            </Button>
          </div>
        </div>

        <div className="itam-scroll max-h-[55vh] overflow-auto rounded-md border border-slate-200 dark:border-slate-700">
          <Table>
            <TableHeader className="sticky top-0 bg-slate-50 dark:bg-slate-800">
              <TableRow>
                <TableHead className="h-8 text-xs">ชื่อ-นามสกุล</TableHead>
                <TableHead className="h-8 text-xs">เบอร์โทร</TableHead>
                <TableHead className="h-8 text-xs">รหัสพนักงาน</TableHead>
                <TableHead className="h-8 text-xs">แผนก</TableHead>
                <TableHead className="h-8 text-xs text-center">ใช้งาน</TableHead>
                <TableHead className="h-8 w-12 text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="mx-auto h-5 w-8 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-6 w-8" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-xs text-slate-400">
                    ไม่พบรายการ
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((e) => (
                  <TableRow key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <TableCell className="text-sm font-medium">{e.full_name}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {e.phone_primary ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3 text-slate-400" />
                          {e.phone_primary}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {e.employee_code ? (
                        <span className="inline-flex items-center gap-1">
                          <Hash className="h-3 w-3 text-slate-400" />
                          {e.employee_code}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-xs">{e.department ?? '—'}</TableCell>
                    <TableCell className="text-center">
                      {e.active ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">✓</Badge>
                      ) : (
                        <Badge className="bg-slate-50 text-slate-400">—</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(e)}
                        className="text-rose-500 hover:bg-rose-50"
                        aria-label={`ลบ ${e.full_name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4 text-[#f97316]" /> เพิ่มผู้ติดต่อ
            </DialogTitle>
            <DialogDescription>ระบบจะใช้ข้อมูลนี้ยืนยันตัวตนผู้แจ้งซ่อม (Guest)</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-fullName" className="text-xs">ชื่อ-นามสกุล *</Label>
              <Input
                id="contact-fullName"
                name="fullName"
                aria-label="ชื่อ-นามสกุล"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                placeholder="เช่น คุณสมชาย ใจดี"
                className="dark:bg-slate-800 dark:border-slate-700"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="contact-phone" className="text-xs">เบอร์โทร</Label>
                <Input
                  id="contact-phone"
                  name="phonePrimary"
                  aria-label="เบอร์โทร"
                  value={form.phonePrimary}
                  onChange={(e) => setForm((f) => ({ ...f, phonePrimary: e.target.value }))}
                  inputMode="tel"
                  placeholder="08xxxxxxxx"
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-employeeCode" className="text-xs">รหัสพนักงาน</Label>
                <Input
                  id="contact-employeeCode"
                  name="employeeCode"
                  aria-label="รหัสพนักงาน"
                  value={form.employeeCode}
                  onChange={(e) => setForm((f) => ({ ...f, employeeCode: e.target.value }))}
                  placeholder="ไม่บังคับ"
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-department" className="text-xs">แผนก / หน่วยงาน</Label>
              <Input
                id="contact-department"
                name="department"
                aria-label="แผนก / หน่วยงาน"
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                placeholder="เช่น แผนกเทคโนโลยีสารสนเทศ"
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-note" className="text-xs">หมายเหตุ (ไม่บังคับ)</Label>
              <Input
                id="contact-note"
                name="note"
                aria-label="หมายเหตุ"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="หมายเหตุเพิ่มเติม"
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-200">เปิดใช้งาน</div>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
            </div>
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
              ต้องการลบ "{deleteTarget?.full_name ?? ''}" จากสมุดผู้ติดต่อใช่หรือไม่? การกระทำนี้ไม่สามารถยกเลิกได้
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
    </Card>
  )
}
