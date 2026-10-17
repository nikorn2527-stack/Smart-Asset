'use client'

/**
 * MobileDashboard — แดชบอร์ดแบบมือถือ (compact KPI cards)
 *
 * แสดงข้อมูลสำคัญแบบย่อ: จำนวนอุปกรณ์, ใช้งาน, ส่งซ่อม, รอบมิเตอร์
 * ไม่แสดงกราฟ (เพราะจอแคบ) — กราฟดูได้บน desktop
 */

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth-store'
import { useLang } from '@/store/i18n-store'
import { Package, CheckCircle, Wrench, AlertTriangle, Clock, TrendingUp } from 'lucide-react'
import { bearerHeaders } from '@/lib/http-headers'

interface DashboardData {
  totals: { total: number; active: number; spare: number; repair: number }
  pendingWO: number
  expiringWarranty: number
  meterRequired: number
  paperThisMonth: number
}

export function MobileDashboard() {
  const token = useAuthStore((s) => s.token)
  const { lang } = useLang()

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['mobile-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/itam/dashboard?range=month', {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('Failed')
      const j = await res.json()
      return {
        totals: j.totals ?? { total: 0, active: 0, spare: 0, repair: 0 },
        pendingWO: j.recentActivity?.filter((a: { status: string }) => a.status === 'PENDING').length ?? 0,
        expiringWarranty: j.warrantyExpiring ?? 0,
        meterRequired: j.meterRequired ?? 0,
        paperThisMonth: j.paperThisMonth ?? 0,
      }
    },
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      </div>
    )
  }

  const d = data ?? { totals: { total: 0, active: 0, spare: 0, repair: 0 }, pendingWO: 0, expiringWarranty: 0, meterRequired: 0, paperThisMonth: 0 }

  return (
    <div className="space-y-3 px-3 pb-24 pt-3">
      <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">📊 แดชบอร์ด</h1>

      {/* KPI cards — 2×2 grid */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCard icon={<Package className="h-5 w-5" />} label="อุปกรณ์ทั้งหมด" value={d.totals.total} color="orange" lang={lang} />
        <KpiCard icon={<CheckCircle className="h-5 w-5" />} label="ใช้งานอยู่" value={d.totals.active} color="emerald" lang={lang} />
        <KpiCard icon={<Wrench className="h-5 w-5" />} label="ส่งซ่อม" value={d.totals.repair} color="rose" lang={lang} />
        <KpiCard icon={<Clock className="h-5 w-5" />} label="รอบมิเตอร์" value={d.meterRequired} color="teal" lang={lang} />
      </div>

      {/* Alerts */}
      <div className="space-y-2">
        {d.pendingWO > 0 && (
          <AlertCard icon={<AlertTriangle className="h-4 w-4" />} label="รอดำเนินการซ่อม" value={d.pendingWO} color="amber" lang={lang} />
        )}
        {d.expiringWarranty > 0 && (
          <AlertCard icon={<AlertTriangle className="h-4 w-4" />} label="รับประกันใกล้หมด" value={d.expiringWarranty} color="rose" lang={lang} />
        )}
        {d.paperThisMonth > 0 && (
          <AlertCard icon={<TrendingUp className="h-4 w-4" />} label="กระดาษเดือนนี้" value={d.paperThisMonth} suffix="แผ่น" color="teal" lang={lang} />
        )}
      </div>

      {/* Tip */}
      <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/30 dark:text-slate-400">
        💡 กราฟและรายละเอียดเพิ่มเติมดูได้ที่แดชบอร์ดแบบเต็ม (desktop)
      </div>
    </div>
  )
}

function KpiCard({ icon, label, value, color, lang }: { icon: React.ReactNode; label: string; value: number; color: string; lang: 'th' | 'en' }) {
  const colors: Record<string, string> = {
    orange: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800/50 dark:bg-orange-950/20 dark:text-orange-300',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/20 dark:text-emerald-300',
    rose: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/20 dark:text-rose-300',
    teal: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800/50 dark:bg-teal-950/20 dark:text-teal-300',
  }
  return (
    <div className={`rounded-xl border p-3 ${colors[color] ?? colors.orange}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium opacity-80">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-bold">{value.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</p>
    </div>
  )
}

function AlertCard({ icon, label, value, suffix, color, lang }: { icon: React.ReactNode; label: string; value: number; suffix?: string; color: string; lang: 'th' | 'en' }) {
  const colors: Record<string, string> = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300',
    rose: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/20 dark:text-rose-300',
    teal: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/50 dark:bg-teal-950/20 dark:text-teal-300',
  }
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${colors[color] ?? colors.amber}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-lg font-bold">
        {value.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} {suffix ?? ''}
      </span>
    </div>
  )
}
