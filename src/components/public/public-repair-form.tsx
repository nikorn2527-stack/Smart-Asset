'use client'

/**
 * public-repair-form.tsx — Multi-tier public repair form.
 *
 * Two modes (driven by `tier` prop + optional `lineSession`):
 *
 *   • Tier 1 / 2 (LINE-verified): Pre-fills `name` + LINE profile
 *     picture. Phone is shown ONLY when Tier 1 (lineSession.scopePhone
 *     is present); hidden for Tier 2.
 *
 *   • Tier 3 (anonymous): Manual fields — name (required), phone
 *     (required, Thai format 08X-XXX-XXXX), email (optional).
 *
 * Common fields:
 *   • Subject         (required, 5–100 chars)
 *   • Problem categories (multi-select via <ProblemCategorySelector>)
 *   • Description     (optional, max 1000 chars)
 *
 * Submit → POST /api/public/repairs
 *
 * Error handling (HTTP → message):
 *   • 400  → validation error or "replaced" / disposed
 *   • 403  → reporter blocked
 *   • 404  → device not found (QR stale)
 *   • 429  → rate limit (per-phone or per-IP)
 *
 * On success: render <PublicRepairSuccess> with the returned woNumber.
 */

import * as React from 'react'
import { toast } from 'sonner'
import {
  Send,
  Loader2,
  AlertCircle,
  ArrowLeft,
  User,
  Phone,
  Mail,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import {
  ProblemCategorySelector,
  type SubjectOption,
} from '@/components/itam/problem-category-selector'
import {
  PUBLIC_DEFAULT_SUBJECTS,
  buildCategoriesFromSubjects,
} from '@/lib/public-subjects'
import { PublicRepairSuccess } from './public-repair-success'

// ── Types ───────────────────────────────────────────────────────────────

export interface LineSessionProp {
  userId: string
  displayName: string
  /** Nullable: useLineSession() reads this from a cookie/JSON payload. */
  pictureUrl?: string | null
  scopePhone?: string | null
}

export interface DeviceInfoProp {
  /**
   * All fields are nullable because they mirror
   * `GET /api/public/devices/[shortId]` verbatim — a Device row may have a
   * null brand/model/location, and legacy rows can even have a null
   * assetCode/name. The render sites already guard each one
   * (`deviceInfo.location && …`), so the type must reflect the wire shape
   * rather than pretending every column is populated.
   */
  assetCode: string | null
  name: string | null
  brand?: string | null
  model?: string | null
  site: string
  location?: string | null
}

export interface PublicRepairFormProps {
  deviceShortId: string
  siteCode: string
  tier: 'line' | 'anonymous'
  /** Passed by parent if tier === 'line' (from useLineSession). */
  lineSession?: LineSessionProp | null
  /** Context display at top of form (so user knows which device). */
  deviceInfo?: DeviceInfoProp
  /** Called after successful submit. */
  onSuccess?: (data: {
    woNumber: string
    trackableUrl: string
    requiresVerification: boolean
  }) => void
  /** Cancel button — usually swaps back to the device card. */
  onCancel?: () => void
  className?: string
}

interface SubmitSuccess {
  woNumber: string
  trackableUrl: string
  requiresVerification: boolean
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Format Thai mobile: 0812345678 → 081-234-5678 (best-effort). */
function formatThaiPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  // Strip leading "66" country code → treat as 0
  let normalized = digits
  if (normalized.startsWith('66') && normalized.length === 11) {
    normalized = '0' + normalized.slice(2)
  }
  if (normalized.length > 10) normalized = normalized.slice(0, 10)
  if (normalized.length <= 3) return normalized
  if (normalized.length <= 6) return `${normalized.slice(0, 3)}-${normalized.slice(3)}`
  return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`
}

/** Validate Thai mobile (10 digits, starts with 0 + 6/8/9). */
function isValidThaiPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return /^0[689]\d{8}$/.test(digits)
}

// ── Component ───────────────────────────────────────────────────────────

export function PublicRepairForm({
  deviceShortId,
  siteCode,
  tier,
  lineSession,
  deviceInfo,
  onSuccess,
  onCancel,
  className,
}: PublicRepairFormProps) {
  const isLine = tier === 'line'
  // Tier 1 = LINE + scopePhone; Tier 2 = LINE only (no phone in scope).
  const isTier1 = isLine && !!lineSession?.scopePhone

  // ── Form state ──
  const [subject, setSubject] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [selectedSubjects, setSelectedSubjects] = React.useState<string[]>([])
  const [otherDetail, setOtherDetail] = React.useState('')

  // Tier 3 only
  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [email, setEmail] = React.useState('')

  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<SubmitSuccess | null>(null)

  // Categories (static fallback for public — /api/settings/options needs auth)
  const subjectOptions: SubjectOption[] = React.useMemo(() => PUBLIC_DEFAULT_SUBJECTS, [])
  const categories = React.useMemo(
    () => buildCategoriesFromSubjects(subjectOptions),
    [subjectOptions],
  )

  // ── Auto-compose subject from selected categories ──
  // If user selected categories, use them as the subject (joined) UNLESS they
  // typed a custom subject — typed wins.
  const composedSubject = React.useMemo(() => {
    if (selectedSubjects.length === 0) return subject
    const joined = selectedSubjects.filter((s) => s !== 'อื่นๆ (ระบุในรายละเอียด)').join(', ')
    if (joined) return joined.slice(0, 100)
    return subject
  }, [selectedSubjects, subject])

  const finalSubject = composedSubject.trim()
  const subjectValid = finalSubject.length >= 5 && finalSubject.length <= 100

  const phoneValid = isLine ? true : isValidThaiPhone(phone)
  const nameValid = isLine ? true : name.trim().length >= 2

  const canSubmit =
    subjectValid && phoneValid && nameValid && !submitting

  // ── Auto-fill from previous PublicReporter record ──
  // When the user has a LINE session, fetch their previously stored
  // profile (name, phone, email) so they don't have to re-type it on
  // subsequent submissions. Only pre-fill empty fields (don't overwrite
  // if the user has already started typing).
  const [autoFillLoaded, setAutoFillLoaded] = React.useState(false)
  React.useEffect(() => {
    if (!lineSession?.userId) {
      setAutoFillLoaded(true)
      return
    }
    let cancelled = false
    fetch(
      `/api/public/reporter/me?siteCode=${encodeURIComponent(siteCode)}`,
      { credentials: 'same-origin' },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json?.data) {
          setAutoFillLoaded(true)
          return
        }
        const data = json.data as {
          name: string | null
          phone: string | null
          email: string | null
        }
        // Only fill empty fields — don't overwrite user input.
        setName((prev) => prev || (data.name ?? ''))
        setPhone((prev) => prev || (data.phone ?? ''))
        setEmail((prev) => prev || (data.email ?? ''))
        setAutoFillLoaded(true)
      })
      .catch(() => {
        // Network error — don't block form, just proceed without autofill
        setAutoFillLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [lineSession?.userId, siteCode])

  // ── Submit handler ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) {
      if (!subjectValid) setSubmitError('หัวข้อปัญหาต้องมีอย่างน้อย 5 ตัวอักษร')
      else if (!phoneValid) setSubmitError('กรุณาระบุเบอร์โทรศัพท์ให้ถูกต้อง (08X-XXX-XXXX)')
      else if (!nameValid) setSubmitError('กรุณาระบุชื่อ-สกุล')
      return
    }
    setSubmitting(true)
    setSubmitError(null)

    // Build combined details: user description + "อื่นๆ" detail
    const detailParts: string[] = []
    if (description.trim()) detailParts.push(description.trim())
    if (
      selectedSubjects.includes('อื่นๆ (ระบุในรายละเอียด)') &&
      otherDetail.trim()
    ) {
      detailParts.push(`อาการอื่นๆ: ${otherDetail.trim()}`)
    }
    const combinedDetails = detailParts.join('\n\n')

    const body: Record<string, unknown> = {
      deviceShortId,
      siteCode,
      subject: finalSubject,
      details: combinedDetails || null,
      problemCategories: selectedSubjects,
    }

    if (isLine && lineSession) {
      body.lineUserId = lineSession.userId
      body.lineDisplayName = lineSession.displayName
      if (lineSession.pictureUrl) body.linePictureUrl = lineSession.pictureUrl
      if (lineSession.scopePhone) body.lineScopePhone = lineSession.scopePhone
    } else {
      body.name = name.trim()
      body.phone = phone.replace(/\D/g, '')
      if (email.trim()) body.email = email.trim()
    }

    try {
      const res = await fetch('/api/public/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: SubmitSuccess
        error?: string
      }

      if (res.ok && json.data) {
        setSuccess(json.data)
        toast.success('ส่งเรื่องแจ้งซ่อมสำเร็จ')
        onSuccess?.(json.data)
        return
      }

      // Error mapping
      const errMsg = json.error ?? 'ส่งเรื่องไม่สำเร็จ กรุณาลองใหม่'
      if (res.status === 404) {
        setSubmitError('ไม่พบอุปกรณ์ — กรุณาสแกน QR ใหม่อีกครั้ง')
      } else if (res.status === 403) {
        setSubmitError(errMsg)
      } else if (res.status === 429) {
        setSubmitError(errMsg)
      } else if (res.status === 400) {
        setSubmitError(errMsg)
      } else {
        setSubmitError(errMsg)
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? `เกิดข้อผิดพลาด: ${err.message}`
          : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
      )
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success state — render the success screen ──
  if (success) {
    return (
      <PublicRepairSuccess
        woNumber={success.woNumber}
        trackableUrl={success.trackableUrl}
        requiresVerification={success.requiresVerification}
        onCancel={onCancel}
        className={className}
      />
    )
  }

  // ── Form ──
  return (
    <div className={cn('mx-auto w-full max-w-md', className)}>
      <form onSubmit={handleSubmit}>
        <Card className="gap-0 overflow-hidden py-0">
          {/* ── Header ── */}
          <CardHeader className="gap-3 bg-gradient-to-br from-[#fff7ed] to-white p-4 dark:from-orange-950/30 dark:to-card">
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                className="-ml-2 h-8 px-2 text-slate-500 hover:bg-white/50 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                ย้อนกลับ
              </Button>
              <Badge
                variant="outline"
                className={cn(
                  'border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold dark:border-slate-700 dark:bg-slate-800',
                  isTier1
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : isLine
                      ? 'text-[#06C755]'
                      : 'text-slate-500 dark:text-slate-400',
                )}
              >
                {isTier1 ? (
                  <>
                    <ShieldCheck className="mr-1 h-3 w-3" />
                    ยืนยันตัวตนแล้ว
                  </>
                ) : isLine ? (
                  <>
                    <MessageCircle className="mr-1 h-3 w-3" />
                    LINE
                  </>
                ) : (
                  <>
                    <User className="mr-1 h-3 w-3" />
                    ผู้แจ้งทั่วไป
                  </>
                )}
              </Badge>
            </div>

            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              แจ้งซ่อมอุปกรณ์
            </h1>

            {deviceInfo && (
              <div className="rounded-lg border border-[#f97316]/20 bg-white p-2.5 dark:border-orange-900/40 dark:bg-slate-800/40">
                <p className="truncate font-mono text-sm font-bold text-[#ea580c] dark:text-orange-300">
                  {deviceInfo.assetCode}
                </p>
                <p className="truncate text-sm text-slate-700 dark:text-slate-200">
                  {deviceInfo.name}
                </p>
                {(deviceInfo.brand || deviceInfo.model) && (
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {[deviceInfo.brand, deviceInfo.model].filter(Boolean).join(' · ')}
                  </p>
                )}
                {deviceInfo.location && (
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {deviceInfo.location}
                  </p>
                )}
              </div>
            )}
          </CardHeader>

          <CardContent className="space-y-4 p-4">
            {/* ── Reporter section ── */}
            {isLine && lineSession ? (
              <section className="space-y-2">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <MessageCircle className="h-3.5 w-3.5" />
                  ข้อมูลผู้แจ้ง (LINE)
                </h2>
                <div className="flex items-center gap-3 rounded-lg border border-[#06C755]/30 bg-[#06C755]/5 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/10">
                  <Avatar className="h-11 w-11 border-2 border-[#06C755]/30">
                    {lineSession.pictureUrl ? (
                      <AvatarImage src={lineSession.pictureUrl} alt={lineSession.displayName} />
                    ) : null}
                    <AvatarFallback className="bg-[#06C755]/20 text-[#06C755]">
                      {lineSession.displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                      {lineSession.displayName}
                    </p>
                    {isTier1 && lineSession.scopePhone ? (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        โทร: {formatThaiPhone(lineSession.scopePhone)}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                        ยังไม่ได้ยืนยันเบอร์โทร (เจ้าหน้าที่จะติดต่อกลับ)
                      </p>
                    )}
                  </div>
                  {isTier1 && (
                    <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-500" />
                  )}
                </div>
              </section>
            ) : (
              <section className="space-y-2">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <User className="h-3.5 w-3.5" />
                  ข้อมูลผู้แจ้ง
                </h2>
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="prf-name" className="text-sm font-medium">
                      ชื่อ-สกุล <span className="text-rose-500">*</span>
                    </Label>
                    <Input
                      id="prf-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="ชื่อ นามสกุล"
                      maxLength={100}
                      required
                      autoComplete="name"
                      className="h-12 text-base"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="prf-phone" className="text-sm font-medium">
                      เบอร์โทรศัพท์ <span className="text-rose-500">*</span>
                    </Label>
                    <Input
                      id="prf-phone"
                      type="tel"
                      inputMode="tel"
                      value={phone}
                      onChange={(e) => setPhone(formatThaiPhone(e.target.value))}
                      placeholder="08X-XXX-XXXX"
                      maxLength={12}
                      required
                      autoComplete="tel"
                      className="h-12 text-base font-mono tracking-wider"
                    />
                    {phone && !phoneValid && (
                      <p className="text-xs text-rose-500">
                        เบอร์โทรไม่ถูกต้อง (ต้องเป็น 08/09/06 ตามด้วย 8 หลัก)
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="prf-email" className="text-sm font-medium">
                      อีเมล <span className="text-xs text-slate-400">(ถ้ามี)</span>
                    </Label>
                    <Input
                      id="prf-email"
                      type="email"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      maxLength={200}
                      autoComplete="email"
                      className="h-12 text-base"
                    />
                  </div>
                </div>
              </section>
            )}

            <Separator />

            {/* ── Subject ── */}
            <section className="space-y-1.5">
              <Label htmlFor="prf-subject" className="text-sm font-medium">
                หัวข้อปัญหา <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="prf-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="เช่น เครื่องพิมพ์ไม่ทำงาน"
                maxLength={100}
                required
                className="h-12 text-base"
              />
              <p className="text-right text-xs text-slate-400">
                {finalSubject.length}/100
              </p>
            </section>

            {/* ── Problem categories ── */}
            <section className="space-y-1.5">
              <Label className="text-sm font-medium">
                อาการที่พบ{' '}
                <span className="ml-1 text-[10px] font-normal text-slate-400">
                  (เลือกได้หลายหัวข้อ)
                </span>
              </Label>
              <ProblemCategorySelector
                categories={categories}
                subjectOptions={subjectOptions}
                selected={selectedSubjects}
                onChange={setSelectedSubjects}
                otherDetail={otherDetail}
                onOtherDetailChange={setOtherDetail}
              />
              {selectedSubjects.length > 0 && (
                <div className="rounded-md bg-[#fff7ed] p-2 text-xs dark:bg-orange-950/30">
                  <span className="font-medium text-[#ea580c] dark:text-orange-300">
                    เลือกแล้ว {selectedSubjects.length} หัวข้อ:
                  </span>{' '}
                  <span className="text-slate-600 dark:text-slate-300">
                    {selectedSubjects.join(', ')}
                  </span>
                </div>
              )}
            </section>

            {/* ── Description ── */}
            <section className="space-y-1.5">
              <Label htmlFor="prf-desc" className="text-sm font-medium">
                ลักษณะหน้างาน / รายละเอียดเพิ่มเติม{' '}
                <span className="text-xs text-slate-400">(ถ้ามี)</span>
              </Label>
              <Textarea
                id="prf-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="บอกลักษณะที่เห็น เช่น ติดไฟแต่ไม่พิมพ์"
                rows={4}
                maxLength={1000}
                className="min-h-24 text-base"
              />
              <p className="text-right text-xs text-slate-400">
                {description.length}/1000
              </p>
            </section>

            {/* ── Submit error ── */}
            {submitError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{submitError}</span>
              </div>
            )}

            {/* ── Privacy notice ── */}
            <p className="text-center text-[11px] text-slate-400">
              ข้อมูลของคุณจะถูกใช้เพื่อติดต่อกลับเรื่องการซ่อมบำรุงเท่านั้น
            </p>
          </CardContent>

          {/* ── Sticky submit footer ── */}
          <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <Button
              type="submit"
              size="lg"
              disabled={!canSubmit}
              className="h-12 bg-[#f97316] text-base font-semibold text-white hover:bg-[#ea580c]"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  กำลังส่งเรื่อง...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-5 w-5" />
                  ส่งเรื่องแจ้งซ่อม
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={onCancel}
              disabled={submitting}
              className="h-10 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              ยกเลิก
            </Button>
          </div>
        </Card>
      </form>
    </div>
  )
}
