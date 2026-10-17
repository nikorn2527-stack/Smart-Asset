# Stock Module — สต๊อก

**Owner role:** Dev-2 / Stock Team  
**Primary feature IDs:** F-07, F-11, F-12, F-13, F-14, F-16  
**Consumers:** Repair, Dashboard/Reports และ Document Output  
**Canonical tables:** `StockItem`, `StockTransaction` และ normalized material-issue lines/approval relationตาม schema ที่ผ่านการอนุมัติ

## เป้าหมาย

Stock Module รับผิดชอบข้อมูลสินค้า/วัสดุ จำนวนคงเหลือ การรับเข้า การเบิกออก การอนุมัติ และการตรวจสอบรายการที่ผูกกับงานซ่อม. ข้อมูลที่ Legacy รวม requester, department, purpose, approver และ work-order number ไว้ในข้อความเดียวต้องถูกแยกเป็น semantic fields ที่ query และทำสถิติได้.

ทุก stock mutation ต้องผูกกับ authenticated user ตาม authorization policy. `requester` และ `performedBy` ห้ามรับจาก client เป็น source of truth. หากการผูก WorkOrder จาก legacy job number ไม่ชัดเจน ให้เก็บเป็น unresolved/quarantine ตาม contract และห้ามเดาสุ่ม.

## Code surface ที่ทีมควรเริ่มอ่าน

| พื้นที่ | หน้าที่ |
|---|---|
| `src/app/api/stock-items` | stock item list/detail และ transaction mutation |
| `src/app/api/itam/stock` | canonical stock API boundary |
| `src/app/api/stock-items/pending` | pending approval workflow |
| `src/components/itam/stock-page.tsx` | stock UI และ transaction form |
| `src/components/itam/itam-stock.tsx` | stock view ที่มีอยู่เดิม |
| `src/lib/csv-field-mapping.ts` | StockOut semantic mapping |
| `src/lib/stock-transaction-identity.ts` | session-bound identity helper |
| `src/lib/repair-link-resolution.ts` | WorkOrder resolver ที่ Stock ใช้ร่วมกับ Repair |
| `prisma/schema.prisma` | stock models และ relations |

## ขอบเขตและ dependency

Stock เป็นเจ้าของ quantity, product status และ approval lifecycle. Repair เป็นเจ้าของ WorkOrder lifecycle; Stock จึงอ่าน stable job reference และสร้าง material issue ที่ผูกกลับไปยัง WorkOrder ได้ แต่ห้ามแก้ WorkOrder status โดยตรง. Devices และ Meter ไม่ควรเขียน Stock tables.

งานระยะแรกคือกำหนด product/transaction semantics, quantity validation, pending/approved/rejected flow, duplicate protection และ report ต่อ job. Direct Stock adapter ต้องแยก parser, validator, resolver และ persistence ให้ทดสอบแต่ละชั้นได้ โดย CSV fallback ต้องยังเปิดใช้งานเมื่อต้นทาง direct sync ใช้ไม่ได้.

## Definition of Done

งาน Stock จะถือว่าผ่านเมื่อ stock in/out และ approval ตรวจ permission/site scope, identity มาจาก session, quantity ไม่ติดลบหรือเกิน policy, duplicate/import retry ไม่สร้างรายการซ้ำ, unresolved work-order link ถูก quarantine, transaction audit ตรวจ actor/source ได้ และรายงานต่อ job แยก requester/department/purpose/approver ได้จริง.

UI ต้องแสดง performed-by เป็น read-only เมื่อ policy กำหนด และต้องมี loading, empty, error, pending และ mobile states. Tests ต้องครอบคลุม unauthorized mutation, duplicate transaction, inactive/missing product, unresolved job number, approval boundary และ idempotent retry.

## ห้ามทำ

ห้ามให้ผู้ใช้แก้ requester หรือ performedBy เป็นผู้อื่นผ่าน payload ปกติ, ห้ามใช้ข้อความ combined field เป็น canonical record, ห้ามลด quantity ก่อนผ่าน validation/authorization, ห้ามปิด CSV fallback และห้ามแก้ B4 frozen authorization/audit files เพื่อแก้ปัญหาเฉพาะ module.
