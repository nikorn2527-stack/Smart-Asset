import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { logAudit } from '@/lib/audit'
import { uploadImage, isStorageConfigured } from '@/lib/storage'

/**
 * GET /api/itam/auth/me/profile
 *
 * Returns the current user's profile (name, email, username, avatarUrl,
 * role, phone, department). Used by the profile-edit UI.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const user = await db.user.findUnique({
    where: { id: auth.row.id },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      avatarUrl: true,
      role: true,
      phone: true,
      department: true,
    },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ user })
}

/**
 * PUT /api/itam/auth/me/profile
 *
 * Lets a user update their OWN profile (not role/permissions — those need
 * admin). Allowed fields: name, avatarUrl, phone, department.
 *
 * Body: { name?, avatarUrl?, phone?, department? }
 */
export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      avatarUrl?: string | null
      phone?: string | null
      department?: string | null
    }

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) {
      const n = String(body.name).trim()
      if (n.length === 0 || n.length > 100) {
        return NextResponse.json({ error: 'ชื่อต้องมีความยาว 1-100 ตัวอักษร' }, { status: 400 })
      }
      data.name = n
    }
    if (body.avatarUrl !== undefined) {
      // Accept null (clear avatar) or a string URL/data-URL
      const url = body.avatarUrl
      if (url === null) {
        data.avatarUrl = null
      } else if (typeof url === 'string') {
        // Validate: must be http(s) URL or data:image/... (base64)
        if (
          url.startsWith('http://') ||
          url.startsWith('https://') ||
          url.startsWith('data:image/')
        ) {
          // Cap size at 2MB for data URLs (avoid DB bloat)
          if (url.startsWith('data:image/') && url.length > 2_700_000) {
            return NextResponse.json(
              { error: 'รูปใหญ่เกินไป (สูงสุด 2MB) — กรุณาย่อขนาดก่อนอัปโหลด' },
              { status: 413 },
            )
          }
          // SPRINT-1 #2: if it's a base64 data URL AND external storage is
          // configured, upload to R2/Blob/Supabase and store only the URL
          // (avoids bloating the User table with multi-MB base64 strings).
          // If storage is NOT configured (dev/memory mode), keep the data
          // URL as-is so avatars still work in dev.
          if (url.startsWith('data:image/') && isStorageConfigured()) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/)
            if (match) {
              const contentType = match[1]
              const ext = contentType.split('/')[1] === 'jpeg' ? 'jpg' : (contentType.split('/')[1] || 'jpg')
              const buffer = Buffer.from(match[2], 'base64')
              try {
                const { url: storedUrl } = await uploadImage(buffer, ext, 'avatars')
                data.avatarUrl = storedUrl
              } catch (uploadErr) {
                console.error('[profile] avatar upload failed, keeping data URL:', uploadErr)
                data.avatarUrl = url
              }
            } else {
              data.avatarUrl = url
            }
          } else {
            data.avatarUrl = url
          }
        } else {
          return NextResponse.json({ error: 'avatarUrl ต้องเป็น URL หรือ data:image/...' }, { status: 400 })
        }
      }
    }
    if (body.phone !== undefined) {
      data.phone = body.phone ? String(body.phone).trim().slice(0, 20) : null
    }
    if (body.department !== undefined) {
      data.department = body.department ? String(body.department).trim().slice(0, 100) : null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'ไม่มีฟิลด์ให้อัปเดต' }, { status: 400 })
    }

    const updated = await db.user.update({
      where: { id: auth.row.id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        avatarUrl: true,
        role: true,
        phone: true,
        department: true,
      },
    })

    // Audit log (non-fatal)
    await logAudit(
      'PROFILE_UPDATE',
      'User',
      auth.row.id,
      `อัปเดตโปรไฟล์: ${Object.keys(data).join(', ')}`,
      { fields: Object.keys(data) },
      auth.row.email ?? 'user',
    ).catch(() => {})

    return NextResponse.json({ user: updated })
  } catch (err) {
    console.error('PUT /api/itam/auth/me/profile', err)
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 },
    )
  }
}
