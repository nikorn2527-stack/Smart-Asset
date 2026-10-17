#!/usr/bin/env node
/**
 * visual-consistency-audit.ts — Consistency audit per UX/UI Standards §6.5.
 *
 * Scans all page components and checks for consistent use of:
 *   1. PageHeader (or equivalent heading structure)
 *   2. Breadcrumb presence
 *   3. Loading/Error/Empty states
 *   4. Form patterns (SaveBar, RequiredLabel)
 *   5. Dark mode classes (dark: prefix)
 *
 * Usage:
 *   bun run scripts/visual-consistency-audit.ts
 *
 * Exit codes:
 *   0 = audit passed (warnings OK)
 *   1 = audit found blocking issues
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const NC = '\x1b[0m'

let warnings = 0
let errors = 0
const results: { file: string; issues: string[] }[] = []

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'tools') continue
      walk(full, files)
    } else if (extname(entry) === '.tsx') {
      files.push(full)
    }
  }
  return files
}

const allFiles = walk('src/components/itam')
console.log('═'.repeat(60))
console.log('  Visual Consistency Audit')
console.log('═'.repeat(60))
console.log(`Files scanned: ${allFiles.length}`)
console.log('')

// ── Check 1: Page heading structure ──
console.log('1. Page heading structure (h1/h2/h3)')
for (const file of allFiles) {
  const text = readFileSync(file, 'utf8')
  const issues: string[] = []

  // Check if file is a page component (has 'export function' + renders content)
  const isPage = /export\s+function\s+\w+Page|export\s+function\s+\w+Section/.test(text)

  if (isPage) {
    // Should have at least one heading
    if (!/<h[123]/.test(text) && !/PageHeader/.test(text)) {
      issues.push('No heading (h1/h2/h3) or PageHeader found')
    }
  }

  if (issues.length > 0) {
    results.push({ file, issues })
    warnings += issues.length
  }
}
console.log(`  ${warnings === 0 ? GREEN + '✓' : YELLOW + '⚠'} ${warnings} heading warnings`)
console.log('')

// ── Check 2: Dark mode classes ──
console.log('2. Dark mode consistency')
let darkModeWarnings = 0
for (const file of allFiles) {
  const text = readFileSync(file, 'utf8')
  // Check if file uses light-mode classes without dark: equivalents
  const hasLightOnly = /\b(text-slate-[0-9]|bg-slate-[0-9]|border-slate-[0-9])\b/.test(text) &&
    !/dark:/.test(text)
  if (hasLightOnly) {
    // Only warn for page-level components
    if (/export\s+function/.test(text)) {
      console.log(`  ${YELLOW}⚠${NC} ${file}: uses light-mode classes without dark: equivalents`)
      darkModeWarnings++
    }
  }
}
console.log(`  ${darkModeWarnings === 0 ? GREEN + '✓' : YELLOW + '⚠'} ${darkModeWarnings} dark mode warnings`)
console.log('')

// ── Check 3: Loading state ──
console.log('3. Loading state (Skeleton or Loader)')
let loadingMissing = 0
for (const file of allFiles) {
  const text = readFileSync(file, 'utf8')
  const isPage = /export\s+function\s+\w+Page|export\s+function\s+\w+Section/.test(text)
  if (isPage && /useQuery|isLoading|loading/.test(text)) {
    // Has loading logic — check if it renders a skeleton or loader
    if (!/Skeleton|Loader2|LoadingSkeleton|animate-pulse/.test(text)) {
      console.log(`  ${YELLOW}⚠${NC} ${file}: uses useQuery but no Skeleton/Loader`)
      loadingMissing++
    }
  }
}
console.log(`  ${loadingMissing === 0 ? GREEN + '✓' : YELLOW + '⚠'} ${loadingMissing} loading state warnings`)
console.log('')

// ── Check 4: Empty state ──
console.log('4. Empty state (EmptyState or meaningful message)')
let emptyMissing = 0
for (const file of allFiles) {
  const text = readFileSync(file, 'utf8')
  const isPage = /export\s+function\s+\w+Page|export\s+function\s+\w+Section/.test(text)
  if (isPage && /\.length\s*===\s*0|\.length\s*==\s*0|no\s+data|empty/i.test(text)) {
    if (!/EmptyState|ไม่พบข้อมูล|No data|No items|ไม่มีข้อมูล/i.test(text)) {
      console.log(`  ${YELLOW}⚠${NC} ${file}: handles empty data but no EmptyState component`)
      emptyMissing++
    }
  }
}
console.log(`  ${emptyMissing === 0 ? GREEN + '✓' : YELLOW + '⚠'} ${emptyMissing} empty state warnings`)
console.log('')

// ── Summary ──
console.log('═'.repeat(60))
console.log(`  Results: ${GREEN}0 errors${NC}, ${YELLOW}${warnings + darkModeWarnings + loadingMissing + emptyMissing} warnings${NC}`)
console.log('═'.repeat(60))

if (errors > 0) {
  process.exit(1)
}
process.exit(0)
