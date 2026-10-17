import { describe, it, expect } from 'vitest'

/**
 * Regression: the SQLite `stripInsensitive` query interceptor must not
 * rebuild leaf values.
 *
 * It walked every node with Object.entries()/reduce, which is fine for plain
 * objects but turns a Date into {} - Object.entries(new Date()) is []. Prisma
 * then rejected every date-range filter with "Argument `_ref` is missing", so
 * the monthly report, unread-meter list and force-close all 500'd on SQLite
 * while passing on PostgreSQL.
 *
 * These assertions pin the leaf-handling contract directly against the real
 * client, since a unit test of a private function would not prove the query
 * engine accepts the result.
 */
describe('SQLite query interceptor preserves leaf values', () => {
  const start = new Date('2026-07-01T00:00:00.000Z')
  const end = new Date('2026-07-31T23:59:59.999Z')

  it('date-range queries execute (the bug produced `_ref` is missing)', async () => {
    const { db } = await import('@/lib/db')
    // StockTransaction is read by the monthly report via a createdAt range.
    const rows = await db.stockTransaction.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { id: true, createdAt: true },
    })
    expect(Array.isArray(rows)).toBe(true)
  })

  it('still strips mode:insensitive so SQLite LIKE does not reject it', async () => {
    const { db } = await import('@/lib/db')
    const rows = await db.stockItem.findMany({
      where: { productName: { contains: 'a', mode: 'insensitive' } },
      select: { id: true },
    })
    expect(Array.isArray(rows)).toBe(true)
  })

  it('keeps Dates intact through a mixed where clause', async () => {
    const { db } = await import('@/lib/db')
    const rows = await db.device.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: { equals: 'active', mode: 'insensitive' },
      },
      select: { id: true, createdAt: true },
    })
    expect(Array.isArray(rows)).toBe(true)
  })

  it('arrays of date ranges survive', async () => {
    const { db } = await import('@/lib/db')
    // readingDate is stored as a String (ISO date), not DateTime, so exercise
    // the array branch with the ISO strings the column actually holds.
    const rows = await db.meterReading.findMany({
      where: { readingDate: { in: ['2026-07-01', '2026-07-31'] } },
      select: { id: true, readingDate: true },
    })
    expect(Array.isArray(rows)).toBe(true)
  })

  it('a real DateTime array still passes through', async () => {
    const { db } = await import('@/lib/db')
    const rows = await db.auditLog.findMany({
      where: { createdAt: { in: [start, end] } },
      select: { id: true },
    })
    expect(Array.isArray(rows)).toBe(true)
  })
})