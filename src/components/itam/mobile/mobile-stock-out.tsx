'use client'

/**
 * MobileStockOut — mobile-first "เบิกของ" (Stock Out / Issue) screen.
 *
 * Flow:
 *   1. Sticky search bar — search stock items by name/code/brand via
 *      GET /api/stock-items?search=Q&pageSize=50.
 *   2. List of stock items (cards): productCode, productName, brand,
 *      quantity remaining, unit, low-stock badge if quantity ≤ minQuantity.
 *   3. Tap an item → opens bottom sheet (Sheet side="bottom") with the
 *      issue form:
 *        - Show current quantity + unit
 *        - Numeric input for quantity (max = item.quantity)
 *        - Optional: search field for linking a work order (debounced
 *          GET /api/work-orders?search=WO-...&pageSize=10 → dropdown)
 *        - Optional: requester + remark
 *        - Confirm button → POST /api/stock-items/[id]/transaction
 *   4. Success → toast + sheet swaps to success view showing txnNumber,
 *      balance after, product info; then user can close and the list
 *      re-fetches (so the remaining qty updates).
 *   5. Optional expandable "รออนุมัติ" section at the bottom showing recent
 *      pending stock-out requests via
 *      GET /api/stock-items/pending?status=PENDING&pageSize=20.
 *
 * Touch targets: every button is h-12 (≥44px); inputs are h-12.
 *
 * Responsive: full-width on phones (max-w-md wrapper from the shell);
 * list uses `max-h-[55vh] overflow-y-auto` so the bottom sheet (which is
 * position: fixed) does not fight the page scroll.
 *
 * Accessibility:
 *   - All inputs have <Label> (with htmlFor) + aria-required.
 *   - Touch-friendly hit areas (≥44px).
 *   - Error messages announced via role="alert".
 *   - Loading state has aria-busy + a spinner.
 *
 * API contract (Bearer token attached by the global fetch interceptor in
 * app/page.tsx — covers /api/stock-items, /api/work-orders):
 *   GET    /api/stock-items?search=&pageSize=
 *        → { data: StockItem[], pagination, stats }
 *        StockItem shape (selected fields used here):
 *          id, productCode, productName, category, brand, model, unit,
 *          quantity, minQuantity, maxQuantity, location, site, active
 *   GET    /api/stock-items/pending?status=PENDING&pageSize=
 *        → { data: StockTransaction[], pagination }
 *   GET    /api/work-orders?search=&pageSize=
 *        → { data: WorkOrder[], pagination, stats }
 *        WorkOrder shape (selected fields):
 *          id, woNumber, subject, status, reporterName, createdAt
 *   POST   /api/stock-items/[id]/transaction
 *          body: { type: 'OUT', quantity, workOrderId?, workOrderNo?,
 *                  requester?, department?, purpose?, remark?, receiver?,
 *                  performedBy?, txnDate? }
 *        → 201 { data: { item, transaction, poUpdate } }
 *          transaction.txnNumber is the success-code we display.
 *        → 400 { error }  (e.g. "สต็อกไม่เพียงพอ (คงเหลือ N ชิ้น)")
 *        → 404 { error: 'Not found' }
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  Search,
  X,
  Loader2,
  AlertCircle,
  ChevronRight,
  RefreshCw,
  PackageOpen,
  Package,
  AlertTriangle,
  CheckCircle2,
  Hash,
  ClipboardList,
  Inbox,
  RotateCcw,
  Minus,
  Plus,
  Link2,
  Unlink,
  QrCode,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth-store'
import { useLang } from '@/store/i18n-store'
import { useKeyboardAware } from '@/hooks/use-keyboard-aware'
import { QrScannerDialog } from '@/components/itam/qr-scanner-dialog'
import { addToQueue } from '@/lib/offline-queue'
import { bearerHeaders } from '@/lib/http-headers'

// ── Types ─────────────────────────────────────────────────────────────

interface StockItemLite {
  id: string
  productCode: string
  productName: string
  category: string | null
  brand: string | null
  model: string | null
  unit: string
  quantity: number
  minQuantity: number
  maxQuantity: number
  location: string | null
  site: string | null
  active: boolean
}

interface StockListResponse {
  data: StockItemLite[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  stats: {
    total: number
    lowStock: number
    totalValue: number
    thisMonth: number
  }
}

interface WorkOrderLite {
  id: string
  woNumber: string | null
  subject: string
  status: string
  reporterName: string | null
  createdAt: string
}

interface WorkOrderSearchResponse {
  data: WorkOrderLite[]
  pagination: { total: number }
}

interface PendingTxn {
  id: string
  txnNumber: string | null
  productCode: string | null
  productName: string | null
  quantity: number
  type: string
  approvalStatus: string | null
  requester: string | null
  workOrderNo: string | null
  createdAt: string
  stockItem?: {
    productCode: string
    productName: string
    unit: string
    quantity: number
    active: boolean
  } | null
}

interface PendingResponse {
  data: PendingTxn[]
  pagination: { total: number }
}

interface TxnResponse {
  data: {
    item: StockItemLite
    transaction: {
      id: string
      txnNumber: string | null
      quantity: number
      balanceAfter: number
      type: string
      approvalStatus: string | null
    }
    poUpdate: unknown
  }
}

// ── Constants ─────────────────────────────────────────────────────────

const PAGE_SIZE = 50

// ── Component ─────────────────────────────────────────────────────────

export function MobileStockOut() {
  // ── Data state ──
  const [items, setItems] = React.useState<StockItemLite[]>([])
  const [stats, setStats] = React.useState<{ lowStock: number; total: number } | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // ── UI state ──
  const [searchTerm, setSearchTerm] = React.useState('')
  const [selected, setSelected] = React.useState<StockItemLite | null>(null)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  // QR/barcode scan dialog state (Task ID: UX-GAPS-3-ITEMS).
  // On scan: drop the code into the search box — the debounced reload
  // filters the list so the user can tap the matching item.
  const [scanOpen, setScanOpen] = React.useState(false)

  // ── Pending approvals ──
  const [pending, setPending] = React.useState<PendingTxn[]>([])
  const [showPending, setShowPending] = React.useState(false)
  const [pendingLoading, setPendingLoading] = React.useState(false)
  const { lang } = useLang()

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fetch stock items ──
  const loadItems = React.useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    if (!opts.silent) setError(null)
    try {
      const params = new URLSearchParams({
        pageSize: String(PAGE_SIZE),
        activeOnly: '1',
      })
      const q = searchTerm.trim()
      if (q) params.set('search', q)
      const res = await fetch(`/api/stock-items?${params.toString()}`, {
        headers: bearerHeaders(useAuthStore.getState()?.token),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'โหลดรายการไม่สำเร็จ')
      }
      const json = (await res.json()) as StockListResponse
      setItems(json.data ?? [])
      setStats({
        lowStock: json.stats?.lowStock ?? 0,
        total: json.stats?.total ?? 0,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'โหลดรายการไม่สำเร็จ'
      setError(msg)
      if (opts.silent) toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [searchTerm])

  // Debounced search reload
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void loadItems({ silent: false })
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [loadItems])

  // ── Load pending approvals ──
  const loadPending = React.useCallback(async () => {
    setPendingLoading(true)
    try {
      const res = await fetch(
        `/api/stock-items/pending?${new URLSearchParams({
          status: 'PENDING',
          pageSize: '20',
        }).toString()}`,
        {
          headers: bearerHeaders(useAuthStore.getState()?.token),
        },
      )
      if (!res.ok) {
        throw new Error('โหลดรายการรออนุมัติไม่สำเร็จ')
      }
      const json = (await res.json()) as PendingResponse
      setPending(json.data ?? [])
    } catch {
      // Silent — pending list is best-effort.
      setPending([])
    } finally {
      setPendingLoading(false)
    }
  }, [])

  // ── Open the issue sheet for a given item ──
  function openIssue(item: StockItemLite) {
    setSelected(item)
    setSheetOpen(true)
  }

  // ── After a successful transaction ──
  function onIssued(updatedItem: StockItemLite, txnNumber: string | null) {
    // Update the local list with the new quantity.
    setItems((prev) =>
      prev.map((it) => (it.id === updatedItem.id ? { ...it, quantity: updatedItem.quantity } : it)),
    )
    toast.success(`เบิกออกสำเร็จ${txnNumber ? ` · ${txnNumber}` : ''}`)
    // Refresh pending list silently so the new request shows up.
    void loadPending()
  }

  // ── Scan handler (Task ID: UX-GAPS-3-ITEMS) ──
  // Drop the scanned code into the search box; the debounced reload
  // narrows the list. If exactly one item matches, auto-open the issue
  // sheet for it so the user can complete the issue in one tap.
  function handleScanResult(code: string) {
    setScanOpen(false)
    const v = code.trim()
    if (!v) return
    setSearchTerm(v)
    // Defer the auto-pick so the items list has time to refresh.
    setTimeout(() => {
      setItems((prev) => {
        const lower = v.toLowerCase()
        const match =
          prev.find((it) => it.productCode.toLowerCase() === lower) ??
          prev.find((it) => it.productCode.toLowerCase().includes(lower)) ??
          prev.find((it) => it.productName.toLowerCase().includes(lower))
        if (match && match.quantity > 0) {
          setSelected(match)
          setSheetOpen(true)
        } else if (match && match.quantity <= 0) {
          toast.error(`สินค้า "${match.productName}" หมดสต็อก`)
        }
        return prev
      })
    }, 450)
  }

  // ── Render: loading ──
  if (loading) {
    return <LoadingState />
  }

  // ── Render: error ──
  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => void loadItems({ silent: false })}
      />
    )
  }

  // ── Render: main ──
  return (
    <div className="flex flex-col gap-3">
      {/* ── Stats card ── */}
      <Card className="gap-0 py-0">
        <CardContent className="px-0 py-0">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-300">
                <PackageOpen className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-none">
                  คลังอะไหล่/ supplies
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stats?.total ?? items.length} รายการ
                  {stats && stats.lowStock > 0 && (
                    <>
                      {' · '}
                      <span className="text-amber-600">{stats.lowStock} ใกล้หมด</span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadItems({ silent: false })}
              aria-label="รีเฟรช"
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── Sticky search bar ── */}
      <div className="sticky top-14 z-10 -mx-3 bg-background/95 px-3 pb-1 pt-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              inputMode="search"
              autoComplete="off"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="รหัสสินค้า / ชื่อ / ยี่ห้อ"
              aria-label="ค้นหารายการสินค้า"
              className="h-12 rounded-lg pl-9 pr-9 text-base"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label="ล้างคำค้นหา"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setScanOpen(true)}
            aria-label="สแกน QR/บาร์โค้ด"
            title="สแกน QR/บาร์โค้ดเพื่อค้นหาสินค้า"
            className="h-12 shrink-0 border-orange-300 px-3 text-orange-700 hover:bg-orange-50 hover:text-orange-800 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/40"
          >
            <QrCode className="h-5 w-5" />
          </Button>
        </div>
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">
          แสดง {items.length} รายการ
          {searchTerm ? ` (กรอง "${searchTerm}")` : ''}
        </p>
      </div>

      {/* ── Stock list ── */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center">
          <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">ไม่พบสินค้าที่ตรงกัน</p>
          <p className="mt-1 text-xs text-muted-foreground">
            ลองเปลี่ยนคำค้นหา หรือกดรีเฟรช
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => {
            const low = it.quantity <= it.minQuantity
            const out = it.quantity <= 0
            return (
              <Card key={it.id} className="gap-0 py-0">
                <CardContent className="px-0 py-0">
                  <button
                    type="button"
                    onClick={() => openIssue(it)}
                    disabled={out}
                    aria-label={`เบิก ${it.productName}`}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                      out
                        ? 'cursor-not-allowed opacity-60'
                        : 'hover:bg-muted/60 active:bg-muted',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
                        out
                          ? 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-300'
                          : low
                            ? 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300',
                      )}
                    >
                      {out ? (
                        <AlertTriangle className="h-5 w-5" />
                      ) : (
                        <Package className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-xs font-semibold text-orange-600">
                          {it.productCode}
                        </span>
                        <span className="truncate text-sm font-medium">
                          {it.productName}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[it.brand, it.model, it.category].filter(Boolean).join(' · ') || '—'}
                        {it.location ? ` · ที่เก็บ ${it.location}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={cn(
                          'font-mono text-sm font-semibold',
                          out
                            ? 'text-rose-600'
                            : low
                              ? 'text-amber-600'
                              : 'text-emerald-600',
                        )}
                      >
                        {(it.quantity ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}{' '}
                        <span className="text-xs text-muted-foreground">{it.unit}</span>
                      </span>
                      {out ? (
                        <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 text-[10px]">
                          หมด
                        </Badge>
                      ) : low ? (
                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 text-[10px]">
                          ใกล้หมด
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          พร้อมเบิก
                        </Badge>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  </button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Pending approvals (collapsible) ── */}
      <Card className="gap-0 py-0">
        <CardContent className="px-0 py-0">
          <button
            type="button"
            onClick={() => {
              const next = !showPending
              setShowPending(next)
              if (next && pending.length === 0) void loadPending()
            }}
            aria-expanded={showPending}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-300">
              <ClipboardList className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold leading-none">รออนุมัติ</p>
              <p className="mt-1 text-xs text-muted-foreground">
                รายการเบิกที่รอการอนุมัติ
              </p>
            </div>
            {pendingLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                {pending.length > 0 && (
                  <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/40 dark:text-sky-300">
                    {pending.length}
                  </Badge>
                )}
                <ChevronRight
                  className={cn(
                    'h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform',
                    showPending && 'rotate-90',
                  )}
                />
              </>
            )}
          </button>
          <AnimatePresence initial={false}>
            {showPending && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden border-t"
              >
                {pending.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    ไม่มีรายการรออนุมัติ
                  </div>
                ) : (
                  <ul className="max-h-72 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                    {pending.map((p) => (
                      <li
                        key={p.id}
                        className="border-b px-4 py-3 text-xs last:border-b-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-orange-600">
                            {p.txnNumber ?? '—'}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {p.type === 'OUT' ? 'เบิกออก' : p.type}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate font-medium">
                          {p.productName ?? p.stockItem?.productName ?? '—'}
                          <span className="ml-1 text-muted-foreground">
                            ({p.productCode ?? p.stockItem?.productCode ?? '—'})
                          </span>
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          จำนวน {(p.quantity ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} หน่วย
                          {p.requester ? ` · ผู้เบิก ${p.requester}` : ''}
                          {p.workOrderNo ? ` · WO ${p.workOrderNo}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* ── Issue sheet (bottom) ── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="mx-auto max-h-[90dvh] max-w-md overflow-y-auto p-0">
          {selected && (
            <IssueSheetBody
              item={selected}
              onClose={() => setSheetOpen(false)}
              onIssued={onIssued}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* QR/barcode scanner dialog (Task ID: UX-GAPS-3-ITEMS) */}
      <QrScannerDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onScan={handleScanResult}
      />
    </div>
  )
}

// ── Sub-component: Issue sheet body ───────────────────────────────────

interface IssueSheetBodyProps {
  item: StockItemLite
  onClose: () => void
  onIssued: (updatedItem: StockItemLite, txnNumber: string | null) => void
}

function IssueSheetBody({ item, onClose, onIssued }: IssueSheetBodyProps) {
  const { lang } = useLang()
  const user = useAuthStore((s) => s.user)

  const [quantity, setQuantity] = React.useState('1')
  const [requester, setRequester] = React.useState('')
  const [remark, setRemark] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<{
    txnNumber: string | null
    balanceAfter: number
    quantity: number
  } | null>(null)

  // ── Work-order linking state ──
  const [woSearch, setWoSearch] = React.useState('')
  const [woResults, setWoResults] = React.useState<WorkOrderLite[]>([])
  const [woSearching, setWoSearching] = React.useState(false)
  const [linkedWo, setLinkedWo] = React.useState<WorkOrderLite | null>(null)
  const [showWoDropdown, setShowWoDropdown] = React.useState(false)
  const woDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const woDropdownRef = React.useRef<HTMLDivElement>(null)

  const qtyNum = parseQty(quantity)
  const maxQty = Math.max(0, item.quantity)
  const tooMuch = qtyNum !== null && qtyNum > maxQty
  const canSubmit =
    qtyNum !== null &&
    qtyNum > 0 &&
    !tooMuch &&
    !submitting &&
    success === null

  // ── Work-order search (debounced) ──
  React.useEffect(() => {
    const q = woSearch.trim()
    if (!q || q.length < 1) {
      setWoResults([])
      setWoSearching(false)
      return
    }
    if (woDebounceRef.current) clearTimeout(woDebounceRef.current)
    woDebounceRef.current = setTimeout(async () => {
      setWoSearching(true)
      try {
        const res = await fetch(
          `/api/work-orders?${new URLSearchParams({
            search: q,
            pageSize: '10',
          }).toString()}`,
          {
            headers: bearerHeaders(useAuthStore.getState()?.token),
          },
        )
        if (!res.ok) throw new Error('ค้นหาใบงานไม่สำเร็จ')
        const json = (await res.json()) as WorkOrderSearchResponse
        setWoResults(json.data ?? [])
        setShowWoDropdown(true)
      } catch {
        setWoResults([])
      } finally {
        setWoSearching(false)
      }
    }, 300)
    return () => {
      if (woDebounceRef.current) clearTimeout(woDebounceRef.current)
    }
  }, [woSearch])

  // ── Click-outside to close WO dropdown ──
  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (woDropdownRef.current && !woDropdownRef.current.contains(e.target as Node)) {
        setShowWoDropdown(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // ── Submit ──
  async function handleSubmit() {
    setError(null)
    if (qtyNum === null || qtyNum <= 0) {
      setError('กรุณาระบุจำนวนที่ต้องการเบิก')
      return
    }
    if (qtyNum > maxQty) {
      setError(`สต็อกไม่พอ (คงเหลือ ${maxQty} ${item.unit})`)
      return
    }
    setSubmitting(true)
    // Declare outside try so the catch block can read it for offline-queue fallback.
    let body: Record<string, unknown> | null = null
    try {
      body = {
        type: 'OUT',
        quantity: qtyNum,
        txnDate: new Date().toISOString().slice(0, 10),
      }
      if (linkedWo) {
        body.workOrderId = linkedWo.id
        if (linkedWo.woNumber) body.workOrderNo = linkedWo.woNumber
      }
      if (requester.trim()) body.requester = requester.trim()
      if (remark.trim()) body.remark = remark.trim()
      // Auto-fill requester from logged-in user if not provided.
      if (!requester.trim() && user) {
        body.requester = user.name ?? user.username ?? user.email
      }
      // performedBy = current user
      if (user?.email) body.performedBy = user.email

      const res = await fetch(
        `/api/stock-items/${encodeURIComponent(item.id)}/transaction`,
        {
          method: 'POST',
          headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? 'เบิกของไม่สำเร็จ')
      }
      const json = (await res.json()) as TxnResponse
      const updatedItem: StockItemLite = {
        ...item,
        quantity: json.data.item.quantity,
      }
      setSuccess({
        txnNumber: json.data.transaction.txnNumber ?? null,
        balanceAfter: json.data.transaction.balanceAfter,
        quantity: qtyNum,
      })
      onIssued(updatedItem, json.data.transaction.txnNumber ?? null)
    } catch (e) {
      // Offline queue fallback — only when the network is actually down,
      // not on server-side errors (e.g. "สต็อกไม่พอ").
      if (!navigator.onLine && body) {
        addToQueue({
          url: `/api/stock-items/${encodeURIComponent(item.id)}/transaction`,
          method: 'POST',
          body,
          label: `เบิกของ: ${item.productName} ×${qtyNum ?? 0} ${item.unit ?? ''}`.trim(),
        })
        toast.success('บันทึกไว้ในคิว จะส่งอัตโนมัติเมื่อออนไลน์')
        // Close the sheet so the technician can scan the next item; the
        // queue will replay the transaction when connectivity returns.
        onClose()
        return
      }
      setError(e instanceof Error ? e.message : 'เบิกของไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Reset state when item changes ──
  React.useEffect(() => {
    setQuantity('1')
    setRequester('')
    setRemark('')
    setWoSearch('')
    setLinkedWo(null)
    setWoResults([])
    setSubmitting(false)
    setError(null)
    setSuccess(null)
  }, [item.id])

  // ── Stepper buttons ──
  function step(delta: number) {
    const cur = qtyNum ?? 0
    const next = Math.max(1, Math.min(maxQty, cur + delta))
    setQuantity(String(next))
  }

  // ── Render: success view ──
  if (success) {
    return (
      <div className="flex flex-col items-center px-4 py-6 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-10 w-10" />
        </motion.div>
        <h2 className="mt-3 text-base font-semibold">เบิกออกสำเร็จ</h2>
        {success.txnNumber && (
          <div className="mt-3 w-full rounded-lg border bg-muted/30 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              เลขรายการ
            </p>
            <p className="mt-0.5 break-all font-mono text-xl font-bold text-orange-600">
              {success.txnNumber}
            </p>
          </div>
        )}
        <div className="mt-3 w-full space-y-1.5 text-left text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">สินค้า</span>
            <span className="max-w-[60%] truncate font-medium">{item.productName}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">จำนวนที่เบิก</span>
            <span className="font-mono font-medium">
              {success.quantity.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} {item.unit}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">คงเหลือ</span>
            <span className="font-mono font-medium text-emerald-600">
              {(success.balanceAfter ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} {item.unit}
            </span>
          </div>
        </div>
        <Button
          type="button"
          onClick={onClose}
          className="mt-5 h-12 w-full bg-orange-500 hover:bg-orange-600"
        >
          เสร็จสิ้น
        </Button>
      </div>
    )
  }

  // ── Render: form view ──
  return (
    <>
      <SheetHeader className="px-4 pb-2 pt-4">
        <SheetTitle className="text-base">เบิกสินค้าออก</SheetTitle>
        <SheetDescription className="text-xs">
          กรอกจำนวนที่ต้องการเบิก และเชื่อมใบงาน (ถ้ามี)
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-4 px-4 py-3">
        {/* Item info */}
        <div className="rounded-lg border bg-muted/40 p-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-orange-600">
              {item.productCode}
            </span>
            <span className="text-sm font-medium">{item.productName}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[item.brand, item.model, item.category].filter(Boolean).join(' · ') || '—'}
            {item.location ? ` · ที่เก็บ ${item.location}` : ''}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">คงเหลือในสต็อก:</span>
            <span
              className={cn(
                'font-mono font-semibold',
                item.quantity <= 0
                  ? 'text-rose-600'
                  : item.quantity <= item.minQuantity
                    ? 'text-amber-600'
                    : 'text-emerald-600',
              )}
            >
              {(item.quantity ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} {item.unit}
            </span>
            {item.quantity <= item.minQuantity && item.quantity > 0 && (
              <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 text-[10px]">
                ใกล้หมด
              </Badge>
            )}
          </div>
        </div>

        {/* Quantity stepper */}
        <div className="space-y-1.5">
          <Label htmlFor="so-qty" className="text-sm font-medium">
            จำนวนที่เบิก <span className="text-rose-500">*</span>
          </Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => step(-1)}
              disabled={qtyNum !== null && qtyNum <= 1}
              aria-label="ลดจำนวน"
              className="h-12 w-12 flex-shrink-0"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              id="so-qty"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              min={1}
              max={maxQty}
              className="h-12 text-center text-lg font-mono"
              aria-required="true"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => step(1)}
              disabled={qtyNum !== null && qtyNum >= maxQty}
              aria-label="เพิ่มจำนวน"
              className="h-12 w-12 flex-shrink-0"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {qtyNum !== null && qtyNum > 0 && !tooMuch && (
            <p className="text-xs text-muted-foreground">
              ใช้ไป {qtyNum.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} {item.unit} · คงเหลือหลังเบิก{' '}
              <span className="font-mono font-medium">
                {Math.max(0, maxQty - qtyNum).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} {item.unit}
              </span>
            </p>
          )}
          {tooMuch && (
            <p role="alert" className="text-xs text-rose-600">
              จำนวนเกินสต็อก (คงเหลือ {maxQty} {item.unit})
            </p>
          )}
        </div>

        {/* Work-order link */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">
            ใบงานที่เกี่ยวข้อง{' '}
            <span className="text-muted-foreground">(ถ้ามี)</span>
          </Label>
          {linkedWo ? (
            <div className="flex items-center gap-2 rounded-lg border bg-emerald-50/60 p-2 dark:bg-emerald-950/20">
              <Link2 className="h-4 w-4 flex-shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  <span className="font-mono text-orange-600">
                    {linkedWo.woNumber ?? linkedWo.id}
                  </span>{' '}
                  · {linkedWo.subject}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {linkedWo.status} · {linkedWo.reporterName ?? '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLinkedWo(null)
                  setWoSearch('')
                }}
                aria-label="ยกเลิกการเชื่อมใบงาน"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Unlink className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div ref={woDropdownRef} className="relative">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  inputMode="search"
                  autoComplete="off"
                  value={woSearch}
                  onChange={(e) => setWoSearch(e.target.value)}
                  onFocus={() => woResults.length > 0 && setShowWoDropdown(true)}
                  placeholder="เลขใบงาน / หัวข้อ / ผู้แจ้ง"
                  aria-label="ค้นหาใบงาน"
                  className="h-11 rounded-lg pl-9 pr-9 text-base"
                />
                {woSearching && (
                  <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {woSearch && !woSearching && (
                  <button
                    type="button"
                    onClick={() => {
                      setWoSearch('')
                      setWoResults([])
                    }}
                    aria-label="ล้าง"
                    className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {showWoDropdown && woSearch.trim() && (
                <div className="mt-1 overflow-hidden rounded-lg border bg-background shadow-sm">
                  {woResults.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                      ไม่พบใบงานที่ตรงกับ “{woSearch}”
                    </div>
                  ) : (
                    <ul className="max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                      {woResults.map((wo) => (
                        <li key={wo.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setLinkedWo(wo)
                              setWoSearch('')
                              setWoResults([])
                              setShowWoDropdown(false)
                            }}
                            className="flex w-full items-center justify-between gap-2 border-b px-3 py-2.5 text-left text-xs transition-colors last:border-b-0 hover:bg-muted/60 active:bg-muted"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-mono font-semibold text-orange-600">
                                {wo.woNumber ?? wo.id}
                              </p>
                              <p className="truncate text-muted-foreground">
                                {wo.subject}
                              </p>
                            </div>
                            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Requester */}
        <div className="space-y-1.5">
          <Label htmlFor="so-requester" className="text-sm font-medium">
            ผู้เบิก <span className="text-muted-foreground">(ถ้าไม่ใช่คุณ)</span>
          </Label>
          <Input
            id="so-requester"
            type="text"
            value={requester}
            onChange={(e) => setRequester(e.target.value)}
            placeholder={user?.name ?? user?.username ?? user?.email ?? 'ชื่อผู้เบิก'}
            maxLength={100}
            className="h-11 text-base"
          />
        </div>

        {/* Remark */}
        <div className="space-y-1.5">
          <Label htmlFor="so-remark" className="text-sm font-medium">
            หมายเหตุ <span className="text-muted-foreground">(ถ้ามี)</span>
          </Label>
          <Textarea
            id="so-remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="วัตถุประสงค์ / เหตุผลการเบิก"
            rows={2}
            maxLength={500}
            className="min-h-16 text-base"
          />
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <SheetFooter className="px-4 pb-6 pt-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="h-12"
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            aria-busy={submitting}
            className="h-12 bg-orange-500 text-base font-semibold hover:bg-orange-600"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                กำลังเบิก…
              </>
            ) : (
              <>
                <PackageOpen className="mr-2 h-4 w-4" />
                เบิกออก
              </>
            )}
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col gap-3">
      <Card className="gap-0 py-0">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>
      <Skeleton className="h-12 w-full rounded-lg" />
      {[0, 1, 2, 3, 4].map((i) => (
        <Card key={i} className="gap-0 py-0">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-6 w-12" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-200 bg-rose-50/50 p-8 text-center dark:border-rose-900 dark:bg-rose-950/20">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-300">
        <AlertCircle className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
          โหลดข้อมูลไม่สำเร็จ
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
      <Button type="button" variant="outline" onClick={onRetry} className="h-11">
        <RotateCcw className="mr-2 h-4 w-4" />
        ลองอีกครั้ง
      </Button>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Parse a quantity input; returns null if empty/invalid. */
function parseQty(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.floor(n)
}
