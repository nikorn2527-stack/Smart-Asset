/**
 * asset-site-code.ts — helpers for the per-site AssetSiteCode (e.g. `UDH-00001`).
 *
 * Format:  `<SITE_CODE>-<NNNNN>`  (5-digit zero-padded sequence)
 *
 * Behavior mirrors the Apps Script version (SettingsService.gs +
 * DeviceService.gs `getNextAssetSiteCode`):
 *   • Look up the SiteAttribute.SiteCode prefix for the given site.
 *   • Find the MAX existing AssetSiteCode for that site in the devices table
 *     (and in DeviceTransfer history, if any).
 *   • If the device was previously at this site (per DeviceTransfer),
 *     REUSE the old AssetSiteCode.
 *   • Otherwise increment + format.
 *
 * This module imports `db`, so it is SERVER-ONLY. Do not import from
 * client components.
 */

import { db } from '@/lib/db'

const DEFAULT_WIDTH = 5

/**
 * Pull the numeric seed out of an AssetSiteCode like `UDH-00001` → 1.
 * Returns 0 if the value is null/empty/malformed.
 */
export function parseAssetSiteCodeSeed(code: string | null | undefined): number {
  if (!code) return 0
  // Accept `PREFIX-NNNNN` or just `NNNNN`
  const m = String(code).match(/(\d+)\s*$/)
  if (!m) return 0
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Extract the alphabetic prefix from an AssetSiteCode like `UDH-00001` → `UDH`.
 * Returns empty string if the value is null/empty/malformed.
 */
export function extractSitePrefix(code: string | null | undefined): string {
  if (!code) return ''
  const m = String(code).trim().toUpperCase().match(/^([A-Z]+)/)
  return m ? m[1] : ''
}

/**
 * Format a prefix + numeric seed as an AssetSiteCode: `UDH` + 1 → `UDH-00001`.
 */
export function formatAssetSiteCode(
  prefix: string,
  num: number,
  width = DEFAULT_WIDTH,
): string {
  const safePrefix = (prefix || '').trim().toUpperCase()
  const safeNum = Math.max(0, Math.floor(num))
  return `${safePrefix}-${String(safeNum).padStart(width, '0')}`
}

/**
 * Normalize for comparison — strip whitespace, uppercase, leading zeros stripped
 * from the numeric portion so `UDH-00001` and `UDH-1` compare equal.
 */
export function normalizeAssetSiteCodeForCompare(code: string | null | undefined): string {
  if (!code) return ''
  const s = String(code).trim().toUpperCase()
  const m = s.match(/^([A-Z]+)-0*(\d+)$/)
  if (m) return `${m[1]}-${m[2]}`
  return s
}

/**
 * Look up the SiteCode prefix for a given siteName or siteCode.
 *
 * Resolution order:
 *   1. SiteAttribute table — match by SiteCode (exact) or SiteName (exact).
 *   2. MasterItem category "Site" — match by code or label.
 *   3. Derive from existing devices at that site (extract prefix from assetSiteCode).
 *   4. Fallback: first 3-6 uppercase alphanumeric chars of the input.
 */
export async function getSiteCodeForName(siteInput: string | null | undefined): Promise<string | null> {
  if (!siteInput) return null
  const input = siteInput.trim()
  const upper = input.toUpperCase()

  // 1. SiteAttribute — match by SiteCode or SiteName
  const sa = await db.siteAttribute.findFirst({
    where: {
      OR: [
        { SiteCode: upper },
        { SiteName: input },
      ],
    },
    select: { SiteCode: true },
  })
  if (sa?.SiteCode) return sa.SiteCode.toUpperCase()

  // 2. MasterItem category "Site"
  const masterSite = await db.masterItem.findFirst({
    where: {
      category: 'Site',
      OR: [{ code: upper }, { label: input }],
    },
    select: { code: true, siteCode: true },
  })
  if (masterSite?.siteCode) return masterSite.siteCode.toUpperCase()
  if (masterSite?.code) return masterSite.code.toUpperCase()

  // 3. Derive from existing devices — find any device whose site matches OR
  //    whose assetSiteCode starts with the input prefix
  const sample = await db.device.findFirst({
    where: {
      OR: [
        { site: input, assetSiteCode: { not: null } },
        { assetSiteCode: { startsWith: upper + '-' } },
      ],
    },
    select: { assetSiteCode: true },
  })
  const derived = extractSitePrefix(sample?.assetSiteCode)
  if (derived) return derived

  // 4. Fallback — first uppercase alphanumeric chars of the input (3-6 chars)
  const fallback = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6) || null
  return fallback
}

/**
 * Reverse lookup — given a SiteCode, find the siteName.
 */
export async function getSiteNameForCode(siteCode: string | null | undefined): Promise<string | null> {
  if (!siteCode) return null
  const code = siteCode.toUpperCase()

  const sa = await db.siteAttribute.findUnique({
    where: { SiteCode: code },
    select: { SiteName: true },
  })
  if (sa?.SiteName) return sa.SiteName

  const masterSite = await db.masterItem.findFirst({
    where: { category: 'Site', OR: [{ code }, { siteCode: code }] },
    select: { label: true },
  })
  if (masterSite?.label) return masterSite.label

  // Derive from devices
  const sample = await db.device.findFirst({
    where: { assetSiteCode: { startsWith: code + '-' } },
    select: { site: true },
  })
  return sample?.site ?? null
}

/**
 * Compute the NEXT AssetSiteCode for a device being moved to `targetSite`.
 *
 * Algorithm (matches Apps Script):
 *   1. If `assetNo` (assetCode) already has a DeviceTransfer entry with
 *      `toSite === targetSite`, REUSE the AssetSiteCode from that record.
 *   2. Otherwise find MAX(assetSiteCode) for the target site across all
 *      devices + DeviceTransfer history, and return PREFIX-(MAX+1).
 *   3. If no device exists at the target site yet, start at PREFIX-00001.
 */
export async function getNextAssetSiteCode(
  targetSite: string,
  options?: { assetNo?: string | null; reuseFromHistory?: boolean },
): Promise<string | null> {
  const prefix = await getSiteCodeForName(targetSite)
  if (!prefix) return null
  return continueWithPrefix(prefix, targetSite, options)
}

async function continueWithPrefix(
  prefix: string,
  targetSite: string,
  options?: { assetNo?: string | null; reuseFromHistory?: boolean },
): Promise<string> {
  const reuse = options?.reuseFromHistory !== false

  // 1. Reuse from DeviceTransfer history if applicable
  if (reuse && options?.assetNo) {
    const hist = await db.deviceTransfer.findFirst({
      where: {
        assetCode: options.assetNo,
        toSite: targetSite,
        toAssetSiteCode: { not: null },
      },
      orderBy: { transferDate: 'desc' },
      select: { toAssetSiteCode: true },
    })
    if (hist?.toAssetSiteCode) {
      return hist.toAssetSiteCode
    }
  }

  // 2. Find MAX assetSiteCode across all devices — match by site name OR
  //    by assetSiteCode prefix (handles both site code & site name input).
  const devicesAtSite = await db.device.findMany({
    where: {
      OR: [
        { site: targetSite, assetSiteCode: { not: null } },
        { assetSiteCode: { startsWith: prefix + '-' } },
      ],
    },
    select: { assetSiteCode: true },
    orderBy: { assetSiteCode: 'desc' },
    take: 1,
  })
  let maxSeed = 0
  if (devicesAtSite.length > 0 && devicesAtSite[0].assetSiteCode) {
    maxSeed = parseAssetSiteCodeSeed(devicesAtSite[0].assetSiteCode)
  }

  // Also probe DeviceTransfer for any higher historical code.
  const histMax = await db.deviceTransfer.findFirst({
    where: {
      OR: [
        { toSite: targetSite, toAssetSiteCode: { not: null } },
        { toAssetSiteCode: { startsWith: prefix + '-' } },
      ],
    },
    orderBy: { toAssetSiteCode: 'desc' },
    select: { toAssetSiteCode: true },
    take: 1,
  })
  if (histMax?.toAssetSiteCode) {
    maxSeed = Math.max(maxSeed, parseAssetSiteCodeSeed(histMax.toAssetSiteCode))
  }

  const nextSeed = maxSeed + 1
  return formatAssetSiteCode(prefix, nextSeed)
}
