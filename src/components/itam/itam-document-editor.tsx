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
  Square, Loader2, ChevronUp, ChevronDown, ArrowRight, X,
  ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react'
import {
  DOC_PAPER_PRESETS,
  DOCUMENT_VARIABLES,
  AVAILABLE_TABLE_COLUMNS,
  genElementId,
  type DocumentTemplate,
  type DocumentElement,
  type DocumentElementType,
  type DocumentTableColumn,
  type DocumentRenderRow,
} from '@/lib/document-template'
import { useLang } from '@/store/i18n-store'

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function genTemplateId(): string {
  return `doc-tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function makeElement(type: DocumentElementType): DocumentElement {
  // `base` deliberately omits `type` — each branch below supplies the concrete
  // discriminant. Annotating it as a full `DocumentElement` (which requires
  // `type`) made this object literal fail with TS2741.
  const base: Omit<DocumentElement, 'type'> = {
    id: genElementId(),
    x: 10, y: 30, width: 40, height: 5,
    opacity: 1, zIndex: 1,
  }
  if (type === 'text') {
    return { ...base, type, width: 80, height: 5, content: 'ข้อความใหม่', fontSize: 10, fontWeight: 600, color: '#1e293b', align: 'left' }
  }
  if (type === 'image') {
    return { ...base, type, width: 30, height: 15, content: '' }
  }
  // rect
  return { ...base, type, width: 100, height: 0.5, background: '#f97316', border: 'none', borderRadius: 0 }
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
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) setSize({ width: r.width, height: r.height })
    return () => ro.disconnect()
  }, [])

  const totalWmm = canvasWmm + padMm * 2
  const totalHmm = canvasHmm + padMm * 2
  const nativeWpx = totalWmm * MM_PX
  const nativeHpx = totalHmm * MM_PX
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

// Sample rows for preview
const SAMPLE_ROWS: DocumentRenderRow[] = [
  { no: 1, brand: 'HP', model: 'LaserJet Pro M404', serial: 'SN001234', remark: 'ปริ้นเตอร์เลเซอร์ขาวดำ', pagesCurrent: 1200, bwRate: 0.5, startMeter: 0.5, rowCost: 600, momPercent: 7, difference: 0, endMeter: 600, pagesPrevious: 5 },
  { no: 2, brand: 'Canon', model: 'imageRUNNER 2630', serial: 'SN005678', remark: 'มัลติฟังก์ชั่นสี', pagesCurrent: 850, bwRate: 0.5, startMeter: 0.8, rowCost: 680, momPercent: 7, difference: 0, endMeter: 680, pagesPrevious: 3 },
  { no: 3, brand: 'KYOCERA', model: 'ECOSYS P3260dn', serial: 'SN009012', remark: 'ปริ้นเตอร์ A4 ความเร็วสูง', pagesCurrent: 2400, bwRate: 0.5, startMeter: 0.4, rowCost: 960, momPercent: 7, difference: 0, endMeter: 960, pagesPrevious: 8 },
  { no: 4, brand: 'Brother', model: 'MFC-L8900CDW', serial: 'SN003456', remark: 'ปริ้นเตอร์สีเลเซอร์', pagesCurrent: 540, bwRate: 0.5, startMeter: 1.5, rowCost: 810, momPercent: 7, difference: 0, endMeter: 810, pagesPrevious: 0 },
  { no: 5, brand: 'Epson', model: 'EcoTank L15150', serial: 'SN007890', remark: 'ปริ้นเตอร์อิงค์แทงค์', pagesCurrent: 320, bwRate: 0.5, startMeter: 0.3, rowCost: 96, momPercent: 7, difference: 0, endMeter: 96, pagesPrevious: 2 },
]

// ─────────────────────────────────────────────────────────────────────────
// Workspace element renderer (visual on the page canvas)
// ─────────────────────────────────────────────────────────────────────────

function WorkspaceElement({
  el,
  selected,
  onMouseDown,
  onResizeMouseDown,
}: {
  el: DocumentElement
  selected: boolean
  onMouseDown: (e: React.MouseEvent, id: string) => void
  onResizeMouseDown: (e: React.MouseEvent, id: string) => void
}) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${el.x}mm`,
    top: `${el.y}mm`,
    width: `${el.width}mm`,
    height: `${el.height}mm`,
    opacity: el.opacity ?? 1,
    zIndex: el.zIndex ?? 0,
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
      lineHeight: 1.2,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'hidden',
      fontFamily: '"Sukhumvit Set","Noto Sans Thai","Tahoma","Segoe UI",sans-serif',
    })
    content = el.content || '​'
  } else if (el.type === 'rect') {
    Object.assign(style, {
      background: el.background || 'transparent',
      border: el.border || 'none',
      borderRadius: el.borderRadius ? `${el.borderRadius}mm` : undefined,
    })
  } else if (el.type === 'image') {
    Object.assign(style, { objectFit: 'contain' as const })
    if (el.content) {
      return (
        <img
          src={el.content}
          alt=""
          style={style}
          draggable={false}
          onMouseDown={(e) => onMouseDown(e, el.id)}
        />
      )
    }
    Object.assign(style, {
      background: '#f1f5f9', border: '1px dashed #cbd5e1',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#94a3b8', fontSize: '8pt',
    })
    content = '(image)'
  }

  return (
    <div
      style={style}
      onMouseDown={(e) => onMouseDown(e, el.id)}
      className={selected ? 'ring-2 ring-[#f97316] ring-offset-1' : ''}
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

export function ItamDocumentEditor() {
  const qc = useQueryClient()
  const { lang } = useLang()
  const workspaceRef = React.useRef<HTMLDivElement>(null)

  // ── Zoom + fit-scale (Bug 1: canvas too large) ───────────────────────
  // Workspace scales to fit the container; user can zoom +/- from toolbar.
  const [zoom, setZoom] = React.useState(1)
  // Alignment guides (dashed lines when element aligns with others)
  const [guides, setGuides] = React.useState<{ x: number[]; y: number[] }>({ x: [], y: [] })

  // ── Data: templates ───────────────────────────────────────────────────
  const { data: tplData, isLoading: tplLoading } = useQuery({
    queryKey: ['document-templates'],
    queryFn: async () => {
      const res = await fetch('/api/itam/document-templates')
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{
        templates: DocumentTemplate[]
        activeId: string | null
        enabled: boolean
      }>
    },
  })

  const templates = tplData?.templates ?? []
  const activeId = tplData?.activeId ?? null
  const enabled = tplData?.enabled ?? false

  // ── Editing state ─────────────────────────────────────────────────────
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<DocumentTemplate | null>(null)
  const [selectedElId, setSelectedElId] = React.useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = React.useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [deleteTplId, setDeleteTplId] = React.useState<string | null>(null)
  // ── Dirty tracking — shows "ยังไม่ได้บันทึก" indicator when draft ≠ saved ──
  // Helps users see their edits are pending and need saving.
  const [savedSnapshot, setSavedSnapshot] = React.useState<string>('')
  const isDirty = draft ? JSON.stringify(draft) !== savedSnapshot : false

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

  // ── Mutations ─────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/itam/document-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json() as Promise<{ template: DocumentTemplate }>
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      setEditingId(data.template.id)
      const cloned = structuredCloneSafe(data.template)
      setDraft(cloned)
      setSavedSnapshot(JSON.stringify(cloned))
      setSelectedElId(null)
      toast.success('สร้างเทมเพลตแล้ว')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'สร้างไม่สำเร็จ'),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: DocumentTemplate }) => {
      const res = await fetch(`/api/itam/document-templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          canvas: payload.canvas,
          elements: payload.elements,
          table: payload.table,
          summary: payload.summary,
          footer: payload.footer,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json() as Promise<{ template: DocumentTemplate }>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('บันทึกเทมเพลตแล้ว')
      // Update saved snapshot so isDirty resets to false
      if (draft) setSavedSnapshot(JSON.stringify(draft))
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/itam/document-templates/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
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
      const res = await fetch(`/api/itam/document-templates/${id}/activate`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('ตั้งเป็นเทมเพลตที่ใช้งานแล้ว')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'ตั้งค่าไม่สำเร็จ'),
  })

  const toggleEnabledMutation = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await fetch('/api/itam/document-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) throw new Error('Failed')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('บันทึกการตั้งค่าแล้ว')
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  })

  // ── Drag logic ─────────────────────────────────────────────────────────
  // fitScale hook — measured from the container (Bug 1 fix)
  const { containerRef, mmScale, totalScale } = useFitScale(
    draft?.canvas.width ?? 297,
    draft?.canvas.height ?? 210,
    20,
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
        newH = Math.max(0.5, Math.round(newH * 2) / 2)
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
  function addElement(type: DocumentElementType) {
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

  function updateSelectedElement(patch: Partial<DocumentElement>) {
    if (!draft || !selectedElId) return
    setDraft({
      ...draft,
      elements: draft.elements.map((el) =>
        el.id === selectedElId ? { ...el, ...patch } : el,
      ),
    })
  }

  // ── Template-level actions ───────────────────────────────────────────
  function selectForEdit(t: DocumentTemplate) {
    setEditingId(t.id)
    const cloned = structuredCloneSafe(t)
    setDraft(cloned)
    setSavedSnapshot(JSON.stringify(cloned))
    setSelectedElId(null)
  }

  function duplicateTemplate(t: DocumentTemplate) {
    const dup: DocumentTemplate = {
      ...structuredCloneSafe(t),
      id: genTemplateId(),
      name: `${t.name} (สำเนา)`,
      isDefault: false,
    }
    dup.elements = dup.elements.map((el) => ({ ...el, id: genElementId() }))
    createMutation.mutate(dup.name, {
      onSuccess: async (data) => {
        await updateMutation.mutateAsync({ id: data.template.id, payload: dup })
        setEditingId(data.template.id)
        const cloned = structuredCloneSafe(dup)
        setDraft(cloned)
        setSavedSnapshot(JSON.stringify(cloned))
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
      const res = await fetch('/api/itam/document-templates/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: draft.id,
          data: {
            title: draft.name || 'ตัวอย่างเอกสาร',
            rows: SAMPLE_ROWS,
            month: 'ม.ค. 2569',
            siteName: 'ชื่อสาขา',  // generic — user sets their own
            contractNo: 'CTR-2569-001',
          },
        }),
      })
      if (!res.ok) throw new Error('Preview failed')
      const j = await res.json() as { html: string; totalPages: number }
      setPreviewHtml(j.html)
      setPreviewOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'พรีวิวไม่สำเร็จ')
    }
  }

  // ── Table column management ──────────────────────────────────────────
  function addColumn(key: string) {
    if (!draft) return
    const col = AVAILABLE_TABLE_COLUMNS.find((c) => c.key === key)
    if (!col) return
    if (draft.table.columns.some((c) => c.key === key)) return
    const newCol: DocumentTableColumn = {
      key: col.key,
      label: col.label,
      width: col.defaultWidth,
      numeric: col.numeric,
    }
    setDraft({
      ...draft,
      table: { ...draft.table, columns: [...draft.table.columns, newCol] },
    })
  }

  function removeColumn(idx: number) {
    if (!draft) return
    const next = [...draft.table.columns]
    next.splice(idx, 1)
    setDraft({ ...draft, table: { ...draft.table, columns: next } })
  }

  function moveColumn(idx: number, dir: -1 | 1) {
    if (!draft) return
    const next = [...draft.table.columns]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    const tmp = next[idx]
    next[idx] = next[target]
    next[target] = tmp
    setDraft({ ...draft, table: { ...draft.table, columns: next } })
  }

  function updateColumn(idx: number, patch: Partial<DocumentTableColumn>) {
    if (!draft) return
    const next = [...draft.table.columns]
    next[idx] = { ...next[idx], ...patch }
    setDraft({ ...draft, table: { ...draft.table, columns: next } })
  }

  // ── Summary management ───────────────────────────────────────────────
  const SUMMARY_KEYS = [
    { key: 'totalCost', label: 'รวมมูลค่าสินค้า' },
    { key: 'totalDiscount', label: 'รวมส่วนลด' },
    { key: 'totalVat', label: 'รวมภาษีมูลค่าเพิ่ม' },
    { key: 'totalNet', label: 'รวมเงินสุทธิ' },
  ]

  function toggleSummary(key: string, label: string) {
    if (!draft) return
    if (draft.summary.some((s) => s.valueKey === key)) {
      setDraft({ ...draft, summary: draft.summary.filter((s) => s.valueKey !== key) })
    } else {
      setDraft({
        ...draft,
        summary: [...draft.summary, { label, valueKey: key, align: 'right' }],
      })
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
            📄 ตัวออกแบบเอกสาร PDF
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            สร้างและแก้ไขเทมเพลตเอกสาร PDF — ลากเพื่อย้ายส่วนหัว, เลือกคอลัมน์ตาราง, สรุปยอด
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 dark:border-slate-700">
            <Label className="text-[11px] text-slate-500">เปิดใช้งาน Template</Label>
            <Switch
              checked={enabled}
              onCheckedChange={(c) => toggleEnabledMutation.mutate(c)}
            />
          </div>
          <Button
            onClick={() => createMutation.mutate('เทมเพลตเอกสารใหม่')}
            disabled={createMutation.isPending}
            className="bg-[#f97316] text-white hover:bg-[#ea580c]"
          >
            <Plus className="h-4 w-4" /> สร้างเทมเพลตใหม่
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_320px]">
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
                          {t.canvas.width}×{t.canvas.height}mm · {t.table.columns.length} คอลัมน์
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
                    ({draft.canvas.width}×{draft.canvas.height}mm · {draft.canvas.orientation})
                  </span>
                )}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <Select
                  value={
                    draft
                      ? DOC_PAPER_PRESETS.find((p) =>
                        p.width === draft.canvas.width &&
                        p.height === draft.canvas.height &&
                        p.paper === draft.canvas.paper,
                      )
                        ? `${draft.canvas.paper}|${draft.canvas.width}x${draft.canvas.height}|${draft.canvas.orientation}`
                        : 'custom'
                      : 'custom'
                  }
                  onValueChange={(v) => {
                    if (!draft) return
                    if (v === 'custom') return
                    const [paper, size, orient] = v.split('|')
                    const [w, h] = size.split('x').map(Number)
                    setDraft({
                      ...draft,
                      canvas: {
                        ...draft.canvas,
                        paper: paper as DocumentTemplate['canvas']['paper'],
                        width: w,
                        height: h,
                        orientation: orient as 'portrait' | 'landscape',
                      },
                    })
                  }}
                >
                  <SelectTrigger className="h-8 w-52 text-xs dark:bg-slate-800 dark:border-slate-700">
                    <SelectValue placeholder="Paper size" />
                  </SelectTrigger>
                  <SelectContent>
                    {DOC_PAPER_PRESETS.map((p) => (
                      <SelectItem
                        key={p.label}
                        value={`${p.paper}|${p.width}x${p.height}|${p.orientation}`}
                      >
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">กำหนดเอง</SelectItem>
                  </SelectContent>
                </Select>
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
                    width: `${(draft.canvas.width + 40) * mmScale}px`,
                    height: `${(draft.canvas.height + 40) * mmScale}px`,
                  }}
                >
                  {/* Workspace (mm-based, visually scaled via transform) */}
                  <div
                    ref={workspaceRef}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: `${draft.canvas.width + 40}mm`,
                      height: `${draft.canvas.height + 40}mm`,
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
                        left: '20mm',
                        top: '6mm',
                        width: `${draft.canvas.width}mm`,
                        height: '10mm',
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
                        left: '6mm',
                        top: '20mm',
                        height: `${draft.canvas.height}mm`,
                        width: '10mm',
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
                    {/* Boundary box showing actual page size — with footer indicator */}
                    <div
                      style={{
                        position: 'absolute',
                        left: '20mm',
                        top: '20mm',
                        width: `${draft.canvas.width}mm`,
                        height: `${draft.canvas.height}mm`,
                        border: '2px dashed #ef4444',
                        background: '#ffffff',
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                      }}
                      // Bug 2 fix: only deselect when clicking the boundary
                      // box directly (not bubbling up from an element).
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setSelectedElId(null)
                      }}
                    >
                    {/* Margin indicators */}
                    <div
                      style={{
                        position: 'absolute',
                        left: `${draft.canvas.margin}mm`,
                        top: `${draft.canvas.margin}mm`,
                        right: `${draft.canvas.margin}mm`,
                        bottom: `${draft.canvas.margin}mm`,
                        border: '1px dashed #cbd5e1',
                        pointerEvents: 'none',
                      }}
                    />
                    {/* Page edge labels — clear indication of where the paper ends */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '1mm',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        fontSize: '7pt',
                        color: '#ef4444',
                        background: 'rgba(255,255,255,0.9)',
                        padding: '0 2mm',
                        borderRadius: '2px',
                        pointerEvents: 'none',
                        fontWeight: 600,
                      }}
                    >
                      ↑ ขอบกระดาษด้านบน (Top edge)
                    </div>
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '1mm',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        fontSize: '7pt',
                        color: '#ef4444',
                        background: 'rgba(255,255,255,0.9)',
                        padding: '0 2mm',
                        borderRadius: '2px',
                        pointerEvents: 'none',
                        fontWeight: 600,
                        zIndex: 50,
                      }}
                    >
                      ↓ ขอบกระดาษด้านล่าง (Bottom edge) — ท้ายกระดาษจริง
                    </div>
                    {/* Bottom margin measurement guide */}
                    <div
                      style={{
                        position: 'absolute',
                        left: '0',
                        right: '0',
                        bottom: `${draft.canvas.margin}mm`,
                        height: '0',
                        borderTop: '1px dotted #10b981',
                        pointerEvents: 'none',
                        zIndex: 40,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        right: '1mm',
                        bottom: `${draft.canvas.margin / 2}mm`,
                        transform: 'translateY(50%)',
                        fontSize: '7pt',
                        color: '#10b981',
                        background: 'rgba(255,255,255,0.9)',
                        padding: '0 2mm',
                        borderRadius: '2px',
                        pointerEvents: 'none',
                        fontWeight: 600,
                        zIndex: 41,
                      }}
                    >
                      Margin {draft.canvas.margin}mm →
                    </div>
                    {/* Header elements */}
                    {[...draft.elements]
                      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
                      .map((el) => (
                        <WorkspaceElement
                          key={el.id}
                          el={el}
                          selected={el.id === selectedElId}
                          onMouseDown={onElementMouseDown}
                          onResizeMouseDown={onResizeMouseDown}
                        />
                      ))}
                    {/* Table area preview */}
                    <div
                      style={{
                        position: 'absolute',
                        left: `${draft.canvas.margin}mm`,
                        top: `${draft.table.y}mm`,
                        width: `${draft.table.columns.reduce((s, c) => s + c.width, 0)}mm`,
                      }}
                      // Bug 2 fix: stop bubbling so click on table doesn't deselect.
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {/* Table header */}
                      <div style={{ display: 'flex', background: draft.table.headerColor, color: draft.table.headerTextColor, fontSize: `${draft.table.fontSize - 1}pt`, fontWeight: 600 }}>
                        {draft.table.columns.map((c) => (
                          <div
                            key={c.key}
                            style={{
                              width: `${c.width}mm`,
                              padding: '2px 4px',
                              textAlign: c.numeric ? 'right' : 'left',
                              borderRight: '1px solid #e2e8f0',
                            }}
                          >
                            {c.label}
                          </div>
                        ))}
                      </div>
                      {/* Sample rows */}
                      {SAMPLE_ROWS.slice(0, 3).map((r, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            background: i % 2 === 1 ? '#fafbfc' : '#ffffff',
                            fontSize: `${draft.table.fontSize}pt`,
                          }}
                        >
                          {draft.table.columns.map((c) => {
                            const v = (r as Record<string, unknown>)[c.key]
                            const text = c.numeric
                              ? (typeof v === 'number' ? v.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB') : '')
                              : String(v ?? '')
                            return (
                              <div
                                key={c.key}
                                style={{
                                  width: `${c.width}mm`,
                                  padding: '2px 4px',
                                  textAlign: c.numeric ? 'right' : 'left',
                                  borderRight: '1px solid #e2e8f0',
                                  borderBottom: '1px solid #e2e8f0',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {text || '—'}
                              </div>
                            )
                          })}
                        </div>
                      ))}
                      {/* Continuation indicator */}
                      <div style={{ padding: '2px 4px', fontSize: `${draft.table.fontSize - 1}pt`, color: '#94a3b8', textAlign: 'center' }}>
                        … ({SAMPLE_ROWS.length} แถวตัวอย่างในพรีวิว)
                      </div>
                    </div>
                    {/* Footer area — EXACT match to PDF output (render the same HTML structure as renderPDFFromTemplate) */}
                    {(() => {
                      // Mirror of renderPDFFromTemplate() footer rendering — keep in sync!
                      // Variable substitution preview (use sample values so user sees real output)
                      const previewVars: Record<string, string> = {
                        '{{pageNumber}}': '1',
                        '{{totalPages}}': '3',
                        '{{pdfPageCount}}': '1/3',
                        '{{printedAt}}': new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' }),
                        '{{reportTitle}}': draft.name || 'รายงานเอกสาร',
                        '{{month}}': 'ม.ค. 2569',
                        '{{siteName}}': 'ชื่อสาขา',
                        '{{contractNo}}': 'CTR-2569-001',
                        '{{deviceCount}}': String(SAMPLE_ROWS.length),
                      }
                      let footerText = draft.footer.content ?? ''
                      for (const [k, v] of Object.entries(previewVars)) {
                        footerText = footerText.split(k).join(v)
                      }
                      const sigs = draft.footer.signatures ?? []
                      const fontSize = draft.footer.fontSize ?? 8
                      const color = draft.footer.color ?? '#94a3b8'
                      return (
                        <div
                          style={{
                            position: 'absolute',
                            left: `${draft.canvas.margin}mm`,
                            right: `${draft.canvas.margin}mm`,
                            bottom: `${draft.canvas.margin}mm`,
                            height: `${draft.footer.height}mm`,
                            // Visual hint: subtle highlight so user can see the area,
                            // but renders to transparent in PDF (PDF uses no background)
                            background: 'repeating-linear-gradient(45deg, rgba(254,243,199,0.45) 0 4px, rgba(254,243,199,0.25) 4px 8px)',
                            borderTop: '1px solid #e2e8f0', // matches PDF
                            outline: '1px dashed #f59e0b',
                            outlineOffset: '-1px',
                            fontSize: `${fontSize}pt`,
                            color,
                            overflow: 'hidden',
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          title={`ท้ายกระดาษ · ความสูง ${draft.footer.height}mm · ระยะจากขอบล่าง ${draft.canvas.margin}mm`}
                        >
                          {/* Top row: footer text (left) + org name (right) — matches PDF exactly */}
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-end',
                            paddingTop: '1mm',
                            paddingLeft: '2mm',
                            paddingRight: '2mm',
                            color,
                            fontSize: `${fontSize}pt`,
                          }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                              {footerText || '— ไม่มีเนื้อหาท้ายกระดาษ —'}
                            </div>
                            <div style={{ color, fontSize: `${fontSize}pt` }}>
                              องค์กร — IT Asset Management
                            </div>
                          </div>
                          {/* Bottom row: signature boxes — matches PDF exactly */}
                          {sigs.length > 0 && (
                            <div style={{ display: 'flex', gap: '8mm', marginTop: '1mm', paddingLeft: '2mm', paddingRight: '2mm' }}>
                              {sigs.map((s, i) => (
                                <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                                  <div style={{
                                    marginTop: '4mm',
                                    borderTop: '1px solid #475569',
                                    paddingTop: '1mm',
                                    fontSize: `${fontSize}pt`,
                                    color: '#475569',
                                  }}>
                                    {s || `— ช่องที่ ${i + 1} —`}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Floating badge: makes it clear this is the footer area */}
                          <div style={{
                            position: 'absolute',
                            top: '-7px',
                            right: '4px',
                            background: '#f59e0b',
                            color: 'white',
                            fontSize: '7pt',
                            fontWeight: 600,
                            padding: '1px 4px',
                            borderRadius: '2px',
                            pointerEvents: 'none',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                          }}>
                            FOOTER · {draft.footer.height}mm
                          </div>
                        </div>
                      )
                    })()}
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
                    คลิกที่องค์ประกอบใน workspace เพื่อแก้ไข หรือกดปุ่ม +Text/+Image/+Rect เพื่อเพิ่มใหม่
                  </div>
                  <TabsList className="grid h-8 w-full grid-cols-3 sm:grid-cols-6">
                    <TabsTrigger value="template" onClick={() => {}} className="text-[10px] leading-none sm:text-[11px]">เทมเพลต</TabsTrigger>
                    <TabsTrigger value="table" onClick={() => {}} className="text-[10px] leading-none sm:text-[11px]">ตาราง</TabsTrigger>
                    <TabsTrigger value="columns" onClick={() => {}} className="text-[10px] leading-none sm:text-[11px]">คอลัมน์</TabsTrigger>
                    <TabsTrigger value="summary" onClick={() => {}} className="text-[10px] leading-none sm:text-[11px]">สรุปยอด</TabsTrigger>
                    <TabsTrigger value="footer" onClick={() => {}} className="text-[10px] leading-none sm:text-[11px]">Footer</TabsTrigger>
                    <TabsTrigger value="variables" onClick={() => {}} className="text-[10px] leading-none sm:text-[11px]">ตัวแปร</TabsTrigger>
                  </TabsList>
                </div>

                {/* Template + canvas settings */}
                <TabsContent value="template" className="mt-0 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">ชื่อเทมเพลต</Label>
                    <Input
                      value={draft?.name ?? ''}
                      onChange={(e) => draft && setDraft({ ...draft, name: e.target.value })}
                      className="text-xs dark:bg-slate-800 dark:border-slate-700"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="กว้าง (mm)" value={draft?.canvas.width ?? 0} onChange={(v) => draft && setDraft({ ...draft, canvas: { ...draft.canvas, width: v } })} step={1} min={50} max={600} />
                    <NumInput label="สูง (mm)" value={draft?.canvas.height ?? 0} onChange={(v) => draft && setDraft({ ...draft, canvas: { ...draft.canvas, height: v } })} step={1} min={50} max={600} />
                    <NumInput label="Margin (mm)" value={draft?.canvas.margin ?? 0} onChange={(v) => draft && setDraft({ ...draft, canvas: { ...draft.canvas, margin: v } })} step={0.5} min={0} max={30} />
                    <div className="space-y-1.5">
                      <Label className="text-xs">การวาง</Label>
                      <Select
                        value={draft?.canvas.orientation ?? 'landscape'}
                        onValueChange={(v) => draft && setDraft({ ...draft, canvas: { ...draft.canvas, orientation: v as 'portrait' | 'landscape' } })}
                      >
                        <SelectTrigger className="text-xs dark:bg-slate-800 dark:border-slate-700">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="landscape">แนวนอน</SelectItem>
                          <SelectItem value="portrait">แนวตั้ง</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </TabsContent>

                {/* Table settings */}
                <TabsContent value="table" className="mt-0 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <NumInput label="Y (mm)" value={draft?.table.y ?? 40} onChange={(v) => draft && setDraft({ ...draft, table: { ...draft.table, y: v } })} step={0.5} min={0} />
                    <NumInput label="สูงแถว" value={draft?.table.rowHeight ?? 7} onChange={(v) => draft && setDraft({ ...draft, table: { ...draft.table, rowHeight: v } })} step={0.5} min={3} />
                    <NumInput label="ขนาด Font" value={draft?.table.fontSize ?? 9} onChange={(v) => draft && setDraft({ ...draft, table: { ...draft.table, fontSize: v } })} step={0.5} min={5} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">สีหัวตาราง</Label>
                      <div className="flex gap-1.5">
                        <input
                          type="color"
                          value={draft?.table.headerColor ?? '#f97316'}
                          onChange={(e) => draft && setDraft({ ...draft, table: { ...draft.table, headerColor: e.target.value } })}
                          className="h-8 w-10 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
                        />
                        <Input
                          value={draft?.table.headerColor ?? ''}
                          onChange={(e) => draft && setDraft({ ...draft, table: { ...draft.table, headerColor: e.target.value } })}
                          className="text-xs dark:bg-slate-800 dark:border-slate-700"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">สีตัวอักษรหัว</Label>
                      <div className="flex gap-1.5">
                        <input
                          type="color"
                          value={draft?.table.headerTextColor ?? '#ffffff'}
                          onChange={(e) => draft && setDraft({ ...draft, table: { ...draft.table, headerTextColor: e.target.value } })}
                          className="h-8 w-10 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
                        />
                        <Input
                          value={draft?.table.headerTextColor ?? ''}
                          onChange={(e) => draft && setDraft({ ...draft, table: { ...draft.table, headerTextColor: e.target.value } })}
                          className="text-xs dark:bg-slate-800 dark:border-slate-700"
                        />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Column picker — improved with width slider + drag hint */}
                <TabsContent value="columns" className="mt-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      คอลัมน์ตาราง ({draft?.table.columns.length ?? 0})
                    </Label>
                    <span className="text-[10px] text-slate-400">
                      ความกว้างรวม: {(draft?.table.columns.reduce((sum, c) => sum + c.width, 0) ?? 0).toFixed(0)}mm
                      {draft && draft.table.columns.reduce((s, c) => s + c.width, 0) > 190 && (
                        <span className="ml-1 text-rose-500">(อาจล้นหน้ากระดาษ A4)</span>
                      )}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {(draft?.table.columns ?? []).map((c, i) => (
                      <div
                        key={c.key}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800"
                      >
                        {/* Up/Down */}
                        <div className="flex flex-col">
                          <button
                            type="button"
                            onClick={() => moveColumn(i, -1)}
                            disabled={i === 0}
                            className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                            title="เลื่อนขึ้น"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveColumn(i, 1)}
                            disabled={i === (draft?.table.columns.length ?? 0) - 1}
                            className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                            title="เลื่อนลง"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </div>
                        {/* Label */}
                        <Input
                          value={c.label}
                          onChange={(e) => updateColumn(i, { label: e.target.value })}
                          className="h-7 flex-1 text-[11px] dark:bg-slate-900 dark:border-slate-700"
                          title="ชื่อคอลัมน์"
                        />
                        {/* Width — slider + number */}
                        <div className="flex items-center gap-1">
                          <input
                            type="range"
                            min="5"
                            max="40"
                            value={c.width}
                            onChange={(e) => updateColumn(i, { width: Number(e.target.value) })}
                            className="h-1 w-16 cursor-pointer accent-orange-500"
                            title={`ความกว้าง: ${c.width}mm`}
                          />
                          <Input
                            type="number"
                            value={c.width}
                            onChange={(e) => updateColumn(i, { width: Number(e.target.value) || 5 })}
                            className="h-7 w-12 text-[11px] dark:bg-slate-900 dark:border-slate-700"
                            title="ความกว้าง (mm)"
                          />
                          <span className="text-[9px] text-slate-400">mm</span>
                        </div>
                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => removeColumn(i)}
                          className="flex h-6 w-6 items-center justify-center rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          title="ลบคอลัมน์"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {(draft?.table.columns.length ?? 0) === 0 && (
                      <div className="py-4 text-center text-xs text-slate-400">
                        ยังไม่มีคอลัมน์ — เพิ่มจากด้านล่าง
                      </div>
                    )}
                  </div>
                  {/* Add columns */}
                  <div className="mt-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                    <div className="mb-1.5 text-[10px] font-medium text-slate-500">
                      เพิ่มคอลัมน์ (คลิกเพื่อเพิ่ม):
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {AVAILABLE_TABLE_COLUMNS
                        .filter((c) => !draft?.table.columns.some((x) => x.key === c.key))
                        .map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => addColumn(c.key)}
                            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600 transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-orange-700 dark:hover:bg-orange-950 dark:hover:text-orange-300"
                          >
                            + {c.label}
                            <span className="ml-1 text-slate-400">{c.defaultWidth}mm</span>
                          </button>
                        ))}
                      {AVAILABLE_TABLE_COLUMNS.filter((c) => !draft?.table.columns.some((x) => x.key === c.key)).length === 0 && (
                        <span className="text-[10px] text-slate-400">เพิ่มครบทั้ง 21 คอลัมน์แล้ว</span>
                      )}
                    </div>
                  </div>
                </TabsContent>

                {/* Summary picker */}
                <TabsContent value="summary" className="mt-0 space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    สรุปยอด
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {SUMMARY_KEYS.map((s) => {
                      const on = draft?.summary.some((x) => x.valueKey === s.key)
                      return (
                        <button
                          key={s.key}
                          type="button"
                          onClick={() => toggleSummary(s.key, s.label)}
                          className={[
                            'rounded border px-1.5 py-0.5 text-[10px] transition',
                            on
                              ? 'border-orange-300 bg-orange-100 text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-300'
                              : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-orange-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
                          ].join(' ')}
                        >
                          {on ? '✓ ' : ''}{s.label}
                        </button>
                      )
                    })}
                  </div>
                </TabsContent>

                {/* Footer settings */}
                <TabsContent value="footer" className="mt-0 space-y-2">
                  <Label className="text-xs font-semibold text-slate-700 dark:text-slate-200">Footer</Label>
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    💡 Footer จะถูกพิมพ์ที่ท้ายทุกหน้า (ตำแหน่ง bottom = margin) ตัวอย่างใน canvas ด้านซ้ายคือสิ่งที่จะพิมพ์ออกมาจริง รวมช่องลงนามด้วย
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <NumInput label="ความสูง (mm)" value={draft?.footer.height ?? 18} onChange={(v) => draft && setDraft({ ...draft, footer: { ...draft.footer, height: v } })} step={1} min={5} />
                    <NumInput label="ขนาด Font" value={draft?.footer.fontSize ?? 8} onChange={(v) => draft && setDraft({ ...draft, footer: { ...draft.footer, fontSize: v } })} step={0.5} min={5} />
                    <div className="space-y-1.5">
                      <Label className="text-xs">สีตัวอักษร</Label>
                      <div className="flex gap-1.5">
                        <input
                          type="color"
                          value={draft?.footer.color ?? '#94a3b8'}
                          onChange={(e) => draft && setDraft({ ...draft, footer: { ...draft.footer, color: e.target.value } })}
                          className="h-8 w-10 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
                        />
                        <Input
                          value={draft?.footer.color ?? ''}
                          onChange={(e) => draft && setDraft({ ...draft, footer: { ...draft.footer, color: e.target.value } })}
                          className="text-xs dark:bg-slate-800 dark:border-slate-700"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">เนื้อหา (รองรับ {'{{pageNumber}}'}, {'{{totalPages}}'}, {'{{printedAt}}'}, {'{{pdfPageCount}}'})</Label>
                    <Textarea
                      value={draft?.footer.content ?? ''}
                      onChange={(e) => draft && setDraft({ ...draft, footer: { ...draft.footer, content: e.target.value } })}
                      rows={3}
                      className="text-xs dark:bg-slate-800 dark:border-slate-700"
                    />
                    {/* Variable quick-insert for footer */}
                    <div className="flex flex-wrap gap-1 pt-1">
                      {['{{pageNumber}}', '{{totalPages}}', '{{pdfPageCount}}', '{{printedAt}}', '{{reportTitle}}', '{{month}}', '{{siteName}}'].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => draft && setDraft({ ...draft, footer: { ...draft.footer, content: (draft.footer.content ?? '') + ' ' + v } })}
                          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-orange-700 dark:hover:bg-orange-950 dark:hover:text-orange-300"
                        >
                          + {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Signatures editor — lets user add/remove/edit signature labels */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        ช่องลงนาม ({draft?.footer.signatures?.length ?? 0})
                      </Label>
                      <span className="text-[10px] text-slate-400">
                        แสดงที่ท้ายทุกหน้า ใต้บรรทัด footer
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {(draft?.footer.signatures ?? []).map((s, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="w-5 text-[10px] text-slate-400">{i + 1}.</span>
                          <Input
                            value={s}
                            onChange={(e) => {
                              if (!draft) return
                              const next = [...(draft.footer.signatures ?? [])]
                              next[i] = e.target.value
                              setDraft({ ...draft, footer: { ...draft.footer, signatures: next } })
                            }}
                            className="h-7 flex-1 text-[11px] dark:bg-slate-900 dark:border-slate-700"
                            placeholder={`ชื่อตำแหน่ง เช่น ผู้จัดทำ`}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!draft) return
                              const next = [...(draft.footer.signatures ?? [])]
                              next.splice(i, 1)
                              setDraft({ ...draft, footer: { ...draft.footer, signatures: next } })
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            title="ลบช่องลงนาม"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!draft) return
                          const next = [...(draft.footer.signatures ?? []), '']
                          setDraft({ ...draft, footer: { ...draft.footer, signatures: next } })
                        }}
                        className="h-7 w-full justify-center text-[10px] dark:border-slate-700 dark:bg-slate-800"
                      >
                        <Plus className="h-3 w-3" /> เพิ่มช่องลงนาม
                      </Button>
                      {(draft?.footer.signatures?.length ?? 0) === 0 && (
                        <div className="text-[10px] text-slate-400 text-center py-1">
                          ยังไม่มีช่องลงนาม — เพิ่มเพื่อแสดงในท้ายกระดาษ
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>

                {/* Available variables */}
                <TabsContent value="variables" className="mt-0 space-y-1.5">
                  <Label className="text-xs">ตัวแปร — คลิกเพื่อแทรกลงใน element ที่เลือก</Label>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    ถ้ายังไม่ได้เลือก element ใน canvas → ตัวแปรจะถูกคัดลอก
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {DOCUMENT_VARIABLES.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-orange-700 dark:hover:bg-orange-950 dark:hover:text-orange-300"
                        title={`คลิกเพื่อแทรก ${v}`}
                        onClick={(e) => {
                          e.preventDefault()
                          // This toolbar lives inside the `{!selectedEl ? …}`
                          // panel, so there is by construction NO selected
                          // element here. The previous
                          // `selectedEl && (…type === 'text' || 'qr')` guard
                          // was therefore unreachable dead code (it narrowed
                          // `selectedEl` to `never`), and the "insert variable
                          // into element" affordance never worked. Insertion
                          // happens from the element properties panel, where a
                          // selection exists — so copy to clipboard here.
                          navigator.clipboard?.writeText(v).catch(() => {})
                          toast.success(`คัดลอก ${v} (เลือก element ก่อนเพื่อแทรก)`)
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
                  </div>
                  <TabsList className="grid h-8 w-full grid-cols-4">
                    <TabsTrigger value="position" onClick={() => {}} className="text-[11px]">ตำแหน่ง</TabsTrigger>
                    <TabsTrigger value="style" onClick={() => {}} className="text-[11px]">สไตล์</TabsTrigger>
                    <TabsTrigger value="data" onClick={() => {}} className="text-[11px]">ข้อมูล</TabsTrigger>
                    <TabsTrigger value="advanced" onClick={() => {}} className="text-[11px]">ขั้นสูง</TabsTrigger>
                  </TabsList>
                </div>

                {/* Position & Size */}
                <TabsContent value="position" className="mt-0 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <NumInput label="X (mm)" value={selectedEl.x} onChange={(v) => updateSelectedElement({ x: v })} step={0.5} />
                    <NumInput label="Y (mm)" value={selectedEl.y} onChange={(v) => updateSelectedElement({ y: v })} step={0.5} />
                    <NumInput label="W (mm)" value={selectedEl.width} onChange={(v) => updateSelectedElement({ width: v })} step={0.5} />
                    <NumInput label="H (mm)" value={selectedEl.height} onChange={(v) => updateSelectedElement({ height: v })} step={0.5} />
                  </div>
                </TabsContent>

                {/* Type-specific style */}
                <TabsContent value="style" className="mt-0 space-y-2">
                  {selectedEl.type === 'text' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <NumInput label="ขนาด (pt)" value={selectedEl.fontSize ?? 10} onChange={(v) => updateSelectedElement({ fontSize: v })} step={0.5} min={2} max={48} />
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
                          <Label className="text-xs">จัดวาง</Label>
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
                      {/* Quick variable insert buttons */}
                      <div className="rounded-md border border-slate-100 bg-slate-50/50 p-1.5 dark:border-slate-800 dark:bg-slate-900/30">
                        <div className="mb-1 text-[9px] font-medium uppercase text-slate-400 dark:text-slate-500">
                          คลิกเพื่อแทรกตัวแปร
                        </div>
                        <div className="flex flex-wrap gap-0.5">
                          {DOCUMENT_VARIABLES.map((v) => (
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
                      <Label className="text-xs">URL รูปภาพ</Label>
                      <Input
                        value={selectedEl.content ?? ''}
                        onChange={(e) => updateSelectedElement({ content: e.target.value })}
                        placeholder="https://..."
                        className="text-xs dark:bg-slate-800 dark:border-slate-700"
                      />
                    </div>
                  )}
                  {selectedEl.type !== 'text' && selectedEl.type !== 'image' && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                      ประเภท {selectedEl.type.toUpperCase()} ไม่มีคุณสมบัติข้อมูลเพิ่มเติม
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
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-5xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-slate-800 dark:text-slate-100">
              👁️ พรีวิวเอกสาร PDF
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ตัวอย่างเอกสารสำหรับ {SAMPLE_ROWS.length} แถว — กดปุ่ม 🖨 ในหน้าต่างพรีวิวเพื่อพิมพ์หรือบันทึกเป็น PDF
            </p>
            <div
              className="overflow-auto rounded-md border border-slate-200 bg-slate-200 p-4 dark:border-slate-700 dark:bg-slate-950"
              style={{ minHeight: 300 }}
            >
              {previewHtml ? (
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              ) : (
                <div className="text-center text-xs text-slate-400 py-8">กำลังโหลด...</div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (previewHtml) {
                  const w = window.open('', '_blank', 'width=1000,height=1200')
                  if (w) {
                    w.document.open()
                    w.document.write(previewHtml)
                    w.document.close()
                  } else {
                    toast.warning('เบราว์เซอร์บล็อกป๊อปอัป')
                  }
                }
              }}
              className="gap-1.5"
            >
              <ArrowRight className="h-3.5 w-3.5" /> เปิดในหน้าต่างพิมพ์
            </Button>
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

      {/* Mount animation helper (no visual effect; just to keep AnimatePresence referenced) */}
      <AnimatePresence>
        <motion.div key="itam-document-editor-mounted" initial={{ opacity: 0 }} animate={{ opacity: 0 }} className="hidden" />
      </AnimatePresence>
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
    } catch (err) { console.error('[itam-document-editor]', err) }
  }
  return JSON.parse(JSON.stringify(obj)) as T
}
