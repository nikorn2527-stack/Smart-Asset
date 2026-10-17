import { db } from '@/lib/db'
import type { DeviceRecord, DeviceRepository } from './contracts'
export const deviceRepository: DeviceRepository = {
  async findById(id) {
    return db.device.findUnique({ where: { id } }) as Promise<DeviceRecord | null>
  },
  async findByAssetCode(assetCode) {
    return db.device.findFirst({ where: { OR: [{ id: assetCode }, { assetCode }] } }) as Promise<DeviceRecord | null>
  },
  async list(filter) {
    return db.device.findMany({
      where: {
        ...(filter?.site ? { site: filter.site } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
      take: filter?.limit ?? 100,
      orderBy: { assetCode: 'asc' },
    }) as Promise<DeviceRecord[]>
  },
}
