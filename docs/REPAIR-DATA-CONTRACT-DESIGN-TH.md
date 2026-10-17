# Repair Data Contract และ Normalized Model Design

**สถานะ:** Design baseline บน feature branch `feature/itam-next-direction-repair-workflow`

**เป้าหมาย:** กำหนดวิธีให้ ITAM-NextJS รองรับข้อมูลจาก Legacy Apps โดยถือ source contract เป็น stable, เก็บ traceability ของข้อมูลเดิม, ใช้เลขงานระบบใหม่โดยไม่ทำลายเลขเดิม และแยกข้อมูลวัสดุที่ผูกกับงานแจ้งซ่อมให้ทำสถิติได้ โดยยังรักษาความเข้ากันได้กับ schema/API/UI ปัจจุบัน

> เอกสารนี้เป็นแบบออกแบบก่อน implementation ยังไม่มี migration หรือ database write จากเอกสารนี้เพียงอย่างเดียว

## 1. Design decisions

| ประเด็น | ข้อตกลงออกแบบ | เหตุผล |
|---|---|---|
| Implementation platform | Next.js + TypeScript เป็นผู้แปลงและ validate ข้อมูล | ไม่เปลี่ยน source contract และไม่ต้องแก้ Apps Script เพื่อรองรับระบบใหม่ |
| Target database | ITAM-DB บน Supabase | เป็นฐานข้อมูลเป้าหมายหลักตาม direction ของโครงการ |
| Legacy data | อ่านเป็น read-only reference และ source contract | ใช้ทำความเข้าใจ logic/flow/semantics ไม่คัดลอก implementation เดิมทั้งชุด |
| System job number | ใช้ `WorkOrder.woNumber` เป็น system job number canonical ในระยะ compatibility แรก | API/UI เดิมอ้างอิง `woNumber` จำนวนมาก การเพิ่ม field ซ้ำทันทีจะสร้าง dual-write risk |
| Legacy job number | เพิ่ม `legacyJobNo` แบบ nullable และ immutable เมื่อรับเข้าระบบ | รักษาเลขเดิมเพื่อ traceability และไม่บังคับให้ข้อมูลเก่าที่ไม่มีเลขงานปลอมค่า |
| Source identity | ใช้ `sourceSystem`, `sourceEntity`, `sourceRecordId` และ/หรือ namespaced `sourceKey` | แยก identity ของ Services, IT-Asset-Management และ Stock แม้ค่า id ซ้ำกันข้ามระบบ |
| Material issue | ใช้ `StockTransaction` เป็น ledger/issue line ที่มีอยู่แล้ว และเพิ่ม relation ที่ตรวจสอบได้กับ WorkOrder | ลดการสร้างข้อมูลซ้ำและรักษา API เบิกจ่ายเดิม ขณะเดียวกันหนึ่ง WorkOrder รองรับหลาย transaction lines |
| Source change | ไม่เปลี่ยนชื่อ sheet/header/รูปแบบข้อมูล Legacy | adaptation และ mapping อยู่ใน ITAM-NextJS เท่านั้น |

## 2. Canonical identity model

ข้อมูลหนึ่งรายการต้องแยกสามชนิดของ identity ไม่ให้ใช้แทนกัน

| Identity | ตัวอย่างความหมาย | การเก็บในระบบ |
|---|---|---|
| `source_record_id` | id ของ row/record ใน Legacy Services หรือ Stock | ใช้สำหรับ idempotency และ audit ของ source |
| `legacy_job_no` | เลขงานที่ผู้ใช้เห็นในระบบเดิม เช่นเลขจาก Services/StockOut | เก็บแบบ immutable เมื่อ source ระบุชัด; ไม่สร้างขึ้นเองหาก source ไม่มีค่า |
| `system_job_no` | เลขงานที่ Next.js สร้างตาม `WoNumberPattern` | ใช้ `WorkOrder.woNumber` เป็น canonical field เดิมในระยะ compatibility แรก |

การ map `id` หรือ `request_id` ของ Services เป็น `legacy_job_no` โดยอัตโนมัติ **ไม่อนุญาต** หากยังพิสูจน์ไม่ได้ว่านั่นคือเลขงานที่ผู้ใช้เห็นจริง เพราะ id สำหรับ deduplication ไม่จำเป็นต้องเป็น job number การไม่มี legacy job number ต้องเก็บเป็น `source_record_id` และรายงาน warning/quarantine ตามกรณีแทนการสร้างค่าเทียม

## 3. Proposed schema delta แบบ compatibility-first

การเปลี่ยน schema ที่เสนอในรอบแรกควรเล็กและย้อนตรวจได้ โดยยังไม่บังคับข้อมูลเก่าที่มี null ให้ผ่าน constraint ใหม่

### 3.1 WorkOrder

```prisma
model WorkOrder {
  // existing fields remain unchanged
  woNumber       String? @unique // canonical system_job_no in compatibility phase
  legacyJobNo    String?
  sourceSystem   String?
  sourceEntity   String?
  sourceRecordId String?

  materialIssues StockTransaction[]

  @@index([legacyJobNo])
  @@index([sourceSystem, sourceEntity, sourceRecordId])
}
```

ข้อกำหนดสำคัญคือ `legacyJobNo` ต้องเขียนครั้งแรกจาก source ที่ได้รับการตรวจแล้ว และห้ามแก้ไขใน normal update path การแก้ไขต้องผ่าน migration/reconciliation ที่มีเหตุผล, actor และ audit evidence ส่วน `woNumber` ยังคงเป็นเลขระบบใหม่ที่ออกโดย `WoNumberPattern` และห้ามนำค่าจาก Legacy มา overwrite

การเพิ่ม unique constraint แบบ compound จะพิจารณาหลังตรวจข้อมูลจริงและตัดสิน policy กรณี source เดียวกันส่งเลขซ้ำ หากยังมีข้อมูลซ้ำหรือ source ไม่ครบ จะใช้ quarantine แทนการบังคับ migration ให้ผ่านแบบทำลาย traceability

### 3.2 StockTransaction เป็น material issue line

ปัจจุบัน `StockTransaction` มี field สำคัญอยู่แล้ว ได้แก่ `stockItemId`, `quantity`, `requester`, `department`, `purpose`, `approver`, `approvedAt`, `workOrderId`, `workOrderNo`, `sourceKey`, `approvalStatus` และ `txnDate` การออกแบบรอบแรกจึงใช้ record นี้เป็นหนึ่ง material issue line ต่อสินค้า/การทำรายการ

```prisma
model WorkOrder {
  materialIssues StockTransaction[]
}

model StockTransaction {
  workOrderId String?
  workOrder   WorkOrder? @relation(fields: [workOrderId], references: [id], onDelete: SetNull)

  @@index([workOrderId, type, txnDate])
  @@index([sourceKey])
}
```

การเพิ่ม relation ต้องทำหลังตรวจ orphan `workOrderId` ที่มีอยู่จริงก่อน หากมีค่าเดิมที่ไม่ตรงกับ `WorkOrder.id` ห้ามใช้ `prisma db:push` หรือบังคับ foreign key แบบ blind migration ต้องรายงานและ quarantine รายการที่ resolve ไม่ได้

หากภายหลังพบว่าต้องแยก “คำขอเบิก” ออกจาก “บัญชีแยกประเภท stock” อย่างแท้จริง จึงค่อยเพิ่ม `MaterialIssue`/`MaterialIssueLine` เป็น aggregate ใหม่ โดยต้องมี migration และ backfill plan แยกต่างหาก ไม่สร้างซ้ำในเฟสแรกโดยไม่มีหลักฐานจาก workflow จริง

## 4. Mapping contract รุ่นถัดไป

Mapping ต้องไม่คืนเพียง object ที่ตรงกับ Prisma field เพราะจะกลบความหมายของ source เมื่อหลาย header ถูก map เข้าช่องเดียวกัน Contract ที่เสนอคือ:

```ts
type SourceIdentity = {
  sourceSystem: 'services' | 'it-asset-management' | 'stock'
  sourceEntity: string
  sourceRecordId: string
  sourceLineId?: string
}

type MappingResult<T> = {
  identity: SourceIdentity
  mapped: T
  warnings: string[]
  unmapped: string[]
  quarantineReason?: string
}
```

ทุก adapter ต้องทำงานในลำดับ `normalize headers → parse types → map semantics → resolve references → validate authorization/scope → produce mapped result → persist or quarantine` โดย Preview หยุดก่อน persistence เสมอ

### 4.1 Services WorkOrder

| Legacy field | Canonical target | กติกา |
|---|---|---|
| `id` | `sourceRecordId`/`requestId` สำหรับ dedup | ไม่ถือเป็น `legacyJobNo` จนกว่าจะยืนยัน semantics |
| `request_id` | `requestId` หรือ source alias | ต้องตรวจ duplicate กับ `id` และทำให้ deterministic |
| explicit legacy job field ถ้ามี | `legacyJobNo` | เก็บตาม source แบบ immutable |
| `subject`, `details`, `priority`, `status` | WorkOrder equivalents | status ต้องผ่าน value mapping และ unknown status ต้อง warning/quarantine |
| `reporter_name`, `employee_code`, `tel` | reporter fields | ต้องรักษา source text และพยายาม resolve user แบบไม่เดาข้ามคน |
| `building`, `location`, site field | WorkOrder location/site | site ที่ไม่อยู่ allowlist ต้อง quarantine ตาม policy |
| `pic_before`, `pic_onsite`, `pic_after` | image stage references | ต้อง validate type/size/storage policy ไม่ใส่ secret ลง audit |

### 4.2 StockOut material issue

ทุก row ของ StockOut ที่เป็นการเบิกสินค้าให้กลายเป็นหนึ่ง `StockTransaction` line โดยไม่รวมหลาย product เข้ากับ WorkOrder เพียง record เดียว

| Legacy field | Canonical target | ห้ามทำ |
|---|---|---|
| `IssueNo` + `line_no` | namespaced `sourceKey` | ห้ามใช้ IssueNo เดี่ยว ๆ หากหนึ่งใบมีหลายสินค้า |
| `ProductCode` | resolve `StockItem.id`; เก็บ product code/name เป็น snapshot ตาม policy | ห้ามผูกด้วยชื่อสินค้าอย่างเดียว |
| `Quantity` | `quantity` | ต้องเป็นจำนวนเต็มตามกติกาและไม่อนุญาตค่าติดลบโดยไม่ระบุ adjustment |
| `Requester` | `requester` | ห้าม map เป็น `performedBy` เพราะเป็นคนละความหมาย |
| `Department` | `department` | ต้องเก็บแยกเพื่อรายงาน |
| `Purpose` | `purpose` | ต้องเก็บแยกเพื่อวิเคราะห์การใช้งาน |
| `Approver` | `approver` | ห้ามรวมกับผู้ทำรายการ |
| `ApprovedAt` | `approvedAt` | ต้องตรวจรูปแบบวันเวลาและ approval status |
| `WorkOrderNo` | resolve `legacyJobNo` หรือ `woNumber` ตาม namespace | ไม่พบ/พบหลายรายการให้ quarantine ไม่เดา |
| `processed_flag`, `reason_reject` | processing/approval fields | ต้องไม่ทำให้รายการที่ rejected กลายเป็น applied |

## 5. Job-number policy ที่ต้องยืนยันก่อนเปิดใช้จริง

ระบบจะสร้าง `woNumber` ใหม่จาก `WoNumberPattern` สำหรับงานที่สร้างใน Next.js ส่วนข้อมูลที่นำเข้าจาก Legacy จะรักษา `legacyJobNo` ถ้ามีและไม่ออกเลขใหม่ทับข้อมูลเดิมโดยอัตโนมัติ หากต้องการให้ Legacy job ได้ system number เพิ่ม ต้องทำเป็น explicit migration policy ที่สร้าง mapping one-to-one และบันทึก audit

| กรณี | `legacyJobNo` | `woNumber`/system job no | ผลลัพธ์ |
|---|---|---|---|
| งานใหม่จาก Next.js | null | สร้างใหม่ | ใช้เลขระบบใหม่ตาม pattern |
| งานเก่าที่มีเลขเดิม | เก็บค่าเดิม | สร้างหรือ backfill ตาม policy ที่อนุมัติ | ค้นหาได้ทั้งสองเลข |
| งานเก่าที่ไม่มีเลขเดิม | null | ไม่สร้างเลขเดิมปลอม | ใช้ source record id และรายงาน warning |
| StockOut อ้างเลขที่หาไม่พบ | เก็บ source row | null | quarantine/reconciliation queue |
| เลขเดิมซ้ำใน source | เก็บ raw identity | ไม่เดา record | conflict/quarantine พร้อม evidence |

**Open decision:** Release Owner ต้องยืนยันว่าจะให้ imported legacy jobs ได้ `woNumber` ใหม่ในช่วง backfill หรือจะรักษาเฉพาะ `legacyJobNo` จนกว่าจะมีการเปิดใช้งาน edit/close ในระบบใหม่ การ implement จะไม่เดานโยบายนี้เอง

## 6. Migration และ rollout sequence

1. เพิ่ม nullable columns และ indexes ด้วย Prisma migration ที่ review ได้เท่านั้น ห้ามใช้ `prisma db:push`.
2. เพิ่ม read-only inspection และ report orphan/duplicate ก่อนเพิ่ม relation foreign key.
3. เพิ่ม mapping functions และ tests โดยยังคง CSV fallback.
4. ทำ preview import/sync แบบ no-write และตรวจผล mapped/warning/quarantine.
5. Backfill เฉพาะรายการที่มี deterministic identity พร้อม audit evidence และ rollback plan.
6. เปิด write/apply หลัง Audit ตรวจ exact SHA, authorization, idempotency และ staging evidence.
7. จึงค่อยพิจารณา non-null/unique constraints ที่มีหลักฐานว่าข้อมูลสะอาดแล้ว.

## 7. Acceptance criteria ของ design นี้

| Check | เกณฑ์ผ่าน |
|---|---|
| Source compatibility | ไม่เปลี่ยนชื่อ sheet/header หรือ Apps Script implementation |
| Traceability | source system/entity/record และ legacy job number แยกจาก system job number |
| Normalization | WorkOrder หนึ่งรายการเชื่อม material issue ได้หลาย line และแยก requester/department/purpose/approver |
| Mapping safety | unknown header, type mismatch, missing product, unresolved job และ duplicate ไม่ถูกเขียนแบบเงียบ ๆ |
| Compatibility | API/UI เดิมที่ใช้ `woNumber`, `workOrderId`, `StockTransaction` ยังทำงานได้ |
| Security | ไม่มี password/hash/salt/token/connection string ใน mapping result, audit detail หรือ response |
| Governance | feature branch เท่านั้น, B4 frozen 0-diff, ไม่เพิ่ม `SYNC_RUN`, CSV fallback คงอยู่ |
| Evidence | มี unit/integration/Preview evidence ผูก exact commit SHA ก่อน handoff |

## 8. Next implementation slice

งาน implementation ลำดับแรกที่มีความเสี่ยงต่ำคือสร้าง typed mapping result และ resolver แบบ read/preview-only สำหรับ WorkOrder กับ StockOut โดยยังไม่เพิ่ม migration หรือ foreign key ใน commit เดียวกัน จากนั้นทำ test fixtures ที่ใช้ข้อมูล redacted และตรวจว่า `Requester`, `Department`, `Purpose`, `Approver` ไม่ถูก map รวมกันอีกต่อไป เมื่อ tests ผ่านจึงเสนอ schema migration ขนาดเล็กสำหรับ `legacyJobNo`/source identity และ relation ที่ตรวจ orphan แล้ว

*Owner decision required before write migration: policy ของ system job number สำหรับ imported legacy jobs และ source field ที่ยืนยันว่าเป็น legacy job number จริงของ Services* 
