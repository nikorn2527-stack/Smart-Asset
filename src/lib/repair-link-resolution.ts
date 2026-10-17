// ============================================================
// Repair Link Resolution — read/preview-only WorkOrder matching
// ============================================================
// This module resolves a mapped legacy material issue against candidate
// WorkOrders without performing database reads or writes. Callers may use
// the result to build a reconciliation queue before any apply operation.
// ============================================================

import type { CanonicalMaterialIssueMapping } from '@/lib/repair-data-contract'

export interface WorkOrderLinkCandidate {
  id: string
  systemJobNo?: string | null
  legacyJobNo?: string | null
  woNumber?: string | null
}

export type WorkOrderLinkMatch = 'legacy_job_no' | 'system_job_no'

export interface ResolvedWorkOrderLink {
  workOrderId: string
  matchedBy: WorkOrderLinkMatch
  matchedReference: string
}

export interface WorkOrderLinkResolution {
  link: ResolvedWorkOrderLink | null
  warnings: string[]
  quarantineReason?:
    | 'MISSING_WORK_ORDER_REFERENCE'
    | 'WORK_ORDER_NOT_FOUND'
    | 'MULTIPLE_WORK_ORDERS_MATCH'
}

function clean(value: string | null | undefined): string | undefined {
  const text = value?.trim()
  return text || undefined
}

/**
 * Resolve a material line's legacy WorkOrderNo against known WorkOrders.
 *
 * A missing reference remains an unlinked line rather than being silently
 * assigned to a WorkOrder. An explicit but unknown/ambiguous reference is
 * quarantined for reconciliation.
 */
export function resolveMaterialIssueWorkOrder(
  material: Pick<CanonicalMaterialIssueMapping, 'workOrderLegacyNo'>,
  candidates: WorkOrderLinkCandidate[],
): WorkOrderLinkResolution {
  const reference = clean(material.workOrderLegacyNo)
  if (!reference) {
    return {
      link: null,
      warnings: ['Material issue has no WorkOrder reference; keep it unlinked'],
      quarantineReason: 'MISSING_WORK_ORDER_REFERENCE',
    }
  }

  const normalizedReference = reference.toLocaleLowerCase()
  const matches = new Map<string, { candidate: WorkOrderLinkCandidate; matchedBy: WorkOrderLinkMatch }>()

  for (const candidate of candidates) {
    const legacy = clean(candidate.legacyJobNo)?.toLocaleLowerCase()
    const system = clean(candidate.systemJobNo ?? candidate.woNumber)?.toLocaleLowerCase()

    if (legacy === normalizedReference) {
      matches.set(candidate.id, { candidate, matchedBy: 'legacy_job_no' })
    } else if (system === normalizedReference) {
      matches.set(candidate.id, { candidate, matchedBy: 'system_job_no' })
    }
  }

  if (matches.size === 0) {
    return {
      link: null,
      warnings: [`WorkOrder reference '${reference}' was not found`],
      quarantineReason: 'WORK_ORDER_NOT_FOUND',
    }
  }

  if (matches.size > 1) {
    return {
      link: null,
      warnings: [`WorkOrder reference '${reference}' matched ${matches.size} records`],
      quarantineReason: 'MULTIPLE_WORK_ORDERS_MATCH',
    }
  }

  const [{ candidate, matchedBy }] = [...matches.values()]
  return {
    link: {
      workOrderId: candidate.id,
      matchedBy,
      matchedReference: reference,
    },
    warnings: [],
  }
}
