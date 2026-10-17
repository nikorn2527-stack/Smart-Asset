/**
 * Client-side CSV export helper.
 * Emits a UTF-8 BOM (\uFEFF) so Excel correctly renders Thai text.
 * Values containing commas, quotes, or newlines are RFC-4180 escaped.
 */
export function downloadCsv(
  filename: string,
  rows: Record<string, unknown>[],
  headers?: { key: string; label: string }[],
): void {
  const cols =
    headers ??
    (rows.length > 0
      ? Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
      : [])

  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const headerLine = cols.map((c) => escape(c.label)).join(',')
  const lines = rows.map((r) =>
    cols
      .map((c) => escape((r as Record<string, unknown>)[c.key]))
      .join(','),
  )
  const csv = '\uFEFF' + [headerLine, ...lines].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Builds a YYYYMMDD stamp from the current date — useful for filenames. */
export function dateStamp(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

/**
 * Parses CSV text into a 2D array of strings. Handles RFC-4180 quoted fields
 * (commas inside quotes, escaped double-quotes ""→", and newlines inside
 * quotes). A trailing newline does not produce an extra empty row.
 */
export function parseCsv(text: string): string[][] {
  // Strip BOM if present
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]

    if (inQuotes) {
      if (c === '"') {
        // Escaped quote?
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') {
      inQuotes = true
      continue
    }
    if (c === ',') {
      cur.push(field)
      field = ''
      continue
    }
    if (c === '\r') {
      // Treat \r\n and lone \r as a row break; ignore the \r itself
      if (src[i + 1] === '\n') i++
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
      continue
    }
    if (c === '\n') {
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
      continue
    }
    field += c
  }

  // Push trailing field/row (if any content remains)
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    rows.push(cur)
  }

  // Drop trailing empty row that often comes from a final newline
  if (
    rows.length > 0 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ''
  ) {
    rows.pop()
  }

  return rows
}
