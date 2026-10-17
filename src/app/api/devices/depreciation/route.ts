import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-middleware'
import { db } from '@/lib/db'
import { demoFilter } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// Heavy operation — needs longer timeout (Vercel Hobby: max 60s)
export const maxDuration = 60

/**
 * GET /api/devices/depreciation
 *
 * Calculates straight-line depreciation for all devices that have
 * financial fields (purchasePrice, usefulLife).
 *
 * Formula (straight-line):
 *   annualDepreciation = (purchasePrice - salvageValue) / usefulLife
 *   accumulatedDepreciation = annualDepreciation × yearsElapsed
 *   bookValue = purchasePrice - accumulatedDepreciation
 *
 * Devices without financial data are excluded (not errored).
 *
 * Phase 2 will add AssetCategory model so default usefulLife/salvageValue
 * can come from the device's category instead of per-device entry.
 */

interface DepreciationDevice {
  id: string
  assetCode: string
  name: string
  type: string
  brand?: string
  model?: string
  site: string
  purchasePrice: number
  salvageValue: number
  usefulLife: number
  purchaseDate: string | null
  annualDepreciation: number
  accumulatedDepreciation: number
  // currentValue = bookValue (renamed to match the frontend contract in
  // src/components/itam/types.ts:DepreciationDevice). The frontend expects
  // `currentValue`, NOT `bookValue` — sending `bookValue` causes
  // `d.currentValue` to be undefined in the .map() render, which crashes
  // formatBaht(undefined) with "Cannot read properties of undefined
  // (reading 'toLocaleString')".
  currentValue: number
  // ageInMonths = yearsElapsed × 12 (frontend expects months, not years).
  ageInMonths: number
  depreciationPercent: number
  yearsElapsed: number
  fullyDepreciated: boolean
  // status mapped to the frontend's DepreciationStatus union:
  //   'depreciating' — calculation succeeded, not yet fully depreciated
  //   'depreciated'  — fully depreciated (bookValue <= salvageValue)
  //   'new'          — yearsElapsed < 1 (purchased this year)
  //   'no_price' / 'no_life' — kept for API debug, but frontend maps them
  //   to 'new' badge (safe default).
  status: 'depreciating' | 'depreciated' | 'new' | 'calculated' | 'no_price' | 'no_life' | 'no_date'
}

function calculateYearsElapsed(purchaseDate: string | null): number {
  if (!purchaseDate) return 0
  try {
    const purchase = new Date(purchaseDate.length > 10 ? purchaseDate : purchaseDate + 'T00:00:00')
    const now = new Date()
    const diffMs = now.getTime() - purchase.getTime()
    const years = diffMs / (1000 * 60 * 60 * 24 * 365.25)
    return Math.max(0, years)
  } catch {
    return 0
  }
}

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('devices')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'VIEW_DEVICES')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const isDemoUser = auth.isDemo
    const siteFilter = isDemoUser ? { isDemo: true } : {}

    const devices = await db.device.findMany({
      where: {
        ...siteFilter,
        status: { notIn: ['Disposed', 'Retired'] },
      },
      select: {
        id: true,
        assetCode: true,
        name: true,
        type: true,
        site: true,
        purchasePrice: true,
        salvageValue: true,
        usefulLife: true,
        purchaseDate: true,
        isDemo: true,
      },
      orderBy: { assetCode: 'asc' },
    })

    // Phase 2: Fetch all AssetCategories so we can use them as fallback
    // when a device doesn't have usefulLife/salvageValue set manually.
    //
    // The row type is DERIVED from the query result instead of being referenced
    // as `Prisma.AssetCategory` — the Prisma namespace does not export bare
    // model types (only `...Omit` / `...GetPayload` variants). Deriving it also
    // keeps this block working if the category model gains or loses columns.
    type CategoryRow = Awaited<ReturnType<typeof db.assetCategory.findMany>>[number]
    const categories: CategoryRow[] = await db.assetCategory
      .findMany({ where: { active: true } })
      .catch(() => []) // graceful: if the table doesn't exist yet, skip the fallback
    // Build a lookup map by code (e.g. "IT-COMPUTER" → AssetCategory)
    // Also build a type-name → code map (e.g. "COMPUTER" → "IT-COMPUTER")
    // so devices matched by type string can find their category.
    // `as const` keeps each entry a [string, CategoryRow] tuple so Map's
    // constructor overload accepts it.
    const catByCode = new Map(categories.map((c) => [c.code, c] as const))
    const catByType = new Map<string, typeof categories[0]>()
    for (const c of categories) {
      // Match by name (case-insensitive) or by code suffix
      const nameLower = c.name.toLowerCase()
      const codeSuffix = c.code.split('-').pop()?.toLowerCase()
      catByType.set(nameLower, c)
      if (codeSuffix) catByType.set(codeSuffix, c)
    }

    const items: DepreciationDevice[] = []
    let totalOriginal = 0
    let totalBookValue = 0
    let totalDepreciated = 0
    let fullyDepreciatedCount = 0

    for (const d of devices) {
      const price = d.purchasePrice ? Number(d.purchasePrice) : null
      const salvage = d.salvageValue ? Number(d.salvageValue) : 0
      let life = d.usefulLife ?? null

      // Phase 2: If device doesn't have usefulLife, try to get it from
      // AssetCategory (matched by device type string).
      let categoryMatch: typeof categories[0] | undefined
      if (d.type) {
        const typeLower = d.type.toLowerCase()
        categoryMatch = catByType.get(typeLower)
      }
      if (life == null && categoryMatch?.usefulLifeYears) {
        life = categoryMatch.usefulLifeYears
      }

      // Skip devices without purchase price
      if (price == null || price <= 0) {
        items.push({
          id: d.id, assetCode: d.assetCode, name: d.name, type: d.type, site: d.site,
          purchasePrice: 0, salvageValue: 0, usefulLife: 0, purchaseDate: d.purchaseDate,
          annualDepreciation: 0, accumulatedDepreciation: 0, currentValue: 0,
          ageInMonths: 0,
          depreciationPercent: 0, yearsElapsed: 0, fullyDepreciated: false,
          status: 'no_price',
        })
        continue
      }

      // Skip devices without useful life
      if (life == null || life <= 0) {
        items.push({
          id: d.id, assetCode: d.assetCode, name: d.name, type: d.type, site: d.site,
          purchasePrice: price, salvageValue: salvage, usefulLife: 0, purchaseDate: d.purchaseDate,
          annualDepreciation: 0, accumulatedDepreciation: 0, currentValue: price,
          ageInMonths: 0,
          depreciationPercent: 0, yearsElapsed: 0, fullyDepreciated: false,
          status: 'no_life',
        })
        totalOriginal += price
        totalBookValue += price
        continue
      }

      const yearsElapsed = calculateYearsElapsed(d.purchaseDate)
      const depreciableAmount = price - salvage
      const annualDepreciation = depreciableAmount / life
      const accumulatedDepreciation = Math.min(annualDepreciation * yearsElapsed, depreciableAmount)
      const bookValue = Math.max(salvage, price - accumulatedDepreciation)
      const depreciationPercent = price > 0 ? (accumulatedDepreciation / price) * 100 : 0
      const fullyDepreciated = bookValue <= salvage || yearsElapsed >= life

      // Map to the frontend's DepreciationStatus union:
      //   - fullyDepreciated → 'depreciated'
      //   - yearsElapsed < 1 → 'new' (purchased this year, not yet depreciating)
      //   - otherwise → 'depreciating'
      const mappedStatus: 'depreciated' | 'depreciating' | 'new' =
        fullyDepreciated ? 'depreciated'
        : yearsElapsed < 1 ? 'new'
        : 'depreciating'

      items.push({
        id: d.id, assetCode: d.assetCode, name: d.name, type: d.type, site: d.site,
        purchasePrice: price, salvageValue: salvage, usefulLife: life, purchaseDate: d.purchaseDate,
        annualDepreciation: Math.round(annualDepreciation * 100) / 100,
        accumulatedDepreciation: Math.round(accumulatedDepreciation * 100) / 100,
        currentValue: Math.round(bookValue * 100) / 100,
        ageInMonths: Math.round(yearsElapsed * 12),
        depreciationPercent: Math.round(depreciationPercent * 100) / 100,
        yearsElapsed: Math.round(yearsElapsed * 100) / 100,
        fullyDepreciated,
        status: mappedStatus,
      })

      totalOriginal += price
      totalBookValue += bookValue
      totalDepreciated += accumulatedDepreciation
      if (fullyDepreciated) fullyDepreciatedCount++
    }

    const avgDepreciationPercent = totalOriginal > 0
      ? Math.round((totalDepreciated / totalOriginal) * 10000) / 100
      : 0

    const calculatedCount = items.filter((i) => i.status === 'depreciating' || i.status === 'depreciated').length

    return NextResponse.json({
      configured: true,
      items,
      devices: items, // backward compat for existing frontend
      summary: {
        totalValue: Math.round(totalBookValue * 100) / 100,
        totalOriginal: Math.round(totalOriginal * 100) / 100,
        totalDepreciated: Math.round(totalDepreciated * 100) / 100,
        avgDepreciationPercent,
        fullyDepreciatedCount,
        deviceCount: items.length,
        calculatedCount,
        noPriceCount: items.filter((i) => i.status === 'no_price').length,
        noLifeCount: items.filter((i) => i.status === 'no_life').length,
      },
    })
  } catch (err) {
    console.error('GET /api/devices/depreciation', err)
    return NextResponse.json(
      { error: 'Failed to calculate depreciation' },
      { status: 500 },
    )
  }
}
