'use client'

/**
 * MobileAccount — mobile-friendly Passkey management.
 *
 * Allows users to register Passkey (fingerprint/Face ID/security key)
 * directly from mobile mode — no need to switch to desktop settings.
 *
 * This is a simplified version of MyBiometricsSection (from itam-settings.tsx)
 * optimized for mobile screens (larger touch targets, simpler layout).
 */

import * as React from 'react'
import { useWebAuthn } from '@/hooks/use-webauthn'
import { Fingerprint, Plus, Trash2, Loader2, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useLang } from '@/store/i18n-store'

interface WebAuthnCredential {
  id: string
  deviceType: string | null
  name: string | null
  createdAt: string
  lastUsedAt: string | null
}

export function MobileAccount() {
  const { isSupported, register, listCredentials, removeCredential, loading, error } = useWebAuthn()
  const [credentials, setCredentials] = React.useState<WebAuthnCredential[]>([])
  const [refreshing, setRefreshing] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const { lang } = useLang()

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await listCredentials()
      setCredentials(list)
    } finally {
      setRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  async function handleRegister() {
    const result = await register(newName.trim() || undefined)
    if (result?.verified) {
      toast.success(`ลงทะเบียน "${result.name ?? 'Passkey'}" สำเร็จ`)
      setNewName('')
      refresh()
    } else if (error) {
      toast.error(error)
    }
  }

  async function handleRemove(id: string, name: string | null) {
    if (!confirm(`ยืนยันลบ Passkey "${name ?? 'ลายนิ้วมือ'}" ?`)) return
    const ok = await removeCredential(id)
    if (ok) {
      toast.success('ลบ Passkey เรียบร้อย')
      refresh()
    } else {
      toast.error('ลบไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-4 px-3 pb-24 sm:px-4">
      <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950/30">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-orange-700 dark:text-orange-300">
          <Fingerprint className="h-5 w-5" />
          Passkey ของฉัน
        </h2>
        <p className="mt-1 text-sm text-orange-600/80 dark:text-orange-400/80">
          ลงทะเบียนลายนิ้วมือ/ใบหน้าของมือถือเครื่องนี้ เพื่อ login ครั้งต่อไปโดยไม่ต้องกรอก password
        </p>
      </div>

      {!isSupported ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-5 w-5" />
            ไม่รองรับ Passkey
          </p>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            กรุณาใช้ Safari (iPhone) หรือ Chrome (Android) และเปิดผ่าน HTTPS
          </p>
        </div>
      ) : (
        <>
          {/* Register new */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
              ชื่อเล่น (เช่น &quot;iPhone ของผม&quot;)
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                placeholder="ตั้งชื่อเครื่องนี้"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={50}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={handleRegister}
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 text-white transition hover:bg-orange-600 disabled:opacity-50 sm:w-auto"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                <span className="font-medium">ลงทะเบียน</span>
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              หลังกดปุ่ม เบราว์เซอร์จะถามยืนยันลายนิ้วมือ/ใบหน้า ทำตามขั้นตอนบนหน้าจอ
            </p>
            {error && (
              <div className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* List registered */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Passkey ที่ลงทะเบียน ({credentials.length})
              </h3>
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400"
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
            </div>
            {credentials.length === 0 ? (
              <div className="py-6 text-center">
                <Fingerprint className="mx-auto mb-2 h-10 w-10 text-slate-300 dark:text-slate-400" />
                <p className="text-sm text-slate-500 dark:text-slate-400">ยังไม่ได้ลงทะเบียน Passkey</p>
              </div>
            ) : (
              <div className="space-y-2">
                {credentials.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {c.name ?? 'Passkey'}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {c.deviceType ?? 'webauthn'} · {new Date(c.createdAt).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(c.id, c.name)}
                      className="rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      aria-label="ลบ"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Help */}
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/30 dark:text-slate-400">
            <p className="font-medium">💡 วิธีใช้งาน:</p>
            <ol className="mt-1 ml-4 list-decimal space-y-0.5">
              <li>ลงทะเบียน Passkey ของมือถือเครื่องนี้ (ด้านบน)</li>
              <li>ครั้งต่อไปที่ login — กรอก email แล้วกด &quot;เข้าสู่ระบบด้วย Passkey&quot;</li>
              <li>เบราว์เซอร์จะถามยืนยันลายนิ้วมือ ไม่ต้องกรอก password</li>
            </ol>
          </div>
        </>
      )}
    </div>
  )
}
