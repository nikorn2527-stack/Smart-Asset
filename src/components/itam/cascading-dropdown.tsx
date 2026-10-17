'use client'

/**
 * cascading-dropdown.tsx
 *
 * Two cascade groups + a free-text Location, used in device forms:
 *
 *   ┌─ Type ──→ Brand ──→ Model ───────────────────────────────┐
 *   │  (FK tables: DeviceType / Brand / Model)                  │
 *   │                                                            │
 *   └─ Building ──→ Floor ──→ Department ──→ Location (free) ───┘
 *      (DISTINCT queries on Device, scoped to the user's site)
 *
 * Features:
 *   • Uses shadcn Combobox (Popover + Command) so users can ALSO type a
 *     brand-new value not in the list — the new value is marked with a
 *     "+ ใหม่" badge and the parent's onChange receives isNewXxx=true.
 *   • Loading skeletons while each list is being fetched.
 *   • Touch-friendly: every trigger is h-11 (44px) — meets iOS HIG.
 *   • Thai labels throughout.
 *   • When a parent selection changes, child selections are cleared
 *     (otherwise stale values linger).
 *
 * API (all Bearer-auth'd via the global fetch interceptor):
 *   GET /api/master?type=device-types
 *   GET /api/master?type=brands&typeId=X
 *   GET /api/master?type=models&brandId=X
 *   GET /api/master?type=buildings&site=UDH
 *   GET /api/master?type=floors&site=UDH&building=X
 *   GET /api/master?type=departments&site=UDH&building=X&floor=Y
 *   GET /api/master?type=locations&site=UDH
 *
 * The `site` prop is FIXED from the parent (typically the user's
 * current site, derived from login) so site-scoped queries are
 * constrained to what the user is allowed to see.
 */

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Combobox } from './combobox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Cpu, Building2, Layers, Users, MapPin } from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface CascadingValue {
  // Type → Brand → Model cascade (normalized FKs)
  typeId?: string | null
  brandId?: string | null
  modelId?: string | null
  // The string names (kept for backward compat with legacy Device columns)
  type?: string
  brand?: string
  model?: string
  // "new" flags — true when the user typed a value not in the master list
  isNewType?: boolean
  isNewBrand?: boolean
  isNewModel?: boolean

  // Building → Floor → Department + Location cascade (free-text)
  building?: string
  floor?: string
  department?: string
  location?: string
}

export interface CascadingDropdownProps {
  /** Fixed site code (from the user's login / selected site). */
  site: string
  /** Initial values (used for edit mode). */
  initial?: Partial<CascadingValue>
  /** Called on every change with the full new value object. */
  onChange: (v: CascadingValue) => void
  /** Disable all controls (e.g. while saving). */
  disabled?: boolean
  /** Optional className on the root container. */
  className?: string
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

interface IdName {
  id: string
  name: string
}

interface MasterListResponse {
  items: IdName[] | string[]
  type?: string
}

function toIdNameItems(arr: unknown): IdName[] {
  if (!Array.isArray(arr)) return []
  // Items may be either {id, name} or plain strings
  return arr
    .map((it) => {
      if (typeof it === 'string') return { id: it, name: it }
      if (it && typeof it === 'object' && 'name' in it && 'id' in it) {
        return { id: String((it as IdName).id), name: String((it as IdName).name) }
      }
      return null
    })
    .filter((x): x is IdName => x !== null)
}

function toStrItems(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return arr
    .map((it) => {
      if (typeof it === 'string') return it
      if (it && typeof it === 'object' && 'name' in it) return String((it as IdName).name)
      if (it && typeof it === 'object' && 'label' in it) return String((it as { label: string }).label)
      return ''
    })
    .filter((s) => s !== '')
}

// ─────────────────────────────────────────────────────────────
// Field wrapper — label + control + loading skeleton
// ─────────────────────────────────────────────────────────────

function Field({
  label,
  htmlFor,
  loading,
  children,
  hint,
}: {
  label: string
  htmlFor?: string
  loading?: boolean
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-xs font-medium text-slate-600 dark:text-slate-300"
      >
        {label}
      </Label>
      {loading ? (
        <Skeleton className="h-11 w-full rounded-md" />
      ) : (
        children
      )}
      {hint && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  )
}

// Small "+ ใหม่" badge shown next to a value that the user typed
// (i.e. doesn't match any item in the loaded list).
function NewBadge() {
  return (
    <Badge
      variant="outline"
      className="ml-2 border-amber-300 bg-amber-50 px-1.5 py-0 text-[9px] font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
    >
      + ใหม่
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function CascadingDropdown({
  site,
  initial,
  onChange,
  disabled,
  className,
}: CascadingDropdownProps) {
  // ── Local state (controlled by parent via initial + onChange) ──
  const [val, setVal] = React.useState<CascadingValue>({
    type: initial?.type ?? '',
    brand: initial?.brand ?? '',
    model: initial?.model ?? '',
    typeId: initial?.typeId ?? null,
    brandId: initial?.brandId ?? null,
    modelId: initial?.modelId ?? null,
    building: initial?.building ?? '',
    floor: initial?.floor ?? '',
    department: initial?.department ?? '',
    location: initial?.location ?? '',
  })

  // Sync from parent when `initial` changes (e.g. when a different
  // device is opened).
  React.useEffect(() => {
    setVal({
      type: initial?.type ?? '',
      brand: initial?.brand ?? '',
      model: initial?.model ?? '',
      typeId: initial?.typeId ?? null,
      brandId: initial?.brandId ?? null,
      modelId: initial?.modelId ?? null,
      building: initial?.building ?? '',
      floor: initial?.floor ?? '',
      department: initial?.department ?? '',
      location: initial?.location ?? '',
    })
  }, [
    initial?.type,
    initial?.brand,
    initial?.model,
    initial?.typeId,
    initial?.brandId,
    initial?.modelId,
    initial?.building,
    initial?.floor,
    initial?.department,
    initial?.location,
  ])

  // Propagate every change up.
  function update(patch: Partial<CascadingValue>) {
    const next = { ...val, ...patch }
    setVal(next)
    onChange(next)
  }

  // ── Cascade 1: DeviceType → Brand → Model ──
  const typesQ = useQuery<IdName[]>({
    queryKey: ['master', 'device-types'],
    queryFn: async () => {
      const res = await fetch('/api/master?type=device-types')
      if (!res.ok) throw new Error('Failed to load device types')
      const j = (await res.json()) as MasterListResponse
      return toIdNameItems(j.items)
    },
    staleTime: 60_000,
  })

  const brandsQ = useQuery<IdName[]>({
    queryKey: ['master', 'brands', val.typeId ?? ''],
    queryFn: async () => {
      if (!val.typeId) return []
      const res = await fetch(
        `/api/master?type=brands&typeId=${encodeURIComponent(val.typeId)}`,
      )
      if (!res.ok) throw new Error('Failed to load brands')
      const j = (await res.json()) as MasterListResponse
      return toIdNameItems(j.items)
    },
    enabled: Boolean(val.typeId),
    staleTime: 60_000,
  })

  const modelsQ = useQuery<IdName[]>({
    queryKey: ['master', 'models', val.brandId ?? ''],
    queryFn: async () => {
      if (!val.brandId) return []
      const res = await fetch(
        `/api/master?type=models&brandId=${encodeURIComponent(val.brandId)}`,
      )
      if (!res.ok) throw new Error('Failed to load models')
      const j = (await res.json()) as MasterListResponse
      return toIdNameItems(j.items)
    },
    enabled: Boolean(val.brandId),
    staleTime: 60_000,
  })

  // ── Cascade 2: Building → Floor → Department ──
  const buildingsQ = useQuery<string[]>({
    queryKey: ['master', 'buildings', site],
    queryFn: async () => {
      const res = await fetch(
        `/api/master?type=buildings&site=${encodeURIComponent(site)}`,
      )
      if (!res.ok) throw new Error('Failed to load buildings')
      const j = (await res.json()) as MasterListResponse
      return toStrItems(j.items)
    },
    enabled: Boolean(site),
    staleTime: 30_000,
  })

  const floorsQ = useQuery<string[]>({
    queryKey: ['master', 'floors', site, val.building ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams({ type: 'floors', site })
      if (val.building) params.set('building', val.building)
      const res = await fetch(`/api/master?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load floors')
      const j = (await res.json()) as MasterListResponse
      return toStrItems(j.items)
    },
    enabled: Boolean(site) && Boolean(val.building),
    staleTime: 30_000,
  })

  const deptsQ = useQuery<string[]>({
    queryKey: ['master', 'departments', site, val.building ?? '', val.floor ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams({ type: 'departments', site })
      if (val.building) params.set('building', val.building)
      if (val.floor) params.set('floor', val.floor)
      const res = await fetch(`/api/master?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load departments')
      const j = (await res.json()) as MasterListResponse
      return toStrItems(j.items)
    },
    enabled: Boolean(site) && Boolean(val.building) && Boolean(val.floor),
    staleTime: 30_000,
  })

  const locationsQ = useQuery<string[]>({
    queryKey: ['master', 'locations', site],
    queryFn: async () => {
      const res = await fetch(
        `/api/master?type=locations&site=${encodeURIComponent(site)}`,
      )
      if (!res.ok) throw new Error('Failed to load locations')
      const j = (await res.json()) as MasterListResponse
      return toStrItems(j.items)
    },
    enabled: Boolean(site),
    staleTime: 30_000,
  })

  // ── Cascade-clear on parent change ──
  // When the user changes Type → clear Brand + Model (FKs and strings).
  function handleTypeChange(next: string) {
    // If the new value matches a known DeviceType, set the typeId too.
    const match = typesQ.data?.find((t) => t.name === next)
    update({
      type: next,
      typeId: match ? match.id : null,
      isNewType: !match && next !== '',
      // Clear children
      brand: '',
      brandId: null,
      isNewBrand: false,
      model: '',
      modelId: null,
      isNewModel: false,
    })
  }

  function handleBrandChange(next: string) {
    const match = brandsQ.data?.find((b) => b.name === next)
    update({
      brand: next,
      brandId: match ? match.id : null,
      isNewBrand: !match && next !== '',
      // Clear child
      model: '',
      modelId: null,
      isNewModel: false,
    })
  }

  function handleModelChange(next: string) {
    const match = modelsQ.data?.find((m) => m.name === next)
    update({
      model: next,
      modelId: match ? match.id : null,
      isNewModel: !match && next !== '',
    })
  }

  // Building / Floor / Department / Location are free-text with suggestions.
  // Changing Building clears Floor + Department (cascade integrity).
  function handleBuildingChange(next: string) {
    update({
      building: next,
      floor: '',
      department: '',
    })
  }
  function handleFloorChange(next: string) {
    update({
      floor: next,
      department: '',
    })
  }
  function handleDepartmentChange(next: string) {
    update({ department: next })
  }
  function handleLocationChange(next: string) {
    update({ location: next })
  }

  // ── Derived: is the current value "new" (not in the loaded list)? ──
  const isNewType =
    val.type !== '' &&
    !typesQ.data?.some((t) => t.name === val.type)
  const isNewBrand =
    val.brand !== '' &&
    !brandsQ.data?.some((b) => b.name === val.brand)
  const isNewModel =
    val.model !== '' &&
    !modelsQ.data?.some((m) => m.name === val.model)

  // ── Render ──
  return (
    <div className={`flex flex-col gap-4 ${className ?? ''}`}>
      {/* ── Section 1: DeviceType → Brand → Model ── */}
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <Cpu className="h-3.5 w-3.5" />
          ประเภท / แบรนด์ / รุ่น
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="ประเภทอุปกรณ์" loading={typesQ.isLoading}>
            <div className="flex items-center">
              <Combobox
                items={(typesQ.data ?? []).map((t) => ({ value: t.name, label: t.name }))}
                value={val.type ?? ''}
                onChange={handleTypeChange}
                placeholder="เลือกหรือพิมพ์..."
                disabled={disabled}
                emptyText="ไม่พบประเภท — พิมพ์เพื่อเพิ่มใหม่"
                groupLabel="ประเภทที่มีในระบบ"
                className="w-full"
              />
              {isNewType && <NewBadge />}
            </div>
          </Field>

          <Field
            label="แบรนด์"
            loading={brandsQ.isLoading && Boolean(val.typeId)}
            hint={!val.type ? '⚠ เลือกประเภทก่อน' : undefined}
          >
            <div className="flex items-center">
              <Combobox
                items={(brandsQ.data ?? []).map((b) => ({ value: b.name, label: b.name }))}
                value={val.brand ?? ''}
                onChange={handleBrandChange}
                placeholder="เลือกหรือพิมพ์..."
                disabled={disabled || !val.type}
                emptyText="ไม่พบแบรนด์ — พิมพ์เพื่อเพิ่มใหม่"
                groupLabel="แบรนด์ที่มีในระบบ"
                className="w-full"
              />
              {isNewBrand && <NewBadge />}
            </div>
          </Field>

          <Field
            label="รุ่น"
            loading={modelsQ.isLoading && Boolean(val.brandId)}
            hint={!val.brand ? '⚠ เลือกแบรนด์ก่อน' : undefined}
          >
            <div className="flex items-center">
              <Combobox
                items={(modelsQ.data ?? []).map((m) => ({ value: m.name, label: m.name }))}
                value={val.model ?? ''}
                onChange={handleModelChange}
                placeholder="เลือกหรือพิมพ์..."
                disabled={disabled || !val.brand}
                emptyText="ไม่พบรุ่น — พิมพ์เพื่อเพิ่มใหม่"
                groupLabel="รุ่นที่มีในระบบ"
                className="w-full"
              />
              {isNewModel && <NewBadge />}
            </div>
          </Field>
        </div>
      </div>

      {/* ── Section 2: Building → Floor → Department + Location ── */}
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <Building2 className="h-3.5 w-3.5" />
          ตำแหน่งที่ตั้ง
          <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            site: {site || '—'}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="อาคาร" loading={buildingsQ.isLoading}>
            <div className="flex items-center">
              <Combobox
                items={(buildingsQ.data ?? []).map((b) => ({ value: b, label: b }))}
                value={val.building ?? ''}
                onChange={handleBuildingChange}
                placeholder="เลือกหรือพิมพ์..."
                disabled={disabled || !site}
                emptyText="ไม่พบอาคาร — พิมพ์เพื่อเพิ่มใหม่"
                groupLabel="อาคารที่มีในสาขานี้"
                className="w-full"
              />
            </div>
          </Field>

          <Field
            label="ชั้น"
            loading={floorsQ.isLoading && Boolean(val.building)}
            hint={!val.building ? '⚠ เลือกอาคารก่อน' : undefined}
          >
            <div className="flex items-center">
              <Combobox
                items={(floorsQ.data ?? []).map((f) => ({ value: f, label: f }))}
                value={val.floor ?? ''}
                onChange={handleFloorChange}
                placeholder="เลือกหรือพิมพ์..."
                disabled={disabled || !val.building}
                emptyText="ไม่พบชั้น — พิมพ์เพื่อเพิ่มใหม่"
                groupLabel="ชั้นในอาคารนี้"
                className="w-full"
              />
            </div>
          </Field>

          <Field
            label="แผนก"
            loading={deptsQ.isLoading && Boolean(val.floor)}
            hint={!val.floor ? '⚠ เลือกชั้นก่อน' : undefined}
          >
            <div className="flex items-center">
              <Combobox
                items={(deptsQ.data ?? []).map((d) => ({ value: d, label: d }))}
                value={val.department ?? ''}
                onChange={handleDepartmentChange}
                placeholder="เลือกหรือพิมพ์..."
                disabled={disabled || !val.floor}
                emptyText="ไม่พบแผนก — พิมพ์เพื่อเพิ่มใหม่"
                groupLabel="แผนกในชั้นนี้"
                className="w-full"
              />
            </div>
          </Field>

          <Field label="ที่ตั้ง (Location)" loading={locationsQ.isLoading}>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Combobox
                items={(locationsQ.data ?? []).map((l) => ({ value: l, label: l }))}
                value={val.location ?? ''}
                onChange={handleLocationChange}
                placeholder="พิมพ์ที่ตั้ง..."
                disabled={disabled || !site}
                emptyText="ไม่พบที่ตั้ง — พิมพ์เพื่อเพิ่มใหม่"
                groupLabel="ที่ตั้งที่เคยใช้ในสาขานี้"
                className="w-full"
                icon={<MapPin className="h-3.5 w-3.5" />}
              />
            </div>
          </Field>
        </div>
      </div>

      {/* Compact legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
        <span className="flex items-center gap-1">
          <Layers className="h-3 w-3" />
          เลือกจากรายการ หรือพิมพ์ใหม่ได้
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          ค่าที่พิมพ์ใหม่จะถูกทำเคราะห์
        </span>
        <span className="flex items-center gap-1">
          <NewBadge />
          หมายถึงค่าใหม่ที่ยังไม่อยู่ในระบบ
        </span>
      </div>
    </div>
  )
}

export default CascadingDropdown
