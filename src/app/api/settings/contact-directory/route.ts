import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { loadContactDirectory } from '@/lib/guest-validation'

// ============================================================
// Contact Directory API
//   GET    /api/settings/contact-directory        — list all contacts
//   POST   /api/settings/contact-directory        — add a new contact
//   DELETE /api/settings/contact-directory/[id]   — remove a contact
//
// Stored as a JSON array in `AppSetting.key = 'contactDirectory'`.
// Each entry uses snake_case keys to stay compatible with
// `lib/guest-validation.ts::loadContactDirectory`:
//   { id, full_name, phone_primary, employee_code, department, active, note, createdAt }
// ============================================================

export interface ContactDirectoryEntry {
  id: string
  full_name: string
  phone_primary?: string
  employee_code?: string
  department?: string
  active: boolean
  note?: string
  createdAt: string
}

function makeId(): string {
  return 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function normalizePhone(s: string): string {
  // Keep digits, strip spaces/dashes, convert +66 → 0
  let v = String(s ?? '').trim()
  if (v.startsWith('+66')) v = '0' + v.slice(3)
  else if (v.startsWith('66') && v.length === 11) v = '0' + v.slice(2)
  return v.replace(/\D+/g, '')
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const entries = await loadContactDirectory()
    // Ensure each entry has an id (legacy entries without id get one in-memory)
    const withIds: ContactDirectoryEntry[] = entries.map((e, idx) => ({
      id: (e as { id?: string }).id ?? `legacy_${idx}`,
      full_name: e.full_name,
      phone_primary: e.phone_primary ?? e.phone,
      employee_code: e.employee_code ?? e.employeeCode,
      department: e.department,
      active: e.active !== false,
      note: (e as { note?: string }).note,
      createdAt: (e as { createdAt?: string }).createdAt ?? new Date().toISOString(),
    }))
    return NextResponse.json({ data: withIds })
  } catch (err) {
    console.error('GET /api/settings/contact-directory', err)
    return NextResponse.json({ error: 'Failed to load contacts' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, 'ADMIN')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json()
    const fullName = String(body.fullName ?? body.full_name ?? '').trim()
    if (!fullName) {
      return NextResponse.json({ error: 'กรุณาระบุชื่อ-นามสกุล' }, { status: 400 })
    }
    const phonePrimary = normalizePhone(String(body.phonePrimary ?? body.phone_primary ?? ''))
    const employeeCode = String(body.employeeCode ?? body.employee_code ?? '').trim() || undefined
    const department = String(body.department ?? '').trim() || undefined
    const note = String(body.note ?? '').trim() || undefined
    const active = body.active !== false // default true

    const existing = await loadContactDirectory()
    const entry: ContactDirectoryEntry = {
      id: makeId(),
      full_name: fullName,
      phone_primary: phonePrimary || undefined,
      employee_code: employeeCode,
      department,
      active,
      note,
      createdAt: new Date().toISOString(),
    }

    const next = [...existing, entry]
    await db.appSetting.upsert({
      where: { key: 'contactDirectory' },
      update: { value: JSON.stringify(next) },
      create: { key: 'contactDirectory', value: JSON.stringify(next) },
    })

    try {
      await db.auditLog.create({
        data: {
          action: 'CONTACT_DIRECTORY_ADD',
          entity: 'AppSetting',
          entityId: entry.id,
          summary: `เพิ่มผู้ติดต่อ ${fullName}`,
          detail: JSON.stringify({ entry, actor: auth.user.email }),
          actor: auth.user.email,
        },
      })
    } catch (err) { console.error('[route]', err) }

    return NextResponse.json({ data: entry }, { status: 201 })
  } catch (err) {
    console.error('POST /api/settings/contact-directory', err)
    return NextResponse.json({ error: 'Failed to add contact' }, { status: 500 })
  }
}
