/**
 * Custom Export helpers — shared between pages that use CustomExportDialog.
 *
 * Used by:
 *   - itam-meter-unified.tsx        (Meter page)
 *   - stock/stock-inventory.tsx    (Stock Inventory)
 *   - itam-audit.tsx                (Audit Log)
 *   - itam-paper-analytics.tsx      (Paper Analytics)
 *
 * Mirrors the recipe described in TASK-4-CUSTOM-EXPORT:
 *   • csv  → UTF-8 BOM (\uFEFF) + RFC-4180 escaping (delegates to downloadCsv)
 *   • xlsx → HTML table saved as `.xls` with `application/vnd.ms-excel` MIME
 *            type. Avoids pulling in a heavy xlsx library; Excel/Sheets open
 *            the HTML table natively. The `mso-number-format:'\@'` style
 *            forces text mode so leading zeros / phone numbers stay intact.
 *   • pdf  → open a new window with an HTML table and trigger `window.print()`
 *            so the user can save as PDF using the browser's native print
 *            dialog. No pdf-lib dependency required.
 *
 * Caller is responsible for:
 *   1. Building rows (Record<string, unknown>[]) from the page's data, using
 *      the selected column keys.
 *   2. Calling `runCustomExport(columns, format, rows, filenameBase, title)`.
 *   3. Showing a sonner toast on success/failure.
 */
import { downloadCsv, dateStamp } from './csv'
import type { ExportColumn, ExportFormat } from '@/components/itam/custom-export-dialog'

/** Escape a value for safe inclusion in HTML/XML output. */
function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  )
}

/**
 * Run the actual export. Each format produces a download (csv/xlsx) or opens
 * a print window (pdf). The caller passes already-built rows keyed by column
 * `key`; values are coerced to strings at write time.
 *
 * @param columns   Selected export columns (in display order).
 * @param format    Chosen export format.
 * @param rows      Data rows (already mapped to the column keys).
 * @param filenameBase e.g. 'meter-readings' → file becomes `meter-readings-YYYYMMDD.csv`
 * @param reportTitle Title shown at the top of the PDF print window.
 */
export function runCustomExport(
  columns: ExportColumn[],
  format: ExportFormat,
  rows: Record<string, unknown>[],
  filenameBase: string,
  reportTitle: string,
): void {
  const headers = columns.map((c) => ({ key: c.key, label: c.label }))
  const filename = `${filenameBase}-${dateStamp()}`

  if (format === 'csv') {
    // downloadCsv already prepends the UTF-8 BOM (\uFEFF) and handles
    // RFC-4180 quoting for values containing commas, quotes, or newlines.
    downloadCsv(`${filename}.csv`, rows, headers)
    return
  }

  if (format === 'xlsx') {
    // Build an HTML table that Excel/Google Sheets can open. We use the
    // .xls extension + the legacy MS-Excel MIME type because it requires
    // no extra library and is widely compatible. The leading BOM keeps
    // Thai characters intact when opened in Excel on Windows.
    const headHtml = headers
      .map(
        (h) =>
          `<th style="background:#f97316;color:#fff;padding:6px;border:1px solid #ddd;font-weight:600">${escapeHtml(h.label)}</th>`,
      )
      .join('')
    const bodyHtml = rows
      .map((r) => {
        const cells = headers
          .map(
            (h) =>
              `<td style="padding:5px;border:1px solid #e2e8f0;mso-number-format:'\\@'">${escapeHtml((r as Record<string, unknown>)[h.key] ?? '')}</td>`,
          )
          .join('')
        return `<tr>${cells}</tr>`
      })
      .join('')
    const html =
      `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
      `<head><meta charset="utf-8"></head><body>` +
      `<table style="border-collapse:collapse;font-family:'Tahoma',sans-serif;font-size:11px">` +
      `<thead><tr>${headHtml}</tr></thead>` +
      `<tbody>${bodyHtml}</tbody>` +
      `</table></body></html>`
    const blob = new Blob(['\uFEFF' + html], {
      type: 'application/vnd.ms-excel;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}.xls`
    a.click()
    URL.revokeObjectURL(url)
    return
  }

  if (format === 'pdf') {
    // Open a print-friendly window with a styled HTML table and trigger
    // window.print() once loaded. The user picks "Save as PDF" in the
    // browser's native print dialog. Avoids heavy pdf-lib dependency.
    const printWin = window.open('', '_blank', 'width=1024,height=768')
    if (!printWin) {
      throw new Error('โปรดอนุญาต popup เพื่อสร้าง PDF')
    }
    const html =
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(reportTitle)}</title>` +
      `<style>
body { font-family: 'Sarabun', 'Helvetica', sans-serif; margin: 16px; font-size: 11px; }
h1 { font-size: 16px; margin: 0 0 8px; color: #0f172a; }
.meta { color: #666; font-size: 10px; margin-bottom: 12px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; }
th { background: #f97316; color: white; font-weight: 600; font-size: 10px; }
tr:nth-child(even) { background: #fafafa; }
</style></head><body>` +
      `<h1>${escapeHtml(reportTitle)}</h1>` +
      `<div class="meta">ส่งออกเมื่อ ${new Date().toLocaleString('th-TH')} — ${rows.length.toLocaleString('th-TH')} รายการ, ${columns.length} คอลัมน์</div>` +
      `<table>
<thead><tr>${headers.map((h) => `<th>${escapeHtml(h.label)}</th>`).join('')}</tr></thead>
<tbody>
${rows
        .map(
          (r) =>
            `<tr>${headers
              .map((h) => `<td>${escapeHtml((r as Record<string, unknown>)[h.key] ?? '')}</td>`)
              .join('')}</tr>`,
        )
        .join('')}
</tbody>
</table>` +
      `<script>window.onload = () => { window.print(); };</script>` +
      `</body></html>`
    printWin.document.write(html)
    printWin.document.close()
    return
  }

  // Exhaustive check — if a new format is added to ExportFormat, TypeScript
  // will flag this fallthrough as an error.
  const _exhaustive: never = format
  void _exhaustive
}
