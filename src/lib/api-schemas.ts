/**
 * api-schemas.ts — Zod validation schemas for API inputs.
 *
 * SPRINT-2 #4: every API endpoint should validate its request body
 * before processing. Previously routes trusted body shape and crashed
 * on undefined/null or returned 500s on bad input. This module
 * centralizes the schemas so they're reused across routes.
 *
 * Usage:
 *   import { loginSchema } from '@/lib/api-schemas'
 *   const parsed = loginSchema.safeParse(body)
 *   if (!parsed.success) {
 *     return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
 *   }
 *   const { email, password } = parsed.data
 */

import { z } from 'zod'

// ── Auth ────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email('รูปแบบอีเมลไม่ถูกต้อง').max(255, 'อีเมลยาวเกินไป'),
  password: z.string().min(1, 'กรุณาระบุรหัสผ่าน').max(1000, 'รหัสผ่านยาวเกินไป'),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'Refresh token ไม่ถูกต้อง').max(5000, 'Token ยาวเกินไป'),
})

export const registerSchema = z.object({
  email: z.string().email('รูปแบบอีเมลไม่ถูกต้อง').max(255),
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(1000),
  name: z.string().min(1, 'กรุณาระบุชื่อ').max(100).optional(),
  username: z.string().min(1).max(50).optional(),
})

// ── Work Orders ─────────────────────────────────────────
// SPRINT-2 #6: WO PUT must NOT accept `status` from body — it bypasses
// the dedicated /complete, /cancel endpoints. Use woUpdateSchema (which
// omits `status`) instead of accepting arbitrary body keys.
export const woCreateSchema = z.object({
  subject: z.string().min(1, 'กรุณาระบุหัวข้อ').max(500, 'หัวข้อยาวเกินไป'),
  details: z.string().max(5000, 'รายละเอียดยาวเกินไป').optional(),
  reporterName: z.string().max(100).optional(),
  tel: z.string().max(20).optional(),
  building: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  siteCode: z.string().max(20).optional(),
  deviceId: z.string().max(100).optional(),
}).passthrough() // allow extra legacy fields

export const woUpdateSchema = z.object({
  // SPRINT-2 #6: NO `status` field — callers must use /complete or /cancel
  subject: z.string().min(1).max(500).optional(),
  details: z.string().max(5000).optional(),
  reporterName: z.string().max(100).optional(),
  tel: z.string().max(20).optional(),
  building: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assignedTo: z.string().max(100).optional(),
}).passthrough()

// ── Devices ─────────────────────────────────────────────
export const deviceCreateSchema = z.object({
  assetCode: z.string().min(1, 'กรุณาระบุรหัสอุปกรณ์').max(50, 'รหัสยาวเกินไป'),
  name: z.string().min(1, 'กรุณาระบุชื่ออุปกรณ์').max(200),
  brand: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  type: z.string().max(50).optional(),
  serialNumber: z.string().max(100).optional(),
  site: z.string().min(1, 'กรุณาระบุสาขา').max(100),
  status: z.string().max(50).optional(),
}).passthrough()

export const deviceUpdateSchema = z.object({
  assetCode: z.string().max(50).optional(), // usually immutable but allow admin
  name: z.string().max(200).optional(),
  brand: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  type: z.string().max(50).optional(),
  serialNumber: z.string().max(100).optional(),
  site: z.string().max(100).optional(),
  status: z.string().max(50).optional(),
}).passthrough()

// ── Pagination ──────────────────────────────────────────
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, 'pageSize ต้องไม่เกิน 100').default(20),
})

// ── Settings ────────────────────────────────────────────
export const settingsUpdateSchema = z.record(z.string(), z.string())

// ── Helper: validate and return parsed data or 400 response ──
export function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): { ok: true; data: T } | { ok: false; error: string; status: 400 } {
  const parsed = schema.safeParse(body)
  if (parsed.success) {
    return { ok: true, data: parsed.data }
  }
  // Return the first issue's message (most useful for users)
  const firstError = parsed.error.issues[0]
  const msg = firstError
    ? `${firstError.path.join('.')}: ${firstError.message}`
    : 'Invalid body'
  return { ok: false, error: msg, status: 400 as const }
}
