const { PrismaClient } = require("@prisma/client"); // eslint-disable-line @typescript-eslint/no-require-imports
const fs = require("fs"); // eslint-disable-line @typescript-eslint/no-require-imports
const csv = require("csv-parse/sync"); // eslint-disable-line @typescript-eslint/no-require-imports

const p = new PrismaClient();

function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toInt(v) {
  const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  console.log("📥 Importing StockOutPending → StockTransaction (PENDING/APPROVED/REJECTED)...");
  const content = fs.readFileSync("/tmp/stock-out-pending.csv", "utf-8");
  const rows = csv.parse(content, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
  console.log("   Source rows:", rows.length);

  // Build product code → stockItemId map
  const allItems = await p.stockItem.findMany({ select: { id: true, productCode: true } });
  const itemMap = new Map(allItems.map(i => [i.productCode, i.id]));

  let inserted = 0, skipped = 0, errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const vals = Object.values(row);
    const requestNo = clean(vals[0]);
    const requestDate = clean(vals[1]);
    const requester = clean(vals[2]);
    const department = clean(vals[3]);
    const purpose = clean(vals[4]);
    const workOrderNo = clean(vals[5]);
    const productCode = clean(vals[6]);
    const productName = clean(vals[7]);
    const quantity = toInt(vals[8]);
    const unit = clean(vals[9]);
    const status = clean(vals[10]);
    const sourceKey = clean(vals[11]);
    const approver = clean(vals[12]);
    const approvedAt = clean(vals[13]);
    const rejectReason = clean(vals[14]);
    const approvalMode = clean(vals[17]);
    const autoApproveAt = clean(vals[18]);
    const approvalType = clean(vals[19]);

    if (!productCode || !itemMap.has(productCode)) {
      skipped++;
      continue;
    }

    // Map Thai status to English
    let approvalStatus = "PENDING";
    if (status && status.includes("อนุมัติแล้ว")) approvalStatus = "APPROVED";
    else if (status && status.includes("ไม่อนุมัติ")) approvalStatus = "REJECTED";

    const stockItemId = itemMap.get(productCode);

    try {
      // Check if already exists (by sourceKey or txnNumber)
      const existing = await p.stockTransaction.findFirst({
        where: {
          OR: [
            sourceKey ? { sourceKey } : {},
            requestNo ? { txnNumber: requestNo } : {},
          ].filter(o => Object.keys(o).length > 0),
        },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await p.stockTransaction.create({
        data: {
          txnNumber: requestNo,
          stockItemId,
          productCode,
          productName,
          type: "OUT",
          quantity,
          unit,
          requester,
          department,
          purpose,
          workOrderNo,
          approvalStatus,
          approver,
          approvedAt,
          rejectReason,
          sourceKey,
          approvalMode: approvalMode || "manual",
          autoApproveAt,
          processedFlag: approvalStatus === "APPROVED" ? "Y" : approvalStatus === "REJECTED" ? "R" : null,
          txnDate: requestDate || new Date().toISOString().slice(0, 10),
          performedBy: requester,
        },
      });
      inserted++;
    } catch (e) {
      errors++;
      if (errors < 5) console.log("   ERR row", i, ":", e.message.slice(0, 100));
    }

    if ((i + 1) % 200 === 0) {
      console.log(`   ...processed ${i + 1}/${rows.length} | inserted=${inserted} skipped=${skipped} errors=${errors}`);
    }
  }

  console.log(`\n   ✓ Inserted: ${inserted} | Skipped: ${skipped} | Errors: ${errors}`);

  // Final summary
  const byStatus = await p.stockTransaction.groupBy({ by: ["approvalStatus"], _count: true });
  console.log("\n✅ Final StockTransaction by approvalStatus:", JSON.stringify(byStatus));
  const linkedToWO = await p.stockTransaction.count({ where: { workOrderNo: { not: null } } });
  console.log("   Linked to WO (workOrderNo):", linkedToWO);
}

main().catch(e => { console.error("ERR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
