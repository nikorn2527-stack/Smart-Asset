'use client'

/**
 * DemoManagementSection — admin tools for the Demo Mode.
 *
 * Surfaces:
 *   • Demo record counts (Devices, Work Orders, Stock Transactions, Meter
 *     Readings, Demo Users) — fetched from GET /api/itam/demo/reset.
 *   • Demo users list (filtered from /api/itam/auth/users where isDemo).
 *   • "ล้างข้อมูลสาธิต" button — calls POST /api/itam/demo/reset to delete
 *     every isDemo-tagged record. Confirms with a second AlertDialog click.
 *   • "รีเฟรช" button — re-fetch the counts + user list.
 *
 * The section is admin-only at the API level (requireAuth 'ADMIN' in the
 * route), so we don't double-gate here — but we DO hide it from non-admins
 * in the sidebar nav (handled by the settings tab visibility).
 */

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { RefreshCw, Trash2, FlaskConical, AlertTriangle } from 'lucide-react'
import { useLang } from '@/store/i18n-store'
import { useAuthStore } from '@/store/auth-store'
import { ROLE_LABELS, type Role } from '@/lib/auth-shared'

/** Build fetch headers with the user's JWT. */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

interface DemoCounts {
  devices: number
  workOrders: number
  stockTransactions: number
  meterReadings: number
  users: number
}

interface DemoUser {
  id: string
  email: string
  username: string | null
  name: string | null
  role: string
  isDemo: boolean
}

export function DemoManagementSection() {
  const { lang } = useLang()
  const qc = useQueryClient()
  const [resetOpen, setResetOpen] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)

  // Demo record counts
  const { data: counts, isLoading: countsLoading } = useQuery<DemoCounts>({
    queryKey: ['demo-counts'],
    queryFn: async () => {
      const res = await fetch('/api/itam/demo/reset', { headers: authHeaders() })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const j = (await res.json()) as { counts: DemoCounts }
      return j.counts
    },
  })

  // All users — we filter client-side by isDemo (the API returns everyone).
  const { data: usersData, isLoading: usersLoading } = useQuery<{
    users: DemoUser[]
  }>({
    queryKey: ['itam-users'],
    queryFn: async () => {
      const res = await fetch('/api/itam/auth/users', { headers: authHeaders() })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
  })

  const demoUsers = React.useMemo(
    () => (usersData?.users ?? []).filter((u) => u.isDemo),
    [usersData],
  )

  async function doReset() {
    setResetting(true)
    try {
      const res = await fetch('/api/itam/demo/reset', {
        method: 'POST',
        headers: authHeaders(),
      })
      const j = (await res.json().catch(() => ({}))) as {
        deleted?: DemoCounts
        error?: string
      }
      if (!res.ok) {
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const d = j.deleted ?? { devices: 0, workOrders: 0, stockTransactions: 0, meterReadings: 0, users: 0 }
      toast.success(
        `ล้างข้อมูลสาธิตแล้ว — อุปกรณ์ ${d.devices} · ใบงาน ${d.workOrders} · สต็อก ${d.stockTransactions} · มิเตอร์ ${d.meterReadings}`,
      )
      setResetOpen(false)
      // Invalidate both queries so the counts + user list refresh.
      await qc.invalidateQueries({ queryKey: ['demo-counts'] })
      await qc.invalidateQueries({ queryKey: ['itam-users'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ล้างข้อมูลไม่สำเร็จ')
    } finally {
      setResetting(false)
    }
  }

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['demo-counts'] })
    void qc.invalidateQueries({ queryKey: ['itam-users'] })
  }

  const totalRecords =
    (counts?.devices ?? 0) +
    (counts?.workOrders ?? 0) +
    (counts?.stockTransactions ?? 0) +
    (counts?.meterReadings ?? 0)

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            สาธิตระบบ (Demo Mode)
          </CardTitle>
          <CardDescription>
            บัญชีสาธิต 3 ตัว (demo_admin / demo_staff / demo_viewer — รหัสผ่าน{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900/60">
              demo123
            </code>
            ) ใช้งานแอปได้เต็มรูปแบบ — ข้อมูลที่สร้างจะถูก tag{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900/60">
              isDemo
            </code>{' '}
            แยกจากข้อมูลจริง และสามารถล้างได้ที่นี่
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Demo record counts */}
      <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>จำนวนข้อมูลสาธิตในระบบ</span>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5" /> รีเฟรช
            </Button>
          </CardTitle>
          <CardDescription>
            รวมทั้งหมด {totalRecords.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ระเบียน +{' '}
            {counts?.users ?? 0} บัญชีผู้ใช้สาธิต
          </CardDescription>
        </CardHeader>
        <CardContent>
          {countsLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-md" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <CountTile label="อุปกรณ์" value={counts?.devices ?? 0} color="text-[#f97316]" />
              <CountTile label="ใบงาน" value={counts?.workOrders ?? 0} color="text-emerald-600 dark:text-emerald-400" />
              <CountTile label="Stock Txn" value={counts?.stockTransactions ?? 0} color="text-sky-600 dark:text-sky-400" />
              <CountTile label="Meter Reading" value={counts?.meterReadings ?? 0} color="text-violet-600 dark:text-violet-400" />
              <CountTile label="บัญชีผู้ใช้" value={counts?.users ?? 0} color="text-rose-600 dark:text-rose-400" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Demo users list */}
      <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardHeader>
          <CardTitle className="text-base">บัญชีผู้ใช้สาธิต</CardTitle>
          <CardDescription>
            สร้างโดย <code>scripts/create-demo-users.js</code> — run ซ้ำเพื่อ reset
            รหัสผ่านกลับเป็น <code>demo123</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="itam-scroll max-h-[40vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-100/95 dark:bg-slate-900/95">
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-center">สาธิต</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-8 mx-auto rounded-full" /></TableCell>
                    </TableRow>
                  ))
                ) : demoUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-400">
                      ยังไม่มีบัญชีสาธิต — run <code>node scripts/create-demo-users.js</code>
                    </TableCell>
                  </TableRow>
                ) : (
                  demoUsers.map((u) => (
                    <TableRow key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <TableCell className="font-mono text-sm">{u.username ?? '—'}</TableCell>
                      <TableCell className="text-sm">{u.name ?? '—'}</TableCell>
                      <TableCell className="text-xs text-slate-500">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {ROLE_LABELS[u.role as Role] ?? u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className="bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800">
                          ✓
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-rose-300 dark:border-rose-900/60 dark:bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4" />
            Danger Zone — ล้างข้อมูลสาธิต
          </CardTitle>
          <CardDescription>
            ลบทุก record ที่ tag <code>isDemo: true</code> ออกจากระบบ — บัญชีผู้ใช้สาธิต
            จะยังอยู่ (login ได้ปกติ) แต่ข้อมูลที่เคยสร้างจะหายหมด
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => setResetOpen(true)}
            disabled={resetting || totalRecords === 0}
          >
            <Trash2 className="h-4 w-4" /> ล้างข้อมูลสาธิต
          </Button>
        </CardContent>
      </Card>

      {/* Confirmation dialog */}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการล้างข้อมูลสาธิต</AlertDialogTitle>
            <AlertDialogDescription>
              การกระทำนี้จะลบ {totalRecords.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ระเบียน (อุปกรณ์{' '}
              {counts?.devices ?? 0}, ใบงาน {counts?.workOrders ?? 0}, สต็อก{' '}
              {counts?.stockTransactions ?? 0}, มิเตอร์ {counts?.meterReadings ?? 0})
              — ไม่สามารถยกเลิกได้ ข้อมูลจริงจะไม่ได้รับผลกระทบ
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void doReset()
              }}
              disabled={resetting}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {resetting ? 'กำลังล้าง...' : 'ล้างข้อมูล'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Small sub-component for the count tiles ──────────────────────────
function CountTile({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  const { lang } = useLang()
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>
        {value.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
      </div>
    </div>
  )
}
