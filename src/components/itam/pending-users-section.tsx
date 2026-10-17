'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Check, X, RefreshCw, Users } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
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
import { useLang, useI18nStore } from '@/store/i18n-store'

interface PendingUser {
  id: string
  email: string
  username: string | null
  name: string | null
  role: string
  department: string | null
  phone: string | null
  createdAt: string
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'ผู้ดูแลสูงสุด',
  admin: 'ผู้ดูแลระบบ',
  editor: 'เจ้าหน้าที่จัดการข้อมูล',
  meter: 'ผู้จดมิเตอร์',
  viewer: 'ผู้ดูรายงาน',
}

// BUGFIX (QA-ROUND-2026-09-16-C): bare `lang` was never defined in this module
// scope → ReferenceError as soon as a pending user row rendered. Read the
// language from the zustand store (non-hook read, safe in render helpers).
function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(useI18nStore.getState().lang === 'th' ? 'th-TH' : 'en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/**
 * PendingUsersSection — admin tab showing users awaiting approval.
 * Lists active=false users; admin can approve (set active=true) or
 * reject (delete) each request.
 */
export function PendingUsersSection() {
  const qc = useQueryClient()
  const [actingId, setActingId] = React.useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = React.useState<PendingUser | null>(null)

  const { data, isLoading, refetch, isFetching } = useQuery<{
    users: PendingUser[]
    count: number
  }>({
    queryKey: ['itam-pending-users'],
    queryFn: async () => {
      const res = await fetch('/api/itam/auth/pending', {
        headers: authHeaders(),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || 'Failed to load pending users')
      }
      return res.json()
    },
  })

  const users = data?.users ?? []

  async function approve(user: PendingUser) {
    if (actingId) return
    setActingId(user.id)
    try {
      const res = await fetch(`/api/itam/auth/approve/${user.id}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        emailSent?: boolean
      }
      if (!res.ok || !j.ok) {
        throw new Error(j.error || 'อนุมัติไม่สำเร็จ')
      }
      toast.success(`อนุมัติบัญชี ${user.email} แล้ว`, {
        description: j.emailSent
          ? 'ส่งอีเมลแจ้งผู้ใช้แล้ว'
          : 'SMTP ยังไม่ได้ตั้งค่า — ไม่ได้ส่งอีเมลแจ้ง',
      })
      await qc.invalidateQueries({ queryKey: ['itam-pending-users'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'อนุมัติไม่สำเร็จ')
    } finally {
      setActingId(null)
    }
  }

  async function reject(user: PendingUser) {
    if (actingId) return
    setRejectTarget(user)
  }

  async function confirmReject() {
    if (!rejectTarget) return
    const user = rejectTarget
    setActingId(user.id)
    setRejectTarget(null)
    try {
      const res = await fetch(`/api/itam/auth/reject/${user.id}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !j.ok) {
        throw new Error(j.error || 'ปฏิเสธไม่สำเร็จ')
      }
      toast.success(`ปฏิเสธและลบคำขอของ ${user.email} แล้ว`)
      await qc.invalidateQueries({ queryKey: ['itam-pending-users'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ปฏิเสธไม่สำเร็จ')
    } finally {
      setActingId(null)
    }
  }

  return (
    <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      <CardContent className="p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[#f97316]" />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              ผู้ใช้รออนุมัติ
            </span>
            <Badge className="bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/50">
              {data?.count ?? 0} คน
            </Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            <span className="ml-1 hidden sm:inline">รีเฟรช</span>
          </Button>
        </div>

        {/* Table */}
        <div className="itam-scroll max-h-[55vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-slate-100/95 dark:bg-slate-900/95">
              <TableRow>
                <TableHead>ชื่อ</TableHead>
                <TableHead>อีเมล</TableHead>
                <TableHead>เบอร์</TableHead>
                <TableHead>แผนก</TableHead>
                <TableHead>สิทธิ์ที่ขอ</TableHead>
                <TableHead>วันที่ขอ</TableHead>
                <TableHead className="text-right">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-7 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-slate-400 text-sm">
                    <div className="text-4xl mb-2">🎉</div>
                    ไม่มีคำขอรออนุมัติ — ทุกคำขอได้รับการพิจารณาแล้ว
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <TableCell className="text-sm font-medium">
                      {u.name || '—'}
                    </TableCell>
                    <TableCell className="text-sm">{u.email}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {u.phone || '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {u.department || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {ROLE_LABELS[u.role] || u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDate(u.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="default"
                          className="bg-emerald-600 hover:bg-emerald-700 h-7"
                          disabled={actingId === u.id}
                          onClick={() => approve(u)}
                          title="อนุมัติ"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span className="ml-1 hidden sm:inline">อนุมัติ</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700 h-7"
                          disabled={actingId === u.id}
                          onClick={() => reject(u)}
                          title="ปฏิเสธ"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span className="ml-1 hidden sm:inline">ปฏิเสธ</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Reject confirmation */}
      <AlertDialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการปฏิเสธ</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการปฏิเสธคำขอของ "{rejectTarget?.name || rejectTarget?.email || ''}" ใช่หรือไม่? บัญชีนี้จะถูกลบออกจากระบบ การกระทำนี้ไม่สามารถยกเลิกได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void confirmReject()
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              ปฏิเสธ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
