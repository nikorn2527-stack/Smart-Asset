'use client'

/**
 * MobileQRScan — mobile-friendly QR/barcode scanner tab.
 *
 * Features:
 *   1. Scan QR/barcode from camera (uses QrScannerDialog)
 *   2. After scan → look up device → show quick actions:
 *      - ดูข้อมูลอุปกรณ์ (device details)
 *      - ย้ายเครื่อง (transfer)
 *      - แจ้งซ่อม (create WO)
 *      - จดมิเตอร์ (meter reading)
 *   3. Manual entry fallback (type asset code)
 *
 * Uses existing QrScannerDialog for camera + jsQR + BarcodeDetector.
 */

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  QrCode,
  Keyboard,
  ArrowRight,
  Wrench,
  Gauge,
  Info,
  X,
  Loader2,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

// Dynamic import QrScannerDialog — jsqr is CommonJS, breaks if loaded statically
const QrScannerDialog = React.lazy(() =>
  import('@/components/itam/qr-scanner-dialog').then((m) => ({ default: m.QrScannerDialog }))
)

interface Device {
  id: string
  assetCode: string | null
  name: string | null
  brand: string | null
  model: string | null
  serialNumber: string | null
  site: string | null
  department: string | null
  status: string
  type: string | null
}

export function MobileQRScan() {
  const qc = useQueryClient()
  const token = useAuthStore((s) => s.token)
  const [scanOpen, setScanOpen] = React.useState(false)
  const [manualCode, setManualCode] = React.useState('')
  const [searching, setSearching] = React.useState(false)
  const [device, setDevice] = React.useState<Device | null>(null)
  const [actionLoading, setActionLoading] = React.useState<string | null>(null)

  // Find device by scanned/typed code
  async function findDevice(code: string) {
    if (!code.trim()) return
    setSearching(true)
    setDevice(null)
    try {
      const res = await fetch(
        `/api/search/fts?q=${encodeURIComponent(code)}&type=devices&limit=1`,
        { headers: bearerHeaders(token) },
      )
      if (!res.ok) {
        toast.error('ค้นหาไม่สำเร็จ')
        return
      }
      const data = await res.json()
      if (!data.results || data.results.length === 0) {
        toast.error(`ไม่พบอุปกรณ์รหัส "${code}"`)
        return
      }
      // Fetch full device details
      const deviceId = data.results[0].id
      const devRes = await fetch(`/api/devices/${deviceId}`, {
        headers: bearerHeaders(token),
      })
      if (!devRes.ok) {
        toast.error('ดึงข้อมูลอุปกรณ์ไม่สำเร็จ')
        return
      }
      const devData = await devRes.json()
      setDevice(devData.device ?? devData)
      toast.success(`พบอุปกรณ์: ${devData.device?.assetCode ?? devData.assetCode}`)
    } catch (err) {
      toast.error('เกิดข้อผิดพลาดในการค้นหา')
      console.error(err)
    } finally {
      setSearching(false)
    }
  }

  const handleScan = (code: string) => {
    setScanOpen(false)
    findDevice(code)
  }

  const handleManualSearch = () => {
    if (manualCode.trim()) {
      findDevice(manualCode.trim())
    }
  }

  // Quick actions after device found
  const handleAction = async (action: 'wo' | 'meter' | 'transfer') => {
    if (!device) return
    setActionLoading(action)

    try {
      if (action === 'wo') {
        // Create WO for this device
        const res = await fetch('/api/work-orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            subject: `แจ้งซ่อม ${device.assetCode ?? ''} — ${device.name ?? ''}`.trim(),
            deviceId: device.id,
            siteCode: device.site,
            submissionSource: 'mobile',
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error ?? 'สร้างใบงานไม่สำเร็จ')
          return
        }
        const data = await res.json()
        toast.success(`สร้างใบงานแล้ว: ${data.workOrder?.woNumber ?? data.woNumber ?? '-'}`)
        qc.invalidateQueries({ queryKey: ['work-orders'] })
      } else if (action === 'meter') {
        // Navigate to meter page with this device
        toast.info(`ไปที่หน้าจดมิเตอร์สำหรับ ${device.assetCode}`)
        // TODO: wire to meter page navigation
      } else if (action === 'transfer') {
        // Open transfer-by-scan flow
        toast.info('ฟีเจอร์ย้ายเครื่อง — กำลังพัฒนา')
        // TODO: wire to transfer flow
      }
    } catch (err) {
      toast.error('เกิดข้อผิดพลาด')
      console.error(err)
    } finally {
      setActionLoading(null)
    }
  }

  const handleClear = () => {
    setDevice(null)
    setManualCode('')
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950/40">
          <QrCode className="h-7 w-7 text-orange-600 dark:text-orange-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          สแกน QR / Barcode
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          สแกนสติกเกอร์อุปกรณ์เพื่อดูข้อมูล แจ้งซ่อม หรือย้ายเครื่อง
        </p>
      </div>

      {/* Scan button */}
      <Button
        onClick={() => setScanOpen(true)}
        disabled={searching}
        size="lg"
        className="h-14 w-full bg-orange-500 text-white hover:bg-orange-600"
      >
        {searching ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            กำลังค้นหา...
          </>
        ) : (
          <>
            <QrCode className="mr-2 h-5 w-5" />
            เปิดกล้องสแกน
          </>
        )}
      </Button>

      {/* Divider */}
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        <span className="text-xs text-slate-400">หรือพิมพ์รหัสเครื่อง</span>
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>

      {/* Manual entry */}
      <div className="flex gap-2">
        <Input
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
          placeholder="เช่น IT-00001 หรือ SN12345"
          className="h-11 flex-1"
        />
        <Button
          onClick={handleManualSearch}
          disabled={searching || !manualCode.trim()}
          size="lg"
          variant="outline"
          className="h-11 px-4"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
      </div>

      {/* Device found */}
      {device && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-orange-100 px-2 py-0.5 font-mono text-xs font-bold text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
                  {device.assetCode ?? '—'}
                </span>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {device.name ?? '—'}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {device.brand} {device.model}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                S/N: {device.serialNumber ?? '—'} · สาขา: {device.site ?? '—'}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                แผนก: {device.department ?? '—'} · สถานะ: {device.status}
              </div>
            </div>
            <button
              onClick={handleClear}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="ปิด"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={() => handleAction('wo')}
              disabled={actionLoading !== null}
              variant="outline"
              className="flex h-16 flex-col items-center justify-center gap-1 border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-950/20"
            >
              {actionLoading === 'wo' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Wrench className="h-5 w-5" />
              )}
              <span className="text-[10px] font-medium">แจ้งซ่อม</span>
            </Button>
            <Button
              onClick={() => handleAction('meter')}
              disabled={actionLoading !== null}
              variant="outline"
              className="flex h-16 flex-col items-center justify-center gap-1 border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/20"
            >
              {actionLoading === 'meter' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Gauge className="h-5 w-5" />
              )}
              <span className="text-[10px] font-medium">จดมิเตอร์</span>
            </Button>
            <Button
              onClick={() => handleAction('transfer')}
              disabled={actionLoading !== null}
              variant="outline"
              className="flex h-16 flex-col items-center justify-center gap-1 border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-400 dark:hover:bg-teal-950/20"
            >
              {actionLoading === 'transfer' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ArrowRight className="h-5 w-5" />
              )}
              <span className="text-[10px] font-medium">ย้ายเครื่อง</span>
            </Button>
          </div>
        </div>
      )}

      {/* QR Scanner Dialog — lazy loaded with Suspense fallback */}
      {scanOpen && (
        <React.Suspense fallback={<div className="p-4 text-center text-sm">กำลังโหลดกล้อง...</div>}>
          <QrScannerDialog
            open={scanOpen}
            onOpenChange={setScanOpen}
            onScan={handleScan}
            title="สแกน QR/Barcode ที่สติกเกอร์อุปกรณ์"
          />
        </React.Suspense>
      )}
    </div>
  )
}
