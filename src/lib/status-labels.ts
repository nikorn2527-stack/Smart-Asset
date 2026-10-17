/**
 * status-labels.ts — Central status/enum label mapping.
 *
 * I18N-08: Status values from the DB (like 'ACTIVE', 'PENDING') should
 * display in the user's selected language, not as raw English codes.
 *
 * Components should use getStatusLabel() or the useStatusLabel() hook
 * instead of showing status codes directly.
 */

import { translate, type Lang } from '@/lib/i18n'

// Map status codes (stored in DB) to i18n dictionary keys.
const STATUS_LABEL_MAP: Record<string, string> = {
  // Device status
  'Active': 'status.active',
  'In Repair': 'status.in_repair',
  'Retired': 'status.retired',
  'Spare': 'status.spare',

  // Work Order status
  'PENDING': 'status.pending',
  'IN_PROGRESS': 'status.in_progress',
  'WAITING_PARTS': 'status.waiting_parts',
  'COMPLETED': 'status.completed',
  'CANCELLED': 'status.cancelled',
  'ON_HOLD': 'status.on_hold',
  'ASSIGNED': 'status.assigned',

  // Priority (Thai values from legacy data)
  'ด่วน': 'priority.urgent',
  'สูง': 'priority.high',
  'ปกติ': 'priority.normal',
  'ต่ำ': 'priority.low',
  'ปานกลาง': 'priority.medium',

  // Priority (English values)
  'Urgent': 'priority.urgent',
  'High': 'priority.high',
  'Normal': 'priority.normal',
  'Low': 'priority.low',
  'Medium': 'priority.medium',
}

/**
 * Get the localized label for a status code.
 * Falls back to the raw code if no mapping exists.
 */
export function getStatusLabel(code: string | null | undefined, lang: Lang = 'th'): string {
  if (!code) return '—'
  const key = STATUS_LABEL_MAP[code]
  if (!key) return code
  return translate(key, lang)
}

/**
 * Get the i18n key for a status code (for t() calls in components).
 */
export function getStatusLabelKey(code: string): string | null {
  return STATUS_LABEL_MAP[code] ?? null
}
