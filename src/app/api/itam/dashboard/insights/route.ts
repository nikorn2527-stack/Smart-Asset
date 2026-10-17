import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { siteFilterForUser, getAllowedSites } from '@/lib/auth'
import { getServerLang, serverFormatNumber, type Lang } from '@/lib/server-i18n'
import { buildAuthorizationContext } from '@/lib/authorization-context'

/**
 * GET /api/itam/dashboard/insights
 *
 * Returns an array of "smart insight" alerts for the dashboard.
 *
 * Insight types:
 *   - { type: 'high_usage', device, value, avg, message }
 *       Devices whose latest-month paper usage is >2x their personal 6-month avg
 *   - { type: 'color_heavy', device, colorPercent, message }
 *       Devices with >50% color pages in the last month
 *   - { type: 'not_read', count, message }
 *       meterRequired + Active devices with no reading in the current month
 *   - { type: 'mom_change', month, prevMonth, current, prev, percent, message }
 *       Month-over-month total paper usage change (only when |%| >= 15)
 *
 * Permission: VIEW_DASHBOARD
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req, 'VIEW_DASHBOARD')
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const user = auth.row

    // SPRINT-2 #5 (AUDIT-API-001 #077): build AuthorizationContext for
    // permission-aware site scoping (same as dashboard route).
    const ctx = await buildAuthorizationContext(
      auth.user,
      auth.row.id,
      auth.row.allowedSites,
    )

    const lang: Lang = getServerLang(req)
    const fmt = (n: number) => serverFormatNumber(n, lang)

    const siteFilter = siteFilterForUser(user)
    const userSites = getAllowedSites(user)

    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

    // Build the list of last 6 months for averages
    const lastSixMonths: string[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      lastSixMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const insights: Array<Record<string, unknown>> = []

    // ─── 1) Not-read this month ────────────────────────────────────────────
    const meterRequiredActive = await db.device.count({
      where: { ...siteFilter, meterRequired: true, status: 'Active' },
    })
    const readThisMonth = await db.meterReading.findMany({
      where: { readingMonth: currentMonth, device: siteFilter },
      select: { assetCode: true },
      distinct: ['assetCode'],
    })
    const readCount = readThisMonth.length
    const notReadCount = Math.max(0, meterRequiredActive - readCount)
    if (notReadCount > 0) {
      insights.push({
        type: 'not_read',
        count: notReadCount,
        total: meterRequiredActive,
        month: currentMonth,
        message: `${notReadCount} เครื่องยังไม่ได้จดมิเตอร์เดือนนี้ (${currentMonth})`,
      })
    }

    // ─── 2) MoM change — based on SUM of pagesBw + pagesColor
    //    with readingMonth = current/previous month key.
    //    Uses readingMonth (not readingDate) because readingDate may fall in
    //    the next calendar month (e.g., reading 1-5 Aug for July cycle).
    //    NOTE: `currentMonth` is already defined above (line 33) — don't redeclare.
    const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

    const [curAgg, prevAgg] = await Promise.all([
      db.meterReading.aggregate({
        _sum: { pagesBw: true, pagesColor: true },
        where: {
          readingMonth: currentMonth,
          device: siteFilter,
        },
      }),
      db.meterReading.aggregate({
        _sum: { pagesBw: true, pagesColor: true },
        where: {
          readingMonth: prevMonthKey,
          device: siteFilter,
        },
      }),
    ])
    const curTotal = (curAgg._sum.pagesBw ?? 0) + (curAgg._sum.pagesColor ?? 0)
    const prevTotal = (prevAgg._sum.pagesBw ?? 0) + (prevAgg._sum.pagesColor ?? 0)
    if (prevTotal > 0) {
      const pct = Math.round(((curTotal - prevTotal) / prevTotal) * 100)
      if (Math.abs(pct) >= 15) {
        const dir = pct > 0 ? 'เพิ่มขึ้น' : 'ลดลง'
        insights.push({
          type: 'mom_change',
          month: currentMonth,
          prevMonth,
          current: curTotal,
          prev: prevTotal,
          percent: pct,
          message: `การใช้กระดาษ${dir} ${Math.abs(pct)}% เทียบเดือนก่อน (${fmt(prevTotal)} → ${fmt(curTotal)} แผ่น)`,
        })
      }
    }

    // ─── 3) High usage + color heavy ───────────────────────────────────────
    // Pull per-device aggregate for last 6 months + current month breakdown.
    const recentReadings = await db.meterReading.findMany({
      where: {
        readingMonth: { in: [...lastSixMonths] },
        device: siteFilter,
      },
      select: {
        assetCode: true,
        readingMonth: true,
        pagesBw: true,
        pagesColor: true,
        device: { select: { brand: true, model: true, site: true, department: true } },
      },
    })

    // Per-device aggregation
    interface DevAgg {
      assetCode: string
      brand: string | null
      model: string | null
      site: string | null
      department: string | null
      byMonth: Record<string, { bw: number; color: number }>
    }
    const perDevice = new Map<string, DevAgg>()
    for (const r of recentReadings) {
      const code = r.assetCode || ''
      let d = perDevice.get(code)
      if (!d) {
        d = {
          assetCode: code,
          brand: r.device?.brand ?? null,
          model: r.device?.model ?? null,
          site: r.device?.site ?? null,
          department: r.device?.department ?? null,
          byMonth: {},
        }
        perDevice.set(code, d)
      }
      const m = r.readingMonth || ''
      if (!d.byMonth[m]) d.byMonth[m] = { bw: 0, color: 0 }
      d.byMonth[m].bw += r.pagesBw
      d.byMonth[m].color += r.pagesColor
    }

    const highUsageList: Array<Record<string, unknown>> = []
    const colorHeavyList: Array<Record<string, unknown>> = []

    for (const d of perDevice.values()) {
      const cur = d.byMonth[currentMonth]
      if (!cur) continue
      const curTotal = cur.bw + cur.color
      if (curTotal === 0) continue

      // 6-month average (excluding current month)
      let sum = 0
      let n = 0
      for (const m of lastSixMonths) {
        if (m === currentMonth) continue
        const r = d.byMonth[m]
        if (r) {
          sum += r.bw + r.color
          n++
        }
      }
      const avg = n > 0 ? sum / n : 0

      // High-usage: current > 2x average AND at least 500 sheets
      if (avg > 0 && curTotal > 2 * avg && curTotal >= 500) {
        highUsageList.push({
          type: 'high_usage',
          assetNo: d.assetCode,
          device: {
            assetNo: d.assetCode,
            brand: d.brand,
            model: d.model,
            site: d.site,
            department: d.department,
          },
          value: curTotal,
          avg: Math.round(avg),
          month: currentMonth,
          message: `${d.assetCode} ใช้กระดาษ ${fmt(curTotal)} แผ่น (เฉลี่ย ${fmt(Math.round(avg))} แผ่น) — สูงผิดปกติ`,
        })
      }

      // Color-heavy: >50% color pages in current month AND >= 200 color sheets
      if (cur.color > 0 && curTotal > 0) {
        const colorPct = (cur.color / curTotal) * 100
        if (colorPct >= 50 && cur.color >= 200) {
          colorHeavyList.push({
            type: 'color_heavy',
            assetNo: d.assetCode,
            device: {
              assetNo: d.assetCode,
              brand: d.brand,
              model: d.model,
              site: d.site,
              department: d.department,
            },
            colorPercent: Math.round(colorPct),
            colorSheets: cur.color,
            totalSheets: curTotal,
            month: currentMonth,
            message: `${d.assetCode} ใช้สี ${Math.round(colorPct)}% (${fmt(cur.color)}/${fmt(curTotal)} แผ่น)`,
          })
        }
      }
    }

    // ─── 4) Smart, actionable insights — top 3 by priority with recommendations ──
    // Compute cost impact (est. baht/month) for each insight:
    //   - BW page ≈ 0.50 baht
    //   - Color page ≈ 3.00 baht
    //   - High-usage: extra cost vs avg
    //   - Color-heavy: would save (colorSheets × (3.00 - 0.50)) if converted to BW
    //   - Not-read: opportunity cost (avg sheets/device × count × 0.50)
    const BW_COST = 0.5
    const COLOR_COST = 3.0

    interface EnrichedInsight extends Record<string, unknown> {
      priority: number  // 1 = highest
      costImpactBath?: number  // estimated monthly cost / saving
      recommendation?: string
      actionLabel?: string
    }

    const enriched: EnrichedInsight[] = []

    // Not-read: priority 1 (data gap — affects billing accuracy)
    if (notReadCount > 0) {
      // Estimate using LAST MONTH's per-device average (not current month's
      // partial data, which inflates the average when only a few devices
      // have read so far). Fall back to a sensible per-device baseline.
      const prevAvgPerDevice = meterRequiredActive > 0
        ? Math.round(prevTotal / meterRequiredActive)
        : 200
      const estUncaptured = Math.round(prevAvgPerDevice * notReadCount * 0.9) // 90% of last month's avg (usage usually fluctuates)
      enriched.push({
        type: 'not_read',
        count: notReadCount,
        total: meterRequiredActive,
        month: currentMonth,
        priority: 1,
        costImpactBath: Math.round(estUncaptured * BW_COST),
        message: `${notReadCount} เครื่องยังไม่ได้จดมิเตอร์เดือนนี้ (คาดการณ์ข้อมูลที่ขาด ~${fmt(estUncaptured)} แผ่น จากค่าเฉลี่ยเดือนก่อน)`,
        recommendation: `เร่งจดมิเตอร์ ${notReadCount} เครื่องที่เหลือ — ข้อมูลที่หายไปจะกระทบความถูกต้องของรายงานต้นทุน`,
        actionLabel: `ไปจดมิเตอร์ (${notReadCount} เครื่อง)`,
      })
    }

    // MoM change: priority 2 (trend alert)
    if (prevTotal > 0) {
      const pct = Math.round(((curTotal - prevTotal) / prevTotal) * 100)
      if (Math.abs(pct) >= 10) {
        const dir = pct > 0 ? 'เพิ่มขึ้น' : 'ลดลง'
        const deltaSheets = Math.abs(curTotal - prevTotal)
        const deltaCost = Math.round(deltaSheets * BW_COST)
        enriched.push({
          type: 'mom_change',
          month: currentMonth,
          prevMonth,
          current: curTotal,
          prev: prevTotal,
          percent: pct,
          priority: 2,
          costImpactBath: deltaCost,
          message: `การใช้กระดาษ${dir} ${Math.abs(pct)}% เทียบเดือนก่อน (${fmt(prevTotal)} → ${fmt(curTotal)} แผ่น)`,
          recommendation: pct > 0
            ? `ตรวจสอบสาเหตุการใช้เพิ่ม ${fmt(deltaSheets)} แผ่น — อาจเป็นการพิมพ์เอกสารจำนวนมากหรืออุปกรณ์ที่ตั้งค่าผิด`
            : `ใช้กระดาษลดลง ${fmt(deltaSheets)} แผ่น — ประหยัดได้ประมาณ ${fmt(deltaCost)} บาท`,
          actionLabel: 'ดูรายละเอียด',
        })
      }
    }

    // High-usage devices: priority 3 (cost opportunity)
    for (const item of highUsageList.slice(0, 3)) {
      const extraSheets = Number(item.value) - Number(item.avg)
      const extraCost = Math.round(extraSheets * BW_COST)
      enriched.push({
        ...item,
        priority: 3,
        costImpactBath: extraCost,
        recommendation: `ตรวจสอบ ${item.assetNo} — ใช้กระดาษ ${fmt(extraSheets)} แผ่นเกินค่าเฉลี่ย (ประมาณ ${fmt(extraCost)} บาท/เดือน) · พิจารณาตั้งค่าโควต้าหรือตรวจสอบการพิมพ์ผิดปกติ`,
        actionLabel: `ดู ${item.assetNo}`,
      })
    }

    // Color-heavy devices: priority 4 (cost saving opportunity)
    for (const item of colorHeavyList.slice(0, 3)) {
      const colorSheets = Number(item.colorSheets)
      const potentialSave = Math.round(colorSheets * (COLOR_COST - BW_COST))
      enriched.push({
        ...item,
        priority: 4,
        costImpactBath: potentialSave,
        recommendation: `${item.assetNo} ใช้สี ${fmt(colorSheets)} แผ่น — หากปรับเป็นขาวดำจะประหยัด ~${fmt(potentialSave)} บาท/เดือน · ตั้งค่า default เป็น BW หรือตรวจสอบเอกสารที่พิมพ์`,
        actionLabel: `ดู ${item.assetNo}`,
      })
    }

    // Sort by priority, then by cost impact desc within priority
    enriched.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      return (b.costImpactBath ?? 0) - (a.costImpactBath ?? 0)
    })

    return NextResponse.json({
      insights: enriched,
      meta: {
        currentMonth,
        prevMonth,
        userSites,
        generatedAt: new Date().toISOString(),
        totals: {
          currentMonthSheets: curTotal,
          prevMonthSheets: prevTotal,
          meterRequiredActive,
          readThisMonth: readCount,
        },
      },
    })
  } catch (err) {
    console.error('GET /api/itam/dashboard/insights', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
