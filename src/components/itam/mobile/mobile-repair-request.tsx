'use client'

/**
 * MobileRepairRequest — mobile-first "แจ้งซ่อม" (Repair Request) screen.
 *
 * Flow:
 *   1. Quick search device by asset code or serial number.
 *   2. Pick a device from the dropdown results.
 *   3. Fill the repair form:
 *        - Subject      (required)
 *        - Description  (required)
 *        - Priority     (low / medium / high / urgent → mapped to Thai)
 *        - Photo(s)     (camera capture, up to 4 images)
 *   4. Submit → POST /api/work-orders (Bearer token attached by the global
 *      fetch interceptor in app/page.tsx).
 *   5. Success screen with the returned WorkOrder number.
 *
 * Touch targets: every button/select is ≥44px (size lg, h-12, etc).
 *
 * Responsive: full-width on phones (max-w-md wrapper from the shell);
 * `max-h-72 overflow-y-auto` on the search results list so it never pushes
 * the form below the fold.
 *
 * Accessibility:
 *   - All inputs have <Label> (with htmlFor) + aria-required.
 *   - Touch-friendly hit areas.
 *   - Error messages announced via role="alert".
 *   - Loading state has aria-busy + a spinner.
 *
 * API contract (POST /api/work-orders, see src/app/api/work-orders/route.ts):
 *   Request body:
 *     {
 *       subject: string,                 // required (validated server-side)
 *       details: string | null,          // optional but enforced on the client
 *       priority: 'ปกติ' | 'ปานกลาง' | 'สูง' | 'ด่วน',
 *       deviceId: string | null,
 *       building: string | null,
 *       location: string | null,
 *       picBeforeImages: string[],      // base64 data URLs (max 9 server-side)
 *       submissionSource: 'session',    // logged-in staff flow → skip guest validation
 *       reporterName?: string | null,
 *       actor?: string,
 *     }
 *   Response 201: { data: WorkOrder }  // data.woNumber is what we display
 *
 * Device search (GET /api/devices?search=Q) returns:
 *   { devices: Device[], total, page, limit, totalPages }
 * — already authorized via the Bearer interceptor; non-superadmin users
 *   only see their Site-scoped devices (server-side).
 */

import * as React from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import {
  Search,
  X,
  Loader2,
  Camera,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  RotateCcw,
  FileText,
  Image as ImageIcon,
  Trash2,
  ScanLine,
  Building2,
  Printer,
  QrCode,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth-store'
import { useKeyboardAware } from '@/hooks/use-keyboard-aware'
import { addToQueue } from '@/lib/offline-queue'

// ── Types ─────────────────────────────────────────────────────────────

interface DeviceLite {
  id: string
  assetCode: string
  name: string
  brand: string | null
  model: string | null
  type: string | null
  site: string | null
  building: string | null
  location: string | null
  serialNumber: string | null
  status?: string | null
}

type PriorityKey = 'low' | 'medium' | 'high' | 'urgent'

interface PriorityOption {
  key: PriorityKey
  label: string
  /** Value sent to the API (existing schema uses Thai labels). */
  value: string
  /** Tailwind classes for the button (idle / active). */
  activeClass: string
}

const PRIORITIES: PriorityOption[] = [
  { key: 'low',    label: 'ปกติ',     value: 'ปกติ',     activeClass: 'bg-emerald-500 text-white border-emerald-500' },
  { key: 'medium', label: 'ปานกลาง',  value: 'ปานกลาง',  activeClass: 'bg-amber-500 text-white border-amber-500' },
  { key: 'high',   label: 'สูง',      value: 'สูง',      activeClass: 'bg-orange-500 text-white border-orange-500' },
  { key: 'urgent', label: 'ด่วน',     value: 'ด่วน',     activeClass: 'bg-rose-500 text-white border-rose-500' },
]

const MAX_IMAGES = 4

// ── Component ─────────────────────────────────────────────────────────

export function MobileRepairRequest() {
  // ── Device search state ──
  const [searchTerm, setSearchTerm] = React.useState('')
  const [searching, setSearching] = React.useState(false)
  const [results, setResults] = React.useState<DeviceLite[]>([])
  const [searchError, setSearchError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<DeviceLite | null>(null)
  const [showResults, setShowResults] = React.useState(false)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultsRef = React.useRef<HTMLDivElement>(null)

  // ── Form state ──
  const [subject, setSubject] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [remark, setRemark] = React.useState('')
  const [otherDetail, setOtherDetail] = React.useState('') // for "อื่นๆ" selection
  const [priority, setPriority] = React.useState<PriorityKey>('medium')
  const [images, setImages] = React.useState<string[]>([]) // base64 data URLs
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [successWoNumber, setSuccessWoNumber] = React.useState<string | null>(null)

  // ── Camera capture (re-uses the project's CameraCapture pattern inline
  //    so we can keep the full-screen overlay consistent with the rest of
  //    the app and avoid pulling another dep into the mobile bundle). ──
  const [cameraOpen, setCameraOpen] = React.useState(false)
  const [qrScanOpen, setQrScanOpen] = React.useState(false)
  const [problemCategories, setProblemCategories] = React.useState<{ id: string; label: string; group?: string }[]>([])
  const [subjectOptions, setSubjectOptions] = React.useState<{ id?: string; value: string; default_priority?: string; group?: string }[]>([])
  const [selectedSubjects, setSelectedSubjects] = React.useState<string[]>([])
  const [buildingOptions, setBuildingOptions] = React.useState<{ id: string; label: string; group?: string }[]>([])
  const [isExternal, setIsExternal] = React.useState(false)
  const [externalClientName, setExternalClientName] = React.useState('')
  const [externalScannedCode, setExternalScannedCode] = React.useState('')
  const [externalPhone, setExternalPhone] = React.useState('')
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const cameraInputRef = React.useRef<HTMLInputElement>(null)

  // ── Auth-aware reporter info (for submissionSource='session') ──
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)

  // Helper: get auth headers for fetch
  function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  }

  // ── Fetch problem categories from /api/settings/options (same as desktop WO) ──
  React.useEffect(() => {
    async function loadCategories() {
      try {
        const res = await fetch('/api/settings/options', {
          headers: getAuthHeaders(),
        })
        if (!res.ok) return
        const data = await res.json()
        // data.subjects = [{ id, group, value, default_priority }]
        const subjects = data.subjects ?? []
        setProblemCategories(
          subjects.map((s: { id?: string; value: string; group?: string }) => ({
            id: s.id ?? s.value,
            label: s.value,
            group: s.group,
          }))
        )
        // Also load priorities from subjects (auto-set when selecting)
        if (subjects.length > 0) {
          setSubjectOptions(subjects)
        }
        // Load building options (from same API)
        const buildings = data.buildings ?? []
        setBuildingOptions(
          buildings.map((b: { id?: string; value: string; group?: string }) => ({
            id: b.id ?? b.value,
            label: b.value,
            group: b.group,
          }))
        )
      } catch {
        // If fetch fails, keep empty → fallback to text input
      }
    }
    loadCategories()
  }, [])

  // ── Search effect (debounced 200ms — faster response) ──
  React.useEffect(() => {
    if (selected) return // do not re-search while a device is selected
    const q = searchTerm.trim()
    if (q.length < 1) {
      setResults([])
      setSearchError(null)
      setShowResults(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      setShowResults(true)
      try {
        // Use search API with suffix-aware matching (short numeric → suffix first)
        // type=devices → skip masters query for faster response
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=devices`, {
          headers: getAuthHeaders(),
        })
        if (!res.ok) {
          // Fallback to devices endpoint
          const params = new URLSearchParams({ search: q, limit: '10' })
          const fallbackRes = await fetch(`/api/devices?${params.toString()}`, {
            headers: getAuthHeaders(),
          })
          if (!fallbackRes.ok) {
            const j = await fallbackRes.json().catch(() => ({}))
            throw new Error(j.error ?? 'ค้นหาไม่สำเร็จ')
          }
          const json = (await fallbackRes.json()) as { devices?: DeviceLite[] }
          setResults((json.devices ?? []).slice(0, 8))
          return
        }
        const data = await res.json()
        const searchResults = data.results?.devices ?? []
        // Fetch full device details for each search result (to get brand, model, type, etc.)
        const fullDevices = await Promise.all(
          searchResults.slice(0, 8).map(async (d: { id: string; title: string; subtitle: string }) => {
            try {
              const detailRes = await fetch(`/api/devices/${d.id}`, { headers: getAuthHeaders() })
              if (detailRes.ok) {
                const detail = await detailRes.json()
                const dev = detail.device ?? detail
                return {
                  id: dev.id ?? d.id,
                  assetCode: dev.assetCode ?? '',
                  name: dev.name ?? '',
                  brand: dev.brand ?? null,
                  model: dev.model ?? null,
                  type: dev.type ?? null,
                  site: dev.site ?? null,
                  building: dev.building ?? null,
                  location: dev.location ?? null,
                  serialNumber: dev.serialNumber ?? null,
                  status: dev.status ?? null,
                } as DeviceLite
              }
            } catch { /* ignore — use basic info */ }
            // Fallback: parse from search result
            const titleParts = d.title.split(' · ')
            const subtitle = d.subtitle || ''
            let serialNumber = ''
            let site = ''
            if (subtitle.includes('S/N:')) {
              serialNumber = subtitle.split('S/N:')[1]?.split('|')[0]?.trim() ?? ''
              const afterPipe = subtitle.split('|')[1]?.trim() ?? ''
              site = afterPipe.split('·').pop()?.trim() ?? ''
            }
            return {
              id: d.id,
              assetCode: titleParts[0] ?? '',
              name: titleParts.slice(1).join(' · ') ?? '',
              brand: null,
              model: null,
              type: null,
              site,
              building: null,
              location: null,
              serialNumber,
              status: null,
            } as DeviceLite
          })
        )
        setResults(fullDevices.filter(Boolean))
      } catch (e) {
        setResults([])
        setSearchError(e instanceof Error ? e.message : 'ค้นหาไม่สำเร็จ')
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchTerm, selected])

  // ── Click-outside to close results dropdown ──
  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (resultsRef.current && !resultsRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // ── Camera control ──
  async function openCamera() {
    if (cameraOpen) return
    if (images.length >= MAX_IMAGES) {
      toast.error(`เพิ่มรูปได้สูงสุด ${MAX_IMAGES} รูป`)
      return
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error('เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOpen(true)
      // Wait a tick for the video element to mount, then attach the stream
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      }, 50)
    } catch {
      toast.error('ไม่สามารถเปิดกล้องได้ ตรวจสอบสิทธิ์การใช้งาน')
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCameraOpen(false)
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const w = video.videoWidth || 1280
    const h = video.videoHeight || 720
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h)
    // Downscale to max 1024 wide, JPEG @ 0.7 (matches CameraCapture.tsx)
    const maxW = 1024
    let dataUrl: string
    if (w > maxW) {
      const scale = maxW / w
      const tmp = document.createElement('canvas')
      tmp.width = maxW
      tmp.height = Math.max(1, Math.round(h * scale))
      const tmpCtx = tmp.getContext('2d')
      if (!tmpCtx) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      } else {
        tmpCtx.drawImage(canvas, 0, 0, tmp.width, tmp.height)
        dataUrl = tmp.toDataURL('image/jpeg', 0.7)
      }
    } else {
      dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    }
    setImages((prev) => [...prev, dataUrl].slice(0, MAX_IMAGES))
    stopCamera()
  }

  // ── File input fallback (pick from gallery) ──
  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) {
      toast.error(`เพิ่มรูปได้สูงสุด ${MAX_IMAGES} รูป`)
      e.target.value = ''
      return
    }
    try {
      const list = Array.from(files).slice(0, remaining)
      const loaded: string[] = []
      for (const file of list) {
        const dataUrl = await readFileAsDataUrl(file)
        loaded.push(dataUrl)
      }
      setImages((prev) => [...prev, ...loaded].slice(0, MAX_IMAGES))
    } catch {
      toast.error('ไม่สามารถอ่านไฟล์รูปได้')
    } finally {
      e.target.value = ''
    }
  }

  // ── Cleanup camera on unmount ──
  React.useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  // ── Submit ──
  async function handleSubmit() {
    setSubmitError(null)
    if (!subject.trim() && selectedSubjects.length === 0) {
      setSubmitError('กรุณาเลือกประเภทปัญหาอย่างน้อย 1 อัน')
      return
    }
    // Combine selected subjects into subject field
    // If "อื่นๆ (ระบุในรายละเอียด)" is selected + user typed detail,
    // append it to the subject so technicians see the specific symptom.
    const OTHER_LABEL = 'อื่นๆ (ระบุในรายละเอียด)'
    const subjectsWithDetail = selectedSubjects.map((s) => {
      if (s === OTHER_LABEL && otherDetail.trim()) {
        return `อื่นๆ: ${otherDetail.trim()}`
      }
      return s
    })
    const finalSubject = subjectsWithDetail.length > 0 ? subjectsWithDetail.join(', ') : subject.trim()
    // Description is optional — user might select problem type only
    // External work doesn't need a device — just client name
    if (!selected && !isExternal) {
      setSubmitError('กรุณาเลือกอุปกรณ์ที่จะแจ้งซ่อม')
      return
    }
    if (isExternal && !externalClientName.trim()) {
      setSubmitError('กรุณาระบุชื่อลูกค้า / สถานที่')
      return
    }
    const prOpt = PRIORITIES.find((p) => p.key === priority)
    if (!prOpt) {
      setSubmitError('ระดับความเร่งด่วนไม่ถูกต้อง')
      return
    }

    setSubmitting(true)
    // Declare outside try so the catch block can read it for offline-queue fallback.
    let payload: Record<string, unknown> | null = null
    try {
      // Combine description + remark into details field for the API
      // (description = ลักษณะหน้างาน, remark = หมายเหตุเพิ่มเติม)
      const combinedDetails = [
        description.trim(),
        remark.trim() ? `หมายเหตุ: ${remark.trim()}` : '',
      ].filter(Boolean).join('\n\n')

      payload = {
        subject: finalSubject,
        details: combinedDetails,
        priority: prOpt.value,
        // For external work there is no device in the system — `selected` is
        // legitimately null and the branch at the bottom of this try sets
        // `deviceId = null` explicitly. So read through optional chaining here
        // instead of dereferencing a value TypeScript cannot prove non-null.
        deviceId: selected?.id ?? null,
        building: selected?.building ?? null,
        location: selected?.location ?? null,
        submissionSource: 'session', // bypass guest contact validation
        reporterName: user?.name ?? user?.username ?? user?.email ?? null,
        actor: user?.email ?? user?.name ?? null,
        picBeforeImages: images,
      }
      // External work — include client name + phone + scanned code in details
      if (isExternal) {
        const externalParts = [
          externalClientName.trim() ? `ลูกค้า/สถานที่: ${externalClientName.trim()}` : '',
          externalPhone.trim() ? `เบอร์: ${externalPhone.trim()}` : '',
          externalScannedCode.trim() ? `รหัสสแกน: ${externalScannedCode.trim()}` : '',
        ].filter(Boolean).join('\n')
        if (externalParts) {
          payload.details = externalParts + (combinedDetails ? '\n\n' + combinedDetails : '')
        }
        payload.deviceId = null // external work — no device in system
      }
      const res = await fetch('/api/work-orders', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'บันทึกไม่สำเร็จ')
      }
      const json = (await res.json()) as { data?: { woNumber?: string | null } }
      const woNumber = json.data?.woNumber ?? null
      setSuccessWoNumber(woNumber)
      toast.success(`สร้างใบแจ้งซ่อม ${woNumber ?? ''} แล้ว`)
    } catch (e) {
      // Offline queue fallback — only when the network is actually down,
      // not on server-side validation errors (those still surface to the user).
      if (!navigator.onLine && payload) {
        addToQueue({
          url: '/api/work-orders',
          method: 'POST',
          body: payload,
          label: `แจ้งซ่อม: ${finalSubject || 'รายการใหม่'}`,
        })
        toast.success('บันทึกไว้ในคิว จะส่งอัตโนมัติเมื่อออนไลน์')
        // Reset the form so the technician can move on; the success screen
        // is not shown because the WO number isn't known yet — the queue
        // retry will create it in the background once connectivity returns.
        resetForm()
        return
      }
      setSubmitError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setSubject('')
    setDescription('')
    setRemark('')
    setOtherDetail('')
    setPriority('medium')
    setImages([])
    setSelected(null)
    setSearchTerm('')
    setResults([])
    setSubmitError(null)
    setSuccessWoNumber(null)
    setExternalClientName('')
    setExternalScannedCode('')
    setExternalPhone('')
  }

  // ── Success screen ──
  if (successWoNumber) {
    return (
      <SuccessScreen
        woNumber={successWoNumber}
        subject={subject}
        deviceLabel={
          selected ? `${selected.assetCode} · ${selected.name}` : ''
        }
        onNew={resetForm}
      />
    )
  }

  // ── Main form ──
  return (
    <div className="flex flex-col gap-3">
      {/* Inline QR Scanner overlay — at top level so it always renders */}
      {qrScanOpen && (
        <InlineQRScanner
          onScan={(value) => {
            // Check if Smart QR URL — redirect to QR router
            const smartMatch = value.match(/\/qr\/([dAsw])\/([a-zA-Z0-9_-]+)/i)
            if (smartMatch) {
              const url = value.startsWith('http') ? value : `${window.location.origin}${value.startsWith('/') ? '' : '/'}${value}`
              setQrScanOpen(false)
              toast.success('สแกน Smart QR สำเร็จ — กำลังเปิด...')
              window.location.href = url
              return
            }

            if (isExternal) {
              setExternalScannedCode(value)
            } else {
              setSearchTerm(value)
            }
            setQrScanOpen(false)
            toast.success(`สแกนได้: ${value}`)
          }}
          onClose={() => setQrScanOpen(false)}
        />
      )}
      {/* Step 1: Device search OR External job */}
      <Card className="gap-0 py-0">
        <CardContent className="px-0 py-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <StepBadge n={1} />
              <span className="text-sm font-semibold">{isExternal ? 'งานนอก' : 'ค้นหาอุปกรณ์'}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Toggle: Internal vs External */}
              <button
                type="button"
                onClick={() => {
                  setIsExternal(!isExternal)
                  setSelected(null)
                  setSearchTerm('')
                  setResults([])
                }}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  isExternal
                    ? 'border-teal-500 bg-teal-500 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {isExternal ? 'งานนอก ✓' : 'งานนอก'}
              </button>
              {selected && !isExternal && (
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null)
                    setSearchTerm('')
                    setResults([])
                  }}
                  className="text-xs font-medium text-orange-600 hover:underline"
                >
                  เปลี่ยนอุปกรณ์
                </button>
              )}
            </div>
          </div>

          {!selected && !isExternal ? (
            <div className="p-4">
              {/* Search input with icon + QR scan button */}
              <div ref={resultsRef} className="relative">
                <div className="relative flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="text"
                      inputMode="search"
                      autoComplete="off"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onFocus={() => results.length > 0 && setShowResults(true)}
                      placeholder="รหัสอุปกรณ์ / Serial"
                      aria-label="ค้นหาอุปกรณ์"
                      className="h-12 rounded-lg pl-9 pr-9 text-base"
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchTerm('')
                          setResults([])
                        }}
                        aria-label="ล้าง"
                        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {/* QR Scan button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      console.log('[QR] button clicked, opening scanner')
                      setQrScanOpen(true)
                    }}
                    aria-label="สแกน QR Code"
                    title="สแกน QR"
                    className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-orange-300 bg-orange-50 text-orange-600 transition-colors hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400 dark:hover:bg-orange-950/60 z-10"
                  >
                    <QrCode className="h-5 w-5" />
                  </button>
                </div>

                {/* Dropdown results */}
                {showResults && (searchTerm.trim().length > 0) && (
                  <div className="mt-2 overflow-hidden rounded-lg border bg-background shadow-sm">
                    {searching ? (
                      <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        กำลังค้นหา…
                      </div>
                    ) : searchError ? (
                      <div
                        role="alert"
                        className="flex items-center gap-2 px-3 py-4 text-sm text-rose-600"
                      >
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        {searchError}
                      </div>
                    ) : results.length === 0 ? (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                        ไม่พบอุปกรณ์ที่ตรงกับ “{searchTerm}”
                      </div>
                    ) : (
                      <ul
                        className="max-h-72 overflow-y-auto"
                        style={{ scrollbarWidth: 'thin' }}
                      >
                        {results.map((d) => (
                          <li key={d.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelected(d)
                                setShowResults(false)
                              }}
                              className="flex w-full items-center justify-between gap-2 border-b px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/60 active:bg-muted"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-mono text-xs font-semibold text-orange-600">
                                    {d.assetCode}
                                  </span>
                                  <span className="truncate text-sm font-medium">
                                    {d.name}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                                  {d.serialNumber && (
                                    <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                                      S/N: {d.serialNumber}
                                    </span>
                                  )}
                                  <span className="text-muted-foreground">
                                    {[d.brand, d.model].filter(Boolean).join(' ') || '—'}
                                  </span>
                                  {d.site && (
                                    <span className="text-muted-foreground">· {d.site}</span>
                                  )}
                                </div>
                              </div>
                              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* Hint */}
              <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                <ScanLine className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                พิมพ์รหัสอุปกรณ์ หรือ Serial Number อย่างน้อย 1 ตัวอักษรเพื่อค้นหา
              </p>
            </div>
          ) : isExternal ? (
            <div className="space-y-3 p-4">
              <div className="rounded-lg bg-teal-50 p-3 text-xs text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                งานนอกสถานที่ — สำหรับงานที่ไม่ได้เกี่ยวข้องกับอุปกรณ์ในระบบ
                (เช่น ลูกค้าภายนอก, สาขาอื่น, งานนอกสถานที่)
              </div>
              {/* QR/Barcode scan — สแกนอุปกรณ์ที่หน้างาน */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">สแกน QR / Barcode หน้างาน <span className="text-xs text-slate-400">(ถ้ามี)</span></Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={externalScannedCode}
                    onChange={(e) => setExternalScannedCode(e.target.value)}
                    placeholder="สแกนหรือพิมพ์รหัส"
                    className="h-12 flex-1 text-base"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setQrScanOpen(true)
                    }}
                    aria-label="สแกน QR/Barcode"
                    title="สแกน QR/Barcode"
                    className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-teal-300 bg-teal-50 text-teal-600 transition-colors hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-400 z-10"
                  >
                    <QrCode className="h-5 w-5" />
                  </button>
                </div>
                {externalScannedCode && (
                  <p className="text-[11px] text-teal-600 dark:text-teal-400">
                    ✓ สแกนได้: {externalScannedCode}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">ชื่อลูกค้า / สถานที่ <span className="text-rose-500">*</span></Label>
                <Input
                  value={externalClientName}
                  onChange={(e) => setExternalClientName(e.target.value)}
                  placeholder="บริษัท / สาขา"
                  className="h-12 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">เบอร์ติดต่อ <span className="text-xs text-slate-400">(ไม่บังคับ)</span></Label>
                <Input
                  value={externalPhone}
                  onChange={(e) => setExternalPhone(e.target.value)}
                  placeholder="เบอร์โทร"
                  className="h-12 text-base"
                  inputMode="tel"
                />
              </div>
            </div>
          ) : selected ? (
            <SelectedDeviceCard device={selected} />
          ) : (
            // Guard: `selected` can be null while the user is still in the
            // non-external branch (nothing picked yet). Rendering the card
            // unconditionally would dereference `null` and crash the screen.
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              กรุณาเลือกอุปกรณ์ที่ต้องการแจ้งซ่อม
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Repair request form (shown when device selected OR external) */}
      {(selected || isExternal) && (
        <Card className="gap-0 py-0">
          <CardContent className="px-0 py-0">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <StepBadge n={2} />
              <span className="text-sm font-semibold">รายละเอียดการแจ้งซ่อม</span>
            </div>

            <div className="space-y-4 p-4">
              {/* Step 2a: เลือกอาการ — แยกตามกลุ่มแบบ collapsible sections (ไม่กองรวมที่เดียว) */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  อาการที่พบ <span className="text-rose-500">*</span>
                  <span className="ml-2 text-[10px] text-slate-400 font-normal">
                    (เลือกได้หลายหัวข้อ · จากข้อมูลมาตรฐาน)
                  </span>
                </Label>
                {problemCategories.length > 0 ? (
                  <ProblemCategorySelector
                    categories={problemCategories}
                    subjectOptions={subjectOptions}
                    selected={selectedSubjects}
                    onChange={(next) => {
                      setSelectedSubjects(next)
                      // Auto-set priority based on selected subjects
                      const priorities = next.map((s) => {
                        const opt = subjectOptions.find((o) => o.value === s)
                        return opt?.default_priority
                      })
                      if (priorities.includes('ด่วน')) setPriority('urgent')
                      else if (priorities.includes('สูง')) setPriority('high')
                      else if (priorities.includes('ปานกลาง')) setPriority('medium')
                      else if (priorities.includes('ปกติ')) setPriority('low')
                    }}
                    otherDetail={otherDetail}
                    onOtherDetailChange={setOtherDetail}
                  />
                ) : (
                  <Input
                    id="mrr-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="เช่น เครื่องพิมพ์ไม่ทำงาน"
                    maxLength={200}
                    className="h-12 text-base"
                  />
                )}
                {/* Show selected subjects summary */}
                {selectedSubjects.length > 0 && (
                  <div className="rounded-md bg-orange-50 dark:bg-orange-950/30 p-2 text-xs">
                    <span className="text-orange-700 dark:text-orange-300 font-medium">
                      เลือกแล้ว {selectedSubjects.length} หัวข้อ:
                    </span>{' '}
                    <span className="text-slate-600 dark:text-slate-300">
                      {selectedSubjects.join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Step 2b: คำอธิบายลักษณะหน้างาน (สำหรับช่างสำรวจ) */}
              <div className="space-y-1.5">
                <Label htmlFor="mrr-onsite-desc" className="text-sm font-medium">
                  ลักษณะหน้างาน / สิ่งที่พบเห็น
                  <span className="ml-1 text-xs text-slate-400">(สำหรับช่างสำรวจ)</span>
                </Label>
                <Textarea
                  id="mrr-onsite-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="บอกลักษณะที่เห็น เช่น ติดไฟแต่ไม่พิมพ์"
                  rows={4}
                  maxLength={1000}
                  className="min-h-24 text-base"
                  aria-required="false"
                />
                <p className="text-right text-xs text-muted-foreground">
                  {description.length}/1000
                </p>
              </div>

              {/* Step 2c: หมายเหตุเพิ่มเติม (optional) */}
              <div className="space-y-1.5">
                <Label htmlFor="mrr-remark" className="text-sm font-medium">
                  หมายเหตุเพิ่มเติม <span className="text-xs text-slate-400">(ถ้ามี)</span>
                </Label>
                <Input
                  id="mrr-remark"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="เบอร์ติดต่อสำรอง / เวลาสะดวก"
                  maxLength={200}
                  className="h-12 text-base"
                />
              </div>

              {/* Priority */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  ความเร่งด่วน <span className="text-rose-500">*</span>
                </Label>
                <div className="grid grid-cols-4 gap-2">
                  {PRIORITIES.map((p) => {
                    const active = priority === p.key
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setPriority(p.key)}
                        aria-pressed={active}
                        className={cn(
                          'flex h-11 items-center justify-center rounded-lg border text-sm font-medium transition-colors',
                          active
                            ? p.activeClass
                            : 'border-border bg-background text-foreground hover:bg-muted',
                        )}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Photo capture */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  รูปภาพประกอบ{' '}
                  <span className="text-muted-foreground">
                    (ถ่ายหรือเลือกจากคลัง — สูงสุด {MAX_IMAGES} รูป)
                  </span>
                </Label>

                {/* Thumbnails */}
                {images.length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {images.map((img, i) => (
                      <div
                        key={i}
                        className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                      >
                        <img
                          src={img}
                          alt={`รูปภาพประกอบ ${i + 1}`}
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setImages((prev) => prev.filter((_, idx) => idx !== i))
                          }
                          aria-label={`ลบรูปที่ ${i + 1}`}
                          className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-white shadow-sm hover:bg-rose-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Capture / pick buttons */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Camera button — opens the device's native camera app directly */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={images.length >= MAX_IMAGES}
                    className="h-12"
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    ถ่ายภาพ
                  </Button>
                  {/* Gallery button — opens the photo picker (gallery only) */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={images.length >= MAX_IMAGES}
                    className="h-12"
                  >
                    <ImageIcon className="mr-2 h-4 w-4" />
                    เลือกจากคลัง
                  </Button>
                </div>
                {/* Gallery input — NO capture attribute → opens photo picker (gallery) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onFileChange}
                  className="hidden"
                  aria-hidden="true"
                />
                {/* Camera input — capture=environment → opens native camera app (rear camera) */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onFileChange}
                  className="hidden"
                  aria-hidden="true"
                />
              </div>

              {/* Submit error */}
              {submitError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Submit */}
              <Button
                type="button"
                size="lg"
                onClick={handleSubmit}
                disabled={submitting}
                aria-busy={submitting}
                className="h-12 w-full bg-orange-500 text-base font-semibold hover:bg-orange-600"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    กำลังส่งเรื่อง…
                  </>
                ) : (
                  <>
                    <FileText className="mr-2 h-4 w-4" />
                    ส่งเรื่องแจ้งซ่อม
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Camera overlay (full-screen) */}
      {cameraOpen && (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-black">
          <div className="flex items-center justify-between p-4">
            <span className="text-sm text-white">ถ่ายภาพอาการ</span>
            <button
              type="button"
              onClick={stopCamera}
              aria-label="ปิดกล้อง"
              className="flex h-9 w-9 items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="flex-1 object-contain"
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="p-6">
            <Button
              type="button"
              onClick={capturePhoto}
              className="h-12 w-full bg-white text-black hover:bg-white/90"
            >
              <Camera className="mr-2 h-5 w-5" />
              ถ่ายภาพ
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────

/**
 * ProblemCategorySelector — เลือกประเภทปัญหาแบบ multi-select
 * จัดกลุ่มตาม RepairGroup (ไม่ใช่กองรวมที่เดียว) — collapsible sections
 *
 * Features:
 *   - แต่ละ group เป็น section แยก มี header + collapse/expand
 *   - แต่ละ item เป็น checkbox (multi-select)
 *   - แสดง count ของที่เลือกในแต่ละ group
 *   - กลุ่มแรกขยายอัตโนมัติ
 *   - เมื่อเลือก "อื่นๆ" จะมีช่อง input ให้ระบุอาการเสียเพิ่ม
 */
function ProblemCategorySelector({
  categories,
  subjectOptions,
  selected,
  onChange,
  otherDetail,
  onOtherDetailChange,
}: {
  categories: Array<{ id: string; label: string; group?: string }>
  subjectOptions: Array<{ id?: string; value: string; default_priority?: string; group?: string }>
  selected: string[]
  onChange: (next: string[]) => void
  otherDetail: string
  onOtherDetailChange: (value: string) => void
}) {
  // Group categories by group name
  const groups = React.useMemo(() => {
    const map = new Map<string, typeof categories>()
    for (const cat of categories) {
      const g = cat.group || 'อื่นๆ'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(cat)
    }
    return Array.from(map.entries())
  }, [categories])

  // First group expanded by default
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(
    new Set(groups.length > 0 ? [groups[0][0]] : []),
  )

  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) {
        next.delete(groupName)
      } else {
        next.add(groupName)
      }
      return next
    })
  }

  const toggleSubject = (label: string) => {
    if (selected.includes(label)) {
      onChange(selected.filter((s) => s !== label))
    } else {
      onChange([...selected, label])
    }
  }

  // Check if "อื่นๆ (ระบุในรายละเอียด)" is selected — needs detail input
  const OTHER_LABEL = 'อื่นๆ (ระบุในรายละเอียด)'
  const isOtherSelected = selected.includes(OTHER_LABEL)

  return (
    <div className="space-y-2">
      {groups.map(([groupName, cats]) => {
        const isExpanded = expandedGroups.has(groupName)
        const selectedInGroup = cats.filter((c) => selected.includes(c.label))
        const selectedCount = selectedInGroup.length

        return (
          <div
            key={groupName}
            className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
          >
            {/* Group header — clickable to expand/collapse */}
            <button
              type="button"
              onClick={() => toggleGroup(groupName)}
              className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-expanded={isExpanded}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {groupName}
                </span>
                {selectedCount > 0 && (
                  <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {selectedCount}
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-400">
                {cats.length} หัวข้อ
                <span className="ml-1 inline-block transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)' }}>
                  ›
                </span>
              </span>
            </button>

            {/* Items — checkbox list */}
            {isExpanded && (
              <div className="space-y-1 border-t border-slate-100 p-2 dark:border-slate-700">
                {cats.map((cat) => {
                  const isSelected = selected.includes(cat.label)
                  const opt = subjectOptions.find((o) => o.value === cat.label)
                  const priority = opt?.default_priority
                  const isOtherItem = cat.label === OTHER_LABEL

                  return (
                    <div key={cat.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                          isSelected
                            ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300'
                            : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSubject(cat.label)}
                          className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                        />
                        <span className="flex-1">{cat.label}</span>
                        {priority && (
                          <span className={`text-[10px] ${
                            priority === 'ด่วน' ? 'text-rose-500' :
                            priority === 'สูง' ? 'text-orange-500' :
                            priority === 'ปานกลาง' ? 'text-amber-500' :
                            'text-slate-400'
                          }`}>
                            {priority}
                          </span>
                        )}
                      </label>
                      {/* When "อื่นๆ" is selected, show input for specifying the symptom */}
                      {isOtherItem && isSelected && (
                        <div className="mt-1 pl-6">
                          <Input
                            type="text"
                            value={otherDetail}
                            onChange={(e) => onOtherDetailChange(e.target.value)}
                            placeholder="ระบุอาการเสีย"
                            maxLength={200}
                            className="h-10 text-sm"
                            aria-label="ระบุอาการเสียอื่นๆ"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">
      {n}
    </span>
  )
}

function SelectedDeviceCard({ device }: { device: DeviceLite }) {
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-300">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-orange-600">
              {device.assetCode}
            </span>
            <span className="truncate text-sm font-medium">{device.name}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[device.brand, device.model].filter(Boolean).join(' ') || '—'}
            {device.serialNumber ? ` · S/N ${device.serialNumber}` : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {device.site && (
              <Badge variant="secondary" className="text-[10px]">
                {device.site}
              </Badge>
            )}
            {device.building && (
              <Badge variant="outline" className="text-[10px]">
                {device.building}
              </Badge>
            )}
            {device.location && (
              <Badge variant="outline" className="text-[10px]">
                {device.location}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SuccessScreen({
  woNumber,
  subject,
  deviceLabel,
  onNew,
}: {
  woNumber: string
  subject: string
  deviceLabel: string
  onNew: () => void
}) {
  // Generate print URL using woNumber (print route accepts woNumber as ID)
  // Token is passed via query param so window.open doesn't need auth headers
  const token = typeof window !== 'undefined' ? localStorage.getItem('itam.token') ?? '' : ''
  const printUrl80 = `/api/work-orders/${encodeURIComponent(woNumber)}/print?paper=ticket-80&t=${encodeURIComponent(token)}`
  const printUrl58 = `/api/work-orders/${encodeURIComponent(woNumber)}/print?paper=ticket-58&t=${encodeURIComponent(token)}`
  const printUrlA4 = `/api/work-orders/${encodeURIComponent(woNumber)}/print?paper=a4-portrait&t=${encodeURIComponent(token)}`

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center px-2 pt-6"
    >
      <Card className="w-full gap-0 py-0">
        <CardContent className="flex flex-col items-center px-4 py-8 text-center">
          {/* Big check icon */}
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.05, type: 'spring', stiffness: 220, damping: 18 }}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300"
          >
            <CheckCircle2 className="h-12 w-12" />
          </motion.div>

          <h2 className="mt-4 text-lg font-semibold">ส่งเรื่องสำเร็จ</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ทางทีมงานได้รับแจ้งซ่อมของคุณแล้ว
          </p>

          {/* WorkOrder number */}
          <div className="mt-5 w-full rounded-xl border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              เลขใบแจ้งซ่อม
            </p>
            <p className="mt-1 break-all font-mono text-2xl font-bold text-orange-600">
              {woNumber}
            </p>
          </div>

          {/* Summary */}
          <div className="mt-4 w-full space-y-2 text-left text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">ประเภทปัญหา</span>
              <span className="max-w-[60%] truncate font-medium">
                {subject}
              </span>
            </div>
            {deviceLabel && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">อุปกรณ์</span>
                <span className="max-w-[60%] truncate font-medium">
                  {deviceLabel}
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 grid w-full grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-12"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  // Open the public WO view page (UI, not raw JSON)
                  window.open(
                    `/wo/${encodeURIComponent(woNumber)}`,
                    '_blank',
                    'noopener,noreferrer',
                  )
                }
              }}
            >
              <FileText className="mr-2 h-4 w-4" />
              ดูสถานะ
            </Button>
            <Button
              type="button"
              className="h-12 bg-orange-500 hover:bg-orange-600"
              onClick={onNew}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              แจ้งซ่อมใหม่
            </Button>
          </div>

          {/* Print tickets */}
          <div className="mt-3 grid w-full grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-12 text-[11px]"
              onClick={() => window.open(printUrl80, '_blank', 'noopener,noreferrer')}
            >
              <Printer className="mr-1 h-4 w-4" />
              80mm
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 text-[11px]"
              onClick={() => window.open(printUrl58, '_blank', 'noopener,noreferrer')}
            >
              <Printer className="mr-1 h-4 w-4" />
              58mm
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 text-[11px]"
              onClick={() => window.open(printUrlA4, '_blank', 'noopener,noreferrer')}
            >
              <Printer className="mr-1 h-4 w-4" />
              A4
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// ── Inline QR Scanner ─────────────────────────────────────────────────
// Self-contained QR scanner overlay — uses camera + jsQR (dynamic import)
// No dependency on QrScannerDialog (which uses global store + CommonJS).

function InlineQRScanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void
  onClose: () => void
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const stoppedRef = React.useRef(false)
  const [status, setStatus] = React.useState<'starting' | 'scanning' | 'error' | 'manual'>('starting')
  const [errorMsg, setErrorMsg] = React.useState('')
  const [manualValue, setManualValue] = React.useState('')

  React.useEffect(() => {
    startCamera()
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startCamera() {
    setStatus('starting')
    setErrorMsg('')
    stoppedRef.current = false

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('browser-not-supported')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream

      const video = videoRef.current
      if (!video) return

      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      await video.play()
      setStatus('scanning')
      tick()
    } catch (e) {
      const err = e as Error
      if (err.name === 'NotAllowedError') {
        setErrorMsg('ไม่ได้อนุญาตกล้อง — กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์ หรือพิมพ์รหัสเครื่องด้านล่าง')
      } else if (err.name === 'NotFoundError') {
        setErrorMsg('ไม่พบกล้องในอุปกรณ์นี้ — พิมพ์รหัสเครื่องด้านล่างแทน')
      } else {
        setErrorMsg('เปิดกล้องไม่ได้ — พิมพ์รหัสเครื่องด้านล่างแทน')
      }
      setStatus('manual')
    }
  }

  function stopCamera() {
    stoppedRef.current = true
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop() } catch { /* ignore */ }
      }
      streamRef.current = null
    }
  }

  async function tick() {
    if (stoppedRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    const w = video.videoWidth
    const h = video.videoHeight
    if (w === 0 || h === 0) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    ctx.drawImage(video, 0, 0, w, h)

    // Clean scanned value helper
    const cleanValue = (raw: string) =>
      raw
        .replace(/[*`\[\]{}()<>]/g, '')
        .replace(/^\*+|\*+$/g, '')
        .trim()

    // ── Try BarcodeDetector API first (supports QR + 2D barcodes) ──
    // Browser built-in, supports: qr_code, code_128, code_39, ean_13, ean_8, etc.
    if ('BarcodeDetector' in window) {
      try {
        // @ts-expect-error — BarcodeDetector is not in TS types yet
        const detector = new window.BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'code_93', 'codabar', 'itf'],
        })
        const barcodes = await detector.detect(video)
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          const cleaned = cleanValue(barcodes[0].rawValue)
          if (cleaned) {
            onScan(cleaned)
            return
          }
        }
      } catch {
        // BarcodeDetector failed — fall through to jsQR
      }
    }

    // ── Fallback: jsQR (QR codes only) ──
    try {
      const imageData = ctx.getImageData(0, 0, w, h)
      const { default: jsQR } = await import('jsqr')
      const code = jsQR(imageData.data, w, h, {
        inversionAttempts: 'dontInvert',
      })

      if (code && code.data) {
        const cleaned = cleanValue(code.data)
        if (cleaned) {
          onScan(cleaned)
          return
        }
      }
    } catch {
      setStatus('manual')
      setErrorMsg('ไม่สามารถสแกนได้ — พิมพ์รหัสเครื่องด้านล่างแทน')
      return
    }

    rafRef.current = requestAnimationFrame(tick)
  }

  function handleManualSubmit() {
    const raw = manualValue.trim()
    if (!raw) return
    // Clean manual input too (remove * etc.)
    const cleaned = raw.replace(/[*`\[\]{}()<>]/g, '').trim()
    onScan(cleaned)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between bg-black/80 px-4 py-3 pt-[env(safe-area-inset-top)]">
        <span className="text-sm font-medium text-white">สแกน QR Code</span>
        <button
          type="button"
          onClick={() => { stopCamera(); onClose() }}
          aria-label="ปิด"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Camera / Manual */}
      {status === 'starting' || status === 'scanning' ? (
        <div className="relative flex-1">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Scan overlay frame */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-48 w-48 rounded-xl border-2 border-orange-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
          </div>

          {/* Hint text */}
          <div className="absolute inset-x-0 bottom-20 px-6 text-center">
            <p className="text-sm text-white/80">
              {status === 'starting' ? 'กำลังเปิดกล้อง...' : 'นำกล้องไปที่ QR Code บนสติกเกอร์อุปกรณ์'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          {errorMsg && (
            <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              {errorMsg}
            </div>
          )}

          {/* Retry camera button */}
          <button
            type="button"
            onClick={startCamera}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-orange-300 bg-orange-50 py-3 text-sm font-medium text-orange-600 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400"
          >
            <Camera className="h-5 w-5" />
            ลองเปิดกล้องอีกครั้ง
          </button>

          {/* Manual entry */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              พิมพ์รหัสเครื่อง
            </label>
            <input
              type="text"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              placeholder="เช่น IT-00001 หรือ SN12345"
              className="h-12 w-full rounded-lg border border-slate-300 px-4 text-base dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              autoFocus
            />
            <button
              type="button"
              onClick={handleManualSubmit}
              disabled={!manualValue.trim()}
              className="h-12 w-full rounded-lg bg-orange-500 text-white font-medium disabled:opacity-50"
            >
              ยืนยัน
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
