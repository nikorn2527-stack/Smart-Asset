'use client'

import * as React from 'react'
import { Camera, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CameraCaptureProps {
  onCapture: (dataUrl: string) => void
  className?: string
  label?: string
}

/**
 * CameraCapture — a reusable button that opens the device camera and lets
 * the user take a photo. Returns the captured image as a JPEG data URL via
 * the `onCapture` callback (so it can feed into the same handler as a file
 * upload button). Designed to sit next to existing file inputs.
 *
 * Uses getUserMedia with `facingMode: 'environment'` (rear camera on mobile).
 * Captures at up to 1280×720, then downscales to max 1024px wide JPEG @ 0.7.
 */
export function CameraCapture({ onCapture, className, label = 'ถ่ายภาพ' }: CameraCaptureProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function startCamera() {
    setError(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง (getUserMedia ไม่พร้อมใช้งาน)')
        setOpen(true)
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setOpen(true)
    } catch (err) {
      setError('ไม่สามารถเปิดกล้องได้ ตรวจสอบการอนุญาตใช้งานกล้อง')
      setOpen(true)
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setOpen(false)
  }

  async function capture() {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    // SPRINT-1 #3: instead of canvas.toDataURL('image/jpeg', 0.7) which
    // produces ~500KB-1MB photos, convert to a File and run through
    // browser-image-compression (target 50KB). 20× smaller uploads.
    try {
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
      )
      if (blob) {
        const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' })
        const { compressImageToDataUrl } = await import('@/lib/client-image-compress')
        const dataUrl = await compressImageToDataUrl(file, { maxSizeMB: 0.05 })
        onCapture(dataUrl)
      } else {
        // Fallback to direct toDataURL if toBlob fails
        onCapture(canvas.toDataURL('image/jpeg', 0.7))
      }
    } catch (err) {
      console.warn('[camera-capture] compression failed, using raw canvas:', err)
      onCapture(canvas.toDataURL('image/jpeg', 0.7))
    }
    stopCamera()
  }

  // Cleanup stream on unmount
  React.useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  if (open) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col bg-black">
        <div className="flex items-center justify-between p-4">
          <span className="text-white text-sm">{label}</span>
          <Button size="icon" variant="ghost" onClick={stopCamera} className="text-white hover:bg-white/10" aria-label="ปิดกล้อง">
            <X className="h-5 w-5" />
          </Button>
        </div>
        {error ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-white">
            <div>
              <p className="mb-4">{error}</p>
              <Button onClick={startCamera}>ลองอีกครั้ง</Button>
            </div>
          </div>
        ) : (
          <>
            <video ref={videoRef} muted autoPlay playsInline className="flex-1 object-contain" />
            <canvas ref={canvasRef} className="hidden" />
            <div className="p-6">
              <Button onClick={capture} className="w-full" size="lg">
                <Camera className="mr-2 h-5 w-5" /> ถ่ายภาพ
              </Button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={startCamera} className={className}>
      <Camera className="mr-1.5 h-4 w-4" /> {label}
    </Button>
  )
}
