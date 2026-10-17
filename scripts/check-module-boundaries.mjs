#!/usr/bin/env node
/**
 * Boundary Enforcement Checker — Milestone 3
 *
 * Enforces architectural rules from MODULE-ARCHITECTURE-GUIDE.md:
 *   1. Route files (src/app/api/**) MUST NOT import @/lib/db directly
 *      — they should go through module services/repositories
 *   2. UI components (src/components/**) MUST NOT import module repositories
 *      — they should only use module barrels (index.ts)
 *   3. Cross-module imports MUST go through barrel exports (index.ts),
 *      not deep into module internals
 *
 * Usage:
 *   node scripts/check-module-boundaries.mjs          # check all
 *   node scripts/check-module-boundaries.mjs --staged   # check staged only
 *
 * Exit code 0 = clean, 1 = violations found
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execSync } from 'node:child_process'

const EXTS = new Set(['.ts', '.tsx'])
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build'])

// Rules
const VIOLATIONS = {
  // Rule 1: Route files must not import @/lib/db
  routeDbImport: {
    pattern: /from\s+['"]@\/lib\/db['"]/,
    appliesTo: (f) => f.startsWith('src/app/api/'),
    message: 'Route files must not import @/lib/db — use module services/repositories instead',
  },
  // Rule 2: UI must not import module internals (repository, not barrel)
  uiDeepImport: {
    pattern: /from\s+['"]@\/modules\/[^'"]*\/(repository|service|contracts)['"]/,
    appliesTo: (f) => f.startsWith('src/components/'),
    message: 'UI components must import from module barrel (@/modules/X), not deep internals',
  },
  // Rule 3: No direct @/lib/db in module barrels (should be in repository only)
  barrelDbImport: {
    pattern: /from\s+['"]@\/lib\/db['"]/,
    appliesTo: (f) => f.includes('/modules/') && f.endsWith('index.ts'),
    message: 'Module barrels must not import @/lib/db — use repository files',
  },
}

function walkDir(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkDir(full, files)
    } else if (st.isFile() && EXTS.has(full.slice(-4))) {
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
    return null
  }
}

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const violations = []

  for (const [ruleName, rule] of Object.entries(VIOLATIONS)) {
    if (!rule.appliesTo(filePath)) continue
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        // Skip comments
        if (lines[i].trim().startsWith('//')) continue
        violations.push({
          rule: ruleName,
          line: i + 1,
          content: lines[i].trim(),
          message: rule.message,
        })
      }
    }
  }
  return violations
}

// Main
const argv = process.argv.slice(2)
const stagedOnly = argv.includes('--staged')

let filesToCheck
if (stagedOnly) {
  const staged = getStagedFiles()
  filesToCheck = staged ? staged.filter((f) => EXTS.has(f.slice(-4))) : []
} else {
  filesToCheck = walkDir('src')
}

if (filesToCheck.length === 0) {
  console.log('ℹ️  No files to check.')
  process.exit(0)
}

let totalViolations = 0
const fileViolations = new Map()

for (const file of filesToCheck) {
  try {
    const violations = checkFile(file)
    if (violations.length > 0) {
      fileViolations.set(file, violations)
      totalViolations += violations.length
    }
  } catch {
    // File might not exist or be unreadable — skip
  }
}

if (totalViolations === 0) {
  console.log('✅ No boundary violations found.')
  process.exit(0)
}

console.error(`\n❌ Found ${totalViolations} boundary violation(s):\n`)
for (const [file, violations] of fileViolations) {
  console.error(`📄 ${file}`)
  for (const v of violations) {
    console.error(`   L${v.line} [${v.rule}]: ${v.message}`)
    console.error(`        ${v.content}`)
  }
  console.error('')
}
process.exit(1)
