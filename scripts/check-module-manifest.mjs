#!/usr/bin/env node
// check-module-manifest.mjs — validates module consistency across the codebase.
//
// This script imports MODULE_NAMES and MODULES directly from
// `src/config/modules.ts` (the single source of truth). Bun natively supports
// importing `.ts` files from `.mjs` modules, so no transpile step / regex
// extraction / hardcoded duplicate list is required.
//
// Why this matters: an earlier version of this file kept its own hardcoded
// list of module names which drifted out of sync with `modules.ts` — it used
// `meter` (singular) while modules.ts had `meters` (plural), listed `mobile`,
// `sites`, `users` that modules.ts doesn't define, and was missing
// `authorization`, `stickers`, `sync`, `pm` that modules.ts does define.
//
// After that initial fix (commit ede72e1), the script read MODULE_NAMES via a
// regex against the source file — but regex parsing broke on the inline
// `// Phase 4.4: PM (Preventive Maintenance) — was missing` comment after the
// `'pm'` entry, producing a false-positive error.
//
// Now: the script uses a real `import` statement, so any drift in modules.ts
// (added/removed/renamed module, missing definition, cycle in dependency
// graph) is detected automatically — including at module-load time via the
// `assertValidModuleConfiguration()` call at the end of modules.ts.

import { readFileSync } from 'node:fs'
import { MODULE_NAMES, MODULES } from '../src/config/modules.ts'

const sidebarPath = 'src/components/itam/sidebar.tsx'
const sidebar = readFileSync(sidebarPath, 'utf8')

const errors = []

// ────────────────────────────────────────────────────────────────────────────
// 1. Every entry in MODULE_NAMES must have a corresponding definition in MODULES
//    (and vice versa). With direct import, this is a simple property check.
// ────────────────────────────────────────────────────────────────────────────
console.log(`📋 Validating ${MODULE_NAMES.length} modules from MODULE_NAMES (single source of truth):`)
console.log(`   ${MODULE_NAMES.join(', ')}\n`)

for (const name of MODULE_NAMES) {
  if (!(name in MODULES)) {
    errors.push(`Module '${name}' is in MODULE_NAMES but has no definition in MODULES`)
  }
}

const definitionNames = Object.keys(MODULES)
for (const name of definitionNames) {
  if (!MODULE_NAMES.includes(name)) {
    errors.push(`Module '${name}' has a definition in MODULES but is missing from MODULE_NAMES`)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Every dependency referenced by a module definition must itself be a
//    member of MODULE_NAMES. (assertValidModuleConfiguration() — called at
//    the bottom of modules.ts on import — already enforces this and cycles,
//    but we surface the specific problem here for a friendlier error message
//    if the import somehow didn't throw.)
// ────────────────────────────────────────────────────────────────────────────
for (const name of MODULE_NAMES) {
  const definition = MODULES[name]
  if (!definition) continue
  for (const dep of definition.dependencies) {
    if (!MODULE_NAMES.includes(dep)) {
      errors.push(`Module '${name}' depends on '${dep}' which is not in MODULE_NAMES`)
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Sidebar `module: '<name>'` references must all resolve to a member of
//    MODULE_NAMES. We extract these dynamically from sidebar.tsx so this check
//    never drifts if a new nav item is added.
// ────────────────────────────────────────────────────────────────────────────
const sidebarModuleRefs = [
  ...sidebar.matchAll(/module:\s*['"]([^'"]+)['"]/g),
].map((m) => m[1])
const uniqueSidebarModuleRefs = [...new Set(sidebarModuleRefs)]

console.log(`🧭 Sidebar references ${uniqueSidebarModuleRefs.length} unique modules:`)
console.log(`   ${uniqueSidebarModuleRefs.join(', ')}\n`)

for (const ref of uniqueSidebarModuleRefs) {
  if (!MODULE_NAMES.includes(ref)) {
    errors.push(
      `Sidebar item uses module '${ref}' which is not declared in MODULE_NAMES ` +
        `(either add it to src/config/modules.ts or fix the sidebar reference)`,
    )
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Report
// ────────────────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error(`\n❌ Found ${errors.length} error(s):`)
  for (const e of errors) console.error(`   - ${e}`)
  process.exit(1)
}

console.log('✅ Module manifest is consistent (MODULE_NAMES = single source of truth)')
