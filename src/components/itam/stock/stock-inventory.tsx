'use client'

/**
 * StockInventory — คลังสินค้า (Tab 2)
 *
 * - Product table: ProductCode, ProductName, Quantity, Unit, UnitPrice, TotalValue, ReorderPoint, Status, Actions
 * - Search + Add New Product button
 * - Edit/Delete actions
 *
 * API:
 *   - GET    /api/stock-items?search=&category=&lowStock=&activeOnly=1
 *   - POST   /api/stock-items
 *   - PUT    /api/stock-items/[id]
 *   - DELETE /api/stock-items/[id]  (soft delete)
 *   - GET    /api/stock-items/[id]  (detail incl. transactions)
 *   - POST   /api/stock-items/[id]/transaction  (single IN/OUT/ADJUST)
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { useLang } from '@/store/i18n-store'
import {
  Package,
  Plus,
  RefreshCw,
  Search,
  AlertTriangle,
  Pencil,
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  SlidersHorizontal,
  Eye,
  Loader2,
  Check,
  PackageSearch,
  X,
  Download,
} from 'lucide-react'
import {
  type StockItem,
  type StockTransaction,
  stockKeys,
  buildCategoryOptions,
  buildSiteOptions,
  categoryLabel,
  TYPE_LABELS,
  TYPE_BADGES,
  formatBaht,
  formatInt,
  formatDateTime,
  truncate,
  isLow,
  authFetch,
  PRIMARY_BTN,
} from './shared'
import { canSelectSite } from '../types'
import { useAuthStore } from '@/store/auth-store'
import { CustomExportDialog, type ExportColumn, type ExportFormat } from '../custom-export-dialog'
import { runCustomExport } from '@/lib/custom-export'

// ============================================================
// Custom Export — Stock Inventory (Task ID: FIX-1-2-EXPORT-PRINT)
// ============================================================
const STOCK_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'productCode', label: 'รหัสสินค้า', group: 'สินค้า' },
  { key: 'productName', label: 'ชื่อสินค้า', group: 'สินค้า' },
  { key: 'category', label: 'หมวดหมู่', group: 'สินค้า' },
  { key: 'brand', label: 'แบรนด์', group: 'สินค้า' },
  { key: 'model', label: 'รุ่น', group: 'สินค้า' },
  { key: 'quantity', label: 'จำนวนคงเหลือ', group: 'สต็อก' },
  { key: 'minQuantity', label: 'สต็อกต่ำสุด', group: 'สต็อก' },
  { key: 'unitCost', label: 'ราคา/หน่วย', group: 'สต็อก' },
  { key: 'totalValue', label: 'มูลค่ารวม', group: 'สต็อก' },
  { key: 'location', label: 'ตำแหน่ง', group: 'สต็อก' },
  { key: 'site', label: 'สาขา', group: 'สต็อก' },
  { key: 'status', label: 'สถานะ', group: 'สต็อก' },
]

// ── Response types ─────────────────────────────────────────────────────

interface StockListResponse {
  data: StockItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  stats: { total: number; lowStock: number; totalValue: number; thisMonth: number }
}

interface StockDetailResponse {
  data: StockItem & { transactions: StockTransaction[] }
}

// ── Form types ─────────────────────────────────────────────────────────

interface ProductForm {
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
  // ── Cost Analytics fields ──
  costType: string
  yieldPerPage: string
  depreciationMethod: string
  usefulLifeMonths: string
  usefulLifePages: string
}

const EMPTY_FORM: ProductForm = {
  productCode: '',
  productName: '',
  category: '',
  brand: '',
  model: '',
  unit: 'ชิ้น',
  quantity: '0',
  minQuantity: '0',
  maxQuantity: '0',
  unitCost: '',
  location: '',
  site: '',
  compatibleDevices: '',
  remark: '',
  costType: '',
  yieldPerPage: '',
  depreciationMethod: '',
  usefulLifeMonths: '',
  usefulLifePages: '',
}

// ── Component ──────────────────────────────────────────────────────────

export function StockInventory() {
  const { lang } = useLang()
  const qc = useQueryClient()

  // ── Fetch ProductCategory from MasterItem + sites from DB ──
  const { data: productCategoriesData } = useQuery<{ code: string; label: string }[]>({
    queryKey: ['master-product-categories'],
    queryFn: async () => {
      try {
        const res = await authFetch<{ items: { code: string; label: string }[] }>(
          '/api/master?category=ProductCategory',
        )
        return res.items ?? []
      } catch {
        return []
      }
    },
    staleTime: 120_000,
  })
  // Use ProductCategory codes from MasterItem as the canonical list.
  // Fall back to distinct categories from StockItem if MasterItem has none.
  const { data: stockData } = useQuery<StockListResponse>({
    queryKey: stockKeys.list({ pageSize: 200, forOptions: true }),
    queryFn: () =>
      authFetch<StockListResponse>('/api/stock-items?activeOnly=0&pageSize=200'),
    staleTime: 120_000,
  })
  const dbCategories = React.useMemo(() => {
    if (productCategoriesData && productCategoriesData.length > 0) {
      return productCategoriesData.map((pc) => pc.code)
    }
    // Fallback: distinct categories from StockItem
    const set = new Set<string>()
    for (const item of stockData?.data ?? []) {
      if (item.category) set.add(item.category)
    }
    return Array.from(set)
  }, [productCategoriesData, stockData])

  const { data: siteData } = useQuery<{ sites: { code: string; name?: string | null }[] }>({
    queryKey: ['sites-for-stock'],
    queryFn: async () => {
      try {
        const res = await authFetch<{ sites: { code: string; name?: string | null }[] }>('/api/sites')
        return res
      } catch {
        return { sites: [] }
      }
    },
    staleTime: 120_000,
  })
  const dbSites = siteData?.sites ?? []

  const categoryOptions = React.useMemo(() => buildCategoryOptions(dbCategories), [dbCategories])
  const siteOptions = React.useMemo(() => buildSiteOptions(dbSites), [dbSites])

  // Filter state
  const [categoryFilter, setCategoryFilter] = React.useState('all')
  const [siteFilter, setSiteFilter] = React.useState('all')
  const [lowStockOnly, setLowStockOnly] = React.useState(false)
  const [search, setSearch] = React.useState('')

  // ── Site filter visibility — only show if user can select among multiple sites ──
  const authUser = useAuthStore((s) => s.user)
  const showSiteFilter = authUser ? canSelectSite(authUser) : false

  // Create/Edit dialog state
  const [formOpen, setFormOpen] = React.useState(false)
  const [editTarget, setEditTarget] = React.useState<StockItem | null>(null)
  const [form, setForm] = React.useState<ProductForm>(EMPTY_FORM)

  // Detail dialog state
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailItem, setDetailItem] = React.useState<StockItem | null>(null)

  // Quick txn dialog state (single-item IN/OUT/ADJUST)
  type TxnType = 'IN' | 'OUT' | 'ADJUST'
  const [txnOpen, setTxnOpen] = React.useState(false)
  const [txnType, setTxnType] = React.useState<TxnType>('IN')
  const [txnTarget, setTxnTarget] = React.useState<StockItem | null>(null)
  const [txnForm, setTxnForm] = React.useState({
    quantity: '',
    vendor: '',
    cost: '',
    reason: '',
    remark: '',
  })

  // ── Queries ──────────────────────────────────────────────────────────

  const queryKey = stockKeys.list({
    category: categoryFilter,
    site: siteFilter,
    lowStock: lowStockOnly ? 1 : 0,
    search: search.trim().toLowerCase(),
  })

  const { data, isLoading, isFetching } = useQuery<StockListResponse>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ activeOnly: '1', pageSize: '200' })
      if (categoryFilter !== 'all') params.set('category', categoryFilter)
      if (siteFilter !== 'all') params.set('site', siteFilter)
      if (lowStockOnly) params.set('lowStock', '1')
      const q = search.trim()
      if (q) params.set('search', q)
      return authFetch<StockListResponse>(`/api/stock-items?${params.toString()}`)
    },
    staleTime: 30_000,
  })

  const items = data?.data ?? []

  const { data: detailData, isLoading: detailLoading } = useQuery<StockDetailResponse>({
    queryKey: stockKeys.detail(detailItem?.id ?? ''),
    queryFn: () => authFetch<StockDetailResponse>(`/api/stock-items/${detailItem!.id}`),
    enabled: !!detailItem && detailOpen,
    staleTime: 10_000,
  })

  // ── Mutations ────────────────────────────────────────────────────────

  const upsertMutation = useMutation({
    mutationFn: async (input: { id?: string; data: ProductForm }) => {
      const payload = {
        productCode: input.data.productCode.trim() || undefined,
        productName: input.data.productName.trim(),
        category: input.data.category.trim() || null,
        brand: input.data.brand.trim() || null,
        model: input.data.model.trim() || null,
        unit: input.data.unit.trim() || 'ชิ้น',
        quantity: Number(input.data.quantity) || 0,
        minQuantity: Number(input.data.minQuantity) || 0,
        maxQuantity: Number(input.data.maxQuantity) || 0,
        unitCost: input.data.unitCost === '' ? null : Number(input.data.unitCost),
        location: input.data.location.trim() || null,
        site: input.data.site.trim() || null,
        compatibleDevices: input.data.compatibleDevices.trim() || null,
        remark: input.data.remark.trim() || null,
        // ── Cost Analytics ──
        costType: input.data.costType || null,
        yieldPerPage: input.data.yieldPerPage === '' ? null : Number(input.data.yieldPerPage),
        depreciationMethod: input.data.depreciationMethod || null,
        usefulLifeMonths: input.data.usefulLifeMonths === '' ? null : Number(input.data.usefulLifeMonths),
        usefulLifePages: input.data.usefulLifePages === '' ? null : Number(input.data.usefulLifePages),
      }
      if (input.id) {
        return authFetch<{ data: StockItem }>(`/api/stock-items/${input.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      }
      return authFetch<{ data: StockItem }>(`/api/stock-items`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: (_json, vars) => {
      toast.success(vars.id ? 'แก้ไขสินค้าแล้ว' : 'สร้างสินค้าแล้ว')
      qc.invalidateQueries({ queryKey: ['stock-items'] })
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setFormOpen(false)
      setEditTarget(null)
      setForm(EMPTY_FORM)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      authFetch(`/api/stock-items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('ลบสินค้าแล้ว')
      qc.invalidateQueries({ queryKey: ['stock-items'] })
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  const txnMutation = useMutation({
    mutationFn: async ({ id, type, body }: { id: string; type: TxnType; body: Record<string, unknown> }) =>
      authFetch(`/api/stock-items/${id}/transaction`, {
        method: 'POST',
        body: JSON.stringify({ type, ...body }),
      }),
    onSuccess: () => {
      const verb = txnType === 'IN' ? 'รับเข้า' : txnType === 'OUT' ? 'เบิกออก' : 'ปรับปรุง'
      toast.success(`${verb}สต็อกเรียบร้อยแล้ว`)
      qc.invalidateQueries({ queryKey: ['stock-items'] })
      if (detailOpen && detailItem) {
        qc.invalidateQueries({ queryKey: stockKeys.detail(detailItem.id) })
      }
      setTxnOpen(false)
      setTxnTarget(null)
      setTxnForm({ quantity: '', vendor: '', cost: '', reason: '', remark: '' })
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEdit(item: StockItem, e?: React.MouseEvent) {
    e?.stopPropagation()
    setEditTarget(item)
    setForm({
      productCode: item.productCode,
      productName: item.productName,
      category: item.category ?? '',
      brand: item.brand ?? '',
      model: item.model ?? '',
      unit: item.unit,
      quantity: String(item.quantity),
      minQuantity: String(item.minQuantity),
      maxQuantity: String(item.maxQuantity),
      unitCost: item.unitCost == null ? '' : String(item.unitCost),
      location: item.location ?? '',
      site: item.site ?? '',
      compatibleDevices: item.compatibleDevices ?? '',
      remark: item.remark ?? '',
      // ── Cost Analytics ──
      costType: (item as StockItem & { costType?: string | null }).costType ?? '',
      yieldPerPage: (item as StockItem & { yieldPerPage?: number | null }).yieldPerPage == null ? '' : String((item as StockItem & { yieldPerPage?: number | null }).yieldPerPage),
      depreciationMethod: (item as StockItem & { depreciationMethod?: string | null }).depreciationMethod ?? '',
      usefulLifeMonths: (item as StockItem & { usefulLifeMonths?: number | null }).usefulLifeMonths == null ? '' : String((item as StockItem & { usefulLifeMonths?: number | null }).usefulLifeMonths),
      usefulLifePages: (item as StockItem & { usefulLifePages?: number | null }).usefulLifePages == null ? '' : String((item as StockItem & { usefulLifePages?: number | null }).usefulLifePages),
    })
    setFormOpen(true)
  }

  function openDetail(item: StockItem) {
    setDetailItem(item)
    setDetailOpen(true)
  }

  function openTxn(item: StockItem, type: TxnType, e?: React.MouseEvent) {
    e?.stopPropagation()
    setTxnTarget(item)
    setTxnType(type)
    setTxnForm({
      quantity: type === 'ADJUST' ? String(item.quantity) : '',
      vendor: '',
      cost: '',
      reason: '',
      remark: '',
    })
    setTxnOpen(true)
  }

  function submitForm() {
    if (!form.productName.trim()) {
      toast.error('กรุณาระบุชื่อสินค้า')
      return
    }
    upsertMutation.mutate({ id: editTarget?.id, data: form })
  }

  function submitTxn() {
    if (!txnTarget) return
    const qty = Number(txnForm.quantity)
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error('กรุณาระบุจำนวนที่ถูกต้อง')
      return
    }
    if (txnType !== 'ADJUST' && qty <= 0) {
      toast.error('จำนวนต้องมากกว่า 0')
      return
    }
    if (txnType === 'OUT' && qty > txnTarget.quantity) {
      toast.error(`จำนวนเบิกเกินคงเหลือ (${txnTarget.quantity} ${txnTarget.unit})`)
      return
    }
    txnMutation.mutate({
      id: txnTarget.id,
      type: txnType,
      body: {
        quantity: Math.trunc(qty),
        vendor: txnForm.vendor.trim() || null,
        cost: txnForm.cost === '' ? null : Number(txnForm.cost),
        reason: txnForm.reason.trim() || null,
        remark: txnForm.remark.trim() || null,
      },
    })
  }

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = React.useState<StockItem | null>(null)

  // Custom export dialog state (Task ID: FIX-1-2-EXPORT-PRINT)
  const [customExportOpen, setCustomExportOpen] = React.useState(false)

  // ── Custom Export handler ──
  // Builds rows from the currently filtered `items` list and delegates to
  // the shared runCustomExport helper.
  const handleCustomExport = React.useCallback(
    (columns: ExportColumn[], format: ExportFormat) => {
      if (items.length === 0) {
        toast.warning('ไม่มีข้อมูลสินค้าในตัวกรองปัจจุบันให้ส่งออก')
        return
      }
      const rows: Record<string, unknown>[] = items.map((item) => {
        const low = isLow(item)
        const out = item.quantity <= 0
        const status = out ? 'หมด' : low ? 'ต่ำ' : !item.active ? 'ปิดใช้งาน' : 'ปกติ'
        return {
          productCode: item.productCode ?? '',
          productName: item.productName ?? '',
          category: item.category ? categoryLabel(item.category) : '',
          brand: item.brand ?? '',
          model: item.model ?? '',
          quantity: item.quantity ?? 0,
          minQuantity: item.minQuantity ?? 0,
          unitCost: item.unitCost ?? 0,
          totalValue: (item.unitCost ?? 0) * (item.quantity ?? 0),
          location: item.location ?? '',
          site: item.site ?? '',
          status,
        }
      })
      runCustomExport(columns, format, rows, 'stock-inventory', 'รายงานสต็อกสินค้า')
      toast.success(`ส่งออก ${rows.length} รายการ`)
    },
    [items],
  )

  function handleDelete(item: StockItem, e?: React.MouseEvent) {
    e?.stopPropagation()
    setDeleteTarget(item)
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Action bar */}
      <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ['stock-items'] })}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>
          <Button onClick={openCreate} className={PRIMARY_BTN}>
            <Plus className="h-4 w-4" /> เพิ่มสินค้า
          </Button>
          {/* ส่งออก — Task ID: FIX-1-2-EXPORT-PRINT */}
          <Button
            variant="outline"
            onClick={() => setCustomExportOpen(true)}
            className="dark:bg-slate-800 dark:border-slate-700"
          >
            <Download className="h-4 w-4" /> ส่งออก
          </Button>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          ทั้งหมด {items.length.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} รายการ
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-shrink-0 flex-col gap-2 lg:flex-row lg:items-center">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full lg:w-44 dark:bg-slate-800 dark:border-slate-700">
            <SelectValue placeholder="หมวดหมู่" />
          </SelectTrigger>
          <SelectContent>
            {categoryOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showSiteFilter && (
          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger className="w-full lg:w-44 dark:bg-slate-800 dark:border-slate-700">
              <SelectValue placeholder="สาขา" />
            </SelectTrigger>
            <SelectContent>
              {siteOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          <Switch
            id="low-only"
            checked={lowStockOnly}
            onCheckedChange={setLowStockOnly}
            className="data-[state=checked]:bg-rose-500"
          />
          <Label htmlFor="low-only" className="cursor-pointer text-xs text-slate-600 dark:text-slate-300">
            สต็อกต่ำเท่านั้น
          </Label>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="ค้นหาด้วยรหัส / ชื่อ / แบรนด์ / รุ่น..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 dark:bg-slate-800 dark:border-slate-700"
          />
        </div>
      </div>

      {/* Product table — fills remaining height (Issue 3) */}
      <Card className="flex min-h-0 flex-1 flex-col border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="min-h-0 flex-1 p-0">
          <div className="itam-scroll max-h-[calc(100vh-20rem)] min-h-[300px] overflow-auto overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95">
                <TableRow>
                  <TableHead className="w-28 whitespace-nowrap">รหัสสินค้า</TableHead>
                  <TableHead className="min-w-[200px] whitespace-nowrap">ชื่อสินค้า</TableHead>
                  <TableHead className="w-24 whitespace-nowrap text-right">คงเหลือ</TableHead>
                  <TableHead className="w-20 whitespace-nowrap">หน่วย</TableHead>
                  <TableHead className="w-28 whitespace-nowrap text-right">ราคา/หน่วย</TableHead>
                  <TableHead className="w-32 whitespace-nowrap text-right">มูลค่ารวม</TableHead>
                  <TableHead className="w-24 whitespace-nowrap text-right">จุดสั่งซื้อซ้ำ</TableHead>
                  <TableHead className="w-24 whitespace-nowrap">สถานะ</TableHead>
                  <TableHead className="w-72 whitespace-nowrap text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={9}><Skeleton className="h-7 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-14">
                      <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
                        <PackageSearch className="h-12 w-12" />
                        <div className="text-sm font-medium">ยังไม่มีสินค้าในสต็อก</div>
                        <Button size="sm" onClick={openCreate} className={PRIMARY_BTN}>
                          <Plus className="h-4 w-4" /> เพิ่มสินค้าใหม่
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const low = isLow(item)
                    const out = item.quantity <= 0
                    return (
                      <TableRow
                        key={item.id}
                        onClick={() => openDetail(item)}
                        className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 ${!item.active ? 'opacity-50' : ''}`}
                      >
                        <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600 dark:text-slate-300">
                          {item.productCode}
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[250px] truncate font-medium text-slate-800 dark:text-slate-100" title={item.productName ?? ''}>
                            {item.productName}
                          </div>
                          {(item.brand || item.model) && (
                            <div className="max-w-[250px] truncate text-[11px] text-slate-500 dark:text-slate-400" title={[item.brand, item.model].filter(Boolean).join(' · ')}>
                              {[item.brand, item.model].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {item.category && (
                            <Badge className="mt-0.5 bg-slate-100 text-slate-600 border-slate-200 text-[9px] dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                              {categoryLabel(item.category)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs ${low ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-700 dark:text-slate-200'}`}>
                          {formatInt(item.quantity)}
                          {low && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 dark:text-slate-400">
                          {item.unit}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-slate-700 dark:text-slate-200">
                          {formatBaht(item.unitCost)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {formatBaht((item.unitCost ?? 0) * item.quantity)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                          {item.minQuantity > 0 ? formatInt(item.minQuantity) : '—'}
                        </TableCell>
                        <TableCell>
                          {out ? (
                            <Badge className="bg-rose-100 text-rose-700 border-rose-200 text-[10px] dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800">
                              หมด
                            </Badge>
                          ) : low ? (
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
                              ต่ำ
                            </Badge>
                          ) : !item.active ? (
                            <Badge className="bg-slate-200 text-slate-500 text-[10px]" variant="outline">
                              ปิดใช้งาน
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
                              ปกติ
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              title="รับเข้า" aria-label="รับเข้า"
                              onClick={(e) => openTxn(item, 'IN', e)}
                              className="h-7 px-2 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950"
                            >
                              <ArrowDownToLine className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="เบิกออก" aria-label="เบิกออก"
                              onClick={(e) => openTxn(item, 'OUT', e)}
                              disabled={item.quantity <= 0}
                              className="h-7 px-2 text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950"
                            >
                              <ArrowUpFromLine className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="ปรับปรุง" aria-label="ปรับปรุง"
                              onClick={(e) => openTxn(item, 'ADJUST', e)}
                              className="h-7 px-2 text-sky-600 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-950"
                            >
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="ดูรายละเอียด"
                              aria-label={`ดูรายละเอียด ${item.productName ?? item.productCode ?? ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                openDetail(item)
                              }}
                              className="h-7 px-2 text-slate-500 hover:text-[#f97316]"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="แก้ไข" aria-label="แก้ไข"
                              onClick={(e) => openEdit(item, e)}
                              className="h-7 px-2 text-slate-500 hover:text-[#0d9488]"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="ลบ" aria-label="ลบ"
                              onClick={(e) => handleDelete(item, e)}
                              disabled={deleteMutation.isPending}
                              className="h-7 px-2 text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
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

      {/* ── Create/Edit Dialog ─────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-[#f97316]" />
              {editTarget ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าสต็อก'}
            </DialogTitle>
            <DialogDescription>
              {editTarget
                ? `รหัส: ${editTarget.productCode}`
                : 'กรอกข้อมูลสินค้าที่ต้องการเก็บในคลังสต็อก'}
            </DialogDescription>
          </DialogHeader>

          <div className="itam-scroll max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {/* ProductCode (optional — auto-generated if blank) */}
            <div className="space-y-1.5">
              <Label htmlFor="stk-code">รหัสสินค้า <span className="text-[10px] text-slate-400">(ไม่บังคับ — ระบบสร้างให้อัตโนมัติรูปแบบ STK-NNNN)</span></Label>
              <Input
                id="stk-code"
                placeholder="เว้นว่าง = สร้างอัตโนมัติ เช่น STK-0001"
                value={form.productCode}
                onChange={(e) => setForm((f) => ({ ...f, productCode: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
              {!editTarget && (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                  ✓ ถ้าเว้นว่าง ระบบจะสร้างรหัสใหม่ให้อัตโนมัติ (ต่อจากล่าสุด)
                </p>
              )}
            </div>

            {/* ProductName */}
            <div className="space-y-1.5">
              <Label htmlFor="stk-name">ชื่อสินค้า <span className="text-rose-500">*</span></Label>
              <Input
                id="stk-name"
                placeholder="เช่น หมึกพิมพ์ EPSON T544"
                value={form.productName}
                onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label htmlFor="stk-cat">หมวดหมู่ <span className="text-[10px] text-slate-400">(เลือกจาก ProductCategory)</span></Label>
              <Select
                value={form.category || '__none__'}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v === '__none__' ? '' : v }))}
              >
                <SelectTrigger className="w-full dark:bg-slate-800 dark:border-slate-700">
                  <SelectValue placeholder="— เลือกหมวดหมู่ —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— ไม่ระบุ —</SelectItem>
                  {categoryOptions.filter((o) => o.value !== 'all').map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Brand + Model */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="stk-brand">แบรนด์</Label>
                <Input
                  id="stk-brand"
                  placeholder="เช่น EPSON"
                  value={form.brand}
                  onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stk-model">รุ่น/ขนาด</Label>
                <Input
                  id="stk-model"
                  placeholder="เช่น T544"
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>

            {/* Unit + Quantity */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="stk-unit">หน่วย</Label>
                <Input
                  id="stk-unit"
                  placeholder="ชิ้น, กล่อง, แพ็ค, ม้วน..."
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stk-qty">จำนวนเริ่มต้น</Label>
                <Input
                  id="stk-qty"
                  type="number"
                  min="0"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>

            {/* Min + Max */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="stk-min">สต็อกต่ำสุด (เตือน)</Label>
                <Input
                  id="stk-min"
                  type="number"
                  min="0"
                  value={form.minQuantity}
                  onChange={(e) => setForm((f) => ({ ...f, minQuantity: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stk-max">สต็อกสูงสุด</Label>
                <Input
                  id="stk-max"
                  type="number"
                  min="0"
                  value={form.maxQuantity}
                  onChange={(e) => setForm((f) => ({ ...f, maxQuantity: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>

            {/* Unit cost */}
            <div className="space-y-1.5">
              <Label htmlFor="stk-cost">ราคาต่อหน่วย (฿)</Label>
              <Input
                id="stk-cost"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.unitCost}
                onChange={(e) => setForm((f) => ({ ...f, unitCost: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* ── การคำนวณต้นทุนวัสดุ ── */}
            <div className="rounded-lg border border-[#f97316]/30 bg-[#f97316]/5 p-3 dark:border-[#fb923c]/30 dark:bg-[#fb923c]/5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#f97316] dark:text-[#fb923c]">
                💰 การคำนวณต้นทุนวัสดุ
              </div>
              {/* costType */}
              <div className="space-y-1.5">
                <Label htmlFor="stk-costtype" className="text-xs">
                  ประเภทการคำนวณ
                </Label>
                <Select
                  value={form.costType || '__none__'}
                  onValueChange={(v) => setForm((f) => ({
                    ...f,
                    costType: v === '__none__' ? '' : v,
                    yieldPerPage: v !== 'consumable' ? '' : f.yieldPerPage,
                    depreciationMethod: v !== 'spare_part' ? '' : f.depreciationMethod,
                    usefulLifeMonths: v !== 'spare_part' ? '' : f.usefulLifeMonths,
                    usefulLifePages: v !== 'spare_part' ? '' : f.usefulLifePages,
                  }))}
                >
                  <SelectTrigger id="stk-costtype" className="w-full dark:bg-slate-800 dark:border-slate-700">
                    <SelectValue placeholder="— เลือกประเภท —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— ไม่ระบุ —</SelectItem>
                    <SelectItem value="consumable">วัสดุสิ้นเปลือง (หมึก, ผงถ่าน)</SelectItem>
                    <SelectItem value="spare_part">อะไหล่ (Drum, Fuser, Belt)</SelectItem>
                    <SelectItem value="service">บริการ (ค่าซ่อมนอก, ขนส่ง)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* consumable → yieldPerPage */}
              {form.costType === 'consumable' && (
                <div className="mt-2 space-y-1.5">
                  <Label htmlFor="stk-yield" className="text-xs">
                    อัตราการพิมพ์ต่อขวด/ตลับ (แผ่น)
                  </Label>
                  <Input
                    id="stk-yield"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="เช่น 1500 (พิมพ์ได้ 1,500 แผ่นต่อขวด)"
                    value={form.yieldPerPage}
                    onChange={(e) => setForm((f) => ({ ...f, yieldPerPage: e.target.value }))}
                    className="dark:bg-slate-800 dark:border-slate-700"
                  />
                  {form.unitCost && form.yieldPerPage && Number(form.yieldPerPage) > 0 && (
                    <div className="rounded bg-orange-50 px-2 py-1 text-[11px] text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                      💡 ต้นทุนต่อแผ่น = ฿{Number(form.unitCost).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ÷ {Number(form.yieldPerPage).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} = <strong>฿{(Number(form.unitCost) / Number(form.yieldPerPage)).toFixed(2)}/แผ่น</strong>
                    </div>
                  )}
                </div>
              )}

              {/* spare_part → depreciation */}
              {form.costType === 'spare_part' && (
                <div className="mt-2 space-y-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="stk-depmethod" className="text-xs">วิธีคำนวณค่าเสื่อม</Label>
                    <Select
                      value={form.depreciationMethod || '__none__'}
                      onValueChange={(v) => setForm((f) => ({
                        ...f,
                        depreciationMethod: v === '__none__' ? '' : v,
                        usefulLifeMonths: v !== 'straight_line' ? '' : f.usefulLifeMonths,
                        usefulLifePages: v !== 'usage_based' ? '' : f.usefulLifePages,
                      }))}
                    >
                      <SelectTrigger id="stk-depmethod" className="w-full dark:bg-slate-800 dark:border-slate-700">
                        <SelectValue placeholder="— เลือกวิธี —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— ไม่ระบุ —</SelectItem>
                        <SelectItem value="straight_line">เสื่อมตามเวลา (ต่อเดือน)</SelectItem>
                        <SelectItem value="usage_based">เสื่อมตามการใช้งาน (ต่อแผ่น)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.depreciationMethod === 'straight_line' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="stk-life-months" className="text-xs">อายุการใช้งาน (เดือน)</Label>
                      <Input
                        id="stk-life-months"
                        type="number"
                        min="1"
                        placeholder="เช่น 24 (2 ปี)"
                        value={form.usefulLifeMonths}
                        onChange={(e) => setForm((f) => ({ ...f, usefulLifeMonths: e.target.value }))}
                        className="dark:bg-slate-800 dark:border-slate-700"
                      />
                      {form.unitCost && form.usefulLifeMonths && Number(form.usefulLifeMonths) > 0 && (
                        <div className="rounded bg-violet-50 px-2 py-1 text-[11px] text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                          💡 ต้นทุนต่อเดือน = ฿{Number(form.unitCost).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ÷ {form.usefulLifeMonths} = <strong>฿{(Number(form.unitCost) / Number(form.usefulLifeMonths)).toFixed(2)}/เดือน</strong>
                        </div>
                      )}
                    </div>
                  )}
                  {form.depreciationMethod === 'usage_based' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="stk-life-pages" className="text-xs">อายุการใช้งาน (แผ่นพิมพ์)</Label>
                      <Input
                        id="stk-life-pages"
                        type="number"
                        min="1"
                        placeholder="เช่น 100000 (100K แผ่น)"
                        value={form.usefulLifePages}
                        onChange={(e) => setForm((f) => ({ ...f, usefulLifePages: e.target.value }))}
                        className="dark:bg-slate-800 dark:border-slate-700"
                      />
                      {form.unitCost && form.usefulLifePages && Number(form.usefulLifePages) > 0 && (
                        <div className="rounded bg-violet-50 px-2 py-1 text-[11px] text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                          💡 ต้นทุนต่อแผ่น = ฿{Number(form.unitCost).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} ÷ {Number(form.usefulLifePages).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')} = <strong>฿{(Number(form.unitCost) / Number(form.usefulLifePages)).toFixed(4)}/แผ่น</strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {form.costType === 'service' && (
                <div className="mt-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-[11px] text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                  ✓ ต้นทุน = ราคา × จำนวน (คำนวณตรงตัวเมื่อเบิกใช้)
                </div>
              )}

              {!form.costType && (
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                  เลือกประเภทการคำนวณเพื่อให้ระบบคำนวณต้นทุนต่อแผ่น/เดือน อัตโนมัติ
                </div>
              )}
            </div>

            {/* Location + Site */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="stk-loc">ตำแหน่งเก็บ</Label>
                <Input
                  id="stk-loc"
                  placeholder="ตู้ A / ชั้น 3..."
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stk-site">สาขา</Label>
                <Input
                  id="stk-site"
                  list="stk-site-list"
                  placeholder="MECUD / MECNK / ..."
                  value={form.site}
                  onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))}
                  className="dark:bg-slate-800 dark:border-slate-700"
                />
                <datalist id="stk-site-list">
                  {siteOptions.filter((o) => o.value !== 'all').map((o) => (
                    <option key={o.value} value={o.value} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Compatible devices */}
            <div className="space-y-1.5">
              <Label htmlFor="stk-comp">อุปกรณ์ที่รองรับ</Label>
              <Input
                id="stk-comp"
                placeholder="คั่นด้วยจุลภาค เช่น EPSON L5290, L3210"
                value={form.compatibleDevices}
                onChange={(e) => setForm((f) => ({ ...f, compatibleDevices: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            {/* Remark */}
            <div className="space-y-1.5">
              <Label htmlFor="stk-rem">หมายเหตุ</Label>
              <Textarea
                id="stk-rem"
                rows={2}
                placeholder="(ไม่บังคับ)"
                value={form.remark}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={upsertMutation.isPending}>
              ยกเลิก
            </Button>
            <Button
              onClick={submitForm}
              disabled={upsertMutation.isPending || !form.productName.trim()}
              className={PRIMARY_BTN}
            >
              {upsertMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> กำลังบันทึก...</>
              ) : (
                <><Check className="h-4 w-4" /> {editTarget ? 'บันทึกการแก้ไข' : 'สร้างสินค้า'}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Quick Transaction Dialog (IN/OUT/ADJUST) ─────────────────── */}
      <Dialog open={txnOpen} onOpenChange={setTxnOpen}>
        <DialogContent className="sm:max-w-lg dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle>
              {txnType === 'IN' && <><ArrowDownToLine className="mr-1 inline h-5 w-5 text-emerald-600" /> รับเข้าสต็อก</>}
              {txnType === 'OUT' && <><ArrowUpFromLine className="mr-1 inline h-5 w-5 text-amber-600" /> เบิกออกสต็อก</>}
              {txnType === 'ADJUST' && <><SlidersHorizontal className="mr-1 inline h-5 w-5 text-sky-600" /> ปรับปรุงสต็อก</>}
            </DialogTitle>
            <DialogDescription>
              {txnTarget && (
                <span className="font-mono text-xs">
                  {txnTarget.productCode} · {txnTarget.productName}
                  <span className="ml-2 text-slate-400">คงเหลือปัจจุบัน: {txnTarget.quantity} {txnTarget.unit}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="txn-qty">
                {txnType === 'ADJUST' ? 'จำนวนคงเหลือใหม่' : 'จำนวน'} <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="txn-qty"
                type="number"
                min="0"
                value={txnForm.quantity}
                onChange={(e) => setTxnForm((f) => ({ ...f, quantity: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
              {txnType === 'OUT' && txnTarget && (
                <div className="text-xs text-slate-400">
                  คงเหลือปัจจุบัน {txnTarget.quantity} {txnTarget.unit}
                  {txnTarget.minQuantity > 0 && (
                    <span className="ml-1">(ต่ำสุด {txnTarget.minQuantity})</span>
                  )}
                </div>
              )}
            </div>

            {txnType === 'IN' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="txn-vendor">ซื้อจาก / ผู้จำหน่าย</Label>
                  <Input
                    id="txn-vendor"
                    placeholder="(ไม่บังคับ) เช่น บจก. ออฟฟิศเมท..."
                    value={txnForm.vendor}
                    onChange={(e) => setTxnForm((f) => ({ ...f, vendor: e.target.value }))}
                    className="dark:bg-slate-800 dark:border-slate-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="txn-cost">มูลค่ารวม (฿)</Label>
                  <Input
                    id="txn-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={txnForm.cost}
                    onChange={(e) => setTxnForm((f) => ({ ...f, cost: e.target.value }))}
                    className="dark:bg-slate-800 dark:border-slate-700"
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="txn-reason">เหตุผล</Label>
              <Input
                id="txn-reason"
                placeholder={
                  txnType === 'IN'
                    ? 'เช่น ซื้อใหม่, รับบริจาค, คืนจากการยืม...'
                    : txnType === 'OUT'
                      ? 'เช่น เบิกใช้, ย้าย, เสีย, หมดอายุ...'
                      : 'เช่น ตรวจนับ, แก้ไขยอด...'
                }
                value={txnForm.reason}
                onChange={(e) => setTxnForm((f) => ({ ...f, reason: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="txn-rem">หมายเหตุ</Label>
              <Textarea
                id="txn-rem"
                rows={2}
                placeholder="(ไม่บังคับ)"
                value={txnForm.remark}
                onChange={(e) => setTxnForm((f) => ({ ...f, remark: e.target.value }))}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTxnOpen(false)} disabled={txnMutation.isPending}>
              ยกเลิก
            </Button>
            <Button
              onClick={submitTxn}
              disabled={txnMutation.isPending}
              className={
                txnType === 'IN'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : txnType === 'OUT'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-sky-600 hover:bg-sky-700'
              }
            >
              {txnMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> กำลังบันทึก...</>
              ) : (
                <><Check className="h-4 w-4" /> บันทึก</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail Dialog ─────────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-2xl dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-[#f97316]" />
              {detailData?.data.productName ?? detailItem?.productName ?? '—'}
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono text-xs">{detailData?.data.productCode ?? detailItem?.productCode ?? '—'}</span>
            </DialogDescription>
          </DialogHeader>

          {detailLoading && !detailData ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-6 w-1/2" />
            </div>
          ) : detailData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <DetailCell label="หมวดหมู่" value={detailData.data.category} />
                <DetailCell
                  label="คงเหลือ"
                  value={`${formatInt(detailData.data.quantity)} ${detailData.data.unit}`}
                  highlight={isLow(detailData.data)}
                />
                <DetailCell label="ต่ำสุด / สูงสุด" value={`${detailData.data.minQuantity} / ${detailData.data.maxQuantity}`} />
                <DetailCell label="ราคา/หน่วย" value={formatBaht(detailData.data.unitCost)} />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400">แบรนด์:</span>{' '}
                  <span className="text-slate-700 dark:text-slate-200">{detailData.data.brand ?? '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400">รุ่น:</span>{' '}
                  <span className="text-slate-700 dark:text-slate-200">{detailData.data.model ?? '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400">ตำแหน่ง:</span>{' '}
                  <span className="text-slate-700 dark:text-slate-200">{detailData.data.location ?? '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400">สาขา:</span>{' '}
                  <span className="text-slate-700 dark:text-slate-200">{detailData.data.site ?? '—'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400">อุปกรณ์ที่รองรับ:</span>{' '}
                  <span className="text-slate-700 dark:text-slate-200">{detailData.data.compatibleDevices ?? '—'}</span>
                </div>
                {detailData.data.remark && (
                  <div className="col-span-2">
                    <span className="text-slate-400">หมายเหตุ:</span>{' '}
                    <span className="text-slate-700 dark:text-slate-200">{detailData.data.remark}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openTxn(detailData.data, 'IN')}
                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" /> รับเข้า
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openTxn(detailData.data, 'OUT')}
                  disabled={detailData.data.quantity <= 0}
                  className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950"
                >
                  <ArrowUpFromLine className="h-3.5 w-3.5" /> เบิกออก
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openTxn(detailData.data, 'ADJUST')}
                  className="border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" /> ปรับปรุง
                </Button>
              </div>

              {/* Transaction history */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    ประวัติ 10 รายการล่าสุด
                  </Label>
                  {(!detailData.data.transactions || detailData.data.transactions.length === 0) && (
                    <span className="text-[10px] text-slate-400">ยังไม่มีรายการ</span>
                  )}
                </div>
                <div className="rounded-md border border-slate-200 dark:border-slate-700">
                  <div className="itam-scroll max-h-60 overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                        <TableRow>
                          <TableHead className="h-8 text-[10px]">วันที่</TableHead>
                          <TableHead className="h-8 text-[10px]">ประเภท</TableHead>
                          <TableHead className="h-8 text-[10px] text-right">จำนวน</TableHead>
                          <TableHead className="h-8 text-[10px] text-right">คงเหลือ</TableHead>
                          <TableHead className="h-8 text-[10px]">เหตุผล</TableHead>
                          <TableHead className="h-8 text-[10px]">ผู้ทำ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!detailData.data.transactions || detailData.data.transactions.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-6 text-center text-xs text-slate-400">
                              ยังไม่มีรายการเข้า-ออก
                            </TableCell>
                          </TableRow>
                        ) : (
                          detailData.data.transactions.map((t) => (
                            <TableRow key={t.id}>
                              <TableCell className="py-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                                {formatDateTime(t.txnDate)}
                              </TableCell>
                              <TableCell className="py-1.5">
                                <Badge className={`${TYPE_BADGES[t.type] ?? 'bg-slate-100'} px-1.5 py-0 text-[10px]`}>
                                  {TYPE_LABELS[t.type] ?? t.type}
                                </Badge>
                              </TableCell>
                              <TableCell className={`py-1.5 text-right font-mono text-[11px] ${t.type === 'IN' ? 'text-emerald-600' : t.type === 'OUT' ? 'text-amber-600' : 'text-sky-600'}`}>
                                {t.type === 'IN' ? '+' : t.type === 'OUT' ? '-' : '='}{Math.abs(t.quantity)}
                              </TableCell>
                              <TableCell className="py-1.5 text-right font-mono text-[11px] text-slate-700 dark:text-slate-200">
                                {t.balanceAfter}
                              </TableCell>
                              <TableCell className="py-1.5 text-[11px] text-slate-600 dark:text-slate-300" title={t.reason ?? ''}>
                                {truncate(t.reason, 24)}
                              </TableCell>
                              <TableCell className="py-1.5 text-[11px] text-slate-500 dark:text-slate-400" title={t.performedBy ?? ''}>
                                {truncate(t.performedBy, 18)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              <X className="h-4 w-4" /> ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบสินค้า</AlertDialogTitle>
            <AlertDialogDescription>
              คุณกำลังจะลบ{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {deleteTarget?.productName} ({deleteTarget?.productCode})
              </span>
              {' '}— ระบบจะตั้งเป็น "ปิดใช้งาน" ไม่ลบถาวร
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.id, {
                    onSuccess: () => setDeleteTarget(null),
                  })
                }
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              ลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Custom Export Dialog — Task ID: FIX-1-2-EXPORT-PRINT */}
      <CustomExportDialog
        open={customExportOpen}
        onOpenChange={setCustomExportOpen}
        availableColumns={STOCK_EXPORT_COLUMNS}
        onExport={handleCustomExport}
        storageKey="itam-stock-export-cols"
        totalRows={items.length}
      />
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────

function DetailCell({
  label,
  value,
  highlight,
}: {
  label: string
  value: string | null | undefined
  highlight?: boolean
}) {
  return (
    <div className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
      <div className={`mt-1 text-xs ${highlight ? 'font-bold text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200'}`}>
        {value ?? '—'}
      </div>
    </div>
  )
}
