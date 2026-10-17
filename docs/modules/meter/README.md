# Meter Module — จดมิเตอร์

**Owner role:** Dev-3 / Asset & Meter Team  
**Future owner:** Dev-4 / Meter Team หากมีการเพิ่มทีม  
**Primary feature IDs:** F-16, F-20, F-21, F-22, F-23 และ meter backlog ใหม่  
**Canonical table:** `MeterReading` รวมถึง reminder/config relation ที่ผ่านการอนุมัติ

## เป้าหมาย

Meter Module รับผิดชอบการบันทึกและค้นประวัติค่า meter ของอุปกรณ์ การกรอกแบบ bulk การตรวจค่าผิดปกติ การแจ้งเตือน และการแสดงแนวโน้ม. ทุก reading ต้องผูกกับ `deviceId` ที่ตรวจสอบได้และต้องอยู่ภายใต้ site/ownership scope ของผู้ใช้งาน.

ในระยะที่ยังไม่มี Dev-4 ให้ Dev-3 ดูแล Meter เป็น workstream แยกจาก Devices แม้ใช้ทีมเดียวกัน. ห้ามรวม backlog หรือ test จนทำให้ไม่สามารถระบุได้ว่า defect อยู่ใน device identity หรือ meter reading semantics.

## Code surface ที่ทีมควรเริ่มอ่าน

| พื้นที่ | หน้าที่ |
|---|---|
| `src/app/api/meter` | meter reading และ reminder API |
| `src/app/api/itam/meter-readings` | canonical reading API |
| `src/app/api/v1/meter-readings` | external/versioned reading boundary |
| `src/components/itam/meter-page.tsx` | meter list/history UI |
| `src/components/itam/bulk-meter-dialog.tsx` | bulk entry workflow |
| `src/components/itam/itam-meter.tsx`, `itam-meter-unified.tsx`, `itam-meter-keyboard.tsx` | existing meter UI variants |
| `prisma/schema.prisma` | `MeterReading` และ relation กับ Device |

## ขอบเขตและ dependency

Meter อ่าน device identity จาก Devices แต่เป็นเจ้าของ reading record, validation result, history และ reminder state. การเปลี่ยนแปลงใน `Device` หรือ site ownership ต้องให้ Meter ตรวจ consumer impact. Repair และ Stock ไม่ควรเขียน Meter data.

งานระยะแรกคือกำหนด reading period/actor semantics, duplicate policy, monotonicityหรือ range validation ตามชนิด meter, bulk error row behavior และ reminder schedule ที่ไม่ทำให้ mutation หลักล้ม. การทำ dashboard/trend ต้อง query แบบ bounded และใช้ aggregation ที่ฐานข้อมูลเมื่อเหมาะสม.

## Definition of Done

งาน Meter จะถือว่าผ่านเมื่อบันทึก reading ได้เฉพาะ device ที่ resolve และอยู่ใน scope, duplicate period ถูกปฏิเสธหรือจัดการตาม policy, ค่าผิดช่วงถูกแจ้งชัด, bulk upload แยก success/error rows โดยไม่เขียนรายการเสีย, history แสดง actor/time/site ได้ และ reminder failure ไม่ทำให้การบันทึกหลักล้ม.

UI ต้องรองรับมือถือและ keyboard/bulk flow พร้อม loading, empty, error, retry และ permission states. Tests ต้องครอบคลุม unknown device, cross-site access, duplicate period, invalid value, bulk partial failure, retry/idempotency และ reminder failure isolation.

## ห้ามทำ

ห้ามบันทึก reading ด้วยชื่อหรือเลขที่ผู้ใช้พิมพ์โดยไม่ resolve device identity, ห้ามให้ offline queue เขียนข้อมูล stale ทับค่าใหม่โดยไม่มี conflict policy, ห้ามดึง history ทั้งหมดโดยไม่มี pagination และห้ามแก้ B4 frozen files.
