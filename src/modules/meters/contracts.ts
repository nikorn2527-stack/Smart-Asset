/** Public DTOs for the meters module. */
export interface MeterReadingRecord {
  id: string
  readingId: string | null
  deviceId: string
  assetCode: string | null
  readingDate: string
  readingMonth: string | null
  meterBw: number
  meterColor: number
  pagesBw: number
  pagesColor: number
  prevMeterBw: number
  prevMeterColor: number
  readingType: string | null
  readBy: string | null
  remark: string | null
  locationAtReading: string | null
  siteAtReading: string | null
  buildingAtReading: string | null
  floorAtReading: string | null
  departmentAtReading: string | null
  departmentCodeAtReading: string | null
  eventType: string | null
  eventId: string | null
  isDemo: boolean
  createdAt: Date
}

/**
 * Writable payload for `create()` — mirrors MeterReadingUncheckedCreateInput.
 *
 * `deviceId` (relation FK) and `readingDate` are the only columns with no DB
 * default, so they are required here; the rest are defaulted by Prisma or
 * nullable. Server-managed columns (`id`, `createdAt`) are excluded — passing
 * them would make Prisma throw.
 *
 * Typing this explicitly (instead of `Partial<MeterReadingRecord>`) means a
 * missing required column fails at COMPILE time, not as a Prisma runtime error.
 */
export type MeterReadingCreateInput = Required<
  Pick<MeterReadingRecord, 'deviceId' | 'readingDate'>
> &
  Partial<
    Omit<
      MeterReadingRecord,
      'id' | 'createdAt' | 'deviceId' | 'readingDate'
    >
  >

export interface MeterReadingRepository {
  findByDeviceId(deviceId: string, limit?: number): Promise<MeterReadingRecord[]>
  findLatestByAssetCode(assetCode: string): Promise<MeterReadingRecord | null>
  create(data: MeterReadingCreateInput): Promise<MeterReadingRecord>
  update(id: string, data: Partial<MeterReadingCreateInput>): Promise<MeterReadingRecord>
  findUnreadDevices(activeCycleId?: string): Promise<unknown[]>
}
