'use client'

/**
 * CustomFieldRenderer.tsx — Dynamic form fields ตาม CustomFieldDefinition
 *
 * ตามภาคผนวก B ของพิมพ์เขียว:
 *   - โหลด Definition ที่ active=true + targetEntity ตรงกัน
 *   - เรียงตาม section, sortOrder
 *   - แสดง Required/Help/Validation ให้ผู้ใช้เห็น
 *   - รองรับ type: text, textarea, integer, decimal, boolean, date, datetime, select, multiselect, email, url
 *
 * Usage:
 *   <CustomFieldRenderer targetEntity="Device" targetId="device-123" />
 */
import * as React from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, Save, Tag } from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

export interface CustomFieldDef {
  id: string
  key: string
  label: string
  description: string | null
  fieldType: string
  required: boolean
  section: string | null
  placeholder: string | null
  sortOrder: number
  options: Array<{ value: string; label: string; active: boolean }>
}

export interface CustomFieldValueData {
  fieldId: string
  key: string
  label: string
  value: any
  fieldType: string
}

interface Props {
  targetEntity: string
  targetId: string
  /** Optional: only render fields in this section */
  section?: string
}

export function CustomFieldRenderer({ targetEntity, targetId, section }: Props) {
  const token = useAuthStore((s) => s.token)

  // Load definitions
  const { data: defData, isLoading: defLoading } = useQuery({
    queryKey: ['custom-field-defs', targetEntity],
    queryFn: async () => {
      const url = `/api/custom-fields/definitions?targetEntity=${targetEntity}&includeOptions=true`
      const res = await fetch(url, {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('Failed to load custom field definitions')
      return res.json()
    },
  })

  // Load existing values
  const { data: valData } = useQuery({
    queryKey: ['custom-field-values', targetEntity, targetId],
    queryFn: async () => {
      const res = await fetch(`/api/custom-fields/values/${targetEntity}/${targetId}`, {
        headers: bearerHeaders(token),
      })
      if (!res.ok) return { values: [] }
      return res.json()
    },
    enabled: !!targetId && targetId !== 'new',
  })

  // Build form state
  const definitions: CustomFieldDef[] = defData?.definitions || []
    // Shape matches the GET /api/custom-fields/values response, which returns raw
  // CustomFieldValue rows (`include: { field }`).
  const values: Array<{ fieldId: string; valueJson: unknown }> = valData?.values || []

  const [formValues, setFormValues] = React.useState<Record<string, any>>({})

  // Sync values from API → local state
  React.useEffect(() => {
    if (values.length > 0) {
      const newState: Record<string, any> = {}
      for (const v of values) {
        // `valueJson` is a Prisma `Json` column, so the API already returns it
        // deserialized — it is NOT a JSON string. Calling JSON.parse() on it
        // stringified the object to "[object Object]", threw, and the catch
        // branch reset EVERY custom field to null. Use the value as-is and only
        // fall back to null when the server sent nothing.
        newState[v.fieldId] = v.valueJson ?? null
      }
      setFormValues(newState)
    }
  }, [values])

  // Filter by section if provided
  const filteredDefs = section
    ? definitions.filter(d => d.section === section)
    : definitions

  // Group by section
  const grouped = React.useMemo(() => {
    const groups = new Map<string, CustomFieldDef[]>()
    for (const def of filteredDefs) {
      const sec = def.section || 'ข้อมูลเพิ่มเติม'
      if (!groups.has(sec)) groups.set(sec, [])
      groups.get(sec)!.push(def)
    }
    // Sort each group by sortOrder
    for (const [k, defs] of groups) {
      defs.sort((a, b) => a.sortOrder - b.sortOrder)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredDefs])

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const valuesToSave = Object.entries(formValues).map(([fieldId, value]) => ({
        fieldId,
        value,
      }))
      const res = await fetch(`/api/custom-fields/values/${targetEntity}/${targetId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ values: valuesToSave }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Save failed' }))
        throw new Error(err.error || 'Save failed')
      }
      return res.json()
    },
    onSuccess: () => toast.success('บันทึกข้อมูลเพิ่มเติมแล้ว'),
    onError: (e: any) => toast.error(e.message || 'บันทึกไม่สำเร็จ'),
  })

  if (defLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  if (definitions.length === 0) {
    return null // No custom fields for this entity — don't render anything
  }

  return (
    <div className="space-y-4">
      {grouped.map(([sectionName, defs]) => (
        <div key={sectionName} className="space-y-3">
          <div className="flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-[#f97316]" />
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{sectionName}</h4>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {defs.map(def => (
              <FieldInput
                key={def.id}
                def={def}
                value={formValues[def.id]}
                onChange={(v) => setFormValues(prev => ({ ...prev, [def.id]: v }))}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          size="sm"
          className="gap-1.5"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          บันทึกข้อมูลเพิ่มเติม
        </Button>
      </div>
    </div>
  )
}

// ── Single Field Input ────────────────────────────────────────────────

function FieldInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef
  value: any
  onChange: (v: any) => void
}) {
  const label = (
    <Label className="text-xs">
      {def.label}
      {def.required && <span className="ml-1 text-rose-500">*</span>}
    </Label>
  )

  const helpText = def.description ? (
    <p className="text-[10px] text-muted-foreground">{def.description}</p>
  ) : null

  const renderInput = () => {
    switch (def.fieldType) {
      case 'text':
      case 'email':
      case 'url':
        return (
          <Input
            type={def.fieldType === 'email' ? 'email' : def.fieldType === 'url' ? 'url' : 'text'}
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            placeholder={def.placeholder || ''}
            required={def.required}
          />
        )
      case 'textarea':
        return (
          <Textarea
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            placeholder={def.placeholder || ''}
            required={def.required}
            rows={3}
          />
        )
      case 'integer':
        return (
          <Input
            type="number"
            value={value ?? ''}
            onChange={e => onChange(e.target.value === '' ? null : parseInt(e.target.value))}
            placeholder={def.placeholder || '0'}
            required={def.required}
          />
        )
      case 'decimal':
        return (
          <Input
            type="number"
            step="0.01"
            value={value ?? ''}
            onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
            placeholder={def.placeholder || '0.00'}
            required={def.required}
          />
        )
      case 'boolean':
        return (
          <div className="flex items-center gap-2 pt-1">
            <Switch
              checked={!!value}
              onCheckedChange={v => onChange(v)}
            />
            <span className="text-xs text-muted-foreground">{value ? 'ใช่' : 'ไม่ใช่'}</span>
          </div>
        )
      case 'date':
        return (
          <Input
            type="date"
            value={value ?? ''}
            onChange={e => onChange(e.target.value || null)}
            required={def.required}
          />
        )
      case 'datetime':
        return (
          <Input
            type="datetime-local"
            value={value ?? ''}
            onChange={e => onChange(e.target.value || null)}
            required={def.required}
          />
        )
      case 'select':
        return (
          <Select value={value ?? ''} onValueChange={v => onChange(v)}>
            <SelectTrigger>
              <SelectValue placeholder={def.placeholder || 'เลือก...'} />
            </SelectTrigger>
            <SelectContent>
              {def.options.filter(o => o.active).map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      case 'multiselect':
        return (
          <div className="space-y-1">
            {def.options.filter(o => o.active).map(o => {
              const arr: string[] = Array.isArray(value) ? value : []
              const checked = arr.includes(o.value)
              return (
                <div key={o.value} className="flex items-center gap-2">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      if (v) onChange([...arr, o.value])
                      else onChange(arr.filter(x => x !== o.value))
                    }}
                  />
                  <span className="text-xs">{o.label}</span>
                </div>
              )
            })}
          </div>
        )
      default:
        return <Input value={value ?? ''} onChange={e => onChange(e.target.value)} />
    }
  }

  return (
    <div className="space-y-1">
      {label}
      {renderInput()}
      {helpText}
    </div>
  )
}
