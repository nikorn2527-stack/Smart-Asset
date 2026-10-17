# ITAM-NextJS Customer Onboarding Guide
# คู่มือการติดตั้งและเริ่มใช้งานสำหรับองค์กรใหม่

**เวอร์ชั่น:** 1.0
**วันที่:** 2026-09-12
**สถานะ:** ใช้สำหรับ Onboarding องค์กรใหม่

---

## 1. ข้อมูลที่ลูกค้าต้องเตรียมก่อนติดตั้ง

### 1.1 ขั้นต่ำ (Required)
| ข้อมูล | ตัวอย่าง | ใช้สำหรับ |
|---|---|---|
| ชื่อองค์กร | โรงพยาบาล ABC | สร้าง Tenant |
| รหัสองค์กร | ABC | Scope + Code Pattern |
| ผู้ดูแลระบบคนแรก | คุณสมชาย | เริ่มตั้งค่าและจัดการสิทธิ์ |
| Timezone | Asia/Bangkok | วันที่และเวลา |
| สกุลเงิน | THB | ราคาและรายงาน |
| Site หลัก 1 แห่ง | สำนักงานใหญ่ | Authorization + การจัดกลุ่ม |
| Asset Code Pattern | AST-{seq:6} | สร้างเลขอุปกรณ์ |
| Module ที่เปิดใช้ | Asset, Repair, Stock | กำหนดเมนูที่จำเป็น |

### 1.2 แนะนำ (Recommended)
| ข้อมูล | ตัวอย่าง |
|---|---|
| Department | ศูนย์คอมพิวเตอร์, ธุรการ |
| Building/Floor/Room | อาคาร A, ชั้น 2, ห้อง 201 |
| AssetCategory | คอมพิวเตอร์, เครื่องพิมพ์ |
| DeviceType | NOTEBOOK, PRINTER LASER |
| Status | Active, In Stock, Retired |
| RepairProblem/Resolution | วัสดุสิ้นเปลือง, เติมหมึก |
| StockUnit | ชิ้น, กล่อง |
| StockCategory | Toner, Spare Part |
| User Roles | admin, staff, viewer |

### 1.3 ตัวเลือก (Optional)
| ข้อมูล | ตัวอย่าง |
|---|---|
| Brand/Model | BROTHER, HL-L5210DN |
| Supplier | บริษัท ABC จำกัด |
| Meter | จดมิเตอร์เครื่องพิมพ์ |
| Purchase Order | PO-2026-0001 |
| License | Microsoft 365, Adobe |
| Depreciation | ค่าเสื่อมราคา |
| LINE/Email/Notification | การแจ้งเตือน |
| Google Sheets Sync | ดึงข้อมูลจาก Google Sheets |

---

## 2. ขั้นตอนการติดตั้ง

### 2.1 Quick Start (เร็วที่สุด — ใช้ SQLite)
```powershell
# รันในฐานะ Administrator
.\scripts\install.ps1 -Mode QuickStart
```

### 2.2 Custom (ใช้ PostgreSQL ของลูกค้า)
```powershell
.\scripts\install.ps1 -Mode Custom `
  -DbHost localhost -DbPort 5432 `
  -DbName itam -DbUser itam_app -DbPassword "your-password" `
  -AdminEmail "admin@hospital.go.th" -AdminPassword "secure-password" `
  -OrgCode "HOSP_ABC" -OrgName "โรงพยาบาล ABC"
```

### 2.3 LAN Server (วางบน server ภายในองค์กร)
```powershell
.\scripts\install.ps1 -Mode LANServer `
  -DbHost localhost -DbPort 5432 -DbName itam -DbUser itam_app -DbPassword "password"
# ดู config เพิ่มเติม: scripts/lan-mode-config.md
```

---

## 3. Setup Wizard (11 ขั้นตอน)

หลังติดตั้งเสร็จ → เปิดเบราว์เซอร์ → ไปที่ **Settings → Setup Wizard**

| Step | ชื่อ | สิ่งที่ต้องกรอก | บังคับ/ตัวเลือก |
|---|---|---|---|
| 0 | Preflight | — (ตรวจสอบอัตโนมัติ) | Required |
| 1 | Organization Identity | code, name, type, timezone, currency | Required |
| 2 | Module Selection | เลือก Module ที่จะใช้ | Required (Asset บังคับ) |
| 3 | Code Pattern | AST, WO, STK, PO pattern | Required |
| 4 | Sites | สาขาอย่างน้อย 1 แห่ง | Required |
| 5 | Organization Structure | แผนก, อาคาร, ชั้น | Optional |
| 6 | Master Data Source | Template / CSV Import / Manual | Optional |
| 7 | Admin + RBAC | ผู้ดูแลคนแรก + role + site scope | Required |
| 8 | Integration | LINE, Email, SSO | Optional |
| 9 | Review | ตรวจสอบข้อมูลทั้งหมด | Required |
| 10 | Activate | เปิดใช้งาน + Audit + Backup | Required |

---

## 4. Module Dependencies

| Module | ต้องเปิดก่อน | สิ่งที่จำเป็น |
|---|---|---|
| Asset | — | Organization, Site, Asset Pattern |
| Repair | Asset | WorkOrder Pattern, Status, Priority |
| Stock | Asset | Stock Pattern, Unit, Status |
| Meter | Asset | Device Meter Policy |
| Purchase Order | Stock | PO Pattern, Supplier |
| License | Asset | License Type |
| Depreciation | Asset | AssetCategory, Fiscal Year |

---

## 5. การนำเข้าข้อมูลจากระบบเดิม

### 5.1 Flow (Preview → Approve → Apply)
```
Source CSV/Sheet → Preview (read-only) → Admin Approve → Apply → LegacyReference + Audit
```

### 5.2 ลำดับการ Import (ตามความสำคัญ)
1. **Master Data** (Master_Items, Site_Attributes, Products, Departments)
2. **Devices** (All_Devices)
3. **Work Orders** (Services Data)
4. **Meter Readings** (Meter_Readings)
5. **Stock Transactions** (StockIn, StockOut)

### 5.3 การใช้ Preview
```
Settings → Google Sheets → Sync tab → Preview all sheets
```
หรือ API:
```bash
curl -X POST http://localhost:3000/api/legacy-import/preview \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"source":"itam","entityType":"Device","rows":[...]}'
```

---

## 6. การสำรองข้อมูล (Backup)

### 6.1 Manual Backup
```bash
# Pre-migration backup
bun scripts/pre-migration-backup.ts

# Export as TSV
curl http://localhost:3000/api/integrations/google-sheets/export-spreadsheet?format=tsv \
  -H "Authorization: Bearer <token>" -o backup.tsv
```

### 6.2 Restore Test
```bash
bun scripts/restore-test.ts db/backups/pre-migration-<timestamp>.db
```

### 6.3 Upgrade Flow
```bash
bash scripts/upgrade.sh
```

---

## 7. การแก้ปัญหา (Troubleshooting)

| ปัญหา | วิธีแก้ |
|---|---|
| แอปเข้าไม่ได้ | ตรวจ `curl http://localhost:3000/api/health` |
| Database error | ตรวส .env → DATABASE_URL ถูกต้อง |
| Login ไม่ได้ | ตรวจ admin password → ใช้ `bun scripts/seed-organization-pilot.ts` reset |
| Migration fail | รัน `bun scripts/pre-migration-backup.ts` ก่อน → restore ถ้าพัง |
| Memory (OOM) | ลด heap: `NODE_OPTIONS="--max-old-space-size=512" bun run start` |

---

## 8. การติดต่อ Support

| ช่องทาง | ใช้สำหรับ |
|---|---|
| GitHub Issues | Bug report + Feature request |
| LINE OA | แจ้งซ่อมด่วน |
| Email | คำถามทั่วไป |
| Supabase Dashboard | ดู/แก้ database โดยตรง (Admin เท่านั้น) |

---

## Appendix A: Migration Workbook Template

ดาวน์โหลด: `upload/IT_Asset_Management_Database.xlsx`

Sheets:
- All_Devices: ข้อมูลอุปกรณ์ (asset_no, brand, model, serial, site, ...)
- Meter_Readings: ข้อมูลมิเตอร์ (reading_id, asset_no, reading_date, meter_bw, ...)
- Master_Items: ข้อมูลมาตรฐาน (ItemID, CategoryKey, Value, ParentRef, ...)
- Site_Attributes: ข้อมูลสาขา (SiteCode, SiteName, LineOA, Hotline, PaperRate)
- User_Permissions: ผู้ใช้ (Email, Role, Active, Username, ...)
- App_Settings: การตั้งค่า (Key, Value, Description)

---

## Appendix B: Training Dataset

ข้อมูลตัวอย่างสำหรับฝึก:
- 10 อุปกรณ์ (ประเภทต่างๆ)
- 5 ใบแจ้งซ่อม (สถานะต่างๆ)
- 20 รายการมิเตอร์
- 5 รายการสต็อก
- 3 ผู้ใช้ (admin, staff, viewer)

รัน: `bun scripts/seed-master-catalog-v2.ts` → สร้าง 64 MasterItems ตัวอย่าง
