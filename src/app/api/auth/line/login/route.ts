// ============================================================
// GET /api/auth/line/login
// (Task ID: PUBLIC-QR-2B-LINE-LOGIN)
// ============================================================
// Initiates LINE Login v2.1 (Web flow) for PUBLIC QR repair reporters.
//
// Flow:
//   1. Caller (typically the QR router or a "เข้าสู่ระบบด้วย LINE" button on
//      the public repair form) navigates to this URL with ?redirect=<path>.
//   2. We generate a random state, save it + the redirect target into a
//      10-min HTTP-only cookie, and 302 redirect the browser to LINE's
//      authorize endpoint.
//   3. After consent, LINE redirects to /api/auth/line/callback?code=...
//      which exchanges the code, fetches the profile, sets the
//      `line_session` cookie, and 302 redirects back to the original URL.
//
// Query params:
//   • redirect  (optional) — relative URL to return to after login.
//                            Defaults to '/'. Must start with '/'.
//
// Example:
//   GET /api/auth/line/login?redirect=/qr/d/abc123?action=repair
//
// NOTE: This is a SEPARATE channel/cookie from staff auth (/api/auth/oauth/line
// which uses AppSetting + creates real User rows). This public flow stores
// identity in a 24h `line_session` cookie that public repair endpoints read.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import {
  LINE_LOGIN_CONFIG,
  buildLineLoginUrl,
  isLineLoginConfigured,
} from '@/lib/line-login'
import { setLineStateCookie } from '@/lib/line-session'

export const dynamic = 'force-dynamic'

/** Allowlist of redirect prefixes we permit. Prevents open-redirect abuse. */
function sanitizeRedirect(raw: string | null): string {
  if (!raw) return '/'
  const trimmed = raw.trim()
  // Only allow same-origin relative URLs (must start with '/').
  // Reject protocol-relative URLs (//evil.com) and absolute URLs.
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/'
  // Also reject backslashes (browsers sometimes normalise them to '/').
  if (trimmed.startsWith('/\\')) return '/'
  // Limit length to avoid abuse.
  if (trimmed.length > 512) return '/'
  return trimmed
}

export async function GET(req: NextRequest) {
  try {
    // ── 0. Config check ──────────────────────────────────────────────
    if (!isLineLoginConfigured()) {
      return NextResponse.json(
        {
          error:
            'LINE Login ยังไม่ได้ตั้งค่า — ผู้ดูแลระบบต้องตั้งค่าตัวแปรสภาพแวดล้อม LINE_LOGIN_CHANNEL_ID และ LINE_LOGIN_CHANNEL_SECRET บน Vercel',
        },
        { status: 503 },
      )
    }

    // ── 1. Read + sanitize redirect target ──────────────────────────
    const redirect = sanitizeRedirect(req.nextUrl.searchParams.get('redirect'))

    // ── 2. Determine redirect_uri (must match what's registered in
    //        LINE Developers Console — production:
    //        https://itam-next-js.vercel.app/api/auth/line/callback)
    const origin = new URL(req.url).origin
    const redirectUri =
      LINE_LOGIN_CONFIG.redirectUri || `${origin}/api/auth/line/callback`

    // ── 3. Generate random anti-CSRF state ───────────────────────────
    // 32 hex chars = 128 bits of entropy. crypto.randomUUID is available
    // on Node 19+ and all modern browsers (used as a runtime fallback).
    const state = (crypto.randomUUID?.() ?? randomFallback()).replace(/-/g, '')

    // ── 4. Build authorize URL ───────────────────────────────────────
    const authorizeUrl = buildLineLoginUrl(state, redirectUri)

    // ── 5. Save state + redirect to a 10-min HTTP-only cookie ────────
    const res = NextResponse.redirect(authorizeUrl)
    setLineStateCookie(res, {
      state,
      redirect,
      createdAt: new Date().toISOString(),
    })
    return res
  } catch (err) {
    console.error('GET /api/auth/line/login', err)
    const message =
      err instanceof Error ? err.message : 'LINE Login init failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Fallback state generator if crypto.randomUUID is unavailable. */
function randomFallback(): string {
  try {
    const arr = new Uint8Array(16)
    const c = (globalThis as { crypto?: Crypto }).crypto
    if (c?.getRandomValues) {
      c.getRandomValues(arr)
      return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
