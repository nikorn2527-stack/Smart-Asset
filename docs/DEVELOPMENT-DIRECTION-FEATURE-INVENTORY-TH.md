# ITAM-NextJS Development Direction & Feature Inventory

**สถานะเอกสาร:** Working baseline สำหรับ feature branch `feature/itam-next-direction-repair-workflow`

**เป้าหมาย:** พัฒนา ITAM-NextJS ให้เป็นระบบหลักบน Next.js + TypeScript และ ITAM-DB โดยใช้ Legacy Apps ทั้งสามระบบเป็น read-only reference สำหรับ logic, flow และ source data contract เท่านั้น ไม่คัดลอก implementation เดิมทั้งชุด และไม่เปลี่ยน source contract เพื่อให้ระบบใหม่รองรับข้อมูลเดิมได้โดยตรง

> เอกสารนี้เป็น baseline สำหรับการวางงานและการตรวจรับ ไม่ใช่หลักฐานว่า feature ใดเสร็จแล้วจนกว่าจะมี code, test และ runtime evidence ผูกกับ commit ที่ตรวจสอบได้

## 1. กติกากลางที่ทุก feature ต้องปฏิบัติตาม

| กติกา | เกณฑ์ปฏิบัติ |
|---|---|
| Platform | Next.js App Router + TypeScript เป็น implementation platform หลัก |
| Database | ITAM-DB บน Supabase เป็นฐานข้อมูลเป้าหมายหลัก; ใช้ migration ที่ตรวจสอบได้และห้ามใช้ `prisma db:push` |
| Legacy reference | อ่าน Legacy Apps เพื่อเข้าใจ logic, flow, column semantics และ source contract; ห้ามแก้ Apps Script เว้นแต่พิสูจน์แล้วว่าจำเป็นและต้องรายงาน version, impact และ rollback |
| Source contract | ถือชื่อ sheet, column และรูปแบบข้อมูลเดิมเป็น stable contract; mapping และ adaptation อยู่ใน ITAM-NextJS |
| Data model | แยกข้อมูลที่ Legacy รวมกันให้เป็น relational structure ที่วิเคราะห์ต่อได้ เช่น repair job, material issue, requester และ work-order line |
| Job numbering | เก็บ `legacy_job_no` แบบ immutable เพื่อ traceability และสร้าง `system_job_no` สำหรับเลขงานระบบใหม่ โดยกำหนด policy ว่าจะรันต่อหรือใช้ series ใหม่ก่อนเปิดใช้จริง |
| Security | ไม่ส่ง password, hash, salt, API key, token หรือ `DATABASE_URL` ไปยัง browser, chat, audit log หรือ source payload ที่ไม่จำเป็น |
| Governance | Dev ทำงานบน feature branch; Release Owner ตัดสินใจ environment/risk/release; Audit ตรวจ technical gate; GitHub เป็น Single Source of Truth |
| Frozen baseline | ไฟล์ B4 จำนวน 6 ไฟล์ต้องคง 0-diff จาก `ee75164` |
| Authorization | ไม่เพิ่ม `SYNC_RUN` permission โดยพลการ; ใช้ authorization context และ site scope ที่มีอยู่ พร้อม fail-closed |
| Compatibility | CSV upload ต้องคงเป็น fallback จนกว่า direct sync จะผ่าน staging/operational evidence และได้รับอนุมัติให้ถอดออก |
| UI | ทุกหน้าต้อง mobile-responsive, มี loading/empty/error state และผูกตัวตนผู้ใช้ปัจจุบันอัตโนมัติใน field ที่เกี่ยวข้อง |

## 2. Environment และหลักฐานการทดสอบ

| Environment | บทบาท | ขอบเขตการใช้งาน |
|---|---|---|
| Preview/branch alias | สภาพแวดล้อมทดสอบของ Dev สำหรับ workflow เช่น งานแจ้งซ่อม | ใช้ทดสอบ feature และข้อมูลทดสอบเท่านั้น; dashboard ที่เห็นโดยไม่มี JWT อาจเป็น preview fallback |
| Production alias | สภาพแวดล้อมใช้งานจริง | ตรวจ Login และข้อมูลจริงแยกจาก Preview; ห้ามใช้ Preview result แทน Production evidence |
| ITAM-DB | ฐานข้อมูลเป้าหมาย | ต้องตรวจ source/target และสิทธิ์ให้ชัดเจนก่อน data write |
| CSV fallback | ช่องทางสำรอง | ต้องยังทำงานได้ตลอดช่วง migration/sync rollout |

การเห็นหน้า dashboard หรือข้อมูลว่างไม่ใช่หลักฐานของการ Login สำเร็จ ต้องมี URL ที่ถูกต้อง, JWT/session ที่ออกโดย route และ/หรือ runtime evidence เช่น `lastLoginAt` เปลี่ยนในฐานข้อมูลโดยไม่เปิดเผย token หรือ password

## 3. Feature inventory และ acceptance baseline

| ID | ความสามารถ | เป้าหมายการพัฒนา | สถานะ baseline | Acceptance criteria ระดับ feature |
|---|---|---|---|---|
| F-00 | Production Login และ session | ให้ owner และผู้ใช้จริงเข้า Production ได้ด้วยบัญชีจาก ITAM-DB | Runtime เชื่อมต่อ DB แล้ว; ต้องยืนยัน credential จริงแยกจาก Preview | Invalid credential ได้ 401 ไม่ใช่ 500; valid credential ออก JWT/session และ `/api/itam/auth/me` ยืนยันตัวตนได้; rate limit ทำงาน; ไม่มี secret ใน response/log |
| F-01 | RBAC และ site authorization | คุม role, permission และ Site scope แบบ fail-closed | มี auth/RBAC implementation และ B4 frozen baseline | ปุ่ม, API และ mutation ตรวจสิทธิ์; cross-site ถูกปฏิเสธ; `ALL` ไม่ขยายสิทธิ์ให้ non-superadmin; ทุก route มี test matrix |
| F-02 | Repair job core | สร้าง, แก้ไข, มอบหมาย, เปลี่ยนสถานะ และติดตามงานแจ้งซ่อม | มี Work Order UI/API เดิม ต้อง audit behavior กับ ITAM-DB | ผู้ใช้สร้างงานได้โดย auto-link reporter; มี status lifecycle; บันทึก actor/time/site; mobile flow ใช้งานได้ |
| F-03 | Repair completion และ reporter flow | ปรับปรุงงานปิดซ่อม, guest validation และการแก้ข้อมูลผู้แจ้งตาม policy | มี worklog เดิมสำหรับ `WO-COMPLETE`; ต้องตรวจ exact behavior | ตรวจ required fields ก่อน complete; reporter edit จำกัดสิทธิ์; complete แล้วไม่ย้อนสถานะโดย fail-open; audit ครบ |
| F-04 | รูปภาพหลายช่วงและ QR งานซ่อม | แนบภาพตาม stage และเปิดงาน/อุปกรณ์ด้วย QR ได้ | มี worklog `WO-MULTIIMG-QR`; ต้องตรวจ schema, storage และ UI บน branch | จำกัดชนิด/ขนาดไฟล์; ไม่เผย secret; QR scan map ไป record ที่ถูกต้อง; mobile camera flow มี error/permission state |
| F-05 | เลขงานสองระบบ | รองรับเลขเดิมและเลขใหม่พร้อม traceability | เป็น requirement ใหม่ที่ต้องออกแบบ schema/migration | `legacy_job_no` immutable; `system_job_no` unique ตาม series; import/sync ไม่ชนเลข; search/export แสดงทั้งสองเลขเมื่อเหมาะสม |
| F-06 | Field mapping layer | แปลงชื่อคอลัมน์ไทย/Legacy เป็น field ภาษาอังกฤษใน code ของ ITAM-NextJS | มี `csv-field-mapping.ts`/`csv-mapping.ts` บางส่วน | mapping versioned/tested; unknown field และ type mismatch ถูกแจ้ง; source contract ไม่ถูกแก้; mapping ใช้ร่วมกับ CSV และ adapter ได้ |
| F-07 | Data normalization ของงานซ่อม | แยก repair job, materials issued, requester, department และ line items จากข้อมูลรวม | เป็น design/implementation work ใหม่ | งานหนึ่งมี material lines หลายรายการ; เก็บผู้เบิกและ purpose; aggregate สถิติได้; import เดิมไม่สูญเสีย traceability |
| F-08 | Manual Sync control plane | ให้ผู้มีสิทธิ์กด Preview/Sync Now จาก ITAM-NextJS โดย backend เป็นผู้ดึง source | มี feature brief และ `SyncRun` migration บางส่วน; rollout ยัง gated | มี run state, requestedBy, source/entity, counts, cursor และ error details; Preview ไม่เขียน business data; Apply ตรวจสิทธิ์ซ้ำ |
| F-09 | Services → Work Orders adapter | เริ่ม direct sync MVP จาก legacy Services | contract/adapter ยังต้องผูกกับ source จริงหรือ contract-equivalent evidence | normalize `sourceSystem`, `sourceId`, subject/status/site/location/details/reporter/priority/assignedTo/timestamps; source ที่ไม่มี/ไม่รู้จัก site ถูก quarantine |
| F-10 | IT-Asset-Management → Devices/master data | นำเข้า device และ master data ด้วย stable external key | importer/mapping เดิมมีอยู่; ต้องแยก parser/validator/persistence | upsert ด้วย asset key; ownership policy ชัด; ไม่ overwrite field ที่ ITAM เป็นเจ้าของโดยพลการ; ไม่ sync credential |
| F-11 | Stock → Products/Transactions | แยก stock product และ transaction จาก source เดิม พร้อมเชื่อม work order | มี Stock UI/API และ worklog `STOCK-LINK`; direct source adapter ยังต้องตรวจ | stable `sourceKey`; duplicate/processed/product missing/inactive แยกชัด; quantity validation; requester/department auto-link จาก user |
| F-12 | Stock pending approval และ work-order link | ทำให้การเบิกวัสดุ/หมึกสัมพันธ์กับ job และ approval ได้ | มีบางส่วนใน code/worklog ต้อง verify against current schema | pending/approved/rejected/audited lifecycle; workOrder relation; ไม่ให้ผู้ใช้แก้ requester เป็นคนอื่นโดยไม่มีสิทธิ์; report ต่อ job ได้ |
| F-13 | CSV import fallback | รักษา CSV เป็นทางเลือกสำรองระหว่าง direct sync | มี `/api/import` และ UI | mapping/validation/error row ทำงาน; import ซ้ำไม่สร้าง duplicate; ยังเปิดใช้งานได้แม้ sync source unavailable |
| F-14 | Idempotency, duplicate, retry, quarantine | ทำให้ sync และ import ปลอดภัยเมื่อกดซ้ำหรือ source ผิดพลาด | มี B4 retry/authorization constraints และ sync brief | stable key ต่อ entity; transient error retry จำกัด; validation/auth/schema error ไม่ retry ถี่; partial run retry เฉพาะ failed items |
| F-15 | Audit trail และ operational evidence | ตรวจย้อนหลังได้ว่าใครทำอะไรกับ source/target ใด | มี audit helpers และข้อกำหนดใน sync brief | audit มี actor/source/sourceId/syncRun/site/action; ไม่มี credential; run evidence ผูก exact SHA และ environment |
| F-16 | Dashboard, reports และ PDF export | สรุปงานซ่อม, stock, device และ export ให้ผู้บริหาร/ผู้ปฏิบัติงาน | มี feature worklogs สำหรับ dashboard/PDF export; ต้องตรวจ data correctness | ตัวเลขมาจาก relational data จริง; filter ตาม site/role; export ไม่รั่วข้อมูล; empty/error states ชัด |
| F-17 | Notification/Alerts และ LINE integration | แจ้งเตือนงานหรือเหตุการณ์ที่จำเป็นโดยไม่ผูกระบบจนเกินไป | มี worklog `NOTIFY-LINE`; ต้องแยก notification preference/provider | in-app alert มี read/unread; external notification opt-in/configurable; failure ไม่ทำให้ mutation หลักล้ม; token อยู่ server secret |
| F-18 | Templates, stickers และ document output | ให้ปรับ template เอกสาร/สติกเกอร์และพิมพ์/export ได้ | มี worklogs `A4-TEMPLATES`, `VISUAL-TEMPLATE-EDITOR`, `STOCK-DOCS`, `Task 30` | template validation/version; preview ตรง output; bulk print bounded; authorization ของ template; PDF/print มี field ที่ traceable |
| F-19 | Settings และ master configuration | จัดการตัวเลือกสถานะ, logo, template และ app settings จาก UI | มี worklog `A7-SETTINGS`; ต้องตรวจ schema/permission | settings แยกตาม scope; validation; audit; ไม่เก็บ secret เป็น plain text; preview ใช้ค่าเดียวกับ runtime |
| F-20 | Performance และ mobile operation | ลด resource usage และใช้งานบนมือถือ/ข้อมูลจำนวนมากได้ | มี worklog PWA, SSE, QR, virtual scrolling, saved filters | pagination/virtual list; query select เฉพาะ field; no unbounded fetch; mobile layout; SSE มี reconnect/backoff; PWA offline behavior ไม่เขียนข้อมูลผิด |
| F-21 | Search, saved filters และ navigation | ลดเวลาค้นงาน/อุปกรณ์/stock ของผู้ใช้ | มี worklog `29-Phase7`; ต้อง verify query/index และ permission | search filter ตาม role/site; saved filter ไม่รั่วข้าม user; empty/error/loading state; URL state shareable ตาม policy |
| F-22 | PWA/offline boundary | ใช้งานบนอุปกรณ์เคลื่อนที่ได้ดีโดยไม่ทำให้ข้อมูล stale ถูกเขียนทับ | มี PWA baseline; ต้องกำหนด offline scope | offline ใช้ดู/cache ได้ตาม policy; mutation ต้อง online หรือมี queue ที่ปลอดภัย; service worker ไม่ cache secret |
| F-23 | Real-time updates | แสดงการเปลี่ยนแปลงของ work order/stock ที่สำคัญโดยใช้ resource ต่ำ | มี SSE worklog; ต้องตรวจ production readiness | event ไม่มีข้อมูลลับ; reconnect จำกัด; client invalidates query อย่างถูกต้อง; fallback polling/refresh ใช้ได้ |
| F-24 | Developer/Audit self-verification | ให้ทุก feature ตรวจตัวเองก่อน handoff | governance requirement | มี unit/integration/HTTP/manual evidence; clean checkout; B4 0-diff; no `db:push`; no new permission without review; branch/PR exact SHA |

## 4. Modular team plan

การแบ่งงานและ ownership ของทีม Dev ให้ใช้เอกสาร [`MODULAR-DEVELOPMENT-TEAM-PLAN-TH.md`](./MODULAR-DEVELOPMENT-TEAM-PLAN-TH.md) เป็น working agreement กลาง และใช้ module brief ต่อไปนี้เป็น task boundary: [`Repair`](./modules/repair/README.md), [`Stock`](./modules/stock/README.md), [`Devices`](./modules/devices/README.md) และ [`Meter`](./modules/meter/README.md). เอกสารดังกล่าวไม่เปลี่ยน acceptance baseline ของ F-00 ถึง F-24 แต่ช่วยแยก owner, dependency, code surface และ evidence ต่อโมดูลให้ตรวจสอบง่ายขึ้น.

## 5. ลำดับ implementation ที่เสนอ

ลำดับแรกคือทำ baseline ของงานแจ้งซ่อมบน Preview ให้เห็นข้อมูลและ workflow ที่ตรวจสอบได้ โดยไม่แก้ source contract และไม่แตะ Production code path ที่ถูก freeze จากนั้นจึงทำ normalized model และ mapping layer ให้รองรับข้อมูล Legacy อย่างไม่สูญเสีย `legacy_job_no` และข้อมูลวัสดุที่ผูกกับ job

ลำดับ direct sync ให้เริ่มจาก control plane และ Services → Work Orders ตาม feature brief: `SyncRun/SyncRunItem`, Preview no-write, site authorization, stable source key, idempotent upsert และ error/quarantine ก่อนเพิ่ม Devices และ Stock เป็น adapter แยกกัน CSV fallback ต้องคงไว้ตลอด

งาน template, dashboard, notification, PWA, SSE, QR และ performance จะจัดเป็น work packages ต่อเนื่องหลัง core data/workflow ผ่าน acceptance criteria เพื่อป้องกันการเพิ่ม UI ก่อน data semantics และ authorization ถูกต้อง

## 6. Definition of Done ต่อ feature

ฟีเจอร์จะยังไม่ถือว่าเสร็จจากการมีหน้า UI เพียงอย่างเดียว ต้องมี schema/API/UI ที่สอดคล้องกัน, test ที่ครอบคลุม success และ fail-closed path, runtime/manual evidence บน Preview, mobile check, audit/security review และเอกสาร handoff ที่ผูกกับ exact commit SHA โดยไม่กระทบ Production หรือ B4 frozen files

## 7. แหล่งอ้างอิงภายใน repository

- `Legacy-Apps-Sync-Feature-Brief-TH.md`
- `docs/TASK-legacy-sync.md`
- `docs/PR-SYNC-3-STOCK-SCOPE.md`
- `src/lib/csv-field-mapping.ts`
- `src/lib/csv-mapping.ts`
- `src/components/itam/itam-repairs.tsx`
- `src/components/itam/itam-work-orders.tsx`
- `src/components/itam/itam-stock.tsx`
- `src/components/itam/work-orders-page.tsx`
- `prisma/schema.prisma`
- `agent-ctx/WO-COMPLETE-full-stack-developer.md`
- `agent-ctx/WO-MULTIIMG-QR-full-stack-developer.md`
- `agent-ctx/29-Phase7-orchestrator.md`
- `agent-ctx/STOCK-LINK-full-stack-developer.md`
- `agent-ctx/NOTIFY-LINE-full-stack-developer.md`
- `agent-ctx/VISUAL-TEMPLATE-EDITOR-full-stack-developer.md`
- `agent-ctx/30-full-stack-developer.md`

**ข้อควรจำ:** เอกสารและ worklog เหล่านี้เป็นข้อมูลประกอบการตรวจ ต้องยืนยันกับ source code, schema, tests และ runtime evidence ปัจจุบันทุกครั้งก่อนประกาศว่า feature เสร็จ

เอกสาร modular plan เป็น working agreement ด้านการแบ่งทีม ไม่ใช่หลักฐานว่า feature ใดผ่าน acceptance แล้ว.

## 8. Repository baseline ที่ตรวจจาก source code ปัจจุบัน

การตรวจ baseline รอบแรกพบว่า ITAM-NextJS มีแกนงานแจ้งซ่อมอยู่แล้ว แต่ยังไม่ใช่ normalized model ตามทิศทางใหม่ทั้งหมด ดังนั้นงานต่อไปควรเป็นการยกระดับแบบเพิ่มความสามารถโดยรักษา compatibility เดิม ไม่ควรสร้าง WorkOrder ใหม่ซ้ำทั้งชุด

| พื้นที่ | สิ่งที่มีอยู่จริง | ช่องว่างที่ต้องพัฒนาต่อ |
|---|---|---|
| WorkOrder schema | มี `woNumber`, `requestId`, subject, reporter fields, device/site, status lifecycle, assignment, resolution, images, messages และ optimistic `version` | ยังไม่มี field แยก `legacy_job_no` กับ `system_job_no` อย่างชัดเจน และข้อมูลผู้แจ้งยังเป็น denormalized text หลายช่อง |
| Job number | `POST /api/work-orders` ใช้ active `WoNumberPattern` และมี fallback PPIT/new format | ต้องเพิ่ม policy และ immutable legacy traceability โดยไม่ให้ import/sync ชนเลขระบบใหม่ |
| Idempotency | `requestId`/`clientMutationId` ถูกใช้ป้องกันการสร้าง WorkOrder ซ้ำ | ต้องกำหนด stable external key ต่อ source และ mapping เข้ากับ `legacy_job_no`/source metadata อย่างตรวจสอบได้ |
| Materials/stock | `StockTransaction` มี `workOrderId`, `workOrderNo`, requester, department, purpose, approval fields และ parts API แยกจาก WorkOrder | ยังเป็นการผูกแบบกว้าง/ซ้ำช่องทาง และยังไม่มี canonical material-issue line model ที่รับประกันหนึ่งรายการต่อ job/item/ผู้เบิกและทำสถิติได้ตรง |
| Authorization | list/create API ใช้ `requireAuth`, permission และ site scope แบบ fail-closed; legacy rows ใช้ device.site fallback | feature ใหม่ต้องรักษา authz context เดิมและไม่เพิ่ม `SYNC_RUN` permission โดยไม่มี review |
| Mapping/Sync | `sync-adapter.ts` ใช้ `FIELD_MAPPINGS`, `STATUS_MAPPINGS`, source retry, redaction, site allowlist, preview no-write และ quarantine | ต้องทำ mapping ให้ครอบคลุม source contract จริงของทั้งสาม legacy apps และแยก adapter ตาม entity โดย CSV fallback ต้องคงอยู่ |
| UI | work-order UI รองรับ mobile-first create flow, external job, device/QR, staged images, parts และ timeline ตาม source overview | ต้องตรวจ empty state ว่าเป็นข้อมูลว่างจริงหรือ preview fallback และเพิ่มการแสดงเลขงานสองระบบ/ข้อมูล material lines แบบไม่ทำลาย flow เดิม |

### Baseline decision

เฟสแรกของ implementation จะไม่สร้างระบบแจ้งซ่อมใหม่ทั้งชุด แต่จะออกแบบ **compatibility-first extension**: คง `WorkOrder` และ `StockTransaction` ที่ใช้งานอยู่, เพิ่ม field/model ที่จำเป็นสำหรับ traceability และ normalization ผ่าน migration ที่ตรวจสอบได้, แล้วปรับ mapping/API/UI ให้ใช้ข้อมูลใหม่ร่วมกับข้อมูลเดิมได้ การเปลี่ยนแปลงทุกอย่างจะอยู่บน feature branch และต้องมี test กับ Preview evidence ก่อนเสนอ Release Owner/Audit

### ข้อจำกัดของหลักฐานรอบนี้

การตรวจครั้งนี้เป็น source/schema baseline ยังไม่ใช่ runtime acceptance ของข้อมูลจริงบน Preview หรือ Production และยังไม่ยืนยัน credential ของ owner ใน Production การเห็น dashboard ว่างหรือข้อมูลจำลองไม่ถูกใช้เป็นหลักฐาน login หรือ data migration สำเร็จ

## 8. Next design checkpoint

ก่อนเขียน migration ต้องกำหนด canonical contract อย่างน้อยสี่รายการ ได้แก่ (1) รูปแบบและความหมายของ `legacy_job_no`, (2) sequence/pattern ของ `system_job_no`, (3) source-to-target field mapping ที่ versioned และ (4) relational material issue line ที่เชื่อม WorkOrder, StockItem, requester และผู้อนุมัติ พร้อมกติกา duplicate/quarantine สำหรับ import และ sync

---

*Baseline captured by Manus AI on the development feature branch; implementation status remains pending until code, tests and runtime evidence are attached to an exact commit.*

## 9. Mapping baseline ที่ตรวจจาก `src/lib/csv-field-mapping.ts`

Mapping layer มีจุดเริ่มต้นที่ดีและใช้ร่วมกับ CSV/Sync adapter ได้ แต่การตรวจพบว่าบาง mapping ยังเป็น compatibility shortcut ซึ่งไม่เพียงพอสำหรับ data model ใหม่ จึงต้องแก้ที่ฝั่ง Next.js โดยไม่เปลี่ยน header/source contract ของ Legacy Apps

| Source | Mapping ปัจจุบัน | ความเสี่ยง/งานที่ต้องแก้ |
|---|---|---|
| Services WorkOrder | `id` และ `request_id` map เป็น `requestId`; มี subject/status/reporter/status timestamps | ยังไม่มี canonical `legacy_job_no` และ `sourceSystem/sourceEntity/sourceKey` ที่แยกจาก idempotency key; ต้องรักษา legacy id แบบ immutable |
| StockOut `Requester` | map ไป `performedBy` | ข้อมูลผู้เบิกถูกกลบความหมาย ต้อง map เป็น requester identity/foreign key หรือ canonical requester field |
| StockOut `Department` และ `Purpose` | map ไป `reason` | สอง semantic ถูก รวมเป็นช่องเดียว ทำให้สถิติแยกตามหน่วยงาน/วัตถุประสงค์ไม่ได้ |
| StockOut `Approver` | map ไป `performedBy` | ผู้อนุมัติปะปนกับผู้ทำรายการ ต้องแยก approver และ approvedAt |
| StockOut `WorkOrderNo` | map ไป `workOrderId` พร้อม comment ว่าต้อง lookup | ต้องมี resolver ที่รองรับทั้ง legacy job number และ system job number พร้อม quarantine เมื่อไม่พบหรือพบหลายรายการ |
| StockIn/StockOut `ProductCode` | map ไป id field ที่ต้อง lookup | ต้องเก็บ stable source key และรายงาน product missing/inactive/duplicate อย่างชัดเจน |

**Design implication:** mapping รุ่นถัดไปควรเป็น typed, versioned mapping contract ที่คืนทั้ง `mapped`, `warnings`, `unmapped`, `quarantineReason` และ `sourceIdentity` แทนการ map ตรงเข้า Prisma fields อย่างเดียว เพื่อให้ import/sync ตรวจสอบได้และไม่กลบความหมายของข้อมูลเดิม


## Implementation update — Repair data contract slice

**Feature branch:** `feature/itam-next-direction-repair-workflow`

เริ่ม implementation แบบความเสี่ยงต่ำแล้ว โดยเพิ่ม `src/lib/repair-data-contract.ts` เป็น typed, preview-only mapping boundary และ `tests/sync/repair-data-contract.test.ts` เป็น unit tests แบบไม่เขียนฐานข้อมูล

สิ่งที่ทำได้ใน slice นี้:

| รายการ | สถานะ | หลักฐาน |
|---|---|---|
| แยก source identity ออกจากเลขงาน | ทำแล้ว | `SourceIdentity`, `sourceRecordId`, namespaced `sourceKey` |
| รองรับ `legacyJobNo` โดยไม่สร้างค่าเทียม | ทำแล้ว | `mapLegacyWorkOrderRecord()` เก็บเฉพาะ explicit legacy field |
| ไม่สร้าง `system_job_no` ระหว่าง mapping | ทำแล้ว | mapping result ไม่มี `woNumber`/`systemJobNo` |
| แยก Requester/Department/Purpose/Approver | ทำแล้ว | `mapLegacyStockOutRecord()` มี field แยกกัน |
| แยก material issue ต่อ line | ทำแล้วในระดับ mapping | `IssueNo` + `line_no` สร้าง namespaced source key |
| ตรวจ quantity/product ก่อน write | ทำแล้วในระดับ mapping | `INVALID_QUANTITY`, `NON_POSITIVE_QUANTITY`, `MISSING_PRODUCT_CODE` |
| Foreign-key resolution | ยังไม่ทำ | ต้องทำหลังตรวจข้อมูลจริงและ orphan evidence |
| Prisma migration | ยังไม่ทำ | รอ owner decision เรื่อง job number policy และ source field ที่ยืนยัน semantics |

### Self-verification ล่าสุด

- `npx vitest run tests/sync/repair-data-contract.test.ts`: **5/5 passed**
- `npx eslint src/lib/repair-data-contract.ts tests/sync/repair-data-contract.test.ts`: **ผ่าน**
- B4 frozen files ทั้ง 6 ไฟล์เทียบ `ee75164`: **0-diff**
- New source/tests มี `DATABASE_URL`, JWT secret, password/token หรือไม่: **ไม่พบ**
- ไม่มี `prisma db:push`, ไม่มี database write และ CSV fallback ไม่ได้ถูกปิด

### Known limitation

การตรวจ `npx tsc --noEmit` ทั้ง repository ถูกหยุดหลังเกินเวลา 60 วินาทีและมี memory pressure ใน sandbox จึงยังไม่ประกาศเป็น full typecheck pass การยืนยันที่มีอยู่ในรอบนี้เป็น targeted Vitest + targeted ESLint และต้องทำ full typecheck/CI ใน handoff ถัดไป


### Implementation slice: material-to-WorkOrder reconciliation

เพิ่ม `src/lib/repair-link-resolution.ts` เป็น resolver แบบ typed และ read/preview-only สำหรับจับคู่ `StockOut.WorkOrderNo` กับ `legacy_job_no`, `system_job_no` หรือ `woNumber` ของ WorkOrder โดยไม่อ่านหรือเขียนฐานข้อมูลโดยตรง ผลลัพธ์แยก `matchedBy`, `warnings` และ quarantine reason ชัดเจน กรณีไม่พบเลขงาน, พบหลายรายการ หรือไม่มี reference จะ fail-closed และเข้าสู่ reconciliation queue ได้ในระยะถัดไป

Self-verification: `repair-link-resolution.test.ts` และ `repair-data-contract.test.ts` ผ่านรวม 10/10 tests; ยังไม่มีการเชื่อม resolver เข้ากับ apply path และยังไม่มี migration/write operation จาก slice นี้


## Implementation slice: dual-number pending-parts completion guard

สถานะ: **Implemented on feature branch; not merged; no database migration executed**

`POST /api/work-orders/[id]/complete` ตรวจรายการ StockTransaction ที่มี `approvalStatus=PENDING` จากทั้ง relation `workOrderId` และ raw reference `workOrderNo` ซึ่งอาจเป็น `woNumber`, `systemJobNo` หรือ `legacyJobNo` โดยใช้ reference helper แบบ deterministic, trim และ deduplicate หากมีรายการ pending ระบบยังคง fail-closed และไม่ปิดงาน

Self-verification:

- repair-related unit tests: 6 files / 21 tests passed
- ESLint ของ completion route, helper และ test passed
- `git diff --check` passed
- B4 frozen files: 0-diff
- targeted TypeScript command ยังพบเฉพาะ baseline errors เดิมใน `src/app/api/import/route.ts`, `src/lib/auth-middleware.ts` และ `src/lib/guest-validation.ts`; ไม่มี diagnostic ใหม่ใน completion route/helper
- no `prisma db:push`, no live migration, no database write
