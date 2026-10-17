/**
 * csv-export.ts — Simple CSV export helper.
 *
 * Usage:
 *   import { downloadCsv, downloadJson } from '@/lib/csv-export'
 *
 *   downloadCsv('devices-2024-01.csv', devices, [
 *     { key: 'assetCode', label: 'รหัส' },
 *     { key: 'name', label: 'ชื่อ' },
 *   ])
 */

import type { ExportColumn } from './default-export-templates'

/**
 * Convert array of objects to CSV string.
 * Handles commas, quotes, and newlines in values.
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExportColumn[],
): string {
  // Header row
  const header = columns.map((c) => escapeCsvValue(c.label)).join(',')
  // Data rows
  const body = rows.map((row) =>
    columns
      .map((c) => escapeCsvValue(row[c.key] != null ? String(row[c.key]) : ''))
      .join(','),
  )
  // BOM for Excel UTF-8 compatibility (Thai text)
  return '\uFEFF' + [header, ...body].join('\n')
}

function escapeCsvValue(value: string): string {
  // If value contains comma, quote, or newline → wrap in quotes + escape quotes
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Download CSV file in browser.
 */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: ExportColumn[],
): void {
  const csv = toCsv(rows, columns)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`)
}

/**
 * Download JSON file in browser.
 */
export function downloadJson(
  filename: string,
  data: unknown,
): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  downloadBlob(blob, filename.endsWith('.json') ? filename : `${filename}.json`)
}

/**
 * Download blob as file in browser.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Generate date stamp for filename: 2024-01-15
 */
export function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
