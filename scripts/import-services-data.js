const { PrismaClient } = require("@prisma/client"); // eslint-disable-line @typescript-eslint/no-require-imports
const fs = require("fs"); // eslint-disable-line @typescript-eslint/no-require-imports
const csv = require("csv-parse/sync"); // eslint-disable-line @typescript-eslint/no-require-imports

const p = new PrismaClient();

function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Try dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    return `${m[3]}-${mo}-${d}`;
  }
  return null;
}

function mapStatus(s) {
  if (!s) return "PENDING";
  const lower = String(s).toLowerCase();
  if (lower.includes("จบ") || lower.includes("เสร็จ") || lower.includes("complet")) return "COMPLETED";
  if (lower.includes("กำลัง") || lower.includes("progress") || lower.includes("ซ่อม")) return "IN_PROGRESS";
  if (lower.includes("รอ") || lower.includes("waiting") || lower.includes("อะไหล่")) return "WAITING_PARTS";
  if (lower.includes("ยกเลิก") || lower.includes("cancel")) return "CANCELLED";
  return "PENDING";
}

function mapPriority(s) {
  if (!s) return "ปกติ";
  const lower = String(s).toLowerCase();
  if (lower.includes("ด่วน") || lower.includes("urgent")) return "ด่วน";
  if (lower.includes("สูง") || lower.includes("high")) return "สูง";
  if (lower.includes("ปานกลาง") || lower.includes("medium")) return "ปานกลาง";
  return "ปกติ";
}

async function main() {
  console.log("\n🔧 Importing Services (Work Orders)...");
  const content = fs.readFileSync("/tmp/services-data.csv", "utf-8");
  const rows = csv.parse(content, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
  console.log("   Source rows:", rows.length);
  
  let inserted = 0, updated = 0, skipped = 0, errors = 0;
  let woNumberSeq = 1;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const jsonStr = clean(row.data_json);
    if (!jsonStr) { skipped++; continue; }
    
    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch (e) {
      errors++;
      continue;
    }
    
    // Skip if it's a user record (not a work order)
    if (data.username && data.password_hash !== undefined && !data.subject) {
      skipped++;
      continue;
    }
    
    // Must have subject or id to be a work order
    if (!data.subject && !data.id) {
      skipped++;
      continue;
    }
    
    const woId = String(data.id || "").trim();
    if (!woId) { skipped++; continue; }
    
    // Generate WO number
    const woNumber = data.wo_number || data.woNumber || `WO-${today}-${String(woNumberSeq).padStart(3, "0")}`;
    woNumberSeq++;
    
    const status = mapStatus(data.status);
    const priority = mapPriority(data.priority);
    const createdAt = data.created_at || data.submitted_at || data.timestamp || new Date().toISOString();
    
    try {
      const existing = await p.workOrder.findFirst({ where: { OR: [{ woNumber }, { requestId: woId }] } });
      const woData = {
        woNumber,
        requestId: woId,
        subject: data.subject || "ไม่ระบุ",
        building: clean(data.building),
        location: clean(data.location),
        details: clean(data.details),
        priority,
        reporterName: clean(data.reporter_name || data.name || data.reporter),
        reporterEmail: clean(data.reporter_email || data.email),
        tel: clean(data.tel || data.phone),
        employeeCode: clean(data.employee_code),
        submissionSource: "guest",
        trackable: !!(data.tel || data.phone),
        picBefore: clean(data.pic_before || data.picBefore),
        picOnsite: clean(data.pic_onsite || data.picOnsite),
        picAfter: clean(data.pic_after || data.picAfter),
        status,
        assignedTo: clean(data.assigned_to || data.assignedTo || data.technician),
        resolution: clean(data.resolution || data.resolution_note),
        detailsAdmin: clean(data.admin_note || data.detailsAdmin),
        externalMeta: data.external_meta ? JSON.stringify(data.external_meta) : null,
        createdAt: new Date(createdAt),
        updatedAt: new Date(createdAt),
        workCompletedAt: status === "COMPLETED" && data.completed_at ? new Date(data.completed_at) : null,
        closedAt: status === "COMPLETED" && data.closed_at ? new Date(data.closed_at) : null,
      };
      
      if (existing) {
        await p.workOrder.update({ where: { id: existing.id }, data: woData });
        updated++;
      } else {
        await p.workOrder.create({ data: woData });
        inserted++;
      }
    } catch (e) {
      errors++;
      if (errors < 5) console.log("   ERR row", i, ":", e.message.slice(0, 100));
    }
    
    if ((i + 1) % 500 === 0) {
      console.log(`   ...processed ${i + 1}/${rows.length} | inserted=${inserted} updated=${updated} skipped=${skipped} errors=${errors}`);
    }
  }
  
  console.log(`\n   ✓ Inserted: ${inserted} | Updated: ${updated} | Skipped: ${skipped} | Errors: ${errors}`);
  console.log("\n✅ Final workOrder count:", await p.workOrder.count());
}

main().catch(e => { console.error("ERR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
