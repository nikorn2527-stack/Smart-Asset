import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { siteFilterForUser } from '@/lib/auth'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

/**
 * GET /api/reports/wo-cost-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&site=&groupBy=device|month|category
 *
 * Work Order cost + time summary report. Aggregates:
 *   - WO count by status
 *   - Average repair time (hours from assignedAt → workCompletedAt)
 *   - Total parts cost (sum of StockTransaction.cost where workOrderId matches)
 *   - Parts usage breakdown (qty, usageQuantity, usageHours, usagePages)
 *   - Cost per device (when WO is linked to a device)
 *
 * Returns the data in a shape ready for the Reports Center UI to render.
 *
 * Auth: requires VIEW_REPORTS (admin/manager role).
 */
export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('reports')
  if (unavailable) return unavailable


  try {
    const auth = await requireAuth(req, 'VIEW_REPORTS')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from')?.trim() ?? ''
    const to = searchParams.get('to')?.trim() ?? ''
    const siteParam = searchParams.get('site')?.trim() ?? ''
    const groupBy = (searchParams.get('groupBy')?.trim() ?? 'device') as 'device' | 'month' | 'category'

    // Default range: last 90 days
    const toDate = to || new Date().toISOString().slice(0, 10)
    const fromDate = from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    // Site-level filter
    const siteFilter = siteFilterForUser(user)
    const hasSiteFilter = Object.keys(siteFilter).length > 0
    const siteWhere = hasSiteFilter
      ? siteFilter
      : siteParam
        ? { siteCode: siteParam }
        : {}

    // Pull WOs in range
    const wos = await db.workOrder.findMany({
      where: {
        // (QA-ROUND-2026-09-16-C) ISO strings, not Date objects — Date
        // instances in Prisma filter args break under Bun runtime.
        createdAt: {
          gte: fromDate + 'T00:00:00Z',
          lte: toDate + 'T23:59:59Z',
        },
        isDemo: false,
        ...(hasSiteFilter || siteParam ? siteWhere : {}),
      },
      select: {
        id: true,
        woNumber: true,
        subject: true,
        status: true,
        priority: true,
        assignedTo: true,
        assignedAt: true,
        workCompletedAt: true,
        closedAt: true,
        createdAt: true,
        siteCode: true,
        deviceId: true,
        device: { select: { id: true, assetCode: true, brand: true, model: true, site: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000, // cap for safety
    })

    // Pull all StockTransactions linked to these WOs (via workOrderId OR workOrderNo)
    const woIds = wos.map((w) => w.id)
    const woNumbers = wos.map((w) => w.woNumber).filter(Boolean) as string[]
    const allTxns = await db.stockTransaction.findMany({
      where: {
        OR: [
          { workOrderId: { in: woIds } },
          { workOrderNo: { in: woNumbers } },
        ],
      },
      select: {
        id: true,
        workOrderId: true,
        workOrderNo: true,
        txnNumber: true,
        productCode: true,
        productName: true,
        quantity: true,
        usageQuantity: true,
        usageHours: true,
        usagePages: true,
        usageSource: true,
        cost: true,
        approvalStatus: true,
        txnDate: true,
      },
    })

    // Build a map: WO ID → txns[]
    const txnsByWoId = new Map<string, typeof allTxns>()
    for (const t of allTxns) {
      // Resolve to WO ID (use workOrderId if set; else match by workOrderNo)
      const woId = t.workOrderId
        ?? wos.find((w) => w.woNumber === t.workOrderNo)?.id
        ?? null
      if (!woId) continue
      if (!txnsByWoId.has(woId)) txnsByWoId.set(woId, [])
      txnsByWoId.get(woId)!.push(t)
    }

    // ── Aggregate ──
    const summary = {
      totalWOs: wos.length,
      byStatus: {} as Record<string, number>,
      completedCount: 0,
      avgRepairHours: 0,
      totalPartsCost: 0,
      totalPartsTxns: 0,
      totalUsageHours: 0,
      totalUsagePages: 0,
    }

    let totalRepairHours = 0
    let repairHoursCount = 0

    for (const wo of wos) {
      // Status count
      summary.byStatus[wo.status] = (summary.byStatus[wo.status] ?? 0) + 1
      if (wo.status === 'COMPLETED') summary.completedCount++

      // Repair time (assigned → completed)
      if (wo.assignedAt && wo.workCompletedAt) {
        const hours = (wo.workCompletedAt.getTime() - wo.assignedAt.getTime()) / (1000 * 60 * 60)
        if (hours > 0 && hours < 24 * 30) { // skip obvious junk (>30 days = data error)
          totalRepairHours += hours
          repairHoursCount++
        }
      }

      // Parts (from txnsByWoId map we built above)
      const woTxns = txnsByWoId.get(wo.id) ?? []
      for (const p of woTxns) {
        if (p.cost !== null) summary.totalPartsCost += Number(p.cost)
        summary.totalPartsTxns++
        if (p.usageHours !== null) summary.totalUsageHours += Number(p.usageHours)
        if (p.usagePages !== null) summary.totalUsagePages += p.usagePages
      }
    }

    summary.avgRepairHours = repairHoursCount > 0
      ? Math.round((totalRepairHours / repairHoursCount) * 100) / 100
      : 0

    // ── Group by device / month / category ──
    const groups: Record<string, {
      label: string
      woCount: number
      completedCount: number
      totalPartsCost: number
      avgRepairHours: number
      totalUsageHours: number
      totalUsagePages: number
      _repairHoursSum: number
      _repairHoursCount: number
    }> = {}

    for (const wo of wos) {
      let groupKey = 'unknown'
      let groupLabel = 'ไม่ระบุ'
      if (groupBy === 'device') {
        if (wo.device) {
          groupKey = wo.device.id
          groupLabel = `${wo.device.assetCode} — ${wo.device.brand} ${wo.device.model}`
        }
      } else if (groupBy === 'month') {
        const d = wo.createdAt.toISOString().slice(0, 7)
        groupKey = d
        groupLabel = d
      } else if (groupBy === 'category') {
        // Group by first word of subject (crude categorization)
        const cat = wo.subject.split(' ')[0] || wo.subject
        groupKey = cat
        groupLabel = cat
      }

      if (!groups[groupKey]) {
        groups[groupKey] = {
          label: groupLabel,
          woCount: 0,
          completedCount: 0,
          totalPartsCost: 0,
          avgRepairHours: 0,
          totalUsageHours: 0,
          totalUsagePages: 0,
          _repairHoursSum: 0,
          _repairHoursCount: 0,
        }
      }
      const g = groups[groupKey]
      g.woCount++
      if (wo.status === 'COMPLETED') g.completedCount++
      if (wo.assignedAt && wo.workCompletedAt) {
        const hours = (wo.workCompletedAt.getTime() - wo.assignedAt.getTime()) / (1000 * 60 * 60)
        if (hours > 0 && hours < 24 * 30) {
          g._repairHoursSum += hours
          g._repairHoursCount++
        }
      }
      const woTxns = txnsByWoId.get(wo.id) ?? []
      for (const p of woTxns) {
        if (p.cost !== null) g.totalPartsCost += Number(p.cost)
        if (p.usageHours !== null) g.totalUsageHours += Number(p.usageHours)
        if (p.usagePages !== null) g.totalUsagePages += p.usagePages
      }
    }

    // Finalize averages
    const groupList = Object.values(groups).map((g) => {
      const avgRepairHours = g._repairHoursCount > 0
        ? Math.round((g._repairHoursSum / g._repairHoursCount) * 100) / 100
        : 0
      return {
        label: g.label,
        woCount: g.woCount,
        completedCount: g.completedCount,
        totalPartsCost: Math.round(g.totalPartsCost * 100) / 100,
        avgRepairHours,
        totalUsageHours: Math.round(g.totalUsageHours * 100) / 100,
        totalUsagePages: g.totalUsagePages,
      }
    }).sort((a, b) => b.totalPartsCost - a.totalPartsCost)

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      from: fromDate,
      to: toDate,
      site: siteParam || (hasSiteFilter ? 'allowed-sites' : 'all'),
      groupBy,
      summary: {
        totalWOs: summary.totalWOs,
        completedCount: summary.completedCount,
        byStatus: summary.byStatus,
        avgRepairHours: summary.avgRepairHours,
        totalPartsCost: Math.round(summary.totalPartsCost * 100) / 100,
        totalPartsTxns: summary.totalPartsTxns,
        totalUsageHours: Math.round(summary.totalUsageHours * 100) / 100,
        totalUsagePages: summary.totalUsagePages,
      },
      groups: groupList,
    })
  } catch (err) {
    console.error('GET /api/reports/wo-cost-summary', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed') : 'Internal server error' },
      { status: 500 },
    )
  }
}
