'use client'

/**
 * public-repair-success.tsx — Success screen shown after a public repair
 * submission succeeds.
 *
 * Shows:
 *   ✅ icon (large, animated)
 *   "ส่งเรื่องแจ้งซ่อมสำเร็จ"
 *   woNumber (large monospace) — easy to copy/read back to staff
 *   Status badge:
 *     PENDING          → "รอดำเนินการ"          (green — auto-verified)
 *     PENDING_REVIEW   → "รอเจ้าหน้าที่ติดต่อกลับ" (amber — needs review)
 *   If requiresVerification: amber notice explaining staff will call back
 *   Tracking button: "ติดตามสถานะ" → /wo/[woNumber]
 *   "ปิดหน้าต่าง" button (calls onCancel or window.close())
 */

import * as React from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  ExternalLink,
  X,
  PhoneCall,
  Copy,
  Check,
} from 'lucide-react'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ── Types ───────────────────────────────────────────────────────────────

export interface PublicRepairSuccessProps {
  /** WorkOrder number (also used as trackableUrl slug). */
  woNumber: string
  /** Tracking URL — usually `/wo/<woNumber>`. */
  trackableUrl: string
  /** True if WO is in PENDING_REVIEW (Tier 2/3). False if PENDING (Tier 1). */
  requiresVerification?: boolean
  /** Called when user taps "ปิดหน้าต่าง". */
  onCancel?: () => void
  className?: string
}

// ── Component ───────────────────────────────────────────────────────────

export function PublicRepairSuccess({
  woNumber,
  trackableUrl,
  requiresVerification = false,
  onCancel,
  className,
}: PublicRepairSuccessProps) {
  const [copied, setCopied] = React.useState(false)

  const statusBadgeClass = requiresVerification
    ? 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
    : 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'

  const statusLabel = requiresVerification
    ? 'รอเจ้าหน้าที่ติดต่อกลับ'
    : 'รอดำเนินการ'

  async function handleCopyWo() {
    try {
      await navigator.clipboard.writeText(woNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore — clipboard unavailable (e.g. insecure context)
    }
  }

  function handleClose() {
    if (onCancel) {
      onCancel()
      return
    }
    // Fallback: try to close the window/tab (only works if opened by script).
    if (typeof window !== 'undefined') {
      window.close()
    }
  }

  return (
    <div className={cn('mx-auto w-full max-w-md', className)}>
      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="space-y-5 p-6 text-center">
          {/* ── Big check icon ── */}
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
            <CheckCircle2 className="h-12 w-12 text-emerald-600 dark:text-emerald-400" />
          </div>

          {/* ── Title ── */}
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              ส่งเรื่องแจ้งซ่อมสำเร็จ
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              เจ้าหน้าที่ได้รับแจ้งแล้ว — กรุณาบันทึกเลขใบงานไว้
              เพื่อติดตามสถานะ
            </p>
          </div>

          {/* ── WO number block ── */}
          <div className="rounded-xl border-2 border-dashed border-[#f97316]/40 bg-[#fff7ed] p-4 dark:border-orange-900/60 dark:bg-orange-950/20">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#ea580c] dark:text-orange-300">
              เลขใบงาน
            </p>
            <p className="mt-1 break-all font-mono text-2xl font-bold tracking-wider text-[#ea580c] dark:text-orange-200">
              {woNumber}
            </p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopyWo}
                className="h-7 px-2 text-xs text-slate-500 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                {copied ? (
                  <>
                    <Check className="mr-1 h-3.5 w-3.5 text-emerald-500" />
                    คัดลอกแล้ว
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    คัดลอก
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* ── Status badge ── */}
          <div>
            <Badge
              variant="outline"
              className={cn('px-3 py-1 text-sm font-semibold', statusBadgeClass)}
            >
              {statusLabel}
            </Badge>
          </div>

          {/* ── Verification notice ── */}
          {requiresVerification && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm dark:border-amber-900 dark:bg-amber-950/30">
              <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="flex-1 text-amber-800 dark:text-amber-200">
                <span className="font-semibold">เจ้าหน้าที่จะโทรติดต่อกลับ</span>{' '}
                เพื่อยืนยันตัวตนและรายละเอียดเพิ่มเติม ก่อนดำเนินการซ่อม
              </p>
            </div>
          )}

          {/* ── Tracking button ── */}
          <Link href={trackableUrl} className="block">
            <Button
              type="button"
              size="lg"
              className="h-12 w-full bg-[#f97316] text-base font-semibold text-white hover:bg-[#ea580c]"
            >
              <ExternalLink className="mr-2 h-5 w-5" />
              ติดตามสถานะ
            </Button>
          </Link>

          {/* ── Close button ── */}
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={handleClose}
            className="h-10 w-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="mr-1 h-4 w-4" />
            ปิดหน้าต่าง
          </Button>

          {/* ── Tracking URL hint ── */}
          <p className="break-all text-center text-[11px] text-slate-400">
            URL: {trackableUrl}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
