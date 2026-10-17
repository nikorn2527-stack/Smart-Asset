'use client'

// ============================================================
// TemplateEditor — Visual WYSIWYG editor
// (Task ID: VISUAL-TEMPLATE-EDITOR, PART 1)
// ============================================================
// A drag/resize editor that lays out elements on a simulated
// paper canvas (A4 / A4 landscape / A5 / Letter). All internal
// measurements are millimetres; the display layer multiplies by
// MM_TO_PX (~3.78 px per mm).
//
// The editor is fully controlled: the parent passes the current
// TemplateContent and an onChange callback. Saving is also
// delegated to the parent.
// ============================================================

import * as React from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { CameraCapture } from './camera-capture'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Type,
  Image as ImageIcon,
  QrCode,
  Table as TableIcon,
  Square,
  Minus,
  Save,
  Eye,
  Printer,
  Trash2,
  Copy,
  Plus,
  ChevronUp,
  ChevronDown,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  GripVertical,
  Variable,
  X,
} from 'lucide-react'
import {
  interpolate,
  makeDefaultContent,
  makeElement,
  mmToPx,
  newElementId,
  PAPER_SIZE_OPTIONS,
  PAPER_SIZES,
  parseContent,
  SAMPLE_DATA,
  serializeContent,
  snapMm,
  TEMPLATE_VARIABLES,
  type ElementType,
  type FontAlign,
  type PaperSizeKey,
  type TableDataSource,
  type TableColumn,
  type TemplateContent,
  type TemplateElement,
  type TemplateRenderData,
} from '@/lib/template-editor'

// ─────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────

export interface TemplateEditorProps {
  /** Initial template content (parsed). */
  initialContent?: TemplateContent
  /** Called whenever the user edits something. */
  onChange?: (content: TemplateContent) => void
  /** Called when the user clicks "บันทึก". */
  onSave?: (content: TemplateContent) => void | Promise<void>
  /** Optional "พรีวิว" handler — defaults to opening render in new tab. */
  onPreview?: (content: TemplateContent) => void
  /** Save button disabled state (e.g. while parent is saving). */
  saving?: boolean
  /** Hide the save button. */
  hideSaveButton?: boolean
  /** Template type — used to seed a sensible default layout. */
  templateType?: string
  /** If true, render the editor with sample data (used in print preview). */
  previewMode?: boolean
  /** Sample/real data to render in preview mode. */
  previewData?: TemplateRenderData
  /** Disable editing (read-only preview). */
  readOnly?: boolean
}

// ─────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────

const HANDLE_SIZE = 10 // px
const MIN_W_MM = 4
const MIN_H_MM = 3
const TABLE_MIN_W_MM = 20

// ─────────────────────────────────────────────────
// Drag state machine
// ─────────────────────────────────────────────────

type DragMode =
  | { kind: 'move'; startX: number; startY: number; origX: number; origY: number }
  | {
      kind: 'resize'
      handle: ResizeHandle
      startX: number
      startY: number
      origX: number
      origY: number
      origW: number
      origH: number
    }

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

// ─────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────

function makeColumn(): TableColumn {
  return {
    id: `c${Math.random().toString(36).slice(2, 8)}`,
    label: 'คอลัมน์',
    width: 30,
    field: '',
  }
}

// ─────────────────────────────────────────────────
// Sub-component: a single element on the canvas
// ─────────────────────────────────────────────────

interface CanvasElementProps {
  el: TemplateElement
  selected: boolean
  readOnly: boolean
  onSelect: () => void
  onChange: (patch: Partial<TemplateElement>) => void
  onCommit: () => void
  zoom: number
}

function CanvasElement({
  el,
  selected,
  readOnly,
  onSelect,
  onChange,
  onCommit,
  zoom,
}: CanvasElementProps) {
  const dragRef = React.useRef<DragMode | null>(null)
  const [editingText, setEditingText] = React.useState(false)

  const leftPx = mmToPx(el.x) * zoom
  const topPx = mmToPx(el.y) * zoom
  const widthPx = mmToPx(el.w) * zoom
  const heightPx = mmToPx(el.h) * zoom

  // ── Mouse handlers (drag / resize) ──
  function onMouseDownBody(e: React.MouseEvent) {
    if (readOnly || editingText) return
    if (e.button !== 0) return
    e.stopPropagation()
    onSelect()
    dragRef.current = {
      kind: 'move',
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x,
      origY: el.y,
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function onMouseDownHandle(handle: ResizeHandle) {
    return (e: React.MouseEvent) => {
      if (readOnly) return
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      onSelect()
      dragRef.current = {
        kind: 'resize',
        handle,
        startX: e.clientX,
        startY: e.clientY,
        origX: el.x,
        origY: el.y,
        origW: el.w,
        origH: el.h,
      }
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    }
  }

  function onMouseMove(e: MouseEvent) {
    const drag = dragRef.current
    if (!drag) return
    const dxMm = (e.clientX - drag.startX) / (mmToPx(1) * zoom)
    const dyMm = (e.clientY - drag.startY) / (mmToPx(1) * zoom)

    if (drag.kind === 'move') {
      const nx = snapMm(drag.origX + dxMm)
      const ny = snapMm(drag.origY + dyMm)
      onChange({ x: nx, y: ny } as Partial<TemplateElement>)
    } else if (drag.kind === 'resize') {
      let { origX, origY, origW, origH } = drag
      const h = drag.handle
      if (h.includes('e')) origW = Math.max(MIN_W_MM, drag.origW + dxMm)
      if (h.includes('s')) origH = Math.max(MIN_H_MM, drag.origH + dyMm)
      if (h.includes('w')) {
        const newW = Math.max(MIN_W_MM, drag.origW - dxMm)
        origX = drag.origX + (drag.origW - newW)
        origW = newW
      }
      if (h.includes('n')) {
        const newH = Math.max(MIN_H_MM, drag.origH - dyMm)
        origY = drag.origY + (drag.origH - newH)
        origH = newH
      }
      onChange({
        x: snapMm(origX),
        y: snapMm(origY),
        w: snapMm(origW),
        h: snapMm(origH),
      } as Partial<TemplateElement>)
    }
  }

  function onMouseUp() {
    if (dragRef.current) {
      dragRef.current = null
      onCommit()
    }
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  React.useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  function onDoubleClick(e: React.MouseEvent) {
    if (readOnly) return
    if (el.type === 'text') {
      e.stopPropagation()
      setEditingText(true)
    }
  }

  function onTextBlur() {
    setEditingText(false)
    onCommit()
  }

  // ── Render inner content per element type ──
  function renderInner(): React.ReactNode {
    switch (el.type) {
      case 'text':
        if (editingText) {
          return (
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={onTextBlur}
              style={{
                width: '100%',
                height: '100%',
                outline: 'none',
                fontSize: el.fontSize * zoom,
                fontWeight: el.fontWeight,
                color: el.color,
                textAlign: el.align,
                lineHeight: el.lineHeight ?? 1.3,
                fontStyle: el.italic ? 'italic' : 'normal',
                textDecoration: el.underline ? 'underline' : 'none',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflow: 'hidden',
                cursor: 'text',
              }}
              dangerouslySetInnerHTML={{ __html: escapeHtml(el.content) }}
              ref={(node) => {
                if (node) {
                  // Focus on mount
                  node.focus()
                  // Place cursor at end
                  const range = document.createRange()
                  range.selectNodeContents(node)
                  range.collapse(false)
                  const sel = window.getSelection()
                  sel?.removeAllRanges()
                  sel?.addRange(range)
                }
              }}
              onInput={(e) => {
                const text = (e.target as HTMLDivElement).innerText
                onChange({ content: text } as Partial<TemplateElement>)
              }}
            />
          )
        }
        return (
          <div
            style={{
              width: '100%',
              height: '100%',
              fontSize: el.fontSize * zoom,
              fontWeight: el.fontWeight,
              color: el.color,
              textAlign: el.align,
              lineHeight: el.lineHeight ?? 1.3,
              fontStyle: el.italic ? 'italic' : 'normal',
              textDecoration: el.underline ? 'underline' : 'none',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            {interpolate(el.content, SAMPLE_DATA) || (
              <span style={{ color: '#94a3b8' }}>(ข้อความว่าง)</span>
            )}
          </div>
        )
      case 'image':
        if (!el.src) {
          return (
            <div
              style={{
                width: '100%',
                height: '100%',
                border: '1px dashed #cbd5e1',
                background: '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
                fontSize: 11 * zoom,
              }}
            >
              <span>ไม่มีรูป</span>
            </div>
          )
        }
        return (
          <img
            src={el.src}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: el.fit,
              opacity: el.opacity,
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        )
      case 'qr': {
        const content = interpolate(el.content, SAMPLE_DATA)
        const size = Math.min(widthPx, heightPx)
        const url = `https://api.qrserver.com/v1/create-qr-code/?size=${Math.round(
          size,
        )}x${Math.round(size)}&data=${encodeURIComponent(content || ' ')}&color=${el.fgColor.replace(
          '#',
          '',
        )}&bgcolor=${el.bgColor.replace('#', '')}`
        return (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: el.bgColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={url}
              alt="QR"
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                pointerEvents: 'none',
              }}
            />
          </div>
        )
      }
      case 'rectangle':
        return (
          <div
            style={{
              width: '100%',
              height: '100%',
              border: `${el.borderWidth}px solid ${el.borderColor}`,
              background:
                el.bgColor === 'transparent' ? 'transparent' : el.bgColor,
              borderRadius: el.radius,
            }}
          />
        )
      case 'line':
        if (el.direction === 'vertical') {
          return (
            <div
              style={{
                width: `${el.thickness}px`,
                height: '100%',
                background: el.color,
              }}
            />
          )
        }
        return (
          <div
            style={{
              width: '100%',
              height: `${el.thickness}px`,
              background: el.color,
            }}
          />
        )
      case 'table':
        return (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              tableLayout: 'fixed',
              pointerEvents: 'none',
            }}
          >
            <thead>
              <tr>
                {el.columns.map((c) => (
                  <th
                    key={c.id}
                    style={{
                      border: `${el.borderWidth}px solid ${el.borderColor}`,
                      background: el.headerBg,
                      color: el.headerColor,
                      padding: '3px 5px',
                      fontSize: el.fontSize * zoom,
                      fontWeight: 600,
                      textAlign: 'left',
                      width: c.width,
                    }}
                  >
                    {c.label || '—'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(SAMPLE_DATA.workOrderItems ?? []).slice(0, 3).map((r, i) => (
                <tr key={i}>
                  {el.columns.map((c) => {
                    const val = c.field && c.field in r ? r[c.field] : ''
                    return (
                      <td
                        key={c.id}
                        style={{
                          border: `${el.borderWidth}px solid ${el.borderColor}`,
                          padding: '3px 5px',
                          fontSize: el.fontSize * zoom,
                          height: el.rowHeight,
                          verticalAlign: 'middle',
                        }}
                      >
                        {val}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr>
                <td
                  colSpan={el.columns.length}
                  style={{
                    border: `${el.borderWidth}px solid ${el.borderColor}`,
                    padding: '4px',
                    textAlign: 'center',
                    color: '#94a3b8',
                    fontSize: 10 * zoom,
                    fontStyle: 'italic',
                  }}
                >
                  …ตัวอย่างแถว…
                </td>
              </tr>
            </tbody>
          </table>
        )
      default:
        return null
    }
  }

  const handles: ResizeHandle[] = [
    'nw',
    'n',
    'ne',
    'e',
    'se',
    's',
    'sw',
    'w',
  ]

  const handlePos: Record<ResizeHandle, React.CSSProperties> = {
    nw: { left: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2, cursor: 'nwse-resize' },
    n: { left: '50%', top: -HANDLE_SIZE / 2, cursor: 'ns-resize', transform: 'translateX(-50%)' },
    ne: { right: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2, cursor: 'nesw-resize' },
    e: { right: -HANDLE_SIZE / 2, top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' },
    se: { right: -HANDLE_SIZE / 2, bottom: -HANDLE_SIZE / 2, cursor: 'nwse-resize' },
    s: { left: '50%', bottom: -HANDLE_SIZE / 2, cursor: 'ns-resize', transform: 'translateX(-50%)' },
    sw: { left: -HANDLE_SIZE / 2, bottom: -HANDLE_SIZE / 2, cursor: 'nesw-resize' },
    w: { left: -HANDLE_SIZE / 2, top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' },
  }

  return (
    <div
      onMouseDown={onMouseDownBody}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        left: leftPx,
        top: topPx,
        width: widthPx,
        minHeight: heightPx,
        cursor: readOnly ? 'default' : editingText ? 'text' : 'move',
        outline: selected
          ? '1.5px solid #f97316'
          : '1px dashed transparent',
        outlineOffset: 1,
        zIndex: selected ? 10 : 1,
        userSelect: editingText ? 'text' : 'none',
      }}
      data-element-id={el.id}
    >
      {renderInner()}
      {selected && !readOnly && !editingText && (
        <>
          {handles.map((h) => (
            <div
              key={h}
              onMouseDown={onMouseDownHandle(h)}
              style={{
                position: 'absolute',
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: '#fff',
                border: '1.5px solid #f97316',
                borderRadius: 2,
                ...handlePos[h],
              }}
            />
          ))}
        </>
      )}
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')
}

// ─────────────────────────────────────────────────
// Sub-component: Properties panel
// ─────────────────────────────────────────────────

interface PropertiesPanelProps {
  el: TemplateElement | null
  onChange: (patch: Partial<TemplateElement>) => void
  onDelete: () => void
  onDuplicate: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

function PropertiesPanel({
  el,
  onChange,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
}: PropertiesPanelProps) {
  if (!el) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <Square className="h-8 w-8 text-muted-foreground/40" />
        <p>เลือกองค์ประกอบบนกระดาษเพื่อแก้ไข</p>
        <p className="text-xs">หรือกดเพิ่มจากแถบเครื่องมือด้านบน</p>
      </div>
    )
  }

  // Type-specific tab sections.
  const tabs = buildTypeTabs(el, onChange)
  // Build the list of visible tab triggers (always show ตำแหน่ง first).
  const tabList: { value: string; label: string }[] = [
    { value: 'position', label: 'ตำแหน่ง' },
  ]
  if (tabs.style) tabList.push({ value: 'style', label: 'สไตล์' })
  if (tabs.data) tabList.push({ value: 'data', label: 'ข้อมูล' })
  if (tabs.table) tabList.push({ value: 'table', label: 'ตาราง' })
  if (tabs.advanced) tabList.push({ value: 'advanced', label: 'ขั้นสูง' })
  // Grid columns = number of visible tabs (cap at 5 for compactness).
  const colCount = Math.min(tabList.length, 5)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <div className="mb-1 flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
          >
            {typeLabel(el.type)}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">
            {el.id}
          </span>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1"
            onClick={onMoveUp}
            title="เลื่อนขึ้น (render บนสุด)"
            aria-label="เลื่อนขึ้น"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1"
            onClick={onMoveDown}
            title="เลื่อนลง"
            aria-label="เลื่อนลง"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1"
            onClick={onDuplicate}
            title="คัดลอก (Ctrl+D)"
            aria-label="คัดลอก"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950"
            onClick={onDelete}
            title="ลบ (Del)"
            aria-label="ลบ"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs — always visible; only the active tab content scrolls. */}
      <Tabs
        defaultValue="position"
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b bg-card px-2 py-2">
          <TabsList
            className="grid h-8 w-full"
            style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
          >
            {tabList.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="text-[11px] leading-none"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-3">
            <TabsContent value="position" className="mt-0 space-y-4">
              <PositionSection el={el} onChange={onChange} />
            </TabsContent>
            {tabs.style && (
              <TabsContent value="style" className="mt-0 space-y-4">
                {tabs.style}
              </TabsContent>
            )}
            {tabs.data && (
              <TabsContent value="data" className="mt-0 space-y-4">
                {tabs.data}
              </TabsContent>
            )}
            {tabs.table && (
              <TabsContent value="table" className="mt-0 space-y-4">
                {tabs.table}
              </TabsContent>
            )}
            {tabs.advanced && (
              <TabsContent value="advanced" className="mt-0 space-y-4">
                {tabs.advanced}
              </TabsContent>
            )}
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  )
}

// Position + size — shown in the "ตำแหน่ง" tab for every element type.
function PositionSection({
  el,
  onChange,
}: {
  el: TemplateElement
  onChange: (patch: Partial<TemplateElement>) => void
}) {
  return (
    <Section title="ตำแหน่ง & ขนาด">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="X (มม.)"
          value={el.x}
          onChange={(v) => onChange({ x: v } as Partial<TemplateElement>)}
        />
        <NumberField
          label="Y (มม.)"
          value={el.y}
          onChange={(v) => onChange({ y: v } as Partial<TemplateElement>)}
        />
        <NumberField
          label="กว้าง (มม.)"
          value={el.w}
          onChange={(v) => onChange({ w: v } as Partial<TemplateElement>)}
        />
        <NumberField
          label="สูง (มม.)"
          value={el.h}
          onChange={(v) => onChange({ h: v } as Partial<TemplateElement>)}
        />
        <NumberField
          label="หมุน (องศา)"
          value={el.rotation ?? 0}
          step={1}
          min={-180}
          max={180}
          onChange={(v) =>
            onChange({ rotation: v } as Partial<TemplateElement>)
          }
        />
      </div>
    </Section>
  )
}

// Build the type-specific tab sections ({ style?, data?, table?, advanced? }).
// Each returned ReactNode is rendered inside its own TabsContent. Tabs with no
// content (e.g. a Text element has no "ตาราง" tab) are simply omitted from the
// tab list above.
function buildTypeTabs(
  el: TemplateElement,
  onChange: (patch: Partial<TemplateElement>) => void,
): {
  style?: React.ReactNode
  data?: React.ReactNode
  table?: React.ReactNode
  advanced?: React.ReactNode
} {
  switch (el.type) {
    case 'text':
      return {
        style: <TextStyle el={el} onChange={onChange} />,
        data: (
          <>
            <Section title="เนื้อหา">
              <Textarea
                value={el.content}
                onChange={(e) =>
                  onChange({ content: e.target.value } as Partial<TemplateElement>)
                }
                className="min-h-[72px] text-xs"
                placeholder="พิมพ์ข้อความ… (รองรับ {variable})"
              />
            </Section>
            <VariablePicker />
          </>
        ),
      }
    case 'image':
      return {
        style: (
          <Section title="การแสดงผล">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                วิธีจัดวาง (Fit)
              </Label>
              <Select
                value={el.fit}
                onValueChange={(v) =>
                  onChange({
                    fit: v as 'contain' | 'cover' | 'fill',
                  } as Partial<TemplateElement>)
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contain">Contain (อยู่ในกรอบ)</SelectItem>
                  <SelectItem value="cover">Cover (เต็มกรอบ)</SelectItem>
                  <SelectItem value="fill">Fill (ยืดเต็ม)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Section>
        ),
        data: <ImageSource el={el} onChange={onChange} />,
        advanced: (
          <Section title="ขั้นสูง">
            <NumberField
              label="ความโปร่งแสง (0-1)"
              value={el.opacity}
              step={0.1}
              min={0}
              max={1}
              onChange={(v) =>
                onChange({ opacity: v } as Partial<TemplateElement>)
              }
            />
          </Section>
        ),
      }
    case 'qr':
      return {
        style: (
          <Section title="สี">
            <ColorField
              label="สีจุด QR"
              value={el.fgColor}
              onChange={(v) =>
                onChange({ fgColor: v } as Partial<TemplateElement>)
              }
            />
            <ColorField
              label="สีพื้นหลัง"
              value={el.bgColor}
              onChange={(v) =>
                onChange({ bgColor: v } as Partial<TemplateElement>)
              }
            />
          </Section>
        ),
        data: (
          <>
            <Section title="เนื้อหา QR">
              <Textarea
                value={el.content}
                onChange={(e) =>
                  onChange({ content: e.target.value } as Partial<TemplateElement>)
                }
                className="min-h-[60px] text-xs"
                placeholder="เช่น {woNumber} หรือข้อความ"
              />
            </Section>
            <VariablePicker
              onPick={(v) =>
                onChange({
                  content: `{${v}}`,
                } as Partial<TemplateElement>)
              }
            />
          </>
        ),
      }
    case 'table':
      return {
        style: <TableStyle el={el} onChange={onChange} />,
        data: (
          <Section title="แหล่งข้อมูล">
            <Select
              value={el.dataSource}
              onValueChange={(v) =>
                onChange({
                  dataSource: v as TableDataSource,
                } as Partial<TemplateElement>)
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="work-order-items">
                  รายการอะไหล่ในใบงาน
                </SelectItem>
                <SelectItem value="stock-transactions">
                  รายการเบิก/รับสต็อก
                </SelectItem>
                <SelectItem value="devices">รายการอุปกรณ์</SelectItem>
                <SelectItem value="custom">กำหนดเอง</SelectItem>
              </SelectContent>
            </Select>
          </Section>
        ),
        table: <TableColumns el={el} onChange={onChange} />,
      }
    case 'rectangle':
      return {
        style: (
          <Section title="สไตล์กรอบ">
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="ความหนา (px)"
                value={el.borderWidth}
                min={0}
                max={10}
                onChange={(v) =>
                  onChange({ borderWidth: v } as Partial<TemplateElement>)
                }
              />
              <NumberField
                label="มุมมน (px)"
                value={el.radius}
                min={0}
                max={50}
                onChange={(v) =>
                  onChange({ radius: v } as Partial<TemplateElement>)
                }
              />
            </div>
            <ColorField
              label="สีเส้นขอบ"
              value={el.borderColor}
              onChange={(v) =>
                onChange({ borderColor: v } as Partial<TemplateElement>)
              }
            />
            <ColorField
              label="สีพื้นหลัง"
              value={el.bgColor}
              allowTransparent
              onChange={(v) => onChange({ bgColor: v } as Partial<TemplateElement>)}
            />
          </Section>
        ),
      }
    case 'line':
      return {
        style: (
          <Section title="สไตล์เส้น">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">ทิศทาง</Label>
              <Select
                value={el.direction}
                onValueChange={(v) =>
                  onChange({
                    direction: v as 'horizontal' | 'vertical',
                  } as Partial<TemplateElement>)
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="horizontal">แนวนอน</SelectItem>
                  <SelectItem value="vertical">แนวตั้ง</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumberField
              label="ความหนา (px)"
              value={el.thickness}
              min={1}
              max={10}
              onChange={(v) =>
                onChange({ thickness: v } as Partial<TemplateElement>)
              }
            />
            <ColorField
              label="สี"
              value={el.color}
              onChange={(v) => onChange({ color: v } as Partial<TemplateElement>)}
            />
          </Section>
        ),
      }
    default:
      return {}
  }
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </Label>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="h-8"
      />
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
  allowTransparent = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  allowTransparent?: boolean
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value === 'transparent' ? '#ffffff' : value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-input"
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 flex-1 font-mono text-xs"
        />
        {allowTransparent && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => onChange('transparent')}
          >
            ไม่มี
          </Button>
        )}
      </div>
    </div>
  )
}

function VariablePicker({
  onPick,
}: {
  onPick?: (key: string) => void
}) {
  const [group, setGroup] = React.useState<string>('ใบงาน')
  const groups = Array.from(new Set(TEMPLATE_VARIABLES.map((v) => v.group)))
  const items = TEMPLATE_VARIABLES.filter((v) => v.group === group)

  function handleInsert(key: string) {
    if (onPick) {
      onPick(key)
      return
    }
    // Default: copy to clipboard and notify
    const text = `{${key}}`
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`คัดลอก ${text} แล้ว`),
      () => toast.error('คัดลอกไม่สำเร็จ'),
    )
  }

  return (
    <Section title="ตัวแปร (Variables)">
      <Select value={group} onValueChange={setGroup}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groups.map((g) => (
            <SelectItem key={g} value={g}>
              {g}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-1">
        {items.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => handleInsert(v.key)}
            title={v.label}
            className="inline-flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-[11px] hover:border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950"
          >
            <Variable className="h-3 w-3 text-orange-500" />
            {v.label}
          </button>
        ))}
      </div>
      {!onPick && (
        <p className="text-[10px] text-muted-foreground">
          กดปุ่มเพื่อคัดลอก แล้วนำไปวางในเนื้อหาข้อความ
        </p>
      )}
    </Section>
  )
}

// ─────────────────────────────────────────────────
// Type-specific tab section helpers (rendered inside TabsContent).
// The "ตำแหน่ง" tab + content/data are inlined in buildTypeTabs above; the
// functions below cover the heavier style/table/source sections.
// ─────────────────────────────────────────────────

function TextStyle({
  el,
  onChange,
}: {
  el: Extract<TemplateElement, { type: 'text' }>
  onChange: (patch: Partial<TemplateElement>) => void
}) {
  return (
    <Section title="ฟอนต์">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="ขนาด (px)"
          value={el.fontSize}
          min={8}
          max={72}
          onChange={(v) =>
            onChange({ fontSize: v } as Partial<TemplateElement>)
          }
        />
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            น้ำหนัก / รูปแบบ
          </Label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={el.fontWeight === 'bold' ? 'default' : 'outline'}
              className="h-8 w-8 p-0"
              onClick={() =>
                onChange({
                  fontWeight:
                    el.fontWeight === 'bold' ? 'normal' : 'bold',
                } as Partial<TemplateElement>)
              }
            >
              <Bold className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant={el.italic ? 'default' : 'outline'}
              className="h-8 w-8 p-0"
              onClick={() =>
                onChange({
                  italic: !el.italic,
                } as Partial<TemplateElement>)
              }
            >
              <Italic className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant={el.underline ? 'default' : 'outline'}
              className="h-8 w-8 p-0"
              onClick={() =>
                onChange({
                  underline: !el.underline,
                } as Partial<TemplateElement>)
              }
            >
              <Underline className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">
          การจัดวาง
        </Label>
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as FontAlign[]).map((a) => (
            <Button
              key={a}
              type="button"
              size="sm"
              variant={el.align === a ? 'default' : 'outline'}
              className="h-8 flex-1"
              onClick={() =>
                onChange({ align: a } as Partial<TemplateElement>)
              }
            >
              {a === 'left' && <AlignLeft className="h-3.5 w-3.5" />}
              {a === 'center' && <AlignCenter className="h-3.5 w-3.5" />}
              {a === 'right' && <AlignRight className="h-3.5 w-3.5" />}
            </Button>
          ))}
        </div>
      </div>
      <ColorField
        label="สีตัวอักษร"
        value={el.color}
        onChange={(v) => onChange({ color: v } as Partial<TemplateElement>)}
      />
      <NumberField
        label="ระยะบรรทัด (×)"
        value={el.lineHeight ?? 1.3}
        step={0.1}
        min={0.8}
        max={3}
        onChange={(v) =>
          onChange({ lineHeight: v } as Partial<TemplateElement>)
        }
      />
    </Section>
  )
}

function ImageSource({
  el,
  onChange,
}: {
  el: Extract<TemplateElement, { type: 'image' }>
  onChange: (patch: Partial<TemplateElement>) => void
}) {
  const fileRef = React.useRef<HTMLInputElement>(null)

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 1_500_000) {
      toast.error('รูปใหญ่เกินไป (สูงสุด 1.5 MB)')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      onChange({ src: String(reader.result) } as Partial<TemplateElement>)
    }
    reader.readAsDataURL(file)
  }

  return (
    <Section title="แหล่งรูป">
      <div className="space-y-2">
        <Input
          type="text"
          placeholder="URL หรือ base64…"
          value={el.src.startsWith('data:') ? '' : el.src}
          onChange={(e) =>
            onChange({ src: e.target.value } as Partial<TemplateElement>)
          }
          className="h-8 text-xs"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 w-full"
          onClick={() => fileRef.current?.click()}
        >
          <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
          อัปโหลดรูป (สูงสุด 1.5 MB)
        </Button>
        <CameraCapture
          onCapture={(dataUrl) =>
            onChange({ src: dataUrl } as Partial<TemplateElement>)
          }
          label="ถ่ายภาพจากกล้อง"
          className="h-8 w-full"
        />
        {el.src && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-full text-rose-600"
            onClick={() =>
              onChange({ src: '' } as Partial<TemplateElement>)
            }
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            ล้างรูป
          </Button>
        )}
      </div>
    </Section>
  )
}

function TableStyle({
  el,
  onChange,
}: {
  el: Extract<TemplateElement, { type: 'table' }>
  onChange: (patch: Partial<TemplateElement>) => void
}) {
  return (
    <Section title="สไตล์">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="ความสูงแถว (มม.)"
          value={el.rowHeight}
          min={3}
          onChange={(v) =>
            onChange({ rowHeight: v } as Partial<TemplateElement>)
          }
        />
        <NumberField
          label="ขนาดฟอนต์ (px)"
          value={el.fontSize}
          min={8}
          max={24}
          onChange={(v) =>
            onChange({ fontSize: v } as Partial<TemplateElement>)
          }
        />
        <NumberField
          label="ความหนาเส้น (px)"
          value={el.borderWidth}
          min={0}
          max={5}
          onChange={(v) =>
            onChange({ borderWidth: v } as Partial<TemplateElement>)
          }
        />
      </div>
      <ColorField
        label="สีพื้นหัวตาราง"
        value={el.headerBg}
        onChange={(v) =>
          onChange({ headerBg: v } as Partial<TemplateElement>)
        }
      />
      <ColorField
        label="สีตัวอักษรหัวตาราง"
        value={el.headerColor}
        onChange={(v) =>
          onChange({ headerColor: v } as Partial<TemplateElement>)
        }
      />
      <ColorField
        label="สีเส้นขอบ"
        value={el.borderColor}
        onChange={(v) =>
          onChange({ borderColor: v } as Partial<TemplateElement>)
        }
      />
    </Section>
  )
}

function TableColumns({
  el,
  onChange,
}: {
  el: Extract<TemplateElement, { type: 'table' }>
  onChange: (patch: Partial<TemplateElement>) => void
}) {
  function updateColumn(idx: number, patch: Partial<TableColumn>) {
    const next = el.columns.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    onChange({ columns: next } as Partial<TemplateElement>)
  }
  function addColumn() {
    onChange({
      columns: [...el.columns, makeColumn()],
    } as Partial<TemplateElement>)
  }
  function removeColumn(idx: number) {
    onChange({
      columns: el.columns.filter((_, i) => i !== idx),
    } as Partial<TemplateElement>)
  }
  function moveColumn(idx: number, dir: -1 | 1) {
    const target = idx + dir
    if (target < 0 || target >= el.columns.length) return
    const next = [...el.columns]
    const [moved] = next.splice(idx, 1)
    next.splice(target, 0, moved)
    onChange({ columns: next } as Partial<TemplateElement>)
  }

  return (
    <Section title="คอลัมน์">
      <div className="space-y-2">
        {el.columns.map((c, i) => (
          <div
            key={c.id}
            className="space-y-1 rounded border border-border bg-muted/30 p-2"
          >
            <div className="flex items-center gap-1">
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                value={c.label}
                onChange={(e) =>
                  updateColumn(i, { label: e.target.value })
                }
                placeholder="ชื่อหัวตาราง"
                className="h-7 flex-1 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => moveColumn(i, -1)}
                disabled={i === 0}
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => moveColumn(i, 1)}
                disabled={i === el.columns.length - 1}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-rose-600"
                onClick={() => removeColumn(i)}
                disabled={el.columns.length <= 1}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-0.5">
                <Label className="text-[10px] text-muted-foreground">
                  ฟิลด์ข้อมูล
                </Label>
                <Input
                  type="text"
                  value={c.field ?? ''}
                  onChange={(e) =>
                    updateColumn(i, { field: e.target.value })
                  }
                  placeholder="เช่น productName"
                  className="h-7 text-xs"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] text-muted-foreground">
                  ความกว้าง (มม.)
                </Label>
                <Input
                  type="number"
                  value={c.width}
                  min={5}
                  onChange={(e) =>
                    updateColumn(i, { width: Number(e.target.value) })
                  }
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 w-full"
          onClick={addColumn}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          เพิ่มคอลัมน์
        </Button>
      </div>
    </Section>
  )
}

function typeLabel(t: ElementType): string {
  switch (t) {
    case 'text':
      return 'ข้อความ'
    case 'image':
      return 'รูปภาพ'
    case 'qr':
      return 'QR Code'
    case 'table':
      return 'ตาราง'
    case 'rectangle':
      return 'กรอบสี่เหลี่ยม'
    case 'line':
      return 'เส้น'
    default:
      return t
  }
}

// ─────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────

export function TemplateEditor({
  initialContent,
  onChange,
  onSave,
  onPreview,
  saving = false,
  hideSaveButton = false,
  templateType = 'work-order',
  readOnly = false,
}: TemplateEditorProps) {
  // ── State ──
  const [content, setContent] = React.useState<TemplateContent>(() => {
    if (initialContent) return initialContent
    // Seed a default based on template type
    const paperKey: PaperSizeKey =
      templateType === 'sticker' ? 'A4' : 'A4'
    return makeDefaultContent(paperKey, templateType)
  })
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [zoom, setZoom] = React.useState(1)
  const [dirty, setDirty] = React.useState(false)
  const canvasRef = React.useRef<HTMLDivElement>(null)

  // ── Auto-fit: calculate scale so the full page fits in the canvas area ──
  const [fitScale, setFitScale] = React.useState(1)
  const paper = content.paper
  React.useEffect(() => {
    function calcFit() {
      const el = canvasRef.current
      if (!el) return
      const containerW = el.clientWidth - 64 // padding p-8 = 32px each side
      const containerH = el.clientHeight - 64
      const paperW = mmToPx(paper?.width ?? 210)
      const paperH = mmToPx(paper?.height ?? 297)
      const scaleW = containerW / paperW
      const scaleH = containerH / paperH
      const scale = Math.min(scaleW, scaleH, 1.5) // max 150%
      setFitScale(scale > 0.1 ? scale : 0.3) // minimum 30%
    }
    calcFit()
    const ro = new ResizeObserver(calcFit)
    if (canvasRef.current) ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, [paper?.width, paper?.height])

  // History (undo) — keep a small ring buffer
  const historyRef = React.useRef<TemplateContent[]>([content])
  const historyIdxRef = React.useRef(0)

  // ── Sync incoming changes ──
  React.useEffect(() => {
    if (initialContent && initialContent !== content) {
      setContent(initialContent)
      historyRef.current = [initialContent]
      historyIdxRef.current = 0
      setDirty(false)
    }
  }, [initialContent])

  // ── Content mutation helpers ──
  function update(next: TemplateContent, pushHistory = true) {
    setContent(next)
    setDirty(true)
    onChange?.(next)
    if (pushHistory) {
      // Truncate any redo entries
      historyRef.current = historyRef.current.slice(
        0,
        historyIdxRef.current + 1,
      )
      historyRef.current.push(next)
      // Cap history at 50 entries
      if (historyRef.current.length > 50) {
        historyRef.current = historyRef.current.slice(-50)
      }
      historyIdxRef.current = historyRef.current.length - 1
    }
  }

  function patchElement(id: string, patch: Partial<TemplateElement>) {
    const next: TemplateContent = {
      ...content,
      elements: content.elements.map((el) =>
        el.id === id ? ({ ...el, ...patch } as TemplateElement) : el,
      ),
    }
    update(next, false) // drag/resize updates are too frequent for history
  }

  function commitHistory() {
    // Push a snapshot to history at end of a drag/resize gesture
    historyRef.current = historyRef.current.slice(
      0,
      historyIdxRef.current + 1,
    )
    historyRef.current.push(content)
    if (historyRef.current.length > 50) {
      historyRef.current = historyRef.current.slice(-50)
    }
    historyIdxRef.current = historyRef.current.length - 1
  }

  function addElement(type: ElementType) {
    const el = makeElement(type, content.paper)
    const next: TemplateContent = {
      ...content,
      elements: [...content.elements, el],
    }
    update(next)
    setSelectedId(el.id)
    toast.success(`เพิ่ม${typeLabel(type)}แล้ว`)
  }

  function deleteElement(id: string) {
    const next: TemplateContent = {
      ...content,
      elements: content.elements.filter((el) => el.id !== id),
    }
    update(next)
    if (selectedId === id) setSelectedId(null)
  }

  function duplicateElement(id: string) {
    const src = content.elements.find((e) => e.id === id)
    if (!src) return
    const clone: TemplateElement = {
      ...src,
      id: newElementId(),
      x: src.x + 5,
      y: src.y + 5,
    } as TemplateElement
    const next: TemplateContent = {
      ...content,
      elements: [...content.elements, clone],
    }
    update(next)
    setSelectedId(clone.id)
  }

  function moveElement(id: string, dir: 'up' | 'down') {
    const idx = content.elements.findIndex((e) => e.id === id)
    if (idx === -1) return
    const next = [...content.elements]
    const target = dir === 'up' ? idx + 1 : idx - 1
    if (target < 0 || target >= next.length) return
    const [moved] = next.splice(idx, 1)
    next.splice(target, 0, moved)
    update({ ...content, elements: next })
  }

  // ── Paper size change ──
  function changePaper(key: PaperSizeKey) {
    const spec = PAPER_SIZES[key]
    const next: TemplateContent = {
      ...content,
      paper: {
        size: spec.key,
        orientation: spec.width > spec.height ? 'landscape' : 'portrait',
        width: spec.width,
        height: spec.height,
        margin: content.paper.margin,
      },
    }
    update(next)
  }

  function changeMargin(margin: number) {
    update({
      ...content,
      paper: { ...content.paper, margin },
    })
  }

  // ── Save / Preview / Print ──
  async function handleSave() {
    try {
      await onSave?.(content)
      setDirty(false)
      // Reset history baseline so undo doesn't revert past save point
      historyRef.current = [content]
      historyIdxRef.current = 0
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ')
    }
  }

  function handlePreview() {
    if (onPreview) {
      onPreview(content)
      return
    }
    // Default: open a new window with sample-data preview
    const html = buildStandalonePreviewHtml(content)
    openHtmlInNewTab(html, 'พรีวิวเทมเพลต')
  }

  function handlePrint() {
    const html = buildStandalonePreviewHtml(content)
    openHtmlInNewTab(html, 'พิมพ์เทมเพลต', /* autoPrint */ true)
  }

  // ── Keyboard shortcuts ──
  React.useEffect(() => {
    if (readOnly) return
    function onKey(e: KeyboardEvent) {
      // Skip if focus is in an input/textarea/contentEditable
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        // Allow Escape to blur
        if (e.key === 'Escape') {
          target.blur()
          setSelectedId(null)
        }
        return
      }
      if (e.key === 'Escape') {
        setSelectedId(null)
      }
      if (!selectedId) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteElement(selectedId)
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        duplicateElement(selectedId)
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 'z' || e.key === 'Z')
      ) {
        // Redo
        e.preventDefault()
        if (historyIdxRef.current < historyRef.current.length - 1) {
          historyIdxRef.current += 1
          setContent(historyRef.current[historyIdxRef.current])
          onChange?.(historyRef.current[historyIdxRef.current])
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        // Undo
        e.preventDefault()
        if (historyIdxRef.current > 0) {
          historyIdxRef.current -= 1
          setContent(historyRef.current[historyIdxRef.current])
          onChange?.(historyRef.current[historyIdxRef.current])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, content, readOnly])

  // ── Render ──
  const totalScale = fitScale * zoom // fitScale auto-fits, zoom is user adjustment on top
  const paperWidthPx = mmToPx(paper.width) * totalScale
  const paperHeightPx = mmToPx(paper.height) * totalScale
  const marginPx = mmToPx(paper.margin) * totalScale
  const selected = content.elements.find((e) => e.id === selectedId) ?? null

  return (
    <div className="flex h-full min-h-[600px] flex-col">
      {/* === Toolbar === */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <div className="flex items-center gap-1">
          <ToolbarButton
            icon={<Type className="h-4 w-4" />}
            label="ข้อความ"
            onClick={() => addElement('text')}
            disabled={readOnly}
          />
          <ToolbarButton
            icon={<ImageIcon className="h-4 w-4" />}
            label="รูป"
            onClick={() => addElement('image')}
            disabled={readOnly}
          />
          <ToolbarButton
            icon={<QrCode className="h-4 w-4" />}
            label="QR"
            onClick={() => addElement('qr')}
            disabled={readOnly}
          />
          <ToolbarButton
            icon={<TableIcon className="h-4 w-4" />}
            label="ตาราง"
            onClick={() => addElement('table')}
            disabled={readOnly}
          />
          <ToolbarButton
            icon={<Square className="h-4 w-4" />}
            label="กรอบ"
            onClick={() => addElement('rectangle')}
            disabled={readOnly}
          />
          <ToolbarButton
            icon={<Minus className="h-4 w-4" />}
            label="เส้น"
            onClick={() => addElement('line')}
            disabled={readOnly}
          />
        </div>
        <Separator orientation="vertical" className="h-7" />
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">กระดาษ:</Label>
          <Select value={paper.size} onValueChange={(v) => changePaper(v as PaperSizeKey)}>
            <SelectTrigger className="h-8 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAPER_SIZE_OPTIONS.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">ขอบ:</Label>
          <Input
            type="number"
            value={paper.margin}
            min={0}
            max={50}
            onChange={(e) => changeMargin(Number(e.target.value))}
            className="h-8 w-[60px]"
            disabled={readOnly}
          />
          <span className="text-xs text-muted-foreground">มม.</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">ซูม:</Label>
          <Select
            value={String(zoom)}
            onValueChange={(v) => setZoom(Number(v))}
          >
            <SelectTrigger className="h-8 w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5">50%</SelectItem>
              <SelectItem value="0.75">75%</SelectItem>
              <SelectItem value="1">100%</SelectItem>
              <SelectItem value="1.25">125%</SelectItem>
              <SelectItem value="1.5">150%</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={() => setZoom(1)}
            title="รีเซ็ตซูม — ให้พอดีหน้าจอ"
          >
            พอดี
          </Button>
        </div>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={handlePreview}
          disabled={saving}
        >
          <Eye className="mr-1.5 h-3.5 w-3.5" />
          พรีวิว
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handlePrint}
          disabled={saving}
        >
          <Printer className="mr-1.5 h-3.5 w-3.5" />
          ทดสอบพิมพ์
        </Button>
        {!hideSaveButton && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-orange-500 hover:bg-orange-600"
          >
            {saving ? (
              <>
                <span className="mr-1.5 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                กำลังบันทึก…
              </>
            ) : (
              <>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                บันทึก
              </>
            )}
          </Button>
        )}
      </div>

      {/* === Body: Canvas + Properties panel === */}
      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div
          ref={canvasRef}
          className="relative flex-1 overflow-auto bg-slate-200 p-8 dark:bg-slate-900"
          onMouseDown={(e) => {
            // Click empty canvas = deselect
            if (e.target === e.currentTarget) {
              setSelectedId(null)
            }
          }}
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(15,23,42,0.06) 1px, transparent 1px)',
            backgroundSize: '16px 16px',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="relative mx-auto"
            style={{
              width: paperWidthPx,
              height: paperHeightPx,
              background: 'white',
              boxShadow: '0 4px 18px rgba(0,0,0,0.15)',
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedId(null)
              }
            }}
          >
            {/* Margin guides */}
            <div
              style={{
                position: 'absolute',
                left: marginPx,
                top: marginPx,
                right: marginPx,
                bottom: marginPx,
                border: '1px dashed #cbd5e1',
                pointerEvents: 'none',
              }}
            />
            {/* Elements */}
            {content.elements.map((el) => (
              <CanvasElement
                key={el.id}
                el={el}
                selected={selectedId === el.id}
                readOnly={readOnly}
                zoom={totalScale}
                onSelect={() => setSelectedId(el.id)}
                onChange={(patch) => patchElement(el.id, patch)}
                onCommit={commitHistory}
              />
            ))}
          </motion.div>
        </div>

        {/* Properties panel */}
        <div className="hidden w-[280px] shrink-0 border-l bg-card md:block">
          <PropertiesPanel
            el={selected}
            onChange={(patch) =>
              selected && patchElement(selected.id, patch)
            }
            onDelete={() => selected && deleteElement(selected.id)}
            onDuplicate={() => selected && duplicateElement(selected.id)}
            onMoveUp={() => selected && moveElement(selected.id, 'up')}
            onMoveDown={() => selected && moveElement(selected.id, 'down')}
          />
        </div>
      </div>

      {/* === Status bar === */}
      <div className="flex items-center justify-between border-t bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>
          กระดาษ: {paper.width} × {paper.height} มม. •{' '}
          {content.elements.length} องค์ประกอบ
        </span>
        <span>
          {dirty ? '⚠ ยังไม่บันทึก' : '✓ บันทึกแล้ว'} •
          ลัด: Del=ลบ Ctrl+D=คัดลอก Ctrl+Z=ยกเลิก
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────
// Toolbar button
// ─────────────────────────────────────────────────

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className="h-8"
    >
      {icon}
      <span className="ml-1.5 hidden text-xs sm:inline">{label}</span>
    </Button>
  )
}

// ─────────────────────────────────────────────────
// Standalone preview HTML builder (client-side, used
// for the in-editor "พรีวิว" / "ทดสอบพิมพ์" buttons)
// ─────────────────────────────────────────────────

function buildStandalonePreviewHtml(content: TemplateContent): string {
  const paper = content.paper
  const margin = paper.margin ?? 10

  // Inline element rendering (client side, similar to render API)
  const elementsHtml = content.elements
    .map((el) => renderElementClient(el))
    .join('\n      ')

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>พรีวิวเทมเพลต</title>
  <style>
    @page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin:0; padding:0; font-family:'Segoe UI','Thonburi','Tahoma',sans-serif; color:#1e293b; background:#f1f5f9; }
    body { padding:16px; display:flex; justify-content:center; }
    .page { position:relative; background:#fff; width:${paper.width}mm; height:${paper.height}mm; box-shadow:0 4px 18px rgba(0,0,0,0.08); overflow:hidden; }
    .toolbar { position:fixed; bottom:16px; right:16px; display:flex; gap:8px; z-index:99; }
    .toolbar button { padding:8px 14px; border-radius:6px; border:none; background:#f97316; color:white; font-size:13px; font-weight:600; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.15); }
    .toolbar button.secondary { background:#64748b; }
    @media print { body{background:#fff;padding:0;} .page{box-shadow:none;} .toolbar{display:none !important;} }
  </style>
</head>
<body>
  <div class="page">
    <div style="position:absolute;left:${margin}mm;top:${margin}mm;right:${margin}mm;bottom:${margin}mm;border:1px dashed transparent;pointer-events:none;"></div>
      ${elementsHtml}
  </div>
  <div class="toolbar">
    <button type="button" onclick="window.print()">🖨 พิมพ์</button>
    <button type="button" class="secondary" onclick="window.close()">ปิด</button>
  </div>
</body>
</html>`
}

function renderElementClient(el: TemplateElement): string {
  const baseStyle = `position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.w}mm;min-height:${el.h}mm;`

  switch (el.type) {
    case 'text': {
      const text = interpolate(escapeHtmlPlain(el.content), SAMPLE_DATA)
      const fontStyle = el.italic ? 'italic' : 'normal'
      const textDecoration = el.underline ? 'underline' : 'none'
      const lineHeight = el.lineHeight ?? 1.3
      return `<div style="${baseStyle}font-size:${el.fontSize}px;font-weight:${el.fontWeight};color:${el.color};text-align:${el.align};font-style:${fontStyle};text-decoration:${textDecoration};line-height:${lineHeight};white-space:pre-wrap;word-break:break-word;overflow:hidden;">${text}</div>`
    }
    case 'image': {
      if (!el.src) return ''
      const objectFit =
        el.fit === 'cover' ? 'cover' : el.fit === 'fill' ? 'fill' : 'contain'
      return `<div style="${baseStyle}overflow:hidden;"><img src="${el.src}" alt="" style="width:100%;height:100%;object-fit:${objectFit};opacity:${el.opacity};display:block;" /></div>`
    }
    case 'qr': {
      const content = interpolate(el.content, SAMPLE_DATA)
      const size = 200
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(content || ' ')}&color=${el.fgColor.replace('#', '')}&bgcolor=${el.bgColor.replace('#', '')}`
      return `<div style="${baseStyle}overflow:hidden;display:flex;align-items:center;justify-content:center;background:${el.bgColor};"><img src="${url}" alt="QR" style="width:100%;height:100%;display:block;" /></div>`
    }
    case 'rectangle': {
      const bg = el.bgColor === 'transparent' ? 'transparent' : el.bgColor
      return `<div style="${baseStyle}border:${el.borderWidth}px solid ${el.borderColor};background:${bg};border-radius:${el.radius}px;"></div>`
    }
    case 'line': {
      const t = el.thickness
      if (el.direction === 'vertical') {
        return `<div style="position:absolute;left:${el.x}mm;top:${el.y}mm;width:${t}px;height:${el.h}mm;background:${el.color};"></div>`
      }
      return `<div style="position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.w}mm;height:${t}px;background:${el.color};"></div>`
    }
    case 'table': {
      const rows = SAMPLE_DATA.workOrderItems ?? []
      const cols = el.columns
      const totalWidth = cols.reduce((s, c) => s + c.width, 0)
      const head = cols
        .map(
          (c) =>
            `<th style="border:${el.borderWidth}px solid ${el.borderColor};background:${el.headerBg};color:${el.headerColor};padding:3px 5px;font-size:${el.fontSize}px;font-weight:600;text-align:left;width:${c.width}mm;">${escapeHtmlPlain(c.label)}</th>`,
        )
        .join('')
      const body = rows.length
        ? rows
            .map(
              (r) =>
                `<tr>${cols
                  .map((c) => {
                    const val = c.field && c.field in r ? r[c.field] : ''
                    return `<td style="border:${el.borderWidth}px solid ${el.borderColor};padding:3px 5px;font-size:${el.fontSize}px;height:${el.rowHeight}mm;vertical-align:middle;">${escapeHtmlPlain(val)}</td>`
                  })
                  .join('')}</tr>`,
            )
            .join('')
        : `<tr><td colspan="${cols.length}" style="border:${el.borderWidth}px solid ${el.borderColor};padding:6px;text-align:center;color:#94a3b8;font-size:${el.fontSize}px;">ไม่มีข้อมูล</td></tr>`
      return `<div style="${baseStyle}overflow:hidden;"><table style="border-collapse:collapse;table-layout:fixed;width:${totalWidth}mm;font-family:inherit;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
    }
    default:
      return ''
  }
}

function escapeHtmlPlain(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function openHtmlInNewTab(
  html: string,
  title: string,
  autoPrint = false,
) {
  const w = window.open('', '_blank', 'noopener,noreferrer')
  if (!w) {
    toast.error('เบราว์เซอร์บล็อก pop-up — กรุณาอนุญาตแล้วลองอีกครั้ง')
    return
  }
  if (autoPrint) {
    // Inject auto-print script before </body>
    html = html.replace(
      '</body>',
      `<script>setTimeout(function(){window.print();},400);</script></body>`,
    )
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  // Set title (after document is written)
  try {
    w.document.title = title
  } catch (err) { console.error('[template-editor]', err) }
}

// ─────────────────────────────────────────────────
// Helper exported for parents: parse a string content
// into a TemplateContent object.
// ─────────────────────────────────────────────────

export { parseContent, serializeContent }
