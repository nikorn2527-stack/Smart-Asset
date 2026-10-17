#!/usr/bin/env node
/**
 * check-i18n.ts — CI script to verify translation coverage.
 *
 * I18N-CI: catches missing keys before they ship.
 *
 * Checks:
 *   1. Every GLOSSARY entry has both `th` and `en` (no half-translated keys)
 *   2. Every `t('key')` call in components resolves to a GLOSSARY entry
 *      (catches typos + missing keys)
 *   3. No `.toLocaleString('th-TH')` or `.toLocaleDateString('th-TH')`
 *      outside the central formatter (forces use of useFormatNumber etc.)
 *   4. With --strict-literals: warns about hard-coded Thai text outside t()
 *      (both JSX text and string literals like label:/placeholder=) —
 *      numbers the Phase C translation backlog. Warn-only, never fails CI.
 *
 * Usage:
 *   bun run scripts/check-i18n.ts                          # basic check
 *   bun run scripts/check:i18n -- --json report.json        # JSON output
 *   bun run scripts/check:i18n -- --strict-literals         # strict mode
 *   bun run scripts/check:i18n -- --strict-literals --json report.json
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = found issues (fails CI)
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { GLOSSARY } = require('../src/lib/i18n') as { GLOSSARY: Record<string, { th: string; en?: string }> }

// ── CLI argument parsing ──────────────────────────────────────────────────
const args = process.argv.slice(2)
const jsonOutput = args.includes('--json')
const strictLiterals = args.includes('--strict-literals')
const jsonFile = args[args.indexOf('--json') + 1] || 'i18n-report.json'

interface ReportEntry {
  check: string
  severity: 'error' | 'warning'
  file?: string
  key?: string
  message: string
}

const reportEntries: ReportEntry[] = []
let problems = 0

// ── Check 1: every entry has both th and en ──────────────────────────────
console.log('Check 1: every GLOSSARY entry has both th and en...')
let halfTranslated = 0
for (const [key, entry] of Object.entries(GLOSSARY)) {
  if (!entry.th) {
    console.error(`  ✗ "${key}" missing th translation`)
    halfTranslated++
    problems++
  }
  if (!entry.en) {
    console.warn(`  ⚠ "${key}" missing en translation (falls back to th)`)
    halfTranslated++
    problems++
  }
}
if (halfTranslated === 0) {
  console.log(`  ✓ all ${Object.keys(GLOSSARY).length} keys have both th and en`)
} else {
  console.log(`  ✗ ${halfTranslated} keys are missing one language`)
}

// ── Check 2: every t('key') call resolves ─────────────────────────────────
console.log('\nCheck 2: every t() call resolves to a GLOSSARY key...')

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'tools') continue
      walk(full, files)
    } else if (extname(entry) === '.tsx' || extname(entry) === '.ts') {
      files.push(full)
    }
  }
  return files
}

const T_CALL_RE = /\bt\(\s*['"]([^'"]+)['"]/g
const knownKeys = new Set(Object.keys(GLOSSARY))
const missingKeys = new Set<string>()

const allFiles = walk('src')
for (const file of allFiles) {
  const text = readFileSync(file, 'utf8')
  // Strip block comments and line comments so doc-comment examples like
  // `t('your.key.here')` in JSDoc are not counted as real t() calls.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments /* ... */
    .replace(/\/\/[^\n]*/g, '')          // line comments //
  let match: RegExpExecArray | null
  while ((match = T_CALL_RE.exec(stripped)) !== null) {
    const key = match[1]
    if (!knownKeys.has(key)) {
      missingKeys.add(key)
    }
  }
}

if (missingKeys.size === 0) {
  console.log(`  ✓ all t() calls resolve to known keys`)
} else {
  console.error(`  ✗ ${missingKeys.size} keys used in t() but not in GLOSSARY:`)
  for (const key of [...missingKeys].sort()) {
    console.error(`    - "${key}"`)
  }
  problems += missingKeys.size
}

// ── Check 3: no direct toLocaleString('th-TH') outside formatters ─────────
console.log('\nCheck 3: no direct locale calls outside central formatters...')
const LOCALE_RE = /\.toLocale(String|DateString)\(\s*['"]th-TH['"]/g
const allowedFiles = new Set(['src/store/i18n-store.ts', 'src/lib/i18n.ts'])
let directLocaleCount = 0
const directLocaleFiles: Record<string, number> = {}

for (const file of allFiles) {
  if (allowedFiles.has(file.replace(/\\/g, '/'))) continue
  const text = readFileSync(file, 'utf8')
  const matches = text.match(LOCALE_RE)
  if (matches) {
    directLocaleCount += matches.length
    directLocaleFiles[file] = matches.length
  }
}

if (directLocaleCount === 0) {
  console.log(`  ✓ no direct locale calls outside central formatters`)
} else {
  console.warn(`  ⚠ ${directLocaleCount} direct locale calls found (should use useFormatNumber/useFormatDate):`)
  for (const [file, count] of Object.entries(directLocaleFiles)) {
    console.warn(`    - ${file}: ${count} call(s)`)
  }
  // Warn only — don't fail CI until migration is complete
}

// ── Check 4 (strict-literals mode): hard-coded Thai text outside t() ─────────
// Counts JSX text nodes AND UI-prop/string literals (label:, title:,
// placeholder="…"). Warn-only — never increments `problems`, so wiring
// --strict-literals into package.json cannot fail CI on its own.
//
// Scope: only the surfaces the language toggle must flip (src/components +
// src/app). Raw Thai also exists legitimately elsewhere — the GLOSSARY itself
// (th: values in src/lib/i18n.ts, which has to contain Thai by definition),
// Thai-only server content (default-templates.ts, DB seed fixtures, CSV import
// samples) and API-route error strings — counting those would bury the
// actionable Phase C files under thousands of accepted lines.
const strictScanRoots = ['src/components', 'src/app']

if (strictLiterals) {
  console.log('\nCheck 4: hard-coded Thai text outside t() (strict mode)...')
  const THAI_RE = /[\u0E00-\u0E7F]/
  let thaiLiteralCount = 0
  let uiPropCount = 0
  const thaiLiteralFiles: Record<string, number> = {}
  
  for (const file of allFiles) {
    if (allowedFiles.has(file.replace(/\\/g, '/'))) continue
    const normalized = file.replace(/\\/g, '/')
    if (!strictScanRoots.some((root) => normalized === root || normalized.startsWith(root + '/'))) continue
    const text2 = readFileSync(file, 'utf8')
    // Strip comments
    const stripped2 = text2
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    // (JSX-text regex helper removed: an earlier draft called a misnamed helper
    // here and crashed this check with ReferenceError. The per-line scan below
    // is authoritative.)
    const lines = stripped2.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // Count every Thai line that bypasses t() — not only JSX text nodes.
      // UI-prop literals (label:, title:, placeholder="…", option text) have
      // no >…< around them and are the bulk of the Phase C backlog.
      if (!THAI_RE.test(lines[i])) continue
      // t('key') / translate( calls belong to Check 2 and resolve there.
      if (lines[i].includes('t(') || lines[i].includes('translate(')) continue
      // Comments were stripped above; skip imports defensively.
      const trimmedLine = lines[i].trim()
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('import ')) continue
      thaiLiteralCount++
      if (!(lines[i].includes('>') && lines[i].includes('<'))) uiPropCount++
      if (!thaiLiteralFiles[file]) thaiLiteralFiles[file] = 0
      thaiLiteralFiles[file]++
    }
  }
  
  if (thaiLiteralCount === 0) {
    console.log(`  ✓ no hard-coded Thai text outside t()`)
  } else {
    console.warn(`  ⚠ ${thaiLiteralCount} lines with hard-coded Thai text outside t() (${thaiLiteralCount - uiPropCount} JSX text, ${uiPropCount} string literals such as label:/placeholder=):`)
    for (const [file, count] of Object.entries(thaiLiteralFiles).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.warn(`    - ${file}: ${count} line(s)`)
      reportEntries.push({ check: 'strict-literals', severity: 'warning', file, message: `${count} hard-coded Thai text line(s)` })
    }
    const restFiles = Object.keys(thaiLiteralFiles).length - 25
    if (restFiles > 0) console.warn(`    … and ${restFiles} more file(s) — run with --json for the full list`)
    // Warn only — don't fail CI until the Phase C translation backlog is gone
  }
}

// ── Write JSON report if requested ────────────────────────────────────────
if (jsonOutput) {
  const report = {
    timestamp: new Date().toISOString(),
    glossaryKeys: Object.keys(GLOSSARY).length,
    filesScanned: allFiles.length,
    errors: problems,
    warnings: reportEntries.filter(e => e.severity === 'warning').length,
    entries: reportEntries,
  }
  writeFileSync(jsonFile, JSON.stringify(report, null, 2))
  console.log(`\n📄 JSON report written to: ${jsonFile}`)
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60))
if (problems === 0) {
  console.log('✓ i18n check passed — all keys present and translated')
  process.exit(0)
} else {
  console.error(`✗ i18n check failed — ${problems} issue(s) found`)
  process.exit(1)
}
