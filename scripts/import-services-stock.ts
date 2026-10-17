/**
 * Import Services (แจ้งซ่อม) + Stock (สต็อก) — ดึงจาก Google Sheets xlsx
 */

import { db } from '@/lib/db'
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'
import { STATUS_MAPPINGS } from '@/lib/csv-mapping'

async function importServices() {
  console.log('\n🔧 === Importing Services (แจ้งซ่อม) ===')
  const xlsxPath = '/tmp/sheet-exports/services-all.xlsx'
  const wb = XLSX.readFile(xlsxPath)
  console.log('Sheets:', wb.SheetNames)

  // ── Data sheet (WorkOrders as JSON-in-cell) ──
  if (wb.SheetNames.includes('Data')) {
    const ws = wb.Sheets['Data']
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 1 })
    console.log(`Data sheet: ${rows.length} rows (including header)`)

    // Row 1 = header (data_json), Row 2+ = JSON strings
    let inserted = 0, errors = 0
    for (let i = 1; i < rows.length; i++) {
      try {
        const jsonStr = String(rows[i][0] || '').trim()
        if (!jsonStr || jsonStr === 'data_json') continue

        const record = JSON.parse(jsonStr)

        // Map status: 🟠รอดำเนินการ → PENDING, etc.
        const rawStatus = String(record.status || 'PENDING')
        const mappedStatus = STATUS_MAPPINGS.workOrder[rawStatus] || 'PENDING'

        // Build WorkOrder data
        const data = {
          id: record.id || undefined,
          woNumber: record.id || null, // Use original ID as woNumber
          requestId: record.request_id || null,
          subject: String(record.subject || 'ไม่ระบุ'),
          building: record.building || null,
          location: record.location || null,
          details: record.details || null,
          priority: record.priority || 'ปกติ',
          reporterName: record.reporter_name || null,
          tel: record.tel || null,
          employeeCode: record.employee_code || null,
          submissionSource: record.submission_source || 'guest',
          trackable: record.trackable === true || record.trackable === 'true',
          externalMeta: record.external_meta ? JSON.stringify(record.external_meta) : null,
          picBefore: record.pic_before || null,
          picOnsite: record.pic_onsite || null,
          picAfter: record.pic_after || null,
          status: mappedStatus,
          acceptStatus: record.accept_status || null,
          assignedTo: record.assigned_to || null,
          assignedBy: record.assigned_by || null,
          assignedAt: record.assigned_at ? new Date(record.assigned_at) : null,
          assignmentNote: record.assignment_note || null,
          detailsAdmin: record.details_admin || null,
          dateAdmin: record.date_admin || null,
          editUnlockActive: record.edit_unlock_active === true || record.edit_unlock_active === 'true',
          editUnlockBy: record.edit_unlock_by || null,
          editUnlockAt: record.edit_unlock_at ? new Date(record.edit_unlock_at) : null,
          editUnlockNote: record.edit_unlock_note || null,
          workCompletedAt: record.work_completed_at ? new Date(record.work_completed_at) : null,
          closedAt: record.closed_at ? new Date(record.closed_at) : null,
          canceledAt: record.canceled_at ? new Date(record.canceled_at) : null,
          createdAt: record.created_at ? new Date(record.created_at) : new Date(),
          updatedAt: record.updated_at ? new Date(record.updated_at) : new Date(),
        }

        // Remove undefined id (let Prisma generate)
        if (!data.id) delete (data as Record<string, unknown>).id

        await db.workOrder.upsert({
          where: { woNumber: data.woNumber || 'unknown' },
          create: data as any,
          update: data as any,
        })
        inserted++
      } catch (err) {
        errors++
        if (errors <= 3) console.log(`  Row ${i + 1} error:`, err instanceof Error ? err.message : 'unknown')
      }
    }
    console.log(`✅ WorkOrders: inserted=${inserted}, errors=${errors}`)
  }

  // ── Users sheet ──
  if (wb.SheetNames.includes('Users')) {
    const ws = wb.Sheets['Users']
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 1 })
    console.log(`Users sheet: ${rows.length} rows`)
    let inserted = 0
    for (let i = 1; i < rows.length; i++) {
      try {
        const jsonStr = String(rows[i][0] || '').trim()
        if (!jsonStr) continue
        const record = JSON.parse(jsonStr)
        const email = record.username ? `${record.username}@ppit.local` : `user${i}@ppit.local`
        await db.user.upsert({
          where: { email },
          create: {
            email,
            username: record.username || null,
            name: record.name || null,
            role: record.role || 'viewer',
            active: record.active !== false,
            passwordHash: record.password_hash || null,
            lastLoginAt: record.last_login || null,
          },
          update: {
            username: record.username || null,
            name: record.name || null,
            role: record.role || 'viewer',
            active: record.active !== false,
          },
        })
        inserted++
      } catch { /* skip */ }
    }
    console.log(`✅ Users: inserted=${inserted}`)
  }

  // ── WorkOrderMessages sheet ──
  if (wb.SheetNames.includes('WorkOrderMessages')) {
    const ws = wb.Sheets['WorkOrderMessages']
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 1 })
    console.log(`WorkOrderMessages sheet: ${rows.length} rows`)
    let inserted = 0
    for (let i = 1; i < rows.length; i++) {
      try {
        const jsonStr = String(rows[i][0] || '').trim()
        if (!jsonStr) continue
        const record = JSON.parse(jsonStr)
        // Find work order by woNumber (original id)
        const wo = await db.workOrder.findFirst({ where: { woNumber: record.work_order_id } })
        if (!wo) continue
        await db.workOrderMessage.create({
          data: {
            workOrderId: wo.id,
            message: String(record.message || ''),
            author: record.author || null,
            authorRole: record.authorRole || null,
            createdAt: record.created_at ? new Date(record.created_at) : new Date(),
          },
        })
        inserted++
      } catch { /* skip */ }
    }
    console.log(`✅ Messages: inserted=${inserted}`)
  }

  // ── Reviews sheet ──
  if (wb.SheetNames.includes('Reviews')) {
    const ws = wb.Sheets['Reviews']
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { header: 1 })
    console.log(`Reviews sheet: ${rows.length} rows`)
    let inserted = 0
    for (let i = 1; i < rows.length; i++) {
      try {
        const jsonStr = String(rows[i][0] || '').trim()
        if (!jsonStr) continue
        const record = JSON.parse(jsonStr)
        const wo = await db.workOrder.findFirst({ where: { woNumber: record.work_order_id } })
        if (!wo) continue
        await db.workOrderReview.upsert({
          where: { workOrderId: wo.id },
          create: {
            workOrderId: wo.id,
            rating: Number(record.rating) || 5,
            comment: record.comment || null,
            reviewedBy: record.reviewed_by || null,
          },
          update: {},
        })
        inserted++
      } catch { /* skip */ }
    }
    console.log(`✅ Reviews: inserted=${inserted}`)
  }
}

async function importStock() {
  console.log('\n📦 === Importing Stock (สต็อก) ===')
  const xlsxPath = '/tmp/sheet-exports/stock-all.xlsx'
  const wb = XLSX.readFile(xlsxPath)
  console.log('Sheets:', wb.SheetNames)

  // ── Products sheet ──
  if (wb.SheetNames.includes('Products')) {
    const ws = wb.Sheets['Products']
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    console.log(`Products: ${rows.length} rows`)
    let inserted = 0
    for (const row of rows) {
      try {
        const productCode = String(row.ProductCode || '').trim()
        if (!productCode) continue
        const active = String(row.Status || 'Active').toLowerCase() === 'active'
        const quantity = Number(row.CurrentStock) || 0
        const unitCost = Number(row.UnitPrice) || null
        await db.stockItem.upsert({
          where: { productCode },
          create: {
            productCode,
            productName: String(row.ProductName || 'Unknown'),
            unit: String(row.Unit || 'ชิ้น'),
            quantity,
            minQuantity: Number(row.ReorderPoint) || 0,
            unitCost,
            totalValue: quantity * (unitCost || 0),
            active,
            lastUpdated: row.LastUpdated ? String(row.LastUpdated) : null,
          },
          update: {
            productName: String(row.ProductName || 'Unknown'),
            quantity,
            unitCost,
            totalValue: quantity * (unitCost || 0),
            active,
          },
        })
        inserted++
      } catch { /* skip */ }
    }
    console.log(`✅ Products: inserted=${inserted}`)
  }

  // ── StockIn sheet → StockTransaction type=IN ──
  if (wb.SheetNames.includes('StockIn')) {
    const ws = wb.Sheets['StockIn']
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    console.log(`StockIn: ${rows.length} rows`)
    let inserted = 0
    for (const row of rows) {
      try {
        const productCode = String(row.ProductCode || '').trim()
        if (!productCode) continue
        const item = await db.stockItem.findUnique({ where: { productCode } })
        if (!item) continue
        await db.stockTransaction.create({
          data: {
            txnNumber: String(row.ReceiptNo || `STX-IN-${inserted + 1}`),
            stockItemId: item.id,
            productCode,
            productName: String(row.ProductName || ''),
            type: 'IN',
            quantity: Number(row.Quantity) || 0,
            unit: String(row.Unit || 'ชิ้น'),
            unitCost: Number(row.UnitPrice) || null,
            cost: Number(row.TotalValue) || null,
            vendor: String(row.Supplier || '') || null,
            receiver: String(row.Receiver || '') || null,
            purchaseOrderNo: String(row.PurchaseOrderNo || '') || null,
            txnDate: String(row.Date || new Date().toISOString().slice(0, 10)),
            performedBy: String(row.Receiver || 'system'),
            remark: String(row.Remark || '') || null,
          },
        })
        inserted++
      } catch { /* skip */ }
    }
    console.log(`✅ StockIn: inserted=${inserted}`)
  }

  // ── StockOut sheet → StockTransaction type=OUT ──
  if (wb.SheetNames.includes('StockOut')) {
    const ws = wb.Sheets['StockOut']
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    console.log(`StockOut: ${rows.length} rows`)
    let inserted = 0
    for (const row of rows) {
      try {
        const productCode = String(row.ProductCode || '').trim()
        if (!productCode) continue
        const item = await db.stockItem.findUnique({ where: { productCode } })
        if (!item) continue
        await db.stockTransaction.create({
          data: {
            txnNumber: String(row.IssueNo || `STX-OUT-${inserted + 1}`),
            stockItemId: item.id,
            productCode,
            productName: String(row.ProductName || ''),
            type: 'OUT',
            quantity: Number(row.Quantity) || 0,
            unit: String(row.Unit || 'ชิ้น'),
            requester: String(row.Requester || '') || null,
            department: String(row.Department || '') || null,
            purpose: String(row.Purpose || '') || null,
            approver: String(row.Approver || '') || null,
            approvedAt: String(row.ApprovedAt || '') || null,
            txnDate: String(row.Date || new Date().toISOString().slice(0, 10)),
            performedBy: String(row.Requester || 'system'),
            remark: String(row.Remark || '') || null,
            sourceKey: String(row.source_key || '') || null,
            processedFlag: String(row.processed_flag || '') || null,
          },
        })
        inserted++
      } catch { /* skip */ }
    }
    console.log(`✅ StockOut: inserted=${inserted}`)
  }

  // ── PurchaseOrders sheet ──
  if (wb.SheetNames.includes('PurchaseOrders')) {
    const ws = wb.Sheets['PurchaseOrders']
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    console.log(`PurchaseOrders: ${rows.length} rows`)
    let inserted = 0
    for (const row of rows) {
      try {
        const poNumber = String(row.PurchaseOrderNo || '').trim()
        if (!poNumber) continue
        const existing = await db.purchaseOrder.findUnique({ where: { poNumber } })
        if (existing) continue
        const productCode = String(row.ProductCode || '').trim()
        const item = productCode ? await db.stockItem.findUnique({ where: { productCode } }) : null
        const po = await db.purchaseOrder.create({
          data: {
            poNumber,
            orderDate: String(row.OrderDate || new Date().toISOString().slice(0, 10)),
            supplier: String(row.Supplier || '') || null,
            status: String(row.Status || 'open'),
            totalValue: Number(row.TotalValue) || null,
            createdBy: String(row.CreatedBy || '') || null,
          },
        })
        if (item) {
          await db.purchaseOrderItem.create({
            data: {
              purchaseOrderId: po.id,
              stockItemId: item.id,
              productCode,
              productName: String(row.ProductName || ''),
              quantityOrdered: Number(row.QuantityOrdered) || 0,
              unit: String(row.Unit || 'ชิ้น'),
              unitPrice: Number(row.UnitPrice) || null,
              totalValue: Number(row.TotalValue) || null,
              quantityReceived: Number(row.QuantityReceived) || 0,
              quantityRemaining: Number(row.QuantityRemaining) || 0,
            },
          })
        }
        inserted++
      } catch { /* skip */ }
    }
    console.log(`✅ PurchaseOrders: inserted=${inserted}`)
  }
}

async function main() {
  await importServices()
  await importStock()

  console.log('\n📊 === Final counts ===')
  console.log(`Devices: ${await db.device.count()}`)
  console.log(`WorkOrders: ${await db.workOrder.count()}`)
  console.log(`WorkOrderMessages: ${await db.workOrderMessage.count()}`)
  console.log(`WorkOrderReviews: ${await db.workOrderReview.count()}`)
  console.log(`Users: ${await db.user.count()}`)
  console.log(`StockItems: ${await db.stockItem.count()}`)
  console.log(`StockTransactions: ${await db.stockTransaction.count()}`)
  console.log(`PurchaseOrders: ${await db.purchaseOrder.count()}`)
}

main().then(() => db.$disconnect()).catch((e) => { console.error(e); db.$disconnect(); process.exit(1) })
