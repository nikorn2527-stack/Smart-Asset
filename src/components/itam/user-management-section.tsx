'use client'

/**
 * User Management section (Task ID: FIX-RBAC-AUDIT-CYCLE-SITE — Issue 2).
 *
 * Lists every user in the system + lets admins:
 *   • create / edit / delete users
 *   • set role + allowedSites
 *   • toggle active
 *   • jump to the Permission Management dialog (per-user granular perms)
 *
 * Uses the existing /api/itam/auth/users (GET, POST) + [id] (PUT, DELETE)
 * endpoints. Auth header carries the JWT from the auth store.
 */

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import {
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Shield,
  KeyRound,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import {
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  ALL_PERMISSION_KEYS,
  type Permission,
  type Role,
} from '@/lib/auth-shared'

/** Build fetch headers with the user's JWT (if logged in). */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

interface UserRow {
  id: string
  email: string
  username: string | null
  name: string | null
  role: Role
  allowedSites: string | 'ALL'
  permissions: Permission[]
  active: boolean
}

interface SiteOption {
  code: string
  name: string
}

const ROLE_CHOICES: Role[] = ['superadmin', 'admin', 'editor', 'meter', 'viewer']

interface UserFormState {
  id?: string
  email: string
  username: string
  name: string
  role: Role
  allowedSites: string // comma-separated, or "ALL"
  password: string // optional on edit
  active: boolean
  permissions: Set<Permission> // custom grants (additive on top of role defaults)
}

function emptyForm(): UserFormState {
  return {
    email: '',
    username: '',
    name: '',
    role: 'viewer',
    allowedSites: 'ALL',
    password: '',
    active: true,
    permissions: new Set<Permission>(),
  }
}

export function UserManagementSection() {
  const qc = useQueryClient()

  // ── Users list ──
  const { data: usersData, isLoading, isError, error } = useQuery<{ users: UserRow[]; count: number }>({
    queryKey: ['itam-users'],
    queryFn: async () => {
      const res = await fetch('/api/itam/auth/users', { headers: authHeaders() })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to load users')
      }
      return res.json()
    },
    staleTime: 60_000,
    retry: 1,
  })

  // ── Sites list (for the allowedSites picker) ──
  const { data: sites } = useQuery<SiteOption[]>({
    queryKey: ['sites'],
    queryFn: async () => {
      const res = await fetch('/api/sites', { headers: authHeaders() })
      if (!res.ok) return []
      const json = await res.json()
      return (json.sites ?? []) as SiteOption[]
    },
    staleTime: 120_000,
    retry: 1,
  })

  // ── Dialog state ──
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [form, setForm] = React.useState<UserFormState>(emptyForm())
  const [saving, setSaving] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<UserRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  // ── Permission management dialog state ──
  const [permTarget, setPermTarget] = React.useState<UserRow | null>(null)

  const users = usersData?.users ?? []

  function openAdd() {
    setForm(emptyForm())
    setDialogOpen(true)
  }

  function openEdit(u: UserRow) {
    // Seed the form with the user's CURRENT permissions minus their role's
    // defaults — those are stored as "custom grants" on User.permissions.
    const roleDefaults = new Set<Permission>(ROLE_PERMISSIONS[u.role] ?? [])
    const customOnly = new Set<Permission>(
      (u.permissions ?? []).filter((p) => !roleDefaults.has(p)),
    )
    setForm({
      id: u.id,
      email: u.email,
      username: u.username ?? '',
      name: u.name ?? '',
      role: u.role,
      allowedSites: u.allowedSites ?? 'ALL',
      password: '',
      active: u.active,
      permissions: customOnly,
    })
    setDialogOpen(true)
  }

  async function save() {
    if (!form.email.trim()) {
      toast.error('กรุณากรอกอีเมล')
      return
    }
    if (!form.id && !form.password) {
      toast.error('กรุณากรอกรหัสผ่าน (สำหรับผู้ใช้ใหม่)')
      return
    }
    try {
      setSaving(true)
      const isEdit = Boolean(form.id)
      const url = isEdit ? `/api/itam/auth/users/${form.id}` : '/api/itam/auth/users'
      const method = isEdit ? 'PUT' : 'POST'
      const body: Record<string, unknown> = {
        email: form.email.trim().toLowerCase(),
        username: form.username.trim().toLowerCase() || null,
        name: form.name.trim() || null,
        role: form.role,
        allowedSites: form.allowedSites.trim() || 'ALL',
        active: form.active,
        permissions: Array.from(form.permissions),
      }
      if (form.password) body.password = form.password

      const res = await fetch(url, {
        method,
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Save failed')
      }
      toast.success(isEdit ? 'แก้ไขผู้ใช้แล้ว' : 'เพิ่มผู้ใช้ใหม่แล้ว')
      setDialogOpen(false)
      await qc.invalidateQueries({ queryKey: ['itam-users'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      const res = await fetch(`/api/itam/auth/users/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Delete failed')
      }
      toast.success(`ลบผู้ใช้ ${deleteTarget.email} แล้ว`)
      setDeleteTarget(null)
      await qc.invalidateQueries({ queryKey: ['itam-users'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    } finally {
      setDeleting(false)
    }
  }

  async function toggleActive(u: UserRow) {
    try {
      const res = await fetch(`/api/itam/auth/users/${u.id}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ active: !u.active }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Toggle failed')
      }
      toast.success(!u.active ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว')
      await qc.invalidateQueries({ queryKey: ['itam-users'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ')
    }
  }

  function togglePerm(p: Permission) {
    setForm((prev) => {
      const next = new Set(prev.permissions)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return { ...prev, permissions: next }
    })
  }

  function setAllRoleDefaults() {
    setForm((prev) => {
      const merged = new Set<Permission>(prev.permissions)
      for (const p of ROLE_PERMISSIONS[form.role] ?? []) merged.add(p)
      return { ...prev, permissions: merged }
    })
  }

  function clearAll() {
    setForm((prev) => ({ ...prev, permissions: new Set<Permission>() }))
  }

  const roleDefaults = ROLE_PERMISSIONS[form.role] ?? []

  return (
    <div className="space-y-4">
      <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100">
                <Shield className="h-5 w-5 text-[#f97316]" />
                ผู้ใช้ทั้งหมด
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                จัดการบัญชีผู้ใช้ — สร้าง / แก้ไข / ลบ / ตั้งสิทธิ์
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => qc.invalidateQueries({ queryKey: ['itam-users'] })}
                className="dark:bg-slate-800 dark:border-slate-700"
              >
                <RefreshCw className="h-4 w-4" /> รีเฟรช
              </Button>
              <Button
                size="sm"
                onClick={openAdd}
                className="bg-[#f97316] text-white hover:bg-[#ea580c]"
              >
                <Plus className="h-4 w-4" /> เพิ่มผู้ใช้
              </Button>
            </div>
          </div>

          <div className="itam-scroll max-h-[55vh] overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead>ชื่อ / อีเมล</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>บทบาท</TableHead>
                  <TableHead>สาขาที่อนุญาต</TableHead>
                  <TableHead className="text-center">ใช้งาน</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={6}><Skeleton className="h-8 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-sm text-rose-600 dark:text-rose-400">
                          ⚠️ โหลดข้อมูลไม่สำเร็จ
                        </span>
                        <span className="text-xs text-slate-400">
                          {error instanceof Error ? error.message : 'เกิดข้อผิดพลาด'}
                        </span>
                        <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['itam-users'] })}>
                          ลองอีกครั้ง
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">
                      ยังไม่มีผู้ใช้ในระบบ
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <TableCell>
                        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                          {u.name || '—'}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{u.email}</div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                        {u.username || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-[#f97316]/10 text-[#f97316] border-[#f97316]/30 dark:bg-[#fb923c]/10 dark:text-[#fb923c] dark:border-[#fb923c]/30">
                          {ROLE_LABELS[u.role] ?? u.role}
                        </Badge>
                        {(u.permissions?.length ?? 0) > 0 && (
                          <span className="ml-1 text-[10px] text-slate-400" title="มีสิทธิ์เพิ่มเติมนอกเหนือจากบทบาท">
                            +{u.permissions.length} custom
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                        {u.allowedSites === 'ALL' || !u.allowedSites ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
                            ทั้งหมด
                          </Badge>
                        ) : (
                          <span className="font-mono">{u.allowedSites}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={u.active}
                          onCheckedChange={() => toggleActive(u)}
                          aria-label={`เปิด/ปิดการใช้งาน ${u.email}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPermTarget(u)}
                            className="h-8 text-[#f97316] hover:bg-[#f97316]/10"
                            title="จัดการสิทธิ์เฉพาะบุคคล"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(u)}
                            className="h-8"
                            title="แก้ไขผู้ใช้"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(u)}
                            className="h-8 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            title="ลบผู้ใช้"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
      </Card>

      {/* ── Create / Edit user dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Shield className="h-5 w-5 text-[#f97316]" />
              {form.id ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}
            </DialogTitle>
            <DialogDescription>
              {form.id
                ? `แก้ไขข้อมูล ${form.email} — เว้นว่างช่องรหัสผ่านหากไม่ต้องการเปลี่ยน`
                : 'กรอกข้อมูลให้ครบ — รหัสผ่านจำเป็นสำหรับผู้ใช้ใหม่'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto itam-scroll pr-1">
            {/* Basic info */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">อีเมล *</Label>
                <Input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="user@example.com"
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Username</Label>
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="user.name"
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">ชื่อ-สกุล</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="นาย สมชาย"
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">รหัสผ่าน {form.id ? '(เว้นว่าง = ใช้ของเดิม)' : '*'}</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">บทบาท (Role) *</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as Role })}
                >
                  <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_CHOICES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]} ({r})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">สถานะการใช้งาน</Label>
                <div className="flex h-9 items-center gap-2">
                  <Switch
                    checked={form.active}
                    onCheckedChange={(v) => setForm({ ...form, active: v })}
                  />
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {form.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                  </span>
                </div>
              </div>
            </div>

            {/* Allowed sites */}
            <div className="space-y-1.5">
              <Label className="text-xs">สาขาที่อนุญาต</Label>
              <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
                <label className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700">
                  <Checkbox
                    checked={form.allowedSites.toUpperCase() === 'ALL'}
                    onCheckedChange={(v) =>
                      v === true && setForm({ ...form, allowedSites: 'ALL' })
                    }
                  />
                  ทุกสาขา (ALL)
                </label>
                {(sites ?? []).map((s) => {
                  const checked =
                    form.allowedSites.toUpperCase() !== 'ALL' &&
                    form.allowedSites
                      .split(',')
                      .map((x) => x.trim().toUpperCase())
                      .includes(s.code)
                  return (
                    <label
                      key={s.code}
                      className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setForm((prev) => {
                            const current =
                              prev.allowedSites.toUpperCase() === 'ALL'
                                ? []
                                : prev.allowedSites.split(',').map((x) => x.trim()).filter(Boolean)
                            const set = new Set(current)
                            if (v === true) set.add(s.code)
                            else set.delete(s.code)
                            const arr = Array.from(set)
                            return {
                              ...prev,
                              allowedSites: arr.length === 0 ? 'ALL' : arr.join(','),
                            }
                          })
                        }}
                      />
                      {s.code}
                    </label>
                  )
                })}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                เลือก "ทุกสาขา" หรือเลือกเฉพาะสาขาที่ผู้ใช้นี้สามารถเข้าถึงได้ — ใช้สำหรับกรองข้อมูลในหน้าอุปกรณ์/ใบงาน/สต็อก
              </p>
            </div>

            {/* Custom permissions (additive to role defaults) */}
            <div className="space-y-2 rounded-md border border-[#f97316]/30 bg-[#f97316]/5 p-3 dark:border-[#fb923c]/30 dark:bg-[#fb923c]/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#f97316] dark:text-[#fb923c]">
                  <KeyRound className="h-3.5 w-3.5" />
                  สิทธิ์เพิ่มเติม (Custom Grants)
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={setAllRoleDefaults} className="h-7 text-[10px]">
                    + เพิ่มจากบทบาท
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearAll} className="h-7 text-[10px] text-rose-500">
                    ล้าง
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                สิทธิ์ในนี้เป็นการ <b>เพิ่ม</b> บน default ของบทบาท "{ROLE_LABELS[form.role]}" — {roleDefaults.length} สิทธิ์อัตโนมัติ + {form.permissions.size} สิทธิ์เพิ่มเติม
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {ALL_PERMISSION_KEYS.map((p) => {
                  const isDefault = roleDefaults.includes(p)
                  const isChecked = isDefault || form.permissions.has(p)
                  return (
                    <label
                      key={p}
                      className={`flex items-start gap-1.5 rounded border px-2 py-1 text-[11px] transition-colors ${
                        isDefault
                          ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60 dark:border-slate-700 dark:bg-slate-800/50'
                          : 'cursor-pointer border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50'
                      }`}
                      title={isDefault ? 'มาจากบทบาท (auto)' : 'สิทธิ์เพิ่มเติม'}
                    >
                      <Checkbox
                        checked={isChecked}
                        disabled={isDefault}
                        onCheckedChange={() => !isDefault && togglePerm(p)}
                      />
                      <span className="font-mono text-[10px] leading-tight">{p}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="bg-[#f97316] text-white hover:bg-[#ea580c]"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Permission Management dialog (granular per-user) ── */}
      <PermissionManagementDialog
        user={permTarget}
        onClose={() => setPermTarget(null)}
        onSaved={async () => {
          await qc.invalidateQueries({ queryKey: ['itam-users'] })
        }}
      />

      {/* ── Delete confirm ── */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบผู้ใช้</AlertDialogTitle>
            <AlertDialogDescription>
              คุณกำลังจะลบ{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {deleteTarget?.email}
              </span>
              {' '}การกระทำนี้ไม่สามารถย้อนกลับได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void confirmDelete()
              }}
              disabled={deleting}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleting ? 'กำลังลบ...' : 'ลบผู้ใช้'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Permission Management Dialog ─────────────────────────────────────────
/**
 * Renders ALL permissions grouped by category, with checkboxes. Saves to
 * the user's `permissions` field via PUT /api/itam/auth/users/[id].
 *
 * The checkbox state shows the user's MERGED permission set (role defaults +
 * custom grants). Toggling a checkbox that's currently granted by the role
 * has no effect (it can't be revoked per-user — change the role instead).
 * Toggling a non-default permission adds/removes it from the custom grants.
 */
function PermissionManagementDialog({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const qc = useQueryClient()
  const open = Boolean(user)
  const [draft, setDraft] = React.useState<Set<Permission>>(new Set())
  const [saving, setSaving] = React.useState(false)

  // Reset the draft whenever the target user changes
  React.useEffect(() => {
    if (!user) return
    const roleDefaults = new Set<Permission>(ROLE_PERMISSIONS[user.role] ?? [])
    // The user.permissions array already contains role defaults + custom
    // grants (the server returns the merged list via toAuthUser()).
    // For the draft, we only want to track the CUSTOM grants (additive).
    const customOnly = new Set<Permission>(
      (user.permissions ?? []).filter((p) => !roleDefaults.has(p)),
    )
    setDraft(customOnly)
  }, [user])

  if (!user) return null

  const roleDefaults = new Set<Permission>(ROLE_PERMISSIONS[user.role] ?? [])

  function toggle(p: Permission) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  function selectAllInGroup(group: typeof PERMISSION_GROUPS[number]) {
    setDraft((prev) => {
      const next = new Set(prev)
      for (const p of group.perms) {
        if (!roleDefaults.has(p.key)) next.add(p.key)
      }
      return next
    })
  }

  function clearAll() {
    setDraft(new Set<Permission>())
  }

  async function save() {
    if (!user) return
    try {
      setSaving(true)
      const res = await fetch(`/api/itam/auth/users/${user.id}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ permissions: Array.from(draft) }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Save failed')
      }
      toast.success(`บันทึกสิทธิ์ของ ${user.email} แล้ว`)
      await onSaved()
      await qc.invalidateQueries({ queryKey: ['itam-users'] })
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <KeyRound className="h-5 w-5 text-[#f97316]" />
            จัดการสิทธิ์ผู้ใช้
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-slate-700 dark:text-slate-200">{user.name || user.email}</span>
            {' '}— บทบาท: <Badge className="ml-1 bg-[#f97316]/10 text-[#f97316] border-[#f97316]/30 dark:bg-[#fb923c]/10 dark:text-[#fb923c] dark:border-[#fb923c]/30">{ROLE_LABELS[user.role]}</Badge>
            <br />
            <span className="text-[11px]">
              สิทธิ์ที่ติ๊กไว้ในกล่องสีเทาคือ default ของบทบาท (เปลี่ยนไม่ได้ — เปลี่ยนบทบาทแทน).
              ติ๊กสิทธิ์เพิ่มเติมในกล่องปกติเพื่อ grant เป็นรายบุคคล
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto itam-scroll pr-1">
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={clearAll} className="text-[10px] text-rose-500">
              ล้างสิทธิ์เพิ่มเติมทั้งหมด
            </Button>
          </div>
          {PERMISSION_GROUPS.map((group) => (
            <div
              key={group.title}
              className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                  <span>{group.icon}</span>
                  {group.title}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => selectAllInGroup(group)}
                  className="h-6 text-[10px] text-[#f97316] hover:bg-[#f97316]/10"
                >
                  + เพิ่มทั้งหมด
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {group.perms.map((p) => {
                  const isDefault = roleDefaults.has(p.key)
                  const isChecked = isDefault || draft.has(p.key)
                  return (
                    <label
                      key={p.key}
                      className={`flex items-start gap-2 rounded border p-2 text-xs transition-colors ${
                        isDefault
                          ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70 dark:border-slate-700 dark:bg-slate-800/50'
                          : 'cursor-pointer border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50'
                      }`}
                      title={p.desc}
                    >
                      <Checkbox
                        checked={isChecked}
                        disabled={isDefault}
                        onCheckedChange={() => !isDefault && toggle(p.key)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-700 dark:text-slate-200">{p.label}</div>
                        <div className="font-mono text-[10px] text-slate-400">{p.key}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">{p.desc}</div>
                        {isDefault && (
                          <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                            ✓ มาจากบทบาท
                          </div>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            ยกเลิก
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-[#f97316] text-white hover:bg-[#ea580c]"
          >
            {saving ? 'กำลังบันทึก...' : `บันทึก (${draft.size} สิทธิ์เพิ่มเติม)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
