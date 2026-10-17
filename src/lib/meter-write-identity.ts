export type MeterWriteIdentity = {
  readingId: string
  assetCode: string
  readingMonth: string
  meterBw: number
  meterColor: number
}

export type ExistingMeterWrite = Omit<MeterWriteIdentity, 'assetCode' | 'readingId' | 'readingMonth'> & {
  readingId: string | null
  assetCode: string | null
  readingMonth: string | null
}

export type MeterWriteReplay =
  | { status: 'new'; readingId: string | null }
  | { status: 'replay'; readingId: string }
  | { status: 'conflict'; readingId: string }

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

/** Normalize a caller-provided retry identity without accepting blank keys. */
export function normalizeMeterReadingId(value: unknown): string | null {
  const normalized = clean(value)
  return normalized ? normalized.slice(0, 160) : null
}

/**
 * Decide whether a request is a new write, an exact retry, or a conflicting
 * reuse of an idempotency key. The route can safely return the original row
 * for `replay` and reject `conflict` without mutating meter state.
 */
export function classifyMeterWriteReplay(
  requested: Omit<MeterWriteIdentity, 'readingId'> & { readingId: string | null },
  existing: ExistingMeterWrite | null,
): MeterWriteReplay {
  if (!requested.readingId) return { status: 'new', readingId: null }
  if (!existing) return { status: 'new', readingId: requested.readingId }

  const samePayload = existing.readingId === requested.readingId
    && existing.assetCode === requested.assetCode
    && existing.readingMonth === requested.readingMonth
    && existing.meterBw === requested.meterBw
    && existing.meterColor === requested.meterColor

  return samePayload
    ? { status: 'replay', readingId: requested.readingId }
    : { status: 'conflict', readingId: requested.readingId }
}
