# รายงานตรวจสอบระบบ Sync ข้อมูลจาก App เดิม — ITAM-NextJS

**วันที่:** 2026-09-08
**ผู้ตรวจ:** main agent
**สถานะ:** ตรวจพบปัญหาวิกฤต (P0) — sync ครอบคลุมเพียง 3 จาก 12 entities

---

## ภาพรวม

ระบบ sync ข้อมูลจาก 3 Google Sheets (App เดิม) มี 2 ส่วนหลัก:
1. **`/api/cron/sync-legacy`** — cron รันทุกวัน 02:00 (เขียนข้อมูลจริง)
2. **`/api/sync/preview` + `/api/sync/run`** — sync แบบ interactive (preview ก่อนเขียน)

---

## 🔴 P0: Sync ครอบคลุมเพียง 3 จาก 12 entities (25%)

ตามเอกสาร `LEGACY-FIELD-MAPPING-REFERENCE-008.md` App เดิมมี 12 sheet tabs:

| # | Sheet Tab (App เดิม) | ตารางใหม่ | Sync ใน cron หรือไม่ | สถานะ |
|---|---|---|---|---|
| 1 | `All_Devices` | `Device` | ✅ sync แล้ว | ✅ ครบ 28 fields |
| 2 | `Meter_Readings` | `MeterReading` | ❌ **ไม่มี** | 🔴 ขาดทั้งหมด |
| 3 | `Location_History` | `DeviceTransfer` | ❌ **ไม่มี** | 🔴 ขาดทั้งหมด |
| 4 | `User_Permissions` | `User` | ❌ **ไม่มี** | 🔴 ขาดทั้งหมด |
| 5 | `App_Settings` | `AppSetting` | ❌ **ไม่มี** | 🔴 ขาดทั้งหมด |
| 6 | `Master_Items` | `MasterItem` | ❌ **ไม่มี** | 🔴 ขาดทั้งหมด |
| 7 | `Site_Attributes` | `Site` / `SiteRate` | ❌ **ไม่มี** | 🔴 ขาดทั้งหมด |
| 8 | `Data` (Services WO) | `WorkOrder` | ⚠️ sync แต่ชื่อ sheet ผิด | 🟠 sheet name ผิด + ขาด 20+ fields |
| 9 | `Products` (Stock) | `StockItem` | ✅ sync แล้ว | ✅ ครบ (เบื้องต้น) |
| 10 | `StockIn` | `StockTransaction (IN)` | ❌ **ไม่มี** | 🔴 ขาดทั้งหมด |
| 11 | `StockOut` | `StockTransaction (OUT)` | ❌ **ไม่มี** | 🔴 ขาดทั้งหมด |
| 12 | `PurchaseOrders` | `PurchaseOrder` | ❌ **ไม่มี** | 🔴 ขาดทั้งหมด |

**สรุป:** sync ครอบคลุมเพียง **Devices + StockItems + WO (บางส่วน)** — ขาด **9 entities** ที่สำคัญ

---

## 🔴 P0: WO sheet name ผิด

**ไฟล์:** `src/app/api/cron/sync-legacy/route.ts` บรรทัด 191

```ts
// เดิม (ผิด):
const sheetUrl = `...&sheet=All_WO`

// ตาม LEGACY-FIELD-MAPPING-008.md (ถูก):
// ชื่อแท็บจริงของ Services sheet คือ "Data" ไม่ใช่ "All_WO"
const sheetUrl = `...&sheet=Data`
```

**ผลกระทบ:** WO sync ไม่ทำงานเลย — Google Sheets คืน empty sheet เพราะหา tab "All_WO" ไม่เจอ

---

## 🔴 P0: WO sync ขาด 20+ fields

WO sync ดึงเฉพาะ 7 fields จาก 27+ ที่มีใน App เดิม:

**ที่ sync แล้ว:** woNumber, subject, status, reporterName, tel, priority, location
**ที่ขาด:** building, details, external_meta, employee_code, submission_source, pic_before, pic_onsite, pic_after, details_admin, date_admin, accept_status, edit_unlock_active/by/at/note, work_completed_at, closed_at, canceled_at, assigned_to/by/at, assignment_note, trackable, created_at, updated_at, legacy_job_no, reporter_email

---

## 🟠 P1: WO + Stock ไม่มี transaction wrapping

**ไฟล์:** `src/app/api/cron/sync-legacy/route.ts`

- Devices: ✅ หุ้มด้วย `db.$transaction` (batch 100 rows)
- Work Orders: ❌ upsert ทีละ row ไม่มี transaction — ถ้าพังกลางทาง ข้อมูลครึ่งเดียว
- Stock Items: ❌ upsert ทีละ row ไม่มี transaction — เหมือนกัน

**ความเสี่ยง:** ถ้า sync พังตอน row 500/1000 → 500 แถวแรกเข้า DB แล้ว 500 หลังไม่เข้า → ข้อมูลไม่สมบูรณ์

---

## 🟠 P1: ไม่รองรับ Google Service Account

**ไฟล์:** `src/lib/google-sheets-sync.ts`

ปัจจุบันใช้ public CSV export URL:
```
https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:csv&sheet=...
```

**ปัญหา:**
- ต้องเปิดแชร์ Sheets เป็น "Anyone with link" (ความปลอดภัยต่ำ)
- ไม่รองรับ Sheets ที่เป็น private
- User เตรียม Google Service Account + เปิด Sheets API + แชร์ Viewer ให้แล้ว

**ต้องแก้:** เปลี่ยนจาก `fetch(CSV export URL)` → ใช้ `googleapis` (Sheets API v4) กับ Service Account

---

## 🟡 P2: ไม่มี sync log/history table

ไม่มี model เก็บประวัติการ sync (รันเมื่อไหร่, สำเร็จ/ล้มเหลว, กี่แถว, error อะไร) — ตรวจได้แค่ AuditLog ซึ่งไม่เพียงพอ

---

## แผนการแก้ (เรียงตามลำดับความสำคัญ)

### Phase 1: แก้ P0 (เร่งด่วน — ทำให้ sync ทำงานได้จริง)

1. **แก้ WO sheet name** `All_WO` → `Data` (1 นาที)
2. **เพิ่ม WO fields ที่ขาด** (20+ fields) — ใช้ FIELD_MAPPINGS จาก csv-field-mapping.ts (2-3 ชม.)
3. **เพิ่ม transaction wrapping** สำหรับ WO + Stock (1 ชม.)

### Phase 2: เพิ่ม entities ที่ขาด (สำคัญ — ทำให้ sync ครบ 100%)

4. **Meter Readings** — sync จาก `Meter_Readings` sheet (2-3 ชม.)
5. **Device Transfers** — sync จาก `Location_History` sheet (2-3 ชม.)
6. **Stock Transactions** — sync จาก `StockIn` + `StockOut` sheets (3-4 ชม.)
7. **Purchase Orders** — sync จาก `PurchaseOrders` sheet (2-3 ชม.)
8. **Users** — sync จาก `User_Permissions` sheet (2-3 ชม.)
9. **Master Items** — sync จาก `Master_Items` sheet (1-2 ชม.)
10. **Site Attributes + Rates** — sync จาก `Site_Attributes` sheet (1-2 ชม.)
11. **App Settings** — sync จาก `App_Settings` sheet (1 ชม.)

### Phase 3: Service Account + reliability (สำคัญ — ความปลอดภัย)

12. **เปลี่ยนจาก CSV export → Sheets API v4** กับ Service Account (3-4 ชม.)
13. **เพิ่ม SyncRun model** — เก็บประวัติ sync (2 ชม.)
14. **เพิ่ม retry logic** — ถ้า Google Sheets timeout (1 ชม.)

---

## ประมาณการเวลา

| Phase | เนื้องาน | เวลา |
|---|---|---|
| Phase 1 | แก้ P0 (sheet name + WO fields + transaction) | ~4-5 ชม. |
| Phase 2 | เพิ่ม 9 entities ที่ขาด | ~15-20 ชม. |
| Phase 3 | Service Account + reliability | ~6-8 ชม. |
| **รวม** | | **~25-33 ชม.** |

---

## ความเสี่ยงถ้าไม่แก้

- **ถ้าวันนึง App เดิมถูกปิด** → ข้อมูล 9 entities (MeterReadings, Transfers, Users, StockIn/Out, POs, MasterItems, Sites, AppSettings) จะ **หายไปทั้งหมด** เพราะ sync ไม่ดึงมา
- **WO sync ไม่ทำงานเลย** เพราะ sheet name ผิด → ใบงานใหม่จาก App เดิมไม่เข้าระบบใหม่
- **ถ้า sync พังกลางทาง** → ข้อมูลครึ่งเดียว (WO + Stock ไม่มี transaction)

---

*เอกสารนี้ตรวจสอบจากโค้ดจริงทุกจุด — ไม่ใช่การเดา*
