'use client'

/**
 * oauth-section.tsx — OAuth / External login settings.
 *
 * Lets the admin configure credentials for 3 external login providers so the
 * login page can show the buttons:
 *   - Google  (Client ID + Secret + Redirect URL)
 *   - LINE    (Channel ID + Secret + Redirect URL)
 *   - Telegram (Bot Token — used by the Telegram Login Widget)
 *
 * All values are stored as AppSetting rows via PUT /api/settings (object
 * upsert). Keys: oauth_google_client_id, oauth_google_client_secret,
 * oauth_google_redirect_url, oauth_line_channel_id,
 * oauth_line_channel_secret, oauth_line_redirect_url,
 * oauth_telegram_bot_token.
 *
 * Note: actual OAuth flow requires the admin to:
 *   1. Register an app at the provider's console
 *   2. Set the redirect URL to:
 *      https://itam-next-js-png-team.vercel.app/api/auth/oauth/{provider}/callback
 *   3. Paste the credentials here and Save
 *
 * Once saved, the login page (/api/auth/oauth/status) will report the
 * provider as "configured" and the buttons will be enabled.
 */

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { KeyRound, CheckCircle2, XCircle, Save, RefreshCw, ExternalLink } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'

const REDIRECT_BASE =
  typeof window !== 'undefined'
    ? `${window.location.origin}/api/auth/oauth`
    : 'https://itam-next-js-png-team.vercel.app/api/auth/oauth'

const GOOGLE_REDIRECT = `${REDIRECT_BASE}/google/callback`
const LINE_REDIRECT = `${REDIRECT_BASE}/line/callback`

interface OAuthSettings {
  oauth_google_client_id: string
  oauth_google_client_secret: string
  oauth_google_redirect_url: string
  oauth_line_channel_id: string
  oauth_line_channel_secret: string
  oauth_line_redirect_url: string
  oauth_telegram_bot_token: string
}

const EMPTY: OAuthSettings = {
  oauth_google_client_id: '',
  oauth_google_client_secret: '',
  oauth_google_redirect_url: GOOGLE_REDIRECT,
  oauth_line_channel_id: '',
  oauth_line_channel_secret: '',
  oauth_line_redirect_url: LINE_REDIRECT,
  oauth_telegram_bot_token: '',
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

export function OauthSection() {
  const qc = useQueryClient()
  // BUG-SETTINGS-012 fix: controlled Tabs with state + onClick fallback.
  // Radix Tabs 1.1.13 has a known issue where click events don't fire
  // reliably in some contexts (Dialog, Portal, SSR hydration). Using
  // a controlled value + onClick handler on each TabsTrigger is the
  // proven fix pattern (same as BUG-METER-004 / BUG-PAPER-001).
  const [providerTab, setProviderTab] = React.useState('google')
  const { data, isLoading } = useQuery<Record<string, string>>({
    queryKey: ['oauth-settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings')
      if (!res.ok) return {}
      const j = await res.json()
      return (j.settings ?? {}) as Record<string, string>
    },
  })

  const [form, setForm] = React.useState<OAuthSettings>(EMPTY)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!data) return
    setForm({
      oauth_google_client_id: data.oauth_google_client_id ?? '',
      oauth_google_client_secret: data.oauth_google_client_secret ?? '',
      oauth_google_redirect_url:
        data.oauth_google_redirect_url || GOOGLE_REDIRECT,
      oauth_line_channel_id: data.oauth_line_channel_id ?? '',
      oauth_line_channel_secret: data.oauth_line_channel_secret ?? '',
      oauth_line_redirect_url: data.oauth_line_redirect_url || LINE_REDIRECT,
      oauth_telegram_bot_token: data.oauth_telegram_bot_token ?? '',
    })
  }, [data])

  function set<K extends keyof OAuthSettings>(k: K, v: string) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'บันทึกไม่สำเร็จ')
      }
      toast.success('บันทึกการตั้งค่า OAuth แล้ว')
      await qc.invalidateQueries({ queryKey: ['oauth-settings'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return <Skeleton className="h-96 w-full rounded-lg" />
  }

  return (
    <div className="space-y-4">
      <Card className="border-amber-200/60 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/10">
        <CardContent className="p-4">
          <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <div className="font-semibold">วิธีตั้งค่า OAuth Login</div>
              <ol className="list-decimal space-y-0.5 pl-4 text-xs">
                <li>สมัคร App ที่ Console ของผู้ให้บริการ (Google / LINE / Telegram)</li>
                <li>ตั้งค่า <span className="font-mono">Authorized Redirect URI</span> ตามที่ระบบแสดงด้านล่าง</li>
                <li>นำ Client ID / Secret / Bot Token มาวางในฟอร์มด้านล่าง แล้วกดบันทึก</li>
                <li>ปุ่มเข้าสู่ระบบของผู้ให้บริการจะปรากฏในหน้า Login ทันที</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BUG-SETTINGS-012 fix: controlled Tabs + onClick fallback on triggers */}
      <Tabs value={providerTab} onValueChange={setProviderTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-flex">
          <TabsTrigger value="google" className="gap-1.5" onClick={() => setProviderTab('google')}>
            <span>🔴</span>
            <span className="hidden sm:inline">Google</span>
          </TabsTrigger>
          <TabsTrigger value="line" className="gap-1.5" onClick={() => setProviderTab('line')}>
            <span>🟢</span>
            <span className="hidden sm:inline">LINE</span>
          </TabsTrigger>
          <TabsTrigger value="telegram" className="gap-1.5" onClick={() => setProviderTab('telegram')}>
            <span>🔵</span>
            <span className="hidden sm:inline">Telegram</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="google" className="mt-4">
          <ProviderCard
            title="Google (Gmail)"
            emoji="🔴"
            instructions={[
              'ไปที่ https://console.cloud.google.com/apis/credentials',
              'สร้าง OAuth 2.0 Client ID (Web application)',
              'เพิ่ม Authorized Redirect URI ตามที่แสดงด้านล่าง',
            ]}
            docsUrl="https://console.cloud.google.com/apis/credentials"
            configured={Boolean(form.oauth_google_client_id && form.oauth_google_client_secret)}
            fields={
              <>
                <FieldInput
                  label="Client ID"
                  value={form.oauth_google_client_id}
                  onChange={(v) => set('oauth_google_client_id', v)}
                  placeholder="123456789-abc.apps.googleusercontent.com"
                  mono
                />
                <FieldInput
                  label="Client Secret"
                  value={form.oauth_google_client_secret}
                  onChange={(v) => set('oauth_google_client_secret', v)}
                  placeholder="GOCSPX-xxxxxxxxxxxxx"
                  mono
                  type="password"
                />
                <FieldInput
                  label="Redirect URL"
                  value={form.oauth_google_redirect_url}
                  onChange={(v) => set('oauth_google_redirect_url', v)}
                  placeholder={GOOGLE_REDIRECT}
                  mono
                  readOnly
                  hint="ตั้งค่า URL นี้ใน Google Console → Authorized Redirect URIs"
                />
              </>
            }
          />
        </TabsContent>

        <TabsContent value="line" className="mt-4">
          <ProviderCard
            title="LINE"
            emoji="🟢"
            instructions={[
              'ไปที่ https://developers.line.biz/console/',
              'สร้าง LINE Login Channel (provider type: web)',
              'ตั้งค่า Callback URL ตามที่แสดงด้านล่าง',
            ]}
            docsUrl="https://developers.line.biz/console/"
            configured={Boolean(form.oauth_line_channel_id && form.oauth_line_channel_secret)}
            fields={
              <>
                <FieldInput
                  label="Channel ID"
                  value={form.oauth_line_channel_id}
                  onChange={(v) => set('oauth_line_channel_id', v)}
                  placeholder="1234567890"
                  mono
                />
                <FieldInput
                  label="Channel Secret"
                  value={form.oauth_line_channel_secret}
                  onChange={(v) => set('oauth_line_channel_secret', v)}
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                  mono
                  type="password"
                />
                <FieldInput
                  label="Redirect URL (Callback)"
                  value={form.oauth_line_redirect_url}
                  onChange={(v) => set('oauth_line_redirect_url', v)}
                  placeholder={LINE_REDIRECT}
                  mono
                  readOnly
                  hint="ตั้งค่า URL นี้ใน LINE Console → Callback URL"
                />
              </>
            }
          />
        </TabsContent>

        <TabsContent value="telegram" className="mt-4">
          <ProviderCard
            title="Telegram"
            emoji="🔵"
            instructions={[
              'คุยกับ @BotFather → /newbot สร้าง Bot ใหม่',
              'ตั้งค่า Login Widget domain กับ @BotFather ด้วยคำสั่ง /setdomain',
              'วาง Bot Token ด้านล่าง — ระบบจะ render Telegram Login Widget ในหน้า Login',
            ]}
            docsUrl="https://core.telegram.org/bots/tutorial#obtain-your-bot-token"
            configured={Boolean(form.oauth_telegram_bot_token)}
            fields={
              <>
                <FieldInput
                  label="Bot Token"
                  value={form.oauth_telegram_bot_token}
                  onChange={(v) => set('oauth_telegram_bot_token', v)}
                  placeholder="123456789:ABC-DEF..."
                  mono
                  type="password"
                />
                <div className="sm:col-span-2">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    💡 Telegram Login Widget ต้องการการตั้งค่า domain ที่ @BotFather
                    — domain ของระบบนี้คือ <span className="font-mono">{typeof window !== 'undefined' ? window.location.hostname : 'itam-next-js-png-team.vercel.app'}</span>
                  </p>
                </div>
              </>
            }
          />
        </TabsContent>
      </Tabs>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          บันทึกการตั้งค่า OAuth
        </Button>
        <Button
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ['oauth-settings'] })}
          className="dark:bg-slate-800 dark:border-slate-700"
        >
          <RefreshCw className="h-4 w-4" /> รีเฟรช
        </Button>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────

function ProviderCard({
  title,
  emoji,
  instructions,
  docsUrl,
  configured,
  fields,
}: {
  title: string
  emoji: string
  instructions: string[]
  docsUrl: string
  configured: boolean
  fields: React.ReactNode
}) {
  return (
    <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <span>{emoji}</span>
            {title}
          </span>
          {configured ? (
            <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="mr-1 h-3 w-3" /> ตั้งค่าแล้ว
            </Badge>
          ) : (
            <Badge className="border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <XCircle className="mr-1 h-3 w-3" /> ยังไม่ตั้งค่า
            </Badge>
          )}
        </CardTitle>
        <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-slate-500 dark:text-slate-400">
          {instructions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#f97316] hover:underline dark:text-[#fb923c]"
        >
          เปิด Console <ExternalLink className="h-3 w-3" />
        </a>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{fields}</div>
      </CardContent>
    </Card>
  )
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
  type = 'text',
  readOnly,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  type?: 'text' | 'password'
  readOnly?: boolean
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        onClick={readOnly ? (e) => (e.target as HTMLInputElement).select() : undefined}
        className={`h-9 dark:bg-slate-800 dark:border-slate-700 ${mono ? 'font-mono text-xs' : ''} ${
          readOnly ? 'bg-slate-50 text-slate-500 dark:bg-slate-800/50' : ''
        }`}
      />
      {hint && <p className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  )
}
