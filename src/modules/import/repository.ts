/** Prisma-backed persistence for ImportJob. Not exported by barrel. */
import { db } from '@/lib/db'
import type { ImportJobRecord, ImportJobRepository } from './contracts'

export const importJobRepository: ImportJobRepository = {
  async listRecent(limit) {
    return db.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) as Promise<ImportJobRecord[]>
  },
  async findById(id) {
    return db.importJob.findUnique({ where: { id } }) as Promise<ImportJobRecord | null>
  },
  async create(input) {
    // `input` is ImportJobCreateInput: server-managed columns are already
    // excluded by the contract, so Prisma applies its own cuid/now() defaults.
    return db.importJob.create({ data: input }) as Promise<ImportJobRecord>
  },
  async update(id, data) {
    // Same contract guarantee as create(): no id/createdAt in the payload.
    return db.importJob.update({ where: { id }, data }) as Promise<ImportJobRecord>
  },
}
