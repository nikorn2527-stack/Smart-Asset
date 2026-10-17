# ITAM-NextJS Testing Guide
# คู่มือเทสโปรแกรมทีละขั้นตอน

## ขั้นที่ 1: เตรียมเครื่อง

### 1.1 ติดตั้ง Bun
```bash
# Windows (PowerShell แบบ Admin)
irm bun.sh/install.ps1 | iex

# Mac
brew install bun

# Linux
curl -fsSL https://bun.sh/install | bash
```

### 1.2 Clone repo
```bash
git clone https://github.com/nikorn2527-stack/ITAM-NextJS.git
cd ITAM-NextJS
```

### 1.3 ติดตั้ง dependencies
```bash
bun install
```

### 1.4 สร้าง .env
```bash
cp .env.example .env
```

แก้ไข `.env`:
```bash
DATABASE_URL=file:./db/custom.db
JWT_SECRET=itam-production-secret-2025-png-team-32bytes
NODE_ENV=development
```

### 1.5 สร้าง database + seed
```bash
# สร้างตาราง
DEV_DB_PUSH=1 bun run db:push

# สร้าง Organization + Master Data + Test Users
bun scripts/seed-organization-pilot.ts
bun scripts/seed-master-catalog-v2.ts
```

### 1.6 รัน dev server
```bash
bun run dev
```

เปิด browser: `http://localhost:3000`

---

## ขั้นที่ 2: เทส Login

### 2.1 Login ด้วย admin
- Username: `admin`
- Password: `test1234`
- คาดหวัง: เข้าสู่ระบบได้ → ไปหน้า Dashboard

### 2.2 ทดสอบ user อื่นๆ
| Username | Password | Role |
|---|---|---|
| `superadmin` | test1234 | superadmin |
| `manager` | test1234 | editor |
| `tester` | test1234 | staff |
| `viewer` | test1234 | viewer |

### 2.3 ทดสอบ login ผิด
- ใส่รหัสผิด 3 ครั้ง → คาดหวัง: ล็อค 5 นาที

---

## ขั้นที่ 3: เทส Dashboard

### 3.1 ตรวจ KPI
- [ ] แสดง "● Live" badge (เขียว)
- [ ] อุปกรณ์ทั้งหมด: 2,406
- [ ] ใบงาน: 4,942
- [ ] สต็อกต่ำ: แสดงจำนวน

### 3.2 ตรวจ Charts
- [ ] กราฟสถานะอุปกรณ์ (Pie Chart)
- [ ] กราฟประเภทอุปกรณ์ (Bar Chart)
- [ ] กราฟแนวโน้มกระดาษ (Line Chart)

### 3.3 ตรวจ Real-time
- [ ] รอ 30 วินาที → KPI อัปเดตอัตโนมัติ (ไม่ต้อง refresh)

---

## ขั้นที่ 4: เทส Devices

### 4.1 ค้นหาอุปกรณ์
- [ ] ค้นหา "ZEBRA" → แสดงผล
- [ ] ค้นหา "PRINTER" → แสดงผล
- [ ] กรองตามสาขา → แสดงผล

### 4.2 ดูรายละเอียดอุปกรณ์
- [ ] คลิกอุปกรณ์ → เปิด detail sheet
- [ ] แสดงข้อมูลครบ (assetCode, brand, model, serial)
- [ ] แสดงประวัติมิเตอร์
- [ ] แสดงประวัติการย้าย
- [ ] แสดง Custom Fields (ถ้ามี)

### 4.3 เพิ่มอุปกรณ์ใหม่
- [ ] กด "เพิ่ม" → กรอกข้อมูล → บันทึก
- [ ] ตรวจว่าอุปกรณ์ใหม่แสดงในรายการ

---

## ขั้นที่ 5: เทส Work Orders

### 5.1 สร้างใบแจ้งซ่อม
- [ ] กด "แจ้งซ่อม" → กรอกหัวข้อ + รายละเอียด
- [ ] บันทึก → ได้เลขใบงาน

### 5.2 มอบหมายงาน
- [ ] เลือกใบงาน → กด "มอบหมาย" → เลือกผู้รับผิดชอบ
- [ ] สถานะเปลี่ยนเป็น "มอบหมายแล้ว"

### 5.3 ปิดงาน
- [ ] กด "ปิดงาน" → กรอกผลการซ่อม → บันทึก
- [ ] สถานะเปลี่ยนเป็น "เสร็จสิ้น"

---

## ขั้นที่ 6: เทส Meter

### 6.1 จดมิเตอร์
- [ ] เลือกอุปกรณ์ → กรอกเลขมิเตอร์ BW + Color
- [ ] บันทึก → แสดงในประวัติ

### 6.2 ดูประวัติมิเตอร์
- [ ] เปิด detail อุปกรณ์ → ดูกราฟมิเตอร์
- [ ] ตรวจว่าจำนวนหน้าคำนวณถูกต้อง

---

## ขั้นที่ 7: เทส Stock

### 7.1 รับเข้าสต็อก
- [ ] เลือกสินค้า → กด "รับเข้า" → กรอกจำนวน
- [ ] ตรวจว่าจำนวนเพิ่มขึ้น

### 7.2 เบิกออกสต็อก
- [ ] เลือกสินค้า → กด "เบิกออก" → กรอกจำนวน
- [ ] ตรวจว่าจำนวนลดลง

### 7.3 แจ้งเตือนสต็อกต่ำ
- [ ] ตรวจว่าสินค้าที่ quantity <= minQuantity แสดง "ต่ำ"

---

## ขั้นที่ 8: เทส Settings

### 8.1 Master Data
- [ ] Settings → Master Data → แสดง 4 กลุ่ม (Core/Device/Repair/Stock)
- [ ] คลิกแต่ละกลุ่ม → แสดง categories ในกลุ่ม
- [ ] ตรวจว่า codes เป็น Canonical (BRD-0001, DEP-0001, etc.)

### 8.2 Organizations
- [ ] Settings → Organizations → แสดง PILOT
- [ ] ตรวจว่า code=PILOT, name=โรงพยาบาลศูนย์อุดรธานี

### 8.3 Setup Wizard
- [ ] Settings → Setup Wizard → แสดง 11 steps
- [ ] กรอกขั้นที่ 1 (Organization) ไม่ครบ → กดถัดไป → ต้องแสดง error (Fail-Closed)
- [ ] กรอกครบ → กดถัดไป → ผ่านไปขั้นถัดไป

### 8.4 Custom Fields
- [ ] Settings → Custom Fields → เลือก Device
- [ ] กด "สร้างฟิลด์ใหม่" → กรอก key + label + type → สร้าง
- [ ] ไปดู Device detail → ฟิลด์ใหม่แสดง

### 8.5 Google Sheets
- [ ] Settings → Google Sheets → Connection tab
- [ ] ตรวจ authProbe: ok=true (ถ้าตั้ง GOOGLE_* env แล้ว)
- [ ] Sync tab → กด Preview → แสดงจำนวน rows

---

## ขั้นที่ 9: เทส Security

### 9.1 รัน Cross-Org Tests
```bash
npx tsx tests/auth/cross-org-auth.test.ts
```
- [ ] 8/8 ผ่าน

### 9.2 รัน Custom Field Tests
```bash
npx tsx tests/custom-fields-acceptance.test.ts
```
- [ ] 10/10 ผ่าน

### 9.3 ตรวจ Scope Matrix
```bash
npx tsx scripts/check-scope-matrix.ts
```
- [ ] 17+ tables มี organizationId

---

## ขั้นที่ 10: เทส Backup/Restore

### 10.1 สำรองข้อมูล
```bash
bun scripts/pre-migration-backup.ts
```
- [ ] สร้าง backup file ใน db/backups/
- [ ] สร้าง JSON export

### 10.2 ทดสอบ restore
```bash
bun scripts/restore-test.ts db/backups/pre-migration-<timestamp>.db
```
- [ ] RESTORE TEST PASSED

### 10.3 Export TSV
```bash
# Login ก่อน
TOKEN=$(curl -s -X POST http://localhost:3000/api/itam/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"test1234"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Export
curl -s "http://localhost:3000/api/integrations/google-sheets/export-spreadsheet?format=tsv" \
  -H "Authorization: Bearer $TOKEN" -o backup.tsv
```
- [ ] ไฟล์ TSV มีข้อมูลครบ

---

## ขั้นที่ 11: สรุปผลการเทส

| ขั้น | ฟีเจอร์ | ผล |
|---|---|---|
| 1 | เตรียมเครื่อง | ☐ |
| 2 | Login | ☐ |
| 3 | Dashboard | ☐ |
| 4 | Devices | ☐ |
| 5 | Work Orders | ☐ |
| 6 | Meter | ☐ |
| 7 | Stock | ☐ |
| 8 | Settings | ☐ |
| 9 | Security | ☐ |
| 10 | Backup/Restore | ☐ |

เมื่อทำครบ → พร้อม deploy จริง!
