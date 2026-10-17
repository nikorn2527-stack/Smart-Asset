# ข้อกำหนด: นำเข้าข้อมูล Asset Categories + Contact Directory

**วันที่:** 2026-09-08
**สถานะ:** ร่างข้อกำหนด (พร้อมส่งทีมพัฒนา)
**ผู้ขอ:** ผู้ใช้ (เจ้าของระบบ)

---

## บทนำ

ระบบ ITAM มีข้อมูล 2 ประเภทที่ต้องคีย์ทีละรายการผ่าน UI เท่านั้น ไม่มี bulk import:

1. **Asset Categories** — หมวดหมู่ครุภัณฑ์สำหรับตั้งค่าค่าเสื่อมสภาพแยกตามประเภท
2. **Contact Directory** — สมุดโทรศัพท์/ผู้ติดต่อ (ช่างเทคนิค, ผู้ประสานงาน)

ทั้ง 2 ประเภทเก็บเป็น list/array ที่ทำ bulk import ได้ง่าย (entity ไม่ซับซ้อน เหมือน device/work-order ที่มี relation เยอะ)

---

## 1. Import Asset Categories

### ปัญหา
- องค์กรราชการมีหมวดหมู่ครุภัณฑ์ตามระเบียบกรมบัญชีกลาง 10-20 ประเภท
- ต้องเพิ่มทีละอันในฟอร์ม UI (Settings → หมวดหมู่สินทรัพย์)
- ใช้เวลานาน + พิมพ์ผิดได้

### ข้อกำหนด
- **Endpoint:** `POST /api/itam/asset-categories/import`
- **Input:** CSV file หรือ JSON array
- **Permission:** `SYSTEM_CONFIG` (admin only)
- **Behavior:** Upsert (ถ้า code ซ้ำ → อัปเดต, ถ้าใหม่ → สร้าง)
- **Response:** `{ imported: N, updated: N, skipped: N, errors: [...] }`

### CSV Format
```csv
code,name,usefulLifeYears,salvageValuePercent,defaultValueLifeYears,defaultSalvageValue,active
IT-COMPUTER,คอมพิวเตอร์,3,10,3,10,true
IT-PRINTER,เครื่องพิมพ์,5,5,5,5,true
IT-NETWORK,อุปกรณ์เครือข่าย,5,10,5,10,true
IT-VEHICLE,ยานพาหนะ,10,5,10,5,true
```

| Column | Required | Type | หมายเหตุ |
|---|---|---|---|
| `code` | ✅ | string | รหัสหมวดหมู่ (unique) เช่น `IT-COMPUTER` |
| `name` | ✅ | string | ชื่อหมวดหมู่ (ไทย/อังกฤษ) |
| `usefulLifeYears` | ❌ | int | อายุการใช้งาน (ปี) — default จาก category ถ้าไม่ระบุ |
| `salvageValuePercent` | ❌ | float | ร้อยละมูลค่าซาก (0-100) — default 10 |
| `defaultValueLifeYears` | ❌ | int | อายุการใช้งาน default สำหรับ device ที่ไม่ระบุ |
| `defaultSalvageValue` | ❌ | float | มูลค่าซาก default |
| `active` | ❌ | bool | true/false — default true |

### Acceptance Criteria
- [ ] อัปโหลด CSV ได้ (drag & drop หรือเลือกไฟล์)
- [ ] แสดง preview ก่อน import (โชว์ 5 แถวแรก)
- [ ] ถ้า code ซ้ำ → อัปเดต (ไม่ error)
- [ ] ถ้า code ใหม่ → สร้าง
- [ ] แสดงสรุปผล: imported N, updated N, skipped N, errors N
- [ ] Export ได้ (ดาวน์โหลดเป็น CSV)

---

## 2. Import Contact Directory

### ปัญหา
- รายชื่อช่างเทคนิค/ผู้ประสานงานแต่ละสาขา ต้องเพิ่มทีละคนใน UI
- มักมี 10-50 คนต่อสาขา → ใช้เวลานาน

### ข้อกำหนด
- **Endpoint:** `POST /api/itam/contacts/import`
- **Input:** CSV file หรือ JSON array
- **Permission:** `SYSTEM_CONFIG` (admin only)
- **Storage:** AppSetting key `contactDirectory` (JSON array — เหมือนที่มีอยู่)
- **Behavior:** Merge (ถ้า id/name+site ซ้ำ → อัปเดต, ถ้าใหม่ → เพิ่ม)

### CSV Format
```csv
name,role,phone,email,siteCode,department,active
สมชาย ใจดี,ช่างเทคนิค,081-234-5678,somchai@itam.local,HQ,IT,true
มาลี รักงาน,ผู้ประสานงาน,082-345-6789,malee@itam.local,UDH,บริหาร,true
```

| Column | Required | Type | หมายเหตุ |
|---|---|---|---|
| `name` | ✅ | string | ชื่อ-นามสกุล |
| `role` | ❌ | string | ตำแหน่ง (ช่างเทคนิค, ผู้ประสานงาน, ฯลฯ) |
| `phone` | ❌ | string | เบอร์โทร |
| `email` | ❌ | string | อีเมล |
| `siteCode` | ❌ | string | รหัสสาขา (ถ้าว่าง = ALL) |
| `department` | ❌ | string | แผนก |
| `active` | ❌ | bool | true/false — default true |

### Acceptance Criteria
- [ ] อัปโหลด CSV ได้
- [ ] แสดง preview ก่อน import
- [ ] ถ้า name+siteCode ซ้ำ → อัปเดต
- [ ] ถ้าใหม่ → เพิ่ม
- [ ] แสดงสรุปผล
- [ ] Export ได้

---

## ลำดับความสำคัญ
1. **Asset Categories** ก่อน — เพราะเพิ่งคุยเรื่องค่าเสื่อมสภาพ และมีหลายสิบประเภทตามระเบียบ
2. **Contact Directory** ตาม — จำนวนรายชื่อมักเยอะกว่า

## ความพยายามประมาณการ
- Asset Categories: งานเล็ก (~2-3 ชม.) — entity ง่าย ไม่มี relation
- Contact Directory: งานเล็ก (~2-3 ชม.) — เก็บใน JSON array ไม่ต้องสร้าง model

---

*เอกสารนี้พร้อมส่งทีมพัฒนาได้เลย*
