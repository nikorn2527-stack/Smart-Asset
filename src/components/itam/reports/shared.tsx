'use client'

// Shared helpers + sub-components for the Reports Hub.
// Task ID: REPORTS-HUB-5GROUPS

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Inbox, TrendingUp, TrendingDown } from 'lucide-react'
import { useLang, getCurrentLang, localeFor } from '@/store/i18n-store'

// ── Status label maps ─────────────────────────────────
export const STATUS_LABELS_WO: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  IN_PROGRESS: 'กำลังซ่อม',
  WAITING_PARTS: 'รออะไหล่',
  COMPLETED: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
}

export const STATUS_COLORS_WO: Record<string, string> = {
  PENDING: '#f59e0b',
  IN_PROGRESS: '#3b82f6',
  WAITING_PARTS: '#a855f7',
  COMPLETED: '#10b981',
  CANCELLED: '#f43f5e',
}

export const STATUS_LABELS_DEV: Record<string, string> = {
  Active: 'ใช้งานอยู่',
  'In Repair': 'ส่งซ่อม',
  Retired: 'ปลดระวาง',
  Spare: 'สำรอง',
  Inactive: 'ไม่ใช้งาน',
}

export const STATUS_COLORS_DEV: Record<string, string> = {
  Active: '#10b981',
  'In Repair': '#f97316',
  Retired: '#6b7280',
  Spare: '#f59e0b',
  Inactive: '#ef4444',
}

export const DEVICE_TYPE_LABELS: Record<string, string> = {
  PRINTER: 'เครื่องพิมพ์',
  SCANNER: 'สแกนเนอร์',
  COMPUTER: 'คอมพิวเตอร์',
  NETWORK: 'อุปกรณ์เครือข่าย',
  OTHER: 'อื่น ๆ',
}

// ── Helpers ────────────────────────────────────────────
export function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function formatMonthLabel(month: string): string {
  try {
    const [y, m] = month.split('-')
    const d = new Date(Number(y), Number(m) - 1, 1)
    return d.toLocaleDateString(localeFor(getCurrentLang()), {
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return month
  }
}

export function formatBaht(value: number): string {
  return `฿${value.toLocaleString(localeFor(getCurrentLang()), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatNumber(value: number): string {
  return value.toLocaleString(localeFor(getCurrentLang()))
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString(localeFor(getCurrentLang()), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString(localeFor(getCurrentLang()), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso).getTime()
    const now = Date.now()
    const diff = now - d
    if (diff < 60_000) return `${Math.floor(diff / 1000)} วินาทีที่แล้ว`
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาทีที่แล้ว`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ชม.ที่แล้ว`
    return `${Math.floor(diff / 86_400_000)} วันที่แล้ว`
  } catch {
    return iso
  }
}

// ── Summary Card sub-component ─────────────────────────
export function SummaryCard({
  title,
  value,
  icon,
  accent,
  hint,
  trend,
}: {
  title: string
  value: string | number
  icon: React.ReactNode
  accent: string
  hint?: string
  trend?: { value: number; label: string }
}) {
  return (
    <Card className="overflow-hidden border-l-4 shadow-sm" style={{ borderLeftColor: accent }}>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:text-xs">
              {title}
            </div>
            <div className="mt-1 text-xl font-bold text-foreground md:text-2xl">
              {value}
            </div>
            {hint && (
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground md:text-xs">
                {hint}
              </div>
            )}
            {trend && (
              <div
                className={`mt-1 flex items-center gap-1 text-[10px] font-medium md:text-xs ${
                  trend.value >= 0 ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {trend.value >= 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {trend.value >= 0 ? '+' : ''}
                {trend.value}% {trend.label}
              </div>
            )}
          </div>
          <div
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white shadow-sm md:h-10 md:w-10"
            style={{ backgroundColor: accent }}
          >
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Empty State ────────────────────────────────────────
export function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Inbox className="mb-2 h-8 w-8 text-muted-foreground/50" />
      <p className="text-xs text-muted-foreground md:text-sm">{label}</p>
    </div>
  )
}

// ── Section Card ───────────────────────────────────────
export function SectionCard({
  title,
  icon,
  accent,
  children,
  action,
}: {
  title: string
  icon: React.ReactNode
  accent: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold md:text-base">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-md text-white"
              style={{ backgroundColor: accent }}
            >
              {icon}
            </span>
            {title}
          </CardTitle>
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// ── Chart tooltip style helper ─────────────────────────
export function chartStyles(isDark: boolean) {
  return {
    textColor: isDark ? '#cbd5e1' : '#475569',
    gridColor: isDark ? '#334155' : '#e2e8f0',
    tooltipStyle: {
      backgroundColor: isDark ? '#1e293b' : '#fff',
      border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      borderRadius: 8,
      fontSize: 12,
    } as React.CSSProperties,
    cursorFill: isDark ? '#1e293b66' : '#f1f5f9',
  }
}
