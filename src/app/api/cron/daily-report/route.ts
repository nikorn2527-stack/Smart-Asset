/**
 * GET /api/cron/daily-report
 *
 * Cron job — runs daily at 8:00 AM Bangkok time.
 *
 * What it does:
 * 1. Aggregates yesterday's metrics (WOs created/completed, meter readings, stock moves)
 * 2. Identifies low-stock items (below reorder point)
 * 3. Identifies warranties expiring within 90 days
 * 4. APPENDIX-C: Identifies PM schedules due within 7 days
 * 5. APPENDIX-C: Identifies licenses expiring within 30 days
 * 6. Sends notifications to admins (in-app + audit log)
 * 7. Optionally sends email summary (if SMTP configured)
 *
 * Setup in vercel.json:
 *   "crons": [{ "path": "/api/cron/daily-report", "schedule": "0 8 * * *" }]
 *
 * Security: requires CRON_SECRET header.
 *
 * Vercel Hobby limit: 2 cron jobs (this is the 2nd, after keepalive).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
// Use max duration (Hobby: 300s) — daily report may take time for big datasets
export const maxDuration = 60

interface DailyReportData {
  date: string
  workOrders: {
    created: number
    completed: number
    cancelled: number
    pendingTotal: number
  }
  meters: {
    newReadings: number
  }
  stock: {
    newTransactions: number
    lowStockItems: number
  }
  devices: {
    newDevices: number
    warrantyExpiringSoon: number
  }
  // APPENDIX-C: PM due + License expiry checks (additions to the daily report)
  maintenance: {
    pmDueSoon: number
    pmDueSoonItems: Array<{ id: string; title: string; nextRunDate: string | null; site: string | null }>
  }
  licenses: {
    expiringSoon: number
    expiringSoonItems: Array<{ id: string; software: string; expiryDate: string | null; assetNo: string | null }>
  }
  auditLogs: {
    totalYesterday: number
    topAction: string | null
  }
}

export async function GET(req: NextRequest) {
  // Auth check — if CRON_SECRET is set, require it.
  // In development (no CRON_SECRET), allow without auth for manual testing.
  const auth = verifyCronSecret(req)
  if (auth) return auth

  try {
    // Calculate "yesterday" in Bangkok timezone (UTC+7)
    const now = new Date()
    const bangkokOffset = 7 * 60 * 60 * 1000
    const bangkokNow = new Date(now.getTime() + bangkokOffset)
    const yesterdayStart = new Date(bangkokNow)
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1)
    yesterdayStart.setUTCHours(0, 0, 0, 0)
    const yesterdayEnd = new Date(yesterdayStart)
    yesterdayEnd.setUTCHours(23, 59, 59, 999)

    // (QA-ROUND-2026-09-16-C) Prisma filter args get ISO STRINGS, not Date
    // objects — Date instances break under the Bun runtime ("_ref missing").
    const yesterdayStartIso = yesterdayStart.toISOString()
    const yesterdayEndIso = yesterdayEnd.toISOString()

    const dateStr = yesterdayStart.toISOString().slice(0, 10)

    // Run all queries in parallel
    const [
      woCreated,
      woCompleted,
      woCancelled,
      woPending,
      meterReadings,
      stockTxns,
      stockLowRaw,
      newDevices,
      warrantyExpiring,
      auditLogs,
      topActionRow,
      // APPENDIX-C: PM schedules (active) + License records (active) to scan
      // for "due soon" / "expiring soon" entries.
      pmSchedules,
      licenseRecords,
    ] = await Promise.all([
      // Work Orders created yesterday
      db.workOrder.count({
        where: { createdAt: { gte: yesterdayStartIso, lte: yesterdayEndIso } },
      }),
      // Work Orders completed yesterday
      db.workOrder.count({
        where: { closedAt: { gte: yesterdayStartIso, lte: yesterdayEndIso } },
      }),
      // Work Orders cancelled yesterday
      db.workOrder.count({
        where: { canceledAt: { gte: yesterdayStartIso, lte: yesterdayEndIso } },
      }),
      // Total pending WOs (still open)
      db.workOrder.count({
        where: { status: { in: ['PENDING', 'IN_PROGRESS', 'WAITING_PARTS'] } },
      }),
      // Meter readings yesterday
      db.meterReading.count({
        where: { createdAt: { gte: yesterdayStartIso, lte: yesterdayEndIso } },
      }),
      // Stock transactions yesterday
      db.stockTransaction.count({
        where: { createdAt: { gte: yesterdayStartIso, lte: yesterdayEndIso } },
      }),
      // Low-stock items (quantity <= minQuantity)
      // Use raw SQL because Prisma doesn't support column-to-column comparison.
      // SQLite-compatible: CAST instead of PostgreSQL's ::int cast.
      // (PostgreSQL would accept either; SQLite only accepts CAST.)
      db.$queryRaw`SELECT CAST(COUNT(*) AS INTEGER) as c FROM "StockItem" WHERE quantity <= "minQuantity"`,
      // New devices added yesterday
      db.device.count({
        where: { createdAt: { gte: yesterdayStartIso, lte: yesterdayEndIso } },
      }),
      // Devices with warranty expiring within 90 days
      // (QA-ROUND-2026-09-16-C) Device.warrantyEnd is a STRING (ISO date), and
      // the old `warrantyExpiry` field doesn't exist on the model at all.
      // String ISO dates compare correctly lexicographically.
      db.device.count({
        where: {
          warrantyEnd: {
            gte: now.toISOString().slice(0, 10),
            lte: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10),
          },
        },
      }),
      // Total audit logs yesterday
      db.auditLog.count({
        where: { createdAt: { gte: yesterdayStartIso, lte: yesterdayEndIso } },
      }),
      // Top action yesterday
      db.auditLog.groupBy({
        by: ['action'],
        where: { createdAt: { gte: yesterdayStartIso, lte: yesterdayEndIso } },
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
        take: 1,
      }),
      // APPENDIX-C: PM schedules — pull all active ones and compute the
      // next run date in JS (the schema stores it as a String, so Prisma
      // can't apply a date-range filter for us). We post-filter below.
      db.pMSchedule.findMany({
        where: { active: true, isDemo: false },
        select: {
          id: true,
          title: true,
          frequency: true,
          intervalDays: true,
          lastRunDate: true,
          nextRunDate: true,
          site: true,
        },
      }),
      // APPENDIX-C: License records — pull all active ones (Expiry_Date is
      // a String, so we parse + filter in JS below).
      db.licenseRecord.findMany({
        where: { isActive: true, isDemo: false },
        select: {
          id: true,
          Software: true,
          Expiry_Date: true,
          Asset_No: true,
        },
      }),
    ])

    // Convert raw query result to number (raw returns [{c: number}])
    const stockLow = Array.isArray(stockLowRaw) && stockLowRaw[0]
      ? Number((stockLowRaw[0] as { c: number }).c)
      : 0

    // ── APPENDIX-C: PM due-within-7-days check ──────────────────────────────
    // PMSchedule stores dates as Strings (ISO yyyy-mm-dd), so we post-filter
    // in JS. "Due soon" = nextRunDate (or lastRunDate + intervalDays) falls
    // within the next 7 days from `now`. We also include ones already
    // overdue (nextRunDate < now) so they aren't silently dropped.
    const PM_WINDOW_DAYS = 7
    const pmWindowEnd = new Date(now.getTime() + PM_WINDOW_DAYS * 24 * 60 * 60 * 1000)

    function computePmNextRun(s: {
      nextRunDate: string | null
      lastRunDate: string | null
      intervalDays: number | null
      frequency: string
    }): Date | null {
      if (s.nextRunDate) {
        const d = new Date(s.nextRunDate)
        if (!isNaN(d.getTime())) return d
      }
      // Fall back to lastRunDate + intervalDays.
      if (s.lastRunDate && s.intervalDays) {
        const last = new Date(s.lastRunDate)
        if (!isNaN(last.getTime())) {
          return new Date(last.getTime() + s.intervalDays * 24 * 60 * 60 * 1000)
        }
      }
      // Final fallback: derive from frequency keyword.
      if (s.lastRunDate) {
        const last = new Date(s.lastRunDate)
        if (!isNaN(last.getTime())) {
          const days =
            s.frequency === 'weekly' ? 7 :
            s.frequency === 'quarterly' ? 90 :
            s.frequency === 'yearly' || s.frequency === 'annual' ? 365 :
            30 // monthly / default
          return new Date(last.getTime() + days * 24 * 60 * 60 * 1000)
        }
      }
      return null
    }

    const pmDueSoonItems: DailyReportData['maintenance']['pmDueSoonItems'] = []
    for (const s of pmSchedules) {
      const next = computePmNextRun(s)
      if (!next) continue
      // include overdue + within window (don't silently drop past-due)
      if (next <= pmWindowEnd) {
        pmDueSoonItems.push({
          id: s.id,
          title: s.title,
          nextRunDate: next.toISOString().slice(0, 10),
          site: s.site,
        })
      }
    }
    pmDueSoonItems.sort((a, b) =>
      (a.nextRunDate ?? '').localeCompare(b.nextRunDate ?? ''),
    )

    // ── APPENDIX-C: License expiry within 30 days check ────────────────────
    const LIC_WINDOW_DAYS = 30
    const licWindowEnd = new Date(now.getTime() + LIC_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const expiringSoonItems: DailyReportData['licenses']['expiringSoonItems'] = []
    for (const lic of licenseRecords) {
      if (!lic.Expiry_Date) continue
      const d = new Date(lic.Expiry_Date)
      if (isNaN(d.getTime())) continue
      if (d >= now && d <= licWindowEnd) {
        expiringSoonItems.push({
          id: lic.id,
          software: lic.Software,
          expiryDate: lic.Expiry_Date,
          assetNo: lic.Asset_No,
        })
      }
    }
    expiringSoonItems.sort((a, b) =>
      (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''),
    )

    const report: DailyReportData = {
      date: dateStr,
      workOrders: {
        created: woCreated,
        completed: woCompleted,
        cancelled: woCancelled,
        pendingTotal: woPending,
      },
      meters: { newReadings: meterReadings },
      stock: {
        newTransactions: stockTxns,
        lowStockItems: stockLow,
      },
      devices: {
        newDevices,
        warrantyExpiringSoon: warrantyExpiring,
      },
      maintenance: {
        pmDueSoon: pmDueSoonItems.length,
        pmDueSoonItems: pmDueSoonItems.slice(0, 50), // cap payload
      },
      licenses: {
        expiringSoon: expiringSoonItems.length,
        expiringSoonItems: expiringSoonItems.slice(0, 50), // cap payload
      },
      auditLogs: {
        totalYesterday: auditLogs,
        topAction: topActionRow[0]?.action ?? null,
      },
    }

    // Log the report generation
    await db.auditLog.create({
      data: {
        action: 'DAILY_REPORT',
        entity: 'System',
        entityId: null,
        summary: `Daily report for ${dateStr}: WO +${woCreated}/✓${woCompleted}, Meters: ${meterReadings}, Low stock: ${stockLow}, PM due ≤7d: ${pmDueSoonItems.length}, Lic exp ≤30d: ${expiringSoonItems.length}`,
        detail: JSON.stringify(report),
        actor: 'cron:daily-report',
        siteCode: null,
      },
    })

    return NextResponse.json({
      ok: true,
      report,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Daily report failed:', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Unknown error') : 'Internal server error' },
      { status: 500 },
    )
  }
}
