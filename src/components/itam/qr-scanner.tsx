'use client'

/**
 * QrScannerDialog — camera-based QR code scanner.
 *
 * Why this exists:
 *   Google Apps Script runs inside a Caja sandbox and CANNOT access
 *   navigator.mediaDevices.getUserMedia — so the GAS version of this app
 *   has no in-app QR scanner. Next.js runs in a real browser context, so
 *   we can use the camera + jsQR to decode QR codes directly.
 *
 * Implementation:
 *   • Single Dialog (mounted once at the app shell, opened via
 *     useAppStore.setQrScannerOpen(true))
 *   • On open: getUserMedia({ video: { facingMode: 'environment' } })
 *   • A <video> element shows the live camera feed
 *   • A canvas (hidden) is used to grab frames every 250ms
 *   • jsQR decodes the frame → if a QR is found, parse the assetNo from
 *     the decoded text (handles URLs like https://.../?asset=XXX, plain
 *     "XXX", or "ITAM:XXX")
 *   • Orange corner-bracket overlay + animated scan line + beep on success
 *   • Manual fallback: text input where the user can type/paste an asset code
 *
 * On successful scan:
 *   • Toast confirmation
 *   • Navigate to ITAM devices page + open device detail sheet
 */

import * as React from 'react'
import jsQR from 'jsqr'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Camera, ScanLine, Keyboard, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { parseAssetNo } from '@/lib/asset-qr'

// `parseAssetNo` is now imported from `@/lib/asset-qr` so the same
// parser is shared with the Replace-on-Withdraw flow and Work Orders
// field-replacement feature.

type ScanMode = 'camera' | 'manual'

export function QrScannerDialog() {
  const open = useAppStore((s) => s.qrScannerOpen)
  const setOpen = useAppStore((s) => s.setQrScannerOpen)
  const setActivePage = useAppStore((s) => s.setActivePage)
  const setPendingDeviceId = useAppStore((s) => s.setPendingDeviceId)

  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const rafRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const [mode, setMode] = React.useState<ScanMode>('camera')
  const [error, setError] = React.useState<string | null>(null)
  const [lastScan, setLastScan] = React.useState<string | null>(null)
  const [manualInput, setManualInput] = React.useState('')
  const [cameraReady, setCameraReady] = React.useState(false)
  const [scanning, setScanning] = React.useState(false)

  // Reset state when the dialog opens
  React.useEffect(() => {
    if (open) {
      setError(null)
      setLastScan(null)
      setManualInput('')
      setCameraReady(false)
      setScanning(false)
      setMode('camera')
    }
  }, [open])

  // Start/stop camera when mode === 'camera' && open
  React.useEffect(() => {
    if (!open || mode !== 'camera') {
      // Cleanup any running stream
      stopCamera()
      return
    }
    let cancelled = false
    async function startCamera() {
      setError(null)
      setCameraReady(false)
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setError('เบราว์เซอร์นี้ไม่รองรับการเข้าถึงกล้อง (getUserMedia)')
          return
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          v.setAttribute('playsinline', 'true')
          await v.play().catch(() => null)
          setCameraReady(true)
          setScanning(true)
          startScanLoop()
        }
      } catch (e) {
        const err = e as DOMException
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          setError('ผู้ใช้ปฏิเสธการเข้าถึงกล้อง หรือเบราว์เซอร์บล็อกไว้ — ลองใช้งานบน HTTPS หรือเปลี่ยนไปใส่รหัสด้วยมือ')
        } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
          setError('ไม่พบกล้องบนอุปกรณ์นี้ — ลองเปลี่ยนไปใส่รหัสด้วยมือ')
        } else {
          setError(err.message || 'เปิดกล้องไม่สำเร็จ')
        }
      }
    }
    void startCamera()
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [open, mode])

  function stopCamera() {
    if (rafRef.current) {
      clearTimeout(rafRef.current)
      rafRef.current = null
    }
    setScanning(false)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    const v = videoRef.current
    if (v) {
      try {
        v.srcObject = null
      } catch (e) { console.error(String(e)) }
    }
  }

  function startScanLoop() {
    let attempts = 0
    // Check if BarcodeDetector API is available (supports QR + 2D barcodes)
    const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window
    const tick = async () => {
      if (!open || mode !== 'camera') return
      const v = videoRef.current
      const canvas = canvasRef.current
      if (!v || !canvas || v.readyState !== v.HAVE_ENOUGH_DATA) {
        rafRef.current = setTimeout(tick, 120) as unknown as ReturnType<typeof setTimeout>
        return
      }
      const w = v.videoWidth
      const h = v.videoHeight
      if (w > 0 && h > 0) {
        // ── Try BarcodeDetector API first (supports QR + 2D barcodes) ──
        if (hasBarcodeDetector) {
          try {
            // @ts-expect-error — BarcodeDetector is not in TS types yet
            const detector = new window.BarcodeDetector({
              formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'data_matrix', 'pdf417'],
            })
            const codes = await detector.detect(v)
            if (codes && codes.length > 0 && codes[0].rawValue) {
              handleDecoded(codes[0].rawValue)
              return
            }
          } catch {
            // Fall through to jsQR below
          }
        }
        // ── Fallback: jsQR (QR codes only) ──
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(v, 0, 0, w, h)
          try {
            const img = ctx.getImageData(0, 0, w, h)
            const code = jsQR(img.data, img.width, img.height, {
              // jsQR only accepts 'dontInvert' | 'onlyInvert' | 'attemptBoth' |
              // 'invertFirst' — 'attemptOnly' is not a valid value and silently
              // disabled inversion retries, which breaks scanning of
              // light-on-dark (inverted) QR codes.
              inversionAttempts: 'attemptBoth',
            })
            if (code && code.data) {
              handleDecoded(code.data)
              return // stop loop on success
            }
          } catch (err) { console.error('[qr-scanner]', err) }
        }
      }
      attempts++
      // Auto-throttle: scan every ~120ms (8 fps) — light on CPU
      rafRef.current = setTimeout(tick, 120) as unknown as ReturnType<typeof setTimeout>
    }
    rafRef.current = setTimeout(tick, 250) as unknown as ReturnType<typeof setTimeout>
  }

  // ── Handle decoded QR — Smart QR routing + legacy fallback ──
  async function handleDecoded(raw: string) {
    // ── Check if this is a Smart QR URL (/qr/{type}/{id}?action=xxx) ──
    const smartMatch = raw.match(/\/qr\/([dAsw])\/([a-zA-Z0-9_-]+)/i)
    if (smartMatch) {
      // Smart QR — redirect to the QR router page
      const url = raw.startsWith('http') ? raw : `${window.location.origin}${raw.startsWith('/') ? '' : '/'}${raw}`
      // Haptic feedback
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(120) } catch { /* ignore */ }
      }
      toast.success('สแกน Smart QR สำเร็จ', { description: 'กำลังเปิด...' })
      stopCamera()
      setOpen(false)
      window.location.href = url
      return
    }

    // ── Legacy QR: parse assetCode / serial ──
    const assetNo = parseAssetNo(raw)
    setLastScan(raw)
    if (!assetNo) {
      toast.error('สแกนสำเร็จ แต่ไม่สามารถอ่านรหัสอุปกรณ์ได้', { description: raw.slice(0, 80) })
      rafRef.current = setTimeout(startScanLoop, 800)
      return
    }
    // Haptic feedback (mobile)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(120)
      } catch (e) { console.error(String(e)) }
    }
    // Smart routing: check if device is meter-required.
    // SERIAL-FIRST (METER-LOOKUP-P0): try /api/itam/devices?assetNo= first;
    // if no match, fall back to ?serial= so manufacturer QR stickers (which
    // encode the serial, not our internal assetCode) work too.
    const lookupDevice = async (code: string) => {
      // 1. Try assetCode exact match
      const r1 = await fetch(`/api/itam/devices?assetNo=${encodeURIComponent(code)}&limit=1`)
      if (r1.ok) {
        const j1 = await r1.json()
        if (j1.devices && j1.devices.length > 0) return { device: j1.devices[0], matchedBy: 'assetCode' }
      }
      // 2. Fallback to serialNumber
      const r2 = await fetch(`/api/itam/devices?serial=${encodeURIComponent(code)}&limit=1`)
      if (r2.ok) {
        const j2 = await r2.json()
        if (j2.devices && j2.devices.length > 0) return { device: j2.devices[0], matchedBy: 'serialNumber' }
      }
      return { device: null, matchedBy: null }
    }
    try {
      const { device, matchedBy } = await lookupDevice(assetNo)
      if (device && device.meterRequired) {
        const devName = (device.brand || '') + ' ' + (device.model || '')
        toast.success('สแกนสำเร็จ: ' + assetNo, {
          description: devName.trim() + ` — ไปหน้าจดมิเตอร์${matchedBy === 'serialNumber' ? ' (จับคู่ด้วย Serial)' : ''}`,
        })
        stopCamera()
        setOpen(false)
        setActivePage('itam-meter-keyboard')
        setPendingDeviceId(device.assetCode) // always use the canonical assetCode for downstream lookups
        return
      }
    } catch (err) { console.error('[qr-scanner]', err) }
    // Default: go to device detail
    toast.success(`สแกนสำเร็จ: ${assetNo}`, {
      description: 'กำลังเปิดรายละเอียดอุปกรณ์...',
    })
    stopCamera()
    setOpen(false)
    setActivePage('itam-devices')
    setPendingDeviceId(assetNo)
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    const raw = manualInput.trim()
    if (!raw) {
      toast.error('กรุณาใส่รหัสอุปกรณ์')
      return
    }
    const assetNo = parseAssetNo(raw) ?? raw
    // Smart routing (same as QR scan): meter-required → meter entry, else detail
    try {
      const res = await fetch(`/api/itam/devices?assetNo=${encodeURIComponent(assetNo)}&limit=1`)
      if (res.ok) {
        const json = await res.json()
        const device = json.devices && json.devices[0]
        if (device && device.meterRequired) {
          const devName = (device.brand || '') + ' ' + (device.model || '')
          toast.success('ค้นหา: ' + assetNo, {
            description: devName.trim() + ' — ไปหน้าจดมิเตอร์',
          })
          setOpen(false)
          setActivePage('itam-meter-keyboard')
          setPendingDeviceId(assetNo)
          return
        }
      }
    } catch (err) { console.error('[qr-scanner]', err) }
    toast.success(`ค้นหา: ${assetNo}`)
    setOpen(false)
    setActivePage('itam-devices')
    setPendingDeviceId(assetNo)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) stopCamera()
      setOpen(o)
    }}>
      <DialogContent className="max-w-md overflow-hidden p-0 dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Camera className="h-5 w-5 text-[#f97316]" /> สแกน QR Code
          </DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex gap-1 px-4">
          <Button
            type="button"
            size="sm"
            variant={mode === 'camera' ? 'default' : 'outline'}
            onClick={() => setMode('camera')}
            className={mode === 'camera' ? 'bg-[#f97316] text-white hover:bg-[#ea580c]' : ''}
          >
            <Camera className="h-3.5 w-3.5" /> กล้อง
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'manual' ? 'default' : 'outline'}
            onClick={() => setMode('manual')}
            className={mode === 'manual' ? 'bg-[#f97316] text-white hover:bg-[#ea580c]' : ''}
          >
            <Keyboard className="h-3.5 w-3.5" /> ใส่รหัส
          </Button>
        </div>

        <div className="px-4 pb-4 pt-3">
          {mode === 'camera' ? (
            <div className="space-y-3">
              {/* Scanner viewport */}
              <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-slate-900">
                <video
                  ref={videoRef}
                  className="absolute inset-0 h-full w-full object-cover"
                  muted
                  playsInline
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* Orange corner brackets */}
                {cameraReady && (
                  <>
                    <div className="pointer-events-none absolute inset-8">
                      <span className="absolute left-0 top-0 h-8 w-8 border-l-4 border-t-4 border-[#f97316] rounded-tl" />
                      <span className="absolute right-0 top-0 h-8 w-8 border-r-4 border-t-4 border-[#f97316] rounded-tr" />
                      <span className="absolute bottom-0 left-0 h-8 w-8 border-b-4 border-l-4 border-[#f97316] rounded-bl" />
                      <span className="absolute bottom-0 right-0 h-8 w-8 border-b-4 border-r-4 border-[#f97316] rounded-br" />
                      {/* Animated scan line */}
                      {scanning && (
                        <div className="absolute inset-x-2 top-0 h-0.5 animate-[qrscan_2s_ease-in-out_infinite] bg-[#f97316] shadow-[0_0_8px_#f97316]" />
                      )}
                    </div>
                    <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 text-[10px] font-medium text-white">
                      <span className={`h-1.5 w-1.5 rounded-full ${scanning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
                      {scanning ? 'กำลังสแกน...' : 'พร้อม'}
                    </div>
                  </>
                )}

                {/* Overlay message */}
                {!cameraReady && !error && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
                    <Camera className="h-10 w-10 animate-pulse text-slate-500" />
                    <div className="text-xs">กำลังเปิดกล้อง...</div>
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div className="flex-1">{error}</div>
                  <button
                    type="button"
                    onClick={() => setMode('manual')}
                    className="flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 underline dark:text-rose-300"
                  >
                    ใส่รหัสเอง
                  </button>
                </div>
              )}

              {lastScan && !error && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <div className="truncate">สแกนล่าสุด: {lastScan}</div>
                </div>
              )}

              <p className="text-center text-[11px] text-slate-500 dark:text-slate-400">
                <ScanLine className="mb-0.5 mr-1 inline h-3 w-3" />
                ถือ QR ให้ตรงกรอบสีส้ม — ระบบจะสแกนอัตโนมัติเมื่อตรวจจับได้
              </p>
            </div>
          ) : (
            <form onSubmit={handleManualSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  รหัสอุปกรณ์ / Asset No.
                </label>
                <Input
                  autoFocus
                  placeholder="เช่น 100, ITAM-100, หรือวางลิงก์ QR"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  รองรับ: รหัสล้วน · ITAM:100 · https://.../?asset=100 · /itam/devices/100
                </p>
              </div>
              <Button type="submit" className="w-full bg-[#f97316] text-white hover:bg-[#ea580c]">
                ค้นหาอุปกรณ์
              </Button>
            </form>
          )}
        </div>

        <DialogFooter className="border-t border-slate-100 px-4 py-2 dark:border-slate-800">
          <Button variant="ghost" size="sm" onClick={() => { stopCamera(); setOpen(false) }}>
            <X className="h-4 w-4" /> ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
