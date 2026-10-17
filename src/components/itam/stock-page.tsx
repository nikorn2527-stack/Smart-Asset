'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { useT, useLang } from '@/store/i18n-store'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {  Package,
  AlertTriangle,
  Wallet,
  CalendarPlus,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Search,
  Eye,
  ArrowDownToLine,
  ArrowUpFromLine,
  SlidersHorizontal,
  ClipboardList,
  Package2,
  ShoppingCart,
  Clock,
  Check,
  XCircle,
  Hourglass,
  Printer,
  FileDown,
  Coins,
} from 'lucide-react'

// ---------- Types ----------

interface StockItem {
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
  unitCost: number | null
  location: string | null
  site: string | null
  compatibleDevices: string | null
  remark: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

interface StockTransaction {
  id: string
  txnNumber: string | null
  stockItemId: string
  productCode: string | null
  productName: string | null
  type: string
  quantity: number
  unit: string | null
  balanceAfter: number
  reason: string | null
  requester: string | null
  department: string | null
  purpose: string | null
  approver: string | null
  approvedAt: string | null
  workOrderNo: string | null
  vendor: string | null
  receiver: string | null
  purchaseOrderNo: string | null
  cost: number | null
  unitCost: number | null
  txnDate: string
  performedBy: string | null
  remark: string | null
  createdAt: string
}

interface PendingStockTransaction extends StockTransaction {
  workOrderId: string | null
  approvalStatus: string | null
  approvalMode: string | null
  autoApproveAt: string | null
  rejectReason: string | null
  stockItem?: {
    productCode: string
    productName: string
    unit: string
    quantity: number
    active: boolean
  } | null
}

interface PendingListResponse {
  data: PendingStockTransaction[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

interface StockItemDetail extends StockItem {
  transactions: StockTransaction[]
}

interface StockStats {
  total: number
  lowStock: number
  totalValue: number
  thisMonth: number
}

interface StockListResponse {
  data: StockItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  stats: StockStats
}

interface PurchaseOrderItem {
  id: string
  stockItemId: string
  quantityOrdered: number
  quantityReceived: number
  unitPrice: number | null
  totalValue: number | null
  stockItem: {
    productCode: string
    productName: string
    unit: string
  } | null
}

interface PurchaseOrder {
  id: string
  poNumber: string | null
  orderDate: string
  supplier: string | null
  status: string
  totalValue: number | null
  createdBy: string | null
  remark: string | null
  createdAt: string
  items?: PurchaseOrderItem[]
}

interface PurchaseOrderListResponse {
  data: PurchaseOrder[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

// ---------- Helpers ----------

// Values are persisted on StockItem.category in the DB — keep them stable.
// Only the Thai display labels are shown in filter/form selects.
const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'InkPrint', label: 'หมึกพิมพ์' },
  { value: 'Paper', label: 'กระดาษ' },
  { value: 'Parts', label: 'อะไหล่' },
  { value: 'DevicebureauWork', label: 'อุปกรณ์สำนักงาน' },
  { value: '耗材', label: 'วัสดุสิ้นเปลือง' },
  { value: 'Other ', label: 'อื่น ๆ' },
]

const UNITS = ['pcs', 'box', 'pack', 'roll', 'box', 'bottles']

function formatBaht(value: number | null | undefined, lang: 'th' | 'en' = 'th'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `฿${value.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatThaiDate(iso: string | null | undefined, lang: 'th' | 'en' = 'th'): string {
  if (!iso) return '—'
  try {
    return new Date(iso.length > 10 ? iso : iso + 'T00:00:00').toLocaleDateString(
      lang === 'th' ? 'th-TH' : 'en-GB',
      { day: '2-digit', month: '2-digit', year: 'numeric' },
    )
  } catch {
    return iso
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Open a print URL in a new window/tab. The HTML page returned by the API
 * auto-triggers window.print() on load (only when opened programmatically).
 */
function printDocument(url: string) {
  const win = window.open(url, '_blank', 'width=900,height=700,noopener,noreferrer')
  if (!win) {
    toast.error('ไม่สามารถเปิดหน้าต่างพิมพ์ได้ กรุณาอนุญาต Pop-up ในเบราว์เซอร์')
  }
}

/**
 * Escape a CSV cell value following RFC 4180:
 * wrap in double quotes if it contains comma, quote, or newline;
 * double any embedded double quotes.
 */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Build and download a CSV file from an array of rows.
 * A UTF-8 BOM is prepended so Excel renders Thai characters correctly.
 */
function downloadCSV(
  filename: string,
  rows: (string | number | null | undefined)[][],
) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---------- Form state ----------

interface ItemFormState {
  id?: string
  productCode: string
  productName: string
  category: string
  brand: string
  model: string
  unit: string
  quantity: string
  minQuantity: string
  maxQuantity: string
  unitCost: string
  location: string
  site: string
  compatibleDevices: string
  remark: string
  // ── WO-PARTS-FLOW Level 2+: cost model + expected usage defaults ──
  costModel: string // 'fixed' | 'per-page' | 'per-hour' | 'monthly' | 'per-device'
  expectedDevicesPerUnit: string
  expectedHoursPerUnit: string
  expectedPagesPerUnit: string
  ratePerPage: string
  ratePerHour: string
  ratePerMonth: string
  ratePerDevice: string
}

const EMPTY_ITEM_FORM: ItemFormState = {
  productCode: '',
  productName: '',
  category: '',
  brand: '',
  model: '',
  unit: 'pcs',
  quantity: '0',
  minQuantity: '0',
  maxQuantity: '0',
  unitCost: '',
  location: '',
  site: '',
  compatibleDevices: '',
  remark: '',
  costModel: 'fixed',
  expectedDevicesPerUnit: '',
  expectedHoursPerUnit: '',
  expectedPagesPerUnit: '',
  ratePerPage: '',
  ratePerHour: '',
  ratePerMonth: '',
  ratePerDevice: '',
}

interface TxnFormState {
  type: 'IN' | 'OUT' | 'ADJUST'
  quantity: string
  txnDate: string
  reason: string
  vendor: string
  cost: string
  performedBy: string
  remark: string
}

const EMPTY_TXN_FORM: TxnFormState = {
  type: 'IN',
  quantity: '',
  txnDate: todayISO(),
  reason: '',
  vendor: '',
  cost: '',
  performedBy: '',
  remark: '',
}

// ---------- Component ----------

export function StockPage() {
  const t = useT()
  const { lang } = useLang()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = React.useState<'items' | 'po' | 'pending'>('items')

  // Filters
  const [search, setSearch] = React.useState('')
  const [category, setCategory] = React.useState('all')
  const [lowStockOnly, setLowStockOnly] = React.useState(false)

  // Dialogs
  const [itemDialogOpen, setItemDialogOpen] = React.useState(false)
  const [itemForm, setItemForm] = React.useState<ItemFormState>(EMPTY_ITEM_FORM)
  const [savingItem, setSavingItem] = React.useState(false)

  const [txnDialogOpen, setTxnDialogOpen] = React.useState(false)
  const [txnTarget, setTxnTarget] = React.useState<StockItem | null>(null)
  const [txnForm, setTxnForm] = React.useState<TxnFormState>(EMPTY_TXN_FORM)
  const [savingTxn, setSavingTxn] = React.useState(false)

  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = React.useState<StockItem | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  // PO dialog
  const [poDialogOpen, setPoDialogOpen] = React.useState(false)
  const [poForm, setPoForm] = React.useState({
    orderDate: todayISO(),
    supplier: '',
    remark: '',
  })
  const [poLines, setPoLines] = React.useState<
    { stockItemId: string; quantityOrdered: string; unitPrice: string }[]
  >([{ stockItemId: '', quantityOrdered: '1', unitPrice: '' }])
  const [savingPo, setSavingPo] = React.useState(false)

  // ── Pending approval (PART 1) ──
  const [pendingFilter, setPendingFilter] = React.useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'all'>('PENDING')
  const [pendingSearch, setPendingSearch] = React.useState('')
  const [pendingDebouncedSearch, setPendingDebouncedSearch] = React.useState('')
  const [approvingTxn, setApprovingTxn] = React.useState<PendingStockTransaction | null>(null)
  const [approving, setApproving] = React.useState(false)
  const [rejectingTxn, setRejectingTxn] = React.useState<PendingStockTransaction | null>(null)
  const [rejectReason, setRejectReason] = React.useState('')
  const [rejecting, setRejecting] = React.useState(false)

  React.useEffect(() => {
    const t = setTimeout(() => setPendingDebouncedSearch(pendingSearch), 300)
    return () => clearTimeout(t)
  }, [pendingSearch])

  // ---- Pending list query ----
  const { data: pendingData, isLoading: loadingPending } = useQuery<PendingListResponse>({
    queryKey: ['stock-pending', pendingFilter, pendingDebouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('status', pendingFilter)
      if (pendingDebouncedSearch) params.set('search', pendingDebouncedSearch)
      params.set('pageSize', '200')
      const res = await fetch(`/api/stock-items/pending?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load pending')
      const json = await res.json()
      return json as PendingListResponse
    },
  })

  const pendingList = pendingData?.data ?? []

  async function handleApprovePending(t: PendingStockTransaction) {
    try {
      setApproving(true)
      setApprovingTxn(t)
      const res = await fetch(
        `/api/stock-items/${t.stockItemId}/pending/${t.id}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approver: 'admin' }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'อนุมัติไม่สำเร็จ')
      }
      toast.success(`อนุมัติการเบิกออก ${t.productCode ?? ''} สำเร็จ`)
      setApprovingTxn(null)
      await qc.invalidateQueries({ queryKey: ['stock-pending'] })
      await qc.invalidateQueries({ queryKey: ['stock-items'] })
      // Refresh any open detail dialog
      if (detailId) {
        await qc.invalidateQueries({ queryKey: ['stock-item-detail', detailId] })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'อนุมัติไม่สำเร็จ')
    } finally {
      setApproving(false)
    }
  }

  async function handleRejectPending() {
    if (!rejectingTxn) return
    if (!rejectReason.trim()) {
      toast.error('กรุณาระบุเหตุผลในการปฏิเสธ')
      return
    }
    try {
      setRejecting(true)
      const res = await fetch(
        `/api/stock-items/${rejectingTxn.stockItemId}/pending/${rejectingTxn.id}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approver: 'admin',
            reason: rejectReason.trim(),
          }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ปฏิเสธไม่สำเร็จ')
      }
      toast.success(`ปฏิเสธคำขอเบิกออก ${rejectingTxn.productCode ?? ''} `)
      setRejectingTxn(null)
      setRejectReason('')
      await qc.invalidateQueries({ queryKey: ['stock-pending'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ปฏิเสธไม่สำเร็จ')
    } finally {
      setRejecting(false)
    }
  }

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // ---- Stock items query ----
  const { data: stockData, isLoading: loadingStock } = useQuery<StockListResponse>({
    queryKey: ['stock-items', debouncedSearch, category, lowStockOnly],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (category !== 'all') params.set('category', category)
      if (lowStockOnly) params.set('lowStock', '1')
      params.set('pageSize', '200')
      const res = await fetch(`/api/stock-items?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load stock items')
      const json = await res.json()
      return json as StockListResponse
    },
  })

  const stockItems = stockData?.data ?? []
  const stats: StockStats = stockData?.stats ?? {
    total: 0,
    lowStock: 0,
    totalValue: 0,
    thisMonth: 0,
  }

  // ---- Purchase orders query ----
  const { data: poData, isLoading: loadingPo } = useQuery<PurchaseOrderListResponse>({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const res = await fetch('/api/purchase-orders?pageSize=200')
      if (!res.ok) throw new Error('Failed to load purchase orders')
      const json = await res.json()
      return json as PurchaseOrderListResponse
    },
  })
  const purchaseOrders = poData?.data ?? []

  // ---- Detail query (lazy, only when dialog open) ----
  const { data: detailData, isLoading: loadingDetail } = useQuery<StockItemDetail>({
    queryKey: ['stock-item-detail', detailId],
    queryFn: async () => {
      if (!detailId) throw new Error('No id')
      const res = await fetch(`/api/stock-items/${detailId}`)
      if (!res.ok) throw new Error('Failed to load detail')
      const json = await res.json()
      return json.data as StockItemDetail
    },
    enabled: Boolean(detailId) && detailOpen,
  })

  // ---------- Item add/edit ----------
  function openAddItem() {
    setItemForm({ ...EMPTY_ITEM_FORM })
    setItemDialogOpen(true)
  }
  function openEditItem(item: StockItem) {
    setItemForm({
      id: item.id,
      productCode: item.productCode,
      productName: item.productName,
      category: item.category ?? '',
      brand: item.brand ?? '',
      model: item.model ?? '',
      unit: item.unit,
      quantity: String(item.quantity),
      minQuantity: String(item.minQuantity),
      maxQuantity: String(item.maxQuantity),
      unitCost: item.unitCost !== null ? String(item.unitCost) : '',
      location: item.location ?? '',
      site: item.site ?? '',
      compatibleDevices: item.compatibleDevices ?? '',
      remark: item.remark ?? '',
      costModel: (item as { costModel?: string | null }).costModel ?? 'fixed',
      expectedDevicesPerUnit: (item as { expectedDevicesPerUnit?: number | null }).expectedDevicesPerUnit != null ? String((item as { expectedDevicesPerUnit?: number | null }).expectedDevicesPerUnit) : '',
      expectedHoursPerUnit: (item as { expectedHoursPerUnit?: number | null }).expectedHoursPerUnit != null ? String((item as { expectedHoursPerUnit?: number | null }).expectedHoursPerUnit) : '',
      expectedPagesPerUnit: (item as { expectedPagesPerUnit?: number | null }).expectedPagesPerUnit != null ? String((item as { expectedPagesPerUnit?: number | null }).expectedPagesPerUnit) : '',
      ratePerPage: (item as { ratePerPage?: number | string | null }).ratePerPage != null ? String((item as { ratePerPage?: number | string | null }).ratePerPage) : '',
      ratePerHour: (item as { ratePerHour?: number | string | null }).ratePerHour != null ? String((item as { ratePerHour?: number | string | null }).ratePerHour) : '',
      ratePerMonth: (item as { ratePerMonth?: number | string | null }).ratePerMonth != null ? String((item as { ratePerMonth?: number | string | null }).ratePerMonth) : '',
      ratePerDevice: (item as { ratePerDevice?: number | string | null }).ratePerDevice != null ? String((item as { ratePerDevice?: number | string | null }).ratePerDevice) : '',
    })
    setItemDialogOpen(true)
  }
  async function saveItem() {
    if (!itemForm.productName) {
      toast.error('กรุณาระบุชื่อสินค้า')
      return
    }
    try {
      setSavingItem(true)
      const payload = {
        productCode: itemForm.productCode || undefined,
        productName: itemForm.productName,
        category: itemForm.category || null,
        brand: itemForm.brand || null,
        model: itemForm.model || null,
        unit: itemForm.unit,
        quantity: Number(itemForm.quantity) || 0,
        minQuantity: Number(itemForm.minQuantity) || 0,
        maxQuantity: Number(itemForm.maxQuantity) || 0,
        unitCost: itemForm.unitCost === '' ? null : Number(itemForm.unitCost),
        location: itemForm.location || null,
        site: itemForm.site || null,
        compatibleDevices: itemForm.compatibleDevices || null,
        remark: itemForm.remark || null,
        // WO-PARTS-FLOW Level 2+: cost model + expected usage + rates
        costModel: itemForm.costModel || null,
        expectedDevicesPerUnit: itemForm.expectedDevicesPerUnit === '' ? null : Number(itemForm.expectedDevicesPerUnit),
        expectedHoursPerUnit: itemForm.expectedHoursPerUnit === '' ? null : Number(itemForm.expectedHoursPerUnit),
        expectedPagesPerUnit: itemForm.expectedPagesPerUnit === '' ? null : Number(itemForm.expectedPagesPerUnit),
        ratePerPage: itemForm.ratePerPage === '' ? null : Number(itemForm.ratePerPage),
        ratePerHour: itemForm.ratePerHour === '' ? null : Number(itemForm.ratePerHour),
        ratePerMonth: itemForm.ratePerMonth === '' ? null : Number(itemForm.ratePerMonth),
        ratePerDevice: itemForm.ratePerDevice === '' ? null : Number(itemForm.ratePerDevice),
      }
      const isEdit = Boolean(itemForm.id)
      const url = isEdit ? `/api/stock-items/${itemForm.id}` : '/api/stock-items'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'บันทึกไม่สำเร็จ')
      }
      const json = await res.json()
      toast.success(isEdit ? 'แก้ไขสินค้าแล้ว' : 'เพิ่มสินค้าใหม่แล้ว')
      setItemDialogOpen(false)
      await qc.invalidateQueries({ queryKey: ['stock-items'] })
      if (isEdit && detailId === itemForm.id) {
        await qc.invalidateQueries({ queryKey: ['stock-item-detail', detailId] })
      }
      // Surface auto-generated productCode after create.
      if (!isEdit && json?.data?.productCode) {
        toast.info(`รหัสสินค้าใหม่: ${json.data.productCode}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingItem(false)
    }
  }

  // ---------- Delete (soft) ----------
  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      const res = await fetch(`/api/stock-items/${deleteTarget.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ลบไม่สำเร็จ')
      }
      toast.success('ลบสินค้าแล้ว')
      setDeleteTarget(null)
      await qc.invalidateQueries({ queryKey: ['stock-items'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    } finally {
      setDeleting(false)
    }
  }

  // ---------- Stock transaction (IN/OUT/ADJUST) ----------
  function openTxn(item: StockItem, type: 'IN' | 'OUT' | 'ADJUST') {
    setTxnTarget(item)
    setTxnForm({
      ...EMPTY_TXN_FORM,
      type,
      txnDate: todayISO(),
      // For ADJUST, pre-fill current quantity for clarity.
      quantity: type === 'ADJUST' ? String(item.quantity) : '',
    })
    setTxnDialogOpen(true)
  }
  async function saveTxn() {
    if (!txnTarget) return
    const qty = Number(txnForm.quantity)
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error('กรุณาระบุจำนวนให้ถูกต้อง')
      return
    }
    if ((txnForm.type === 'IN' || txnForm.type === 'OUT') && qty <= 0) {
      toast.error('จำนวนสำหรับรับเข้า/เบิกออกต้องมากกว่า 0')
      return
    }
    try {
      setSavingTxn(true)
      const payload: Record<string, unknown> = {
        type: txnForm.type,
        quantity: qty,
        txnDate: txnForm.txnDate,
        reason: txnForm.reason || undefined,
        vendor: txnForm.vendor || undefined,
        remark: txnForm.remark || undefined,
      }
      if (txnForm.cost !== '') payload.cost = Number(txnForm.cost)
      const res = await fetch(`/api/stock-items/${txnTarget.id}/transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'ทำรายการไม่สำเร็จ')
      }
      const json = await res.json()
      const verb =
        txnForm.type === 'IN'
          ? 'รับเข้า'
          : txnForm.type === 'OUT'
          ? 'เบิกออก'
          : 'ปรับสต๊อก'
      toast.success(`${verb}สำเร็จ — คงเหลือ ${json.data.item.quantity} ${json.data.item.unit}`)
      setTxnDialogOpen(false)
      await qc.invalidateQueries({ queryKey: ['stock-items'] })
      if (detailId === txnTarget.id) {
        await qc.invalidateQueries({ queryKey: ['stock-item-detail', detailId] })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ')
    } finally {
      setSavingTxn(false)
    }
  }

  // ---------- Purchase order create ----------
  function openAddPo() {
    setPoForm({ orderDate: todayISO(), supplier: '', remark: '' })
    setPoLines([{ stockItemId: '', quantityOrdered: '1', unitPrice: '' }])
    setPoDialogOpen(true)
  }
  function addPoLine() {
    setPoLines((prev) => [
      ...prev,
      { stockItemId: '', quantityOrdered: '1', unitPrice: '' },
    ])
  }
  function removePoLine(idx: number) {
    setPoLines((prev) => prev.filter((_, i) => i !== idx))
  }
  function updatePoLine(idx: number, key: 'stockItemId' | 'quantityOrdered' | 'unitPrice', value: string) {
    setPoLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)),
    )
  }
  async function savePo() {
    if (!poForm.orderDate) {
      toast.error('กรุณาระบุวันที่สั่งซื้อ')
      return
    }
    const cleanLines = poLines.filter((l) => l.stockItemId)
    if (cleanLines.length === 0) {
      toast.error('ต้องเพิ่มอย่างน้อย 1 รายการสินค้า')
      return
    }
    try {
      setSavingPo(true)
      const payload = {
        orderDate: poForm.orderDate,
        supplier: poForm.supplier || null,
        remark: poForm.remark || null,
        items: cleanLines.map((l) => ({
          stockItemId: l.stockItemId,
          quantityOrdered: Number(l.quantityOrdered) || 0,
          unitPrice: l.unitPrice === '' ? null : Number(l.unitPrice),
        })),
      }
      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'บันทึกไม่สำเร็จ')
      }
      const json = await res.json()
      toast.success('สร้างใบสั่งซื้อแล้ว')
      if (json?.data?.poNumber) {
        toast.info(`เลขที่ใบสั่งซื้อ: ${json.data.poNumber}`)
      }
      setPoDialogOpen(false)
      await qc.invalidateQueries({ queryKey: ['purchase-orders'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingPo(false)
    }
  }

  // ---------- Render helpers ----------
  const txnTypeBadge = (type: string) => {
    if (type === 'IN')
      return (
        <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          รับเข้า
        </Badge>
      )
    if (type === 'OUT')
      return (
        <Badge className="border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
          เบิกออก
        </Badge>
      )
    return (
      <Badge className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        ปรับสต๊อก
      </Badge>
    )
  }

  const poStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      open: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
      partial:
        'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
      received:
        'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
      cancelled:
        'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300',
    }
    const labelMap: Record<string, string> = {
      open: 'เปิดอยู่',
      partial: 'รับบางส่วน',
      received: 'รับครบแล้ว',
      cancelled: t('common.cancel'),
    }
    return (
      <Badge className={map[status] ?? map.open}>{labelMap[status] ?? status}</Badge>
    )
  }

  const pendingStatusBadge = (status: string | null) => {
    if (status === 'PENDING') {
      return (
        <Badge className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          รอการอนุมัติ
        </Badge>
      )
    }
    if (status === 'APPROVED') {
      return (
        <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          อนุมัติแล้ว
        </Badge>
      )
    }
    if (status === 'REJECTED') {
      return (
        <Badge className="border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
          ปฏิเสธ
        </Badge>
      )
    }
    return (
      <Badge className="border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
        ทำรายการ
      </Badge>
    )
  }

  // ---------- KPI cards ----------
  const KPI_CARDS = [
    {
      title: 'ทั้งหมด',
      value: stats.total,
      icon: <Package className="h-5 w-5" />,
      accent: 'bg-[#f97316] text-white',
      soft: 'bg-orange-50 dark:bg-orange-950/40',
      format: (v: number) => `${v} รายการ`,
    },
    {
      title: 'สต๊อกต่ำ',
      value: stats.lowStock,
      icon: <AlertTriangle className="h-5 w-5" />,
      accent: 'bg-rose-500 text-white',
      soft: 'bg-rose-50 dark:bg-rose-950/40',
      format: (v: number) => `${v} รายการ`,
    },
    {
      title: 'มูลค่ารวม',
      value: stats.totalValue,
      icon: <Wallet className="h-5 w-5" />,
      accent: 'bg-teal-600 text-white',
      soft: 'bg-teal-50 dark:bg-teal-950/40',
      format: (v: number) => formatBaht(v, lang),
    },
    {
      title: 'รายการเดือนนี้',
      value: stats.thisMonth,
      icon: <CalendarPlus className="h-5 w-5" />,
      accent: 'bg-slate-700 text-white',
      soft: 'bg-slate-100 dark:bg-slate-800/60',
      format: (v: number) => `${v} รายการ`,
    },
  ]

  return (
    <div className="min-w-0 flex h-full flex-col overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      {/* Page header — primary CTA (AddProduct) is first so it's the
          obvious action; secondary actions follow. */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            📦 สินค้าในสต๊อก
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            จัดการสินค้าในคลัง รับเข้า-เบิกออก และใบสั่งซื้อ
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={openAddItem}
            className="order-first w-full bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950 sm:order-none sm:w-auto"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            เพิ่มสินค้า
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openAddPo}
            className="border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-300 dark:hover:bg-teal-950/40"
          >
            <ShoppingCart className="mr-1.5 h-3.5 w-3.5" />
            สร้างใบสั่งซื้อ
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ['stock-items'] })}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            รีเฟรช
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {KPI_CARDS.map((kpi, i) => (
          <motion.div
            key={kpi.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.05 }}
          >
            <Card className="overflow-hidden border-slate-200 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {kpi.title}
                    </div>
                    <div className="mt-1 truncate text-xl font-bold text-slate-800 dark:text-slate-100">
                      {loadingStock ? (
                        <Skeleton className="h-6 w-20" />
                      ) : (
                        kpi.format(kpi.value)
                      )}
                    </div>
                  </div>
                  <div
                    className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg ${kpi.soft}`}
                  >
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-md ${kpi.accent}`}
                    >
                      {kpi.icon}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Tabs: items | purchase orders | pending approval */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'items' | 'po' | 'pending')}>
        <TabsList className="bg-slate-100 dark:bg-slate-800">
          <TabsTrigger value="items">
            <Package2 className="mr-1.5 h-3.5 w-3.5" />
            สินค้าในคลัง
          </TabsTrigger>
          <TabsTrigger value="po">
            <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
            ใบสั่งซื้อ
          </TabsTrigger>
          <TabsTrigger value="pending">
            <Hourglass className="mr-1.5 h-3.5 w-3.5" />
            รอการอนุมัติ
          </TabsTrigger>
        </TabsList>

        {/* ===== Items tab ===== */}
        <TabsContent value="items" className="mt-4">
          {/* Filter bar */}
          <Card className="mb-4 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  ค้นหา
                </Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="รหัสสินค้า ชื่อ ยี่ห้อ รุ่น..."
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="w-full sm:w-56">
                <Label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  หมวดหมู่
                </Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ทุกหมวดหมู่</SelectItem>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                <Switch
                  checked={lowStockOnly}
                  onCheckedChange={setLowStockOnly}
                  aria-label="กรองสต๊อกต่ำ"
                />
                <Label className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
                  แสดงเฉพาะสต๊อกต่ำ
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800/60">
                      <TableHead className="w-28">รหัสสินค้า</TableHead>
                      <TableHead>ชื่อสินค้า</TableHead>
                      <TableHead className="w-32">{t('settings.col.category')}</TableHead>
                      <TableHead className="w-20 text-right">คงเหลือ</TableHead>
                      <TableHead className="w-20">หน่วย</TableHead>
                      <TableHead className="w-24 text-right">ราคา/หน่วย</TableHead>
                      <TableHead className="w-28 text-right">มูลค่ารวม</TableHead>
                      <TableHead className="w-56 text-right">การดำเนินการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingStock ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={`s-${i}`}>
                          {Array.from({ length: 8 }).map((__, j) => (
                            <TableCell key={`s-${i}-${j}`}>
                              <Skeleton className="h-5 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : stockItems.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="py-12 text-center text-slate-500 dark:text-slate-400"
                        >
                          <Package className="mx-auto mb-2 h-10 w-10 opacity-30" />
                          <div className="text-sm">ไม่พบสินค้าในสต๊อก</div>
                          <Button
                            variant="link"
                            size="sm"
                            onClick={openAddItem}
                            className="mt-2 text-[#f97316] hover:text-[#ea580c]"
                          >
                            เพิ่มสินค้าใหม่
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : (
                      stockItems.map((item) => {
                        const low = item.quantity <= item.minQuantity
                        const totalValue =
                          (item.unitCost ?? 0) * item.quantity
                        return (
                          <TableRow
                            key={item.id}
                            className="cursor-default transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                          >
                            <TableCell className="font-mono text-xs font-semibold text-[#f97316]">
                              {item.productCode}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-slate-800 dark:text-slate-100">
                                {item.productName}
                              </div>
                              {(item.brand || item.model) && (
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {[item.brand, item.model]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {item.category ? (
                                <Badge
                                  variant="outline"
                                  className="border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                >
                                  {item.category}
                                </Badge>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </TableCell>
                            <TableCell
                              className={`text-right font-semibold ${
                                low
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-800 dark:text-slate-100'
                              }`}
                            >
                              {item.quantity}
                              {low && item.minQuantity > 0 && (
                                <div className="text-[10px] font-normal text-rose-500">
                                  ต่ำกว่า {item.minQuantity}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-300">
                              {item.unit}
                            </TableCell>
                            <TableCell className="text-right text-slate-700 dark:text-slate-200">
                              {formatBaht(item.unitCost, lang)}
                            </TableCell>
                            <TableCell className="text-right font-medium text-slate-700 dark:text-slate-200">
                              {formatBaht(totalValue, lang)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-2 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                                  onClick={() => openTxn(item, 'IN')}
                                  title="รับเข้า"
                                >
                                  <ArrowDownToLine className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
                                  onClick={() => openTxn(item, 'OUT')}
                                  title="เบิกออก"
                                  disabled={item.quantity <= 0}
                                >
                                  <ArrowUpFromLine className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-2 text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40"
                                  onClick={() => openTxn(item, 'ADJUST')}
                                  title="ปรับสต๊อก"
                                >
                                  <SlidersHorizontal className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-2 text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                                  onClick={() => {
                                    setDetailId(item.id)
                                    setDetailOpen(true)
                                  }}
                                  title="ดูรายละเอียด"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-2 text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                                  onClick={() => openEditItem(item)}
                                  title={t('settings.edit')}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
                                  onClick={() => setDeleteTarget(item)}
                                  title={t('settings.delete')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Purchase Orders tab ===== */}
        <TabsContent value="po" className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              ใบสั่งซื้อทั้งหมด ({purchaseOrders.length} รายการ)
            </h3>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={purchaseOrders.length === 0}
                onClick={() => {
                  const rows: (string | number | null | undefined)[][] = [
                    [
                      'เลขที่ใบสั่งซื้อ',
                      'วันที่สั่งซื้อ',
                      'ผู้จัดจำหน่าย',
                      'จำนวนรายการ',
                      t('common.status'),
                      'มูลค่ารวม',
                      'ผู้สั่งซื้อ',
                      t('common.remark'),
                      'รายการสินค้า',
                    ],
                  ]
                  for (const po of purchaseOrders) {
                    const itemDesc = (po.items ?? [])
                      .map(
                        (it) =>
                          `${it.stockItem?.productCode ?? '—'} x${it.quantityOrdered} @ ${it.unitPrice ?? 0}`,
                      )
                      .join(' | ')
                    rows.push([
                      po.poNumber,
                      formatThaiDate(po.orderDate, lang),
                      po.supplier,
                      po.items?.length ?? 0,
                      po.status,
                      po.totalValue,
                      po.createdBy,
                      po.remark,
                      itemDesc,
                    ])
                  }
                  const fname = `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`
                  downloadCSV(fname, rows)
                  toast.success(`ส่งออกใบสั่งซื้อ ${purchaseOrders.length} รายการเป็น CSV แล้ว`)
                }}
                className="h-8 border-slate-300 px-3 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                title="ส่งออกใบสั่งซื้อทั้งหมดเป็น CSV"
              >
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
                ส่งออก CSV
              </Button>
            </div>
          </div>
          <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800/60">
                      <TableHead className="w-36">เลขที่ใบสั่งซื้อ</TableHead>
                      <TableHead className="w-32">วันที่สั่งซื้อ</TableHead>
                      <TableHead>ผู้จัดจำหน่าย</TableHead>
                      <TableHead className="w-24 text-right">รายการ</TableHead>
                      <TableHead className="w-32 text-right">มูลค่ารวม</TableHead>
                      <TableHead className="w-28">สถานะ</TableHead>
                      <TableHead className="w-32 text-right">การดำเนินการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingPo ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={`p-${i}`}>
                          {Array.from({ length: 7 }).map((__, j) => (
                            <TableCell key={`p-${i}-${j}`}>
                              <Skeleton className="h-5 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : purchaseOrders.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-12 text-center text-slate-500 dark:text-slate-400"
                        >
                          <ClipboardList className="mx-auto mb-2 h-10 w-10 opacity-30" />
                          <div className="text-sm">ยังไม่มีใบสั่งซื้อ</div>
                          <Button
                            variant="link"
                            size="sm"
                            onClick={openAddPo}
                            className="mt-2 text-[#f97316] hover:text-[#ea580c]"
                          >
                            สร้างใบสั่งซื้อใหม่
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : (
                      purchaseOrders.map((po) => (
                        <TableRow
                          key={po.id}
                          className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        >
                          <TableCell className="font-mono text-xs font-semibold text-[#f97316]">
                            {po.poNumber ?? '—'}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            {formatThaiDate(po.orderDate, lang)}
                          </TableCell>
                          <TableCell className="text-slate-800 dark:text-slate-100">
                            {po.supplier ?? '—'}
                          </TableCell>
                          <TableCell className="text-right text-slate-600 dark:text-slate-300">
                            {po.items?.length ?? 0} รายการ
                          </TableCell>
                          <TableCell className="text-right font-medium text-slate-700 dark:text-slate-200">
                            {formatBaht(po.totalValue, lang)}
                          </TableCell>
                          <TableCell>{poStatusBadge(po.status)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px] text-teal-600 hover:bg-teal-50 hover:text-teal-700 dark:text-teal-400 dark:hover:bg-teal-950/40"
                              onClick={() =>
                                printDocument(`/api/purchase-orders/${po.id}/print`)
                              }
                              title="พิมพ์ใบสั่งซื้อ"
                            >
                              <Printer className="mr-1 h-3 w-3" />
                              พิมพ์ใบสั่งซื้อ
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Pending approval tab ===== */}
        <TabsContent value="pending" className="mt-4">
          {/* Filter bar */}
          <Card className="mb-4 border-slate-200 dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  ค้นหา
                </Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                    placeholder="เลขที่คำขอ / รหัสสินค้า / ชื่อ / เลขที่ใบงาน"
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="w-full sm:w-56">
                <Label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  สถานะ
                </Label>
                <Select
                  value={pendingFilter}
                  onValueChange={(v) =>
                    setPendingFilter(
                      v as 'PENDING' | 'APPROVED' | 'REJECTED' | 'all',
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">รอการอนุมัติ</SelectItem>
                    <SelectItem value="APPROVED">อนุมัติแล้ว</SelectItem>
                    <SelectItem value="REJECTED">ปฏิเสธ</SelectItem>
                    <SelectItem value="all">ทั้งหมด</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  qc.invalidateQueries({ queryKey: ['stock-pending'] })
                }
                className="border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                รีเฟรช
              </Button>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800/60">
                      <TableHead className="w-32">เลขที่คำขอ</TableHead>
                      <TableHead className="w-32">วันที่</TableHead>
                      <TableHead>สินค้า</TableHead>
                      <TableHead className="w-24 text-right">{t('common.quantity')}</TableHead>
                      <TableHead className="w-28 text-right">คงเหลือ</TableHead>
                      <TableHead className="w-32">เลขที่ใบงาน</TableHead>
                      <TableHead>เหตุผล / หมายเหตุ</TableHead>
                      <TableHead className="w-28">สถานะ</TableHead>
                      <TableHead className="w-40 text-right">การดำเนินการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingPending ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={`pen-${i}`}>
                          {Array.from({ length: 9 }).map((__, j) => (
                            <TableCell key={`pen-${i}-${j}`}>
                              <Skeleton className="h-5 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : pendingList.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="py-12 text-center text-slate-500 dark:text-slate-400"
                        >
                          <Hourglass className="mx-auto mb-2 h-10 w-10 opacity-30" />
                          <div className="text-sm">
                            ไม่พบคำขอเบิกออก
                            {pendingFilter !== 'all'
                              ? ` ที่มีสถานะ "${
                                  pendingFilter === 'PENDING'
                                    ? 'รอการอนุมัติ'
                                    : pendingFilter === 'APPROVED'
                                    ? 'อนุมัติแล้ว'
                                    : 'ปฏิเสธ'
                                }"`
                              : ''}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      pendingList.map((t) => {
                        const stockQty = t.stockItem?.quantity
                        const insufficient =
                          stockQty !== undefined && stockQty < t.quantity
                        return (
                          <TableRow
                            key={t.id}
                            className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                          >
                            <TableCell className="font-mono text-xs font-semibold text-purple-600 dark:text-purple-400">
                              {t.txnNumber ?? '—'}
                            </TableCell>
                            <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                              {formatThaiDate(t.txnDate, lang)}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-slate-800 dark:text-slate-100">
                                {t.productName ?? t.stockItem?.productName ?? '—'}
                              </div>
                              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {t.productCode ?? '—'}
                                {t.requester && (
                                  <span className="ml-1.5 text-slate-400">
                                    • ผู้เบิก: {t.requester}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-rose-600 dark:text-rose-400">
                              -{t.quantity} {t.unit ?? ''}
                            </TableCell>
                            <TableCell
                              className={`text-right ${
                                insufficient
                                  ? 'font-semibold text-rose-600 dark:text-rose-400'
                                  : 'text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {stockQty !== undefined ? stockQty : '—'}
                              {insufficient && (
                                <div className="text-[10px] font-normal text-rose-500">
                                  ไม่เพียงพอ
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              {t.workOrderNo ? (
                                <Badge
                                  variant="outline"
                                  className="border-purple-200 bg-purple-100 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300"
                                >
                                  {t.workOrderNo}
                                </Badge>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                              <div className="line-clamp-2 max-w-xs">
                                {t.reason ?? '—'}
                              </div>
                              {t.purpose && (
                                <div className="text-[10px] text-slate-400">
                                  เพื่อ: {t.purpose}
                                </div>
                              )}
                              {t.rejectReason && (
                                <div className="text-[10px] text-rose-500">
                                  ปฏิเสธ: {t.rejectReason}
                                </div>
                              )}
                              {t.approver && (
                                <div className="text-[10px] text-slate-400">
                                  โดย: {t.approver}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{pendingStatusBadge(t.approvalStatus)}</TableCell>
                            <TableCell>
                              {t.approvalStatus === 'PENDING' ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 px-2 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                                    onClick={() => handleApprovePending(t)}
                                    disabled={
                                      approving && approvingTxn?.id === t.id
                                    }
                                    title="อนุมัติ"
                                  >
                                    {approving && approvingTxn?.id === t.id ? (
                                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Check className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
                                    onClick={() => {
                                      setRejectingTxn(t)
                                      setRejectReason('')
                                    }}
                                    title="ปฏิเสธ"
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : (
                                <span className="block text-right text-[11px] text-slate-400">
                                  —
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== Item add/edit dialog ===== */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-slate-800 dark:text-slate-100">
              {itemForm.id ? '✏️ แก้ไขสินค้า' : '➕ เพิ่มสินค้าใหม่'}
            </DialogTitle>
            <DialogDescription>
              {itemForm.id
                ? `แก้ไขข้อมูลสินค้า ${itemForm.productCode}`
                : 'รหัสสินค้าจะถูกสร้างอัตโนมัติในรูปแบบ STK-NNNN หากไม่ระบุ'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                รหัสสินค้า
              </Label>
              <Input
                value={itemForm.productCode}
                onChange={(e) =>
                  setItemForm({ ...itemForm, productCode: e.target.value })
                }
                placeholder="STK-0001 (เว้นว่างเพื่อสร้างอัตโนมัติ)"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ชื่อสินค้า *
              </Label>
              <Input
                value={itemForm.productName}
                onChange={(e) =>
                  setItemForm({ ...itemForm, productName: e.target.value })
                }
                placeholder="เช่น หมึกพิมพ์ EPSON T544"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                หมวดหมู่
              </Label>
              <Select
                value={itemForm.category}
                onValueChange={(v) =>
                  setItemForm({ ...itemForm, category: v === '__none' ? '' : v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="เลือกหมวดหมู่" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— ไม่ระบุ —</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                หน่วย
              </Label>
              <Select
                value={itemForm.unit}
                onValueChange={(v) => setItemForm({ ...itemForm, unit: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ยี่ห้อ
              </Label>
              <Input
                value={itemForm.brand}
                onChange={(e) =>
                  setItemForm({ ...itemForm, brand: e.target.value })
                }
                placeholder="เช่น EPSON, HP"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                รุ่น
              </Label>
              <Input
                value={itemForm.model}
                onChange={(e) =>
                  setItemForm({ ...itemForm, model: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                จำนวนคงเหลือ
              </Label>
              <Input
                type="number"
                min="0"
                value={itemForm.quantity}
                onChange={(e) =>
                  setItemForm({ ...itemForm, quantity: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                จุดสั่งซื้อ (ขั้นต่ำ)
              </Label>
              <Input
                type="number"
                min="0"
                value={itemForm.minQuantity}
                onChange={(e) =>
                  setItemForm({ ...itemForm, minQuantity: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                จำนวนสูงสุด
              </Label>
              <Input
                type="number"
                min="0"
                value={itemForm.maxQuantity}
                onChange={(e) =>
                  setItemForm({ ...itemForm, maxQuantity: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ราคาต่อหน่วย (บาท)
              </Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={itemForm.unitCost}
                onChange={(e) =>
                  setItemForm({ ...itemForm, unitCost: e.target.value })
                }
                placeholder="0.00"
              />
              <p className="text-[11px] text-slate-400">
                ใช้สำหรับโมเดลค่าใช้จ่ายแบบ &quot;ราคาต่อหน่วยคงที่&quot;
              </p>
            </div>

            {/* ── WO-PARTS-FLOW Level 2+: cost model + rate config ── */}
            <div className="sm:col-span-2 rounded-lg border border-purple-200 bg-purple-50/40 p-3 dark:border-purple-800 dark:bg-purple-950/20">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
                <Coins className="h-3.5 w-3.5" />
                รูปแบบการคิดค่าใช้จ่าย (Cost Model)
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">เลือกรูปแบบการคิดค่าใช้จ่าย</Label>
                <Select
                  value={itemForm.costModel}
                  onValueChange={(v) => setItemForm({ ...itemForm, costModel: v })}
                >
                  <SelectTrigger className="w-full dark:bg-slate-800 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">ราคาต่อหน่วยคงที่ — เช่น ตลับหมึก, อะไหล่</SelectItem>
                    <SelectItem value="per-page">ราคาต่อหน้าพิมพ์ — เช่น เครื่องพิมพ์เช่า</SelectItem>
                    <SelectItem value="per-hour">ราคาต่อชั่วโมง — เช่น อุปกรณ์เช่ารายชั่วโมง</SelectItem>
                    <SelectItem value="monthly">รายเดือน — เช่น ค่าบำรุงรักษารายเดือน</SelectItem>
                    <SelectItem value="per-device">ราคาต่อเครื่อง — เช่น ค่าบริการต่อเครื่อง</SelectItem>
                  </SelectContent>
                </Select>

                {/* Conditional rate inputs based on costModel */}
                {itemForm.costModel === 'per-page' && (
                  <div>
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">อัตราค่าบริการต่อหน้า (บาท)</Label>
                    <Input type="number" min="0" step="0.01" value={itemForm.ratePerPage}
                      onChange={(e) => setItemForm({ ...itemForm, ratePerPage: e.target.value })}
                      placeholder="0.50" />
                  </div>
                )}
                {itemForm.costModel === 'per-hour' && (
                  <div>
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">อัตราค่าบริการต่อชั่วโมง (บาท)</Label>
                    <Input type="number" min="0" step="0.01" value={itemForm.ratePerHour}
                      onChange={(e) => setItemForm({ ...itemForm, ratePerHour: e.target.value })}
                      placeholder="100.00" />
                  </div>
                )}
                {itemForm.costModel === 'monthly' && (
                  <div>
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">ค่าบริการรายเดือน (บาท)</Label>
                    <Input type="number" min="0" step="0.01" value={itemForm.ratePerMonth}
                      onChange={(e) => setItemForm({ ...itemForm, ratePerMonth: e.target.value })}
                      placeholder="1500.00" />
                  </div>
                )}
                {itemForm.costModel === 'per-device' && (
                  <div>
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">ค่าบริการต่อเครื่อง (บาท)</Label>
                    <Input type="number" min="0" step="0.01" value={itemForm.ratePerDevice}
                      onChange={(e) => setItemForm({ ...itemForm, ratePerDevice: e.target.value })}
                      placeholder="200.00" />
                  </div>
                )}
              </div>

              {/* Expected usage defaults — used by parts picker */}
              <div className="mt-3 border-t border-purple-200 pt-2 dark:border-purple-800">
                <div className="mb-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
                  สเปคการใช้งาน (กรอกอัตโนมัติเมื่อเบิกอะไหล่)
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">1 หน่วยเติมได้กี่เครื่อง</Label>
                    <Input type="number" min="0" value={itemForm.expectedDevicesPerUnit}
                      onChange={(e) => setItemForm({ ...itemForm, expectedDevicesPerUnit: e.target.value })}
                      placeholder="3" />
                    <p className="text-[11px] text-slate-400">เช่น น้ำหมึก 1 ขวด เติมได้ 3 เครื่อง</p>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">1 หน่วยใช้ได้กี่ชม.</Label>
                    <Input type="number" min="0" value={itemForm.expectedHoursPerUnit}
                      onChange={(e) => setItemForm({ ...itemForm, expectedHoursPerUnit: e.target.value })}
                      placeholder="8" />
                    <p className="text-[11px] text-slate-400">เช่น แบตเตอรี่ 8 ชม.</p>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">1 หน่วยพิมพ์ได้กี่หน้า (Yield)</Label>
                    <Input type="number" min="0" value={itemForm.expectedPagesPerUnit}
                      onChange={(e) => setItemForm({ ...itemForm, expectedPagesPerUnit: e.target.value })}
                      placeholder="6000" />
                    <p className="text-[11px] text-slate-400">เช่น หมึก 6,000 แผ่น / ดรัม 15,000 แผ่น</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] italic text-slate-400">
                  💡 หน่วยตามสเปคมาตรฐาน: หมึก EPSON T544 = 6,000 แผ่น/ขวด · ดรัม OKI = 15,000 แผ่น/ตลับ · ตลับหมึก HP 85A = 1,600 แผ่น
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ตำแหน่งจัดเก็บ
              </Label>
              <Input
                value={itemForm.location}
                onChange={(e) =>
                  setItemForm({ ...itemForm, location: e.target.value })
                }
                placeholder="เช่น ชั้น A-1"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                ไซต์
              </Label>
              <Input
                value={itemForm.site}
                onChange={(e) =>
                  setItemForm({ ...itemForm, site: e.target.value })
                }
                placeholder="เช่น HQ"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                อุปกรณ์ที่รองรับ
              </Label>
              <Input
                value={itemForm.compatibleDevices}
                onChange={(e) =>
                  setItemForm({
                    ...itemForm,
                    compatibleDevices: e.target.value,
                  })
                }
                placeholder="เช่น EPSON L5290, L3210 (คั่ด้วยจุลภาค)"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                หมายเหตุ
              </Label>
              <Textarea
                value={itemForm.remark}
                onChange={(e) =>
                  setItemForm({ ...itemForm, remark: e.target.value })
                }
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setItemDialogOpen(false)}
              disabled={savingItem}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={saveItem}
              disabled={savingItem}
              className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {savingItem ? 'กำลังบันทึก...' : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Transaction dialog ===== */}
      <Dialog open={txnDialogOpen} onOpenChange={setTxnDialogOpen}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              {txnForm.type === 'IN' && (
                <>
                  <ArrowDownToLine className="h-4 w-4 text-emerald-600" />
                  รับสินค้าเข้า
                </>
              )}
              {txnForm.type === 'OUT' && (
                <>
                  <ArrowUpFromLine className="h-4 w-4 text-rose-600" />
                  เบิกสินค้าออก
                </>
              )}
              {txnForm.type === 'ADJUST' && (
                <>
                  <SlidersHorizontal className="h-4 w-4 text-amber-600" />
                  ปรับสต๊อก
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {txnTarget && (
                <span>
                  {txnTarget.productCode} — {txnTarget.productName}
                  <br />
                  คงเหลือปัจจุบัน: {txnTarget.quantity} {txnTarget.unit}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {txnForm.type === 'ADJUST'
                  ? 'จำนวนคงเหลือใหม่ (ตั้งค่าใหม่)'
                  : 'จำนวน *'}
              </Label>
              <Input
                type="number"
                min="0"
                value={txnForm.quantity}
                onChange={(e) =>
                  setTxnForm({ ...txnForm, quantity: e.target.value })
                }
                autoFocus
              />
              {txnForm.type === 'OUT' && txnTarget && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  จำนวนสูงสุดที่เบิกได้: {txnTarget.quantity} {txnTarget.unit}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  วันที่ทำรายการ
                </Label>
                <Input
                  type="date"
                  value={txnForm.txnDate}
                  onChange={(e) =>
                    setTxnForm({ ...txnForm, txnDate: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  เหตุผล
                </Label>
                <Input
                  value={txnForm.reason}
                  onChange={(e) =>
                    setTxnForm({ ...txnForm, reason: e.target.value })
                  }
                  placeholder={
                    txnForm.type === 'IN'
                      ? 'ซื้อ / ย้ายเข้า'
                      : txnForm.type === 'OUT'
                      ? 'เบิกใช้ / ย้ายออก / จ่ายแจก'
                      : 'ตรวจนับสต๊อก / ปรับยอด'
                  }
                />
              </div>
            </div>
            {txnForm.type === 'IN' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    ซื้อจาก (ผู้จัดจำหน่าย)
                  </Label>
                  <Input
                    value={txnForm.vendor}
                    onChange={(e) =>
                      setTxnForm({ ...txnForm, vendor: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    มูลค่ารวม (บาท)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={txnForm.cost}
                    onChange={(e) =>
                      setTxnForm({ ...txnForm, cost: e.target.value })
                    }
                    placeholder="0.00"
                  />
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  ผู้ทำรายการ
                </Label>
                <Input
                  value="ระบบจะผูกกับบัญชีที่เข้าสู่ระบบ"
                  readOnly
                  aria-describedby="stock-transaction-actor-help"
                />
                <p
                  id="stock-transaction-actor-help"
                  className="text-[11px] text-slate-500 dark:text-slate-400"
                >
                  ไม่สามารถเปลี่ยนชื่อผู้ทำรายการจากฟอร์มนี้ได้
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  หมายเหตุ
                </Label>
                <Input
                  value={txnForm.remark}
                  onChange={(e) =>
                    setTxnForm({ ...txnForm, remark: e.target.value })
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTxnDialogOpen(false)}
              disabled={savingTxn}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={saveTxn}
              disabled={savingTxn}
              className={
                txnForm.type === 'IN'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950'
                  : txnForm.type === 'OUT'
                  ? 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950'
                  : 'bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950'
              }
            >
              {savingTxn ? 'กำลังบันทึก...' : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Detail dialog ===== */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Eye className="h-4 w-4 text-slate-500" />
              รายละเอียดสินค้า
            </DialogTitle>
            <DialogDescription>
              {detailData && (
                <span>
                  {detailData.productCode} — {detailData.productName}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {loadingDetail || !detailData ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Item info grid */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50 sm:grid-cols-3">
                <DetailField label="รหัสสินค้า" value={detailData.productCode} mono />
                <DetailField label="หมวดหมู่" value={detailData.category} />
                <DetailField label="ยี่ห้อ" value={detailData.brand} />
                <DetailField label="รุ่น" value={detailData.model} />
                <DetailField
                  label="คงเหลือ"
                  value={`${detailData.quantity} ${detailData.unit}`}
                  highlight={detailData.quantity <= detailData.minQuantity}
                />
                <DetailField
                  label="จุดสั่งซื้อ"
                  value={`${detailData.minQuantity} ${detailData.unit}`}
                />
                <DetailField
                  label="ราคา/หน่วย"
                  value={formatBaht(detailData.unitCost, lang)}
                />
                <DetailField
                  label="มูลค่ารวม"
                  value={formatBaht(
                    (detailData.unitCost ?? 0) * detailData.quantity,
                    lang,
                  )}
                />
                <DetailField label="ตำแหน่งจัดเก็บ" value={detailData.location} />
                <DetailField label="ไซต์" value={detailData.site} />
                <DetailField
                  label="อุปกรณ์ที่รองรับ"
                  value={detailData.compatibleDevices}
                  span={2}
                />
                <DetailField
                  label="หมายเหตุ"
                  value={detailData.remark}
                  span={2}
                />
                <DetailField
                  label="สถานะ"
                  value={detailData.active ? t('status.active') : 'ปิดใช้งาน'}
                />
              </div>

              {/* Stock level progress */}
              {detailData.maxQuantity > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-300">
                      ระดับสต๊อก
                    </span>
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {detailData.quantity} / {detailData.maxQuantity}{' '}
                      {detailData.unit}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(
                      100,
                      (detailData.quantity / detailData.maxQuantity) * 100,
                    )}
                    className="h-2"
                  />
                </div>
              )}

              {/* Transaction history */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    ประวัติรับเข้า/เบิกออกสต๊อก
                  </h3>
                  <div className="flex items-center gap-2">
                    {detailData.transactions.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const rows: (string | number | null | undefined)[][] = [
                            [
                              'เลขที่',
                              t('common.type'),
                              'รหัสสินค้า',
                              'ชื่อสินค้า',
                              t('common.quantity'),
                              t('common.unit'),
                              'คงเหลือ',
                              'ราคา/หน่วย',
                              'มูลค่ารวม',
                              'ผู้จัดจำหน่าย/ผู้เบิก',
                              'แผนก',
                              'วัตถุประสงค์/เหตุผล',
                              'ผู้อนุมัติ',
                              'ใบสั่งซื้อ',
                              t('jobtype.work-order'),
                              t('common.date'),
                              'ดำเนินการโดย',
                              t('common.remark'),
                            ],
                          ]
                          for (const t of detailData.transactions) {
                            rows.push([
                              t.txnNumber,
                              t.type,
                              t.productCode ?? detailData.productCode,
                              t.productName ?? detailData.productName,
                              t.quantity,
                              t.unit ?? detailData.unit,
                              t.balanceAfter,
                              t.unitCost ?? detailData.unitCost,
                              t.cost,
                              t.vendor ?? t.requester,
                              t.department,
                              t.purpose ?? t.reason,
                              t.approver,
                              t.purchaseOrderNo,
                              t.workOrderNo,
                              formatThaiDate(t.txnDate, lang),
                              t.performedBy,
                              t.remark,
                            ])
                          }
                          const fname = `stock-transactions-${detailData.productCode || detailData.id}-${new Date().toISOString().slice(0, 10)}.csv`
                          downloadCSV(fname, rows)
                          toast.success(`ส่งออก ${detailData.transactions.length} รายการเป็น CSV แล้ว`)
                        }}
                        className="h-7 border-slate-300 px-2 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        title="ส่งออกรายการทั้งหมดเป็น CSV"
                      >
                        <FileDown className="mr-1 h-3 w-3" />
                        ส่งออก CSV
                      </Button>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {detailData.transactions.length} รายการ
                    </Badge>
                  </div>
                </div>
                {detailData.transactions.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    ยังไม่มีประวัติรับเข้า/เบิกออกสต๊อก
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
                    <Table>
                      <TableHeader className="sticky top-0 bg-slate-50 dark:bg-slate-800/80">
                        <TableRow>
                          <TableHead className="w-28">เลขที่</TableHead>
                          <TableHead className="w-20">ประเภท</TableHead>
                          <TableHead className="w-24 text-right">{t('common.quantity')}</TableHead>
                          <TableHead className="w-24 text-right">คงเหลือ</TableHead>
                          <TableHead>เหตุผล</TableHead>
                          <TableHead className="w-28">วันที่</TableHead>
                          <TableHead className="w-16 text-right">พิมพ์</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailData.transactions.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {t.txnNumber ?? '—'}
                            </TableCell>
                            <TableCell>{txnTypeBadge(t.type)}</TableCell>
                            <TableCell className="text-right font-medium text-slate-700 dark:text-slate-200">
                              {t.type === 'IN'
                                ? `+${t.quantity}`
                                : t.type === 'OUT'
                                ? `-${t.quantity}`
                                : `=${t.quantity}`}
                            </TableCell>
                            <TableCell className="text-right text-slate-600 dark:text-slate-300">
                              {t.balanceAfter}
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-300">
                              {t.reason ?? '—'}
                              {t.vendor && (
                                <div className="text-[10px] text-slate-400">
                                  จาก: {t.vendor}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-slate-500 dark:text-slate-400">
                              {formatThaiDate(t.txnDate, lang)}
                            </TableCell>
                            <TableCell className="text-right">
                              {t.type === 'IN' ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[11px] text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                                  onClick={() =>
                                    printDocument(
                                      `/api/stock-items/${detailData.id}/print?txnId=${t.id}&type=in`,
                                    )
                                  }
                                  title="พิมพ์ใบรับของ"
                                >
                                  <Printer className="mr-1 h-3 w-3" />
                                  ใบรับของ
                                </Button>
                              ) : t.type === 'OUT' ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[11px] text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
                                  onClick={() =>
                                    printDocument(
                                      `/api/stock-items/${detailData.id}/print?txnId=${t.id}&type=out`,
                                    )
                                  }
                                  title="พิมพ์ใบเบิกของ"
                                >
                                  <Printer className="mr-1 h-3 w-3" />
                                  ใบเบิกของ
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[11px] text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40"
                                  onClick={() =>
                                    printDocument(
                                      `/api/stock-items/${detailData.id}/print?txnId=${t.id}`,
                                    )
                                  }
                                  title="พิมพ์ใบปรับสต๊อก"
                                >
                                  <Printer className="mr-1 h-3 w-3" />
                                  ใบปรับสต๊อก
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* Quick actions */}
              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!detailData) return
                    setDetailOpen(false)
                    openTxn(detailData, 'IN')
                  }}
                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                >
                  <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                  รับเข้า
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!detailData) return
                    setDetailOpen(false)
                    openTxn(detailData, 'OUT')
                  }}
                  disabled={detailData.quantity <= 0}
                  className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40"
                >
                  <ArrowUpFromLine className="mr-1.5 h-3.5 w-3.5" />
                  เบิกออก
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!detailData) return
                    setDetailOpen(false)
                    openTxn(detailData, 'ADJUST')
                  }}
                  className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
                >
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                  ปรับสต๊อก
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!detailData) return
                    setDetailOpen(false)
                    openEditItem(detailData)
                  }}
                  className="ml-auto border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  แก้ไข
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== Delete confirmation ===== */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
              <Trash2 className="h-4 w-4" />
              ยืนยันการลบสินค้า
            </DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <span>
                  คุณกำลังจะลบ{' '}
                  <strong className="text-slate-700 dark:text-slate-200">
                    {deleteTarget.productCode} — {deleteTarget.productName}
                  </strong>
                  <br />
                  ระบบจะตั้งสถานะเป็น &quot;ปิดใช้งาน&quot; (soft delete)
                  เพื่อเก็บประวัติรับเข้า/เบิกออกไว้
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {deleting ? 'กำลังลบ...' : 'ลบสินค้า'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Purchase order dialog ===== */}
      <Dialog open={poDialogOpen} onOpenChange={setPoDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <ShoppingCart className="h-4 w-4 text-teal-600" />
              สร้างใบสั่งซื้อ
            </DialogTitle>
            <DialogDescription>
              เลขที่ใบสั่งซื้อจะถูกสร้างอัตโนมัติในรูปแบบ PO-YYYYMMDD-NNN
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  วันที่สั่งซื้อ *
                </Label>
                <Input
                  type="date"
                  value={poForm.orderDate}
                  onChange={(e) =>
                    setPoForm({ ...poForm, orderDate: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  ผู้จัดจำหน่าย
                </Label>
                <Input
                  value={poForm.supplier}
                  onChange={(e) =>
                    setPoForm({ ...poForm, supplier: e.target.value })
                  }
                  placeholder="ชื่อบริษัท/ร้านค้า"
                />
              </div>
            </div>

            {/* PO lines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  รายการสินค้า
                </Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addPoLine}
                  className="h-7 border-teal-300 px-2 text-xs text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-300 dark:hover:bg-teal-950/40"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  เพิ่มรายการ
                </Button>
              </div>
              <div className="space-y-2">
                {poLines.map((line, idx) => {
                  const unitPrice = line.unitPrice === '' ? null : Number(line.unitPrice)
                  const qty = Number(line.quantityOrdered) || 0
                  const lineTotal =
                    unitPrice !== null && Number.isFinite(qty)
                      ? unitPrice * qty
                      : 0
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/50"
                    >
                      <div className="col-span-12 sm:col-span-5">
                        <Select
                          value={line.stockItemId}
                          onValueChange={(v) =>
                            updatePoLine(idx, 'stockItemId', v)
                          }
                        >
                          <SelectTrigger className="h-8 w-full text-xs">
                            <SelectValue placeholder="เลือกสินค้า" />
                          </SelectTrigger>
                          <SelectContent>
                            {stockItems.map((it) => (
                              <SelectItem key={it.id} value={it.id}>
                                {it.productCode} — {it.productName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <Input
                          type="number"
                          min="1"
                          value={line.quantityOrdered}
                          onChange={(e) =>
                            updatePoLine(idx, 'quantityOrdered', e.target.value)
                          }
                          className="h-8 text-xs"
                          placeholder={t('common.quantity')}
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) =>
                            updatePoLine(idx, 'unitPrice', e.target.value)
                          }
                          className="h-8 text-xs"
                          placeholder="ราคา/หน่วย"
                        />
                      </div>
                      <div className="col-span-3 sm:col-span-2 flex items-center text-right text-xs font-medium text-slate-700 dark:text-slate-200">
                        {formatBaht(lineTotal, lang)}
                      </div>
                      <div className="col-span-1 flex items-center justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          onClick={() => removePoLine(idx)}
                          disabled={poLines.length === 1}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {(() => {
                const grand = poLines.reduce((sum, l) => {
                  const up = l.unitPrice === '' ? null : Number(l.unitPrice)
                  const q = Number(l.quantityOrdered) || 0
                  if (up === null || !Number.isFinite(q)) return sum
                  return sum + up * q
                }, 0)
                return (
                  <div className="flex justify-end gap-2 border-t border-slate-200 pt-2 text-sm dark:border-slate-700">
                    <span className="text-slate-500 dark:text-slate-400">
                      มูลค่ารวมทั้งหมด:
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-100">
                      {formatBaht(grand, lang)}
                    </span>
                  </div>
                )
              })()}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                หมายเหตุ
              </Label>
              <Textarea
                value={poForm.remark}
                onChange={(e) =>
                  setPoForm({ ...poForm, remark: e.target.value })
                }
                rows={2}
                placeholder="เช่น สั่งเพื่อเติมสต๊อกประจำเดือน..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPoDialogOpen(false)}
              disabled={savingPo}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={savePo}
              disabled={savingPo}
              className="bg-teal-600 text-white hover:bg-teal-700 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {savingPo ? 'กำลังบันทึก...' : 'สร้างใบสั่งซื้อ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Reject pending dialog ===== */}
      <Dialog
        open={Boolean(rejectingTxn)}
        onOpenChange={(o) => {
          if (!o) {
            setRejectingTxn(null)
            setRejectReason('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
              <XCircle className="h-4 w-4" />
              ปฏิเสธคำขอเบิกออก
            </DialogTitle>
            <DialogDescription>
              {rejectingTxn && (
                <span>
                  คุณกำลังจะปฏิเสธคำขอเบิกออก{' '}
                  <strong className="text-slate-700 dark:text-slate-200">
                    {rejectingTxn.productCode ?? '—'} — {rejectingTxn.productName ?? rejectingTxn.stockItem?.productName ?? ''}
                  </strong>
                  <br />
                  จำนวน {rejectingTxn.quantity} {rejectingTxn.unit ?? ''}
                  {rejectingTxn.workOrderNo && (
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      เลขที่ใบงานที่เชื่อมโยง: {rejectingTxn.workOrderNo}
                    </span>
                  )}
                  <br />
                  ระบบจะไม่ตัดจำนวนสต๊อก — ผู้เบิกต้องสร้างคำขอใหม่หากต้องการ
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              เหตุผลในการปฏิเสธ <span className="text-rose-500">*</span>
            </Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="เช่น ระบุเหตุผลที่ปฏิเสธ, จำนวนเกินกว่าที่อนุมัติได้, ไม่ใช่งานที่รับผิดชอบ..."
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectingTxn(null)
                setRejectReason('')
              }}
              disabled={rejecting}
            >
              ยกเลิก
            </Button>
            <Button
              onClick={handleRejectPending}
              disabled={rejecting || !rejectReason.trim()}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
            >
              {rejecting ? 'กำลังบันทึก...' : 'ปฏิเสธคำขอ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------- Detail field helper ----------

function DetailField({
  label,
  value,
  mono,
  highlight,
  span,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  highlight?: boolean
  span?: 1 | 2
}) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div
        className={`mt-0.5 text-sm ${
          highlight
            ? 'font-semibold text-rose-600 dark:text-rose-400'
            : 'text-slate-800 dark:text-slate-100'
        } ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value || value === '0' ? value : '—'}
      </div>
    </div>
  )
}
