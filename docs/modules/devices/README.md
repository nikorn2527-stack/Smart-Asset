# Devices Module — จัดการอุปกรณ์

**Owner role:** Dev-3 / Asset & Meter Team  
**Primary feature IDs:** F-10, F-16, F-20, F-21, F-22, F-23  
**Consumers:** Repair และ Meter  
**Canonical tables:** `Device`, `DeviceTransfer` และ lifecycle/warranty/utilization relations

## เป้าหมาย

Devices Module เป็นเจ้าของ asset master และประวัติการโอนย้ายอุปกรณ์. งานนำเข้าจาก IT-Asset-Management ต้องใช้ stable external asset key, แยก parser/validator/persistence และรักษา field ที่ ITAM-NextJS เป็นเจ้าของไม่ให้ถูก overwrite โดยพลการ.

Device identity เป็น dependency กลางของ Repair และ Meter. ดังนั้นการเปลี่ยนชื่อหรือ semantics ของ `deviceId`, asset key, site code, owner และ status ต้องประกาศใน PR ให้ทั้งสอง consumer ตรวจสอบก่อน.

## Code surface ที่ทีมควรเริ่มอ่าน

| พื้นที่ | หน้าที่ |
|---|---|
| `src/app/api/devices` | device CRUD, transfer, lifecycle, warranty และ utilization |
| `src/app/api/itam/devices` | canonical device API boundary |
| `src/app/api/devices/import` และ `src/app/api/import` | import/compatibility paths |
| `src/components/itam/devices-page.tsx` | device list และ filter |
| `src/components/itam/device-detail-sheet.tsx` และ `itam-device-detail-sheet.tsx` | device detail/edit surface |
| `prisma/schema.prisma` | `Device` และ `DeviceTransfer` models |
| `src/lib/csv-field-mapping.ts` | legacy header mapping |

## ขอบเขตและ dependency

Devices เป็นเจ้าของ master identity, ownership/site, transfer history, lifecycle และ warranty metadata. Repair อ่าน device reference เพื่อเปิดงานซ่อมแต่ห้ามสร้าง device copy ที่เป็น source of truth ใหม่. Meter บันทึก reading ด้วย `deviceId` ที่ resolve แล้วและต้องตรวจ site/ownership ก่อนบันทึก.

งานระยะแรกคือกำหนด asset key policy, ตรวจ duplicate/import behavior, แยก parser/validator/persistence และตรวจ transfer department-code compatibility. งาน performance ต้องใช้ pagination และ select เฉพาะ field; ห้ามดึง device ทั้งฐานข้อมูลมาไว้ใน browser โดยไม่จำเป็น.

## Definition of Done

งาน Devices จะถือว่าผ่านเมื่อ import เป็น idempotent ด้วย stable asset key, duplicate และ missing key ถูกแยกชัด, ownership policy ไม่ overwrite ข้อมูลที่ระบบเป็นเจ้าของ, transfer ตรวจ from/to site และ actor, lifecycle transition มี authorization/audit, Repair และ Meter ยังคง resolve identity ได้ และ mobile list/detail ใช้งานได้.

Tests ต้องครอบคลุม duplicate asset, unknown site, invalid transfer, cross-site access, overwrite policy, import retry และ missing device reference. Evidence ต้องผูก source revision, row counts/summary ที่ไม่เปิดเผยข้อมูลลับ และผล schema/runtime check.

## ห้ามทำ

ห้ามเปลี่ยน source sheet/column contract เพื่อให้นำเข้าได้ง่ายขึ้น, ห้ามสร้าง asset duplicate เพราะชื่ออุปกรณ์ต่างกันเล็กน้อย, ห้ามบันทึก Meter reading โดยใช้ชื่ออุปกรณ์แทน identity และห้ามแก้ B4 frozen files.
