import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkRateLimit, getClientIP } from '@/lib/rate-limit-kv'

// ============================================================
// Public Device Lookup API (NO AUTH REQUIRED)
//   GET /api/public/devices/lookup?code=SN12345&siteCode=PPIT
//
// Looks up devices by an arbitrary identifier (assetCode OR
// serialNumber). Returns a SANITIZED subset of fields safe for
// public consumption — no serials (raw), no IP/MAC, no PII.
//
// Why this exists:
//   • Lets users report a repair by typing the asset code or serial
//     number printed on the device, without needing a QR sticker
//     (Phase 2 of LINE-WEBHOOK-FIX — see /report/general page).
//   • Used by the LINE webhook's free-text branch via /report/general.
//
// Rate limit (per-IP):
//   • 30 lookups per hour per IP — read-only, higher than the
//     repair-submit limit (10/IP/day). Reset window: 1 hour.
//
// Response shape:
//   {
//     data: {
//       matches: [
//         {
//           shortId: "abc12345",  // last 8 chars of device.id (Smart QR)
//           assetCode: "IT-001",
//           name: "HP LaserJet",
//           brand: "HP",
//           model: "M404",
//           type: "Printer",
//           site: "PPIT",
//           building: "A",
//           floor: "1",
//           room: "101",
//           location: "แผนกบัญชี",
//           displayLabel: "HP LaserJet M404"
//         },
//         ...
//       ],
//       count: 1
//     }
//   }
//
// If no matches → 200 with empty array (not 404). This lets the UI
// render a friendly "not found" message without branching on status.
// ============================================================

export const dynamic = 'force-dynamic'

// ── Rate limit config ─────────────────────────────────────────────────
// 30 lookups per IP per hour. Higher than the repair-submit limit because
// this is read-only and the user may legitimately try several codes when
// searching for their device (asset code typo, wrong serial, etc.).
const LOOKUP_RATE_LIMIT = { maxRequests: 30, windowMs: 60 * 60 * 1000 }

// ── Public-safe device fields ──────────────────────────────────────────
// NEVER expose: serialNumber (raw), ip, mac, remoteId, purchasePrice,
// salvageValue, vendor, contractNo, departmentCode, costCenter,
// currentAssignee, parentDeviceId, replacedById, warrantyVendor, etc.
const PUBLIC_DEVICE_FIELDS = {
  id: true,
  assetCode: true,
  name: true,
  brand: true,
  model: true,
  type: true,
  status: true,
  site: true,
  building: true,
  floor: true,
  room: true,
  location: true,
  department: true,
  assetSiteCode: true,
  displayLabel: true,
  replacedById: true,
} as const

/** Type alias for a device row selected with the public fields above. */
type PublicDeviceRow = {
  id: string
  assetCode: string
  name: string | null
  brand: string | null
  model: string | null
  type: string | null
  status: string | null
  site: string | null
  building: string | null
  floor: string | null
  room: string | null
  location: string | null
  department: string | null
  assetSiteCode: string | null
  displayLabel: string | null
  replacedById: string | null
}

/**
 * Build a public-safe device payload (single match). Mirrors the subset
 * returned by /api/public/devices/[shortId] but without the
 * device.workOrders relation (we don't want to leak WO history here).
 */
function toPublicMatch(device: PublicDeviceRow) {
  return {
    shortId: device.id,
    assetCode: device.assetCode,
    name: device.name,
    brand: device.brand,
    model: device.model,
    type: device.type,
    site: device.site,
    building: device.building,
    floor: device.floor,
    room: device.room,
    location: device.location,
    department: device.department,
    assetSiteCode: device.assetSiteCode,
    displayLabel: device.displayLabel,
    replaced: !!device.replacedById,
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const code = (url.searchParams.get('code') ?? '').trim()
    const siteCode = (url.searchParams.get('siteCode') ?? '').trim().toUpperCase()

    if (!code) {
      return NextResponse.json(
        { error: 'กรุณาระบุรหัสทรัพย์สิน หรือ เลขซีเรียล (code)' },
        { status: 400 },
      )
    }

    // ── Rate limit (per-IP) ──
    const clientIP = getClientIP(req)
    const rlKey = `lookup:${clientIP}`
    const rl = await checkRateLimit(rlKey, LOOKUP_RATE_LIMIT)
    if (!rl.allowed) {
      const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000)
      return NextResponse.json(
        {
          error: `ค้นหาเร็วเกินไป กรุณารอ ${Math.max(1, Math.ceil(retryAfterSec / 60))} นาที แล้วลองอีกครั้ง`,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSec),
            'X-RateLimit-Limit': String(rl.limit),
            'X-RateLimit-Remaining': String(rl.remaining),
          },
        },
      )
    }

    // ── Resolve device(s) by assetCode or serialNumber ──
    // We do two queries:
    //   1. assetCode exact (unique → 0 or 1 row)
    //   2. serialNumber exact (potentially many rows)
    // Combine the results, dedup by device.id, and filter by siteCode.
    const matches: PublicDeviceRow[] = []

    // 1. Try assetCode (unique constraint — at most one row)
    const byAsset = await db.device.findUnique({
      where: { assetCode: code },
      select: PUBLIC_DEVICE_FIELDS,
    })
    if (byAsset) matches.push(byAsset as PublicDeviceRow)

    // 2. Try serialNumber (case-sensitive equality; serial is non-unique)
    //    We use findMany (not findFirst) to surface duplicate-serial devices.
    //    Ordering: updatedAt desc → most-recently-active first so the most
    //    relevant device appears at the top of the list.
    const bySerial = await db.device.findMany({
      where: { serialNumber: code },
      select: PUBLIC_DEVICE_FIELDS,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      // Cap at 10 to keep the response payload sane (and the UI usable).
      take: 10,
    })
    for (const d of bySerial) {
      if (!matches.some((m) => m.id === d.id)) {
        matches.push(d as PublicDeviceRow)
      }
    }

    // 3. Optional siteCode filter — restrict to the user's site.
    let filtered = matches
    if (siteCode) {
      filtered = matches.filter((d) => {
        const devSite = (d.site ?? '').toUpperCase()
        const devAssetSite = (d.assetSiteCode ?? '').toUpperCase()
        return devSite === siteCode || devAssetSite === siteCode
      })
    }

    // ── Sanitize the response ──
    const publicMatches = filtered.map(toPublicMatch)

    return NextResponse.json(
      {
        data: {
          matches: publicMatches,
          count: publicMatches.length,
          // Echo the search context so the UI can display "X results for 'code' at site 'PPIT'"
          query: { code, siteCode: siteCode || null },
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          'X-RateLimit-Limit': String(rl.limit),
          'X-RateLimit-Remaining': String(rl.remaining),
        },
      },
    )
  } catch (err) {
    console.error('GET /api/public/devices/lookup', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: 'Internal error', detail: message },
      { status: 500 },
    )
  }
}
