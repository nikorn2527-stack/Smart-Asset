import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/auth/verify-token — verify token validity.
 *
 * Query: ?token={token}&type={register|reset}
 *
 * Returns:
 *   { valid: true, email, data?, type } — token is valid + not expired + not used
 *   { valid: false, error } — token invalid / expired / used
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')?.trim()
    const requestedType = url.searchParams.get('type')?.trim() as
      | 'register'
      | 'reset'
      | 'invite'
      | null

    if (!token) {
      return NextResponse.json(
        { valid: false, error: 'missing token' },
        { status: 400 },
      )
    }

    const row = await db.passwordResetToken.findUnique({ where: { token } })
    if (!row || row.used) {
      return NextResponse.json(
        { valid: false, error: 'ลิงก์ไม่ถูกต้องหรือถูกใช้แล้ว' },
        { status: 200 },
      )
    }
    if (row.expiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        { valid: false, error: 'ลิงก์หมดอายุแล้ว' },
        { status: 200 },
      )
    }

    // Type filter: 'register' matches both 'invite' (Method 2) and 'register'
    if (requestedType === 'register' && row.type !== 'invite' && row.type !== 'register') {
      return NextResponse.json(
        { valid: false, error: 'ประเภทลิงก์ไม่ถูกต้อง' },
        { status: 200 },
      )
    }
    if (requestedType === 'reset' && row.type !== 'reset') {
      return NextResponse.json(
        { valid: false, error: 'ประเภทลิงก์ไม่ถูกต้อง' },
        { status: 200 },
      )
    }

    let data: Record<string, unknown> | undefined
    if (row.data) {
      try {
        data = JSON.parse(row.data) as Record<string, unknown>
      } catch {
        data = undefined
      }
    }

    return NextResponse.json({
      valid: true,
      email: row.email,
      type: row.type,
      data,
      expiresAt: row.expiresAt.toISOString(),
    })
  } catch (err) {
    console.error('GET /api/auth/verify-token', err)
    return NextResponse.json(
      {
        valid: false,
        error: 'Internal server error',
        detail: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
