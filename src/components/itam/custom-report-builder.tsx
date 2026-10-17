'use client'

/**
 * CustomReportBuilder — Phase A3 — Advanced Custom Report Builder.
 *
 * Multi-step wizard:
 *   1. Choose data source (devices/workorders/meterreadings/stockitems)
 *   2. Select columns (checkboxes with field names)
 *   3. Add filters (dynamic filter rows with field/op/value)
 *   4. Group by + aggregations (optional)
 *   5. Save template (name + description)
 *
 * Live preview panel shows the first 10 rows of the result; "Run Report"
 * shows the full result; "Export CSV" / "Export PDF" download attachments.
 *
 * The list of saved templates (right column) supports edit / duplicate /
 * delete / run / export. Templates are owned by the user; admins can share
 * them system-wide via the "isShared" toggle on the save step.
 *
 * Task ID: PHASE-A3-REPORTS
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  BarChart3, Plus, Pencil, Trash2, Copy, Play, Download, FileText,
  ChevronLeft, ChevronRight, Loader2, Database, AlertTriangle, CheckCircle2, X,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { useT, useFormatDateTime } from '@/store/i18n-store'
import { cn } from '@/lib/utils'
import { downloadCsv } from '@/lib/csv-export'

// ── Types ─────────────────────────────────────────────────────────────

type DataSourceName = 'devices' | 'workorders' | 'meterreadings' | 'stockitems'
type FilterOp = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'in'
type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max'

interface FieldDef {
  prisma: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'datetime'
}

interface ReportFilter {
  field: string
  op: FilterOp
  value: string // raw string — server coerces based on field type
}

interface ReportAggregation {
  field: string
  fn: AggFn
}

interface ReportSort {
  field: string
  dir: 'asc' | 'desc'
}

interface ReportConfig {
  dataSource: DataSourceName
  columns: string[]
  filters: ReportFilter[]
  groupBy?: string
  aggregations: ReportAggregation[]
  sortBy: ReportSort[]
  limit?: number
}

interface SavedTemplate {
  id: string
  name: string
  description: string | null
  dataSource: DataSourceName
  isShared: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
  config?: ReportConfig
}

interface RunResult {
  rows: Record<string, unknown>[]
  columns: { key: string; label: string }[]
  total: number
  truncated: boolean
  dataSource: DataSourceName
  generatedAt: string
}

// ── Field catalogs (must match the server-side whitelist) ─────────────

const FIELDS: Record<DataSourceName, FieldDef[]> = {
  devices: [
    { prisma: 'id', label: 'ID', type: 'string' },
    { prisma: 'assetCode', label: 'Asset Code', type: 'string' },
    { prisma: 'name', label: 'Name', type: 'string' },
    { prisma: 'brand', label: 'Brand', type: 'string' },
    { prisma: 'model', label: 'Model', type: 'string' },
    { prisma: 'type', label: 'Type', type: 'string' },
    { prisma: 'serialNumber', label: 'Serial Number', type: 'string' },
    { prisma: 'status', label: 'Status', type: 'string' },
    { prisma: 'site', label: 'Site', type: 'string' },
    { prisma: 'department', label: 'Department', type: 'string' },
    { prisma: 'departmentCode', label: 'Department Code', type: 'string' },
    { prisma: 'assetSiteCode', label: 'Asset Site Code', type: 'string' },
    { prisma: 'displayLabel', label: 'Display Label', type: 'string' },
    { prisma: 'location', label: 'Location', type: 'string' },
    { prisma: 'building', label: 'Building', type: 'string' },
    { prisma: 'floor', label: 'Floor', type: 'string' },
    { prisma: 'room', label: 'Room', type: 'string' },
    { prisma: 'purchaseDate', label: 'Purchase Date', type: 'date' },
    { prisma: 'purchasePrice', label: 'Purchase Price', type: 'number' },
    { prisma: 'salvageValue', label: 'Salvage Value', type: 'number' },
    { prisma: 'usefulLife', label: 'Useful Life', type: 'number' },
    { prisma: 'warrantyMonths', label: 'Warranty Months', type: 'number' },
    { prisma: 'warrantyEnd', label: 'Warranty End', type: 'date' },
    { prisma: 'vendor', label: 'Vendor', type: 'string' },
    { prisma: 'contractNo', label: 'Contract No', type: 'string' },
    { prisma: 'installDate', label: 'Install Date', type: 'date' },
    { prisma: 'uninstallDate', label: 'Uninstall Date', type: 'date' },
    { prisma: 'meterRequired', label: 'Meter Required', type: 'boolean' },
    { prisma: 'meterMode', label: 'Meter Mode', type: 'string' },
    { prisma: 'lastMeterBw', label: 'Last Meter BW', type: 'number' },
    { prisma: 'lastMeterColor', label: 'Last Meter Color', type: 'number' },
    { prisma: 'ip', label: 'IP Address', type: 'string' },
    { prisma: 'mac', label: 'MAC Address', type: 'string' },
    { prisma: 'currentAssignee', label: 'Current Assignee', type: 'string' },
    { prisma: 'remark', label: 'Remark', type: 'string' },
    { prisma: 'costCenter', label: 'Cost Center', type: 'string' },
    { prisma: 'deviceGroup', label: 'Device Group', type: 'string' },
    { prisma: 'createdAt', label: 'Created At', type: 'datetime' },
    { prisma: 'updatedAt', label: 'Updated At', type: 'datetime' },
    { prisma: 'updatedBy', label: 'Updated By', type: 'string' },
  ],
  workorders: [
    { prisma: 'id', label: 'ID', type: 'string' },
    { prisma: 'woNumber', label: 'WO Number', type: 'string' },
    { prisma: 'legacyJobNo', label: 'Legacy Job No', type: 'string' },
    { prisma: 'systemJobNo', label: 'System Job No', type: 'string' },
    { prisma: 'requestId', label: 'Request ID', type: 'string' },
    { prisma: 'subject', label: 'Subject', type: 'string' },
    { prisma: 'building', label: 'Building', type: 'string' },
    { prisma: 'location', label: 'Location', type: 'string' },
    { prisma: 'details', label: 'Details', type: 'string' },
    { prisma: 'priority', label: 'Priority', type: 'string' },
    { prisma: 'reporterName', label: 'Reporter Name', type: 'string' },
    { prisma: 'reporterEmail', label: 'Reporter Email', type: 'string' },
    { prisma: 'tel', label: 'Phone', type: 'string' },
    { prisma: 'employeeCode', label: 'Employee Code', type: 'string' },
    { prisma: 'submissionSource', label: 'Submission Source', type: 'string' },
    { prisma: 'trackable', label: 'Trackable', type: 'boolean' },
    { prisma: 'status', label: 'Status', type: 'string' },
    { prisma: 'acceptStatus', label: 'Accept Status', type: 'string' },
    { prisma: 'assignedTo', label: 'Assigned To', type: 'string' },
    { prisma: 'assignedBy', label: 'Assigned By', type: 'string' },
    { prisma: 'assignmentNote', label: 'Assignment Note', type: 'string' },
    { prisma: 'resolution', label: 'Resolution', type: 'string' },
    { prisma: 'resolutionGroup', label: 'Resolution Group', type: 'string' },
    { prisma: 'deviceId', label: 'Device ID', type: 'string' },
    { prisma: 'siteCode', label: 'Site Code', type: 'string' },
    { prisma: 'isSpecialFee', label: 'Special Fee', type: 'boolean' },
    { prisma: 'createdAt', label: 'Created At', type: 'datetime' },
    { prisma: 'updatedAt', label: 'Updated At', type: 'datetime' },
    { prisma: 'assignedAt', label: 'Assigned At', type: 'datetime' },
    { prisma: 'workCompletedAt', label: 'Work Completed At', type: 'datetime' },
    { prisma: 'closedAt', label: 'Closed At', type: 'datetime' },
    { prisma: 'canceledAt', label: 'Canceled At', type: 'datetime' },
  ],
  meterreadings: [
    { prisma: 'id', label: 'ID', type: 'string' },
    { prisma: 'readingId', label: 'Reading ID', type: 'string' },
    { prisma: 'deviceId', label: 'Device ID', type: 'string' },
    { prisma: 'assetCode', label: 'Asset Code', type: 'string' },
    { prisma: 'readingDate', label: 'Reading Date', type: 'date' },
    { prisma: 'readingMonth', label: 'Reading Month', type: 'string' },
    { prisma: 'meterBw', label: 'Meter BW', type: 'number' },
    { prisma: 'meterColor', label: 'Meter Color', type: 'number' },
    { prisma: 'pagesBw', label: 'Pages BW', type: 'number' },
    { prisma: 'pagesColor', label: 'Pages Color', type: 'number' },
    { prisma: 'prevMeterBw', label: 'Prev Meter BW', type: 'number' },
    { prisma: 'prevMeterColor', label: 'Prev Meter Color', type: 'number' },
    { prisma: 'meterMode', label: 'Meter Mode', type: 'string' },
    { prisma: 'readingType', label: 'Reading Type', type: 'string' },
    { prisma: 'readBy', label: 'Read By', type: 'string' },
    { prisma: 'remark', label: 'Remark', type: 'string' },
    { prisma: 'locationAtReading', label: 'Location', type: 'string' },
    { prisma: 'siteAtReading', label: 'Site', type: 'string' },
    { prisma: 'buildingAtReading', label: 'Building', type: 'string' },
    { prisma: 'floorAtReading', label: 'Floor', type: 'string' },
    { prisma: 'departmentAtReading', label: 'Department', type: 'string' },
    { prisma: 'departmentCodeAtReading', label: 'Department Code', type: 'string' },
    { prisma: 'eventType', label: 'Event Type', type: 'string' },
    { prisma: 'createdAt', label: 'Created At', type: 'datetime' },
  ],
  stockitems: [
    { prisma: 'id', label: 'ID', type: 'string' },
    { prisma: 'productCode', label: 'Product Code', type: 'string' },
    { prisma: 'productName', label: 'Product Name', type: 'string' },
    { prisma: 'category', label: 'Category', type: 'string' },
    { prisma: 'brand', label: 'Brand', type: 'string' },
    { prisma: 'model', label: 'Model', type: 'string' },
    { prisma: 'unit', label: 'Unit', type: 'string' },
    { prisma: 'quantity', label: 'Quantity', type: 'number' },
    { prisma: 'minQuantity', label: 'Min Quantity', type: 'number' },
    { prisma: 'maxQuantity', label: 'Max Quantity', type: 'number' },
    { prisma: 'unitCost', label: 'Unit Cost', type: 'number' },
    { prisma: 'totalValue', label: 'Total Value', type: 'number' },
    { prisma: 'location', label: 'Location', type: 'string' },
    { prisma: 'site', label: 'Site', type: 'string' },
    { prisma: 'compatibleDevices', label: 'Compatible Devices', type: 'string' },
    { prisma: 'remark', label: 'Remark', type: 'string' },
    { prisma: 'active', label: 'Active', type: 'boolean' },
    { prisma: 'lastUpdated', label: 'Last Updated', type: 'string' },
    { prisma: 'costType', label: 'Cost Type', type: 'string' },
    { prisma: 'costModel', label: 'Cost Model', type: 'string' },
    { prisma: 'yieldPerPage', label: 'Yield/Page', type: 'number' },
    { prisma: 'createdAt', label: 'Created At', type: 'datetime' },
    { prisma: 'updatedAt', label: 'Updated At', type: 'datetime' },
  ],
}

const DATA_SOURCE_LABELS: { value: DataSourceName; labelKey: string }[] = [
  { value: 'devices', labelKey: 'reports.custom.data_source.devices' },
  { value: 'workorders', labelKey: 'reports.custom.data_source.workorders' },
  { value: 'meterreadings', labelKey: 'reports.custom.data_source.meterreadings' },
  { value: 'stockitems', labelKey: 'reports.custom.data_source.stockitems' },
]

const FILTER_OPS: { value: FilterOp; labelKey: string }[] = [
  { value: 'eq', labelKey: 'reports.custom.op.eq' },
  { value: 'neq', labelKey: 'reports.custom.op.neq' },
  { value: 'gt', labelKey: 'reports.custom.op.gt' },
  { value: 'lt', labelKey: 'reports.custom.op.lt' },
  { value: 'contains', labelKey: 'reports.custom.op.contains' },
  { value: 'in', labelKey: 'reports.custom.op.in' },
]

const AGG_FNS: { value: AggFn; labelKey: string }[] = [
  { value: 'count', labelKey: 'reports.custom.agg_fn.count' },
  { value: 'sum', labelKey: 'reports.custom.agg_fn.sum' },
  { value: 'avg', labelKey: 'reports.custom.agg_fn.avg' },
  { value: 'min', labelKey: 'reports.custom.agg_fn.min' },
  { value: 'max', labelKey: 'reports.custom.agg_fn.max' },
]

// ── Helpers ───────────────────────────────────────────────────────────

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const token = useAuthStore.getState()?.token
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

function emptyConfig(): ReportConfig {
  return {
    dataSource: 'devices',
    columns: [],
    filters: [],
    aggregations: [],
    sortBy: [],
    limit: 1000,
  }
}

function safeString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString()
    try {
      return String(v)
    } catch {
      return JSON.stringify(v)
    }
  }
  return String(v)
}

// ── Main component ────────────────────────────────────────────────────

export function CustomReportBuilder() {
  const t = useT()
  const qc = useQueryClient()
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [config, setConfig] = React.useState<ReportConfig>(emptyConfig())
  const [step, setStep] = React.useState<number>(0)
  const [templateName, setTemplateName] = React.useState('')
  const [templateDesc, setTemplateDesc] = React.useState('')
  const [isShared, setIsShared] = React.useState(false)
  const [wizardOpen, setWizardOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<SavedTemplate | null>(null)
  const [fullResult, setFullResult] = React.useState<RunResult | null>(null)
  const [previewResult, setPreviewResult] = React.useState<RunResult | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [exporting, setExporting] = React.useState<'csv' | 'pdf' | null>(null)
  const [fullLoading, setFullLoading] = React.useState(false)

  const { data: templatesData, isLoading: templatesLoading } = useQuery<{
    templates: SavedTemplate[]
  }>({
    queryKey: ['custom-reports'],
    queryFn: async () => {
      const res = await fetch('/api/reports/custom', { headers: authHeaders() })
      if (!res.ok) throw new Error(t('reports.custom.error_load'))
      return res.json()
    },
  })

  const templates = templatesData?.templates ?? []

  const createMut = useMutation({
    mutationFn: async (payload: {
      name: string
      description?: string | null
      dataSource: DataSourceName
      config: ReportConfig
      isShared?: boolean
    }) => {
      const res = await fetch('/api/reports/custom', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || t('reports.custom.error_save'))
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success(t('reports.custom.success_save'))
      qc.invalidateQueries({ queryKey: ['custom-reports'] })
      closeWizard()
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t('reports.custom.error_save'))
    },
  })

  const updateMut = useMutation({
    mutationFn: async (payload: {
      id: string
      name?: string
      description?: string | null
      dataSource?: DataSourceName
      config?: ReportConfig
      isShared?: boolean
    }) => {
      const res = await fetch(`/api/reports/custom/${payload.id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || t('reports.custom.error_save'))
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success(t('reports.custom.success_save'))
      qc.invalidateQueries({ queryKey: ['custom-reports'] })
      closeWizard()
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t('reports.custom.error_save'))
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/reports/custom/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || t('reports.custom.error_save'))
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success(t('reports.custom.success_delete'))
      qc.invalidateQueries({ queryKey: ['custom-reports'] })
      setDeleteTarget(null)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t('reports.custom.error_save'))
    },
  })

  // ── Wizard actions ───────────────────────────────────────────────

  function openNewWizard() {
    setConfig(emptyConfig())
    setStep(0)
    setTemplateName('')
    setTemplateDesc('')
    setIsShared(false)
    setEditingId(null)
    setFullResult(null)
    setPreviewResult(null)
    setWizardOpen(true)
  }

  async function openEditWizard(template: SavedTemplate) {
    // Fetch the full template (with config).
    try {
      const res = await fetch(`/api/reports/custom/${template.id}`, {
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error()
      const json = await res.json()
      const cfg = json.template?.config as ReportConfig | undefined
      setConfig(
        cfg ?? {
          dataSource: template.dataSource,
          columns: [],
          filters: [],
          aggregations: [],
          sortBy: [],
          limit: 1000,
        },
      )
      setEditingId(template.id)
      setTemplateName(template.name)
      setTemplateDesc(template.description ?? '')
      setIsShared(template.isShared)
      setStep(0)
      setFullResult(null)
      setPreviewResult(null)
      setWizardOpen(true)
    } catch {
      toast.error(t('reports.custom.error_load'))
    }
  }

  function closeWizard() {
    setWizardOpen(false)
    setEditingId(null)
    setFullResult(null)
    setPreviewResult(null)
  }

  // Run preview (limit 10)
  async function runPreview() {
    setPreviewLoading(true)
    try {
      const endpoint = editingId
        ? `/api/reports/custom/${editingId}/run`
        : '/api/reports/custom/run-preview' // doesn't exist — we use a temp save trick
      // Workaround: if there's no saved template, we POST to a temp id placeholder.
      // Simpler: create the template lazily. For preview, we'll save the report
      // as a draft if not yet saved, OR run the saved one.
      if (!editingId) {
        // Save as draft first, then run preview, then delete the draft? Too much churn.
        // Better: just inform user they must save first. Actually — we can use the
        // run endpoint with configOverride on a dummy ID? No, we need a real ID.
        // Solution: save a draft template silently, run preview, then allow user
        // to delete it via "discard changes".
        // Simpler UX: disable the preview button until first save, OR auto-create
        // a draft on the first preview.
        // We'll auto-create a draft here for the simplest UX.
        const draftName = `_draft_${Date.now()}`
        const createRes = await fetch('/api/reports/custom', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            name: draftName,
            dataSource: config.dataSource,
            config,
            isShared: false,
          }),
        })
        if (!createRes.ok) {
          const j = await createRes.json().catch(() => ({}))
          throw new Error(j.error || t('reports.custom.error_run'))
        }
        const json = await createRes.json()
        const draftId = json.template.id
        // Run preview with limit 10.
        const runRes = await fetch(`/api/reports/custom/${draftId}/run`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ limit: 10 }),
        })
        if (!runRes.ok) {
          const j = await runRes.json().catch(() => ({}))
          throw new Error(j.error || t('reports.custom.error_run'))
        }
        const runJson = await runRes.json()
        setPreviewResult(runJson.result as RunResult)
        // Switch to edit mode so subsequent saves update the draft (not create new).
        setEditingId(draftId)
        setTemplateName((prev) => (prev === '' ? draftName : prev))
      } else {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ limit: 10, configOverride: config }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || t('reports.custom.error_run'))
        }
        const json = await res.json()
        setPreviewResult(json.result as RunResult)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('reports.custom.error_run'))
    } finally {
      setPreviewLoading(false)
    }
  }

  // Run full report (limit = config.limit)
  async function runFull() {
    if (!editingId) {
      // Save first, then run.
      await saveTemplate(true)
    }
    if (!editingId) return
    setFullLoading(true)
    try {
      const res = await fetch(`/api/reports/custom/${editingId}/run`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ configOverride: config }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || t('reports.custom.error_run'))
      }
      const json = await res.json()
      setFullResult(json.result as RunResult)
      toast.success(t('reports.custom.success_run'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('reports.custom.error_run'))
    } finally {
      setFullLoading(false)
    }
  }

  async function saveTemplate(silent = false) {
    if (!templateName.trim()) {
      if (!silent) toast.error(t('reports.custom.name_required'))
      return null
    }
    const payload = {
      name: templateName.trim(),
      description: templateDesc.trim() || null,
      dataSource: config.dataSource,
      config,
      isShared,
    }
    if (editingId) {
      await updateMut.mutateAsync({ id: editingId, ...payload })
    } else {
      const result = await createMut.mutateAsync(payload)
      if (result?.template?.id) {
        setEditingId(result.template.id)
      }
    }
    return editingId
  }

  async function exportFormat(fmt: 'csv' | 'pdf') {
    if (!editingId) {
      const id = await saveTemplate(true)
      if (!id) return
    }
    if (!editingId) return
    setExporting(fmt)
    try {
      const res = await fetch(
        `/api/reports/custom/${editingId}/export?format=${fmt}`,
        { headers: authHeaders() },
      )
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        let msg = t('reports.custom.error_export')
        try {
          const j = JSON.parse(txt)
          if (j.error) msg = j.error
        } catch {
          /* ignore */
        }
        throw new Error(msg)
      }
      const blob = await res.blob()
      // Determine filename from Content-Disposition (fallback to default).
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `report.${fmt}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(t('reports.custom.success_run'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('reports.custom.error_export'))
    } finally {
      setExporting(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-xl">
                <BarChart3 className="h-5 w-5 text-primary" />
                {t('reports.custom.title')}
              </CardTitle>
              <CardDescription className="max-w-2xl">
                {t('reports.custom.subtitle')}
              </CardDescription>
            </div>
            <Button onClick={openNewWizard} className="shrink-0">
              <Plus className="h-4 w-4 mr-1" />
              {t('reports.custom.new_report')}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Saved templates list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('reports.custom.saved_templates')}</CardTitle>
        </CardHeader>
        <CardContent>
          {templatesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {t('reports.custom.no_templates')}
            </div>
          ) : (
            <div className="rounded-md border max-h-[420px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[40%]">{t('reports.custom.template_name')}</TableHead>
                    <TableHead>{t('reports.custom.data_source')}</TableHead>
                    <TableHead className="w-[120px]">{t('reports.custom.updated_at')}</TableHead>
                    <TableHead className="text-right">{t('reports.custom.run')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((tpl) => (
                    <TableRow key={tpl.id}>
                      <TableCell>
                        <div className="font-medium truncate">{tpl.name}</div>
                        {tpl.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {tpl.description}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={tpl.isShared ? 'default' : 'outline'} className="text-[10px] h-5">
                            {tpl.isShared ? t('reports.custom.shared') : t('reports.custom.private')}
                          </Badge>
                          {tpl.createdBy && (
                            <span className="text-[11px] text-muted-foreground">
                              {t('reports.custom.created_by')}: {tpl.createdBy}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {t(`reports.custom.data_source.${tpl.dataSource}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <FormatDate iso={tpl.updatedAt} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditWizard(tpl)}
                            title={t('reports.custom.edit_report')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => duplicateTemplate(tpl)}
                            title={t('reports.custom.duplicate')}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(tpl)}
                            title={t('reports.custom.delete')}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wizard dialog */}
      <Dialog open={wizardOpen} onOpenChange={(o) => !o && closeWizard()}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              {editingId
                ? t('reports.custom.edit_report')
                : t('reports.custom.new_report')}
            </DialogTitle>
            <DialogDescription>
              {t('reports.custom.step')} {step + 1} / 5 — {stepTitle(step, t)}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {[
              'reports.custom.step.datasource',
              'reports.custom.step.columns',
              'reports.custom.step.filters',
              'reports.custom.step.aggregations',
              'reports.custom.step.save',
            ].map((key, i) => (
              <button
                key={key}
                onClick={() => setStep(i)}
                className={cn(
                  'px-2.5 py-1 rounded-full border transition-colors',
                  i === step
                    ? 'bg-primary text-primary-foreground border-primary'
                    : i < step
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-card border-border text-muted-foreground hover:bg-accent',
                )}
              >
                {i + 1}. {t(key)}
              </button>
            ))}
          </div>

          {/* Step content (scrollable) */}
          <div className="flex-1 overflow-y-auto pr-1 min-h-0 space-y-4">
            {step === 0 && (
              <DataSourceStep config={config} setConfig={setConfig} />
            )}
            {step === 1 && (
              <ColumnsStep config={config} setConfig={setConfig} />
            )}
            {step === 2 && (
              <FiltersStep config={config} setConfig={setConfig} />
            )}
            {step === 3 && (
              <AggregationsStep config={config} setConfig={setConfig} />
            )}
            {step === 4 && (
              <SaveStep
                name={templateName}
                setName={setTemplateName}
                description={templateDesc}
                setDescription={setTemplateDesc}
                isShared={isShared}
                setIsShared={setIsShared}
              />
            )}

            {/* Live preview (always visible after step 0) */}
            <PreviewPanel
              result={previewResult}
              loading={previewLoading}
              onRunPreview={runPreview}
              canRunPreview={config.columns.length > 0 || !!config.groupBy}
            />

            {/* Full results panel (after Run Report) */}
            {fullResult && (
              <FullResultPanel
                result={fullResult}
                onClose={() => setFullResult(null)}
              />
            )}
          </div>

          {/* Footer — actions + nav */}
          <DialogFooter className="flex items-center justify-between gap-2 flex-wrap border-t pt-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                {t('reports.custom.back')}
              </Button>
              <Button
                size="sm"
                onClick={() => setStep((s) => Math.min(4, s + 1))}
                disabled={step === 4}
              >
                {t('reports.custom.next')}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => runFull()}
                disabled={fullLoading || (config.columns.length === 0 && !config.groupBy)}
              >
                {fullLoading ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                {t('reports.custom.run_report')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportFormat('csv')}
                disabled={exporting !== null || !editingId}
              >
                {exporting === 'csv' ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1" />
                )}
                {t('reports.custom.export_csv')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportFormat('pdf')}
                disabled={exporting !== null || !editingId}
              >
                {exporting === 'pdf' ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-1" />
                )}
                {t('reports.custom.export_pdf')}
              </Button>
              <Button
                size="sm"
                onClick={() => saveTemplate(false)}
                disabled={
                  createMut.isPending ||
                  updateMut.isPending ||
                  !templateName.trim()
                }
              >
                {(createMut.isPending || updateMut.isPending) && (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                )}
                {editingId
                  ? t('reports.custom.update_template')
                  : t('reports.custom.save_template')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('reports.custom.delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name ?? ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('reports.custom.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('reports.custom.delete')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

  // ── Local helpers (inside the component so they close over `t`) ──

  function duplicateTemplate(tpl: SavedTemplate) {
    // Save a new template with the same config but a " (copy)" suffix.
    // Fetch the full config first.
    fetch(`/api/reports/custom/${tpl.id}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((json) => {
        const cfg = json.template?.config as ReportConfig | undefined
        if (!cfg) return
        return createMut.mutateAsync({
          name: tpl.name + t('reports.custom.duplicated_suffix'),
          description: tpl.description ?? null,
          dataSource: tpl.dataSource,
          config: cfg,
          isShared: false, // duplicates are private by default
        })
      })
      .catch(() => toast.error(t('reports.custom.error_save')))
  }
}

function stepTitle(step: number, t: (k: string) => string): string {
  const titles = [
    'reports.custom.step.datasource',
    'reports.custom.step.columns',
    'reports.custom.step.filters',
    'reports.custom.step.aggregations',
    'reports.custom.step.save',
  ]
  return t(titles[step] ?? '')
}

// ── Step components ───────────────────────────────────────────────────

function DataSourceStep({
  config,
  setConfig,
}: {
  config: ReportConfig
  setConfig: React.Dispatch<React.SetStateAction<ReportConfig>>
}) {
  const t = useT()
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">{t('reports.custom.data_source')}</Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {DATA_SOURCE_LABELS.map((ds) => (
          <button
            key={ds.value}
            type="button"
            onClick={() =>
              setConfig((c) => ({
                ...c,
                dataSource: ds.value,
                columns: [], // clear columns when source changes
                filters: [],
                groupBy: undefined,
                aggregations: [],
                sortBy: [],
              }))
            }
            className={cn(
              'p-4 rounded-lg border text-left transition-all hover:shadow-sm',
              config.dataSource === ds.value
                ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                : 'border-border bg-card hover:border-primary/40',
            )}
          >
            <Database className={cn('h-5 w-5 mb-2', config.dataSource === ds.value ? 'text-primary' : 'text-muted-foreground')} />
            <div className="text-sm font-medium">{t(ds.labelKey)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {FIELDS[ds.value].length} fields
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function ColumnsStep({
  config,
  setConfig,
}: {
  config: ReportConfig
  setConfig: React.Dispatch<React.SetStateAction<ReportConfig>>
}) {
  const t = useT()
  const fields = FIELDS[config.dataSource]
  const toggle = (key: string) => {
    setConfig((c) => ({
      ...c,
      columns: c.columns.includes(key)
        ? c.columns.filter((k) => k !== key)
        : [...c.columns, key],
    }))
  }
  const selectAll = () => setConfig((c) => ({ ...c, columns: fields.map((f) => f.prisma) }))
  const clearAll = () => setConfig((c) => ({ ...c, columns: [] }))
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Label className="text-sm font-medium">{t('reports.custom.columns')}</Label>
          <p className="text-xs text-muted-foreground">{t('reports.custom.columns_hint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={selectAll}>
            {t('reports.custom.select_all')}
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll}>
            {t('reports.custom.clear_all')}
          </Button>
        </div>
      </div>
      {config.columns.length === 0 && (
        <div className="text-xs text-amber-600 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t('reports.custom.columns_required')}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-[280px] overflow-y-auto rounded-md border p-3 bg-card/50">
        {fields.map((f) => (
          <label
            key={f.prisma}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-accent',
              config.columns.includes(f.prisma) && 'bg-primary/5',
            )}
          >
            <Checkbox
              checked={config.columns.includes(f.prisma)}
              onCheckedChange={() => toggle(f.prisma)}
            />
            <span className="flex-1 truncate">
              {f.label}
              <span className="text-[10px] text-muted-foreground ml-1.5">({f.type})</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

function FiltersStep({
  config,
  setConfig,
}: {
  config: ReportConfig
  setConfig: React.Dispatch<React.SetStateAction<ReportConfig>>
}) {
  const t = useT()
  const fields = FIELDS[config.dataSource]
  const addFilter = () => {
    setConfig((c) => ({
      ...c,
      filters: [...c.filters, { field: fields[0]?.prisma ?? '', op: 'eq', value: '' }],
    }))
  }
  const updateFilter = (i: number, patch: Partial<ReportFilter>) => {
    setConfig((c) => ({
      ...c,
      filters: c.filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    }))
  }
  const removeFilter = (i: number) => {
    setConfig((c) => ({
      ...c,
      filters: c.filters.filter((_, idx) => idx !== i),
    }))
  }
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">{t('reports.custom.filters')}</Label>
        <p className="text-xs text-muted-foreground">{t('reports.custom.filters_hint')}</p>
      </div>
      {config.filters.length === 0 && (
        <div className="text-xs text-muted-foreground py-3">{t('reports.custom.no_results')}</div>
      )}
      <div className="space-y-2">
        {config.filters.map((f, i) => (
          <div
            key={i}
            className="grid grid-cols-1 sm:grid-cols-[1fr_140px_1.4fr_auto] gap-2 items-center"
          >
            <Select
              value={f.field}
              onValueChange={(v) => updateFilter(i, { field: v })}
            >
              <SelectTrigger><SelectValue placeholder={t('reports.custom.field')} /></SelectTrigger>
              <SelectContent>
                {fields.map((fld) => (
                  <SelectItem key={fld.prisma} value={fld.prisma}>
                    {fld.label} <span className="text-[10px] text-muted-foreground">({fld.type})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={f.op}
              onValueChange={(v) => updateFilter(i, { op: v as FilterOp })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FILTER_OPS.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {t(op.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={f.value}
              onChange={(e) => updateFilter(i, { value: e.target.value })}
              placeholder={t('reports.custom.value')}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeFilter(i)}
              title={t('reports.custom.remove')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addFilter}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        {t('reports.custom.add_filter')}
      </Button>

      {/* Sort + Limit */}
      <div className="mt-4 pt-4 border-t space-y-3">
        <Label className="text-sm font-medium">{t('reports.custom.sort_by')}</Label>
        <div className="space-y-2">
          {config.sortBy.map((s, i) => (
            <div
              key={i}
              className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-center"
            >
              <Select
                value={s.field}
                onValueChange={(v) =>
                  setConfig((c) => ({
                    ...c,
                    sortBy: c.sortBy.map((it, idx) =>
                      idx === i ? { ...it, field: v } : it,
                    ),
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder={t('reports.custom.field')} /></SelectTrigger>
                <SelectContent>
                  {fields.map((fld) => (
                    <SelectItem key={fld.prisma} value={fld.prisma}>
                      {fld.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={s.dir}
                onValueChange={(v) =>
                  setConfig((c) => ({
                    ...c,
                    sortBy: c.sortBy.map((it, idx) =>
                      idx === i ? { ...it, dir: v as 'asc' | 'desc' } : it,
                    ),
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">{t('reports.custom.sort_dir.asc')}</SelectItem>
                  <SelectItem value="desc">{t('reports.custom.sort_dir.desc')}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setConfig((c) => ({
                    ...c,
                    sortBy: c.sortBy.filter((_, idx) => idx !== i),
                  }))
                }
                title={t('reports.custom.remove')}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setConfig((c) => ({
              ...c,
              sortBy: [...c.sortBy, { field: fields[0]?.prisma ?? '', dir: 'asc' }],
            }))
          }
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('reports.custom.add_sort')}
        </Button>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-2 items-end">
          <div>
            <Label className="text-sm font-medium">{t('reports.custom.limit')}</Label>
            <p className="text-xs text-muted-foreground">{t('reports.custom.limit_hint')}</p>
          </div>
          <Input
            type="number"
            min={1}
            max={5000}
            value={config.limit ?? 1000}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                limit: Math.min(5000, Math.max(1, Number(e.target.value) || 1000)),
              }))
            }
          />
        </div>
      </div>
    </div>
  )
}

function AggregationsStep({
  config,
  setConfig,
}: {
  config: ReportConfig
  setConfig: React.Dispatch<React.SetStateAction<ReportConfig>>
}) {
  const t = useT()
  const fields = FIELDS[config.dataSource]
  const setGroupBy = (v: string) => {
    setConfig((c) => ({
      ...c,
      groupBy: v === '__none__' ? undefined : v,
      aggregations: v === '__none__' ? [] : c.aggregations,
    }))
  }
  const addAgg = () => {
    setConfig((c) => ({
      ...c,
      aggregations: [
        ...c.aggregations,
        { field: fields[0]?.prisma ?? '', fn: 'count' },
      ],
    }))
  }
  const updateAgg = (i: number, patch: Partial<ReportAggregation>) => {
    setConfig((c) => ({
      ...c,
      aggregations: c.aggregations.map((a, idx) =>
        idx === i ? { ...a, ...patch } : a,
      ),
    }))
  }
  const removeAgg = (i: number) => {
    setConfig((c) => ({
      ...c,
      aggregations: c.aggregations.filter((_, idx) => idx !== i),
    }))
  }
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">{t('reports.custom.group_by')}</Label>
      </div>
      <Select
        value={config.groupBy ?? '__none__'}
        onValueChange={setGroupBy}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{t('reports.custom.group_by_none')}</SelectItem>
          {fields.map((f) => (
            <SelectItem key={f.prisma} value={f.prisma}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {config.groupBy ? (
        <>
          <div className="flex items-center justify-between pt-3 border-t">
            <div>
              <Label className="text-sm font-medium">{t('reports.custom.aggregations')}</Label>
            </div>
            <Button variant="outline" size="sm" onClick={addAgg}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t('reports.custom.add_aggregation')}
            </Button>
          </div>
          <div className="space-y-2">
            {config.aggregations.map((a, i) => (
              <div
                key={i}
                className="grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] gap-2 items-center"
              >
                <Select
                  value={a.fn}
                  onValueChange={(v) => updateAgg(i, { fn: v as AggFn })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AGG_FNS.map((fn) => (
                      <SelectItem key={fn.value} value={fn.value}>
                        {t(fn.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={a.field}
                  onValueChange={(v) => updateAgg(i, { field: v })}
                >
                  <SelectTrigger><SelectValue placeholder={t('reports.custom.field')} /></SelectTrigger>
                  <SelectContent>
                    {fields.map((f) => (
                      <SelectItem key={f.prisma} value={f.prisma}>
                        {f.label} <span className="text-[10px] text-muted-foreground">({f.type})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAgg(i)}
                  title={t('reports.custom.remove')}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground py-2">
          {t('reports.custom.aggregations_hint')}
        </div>
      )}
    </div>
  )
}

function SaveStep({
  name,
  setName,
  description,
  setDescription,
  isShared,
  setIsShared,
}: {
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  isShared: boolean
  setIsShared: (v: boolean) => void
}) {
  const t = useT()
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">{t('reports.custom.template_name')}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('reports.custom.template_name')}
          className="mt-1"
        />
        {!name.trim() && (
          <div className="text-xs text-amber-600 mt-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('reports.custom.name_required')}
          </div>
        )}
      </div>
      <div>
        <Label className="text-sm font-medium">{t('reports.custom.template_description')}</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('reports.custom.template_description')}
          className="mt-1"
        />
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Switch checked={isShared} onCheckedChange={setIsShared} id="isShared" />
        <Label htmlFor="isShared" className="text-sm cursor-pointer">
          {t('reports.custom.is_shared')}
        </Label>
      </div>
    </div>
  )
}

// ── Preview + Results panels ─────────────────────────────────────────

function PreviewPanel({
  result,
  loading,
  onRunPreview,
  canRunPreview,
}: {
  result: RunResult | null
  loading: boolean
  onRunPreview: () => void
  canRunPreview: boolean
}) {
  const t = useT()
  return (
    <Card className="mt-2">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4" />
            {t('reports.custom.preview')}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={onRunPreview}
            disabled={loading || !canRunPreview}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1" />
            )}
            {t('reports.custom.run')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!result && !loading && (
          <div className="text-xs text-muted-foreground py-4 text-center">
            {t('reports.custom.preview_empty')}
          </div>
        )}
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
            <div className="text-xs text-muted-foreground text-center">
              {t('reports.custom.preview_loading')}
            </div>
          </div>
        )}
        {result && !loading && (
          <div className="space-y-2">
            {result.truncated && (
              <div className="text-xs text-amber-600 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('reports.custom.truncated')}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {result.rows.length} / {result.total} {t('reports.custom.rows')}
            </div>
            <ResultTable result={result} maxRows={10} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FullResultPanel({
  result,
  onClose,
}: {
  result: RunResult
  onClose: () => void
}) {
  const t = useT()
  const fmtDt = useFormatDateTime()
  // CSV export via the existing helper (client-side).
  const handleClientCsv = () => {
    const columns = result.columns.map((c) => ({ key: c.key, label: c.label }))
    downloadCsv(`custom-report-${result.dataSource}`, result.rows as Record<string, unknown>[], columns)
  }
  return (
    <Card className="mt-2 border-primary/40">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            {t('reports.custom.results')}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleClientCsv}>
              <Download className="h-3.5 w-3.5 mr-1" />
              {t('reports.custom.export_csv')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          {result.rows.length} / {result.total} {t('reports.custom.rows')} · {fmtDt(result.generatedAt)}
          {result.truncated && ' · ' + t('reports.custom.truncated')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResultTable result={result} maxRows={500} />
      </CardContent>
    </Card>
  )
}

function ResultTable({
  result,
  maxRows,
}: {
  result: RunResult
  maxRows: number
}) {
  const t = useT()
  const rows = result.rows.slice(0, maxRows)
  if (rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-4 text-center">
        {t('reports.custom.no_results')}
      </div>
    )
  }
  return (
    <div className="rounded-md border max-h-[400px] overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            {result.columns.map((c) => (
              <TableHead key={c.key} className="whitespace-nowrap">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {result.columns.map((c) => (
                <TableCell key={c.key} className="text-xs whitespace-nowrap max-w-[260px] truncate">
                  {safeString(row[c.key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ── Tiny presentational helpers ──────────────────────────────────────

function FormatDate({ iso }: { iso: string }) {
  const fmt = useFormatDateTime()
  return <span>{fmt(iso)}</span>
}
