'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
  ChevronDown,
  ChevronRight,
  Info,
  Database,
  ArrowRight,
} from 'lucide-react'
import {
  SOURCE_SHEET_REGISTRY,
  FIELD_MAPPINGS,
  TEMPLATE_HEADERS,
  type AppsScriptSource,
} from '@/lib/csv-field-mapping'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

// ============================================================
// นำเข้าจากระบบเก่า (Apps Script) — ดึง CSV จาก 3 แอปเดิม
// ============================================================

interface LegacyImportResult {
  job: {
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
  summary?: {
    source: string
    sheetId: string
    sheetLabel: string
    model: string
    totalRows: number
    processedRows: number
    errorRows: number
    warnings: string[]
    unmappedColumns: string[]
    expectedHeaders: readonly string[]
    actualHeaders: string[]
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function getSourceMeta(source: AppsScriptSource) {
  return SOURCE_SHEET_REGISTRY[source]
}

// Build a CSV template that matches the legacy sheet headers EXACTLY.
// One empty row is added so the file isn't 0-byte and Excel opens it.
function downloadLegacyTemplate(sheetId: string) {
  const headers = TEMPLATE_HEADERS[sheetId as keyof typeof TEMPLATE_HEADERS]
  if (!headers) {
    toast.error(`ไม่พบ template สำหรับ ${sheetId}`)
    return
  }
  // Build an empty sample row using the headers
  const sample: Record<string, string> = {}
  headers.forEach((h) => {
    sample[h] = ''
  })
  const fname = `${sheetId}-template.csv`
  downloadCsv(
    fname,
    [sample],
    headers.map((h) => ({ key: h, label: h })),
  )
  toast.success(`ดาวน์โหลดเทมเพลต ${fname}`)
}

// Show the mapping for a sheet — pairs (csvHeader → prismaField) for clarity
function getMappingPreview(sheetId: string): Array<{ csv: string; prisma: string }> {
  const headers = TEMPLATE_HEADERS[sheetId as keyof typeof TEMPLATE_HEADERS]
  if (!headers) return []
  // Find the mapping name by reverse-looking-up the SOURCE_SHEET_REGISTRY
  let mappingName: keyof typeof FIELD_MAPPINGS | null = null
  for (const src of Object.values(SOURCE_SHEET_REGISTRY)) {
    const found = src.sheets.find((s) => s.id === sheetId)
    if (found) {
      mappingName = found.mapping as keyof typeof FIELD_MAPPINGS
      break
    }
  }
  if (!mappingName) return []
  const mapping = FIELD_MAPPINGS[mappingName] as Record<string, string>

  const out: Array<{ csv: string; prisma: string }> = []
  for (const h of headers) {
    // Try exact match first, then case-insensitive
    let prisma = mapping[h]
    if (!prisma) {
      const lower = h.toLowerCase()
      for (const [k, v] of Object.entries(mapping)) {
        if (k.toLowerCase() === lower) {
          prisma = v
          break
        }
      }
    }
    out.push({ csv: h, prisma: prisma ?? '(ไม่ map)' })
  }
  return out
}

export function LegacyImportSection() {
  const qc = useQueryClient()
  const [selectedSource, setSelectedSource] = React.useState<AppsScriptSource | null>(
    null,
  )
  const [selectedSheet, setSelectedSheet] = React.useState<string | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const [mappingOpen, setMappingOpen] = React.useState(false)
  const [resultDialog, setResultDialog] = React.useState<LegacyImportResult | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const selectedSourceMeta = React.useMemo(
    () => (selectedSource ? getSourceMeta(selectedSource) : null),
    [selectedSource],
  )

  const selectedSheetMeta = React.useMemo(() => {
    if (!selectedSourceMeta || !selectedSheet) return null
    return (
      selectedSourceMeta.sheets.find((s) => s.id === selectedSheet) ?? null
    )
  }, [selectedSourceMeta, selectedSheet])

  const mappingPreview = React.useMemo(
    () => (selectedSheet ? getMappingPreview(selectedSheet) : []),
    [selectedSheet],
  )

  // ── Upload mutation (Apps Script legacy import) ──────────────
  const uploadMutation = useMutation({
    mutationFn: async (vars: {
      file: File
      source: AppsScriptSource
      sheetId: string
    }): Promise<LegacyImportResult> => {
      const fd = new FormData()
      fd.append('file', vars.file)
      fd.append('source', vars.source)
      fd.append('sheetId', vars.sheetId)
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token),
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error ?? 'อัปโหลดไม่สำเร็จ')
      }
      return json as LegacyImportResult
    },
    onSuccess: (data) => {
      const s = data.summary
      if (s) {
        toast.success(
          `ดึงข้อมูล ${s.sheetLabel}: ${s.processedRows}/${s.totalRows} แถว`,
        )
        if (s.unmappedColumns.length > 0) {
          toast.warning(
            `พบ ${s.unmappedColumns.length} คอลัมน์ที่ไม่ถูก map — ดูรายละเอียด`,
          )
        }
      } else {
        toast.success(`นำเข้าสำเร็จ ${data.job.processedRows}/${data.job.totalRows} แถว`)
      }
      setResultDialog(data)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      qc.invalidateQueries({ queryKey: ['import-jobs'] })
      // Invalidate the per-type data so other pages refresh.
      if (selectedSheet) {
        if (selectedSheet.startsWith('itam-')) {
          qc.invalidateQueries({ queryKey: ['devices'] })
          qc.invalidateQueries({ queryKey: ['meter'] })
        } else if (selectedSheet.startsWith('stock-')) {
          qc.invalidateQueries({ queryKey: ['stock-items'] })
        } else if (selectedSheet.startsWith('services-')) {
          qc.invalidateQueries({ queryKey: ['work-orders'] })
        }
      }
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e: Error) => {
      toast.error(e.message)
      qc.invalidateQueries({ queryKey: ['import-jobs'] })
    },
  })

  function handleFile(f: File) {
    const lower = f.name.toLowerCase()
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      toast.error('Apps Script import รองรับเฉพาะ .csv เท่านั้น')
      return
    }
    if (!lower.endsWith('.csv') && !lower.endsWith('.txt') && !lower.endsWith('.json')) {
      toast.error('รองรับเฉพาะไฟล์ .csv (หรือ .json สำหรับ Services)')
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
    if (!file || !selectedSource || !selectedSheet) return
    uploadMutation.mutate({ file, source: selectedSource, sheetId: selectedSheet })
  }

  function onDownloadTemplate() {
    if (!selectedSheet) return
    downloadLegacyTemplate(selectedSheet)
  }

  function parseErrors(job: LegacyImportResult['job']): Array<{
    row: number
    message: string
  }> {
    if (!job.errors) return []
    try {
      const arr = JSON.parse(job.errors)
      return Array.isArray(arr) ? arr : []
    } catch {
      return []
    }
  }

  // ── Source cards (3 apps) ───────────────────────────────────
  const sourceCards: Array<{
    id: AppsScriptSource
    icon: string
    title: string
    desc: string
    color: string
  }> = [
    {
      id: 'apps-script-itam',
      icon: '📊',
      title: 'IT-Asset-Management',
      desc: 'ดึงข้อมูลอุปกรณ์/มิเตอร์/ประวัติ จาก Google Sheets',
      color: '#f97316',
    },
    {
      id: 'apps-script-services',
      icon: '🔧',
      title: 'Services',
      desc: 'ดึงใบงานแจ้งซ่อมจากระบบเก่า',
      color: '#0d9488',
    },
    {
      id: 'apps-script-stock',
      icon: '📦',
      title: 'Stock',
      desc: 'ดึงสินค้า/รับเข้า/เบิกออก จากระบบสต็อกเก่า',
      color: '#8b5cf6',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              นำเข้าจากระบบเก่า (Apps Script)
            </h3>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              ดึงข้อมูลจาก 3 แอป Google Sheets ที่กำลังใช้งานอยู่ —
              export เป็น CSV แล้วอัปโหลดเพื่อโอนย้ายข้อมูลแบบครั้งเดียว
              ระบบจะแปลงชื่อคอลัมน์และสถานะให้อัตโนมัติ
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: เลือกแหล่งข้อมูล */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
          1. เลือกแหล่งข้อมูล (Source)
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {sourceCards.map((s) => {
            const active = selectedSource === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSelectedSource(s.id)
                  setSelectedSheet(null)
                  setFile(null)
                  if (inputRef.current) inputRef.current.value = ''
                }}
                className={cn(
                  'group relative flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
                  active
                    ? 'border-[#f97316] bg-[#f97316]/5 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-[#f97316]/40 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-[#fb923c]/40 dark:hover:bg-slate-800',
                )}
              >
                <span className="text-3xl" aria-hidden>
                  {s.icon}
                </span>
                <span className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  {s.title}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {s.desc}
                </span>
                <span className="mt-1 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                  {s.id}
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

      {/* Step 2: เลือก sheet และอัปโหลด */}
      {selectedSourceMeta && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                <span aria-hidden>{selectedSourceMeta.icon}</span>
                2. เลือก Sheet ที่จะนำเข้า — {selectedSourceMeta.label}
              </CardTitle>
              <CardDescription>
                เลือก sheet ที่ตรงกับไฟล์ CSV ที่ export จากระบบเก่า
                (export จาก Google Sheets → File → Download → Comma-separated values)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Sheet selector */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {selectedSourceMeta.sheets.map((sh) => {
                  const active = selectedSheet === sh.id
                  return (
                    <button
                      key={sh.id}
                      type="button"
                      onClick={() => {
                        setSelectedSheet(sh.id)
                        setFile(null)
                        if (inputRef.current) inputRef.current.value = ''
                      }}
                      className={cn(
                        'flex flex-col items-start gap-0.5 rounded-lg border-2 p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
                        active
                          ? 'border-[#f97316] bg-[#f97316]/5'
                          : 'border-slate-200 bg-white hover:border-[#f97316]/40 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800',
                      )}
                    >
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {sh.label}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {sh.desc}
                      </span>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] text-slate-500 dark:text-slate-400"
                        >
                          → {sh.model}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] text-slate-500 dark:text-slate-400"
                        >
                          {TEMPLATE_HEADERS[sh.id as keyof typeof TEMPLATE_HEADERS].length} cols
                        </Badge>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Upload zone (only when sheet selected) */}
              {selectedSheetMeta && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4"
                >
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
                      'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
                      dragOver
                        ? 'border-[#f97316] bg-[#f97316]/5'
                        : 'border-slate-300 bg-slate-50 hover:border-[#f97316] hover:bg-[#f97316]/5 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-[#fb923c]',
                    )}
                  >
                    <Upload className="h-10 w-10 text-slate-400 dark:text-slate-500" />
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
                          'ลากไฟล์ CSV มาวาง หรือคลิกเพื่อเลือกไฟล์'
                        )}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500">
                        รองรับ .csv (UTF-8) — export จาก Google Sheets
                        {selectedSource === 'apps-script-services' &&
                          ' หรือ .json (export จาก Apps Script)'}
                      </div>
                    </div>
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".csv,text/csv,.txt,.json"
                      className="hidden"
                      onChange={onInputChange}
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onPickFile}
                      className="border-slate-300 dark:border-slate-700"
                    >
                      <File className="mr-1.5 h-4 w-4" />
                      เลือกไฟล์
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onDownloadTemplate}
                      className="border-slate-300 dark:border-slate-700"
                    >
                      <Download className="mr-1.5 h-4 w-4" />
                      ดาวน์โหลดเทมเพลต
                    </Button>
                    <Button
                      type="button"
                      onClick={onUpload}
                      disabled={!file || uploadMutation.isPending}
                      className="ml-auto bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
                    >
                      {uploadMutation.isPending ? (
                        <>
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          กำลังดึงข้อมูล...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-1.5 h-4 w-4" />
                          ดึงข้อมูลจากระบบเก่า
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Required headers preview */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        หัวคอลัมน์ที่ต้องมี (ตรงกับระบบเก่า):
                      </div>
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] text-slate-500 dark:text-slate-400"
                      >
                        {TEMPLATE_HEADERS[selectedSheetMeta.id as keyof typeof TEMPLATE_HEADERS].length} columns
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {TEMPLATE_HEADERS[selectedSheetMeta.id as keyof typeof TEMPLATE_HEADERS].map((h) => (
                        <Badge
                          key={h}
                          variant="outline"
                          className="font-mono text-[11px] text-slate-600 dark:text-slate-300"
                        >
                          {h}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Mapping preview (collapsible) */}
                  <Collapsible open={mappingOpen} onOpenChange={setMappingOpen}>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
                        >
                          <div className="flex items-center gap-2">
                            <Info className="h-4 w-4 text-slate-400" />
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                              ดูการแมพคอลัมน์ (CSV → Prisma) — {mappingPreview.length} คอลัมน์
                            </span>
                          </div>
                          {mappingOpen ? (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          )}
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="max-h-72 overflow-y-auto border-t border-slate-100 p-2 dark:border-slate-800">
                          <Table>
                            <TableHeader className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                              <TableRow>
                                <TableHead className="w-1/2">CSV Header (ระบบเก่า)</TableHead>
                                <TableHead className="w-8" />
                                <TableHead>Prisma Field (ระบบใหม่)</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {mappingPreview.map((m) => (
                                <TableRow key={m.csv}>
                                  <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                                    {m.csv}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <ArrowRight className="mx-auto h-3 w-3 text-slate-400" />
                                  </TableCell>
                                  <TableCell
                                    className={cn(
                                      'font-mono text-xs',
                                      m.prisma === '(ไม่ map)'
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : m.prisma === '_skip'
                                          ? 'text-slate-400 dark:text-slate-500 italic'
                                          : 'text-emerald-700 dark:text-emerald-400',
                                    )}
                                  >
                                    {m.prisma}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>

                  {/* Export instructions */}
                  {selectedSource && <ExportInstructions source={selectedSource} />}
                </motion.div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Result dialog */}
      <Dialog
        open={!!resultDialog}
        onOpenChange={(o) => !o && setResultDialog(null)}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              {resultDialog?.job.status === 'completed' ? (
                <CheckCircle className="h-5 w-5 text-emerald-500" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-500" />
              )}
              ผลการนำเข้าจากระบบเก่า
            </DialogTitle>
            <DialogDescription>
              {resultDialog?.summary && (
                <>
                  {resultDialog.summary.sheetLabel} → {resultDialog.summary.model}
                  {' — '}
                  ไฟล์: <span className="font-mono">{resultDialog.job.fileName}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {resultDialog?.summary && (
            <div className="space-y-4">
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-center dark:border-slate-800 dark:bg-slate-800/50">
                  <div className="text-xs text-slate-500 dark:text-slate-400">ทั้งหมด</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
                    {resultDialog.summary.totalRows}
                  </div>
                </div>
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-center dark:border-emerald-800 dark:bg-emerald-950/30">
                  <div className="text-xs text-emerald-700 dark:text-emerald-400">สำเร็จ</div>
                  <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                    {resultDialog.summary.processedRows}
                  </div>
                </div>
                <div className="rounded-md border border-red-200 bg-red-50 p-2 text-center dark:border-red-800 dark:bg-red-950/30">
                  <div className="text-xs text-red-700 dark:text-red-400">ผิดพลาด</div>
                  <div className="text-lg font-bold text-red-700 dark:text-red-400">
                    {resultDialog.summary.errorRows}
                  </div>
                </div>
              </div>

              {/* Unmapped columns warning */}
              {resultDialog.summary.unmappedColumns.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <AlertCircle className="h-3.5 w-3.5" />
                    คอลัมน์ที่ไม่ถูก map ({resultDialog.summary.unmappedColumns.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {resultDialog.summary.unmappedColumns.map((c) => (
                      <Badge
                        key={c}
                        variant="outline"
                        className="font-mono text-[10px] text-amber-700 dark:text-amber-300"
                      >
                        {c}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                    คอลัมน์เหล่านี้ถูกข้ามเพราะไม่ตรงกับ field ใดใน schema ปัจจุบัน —
                    ข้อมูลในคอลัมน์เหล่านี้ไม่ถูกบันทึก
                  </p>
                </div>
              )}

              {/* Header comparison */}
              {resultDialog.summary.expectedHeaders &&
                resultDialog.summary.actualHeaders && (
                  <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                    <div className="mb-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      ตรวจสอบหัวคอลัมน์:
                    </div>
                    <div className="space-y-1 text-[11px]">
                      <div className="text-slate-600 dark:text-slate-300">
                        <span className="font-mono text-slate-500">expected:</span>{' '}
                        <span className="text-slate-700 dark:text-slate-200">
                          {resultDialog.summary.expectedHeaders.length} columns
                        </span>
                      </div>
                      <div className="text-slate-600 dark:text-slate-300">
                        <span className="font-mono text-slate-500">actual:</span>{' '}
                        <span className="text-slate-700 dark:text-slate-200">
                          {resultDialog.summary.actualHeaders.length} columns
                        </span>
                      </div>
                      {/* Show extra columns (in actual but not expected) */}
                      {resultDialog.summary.actualHeaders.filter(
                        (h) =>
                          !resultDialog!.summary!.expectedHeaders.includes(h),
                      ).length > 0 && (
                        <div className="text-amber-700 dark:text-amber-400">
                          <span className="font-mono">extra:</span>{' '}
                          {resultDialog.summary.actualHeaders
                            .filter(
                              (h) =>
                                !resultDialog!.summary!.expectedHeaders.includes(h),
                            )
                            .join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {/* Warnings list */}
              {resultDialog.summary.warnings.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md border border-amber-200 dark:border-amber-800">
                  <div className="sticky top-0 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    คำเตือน ({resultDialog.summary.warnings.length})
                  </div>
                  <div className="divide-y divide-amber-100 dark:divide-amber-900">
                    {resultDialog.summary.warnings.map((w, i) => (
                      <div
                        key={i}
                        className="px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300"
                      >
                        {w}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Errors table */}
              {parseErrors(resultDialog.job).length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
                  <div className="sticky top-0 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    ข้อผิดพลาด ({parseErrors(resultDialog.job).length})
                  </div>
                  <Table>
                    <TableHeader className="sticky top-7 z-10 bg-slate-50 dark:bg-slate-900">
                      <TableRow>
                        <TableHead className="w-16">บรรทัด</TableHead>
                        <TableHead>ข้อความ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parseErrors(resultDialog.job).map((err, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs text-slate-500 dark:text-slate-400">
                            {err.row === 0 ? '—' : err.row}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-xs',
                              err.message.startsWith('[warning]')
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-slate-700 dark:text-slate-300',
                            )}
                          >
                            {err.message}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================
// Export instructions — how to get CSV out of Google Sheets
// ============================================================
function ExportInstructions({ source }: { source: AppsScriptSource }) {
  const steps: Record<AppsScriptSource, Array<{ title: string; body: string }>> = {
    'apps-script-itam': [
      {
        title: 'เปิด Google Sheets',
        body: 'เปิด spreadsheet IT-Asset-Management ของคุณ',
      },
      {
        title: 'เลือก sheet ที่จะ export',
        body: 'เช่น All_Devices, Meter_Readings, Location_History ฯลฯ — คลิก tab ด้านล่าง',
      },
      {
        title: 'File → Download → Comma-separated values',
        body: 'เมนู File → Download → เลือก ".csv" — ไฟล์จะถูกบันทึกลงเครื่อง',
      },
      {
        title: 'อัปโหลดไฟล์ CSV',
        body: 'นำไฟล์ CSV มาลากวางในพื้นที่ด้านบน — ระบบจะ map คอลัมน์ให้อัตโนมัติ',
      },
    ],
    'apps-script-stock': [
      {
        title: 'เปิด Google Sheets',
        body: 'เปิด spreadsheet Stock ของคุณ',
      },
      {
        title: 'เลือก sheet ที่จะ export',
        body: 'เช่น Products, StockIn, StockOut, PurchaseOrders — คลิก tab ด้านล่าง',
      },
      {
        title: 'File → Download → Comma-separated values',
        body: 'เมนู File → Download → เลือก ".csv" — ไฟล์จะถูกบันทึกลงเครื่อง',
      },
      {
        title: 'อัปโหลดไฟล์ CSV',
        body: 'นำไฟล์ CSV มาลากวางในพื้นที่ด้านบน — ระบบจะ map คอลัมน์ให้อัตโนมัติ',
      },
    ],
    'apps-script-services': [
      {
        title: 'เปิด Apps Script Editor',
        body: 'เปิด Services app → Extensions → Apps Script',
      },
      {
        title: 'รันฟังก์ชัน exportData',
        body: 'หรือใช้ Logs → ดู JSON ของ WorkOrder ทั้งหมด (sheet "Data")',
      },
      {
        title: 'บันทึกเป็น .json หรือ .csv',
        body: 'นำ JSON มา flatten เป็น CSV ด้วยเครื่องมือออนไลน์ (JSON-to-CSV) หรือเขียนสคริปต์',
      },
      {
        title: 'อัปโหลดไฟล์',
        body: 'ระบบจะ parse แต่ละ row ตาม field ของ WorkOrder และแปลงสถานะ emoji-Thai → enum',
      },
    ],
  }
  const list = steps[source]
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
        <Info className="h-3.5 w-3.5 text-slate-400" />
        วิธี export จากระบบเก่า
      </div>
      <ol className="ml-4 list-decimal space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
        {list.map((s, i) => (
          <li key={i}>
            <strong className="text-slate-700 dark:text-slate-200">{s.title}:</strong>{' '}
            {s.body}
          </li>
        ))}
      </ol>
    </div>
  )
}
