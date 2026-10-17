'use client'

/**
 * TransferByScan — ย้ายเครื่องผ่าน QR/Barcode scan.
 *
 * Flow:
 *   1. User clicks "สแกนเพื่อย้ายเครื่อง" button
 *   2. Camera opens → scan QR/barcode on device sticker
 *   3. System looks up device by assetCode or serialNumber
 *   4. Shows device info + transfer form (destination site, department)
 *   5. Optional: capture meter reading (for transfer-with-meter)
 *   6. Submit → calls POST /api/devices/[id]/transfer-with-meter
 *
 * Usage:
 *   <TransferByScan onTransferred={() => refetch()} />
 */

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { QrCode, Camera, ArrowRight, Loader2, MapPin, Building2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { QrScannerDialog } from '@/components/itam/qr-scanner-dialog'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

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
}

interface Site {
  id: string
  code: string
  name: string | null
}

export function TransferByScan({ onTransferred }: { onTransferred?: () => void }) {
  const qc = useQueryClient()
  const token = useAuthStore((s) => s.token)
  const [scanOpen, setScanOpen] = React.useState(false)
  const [scannedCode, setScannedCode] = React.useState<string | null>(null)
  const [device, setDevice] = React.useState<Device | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [sites, setSites] = React.useState<Site[]>([])
  const [transferForm, setTransferForm] = React.useState({
    toSite: '',
    toDepartment: '',
    meterBw: '',
    meterColor: '',
    remark: '',
  })
  const [submitting, setSubmitting] = React.useState(false)

  // Load sites for dropdown
  React.useEffect(() => {
    async function loadSites() {
      try {
        const res = await fetch('/api/sites', {
          headers: bearerHeaders(token),
        })
        if (!res.ok) return
        const data = await res.json()
        setSites(data.sites ?? [])
      } catch {
        // ignore
      }
    }
    loadSites()
  }, [token])

  // When a code is scanned, look up the device
  React.useEffect(() => {
    if (!scannedCode) return
    // Capture the narrowed value: `scannedCode` is a mutable state binding, so
    // TypeScript cannot carry the `!scannedCode` narrowing into the async
    // findDevice() closure.
    const code = scannedCode
    async function findDevice() {
      setSearching(true)
      try {
        // Search by assetCode or serialNumber
        const res = await fetch(
          `/api/search/fts?q=${encodeURIComponent(code)}&type=devices&limit=1`,
          { headers: bearerHeaders(token) },
        )
        if (!res.ok) {
          toast.error('ไม่พบอุปกรณ์จากรหัสที่สแกน')
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
          toast.error('ไม่สามารถดึงข้อมูลอุปกรณ์ได้')
          return
        }
        const devData = await devRes.json()
        setDevice(devData.device ?? devData)
        toast.success(`พบอุปกรณ์: ${devData.device?.assetCode ?? devData.assetCode}`)
      } catch (err) {
        toast.error('เกิดข้อผิดพลาดในการค้นหาอุปกรณ์')
        console.error(err)
      } finally {
        setSearching(false)
      }
    }
    findDevice()
  }, [scannedCode, token])

  const handleScan = (code: string) => {
    setScannedCode(code)
    setScanOpen(false)
  }

  const handleTransfer = async () => {
    if (!device) return
    if (!transferForm.toSite) {
      toast.error('กรุณาเลือกสาขาปลายทาง')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/devices/${device.id}/transfer-with-meter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          toSite: transferForm.toSite,
          toDepartment: transferForm.toDepartment || undefined,
          meterBw: transferForm.meterBw ? parseInt(transferForm.meterBw, 10) : undefined,
          meterColor: transferForm.meterColor ? parseInt(transferForm.meterColor, 10) : undefined,
          remark: transferForm.remark || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'ย้ายเครื่องไม่สำเร็จ')
        return
      }

      toast.success(`ย้ายเครื่อง ${device.assetCode} ไปยัง ${transferForm.toSite} สำเร็จ`)
      setDevice(null)
      setScannedCode(null)
      setTransferForm({ toSite: '', toDepartment: '', meterBw: '', meterColor: '', remark: '' })
      qc.invalidateQueries({ queryKey: ['devices'] })
      onTransferred?.()
    } catch (err) {
      toast.error('เกิดข้อผิดพลาดในการย้ายเครื่อง')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    setDevice(null)
    setScannedCode(null)
    setTransferForm({ toSite: '', toDepartment: '', meterBw: '', meterColor: '', remark: '' })
  }

  return (
    <>
      {/* Trigger button */}
      <Button
        onClick={() => setScanOpen(true)}
        variant="outline"
        size="sm"
        className="border-[#f97316] text-[#f97316] hover:bg-[#f97316]/10"
      >
        <QrCode className="mr-1.5 h-4 w-4" />
        สแกนย้ายเครื่อง
      </Button>

      {/* QR Scanner Dialog */}
      <QrScannerDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onScan={handleScan}
        title="สแกน QR/Barcode ที่สติกเกอร์อุปกรณ์"
      />

      {/* Device found + transfer form */}
      {device && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900">
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                ย้ายเครื่อง
              </h2>
              <button
                onClick={handleCancel}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Device info */}
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-2">
                <span className="rounded bg-[#f97316]/10 px-2 py-0.5 text-xs font-mono font-bold text-[#f97316]">
                  {device.assetCode ?? '—'}
                </span>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {device.name ?? '—'}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {device.brand} {device.model} · S/N: {device.serialNumber ?? '—'}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <MapPin className="h-3 w-3" />
                {device.site ?? '—'} → ?
              </div>
            </div>

            {/* Transfer form */}
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium">สาขาปลายทาง *</Label>
                <Select
                  value={transferForm.toSite}
                  onValueChange={(v) => setTransferForm({ ...transferForm, toSite: v })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="เลือกสาขา" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.code}>
                        {s.code} {s.name ? `— ${s.name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-medium">แผนกปลายทาง (ไม่บังคับ)</Label>
                <Input
                  value={transferForm.toDepartment}
                  onChange={(e) => setTransferForm({ ...transferForm, toDepartment: e.target.value })}
                  placeholder="เช่น IT, บัญชี, การเงิน"
                  className="h-9"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs font-medium">มิเตอร์ขาวดำ (ไม่บังคับ)</Label>
                  <Input
                    type="number"
                    value={transferForm.meterBw}
                    onChange={(e) => setTransferForm({ ...transferForm, meterBw: e.target.value })}
                    placeholder="0"
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs font-medium">มิเตอร์สี (ไม่บังคับ)</Label>
                  <Input
                    type="number"
                    value={transferForm.meterColor}
                    onChange={(e) => setTransferForm({ ...transferForm, meterColor: e.target.value })}
                    placeholder="0"
                    className="h-9"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">หมายเหตุ (ไม่บังคับ)</Label>
                <Textarea
                  value={transferForm.remark}
                  onChange={(e) => setTransferForm({ ...transferForm, remark: e.target.value })}
                  placeholder="เหตุผลในการย้ายเครื่อง..."
                  rows={2}
                  className="text-sm"
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-5 flex gap-2">
              <Button
                onClick={handleTransfer}
                disabled={submitting || !transferForm.toSite}
                className="flex-1 bg-[#f97316] text-white hover:bg-[#ea580c]"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    กำลังย้าย...
                  </>
                ) : (
                  <>
                    <ArrowRight className="mr-1.5 h-4 w-4" />
                    ย้ายเครื่อง
                  </>
                )}
              </Button>
              <Button onClick={handleCancel} variant="outline" className="flex-1">
                ยกเลิก
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Searching state */}
      {searching && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="flex items-center gap-3 rounded-lg bg-white p-6 dark:bg-slate-900">
            <Loader2 className="h-6 w-6 animate-spin text-[#f97316]" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              กำลังค้นหาอุปกรณ์...
            </span>
          </div>
        </div>
      )}
    </>
  )
}
