'use client'

/**
 * UniversalSearch — single search input that supports 3 input modes:
 *
 *   1. TYPE   — manual text entry (default, like a normal search box)
 *   2. SCAN   — QR/barcode scanner via camera (uses jsQR for QR, native BarcodeDetector if available)
 *   3. OCR    — camera capture + Tesseract.js text recognition (read text from a photo)
 *
 * The component is "context-aware" — the parent passes `searchType` so the
 * placeholder + result mapping can be tailored (e.g. "asset_no", "productCode",
 * "woNumber", "serialNumber").
 *
 * Designed for:
 *   - Devices page: search by asset_no / serialNumber / brand+model
 *   - Stock page: search by productCode / productName
 *   - WorkOrders page: search by woNumber / subject / assetCode
 *   - Meter page: search by asset_no (for device lookup)
 *
 * UX:
 *   - Input row with 3 buttons: [TYPE] [SCAN] [OCR]
 *   - Active mode is highlighted
 *   - SCAN/OCR open a fullscreen camera overlay
 *   - On scan/OCR success → fills the input + calls onSearch(value)
 *   - Touch-friendly: input h-11, buttons h-11 (44px minimum)
 *
 * Privacy:
 *   - Camera stream is local-only (no upload)
 *   - OCR runs in-browser via Tesseract.js (no image leaves the device)
 *   - Stream is stopped + tracks ended on close
 *
 * Performance:
 *   - Tesseract.js is loaded lazily (only when OCR mode is activated)
 *   - QR scanning uses jsQR (lightweight, ~30KB)
 *   - BarcodeDetector used if browser supports it (Chrome Android)
 */

import * as React from 'react'
import { Search, QrCode, ScanLine, X, Loader2, Camera, Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type SearchMode = 'type' | 'scan' | 'ocr'

export type SearchContext =
  | 'asset_no'
  | 'serialNumber'
  | 'productCode'
  | 'productName'
  | 'woNumber'
  | 'subject'
  | 'generic'

interface UniversalSearchProps {
  /** Current search value */
  value: string
  /** Callback when value changes (debounced) */
  onChange: (value: string) => void
  /** Submit callback (Enter or scan success) */
  onSubmit?: (value: string) => void
  /** What we're searching for — controls placeholder + hints */
  context?: SearchContext
  /** Initial mode (default: 'type') */
  initialMode?: SearchMode
  /** Placeholder override */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Class name */
  className?: string
}

const CONTEXT_LABEL: Record<SearchContext, string> = {
  asset_no: 'เลขสินทรัพย์ / Asset No.',
  serialNumber: 'หมายเลขซีเรียล / Serial Number',
  productCode: 'รหัสสินค้า / Product Code',
  productName: 'ชื่อสินค้า / Product Name',
  woNumber: 'เลขใบแจ้งซ่อม / WO Number',
  subject: 'หัวข้อ / Subject',
  generic: 'ค้นหา',
}

const CONTEXT_HINT: Record<SearchContext, string> = {
  asset_no: 'สแกน QR สติกเกอร์ หรือพิมพ์เลขสินทรัพย์ (เช่น UDH-00001)',
  serialNumber: 'สแกนบาร์โค้ดซีเรียล หรือพิมพ์หมายเลข',
  productCode: 'สแกนบาร์โค้ดสินค้า หรือพิมพ์รหัส (เช่น B0001)',
  productName: 'พิมพ์ชื่อสินค้า (เช่น น้ำหมึก)',
  woNumber: 'พิมพ์เลขใบแจ้งซ่อม (เช่น WO-2026-001)',
  subject: 'พิมพ์หัวข้อปัญหา',
  generic: 'พิมพ์คำค้นหา หรือสแกน QR/บาร์โค้ด',
}

export function UniversalSearch({
  value,
  onChange,
  onSubmit,
  context = 'generic',
  initialMode = 'type',
  placeholder,
  disabled = false,
  className,
}: UniversalSearchProps) {
  const [mode, setMode] = React.useState<SearchMode>(initialMode)
  const [cameraOpen, setCameraOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const labelText = placeholder ?? `${CONTEXT_LABEL[context]}...`
  const hintText = CONTEXT_HINT[context]

  function handleScanSuccess(result: string) {
    onChange(result)
    onSubmit?.(result)
    setCameraOpen(false)
    setMode('type')
    // Refocus input so user can edit if needed
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit?.(value)
  }

  function handleClear() {
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <div className={cn('w-full', className)}>
      <form onSubmit={handleSubmit} className="flex gap-2">
        {/* Input + clear button */}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            inputMode={context === 'asset_no' || context === 'serialNumber' || context === 'productCode' || context === 'woNumber' ? 'text' : 'search'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={labelText}
            disabled={disabled}
            className="h-11 pl-10 pr-10"
            aria-label={CONTEXT_LABEL[context]}
          />
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="ล้างคำค้นหา"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Mode toggle: TYPE / SCAN / OCR */}
        <div className="flex gap-1 rounded-md border bg-muted/40 p-1">
          <ModeButton
            active={mode === 'type'}
            onClick={() => setMode('type')}
            icon={<Keyboard className="h-4 w-4" />}
            label="พิมพ์"
          />
          <ModeButton
            active={mode === 'scan'}
            onClick={() => {
              setMode('scan')
              setCameraOpen(true)
            }}
            icon={<QrCode className="h-4 w-4" />}
            label="สแกน"
            disabled={disabled}
          />
          <ModeButton
            active={mode === 'ocr'}
            onClick={() => {
              setMode('ocr')
              setCameraOpen(true)
            }}
            icon={<ScanLine className="h-4 w-4" />}
            label="อ่าน"
            disabled={disabled}
          />
        </div>
      </form>

      {/* Context hint */}
      <p className="mt-1 text-xs text-muted-foreground">{hintText}</p>

      {/* Camera overlay (SCAN or OCR) */}
      {cameraOpen && (
        <SearchCamera
          mode={mode}
          onClose={() => {
            setCameraOpen(false)
            setMode('type')
          }}
          onSuccess={handleScanSuccess}
          context={context}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mode toggle button (TYPE / SCAN / OCR)
// ─────────────────────────────────────────────────────────────
function ModeButton({
  active,
  onClick,
  icon,
  label,
  disabled,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-9 items-center gap-1 rounded px-2.5 text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      aria-pressed={active}
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// SearchCamera — fullscreen camera overlay for SCAN or OCR
// ─────────────────────────────────────────────────────────────
function SearchCamera({
  mode,
  onClose,
  onSuccess,
  context,
}: {
  mode: SearchMode
  onClose: () => void
  onSuccess: (value: string) => void
  context: SearchContext
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [status, setStatus] = React.useState<string>('กำลังเปิดกล้อง...')

  // SCAN mode: continuously check frames for QR/barcode
  // OCR mode: capture one photo + run Tesseract.js
  React.useEffect(() => {
    let cancelled = false

    async function start() {
      setError(null)
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง (getUserMedia ไม่พร้อมใช้งาน)')
          return
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
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
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setStatus(mode === 'scan' ? 'นำ QR/บาร์โค้ดเข้ากรอบเพื่อสแกนอัตโนมัติ' : 'กดปุ่ม "อ่านข้อความ" เมื่อพร้อม')
        if (mode === 'scan') {
          // Start scan loop
          scanLoop()
        }
      } catch (err) {
        setError('ไม่สามารถเปิดกล้องได้ ตรวจสอบการอนุญาตใช้งานกล้องในเบราว์เซอร์')
      }
    }

    async function scanLoop() {
      if (cancelled) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(scanLoop)
        return
      }
      const w = video.videoWidth
      const h = video.videoHeight
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        rafRef.current = requestAnimationFrame(scanLoop)
        return
      }
      ctx.drawImage(video, 0, 0, w, h)

      // Try BarcodeDetector first (native, fast, on Chrome Android)
      type BarcodeDetectorCtor = new (opts: { formats: string[] }) => { detect: (src: CanvasRenderingContext2D | HTMLCanvasElement | ImageBitmap | VideoFrame) => Promise<Array<{ rawValue?: string }>> }
      const BarcodeDetectorAny = (window as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
      if (BarcodeDetectorAny) {
        try {
          const detector = new BarcodeDetectorAny({
            formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'],
          })
          const codes = await detector.detect(canvas)
          if (codes && codes.length > 0) {
            const value = codes[0].rawValue
            if (value) {
              cleanup()
              onSuccess(value)
              return
            }
          }
        } catch {
          // Fall through to jsQR
        }
      }

      // jsQR fallback for QR codes
      try {
        const { default: jsQR } = await import('jsqr')
        const imageData = ctx.getImageData(0, 0, w, h)
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        })
        if (code && code.data) {
          cleanup()
          onSuccess(code.data)
          return
        }
      } catch {
        // jsQR not loaded yet — retry next frame
      }

      rafRef.current = requestAnimationFrame(scanLoop)
    }

    function cleanup() {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }

    start()
    return () => {
      cancelled = true
      cleanup()
    }
  }, [mode])

  async function runOcr() {
    setLoading(true)
    setStatus('กำลังประมวลผลข้อความ...')
    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) return
      const w = video.videoWidth
      const h = video.videoHeight
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, w, h)

      // Lazy-load Tesseract.js (so the main bundle stays small)
      const { default: Tesseract } = await import('tesseract.js')
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
      const result = await Tesseract.recognize(dataUrl, 'tha+eng', {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') {
            setStatus(`กำลังอ่านข้อความ... ${Math.round(m.progress * 100)}%`)
          }
        },
      })
      const text = result.data.text.trim()
      if (text) {
        // Take the first non-empty line — usually the relevant identifier
        const firstLine = text.split('\n').map((s: string) => s.trim()).find((s: string) => s.length > 0)
        onSuccess(firstLine ?? text)
      } else {
        setStatus('ไม่พบข้อความในภาพ ลองถ่ายใหม่อีกครั้ง')
      }
    } catch (err) {
      setError('OCR ล้มเหลว: ' + (err instanceof Error ? err.message : String(err)))
      setStatus('ลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  function handleCapturePhoto() {
    if (mode === 'ocr') {
      runOcr()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between p-4 text-white">
        <div className="flex items-center gap-2">
          {mode === 'scan' ? <QrCode className="h-5 w-5" /> : <ScanLine className="h-5 w-5" />}
          <span className="text-sm font-medium">
            {mode === 'scan' ? 'สแกน QR/บาร์โค้ด' : 'อ่านข้อความจากกล้อง (OCR)'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label="ปิดกล้อง"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Video preview */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Scan frame overlay (only in scan mode) */}
        {mode === 'scan' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-48 w-48 border-2 border-white/80 rounded-lg">
              <div className="h-full w-full animate-pulse bg-white/5" />
            </div>
          </div>
        )}

        {/* Status text */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-center text-xs text-white backdrop-blur">
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              {status}
            </span>
          ) : (
            status
          )}
        </div>

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center">
            <div className="max-w-sm">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={onClose}>
                ปิด
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons (OCR mode shows capture button) */}
      {mode === 'ocr' && !loading && !error && (
        <div className="bg-black p-4">
          <Button
            onClick={handleCapturePhoto}
            className="w-full"
            size="lg"
            disabled={loading}
          >
            <Camera className="mr-2 h-5 w-5" />
            อ่านข้อความ
          </Button>
          <p className="mt-2 text-center text-xs text-white/60">
            ภาพจะถูกประมวลผลในเครื่องเท่านั้น (ไม่ส่งไปเซิร์ฟเวอร์)
          </p>
        </div>
      )}

      {/* Scan mode hint */}
      {mode === 'scan' && (
        <div className="bg-black p-4">
          <p className="text-center text-xs text-white/60">
            สแกนอัตโนมัติเมื่อ QR/บาร์โค้ดอยู่ในกรอบ
          </p>
        </div>
      )}
    </div>
  )
}

export default UniversalSearch
