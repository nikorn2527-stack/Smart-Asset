/**
 * POST /api/settings/contact-directory/import
 *
 * SPRINT-4 #7 (IMPORT-SPEC-009): bulk import contact directory entries
 * from a JSON array. Supports merge (by phone_primary or employee_code)
 * so re-importing updates existing entries.
 *
 * Body: { contacts: Array<{ full_name, phone_primary?, employee_code?, department?, ... }> }
 * Returns: { imported, updated, errors }
 *
 * Auth: ADMIN (contact directory is admin-managed)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { loadContactDirectory } from '@/lib/guest-validation'
// NOTE: `@/lib/guest-validation` exports a *narrow* match-oriented
// ContactDirectoryEntry (name/phone/employee_code only, all optional). The
// full stored shape — with `id` and `createdAt` — is owned by the
// contact-directory route, which is also where this payload is persisted
// (AppSetting key 'contactDirectory'). Import the canonical type from there so
// the import can't silently drop identity/timestamp fields.
import type { ContactDirectoryEntry } from '../route'
import { logAudit } from '@/lib/audit'

interface ImportContact {
  full_name: string
  phone_primary?: string
  employee_code?: string
  department?: string
  active?: boolean
  note?: string
}

function makeId(): string {
  return 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function normalizePhone(s: string): string {
  let v = String(s ?? '').trim()
  if (v.startsWith('+66')) v = '0' + v.slice(3)
  else if (v.startsWith('66') && v.length === 11) v = '0' + v.slice(2)
  return v.replace(/\D+/g, '')
}

/** Save the contact directory back to AppSetting (JSON string). */
async function saveContactDirectory(contacts: ContactDirectoryEntry[]): Promise<void> {
  const json = JSON.stringify(contacts)
  await db.appSetting.upsert({
    where: { key: 'contactDirectory' },
    update: { value: json },
    create: { key: 'contactDirectory', value: json },
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json()
    const rows: ImportContact[] = Array.isArray(body.contacts) ? body.contacts : []
    if (rows.length === 0) {
      return NextResponse.json({ error: 'กรุณาส่ง array ของ contacts (อย่างน้อย 1 รายการ)' }, { status: 400 })
    }
    if (rows.length > 500) {
      return NextResponse.json({ error: 'import ได้สูงสุด 500 รายการต่อครั้ง' }, { status: 413 })
    }

    // Load existing contacts.
    //
    // `loadContactDirectory()` returns the narrow guest-validation shape where
    // `active` is OPTIONAL; the canonical stored shape (imported above) requires
    // it. Normalize with `active ?? true` so entries written before the flag
    // existed don't get dropped/retitled on re-import.
    const existing: ContactDirectoryEntry[] = (await loadContactDirectory()).map((e) => ({
      ...e,
      active: e.active ?? true,
    }))

    let imported = 0
    let updated = 0
    const errors: Array<{ row: number; name: string; error: string }> = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const fullName = String(row.full_name || '').trim()
      if (!fullName) {
        errors.push({ row: i + 1, name: '', error: 'full_name is required' })
        continue
      }

      const phone = row.phone_primary ? normalizePhone(row.phone_primary) : ''
      const empCode = String(row.employee_code || '').trim()

      // Find existing by phone or employee_code
      const matchIdx = existing.findIndex((e) => {
        if (phone && e.phone_primary === phone) return true
        if (empCode && e.employee_code === empCode) return true
        return false
      })

      const entry: ContactDirectoryEntry = {
        id: matchIdx >= 0 ? existing[matchIdx].id : makeId(),
        full_name: fullName,
        phone_primary: phone || undefined,
        employee_code: empCode || undefined,
        department: row.department ? String(row.department).trim() : undefined,
        active: row.active !== false,
        note: row.note ? String(row.note).trim() : undefined,
        createdAt: matchIdx >= 0 ? existing[matchIdx].createdAt : new Date().toISOString(),
      }

      if (matchIdx >= 0) {
        existing[matchIdx] = entry
        updated++
      } else {
        existing.push(entry)
        imported++
      }
    }

    await saveContactDirectory(existing)

    await logAudit(
      'BULK_IMPORT',
      'ContactDirectory',
      null,
      `Bulk import สมุดผู้ติดต่อ: ${imported} ใหม่, ${updated} อัปเดต, ${errors.length} error`,
      { imported, updated, errorCount: errors.length },
      auth.row.email,
    )

    return NextResponse.json({ imported, updated, errors })
  } catch (err) {
    console.error('POST /api/settings/contact-directory/import', err)
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Import failed') : 'Internal server error' },
      { status: 500 },
    )
  }
}
