/**
 * custom-report-export.ts — server-side CSV + PDF export for custom reports.
 *
 * CSV is built in-memory (Buffer) with a UTF-8 BOM so Excel/Sheets render
 * Thai characters correctly.
 *
 * PDF is generated via the `pdf` skill's Report production line (ReportLab).
 * We invoke ReportLab directly through a Python subprocess — the skill's
 * Triage rules say reports with structured tables go through ReportLab,
 * not Playwright. This file stays free of any node-specific PDF libs so
 * it works in a serverless / Node runtime.
 *
 * Task ID: PHASE-A3-REPORTS
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ReportRunResult } from './custom-report-runner'

// ── CSV ─────────────────────────────────────────────────────────────

export function buildCsvBytes(result: ReportRunResult): Buffer {
  const { rows, columns } = result
  const headerCells = columns.map((c) => escapeCsvCell(c.label))
  const bodyCells = rows.map((row) =>
    columns
      .map((col) => escapeCsvCell(stringifyCell(row[col.key])))
      .join(','),
  )
  const csv = [headerCells.join(','), ...bodyCells].join('\r\n')
  // Prepend UTF-8 BOM so Excel/Sheets interpret the file as UTF-8.
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf-8')])
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    // Prisma Decimal — try .toString().
    try {
      return String(value)
    } catch {
      return JSON.stringify(value)
    }
  }
  return String(value)
}

// ── PDF (via ReportLab Python script) ────────────────────────────────

export interface PdfBuildArgs {
  title: string
  description?: string
  result: ReportRunResult
  generatedBy: string
}

export async function buildReportPdfBytes(args: PdfBuildArgs): Promise<Buffer> {
  const { title, description, result, generatedBy } = args

  // We pass the report payload as JSON to a Python script via stdin.
  // The Python script writes the PDF to a temp file and prints its path.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-report-'))
  const jsonPath = path.join(tmpDir, 'payload.json')
  const pdfPath = path.join(tmpDir, 'report.pdf')

  const payload = {
    title,
    description: description ?? null,
    generatedAt: result.generatedAt,
    generatedBy,
    dataSource: result.dataSource,
    columns: result.columns,
    rows: result.rows.map((row) => {
      // Stringify every cell — ReportLab's Paragraph() handles strings only.
      const out: Record<string, string> = {}
      for (const col of result.columns) {
        const v = row[col.key]
        out[col.key] = stringifyCell(v)
      }
      return out
    }),
    total: result.total,
    truncated: result.truncated,
  }
  fs.writeFileSync(jsonPath, JSON.stringify(payload), 'utf-8')

  const scriptPath = path.join(
    process.cwd(),
    'scripts',
    'custom-report-pdf.py',
  )

  try {
    execFileSync('python3', [scriptPath, jsonPath, pdfPath], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 30_000, // 30s cap — exports should never take >30s
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch (err) {
    // Surface stderr if available — helps debugging in dev.
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr?: unknown }).stderr)
        : ''
    throw new Error(
      `ReportLab PDF build failed${stderr ? `: ${stderr.slice(0, 400)}` : ''}`,
    )
  }

  const pdfBytes = fs.readFileSync(pdfPath)
  // Cleanup temp dir.
  fs.rmSync(tmpDir, { recursive: true, force: true })
  return pdfBytes
}
