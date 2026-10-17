'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  RefreshCw,
  AlertTriangle,
  Eye,
  CheckCircle2,
  Inbox,
  ArrowRight,
} from 'lucide-react'
import type {
  LifecycleData,
  WarrantyStatus,
} from './types'
import {
  warrantyBadgeClass,
  warrantyLabel,
} from './types'
import { useAppStore } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import { useT } from '@/store/i18n-store'
import { bearerHeaders } from '@/lib/http-headers'

/** Animated count-up hook — tweens from the previous value to the next
 * over 500ms using requestAnimationFrame (mirrors the dashboard-page one). */
function useCountUp(target: number, duration = 500) {
  const [display, setDisplay] = React.useState(target)
  const fromRef = React.useRef(target)
  const rafRef = React.useRef<number | null>(null)
  const startRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const from = fromRef.current
    if (from === target) {
      setDisplay(target)
      return
    }
    startRef.current = null
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts
      const elapsed = ts - startRef.current
      const t = Math.min(1, elapsed / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = Math.round(from + (target - from) * eased)
      setDisplay(next)
      if (t < 1) {
        rafRef.current = window.requestAnimationFrame(step)
      } else {
        fromRef.current = target
        setDisplay(target)
      }
    }
    rafRef.current = window.requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
      }
      fromRef.current = display
    }
  }, [target, duration])
  return display
}

function recBadgeClass(rec: string): string {
  switch (rec) {
    case 'replace':
      return 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
    case 'monitor':
      return 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
    case 'ok':
    default:
      return 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
  }
}

function recLabel(rec: string, t: (k: string) => string): string {
  switch (rec) {
    case 'replace':
      return t('lifecycle.filter.replace')
    case 'monitor':
      return t('lifecycle.filter.monitor')
    case 'ok':
    default:
      return t('lifecycle.filter.ok')
  }
}

function SummaryMiniCard({
  label,
  value,
  icon,
  accentClass,
  iconWrapClass,
}: {
  label: string
  value: number
  icon: React.ReactNode
  accentClass: string
  iconWrapClass: string
}) {
  const t = useT()
  const animated = useCountUp(value, 500)
  return (
    <div
      className={
        'relative overflow-hidden rounded-lg border p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ' +
        accentClass
      }
    >
      <div className="flex items-center gap-3">
        <div
          className={
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ' +
            iconWrapClass
          }
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-slate-600 dark:text-slate-300">
            {label}
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums leading-tight text-slate-800 dark:text-slate-100">
              {animated}
            </span>
            <span className="shrink-0 text-xs font-medium text-slate-400 dark:text-slate-500">
              {t('lifecycle.unit.device')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function LifecycleDashboard() {
  const setActivePage = useAppStore((s) => s.setActivePage)
  const setPendingDeviceId = useAppStore((s) => s.setPendingDeviceId)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const t = useT()

  const { data, isLoading, refetch, isFetching } = useQuery<LifecycleData>({
    queryKey: ['devices-lifecycle'],
    queryFn: async () => {
      const res = await fetch('/api/devices/lifecycle', {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) throw new Error('Failed to load lifecycle data')
      return res.json()
    },
    staleTime: 60_000,
  })

  const summary = data?.summary
  const devices = data?.devices ?? []
  const replaceDevices = devices
    .filter((d) => d.recommendation === 'replace')
    .slice(0, 5)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <Card className="relative overflow-hidden border-rose-200/70 bg-gradient-to-br from-white to-rose-50/40 shadow-sm transition-shadow hover:shadow-md dark:border-rose-900/40 dark:from-slate-900 dark:to-rose-950/10">
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-rose-400 via-amber-400 to-emerald-400" />
        <CardContent className="relative p-4 sm:p-5">
          {/* Header */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
                <RefreshCw className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 sm:text-base">
                  {t('lifecycle.title')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('lifecycle.subtitle')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {summary && (
                <span className="hidden text-xs text-slate-500 dark:text-slate-400 sm:inline">
                  {t('lifecycle.avg_age')}{' '}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {summary.avgAge}
                  </span>{' '}
                  {t('lifecycle.month_unit')}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className="h-8 focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
              >
                <RefreshCw
                  className={'h-3.5 w-3.5' + (isFetching ? ' animate-spin' : '')}
                />
                {t('lifecycle.refresh')}
              </Button>
            </div>
          </div>

          {/* Summary mini-cards */}
          {isLoading ? (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 dark:bg-slate-800" />
              ))}
            </div>
          ) : (
            summary && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SummaryMiniCard
                  label={t('lifecycle.filter.replace')}
                  value={summary.replace}
                  icon={<AlertTriangle className="h-5 w-5" />}
                  accentClass="border-rose-200 bg-rose-50/50 dark:border-rose-800/60 dark:bg-rose-950/20"
                  iconWrapClass="bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300"
                />
                <SummaryMiniCard
                  label={t('lifecycle.filter.monitor')}
                  value={summary.monitor}
                  icon={<Eye className="h-5 w-5" />}
                  accentClass="border-amber-200 bg-amber-50/50 dark:border-amber-800/60 dark:bg-amber-950/20"
                  iconWrapClass="bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300"
                />
                <SummaryMiniCard
                  label={t('lifecycle.filter.ok')}
                  value={summary.ok}
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  accentClass="border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/60 dark:bg-emerald-950/20"
                  iconWrapClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"
                />
              </div>
            )
          )}

          {/* Top devices needing replacement */}
          {!isLoading &&
            (replaceDevices.length === 0 ? (
              <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-emerald-300 bg-emerald-50/40 py-8 text-center dark:border-emerald-700 dark:bg-emerald-950/20">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t('lifecycle.empty_title')}
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-500">
                  {t('lifecycle.empty_desc')}
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {t('lifecycle.replace_now')} ({replaceDevices.length})
                  </h4>
                  {summary && summary.replace > replaceDevices.length && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialogOpen(true)}
                      className="h-7 border-rose-300 text-rose-600 hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:focus-visible:ring-offset-slate-950"
                    >
                      {t('lifecycle.view_all')}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <ul className="space-y-2">
                  {replaceDevices.map((d, i) => (
                    <motion.li
                      key={d.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.04 }}
                      className="cursor-pointer rounded-md border border-slate-100 bg-white px-3 py-2.5 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-slate-800/70"
                      onClick={() => {
                        setPendingDeviceId(d.id)
                        setActivePage('devices')
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                              {d.name}
                            </span>
                            <span className="shrink-0 font-mono text-xs text-slate-400 dark:text-slate-500">
                              {d.assetCode}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className="flex items-center gap-1">
                              <Badge
                                className={
                                  d.ageInMonths > 36
                                    ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                    : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }
                              >
                                {d.ageInMonths} {t('lifecycle.month_unit')}
                              </Badge>
                            </span>
                            <WarrantyStatusBadge status={d.warrantyStatus} />
                            <span>·</span>
                            <span>{d.site}</span>
                          </div>
                        </div>
                        <div className="flex w-28 shrink-0 flex-col items-end gap-1">
                          <span className="text-xs font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                            {d.replacementScore}/100
                          </span>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${d.replacementScore}%`,
                                background:
                                  'linear-gradient(90deg, #f43f5e, #fb7185)',
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </motion.li>
                  ))}
                </ul>
                {summary && summary.replace > 0 && (
                  <div className="mt-2 text-right">
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setDialogOpen(true)}
                      className="h-7 px-2 text-rose-600 hover:text-rose-700 dark:text-rose-400"
                    >
                      {t('lifecycle.view_full_table')}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}

          {/* Empty state when no devices */}
          {!isLoading && summary && summary.total === 0 && (
            <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-8 text-slate-400 dark:border-slate-700 dark:text-slate-500">
              <Inbox className="h-8 w-8 text-slate-300 dark:text-slate-400" />
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                {t('lifecycle.no_devices')}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full lifecycle table dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-4xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <RefreshCw className="h-4 w-4 text-[#f97316]" />
              {t('lifecycle.dialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('lifecycle.dialog.subtitle').replace('{count}', String(devices.length))}
            </DialogDescription>
          </DialogHeader>
          <div className="itam-scroll max-h-[70vh] overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="text-slate-600 dark:text-slate-300">{t('lifecycle.col.code')}</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">{t('lifecycle.col.name')}</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">{t('lifecycle.col.site')}</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-300">{t('lifecycle.col.age')}</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">{t('lifecycle.col.warranty')}</TableHead>
                  <TableHead className="text-right text-slate-600 dark:text-slate-300">{t('lifecycle.col.score')}</TableHead>
                  <TableHead className="text-slate-600 dark:text-slate-300">{t('lifecycle.col.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-slate-400 dark:text-slate-500">
                      {t('lifecycle.no_data')}
                    </TableCell>
                  </TableRow>
                ) : (
                  devices.map((d) => (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      onClick={() => {
                        setDialogOpen(false)
                        setPendingDeviceId(d.id)
                        setActivePage('devices')
                      }}
                    >
                      <TableCell className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        {d.assetCode}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-slate-700 dark:text-slate-200">
                        {d.name}
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300">{d.site}</TableCell>
                      <TableCell className="text-right">
                        <Badge
                          className={
                            d.ageInMonths > 36
                              ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }
                        >
                          {d.ageInMonths} {t('lifecycle.unit.month_short')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={warrantyBadgeClass(d.warrantyStatus as WarrantyStatus)}>
                          {warrantyLabel(d.warrantyStatus as WarrantyStatus)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${d.replacementScore}%`,
                                background:
                                  d.recommendation === 'replace'
                                    ? 'linear-gradient(90deg, #f43f5e, #fb7185)'
                                    : d.recommendation === 'monitor'
                                      ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                                      : 'linear-gradient(90deg, #10b981, #34d399)',
                              }}
                            />
                          </div>
                          <span className="w-7 text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                            {d.replacementScore}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={recBadgeClass(d.recommendation)}>
                          {recLabel(d.recommendation, t)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
            <span>
              {summary
                ? t('lifecycle.summary').replace('{replace}', String(summary.replace)).replace('{monitor}', String(summary.monitor)).replace('{ok}', String(summary.ok))
                : ''}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              className="h-7 focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {t('common.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}

function WarrantyStatusBadge({ status }: { status: WarrantyStatus }) {
  return (
    <Badge className={warrantyBadgeClass(status)} title={status}>
      {warrantyLabel(status)}
    </Badge>
  )
}
