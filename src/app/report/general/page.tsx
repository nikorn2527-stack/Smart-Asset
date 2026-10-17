'use client'

export const dynamic = 'force-dynamic'

/**
 * /report/general — Public "no QR needed" repair form.
 *
 * Lets a user (typically a LINE user who messaged the OA) search for
 * their device by assetCode or serialNumber and submit a repair
 * request via the same PublicReporter verification pipeline used by
 * the Smart QR scan flow.
 *
 * Flow:
 *   1. User types a code → GET /api/public/devices/lookup?code=...
 *   2. If 1 match → auto-select + show device info + "แจ้งซ่อมอุปกรณ์นี้"
 *      button → opens <PublicRepairForm>.
 *   3. If multiple matches → show list (brand/model/building) → click
 *      one → opens form.
 *   4. If 0 matches → friendly "not found" message.
 *   5. If user has a LINE session → form is tier='line' (auto-fill name,
 *      possibly phone via scope). Otherwise tier='anonymous' (manual
 *      name + phone).
 *
 * Works in both LINE in-app browser and regular browsers.
 * Mobile-first layout — same max-w-md container as the QR page.
 */

import * as React from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Search,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Wrench,
  ScanLine,
  ArrowRight,
  MapPin,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  PublicRepairForm,
  type PublicRepairFormProps,
} from '@/components/public/public-repair-form'
import { useLineSession } from '@/hooks/use-line-session'

// ── Types ───────────────────────────────────────────────────────────────

interface DeviceMatch {
  shortId: string
  assetCode: string
  name: string | null
  brand: string | null
  model: string | null
  type: string | null
  site: string | null
  building: string | null
  floor: string | null
  room: string | null
  location: string | null
  department: string | null
  assetSiteCode: string | null
  displayLabel: string | null
  replaced: boolean
}

interface LookupResponse {
  data: {
    matches: DeviceMatch[]
    count: number
    query: { code: string; siteCode: string | null }
  }
}

type Step =
  | { kind: 'search' }
  | { kind: 'list'; matches: DeviceMatch[]; code: string }
  | { kind: 'form'; device: DeviceMatch; tier: 'line' | 'anonymous' }
  | {
      kind: 'success'
      data: { woNumber: string; trackableUrl: string; requiresVerification: boolean }
    }

// ── Page wrapper (Suspense boundary for useSearchParams) ────────────────

export default function ReportGeneralPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
          <Loader2 className="h-12 w-12 animate-spin text-[#f97316]" />
        </div>
      }
    >
      <ReportGeneralInner />
    </React.Suspense>
  )
}

function ReportGeneralInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { session: lineSession, loading: lineLoading } = useLineSession()

  // ── State ──
  // Initialize from URL search params so the input is pre-filled when
  // the user lands via /report/general?code=IT-001&siteCode=PPIT (e.g.
  // when the LINE OA sends a deep link). Lazy initializer runs once on
  // first render — no setState-in-effect needed.
  const [code, setCode] = React.useState(() => searchParams.get('code') ?? '')
  const [siteCode, setSiteCode] = React.useState(
    () => searchParams.get('siteCode') ?? '',
  )
  const [searching, setSearching] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [step, setStep] = React.useState<Step>({ kind: 'search' })

  // Track whether the initial URL-driven search has fired so we don't
  // re-trigger it on every render (e.g. when searchParams updates after
  // navigation). This is a guard, not state used for rendering.
  const initialSearchFiredRef = React.useRef(false)

  // ── Pre-fill code from query string (?code=IT-001&siteCode=PPIT) ──
  // Useful when the LINE OA sends a /report/general?code=... link or
  // when the user clicks "แจ้งซ่อมไม่ระบุเครื่อง" and types the code
  // before arriving. Auto-triggers a search if `code` is present.
  React.useEffect(() => {
    if (initialSearchFiredRef.current) return
    const qCode = searchParams.get('code')
    if (!qCode) return
    initialSearchFiredRef.current = true
    const qSite = searchParams.get('siteCode') ?? ''
    // Defer to next tick so state is committed before runSearch reads it
    const t = setTimeout(() => runSearch(qCode, qSite), 0)
    return () => clearTimeout(t)
  }, [searchParams, runSearch])

  // ── Search handler ──
  async function runSearch(rawCode: string, rawSite: string) {
    const trimmed = rawCode.trim()
    if (!trimmed) {
      setError('กรุณาระบุรหัสทรัพย์สิน หรือ เลขซีเรียล')
      return
    }
    setSearching(true)
    setError(null)
    try {
      const params = new URLSearchParams({ code: trimmed })
      if (rawSite.trim()) params.set('siteCode', rawSite.trim().toUpperCase())
      const res = await fetch(
        `/api/public/devices/lookup?${params.toString()}`,
        { cache: 'no-store' },
      )
      const json = (await res.json().catch(() => ({}))) as LookupResponse | { error?: string }
      if (!res.ok) {
        const errMsg =
          (json as { error?: string }).error ?? `เกิดข้อผิดพลาด (${res.status})`
        if (res.status === 429) {
          setError(errMsg)
        } else if (res.status === 400) {
          setError(errMsg)
        } else {
          setError(errMsg)
        }
        setStep({ kind: 'search' })
        return
      }
      const matches = (json as LookupResponse).data.matches
      if (matches.length === 0) {
        setStep({ kind: 'list', matches: [], code: trimmed })
      } else if (matches.length === 1) {
        // Auto-select the single match → go straight to form
        setStep({
          kind: 'form',
          device: matches[0],
          tier: lineSession ? 'line' : 'anonymous',
        })
      } else {
        setStep({ kind: 'list', matches, code: trimmed })
      }
    } catch (err) {
      console.error('[/report/general] lookup failed:', err)
      setError(
        err instanceof Error
          ? `เกิดข้อผิดพลาด: ${err.message}`
          : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้',
      )
    } finally {
      setSearching(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    runSearch(code, siteCode)
  }

  // ── Form props (when step is 'form') ──
  const formProps: PublicRepairFormProps | null =
    step.kind === 'form'
      ? {
          deviceShortId: step.device.shortId,
          siteCode: step.device.site ?? step.device.assetSiteCode ?? 'UNKNOWN',
          tier: step.tier,
          lineSession: lineSession
            ? {
                userId: lineSession.userId,
                displayName: lineSession.displayName,
                pictureUrl: lineSession.pictureUrl ?? undefined,
                scopePhone: lineSession.scopePhone ?? undefined,
              }
            : null,
          deviceInfo: {
            assetCode: step.device.assetCode,
            name: step.device.name ?? step.device.assetCode,
            brand: step.device.brand ?? undefined,
            model: step.device.model ?? undefined,
            site: step.device.site ?? step.device.assetSiteCode ?? '',
            location:
              [step.device.building, step.device.location, step.device.department]
                .filter(Boolean)
                .join(' • ') || undefined,
          },
          onSuccess: (data) => setStep({ kind: 'success', data }),
          onCancel: () => setStep({ kind: 'search' }),
        }
      : null

  // ── Render: success ──
  if (step.kind === 'success') {
    return (
      <PageShell title="ส่งเรื่องแจ้งซ่อมสำเร็จ">
        <Card className="gap-0 py-0">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
              <Wrench className="h-8 w-8 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                ส่งเรื่องแจ้งซ่อมสำเร็จ
              </h2>
              <p className="mt-1 font-mono text-2xl font-bold text-[#f97316]">
                {step.data.woNumber}
              </p>
            </div>
            {step.data.requiresVerification ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                ระบบบันทึกคำขอแล้ว — กรุณารอเจ้าหน้าที่ติดต่อกลับเพื่อยืนยันตัวตน
              </p>
            ) : (
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                คำขอได้รับการยืนยันแล้ว ติดตามสถานะได้ที่ปุ่มด้านล่าง
              </p>
            )}
            <div className="flex w-full flex-col gap-2">
              <Button
                type="button"
                className="w-full bg-[#f97316] hover:bg-[#ea580c]"
                onClick={() =>
                  router.push(step.data.trackableUrl)
                }
              >
                ติดตามสถานะ
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setCode('')
                  setSiteCode('')
                  setError(null)
                  setStep({ kind: 'search' })
                }}
              >
                แจ้งซ่อมเครื่องอื่น
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    )
  }

  // ── Render: form ──
  if (step.kind === 'form' && formProps) {
    return (
      <PageShell
        title="แจ้งซ่อมอุปกรณ์"
        onBack={() => setStep({ kind: 'search' })}
      >
        {/* Tier switcher (only show if lineSession loaded) */}
        {!lineLoading && lineSession && step.tier === 'anonymous' && (
          <div className="mb-3 rounded-lg border border-[#06C755]/30 bg-[#06C755]/5 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/10">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              คุณล็อกอินด้วย LINE อยู่ —{' '}
              <button
                type="button"
                onClick={() => setStep({ ...step, tier: 'line' })}
                className="font-semibold text-[#06C755] underline"
              >
                สลับเป็นแจ้งซ่อมด้วย LINE
              </button>
            </p>
          </div>
        )}
        {!lineLoading && !lineSession && step.tier === 'line' && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              ยังไม่ได้ล็อกอิน LINE — คุณสามารถ{' '}
              <button
                type="button"
                onClick={() => setStep({ ...step, tier: 'anonymous' })}
                className="font-semibold text-amber-900 underline dark:text-amber-100"
              >
                แจ้งซ่อมด้วยเบอร์มือถือแทน
              </button>
            </p>
          </div>
        )}

        {/* Form — reuses the same component as the QR scan flow */}
        <PublicRepairForm {...formProps} />

        {/* Tier switch button (always available at the bottom) */}
        <div className="mt-3 flex justify-center">
          {step.tier === 'line' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep({ ...step, tier: 'anonymous' })}
              className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              สลับเป็นแจ้งซ่อมด้วยเบอร์มือถือ
            </Button>
          ) : (
            !lineLoading &&
            lineSession && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep({ ...step, tier: 'line' })}
                className="text-[#06C755] hover:text-[#05a045]"
              >
                สลับเป็นแจ้งซ่อมด้วย LINE
              </Button>
            )
          )}
        </div>
      </PageShell>
    )
  }

  // ── Render: list (0 or many matches) ──
  if (step.kind === 'list') {
    return (
      <PageShell
        title="แจ้งซ่อมอุปกรณ์"
        onBack={() => setStep({ kind: 'search' })}
      >
        {step.matches.length === 0 ? (
          <Card className="gap-0 py-0">
            <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950">
                <AlertCircle className="h-8 w-8 text-rose-600 dark:text-rose-300" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  ไม่พบอุปกรณ์
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  ไม่พบอุปกรณ์ที่ตรงกับ{' '}
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    &quot;{step.code}&quot;
                  </span>
                  {siteCode.trim() && (
                    <>
                      {' '}
                      ที่สาขา{' '}
                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                        {siteCode.trim().toUpperCase()}
                      </span>
                    </>
                  )}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  ลองตรวจสอบรหัสอีกครั้ง หรือติดต่อเจ้าหน้าที่
                </p>
              </div>
              <div className="flex w-full flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setStep({ kind: 'search' })}
                >
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  ค้นหาใหม่
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-[#06C755] hover:bg-[#06C755]/10"
                  onClick={() => {
                    // User can't find their device → ask staff
                    toast.info(
                      'กรุณาติดต่อเจ้าหน้าที่ IT เพื่อตรวจสอบรหัสอุปกรณ์',
                    )
                  }}
                >
                  ติดต่อเจ้าหน้าที่
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="px-1">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                พบ{' '}
                <span className="font-bold text-slate-800 dark:text-slate-100">
                  {step.matches.length}
                </span>{' '}
                อุปกรณ์ที่ตรงกับ{' '}
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                  &quot;{step.code}&quot;
                </span>{' '}
                — เลือกอุปกรณ์ที่ต้องการแจ้งซ่อม:
              </p>
            </div>
            {step.matches.map((d) => (
              <DeviceMatchCard
                key={d.shortId}
                device={d}
                onSelect={() =>
                  setStep({
                    kind: 'form',
                    device: d,
                    tier: lineSession ? 'line' : 'anonymous',
                  })
                }
              />
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setStep({ kind: 'search' })}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              ค้นหาใหม่
            </Button>
          </div>
        )}
      </PageShell>
    )
  }

  // ── Render: search (default) ──
  return (
    <PageShell title="แจ้งซ่อมอุปกรณ์">
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="gap-3 bg-gradient-to-br from-[#fff7ed] to-white p-4 dark:from-orange-950/30 dark:to-card">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f97316]/10">
              <Wrench className="h-5 w-5 text-[#f97316]" />
            </div>
            <div>
              <CardTitle className="text-base text-slate-800 dark:text-slate-100">
                ค้นหาอุปกรณ์
              </CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ไม่ต้องสแกน QR — พิมพ์รหัสที่ติดอยู่บนเครื่อง
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="code">
                รหัสทรัพย์สิน หรือ เลขซีเรียล <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="เช่น IT-00001 หรือ PHCFD06265"
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono"
                aria-label="รหัสทรัพย์สิน หรือ เลขซีเรียล"
              />
              <p className="text-[11px] text-slate-400">
                ดูรหัสได้จากสติกเกอร์ที่ติดบนตัวเครื่อง หรือใบรับประกัน
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="siteCode" className="text-xs text-slate-500">
                รหัสสาขา (ถ้าทราบ — เพื่อกรองเฉพาะอุปกรณ์ในสาขา)
              </Label>
              <Input
                id="siteCode"
                value={siteCode}
                onChange={(e) => setSiteCode(e.target.value)}
                placeholder="เช่น PPIT"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono"
                aria-label="รหัสสาขา"
              />
            </div>
            <Button
              type="submit"
              disabled={searching || !code.trim()}
              className="w-full bg-[#f97316] hover:bg-[#ea580c]"
            >
              {searching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              ค้นหาอุปกรณ์
            </Button>
          </form>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
              {error}
            </div>
          )}

          {/* Tip: prefer scanning if possible */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
              <ScanLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
              <span>
                หากอุปกรณ์มีสติกเกอร์ QR — สแกน QR ด้วยกล้องโทรศัพท์
                จะเร็วและแม่นยำกว่าการพิมพ์รหัส
              </span>
            </p>
          </div>

          {/* LINE session indicator */}
          <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
            {lineLoading ? (
              <p className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                กำลังตรวจสอบสถานะ LINE...
              </p>
            ) : lineSession ? (
              <p className="flex items-center gap-2 text-xs text-[#06C755]">
                <span className="inline-block h-2 w-2 rounded-full bg-[#06C755]" />
                ล็อกอิน LINE แล้วในชื่อ &quot;{lineSession.displayName}&quot; —
                แบบฟอร์มจะกรอกชื่อและเบอร์ให้อัตโนมัติ
              </p>
            ) : (
              <p className="flex flex-col gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>ยังไม่ได้ล็อกอิน LINE — ต้องกรอกชื่อและเบอร์เอง</span>
                <a
                  href={`/api/auth/line/login?redirect=${encodeURIComponent(
                    typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/report/general',
                  )}`}
                  className="inline-flex w-fit items-center gap-1 rounded-md border border-[#06C755]/30 bg-[#06C755]/5 px-3 py-1.5 font-semibold text-[#06C755] hover:bg-[#06C755]/10"
                >
                  เข้าสู่ระบบด้วย LINE
                  <ArrowRight className="h-3 w-3" />
                </a>
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </PageShell>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────

function DeviceMatchCard({
  device,
  onSelect,
}: {
  device: DeviceMatch
  onSelect: () => void
}) {
  const locationParts = [
    device.building,
    device.floor ? `ชั้น ${device.floor}` : null,
    device.room ? `ห้อง ${device.room}` : null,
    device.location,
    device.department,
  ].filter(Boolean)

  return (
    <Card
      className="cursor-pointer gap-0 py-0 transition-colors hover:border-[#f97316]/40 hover:bg-orange-50/50 dark:hover:bg-orange-950/10"
      onClick={onSelect}
    >
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-950">
          <Wrench className="h-5 w-5 text-orange-600 dark:text-orange-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-[#ea580c] dark:text-orange-300">
              {device.assetCode}
            </span>
            {device.replaced && (
              <Badge
                variant="outline"
                className="border-rose-200 bg-rose-100 px-1.5 py-0 text-[9px] text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
              >
                เปลี่ยนเครื่องแล้ว
              </Badge>
            )}
          </div>
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            {device.name ?? '—'}
          </p>
          {(device.brand || device.model) && (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {[device.brand, device.model].filter(Boolean).join(' · ')}
            </p>
          )}
          {locationParts.length > 0 && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-400">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              {locationParts.join(' • ')}
            </p>
          )}
        </div>
        <ArrowRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
      </CardContent>
    </Card>
  )
}

function PageShell({
  title,
  onBack,
  children,
}: {
  title: string
  onBack?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="ย้อนกลับ"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">
          {title}
        </h1>
      </header>
      <main className="mx-auto max-w-md px-3 py-4 sm:py-6">{children}</main>
    </div>
  )
}
