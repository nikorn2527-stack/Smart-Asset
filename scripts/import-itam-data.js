const { PrismaClient } = require("@prisma/client"); // eslint-disable-line @typescript-eslint/no-require-imports
const fs = require("fs"); // eslint-disable-line @typescript-eslint/no-require-imports
const csv = require("csv-parse/sync"); // eslint-disable-line @typescript-eslint/no-require-imports

const p = new PrismaClient({ log: ["error"] });

function parseCsv(path) {
  const content = fs.readFileSync(path, "utf-8");
  return csv.parse(content, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
}
function clean(v) { if (v === undefined || v === null) return null; const s = String(v).trim(); return s === "" ? null : s; }
function toInt(v) { const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : 0; }

async function main() {
  // ── 1. Meter Readings (14,270 rows) ──
  console.log("\n📊 Importing Meter_Readings...");
  const readings = parseCsv("/tmp/itam-Meter_Readings.csv");
  console.log("   Source rows:", readings.length);
  // Build asset_no → deviceId map
  const devices = await p.device.findMany({ select: { id: true, assetCode: true } });
  const devMap = new Map(devices.map(d => [d.assetCode, d.id]));
  let rInserted = 0, rSkipped = 0;
  // Batch insert (100 at a time)
  const batch = [];
  for (let i = 0; i < readings.length; i++) {
    const row = readings[i];
    const assetNo = clean(row.asset_no);
    const deviceId = assetNo ? devMap.get(assetNo) : null;
    if (!deviceId) { rSkipped++; continue; }
    const readingId = clean(row.reading_id);
    // Skip if reading_id already exists
    if (readingId && batch.some(b => b.readingId === readingId)) { rSkipped++; continue; }
    batch.push({
      readingId,
      deviceId,
      assetCode: assetNo,
      readingDate: clean(row.reading_date) || new Date().toISOString().slice(0, 10),
      readingMonth: clean(row.reading_month),
      meterBw: toInt(row.meter_bw),
      meterColor: toInt(row.meter_color),
      pagesBw: toInt(row.pages_bw),
      pagesColor: toInt(row.pages_color),
      prevMeterBw: toInt(row.prev_meter_bw),
      prevMeterColor: toInt(row.prev_meter_color),
      readingType: clean(row.reading_type) || "MONTHLY",
      readBy: clean(row.read_by),
      remark: clean(row.remark),
      locationAtReading: clean(row.location_at_reading),
      siteAtReading: clean(row.site_at_reading),
      buildingAtReading: clean(row.building_at_reading),
      floorAtReading: clean(row.floor_at_reading),
      departmentAtReading: clean(row.department_at_reading),
      departmentCodeAtReading: clean(row.department_code_at_reading),
      eventType: clean(row.event_type),
      eventId: clean(row.event_id),
    });
    if (batch.length >= 200) {
      try {
        const result = await p.meterReading.createMany({ data: batch, skipDuplicates: true });
        rInserted += result.count;
      } catch (e) { rSkipped += batch.length; }
      batch.length = 0;
      if ((i + 1) % 1000 === 0) console.log(`   ...${i + 1}/${readings.length} | inserted=${rInserted} skipped=${rSkipped}`);
    }
  }
  if (batch.length > 0) {
    try { const r = await p.meterReading.createMany({ data: batch, skipDuplicates: true }); rInserted += r.count; } catch (e) { rSkipped += batch.length; }
  }
  console.log(`   ✓ Inserted: ${rInserted} | Skipped: ${rSkipped}`);

  // ── 2. Location History → DeviceTransfer (122 rows) ──
  console.log("\n🔄 Importing Location_History → DeviceTransfer...");
  const history = parseCsv("/tmp/itam-Location_History.csv");
  console.log("   Source rows:", history.length);
  let tInserted = 0, tSkipped = 0;
  for (const row of history) {
    const assetNo = clean(row.Asset_No);
    const deviceId = assetNo ? devMap.get(assetNo) : null;
    if (!deviceId) { tSkipped++; continue; }
    const logId = clean(row.Log_ID);
    if (logId) {
      const existing = await p.deviceTransfer.findUnique({ where: { logId } });
      if (existing) { tSkipped++; continue; }
    }
    try {
      await p.deviceTransfer.create({
        data: {
          logId,
          deviceId,
          assetCode: assetNo,
          moveDate: clean(row.Move_Date),
          action: clean(row.Action),
          fromStatus: clean(row.From_Status),
          toStatus: clean(row.To_Status),
          fromSite: clean(row.From_Site),
          fromAssetSiteCode: clean(row.From_AssetSiteCode),
          fromBuilding: clean(row.From_Building),
          fromFloor: clean(row.From_Floor),
          fromDepartment: clean(row.From_Department),
          fromLocation: clean(row.From_Location),
          toSite: clean(row.To_Site) || "unknown",
          toAssetSiteCode: clean(row.To_AssetSiteCode),
          toBuilding: clean(row.To_Building),
          toFloor: clean(row.To_Floor),
          toDepartment: clean(row.To_Department),
          toLocation: clean(row.To_Location),
          movedBy: clean(row.Moved_By),
          remark: clean(row.Remark),
          transferDate: clean(row.Move_Date) || new Date().toISOString().slice(0, 10),
        },
      });
      tInserted++;
    } catch (e) { tSkipped++; }
  }
  console.log(`   ✓ Inserted: ${tInserted} | Skipped: ${tSkipped}`);

  // ── 3. Master Items (306 rows) ──
  console.log("\n📋 Importing Master_Items...");
  const masters = parseCsv("/tmp/itam-Master_Items.csv");
  console.log("   Source rows:", masters.length);
  let mInserted = 0, mUpdated = 0, mSkipped = 0;
  for (const row of masters) {
    const category = clean(row.CategoryKey);
    const code = clean(row.ItemID);
    const label = clean(row.Value);
    if (!category || !code || !label) { mSkipped++; continue; }
    const existing = await p.masterItem.findFirst({ where: { category, code } });
    const data = {
      label,
      parentRef: clean(row.ParentRef) || clean(row.GroupName),
      displayLabel: clean(row.DisplayLabel) || label,
      siteCode: clean(row.SiteCode),
      active: clean(row.Active) !== "FALSE",
    };
    if (existing) {
      await p.masterItem.update({ where: { id: existing.id }, data });
      mUpdated++;
    } else {
      await p.masterItem.create({ data: { category, code, ...data } });
      mInserted++;
    }
  }
  console.log(`   ✓ Inserted: ${mInserted} | Updated: ${mUpdated} | Skipped: ${mSkipped}`);

  // ── 4. Audit Log (291 rows) ──
  console.log("\n📜 Importing Audit_Log...");
  const audits = parseCsv("/tmp/itam-Audit_Log.csv");
  console.log("   Source rows:", audits.length);
  let aInserted = 0, aSkipped = 0;
  for (const row of audits) {
    // Audit_Log CSV has weird format — first column is "Timestamp" with data concatenated
    // Skip for now if structure is wrong
    const action = clean(row.Action || row.action);
    if (!action) { aSkipped++; continue; }
    try {
      await p.auditLog.create({
        data: {
          action,
          entity: clean(row.Entity || row.entity) || "unknown",
          entityId: clean(row.Entity_ID || row.entity_id),
          summary: clean(row.Summary || row.summary) || action,
          detail: clean(row.Details || row.details),
          actor: clean(row.User || row.user) || "system",
          createdAt: clean(row.Timestamp || row.timestamp) ? new Date(row.Timestamp || row.timestamp) : new Date(),
        },
      });
      aInserted++;
    } catch (e) { aSkipped++; }
  }
  console.log(`   ✓ Inserted: ${aInserted} | Skipped: ${aSkipped}`);

  // ── 5. App Settings ──
  console.log("\n⚙️ Importing App_Settings...");
  const settings = parseCsv("/tmp/itam-App_Settings.csv");
  console.log("   Source rows:", settings.length);
  let sInserted = 0, sUpdated = 0, sSkipped = 0;
  for (const row of settings) {
    const key = clean(row.Key);
    const value = clean(row.Value);
    if (!key) { sSkipped++; continue; }
    const existing = await p.appSetting.findUnique({ where: { key } });
    if (existing) {
      await p.appSetting.update({ where: { id: existing.id }, data: { value } });
      sUpdated++;
    } else {
      await p.appSetting.create({ data: { key, value } });
      sInserted++;
    }
  }
  console.log(`   ✓ Inserted: ${sInserted} | Updated: ${sUpdated} | Skipped: ${sSkipped}`);

  // ── Summary ──
  console.log("\n✅ Final counts:");
  console.log("  device:", await p.device.count());
  console.log("  workOrder:", await p.workOrder.count());
  console.log("  stockItem:", await p.stockItem.count());
  console.log("  stockTransaction:", await p.stockTransaction.count());
  console.log("  meterReading:", await p.meterReading.count());
  console.log("  deviceTransfer:", await p.deviceTransfer.count());
  console.log("  masterItem:", await p.masterItem.count());
  console.log("  auditLog:", await p.auditLog.count());
  console.log("  appSetting:", await p.appSetting.count());
}

main().catch(e => { console.error("ERR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
