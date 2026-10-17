'use client'

// ============================================================
// NotificationLogSection — Admin-facing delivery stats + retry trigger
//
// Task ID: NOTIF-LOG-UI-003
//   Bug B fix (UI side): surfaces NotificationLog data so admins can
//   see how many notifications actually went out, which channels are
//   failing, the most recent failure messages, and a manual "ลองส่งใหม่"
//   button that hits the cron retry endpoint.
//
// Data source: GET /api/notifications/logs (requires VIEW_DASHBOARD)
// Retry action: GET /api/cron/notification-retry (no auth in dev;
//   in prod would require CRON_SECRET — the route handles that).
// ============================================================

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Activity,
  RefreshCw,
  Send,
  CheckCircle2,
  XCircle,
  SkipForward,
  AlertTriangle,
  Ban,
  Inbox,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { useLang, getCurrentLang, localeFor } from '@/store/i18n-store'

// ── Types matching the API response (GET /api/notifications/logs) ──
// Note: the backend returns Date objects which JSON-serializes to ISO
// strings, so on the client both `lastAttemptAt` and `createdAt` are
// strings (or null for lastAttemptAt).
interface ChannelStats {
  channel: string
  total: number
  sent: number
  failed: number
}

interface RecentFailure {
  id: string
  channel: string
  template: string
  title: string
  errorMessage: string | null
  retryCount: number
  lastAttemptAt: string | null
  createdAt: string
}

interface NotificationLogStatsResponse {
  total: number
  pending: number
  sent: number
  failed: number
  skipped: number
  permanentlyFailed: number
  byChannel: ChannelStats[]
  recentFailures: RecentFailure[]
  maxRetries: number
}

interface RetrySummaryResponse {
  ok: boolean
  ts: number
  dev: boolean
  elapsedMs: number
  summary: {
    examined: number
    retried: number
    succeeded: number
    stillFailing: number
    permanentlyFailed: number
  }
}

// ── Channel display helpers ──────────────────────────────────
type ChannelKey = 'line-oa' | 'telegram' | 'email'

const CHANNEL_LABELS: Record<string, string> = {
  'line-oa': 'LINE OA',
  telegram: 'Telegram',
  email: 'Email',
}

const CHANNEL_DOT: Record<string, string> = {
  'line-oa': 'bg-emerald-500',
  telegram: 'bg-cyan-500',
  email: 'bg-orange-500',
}

function channelLabel(ch: string): string {
  return CHANNEL_LABELS[ch] ?? ch
}

function channelDotClass(ch: string): string {
  return CHANNEL_DOT[ch] ?? 'bg-slate-400'
}

// ── Utilities ─────────────────────────────────────────────────
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString(localeFor(getCurrentLang()), {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function successRate(sent: number, total: number): string {
  if (total <= 0) return '—'
  const pct = (sent / total) * 100
  return `${pct.toFixed(1)}%`
}

function retryBadgeClass(retryCount: number, maxRetries: number): string {
  if (retryCount >= maxRetries) {
    return 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900'
  }
  if (retryCount >= 1) {
    return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
  }
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
}

// ── Component ─────────────────────────────────────────────────
export function NotificationLogSection() {
  const { lang } = useLang()
  const qc = useQueryClient()

  // ── Fetch stats ──────────────────────────────────────────────
  const { data, isLoading, isFetching, error } = useQuery<NotificationLogStatsResponse>({
    queryKey: ['notification-logs'],
    queryFn: async () => {
      const res = await fetch('/api/notifications/logs', {
        headers: authHeaders(),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `โหลดสถิติไม่สำเร็จ (HTTP ${res.status})`)
      }
      return (await res.json()) as NotificationLogStatsResponse
    },
    retry: false,
  })

  // ── Manual retry mutation ────────────────────────────────────
  // Calls the cron endpoint directly. In dev the route runs without
  // a CRON_SECRET; in prod an operator would invoke it via the cron
  // service, but exposing this button lets an admin trigger an
  // ad-hoc pass on demand.
  const retryMutation = useMutation({
    mutationFn: async (): Promise<RetrySummaryResponse> => {
      const res = await fetch('/api/cron/notification-retry', {
        method: 'GET',
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `ลองส่งใหม่ไม่สำเร็จ (HTTP ${res.status})`)
      }
      return (await res.json()) as RetrySummaryResponse
    },
    onSuccess: (resp) => {
      const s = resp.summary
      toast.success(
        `ลองส่งใหม่เสร็จ: ตรวจ ${s.examined} · ส่งใหม่ ${s.retried} · สำเร็จ ${s.succeeded} · ยังล้มเหลว ${s.stillFailing} · ถาวร ${s.permanentlyFailed}`,
        { duration: 8000 },
      )
      qc.invalidateQueries({ queryKey: ['notification-logs'] })
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : 'ลองส่งใหม่ไม่สำเร็จ')
    },
  })

  const maxRetries = data?.maxRetries ?? 3
  const stats = data
  const channels = stats?.byChannel ?? []
  const failures = stats?.recentFailures ?? []

  // ── Stat card config ────────────────────────────────────────
  const statCards: Array<{
    label: string
    value: number
    icon: React.ComponentType<{ className?: string }>
    accent: string
    hint?: string
  }> = [
    {
      label: 'ทั้งหมด',
      value: stats?.total ?? 0,
      icon: Activity,
      accent: 'text-slate-600 dark:text-slate-300',
      hint: 'รายการที่บันทึกทั้งหมด',
    },
    {
      label: 'ส่งสำเร็จ',
      value: stats?.sent ?? 0,
      icon: CheckCircle2,
      accent: 'text-emerald-600 dark:text-emerald-400',
      hint: 'ส่งถึงผู้รับแล้ว',
    },
    {
      label: 'ล้มเหลว',
      value: stats?.failed ?? 0,
      icon: XCircle,
      accent: 'text-rose-600 dark:text-rose-400',
      hint: `รวมถาวร (retry ≥ ${maxRetries})`,
    },
    {
      label: 'ข้ามการส่ง',
      value: stats?.skipped ?? 0,
      icon: SkipForward,
      accent: 'text-amber-600 dark:text-amber-400',
      hint: 'ไม่ได้ส่งโดยตั้งใจ (เช่น ไม่มีผู้รับ)',
    },
    {
      label: 'ล้มเหลวถาวร',
      value: stats?.permanentlyFailed ?? 0,
      icon: Ban,
      accent: 'text-rose-700 dark:text-rose-500',
      hint: `retry ครบ ${maxRetries} ครั้ง — ต้องตรวจสอบด้วยมือ`,
    },
  ]

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Activity className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          <span>
            สถิติการส่งแจ้งเตือน — ติดตามสถานะการจ่าส่งทุกช่องทาง (LINE OA / Telegram / Email)
            และลองส่งใหม่ได้ที่นี่
          </span>
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ['notification-logs'] })}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> รีเฟรช
          </Button>
          <Button
            size="sm"
            onClick={() => retryMutation.mutate()}
            disabled={retryMutation.isPending}
            className="bg-[#f97316] text-white hover:bg-[#ea580c] disabled:opacity-60"
          >
            {retryMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            ลองส่งใหม่
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{error instanceof Error ? error.message : 'โหลดสถิติไม่สำเร็จ'}</span>
        </div>
      )}

      {/* ── Stat cards grid ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <Card
              key={card.label}
              className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {card.label}
                  </span>
                  <Icon className={`h-4 w-4 ${card.accent}`} />
                </div>
                <div className="mt-2 text-3xl font-bold text-slate-800 dark:text-slate-100">
                  {isLoading ? (
                    <Skeleton className="h-8 w-12" />
                  ) : (
                    (card.value ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')
                  )}
                </div>
                {card.hint && (
                  <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                    {card.hint}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ── Per-channel breakdown ───────────────────────────────── */}
      <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            สถิติแยกตามช่องทาง
            {channels.length > 0 && (
              <Badge className="bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900">
                {channels.length} ช่องทาง
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="itam-scroll max-h-[40vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-100/95 backdrop-blur dark:bg-slate-900/95 z-10">
                <TableRow>
                  <TableHead className="min-w-[140px]">ช่องทาง</TableHead>
                  <TableHead className="min-w-[80px] text-right">ทั้งหมด</TableHead>
                  <TableHead className="min-w-[80px] text-right">ส่งสำเร็จ</TableHead>
                  <TableHead className="min-w-[80px] text-right">ล้มเหลว</TableHead>
                  <TableHead className="min-w-[100px] text-right">อัตราสำเร็จ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={`sk-ch-${i}`}>
                      <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : channels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-400">
                      <Inbox className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      ยังไม่มีบันทึกการส่ง — เมื่อระบบส่งแจ้งเตือน ข้อมูลจะแสดงที่นี่
                    </TableCell>
                  </TableRow>
                ) : (
                  channels.map((c) => {
                    const rate = successRate(c.sent, c.total)
                    const rateNum = c.total > 0 ? (c.sent / c.total) * 100 : 0
                    const rateBadgeClass =
                      c.total === 0
                        ? 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                        : rateNum >= 90
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                          : rateNum >= 50
                            ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
                            : 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900'
                    return (
                      <TableRow
                        key={c.channel}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <TableCell>
                          <span className="inline-flex items-center gap-2 text-sm font-medium">
                            <span className={`h-2 w-2 rounded-full ${channelDotClass(c.channel)}`} />
                            {channelLabel(c.channel)}
                            <span className="font-mono text-[10px] text-slate-400">{c.channel}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">
                          {c.total.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-emerald-700 dark:text-emerald-400">
                          {c.sent.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-rose-700 dark:text-rose-400">
                          {c.failed.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={rateBadgeClass}>
                            {rate}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Recent failures ─────────────────────────────────────── */}
      <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-[#f97316] dark:text-[#fb923c]" />
            รายการที่ล้มเหลวล่าสุด
            {failures.length > 0 && (
              <Badge className="bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900">
                {failures.length} รายการ
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="itam-scroll max-h-[55vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-100/95 backdrop-blur dark:bg-slate-900/95 z-10">
                <TableRow>
                  <TableHead className="min-w-[110px]">ช่องทาง</TableHead>
                  <TableHead className="min-w-[130px]">เทมเพลต</TableHead>
                  <TableHead className="min-w-[200px]">หัวข้อ</TableHead>
                  <TableHead className="min-w-[240px]">ข้อความผิดพลาด</TableHead>
                  <TableHead className="min-w-[90px] text-center">ลอง (ครั้ง)</TableHead>
                  <TableHead className="min-w-[140px]">พยายามล่าสุด</TableHead>
                  <TableHead className="min-w-[140px]">สร้างเมื่อ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={`sk-f-${i}`}>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-5 w-8 mx-auto rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    </TableRow>
                  ))
                ) : failures.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-sm text-slate-400">
                      <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500 opacity-60" />
                      ไม่มีรายการที่ล้มเหลว — การส่งแจ้งเตือนทั้งหมดสำเร็จ
                    </TableCell>
                  </TableRow>
                ) : (
                  failures.map((f) => {
                    const permanent = f.retryCount >= maxRetries
                    return (
                      <TableRow
                        key={f.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                            <span className={`h-2 w-2 rounded-full ${channelDotClass(f.channel)}`} />
                            {channelLabel(f.channel)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {f.template}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[260px] truncate text-sm text-slate-700 dark:text-slate-200" title={f.title}>
                            {f.title || <span className="text-slate-400">—</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div
                            className="max-w-[320px] truncate text-xs text-rose-700 dark:text-rose-300"
                            title={f.errorMessage ?? ''}
                          >
                            {f.errorMessage || <span className="text-slate-400">—</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={retryBadgeClass(f.retryCount, maxRetries)}>
                            {f.retryCount}
                            {permanent && (
                              <span className="ml-1 text-[10px] opacity-80">/ {maxRetries}</span>
                            )}
                          </Badge>
                          {permanent && (
                            <div className="mt-1 text-[10px] font-medium text-rose-600 dark:text-rose-400">
                              ถาวร
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          {formatDateTime(f.lastAttemptAt)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          {formatDateTime(f.createdAt)}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Footer hint ─────────────────────────────────────────── */}
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        ระบบจะลองส่งใหม่อัตโนมัติทุก 5 นาที (ตาม cron schedule) สำหรับรายการที่ล้มเหลว
        และยังไม่เกิน {maxRetries} ครั้ง — ปุ่ม “ลองส่งใหม่” ด้านบนเรียกทันทีโดยไม่รอ cron.
      </p>
    </div>
  )
}
