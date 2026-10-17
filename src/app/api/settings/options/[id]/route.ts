import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'

// ============================================================
// DELETE /api/settings/options/[id]
// Removes a subject/building/resolution option by its stable `id`.
// The id prefix indicates which AppSetting key to mutate:
//   subj_*  → subjectOptions
//   bld_*   → wo_buildings
//   res_*   → resolutionOptions
// ============================================================

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req, 'MASTER_DATA_EDIT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'missing id' }, { status: 400 })
    }

    // Determine which collection to mutate based on id prefix.
    let key: string
    let label: string
    if (id.startsWith('subj')) {
      key = 'subjectOptions'
      label = 'หัวข้อปัญหา'
    } else if (id.startsWith('bld')) {
      key = 'wo_buildings'
      label = 'อาคาร/ฝ่าย'
    } else if (id.startsWith('res')) {
      key = 'resolutionOptions'
      label = 'ผลการแก้ไข'
    } else {
      return NextResponse.json({ error: 'id ไม่ถูกต้อง' }, { status: 400 })
    }

    const row = await db.appSetting.findUnique({ where: { key } })
    let arr: Array<{ id?: string; value?: string; group?: string }> = []
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value)
        if (Array.isArray(parsed)) arr = parsed
      } catch (err) { console.error('[route]', err) }
    }

    // Find by id, OR by index when the id is a "legacy_<n>" synthetic.
    let removed: { value?: string; group?: string } | undefined
    const next = arr.filter((e, idx) => {
      const eid = typeof e?.id === 'string' ? e.id : undefined
      if (eid && eid === id) {
        removed = e
        return false
      }
      // Legacy entries get assigned ids like `${prefix}_legacy_${idx}`
      // by the parse* helpers in the GET route. Handle them too.
      if (id.includes('_legacy_')) {
        const m = id.match(/_legacy_(\d+)$/)
        if (m && parseInt(m[1], 10) === idx) {
          removed = e
          return false
        }
      }
      return true
    })

    if (!removed) {
      return NextResponse.json({ error: 'ไม่พบรายการที่ต้องการลบ' }, { status: 404 })
    }

    const nextValue = JSON.stringify(
      next.map(({ id: _omitId, ...rest }) => (_omitId ? { id: _omitId, ...rest } : rest)),
    )
    await db.appSetting.upsert({
      where: { key },
      update: { value: nextValue },
      create: { key, value: nextValue },
    })

    try {
      await db.auditLog.create({
        data: {
          action: 'WO_OPTIONS_DELETE',
          entity: 'AppSetting',
          entityId: id,
          summary: `ลบ${label}: ${removed.value ?? id}`,
          detail: JSON.stringify({ id, key, removed, actor: auth.user.email }),
          actor: auth.user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/settings/options/[id]', err)
    return NextResponse.json({ error: 'Failed to delete option' }, { status: 500 })
  }
}
