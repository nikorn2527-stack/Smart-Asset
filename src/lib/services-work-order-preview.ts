import {
  adaptServicesWorkOrders,
  type ServicesWorkOrderAdapterItem,
} from '@/lib/services-work-order-adapter'
import {
  computePreviewItems,
  redacted,
  type PreviewItem,
  type SyncSourceRecord,
} from '@/lib/sync-adapter'

export interface ServicesWorkOrderPreviewResult {
  items: PreviewItem[]
  readyRows: number
  quarantinedRows: number
  unmappedColumns: string[]
}

function quarantineItem(item: ServicesWorkOrderAdapterItem): PreviewItem {
  const externalKey = item.identity?.sourceKey || `(row:${item.rowNumber})`
  const siteCode = item.mapped.siteCode || null

  return {
    externalKey,
    action: 'error',
    before: null,
    after: redacted(item.mapped as Record<string, unknown>),
    expectedVersion: null,
    expectedExists: false,
    siteCode,
    siteMappingReason: siteCode ? 'mapped' : 'missing',
    errorMessage: `QUARANTINED:${item.quarantineReason || 'INVALID_SOURCE_ROW'}`,
  }
}

/**
 * Build a Services -> WorkOrder preview using the existing read-only sync
 * comparison. Adapter quarantine rows are persisted as error items so they
 * remain visible in SyncRun without becoming apply candidates.
 */
export async function computeServicesWorkOrderPreview(
  records: SyncSourceRecord[],
  tx: Parameters<typeof computePreviewItems>[1],
  siteScope?: string[],
): Promise<ServicesWorkOrderPreviewResult> {
  const adapted = adaptServicesWorkOrders(records)
  const readyRecords = adapted.ready.map((item) => item.mapped as SyncSourceRecord)

  const comparableItems = await computePreviewItems(
    readyRecords,
    tx,
    siteScope,
    (record) => ({ mapped: record, unmapped: [] }),
  )

  const quarantineItems = adapted.quarantine.map(quarantineItem)

  return {
    items: [...comparableItems, ...quarantineItems],
    readyRows: adapted.ready.length,
    quarantinedRows: adapted.quarantine.length,
    unmappedColumns: adapted.unmappedColumns,
  }
}
