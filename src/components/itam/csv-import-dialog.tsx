'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  UploadCloud,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { parseCsv, downloadCsv } from '@/lib/csv'
import type { Device } from './types'

/**
 * Column header → device field mapping.
 * Recognises Thai and English headers (case-insensitive).
 *
 * Extended in Task 10 to support the 3 new Device Set fields
 * (parentDeviceId, setLabel, setPosition) and additional optional fields
 * (building, floor, room, IP, MAC, vendor, warrantyEnd, etc).
 */
const HEADER_ALIASES: Array<{ aliases: string[]; field: keyof ImportRow }> = [
  { aliases: ['รหัส', 'รหัสอุปกรณ์', 'assetcode', 'asset code', 'code'], field: 'assetCode' },
  { aliases: ['ชื่อ', 'ชื่ออุปกรณ์', 'name'], field: 'name' },
  { aliases: ['แบรนด์', 'brand'], field: 'brand' },
  { aliases: ['รุ่น', 'model'], field: 'model' },
  { aliases: ['ประเภท', 'type'], field: 'type' },
  { aliases: ['sn', 'serialnumber', 'serial number', 'หมายเลขsn', 'หมายเลข sn', 'serial'], field: 'serialNumber' },
  { aliases: ['สถานะ', 'status'], field: 'status' },
  { aliases: ['สาขา', 'site'], field: 'site' },
  { aliases: ['แผนก', 'department'], field: 'department' },
  { aliases: ['รหัสแผนก', 'departmentcode', 'department code'], field: 'departmentCode' },
  { aliases: ['parentref', 'parent ref'], field: 'parentRef' },
  { aliases: ['displaylabel', 'display label'], field: 'displayLabel' },
  { aliases: ['ที่ตั้ง', 'location'], field: 'location' },
  { aliases: ['อาคาร', 'building'], field: 'building' },
  { aliases: ['ชั้น', 'floor'], field: 'floor' },
  { aliases: ['ห้อง', 'room'], field: 'room' },
  { aliases: ['วันที่ซื้อ', 'วันที่รับ', 'purchasedate', 'purchase date'], field: 'purchaseDate' },
  { aliases: ['ราคาทุน', 'purchaseprice', 'purchase price'], field: 'purchasePrice' },
  { aliases: ['รับประกัน(เดือน)', 'warrantymonths', 'warranty months'], field: 'warrantyMonths' },
  { aliases: ['วันหมดรับประกัน', 'warrantyend', 'warranty end'], field: 'warrantyEnd' },
  { aliases: ['ผู้จำหน่าย', 'vendor'], field: 'vendor' },
  { aliases: ['เลขที่สัญญา', 'contractno', 'contract no'], field: 'contractNo' },
  { aliases: ['ip', 'ipaddress', 'ip address'], field: 'ip' },
  { aliases: ['mac', 'macaddress', 'mac address'], field: 'mac' },
  { aliases: ['remoteid', 'remote id'], field: 'remoteId' },
  { aliases: ['ต้องจดมิเตอร์', 'meterrequired', 'meter required'], field: 'meterRequired' },
  { aliases: ['โหมดมิเตอร์', 'metermode', 'meter mode'], field: 'meterMode' },
  { aliases: ['มิเตอร์ล่าสุด', 'lastmeterreading', 'last meter reading', 'มิเตอร์ขาวดำ', 'lastmeterbw', 'last meter bw'], field: 'lastMeterReading' },
  { aliases: ['มิเตอร์สี', 'lastmetercolor', 'last meter color'], field: 'lastMeterColor' },
  { aliases: ['costcenter', 'cost center'], field: 'costCenter' },
  { aliases: ['กลุ่มอุปกรณ์', 'devicegroup', 'device group'], field: 'deviceGroup' },
  { aliases: ['หมายเหตุ', 'remark'], field: 'remark' },
  // ── Device Set fields (Task 9 Phase 2) ──
  { aliases: ['อุปกรณ์หลัก', 'parentdeviceid', 'parent device id', 'parent device'], field: 'parentDeviceId' },
  { aliases: ['ชื่อชุด', 'setlabel', 'set label'], field: 'setLabel' },
  { aliases: ['ลำดับในชุด', 'setposition', 'set position'], field: 'setPosition' },
]

const STATUS_THAI_TO_EN: Record<string, string> = {
  'ใช้งานอยู่': 'Active',
  'สำรอง': 'In Stock',
  'ส่งซ่อม': 'In Repair',
  'ไม่ใช้งาน': 'Inactive',
  'เกษียณ': 'Retrieved',
  'ตัดของออก': 'Disposed',
  'จำหน่าย': 'Disposed',
  'คืนเครื่อง': 'Returned',
  // Legacy short forms (backward-compat with old templates)
  active: 'Active',
  spare: 'In Stock',
  repair: 'In Repair',
  disposed: 'Disposed',
}

const TEMPLATE_HEADERS = [
  { key: 'assetCode', label: 'รหัสอุปกรณ์' },
  { key: 'name', label: 'ชื่อ' },
  { key: 'brand', label: 'แบรนด์' },
  { key: 'model', label: 'รุ่น' },
  { key: 'type', label: 'ประเภท' },
  { key: 'serialNumber', label: 'หมายเลข SN' },
  { key: 'status', label: 'สถานะ' },
  { key: 'site', label: 'สาขา' },
  { key: 'department', label: 'แผนก' },
  { key: 'departmentCode', label: 'รหัสแผนก' },
  { key: 'parentRef', label: 'ParentRef' },
  { key: 'displayLabel', label: 'DisplayLabel' },
  { key: 'location', label: 'ที่ตั้ง' },
  { key: 'building', label: 'อาคาร' },
  { key: 'floor', label: 'ชั้น' },
  { key: 'room', label: 'ห้อง' },
  { key: 'purchaseDate', label: 'วันที่ซื้อ' },
  { key: 'purchasePrice', label: 'ราคาทุน' },
  { key: 'warrantyMonths', label: 'รับประกัน(เดือน)' },
  { key: 'warrantyEnd', label: 'วันหมดรับประกัน' },
  { key: 'vendor', label: 'ผู้จำหน่าย' },
  { key: 'ip', label: 'IP Address' },
  { key: 'mac', label: 'MAC Address' },
  { key: 'meterRequired', label: 'ต้องจดมิเตอร์' },
  { key: 'lastMeterReading', label: 'มิเตอร์ขาวดำ' },
  { key: 'lastMeterColor', label: 'มิเตอร์สี' },
  { key: 'costCenter', label: 'Cost Center' },
  { key: 'deviceGroup', label: 'กลุ่มอุปกรณ์' },
  { key: 'remark', label: 'หมายเหตุ' },
  // ── Device Set fields (Task 9 Phase 2) ──
  { key: 'parentDeviceId', label: 'อุปกรณ์หลัก (รหัส)' },
  { key: 'setLabel', label: 'ชื่อชุด' },
  { key: 'setPosition', label: 'ลำดับในชุด' },
]

interface ImportRow {
  assetCode: string
  name: string
  brand: string
  model: string
  type: string
  serialNumber: string
  status: string
  site: string
  department: string
  departmentCode: string
  parentRef: string
  displayLabel: string
  location: string
  building: string
  floor: string
  room: string
  purchaseDate: string
  purchasePrice: string
  warrantyMonths: string
  warrantyEnd: string
  vendor: string
  contractNo: string
  ip: string
  mac: string
  remoteId: string
  meterRequired: string
  meterMode: string
  lastMeterReading: string
  lastMeterColor: string
  costCenter: string
  deviceGroup: string
  remark: string
  // ── Device Set fields (Task 9 Phase 2) ──
  parentDeviceId: string
  setLabel: string
  setPosition: string
  _rowIndex: number
  _error?: string
}

const EMPTY_ROW: Omit<ImportRow, '_rowIndex'> = {
  assetCode: '',
  name: '',
  brand: '',
  model: '',
  type: '',
  serialNumber: '',
  status: '',
  site: '',
  department: '',
  departmentCode: '',
  parentRef: '',
  displayLabel: '',
  location: '',
  building: '',
  floor: '',
  room: '',
  purchaseDate: '',
  purchasePrice: '',
  warrantyMonths: '',
  warrantyEnd: '',
  vendor: '',
  contractNo: '',
  ip: '',
  mac: '',
  remoteId: '',
  meterRequired: '',
  meterMode: '',
  lastMeterReading: '',
  lastMeterColor: '',
  costCenter: '',
  deviceGroup: '',
  remark: '',
  // ── Device Set fields (Task 9 Phase 2) ──
  parentDeviceId: '',
  setLabel: '',
  setPosition: '',
}

interface ParsedData {
  headers: string[]
  rows: ImportRow[]
  fieldMap: Record<string, keyof ImportRow>
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  existingAssetCodes?: Set<string>
}

type ImportMode = 'create' | 'update' | 'upsert'

const MODE_INFO: Record<ImportMode, { label: string; desc: string; color: string }> = {
  create: {
    label: 'เพิ่มใหม่',
    desc: 'เฉพาะรายการใหม่ — รายการที่มีอยู่แล้วจะถูกข้าม',
    color: 'emerald',
  },
  update: {
    label: 'อัปเดต',
    desc: 'เฉพาะรายการที่มีอยู่ — รายการใหม่จะถูกข้าม',
    color: 'amber',
  },
  upsert: {
    label: 'เพิ่ม/อัปเดต',
    desc: 'เพิ่มใหม่ถ้ายังไม่มี — อัปเดตถ้ามีแล้ว',
    color: 'sky',
  },
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

function detectFieldMap(headers: string[]): Record<string, keyof ImportRow> {
  const map: Record<string, keyof ImportRow> = {}
  headers.forEach((h, idx) => {
    const nh = normalizeHeader(h)
    const match = HEADER_ALIASES.find((a) =>
      a.aliases.some((alias) => normalizeHeader(alias) === nh),
    )
    if (match) {
      map[idx] = match.field
    }
  })
  return map
}

function mapRow(
  raw: string[],
  fieldMap: Record<string, keyof ImportRow>,
  rowIndex: number,
): ImportRow {
  const row: ImportRow = { ...EMPTY_ROW, _rowIndex: rowIndex }
  Object.entries(fieldMap).forEach(([idx, field]) => {
    const value = raw[Number(idx)]?.trim() ?? ''
    // `ImportRow` is a flat string record; go through `unknown` because
    // interfaces get no implicit index signature.
    ;(row as unknown as Record<string, unknown>)[field] = value
  })
  // Normalize Thai status labels to English keys
  if (row.status && STATUS_THAI_TO_EN[row.status]) {
    row.status = STATUS_THAI_TO_EN[row.status]
  }
  return row
}

function validateRows(
  rows: ImportRow[],
  existingCodes: Set<string>,
  mode: ImportMode,
): ImportRow[] {
  const seen = new Set<string>()
  const validStatuses = new Set([
    'active', 'spare', 'repair', 'disposed', '',
    'in stock', 'in repair', 'inactive', 'returned', 'retrieved',
    'ใช้งานอยู่', 'สำรอง', 'ส่งซ่อม', 'ไม่ใช้งาน', 'เกษียณ', 'ตัดของออก', 'จำหน่าย', 'คืนเครื่อง',
  ])
  rows.forEach((r) => {
    if (!r.assetCode) {
      r._error = 'ไม่มีรหัสอุปกรณ์'
      return
    }
    // For create mode: required name/brand/model/type
    // For update/upsert mode: only required when row is for a NEW device
    // (server will decide; we just do client-side pre-validation for create mode)
    if (mode === 'create') {
      if (!r.name) {
        r._error = 'ไม่มีชื่ออุปกรณ์'
        return
      }
      if (!r.brand) {
        r._error = 'ไม่มีแบรนด์'
        return
      }
      if (!r.model) {
        r._error = 'ไม่มีรุ่น'
        return
      }
      if (!r.type) {
        r._error = 'ไม่มีประเภท'
        return
      }
    }
    if (r.status && !validStatuses.has(r.status.toLowerCase())) {
      r._error = `สถานะไม่ถูกต้อง: ${r.status}`
      return
    }
    if (seen.has(r.assetCode)) {
      r._error = `รหัสซ้ำในไฟล์: ${r.assetCode}`
      return
    }
    // For create mode: existing codes are errors (legacy behavior)
    // For update/upsert mode: existing codes are EXPECTED — no error
    if (mode === 'create' && existingCodes.has(r.assetCode)) {
      r._error = `มีอยู่แล้วในระบบ: ${r.assetCode}`
      return
    }
    // For update mode: warn if code doesn't exist (but don't block — server will skip)
    if (mode === 'update' && !existingCodes.has(r.assetCode)) {
      r._error = `ไม่พบในระบบ (จะถูกข้าม): ${r.assetCode}`
      return
    }
    seen.add(r.assetCode)
  })
  return rows
}

function downloadTemplate(mode: ImportMode = 'create') {
  const sample: Record<string, unknown> = {}
  TEMPLATE_HEADERS.forEach((h) => {
    sample[h.key] =
      h.key === 'status'
        ? 'ใช้งานอยู่'
        : h.key === 'lastMeterReading' || h.key === 'lastMeterColor'
          ? '0'
          : h.key === 'purchaseDate' || h.key === 'warrantyEnd'
            ? '2025-01-01'
            : h.key === 'assetCode'
              ? 'IT-PRT-001'
              : h.key === 'name'
                ? 'เครื่องพิมพ์ HP LaserJet Pro'
                : h.key === 'brand'
                  ? 'HP'
                  : h.key === 'model'
                    ? 'LaserJet Pro M404'
                    : h.key === 'type'
                      ? 'PRINTER'
                      : h.key === 'site'
                        ? 'HQ'
                        : h.key === 'meterRequired'
                          ? 'true'
                          : h.key === 'parentDeviceId'
                            ? (mode === 'update' ? '' : '')
                            : ''
  })
  const fname =
    mode === 'update'
      ? 'devices-update-template.csv'
      : mode === 'upsert'
        ? 'devices-upsert-template.csv'
        : 'devices-template.csv'
  downloadCsv(fname, [sample], TEMPLATE_HEADERS)
}

export function CsvImportDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient()
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [parsed, setParsed] = React.useState<ParsedData | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [mode, setMode] = React.useState<ImportMode>('create')
  const [lastImportResult, setLastImportResult] = React.useState<{
    inserted: number
    updated: number
    skipped: number
  } | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const { data: existingDevices } = useQuery<Device[]>({
    queryKey: ['devices', '', 'all', 'all'],
    queryFn: async () => {
      const res = await fetch('/api/devices?limit=500')
      if (!res.ok) return []
      const json = await res.json()
      return (json.devices ?? []) as Device[]
    },
    staleTime: 30_000,
  })
  const existingCodes = React.useMemo(
    () => new Set((existingDevices ?? []).map((d) => d.assetCode)),
    [existingDevices],
  )

  function reset() {
    setFileName(null)
    setParsed(null)
    setLastImportResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleClose(o: boolean) {
    if (!o) {
      reset()
    }
    onOpenChange(o)
  }

  function handleFile(file: File) {
    setFileName(file.name)
    setLastImportResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = String(e.target?.result ?? '')
      const grid = parseCsv(text)
      if (grid.length === 0) {
        toast.error('ไฟล์ CSV ว่างเปล่า')
        setParsed(null)
        return
      }
      const headers = grid[0]
      const fieldMap = detectFieldMap(headers)
      if (Object.keys(fieldMap).length === 0) {
        toast.error('ไม่พบคอลัมน์ที่รู้จัก (ต้องมีอย่างน้อย: รหัส, ชื่อ, แบรนด์, รุ่น, ประเภท)')
        setParsed(null)
        return
      }
      const rows = grid.slice(1).map((raw, i) => mapRow(raw, fieldMap, i + 2))
      const validated = validateRows(rows, existingCodes, mode)
      setParsed({ headers, rows: validated, fieldMap })
    }
    reader.onerror = () => toast.error('อ่านไฟล์ไม่สำเร็จ')
    reader.readAsText(file, 'utf-8')
  }

  // Re-validate when mode changes (so errors update accordingly)
  React.useEffect(() => {
    if (!parsed) return
    const revalidated = validateRows(parsed.rows, existingCodes, mode)
    setParsed({ ...parsed, rows: revalidated })
  }, [mode, existingCodes])

  const validRows = (parsed?.rows ?? []).filter((r) => !r._error)
  const errorRows = (parsed?.rows ?? []).filter((r) => r._error)
  const previewRows = (parsed?.rows ?? []).slice(0, 8)

  async function doImport() {
    if (!parsed || validRows.length === 0) return
    try {
      setImporting(true)
      const payload = validRows.map((r) => {
        const row: Record<string, unknown> = {
          assetCode: r.assetCode,
        }
        // Only include non-empty fields — server treats null as "don't update"
        // for update mode, and uses defaults for create mode.
        if (r.name) row.name = r.name
        if (r.brand) row.brand = r.brand
        if (r.model) row.model = r.model
        if (r.type) row.type = r.type
        if (r.serialNumber) row.serialNumber = r.serialNumber
        if (r.status) row.status = r.status
        if (r.site) row.site = r.site
        if (r.department) row.department = r.department
        if (r.departmentCode) row.departmentCode = r.departmentCode
        if (r.parentRef) row.parentRef = r.parentRef
        if (r.displayLabel) row.displayLabel = r.displayLabel
        if (r.location) row.location = r.location
        if (r.building) row.building = r.building
        if (r.floor) row.floor = r.floor
        if (r.room) row.room = r.room
        if (r.purchaseDate) row.purchaseDate = r.purchaseDate
        if (r.purchasePrice) row.purchasePrice = r.purchasePrice
        if (r.warrantyMonths) row.warrantyMonths = r.warrantyMonths
        if (r.warrantyEnd) row.warrantyEnd = r.warrantyEnd
        if (r.vendor) row.vendor = r.vendor
        if (r.contractNo) row.contractNo = r.contractNo
        if (r.ip) row.ip = r.ip
        if (r.mac) row.mac = r.mac
        if (r.remoteId) row.remoteId = r.remoteId
        if (r.meterRequired) row.meterRequired = r.meterRequired
        if (r.meterMode) row.meterMode = r.meterMode
        if (r.lastMeterReading) row.lastMeterBw = Number(r.lastMeterReading) || 0
        if (r.lastMeterColor) row.lastMeterColor = Number(r.lastMeterColor) || 0
        if (r.costCenter) row.costCenter = r.costCenter
        if (r.deviceGroup) row.deviceGroup = r.deviceGroup
        if (r.remark) row.remark = r.remark
        // ── Device Set fields (Task 9 Phase 2) ──
        if (r.parentDeviceId) row.parentDeviceId = r.parentDeviceId
        if (r.setLabel) row.setLabel = r.setLabel
        if (r.setPosition) row.setPosition = r.setPosition
        return row
      })
      const res = await fetch('/api/devices/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, devices: payload }),
      })
      // ── CONSULTING-007 Phase B (partial) ──────────────────────────
      // This dialog still calls `/api/devices/import` (NOT the cleaner
      // `/api/itam/devices/import` endpoint) because the contract at
      // `src/lib/device-import-contract.ts` is still missing these
      // fields that this dialog supports:
      //   • purchasePrice      (Decimal)
      //   • lastMeterBw        (Int)
      //   • lastMeterColor     (Int)
      //   • parentDeviceId     (Device Set — cuid/assetCode resolution)
      //   • setLabel           (Device Set)
      //   • setPosition        (Device Set)
      //   • parentRef          (legacy)
      //   • displayLabel       (legacy)
      // `name` + `warrantyMonths` WERE added to the contract as part of
      // CONSULTING-007 Phase B (they were the only fields missing vs
      // `/api/import`). Once the remaining 8 fields above are added to
      // the contract + persistence layer, this dialog should be routed
      // to `/api/itam/devices/import` (which uses db.$transaction via
      // `device-import-persistence.ts`). The current `/api/devices/import`
      // endpoint already wraps writes in db.$transaction (see
      // `/api/devices/import/route.ts` lines 417-434), so this dialog
      // is already transaction-safe — Phase B here is consolidation, not
      // a safety fix. See worklog CONSULTING-007-IMPORT-TEMPLATES.
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error ?? 'นำเข้าไม่สำเร็จ')
      }
      setLastImportResult({
        inserted: json.inserted ?? 0,
        updated: json.updated ?? 0,
        skipped: json.skipped ?? 0,
      })
      const insertedN = json.inserted ?? 0
      const updatedN = json.updated ?? 0
      if (mode === 'create') {
        toast.success(`นำเข้า ${insertedN} อุปกรณ์แล้ว`)
      } else if (mode === 'update') {
        toast.success(`อัปเดต ${updatedN} อุปกรณ์แล้ว`)
      } else {
        toast.success(`เพิ่ม ${insertedN} + อัปเดต ${updatedN} อุปกรณ์แล้ว`)
      }
      await qc.invalidateQueries({ queryKey: ['devices'] })
      await qc.invalidateQueries({ queryKey: ['dashboard'] })
      // Close after a brief delay so the user sees the result
      setTimeout(() => {
        handleClose(false)
      }, 800)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'นำเข้าไม่สำเร็จ')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <UploadCloud className="h-5 w-5 text-[#f97316]" />
            นำเข้าอุปกรณ์จาก CSV
          </DialogTitle>
          <DialogDescription>
            เลือกโหมด → ดาวน์โหลดเทมเพลต → แก้ไข → อัปโหลด — ระบบจะตรวจสอบและแสดงตัวอย่างก่อนนำเข้า
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Mode selector (Task 10 — new) ──
              Lets the user choose: create only, update only, or upsert. */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
            <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              โหมดการนำเข้า
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(MODE_INFO) as ImportMode[]).map((m) => {
                const info = MODE_INFO[m]
                const isActive = mode === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={
                      'flex flex-col items-start gap-0.5 rounded-lg border p-2 text-left transition-all ' +
                      (isActive
                        ? 'border-[#f97316] bg-white ring-1 ring-[#f97316] dark:border-[#fb923c] dark:bg-slate-800'
                        : 'border-slate-200 bg-white/50 hover:bg-white dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800')
                    }
                  >
                    <span className={
                      'text-sm font-medium ' +
                      (isActive ? 'text-[#f97316] dark:text-[#fb923c]' : 'text-slate-700 dark:text-slate-200')
                    }>
                      {info.label}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {info.desc}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Drop zone / file input */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition-colors hover:border-[#f97316] hover:bg-[#f97316]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-[#fb923c] dark:hover:bg-[#f97316]/10"
          >
            <UploadCloud className="h-10 w-10 text-slate-400 dark:text-slate-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {fileName ? (
                <span className="inline-flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  {fileName}
                </span>
              ) : (
                'คลิกเพื่อเลือกไฟล์ CSV'
              )}
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              รองรับ .csv · รหัสอุปกรณ์ต้องไม่ซ้ำ
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => downloadTemplate(mode)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#f97316] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950 rounded"
            >
              <Download className="h-3.5 w-3.5" />
              ดาวน์โหลดเทมเพลต CSV ({MODE_INFO[mode].label})
            </button>
            {parsed && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  ถูกต้อง {validRows.length}
                </Badge>
                {errorRows.length > 0 && (
                  <Badge className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    มีปัญหา {errorRows.length}
                  </Badge>
                )}
                <span className="text-slate-400 dark:text-slate-500">
                  รวม {parsed.rows.length} แถว
                </span>
              </div>
            )}
          </div>

          {/* Validation errors list */}
          {errorRows.length > 0 && (
            <div className="itam-scroll max-h-32 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              <div className="mb-1 font-semibold">รายการที่มีปัญหา (จะไม่ถูกนำเข้า):</div>
              <ul className="space-y-0.5">
                {errorRows.slice(0, 50).map((r) => (
                  <li key={r._rowIndex}>
                    บรรทัด {r._rowIndex}: {r._error}
                  </li>
                ))}
                {errorRows.length > 50 && (
                  <li className="italic">...และอีก {errorRows.length - 50} รายการ</li>
                )}
              </ul>
            </div>
          )}

          {/* Preview table */}
          {parsed && (
            <div className="rounded-md border border-slate-200 dark:border-slate-800">
              <div className="border-b border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-800 dark:text-slate-300">
                ตัวอย่าง {Math.min(8, parsed.rows.length)} จาก {parsed.rows.length} แถว
              </div>
              <div className="itam-scroll max-h-72 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>รหัส</TableHead>
                      <TableHead>ชื่อ</TableHead>
                      <TableHead>แบรนด์</TableHead>
                      <TableHead>ประเภท</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead>สาขา</TableHead>
                      <TableHead className="w-24">สถานะตรวจสอบ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
                          ไม่มีข้อมูลให้แสดง
                        </TableCell>
                      </TableRow>
                    ) : (
                      previewRows.map((r) => (
                        <TableRow key={r._rowIndex}>
                          <TableCell className="text-xs text-slate-400 dark:text-slate-500">
                            {r._rowIndex}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.assetCode || '—'}</TableCell>
                          <TableCell className="max-w-[180px] truncate">{r.name || '—'}</TableCell>
                          <TableCell>{r.brand || '—'}</TableCell>
                          <TableCell>{r.type || '—'}</TableCell>
                          <TableCell>{r.status || '—'}</TableCell>
                          <TableCell>{r.site || '—'}</TableCell>
                          <TableCell>
                            {r._error ? (
                              <Badge className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                ข้าม
                              </Badge>
                            ) : (
                              <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                พร้อม
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Result banner */}
          {lastImportResult && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              {lastImportResult.inserted > 0 && (
                <span>เพิ่มใหม่ {lastImportResult.inserted} รายการ</span>
              )}
              {lastImportResult.updated > 0 && (
                <span className="text-amber-700 dark:text-amber-300">
                  อัปเดต {lastImportResult.updated} รายการ
                </span>
              )}
              {lastImportResult.skipped > 0 && (
                <span className="text-slate-600 dark:text-slate-400">
                  (ข้าม {lastImportResult.skipped} รายการ)
                </span>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={importing}
          >
            ยกเลิก
          </Button>
          <Button
            onClick={doImport}
            disabled={importing || validRows.length === 0}
            className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            {importing ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                กำลัง{mode === 'update' ? 'อัปเดต' : 'นำเข้า'}...
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" />
                {MODE_INFO[mode].label} {validRows.length > 0 ? `(${validRows.length})` : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

