'use client'

export const dynamic = 'force-dynamic'

// ============================================================
// /login/line/page.tsx — LINE Login landing page for PUBLIC users
// (Task ID: PUBLIC-QR-2B-LINE-LOGIN)
// ============================================================
// This page is the user-facing entry point for the LINE Login v2.1 web flow.
//
// UX flow:
//   1. Public visitor scans a Smart QR (e.g. /qr/d/abc123?action=repair)
//      but isn't logged in via LINE yet.
//   2. The QR router (or the public repair form) redirects them to
//        /login/line?redirect=/qr/d/abc123?action=repair
//   3. This page shows a friendly "เข้าสู่ระบบด้วย LINE" button.
//   4. Clicking it navigates to /api/auth/line/login?redirect=... which
//      302-redirects the browser to LINE's authorize endpoint.
//   5. After consent, LINE redirects to /api/auth/line/callback which sets
//      the `line_session` cookie and 302-redirects back to the original URL.
//
// The page also handles:
//   • ?oauth_error=xxx — shown if the LINE callback failed (denied consent,
//     state mismatch, token exchange error, etc.)
//   • sessionStorage.pendingQrAction — optional payload saved by the QR
//     router so we can show "เข้าสู่ระบบเพื่อแจ้งซ่อม <อุปกรณ์ X>" context.
// ============================================================

import * as React from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  LogIn,
} from 'lucide-react'

interface PendingQrAction {
  /** 'd' | 'a' | 's' | 'w' — see src/lib/smart-qr.ts */
  type?: string
  /** Short ID from the QR code (e.g. 'abc123') */
  id?: string
  /** 'repair' | 'view' | 'meter' | 'sticker' | 'transfer' */
  action?: string
  /** Friendly device name (optional, for nice UX) */
  deviceName?: string
  /** Original URL the user came from (used as fallback for the redirect) */
  returnUrl?: string
}

const ERROR_MESSAGES: Record<string, string> = {
  missing_params: 'การเข้าสู่ระบบไม่สมบูรณ์ — กรุณาลองอีกครั้ง',
  state_mismatch:
    'เซสชันหมดอายุหรือไม่ถูกต้อง — กรุณาลองเข้าสู่ระบบใหม่อีกครั้ง',
  not_configured:
    'ระบบยังไม่ได้ตั้งค่า LINE Login — กรุณาติดต่อผู้ดูแลระบบ',
  token_exchange_failed:
    'ไม่สามารถยืนยันตัวตนกับ LINE ได้ — กรุณาลองอีกครั้งในภายหลัง',
  token_access_denied: 'คุณยกเลิกการให้สิทธิ์ LINE — ไม่สามารถเข้าสู่ระบบได้',
  token_invalid_grant:
    'รหัสการเข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ — กรุณาลองใหม่',
  token_invalid_request:
    'คำขอไม่ถูกต้อง — กรุณาลองเข้าสู่ระบบอีกครั้ง',
  exception: 'เกิดข้อผิดพลาดบางอย่าง — กรุณาลองอีกครั้งในภายหลัง',
}

const ACTION_LABELS: Record<string, string> = {
  repair: 'แจ้งซ่อม',
  view: 'ดูข้อมูลอุปกรณ์',
  meter: 'จดมิเตอร์',
  sticker: 'พิมพ์สติกเกอร์',
  transfer: 'ย้ายอุปกรณ์',
}

export default function LineLoginPage() {
  // Wrap the inner component in Suspense to satisfy Next.js static generation
  // (useSearchParams must be inside a Suspense boundary when the page is
  // rendered at build time). Without this, `next build` fails with:
  //   "useSearchParams() should be wrapped in a suspense boundary at page"
  return (
    <React.Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950"><div className="text-sm text-slate-400">กำลังโหลด...</div></div>}>
      <LineLoginInner />
    </React.Suspense>
  )
}

function LineLoginInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const redirect = searchParams.get('redirect') || '/'
  const errorCode = searchParams.get('oauth_error')

  const [pending, setPending] = React.useState<PendingQrAction | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [currentLineSession, setCurrentLineSession] = React.useState<{
    displayName: string
    pictureUrl?: string | null
  } | null>(null)

  // ── Load pending action + check existing LINE session on mount ──────
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = sessionStorage.getItem('pendingQrAction')
      if (raw) setPending(JSON.parse(raw) as PendingQrAction)
    } catch {
      // ignore — sessionStorage may be disabled
    }

    // Check if already logged in via LINE — show "already logged in" UI.
    fetch('/api/auth/line/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.data) {
          setCurrentLineSession({
            displayName: body.data.displayName,
            pictureUrl: body.data.pictureUrl ?? null,
          })
        }
      })
      .catch(() => {
        // ignore — not logged in
      })
  }, [])

  function startLineLogin() {
    setStarting(true)
    // The /api/auth/line/login endpoint will 302 redirect to LINE (external URL).
    // We intentionally use window.location.href instead of router.push() so the
    // browser performs a full navigation that correctly follows the cross-origin
    // redirect chain to https://access.line.me/oauth2/v2.1/authorize.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/auth/line/login?redirect=${encodeURIComponent(redirect)}`
  }

  function goBack() {
    router.push(redirect)
  }

  const errorMessage = errorCode
    ? ERROR_MESSAGES[errorCode] || `เข้าสู่ระบบไม่สำเร็จ (${errorCode})`
    : null

  const actionLabel = pending?.action
    ? ACTION_LABELS[pending.action] || pending.action
    : null

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-md p-4">
        {/* Header */}
        <div className="flex items-center justify-between pt-4">
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            ย้อนกลับ
          </button>
          <span className="text-xs text-slate-400">ITAM</span>
        </div>

        {/* Hero */}
        <div className="mt-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#06C755] text-white shadow-lg shadow-[#06C755]/30">
            <LogIn className="h-8 w-8" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-800 dark:text-slate-100">
            เข้าสู่ระบบด้วย LINE
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            สำหรับการแจ้งซ่อมอุปกรณ์ผ่าน QR Code
          </p>
        </div>

        {/* Context card — why are we asking them to log in? */}
        {pending?.deviceName && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              คุณกำลังจะ
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {actionLabel || 'ดำเนินการต่อ'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              อุปกรณ์: {pending.deviceName}
            </p>
          </div>
        )}

        {/* Already logged in card */}
        {currentLineSession && !errorMessage && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                คุณเข้าสู่ระบบในชื่อ LINE แล้ว: {currentLineSession.displayName}
              </p>
            </div>
          </div>
        )}

        {/* Error card */}
        {errorMessage && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/30">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-600 dark:text-rose-400" />
              <div>
                <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
                  เข้าสู่ระบบไม่สำเร็จ
                </p>
                <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">
                  {errorMessage}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Login button */}
        <button
          type="button"
          onClick={startLineLogin}
          disabled={starting}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#06C755] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[#06C755]/30 transition hover:bg-[#05b04c] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {starting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              กำลังนำทางไปยัง LINE...
            </>
          ) : currentLineSession ? (
            'เข้าสู่ระบบ LINE อีกครั้ง'
          ) : (
            'เข้าสู่ระบบด้วย LINE'
          )}
        </button>

        {/* Already logged in + continue button */}
        {currentLineSession && !starting && (
          <button
            type="button"
            onClick={goBack}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            ดำเนินการต่อในชื่อ {currentLineSession.displayName}
          </button>
        )}

        {/* Privacy notice */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          <p className="font-medium text-slate-600 dark:text-slate-300">
            ข้อมูลที่จะได้รับจาก LINE:
          </p>
          <ul className="mt-2 space-y-1">
            <li>• ชื่อที่แสดง (displayName)</li>
            <li>• รูปโปรไฟล์ (pictureUrl)</li>
            <li>• LINE userId (เพื่อระบุตัวตน)</li>
          </ul>
          <p className="mt-3">
            ระบบจะไม่ขอสิทธิ์เข้าถึงเบอร์โทรศัพท์ — คุณสามารถแจ้งซ่อมได้ทันทีหลัง
            เข้าสู่ระบบ หากต้องการให้เจ้าหน้าที่ติดต่อกลับ กรุณากรอกเบอร์ในแบบฟอร์มแจ้งซ่อม
          </p>
        </div>

        {/* Footer */}
        <div className="mt-6 pb-8 text-center">
          <p className="text-xs text-slate-400">© IT Asset Management</p>
        </div>
      </div>
    </div>
  )
}
