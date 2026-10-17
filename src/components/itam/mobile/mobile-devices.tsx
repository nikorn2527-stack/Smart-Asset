'use client'

/**
 * MobileDevices — รายการอุปกรณ์แบบมือถือ (card list, ไม่ใช้ตาราง)
 *
 * แสดงเป็นการ์ดทีละแถว พร้อมค้นหา + กรองสถานะ
 * กดการ์ด → เปิด device detail sheet
 */

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth-store'
import { Search, Package, ChevronRight } from 'lucide-react'
import { bearerHeaders } from '@/lib/http-headers'

interface DeviceRow {
  id: string
  assetCode: string
  name: string
  type: string
  brand: string | null
  model: string | null
  status: string
  site: string | null
  serialNumber: string | null
}

interface DeviceResponse {
  devices: DeviceRow[]
  total: number
}

const STATUS_LABELS: Record<string, string> = {
  active: 'ใช้งานอยู่',
  Active: 'ใช้งานอยู่',
  spare: 'สำรอง',
  Spare: 'สำรอง',
  repair: 'ส่งซ่อม',
  Repair: 'ส่งซ่อม',
  disposed: 'ตัดจำหน่าย',
  Disposed: 'ตัดจำหน่าย',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  Active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  spare: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  Spare: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  repair: 'bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
  Repair: 'bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
}

export function MobileDevices() {
  const token = useAuthStore((s) => s.token)
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<string>('all')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const { data, isLoading } = useQuery<DeviceResponse>({
    queryKey: ['mobile-devices', search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '200' })
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/devices?${params}`, {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 30_000,
  })

  const devices = data?.devices ?? []

  return (
    <div className="flex h-full flex-col">
      {/* Search bar */}
      <div className="flex-shrink-0 space-y-2 px-3 pb-2 pt-3">
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">💻 อุปกรณ์</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="ค้นหารหัส, ชื่อ, ยี่ห้อ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
        </div>
        {/* Status filter chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            { key: 'all', label: 'ทั้งหมด' },
            { key: 'active', label: 'ใช้งานอยู่' },
            { key: 'spare', label: 'สำรอง' },
            { key: 'repair', label: 'ส่งซ่อม' },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                statusFilter === f.key
                  ? 'bg-orange-500 text-white'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Device list */}
      <div className="flex-1 overflow-y-auto px-3 pb-24">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          </div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="mb-2 h-10 w-10 text-slate-300 dark:text-slate-400" />
            <p className="text-sm text-slate-500 dark:text-slate-400">ไม่พบอุปกรณ์</p>
          </div>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedId(d.id)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-left transition active:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 dark:active:bg-slate-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-orange-600 dark:text-orange-400">{d.assetCode}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[d.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABELS[d.status] ?? d.status}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-slate-700 dark:text-slate-300">
                    {d.name || `${d.brand ?? ''} ${d.model ?? ''}`.trim() || 'ไม่ระบุชื่อ'}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {d.type} · {d.site ?? '-'} · S/N: {d.serialNumber ?? '-'}
                  </p>
                </div>
                <ChevronRight className="ml-2 h-5 w-5 flex-shrink-0 text-slate-300 dark:text-slate-400" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* TODO: Device detail sheet — for now just show a placeholder */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedId(null)} />
          <div className="relative z-10 max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold">รายละเอียดอุปกรณ์</h2>
              <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-500">Device ID: {selectedId}</p>
            <p className="mt-2 text-xs text-slate-400">ดูรายละเอียดเพิ่มเติมได้ที่หน้าจัดการอุปกรณ์แบบเต็ม (desktop)</p>
            <button
              onClick={() => setSelectedId(null)}
              className="mt-4 w-full rounded-lg bg-orange-500 py-2.5 text-sm font-medium text-white"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
