'use client'

import * as React from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'framer-motion'
import { GripVertical, Eye, EyeOff, RotateCcw, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

export type WidgetId =
  | 'kpi'
  | 'cycle'
  | 'insights'
  | 'lifecycle'
  | 'charts'
  | 'paperTrend'
  | 'bySite'
  | 'topDevices'
  | 'recentActivity'
  | 'depreciation'
  | 'reports'

interface WidgetMeta {
  id: WidgetId
  title: string
  icon: string
}

export const DEFAULT_WIDGET_ORDER: WidgetId[] = [
  'kpi',
  'cycle',
  'insights',
  'charts',
  'paperTrend',
  'bySite',
  'recentActivity',
  'lifecycle',
  'depreciation',
  'reports',
]

const WIDGET_META: Record<WidgetId, WidgetMeta> = {
  kpi: { id: 'kpi', title: 'KPI ภาพรวม + รับประกัน', icon: '📊' },
  cycle: { id: 'cycle', title: 'รอบจดมิเตอร์', icon: '⏰' },
  insights: { id: 'insights', title: 'Smart Insights', icon: '💡' },
  lifecycle: { id: 'lifecycle', title: 'อายุการใช้งาน', icon: '♻️' },
  charts: { id: 'charts', title: 'กราฟสถานะ/ประเภท', icon: '📈' },
  paperTrend: { id: 'paperTrend', title: 'แนวโน้มกระดาษ', icon: '📄' },
  bySite: { id: 'bySite', title: 'อุปกรณ์ตามสาขา', icon: '🏢' },
  topDevices: { id: 'topDevices', title: 'อุปกรณ์ใช้งานสูงสุด', icon: '🏆' },
  recentActivity: { id: 'recentActivity', title: 'กิจกรรมล่าสุด', icon: '🕘' },
  depreciation: { id: 'depreciation', title: 'ค่าเสื่อมราคา', icon: '💰' },
  reports: { id: 'reports', title: 'รายงาน', icon: '📋' },
}

const STORAGE_KEY = 'dashboardWidgetLayout'

interface WidgetLayoutState {
  order: WidgetId[]
  visible: Record<WidgetId, boolean>
}

function defaultState(): WidgetLayoutState {
  return {
    order: [...DEFAULT_WIDGET_ORDER],
    visible: DEFAULT_WIDGET_ORDER.reduce(
      (acc, id) => {
        acc[id] = true
        return acc
      },
      {} as Record<WidgetId, boolean>,
    ),
  }
}

function loadState(): WidgetLayoutState {
  if (typeof window === 'undefined') return defaultState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as Partial<WidgetLayoutState>
    const order = Array.isArray(parsed.order) ? (parsed.order as WidgetId[]) : []
    const visible =
      typeof parsed.visible === 'object' && parsed.visible !== null
        ? (parsed.visible as Record<WidgetId, boolean>)
        : {}
    // Ensure all known widgets are present
    const merged = defaultState()
    const filteredOrder = order.filter((id) =>
      DEFAULT_WIDGET_ORDER.includes(id),
    )
    for (const id of DEFAULT_WIDGET_ORDER) {
      if (!filteredOrder.includes(id)) filteredOrder.push(id)
    }
    merged.order = filteredOrder
    for (const id of DEFAULT_WIDGET_ORDER) {
      if (typeof visible[id] === 'boolean') {
        merged.visible[id] = visible[id]
      }
    }
    return merged
  } catch {
    return defaultState()
  }
}

function persistState(s: WidgetLayoutState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

interface WidgetCardProps {
  id: WidgetId
  visible: boolean
  children: React.ReactNode
}

function SortableWidgetCard({ id, visible, children }: WidgetCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : 'auto',
  }

  if (!visible) return null

  const meta = WIDGET_META[id]
  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      whileDrag={{ scale: 1.015, boxShadow: '0 12px 30px rgba(15,23,42,0.18)' }}
      className={cn(
        'group relative',
        isDragging && 'cursor-grabbing',
      )}
    >
      {/* Drag handle — visible on hover or while dragging */}
      <button
        type="button"
        aria-label={`ลากเพื่อจัดเรียง ${meta.title}`}
        className={cn(
          'absolute -top-2 right-3 z-40 flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 shadow-sm transition-all hover:bg-slate-100 hover:text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200',
          'opacity-0 group-hover:opacity-100',
          isDragging && 'opacity-100',
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </motion.div>
  )
}

interface DashboardWidgetLayoutProps {
  /** Render the content for a given widget id. Return null to hide it. */
  renderWidget: (id: WidgetId) => React.ReactNode
  /** Optional: render a custom trigger button for the customize popover.
   *  When provided, the floating action button is hidden. */
  renderCustomizeTrigger?: () => React.ReactNode
}

export function DashboardWidgetLayout({
  renderWidget,
  renderCustomizeTrigger,
}: DashboardWidgetLayoutProps) {
  const [state, setState] = React.useState<WidgetLayoutState>(defaultState)
  const [hydrated, setHydrated] = React.useState(false)
  const [customizeOpen, setCustomizeOpen] = React.useState(false)

  React.useEffect(() => {
    setState(loadState())
    setHydrated(true)
  }, [])

  // Persist whenever state changes (after hydration)
  React.useEffect(() => {
    if (!hydrated) return
    persistState(state)
  }, [state, hydrated])

  // Allow external triggers (e.g. the dashboard header "ปรับแต่ง" button)
  // to open the customize popover by dispatching a CustomEvent.
  React.useEffect(() => {
    function onOpen() {
      setCustomizeOpen(true)
    }
    window.addEventListener('dashboard:open-customize', onOpen)
    return () =>
      window.removeEventListener('dashboard:open-customize', onOpen)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setState((prev) => {
      const oldIndex = prev.order.indexOf(active.id as WidgetId)
      const newIndex = prev.order.indexOf(over.id as WidgetId)
      if (oldIndex < 0 || newIndex < 0) return prev
      return { ...prev, order: arrayMove(prev.order, oldIndex, newIndex) }
    })
  }

  function toggleVisible(id: WidgetId, checked: boolean) {
    setState((prev) => ({
      ...prev,
      visible: { ...prev.visible, [id]: checked },
    }))
  }

  function reset() {
    setState(defaultState())
  }

  // Determine which widgets are visible (in order)
  const visibleOrdered = state.order.filter((id) => state.visible[id])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-6">
        <SortableContext
          items={visibleOrdered}
          strategy={verticalListSortingStrategy}
        >
          {visibleOrdered.map((id) => (
            <SortableWidgetCard
              key={id}
              id={id}
              visible={state.visible[id]}
            >
              {renderWidget(id)}
            </SortableWidgetCard>
          ))}
        </SortableContext>
      </div>

      {/* Customize button + Popover */}
      <Popover open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <PopoverTrigger asChild>
          {renderCustomizeTrigger ? (
            (renderCustomizeTrigger() as React.ReactElement)
          ) : (
            <button
              type="button"
              aria-label="ปรับแต่งวิดเจ็ต"
              className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#0f172a] text-white shadow-lg transition-all hover:scale-105 hover:bg-[#1e293b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-2 dark:bg-[#f97316] dark:hover:bg-[#ea580c] dark:focus-visible:ring-offset-slate-950"
              title="ปรับแต่งวิดเจ็ต"
            >
              <Settings2 className="h-5 w-5" />
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          className="w-72 p-0 dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <Settings2 className="h-4 w-4 text-[#f97316]" />
              ปรับแต่งวิดเจ็ต
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              ลากเพื่อจัดเรียง · เลือกเพื่อแสดง/ซ่อน
            </p>
          </div>
          <div className="itam-scroll max-h-72 overflow-y-auto p-2">
            {state.order.map((id) => {
              const meta = WIDGET_META[id]
              const checked = state.visible[id]
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                  htmlFor={`widget-toggle-${id}`}
                >
                  <Checkbox
                    id={`widget-toggle-${id}`}
                    checked={checked}
                    onCheckedChange={(v) => toggleVisible(id, v === true)}
                    className="border-slate-300 data-[state=checked]:bg-[#f97316] data-[state=checked]:border-[#f97316] data-[state=checked]:text-white dark:border-slate-600 dark:data-[state=checked]:bg-[#f97316] dark:data-[state=checked]:border-[#f97316]"
                  />
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-sm dark:bg-slate-800">
                    {meta.icon}
                  </span>
                  <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">
                    {meta.title}
                  </span>
                  {checked ? (
                    <Eye className="h-3.5 w-3.5 text-slate-400" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 text-slate-300 dark:text-slate-400" />
                  )}
                </label>
              )
            })}
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 dark:border-slate-700">
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {visibleOrdered.length}/{state.order.length} แสดงอยู่
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={reset}
              className="h-8 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              รีเซ็ต
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </DndContext>
  )
}
