#!/usr/bin/env node
/**
 * check-module-gating.ts — CI guard that verifies every API route has
 * moduleUnavailableResponse() called when it should.
 *
 * Per consultant blueprint Phase 4.7, ข้อ 2.3:
 *   "แทนที่จะให้ dev ไล่เพิ่ม moduleUnavailableResponse() ทีละไฟล์ด้วยมือ
 *    แล้วหวังว่าจะไม่ลืม — เพิ่ม automated check ใน CI"
 *
 * This script:
 *   1. Scans all route.ts files under src/app/api/
 *   2. Maps each route to a module based on the path prefix
 *   3. Checks if the file imports and calls moduleUnavailableResponse
 *   4. Reports any routes that are MISSING the guard
 *
 * Exit code: 0 = pass, 1 = fail (missing guards found)
 *
 * Usage:
 *   node scripts/check-module-gating.ts
 *   # or add to package.json: "check:module-gating": "node scripts/check-module-gating.mjs"
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

// ── Module → API prefix mapping (from blueprint ข้อ 2.2) ─────────────
const MODULE_PREFIX_MAP = {
  devices: [
    'devices/', 'itam/devices/', 'devices/depreciation', 'devices/warranty',
    'devices/utilization', 'asset-verification/', 'devices/accessories',
    'devices/import', 'devices/resolve', 'devices/next-asset-code',
    'devices/next-site-code', 'licenses/',
  ],
  meters: [
    'itam/meter-readings/', 'meter/', 'v1/meter-readings', 'cycles/',
    'v1/cycles', 'itam/meter-readings/force-close', 'itam/meter-readings/unread',
  ],
  'work-orders': [
    'work-orders/', 'v1/work-orders/', 'public/work-orders/',
    'public/repairs', 'work-orders/batch-status',
  ],
  stock: [
    'stock-items/', 'itam/stock/', 'stock-count/', 'purchase-orders/',
    'stock-items/pending/',
  ],
  pm: ['pm/'],
  reports: ['reports/', 'cost-analytics/'],
  'paper-analytics': ['itam/paper-analytics'],
  import: ['import/', 'devices/import', 'devices/accessories/import',
           'licenses/import', 'itam/devices/import'],
  templates: ['templates/', 'itam/document-templates/'],
  stickers: ['itam/sticker/'],
  notifications: ['notifications/', 'itam/notifications/',
                  'cron/notification-retry', 'line/'],
  sync: ['sync/', 'cron/sync-legacy', 'master/sync', 'site-attributes/sync'],
}

// ── Helper: recursively find all route.ts files ─────────────────────
function findRouteFiles(dir, base = '') {
  const results = []
  const entries = readdirSync(dir)

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const relPath = base ? `${base}/${entry}` : entry

    if (statSync(fullPath).isDirectory()) {
      results.push(...findRouteFiles(fullPath, relPath))
    } else if (entry === 'route.ts') {
      results.push({ fullPath, relPath })
    }
  }
  return results
}

// ── Helper: map a route path to a module ─────────────────────────────
function routeToModule(relPath) {
  const apiPath = relPath.replace(/^api\//, '')
  for (const [module, prefixes] of Object.entries(MODULE_PREFIX_MAP)) {
    for (const prefix of prefixes) {
      if (apiPath.startsWith(prefix)) {
        return module
      }
    }
  }
  return null // no module mapping needed (e.g. auth, health)
}

// ── Main ────────────────────────────────────────────────────────────
const API_DIR = join(process.cwd(), 'src', 'app', 'api')
const routes = findRouteFiles(API_DIR)

let total = 0
let guarded = 0
let missing = []
let unmapped = []

for (const { fullPath, relPath } of routes) {
  const content = readFileSync(fullPath, 'utf-8')
  const mod = routeToModule(relPath)

  if (!mod) {
    // Routes not in the mapping (auth, health, dashboard, settings, etc.)
    // — don't need module gating
    unmapped.push(relPath)
    continue
  }

  total++

  // Check if file imports and calls moduleUnavailableResponse
  const hasImport = content.includes('moduleUnavailableResponse')
  const hasCall = content.includes('await moduleUnavailableResponse(') ||
                  content.includes('moduleUnavailableResponse(')

  if (hasImport && hasCall) {
    guarded++
  } else {
    missing.push({ relPath, module: mod, hasImport, hasCall })
  }
}

// ── Report ──────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════')
console.log('  Module Gating Check (Phase 4.7 ข้อ 2.3)')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  Total mapped routes: ${total}`)
console.log(`  Guarded:            ${guarded}`)
console.log(`  Missing guard:      ${missing.length}`)
console.log(`  Unmapped (no gate needed): ${unmapped.length}`)
console.log('')

if (missing.length > 0) {
  console.log('❌ MISSING moduleUnavailableResponse() in these routes:')
  console.log('───────────────────────────────────────────────────────────')
  for (const { relPath, module, hasImport, hasCall } of missing) {
    const issues = []
    if (!hasImport) issues.push('no import')
    if (!hasCall) issues.push('no call')
    console.log(`  [${module}] src/app/api/${relPath} — ${issues.join(', ')}`)
  }
  console.log('')
  console.log('Fix: add `import { moduleUnavailableResponse } from \'@/lib/module-gate\'`')
  console.log('     then call `const unavailable = await moduleUnavailableResponse(\'' + (missing[0]?.module || 'module') + '\')`')
  console.log('     at the top of each handler function.')
  console.log('')
  process.exit(1)
} else {
  console.log('✅ All mapped routes have module gating in place.')
  process.exit(0)
}
