export type WorkOrderReferenceInput = {
  workOrderId?: unknown
  workOrderNo?: unknown
  legacyJobNo?: unknown
  systemJobNo?: unknown
  requestId?: unknown
}

export type WorkOrderRecord = {
  id: string
  woNumber?: string | null
  legacyJobNo?: string | null
  systemJobNo?: string | null
  requestId?: string | null
}

export type WorkOrderResolution =
  | {
      status: 'unlinked'
      supplied: string[]
      reason: 'NO_REFERENCE'
    }
  | {
      status: 'resolved'
      supplied: string[]
      workOrder: WorkOrderRecord
      canonicalWorkOrderNo: string | null
    }
  | {
      status: 'quarantined'
      supplied: string[]
      reason: 'NOT_FOUND' | 'CONFLICTING_REFERENCES' | 'AMBIGUOUS_REFERENCE'
    }

type WorkOrderLookup = {
  byId: (value: string) => Promise<WorkOrderRecord | null>
  byWoNumber: (value: string) => Promise<WorkOrderRecord | null>
  byLegacyJobNo: (value: string) => Promise<WorkOrderRecord | null>
  bySystemJobNo: (value: string) => Promise<WorkOrderRecord | null>
  byRequestId: (value: string) => Promise<WorkOrderRecord | null>
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

function canonicalNumber(workOrder: WorkOrderRecord): string | null {
  return workOrder.systemJobNo || workOrder.woNumber || workOrder.legacyJobNo || workOrder.requestId || null
}

/**
 * Resolve optional work-order references without guessing across identifiers.
 * Any missing or conflicting match is quarantined rather than linked silently.
 */
export async function resolveWorkOrderReference(
  input: WorkOrderReferenceInput,
  lookup: WorkOrderLookup,
): Promise<WorkOrderResolution> {
  const references = [
    ['workOrderId', clean(input.workOrderId)],
    ['workOrderNo', clean(input.workOrderNo)],
    ['legacyJobNo', clean(input.legacyJobNo)],
    ['systemJobNo', clean(input.systemJobNo)],
    ['requestId', clean(input.requestId)],
  ] as const
  const supplied = references.filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`)
  if (supplied.length === 0) return { status: 'unlinked', supplied, reason: 'NO_REFERENCE' }

  const matches: WorkOrderRecord[] = []
  let missingReference = false
  for (const [kind, value] of references) {
    if (!value) continue
    const match = kind === 'workOrderId'
      ? await lookup.byId(value)
      : kind === 'workOrderNo'
        ? await lookup.byWoNumber(value)
        : kind === 'legacyJobNo'
          ? await lookup.byLegacyJobNo(value)
          : kind === 'systemJobNo'
            ? await lookup.bySystemJobNo(value)
            : await lookup.byRequestId(value)
    if (match) matches.push(match)
    else missingReference = true
  }

  if (matches.length === 0 || missingReference) {
    return { status: 'quarantined', supplied, reason: 'NOT_FOUND' }
  }

  const distinctIds = new Set(matches.map((match) => match.id))
  if (distinctIds.size > 1) {
    return { status: 'quarantined', supplied, reason: 'CONFLICTING_REFERENCES' }
  }

  const workOrder = matches[0]
  if (!workOrder) {
    return { status: 'quarantined', supplied, reason: 'AMBIGUOUS_REFERENCE' }
  }
  return {
    status: 'resolved',
    supplied,
    workOrder,
    canonicalWorkOrderNo: canonicalNumber(workOrder),
  }
}

/** Stable source key for retries from CSV/legacy import jobs. */
export function normalizeStockSourceKey(value: unknown): string | null {
  const key = clean(value)
  return key ? key.slice(0, 200) : null
}
