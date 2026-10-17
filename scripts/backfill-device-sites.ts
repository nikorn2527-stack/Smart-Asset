/**
 * backfill-device-sites.ts — Normalize device.site to SiteName (matches SiteAttribute).
 *
 * Bug DATA-04: Phantom sites (HQ/BKK) showed up in reports because device.site
 * had short codes or invalid values. This script:
 *   1. Maps "UDH" → "โรงพยาบาลศูนย์อุดรธานี"
 *   2. Maps "NKP" → "โรงพยาบาลนครพนม"
 *   3. Maps "MECUD" → "ศูนย์แพทย์โรงพยาบาลศูนย์อุดรธานี"
 *   4. Maps "HQ"/"BKK"/unknown → "PPIT" (default for demo/test)
 *
 * Safe to re-run — only updates devices where site doesn't match any SiteName.
 *
 * Usage:
 *   DATABASE_URL=... bun run scripts/backfill-device-sites.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('🔧 Backfilling device.site to match SiteAttribute.SiteName...\n')

  // Load all valid SiteName values
  const siteAttrs = await db.siteAttribute.findMany({
    select: { SiteCode: true, SiteName: true },
  })
  const validSiteNames = new Set(siteAttrs.map((s) => s.SiteName).filter(Boolean))
  console.log(`Valid SiteNames (${validSiteNames.size}):`)
  validSiteNames.forEach((n) => console.log(`  - ${n}`))

  // SiteCode → SiteName mapping
  const codeToName = new Map<string, string>()
  for (const s of siteAttrs) {
    if (s.SiteCode && s.SiteName) codeToName.set(s.SiteCode, s.SiteName)
  }

  // Short-code / alias → SiteName mapping (for legacy data)
  const aliasToName = new Map<string, string>([
    ['UDH', 'โรงพยาบาลศูนย์อุดรธานี'],
    ['NKP', 'โรงพยาบาลนครพนม'],
    ['MECUD', 'ศูนย์แพทย์โรงพยาบาลศูนย์อุดรธานี'],
  ])

  // Default site for unknown/demo devices (HQ, BKK, etc.)
  const DEFAULT_SITE = 'PPIT'

  // Find all devices with site NOT in valid SiteNames
  const devices = await db.device.findMany({
    where: { site: { notIn: Array.from(validSiteNames) } },
    select: { id: true, assetCode: true, site: true },
  })
  console.log(`\nFound ${devices.length} device(s) with invalid/phantom site.`)

  if (devices.length === 0) {
    console.log('✅ All devices already have valid site — nothing to backfill.')
    return
  }

  // Group by current site value
  const bySite = new Map<string, number>()
  for (const d of devices) {
    bySite.set(d.site ?? 'null', (bySite.get(d.site ?? 'null') ?? 0) + 1)
  }
  console.log('\nBreakdown:')
  for (const [site, count] of bySite.entries()) {
    const mapped = aliasToName.get(site) ?? DEFAULT_SITE
    console.log(`  ${JSON.stringify(site)} (${count}) → ${mapped}`)
  }

  let updated = 0
  let failed = 0

  for (const d of devices) {
    const currentSite = d.site ?? ''
    let newSite: string

    if (aliasToName.has(currentSite)) {
      newSite = aliasToName.get(currentSite)!
    } else if (validSiteNames.has(currentSite)) {
      // Already valid — skip (shouldn't happen because of the filter above, but safety)
      continue
    } else {
      // Phantom / unknown → default
      newSite = DEFAULT_SITE
    }

    try {
      await db.device.update({
        where: { id: d.id },
        data: { site: newSite },
      })
      updated++
      if (updated <= 5 || updated % 20 === 0) {
        console.log(`  [${updated}/${devices.length}] ${d.assetCode} ${JSON.stringify(currentSite)} → ${newSite}`)
      }
    } catch (e) {
      failed++
      console.error(`  ✗ ${d.assetCode}: ${(e as Error).message}`)
    }
  }

  console.log(`\n════════════════════════════════════════════`)
  console.log(`✓ Updated: ${updated}`)
  console.log(`✗ Failed:  ${failed}`)
  console.log(`════════════════════════════════════════════`)

  // Verify final state
  const finalSites = await db.device.groupBy({
    by: ['site'],
    _count: { site: true },
  })
  console.log('\nFinal device.site distribution:')
  finalSites
    .sort((a, b) => b._count.site - a._count.site)
    .forEach((s) => {
      const isValid = validSiteNames.has(s.site ?? '')
      console.log(`  ${isValid ? '✓' : '✗'} ${JSON.stringify(s.site)} → ${s._count.site}`)
    })
}

main()
  .catch((e) => {
    console.error('Fatal:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
