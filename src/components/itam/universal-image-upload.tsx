'use client'

/**
 * UniversalImageUpload — single component that handles both:
 *
 *   1. CAMERA   — capture from device camera (uses CameraCapture internally)
 *   2. GALLERY  — upload from device photo library / file picker
 *
 * Used wherever images need to be attached:
 *   - WorkOrder: picBefore / picOnsite / picAfter (3 stages)
 *   - WorkOrder: complete dialog (resolution image)
 *   - DeviceDetailSheet: device photos
 *   - StockItem: product photo
 *   - Mobile Mode: all 4 screens (repair / meter / stock / my-work)
 *
 * UX:
 *   - Two big buttons side by side: [📷 ถ่ายภาพ] [🖼️ เลือกจากคลัง]
 *   - "ถ่ายภาพ" opens camera overlay (rear camera, captures JPEG)
 *   - "เลือกจากคลัง" opens file picker (accept="image/*")
 *   - Multiple mode: shows thumbnail grid with delete buttons
 *   - Single mode: shows single thumbnail with replace/remove
 *   - Touch-friendly: every button is h-11 (44px minimum)
 *
 * Compression:
 *   - Camera: max 1024px wide, JPEG quality 0.7
 *   - Gallery: max 1280px wide, JPEG quality 0.8
 *   - Both use canvas drawImage + toDataURL for in-browser resize
 *
 * Props:
 *   - value: string | string[] (depending on `multiple`)
 *   - onChange: callback with new value
 *   - multiple: allow multiple images (default false)
 *   - maxImages: cap on number of images in multiple mode (default 6)
 *   - label: optional label above buttons
 *   - className: extra classes
 */

import * as React from 'react'
import { Camera, Image as ImageIcon, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { compressImageToDataUrl } from '@/lib/client-image-compress'

interface UniversalImageUploadProps {
  value: string | string[]
  onChange: (value: string | string[]) => void
  multiple?: boolean
  maxImages?: number
  label?: string
  className?: string
  disabled?: boolean
}

interface CameraOverlayProps {
  onCapture: (dataUrl: string) => void
  onClose: () => void
}

export function UniversalImageUpload({
  value,
  onChange,
  multiple = false,
  maxImages = 6,
  label,
  className,
  disabled = false,
}: UniversalImageUploadProps) {
  const [cameraOpen, setCameraOpen] = React.useState(false)
  const [galleryLoading, setGalleryLoading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const images: string[] = Array.isArray(value) ? value : value ? [value] : []

  function setImages(newImages: string[]) {
    if (multiple) {
      onChange(newImages.slice(0, maxImages))
    } else {
      onChange(newImages[0] ?? '')
    }
  }

  function addImage(dataUrl: string) {
    if (multiple) {
      if (images.length >= maxImages) return
      setImages([...images, dataUrl])
    } else {
      setImages([dataUrl])
    }
  }

  function removeImage(idx: number) {
    setImages(images.filter((_, i) => i !== idx))
  }

  function openGallery() {
    fileInputRef.current?.click()
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setGalleryLoading(true)
    try {
      const files = Array.from(e.target.files ?? [])
      const imageFiles = files.filter((f) => f.type.startsWith('image/'))
      for (const file of imageFiles) {
        if (multiple && images.length >= maxImages) break
        // SPRINT-1 #3: use browser-image-compression (target 50KB) instead
        // of canvas resize (which produced ~1MB JPEGs). 20× smaller uploads.
        const dataUrl = await compressImageToDataUrl(file, { maxSizeMB: 0.05 })
        addImage(dataUrl)
      }
    } catch (err) {
      console.error('Image upload error:', err)
    } finally {
      setGalleryLoading(false)
      // Reset input so selecting the same file again still fires onChange
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className={cn('w-full', className)}>
      {label && <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCameraOpen(true)}
          disabled={disabled || (multiple && images.length >= maxImages)}
          className="h-11 flex-1"
        >
          <Camera className="mr-2 h-4 w-4" />
          ถ่ายภาพ
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openGallery}
          disabled={disabled || (multiple && images.length >= maxImages)}
          className="h-11 flex-1"
        >
          {galleryLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="mr-2 h-4 w-4" />
          )}
          เลือกจากคลัง
        </Button>
      </div>

      {/* Hidden file input for gallery uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        capture={undefined}
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Preview thumbnails */}
      {images.length > 0 && (
        <div className={cn('mt-3 grid gap-2', multiple ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-1')}>
          {images.map((img, idx) => (
            <div
              key={idx}
              className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
            >
              <img
                src={img}
                alt={`รูปที่ ${idx + 1}`}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                aria-label={`ลบรูปที่ ${idx + 1}`}
              >
                <X className="h-3 w-3" />
              </button>
              {multiple && (
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {idx + 1}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Counter for multiple mode */}
      {multiple && images.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {images.length} / {maxImages} รูป
        </p>
      )}

      {/* Camera overlay */}
      {cameraOpen && (
        <CameraOverlay
          onCapture={(dataUrl) => {
            addImage(dataUrl)
            setCameraOpen(false)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// CameraOverlay — fullscreen camera for taking a photo
// ─────────────────────────────────────────────────────────────
function CameraOverlay({ onCapture, onClose }: CameraOverlayProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง')
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
          setReady(true)
        }
      } catch (err) {
        setError('ไม่สามารถเปิดกล้องได้ ตรวจสอบการอนุญาตใช้งานกล้อง')
      }
    }

    start()
    return () => {
      cancelled = true
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  function capture() {
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
    // Downscale to max 1024px wide, JPEG 0.7
    const maxW = 1024
    const scale = w > maxW ? maxW / w : 1
    const targetW = Math.round(w * scale)
    const targetH = Math.round(h * scale)
    const downCanvas = document.createElement('canvas')
    downCanvas.width = targetW
    downCanvas.height = targetH
    const downCtx = downCanvas.getContext('2d')
    if (!downCtx) return
    downCtx.drawImage(canvas, 0, 0, targetW, targetH)
    const dataUrl = downCanvas.toDataURL('image/jpeg', 0.7)
    onCapture(dataUrl)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between p-4 text-white">
        <span className="text-sm font-medium">ถ่ายภาพ</span>
        <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="ปิด">
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div>
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={onClose}>
                ปิด
              </Button>
            </div>
          </div>
        )}
      </div>
      {!error && (
        <div className="bg-black p-4">
          <Button onClick={capture} className="w-full" size="lg" disabled={!ready}>
            <Camera className="mr-2 h-5 w-5" />
            {ready ? 'ถ่ายภาพ' : 'กำลังเปิดกล้อง...'}
          </Button>
        </div>
      )}
    </div>
  )
}

// NOTE (SPRINT-1 #3): the old `resizeImage` helper using canvas has been
// removed. Compression is now handled by `compressImageToDataUrl` from
// `@/lib/client-image-compress` which uses `browser-image-compression`
// (target 50KB instead of ~1MB — 20× smaller uploads).

export default UniversalImageUpload
