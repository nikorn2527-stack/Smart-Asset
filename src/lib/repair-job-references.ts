export interface RepairJobReferenceSource {
  woNumber?: string | null
  systemJobNo?: string | null
  legacyJobNo?: string | null
}

/**
 * Return stable, non-empty job references for matching legacy material rows.
 * The source identifiers are traceability keys; callers must still retain the
 * WorkOrder relation when it is available and must not infer across conflicts.
 */
export function getRepairJobReferences(source: RepairJobReferenceSource): string[] {
  const references = [source.woNumber, source.systemJobNo, source.legacyJobNo]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value): value is string => value.length > 0)

  return [...new Set(references)]
}
