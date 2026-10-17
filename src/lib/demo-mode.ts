/**
 * demo-mode.ts — Demo Mode helpers (Task ID: DEMO-MODE-E2E-TESTS).
 *
 * Demo users (`User.isDemo === true`) ใช้งานแอปได้เต็มรูปแบบโดยไม่กระทบข้อมูลจริง:
 *   • READ  — เห็นเฉพาะข้อมูล demo (isDemo = true) เท่านั้น เพื่อให้ทดสอบได้แบบ isolated
 *             ไม่เห็นข้อมูลจริงของผู้ใช้คนอื่น ป้องกันการอ่าน/screenshot ข้อมูลจริงระหว่างทดสอบ
 *   • WRITE — ทุก record ที่สร้างจะถูก tag `isDemo: true` อัตโนมัติผ่าน demoTag()
 *             ทำให้ลบได้ง่าย (POST /api/itam/demo/reset ลบทุก row ที่ isDemo = true)
 *
 * Real users (`User.isDemo` เป็น false หรือ null):
 *   • READ  — เห็นเฉพาะข้อมูลจริง (isDemo != true) — ข้อมูล demo ถูกซ่อน
 *   • WRITE — สร้าง record ปกติ (isDemo = false)
 *
 * Concept นี้ทำให้ demo กับ production แยกจากกันอย่างสมบูรณ์:
 *   - demo user ทำอะไรก็อยู่ใน demo scope
 *   - real user ไม่เห็นอะไรที่ demo user สร้าง
 *   - ล้าง demo data ได้โดยไม่กระทบจริง
 */

/** Minimal user shape needed by the helpers. */
export interface DemoAwareUser {
  isDemo?: boolean | null
}

/**
 * Returns `true` when the supplied user is a demo user.
 * Tolerates `null`/`undefined` for callers that pass an optional user.
 */
export function isDemoUser(user: DemoAwareUser | null | undefined): boolean {
  return user?.isDemo === true
}

/**
 * Build a Prisma `where` fragment that filters data based on demo status.
 *
 * - Demo users: เห็นเฉพาะข้อมูล demo (isDemo = true) — isolated from real data
 * - Real users: เห็นเฉพาะข้อมูลจริง (isDemo = false หรือ null) — demo data ถูกซ่อน
 *
 * Use this on every list endpoint to enforce demo data isolation:
 *   const where = { ...filters, ...demoFilter(auth.user) }
 */
export function demoFilter(user: DemoAwareUser | null | undefined): Record<string, unknown> {
  // Demo users see ONLY demo data (isolated from real production data)
  if (isDemoUser(user)) return { isDemo: true }
  // Real users see ONLY non-demo data.
  // Note: isDemo is `Boolean @default(false)` (NOT nullable), so we use
  // `isDemo: false` directly. Previously this used `OR: [{ isDemo: false }, { isDemo: null }]`
  // but `{ isDemo: null }` is invalid for a required field and Prisma throws
  // "Argument isDemo is missing" at runtime.
  return { isDemo: false }
}

/**
 * Build a Prisma `data` fragment that tags a created/updated record as
 * belonging to the demo scope. Returns `{ isDemo: true }` for demo users,
 * `{}` for real users (so the column keeps its DB default of `false`).
 *
 * Spread this into every create payload:
 *   `await db.device.create({ data: { ...payload, ...demoTag(user) } })`
 */
export function demoTag(user: DemoAwareUser | null | undefined): { isDemo?: true } {
  if (!isDemoUser(user)) return {}
  return { isDemo: true }
}
