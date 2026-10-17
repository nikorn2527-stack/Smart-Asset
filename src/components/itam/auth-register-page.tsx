'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Loader2, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
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

interface TokenInfo {
  email: string
  type: string
  data?: {
    name?: string
    phone?: string
    department?: string
    roleRequest?: string
  }
}

/**
 * AuthRegisterPage — shown when URL has `?token={token}` and the token is
 * a valid 'invite'/'register' token (Method 2 — invite link from email).
 *
 * The email field is read-only (locked to the value from the token).
 */
export function AuthRegisterPage({ token }: { token: string }) {
  const [info, setInfo] = React.useState<TokenInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)

  const [form, setForm] = React.useState({
    name: '',
    email: '',
    phone: '',
    department: '',
    roleRequest: 'viewer',
    password: '',
    confirmPassword: '',
  })
  const [showPwd, setShowPwd] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  // ── Verify token ───────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false
    async function verify() {
      setLoadingInfo(true)
      try {
        const res = await fetch(
          `/api/auth/verify-token?token=${encodeURIComponent(token)}&type=register`,
        )
        const j = (await res.json().catch(() => ({}))) as {
          valid?: boolean
          error?: string
          email?: string
          type?: string
          data?: TokenInfo['data']
        }
        if (cancelled) return
        if (!j.valid) {
          setError(j.error || 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว')
        } else if (j.email) {
          const tokenInfo: TokenInfo = {
            email: j.email,
            type: j.type || 'invite',
            data: j.data,
          }
          setInfo(tokenInfo)
          setForm((prev) => ({
            ...prev,
            email: j.email || '',
            name: j.data?.name || '',
            phone: j.data?.phone || '',
            department: j.data?.department || '',
            roleRequest: j.data?.roleRequest || 'viewer',
          }))
        } else {
          setError('ลิงก์ไม่ถูกต้อง')
        }
      } catch {
        if (!cancelled) setError('ไม่สามารถตรวจสอบลิงก์ได้')
      } finally {
        if (!cancelled) setLoadingInfo(false)
      }
    }
    void verify()
    return () => {
      cancelled = true
    }
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!form.name.trim() || !form.password) {
      toast.error('กรุณากรอกชื่อและรหัสผ่าน')
      return
    }
    if (form.password.length < 6) {
      toast.error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
      return
    }
    if (form.password !== form.confirmPassword) {
      toast.error('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || undefined,
          department: form.department.trim() || undefined,
          roleRequest: form.roleRequest,
          password: form.password,
          token,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        message?: string
      }
      if (!res.ok || !j.ok) {
        throw new Error(j.error || 'ลงทะเบียนไม่สำเร็จ')
      }
      setDone(true)
      toast.success('ลงทะเบียนสำเร็จ — รอผู้ดูแลอนุมัติ')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลงทะเบียนไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  function backToLogin() {
    const url = new URL(window.location.href)
    url.searchParams.delete('token')
    window.location.href = url.toString()
  }

  // ── Loading state ───────────────────────────────────────────────
  if (loadingInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 text-white">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#f97316]" />
          <div className="text-sm text-slate-400">กำลังตรวจสอบลิงก์...</div>
        </div>
      </div>
    )
  }

  // ── Invalid token ───────────────────────────────────────────────
  if (error || !info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-2xl border border-white/10 bg-white p-8 shadow-2xl"
        >
          <div className="mb-4 text-center text-5xl">⚠️</div>
          <h1 className="text-center text-xl font-bold text-slate-800">
            ลิงก์ไม่ถูกต้อง
          </h1>
          <p className="mt-2 text-center text-sm text-slate-500">
            {error || 'ลิงก์อาจหมดอายุหรือถูกใช้แล้ว'}
          </p>
          <Button className="mt-6 w-full" onClick={backToLogin}>
            กลับหน้าเข้าสู่ระบบ
          </Button>
        </motion.div>
      </div>
    )
  }

  // ── Success ─────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-2xl border border-white/10 bg-white p-8 text-center shadow-2xl"
        >
          <CheckCircle2 className="mx-auto mb-3 h-16 w-16 text-emerald-500" />
          <h1 className="text-xl font-bold text-slate-800">
            ลงทะเบียนสำเร็จ
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            คำขอของคุณถูกส่งไปยังผู้ดูแลระบบแล้ว
            เมื่อบัญชีได้รับการอนุมัติ คุณจะได้รับอีเมลแจ้งเตือน
            และสามารถเข้าสู่ระบบได้ทันที
          </p>
          <Button className="mt-6 w-full" onClick={backToLogin}>
            กลับหน้าเข้าสู่ระบบ
          </Button>
        </motion.div>
      </div>
    )
  }

  // ── Registration form ───────────────────────────────────────────
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="bg-gradient-to-br from-[#f97316] to-[#c2410c] p-6 text-white">
          <button
            type="button"
            onClick={backToLogin}
            className="mb-2 flex items-center gap-1 text-xs text-white/80 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3 w-3" /> กลับหน้าเข้าสู่ระบบ
          </button>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15 text-xl">
              📦
            </div>
            <div>
              <div className="text-lg font-bold">ลงทะเบียนใช้งาน ITAM</div>
              <div className="text-xs text-white/80">
                คุณได้รับเชิญให้ลงทะเบียน — กรอกข้อมูลเพื่อส่งคำขอ
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="space-y-3 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="reg-name">
              ชื่อ-นามสกุล <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="reg-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              disabled={submitting}
              placeholder="สมชาย ใจดี"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-email">
              อีเมล <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="reg-email"
              type="email"
              value={form.email}
              readOnly
              disabled
              className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            />
            <p className="text-xs text-slate-400">
              อีเมลนี้ถูกตั้งค่าจากลิงก์เชิญ — ไม่สามารถแก้ไขได้
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reg-phone">เบอร์โทร</Label>
              <Input
                id="reg-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                disabled={submitting}
                placeholder="081-234-5678"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-dept">แผนก</Label>
              <Input
                id="reg-dept"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                disabled={submitting}
                placeholder="ไอที"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>สิทธิ์ที่ขอ</Label>
            <Select
              value={form.roleRequest}
              onValueChange={(v) => setForm({ ...form, roleRequest: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">ผู้ดูรายงาน (Viewer)</SelectItem>
                <SelectItem value="staff">เจ้าหน้าที่ (Staff)</SelectItem>
                <SelectItem value="coordinator">ประสานงาน (Coordinator)</SelectItem>
                <SelectItem value="manager">ผู้จัดการ (Manager)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-pwd">
              รหัสผ่าน <span className="text-rose-500">*</span>
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="reg-pwd"
                type={showPwd ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                disabled={submitting}
                placeholder="อย่างน้อย 6 ตัวอักษร"
                className="pl-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                aria-label={showPwd ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-600"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-confirm">
              ยืนยันรหัสผ่าน <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="reg-confirm"
              type={showPwd ? 'text' : 'password'}
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              disabled={submitting}
              placeholder="ยืนยันรหัสผ่าน"
            />
          </div>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                กำลังส่งคำขอ...
              </>
            ) : (
              'ส่งคำขอลงทะเบียน'
            )}
          </Button>

          <p className="text-center text-xs text-slate-400">
            หลังส่งคำขอ บัญชีจะอยู่ในสถานะ "รออนุมัติ" — ผู้ดูแลจะพิจารณาและส่งอีเมลแจ้งผล
          </p>
        </form>
      </motion.div>
    </div>
  )
}
