/**
 * Report Read Repository — centralizes all Prisma read queries that the
 * Reports module owns. Routes must NOT import @/lib/db directly; they call
 * through this repository via the reports service.
 *
 * Milestone 2 — extracted from:
 *   src/app/api/reports/monthly/route.ts (5 queries)
 *   src/app/api/reports/unified/route.ts (17 queries)
 *
 * Each method returns plain objects (no Prisma internals) so the service
 * layer can shape them without leaking ORM details.
 */
import { db } from '@/lib/db'

// ── Monthly report queries ──

export interface MonthlyWorkOrderRow {
  id: string
  status: string
  priority: string
  subject: string | null
  assignedTo: string | null
  createdAt: Date
  assignedAt: Date | null
  workCompletedAt: Date | null
}

export interface MonthlyWorkOrderReviewRow {
  workOrderId: string
  rating: number | null
  createdAt: Date
}

export interface MonthlyStockTxnRow {
  type: string
  quantity: number
  productCode: string | null
  productName: string | null
  createdAt: Date
}

export interface MonthlyStockItemRow {
  productCode: string | null
  productName: string
  quantity: number
  minQuantity: number
  unit: string
  unitCost: number | null
}

export interface MonthlyDeviceRow {
  id: string
  status: string
  createdAt: Date
  site: string
}

export const reportReadRepository = {
  // ── Monthly: Work Orders ──
  async findWorkOrdersForMonth(start: Date, end: Date): Promise<MonthlyWorkOrderRow[]> {
    return db.workOrder.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: {
        id: true, status: true, priority: true, subject: true,
        assignedTo: true, createdAt: true, assignedAt: true, workCompletedAt: true,
      },
    })
  },

  // ── Monthly: Work Order Reviews ──
  async findReviewsForMonth(start: Date, end: Date): Promise<MonthlyWorkOrderReviewRow[]> {
    return db.workOrderReview.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { workOrderId: true, rating: true, createdAt: true },
    })
  },

  // ── Monthly: Stock Transactions ──
  async findStockTxnsForMonth(start: Date, end: Date, siteFilter?: string | null): Promise<MonthlyStockTxnRow[]> {
    // StockTransaction has no `site` field — filter via department instead
    // (department often encodes site context). When a site filter is given
    // we pass it as department; otherwise no extra filter.
    return db.stockTransaction.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        ...(siteFilter && siteFilter !== 'all' ? { department: { contains: siteFilter } } : {}),
      },
      select: { type: true, quantity: true, productCode: true, productName: true, createdAt: true },
    })
  },

  // ── Monthly: Stock Items (current snapshot) ──
  async findStockItems(siteFilter?: string | null): Promise<MonthlyStockItemRow[]> {
    const rows = await db.stockItem.findMany({
      where: siteFilter && siteFilter !== 'all' ? { site: siteFilter } : {},
      select: { productCode: true, productName: true, quantity: true, minQuantity: true, unit: true, unitCost: true },
    })
    return rows.map((i) => ({ ...i, unitCost: i.unitCost == null ? null : Number(i.unitCost) }))
  },

  // ── Monthly: Devices ──
  async findDevicesForMonth(start: Date, end: Date, siteFilter?: string | null): Promise<MonthlyDeviceRow[]> {
    return db.device.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        ...(siteFilter ? { site: siteFilter } : {}),
      },
      select: { id: true, status: true, createdAt: true, site: true },
    })
  },

  // ── Unified: Device summary ──
  async findDevicesForUnified(siteFilter?: string | null) {
    return db.device.findMany({
      where: siteFilter ? { site: siteFilter } : {},
      select: {
        id: true, status: true, type: true, brand: true, model: true,
        site: true, department: true, createdAt: true, purchaseDate: true,
        warrantyEnd: true, meterRequired: true, lastMeterBw: true, lastMeterColor: true,
      },
    })
  },

  // ── Unified: Meter readings ──
  async findCurrentMeterReadings(deviceIds: string[]) {
    if (deviceIds.length === 0) return []
    return db.meterReading.findMany({
      where: { deviceId: { in: deviceIds } },
      orderBy: [{ readingMonth: 'desc' }, { id: 'desc' }],
      select: { deviceId: true, meterBw: true, meterColor: true, readingMonth: true, readingDate: true },
    })
  },

  async findPrevMeterReadings(deviceIds: string[], month: string) {
    if (deviceIds.length === 0) return []
    return db.meterReading.findMany({
      where: {
        deviceId: { in: deviceIds },
        readingMonth: { lt: month },
      },
      orderBy: [{ readingMonth: 'desc' }, { id: 'desc' }],
      select: { deviceId: true, meterBw: true, meterColor: true },
    })
  },

  // ── Unified: Work Orders ──
  async findWorkOrdersForUnified(siteFilter?: string | null) {
    return db.workOrder.findMany({
      where: siteFilter ? { siteCode: siteFilter } : {},
      select: {
        id: true, woNumber: true, status: true, priority: true,
        subject: true, assignedTo: true, createdAt: true, workCompletedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  },

  // ── Unified: Stock items + transactions ──
  async findStockItemsForUnified(siteFilter?: string | null) {
    return db.stockItem.findMany({
      where: siteFilter ? { site: siteFilter } : {},
      select: {
        id: true, productCode: true, productName: true, quantity: true,
        minQuantity: true, unit: true, unitCost: true,
      },
    })
  },

  async findRecentStockTransactions(limit: number, siteFilter?: string | null) {
    return db.stockTransaction.findMany({
      where: siteFilter ? { stockItem: { site: siteFilter } } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, type: true, quantity: true, productCode: true, productName: true, createdAt: true },
    })
  },

  async findPendingApprovals(siteFilter?: string | null) {
    return db.stockTransaction.findMany({
      where: {
        approvalStatus: 'PENDING',
        ...(siteFilter ? { stockItem: { site: siteFilter } } : {}),
      },
      select: { id: true, type: true, quantity: true, productCode: true, createdAt: true },
    })
  },

  // ── Unified: Maintenance logs ──
  async findMaintenanceLogs(siteFilter?: string | null) {
    return db.maintenanceLog.findMany({
      where: siteFilter ? { device: { site: siteFilter } } : {},
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, deviceId: true, type: true, createdAt: true, description: true, resolvedNote: true },
    })
  },

  // ── Unified: Stock transaction parts ──
  async findStockTxnParts(woId: string) {
    return db.stockTransaction.findMany({
      where: { workOrderId: woId },
      select: { id: true, type: true, quantity: true, productCode: true, productName: true, approvalStatus: true },
    })
  },

  async findPendingStock() {
    return db.stockTransaction.findMany({
      where: { approvalStatus: 'PENDING' },
      select: { id: true, type: true, quantity: true, productCode: true, createdAt: true },
    })
  },

  async findApprovedStockTxns(monthStart: Date) {
    return db.stockTransaction.findMany({
      where: { approvalStatus: 'APPROVED', createdAt: { gte: monthStart } },
      select: { id: true, type: true, quantity: true, productCode: true, createdAt: true, approvedAt: true },
    })
  },

  // ── Unified: Work order statuses ──
  async findPendingWorkOrders() {
    return db.workOrder.findMany({
      where: { status: { in: ['PENDING', 'IN_PROGRESS', 'WAITING_PARTS'] } },
      select: { id: true, woNumber: true, status: true, priority: true, subject: true, createdAt: true },
    })
  },

  // ── Unified: Special fee cases ──
  async findSpecialFeeCases() {
    return db.workOrder.findMany({
      where: { isSpecialFee: true },
      select: { id: true, woNumber: true, subject: true, isSpecialFee: true, status: true },
    })
  },

  // ── Unified: Audit log (approval history) ──
  async findApprovalHistory(monthStart: Date) {
    return db.auditLog.findMany({
      where: { createdAt: { gte: monthStart }, entity: { in: ['WorkOrder', 'StockTransaction'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, entity: true, entityId: true, summary: true, actor: true, createdAt: true },
    })
  },
}

