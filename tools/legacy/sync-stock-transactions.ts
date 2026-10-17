import { google } from 'googleapis'
import { PrismaClient } from '@prisma/client'

// Read service account credentials from env var (production) or file (local dev only).
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || '/home/z/my-project/google-service-account.json'
const keyContent = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON

const auth = keyContent
  ? new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      credentials: JSON.parse(keyContent),
    })
  : new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
const sheets = google.sheets({ version: 'v4', auth })
const db = new PrismaClient()

const STOCK_SHEET = '18unmy8rRwQYgFuunZkKueMwBUFvpVtqvokb6l-YihaM'

async function fetchTab(tab: string) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: STOCK_SHEET, range: tab + '!A1:Z' })
  const rows = r.data.values ?? []
  if (rows.length < 2) return []
  const headers = rows[0]
  return rows.slice(1).map(row => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
    return obj
  })
}

async function main() {
  console.log('=== Stock Transactions Sync ===')

  // Build StockItem lookup
  const stockItems = await db.stockItem.findMany({ select: { id: true, productCode: true } })
  const stockMap = new Map(stockItems.map(s => [s.productCode, s.id]))
  console.log('StockItems in DB:', stockMap.length)

  // Get existing txn numbers
  const existingTxns = await db.stockTransaction.findMany({ select: { txnNumber: true } })
  const existingNumbers = new Set(existingTxns.map(t => t.txnNumber).filter(Boolean))
  console.log('Existing transactions:', existingTxns.length)

  let created = 0
  let skipped = 0
  let noMatch = 0
  const batch: Array<Record<string, unknown>> = []

  function addToBatch(data: Record<string, unknown>) {
    batch.push(data)
    if (batch.length >= 500) {
      db.stockTransaction.createMany({ data: batch, skipDuplicates: true })
        .then(r => { created += r.count; console.log(`Progress: ${created} created`) })
        .catch(e => console.error('Batch error:', e instanceof Error ? e.message.slice(0, 80) : 'unknown'))
      batch.length = 0
    }
  }

  // 1. StockIn tab → type=STOCK_IN
  console.log('\n--- StockIn ---')
  const stockIn = await fetchTab('StockIn')
  console.log('Rows:', stockIn.length)
  for (const row of stockIn) {
    const txnNumber = row.ReceiptNo?.trim()
    if (!txnNumber || existingNumbers.has(txnNumber)) { skipped++; continue }
    const productCode = row.ProductCode?.trim()
    const stockItemId = productCode ? stockMap.get(productCode) : null
    if (!stockItemId) { noMatch++; continue }

    addToBatch({
      txnNumber,
      type: 'STOCK_IN',
      stockItemId,
      quantity: parseInt(row.Quantity || '0', 10) || 0,
      unit: row.Unit || null,
      unitCost: parseFloat(row.UnitPrice || '0') || null,
      actor: row.Receiver || null,
      remark: row.Remark || null,
      txnDate: row.Date || new Date().toISOString().slice(0, 10),
      approvalStatus: 'APPROVED',
      approvalMode: 'auto',
    })
  }

  // 2. StockOut tab → type=STOCK_OUT
  console.log('\n--- StockOut ---')
  const stockOut = await fetchTab('StockOut')
  console.log('Rows:', stockOut.length)
  for (const row of stockOut) {
    const txnNumber = row.IssueNo?.trim()
    if (!txnNumber || existingNumbers.has(txnNumber)) { skipped++; continue }
    const productCode = row.ProductCode?.trim()
    const stockItemId = productCode ? stockMap.get(productCode) : null
    if (!stockItemId) { noMatch++; continue }

    addToBatch({
      txnNumber,
      type: 'STOCK_OUT',
      stockItemId,
      quantity: parseInt(row.Quantity || '0', 10) || 0,
      unit: row.Unit || null,
      actor: row.Requester || null,
      remark: row.Purpose || null,
      txnDate: row.Date || new Date().toISOString().slice(0, 10),
      approvalStatus: 'APPROVED',
      approvalMode: 'auto',
      approver: row.Approver || null,
    })
  }

  // 3. StockOutPending tab → type=STOCK_OUT, status=PENDING/APPROVED
  console.log('\n--- StockOutPending ---')
  const pending = await fetchTab('StockOutPending')
  console.log('Rows:', pending.length)
  for (const row of pending) {
    const txnNumber = row.RequestNo?.trim()
    if (!txnNumber || existingNumbers.has(txnNumber)) { skipped++; continue }
    const productCode = row.ProductCode?.trim()
    const stockItemId = productCode ? stockMap.get(productCode) : null
    if (!stockItemId) { noMatch++; continue }

    const status = row.Status?.includes('อนุมัติ') ? 'APPROVED' : row.Status?.includes('ปฏิเัธสธ') ? 'REJECTED' : 'PENDING'

    addToBatch({
      txnNumber,
      type: 'STOCK_OUT',
      stockItemId,
      quantity: parseInt(row.Quantity || '0', 10) || 0,
      unit: row.Unit || null,
      actor: row.RequesterUsername || null,
      remark: row.Purpose || null,
      txnDate: row.RequestDate || new Date().toISOString().slice(0, 10),
      approvalStatus: status,
      approvalMode: row.ApprovalMode || 'manual',
      approver: row.Approver || null,
      workOrderNo: row.WorkOrderNo || null,
    })
  }

  // 4. Transactions tab (general log — skip if already have via StockIn/StockOut)
  console.log('\n--- Transactions (general) ---')
  const transactions = await fetchTab('Transactions')
  console.log('Rows:', transactions.length)
  for (const row of transactions) {
    const txnNumber = row.DocumentNo?.trim()
    if (!txnNumber || existingNumbers.has(txnNumber)) { skipped++; continue }
    const productCode = row.ProductCode?.trim()
    const stockItemId = productCode ? stockMap.get(productCode) : null
    if (!stockItemId) { noMatch++; continue }

    const type = row.TransactionType?.includes('รับเข้า') ? 'STOCK_IN' : 'STOCK_OUT'

    addToBatch({
      txnNumber,
      type,
      stockItemId,
      quantity: parseInt(row.Quantity || '0', 10) || 0,
      unit: row.Unit || null,
      actor: row.PerformedBy || null,
      remark: row.Remark || null,
      txnDate: row.Date || new Date().toISOString().slice(0, 10),
      approvalStatus: 'APPROVED',
      approvalMode: 'auto',
    })
  }

  // Final batch
  if (batch.length > 0) {
    try {
      const r = await db.stockTransaction.createMany({ data: batch, skipDuplicates: true })
      created += r.count
    } catch (err) {
      console.error('Final batch error:', err instanceof Error ? err.message.slice(0, 100) : 'unknown')
    }
  }

  console.log(`\n=== Results ===`)
  console.log(`Created: ${created}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`No matching StockItem: ${noMatch}`)
  console.log(`Total: ${created + skipped + noMatch}`)

  const finalCount = await db.stockTransaction.count()
  console.log(`DB StockTransactions after sync: ${finalCount}`)

  await db.$disconnect()
}

main().catch(e => { console.error('Error:', e); process.exit(1) })
