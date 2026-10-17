export type MeterAggregate = 'monthly' | 'byDevice'

export interface MeterReadingInput {
  deviceId?: string
  reading?: number
  previousReading?: number | null
  date?: string
  remark?: string | null
  cycleId?: string | null
}

export interface MeterReadingValidation {
  ok: boolean
  code?:
    | 'MISSING_DEVICE_ID'
    | 'MISSING_DATE'
    | 'INVALID_DATE'
    | 'INVALID_READING'
    | 'INVALID_PREVIOUS_READING'
    | 'NEGATIVE_READING'
    | 'RESET_REQUIRES_REMARK'
  deviceId?: string
  reading?: number
  previousReading?: number
  delta?: number
  isReset?: boolean
  date?: string
  remark?: string | null
  cycleId?: string | null
}

export interface MeterReadingReference {
  deviceId: string
  date: string
  cycleId?: string | null
}

export interface MeterReadingFreshnessReference {
  readingDate: string
}

export type MeterChannel = 'bw' | 'color'

export interface MeterChannelsInput {
  deviceId: string
  date: string
  remark?: string | null
  cycleId?: string | null
  meterBw: number
  previousMeterBw: number
  meterColor: number
  previousMeterColor: number
}

export interface MeterChannelsValidation {
  ok: boolean
  channel?: MeterChannel
  validation?: MeterReadingValidation
}

export interface MeterQuery {
  deviceId?: string
  cycleId?: string
  aggregate?: MeterAggregate
  limit: number
  offset: number
}

export interface MeterQueryParseResult {
  ok: boolean
  query?: MeterQuery
  error?: string
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

function isValidIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Validate a meter reading without accessing Prisma or device state. */
export function validateMeterReading(input: MeterReadingInput): MeterReadingValidation {
  const deviceId = input.deviceId?.trim()
  if (!deviceId) return { ok: false, code: 'MISSING_DEVICE_ID' }

  const date = input.date?.trim()
  if (!date) return { ok: false, code: 'MISSING_DATE' }
  if (!isValidIsoDate(date)) return { ok: false, code: 'INVALID_DATE', date }

  if (!finiteNumber(input.reading)) {
    return { ok: false, code: 'INVALID_READING', deviceId, date }
  }
  const reading = Math.floor(input.reading)
  if (reading < 0) {
    return { ok: false, code: 'NEGATIVE_READING', deviceId, date, reading }
  }

  const previousReading = input.previousReading ?? 0
  if (!finiteNumber(previousReading) || previousReading < 0) {
    return { ok: false, code: 'INVALID_PREVIOUS_READING', deviceId, date, reading }
  }

  const delta = reading - previousReading
  const remark = input.remark?.trim() || null
  if (delta < 0 && !remark) {
    return {
      ok: false,
      code: 'RESET_REQUIRES_REMARK',
      deviceId,
      reading,
      previousReading,
      delta,
      isReset: true,
      date,
      remark,
      cycleId: input.cycleId?.trim() || null,
    }
  }

  return {
    ok: true,
    deviceId,
    reading,
    previousReading,
    delta,
    isReset: delta < 0,
    date,
    remark,
    cycleId: input.cycleId?.trim() || null,
  }
}

/** Validate both meter channels with the same device/date/reset policy. */
export function validateMeterChannels(input: MeterChannelsInput): MeterChannelsValidation {
  const channels: Array<{
    channel: MeterChannel
    reading: number
    previousReading: number
  }> = [
    { channel: 'bw', reading: input.meterBw, previousReading: input.previousMeterBw },
    { channel: 'color', reading: input.meterColor, previousReading: input.previousMeterColor },
  ]

  for (const channel of channels) {
    const validation = validateMeterReading({
      deviceId: input.deviceId,
      reading: channel.reading,
      previousReading: channel.previousReading,
      date: input.date,
      remark: input.remark,
      cycleId: input.cycleId,
    })
    if (!validation.ok) return { ok: false, channel: channel.channel, validation }
  }

  return { ok: true }
}

/** One reading per device and calendar month unless an explicit cycleId exists. */
export function meterPeriodKey(reference: MeterReadingReference): string {
  const cycleId = reference.cycleId?.trim()
  if (cycleId) return `${reference.deviceId}:cycle:${cycleId}`
  return `${reference.deviceId}:month:${reference.date.slice(0, 7)}`
}

export function hasDuplicateMeterPeriod(
  candidate: MeterReadingReference,
  existing: MeterReadingReference[],
): boolean {
  const candidateKey = meterPeriodKey(candidate)
  return existing.some((reference) => meterPeriodKey(reference) === candidateKey)
}

/** A monthly reading from an older date must not overwrite a newer reading. */
export function isStaleMeterReading(
  candidate: MeterReadingFreshnessReference,
  existing: MeterReadingFreshnessReference | null | undefined,
): boolean {
  if (!existing) return false
  return candidate.readingDate < existing.readingDate
}

/** Parse and clamp list parameters so query cost is bounded by contract. */
export function parseMeterQuery(params: URLSearchParams): MeterQueryParseResult {
  const aggregateValue = params.get('aggregate')?.trim() || undefined
  if (aggregateValue && aggregateValue !== 'monthly' && aggregateValue !== 'byDevice') {
    return { ok: false, error: 'aggregate must be monthly or byDevice' }
  }

  const rawLimit = params.get('limit')
  const rawOffset = params.get('offset')
  const limit = rawLimit === null || rawLimit === '' ? DEFAULT_LIMIT : Number(rawLimit)
  const offset = rawOffset === null || rawOffset === '' ? 0 : Number(rawOffset)

  if (!Number.isInteger(limit) || limit < 1) {
    return { ok: false, error: 'limit must be a positive integer' }
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return { ok: false, error: 'offset must be a non-negative integer' }
  }

  return {
    ok: true,
    query: {
      deviceId: params.get('deviceId')?.trim() || undefined,
      cycleId: params.get('cycleId')?.trim() || undefined,
      aggregate: aggregateValue as MeterAggregate | undefined,
      limit: Math.min(limit, MAX_LIMIT),
      offset,
    },
  }
}
