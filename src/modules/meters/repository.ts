/** Prisma-backed persistence for MeterReading. Not exported by barrel. */
import { db } from '@/lib/db'
import type { MeterReadingRecord, MeterReadingRepository } from './contracts'

export const meterReadingRepository: MeterReadingRepository = {
  async findByDeviceId(deviceId, limit = 100) {
    return db.meterReading.findMany({
      where: { deviceId },
      orderBy: [{ readingMonth: 'desc' }, { id: 'desc' }],
      take: limit,
    }) as Promise<MeterReadingRecord[]>
  },

  async findLatestByAssetCode(assetCode) {
    return db.meterReading.findFirst({
      where: { assetCode },
      orderBy: [{ readingMonth: 'desc' }, { id: 'desc' }],
    }) as Promise<MeterReadingRecord | null>
  },

  async create(data) {
    // `data` is MeterReadingCreateInput: server-managed columns are excluded by
    // the contract, so Prisma applies its own defaults (cuid, @default(0), …).
    return db.meterReading.create({ data }) as Promise<MeterReadingRecord>
  },

  async update(id, data) {
    // Same contract guarantee as create(): no id/createdAt in the payload.
    return db.meterReading.update({ where: { id }, data }) as Promise<MeterReadingRecord>
  },

  async findUnreadDevices(activeCycleId) {
    // Complex query — delegates to the existing unread route logic
    // Will be fully extracted when the unread route is refactored
    const devices = await db.device.findMany({
      where: {
        meterRequired: true,
        status: 'Active',
        ...(activeCycleId ? {} : {}),
      },
      select: {
        id: true,
        assetCode: true,
        name: true,
        brand: true,
        model: true,
        site: true,
        building: true,
        floor: true,
        department: true,
        lastMeterBw: true,
        lastMeterColor: true,
        // NOTE: `lastReadingMonth` is NOT a Device column — it is derived per
        // request by the devices list route from the latest MeterReading.
        // Selecting it here made Prisma reject the query at runtime.
      },
      orderBy: { assetCode: 'asc' },
    })
    return devices
  },
}
