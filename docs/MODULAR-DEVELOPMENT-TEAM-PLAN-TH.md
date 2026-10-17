# ITAM-NextJS Modular Development Team Plan

**สถานะ:** Proposed working agreement สำหรับการพัฒนาร่วมกัน  
**Repository:** `nikorn2527-stack/ITAM-NextJS`  
**Target:** Next.js + TypeScript บน Supabase `ITAM-DB`  
**ผู้อนุมัติ environment และ release:** Release Owner  
**ผู้ตรวจ technical gate:** Audit

## 1. วัตถุประสงค์

จากนี้ให้พัฒนา ITAM-NextJS แบบแยกโมดูลตาม workflow หลัก ไม่ให้ทุกทีมแก้โค้ดปะปนกันในไฟล์เดียว โดยแบ่งเป็น **Repair**, **Stock**, **Devices** และ **Meter** แต่ยังใช้ shared platform เดียวกัน ได้แก่ authentication, authorization, site scope, audit, sync control plane, field mapping, database migration และ UI foundation.

การแยกโมดูลนี้ไม่ได้หมายความว่าแยกฐานข้อมูลหรือทำระบบคนละชุด แต่หมายถึงการแยก ownership, backlog, code surface, test evidence และ acceptance criteria ให้ตรวจสอบได้ง่ายขึ้น ข้อมูลที่เชื่อมกันยังต้องผ่าน canonical identifiers และ contract ที่ประกาศไว้ ห้ามให้แต่ละทีมตีความ field สำคัญคนละแบบ.

> Legacy Apps ทั้งสามระบบยังเป็น read-only reference สำหรับ logic, flow, column semantics และ source contract เท่านั้น การพัฒนาและการปรับปรุงต้องทำใน ITAM-NextJS โดยไม่เปลี่ยน source contract โดยไม่มีเหตุผลและหลักฐานรองรับ

## 2. Team topology ปัจจุบัน

ขณะนี้มีทีม Dev ที่ทำงานได้สามทีม จึงกำหนดชื่อเชิงบทบาทก่อน โดยไม่ผูกกับชื่อบุคคลหรือ GitHub username จนกว่าจะมีรายชื่อสมาชิกยืนยันใน repository.

| Team role | Ownership หลัก | งานรองในระยะเริ่มต้น | สิ่งที่ทีมต้องส่งมอบ |
|---|---|---|---|
| **Dev-1 / Repair Team** | แจ้งซ่อมและ repair workflow | เป็น steward ของ repair-data contract ร่วมกับทีม Stock | code, tests, migration proposal, preview evidence และ handoff note |
| **Dev-2 / Stock Team** | สต๊อก สินค้า การเบิกจ่าย และ approval | material-issue contract ที่เชื่อมกับ Repair | code, quantity/approval tests, duplicate/quarantine evidence และ report correctness |
| **Dev-3 / Asset & Meter Team** | จัดการอุปกรณ์ และจดมิเตอร์ โดยแยก backlog เป็นสองโมดูล | ดูแล compatibility ของ device identity ที่ Meter ใช้อ้างอิง | device/meter code, import/readings tests, mobile evidence และ data integrity note |
| **Shared Platform Steward** | auth, RBAC, site scope, audit, sync, mapping, migration tooling | ประสานงานโดย Dev-1 ในช่วงที่ยังไม่มีทีม platform แยก | contract review, migration ordering และ regression gate |
| **Audit** | technical review และ fail-closed/security gate | ตรวจ exact SHA, tests, B4 frozen และ evidence | verdict ใน PR/Issue; ไม่ใช่ผู้เขียน feature แทน Dev |
| **Release Owner** | environment, risk, staging, canary และ release decision | จัดลำดับการเปิดใช้งานและรับรอง operational evidence | environment decision, go/no-go และการส่งต่อ gate |

หากมีทีม Dev เพิ่มเป็นทีมที่สี่ ให้ย้าย ownership ของ **Meter** ไปเป็น **Dev-4 / Meter Team** ได้โดยไม่เปลี่ยน module contract หรือ schema semantics. การย้าย ownership ต้องทำผ่าน PR ที่แก้เอกสารนี้และอัปเดต module README ที่เกี่ยวข้อง.

## 3. Module map และขอบเขต

| Module | Canonical data ที่เป็นเจ้าของ | API/UI ที่มีอยู่ใน repository | Feature inventory ที่เกี่ยวข้อง |
|---|---|---|---|
| **Repair** | `WorkOrder`, `WorkOrderMessage`, `WorkOrderReview`, `WorkOrderImage`, repair parts request และ job identity | `src/app/api/work-orders`, `src/app/api/public/work-orders`, `src/components/itam/work-orders-page.tsx`, `itam-repairs.tsx`, `itam-work-orders.tsx` | F-00 ถึง F-09, F-12, F-16, F-24 |
| **Stock** | `StockItem`, `StockTransaction`, product/issue/approval semantics และ material issue lines | `src/app/api/stock-items`, `src/app/api/itam/stock`, `src/components/itam/stock-page.tsx`, `itam-stock.tsx` | F-07, F-11 ถึง F-15, F-16, F-20, F-24 |
| **Devices** | `Device`, `DeviceTransfer`, lifecycle, warranty, utilization และ asset master import | `src/app/api/devices`, `src/app/api/itam/devices`, `src/components/itam/devices-page.tsx`, device detail sheets | F-10, F-16, F-20 ถึง F-24 |
| **Meter** | `MeterReading`, meter history, reminders และ device-to-meter reading relationship | `src/app/api/meter`, `src/app/api/itam/meter-readings`, `src/app/api/v1/meter-readings`, `src/components/itam/meter-page.tsx`, `bulk-meter-dialog.tsx`, `itam-meter-*` | F-16, F-20 ถึง F-24 และงาน meter ใหม่ |
| **Shared Platform** | User/auth, site scope, `AuditLog`, `SyncRun`, `SyncRunItem`, mapping, retry และ shared UI/runtime | `src/lib`, `src/app/api/sync`, `src/app/api/import`, dashboard/navigation และ Prisma schema | F-01, F-06, F-08, F-13 ถึง F-15, F-17 ถึง F-24 |

## 4. กติกา ownership ของข้อมูล

แต่ละโมดูลมีสิทธิ์แก้ canonical data ของตนเองเท่านั้น. ตัวอย่างเช่น Repair เป็นเจ้าของสถานะงานซ่อมและ job identity, Stock เป็นเจ้าของจำนวนคงเหลือและสถานะ approval, Devices เป็นเจ้าของ asset master และ transfer history ส่วน Meter เป็นเจ้าของ reading และ reminder state.

โมดูลอื่นอ่านข้อมูลผ่าน relation หรือ stable identifier ที่ประกาศไว้ได้ แต่ห้ามเขียนตารางของอีกโมดูลโดยตรงเพื่อแก้ปัญหาเฉพาะหน้า. หากต้องเปลี่ยนข้อมูลข้ามโมดูล ให้เพิ่มหรือปรับ contract ใน shared boundary พร้อม test ของทั้ง producer และ consumer.

| ความสัมพันธ์ | วิธีเชื่อมที่อนุญาต | สิ่งที่ห้ามทำ |
|---|---|---|
| Repair → Stock | ใช้ `workOrderId` และ stable job references; ส่ง material issue request/สถานะที่ระบุชัด | ให้ Repair แก้ `StockTransaction.quantity` โดยตรง |
| Repair → Devices | ใช้ `deviceId`, asset key หรือ site-scoped device reference | copy ชื่ออุปกรณ์เป็น source of truth ใหม่ใน WorkOrder |
| Meter → Devices | ใช้ `deviceId` และตรวจ site/ownership ก่อนบันทึก reading | บันทึก meter reading โดยไม่มี device identity ที่ตรวจสอบได้ |
| Stock → Repair | ผูก transaction กับ work order แบบ nullable ได้เมื่อ source ยัง resolve ไม่ได้ และ quarantine เมื่อไม่ชัดเจน | เดาสุ่ม work order จากข้อความรวมแล้วเขียนผ่าน |
| ทุก module → Shared Platform | ใช้ auth context, site authorization, audit helper, mapping และ migration process | bypass authorization หรือสร้าง permission ใหม่เอง |

## 5. Branch และ PR workflow

ทุกทีมต้องทำงานบน branch แยกจาก `main` และตั้งชื่อให้บอกโมดูลกับงาน เช่น `feature/repair-completion-guard`, `feature/stock-issue-approval`, `feature/devices-import-validator` หรือ `feature/meter-bulk-reading`. งาน documentation ใช้ `docs/modular-team-plan` หรือชื่อที่บอกขอบเขตชัดเจน.

หนึ่ง PR ควรมีโมดูลหลักเดียว. หากจำเป็นต้องแก้ shared contract ให้ระบุ module consumers ใน PR body และเพิ่ม regression test ของทุก consumer ที่ได้รับผลกระทบ. ห้ามรวมการ refactor ใหญ่, migration ที่ไม่เกี่ยวข้อง และการเปลี่ยน UI คนละโมดูลไว้ใน PR เดียวเพียงเพื่อให้ merge เร็ว.

PR ทุกใบต้องระบุ owner team, feature IDs, changed tables/routes, migration requirement, test commands, mobile check, security/fail-closed result และ rollback consideration. PR จะยังไม่ถือว่าเสร็จจนกว่าจะมี exact commit SHA, clean diff, B4 frozen check และ evidence ที่ Audit ตรวจได้.

## 6. Shared changes ที่ต้องประสานก่อนเขียน

การแก้ `prisma/schema.prisma`, migration, `src/lib/auth*`, authorization, audit, retry, import mapping, sync control plane, navigation shell หรือ shared types ถือเป็น **cross-module change**. เจ้าของโมดูลต้องประกาศผลกระทบใน PR ก่อนเริ่มแก้ และอย่างน้อยต้องให้ทีมที่เป็น consumer ตรวจ contract.

ไฟล์ B4 frozen จำนวนหกไฟล์ต้องคง 0-diff จาก `ee75164` ได้แก่ `retry-transaction.ts`, `wo-authz.ts`, `authorization-context.ts`, `auth-middleware.ts`, `auth-shared.ts` และ `audit.ts`. หากพบ defect ในพื้นที่นี้ ให้เปิด Audit finding และทำ remediation plan แยก ห้ามแก้แทรกใน module PR.

## 7. Definition of Done รายโมดูล

โมดูลจะถือว่าเสร็จเมื่อ schema/API/UI มี semantics เดียวกัน, มี test ทั้ง success และ fail-closed path, มี validation ของ duplicate/invalid input, มี mobile-responsive check, มี evidence บน Preview ที่ผูก exact SHA และผ่าน Audit technical review. Direct sync ยังต้องผ่าน Preview/SyncRun/Quarantine และ CSV fallback ต้องคงอยู่จนกว่า Release Owner จะอนุมัติการเปลี่ยนแปลง.

การมีหน้า UI หรือการที่ endpoint ตอบ `200` เพียงอย่างเดียวไม่ใช่หลักฐานว่าโมดูลเสร็จ. ทีมต้องพิสูจน์ data correctness, actor identity, site scope, idempotency และผลกระทบต่อโมดูลที่เชื่อมกันด้วย.

## 8. ลำดับการเริ่มงานที่แนะนำ

เริ่มพร้อมกันได้สาม workstreams แต่ต้องเรียง dependency ภายในแต่ละโมดูล. Repair และ Stock ควรใช้ repair-data contract ฉบับเดียวกันก่อนพัฒนา workflow ต่อ; Devices ควรตรึง stable device identity ก่อนให้ Meter ขยาย bulk reading; Shared Platform ต้องรับเฉพาะ cross-module changes ที่จำเป็นจริง.

| ระยะ | Repair | Stock | Devices | Meter |
|---|---|---|---|---|
| ระยะ 1 | ตรวจ work-order lifecycle และ material link | ตรวจ product/transaction semantics และ approval | ตรวจ asset key, transfer และ importer | ตรวจ reading model, device reference และ validation |
| ระยะ 2 | completion/reporting/mobile flow | pending issue, quantity และ report ต่อ job | parser/validator/persistence แยกชั้น | bulk entry, duplicate reading และ reminder |
| ระยะ 3 | Services adapter contract | Stock adapter และ idempotency | IT-Asset adapter และ quarantine | dashboard/trend และ resource optimization |

## 9. คำสั่งเริ่มงานสำหรับทีม

แต่ละทีมให้คัดลอก module README ของตนไปใช้เป็น task brief, เปิด branch ตาม naming convention, ตรวจ source/schema ปัจจุบันก่อนแก้ และส่ง PR กลับเข้า `main` โดยระบุ dependency ที่ต้องรอจากทีมอื่น. ห้าม checkout หรือ push ทับ branch ของทีมอื่น และห้ามถือว่า code ใน Legacy Apps เป็นพื้นที่ให้แก้ไขโดยอัตโนมัติ.

รายชื่อสมาชิกจริง, GitHub team slug และผู้ review สำรองจะเติมภายหลังเมื่อ Release Owner ส่งรายชื่อ. จนกว่าจะมีรายชื่อ ให้ใช้ role name ในเอกสารและ PR แทนการเดาชื่อบุคคล.

## References

[1]: https://github.com/nikorn2527-stack/ITAM-NextJS/blob/main/docs/DEVELOPMENT-DIRECTION-FEATURE-INVENTORY-TH.md "ITAM-NextJS Development Direction and Feature Inventory"
[2]: https://github.com/nikorn2527-stack/ITAM-NextJS/blob/main/docs/REPAIR-DATA-CONTRACT-DESIGN-TH.md "Repair Data Contract Design"
[3]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests "GitHub pull request collaboration guidance"
