import {
  mapLegacyWorkOrderRecord,
  type CanonicalWorkOrderMapping,
  type MappingResult,
  type SourceIdentity,
} from '@/lib/repair-data-contract'
import type { SyncSourceRecord } from '@/lib/sync-adapter'

export interface ServicesWorkOrderAdapterItem {
  rowNumber: number
  identity: SourceIdentity | null
  mapped: CanonicalWorkOrderMapping
  warnings: string[]
  unmapped: string[]
  quarantineReason?: string
}

export interface ServicesWorkOrderAdapterResult {
  ready: ServicesWorkOrderAdapterItem[]
  quarantine: ServicesWorkOrderAdapterItem[]
  unmappedColumns: string[]
}

function toItem(
  rowNumber: number,
  result: MappingResult<CanonicalWorkOrderMapping>,
): ServicesWorkOrderAdapterItem {
  return {
    rowNumber,
    identity: result.identity,
    mapped: result.mapped,
    warnings: result.warnings,
    unmapped: result.unmapped,
    quarantineReason: result.quarantineReason,
  }
}

/**
 * Adapt a batch of read-only Services rows into the canonical WorkOrder contract.
 *
 * This boundary only maps and quarantines records. It deliberately does not
 * resolve database relations, allocate system job numbers, or write business
 * tables. The caller must use Preview/SyncRun semantics for persistence.
 */
export function adaptServicesWorkOrders(
  records: SyncSourceRecord[],
): ServicesWorkOrderAdapterResult {
  const seenSourceKeys = new Set<string>()
  const ready: ServicesWorkOrderAdapterItem[] = []
  const quarantine: ServicesWorkOrderAdapterItem[] = []
  const unmappedColumns = new Set<string>()

  records.forEach((record, index) => {
    const rowNumber = index + 1
    const mapped = mapLegacyWorkOrderRecord(record)
    mapped.unmapped.forEach((key) => unmappedColumns.add(key))

    const item = toItem(rowNumber, mapped)
    const sourceKey = mapped.identity?.sourceKey

    if (sourceKey && seenSourceKeys.has(sourceKey)) {
      item.quarantineReason = 'DUPLICATE_SOURCE_KEY'
    } else if (sourceKey) {
      seenSourceKeys.add(sourceKey)
    }

    if (item.quarantineReason) {
      quarantine.push(item)
    } else {
      ready.push(item)
    }
  })

  return {
    ready,
    quarantine,
    unmappedColumns: Array.from(unmappedColumns).sort(),
  }
}
