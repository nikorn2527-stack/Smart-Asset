'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Loader2, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * AuthResetPage — shown when URL has `?token={token}` and the token is
 * a valid 'reset' token (from the forgot-password email).
 *
 * Lets the user set a new password.
 */
export function AuthResetPage({ token }: { token: string }) {
  const [email, setEmail] = React.useState<string | null>(null)
  const [loadingInfo, setLoadingInfo] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)

  const [password, setPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [showPwd, setShowPwd] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  // ── Verify token ───────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false
    async function verify() {
      setLoadingInfo(true)
      try {
        const res = await fetch(
          `/api/auth/verify-token?token=${encodeURIComponent(token)}&type=reset`,
        )
        const j = (await res.json().catch(() => ({}))) as {
          valid?: boolean
          error?: string
          email?: string
        }
        if (cancelled) return
        if (!j.valid) {
          setError(j.error || 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว')
        } else if (j.email) {
          setEmail(j.email)
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
    if (password.length < 6) {
      toast.error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
      return
    }
    if (password !== confirmPassword) {
      toast.error('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !j.ok) {
        throw new Error(j.error || 'เปลี่ยนรหัสผ่านไม่สำเร็จ')
      }
      setDone(true)
      toast.success('เปลี่ยนรหัสผ่านสำเร็จ')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ')
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
  if (error || !email) {
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
            เปลี่ยนรหัสผ่านสำเร็จ
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            คุณสามารถเข้าสู่ระบบด้วยรหัสผ่านใหม่ได้ทันที
          </p>
          <Button className="mt-6 w-full" onClick={backToLogin}>
            กลับหน้าเข้าสู่ระบบ
          </Button>
        </motion.div>
      </div>
    )
  }

  // ── Reset form ──────────────────────────────────────────────────
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl"
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
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-bold">ตั้งรหัสผ่านใหม่</div>
              <div className="text-xs text-white/80">
                สำหรับบัญชี {email}
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="space-y-3 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="reset-pwd">
              รหัสผ่านใหม่ <span className="text-rose-500">*</span>
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="reset-pwd"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                placeholder="อย่างน้อย 6 ตัวอักษร"
                className="pl-10 pr-10"
                autoFocus
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
            <Label htmlFor="reset-confirm">
              ยืนยันรหัสผ่านใหม่ <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="reset-confirm"
              type={showPwd ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
              placeholder="ยืนยันรหัสผ่านใหม่"
            />
          </div>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              'ตั้งรหัสผ่านใหม่'
            )}
          </Button>
        </form>
      </motion.div>
    </div>
  )
}
