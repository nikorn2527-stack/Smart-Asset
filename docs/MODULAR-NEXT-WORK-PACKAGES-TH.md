# Modular Next Work Packages

**สถานะ:** Ready to start

**ฐานงาน:** `feature/itam-next-direction-repair-workflow` @ `951be88`

**เป้าหมาย:** ให้ทีม Dev แยกทำงานตามโมดูลได้ทันที โดยรักษา ITAM-DB เป็น canonical target, ให้ legacy apps เป็น read-only source reference และไม่เปลี่ยน release governance

## หลักการเริ่มงาน

ทุก work package ต้องเริ่มจาก branch ของตัวเองและเปิด Pull Request แยกตามโมดูล การเปลี่ยนแปลงที่เป็น shared contract, Prisma schema, migration, authorization หรือ audit ต้องทำเป็น PR แยกและระบุผู้ได้รับผลกระทบอย่างชัดเจน ห้ามใช้ `prisma db:push`, ห้ามแก้ B4 frozen files และห้ามเพิ่ม `SYNC_RUN` permission โดยไม่มี Audit review ใหม่

การเชื่อมต่อกับ legacy source ในรอบแรกให้ทำเป็น **Preview/no-write adapter** ก่อนเสมอ โดย source record ต้องมี stable identity, mapping ต้อง fail-closed และ record ที่ resolve ไม่ได้ต้อง quarantine แทนการเดาข้อมูลหรือเขียน foreign key ผิด

## Work package A — Dev-1 Repair

**โมดูล:** แจ้งซ่อม

**สาขาแนะนำ:** `feature/module-repair-services-adapter`

**จุดต่อโค้ด:** `src/lib/sync-adapter.ts`, `src/lib/repair-data-contract.ts`, `src/lib/repair-link-resolution.ts`, `src/app/api/sync/preview/route.ts`, `tests/sync/`

**งานระยะนี้:** สร้าง Services → Work Orders adapter boundary ที่รับ legacy record ตาม source contract เดิม แล้วแปลงเป็น `CanonicalWorkOrderMapping` โดยไม่สร้าง `systemJobNo` จากข้อมูลที่ไม่มีหลักฐาน ไม่เขียน WorkOrder ใน Preview และเก็บ `legacyJobNo`/source identity เพื่อ traceability

**ต้องตรวจ:** missing source identity, missing request ID, missing/unknown site, duplicate source key, unknown columns, status mapping, system job number collision และ record ที่มีเพียง source identity แต่ไม่มี legacy job number

**Definition of Done:** มี typed adapter และ unit tests สำหรับ valid row, missing identity, missing request ID, unknown site, duplicate identity และ Preview no-write; existing sync adapter suite ต้องไม่ถอย และต้องแสดงจำนวน `mapped`, `quarantine`, `unmapped` อย่างตรวจสอบย้อนกลับได้

## Work package B — Dev-2 Stock

**โมดูล:** สต๊อก

**สาขาแนะนำ:** `feature/module-stock-issue-validation`

**จุดต่อโค้ด:** `src/lib/csv-field-mapping.ts`, `src/lib/repair-data-contract.ts`, `src/lib/repair-link-resolution.ts`, `src/app/api/import/route.ts`, `src/app/api/stock-items/[id]/transaction/route.ts`, `tests/sync/`

**งานระยะนี้:** ทำ canonical material-issue validation ให้แยก `requester`, `department`, `purpose`, `approver`, `workOrderNo` และ `quantity` ออกจากกัน เพิ่ม deterministic validation สำหรับ quantity, product identity, approval state, duplicate source line และ work-order link ที่หาไม่พบ

**กติกาข้อมูล:** requester และ performedBy ต้องมาจาก authenticated session ไม่รับค่าจาก client เพื่อใช้ audit; WorkOrder lookup ต้องรองรับ `workOrderId`, `woNumber`, `systemJobNo` และ `legacyJobNo`; resolve ไม่ได้ให้ quarantine และไม่ผูก FK แบบเดา

**Definition of Done:** mapping tests ครบ semantic fields, negative quantity, missing product code, duplicate source line, unresolved legacy job number และ unauthorized mutation; CSV fallback ต้องยังใช้งานได้และ stock mutation ต้องผ่าน permission เดิม

## Work package C — Dev-3 Devices

**โมดูล:** จัดการอุปกรณ์

**สาขาแนะนำ:** `feature/module-devices-import-boundary`

**จุดต่อโค้ด:** `src/app/api/itam/devices/import/route.ts`, `src/app/api/devices/import/route.ts`, `src/lib/csv-field-mapping.ts`, `tests/`

**งานระยะนี้:** แยก device importer ออกเป็น parser, normalized row, validator และ persistence boundary โดยคง HTTP response contract เดิมก่อน ห้ามเปลี่ยน source headers เพื่อให้ legacy CSV ยังใช้ได้

**ต้องตรวจ:** asset code ซ้ำในไฟล์, asset code ซ้ำใน DB, required fields, valid status, department-code preservation, site scope, serial number normalization และ batch-size/resource bound

**Definition of Done:** parser/validator เป็น pure functions ที่ทดสอบได้โดยไม่ใช้ DB, persistence รับเฉพาะ validated rows, error ระบุ row และเหตุผลได้, import batch ยังมี upper bound, audit summary ไม่เปิดเผยข้อมูลเกินจำเป็น และ B4/auth contract ไม่เปลี่ยน

## Work package D — Dev-3 Meter

**โมดูล:** จดมิเตอร์

**สาขาแนะนำ:** `feature/module-meter-reading-contract`

**จุดต่อโค้ด:** `src/app/api/meter/route.ts`, `src/app/api/itam/meter-readings/unread/route.ts`, `src/app/api/meter/reminders/route.ts`, `prisma/schema.prisma` เฉพาะเมื่อมี contract ที่ได้รับอนุมัติ, `tests/`

**งานระยะนี้:** ทำ reading validation และ query boundary ให้ชัดเจน โดยรองรับ reset ที่ต้องมี remark, ป้องกันค่าติดลบที่ไม่ถูกต้อง, กำหนด duplicate-period policy และเพิ่ม pagination/limit สำหรับ list และ aggregate ที่ไม่ควรโหลดข้อมูลทั้งตารางโดยไม่จำกัด

**ข้อควรระวัง:** การสร้าง MeterReading และการอัปเดต `Device.lastMeterReading` ต้องพิจารณา transaction/concurrency เพื่อไม่ให้ค่าอ่านล่าสุดถอยหลังจาก request ที่มาถึงสลับลำดับ หากต้องเปลี่ยน unique constraint หรือเพิ่ม index ให้เปิด schema/migration PR แยก

**Definition of Done:** มี tests สำหรับ normal increment, reset without remark, reset with remark, invalid date/number, duplicate period, concurrent/latest-reading behavior และ bounded GET; ผล aggregate ต้องมีขอบเขตข้อมูลและไม่ทำให้ memory โตตามข้อมูลทั้งหมดโดยไม่มี limit

## Shared integration gates

ทีมโมดูลห้ามแก้ canonical table ของโมดูลอื่นโดยตรง หากต้องเชื่อมให้ใช้ typed contract หรือ API boundary และระบุ dependency ใน PR ทุก PR ต้องมี changed-scope tests, regression evidence, `git diff --check`, B4 frozen-file diff check และระบุว่าเป็น Preview, read-only, additive migration หรือ business mutation

ลำดับแนะนำคือ Repair และ Stock ทำ mapping/validation ได้ก่อน ส่วน Devices/Meter ทำ parser และ pure validation ได้คู่ขนาน เมื่อมี schema หรือ cross-module contract ใหม่จึงรวมผลผ่าน Shared Platform review ก่อนนำไป staging

## Handoff checklist

ก่อนขอ Audit review ให้แนบ exact commit SHA, test command และผลจริง, รายการไฟล์ที่เปลี่ยน, migration SQL ถ้ามี, evidence ของ fail-closed/authorization, ผลตรวจ B4 frozen files และผล resource-bound check หากเกี่ยวกับ import หรือ query

**ห้ามสรุปว่า feature ผ่าน release gate เพียงเพราะ unit tests ผ่าน** การ merge, staging, canary และ production ยังคงอยู่ภายใต้ Audit และ Release Owner ตาม governance เดิม
