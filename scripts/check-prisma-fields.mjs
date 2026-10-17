#!/usr/bin/env node
/**
 * Prisma Field Case-Sensitivity Checker
 *
 * WHY THIS EXISTS:
 *   BUG-KPI-001 (Task 11) — KPI computation checked `d.status === 'ACTIVE'`
 *   but the DB stores mixed-case `'Active'`. The bug caused KPI cards to
 *   show 0 across the board. It slipped through review because there's
 *   no automated check for case mismatches between code and DB values.
 *
 *   This script scans TypeScript/JavaScript source files for known Prisma
 *   model fields and flags:
 *     1. Snake_case usage where the schema uses camelCase
 *        (e.g. `asset_code` → should be `assetCode`)
 *     2. Wrong-casing on enum-like string values that the DB stores in
 *        a specific canonical form (e.g. status 'Active' not 'ACTIVE')
 *
 * USAGE:
 *   - As pre-commit hook: runs on staged files only
 *   - Standalone: `node scripts/check-prisma-fields.mjs`
 *   - Exit code 0 = clean, 1 = issues found
 *
 * HOW TO ADD NEW MODELS/FIELDS:
 *   Edit the `MODELS` map below. Each entry is:
 *     modelName: { fieldName: 'suggestionNote', ... }
 *   The script auto-generates snake_case variants to detect.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { execSync } from 'node:child_process'

// ── Canonical Prisma field names per model (camelCase) ──
// Edit this when schema.prisma changes.
const MODELS = {
  Device: {
    assetCode: 'รหัสทรัพย์สิน — camelCase (NOT asset_code, assetcode, AssetCode)',
    assetSiteCode: 'camelCase (NOT asset_site_code)',
    serialNumber: 'camelCase (NOT serial_number, sn)',
    parentRef: 'camelCase (NOT parent_ref)',
    displayLabel: 'camelCase (NOT display_label)',
    departmentCode: 'camelCase (NOT department_code)',
    purchaseDate: 'camelCase (NOT purchase_date)',
    purchasePrice: 'camelCase (NOT purchase_price)',
    salvageValue: 'camelCase (NOT salvage_value)',
    usefulLife: 'camelCase (NOT useful_life)',
    warrantyMonths: 'camelCase (NOT warranty_months)',
    warrantyEnd: 'camelCase (NOT warranty_end)',
    uninstallDate: 'camelCase (NOT uninstall_date)',
    meterRequired: 'camelCase (NOT meter_required)',
    meterMode: 'camelCase (NOT meter_mode)',
    lastMeterBw: 'camelCase (NOT last_meter_bw, lastMeterReading)',
    lastMeterColor: 'camelCase (NOT last_meter_color)',
    currentAssignee: 'camelCase (NOT current_assignee)',
    costCenter: 'camelCase (NOT cost_center)',
    deviceGroup: 'camelCase (NOT device_group)',
    updatedBy: 'camelCase (NOT updated_by)',
    // Device Set fields (Task 9 Phase 2)
    parentDeviceId: 'camelCase (NOT parent_device_id)',
    setLabel: 'camelCase (NOT set_label)',
    setPosition: 'camelCase (NOT set_position)',
  },
  MeterReading: {
    readingDate: 'camelCase (NOT reading_date)',
    readingMonth: 'camelCase (NOT reading_month)',
    meterBw: 'camelCase (NOT meter_bw)',
    meterColor: 'camelCase (NOT meter_color)',
    pagesBw: 'camelCase (NOT pages_bw)',
    pagesColor: 'camelCase (NOT pages_color)',
    prevMeterBw: 'camelCase (NOT prev_meter_bw)',
    prevMeterColor: 'camelCase (NOT prev_meter_color)',
    readingType: 'camelCase (NOT reading_type)',
    locationAtReading: 'camelCase (NOT location_at_reading)',
    siteAtReading: 'camelCase (NOT site_at_reading)',
    buildingAtReading: 'camelCase (NOT building_at_reading)',
    floorAtReading: 'camelCase (NOT floor_at_reading)',
    departmentAtReading: 'camelCase (NOT department_at_reading)',
    departmentCodeAtReading: 'camelCase (NOT department_code_at_reading)',
  },
  DeviceTransfer: {
    moveDate: 'camelCase (NOT move_date)',
    transferDate: 'camelCase (NOT transfer_date)',
    fromStatus: 'camelCase (NOT from_status)',
    toStatus: 'camelCase (NOT to_status)',
    fromSite: 'camelCase (NOT from_site)',
    fromAssetSiteCode: 'camelCase (NOT from_asset_site_code)',
    fromBuilding: 'camelCase (NOT from_building)',
    fromFloor: 'camelCase (NOT from_floor)',
    fromDepartment: 'camelCase (NOT from_department)',
    fromDepartmentCode: 'camelCase (NOT from_department_code)',
    fromLocation: 'camelCase (NOT from_location)',
    toSite: 'camelCase (NOT to_site)',
    toAssetSiteCode: 'camelCase (NOT to_asset_site_code)',
    toBuilding: 'camelCase (NOT to_building)',
    toFloor: 'camelCase (NOT to_floor)',
    toDepartment: 'camelCase (NOT to_department)',
    toDepartmentCode: 'camelCase (NOT to_department_code)',
    toLocation: 'camelCase (NOT to_location)',
    meterReadingId: 'camelCase (NOT meter_reading_id)',
    movedBy: 'camelCase (NOT moved_by)',
  },
}

// ── Known canonical string values that must match DB exactly (case-sensitive) ──
// Add values that have caused bugs due to case mismatch (like BUG-KPI-001).
const CANONICAL_STRING_VALUES = {
  // Device.status — DB stores mixed-case. Code must use one of these
  // exact strings, OR do case-insensitive comparison.
  'Device.status': [
    'Active', 'In Stock', 'In Repair', 'Pending Repair',
    'Inactive', 'Disposed', 'Returned', 'Retrieved', 'Temporary',
  ],
}

// Build snake_case → camelCase lookup for detection
const SNAKE_TO_CAMEL = new Map()
const CAMEL_FIELDS = new Set()
for (const [modelName, fields] of Object.entries(MODELS)) {
  for (const camel of Object.keys(fields)) {
    CAMEL_FIELDS.add(camel)
    // Convert camelCase → snake_case
    const snake = camel.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
    if (snake !== camel) {
      SNAKE_TO_CAMEL.set(snake, camel)
    }
  }
}

// ── File discovery ──
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'coverage',
  'tests', '__tests__', 'test',
])
const SKIP_FILES = new Set([
  'check-prisma-fields.mjs', // self
  'worklog.md',
])

function walkDir(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkDir(full, files)
    } else if (st.isFile() && EXTS.has(extname(full))) {
      files.push(full)
    }
  }
  return files
}

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf-8',
    })
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return null // not in git or no staged files
  }
}

// ── Detection logic ──
function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const issues = []

  // 1. Detect snake_case usage where camelCase is expected
  //    Matches: obj.asset_code, asset_code:, asset_code], etc.
  //    Does NOT match: inside string literals or comments (best-effort).
  for (const [snake, camel] of SNAKE_TO_CAMEL) {
    // Word-boundary regex; skip matches inside single/double-quote strings
    // and after // or /* comment markers (best-effort single-line check).
    const re = new RegExp(`\\b${snake.replace(/_/g, '_')}\\b`, 'g')
    let m
    while ((m = re.exec(content)) !== null) {
      const lineNum = content.slice(0, m.index).split('\n').length
      const line = content.split('\n')[lineNum - 1] ?? ''
      // Skip if inside a string literal (heuristic: line has odd number of quotes)
      // or after // or /* on the same line
      const beforeMatch = line.slice(0, m.index - content.slice(0, m.index).lastIndexOf('\n') - 1)
      const quoteCount = (beforeMatch.match(/['"`]/g) || []).length
      const isComment = /^\s*(\/\/|\/\*|\*)/.test(line)
      if (quoteCount % 2 === 1 || isComment) continue

      issues.push({
        type: 'snake_case_field',
        line: lineNum,
        col: m.index - content.slice(0, m.index).lastIndexOf('\n') - 1,
        match: m[0],
        suggestion: camel,
        context: line.trim().slice(0, 100),
      })
    }
  }

  // 2. Detect case-mismatched comparisons on canonical string values
  //    e.g. d.status === 'ACTIVE' (uppercase) when DB stores 'Active' (mixed-case)
  for (const [fieldPath, values] of Object.entries(CANONICAL_STRING_VALUES)) {
    const [model, field] = fieldPath.split('.')
    // Match patterns like `xxx.field === 'value'` or `.field === "value"`
    for (const canonical of values) {
      // Find any all-uppercase or all-lowercase variant that doesn't match canonical
      const upper = canonical.toUpperCase()
      const lower = canonical.toLowerCase()
      if (upper === canonical || lower === canonical) continue // skip if canonical is already single-case

      for (const variant of [upper, lower]) {
        // Match: .field === 'variant' or .field == "variant"
        const re = new RegExp(
          `\\.${field}\\s*(?:===?|!==?)\\s*['"\`]${variant}['"\`]`,
          'gi',
        )
        let m
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split('\n').length
          const line = content.split('\n')[lineNum - 1] ?? ''
          issues.push({
            type: 'case_mismatch_comparison',
            line: lineNum,
            field: fieldPath,
            match: variant,
            suggestion: canonical,
            context: line.trim().slice(0, 120),
            note: `DB stores "${canonical}" (mixed-case). Use case-insensitive comparison or the exact value.`,
          })
        }
      }
    }
  }

  return issues
}

// ── Main ──
const argv = process.argv.slice(2)
const allFlag = argv.includes('--all')
const quietFlag = argv.includes('--quiet')

// Determine which files to check
let filesToCheck
if (allFlag) {
  filesToCheck = walkDir('src').concat(walkDir('scripts'))
} else {
  const staged = getStagedFiles()
  if (staged === null) {
    // Not in git or no staged files — check everything
    filesToCheck = walkDir('src').concat(walkDir('scripts'))
  } else {
    filesToCheck = staged.filter((f) => EXTS.has(extname(f)) && !SKIP_FILES.has(f.split('/').pop()))
  }
}

if (filesToCheck.length === 0 && !quietFlag) {
  console.log('ℹ️  No staged .ts/.tsx files to check.')
  process.exit(0)
}

let totalIssues = 0
const fileIssues = new Map()
for (const file of filesToCheck) {
  try {
    const issues = checkFile(file)
    if (issues.length > 0) {
      fileIssues.set(file, issues)
      totalIssues += issues.length
    }
  } catch (e) {
    if (!quietFlag) console.error(`Error reading ${file}: ${e.message}`)
  }
}

if (totalIssues === 0) {
  if (!quietFlag) console.log('✅ No Prisma field case-sensitivity issues found.')
  process.exit(0)
}

console.error(`\n❌ Found ${totalIssues} Prisma field case-sensitivity issue(s):\n`)
for (const [file, issues] of fileIssues) {
  console.error(`📄 ${file}`)
  for (const issue of issues) {
    if (issue.type === 'snake_case_field') {
      console.error(
        `   L${issue.line}: use camelCase "${issue.suggestion}" instead of "${issue.match}"`,
      )
    } else if (issue.type === 'case_mismatch_comparison') {
      console.error(
        `   L${issue.line}: ${issue.field} compared as "${issue.match}" — DB stores "${issue.suggestion}"`,
      )
      if (issue.note) console.error(`        ${issue.note}`)
    }
    console.error(`        ${issue.context}`)
  }
  console.error('')
}
console.error(
  `💡 Tip: Use case-insensitive comparison (e.g. status.toLowerCase() === 'active')\n` +
  `   or the exact canonical value from the DB. See scripts/check-prisma-fields.mjs\n` +
  `   for the full list of canonical field names.\n`,
)
process.exit(1)
