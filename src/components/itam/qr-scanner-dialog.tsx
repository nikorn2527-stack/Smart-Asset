'use client'

import * as React from 'react'
import jsQR from 'jsqr'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScanLine, Camera, CameraOff, RefreshCw, Keyboard } from 'lucide-react'
import { useAppStore } from '@/store/app-store'

/**
 * Global QR / Barcode scanner dialog.
 *
 * Mount once at the app root. Other pages open it via
 * `useAppStore.getState().setQrScannerOpen(true)`. When a code is detected
 * (either via camera + jsQR or manual entry) the value is published via
 * `publishQrScan(value)`. Consumers should subscribe to `qrScanNonce` (not
 * `lastQrScan`) in their effect deps so they react to repeated scans of the
 * same value.
 *
 * Uses `getUserMedia` to capture the back camera (`facingMode: 'environment'`)
 * and runs jsQR on each frame. Supports a manual-entry fallback for browsers
 * / devices where camera access is unavailable or denied.
 */
export interface QrScannerDialogProps {
  /** Controlled open state — if provided, overrides global store */
  open?: boolean
  /** Called when dialog should close */
  onOpenChange?: (open: boolean) => void
  /** Called when a QR/barcode is scanned — if provided, overrides global store */
  onScan?: (value: string) => void
  /**
   * Optional dialog heading override. Callers (e.g. the accessory-sticker and
   * transfer flows) pass a context-specific label so the user knows what they
   * are meant to scan. Falls back to the default "สแกน QR / บาร์โค้ด".
   */
  title?: string
}

export function QrScannerDialog(props?: QrScannerDialogProps) {
  // Support both controlled (props) and uncontrolled (global store) modes
  const storeOpen = useAppStore((s) => s.qrScannerOpen)
  const storeSetOpen = useAppStore((s) => s.setQrScannerOpen)
  const publishQrScan = useAppStore((s) => s.publishQrScan)

  const open = props?.open ?? storeOpen
  const setOpen = (v: boolean) => {
    if (props?.onOpenChange) props.onOpenChange(v)
    else storeSetOpen(v)
  }

  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const stoppedRef = React.useRef(false)

  const [cameraReady, setCameraReady] = React.useState(false)
  const [cameraError, setCameraError] = React.useState<string | null>(null)
  const [manualMode, setManualMode] = React.useState(false)
  const [manualValue, setManualValue] = React.useState('')
  const [starting, setStarting] = React.useState(false)

  async function startCamera() {
    setStarting(true)
    setCameraError(null)
    setCameraReady(false)
    stoppedRef.current = false
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('เบราว์เซอร์นี้ไม่รองรับการเข้าถึงกล้อง')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        video.setAttribute('playsinline', 'true')
        await video.play()
        setCameraReady(true)
        tick()
      }
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === 'NotAllowedError'
            ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์'
            : e.name === 'NotFoundError'
              ? 'ไม่พบกล้องในอุปกรณ์นี้'
              : e.message
          : 'เปิดกล้องไม่สำเร็จ'
      setCameraError(msg)
      setManualMode(true)
    } finally {
      setStarting(false)
    }
  }

  function stopCamera() {
    stoppedRef.current = true
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop()
        } catch (err) { console.error('[qr-scanner-dialog]', err) }
      }
      streamRef.current = null
    }
    const video = videoRef.current
    if (video) video.srcObject = null
    setCameraReady(false)
  }

  function tick() {
    if (stoppedRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const w = video.videoWidth
      const h = video.videoHeight
      if (w > 0 && h > 0) {
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h)
          try {
            const imageData = ctx.getImageData(0, 0, w, h)
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert',
            })
            if (code && code.data) {
              handleScan(code.data)
              return
            }
          } catch (err) { console.error('[qr-scanner-dialog]', err) }
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function handleScan(value: string) {
    const v = value.trim()
    if (!v) return
    stopCamera()
    if (props?.onScan) {
      props.onScan(v)
    } else {
      publishQrScan(v)
    }
    setOpen(false)
    toast.success(`สแกนสำเร็จ: ${v.length > 60 ? v.slice(0, 60) + '…' : v}`)
  }

  function handleManualSubmit() {
    const v = manualValue.trim()
    if (!v) {
      toast.error('กรุณาพิมพ์ค่าที่สแกน')
      return
    }
    setManualValue('')
    if (props?.onScan) {
      props.onScan(v)
    } else {
      publishQrScan(v)
    }
    setOpen(false)
    toast.success(`ส่งค่า: ${v.length > 60 ? v.slice(0, 60) + '…' : v}`)
  }

  // Start camera when the dialog opens; stop when it closes.
  React.useEffect(() => {
    if (open) {
      setManualMode(false)
      setManualValue('')
      void startCamera()
    } else {
      stopCamera()
    }
  }, [open])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => stopCamera()
  }, [])

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) stopCamera()
        setOpen(v)
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-orange-500" />
            {props?.title ?? 'สแกน QR / บาร์โค้ด'}
          </DialogTitle>
          <DialogDescription>
            ถือกล้องไปยัง QR Code หรือบาร์โค้ด — ระบบจะอ่านค่าอัตโนมัติ
            หากใช้กล้องไม่ได้สามารถพิมพ์เองได้
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!manualMode ? (
            <div className="space-y-2">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-black">
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                />
                {/* Scan frame overlay */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-2/3 w-2/3 rounded-lg border-2 border-orange-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                </div>
                {!cameraReady && !cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
                    {starting ? (
                      <>
                        <RefreshCw className="h-6 w-6 animate-spin" />
                        <span className="text-xs">กำลังเปิดกล้อง…</span>
                      </>
                    ) : (
                      <>
                        <Camera className="h-6 w-6" />
                        <span className="text-xs">กำลังเตรียมกล้อง…</span>
                      </>
                    )}
                  </div>
                )}
                {cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/80 p-4 text-center text-white/90">
                    <CameraOff className="h-6 w-6 text-rose-400" />
                    <span className="text-xs">{cameraError}</span>
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  ระบบจะตรวจจับ QR/บาร์โค้ดอัตโนมัติเมื่อเห็นชัด
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={startCamera}
                    disabled={starting}
                  >
                    <RefreshCw
                      className={starting ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
                    />
                    เปิดกล้องใหม่
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setManualMode(true)}
                  >
                    <Keyboard className="h-3.5 w-3.5" />
                    พิมพ์เอง
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid gap-1.5">
                <Label htmlFor="qr-manual">พิมพ์ค่า QR / บาร์โค้ด</Label>
                <Input
                  id="qr-manual"
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder="เช่น Asset-001, WO-20250101-001"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleManualSubmit()
                    }
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setManualMode(false)
                    void startCamera()
                  }}
                >
                  <Camera className="h-3.5 w-3.5" />
                  ใช้กล้อง
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleManualSubmit}
                  disabled={!manualValue.trim()}
                  className="bg-orange-500 hover:bg-orange-600"
                >
                  ส่งค่า
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
