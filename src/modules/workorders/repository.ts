import { db } from '@/lib/db'
import type { WorkOrderRecord, WorkOrderRepository } from './contracts'
export const workOrderRepository: WorkOrderRepository = {
  async findById(id) {
    return db.workOrder.findUnique({ where: { id } }) as Promise<WorkOrderRecord | null>
  },
  async listRecent(limit, filter) {
    return db.workOrder.findMany({
      where: filter?.status ? { status: filter.status } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) as Promise<WorkOrderRecord[]>
  },
}
