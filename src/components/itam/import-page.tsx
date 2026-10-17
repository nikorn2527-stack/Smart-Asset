'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Upload,
  Download,
  File,
  CheckCircle,
  AlertCircle,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Database,
  History,
  HelpCircle,
} from 'lucide-react'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { useT, useFormatDateTime } from '@/store/i18n-store'
import { ManualSyncPreviewSection } from './manual-sync-preview-section'

// ============================================================
// item 3: Import data — Upload CSV by Type
// ============================================================

type JobType = 'device' | 'work-order' | 'stock' | 'meter-reading' | 'accessory'

interface ImportTypeDef {
  id: JobType
  icon: string
  // i18n keys for the card title + description.
  titleKey: string
  descKey: string
  headers: { key: string; label: string }[]
  sample: Record<string, string>
}

const IMPORT_TYPES: ImportTypeDef[] = [
  {
    id: 'device',
    icon: '💻',
    titleKey: 'jobtype.device',
    descKey: 'import.type_desc.device',
    headers: [
      { key: 'assetcode', label: 'assetcode' },
      { key: 'name', label: 'name' },
      { key: 'brand', label: 'brand' },
      { key: 'model', label: 'model' },
      { key: 'type', label: 'type' },
      { key: 'serialNumber', label: 'serialNumber' },
      { key: 'status', label: 'status' },
      { key: 'site', label: 'site' },
      { key: 'department', label: 'department' },
      { key: 'location', label: 'location' },
      { key: 'purchaseDate', label: 'purchaseDate' },
      { key: 'warrantyMonths', label: 'warrantyMonths' },
    ],
    sample: {
      assetcode: 'IT-PRT-001',
      name: 'HP LaserJet Printer',
      brand: 'HP',
      model: 'LaserJet Pro M404',
      type: 'PRINTER',
      serialNumber: 'SN12345',
      status: 'active',
      site: 'HQ',
      department: 'IT',
      location: 'Server room',
      purchaseDate: '2025-01-01',
      warrantyMonths: '12',
    },
  },
  {
    id: 'work-order',
    icon: '🔧',
    titleKey: 'jobtype.work-order',
    descKey: 'import.type_desc.work_order',
    headers: [
      { key: 'subject', label: 'subject' },
      { key: 'building', label: 'building' },
      { key: 'location', label: 'location' },
      { key: 'details', label: 'details' },
      { key: 'priority', label: 'priority' },
      { key: 'reporterName', label: 'reporterName' },
      { key: 'tel', label: 'tel' },
    ],
    sample: {
      subject: 'Printer not working',
      building: 'Building A',
      location: 'Floor 3 Room 301',
      details: "Printer won't turn on",
      priority: 'Normal',
      reporterName: 'John',
      tel: '0812345678',
    },
  },
  {
    id: 'stock',
    icon: '📦',
    titleKey: 'jobtype.stock',
    descKey: 'import.type_desc.stock',
    headers: [
      { key: 'productcode', label: 'productcode' },
      { key: 'productName', label: 'productName' },
      { key: 'category', label: 'category' },
      { key: 'brand', label: 'brand' },
      { key: 'unit', label: 'unit' },
      { key: 'quantity', label: 'quantity' },
      { key: 'minQuantity', label: 'minQuantity' },
      { key: 'unitCost', label: 'unitCost' },
      { key: 'location', label: 'location' },
    ],
    sample: {
      productcode: 'STK-0001',
      productName: 'HP Black Ink',
      category: 'Ink',
      brand: 'HP',
      unit: 'pcs',
      quantity: '10',
      minQuantity: '5',
      unitCost: '1200',
      location: 'Floor 2 Cabinet A',
    },
  },
  {
    id: 'meter-reading',
    icon: '📊',
    titleKey: 'jobtype.meter-reading',
    descKey: 'import.type_desc.meter_reading',
    headers: [
      { key: 'assetcode', label: 'assetcode' },
      { key: 'readingDate', label: 'readingDate' },
      { key: 'meterBw', label: 'meterBw' },
      { key: 'meterColor', label: 'meterColor' },
      { key: 'readBy', label: 'readBy' },
      { key: 'remark', label: 'remark' },
    ],
    sample: {
      assetcode: 'IT-PRT-001',
      readingDate: '2025-01-31',
      meterBw: '15000',
      meterColor: '3200',
      readBy: 'Somsak',
      remark: '',
    },
  },
  {
    // ── Task ID: INLINE-ACCESSORY-IN-DEVICE-FORM (Part B) ──
    // Endpoint: POST /api/devices/accessories/import (NOT /api/import)
    // Response shape: { data: { total, created, updated, skipped, errors, jobId } }
    // (different from /api/import which returns { job: ImportJob }).
    id: 'accessory',
    icon: '🔌',
    titleKey: 'jobtype.accessory',
    descKey: 'import.type_desc.accessory',
    headers: [
      { key: 'parent_asset_code', label: 'parent_asset_code' },
      { key: 'accessory_type', label: 'accessory_type' },
      { key: 'brand', label: 'brand' },
      { key: 'model', label: 'model' },
      { key: 'serial_number', label: 'serial_number' },
      { key: 'status', label: 'status' },
      { key: 'installed_date', label: 'installed_date' },
      { key: 'remark', label: 'remark' },
    ],
    sample: {
      parent_asset_code: 'IT-00001',
      accessory_type: 'KEYBOARD',
      brand: 'Logitech',
      model: 'K380',
      serial_number: 'LOG-001',
      status: 'Active',
      installed_date: '2024-01-15',
      remark: 'Wireless keyboard',
    },
  },
]

interface ImportJob {
  id: string
  jobType: string
  fileName: string
  fileType: string
  status: string
  totalRows: number
  processedRows: number
  errorRows: number
  errors: string | null
  uploadedBy: string | null
  createdAt: string
  completedAt: string | null
}

interface ImportError {
  row: number
  message: string
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

// formatDateTime now comes from the i18n store (useFormatDateTime hook)
// so dates flip between Buddhist Era / Thai months and Gregorian / English months when the
// user toggles the global TH/EN language.

function jobTypeLabel(jobType: string): string {
  switch (jobType) {
    case 'device':
      return 'Device'
    case 'work-order':
      return 'Work Order'
    case 'stock':
      return 'Stock'
    case 'meter-reading':
      return 'Meter'
    case 'master-data':
      return 'Master data'
    case 'accessory':
      return 'Accessory'
    default:
      // Legacy import types are stored as "legacy:{sheetId}"
      if (jobType.startsWith('legacy:')) {
        const sheetId = jobType.slice(7)
        const labels: Record<string, string> = {
          'itam-device': 'Legacy: Devices',
          'itam-meter': 'Legacy: Meter',
          'itam-transfer': 'Legacy: Transfer',
          'itam-users': 'Legacy: Users',
          'itam-settings': 'Legacy: Settings',
          'itam-master': 'Legacy: Master',
          'itam-sites': 'Legacy: Site',
          'stock-products': 'Legacy: Products',
          'stock-in': 'Legacy: Stock In',
          'stock-out': 'Legacy: Stock Out',
          'stock-po': 'Legacy: Purchase Orders',
          'services-workorders': 'Legacy: Work Orders',
        }
        return labels[sheetId] ?? jobType
      }
      return jobType
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    completed: {
      label: 'Success',
      cls: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
      icon: <CheckCircle className="mr-1 h-3 w-3" />,
    },
    failed: {
      label: 'Failed',
      cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
      icon: <AlertCircle className="mr-1 h-3 w-3" />,
    },
    processing: {
      label: 'Processing',
      cls: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
      icon: <Loader2 className="mr-1 h-3 w-3 animate-spin" />,
    },
    pending: {
      label: 'Pending',
      cls: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
      icon: <Loader2 className="mr-1 h-3 w-3" />,
    },
  }
  const cfg = map[status] ?? {
    label: status,
    cls: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    icon: null,
  }
  return (
    <Badge className={cn('inline-flex items-center text-xs', cfg.cls)}>
      {cfg.icon}
      {cfg.label}
    </Badge>
  )
}

export function ImportPage() {
  const qc = useQueryClient()
  // Default to 'device' so the upload area renders immediately on first
  // load. Previously defaulted to null which hid the primary action (Upload)
  // until the user picked a type — the reported Critical UX issue.
  const [selectedType, setSelectedType] = React.useState<JobType>('device')
  const [file, setFile] = React.useState<File | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const [errorDialog, setErrorDialog] = React.useState<ImportJob | null>(null)
  // History + Instructions are SECONDARY actions (used rarely). They no
  // longer eat vertical space in the main flow — they're tucked into a
  // small icon button in the header that opens a slide-in Sheet. The
  // PRIMARY action (upload) gets the full viewport.
  // History auto-opens on successful upload so the user sees the result.
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [instructionsOpen, setInstructionsOpen] = React.useState(false)
  // Language comes from the global i18n store (shared with sidebar) — the
  // old per-page TH/EN toggle was removed because the app now has a single
  // global toggle in the sidebar.
  const t = useT()
  const formatDateTime = useFormatDateTime()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const uploadCardRef = React.useRef<HTMLDivElement>(null)

  // Auto-scroll the upload card into view when the user picks a type —
  // ensures the primary action (drop zone + Upload button) is visible on
  // mobile without the user having to hunt for it.
  React.useEffect(() => {
    if (selectedType && uploadCardRef.current) {
      uploadCardRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [selectedType])

  // ---- History list ----
  const {
    data: jobs,
    isLoading: jobsLoading,
    refetch: refetchJobs,
    isFetching: jobsFetching,
  } = useQuery<ImportJob[]>({
    queryKey: ['import-jobs'],
    queryFn: async () => {
      const res = await fetch('/api/import?limit=50')
      if (!res.ok) throw new Error('Failed to load history')
      const j = await res.json()
      return (j.jobs ?? []) as ImportJob[]
    },
    staleTime: 15_000,
  })

  // ---- Upload mutation ----
  // Routes to TWO different endpoints based on jobType:
  //   • device | work-order | stock | meter-reading → POST /api/import
  //     (response: { job: ImportJob })
  //   • accessory → POST /api/devices/accessories/import
  //     (response: { data: { total, created, updated, skipped, errors, jobId } })
  //     — synthesised into an ImportJob shape so the rest of the UI
  //       (history table, error dialog) keeps working without forking.
  const uploadMutation = useMutation({
    mutationFn: async (vars: { file: File; jobType: JobType }) => {
      const fd = new FormData()
      fd.append('file', vars.file)
      if (vars.jobType === 'accessory') {
        // Accessory endpoint — different response shape, see route.ts.
        const res = await fetch('/api/devices/accessories/import', {
          method: 'POST',
          body: fd,
        })
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json?.error ?? 'UploadnotSuccess')
        }
        const data = json.data as {
          total: number
          created: number
          updated: number
          skipped: number
          errors: ImportError[]
          jobId: string
        }
        // Synthesise an ImportJob so the existing UI (history table +
        // error dialog) keeps working. The accessory endpoint doesn't
        // return the full ImportJob record, just a jobId + counts.
        const synth: ImportJob = {
          id: data.jobId,
          jobType: 'accessory',
          fileName: vars.file.name,
          fileType: 'csv',
          status: 'completed',
          totalRows: data.total,
          processedRows: data.created + data.updated,
          errorRows: data.skipped + data.errors.length,
          errors:
            data.errors.length > 0
              ? JSON.stringify(data.errors.slice(0, 200))
              : null,
          uploadedBy: null,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }
        return synth
      }
      // Default: device / work-order / stock / meter-reading
      fd.append('jobType', vars.jobType)
      // ── CONSULTING-007 Phase B (partial) ──────────────────────────
      // The device path stays on `/api/import` for now (rather than
      // migrating to `/api/itam/devices/import`) for two reasons:
      //   1. This page's history table relies on `ImportJob` records
      //      that `/api/import` creates. The `/api/itam/devices/import`
      //      endpoint does NOT create an `ImportJob` row — it only
      //      writes a `logAudit` entry — so switching would silently
      //      drop device imports from the history panel.
      //   2. The contract at `src/lib/device-import-contract.ts` is
      //      now a true superset of `/api/import`'s 12 device columns
      //      (added `name` + `warrantyMonths` as part of this task),
      //      BUT it still lacks `purchasePrice`, `parentDeviceId`,
      //      `setLabel`, `setPosition`, etc. — migrating this path
      //      would lose those capabilities.
      // The Phase A fix already wrapped `/api/import` device writes in
      // `db.$transaction` (batched at 100 rows/batch), so this path is
      // already transaction-safe. Phase B here is consolidation, not a
      // safety fix. See worklog CONSULTING-007-IMPORT-TEMPLATES.
      const res = await fetch('/api/import', {
        method: 'POST',
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error ?? 'UploadnotSuccess')
      }
      return json.job as ImportJob
    },
    onSuccess: (job) => {
      toast.success(
        `Imported ${jobTypeLabel(job.jobType)} ${job.processedRows}/${job.totalRows} rows`,
      )
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      // Auto-open the history Sheet so the user immediately sees the
      // result of their upload (processed/error counts) without hunting.
      setHistoryOpen(true)
      qc.invalidateQueries({ queryKey: ['import-jobs'] })
      // Also invalidate the per-type data so other pages refresh.
      if (job.jobType === 'device') {
        qc.invalidateQueries({ queryKey: ['devices'] })
      } else if (job.jobType === 'work-order') {
        qc.invalidateQueries({ queryKey: ['work-orders'] })
      } else if (job.jobType === 'stock') {
        qc.invalidateQueries({ queryKey: ['stock-items'] })
      } else if (job.jobType === 'meter-reading') {
        qc.invalidateQueries({ queryKey: ['meter'] })
      } else if (job.jobType === 'accessory') {
        // Accessories live under a device — invalidate the devices list +
        // any open device-detail-sheet so the new rows show up.
        qc.invalidateQueries({ queryKey: ['devices'] })
        qc.invalidateQueries({ queryKey: ['device-accessories'] })
      }
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e: Error) => {
      toast.error(e.message)
      qc.invalidateQueries({ queryKey: ['import-jobs'] })
    },
  })

  const selectedTypeDef = React.useMemo(
    () => IMPORT_TYPES.find((t) => t.id === selectedType) ?? null,
    [selectedType],
  )

  function handleFile(f: File) {
    const lower = f.name.toLowerCase()
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      toast.error('Please use CSV format (.xlsx not supported)')
      return
    }
    if (!lower.endsWith('.csv') && !lower.endsWith('.txt')) {
      toast.error('Only .csv files supported')
      return
    }
    setFile(f)
  }

  function onPickFile() {
    inputRef.current?.click()
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
  }

  function onUpload() {
    if (!file || !selectedType) return
    uploadMutation.mutate({ file, jobType: selectedType })
  }

  function onDownloadTemplate() {
    if (!selectedTypeDef) return
    const fname = `${selectedTypeDef.id}-template.csv`
    downloadCsv(fname, [selectedTypeDef.sample], selectedTypeDef.headers)
    toast.success(`Download template ${fname}`)
  }

  function parseErrors(job: ImportJob): ImportError[] {
    if (!job.errors) return []
    try {
      const arr = JSON.parse(job.errors)
      return Array.isArray(arr) ? (arr as ImportError[]) : []
    } catch {
      return []
    }
  }

  return (
    <div className="flex h-full flex-col bg-slate-50 px-3 py-3 dark:bg-slate-950 sm:px-4 lg:px-5">
      <div className="flex h-full w-full flex-col gap-3">
        {/* Header: title (primary) + 2 small icon buttons for SECONDARY
            actions (history, instructions). The TH/EN language toggle
            is now global — it lives in the sidebar (next to the theme
            toggle), so we don't repeat it here. */}
        <div className="flex flex-shrink-0 items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100 md:text-xl">
            <span aria-hidden>📥</span>
            {t('import.title')}
          </h1>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen(true)}
              className="relative border-slate-300 dark:border-slate-700"
              aria-label={t('import.history')}
            >
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">{t('import.history')}</span>
              {jobs && jobs.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 h-4 min-w-4 px-1 text-[10px] tabular-nums"
                >
                  {jobs.length}
                </Badge>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setInstructionsOpen(true)}
              className="border-slate-300 dark:border-slate-700"
              aria-label={t('import.instructions')}
            >
              <HelpCircle className="h-4 w-4" />
              <span className="hidden sm:inline">{t('import.instructions')}</span>
            </Button>
          </div>
        </div>

        {/* ─── Primary content: upload area (gets the FULL viewport) ─── */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {/* Import type selector */}
        <div>
          {/* Removed h2 heading "1. selectTypedata" — the cards are self-explanatory */}
          {/* On mobile: horizontal scrollable row of compact cards so the
              upload area below stays in the viewport. On sm+: 2-4 col grid. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {IMPORT_TYPES.map((def) => {
              const active = selectedType === def.id
              return (
                <button
                  key={def.id}
                  type="button"
                  onClick={() => {
                    setSelectedType(def.id)
                    setFile(null)
                    if (inputRef.current) inputRef.current.value = ''
                  }}
                  className={cn(
                    'group relative flex min-w-0 flex-col items-start gap-0.5 rounded-lg border-2 p-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
                    active
                      ? 'border-[#f97316] bg-[#f97316]/5 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-[#f97316]/40 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-[#fb923c]/40 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="text-xl sm:text-2xl" aria-hidden>
                    {def.icon}
                  </span>
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 sm:text-sm">
                    {t(def.titleKey)}
                  </span>
                  <span className="hidden text-[10px] text-slate-500 dark:text-slate-400 sm:block">
                    {t(def.descKey)}
                  </span>
                  {active && (
                    <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#f97316] text-white">
                      <CheckCircle className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Upload area + template */}
        {selectedTypeDef && (
          <motion.div
            ref={uploadCardRef}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="border-slate-200 dark:border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                  <span aria-hidden>{selectedTypeDef.icon}</span>
                  {t('import.upload_file')} — {t(selectedTypeDef.titleKey)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Drop zone */}
                <div
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  role="button"
                  tabIndex={0}
                  onClick={onPickFile}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onPickFile()
                    }
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
                    dragOver
                      ? 'border-[#f97316] bg-[#f97316]/5'
                      : 'border-slate-300 bg-slate-50 hover:border-[#f97316] hover:bg-[#f97316]/5 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-[#fb923c]',
                  )}
                >
                  <Upload className="h-6 w-6 text-slate-400 dark:text-slate-500" />
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {file ? (
                        <span className="inline-flex items-center gap-2">
                          <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          {file.name}
                          <Badge className="ml-1 border-slate-200 bg-slate-100 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {formatBytes(file.size)}
                          </Badge>
                        </span>
                      ) : (
                        t('import.drop_file')
                      )}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">
                      {t('import.csv_only')}
                    </div>
                  </div>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,text/csv,.txt"
                    className="hidden"
                    onChange={onInputChange}
                  />
                </div>

                {/* Action buttons — Upload is the primary CTA: full-width on
                    mobile (order-last) so it's the obvious action; auto-
                    width right-aligned on sm+. */}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onPickFile}
                    className="border-slate-300 dark:border-slate-700"
                  >
                    <File className="mr-1.5 h-4 w-4" />
                    {t('import.select_file')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onDownloadTemplate}
                    className="border-slate-300 dark:border-slate-700"
                  >
                    <Download className="mr-1.5 h-4 w-4" />
                    {t('import.download_template')}
                  </Button>
                  <Button
                    type="button"
                    onClick={onUpload}
                    disabled={!file || uploadMutation.isPending}
                    className="order-last w-full bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950 sm:order-none sm:ml-auto sm:w-auto"
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        {t('import.uploading')}
                      </>
                    ) : (
                      <>
                        <Upload className="mr-1.5 h-4 w-4" />
                        {t('import.upload')}
                      </>
                    )}
                  </Button>
                </div>

                {/* Template columns preview */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                  <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t('import.required_columns')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedTypeDef.headers.map((h) => (
                      <Badge
                        key={h.key}
                        variant="outline"
                        className="font-mono text-[11px] text-slate-600 dark:text-slate-300"
                      >
                        {h.label}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Sample row preview — shows how to fill in each field.
                    Uses slightly darker text than the headers above so the
                    values are readable (the old single-row preview was too
                    light to read at a glance), but still lighter than the
                    primary upload UI so it doesn't compete with the main
                    action. */}
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t('import.sample_preview')}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <tbody>
                        {selectedTypeDef.headers.map((h, idx) => {
                          const value = selectedTypeDef.sample[h.key] ?? ''
                          return (
                            <tr
                              key={h.key}
                              className={cn(
                                idx > 0 && 'border-t border-slate-100 dark:border-slate-800',
                              )}
                            >
                              <td className="py-1 pr-3 align-top font-mono text-[11px] font-medium text-slate-600 dark:text-slate-300">
                                {h.label}
                              </td>
                              <td className="py-1 align-top text-slate-800 dark:text-slate-100">
                                {value || <span className="text-slate-400">{t('import.empty_value')}</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
        </div>

        {/* ─── History Sheet (slide-in from right) ───
            Replaces the old Collapsible panel that ate vertical space. */}
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl md:max-w-3xl">
            <SheetHeader className="flex flex-row items-center justify-between gap-2 border-b border-slate-100 p-4 dark:border-slate-800">
              <SheetTitle className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100">
                <History className="h-4 w-4 text-[#f97316]" />
                {t('import.history')}
                {jobs && jobs.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {jobs.length}
                  </Badge>
                )}
              </SheetTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refetchJobs()}
                disabled={jobsFetching}
                className="border-slate-300 dark:border-slate-700"
              >
                <RefreshCw
                  className={cn(
                    'mr-1.5 h-3.5 w-3.5',
                    jobsFetching && 'animate-spin',
                  )}
                />
                <span className="hidden sm:inline">{t('common.refresh')}</span>
              </Button>
            </SheetHeader>
          <CardContent className="flex-1 overflow-y-auto p-4">
            {jobsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !jobs || jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <FileSpreadsheet className="h-10 w-10 text-slate-300 dark:text-slate-400" />
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  {t('import.no_history')}
                </p>
              </div>
            ) : (
              <div className="itam-scroll max-h-[28rem] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                    <TableRow>
                      <TableHead className="w-32">{t('import.col_type')}</TableHead>
                      <TableHead>{t('import.col_filename')}</TableHead>
                      <TableHead className="w-28">{t('import.col_status')}</TableHead>
                      <TableHead className="w-20 text-right">{t('import.col_total')}</TableHead>
                      <TableHead className="w-20 text-right">{t('import.col_success')}</TableHead>
                      <TableHead className="w-20 text-right">{t('import.col_errors')}</TableHead>
                      <TableHead className="w-40">{t('import.col_date')}</TableHead>
                      <TableHead className="w-16 text-center">{t('import.col_detail')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => {
                      const errs = parseErrors(job)
                      const hasErrs = errs.length > 0
                      return (
                        <TableRow
                          key={job.id}
                          className={cn(
                            'cursor-pointer',
                            hasErrs
                              ? 'hover:bg-amber-50 dark:hover:bg-amber-950/30'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                          )}
                          onClick={() => hasErrs && setErrorDialog(job)}
                        >
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="text-xs text-slate-600 dark:text-slate-300"
                            >
                              {jobTypeLabel(job.jobType)}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[240px] truncate font-mono text-xs">
                            {job.fileName}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={job.status} />
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {job.totalRows}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
                            {job.processedRows}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-red-600 dark:text-red-400">
                            {job.errorRows}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500 dark:text-slate-400">
                            {formatDateTime(job.createdAt)}
                          </TableCell>
                          <TableCell className="text-center">
                            {hasErrs ? (
                              <button
                                type="button"
                                aria-label="View error details"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-950/50"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setErrorDialog(job)
                                }}
                              >
                                <AlertCircle className="h-4 w-4" />
                              </button>
                            ) : job.status === 'completed' ? (
                              <CheckCircle className="mx-auto h-4 w-4 text-emerald-500" />
                            ) : (
                              <span className="text-slate-300 dark:text-slate-400">
                                —
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </SheetContent>
        </Sheet>

        {/* ─── Instructions Sheet (slide-in from right) ───
            Replaces the old Collapsible panel. Rarely used, so tucked
            away behind a header icon button. */}
        <Sheet open={instructionsOpen} onOpenChange={setInstructionsOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-2xl">
            <SheetHeader className="border-b border-slate-100 p-4 dark:border-slate-800">
              <SheetTitle className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100">
                <HelpCircle className="h-4 w-4 text-[#f97316]" />
                {t('import.instructions')}
              </SheetTitle>
            </SheetHeader>
              <CardContent className="flex-1 space-y-4 overflow-y-auto p-4">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    วิธีใช้งาน
                  </h3>
                  <ol className="ml-4 list-decimal space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                    <li>เลือกประเภทข้อมูลที่ต้องการนำเข้า (อุปกรณ์ / ใบสั่งงาน / สต๊อก / มิเตอร์ / อุปกรณ์เสริม)</li>
                    <li>คลิก &quot;ดาวน์โหลดเทมเพลต&quot; เพื่อรับไฟล์ CSV ตัวอย่างที่มีหัวคอลัมน์ที่ถูกต้อง</li>
                    <li>เปิดเทมเพลตใน Excel หรือโปรแกรมแก้ไข CSV แล้วกรอกข้อมูลในแต่ละแถว</li>
                    <li>บันทึกไฟล์เป็น CSV (UTF-8) — หากใช้ Excel ให้เลือก &quot;CSV UTF-8 (Comma delimited)&quot;</li>
                    <li>ลากไฟล์มาวางในพื้นที่อัปโหลด หรือคลิก &quot;เลือกไฟล์&quot;</li>
                    <li>คลิก &quot;อัปโหลด&quot; — ระบบจะตรวจสอบและนำเข้าข้อมูลทันที</li>
                    <li>ดูผลลัพธ์ในตาราง &quot;ประวัตินำเข้า&quot; — คลิกแถวที่มีข้อผิดพลาดเพื่อดูรายละเอียด</li>
                  </ol>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    รูปแบบไฟล์ที่รองรับ
                  </h3>
                  <ul className="ml-4 list-disc space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    <li>
                      <strong>CSV (UTF-8)</strong> — แนะนำ รองรับภาษาไทย
                    </li>
                    <li>
                      <strong>Excel (.xlsx)</strong> — ยังไม่รองรับ กรุณาบันทึกเป็น CSV ก่อนอัปโหลด
                    </li>
                    <li>ตัวคั่นคอลัมน์: จุลภาค (,) หรือเซมิโคลอน (;)</li>
                    <li>แถวแรกต้องเป็น header ที่ตรงกับเทมเพลต</li>
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    หัวคอลัมน์ที่จำเป็น (ต้องตรงกับเทมเพลต)
                  </h3>
                  <div className="space-y-2">
                    {IMPORT_TYPES.map((def) => (
                      <div
                        key={def.id}
                        className="rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-800/50"
                      >
                        <div className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {def.icon} {t(def.titleKey)} ({def.id})
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {def.headers.map((h) => (
                            <Badge
                              key={h.key}
                              variant="outline"
                              className="font-mono text-[10px] text-slate-600 dark:text-slate-300"
                            >
                              {h.label}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <strong>⚠️ ข้อควรระวัง:</strong> ระบบจะข้ามแถวที่มีรหัสซ้ำ
                  — แนะนำให้ดาวน์โหลดเทมเพลตและตรวจสอบหัวคอลัมน์ก่อนนำเข้าทุกครั้ง
                </div>
              </CardContent>
        </SheetContent>
        </Sheet>
      </div>

      {/* Error detail dialog */}
      <Dialog
        open={!!errorDialog}
        onOpenChange={(o) => !o && setErrorDialog(null)}
      >
        <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              {t('import.error_detail_title')}
            </DialogTitle>
            <DialogDescription>
              {errorDialog && (
                <>
                  ไฟล์: <span className="font-mono">{errorDialog.fileName}</span>
                  {' — '}
                  {jobTypeLabel(errorDialog.jobType)}
                  {' — '}
                  พบข้อผิดพลาด {errorDialog.errorRows} / {errorDialog.totalRows} แถว
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {errorDialog && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-center dark:border-slate-800 dark:bg-slate-800/50">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Total
                  </div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
                    {errorDialog.totalRows}
                  </div>
                </div>
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-center dark:border-emerald-800 dark:bg-emerald-950/30">
                  <div className="text-xs text-emerald-700 dark:text-emerald-400">
                    Success
                  </div>
                  <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                    {errorDialog.processedRows}
                  </div>
                </div>
                <div className="rounded-md border border-red-200 bg-red-50 p-2 text-center dark:border-red-800 dark:bg-red-950/30">
                  <div className="text-xs text-red-700 dark:text-red-400">
                    Errors
                  </div>
                  <div className="text-lg font-bold text-red-700 dark:text-red-400">
                    {errorDialog.errorRows}
                  </div>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                    <TableRow>
                      <TableHead className="w-20">Row</TableHead>
                      <TableHead>message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parseErrors(errorDialog).length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={2}
                          className="py-6 text-center text-sm text-slate-400 dark:text-slate-500"
                        >
                          nothasError Details
                        </TableCell>
                      </TableRow>
                    ) : (
                      parseErrors(errorDialog).map((err, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs text-slate-500 dark:text-slate-400">
                            {err.row === 0 ? '—' : err.row}
                          </TableCell>
                          <TableCell className="text-sm text-slate-700 dark:text-slate-300">
                            {err.message}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
