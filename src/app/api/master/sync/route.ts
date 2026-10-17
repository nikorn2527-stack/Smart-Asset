import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// POST /api/master/sync?type=model|dept|labels
// Backfills parentRef / departmentCode / displayLabel on existing devices & master items.
// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable


  try {
    const { searchParams } = new URL(req.url)
    const type = (searchParams.get('type') ?? '').trim()

    let count = 0

    if (type === 'model') {
      // For MasterItem category=Model with empty parentRef: set parentRef = `${brand}|${type}`
      // (best-effort: infer from displayLabel/label split)
      const models = await db.masterItem.findMany({
        where: { category: 'Model' },
      })
      for (const m of models) {
        if (m.parentRef) continue
        const source = m.displayLabel || m.label
        const parts = source.split('|')
        const parentRef = parts.length >= 2 ? `${parts[0]}|${parts[1]}` : m.label
        await db.masterItem.update({
          where: { id: m.id },
          data: { parentRef },
        })
        count++
      }
      // Also for devices: set parentRef = `${brand}|${type}` if empty
      const devices = await db.device.findMany({ where: { parentRef: null } })
      for (const d of devices) {
        await db.device.update({
          where: { id: d.id },
          data: { parentRef: `${d.brand}|${d.type}` },
        })
        count++
      }
    } else if (type === 'dept') {
      // syncDepartmentCodes: derive departmentCode from department for devices
      const devices = await db.device.findMany({
        where: { departmentCode: null },
      })
      for (const d of devices) {
        if (!d.department) continue
        const code = d.department
          .replace(/\s+/g, '_')
          .replace(/[()]/g, '')
          .toUpperCase()
          .slice(0, 20)
        await db.device.update({
          where: { id: d.id },
          data: { departmentCode: code },
        })
        count++
      }
      // For MasterItem category=Department: ensure displayLabel set
      const depts = await db.masterItem.findMany({
        where: { category: 'Department' },
      })
      for (const d of depts) {
        if (d.displayLabel) continue
        await db.masterItem.update({
          where: { id: d.id },
          data: { displayLabel: d.label },
        })
        count++
      }
    } else if (type === 'labels') {
      // syncDisplayLabels: set displayLabel = label if empty (devices + master)
      const devices = await db.device.findMany({ where: { displayLabel: null } })
      for (const d of devices) {
        await db.device.update({
          where: { id: d.id },
          data: { displayLabel: d.name },
        })
        count++
      }
      const items = await db.masterItem.findMany({
        where: { displayLabel: null },
      })
      for (const it of items) {
        await db.masterItem.update({
          where: { id: it.id },
          data: { displayLabel: it.label },
        })
        count++
      }
    } else {
      return NextResponse.json(
        { error: 'Invalid type. Use model|dept|labels' },
        { status: 400 },
      )
    }

    const typeLabels: Record<string, string> = {
      model: 'Model (ParentRef)',
      dept: 'Department (DepartmentCode)',
      labels: 'DisplayLabel',
    }
    await logAudit(
      'SYNC',
      'MasterItem',
      null,
      `ซิงค์ข้อมูลมาตรฐาน (${typeLabels[type] ?? type}): ${count} รายการ`,
      { type, updated: count },
    )

    return NextResponse.json({ ok: true, type, updated: count })
  } catch (err) {
    console.error('POST /api/master/sync', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Sync failed') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
