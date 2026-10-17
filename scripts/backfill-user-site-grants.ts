/**
 * backfill-user-site-grants.ts — Convert legacy allowedSites to UserSiteGrant.
 *
 * Task ID: PHASE1-AUTH-FOUNDATION
 *
 * For each non-superadmin user with `allowedSites` set (comma-separated
 * or 'ALL'), create UserSiteGrant rows for each Site code. Superadmin
 * users are skipped (they have global access via policy).
 *
 * This script is idempotent — it only creates grants that don't already
 * exist. Existing grants are not modified or deleted.
 *
 * Run with: bun scripts/backfill-user-site-grants.ts
 *
 * Output: a report of users processed, grants created, and unmapped codes.
 */

import { db } from '../src/lib/db'
import { normalizeSiteCode, parseAllowedSites } from '../src/lib/site-scope'

interface BackfillResult {
  userId: string
  email: string
  username: string | null
  globalRole: string
  allowedSites: string | null
  grantsCreated: number
  grantsExisting: number
  unmappedCodes: string[]
  skipped: string | null // reason if skipped
}

async function main() {
  console.log('Backfilling UserSiteGrant from allowedSites...')
  console.log('')

  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      allowedSites: true,
      active: true,
    },
  })

  const results: BackfillResult[] = []
  let totalCreated = 0
  let totalExisting = 0
  const allUnmapped = new Set<string>()

  for (const u of users) {
    const result: BackfillResult = {
      userId: u.id,
      email: u.email,
      username: u.username,
      globalRole: u.role,
      allowedSites: u.allowedSites,
      grantsCreated: 0,
      grantsExisting: 0,
      unmappedCodes: [],
      skipped: null,
    }

    // Skip superadmin — they have global access via policy
    if (u.role.toLowerCase() === 'superadmin') {
      result.skipped = 'superadmin (global access via policy)'
      results.push(result)
      continue
    }

    // Skip users with no allowedSites
    if (!u.allowedSites || u.allowedSites.trim() === '') {
      result.skipped = 'no allowedSites set'
      results.push(result)
      continue
    }

    const parsed = parseAllowedSites(u.allowedSites)

    // Skip ALL — superadmin-only in the new model
    if (parsed.isAll) {
      result.skipped = `allowedSites='ALL' (should be converted to explicit grants or superadmin role)`
      results.push(result)
      continue
    }

    if (parsed.codes.length === 0) {
      result.skipped = 'allowedSites parsed to empty list'
      results.push(result)
      continue
    }

    // For each site code, create a grant if it doesn't exist
    for (const siteCode of parsed.codes) {
      // Check if grant already exists
      const existing = await db.userSiteGrant.findUnique({
        where: {
          userId_siteCode: { userId: u.id, siteCode },
        },
      })
      if (existing) {
        result.grantsExisting++
        totalExisting++
        continue
      }

      // Validate that the site code exists in the Site master
      const siteExists = await db.site.findUnique({
        where: { code: siteCode },
        select: { code: true },
      })
      if (!siteExists) {
        result.unmappedCodes.push(siteCode)
        allUnmapped.add(siteCode)
        continue
      }

      // Create the grant with the user's global role
      await db.userSiteGrant.create({
        data: {
          userId: u.id,
          siteCode,
          roleCode: u.role,
          active: u.active,
          createdBy: 'backfill-script',
        },
      })
      result.grantsCreated++
      totalCreated++
    }

    results.push(result)
  }

  // ── Print report ──
  console.log('=== Backfill Report ===')
  console.log(`Total users:          ${users.length}`)
  console.log(`Grants created:       ${totalCreated}`)
  console.log(`Grants already exist: ${totalExisting}`)
  console.log(`Unmapped site codes:  ${allUnmapped.size > 0 ? Array.from(allUnmapped).join(', ') : '(none)'}`)
  console.log('')

  console.log('=== Per-user detail ===')
  for (const r of results) {
    const name = r.username ?? r.email
    if (r.skipped) {
      console.log(`  [SKIP] ${name} (${r.globalRole}) — ${r.skipped}`)
    } else if (r.grantsCreated > 0 || r.grantsExisting > 0) {
      console.log(
        `  [OK]   ${name} (${r.globalRole}) — created: ${r.grantsCreated}, existing: ${r.grantsExisting}` +
          (r.unmappedCodes.length > 0 ? `, unmapped: ${r.unmappedCodes.join(',')}` : ''),
      )
    }
  }
  console.log('')

  // Final count
  const totalGrants = await db.userSiteGrant.count()
  console.log(`Total UserSiteGrant rows in DB: ${totalGrants}`)
  console.log('')
  console.log('Done. The auth layer can now read from UserSiteGrant.')
  console.log('Users without grants will still fall back to allowedSites (dual-read).')
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
