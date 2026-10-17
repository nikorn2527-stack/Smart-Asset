'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  Loader2,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  AlertCircle,
  ShieldAlert,
  UserPlus,
  KeyRound,
  Mail,
  Fingerprint,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/auth-store'
import { useWebAuthn } from '@/hooks/use-webauthn'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useT } from '@/store/i18n-store'

interface OrgProfile {
  appName?: string
  appTagline?: string
  logoUrl?: string | null
  primaryColor?: string
  accentColor?: string
}

/** Decide whether logoUrl is an emoji (single short string) or a URL/path/data URL. */
function isEmoji(s: string): boolean {
  // Heuristic: short length, no 'http', no 'data:', no '/' — treat as emoji/text
  return s.length <= 4 && !/https?:|data:|\//i.test(s)
}

/** Darken a hex color by a percentage (for gradient end). */
function darkenHex(hex: string, pct = 0.18): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const num = parseInt(m[1], 16)
  let r = (num >> 16) & 0xff
  let g = (num >> 8) & 0xff
  let b = num & 0xff
  r = Math.max(0, Math.round(r * (1 - pct)))
  g = Math.max(0, Math.round(g * (1 - pct)))
  b = Math.max(0, Math.round(b * (1 - pct)))
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/**
 * itam-login.tsx — full-screen login page.
 *
 * Layout:
 *   - Left: branded gradient panel (hidden on mobile)
 *   - Right: card with username/password + เข้าสู่ระบบ button
 *   - Below the form: 3 action buttons
 *       1. "ขอเข้าใช้งาน" → opens registration dialog (Method 1)
 *       2. "ลืมรหัสผ่าน" → opens forgot-password dialog
 *       3. "รับลิงก์ลงทะเบียนทางอีเมล" → opens invite request dialog (Method 2)
 *
 * URL params:
 *   - ?register=1 → auto-open the registration dialog on mount
 *
 * Features:
 *   - Enter-to-submit
 *   - Show/hide password
 *   - Loading state during fetch
 *   - Error message for invalid creds
 *   - Lockout banner when API returns 429 (rate-limited)
 *   - After success: store token via auth-store.login() → AppShell auto-redirects
 */
export function ItamLogin() {
  const login = useAuthStore((s) => s.login)
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPwd, setShowPwd] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = React.useState<number | null>(null)
  const t = useT()

  // ── Organization profile (dynamic branding) ───────────────────────
  // NOTE: This endpoint requires VIEW_DEVICES auth. On the login page the user
  // is not yet authenticated, so the API returns 401. We must swallow that
  // case (return null) instead of returning undefined — React Query throws
  // "Query data cannot be undefined" otherwise, which crashes the login page
  // in production builds.
  const { data: profile } = useQuery<OrgProfile | null>({
    queryKey: ['public-branding'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/public/branding')
        if (!res.ok) return null
        const j = await res.json()
        return (j?.profile as OrgProfile) ?? null
      } catch {
        return null
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const appName = profile?.appName || 'Smart-Asset'
  const appTagline = profile?.appTagline || 'ระบบจัดการครุภัณฑ์ภาครัฐ'
  const primaryColor = profile?.primaryColor || '#f97316'
  const accentColor = profile?.accentColor || '#0d9488'
  const brandGradientFrom = primaryColor
  const brandGradientTo = darkenHex(primaryColor, 0.22)

  // Logo: URL/path → render <img>; emoji/short → render text; null → fallback 📦
  const rawLogo = profile?.logoUrl
  const logoIsUrl = !!rawLogo && !isEmoji(rawLogo)
  const logoEmoji = rawLogo && isEmoji(rawLogo) ? rawLogo : '📦'
  const LogoMark = (
    <>
      {logoIsUrl ? (
        <img
          src={rawLogo as string}
          alt={appName}
          className="h-full w-full rounded-xl object-cover"
        />
      ) : (
        <span className="text-2xl">{logoEmoji}</span>
      )}
    </>
  )

  // ── Dialogs ──────────────────────────────────────────────────────
  const [registerOpen, setRegisterOpen] = React.useState(false)
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [forgotOpen, setForgotOpen] = React.useState(false)

  // ── OAuth providers status (Google / LINE / Telegram) ───────────────
  // Fetches /api/auth/oauth/status on mount. Only render provider buttons
  // that have been configured by the admin in Settings → OAuth.
  const { data: oauthStatus } = useQuery<{
    providers: { google: boolean; apple: boolean; line: boolean; telegram: boolean }
    botUsername?: string
  }>({
    queryKey: ['oauth-status'],
    queryFn: async () => {
      const res = await fetch('/api/auth/oauth/status')
      if (!res.ok) return { providers: { google: false, apple: false, line: false, telegram: false } }
      return res.json()
    },
    staleTime: 60_000,
  })
  const providers = oauthStatus?.providers ?? { google: false, apple: false, line: false, telegram: false }
  const hasAnyOauth = providers.google || providers.apple || providers.line || providers.telegram

  // Handle the OAuth callback redirect: when the SPA boots with ?oauth=success
  // or ?oauth=pending in the URL, hydrate the session / show a toast.
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const oauthParam = params.get('oauth')
    if (!oauthParam) return
    const token = params.get('token')
    const userJson = params.get('user')
    if (oauthParam === 'success' && token && userJson) {
      try {
        const user = JSON.parse(decodeURIComponent(userJson))
        useAuthStore.getState().setSession(token, user)
        toast.success(t('auth.oauth.success'))
      } catch (err) { console.error('[itam-login]', err) }
    } else if (oauthParam === 'pending') {
      toast.info(t('auth.oauth.pending'), { duration: 8000 })
    } else if (oauthParam && oauthParam.startsWith('error')) {
      toast.error(t('auth.oauth.failed'))
    }
    // Clean the URL.
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('oauth')
      url.searchParams.delete('token')
      url.searchParams.delete('user')
      window.history.replaceState({}, '', url.toString())
    } catch (e) { console.error(String(e)) }
  }, [])

  // Auto-open registration dialog when ?register=1 is in the URL
  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('register') === '1') {
        setRegisterOpen(true)
        // Clean the URL so the dialog doesn't reopen on refresh
        const url = new URL(window.location.href)
        url.searchParams.delete('register')
        window.history.replaceState({}, '', url.toString())
      }
    } catch (err) { console.error('[itam-login]', err) }
  }, [])

  // Countdown for lockout
  const [remaining, setRemaining] = React.useState(0)
  React.useEffect(() => {
    if (lockedUntil == null) return
    const t = setInterval(() => {
      const ms = Math.max(0, lockedUntil - Date.now())
      setRemaining(Math.ceil(ms / 1000))
      if (ms <= 0) {
        setLockedUntil(null)
        setError(null)
      }
    }, 500)
    return () => clearInterval(t)
  }, [lockedUntil])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || lockedUntil != null) return
    if (!username.trim() || !password) {
      setError(t('auth.error.empty'))
      return
    }
    setLoading(true)
    setError(null)
    const res = await login(username, password)
    setLoading(false)
    if (!res.ok) {
      // detect lockout — login route returns 429 with retryAfterMs in body
      setError(res.error || t('auth.error.failed'))
      // Heuristic: if the error message mentions waiting, set a 5-min lockout
      if (res.error && /รอ|locked|attempt/i.test(res.error)) {
        setLockedUntil(Date.now() + 5 * 60 * 1000)
      }
    }
  }

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full blur-3xl"
        style={{ backgroundColor: `${primaryColor}33` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full blur-3xl"
        style={{ backgroundColor: `${accentColor}1f` }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative grid w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-md md:grid-cols-2"
      >
        {/* Left brand panel */}
        <div
          className="relative hidden flex-col justify-between p-8 text-white md:flex"
          style={{
            backgroundImage: `linear-gradient(to bottom right, ${brandGradientFrom}F2, ${brandGradientTo}F2)`,
          }}
        >
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white/15 backdrop-blur">
                {LogoMark}
              </div>
              <div>
                <div className="text-xl font-bold">{appName}</div>
                <div className="text-xs text-white/80">{appTagline}</div>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <h2 className="text-2xl font-bold leading-snug">
              {appName}
              <br />ครบวงจร ปลอดภัย
            </h2>
            <ul className="space-y-2 text-sm text-white/85">
              <li className="flex items-center gap-2"><span>✓</span> ควบคุมสิทธิ์ 5 ระดับ (RBAC)</li>
              <li className="flex items-center gap-2"><span>✓</span> แยกข้อมูลตามสาขา (Row-level)</li>
              <li className="flex items-center gap-2"><span>✓</span> จดมิเตอร์รายเดือน + ประวัติการย้าย</li>
              <li className="flex items-center gap-2"><span>✓</span> ประวัติการใช้งานครบทุกการทำรายการ</li>
            </ul>
          </div>
          <div className="inline-block rounded bg-slate-950/80 px-2 py-1 text-xs font-semibold text-[#f97316]">
            POWER BY PNG TEAM
          </div>
        </div>

        {/* Right form panel */}
        <div className="flex flex-col justify-center bg-white p-5 dark:bg-slate-900 sm:p-8">
          <div className="mb-6 flex items-center gap-3 md:hidden">
            <div
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg text-xl text-white"
              style={{ backgroundColor: primaryColor }}
            >
              {LogoMark}
            </div>
            <div>
              <div className="text-base font-bold text-slate-800 dark:text-slate-100">{appName}</div>
              <div className="text-xs text-slate-500">{appTagline}</div>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t('auth.login')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('auth.login_intro')}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {/* Username */}
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('auth.email')}
              </label>
              <div className="relative">
                <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading || lockedUntil != null}
                  placeholder={t('auth.username_placeholder')}
                  style={{ ['--brand' as string]: primaryColor }}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-[var(--brand)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('auth.password')}
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading || lockedUntil != null}
                  placeholder={t('auth.password_placeholder')}
                  style={{ ['--brand' as string]: primaryColor }}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-10 text-sm text-slate-800 transition-colors placeholder:text-slate-400 focus:border-[var(--brand)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  aria-label={t('auth.show_password')}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Error / Lockout */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                >
                  {lockedUntil != null ? (
                    <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  )}
                  <div>
                    <div>{error}</div>
                    {lockedUntil != null && remaining > 0 && (
                      <div className="mt-0.5 text-xs font-medium text-rose-800 dark:text-rose-200">
                        {t('auth.error.locked_wait').replace('{min}', String(minutes)).replace('{sec}', String(seconds).padStart(2, '0'))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || lockedUntil != null}
              style={{
                backgroundColor: primaryColor,
                ['--brand' as string]: primaryColor,
                boxShadow: `0 10px 25px -5px ${primaryColor}40`,
              }}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-900"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.loading')}
                </>
              ) : lockedUntil != null ? (
                <>
                  <Lock className="h-4 w-4" />
                  {t('auth.error.locked')}
                </>
              ) : (
                <>{t('auth.login')}</>
              )}
            </button>
          </form>

          {/* ── OAuth / External login buttons ─────────────────────────── */}
          {/* Only render the divider + buttons if at least one provider is configured. */}
          {hasAnyOauth && (
            <div className="mt-5">
              <div className="relative my-3 text-center">
                <div className="absolute inset-x-0 top-1/2 border-t border-slate-200 dark:border-slate-700" />
                <span className="relative bg-white px-3 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:bg-slate-900 dark:text-slate-500">
                  {t('auth.oauth.divider')}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <OauthButton
                  provider="google"
                  enabled={providers.google}
                  href="/api/auth/oauth/google"
                />
                <OauthButton
                  provider="apple"
                  enabled={providers.apple}
                  href="/api/auth/oauth/apple"
                />
                <OauthButton
                  provider="line"
                  enabled={providers.line}
                  href="/api/auth/oauth/line"
                />
                <OauthButton
                  provider="telegram"
                  enabled={providers.telegram}
                  href="/api/auth/oauth/telegram"
                />
              </div>
            </div>
          )}

          {/* ── Fingerprint / Biometric login (Touch ID / Face ID / Windows Hello) ── */}
          <FingerprintLogin
            email={username}
            onSuccess={(token, user) => { login(token, user as never) }}
            primaryColor={primaryColor}
          />

          {/* Action buttons — register / forgot / invite link */}
          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              style={{
                ['--brand' as string]: primaryColor,
                borderColor: `${primaryColor}66`,
                backgroundColor: `${primaryColor}0d`,
                color: primaryColor,
              }}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors hover:brightness-95"
            >
              <UserPlus className="h-4 w-4" />
              {t('auth.request_access')}
            </button>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setForgotOpen(true)}
                style={{ ['--brand' as string]: primaryColor }}
                className="flex items-center gap-1.5 text-slate-500 transition-colors hover:text-[var(--brand)] dark:text-slate-400"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {t('auth.forgot_password')}
              </button>
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                style={{ ['--brand' as string]: primaryColor }}
                className="flex items-center gap-1.5 text-slate-500 transition-colors hover:text-[var(--brand)] dark:text-slate-400"
              >
                <Mail className="h-3.5 w-3.5" />
                {t('auth.register_link')}
              </button>
            </div>
          </div>

          {/* Footer hint */}
          <div className="mt-6 space-y-1.5 border-t border-slate-100 pt-4 text-xs text-slate-400 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span>{t('auth.footer_logging')}</span>
              <span>{t('auth.footer_lockout')}</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Dialogs ─────────────────────────────────────────────── */}
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} />
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </div>
  )
}

// ─── Register dialog (Method 1) ─────────────────────────────────
function RegisterDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [form, setForm] = React.useState({
    name: '',
    email: '',
    phone: '',
    department: '',
    roleRequest: 'viewer',
    password: '',
    confirmPassword: '',
  })
  const [loading, setLoading] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const t = useT()

  function reset() {
    setForm({
      name: '',
      email: '',
      phone: '',
      department: '',
      roleRequest: 'viewer',
      password: '',
      confirmPassword: '',
    })
    setDone(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      toast.error(t('auth.register.error.empty'))
      return
    }
    if (form.password.length < 6) {
      toast.error(t('auth.register.error.short_pwd'))
      return
    }
    if (form.password !== form.confirmPassword) {
      toast.error(t('auth.register.error.mismatch'))
      return
    }
    setLoading(true)
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
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        testLink?: string
      }
      if (!res.ok || !j.ok) {
        throw new Error(j.error || 'ส่งคำขอไม่สำเร็จ')
      }
      setDone(true)
      toast.success(t('auth.register.success'))
      if (j.testLink) {
        toast.info(t('auth.register.smtp_not_configured'))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('auth.register.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('auth.register.title')}</DialogTitle>
          <DialogDescription>
            กรอกข้อมูลด้านล่างเพื่อส่งคำขอใช้งาน — รอผู้ดูแลอนุมัติ
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="py-6 text-center">
            <div className="mb-3 text-5xl">✅</div>
            <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              ส่งคำขอแล้ว รอผู้ดูแลอนุมัติ
            </div>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              ทางเราจะส่งอีเมลแจ้งเตือนไปยัง {form.email} เมื่อบัญชีของคุณได้รับการอนุมัติ
            </p>
            <Button className="mt-4" onClick={() => onOpenChange(false)}>
              ปิด
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reg-name">
                ชื่อ-นามสกุล <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="reg-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={loading}
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
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                disabled={loading}
                placeholder="you@example.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reg-phone">เบอร์โทร</Label>
                <Input
                  id="reg-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  disabled={loading}
                  placeholder="081-234-5678"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-dept">แผนก</Label>
                <Input
                  id="reg-dept"
                  value={form.department}
                  onChange={(e) =>
                    setForm({ ...form, department: e.target.value })
                  }
                  disabled={loading}
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
              <Input
                id="reg-pwd"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                disabled={loading}
                placeholder="อย่างน้อย 6 ตัวอักษร"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-confirm">
                ยืนยันรหัสผ่าน <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="reg-confirm"
                type="password"
                value={form.confirmPassword}
                onChange={(e) =>
                  setForm({ ...form, confirmPassword: e.target.value })
                }
                disabled={loading}
                placeholder="ยืนยันรหัสผ่าน"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    กำลังส่ง...
                  </>
                ) : (
                  'ส่งคำขอ'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Invite request dialog (Method 2) ───────────────────────────
function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [email, setEmail] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const t = useT()
  const [testLink, setTestLink] = React.useState<string | null>(null)

  function reset() {
    setEmail('')
    setDone(false)
    setTestLink(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error(t('auth.register_link.error.invalid_email'))
      return
    }
    setLoading(true)
    setTestLink(null)
    try {
      const res = await fetch('/api/auth/request-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        testLink?: string
      }
      if (!res.ok || !j.ok) {
        throw new Error(j.error || t('auth.register_link.failed'))
      }
      setDone(true)
      toast.success(t('auth.register_link.success'))
      if (j.testLink) {
        setTestLink(j.testLink)
        toast.warning(`${t('auth.register_link.smtp_not_configured')}: ${j.testLink}`, {
          duration: 8000,
        })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('auth.register_link.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('auth.register_link.title')}</DialogTitle>
          <DialogDescription>
            สำหรับผู้ใช้ใหม่ที่ยังไม่มีบัญชี — เราจะส่งลิงก์ลงทะเบียนไปยังอีเมลของคุณ (หมดอายุใน 24 ชั่วโมง)
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="py-6 text-center">
            <div className="mb-3 text-5xl">📧</div>
            <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              ส่งลิงก์ไปยังอีเมลแล้ว
            </div>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              กรุณาตรวจสอบกล่องอีเมล {email} และคลิกลิงก์เพื่อลงทะเบียน
            </p>
            {testLink && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                <div className="mb-1 font-semibold">
                  ⚠️ SMTP ยังไม่ได้ตั้งค่า — ลิงก์สำหรับทดสอบ:
                </div>
                <a
                  href={testLink}
                  className="break-all underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {testLink}
                </a>
              </div>
            )}
            <Button className="mt-4" onClick={() => onOpenChange(false)}>
              ปิด
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">
                อีเมล <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="you@example.com"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    กำลังส่ง...
                  </>
                ) : (
                  'ส่งลิงก์'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Forgot password dialog ─────────────────────────────────────
function ForgotPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [email, setEmail] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const t = useT()
  const [testLink, setTestLink] = React.useState<string | null>(null)

  function reset() {
    setEmail('')
    setDone(false)
    setTestLink(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error(t('auth.register_link.error.invalid_email'))
      return
    }
    setLoading(true)
    setTestLink(null)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        testLink?: string
      }
      if (!res.ok || !j.ok) {
        throw new Error(j.error || t('auth.forgot.failed'))
      }
      setDone(true)
      toast.success(t('auth.forgot.success'))
      if (j.testLink) {
        setTestLink(j.testLink)
        toast.warning(`${t('auth.register_link.smtp_not_configured')}: ${j.testLink}`, {
          duration: 8000,
        })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('auth.forgot.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('auth.forgot.title')}</DialogTitle>
          <DialogDescription>
            กรอกอีเมลที่ใช้สมัคร — เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้ (หมดอายุใน 1 ชั่วโมง)
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="py-6 text-center">
            <div className="mb-3 text-5xl">🔐</div>
            <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              ตรวจสอบอีเมลของคุณ
            </div>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              หากอีเมล {email} มีอยู่ในระบบ เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้
            </p>
            {testLink && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                <div className="mb-1 font-semibold">
                  ⚠️ SMTP ยังไม่ได้ตั้งค่า — ลิงก์สำหรับทดสอบ:
                </div>
                <a
                  href={testLink}
                  className="break-all underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {testLink}
                </a>
              </div>
            )}
            <Button className="mt-4" onClick={() => onOpenChange(false)}>
              ปิด
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">
                อีเมล <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="you@example.com"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                ยกเลิก
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    กำลังส่ง...
                  </>
                ) : (
                  'ส่งลิงก์รีเซ็ต'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── OAuth provider button ────────────────────────────────────────────
// Renders a branded login button for Google / LINE / Telegram. When the
// provider isn't configured by the admin yet, the button is disabled with
// a tooltip explaining why.
function OauthButton({
  provider,
  enabled,
  href,
}: {
  provider: 'google' | 'apple' | 'line' | 'telegram'
  enabled: boolean
  href: string
}) {
  const config = {
    google: {
      label: 'Google',
      bg: 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50',
      dark: 'dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-700',
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
      ),
    },
    apple: {
      label: 'Apple',
      bg: 'bg-black text-white border-transparent hover:bg-slate-800',
      dark: 'dark:bg-white dark:text-black dark:hover:bg-slate-200',
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
      ),
    },
    line: {
      label: 'LINE',
      bg: 'bg-[#06C755] text-white border-transparent hover:bg-[#05b04c]',
      dark: '',
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
          <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.032-.199.032-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.252 1.058.58.12.301.078.775.038 1.082l-.164 1.02c-.05.301-.23 1.186 1.035.645 1.27-.541 6.854-4.053 9.342-6.936C23.176 14.531 24 12.49 24 10.314" />
        </svg>
      ),
    },
    telegram: {
      label: 'Telegram',
      bg: 'bg-[#0088CC] text-white border-transparent hover:bg-[#0077b3]',
      dark: '',
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.324-.437.89-.663 3.478-1.429 5.795-2.307 6.953-2.635 3.313-.943 3.998-1.107 4.451-1.114z" />
        </svg>
      ),
    },
  }[provider]

  const button = (
    <a
      href={enabled ? href : undefined}
      aria-disabled={!enabled}
      onClick={(e) => {
        if (!enabled) {
          e.preventDefault()
          toast.warning('ผู้ดูแลยังไม่ได้ตั้งค่า OAuth สำหรับผู้ให้บริการนี้')
        }
      }}
      className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors ${config.bg} ${config.dark} ${
        !enabled ? 'cursor-not-allowed opacity-60' : ''
      }`}
    >
      {config.icon}
      <span>{config.label}</span>
    </a>
  )

  if (!enabled) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="top">
            <span className="text-xs">ยังไม่ได้ตั้งค่า — ผู้ดูแลต้องกรอกข้อมูลใน Settings → OAuth</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  return button
}

// ─────────────────────────────────────────────────────────────────────────
// FingerprintLogin — ล็อกอินด้วยPasskey / Face ID / Touch ID / Windows Hello
// ─────────────────────────────────────────────────────────────────────────
function FingerprintLogin({
  email,
  onSuccess,
  primaryColor,
}: {
  email: string
  onSuccess: (token: string, user: unknown) => void
  primaryColor: string
}) {
  const { isSupported, login, loading } = useWebAuthn()
  const t = useT()

  if (!isSupported) return null

  const handleFingerprint = async () => {
    if (!email || email.trim() === '') {
      toast.info(t('auth.passkey.need_email'))
      return
    }
    const result = await login(email.trim())
    if (result) {
      toast.success(t('auth.passkey.success'))
      onSuccess(result.token, result.user)
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleFingerprint}
        disabled={loading}
        style={{
          ['--brand' as string]: primaryColor,
          borderColor: `${primaryColor}40`,
          color: primaryColor,
          backgroundColor: `${primaryColor}08`,
        }}
        className="group flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border-2 text-sm font-medium transition-all hover:bg-[var(--brand)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50 disabled:cursor-not-allowed disabled:opacity-60"
        title={t('auth.passkey.title')}
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('auth.passkey.verifying')}
          </>
        ) : (
          <>
            <Fingerprint className="h-5 w-5 transition-transform group-hover:scale-110" />
            {t('auth.passkey')}
          </>
        )}
      </button>
      <p className="mt-1.5 text-center text-[10px] text-[#f97316] dark:text-slate-500">
        Touch ID · Face ID · Windows Hello · Security Key
      </p>
    </div>
  )
}
