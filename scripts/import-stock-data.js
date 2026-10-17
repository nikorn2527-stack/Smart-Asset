const { PrismaClient } = require("@prisma/client"); // eslint-disable-line @typescript-eslint/no-require-imports
const fs = require("fs"); // eslint-disable-line @typescript-eslint/no-require-imports
const csv = require("csv-parse/sync"); // eslint-disable-line @typescript-eslint/no-require-imports

const p = new PrismaClient();

function parseCsv(path) {
  const content = fs.readFileSync(path, "utf-8");
  return csv.parse(content, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
}

function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toInt(v) {
  const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function toFloat(v) {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  // ── 1. Import Stock Products (60 items) ──
  console.log("\n📦 Importing Stock Products...");
  const products = parseCsv("/tmp/stock-products.csv");
  console.log("   Source rows:", products.length);
  let prodInserted = 0, prodUpdated = 0;
  for (const row of products) {
    const code = clean(row.ProductCode);
    if (!code) continue;
    const data = {
      productCode: code,
      productName: clean(row.ProductName) || code,
      unit: clean(row.Unit) || "ชิ้น",
      quantity: toInt(row.CurrentStock),
      minQuantity: toInt(row.ReorderPoint),
      unitCost: toFloat(row.UnitPrice),
      totalValue: toFloat(row.TotalValue),
      active: clean(row.Status) !== "inactive",
      lastUpdated: clean(row.LastUpdated),
    };
    const existing = await p.stockItem.findUnique({ where: { productCode: code } });
    if (existing) {
      await p.stockItem.update({ where: { id: existing.id }, data });
      prodUpdated++;
    } else {
      await p.stockItem.create({ data });
      prodInserted++;
    }
  }
  console.log("   ✓ Inserted:", prodInserted, "| Updated:", prodUpdated);

  // ── 2. Import Stock Transactions (2,454 rows) ──
  console.log("\n📊 Importing Stock Transactions...");
  const txns = parseCsv("/tmp/stock-transactions.csv");
  console.log("   Source rows:", txns.length);
  let txnInserted = 0, txnSkipped = 0;
  // Build product code → stockItemId map
  const allItems = await p.stockItem.findMany({ select: { id: true, productCode: true } });
  const itemMap = new Map(allItems.map(i => [i.productCode, i.id]));
  for (const row of txns) {
    const docNo = clean(row.DocumentNo);
    const productCode = clean(row.ProductCode);
    const stockItemId = productCode ? itemMap.get(productCode) : null;
    if (!stockItemId) { txnSkipped++; continue; }
    // Check if already exists (by txnNumber)
    if (docNo) {
      const existing = await p.stockTransaction.findFirst({ where: { txnNumber: docNo } });
      if (existing) { txnSkipped++; continue; }
    }
    const txnType = clean(row.TransactionType);
    const type = txnType && txnType.includes("รับเข้า") ? "IN" : txnType && (txnType.includes("เบิก") || txnType.includes("ออก")) ? "OUT" : "ADJUST";
    try {
      await p.stockTransaction.create({
        data: {
          txnNumber: docNo,
          stockItemId,
          productCode,
          productName: clean(row.ProductName),
          type,
          quantity: toInt(row.Quantity),
          unit: clean(row.Unit),
          txnDate: clean(row.Date) || new Date().toISOString().slice(0, 10),
          performedBy: clean(row.PerformedBy),
          remark: clean(row.Remark),
          approvalStatus: "approved",
        },
      });
      txnInserted++;
    } catch (e) {
      txnSkipped++;
    }
  }
  console.log("   ✓ Inserted:", txnInserted, "| Skipped:", txnSkipped);

  // ── 3. Summary ──
  const finalCount = {
    stockItem: await p.stockItem.count(),
    stockTransaction: await p.stockTransaction.count(),
  };
  console.log("\n✅ Final counts:", JSON.stringify(finalCount));
}

main().catch(e => { console.error("ERR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
