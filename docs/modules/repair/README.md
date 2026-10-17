# Repair Module — แจ้งซ่อม

**Owner role:** Dev-1 / Repair Team  
**Primary feature IDs:** F-02, F-03, F-04, F-05, F-07, F-09  
**Consumers:** Stock, Devices, Dashboard/Reports และ Notification  
**Canonical tables:** `WorkOrder`, `WorkOrderMessage`, `WorkOrderReview`, `WorkOrderImage` และ repair-part/material issue relation

## เป้าหมาย

Repair Module รับผิดชอบ workflow งานแจ้งซ่อมตั้งแต่การสร้างงาน การระบุผู้แจ้ง/สถานที่/อุปกรณ์ การมอบหมาย การบันทึกความคืบหน้า การแนบภาพ และการปิดงาน โดยต้องรักษา traceability ของเลขงานเดิมและเลขงานระบบใหม่ตาม repair-data contract.

เลข `legacy_job_no` ต้อง immutable และใช้สำหรับการตรวจย้อนกลับจากข้อมูล Legacy. เลข `system_job_no` เป็นเลขของ ITAM-NextJS ที่ต้องมี policy เรื่อง series และ uniqueness ชัดเจน. ห้ามใช้ข้อความรวมจาก Legacy เป็น source of truth สำหรับ material หรือ requester.

## Code surface ที่ทีมควรเริ่มอ่าน

| พื้นที่ | หน้าที่ |
|---|---|
| `src/app/api/work-orders` | Work Order list/create/detail/status API |
| `src/app/api/public/work-orders` | public/guest intake boundary ที่ต้อง fail-closed |
| `src/components/itam/work-orders-page.tsx` | หน้ารายการและ workflow หลัก |
| `src/components/itam/itam-repairs.tsx` และ `itam-work-orders.tsx` | repair UI ที่มีอยู่เดิม |
| `src/lib/repair-data-contract.ts` | mapping boundary ของข้อมูล Legacy |
| `src/lib/repair-link-resolution.ts` | resolver สำหรับผูก material issue กับ job number |
| `src/lib/repair-job-references.ts` | รวม stable job references |
| `src/lib/repair-identity.ts` | ผูก requester กับ authenticated user |
| `prisma/schema.prisma` | WorkOrder และ relation ที่เกี่ยวข้อง |

## ขอบเขตและ dependency

Repair เป็นเจ้าของ lifecycle และ job identity แต่ไม่เป็นเจ้าของ stock quantity, device master หรือ meter reading. เมื่อขอวัสดุให้ส่งผ่าน material issue contract ที่มี `workOrderId` หรือ stable job references; หาก resolver ไม่มั่นใจต้อง quarantine ไม่ควรเดาจาก subject หรือข้อความรวม. เมื่ออ้างอุปกรณ์ให้ใช้ `deviceId` หรือ stable asset key และตรวจ site scope.

งานที่ควรเริ่มก่อนคือ audit lifecycle และ completion guard, ตรวจ reporter/actor binding, ตรวจ mobile flow และสร้าง test สำหรับ dual job numbers. Direct Services adapter ต้องรอ contract และ sync control plane ที่ผ่าน shared-platform review; CSV fallback ต้องยังใช้งานได้.

## Definition of Done

งาน Repair จะถือว่าผ่านเมื่อสร้างและค้นงานด้วยเลขเดิม/เลขใหม่ได้, requester และ actor มาจาก session ตาม policy, status transition ตรวจสิทธิ์และ required fields, complete ไม่ผ่านเมื่อมี pending material issue, import/sync ที่ resolve ไม่ได้ถูก quarantine, และทุก mutation มี audit/evidence ที่ไม่เปิดเผย secret.

UI ต้องมี loading, empty, error และ mobile state. Test ต้องครอบคลุม duplicate job number, cross-site access, invalid transition, unresolved material link, guest validation และ retry/idempotency. PR ต้องระบุผลกระทบต่อ Stock และ Devices หากแก้ contract ร่วม.

## ห้ามทำ

ห้ามแก้ Apps Script เพื่อทำให้ test ผ่านโดยไม่มี necessity evidence, ห้ามแก้ B4 frozen files, ห้ามเชื่อ client-supplied requester, ห้ามเขียน stock transaction ตรงจาก Repair และห้ามประกาศว่า feature เสร็จจากการที่หน้า UI แสดงผลได้เพียงอย่างเดียว.
