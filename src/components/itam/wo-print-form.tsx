'use client'

// ============================================================
// WoPrintForm — ใบแจ้งซ่อมรายจ๊อบ (Task ID: PRINT-REPORT, PART 1)
// ============================================================
// Print-ready form for a single work order. Lets the user pick
// a paper size (A4 portrait / A4 landscape / A5 portrait) and
// either:
//   • print directly via window.print() with print-specific CSS, or
//   • open a server-rendered HTML page in a new tab/window for
//     standalone printing.
//
// Usage:
//   <WoPrintForm workOrderId="abc123" />
//
// The component fetches /api/work-orders/[id] for the detail and
// /api/work-orders/[id]/parts for linked stock transactions.
// ============================================================

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Printer,
  ExternalLink,
  FileText,
  Wrench,
  User,
  Phone,
  MapPin,
  Building2,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  PackageOpen,
  Box,
  Hash,
  ClipboardList,
  Image as ImageIcon,
} from 'lucide-react'
import { useLang, useI18nStore } from '@/store/i18n-store'

// ── Types (kept self-contained; mirrors WorkOrder shape from API) ──
interface WoMessage {
  id: string
  workOrderId: string
  message: string
  author: string | null
  authorRole: string | null
  createdAt: string
}
interface WoReview {
  id: string
  workOrderId: string
  rating: number
  comment: string | null
  reviewedBy: string | null
  createdAt: string
}
interface ExternalMeta {
  clientName?: string
  place?: string
  contactPhone?: string
  serials?: string[]
}
interface WorkOrderDetail {
  id: string
  woNumber: string | null
  subject: string
  building: string | null
  location: string | null
  details: string | null
  priority: string
  reporterName: string | null
  reporterEmail: string | null
  tel: string | null
  employeeCode: string | null
  submissionSource: string
  externalMeta: string | null
  picBefore: string | null
  picOnsite: string | null
  picAfter: string | null
  status: string
  assignedTo: string | null
  assignedBy: string | null
  assignedAt: string | null
  assignmentNote: string | null
  detailsAdmin: string | null
  dateAdmin: string | null
  resolution: string | null
  resolutionGroup: string | null
  workCompletedAt: string | null
  closedAt: string | null
  canceledAt: string | null
  cancelReason: string | null
  deviceId: string | null
  createdAt: string
  updatedAt: string
  device?: {
    id: string
    assetCode: string
    name: string
    brand: string
    model: string
    /** Device.serialNumber — returned by GET /api/work-orders/[id]. */
    serialNumber: string | null
    site: string
  } | null
  messages?: WoMessage[]
  review?: WoReview | null
}

interface PartsTransaction {
  id: string
  txnNumber: string | null
  productName: string | null
  productCode: string | null
  type: string
  quantity: number
  unit: string | null
  approvalStatus: string | null
  remark: string | null
  txnDate: string
  stockItem?: {
    productName: string
    productCode: string
    unit: string
  } | null
}
interface PartsListResponse {
  data: PartsTransaction[]
  summary: {
    total: number
    pending: number
    approved: number
    rejected: number
    immediate: number
  }
}

// ── Paper sizes ──
type PaperKey = 'a4-portrait' | 'a4-landscape' | 'a5-portrait'

interface PaperSpec {
  key: PaperKey
  label: string
  // CSS @page size value
  pageRule: string
  // The on-screen page width to preview
  previewWidth: string
  // Font scale hint
  fontSize: string
}

const PAPER_SPECS: Record<PaperKey, PaperSpec> = {
  'a4-portrait': {
    key: 'a4-portrait',
    label: 'A4 แนวตั้ง',
    pageRule: 'A4 portrait',
    previewWidth: '210mm',
    fontSize: '14px',
  },
  'a4-landscape': {
    key: 'a4-landscape',
    label: 'A4 แนวนอน',
    pageRule: 'A4 landscape',
    previewWidth: '297mm',
    fontSize: '14px',
  },
  'a5-portrait': {
    key: 'a5-portrait',
    label: 'A5 แนวตั้ง',
    pageRule: 'A5 portrait',
    previewWidth: '148mm',
    fontSize: '12px',
  },
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  IN_PROGRESS: 'กำลังซ่อม',
  WAITING_PARTS: 'รออะไหล่',
  COMPLETED: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
}

function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s
}

// BUGFIX (QA-ROUND-2026-09-16-C): bare `lang` was never defined at module scope
// → ReferenceError when these helpers ran. Read the language from the zustand
// store (non-hook read, safe in render helpers).
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(useI18nStore.getState().lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(iso)
  }
}

function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(useI18nStore.getState().lang === 'th' ? 'th-TH' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return String(iso)
  }
}

function parseExternalMeta(raw: string | null): ExternalMeta | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    return obj as ExternalMeta
  } catch {
    return null
  }
}

function isImageUrl(s: string | null | undefined): s is string {
  if (!s) return false
  return s.startsWith('http') || s.startsWith('data:')
}

// ── Component ──
export function WoPrintForm({ workOrderId }: { workOrderId: string }) {
  const [paper, setPaper] = React.useState<PaperKey>('a4-portrait')
  const spec = PAPER_SPECS[paper]
  // ── In-page print container (Task ID: PRINT-MEDIA-QUERY-012) ──
  // Server-rendered print HTML (from openStandalone) is injected into a
  // hidden `.print-only` div, then window.print() fires on the SAME page
  // (no new tab/window). The local print CSS below hides the in-page
  // `.print-area` preview whenever `.print-only` is present.
  const [printHtml, setPrintHtml] = React.useState('')
  const { lang } = useLang()

  const detailQuery = useQuery<WorkOrderDetail>({
    queryKey: ['wo-print', workOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrderId}`)
      if (!res.ok) throw new Error('โหลดใบงานไม่สำเร็จ')
      const json = await res.json()
      return json.data as WorkOrderDetail
    },
    enabled: Boolean(workOrderId),
  })

  const partsQuery = useQuery<PartsListResponse>({
    queryKey: ['wo-print-parts', workOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrderId}/parts`)
      if (!res.ok) throw new Error('โหลดรายการอะไหล่ไม่สำเร็จ')
      return (await res.json()) as PartsListResponse
    },
    enabled: Boolean(workOrderId),
  })

  const wo = detailQuery.data
  const parts = partsQuery.data?.data ?? []

  function handlePrint() {
    window.print()
  }

  async function openStandalone() {
    if (!wo) return
    const url = `/api/work-orders/${wo.id}/print?paper=${paper}`
    // ── Fetch the server-rendered print page and inject it into the
    // hidden `.print-only` container, then fire window.print() on the
    // SAME page (Task ID: PRINT-MEDIA-QUERY-012). No new tab/window. ──
    try {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error('โหลดหน้าพิมพ์ไม่สำเร็จ')
      }
      const html = await res.text()
      setPrintHtml(html)
      setTimeout(() => window.print(), 50)
      setTimeout(() => setPrintHtml(''), 1000)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'เปิดหน้าพิมพ์ไม่สำเร็จ',
      )
    }
  }

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (detailQuery.error || !wo) {
    return (
      <div className="p-6 text-center text-sm text-rose-600 dark:text-rose-400">
        {detailQuery.error instanceof Error
          ? detailQuery.error.message
          : 'ไม่พบใบงาน'}
      </div>
    )
  }

  const external = parseExternalMeta(wo.externalMeta)
  const todayLabel = new Date().toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const imgBefore = isImageUrl(wo.picBefore) ? wo.picBefore : null
  const imgOnsite = isImageUrl(wo.picOnsite) ? wo.picOnsite : null
  const imgAfter = isImageUrl(wo.picAfter) ? wo.picAfter : null
  const hasImages = Boolean(imgBefore || imgOnsite || imgAfter)

  return (
    <div className="wo-print-root flex flex-col">
      {/* === Controls bar (hidden on print) === */}
      <div className="print-hide flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-semibold">พิมพ์ใบแจ้งซ่อม</span>
          <Badge variant="outline" className="ml-1 font-mono text-[11px]">
            {wo.woNumber ?? '—'}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">ขนาดกระดาษ:</span>
            <Select value={paper} onValueChange={(v) => setPaper(v as PaperKey)}>
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a4-portrait">A4 แนวตั้ง</SelectItem>
                <SelectItem value="a4-landscape">A4 แนวนอน</SelectItem>
                <SelectItem value="a5-portrait">A5 แนวตั้ง</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={openStandalone}
            className="h-8"
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            เปิดหน้าใหม่
          </Button>
          <Button
            size="sm"
            onClick={handlePrint}
            className="h-8 bg-orange-500 hover:bg-orange-600"
          >
            <Printer className="mr-1 h-3.5 w-3.5" />
            พิมพ์
          </Button>
        </div>
      </div>

      {/* === Scrollable preview === */}
      <div className="print-scroll bg-slate-200/60 p-4 dark:bg-slate-900/40">
        <div
          className="print-area mx-auto bg-white shadow-lg"
          style={{
            width: spec.previewWidth,
            maxWidth: '100%',
            minHeight: 'auto',
            padding: '14mm 12mm',
            fontSize: spec.fontSize,
            color: '#1e293b',
            fontFamily:
              "'Segoe UI', 'Thonburi', 'Tahoma', sans-serif",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between gap-3 border-b-2 border-slate-900 pb-2"
            style={{ pageBreakAfter: 'avoid' }}
          >
            <div
              className="flex h-12 w-12 items-center justify-center rounded-lg text-2xl font-bold text-white"
              style={{ background: '#f97316' }}
            >
              ซ
            </div>
            <div className="flex-1 text-center">
              <h1 className="text-xl font-bold text-slate-900">ใบแจ้งซ่อม</h1>
              <div className="text-[11px] text-slate-500">
                Work Order Form • ระบบจัดการสินทรัพย์
              </div>
            </div>
            <div className="text-right text-[11px] text-slate-600">
              <div className="font-mono text-[13px] font-bold text-slate-900">
                {wo.woNumber ?? '—'}
              </div>
              <div>วันที่แจ้ง: {formatDateOnly(wo.createdAt)}</div>
              <div>พิมพ์เมื่อ: {todayLabel}</div>
            </div>
          </div>

          {/* Info section */}
          <SectionTitle icon={<Wrench className="h-3.5 w-3.5" />}>
            ข้อมูลการแจ้ง
          </SectionTitle>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <PrintInfoRow
              icon={<User className="h-3 w-3" />}
              label="ผู้แจ้ง"
              value={wo.reporterName ?? '—'}
            />
            <PrintInfoRow
              icon={<Phone className="h-3 w-3" />}
              label="เบอร์โทร"
              value={wo.tel ?? '—'}
            />
            <PrintInfoRow
              icon={<Building2 className="h-3 w-3" />}
              label="อาคาร / ฝ่าย"
              value={wo.building ?? '—'}
            />
            <PrintInfoRow
              icon={<MapPin className="h-3 w-3" />}
              label="สถานที่"
              value={wo.location ?? '—'}
            />
            <PrintInfoRow
              icon={<Wrench className="h-3 w-3" />}
              label="หัวข้อ"
              value={wo.subject}
            />
            <PrintInfoRow
              icon={<Hash className="h-3 w-3" />}
              label="รหัสพนักงาน"
              value={wo.employeeCode ?? '—'}
            />
            <PrintInfoRow
              icon={<AlertTriangle className="h-3 w-3" />}
              label="ความเร่งด่วน"
              value={wo.priority}
            />
            <PrintInfoRow
              icon={<CheckCircle2 className="h-3 w-3" />}
              label="สถานะ"
              value={statusLabel(wo.status)}
            />
          </div>

          {wo.details && (
            <>
              <SectionTitle>รายละเอียดปัญหา</SectionTitle>
              <p className="whitespace-pre-wrap text-[13px]">{wo.details}</p>
            </>
          )}

          {/* External section */}
          {external && (
            <>
              <SectionTitle icon={<PackageOpen className="h-3.5 w-3.5" />}>
                ข้อมูลลูกค้าภายนอก
              </SectionTitle>
              <div
                className="rounded-md border p-2"
                style={{
                  borderColor: '#5eead4',
                  background: '#f0fdfa',
                }}
              >
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <PrintInfoRow
                    label="ลูกค้า"
                    value={external.clientName ?? '—'}
                  />
                  <PrintInfoRow
                    label="สถานที่"
                    value={external.place ?? '—'}
                  />
                  <PrintInfoRow
                    label="เบอร์ติดต่อ"
                    value={external.contactPhone ?? '—'}
                  />
                  <PrintInfoRow
                    label="S/N"
                    value={(external.serials ?? []).join(', ') || '—'}
                  />
                </div>
              </div>
            </>
          )}

          {/* Device section */}
          {wo.device && (
            <>
              <SectionTitle icon={<ClipboardList className="h-3.5 w-3.5" />}>
                ข้อมูลอุปกรณ์
              </SectionTitle>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <PrintInfoRow
                    label="เลขทะเบียน"
                    value={wo.device.assetCode}
                    mono
                  />
                  <PrintInfoRow
                    label="ยี่ห้อ / รุ่น"
                    value={`${wo.device.brand} ${wo.device.model}`}
                  />
                  <PrintInfoRow
                    label="Serial Number"
                    value={wo.device.serialNumber ?? '—'}
                  />
                  <PrintInfoRow
                    label="สาขา"
                    value={wo.device.site}
                  />
                </div>
              </div>
            </>
          )}

          {/* Assignment section */}
          <SectionTitle icon={<User className="h-3.5 w-3.5" />}>
            การมอบหมาย
          </SectionTitle>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <PrintInfoRow
              label="มอบหมายให้"
              value={wo.assignedTo ?? '—'}
            />
            <PrintInfoRow
              label="มอบหมายโดย"
              value={wo.assignedBy ?? '—'}
            />
            <PrintInfoRow
              icon={<CalendarClock className="h-3 w-3" />}
              label="วันที่มอบหมาย"
              value={formatDateTime(wo.assignedAt)}
            />
            <PrintInfoRow
              icon={<CheckCircle2 className="h-3 w-3" />}
              label="วันที่เสร็จ"
              value={formatDateTime(wo.workCompletedAt)}
            />
          </div>
          {wo.assignmentNote && (
            <div
              className="mt-2 rounded-md border p-2 text-[12px]"
              style={{
                borderColor: '#fdba74',
                background: '#fff7ed',
              }}
            >
              <strong>หมายเหตุการมอบหมาย:</strong> {wo.assignmentNote}
            </div>
          )}

          {/* Work section */}
          <SectionTitle icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
            ผลการแก้ไข
          </SectionTitle>
          {wo.resolution ? (
            <div
              className="rounded-md border p-2 text-[13px]"
              style={{
                borderColor: '#6ee7b7',
                background: '#ecfdf5',
              }}
            >
              {wo.resolutionGroup && (
                <div className="mb-0.5 text-[11px] font-semibold text-emerald-700">
                  {wo.resolutionGroup}
                </div>
              )}
              <div className="whitespace-pre-wrap">{wo.resolution}</div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 p-2 text-center text-[11px] text-slate-400">
              ยังไม่ได้ระบุผลการแก้ไข
            </div>
          )}
          {wo.detailsAdmin && (
            <div
              className="mt-2 rounded-md border p-2 text-[12px]"
              style={{
                borderColor: '#fdba74',
                background: '#fff7ed',
              }}
            >
              <strong>หมายเหตุช่าง:</strong> {wo.detailsAdmin}
            </div>
          )}
          {wo.status === 'CANCELLED' && wo.cancelReason && (
            <div
              className="mt-2 rounded-md border p-2 text-[12px]"
              style={{
                borderColor: '#fca5a5',
                background: '#fef2f2',
              }}
            >
              <strong>เหตุผลการยกเลิก:</strong> {wo.cancelReason}
            </div>
          )}

          {/* Parts section */}
          <SectionTitle icon={<Box className="h-3.5 w-3.5" />}>
            รายการเบิกอะไหล่ ({parts.length})
          </SectionTitle>
          {parts.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-2 text-center text-[11px] text-slate-400">
              ไม่มีรายการเบิกอะไหล่สำหรับใบงานนี้
            </div>
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-slate-100 text-[11px] text-slate-600">
                  <th className="border border-slate-200 px-1.5 py-1 text-left">
                    เลขที่
                  </th>
                  <th className="border border-slate-200 px-1.5 py-1 text-left">
                    รหัส
                  </th>
                  <th className="border border-slate-200 px-1.5 py-1 text-left">
                    รายการ
                  </th>
                  <th className="border border-slate-200 px-1.5 py-1 text-right">
                    จำนวน
                  </th>
                  <th className="border border-slate-200 px-1.5 py-1 text-left">
                    สถานะ
                  </th>
                  <th className="border border-slate-200 px-1.5 py-1 text-left">
                    วันที่
                  </th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => (
                  <tr key={p.id}>
                    <td className="border border-slate-200 px-1.5 py-1 font-mono text-[11px]">
                      {p.txnNumber ?? '—'}
                    </td>
                    <td className="border border-slate-200 px-1.5 py-1 font-mono text-[11px]">
                      {p.productCode ?? p.stockItem?.productCode ?? '—'}
                    </td>
                    <td className="border border-slate-200 px-1.5 py-1">
                      {p.productName ?? p.stockItem?.productName ?? '—'}
                    </td>
                    <td className="border border-slate-200 px-1.5 py-1 text-right">
                      {p.quantity} {p.unit ?? ''}
                    </td>
                    <td className="border border-slate-200 px-1.5 py-1">
                      {p.approvalStatus ?? 'APPROVED'}
                    </td>
                    <td className="border border-slate-200 px-1.5 py-1 text-[11px]">
                      {formatDateOnly(p.txnDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Images section */}
          {hasImages && (
            <>
              <SectionTitle icon={<ImageIcon className="h-3.5 w-3.5" />}>
                รูปภาพ
              </SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                <PrintImageCell label="ก่อน" src={imgBefore} />
                <PrintImageCell label="หน้างาน" src={imgOnsite} />
                <PrintImageCell label="หลัง" src={imgAfter} />
              </div>
            </>
          )}

          {/* Signatures section */}
          <SectionTitle icon={<User className="h-3.5 w-3.5" />}>
            ลายเซ็น
          </SectionTitle>
          <div
            className="grid grid-cols-3 gap-4 pt-8"
            style={{ pageBreakInside: 'avoid' }}
          >
            {['ผู้แจ้ง', 'ช่างผู้ซ่อม', 'ผู้อนุมัติ'].map((label) => (
              <div key={label} className="text-center">
                <div
                  className="mt-10 border-t border-slate-900 pt-1 text-[11px] text-slate-600"
                  style={{ borderTopWidth: 1 }}
                >
                  {label}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">
                  วันที่: ………/………/………
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-4 flex justify-between border-t border-slate-200 pt-1 text-[10px] text-slate-400">
            <span>เลขใบงาน: {wo.woNumber ?? '—'}</span>
            <span>พิมพ์เมื่อ {todayLabel}</span>
          </div>
        </div>
      </div>

      {/* === Print CSS (scoped via class) === */}
      <style jsx global>{`
        @media print {
          /* Hide everything outside the print area */
          body * {
            visibility: hidden;
          }
          .print-area,
          .print-area * {
            visibility: visible;
          }
          /* When a standalone \`.print-only\` container is active
             (openStandalone path), suppress the in-page preview so
             only the server-rendered HTML shows. (PRINT-MEDIA-QUERY-012) */
          body:has(.print-only) .print-area,
          body:has(.print-only) .print-area * {
            visibility: hidden !important;
          }
          /* Hide on-screen controls + scroll wrapper chrome */
          .print-hide,
          .print-scroll {
            display: none !important;
            background: white !important;
            padding: 0 !important;
          }
          /* Reset the print area to the page top */
          .print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            max-width: 100% !important;
            box-shadow: none !important;
            padding: 0 !important;
          }
          /* Page size — driven by the selected paper */
          @page {
            size: ${spec.pageRule};
            margin: 12mm;
          }
          /* Avoid breaking inside sections */
          h2,
          table,
          .signatures,
          .print-info-row,
          [data-slot='card'] {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          h2 {
            page-break-after: avoid;
            break-after: avoid;
          }
        }
      `}</style>

      {/* ── Hidden print container (Task ID: PRINT-MEDIA-QUERY-012) ──
           Injects the server-rendered print HTML and is revealed only in
           @media print via the global `.print-only` rule in globals.css.
           Used by the “เปิดหน้าใหม่” (openStandalone) button. */}
      {printHtml && (
        <div
          className="print-only"
          dangerouslySetInnerHTML={{ __html: printHtml }}
          aria-hidden
        />
      )}
    </div>
  )
}

// ── Sub-components ──

function SectionTitle({
  children,
  icon,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <h2
      className="mt-3 flex items-center gap-1.5 border-b-2 pb-1 text-[14px] font-semibold"
      style={{ color: '#0f172a', borderColor: '#fed7aa' }}
    >
      {icon && <span style={{ color: '#f97316' }}>{icon}</span>}
      {children}
    </h2>
  )
}

function PrintInfoRow({
  label,
  value,
  icon,
  mono,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  mono?: boolean
}) {
  return (
    <div
      className="print-info-row flex flex-col border-b border-dotted border-slate-200 py-0.5"
      style={{ pageBreakInside: 'avoid' }}
    >
      <span className="text-[10px] uppercase tracking-wide text-slate-500">
        {icon && <span className="mr-1 inline-block align-middle">{icon}</span>}
        {label}
      </span>
      <span
        className={`text-[13px] font-medium text-slate-900 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

function PrintImageCell({
  label,
  src,
}: {
  label: string
  src: string | null
}) {
  return (
    <div
      className="rounded border border-slate-200 p-1 text-center"
      style={{ pageBreakInside: 'avoid' }}
    >
      <div className="mb-0.5 text-[10px] text-slate-500">{label}</div>
      {src ? (
        <img
          src={src}
          alt={label}
          style={{
            maxWidth: '100%',
            height: '120px',
            objectFit: 'cover',
            borderRadius: 3,
          }}
        />
      ) : (
        <div
          style={{
            height: '120px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: '11px',
          }}
        >
          ไม่มีรูป
        </div>
      )}
    </div>
  )
}
