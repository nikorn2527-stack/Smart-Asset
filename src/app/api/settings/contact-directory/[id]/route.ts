import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { loadContactDirectory } from '@/lib/guest-validation'

// ============================================================
// DELETE /api/settings/contact-directory/[id]
// Removes the entry whose `id` matches. The directory is stored
// as a JSON array in `AppSetting.key = 'contactDirectory'`.
// ============================================================

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const existing = await loadContactDirectory()

    // Some legacy entries may not have a stable id — match by id OR by
    // (full_name + phone_primary) pair if id is missing.
    const next = existing.filter((e) => {
      const eid = (e as { id?: string }).id
      if (eid && eid === id) return false
      if (id.startsWith('legacy_')) {
        const idx = parseInt(id.replace('legacy_', ''), 10)
        if (Number.isFinite(idx) && existing[idx] === e) return false
      }
      return true
    })

    if (next.length === existing.length) {
      return NextResponse.json({ error: 'ไม่พบรายการที่ต้องการลบ' }, { status: 404 })
    }

    await db.appSetting.upsert({
      where: { key: 'contactDirectory' },
      update: { value: JSON.stringify(next) },
      create: { key: 'contactDirectory', value: JSON.stringify(next) },
    })

    try {
      await db.auditLog.create({
        data: {
          action: 'CONTACT_DIRECTORY_DELETE',
          entity: 'AppSetting',
          entityId: id,
          summary: `ลบผู้ติดต่อ (id=${id})`,
          detail: JSON.stringify({ id, actor: auth.user.email }),
          actor: auth.user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/settings/contact-directory/[id]', err)
    return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 })
  }
}
