# ITAM-NextJS Pilot Plan
# แผนการทดสอบกับ Pilot 4 Site

**เวอร์ชั่น:** 1.0
**วันที่:** 2026-09-12
**สถานะ:** รอ deploy

---

## 1. เป้าหมาย

ทดสอบระบบ ITAM-NextJS กับข้อมูลจริงของ 4 Site ก่อนเปิดให้องค์กรอื่นใช้

### Site ที่เข้าร่วม:
1. **UDH** — โรงพยาบาลศูนย์อุดรธานี (Pilot หลัก)
2. **NKP** — นครปฐม
3. **CNX** — เชียงใหม่
4. **BKK-1** — กรุงเทพ

---

## 2. Timeline

| สัปดาห์ | กิจกรรม | ผลลัพธ์ |
|---|---|---|
| 1 | Deploy + Setup Wizard | ระบบพร้อมใช้ + Admin คนแรก |
| 2 | Import Master Data | ข้อมูลมาตรฐานครบ (28 categories) |
| 3 | Import Devices + Work Orders | ข้อมูล 2,406 devices + 4,942 WO |
| 4 | Import Meter Readings + Stock | ข้อมูล 15,485 meter + 7,520 stock txn |
| 5 | ทดสอบใช้งานจริง | User ทดสอบทุก module |
| 6 | ทดสอบ Cross-Org | ตรวจ tenant isolation |
| 7 | ทดสอบ Backup/Restore | สำรอง + กู้คืน |
| 8 | รวบรวม Feedback + แก้ | แก้ปัญหา + ปรับปรุง |
| 9 | สรุปผล + เตรียม Production | พร้อมเปิดให้องค์กรอื่น |

---

## 3. Test Cases

### 3.1 Setup Wizard
- [ ] สร้าง Organization ใหม่ด้วย Wizard (11 steps)
- [ ] Validation ทำงาน (Fail-Closed)
- [ ] Resume ได้หลังปิดหน้า
- [ ] Idempotent (กดซ้ำไม่สร้างข้อมูลซ้ำ)

### 3.2 Master Data
- [ ] 28 categories ครบ (Core/Device/Repair/Stock)
- [ ] Canonical Codes ถูกต้อง (BRD-0001, DEP-0001, ...)
- [ ] Cascading dropdown ทำงาน (DeviceType → Brand → Model)
- [ ] Global Template แยกจาก Org Master

### 3.3 Devices
- [ ] 2,406 devices import สำเร็จ
- [ ] Search/Filter ทำงาน
- [ ] Organization scope กรองถูกต้อง
- [ ] Custom Fields แสดงใน Device detail

### 3.4 Work Orders
- [ ] 4,942 WO import สำเร็จ
- [ ] Status flow ทำงาน (Pending → Assigned → In Progress → Completed)
- [ ] สร้าง WO ใหม่ได้
- [ ] Organization scope กรองถูกต้อง

### 3.5 Meter Readings
- [ ] 15,485 readings import สำเร็จ
- [ ] จดมิเตอร์ใหม่ได้
- [ ] Meter history chart แสดง

### 3.6 Stock
- [ ] 60 items + 7,520 transactions import สำเร็จ
- [ ] Stock in/out ทำงาน
- [ ] Low stock alert แสดง

### 3.7 Security
- [ ] User ใน Org A ไม่เห็นข้อมูล Org B (cross-org test)
- [ ] User ไม่มี orgId → 403
- [ ] Superadmin เห็นได้ทุก org
- [ ] Secret ไม่หลุดไป browser

### 3.8 Backup/Restore
- [ ] Pre-migration backup ทำงาน
- [ ] Restore test ผ่าน
- [ ] Upgrade flow ทำงาน
- [ ] Export TSV ได้

### 3.9 Custom Fields
- [ ] สร้าง definition ได้
- [ ] แสดงใน Device form
- [ ] Validation ทำงาน (required, type, options)
- [ ] Org-scoped (Org A ไม่เห็น field ของ Org B)

---

## 4. Success Criteria

| รายการ | เกณฑ์ |
|---|---|
| แอปใช้ได้ | Login + Dashboard แสดง |
| ข้อมูลครบ | 2,406 devices + 4,942 WO + 15,485 meter |
| Security | Cross-org test ผ่าน (8/8) |
| Backup | Restore test ผ่าน |
| Custom Fields | Acceptance test ผ่าน (10/10) |
| User satisfaction | ไม่มี Critical bug |

---

## 5. Rollback Plan

ถ้า Pilot ล้มเหลว:
1. รัน `bash scripts/upgrade.sh` (auto-rollback ถ้า migration fail)
2. Restore backup: `cp db/backups/pre-migration-<timestamp>.db db/custom.db`
3. แจ้งผู้ใช้: "ระบบกำลังกู้คืน — กรุณารอ 15 นาที"
4. ตรวจสอบสาเหตุ + แจ้งทีม dev
5. บันทึกเหตุการณ์ใน Audit Log
