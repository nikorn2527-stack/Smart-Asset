/**
 * import-products.ts — Import ProductCategory + Product from Excel into MasterItem,
 * and link existing StockItem rows to their ProductCategory.
 *
 * Excel file: upload/master_item_repair_stock_products_categorized_sitecode_preview.xlsx
 *
 * Steps:
 *   1. Read MasterItem sheet → find ProductCategory (11) + Product (60) rows
 *   2. Upsert into MasterItem table (skip if already exists by code)
 *   3. For each StockItem (B0001-B0060), find the matching Product (PROD-001)
 *      by matching productName, then update StockItem.category to the
 *      ProductCategory code (PCAT-xxx) so the filter dropdown groups correctly.
 */

import * as XLSX from 'xlsx'
import { db } from '../src/lib/db'

interface ExcelRow {
  category: string
  code: string
  label: string
  brand?: string
  model?: string
  deviceType?: string
  parentRef?: string
  displayLabel?: string
  siteCode?: string
  active?: string
}

interface ProductSourceRow {
  ProductCode: string
  ProductName: string
  CurrentStock: string
  Unit: string
  UnitPrice: string
  TotalValue: string
  ReorderPoint: string
  LastUpdated: string
  Status: string
}

async function main() {
  const wb = XLSX.readFile('upload/master_item_repair_stock_products_categorized_sitecode_preview.xlsx')

  // ── Step 1: Read MasterItem sheet ──
  const ws = wb.Sheets['MasterItem']
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(ws)

  const productCategories = rows.filter((r) => r.category === 'ProductCategory')
  const products = rows.filter((r) => r.category === 'Product')

  console.log(`Found ${productCategories.length} ProductCategory + ${products.length} Product rows`)

  // ── Step 2: Upsert ProductCategory into MasterItem ──
  console.log('\n=== Importing ProductCategory ===')
  let catCreated = 0
  let catSkipped = 0
  for (const pc of productCategories) {
    const existing = await db.masterItem.findFirst({ where: { code: pc.code } })
    if (existing) {
      catSkipped++
      continue
    }
    await db.masterItem.create({
      data: {
        category: 'ProductCategory',
        code: pc.code,
        label: pc.label,
        parentRef: pc.parentRef && pc.parentRef !== '—' ? pc.parentRef : null,
        displayLabel: pc.displayLabel && pc.displayLabel !== '—' ? pc.displayLabel : null,
        siteCode: pc.siteCode && pc.siteCode !== '—' ? pc.siteCode : null,
        active: pc.active === 'true' || pc.active === 'TRUE',
      },
    })
    catCreated++
    console.log(`  + ${pc.code}: ${pc.label}`)
  }
  console.log(`ProductCategory: ${catCreated} created, ${catSkipped} skipped`)

  // ── Step 3: Upsert Product into MasterItem ──
  console.log('\n=== Importing Product ===')
  let prodCreated = 0
  let prodSkipped = 0
  for (const p of products) {
    const existing = await db.masterItem.findFirst({ where: { code: p.code } })
    if (existing) {
      prodSkipped++
      continue
    }
    await db.masterItem.create({
      data: {
        category: 'Product',
        code: p.code,
        label: p.label,
        parentRef: p.parentRef && p.parentRef !== '—' ? p.parentRef : null,
        displayLabel: p.displayLabel && p.displayLabel !== '—' ? p.displayLabel : null,
        siteCode: p.siteCode && p.siteCode !== '—' ? p.siteCode : null,
        active: p.active === 'true' || p.active === 'TRUE',
      },
    })
    prodCreated++
    if (prodCreated <= 5 || prodCreated % 10 === 0) {
      console.log(`  + ${p.code}: ${p.label} → ${p.parentRef}`)
    }
  }
  console.log(`Product: ${prodCreated} created, ${prodSkipped} skipped`)

  // ── Step 4: Link StockItem → ProductCategory ──
  // Read Products Source sheet to get the mapping: ProductCode (B0001) → ProductName
  console.log('\n=== Linking StockItem → ProductCategory ===')
  const psWs = wb.Sheets['Products Source']
  const productSourceRows = XLSX.utils.sheet_to_json<ProductSourceRow>(psWs)

  // Build lookup: ProductName → ProductCategory code (via Product MasterItem)
  // Product.label = ProductName, Product.parentRef = PCAT-xxx
  const productNameToCategory: Map<string, string> = new Map()
  for (const p of products) {
    if (p.parentRef && p.parentRef !== '—') {
      productNameToCategory.set(p.label.trim(), p.parentRef)
    }
  }

  // Also build: ProductCode (B0001) → ProductName
  const codeToName: Map<string, string> = new Map()
  for (const ps of productSourceRows) {
    codeToName.set(ps.ProductCode.trim(), ps.ProductName.trim())
  }

  // Now update each StockItem
  const stockItems = await db.stockItem.findMany({
    select: { id: true, productCode: true, productName: true, category: true },
  })
  console.log(`Total StockItems to update: ${stockItems.length}`)

  let updated = 0
  let notFound = 0
  for (const si of stockItems) {
    // Try to find the ProductCategory via productName match
    const pcatCode = productNameToCategory.get(si.productName.trim())
    if (pcatCode) {
      await db.stockItem.update({
        where: { id: si.id },
        data: { category: pcatCode },
      })
      updated++
      if (updated <= 5 || updated % 10 === 0) {
        console.log(`  ✓ ${si.productCode} | ${si.productName} → ${pcatCode}`)
      }
    } else {
      // Try matching via ProductCode → ProductName → ProductCategory
      const name = codeToName.get(si.productCode.trim())
      if (name) {
        const pcat = productNameToCategory.get(name.trim())
        if (pcat) {
          await db.stockItem.update({
            where: { id: si.id },
            data: { category: pcat },
          })
          updated++
          continue
        }
      }
      notFound++
      console.log(`  ✗ ${si.productCode} | ${si.productName} — no ProductCategory match`)
    }
  }
  console.log(`\nStockItem update: ${updated} updated, ${notFound} not found`)

  // ── Summary ──
  console.log('\n=== Summary ===')
  console.log(`ProductCategory: ${catCreated} created, ${catSkipped} already existed`)
  console.log(`Product: ${prodCreated} created, ${prodSkipped} already existed`)
  console.log(`StockItem: ${updated} linked to ProductCategory, ${notFound} unmatched`)

  // Verify
  const pcatCount = await db.masterItem.count({ where: { category: 'ProductCategory' } })
  const prodCount = await db.masterItem.count({ where: { category: 'Product' } })
  console.log(`\nDB now has: ${pcatCount} ProductCategory, ${prodCount} Product`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
