import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { getServerLang } from '@/lib/server-i18n'

// --- Types ---
type Severity = 'expired' | 'expiring' | 'warning' | 'info'

interface BaseNotif {
  id: string
  type: 'warranty' | 'meter' | 'cycle' | 'audit'
  severity: Severity
  title: string
  subtitle: string
  /** ISO date used for "newer than lastReadAt" comparison on the client. */
  timestamp: string
  /** Where clicking should take the user. */
  action?:
    | { page: 'devices'; deviceId?: string; warrantyFilter?: 'expiring' | 'expired' }
    | { page: 'meter'; meterAction?: string }
    | { page: 'settings'; settingsTab?: string }
}

interface WarrantyNotif extends BaseNotif {
  type: 'warranty'
  deviceId: string
  assetCode: string
  name: string
  expiryDate: string | null
  daysOverdue: number | null
}

interface MeterNotif extends BaseNotif {
  type: 'meter'
  deviceId: string
  assetCode: string
  name: string
  daysSinceLastReading: number | null
}

interface CycleNotif extends BaseNotif {
  type: 'cycle'
  cycleName: string
  endDate: string
  daysRemaining: number
}

interface AuditNotif extends BaseNotif {
  type: 'audit'
  summary: string
}

type Notif = WarrantyNotif | MeterNotif | CycleNotif | AuditNotif

// --- Constants ---
const METERABLE_TYPES = new Set(['PRINTER', 'COPIER', 'MFP'])
const SEVERITY_PRIORITY: Record<Severity, number> = {
  expired: 0,
  expiring: 1,
  warning: 2,
  info: 3,
}

function addMonthsISO(iso: string, months: number): Date {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return new Date(NaN)
  const day = d.getDate()
  d.setMonth(d.getMonth() + months)
  if (d.getDate() < day) d.setDate(0)
  return d
}

export async function GET(req: Request) {
  const unavailable = await moduleUnavailableResponse('notifications')
  if (unavailable) return unavailable

  // Resolve the user's language server-side (cookie/Accept-Language/?lang=).
  // I18N-04: prevents (force reload) "lang is not defined" ReferenceError when formatting dates.
  const lang = getServerLang(req)

  // ── P0 Security: require ADMIN permission ──
  // Notifications surface warranty/meter/cycle/audit info that should not be
  // publicly accessible. Previously this endpoint had NO auth check at all.
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const notifications: Notif[] = []

    // --- 1. Warranty alerts ---
    const devices = await db.device.findMany({
      select: {
        id: true,
        assetCode: true,
        brand: true,
        model: true,
        site: true,
        purchaseDate: true,
        warrantyEnd: true,
        type: true,
        updatedAt: true,
      },
      orderBy: { assetCode: 'asc' },
    })

    // Helper to build display name from brand+model (falls back to assetCode)
    const deviceName = (d: { brand: string | null; model: string | null; assetCode: string }) =>
      d.brand && d.model ? `${d.brand} ${d.model}`.trim() : d.assetCode

    for (const d of devices) {
      // Warranty end is stored as an ISO date string (YYYY-MM-DD)
      if (!d.warrantyEnd || !/^\d{4}-\d{2}-\d{2}/.test(d.warrantyEnd)) continue
      const expiry = new Date(d.warrantyEnd.slice(0, 10) + 'T00:00:00')
      if (Number.isNaN(expiry.getTime())) continue
      const today = new Date()
      const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      const diffMs = expiry.getTime() - todayMid.getTime()
      const days = Math.round(diffMs / (1000 * 60 * 60 * 24))
      const expiryISO = d.warrantyEnd.slice(0, 10)
      const name = deviceName(d)

      if (days < 0) {
        notifications.push({
          id: `warranty-expired-${d.id}`,
          type: 'warranty',
          severity: 'expired',
          title: `รับประกันหมดแล้ว — ${name}`,
          subtitle: `${d.assetCode} · หมด ${expiryISO} (${Math.abs(days)} วันที่แล้ว)`,
          timestamp: d.updatedAt.toISOString(),
          deviceId: d.id,
          assetCode: d.assetCode,
          name,
          expiryDate: expiryISO,
          daysOverdue: Math.abs(days),
          action: { page: 'devices', deviceId: d.id, warrantyFilter: 'expired' },
        })
      } else if (days <= 30) {
        notifications.push({
          id: `warranty-expiring-${d.id}`,
          type: 'warranty',
          severity: 'expiring',
          title: `รับประกันใกล้หมด — ${name}`,
          subtitle: `${d.assetCode} · จะหมดใน ${days} วัน (${expiryISO})`,
          timestamp: d.updatedAt.toISOString(),
          deviceId: d.id,
          assetCode: d.assetCode,
          name,
          expiryDate: expiryISO,
          daysOverdue: days,
          action: { page: 'devices', deviceId: d.id, warrantyFilter: 'expiring' },
        })
      }
    }

    // --- 2. Meter reminders (unread meterable devices in active cycle) ---
    const activeCycle = await db.cycle.findFirst({
      where: { status: 'active' },
      orderBy: { startDate: 'desc' },
    })

    if (activeCycle) {
      const meterableDevices = devices.filter((d) =>
        METERABLE_TYPES.has((d.type ?? '').toUpperCase()),
      )

      // Readings in this cycle's date range, grouped by assetCode
      const readings = await db.meterReading.findMany({
        where: {
          readingDate: {
            gte: activeCycle.startDate,
            lte: activeCycle.endDate,
          },
        },
        select: { assetCode: true, readingDate: true, createdAt: true },
        orderBy: { readingDate: 'desc' },
      })
      const readAssetMap = new Map<string, { date: string | null; createdAt: Date }>()
      for (const r of readings) {
        if (r.assetCode && !readAssetMap.has(r.assetCode)) {
          readAssetMap.set(r.assetCode, { date: r.readingDate, createdAt: r.createdAt })
        }
      }

      const todayISO = new Date().toISOString().slice(0, 10)
      for (const d of meterableDevices) {
        if (readAssetMap.has(d.assetCode)) continue
        const name = deviceName(d)
        const referenceDate = d.purchaseDate ?? d.updatedAt.toISOString().slice(0, 10)
        const daysSince = Math.max(
          0,
          Math.round(
            (new Date(todayISO).getTime() - new Date(referenceDate.slice(0, 10)).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
        notifications.push({
          id: `meter-unread-${d.id}`,
          type: 'meter',
          severity: 'info',
          title: `ยังไม่ได้จดมิเตอร์ — ${name}`,
          subtitle: `${d.assetCode} · รอบ "${activeCycle.name}" · ${daysSince} วัน`,
          timestamp: d.updatedAt.toISOString(),
          deviceId: d.id,
          assetCode: d.assetCode,
          name,
          daysSinceLastReading: daysSince,
          action: { page: 'meter', meterAction: 'open-cycle' },
        })
      }

      // --- 3. Cycle ending soon (within 7 days) ---
      const end = new Date(activeCycle.endDate + 'T00:00:00')
      const now = new Date()
      const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const diffMs = end.getTime() - todayMid.getTime()
      const daysRemaining = Math.round(diffMs / (1000 * 60 * 60 * 24))
      if (daysRemaining >= 0 && daysRemaining <= 7) {
        notifications.push({
          id: `cycle-ending-${activeCycle.id}`,
          type: 'cycle',
          severity: 'warning',
          title: `รอบจดมิเตอร์ใกล้จบ — ${activeCycle.name}`,
          subtitle: `จะสิ้นสุดใน ${daysRemaining} วัน (${activeCycle.endDate})`,
          timestamp: activeCycle.createdAt.toISOString(),
          cycleName: activeCycle.name,
          endDate: activeCycle.endDate,
          daysRemaining,
          action: { page: 'meter', meterAction: 'open-cycle' },
        })
      }
    }

    // --- 4. Recent audit activity (last 3 CREATE/DELETE/BULK_*) ---
    const recentAudit = await db.auditLog.findMany({
      where: {
        OR: [
          { action: 'CREATE' },
          { action: 'DELETE' },
          { action: { startsWith: 'BULK_' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    })
    for (const a of recentAudit) {
      notifications.push({
        id: `audit-${a.id}`,
        type: 'audit',
        severity: 'info',
        title: a.summary,
        subtitle: `${a.action} · ${a.entity} · ${a.createdAt.toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', {
          dateStyle: 'short',
          timeStyle: 'short',
        })}`,
        timestamp: a.createdAt.toISOString(),
        summary: a.summary,
        action: { page: 'settings', settingsTab: 'audit' },
      })
    }

    // Sort by severity priority, then by timestamp desc
    notifications.sort((a, b) => {
      const p = SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity]
      if (p !== 0) return p
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    })

    const counts = {
      total: notifications.length,
      expired: notifications.filter((n) => n.severity === 'expired').length,
      expiring: notifications.filter((n) => n.severity === 'expiring').length,
      warning: notifications.filter((n) => n.severity === 'warning').length,
      info: notifications.filter((n) => n.severity === 'info').length,
    }

    return NextResponse.json({ notifications, counts })
  } catch (err) {
    console.error('GET /api/notifications', err)
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 },
    )
  }
}
