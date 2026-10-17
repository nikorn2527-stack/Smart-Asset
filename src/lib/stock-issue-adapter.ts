import {
  mapLegacyStockOutRecord,
  type CanonicalMaterialIssueMapping,
  type MappingResult,
  type SourceIdentity,
} from '@/lib/repair-data-contract'
import type { SyncSourceRecord } from '@/lib/sync-adapter'

export interface StockIssueAdapterItem {
  rowNumber: number
  identity: SourceIdentity | null
  mapped: CanonicalMaterialIssueMapping
  warnings: string[]
  unmapped: string[]
  quarantineReason?: string
}

export interface StockIssueAdapterResult {
  ready: StockIssueAdapterItem[]
  quarantine: StockIssueAdapterItem[]
  unmappedColumns: string[]
}

function toItem(
  rowNumber: number,
  result: MappingResult<CanonicalMaterialIssueMapping>,
): StockIssueAdapterItem {
  return {
    rowNumber,
    identity: result.identity,
    mapped: result.mapped,
    warnings: result.warnings,
    unmapped: result.unmapped,
    quarantineReason: result.quarantineReason,
  }
}

function addApprovalConsistencyQuarantine(item: StockIssueAdapterItem): void {
  if (item.quarantineReason) return

  const hasApprover = Boolean(item.mapped.approver?.trim())
  const hasApprovedAt = Boolean(item.mapped.approvedAt?.trim())

  // A timestamp without an approver is not safe to treat as an approved issue.
  // Do not infer approval from free-form legacy flags at this boundary.
  if (hasApprovedAt && !hasApprover) {
    item.quarantineReason = 'APPROVAL_TIMESTAMP_WITHOUT_APPROVER'
  }
}

/**
 * Adapt legacy StockOut rows into normalized material-issue lines.
 *
 * This is a read-only mapping/validation boundary. It keeps requester,
 * department, purpose and approver separate and never mutates stock quantity
 * or creates a WorkOrder link.
 */
export function adaptLegacyStockIssues(
  records: SyncSourceRecord[],
): StockIssueAdapterResult {
  const seenSourceKeys = new Set<string>()
  const ready: StockIssueAdapterItem[] = []
  const quarantine: StockIssueAdapterItem[] = []
  const unmappedColumns = new Set<string>()

  records.forEach((record, index) => {
    const item = toItem(index + 1, mapLegacyStockOutRecord(record))
    item.unmapped.forEach((key) => unmappedColumns.add(key))

    const sourceKey = item.identity?.sourceKey
    if (sourceKey && seenSourceKeys.has(sourceKey) && !item.quarantineReason) {
      item.quarantineReason = 'DUPLICATE_SOURCE_KEY'
    } else if (sourceKey) {
      seenSourceKeys.add(sourceKey)
    }

    addApprovalConsistencyQuarantine(item)

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
