'use client'

/**
 * Public Work Order View Page — /wo/[id]
 *
 * แสดงสถานะใบแจ้งซ่อมสำหรับผู้ใช้ที่สแกน QR หรือกด "ดูสถานะ"
 * ไม่ต้อง login — ใช้ /api/public/work-orders/[id] (no auth)
 *
 * UI: card layout สวยงาม สำหรับมือถือ
 */

export const dynamic = 'force-dynamic'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { Loader2, AlertCircle, CheckCircle2, Clock, Wrench, Package, XCircle, MapPin, Calendar, Printer } from 'lucide-react'

interface PublicWO {
  woNumber: string
  subject: string
  status: string
  statusLabel: string
  priority: string | null
  building: string | null
  location: string | null
  createdAt: string | null
  closedAt: string | null
  canceledAt: string | null
  cancelReason: string | null
  device: {
    assetCode: string
    name: string
    brand: string
    model: string
    site: string
  } | null
}

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; bg: string }> = {
  PENDING: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-100 dark:bg-amber-950/40' },
  IN_PROGRESS: { icon: Wrench, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-950/40' },
  WAITING_PARTS: { icon: Package, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-950/40' },
  COMPLETED: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-950/40' },
  CANCELLED: { icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-100 dark:bg-rose-950/40' },
}

export default function PublicWOPage() {
  const params = useParams<{ id: string }>()
  const [wo, setWo] = React.useState<PublicWO | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!params.id) return
    setLoading(true)
    fetch(`/api/public/work-orders/${encodeURIComponent(params.id)}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found')
        return r.json()
      })
      .then((data) => {
        setWo(data.data)
        setError(null)
      })
      .catch(() => {
        setError('ไม่พบใบงานนี้ หรืออาจถูกลบแล้ว')
      })
      .finally(() => setLoading(false))
  }, [params.id])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="h-10 w-10 animate-spin text-[#f97316]" />
      </div>
    )
  }

  if (error || !wo) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-950 p-4">
        <AlertCircle className="h-12 w-12 text-rose-500" />
        <p className="text-center text-sm text-slate-600 dark:text-slate-300">{error ?? 'ไม่พบข้อมูล'}</p>
        <a href="/" className="mt-4 rounded-lg border border-slate-300 px-6 py-2 text-sm text-slate-600">กลับหน้าหลัก</a>
      </div>
    )
  }

  const statusCfg = STATUS_CONFIG[wo.status] ?? STATUS_CONFIG.PENDING
  const StatusIcon = statusCfg.icon

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-md p-4">
        {/* Header */}
        <div className="flex items-center justify-between pt-4">
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">สถานะใบแจ้งซ่อม</h1>
          <span className="text-xs text-slate-400">ITAM</span>
        </div>

        {/* WO Number + Status */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">เลขใบแจ้งซ่อม</p>
              <p className="mt-0.5 font-mono text-xl font-bold text-[#f97316]">{wo.woNumber}</p>
            </div>
            <div className={`flex items-center gap-1.5 rounded-lg ${statusCfg.bg} px-3 py-1.5`}>
              <StatusIcon className={`h-4 w-4 ${statusCfg.color}`} />
              <span className={`text-xs font-semibold ${statusCfg.color}`}>{wo.statusLabel}</span>
            </div>
          </div>
        </div>

        {/* Problem */}
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">ปัญหาที่แจ้ง</p>
          <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">{wo.subject}</p>
        </div>

        {/* Device */}
        {wo.device && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">อุปกรณ์</p>
            <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {wo.device.brand} {wo.device.model}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">รหัส: {wo.device.assetCode}</p>
            {wo.device.site && <p className="mt-0.5 text-xs text-slate-500">สาขา: {wo.device.site}</p>}
          </div>
        )}

        {/* Location */}
        {(wo.building || wo.location) && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">สถานที่</p>
            <div className="mt-1 flex items-start gap-2">
              <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
              <div>
                {wo.building && <p className="text-sm text-slate-700 dark:text-slate-200">{wo.building}</p>}
                {wo.location && <p className="text-xs text-slate-500">{wo.location}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">วันที่/เวลา</p>
          <div className="mt-2 space-y-2">
            {wo.createdAt && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                <span className="text-slate-600 dark:text-slate-300">แจ้งเมื่อ: {wo.createdAt}</span>
              </div>
            )}
            {wo.closedAt && wo.status === 'COMPLETED' && (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">ซ่อมเสร็จ: {wo.closedAt}</span>
              </div>
            )}
            {wo.canceledAt && wo.status === 'CANCELLED' && (
              <div className="flex items-center gap-2 text-sm">
                <XCircle className="h-3.5 w-3.5 flex-shrink-0 text-rose-500" />
                <span className="text-rose-600 dark:text-rose-400">ยกเลิก: {wo.canceledAt}</span>
              </div>
            )}
          </div>
          {wo.cancelReason && wo.status === 'CANCELLED' && (
            <div className="mt-2 rounded-md bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              เหตุผล: {wo.cancelReason}
            </div>
          )}
        </div>

        {/* Priority */}
        {wo.priority && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">ความเร่งด่วน</p>
            <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">{wo.priority}</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 pb-8 text-center">
          <p className="text-xs text-slate-400">© IT Asset Management</p>
        </div>
      </div>
    </div>
  )
}
