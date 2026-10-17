'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Plus, Pencil, Copy, Star, Trash2, Save, Eye, Type, Image as ImageIcon,
  QrCode, Square, Loader2, Settings as SettingsIcon,
  ZoomIn, ZoomOut, Maximize2, Upload,
} from 'lucide-react'
import {
  PAPER_PRESETS,
  STICKER_VARIABLES,
  SAMPLE_DEVICE,
  substituteVariables,
  genElementId,
  elementExceedsBounds,
  type StickerElement,
  type StickerTemplate,
  type StickerSettings,
  type StickerElementType,
} from '@/lib/sticker-template'

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function genTemplateId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function makeElement(type: StickerElementType): StickerElement {
  const base = {
    id: genElementId(),
    x: 5, y: 5, width: 20, height: 6,
    opacity: 1, zIndex: 1, rotation: 0,
  }
  if (type === 'text') {
    return { ...base, type, width: 40, height: 5, content: 'ข้อความใหม่', fontSize: 7, fontWeight: 500, color: '#1e293b', align: 'left' }
  }
  if (type === 'image') {
    return { ...base, type, width: 20, height: 20, content: '', source: '' }
  }
  if (type === 'qr') {
    // APPENDIX-D: default to {{QrUrl}} (Smart QR URL) so phone cameras open
    // the ITAM repair page when scanned. The previous default {{AssetNo}}
    // only encoded the asset code as plain text (scanners couldn't open it).
    return { ...base, type, width: 15, height: 15, content: '{{QrUrl}}' }
  }
  // rect
  return { ...base, type, width: 30, height: 5, background: '#f97316', border: 'none', borderRadius: 0 }
}

// ─────────────────────────────────────────────────────────────────────────
// Editor scale + alignment guide helpers (ported from Apps Script)
// ─────────────────────────────────────────────────────────────────────────

/** 1mm in CSS pixels at 96dpi (CSS standard) */
const MM_PX = 3.7795

/**
 * useFitScale — measures the container with ResizeObserver and computes a
 * fitScale so the workspace always fits inside the container (no horizontal
 * scroll when an A4 page is loaded). Multiplied by `zoom` (default 1.0) so the
 * user can zoom in/out. Mirrors Apps Script `getDocEditorScale()`.
 */
function useFitScale(canvasWmm: number, canvasHmm: number, padMm: number, zoom: number) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState({ width: 800, height: 480 })

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect
        setSize({ width: cr.width, height: cr.height })
      }
    })
    ro.observe(el)
    // Initial measurement (ResizeObserver fires on observe, but be safe)
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) setSize({ width: r.width, height: r.height })
    return () => ro.disconnect()
  }, [])

  const totalWmm = canvasWmm + padMm * 2
  const totalHmm = canvasHmm + padMm * 2
  const nativeWpx = totalWmm * MM_PX
  const nativeHpx = totalHmm * MM_PX
  // Reserve a few px for padding inside the container
  const availW = Math.max(50, size.width - 16)
  const availH = Math.max(50, size.height - 16)
  const fitScale = Math.min(availW / nativeWpx, availH / nativeHpx, 2.0)
  const totalScale = fitScale * zoom
  const mmScale = totalScale * MM_PX
  return { containerRef, fitScale, totalScale, mmScale }
}

/**
 * snapToGuides — snap an element to alignment guides (page edges/center +
 * other elements' edges/centers) within `threshold` mm. Returns the snapped
 * x/y plus the list of guide lines to render.
 * Ported from Apps Script `snapDocElement()`.
 */
function snapToGuides(
  elId: string,
  rawX: number,
  rawY: number,
  elements: { id: string; x: number; y: number; width: number; height: number }[],
  canvas: { width: number; height: number },
  threshold = 1,
): { x: number; y: number; guides: { x: number[]; y: number[] } } {
  const el = elements.find((e) => e.id === elId)
  if (!el) return { x: rawX, y: rawY, guides: { x: [], y: [] } }
  const w = el.width || 30
  const h = el.height || 8
  const guides = { x: [] as number[], y: [] as number[] }
  let snapX = rawX
  let snapY = rawY

  const xPoints: number[] = [0, canvas.width, canvas.width / 2]
  const yPoints: number[] = [0, canvas.height, canvas.height / 2]
  elements.forEach((other) => {
    if (other.id === elId) return
    const oX = other.x || 0
    const oY = other.y || 0
    const oW = other.width || 30
    const oH = other.height || 8
    xPoints.push(oX, oX + oW, oX + oW / 2)
    yPoints.push(oY, oY + oH, oY + oH / 2)
  })

  let bestDistX = threshold + 1
  let bestSnapX = rawX
  xPoints.forEach((px) => {
    let d = Math.abs(rawX - px)
    if (d < threshold && d < bestDistX) { bestDistX = d; bestSnapX = px }
    d = Math.abs((rawX + w) - px)
    if (d < threshold && d < bestDistX) { bestDistX = d; bestSnapX = px - w }
    d = Math.abs((rawX + w / 2) - px)
    if (d < threshold && d < bestDistX) { bestDistX = d; bestSnapX = px - w / 2 }
  })
  if (bestDistX <= threshold) snapX = bestSnapX

  let bestDistY = threshold + 1
  let bestSnapY = rawY
  yPoints.forEach((py) => {
    let d = Math.abs(rawY - py)
    if (d < threshold && d < bestDistY) { bestDistY = d; bestSnapY = py }
    d = Math.abs((rawY + h) - py)
    if (d < threshold && d < bestDistY) { bestDistY = d; bestSnapY = py - h }
    d = Math.abs((rawY + h / 2) - py)
    if (d < threshold && d < bestDistY) { bestDistY = d; bestSnapY = py - h / 2 }
  })
  if (bestDistY <= threshold) snapY = bestSnapY

  const sL = snapX, sR = snapX + w, sC = snapX + w / 2
  xPoints.forEach((px) => {
    if (Math.abs(sL - px) < 0.05 && !guides.x.includes(px)) guides.x.push(px)
    if (Math.abs(sR - px) < 0.05 && !guides.x.includes(px)) guides.x.push(px)
    if (Math.abs(sC - px) < 0.05 && !guides.x.includes(px)) guides.x.push(px)
  })
  const sT = snapY, sB = snapY + h, sCY = snapY + h / 2
  yPoints.forEach((py) => {
    if (Math.abs(sT - py) < 0.05 && !guides.y.includes(py)) guides.y.push(py)
    if (Math.abs(sB - py) < 0.05 && !guides.y.includes(py)) guides.y.push(py)
    if (Math.abs(sCY - py) < 0.05 && !guides.y.includes(py)) guides.y.push(py)
  })

  return { x: snapX, y: snapY, guides }
}

// ─────────────────────────────────────────────────────────────────────────
// Element renderer — used inside the workspace
// ─────────────────────────────────────────────────────────────────────────

function WorkspaceElement({
  el,
  selected,
  exceedsBounds,
  onMouseDown,
  onResizeMouseDown,
  settings,
}: {
  el: StickerElement
  selected: boolean
  exceedsBounds: boolean
  onMouseDown: (e: React.MouseEvent, id: string) => void
  onResizeMouseDown: (e: React.MouseEvent, id: string) => void
  settings: StickerSettings | null
}) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${el.x}mm`,
    top: `${el.y}mm`,
    width: `${el.width}mm`,
    height: `${el.height}mm`,
    opacity: el.opacity ?? 1,
    zIndex: el.zIndex ?? 0,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    cursor: 'move',
    userSelect: 'none',
  }

  let content: React.ReactNode = null
  if (el.type === 'text') {
    Object.assign(style, {
      fontSize: `${el.fontSize}pt`,
      fontWeight: el.fontWeight,
      color: el.color,
      textAlign: el.align,
      lineHeight: 1.15,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'hidden',
      fontFamily: '"Sukhumvit Set","Noto Sans Thai","Tahoma","Segoe UI",sans-serif',
      display: 'flex',
      flexDirection: 'column' as const,
      justifyContent: el.valign === 'center' ? 'center' : el.valign === 'bottom' ? 'flex-end' : 'flex-start',
    })
    content = el.content
      ? substituteVariables(
          el.content,
          SAMPLE_DEVICE,
          settings ?? {
            companyName: '',
            orgName: '',
            hotline: '',
            lineOALink: '',
            footerNote: '',
          },
        )
      : '​'
    // Wrap in span for proper flex text rendering
    content = content ? <span style={{ display: 'block', width: '100%' }}>{content}</span> : '​'
  } else if (el.type === 'rect') {
    Object.assign(style, {
      background: el.background || 'transparent',
      border: el.border || 'none',
      borderRadius: el.borderRadius ? `${el.borderRadius}mm` : undefined,
    })
  } else if (el.type === 'image') {
    Object.assign(style, { objectFit: 'contain' as const, overflow: 'hidden' })
    const src = el.source || el.content
    if (src) {
      // Image with src — render inside the wrapper div (below) so drag/resize works
      content = (
        <img
          src={src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          draggable={false}
        />
      )
    } else {
      Object.assign(style, {
        background: '#f1f5f9', border: '1px dashed #cbd5e1',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#94a3b8', fontSize: '6pt',
      })
      content = '(image)'
    }
  } else if (el.type === 'qr') {
    Object.assign(style, {
      background: '#f8fafc', border: '1px solid #e2e8f0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#94a3b8', fontSize: '5pt',
    })
    content = 'QR'
  }

  return (
    <div
      style={style}
      onMouseDown={(e) => onMouseDown(e, el.id)}
      className={selected ? 'ring-2 ring-[#f97316] ring-offset-1' : exceedsBounds ? 'ring-1 ring-orange-400' : ''}
    >
      {content}
      {selected && (
        <div
          onMouseDown={(e) => onResizeMouseDown(e, el.id)}
          style={{
            position: 'absolute',
            right: -4, bottom: -4,
            width: 10, height: 10,
            background: '#f97316',
            border: '2px solid #ffffff',
            borderRadius: 2,
            cursor: 'nwse-resize',
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────

export function ItamStickerEditor() {
  const qc = useQueryClient()
  const workspaceRef = React.useRef<HTMLDivElement>(null)

  // ── Zoom + fit-scale (Bug 1: canvas too large) ───────────────────────
  // Workspace scales to fit the container; user can zoom +/- from toolbar.
  const [zoom, setZoom] = React.useState(1)
  // Alignment guides (dashed lines when element aligns with others)
  const [guides, setGuides] = React.useState<{ x: number[]; y: number[] }>({ x: [], y: [] })

  // ── Data: templates + settings ────────────────────────────────────────
  const { data: tplData, isLoading: tplLoading } = useQuery({
    queryKey: ['sticker-templates'],
    queryFn: async () => {
      const res = await fetch('/api/itam/sticker/templates')
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ templates: StickerTemplate[]; activeId: string | null }>
    },
  })

  const { data: settingsData } = useQuery({
    queryKey: ['sticker-settings'],
    queryFn: async () => {
      const res = await fetch('/api/itam/sticker/settings')
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ settings: StickerSettings }>
    },
  })

  const templates = tplData?.templates ?? []
  const activeId = tplData?.activeId ?? null
  const settings = settingsData?.settings

  // ── Editing state ─────────────────────────────────────────────────────
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<StickerTemplate | null>(null)
  const [selectedElId, setSelectedElId] = React.useState<string | null>(null)
  const imageFileRef = React.useRef<HTMLInputElement>(null)
  const [previewHtml, setPreviewHtml] = React.useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [deleteTplId, setDeleteTplId] = React.useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  // ── Dirty tracking — shows "ยังไม่ได้บันทึก" indicator when draft ≠ saved ──
  // Helps users see their edits are pending and need saving.
  const [savedSnapshot, setSavedSnapshot] = React.useState<string>('')
  const isDirty = draft ? JSON.stringify(draft) !== savedSnapshot : false

  // Local settings form
  const [settingsForm, setSettingsForm] = React.useState<StickerSettings | null>(null)

  // Auto-select first template for editing when list first loads
  React.useEffect(() => {
    if (!editingId && templates.length > 0 && !tplLoading) {
      const first = templates[0]
      setEditingId(first.id)
      const cloned = structuredCloneSafe(first)
      setDraft(cloned)
      setSavedSnapshot(JSON.stringify(cloned))
      setSelectedElId(null)
    }
  }, [templates, tplLoading, editingId])

  React.useEffect(() => {
    if (settings && !settingsForm) {
      setSettingsForm(settings)
    }
  }, [settings, settingsForm])

  // ── Mutations ─────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/itam/sticker/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, canvas: { width: 75.2, height: 36, unit: 'mm' }, overflow: 'clip', elements: [] }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json() as Promise<{ template: StickerTemplate }>
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sticker-templates'] })
      setEditingId(data.template.id)
      setDraft(structuredCloneSafe(data.template))
      setSelectedElId(null)
      toast.success('สร้างเทมเพลตแล้ว')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'สร้างไม่สำเร็จ'),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: StickerTemplate }) => {
      const res = await fetch(`/api/itam/sticker/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          canvas: payload.canvas,
          overflow: payload.overflow,
          elements: payload.elements,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json() as Promise<{ template: StickerTemplate }>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sticker-templates'] })
      toast.success('บันทึกเทมเพลตแล้ว')
      // Update saved snapshot so isDirty resets to false
      if (draft) setSavedSnapshot(JSON.stringify(draft))
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/itam/sticker/templates/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sticker-templates'] })
      setDeleteTplId(null)
      if (editingId === deleteTplId) {
        setEditingId(null)
        setDraft(null)
      }
      toast.success('ลบเทมเพลตแล้ว')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ'),
  })

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/itam/sticker/templates/${id}/activate`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sticker-templates'] })
      toast.success('ตั้งเป็นเทมเพลตที่ใช้งานแล้ว')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'ตั้งค่าไม่สำเร็จ'),
  })

  const saveSettingsMutation = useMutation({
    mutationFn: async (s: StickerSettings) => {
      const res = await fetch('/api/itam/sticker/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json() as Promise<{ settings: StickerSettings }>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sticker-settings'] })
      setSettingsOpen(false)
      toast.success('บันทึกการตั้งค่าแล้ว')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ'),
  })

  // ── Drag logic ─────────────────────────────────────────────────────────
  // fitScale hook — measured from the container (Bug 1 fix)
  const { containerRef, mmScale, totalScale } = useFitScale(
    draft?.canvas.width ?? 75.2,
    draft?.canvas.height ?? 36,
    30,
    zoom,
  )

  const dragStateRef = React.useRef<{
    mode: 'move' | 'resize'
    elId: string
    startClientX: number
    startClientY: number
    startElX: number
    startElY: number
    startElW: number
    startElH: number
    pxPerMm: number
  } | null>(null)

  // pxPerMm = how many CSS pixels equal 1mm *on screen*. With transform: scale,
  // the workspace's mm-based width is visually scaled by `totalScale`, so the
  // effective px/mm is `mmScale = totalScale * MM_PX`.
  function calcPxPerMm(): number {
    return mmScale > 0 ? mmScale : 3.78
  }

  function onElementMouseDown(e: React.MouseEvent, id: string) {
    if (!draft) return
    e.stopPropagation()
    setSelectedElId(id)
    const el = draft.elements.find((x) => x.id === id)
    if (!el) return
    dragStateRef.current = {
      mode: 'move',
      elId: id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startElX: el.x,
      startElY: el.y,
      startElW: el.width,
      startElH: el.height,
      pxPerMm: calcPxPerMm(),
    }
  }

  function onResizeMouseDown(e: React.MouseEvent, id: string) {
    if (!draft) return
    e.stopPropagation()
    e.preventDefault()
    const el = draft.elements.find((x) => x.id === id)
    if (!el) return
    dragStateRef.current = {
      mode: 'resize',
      elId: id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startElX: el.x,
      startElY: el.y,
      startElW: el.width,
      startElH: el.height,
      pxPerMm: calcPxPerMm(),
    }
  }

  React.useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const ds = dragStateRef.current
      if (!ds || !draft) return
      const dxPx = e.clientX - ds.startClientX
      const dyPx = e.clientY - ds.startClientY
      const dxMm = dxPx / ds.pxPerMm
      const dyMm = dyPx / ds.pxPerMm
      if (ds.mode === 'move') {
        const el = draft.elements.find((x) => x.id === ds.elId)
        if (!el) return
        let newX = ds.startElX + dxMm
        let newY = ds.startElY + dyMm
        // Snap to alignment guides (page edges + other elements) — Apps Script parity
        const snap = snapToGuides(ds.elId, newX, newY, draft.elements, draft.canvas)
        newX = snap.x
        newY = snap.y
        setGuides(snap.guides)
        // Snap to 0.5mm grid for cleaner UX (final)
        newX = Math.round(newX * 2) / 2
        newY = Math.round(newY * 2) / 2
        setDraft({
          ...draft,
          elements: draft.elements.map((x) =>
            x.id === ds.elId ? { ...x, x: newX, y: newY } : x,
          ),
        })
      } else {
        // resize
        let newW = ds.startElW + dxMm
        let newH = ds.startElH + dyMm
        newW = Math.max(2, Math.round(newW * 2) / 2)
        newH = Math.max(2, Math.round(newH * 2) / 2)
        setDraft({
          ...draft,
          elements: draft.elements.map((x) =>
            x.id === ds.elId ? { ...x, width: newW, height: newH } : x,
          ),
        })
      }
    }
    function onMouseUp() {
      dragStateRef.current = null
      // Clear alignment guides when drag ends
      setGuides({ x: [], y: [] })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [draft, mmScale])

  // Delete selected element with Delete/Backspace key (but not when typing)
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (!selectedElId || !draft) return
      e.preventDefault()
      setDraft({
        ...draft,
        elements: draft.elements.filter((el) => el.id !== selectedElId),
      })
      setSelectedElId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedElId, draft])

  // ── Element CRUD on draft ─────────────────────────────────────────────
  function addElement(type: StickerElementType) {
    if (!draft) return
    const newEl = makeElement(type)
    setDraft({ ...draft, elements: [...draft.elements, newEl] })
    setSelectedElId(newEl.id)
  }

  function deleteSelectedElement() {
    if (!draft || !selectedElId) return
    setDraft({
      ...draft,
      elements: draft.elements.filter((el) => el.id !== selectedElId),
    })
    setSelectedElId(null)
  }

  function updateSelectedElement(patch: Partial<StickerElement>) {
    if (!draft || !selectedElId) return
    setDraft({
      ...draft,
      elements: draft.elements.map((el) =>
        el.id === selectedElId ? { ...el, ...patch } : el,
      ),
    })
  }

  // ── Template-level actions ───────────────────────────────────────────
  function selectForEdit(t: StickerTemplate) {
    setEditingId(t.id)
    setDraft(structuredCloneSafe(t))
    setSelectedElId(null)
  }

  function duplicateTemplate(t: StickerTemplate) {
    const dup: StickerTemplate = {
      ...structuredCloneSafe(t),
      id: genTemplateId(),
      name: `${t.name} (สำเนา)`,
      isDefault: false,
    }
    // Reassign element ids to avoid collisions
    dup.elements = dup.elements.map((el) => ({ ...el, id: genElementId() }))
    createMutation.mutate(dup.name, {
      onSuccess: async (data) => {
        // Now overwrite with the duplicated elements via PUT
        await updateMutation.mutateAsync({ id: data.template.id, payload: dup })
        setEditingId(data.template.id)
        setDraft(structuredCloneSafe(dup))
        setSelectedElId(null)
      },
    })
  }

  function saveTemplate() {
    if (!draft || !editingId) return
    updateMutation.mutate({ id: editingId, payload: draft })
  }

  async function previewTemplate() {
    if (!draft) return
    try {
      // Find a real device assetNo to render with (preview with sample data)
      let assetNo: string | null = null
      try {
        const devRes = await fetch('/api/itam/devices?limit=1')
        if (devRes.ok) {
          const devJson = (await devRes.json()) as { devices: { assetCode: string }[] }
          assetNo = devJson.devices[0]?.assetCode ?? null
        }
      } catch (err) { console.error('[itam-sticker-editor]', err) }
      if (!assetNo) assetNo = SAMPLE_DEVICE.assetCode

      const res = await fetch('/api/itam/sticker/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetNo, templateId: draft.id }),
      })
      if (!res.ok) {
        // Fallback: try with bulk-render
        const bulk = await fetch('/api/itam/sticker/bulk-render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetNos: [assetNo], templateId: draft.id }),
        })
        if (!bulk.ok) throw new Error('Preview failed')
        const j = await bulk.json() as { stickers: { html: string }[] }
        setPreviewHtml(j.stickers[0]?.html ?? '')
      } else {
        const j = await res.json() as { html: string }
        setPreviewHtml(j.html)
      }
      setPreviewOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'พรีวิวไม่สำเร็จ')
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────
  const selectedEl = React.useMemo(
    () => draft?.elements.find((el) => el.id === selectedElId) ?? null,
    [draft, selectedElId],
  )

  // ── Render ────────────────────────────────────────────────────────────
  if (tplLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#f97316]" />
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            🎨 ตัวออกแบบสติกเกอร์
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            สร้างและแก้ไขเทมเพลตสติกเกอร์ — ลากเพื่อย้าย, ดึงมุมเพื่อปรับขนาด
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setSettingsOpen(true)}
            className="dark:border-slate-700 dark:bg-slate-800"
          >
            <SettingsIcon className="h-4 w-4" /> ตั้งค่าบริษัท
          </Button>
          <Button
            onClick={() => createMutation.mutate('เทมเพลตใหม่')}
            disabled={createMutation.isPending}
            className="bg-[#f97316] text-white hover:bg-[#ea580c]"
          >
            <Plus className="h-4 w-4" /> สร้างเทมเพลตใหม่
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_300px]">
        {/* ── Left: Template Library ────────────────────────────────── */}
        <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-slate-700 dark:text-slate-200">
              📚 คลังเทมเพลต
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            <div className="itam-scroll max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {templates.length === 0 && (
                <div className="py-8 text-center text-xs text-slate-400">
                  ยังไม่มีเทมเพลต
                </div>
              )}
              {templates.map((t) => {
                const isActive = activeId === t.id
                const isEditing = editingId === t.id
                return (
                  <div
                    key={t.id}
                    className={[
                      'rounded-md border p-2.5 transition cursor-pointer',
                      isEditing
                        ? 'border-[#f97316] bg-orange-50 dark:bg-orange-950/30'
                        : 'border-slate-200 hover:border-orange-300 dark:border-slate-700 dark:hover:border-orange-700',
                    ].join(' ')}
                    onClick={() => selectForEdit(t)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                          {t.name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {t.isDefault && (
                            <Badge className="bg-teal-100 text-teal-800 border-teal-300 text-[9px] dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800">
                              [เริ่มต้น]
                            </Badge>
                          )}
                          {isActive && (
                            <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[9px] dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">
                              ⭐ ใช้งาน
                            </Badge>
                          )}
                          {!isActive && !t.isDefault && (
                            <Badge className="bg-slate-100 text-slate-500 border-slate-200 text-[9px] dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                              📄 ปกติ
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-slate-400">
                          {t.canvas.width}×{t.canvas.height}mm · {t.elements.length} องค์ประกอบ
                        </div>
                      </div>
                    </div>
                    <div
                      className="mt-2 flex flex-wrap gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
                        onClick={() => selectForEdit(t)}
                        title="แก้ไข"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
                        onClick={() => duplicateTemplate(t)}
                        title="สำเนา"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
                        onClick={() => activateMutation.mutate(t.id)}
                        disabled={isActive || activateMutation.isPending}
                        title="ตั้งเป็นเทมเพลตที่ใช้งาน"
                      >
                        <Star className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        onClick={() => setDeleteTplId(t.id)}
                        disabled={t.isDefault || isActive}
                        title={t.isDefault ? 'ลบเทมเพลตเริ่มต้นไม่ได้' : isActive ? 'ลบเทมเพลตที่ใช้งานอยู่ไม่ได้' : 'ลบ'}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* ── Center: Workspace ─────────────────────────────────────── */}
        <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm text-slate-700 dark:text-slate-200">
                🖼️ Workspace
                {draft && (
                  <span className="ml-2 font-mono text-[10px] font-normal text-slate-400">
                    ({draft.canvas.width}×{draft.canvas.height}mm)
                  </span>
                )}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <Select
                  value={
                    draft
                      ? PAPER_PRESETS.find((p) => p.width === draft.canvas.width && p.height === draft.canvas.height)
                        ? `${draft.canvas.width}x${draft.canvas.height}`
                        : 'custom'
                      : 'custom'
                  }
                  onValueChange={(v) => {
                    if (!draft) return
                    if (v === 'custom') return
                    const [w, h] = v.split('x').map(Number)
                    setDraft({ ...draft, canvas: { ...draft.canvas, width: w, height: h } })
                  }}
                >
                  <SelectTrigger className="h-8 w-32 text-xs dark:bg-slate-800 dark:border-slate-700">
                    <SelectValue placeholder="Paper size" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAPER_PRESETS.map((p) => (
                      <SelectItem key={p.label} value={`${p.width}x${p.height}`}>
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">กำหนดเอง</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700">
                  <Label className="text-[11px] text-slate-500">Clip</Label>
                  <Switch
                    checked={draft?.overflow === 'visible'}
                    onCheckedChange={(c) => draft && setDraft({ ...draft, overflow: c ? 'visible' : 'clip' })}
                  />
                  <Label className="text-[11px] text-slate-500">Visible</Label>
                </div>
                {/* Zoom controls (Bug 1 fix) */}
                <div className="flex items-center gap-0.5 rounded-md border border-slate-200 px-1 py-0.5 dark:border-slate-700">
                  <Button
                    size="sm" variant="ghost" className="h-7 w-7 p-0"
                    onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}
                    disabled={zoom <= 0.25}
                    title="ซูมออก"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </Button>
                  <span className="min-w-[44px] text-center font-mono text-[11px] text-slate-600 dark:text-slate-300" title="ระดับซูม">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    size="sm" variant="ghost" className="h-7 w-7 p-0"
                    onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
                    disabled={zoom >= 4}
                    title="ซูมเข้า"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-7 w-7 p-0"
                    onClick={() => setZoom(1)}
                    disabled={zoom === 1}
                    title="รีเซ็ตซูม (100%)"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Workspace scrollable area — measures container width for fitScale */}
            <div
              ref={containerRef}
              className="itam-scroll overflow-auto rounded-md border border-slate-200 bg-slate-100 p-2 dark:border-slate-700 dark:bg-slate-950"
              style={{ height: '60vh' }}
              // Bug 2 fix: only deselect when clicking the workspace background
              // itself (not bubbling up from an element).
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setSelectedElId(null)
              }}
            >
              {draft && totalScale > 0 && (
                // Sizing wrapper: takes the scaled px dimensions so the parent's
                // overflow-auto shows scrollbars only when zoomed in beyond fit.
                <div
                  style={{
                    position: 'relative',
                    width: `${(draft.canvas.width + 60) * mmScale}px`,
                    height: `${(draft.canvas.height + 60) * mmScale}px`,
                  }}
                >
                  {/* Workspace (mm-based, visually scaled via transform) */}
                  <div
                    ref={workspaceRef}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: `${draft.canvas.width + 60}mm`,
                      height: `${draft.canvas.height + 60}mm`,
                      transform: `scale(${totalScale})`,
                      transformOrigin: 'top left',
                      backgroundImage:
                        'linear-gradient(rgba(148,163,184,0.15) 1px, transparent 1px),' +
                        'linear-gradient(90deg, rgba(148,163,184,0.15) 1px, transparent 1px)',
                      backgroundSize: '5mm 5mm',
                    }}
                    onMouseDown={(e) => {
                      if (e.target === e.currentTarget) setSelectedElId(null)
                    }}
                  >
                    {/* Top ruler — mm markers every 10mm (Apps Script parity) */}
                    <div
                      style={{
                        position: 'absolute',
                        left: '30mm',
                        top: '12mm',
                        width: `${draft.canvas.width}mm`,
                        height: '14mm',
                        fontSize: '8px',
                        color: '#94a3b8',
                        fontFamily: 'monospace',
                        pointerEvents: 'none',
                      }}
                    >
                      {Array.from({ length: Math.floor(draft.canvas.width / 10) + 1 }).map((_, i) => (
                        <span
                          key={`rt-${i}`}
                          style={{
                            position: 'absolute',
                            left: `${i * 10}mm`,
                            top: 0,
                            transform: 'translateX(-50%)',
                          }}
                        >
                          {i * 10}
                        </span>
                      ))}
                    </div>
                    {/* Left ruler — mm markers every 10mm */}
                    <div
                      style={{
                        position: 'absolute',
                        left: '12mm',
                        top: '30mm',
                        height: `${draft.canvas.height}mm`,
                        width: '14mm',
                        fontSize: '8px',
                        color: '#94a3b8',
                        fontFamily: 'monospace',
                        pointerEvents: 'none',
                      }}
                    >
                      {Array.from({ length: Math.floor(draft.canvas.height / 10) + 1 }).map((_, i) => (
                        <span
                          key={`rl-${i}`}
                          style={{
                            position: 'absolute',
                            top: `${i * 10}mm`,
                            left: 0,
                            transform: 'translateY(-50%)',
                          }}
                        >
                          {i * 10}
                        </span>
                      ))}
                    </div>
                    {/* Red boundary box showing actual template size */}
                    <div
                      style={{
                        position: 'absolute',
                        left: '30mm',
                        top: '30mm',
                        width: `${draft.canvas.width}mm`,
                        height: `${draft.canvas.height}mm`,
                        border: '2px dashed #ef4444',
                        background: '#ffffff',
                        overflow: draft.overflow === 'visible' ? 'visible' : 'hidden',
                        boxSizing: 'border-box',
                      }}
                      // Bug 2 fix: only deselect when clicking the boundary
                      // box directly (not bubbling up from an element).
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setSelectedElId(null)
                      }}
                    >
                      {/* White sticker container */}
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: '#ffffff',
                        }}
                      />
                      {/* Elements */}
                      {[...draft.elements]
                        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
                        .map((el) => (
                          <WorkspaceElement
                            key={el.id}
                            el={el}
                            selected={el.id === selectedElId}
                            exceedsBounds={elementExceedsBounds(el, draft.canvas)}
                            onMouseDown={onElementMouseDown}
                            onResizeMouseDown={onResizeMouseDown}
                            settings={settings ?? null}
                          />
                        ))}
                      {/* Alignment guides (dashed lines) — Apps Script parity */}
                      {guides.x.map((gx, i) => (
                        <div
                          key={`gx-${i}-${gx}`}
                          style={{
                            position: 'absolute',
                            left: `${gx}mm`,
                            top: 0,
                            bottom: 0,
                            width: 0,
                            borderLeft: '1px dashed #3b82f6',
                            pointerEvents: 'none',
                            zIndex: 9999,
                          }}
                        />
                      ))}
                      {guides.y.map((gy, i) => (
                        <div
                          key={`gy-${i}-${gy}`}
                          style={{
                            position: 'absolute',
                            top: `${gy}mm`,
                            left: 0,
                            right: 0,
                            height: 0,
                            borderTop: '1px dashed #3b82f6',
                            pointerEvents: 'none',
                            zIndex: 9999,
                          }}
                        />
                      ))}
                      {/* Corner label showing dimensions */}
                      <div
                        style={{
                          position: 'absolute',
                          top: '-16px',
                          left: 0,
                          fontSize: '10px',
                          color: '#ef4444',
                          fontWeight: 600,
                          fontFamily: 'monospace',
                          pointerEvents: 'none',
                        }}
                      >
                        {draft.canvas.width} × {draft.canvas.height} mm
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Toolbar */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-3 dark:border-slate-700">
              <Button size="sm" variant="outline" onClick={() => addElement('text')} className="dark:border-slate-700 dark:bg-slate-800">
                <Type className="h-3.5 w-3.5" /> +Text
              </Button>
              <Button size="sm" variant="outline" onClick={() => addElement('image')} className="dark:border-slate-700 dark:bg-slate-800">
                <ImageIcon className="h-3.5 w-3.5" /> +Image
              </Button>
              <Button size="sm" variant="outline" onClick={() => addElement('qr')} className="dark:border-slate-700 dark:bg-slate-800">
                <QrCode className="h-3.5 w-3.5" /> +QR
              </Button>
              <Button size="sm" variant="outline" onClick={() => addElement('rect')} className="dark:border-slate-700 dark:bg-slate-800">
                <Square className="h-3.5 w-3.5" /> +Rect
              </Button>
              <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
              <Button
                size="sm"
                variant="outline"
                onClick={deleteSelectedElement}
                disabled={!selectedEl}
                className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30"
              >
                <Trash2 className="h-3.5 w-3.5" /> ลบองค์ประกอบ
              </Button>
              <div className="ml-auto flex items-center gap-1.5">
                {/* Dirty indicator — shows when there are unsaved edits */}
                {isDirty && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    ยังไม่ได้บันทึก
                  </span>
                )}
                <Button size="sm" variant="outline" onClick={previewTemplate} disabled={!draft} className="dark:border-slate-700 dark:bg-slate-800">
                  <Eye className="h-3.5 w-3.5" /> พรีวิว
                </Button>
                <Button
                  size="sm"
                  onClick={saveTemplate}
                  disabled={!draft || updateMutation.isPending || !isDirty}
                  className="bg-[#f97316] text-white hover:bg-[#ea580c] disabled:opacity-50"
                  title={isDirty ? 'บันทึกการเปลี่ยนแปลง' : 'ไม่มีการเปลี่ยนแปลง'}
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}{' '}
                  บันทึก
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Right: Property Panel ─────────────────────────────────── */}
        <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-slate-700 dark:text-slate-200">
              ⚙️ คุณสมบัติ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 pt-0">
            {!selectedEl ? (
              <Tabs defaultValue="template" className="gap-0">
                <div className="pb-2">
                  <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                    คลิกที่องค์ประกอบใน workspace เพื่อแก้ไข หรือกดปุ่ม +Text/+Image/+QR/+Rect เพื่อเพิ่มใหม่
                  </div>
                  <TabsList className="grid h-8 w-full grid-cols-2">
                    <TabsTrigger value="template" onClick={() => {}} className="text-[11px]">เทมเพลต</TabsTrigger>
                    <TabsTrigger value="variables" onClick={() => {}} className="text-[11px]">ตัวแปร</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="template" className="mt-0 space-y-3">
                  {/* Template name */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">ชื่อเทมเพลต</Label>
                    <Input
                      value={draft?.name ?? ''}
                      onChange={(e) => draft && setDraft({ ...draft, name: e.target.value })}
                      className="text-xs dark:bg-slate-800 dark:border-slate-700"
                    />
                  </div>
                  {/* Canvas size custom */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">กว้าง (mm)</Label>
                      <Input
                        type="number" step="0.1" min="10" max="300"
                        value={draft?.canvas.width ?? ''}
                        onChange={(e) => draft && setDraft({ ...draft, canvas: { ...draft.canvas, width: Number(e.target.value) || 10 } })}
                        className="text-xs dark:bg-slate-800 dark:border-slate-700"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">สูง (mm)</Label>
                      <Input
                        type="number" step="0.1" min="10" max="300"
                        value={draft?.canvas.height ?? ''}
                        onChange={(e) => draft && setDraft({ ...draft, canvas: { ...draft.canvas, height: Number(e.target.value) || 10 } })}
                        className="text-xs dark:bg-slate-800 dark:border-slate-700"
                      />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="variables" className="mt-0 space-y-1.5">
                  <Label className="text-xs">ตัวแปร — คลิกเพื่อแทรกลงใน element ที่เลือก</Label>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    ถ้ายังไม่ได้เลือก element ใน canvas → ตัวแปรจะถูกคัดลอกไปยัง clipboard
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {STICKER_VARIABLES.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-orange-700 dark:hover:bg-orange-950 dark:hover:text-orange-300"
                        title={`คลิกเพื่อแทรก ${v} ลงใน element ที่เลือก`}
                        onClick={(e) => {
                          e.preventDefault()
                          // This toolbar renders inside the `{!selectedEl ? …}`
                          // panel (line ~1213), so no element is selected here
                          // by construction. The previous
                          // `selectedEl && (…type === 'text' || 'qr')` branch
                          // was unreachable dead code — it narrowed
                          // `selectedEl` to `never` — so the
                          // "insert variable into element" affordance never
                          // worked. Variables are inserted from the element
                          // properties panel where a selection exists; here we
                          // copy to the clipboard.
                          navigator.clipboard?.writeText(v).catch(() => {})
                          toast.success(`คัดลอก ${v} (คลิกที่ element ก่อนเพื่อแทรก)`)
                        }}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <Tabs defaultValue="position" className="gap-0">
                <div className="pb-2">
                  <div className="mb-2 flex items-center justify-between">
                    <Badge className="bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">
                      {selectedEl.type.toUpperCase()}
                    </Badge>
                    {elementExceedsBounds(selectedEl, draft!.canvas) && (
                      <Badge className="bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">
                        ⚠ ล้นขอบ
                      </Badge>
                    )}
                  </div>
                  <TabsList className="grid h-8 w-full grid-cols-4">
                    <TabsTrigger value="position" onClick={() => {}} className="text-[11px]">ตำแหน่ง</TabsTrigger>
                    <TabsTrigger value="style" onClick={() => {}} className="text-[11px]">สไตล์</TabsTrigger>
                    <TabsTrigger value="data" onClick={() => {}} className="text-[11px]">ข้อมูล</TabsTrigger>
                    <TabsTrigger value="advanced" onClick={() => {}} className="text-[11px]">ขั้นสูง</TabsTrigger>
                  </TabsList>
                </div>

                {/* Position & Size + Rotation */}
                <TabsContent value="position" className="mt-0 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="X (mm)" value={selectedEl.x} onChange={(v) => updateSelectedElement({ x: v })} step={0.5} />
                    <NumInput label="Y (mm)" value={selectedEl.y} onChange={(v) => updateSelectedElement({ y: v })} step={0.5} />
                    <NumInput label="W (mm)" value={selectedEl.width} onChange={(v) => updateSelectedElement({ width: v })} step={0.5} />
                    <NumInput label="H (mm)" value={selectedEl.height} onChange={(v) => updateSelectedElement({ height: v })} step={0.5} />
                    <NumInput label="หมุน (deg)" value={selectedEl.rotation ?? 0} onChange={(v) => updateSelectedElement({ rotation: v })} step={1} />
                  </div>
                </TabsContent>

                {/* Type-specific style */}
                <TabsContent value="style" className="mt-0 space-y-2">
                  {selectedEl.type === 'text' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <NumInput label="ขนาด (pt)" value={selectedEl.fontSize ?? 6} onChange={(v) => updateSelectedElement({ fontSize: v })} step={0.5} min={2} max={48} />
                        <div className="space-y-1.5">
                          <Label className="text-xs">น้ำหนัก</Label>
                          <Select
                            value={String(selectedEl.fontWeight ?? 500)}
                            onValueChange={(v) => updateSelectedElement({ fontWeight: Number(v) })}
                          >
                            <SelectTrigger className="text-xs dark:bg-slate-800 dark:border-slate-700">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="300">300 (บาง)</SelectItem>
                              <SelectItem value="400">400 (ปกติ)</SelectItem>
                              <SelectItem value="500">500</SelectItem>
                              <SelectItem value="600">600</SelectItem>
                              <SelectItem value="700">700 (หนา)</SelectItem>
                              <SelectItem value="800">800 (หนามาก)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">สี</Label>
                          <div className="flex gap-1.5">
                            <input
                              type="color"
                              value={selectedEl.color ?? '#1e293b'}
                              onChange={(e) => updateSelectedElement({ color: e.target.value })}
                              className="h-8 w-10 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
                            />
                            <Input
                              value={selectedEl.color ?? ''}
                              onChange={(e) => updateSelectedElement({ color: e.target.value })}
                              className="text-xs dark:bg-slate-800 dark:border-slate-700"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">จัดวางแนวนอน</Label>
                          <Select
                            value={selectedEl.align ?? 'left'}
                            onValueChange={(v) => updateSelectedElement({ align: v as 'left' | 'center' | 'right' })}
                          >
                            <SelectTrigger className="text-xs dark:bg-slate-800 dark:border-slate-700">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="left">ซ้าย</SelectItem>
                              <SelectItem value="center">กลาง</SelectItem>
                              <SelectItem value="right">ขวา</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">จัดวางแนวตั้ง</Label>
                          <Select
                            value={selectedEl.valign ?? 'top'}
                            onValueChange={(v) => updateSelectedElement({ valign: v as 'top' | 'center' | 'bottom' })}
                          >
                            <SelectTrigger className="text-xs dark:bg-slate-800 dark:border-slate-700">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="top">ชิดบน</SelectItem>
                              <SelectItem value="center">กลาง</SelectItem>
                              <SelectItem value="bottom">ชิดล่าง</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </>
                  )}

                  {selectedEl.type === 'rect' && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs">สีพื้น</Label>
                        <div className="flex gap-1.5">
                          <input
                            type="color"
                            value={selectedEl.background && selectedEl.background !== 'transparent' ? selectedEl.background : '#f97316'}
                            onChange={(e) => updateSelectedElement({ background: e.target.value })}
                            className="h-8 w-10 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
                          />
                          <Input
                            value={selectedEl.background ?? ''}
                            onChange={(e) => updateSelectedElement({ background: e.target.value })}
                            placeholder="transparent หรือ #f97316"
                            className="text-xs dark:bg-slate-800 dark:border-slate-700"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">ขอบ (border CSS)</Label>
                        <Input
                          value={selectedEl.border ?? ''}
                          onChange={(e) => updateSelectedElement({ border: e.target.value })}
                          placeholder="เช่น 1px solid #000 หรือ none"
                          className="text-xs dark:bg-slate-800 dark:border-slate-700"
                        />
                      </div>
                      <NumInput label="รัศมี (mm)" value={selectedEl.borderRadius ?? 0} onChange={(v) => updateSelectedElement({ borderRadius: v })} step={0.5} min={0} />
                    </>
                  )}

                  {selectedEl.type !== 'text' && selectedEl.type !== 'rect' && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                      ประเภท {selectedEl.type.toUpperCase()} ไม่มีคุณสมบัติสไตล์เพิ่มเติม
                    </div>
                  )}
                </TabsContent>

                {/* Type-specific data (content / source) */}
                <TabsContent value="data" className="mt-0 space-y-2">
                  {selectedEl.type === 'text' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">ข้อความ (คลิกตัวแปรด้านล่างเพื่อแทรก)</Label>
                      <Textarea
                        value={selectedEl.content ?? ''}
                        onChange={(e) => updateSelectedElement({ content: e.target.value })}
                        rows={4}
                        className="text-xs dark:bg-slate-800 dark:border-slate-700"
                        placeholder="พิมพ์ข้อความหรือคลิกตัวแปรด้านล่าง..."
                      />
                      {/* Quick variable insert buttons — right next to the textarea */}
                      <div className="rounded-md border border-slate-100 bg-slate-50/50 p-1.5 dark:border-slate-800 dark:bg-slate-900/30">
                        <div className="mb-1 text-[9px] font-medium uppercase text-slate-400 dark:text-slate-500">
                          คลิกเพื่อแทรกตัวแปร
                        </div>
                        <div className="flex flex-wrap gap-0.5">
                          {STICKER_VARIABLES.map((v) => (
                            <button
                              key={v}
                              type="button"
                              className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[8px] text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              title={`แทรก ${v}`}
                              onClick={() => {
                                const cur = selectedEl.content ?? ''
                                updateSelectedElement({ content: cur + v })
                              }}
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {selectedEl.type === 'image' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">URL รูปภาพ หรืออัปโหลดไฟล์</Label>
                      <Input
                        value={selectedEl.source ?? ''}
                        onChange={(e) => updateSelectedElement({ source: e.target.value })}
                        placeholder="https://... หรือกดอัปโหลดด้านล่าง"
                        className="text-xs dark:bg-slate-800 dark:border-slate-700"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => imageFileRef.current?.click()}
                          className="h-7 text-xs dark:border-slate-700 dark:bg-slate-800"
                        >
                          <Upload className="mr-1 h-3 w-3" />
                          อัปโหลดรูป
                        </Button>
                        {selectedEl.source?.startsWith('data:image/') && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => updateSelectedElement({ source: '' })}
                            className="h-7 text-xs text-red-500"
                          >
                            ลบรูป
                          </Button>
                        )}
                        <input
                          ref={imageFileRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            if (file.size > 2 * 1024 * 1024) { toast.error('รูปใหญ่เกินไป (สูงสุด 2MB)'); return }
                            const reader = new FileReader()
                            reader.onload = () => {
                              const img = new Image()
                              img.onload = () => {
                                const canvas = document.createElement('canvas')
                                const maxDim = 200
                                let { width, height } = img
                                if (width > height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim }
                                else if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim }
                                canvas.width = width; canvas.height = height
                                const ctx = canvas.getContext('2d')
                                if (!ctx) return
                                ctx.drawImage(img, 0, 0, width, height)
                                const dataUrl = canvas.toDataURL('image/png')
                                updateSelectedElement({ source: dataUrl })
                                toast.success('อัปโหลดรูปแล้ว')
                              }
                              img.src = reader.result as string
                            }
                            reader.readAsDataURL(file)
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400">
                        💡 วาง URL รูปภาพ หรือกดอัปโหลดไฟล์จากเครื่อง (PNG/SVG, สูงสุด 2MB, ย่ออัตโนมัติ 200×200)
                      </p>
                    </div>
                  )}
                  {selectedEl.type === 'qr' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">ข้อมูล QR (รองรับ {'{{ตัวแปร}}'})</Label>
                      <Input
                        value={selectedEl.content ?? ''}
                        onChange={(e) => updateSelectedElement({ content: e.target.value })}
                        placeholder="{{QrUrl}}"
                        className="text-xs dark:bg-slate-800 dark:border-slate-700"
                      />
                      <p className="text-[10px] text-slate-400">
                        💡 ใช้ตัวแปร {'{{QrUrl}}'} ในอิลิเมนต์ QR เพื่อสแกนแล้วเปิดหน้าแจ้งซ่อมอัตโนมัติ (ส่ง URL ไปยัง Smart QR Router แทนข้อความธรรมดา) — หากใช้ {'{{AssetNo}}'} QR จะเป็นรหัสอุปกรณ์แบบข้อความ
                      </p>
                    </div>
                  )}
                </TabsContent>

                {/* Advanced — opacity, z-index */}
                <TabsContent value="advanced" className="mt-0 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="Opacity (0-1)" value={selectedEl.opacity ?? 1} onChange={(v) => updateSelectedElement({ opacity: Math.min(1, Math.max(0, v)) })} step={0.1} min={0} max={1} />
                    <NumInput label="Z-Index" value={selectedEl.zIndex ?? 0} onChange={(v) => updateSelectedElement({ zIndex: v })} step={1} />
                  </div>
                </TabsContent>
              </Tabs>
            )}
            {selectedEl && (
              <Button
                size="sm" variant="outline"
                onClick={deleteSelectedElement}
                className="w-full border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30"
              >
                <Trash2 className="h-3.5 w-3.5" /> ลบองค์ประกอบนี้
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Preview modal ─────────────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-slate-800 dark:text-slate-100">
              👁️ พรีวิวสติกเกอร์
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ตัวอย่างสติกเกอร์สำหรับอุปกรณ์ <span className="font-mono font-semibold">{SAMPLE_DEVICE.assetCode}</span> ({SAMPLE_DEVICE.brand} {SAMPLE_DEVICE.model})
            </p>
            <div
              className="overflow-auto rounded-md border border-slate-200 bg-slate-100 p-8 dark:border-slate-700 dark:bg-slate-950"
              style={{ minHeight: 200 }}
            >
              {previewHtml ? (
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              ) : (
                <div className="text-center text-xs text-slate-400 py-8">กำลังโหลด...</div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ───────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTplId} onOpenChange={(o) => !o && setDeleteTplId(null)}>
        <AlertDialogContent className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบเทมเพลต?</AlertDialogTitle>
            <AlertDialogDescription>
              จะลบเทมเพลต{' '}
              <span className="font-semibold">
                {templates.find((t) => t.id === deleteTplId)?.name}
              </span>
              {' '}การกระทำนี้ย้อนกลับไม่ได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                if (deleteTplId) {
                  deleteMutation.mutate(deleteTplId, {
                    onSuccess: () => setDeleteTplId(null),
                  })
                }
              }}
              disabled={deleteMutation.isPending}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleteMutation.isPending ? 'กำลังลบ...' : 'ลบ'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Settings modal ───────────────────────────────────────────── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-slate-800 dark:text-slate-100">
              ตั้งค่าบริษัท / ข้อมูลสติกเกอร์
            </DialogTitle>
          </DialogHeader>
          {settingsForm && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">ชื่อบริษัท {'({{companyName}})'}</Label>
                <Input
                  value={settingsForm.companyName}
                  onChange={(e) => setSettingsForm({ ...settingsForm, companyName: e.target.value })}
                  className="text-xs dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">ชื่อองค์กร {'({{orgName}})'}</Label>
                <Input
                  value={settingsForm.orgName}
                  onChange={(e) => setSettingsForm({ ...settingsForm, orgName: e.target.value })}
                  className="text-xs dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">เบอร์ติดต่อ {'({{hotline}})'}</Label>
                <Input
                  value={settingsForm.hotline}
                  onChange={(e) => setSettingsForm({ ...settingsForm, hotline: e.target.value })}
                  className="text-xs dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">LINE OA {'({{lineOA}})'}</Label>
                <Input
                  value={settingsForm.lineOALink}
                  onChange={(e) => setSettingsForm({ ...settingsForm, lineOALink: e.target.value })}
                  className="text-xs dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">หมายเหตุท้ายสติกเกอร์ {'({{footerNote}})'}</Label>
                <Textarea
                  value={settingsForm.footerNote}
                  onChange={(e) => setSettingsForm({ ...settingsForm, footerNote: e.target.value })}
                  rows={2}
                  className="text-xs dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>ยกเลิก</Button>
            <Button
              onClick={() => settingsForm && saveSettingsMutation.mutate(settingsForm)}
              disabled={saveSettingsMutation.isPending || !settingsForm}
              className="bg-[#f97316] text-white hover:bg-[#ea580c]"
            >
              {saveSettingsMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────

function NumInput({
  label, value, onChange, step = 1, min, max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isFinite(n)) return
          onChange(n)
        }}
        step={step}
        min={min}
        max={max}
        className="text-xs dark:bg-slate-800 dark:border-slate-700"
      />
    </div>
  )
}

// Safe structured clone (with fallback for older browsers)
function structuredCloneSafe<T>(obj: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj)
    } catch (err) { console.error('[itam-sticker-editor]', err) }
  }
  return JSON.parse(JSON.stringify(obj)) as T
}
