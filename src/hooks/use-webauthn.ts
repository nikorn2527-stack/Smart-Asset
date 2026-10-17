'use client'

import * as React from 'react'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'

export interface WebAuthnCredential {
  id: string; deviceType: string | null; name: string | null
  createdAt: string; lastUsedAt: string | null
}

export function useWebAuthn() {
  const [isSupported, setIsSupported] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    // WebAuthn requires:
    //   1. window.PublicKeyCredential (the API exists)
    //   2. navigator.credentials (the Credentials Management API)
    //   3. Secure context (HTTPS or localhost)
    const hasApi = typeof window !== 'undefined'
      && 'PublicKeyCredential' in window
      && !!navigator.credentials
    // Secure context check — WebAuthn ONLY works on HTTPS or localhost.
    // If served over plain HTTP (e.g. a preview IP without TLS), the API
    // exists but every call silently fails.
    const isSecure = typeof window !== 'undefined'
      && (window.isSecureContext || window.location.hostname === 'localhost')
    setIsSupported(hasApi && isSecure)
  }, [])

  const getToken = (): string | null => {
    // Try zustand-persisted auth store first (itam-auth key, shape: {state:{token:...}})
    try {
      const raw = localStorage.getItem('itam-auth')
      if (raw) {
        const parsed = JSON.parse(raw)
        const token = parsed?.state?.token
        if (typeof token === 'string' && token.length > 0) return token
      }
    } catch {
      // ignore parse error
    }
    // Fallback: legacy direct key (used by older auth flows)
    try {
      const t = localStorage.getItem('itam.token')
      if (t) return t
    } catch {
      // ignore
    }
    return null
  }

  async function register(name?: string) {
    if (!isSupported) { setError('เบราว์เซอร์นี้ไม่รองรับ Passkey — กรุณาใช้ Chrome/Safari/Edge บน HTTPS'); return null }
    setLoading(true); setError(null)
    try {
      // Pre-check: warn if no platform authenticator (but still allow
      // security key / cross-platform registration)
      if (window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
        const hasPlatform = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        if (!hasPlatform) {
          // Don't block — user may have a USB security key. Just warn.
          console.info('[Passkey] No platform authenticator — will try cross-platform (security key)')
        }
      }
      const token = getToken()
      const beginRes = await fetch('/api/auth/webauthn/register/begin', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name }),
      })
      if (!beginRes.ok) { const j = await beginRes.json().catch(() => ({})); throw new Error(j.error ?? 'เริ่มการลงทะเบียนล้มเหลว') }
      const { options } = await beginRes.json()
      const credential = await startRegistration({ optionsJSON: options })
      const finishRes = await fetch('/api/auth/webauthn/register/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ credential, deviceType: detectDeviceType(), name: name ?? null }),
      })
      if (!finishRes.ok) { const j = await finishRes.json().catch(() => ({})); throw new Error(j.error ?? 'ยืนยัน Passkey ล้มเหลว') }
      const result = await finishRes.json()
      return { verified: true, name: result.name }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Don't show toast if user cancelled
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('abort')) {
        setError(null)
        return null
      }
      // Friendly error messages for common failures
      let friendly = msg
      if (msg.includes('NotAllowed') || msg.includes('allowed')) {
        friendly = 'การยืนยันตัวตนถูกปฏิเสธ — อาจเป็นเพราะเบราว์เซอร์ไม่มี authenticator หรือคุณปฏิเสธการยืนยัน. ลองใช้ Chrome/Safari บนมือถือ หรือเสียบ security key.'
      } else if (msg.includes('InvalidState') || msg.includes('already registered')) {
        friendly = 'อุปกรณ์นี้ลงทะเบียนไว้แล้ว — ลอง login ด้วย Passkey แทน'
      } else if (msg.includes('Abort')) {
        friendly = 'การลงทะเบียนถูกยกเลิก'
      }
      setError(friendly)
      return null
    } finally { setLoading(false) }
  }

  async function login(email: string) {
    if (!isSupported) { setError('เบราว์เซอร์นี้ไม่รองรับ Passkey'); return null }
    setLoading(true); setError(null)
    try {
      const beginRes = await fetch('/api/auth/webauthn/login/begin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!beginRes.ok) { const j = await beginRes.json().catch(() => ({})); throw new Error(j.error ?? 'เริ่มการยืนยันตัวตนล้มเหลว') }
      const { options } = await beginRes.json()
      const credential = await startAuthentication({ optionsJSON: options })
      const finishRes = await fetch('/api/auth/webauthn/login/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, credential }),
      })
      if (!finishRes.ok) { const j = await finishRes.json().catch(() => ({})); throw new Error(j.error ?? 'ยืนยัน Passkey ล้มเหลว') }
      return await finishRes.json()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.toLowerCase().includes('cancel') && !msg.toLowerCase().includes('abort')) setError(msg)
      return null
    } finally { setLoading(false) }
  }

  async function listCredentials(): Promise<WebAuthnCredential[]> {
    const token = getToken(); if (!token) return []
    const res = await fetch('/api/auth/webauthn/credentials', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return []
    return (await res.json()).credentials ?? []
  }

  async function removeCredential(id: string) {
    const token = getToken(); if (!token) return false
    const res = await fetch(`/api/auth/webauthn/credentials?id=${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  }

  return { isSupported, loading, error, register, login, listCredentials, removeCredential, clearError: () => setError(null) }
}

function detectDeviceType(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'ios-touchid-faceid'
  if (/mac/.test(ua)) return 'macos-touchid'
  if (/windows/.test(ua)) return 'windows-hello'
  if (/android/.test(ua)) return 'android-fingerprint'
  return 'webauthn'
}
