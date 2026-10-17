import { db } from '@/lib/db'
import type { CreateReportInput, ReportRecord, ReportRepository } from './contracts'

/** Prisma-backed persistence adapter. It is intentionally not exported by the module barrel. */
export const reportsRepository: ReportRepository = {
  listRecent(limit) {
    return db.report.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, type: true, title: true, rangeKey: true, format: true, createdAt: true },
    })
  },
  findById(id) {
    return db.report.findUnique({ where: { id } })
  },
  create(input) {
    return db.report.create({ data: input })
  },
  async delete(id) {
    try {
      return await db.report.delete({ where: { id } })
    } catch (error) {
      // Prisma's not-found code is deliberately mapped to null so callers
      // have one stable, database-agnostic missing-record outcome.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') return null
      throw error
    }
  },
}
