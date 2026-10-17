# โจทย์งาน: Legacy Apps Script → ITAM-NextJS Manual Sync

**สถานะ:** พร้อมส่งทีมพัฒนา
**ประเภท:** Feature — Data Migration / Integration
**Baseline:** สร้างบน `ee75164` (หลัง B4 Final Closure) — แยกจาก B4 และแยกจาก UX/UI PR
**PR:** แยกเป็นคนละ PR ตาม phase (ดูส่วน "แผนการส่งมอบ")

---

## 1. บทสรุปผู้บริหาร

ระบบ ITAM-NextJS ปัจจุบันใช้ **CSV Upload** เป็นช่องทางเดียวในการโอนย้ายข้อมูลจาก 3 แอป Apps Script เก่า (IT-Asset-Management, Services, Stock) ผู้ใช้ต้อง export CSV จาก Google Sheets ด้วยมือ แล้วอัปโหลดเข้าระบบ ทำให้เกิดปัญหา:

1. **ขั้นตอนยืดยาว** — export → download → upload → รอผล ทุกครั้งที่ต้องการ sync
2. **ไม่มี Preview** — ผู้ใช้กดอัปโหลดแล้วจึงรู้ว่าจะกระทบกี่แถว แก้ไข/สร้าง/ลบอะไรบ้าง
3. **ไม่มี Idempotency** — อัปโหลดซ้ำสองครั้งอาจสร้าง duplicate หรือทับข้อมูลที่แก้ไขแล้วโดยไม่ตั้งใจ
4. **Credential exposure risk** — หากจะดึงจาก Apps Script ตรงจาก browser จะต้องเอา token/credential ไปไว้ฝั่ง client

โจทย์นี้เสนอให้สร้าง **Server-side Pull Adapter** — ผู้ใช้กด **"Preview Changes"** หรือ **"Sync Now"** จากหน้า ITAM-NextJS แล้ว **backend (Next.js API Route)** เป็นผู้เรียก Apps Script Web App / Google Sheets API ฝั่ง server โดย browser **ไม่เห็น credential** ใดๆ ทั้งสิ้น

**แนวทางการส่งมอบแบบ Phase:**

| Phase | แหล่งข้อมูล | เป้าหมาย | สถานะ CSV Upload |
|-------|-----------|---------|-----------------|
| **1 (MVP)** | Services → Work Orders | โอนใบงานแจ้งซ่อมจากระบบเก่า | คงไว้เป็น fallback |
| **2** | IT-Asset-Management → Devices / Master Data | โอนอุปกรณ์ + มิเตอร์ + ประวัติ | คงไว้เป็น fallback |
| **3** | Stock → Products / Transactions | โอนสินค้า + รับเข้า/เบิกออก + PO | คงไว้เป็น fallback |
| **4 (Cleanup)** | ทั้งหมด | ปิด CSV upload legacy path (เมื่อ sync ครบและ stable ≥ 2 สัปดาห์) | ลบ/ซ่อน |

---

## 2. สถาปัตยกรรม

### 2.1 ทางเลือกที่พิจารณา

| ทางเลือก | ข้อดี | ข้อเสีย | คำตัดสิน |
|---------|------|--------|---------|
| **A. Browser → Apps Script ตรง** | ง่ายที่สุด ไม่ต้องเขียน backend | credential อยู่ใน browser (CORS, token leak) | **ปฏิเสธ** — security risk |
| **B. Server-side Pull Adapter (เลือก)** | credential อยู่ฝั่ง server เท่านั้น ควบคุม rate/retry/audit ได้ ทำ Preview ได้ | ต้องเขียน adapter + เก็บ config ฝั่ง server | **เลือก** |
| **C. Apps Script Push → webhook** | real-time | Apps Script เก่าต้องแก้ trigger + ต้องเปิด inbound webhook (auth เพิ่ม) | ปฏิเสธ — เปลี่ยนแอปเก่ามากเกินไป |
| **D. Scheduled cron (auto-sync)** | ไม่ต้องกด | ขัดกับ requirement "Manual Sync" + ทำ Preview ไม่ได้ | ปฏิเสธ (แต่เก็บไว้เป็นอนาคต Phase 5) |

### 2.2 สถาปัตยกรรมที่เลือก (Server-side Pull Adapter)

```
┌─────────────────┐     HTTPS (cookie/JWT)      ┌──────────────────────┐
│   Browser (UI)  │ ───────────────────────────► │  Next.js API Route    │
│  Preview / Sync │   POST /api/sync/preview     │  /api/sync/*          │
│   buttons       │   POST /api/sync/run         │  (server-side only)   │
└─────────────────┘                              └──────────┬───────────┘
                                                            │ server-side fetch
                                                            ▼
                                          ┌─────────────────────────────────┐
                                          │  Apps Script Web App            │
                                          │  ( doPost → JSON )              │
                                          │  OR  Google Sheets API v4       │
                                          └─────────────────────────────────┘
                                                            │
                                                            ▼
                                          ┌─────────────────────────────────┐
                                          │  Prisma: SyncRun + SyncRunItem  │
                                          │  (preview / applied / error)    │
                                          └─────────────────────────────────┘
```

**หลักการสำคัญ:**
- Browser ส่งแค่ `{ source, options }` — ไม่มี credential ใน request body / headers
- Server อ่าน credential จาก environment variables (`APPS_SCRIPT_*` / `GOOGLE_SERVICE_ACCOUNT_*`) เท่านั้น
- ทุกการดึงข้อมูลบันทึกเป็น `SyncRun` (แม้ Preview ก็สร้าง row แต่ status=`preview`)
- Preview **ไม่เขียน** ข้อมูลจริง — เก็บ diff ไว้ใน `SyncRunItem` ให้ผู้ใช้ตรวจก่อนกด Apply

### 2.3 การเรียก Apps Script — สองโหมดที่รองรับ

Adapter ต้องรองรับทั้งสองโหมด (เลือกตาม source config):

**โหมด 1 — Apps Script Web App (แนะนำสำหรับ Services/Stock)**
- Apps Script ฝั่งเก่า deploy เป็น Web App (`doGet`/`doPost` คืน JSON)
- ITAM-NextJS เรียก `POST https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec` พร้อม `Authorization: Bearer {token}` หรือ OAuth
- รองรับ pagination ผ่าน query param `?cursor=...&limit=...`

**โหมด 2 — Google Sheets API v4 (สำหรับ IT-Asset-Management ที่เป็น sheet ตรงๆ)**
- ใช้ Service Account (`GOOGLE_SERVICE_ACCOUNT_JSON`)
- เรียก `GET https://sheets.googleapis.com/v4/spreadsheets/{sheetId}/values/{range}`
- แปลง rows → records ด้วย `FIELD_MAPPINGS` ที่มีอยู่ใน `src/lib/csv-field-mapping.ts`

> **หมายเหตุ:** โค้ด mapping/status conversion ที่มีอยู่ใน `csv-field-mapping.ts` ต้องนำมาใช้ซ้ำ ไม่เขียนใหม่ — adapter แค่เปลี่ยนแหล่งข้อมูลจาก "CSV file" เป็น "HTTP response"
>
> **F-02 fix — Canonical Site Code:** Legacy WorkOrder ไม่มี `siteCode` ต่อ record adapter ต้อง:
> 1. เพิ่ม source `siteCode` จาก Apps Script response (ถ้ามี)
> 2. ถ้าไม่มี: server-side mapping จาก `site` field → `siteCode` ด้วย allowlist + version + audit
> 3. Missing/unknown Site → **quarantine** (item status=`error`, errorMessage=`MISSING_SITE`)
> 4. ห้าม Apply record ที่ไม่มี `siteCode` ที่ถูกต้อง

---

## 3. Data Model

### 3.1 ตารางใหม่: `SyncRun`

เก็บประวัติทุกการ sync (ทั้ง preview และ apply) — แยกจาก `ImportJob` ที่มีอยู่เพราะ ImportJob ใช้กับ CSV upload เท่านั้นและไม่มี concept ของ preview/diff

```prisma
model SyncRun {
  id              String   @id @default(cuid())
  // ── ระบุแหล่ง/เป้าหมาย ──
  source          String   // 'services' | 'itam' | 'stock'
  target          String   // 'work-order' | 'device' | 'meter' | 'stock-item' | 'stock-txn' | 'purchase-order'
  // ── โหมดการทำงาน ──
  mode            String   // 'preview' | 'apply'
  status          String   // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  // ── สถิติ ──
  totalRows       Int      @default(0)
  createRows      Int      @default(0)
  updateRows      Int      @default(0)
  skipRows        Int      @default(0)   // unchanged
  errorRows       Int      @default(0)
  // ── timing ──
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  durationMs      Int?
  // ── auth/audit ──
  triggeredBy     String   // user email
  siteScope       String?  // Site code ที่ sync กระทบ (null = multi-site / superadmin)
  // ── error/retry ──
  errorMessage    String?
  retryOf         String?  // SyncRun.id ที่ retry มาจาก (null = รันครั้งแรก)
  // ── retry metrics (from withSerializableRetryTracked) ──
  attempts        Int      @default(1)   // total transaction attempts (including retries)
  p2034Count      Int      @default(0)   // number of P2034 serialization conflicts encountered
  // ── pagination cursor (สำหรับ resume) ──
  sourceCursor    String?  // opaque cursor จาก Apps Script (เช่น last row id)
  // ── relations ──
  items           SyncRunItem[]
  createdAt       DateTime @default(now())

  @@index([source, target, status])
  @@index([triggeredBy])
  @@index([siteScope, createdAt])
  @@index([status, createdAt])
}
```

### 3.2 ตารางใหม่: `SyncRunItem`

เก็บ diff รายแถว — ผู้ใช้เห็นในหน้า Preview ก่อนกด Apply

```prisma
model SyncRunItem {
  id              String   @id @default(cuid())
  syncRunId       String
  syncRun         SyncRun  @relation(fields: [syncRunId], references: [id], onDelete: Cascade)
  // ── stable external key (ดูส่วน 4) ──
  externalKey     String   // เช่น requestId (Services), assetCode (Device), productCode (Stock)
  // ── การกระทบ ──
  action          String   // 'create' | 'update' | 'skip' | 'error'
  // ── ข้อมูลก่อน/หลัง (JSON) ──
  before          Json?    // JSON object ของ record เดิม (null สำหรับ create)
  after           Json?    // JSON object ของ record ใหม่ (null สำหรับ delete — ยังไม่รองรับ)
  // ── Preview baseline (P1 fix: conflict detection) ──
  // Persisted at preview time so apply can detect intervening edits.
  // Without these, preview→apply is a TOCTOU window: a user could edit
  // the WO (or another sync could create the external key) between
  // preview and apply, and the apply would silently overwrite it.
  expectedVersion Int?     // WorkOrder.version ที่บันทึกตอน preview (null สำหรับ create/skip)
  expectedExists  Boolean  // true = preview เห็น record อยู่; false = preview ไม่เห็น (create)
                           // apply ตรวจ: ถ้า expectedExists=false แต่พบ record จริง → CONFLICT
  // ── ผลลัพธ์ ──
  status          String   // 'pending' | 'applied' | 'skipped' | 'error'
  errorMessage    String?
  // ── ลิงก์กับ record จริง (หลัง apply) ──
  entityId        String?  // WorkOrder.id / Device.id / StockItem.id
  entityType      String?  // 'WorkOrder' | 'Device' | 'StockItem' | ...
  // ── timing ──
  processedAt     DateTime?

  @@index([syncRunId, action])
  @@index([externalKey])
  @@index([syncRunId, status])
}
```

### 3.2.1 Serialization & Redaction Boundary (F-13/F-16)

**SyncRunItem.before / after (Json?):**
- Prisma `Json` type — stored as JSONB in PostgreSQL
- Adapter ต้อง redact ก่อนบันทึก: ลบ PII (email, phone, password), credential (token, API key), internal fields (id, createdAt)
- Redaction allowlist: เก็บเฉพาะ field ที่อยู่ใน `FIELD_MAPPINGS.workOrder` + `siteCode` + `status`
- `null` สำหรับ create action (before) / delete action (after, ยังไม่รองรับ)

**AuditLog.detail (String?):**
- Current architecture: `AuditLog.detail` เป็น `String` (JSON string) ไม่ใช่ Prisma `Json`
- Implementation ต้อง `JSON.stringify(detail)` ก่อนเขียน — ห้ามส่ง object ตรงๆ
- Detail structure: `{ before, after, syncRunId, externalKey }` — ใช้ค่าจาก SyncRunItem (redacted แล้ว)
- ห้ามเก็บ credential/PII ใน AuditLog.detail
- Helper: `redacted(obj)` ควรเป็น pure function ที่:
  1. รับ object (Json? จาก SyncRunItem)
  2. clone + ลบ key ที่อยู่นอก allowlist
  3. คืน redacted object (ยังเป็น object — stringify ตอนเขียน AuditLog)

**Preview response:**
- API response (`before`/`after` ใน items) ส่งค่า redacted เดียวกับที่บันทึกใน DB
- ไม่ echo token/URL/credential ใน response body
```

### 3.3 Migration

- สร้าง `prisma/migrations/{timestamp}_add_sync_run_tables/migration.sql`
- **ห้าม** `bun run db:push` — ใช้ migration file เท่านั้น
- CI/staging/production: `bunx prisma migrate deploy`
- **ห้าม** `--accept-data-loss` ใน release path
- **ไม่ backfill** — SyncRun เริ่มจาก empty (ประวัติ CSV upload เก่ายังอยู่ใน ImportJob)

---

## 4. Stable External Key (กุญแจสำคัญของ Idempotency)

แต่ละ `target` ต้องมี **external key ที่ stable และ unique** เพื่อให้ sync ซ้ำได้โดยไม่ duplicate:

| target | externalKey field (ใน Prisma) | ตัวอย่างค่า | หมายเหตุ |
|--------|-------------------------------|-----------|---------|
| `work-order` | `WorkOrder.requestId` (@unique) | `"12345"` (legacy numeric id) | มีอยู่แล้ว |
| `device` | `Device.assetCode` (@unique) | `"CP-00123"` | มีอยู่แล้ว |
| `meter` | `MeterReading.readingId` (ต้องเพิ่ม @unique) | `"R-2024-001"` | **ต้องเพิ่ม field + index** |
| `stock-item` | `StockItem.productCode` (@unique) | `"PRD-001"` | มีอยู่แล้ว |
| `stock-txn` | `StockTransaction.sourceKey` (มีอยู่ แต่ไม่ @unique) | `"STOCK-row-42"` | **ต้องเพิ่ม @unique + index** |
| `purchase-order` | `PurchaseOrder.poNumber` (@unique) | `"PO-2024-001"` | ตรวจสอบว่ามี @unique |

**งานเตรียม schema (ทำใน Phase 1 เพื่อใช้ทั้งระบบ):**
- เพิ่ม `MeterReading.readingId String? @unique` (ถ้ายังไม่มี)
- เพิ่ม `StockTransaction.sourceKey` เป็น `@unique` (ถ้ายังไม่มี — ตรวจ duplicate เดิมก่อน)
- ถ้ามี duplicate เดิม: backfill ให้ `sourceKey = "legacy-" + id` ก่อนใส่ constraint

---

## 5. API Contract

### 5.1 `POST /api/sync/preview`

**Request:**
```json
{
  "source": "services",
  "target": "work-order",
  "options": {
    "since": "2024-01-01T00:00:00Z",
    "siteFilter": "UDH",
    "limit": 500
  }
}
```

**Response (200):**
```json
{
  "syncRun": {
    "id": "clxxx...",
    "mode": "preview",
    "status": "completed",
    "totalRows": 42,
    "createRows": 5,
    "updateRows": 12,
    "skipRows": 23,
    "errorRows": 2,
    "durationMs": 3400
  },
  "items": [
    {
      "id": "item-1",
      "externalKey": "12345",
      "action": "update",
      "status": "pending",
      "before": { "status": "PENDING", "subject": "..." },
      "after":  { "status": "IN_PROGRESS", "subject": "..." }
    },
    {
      "id": "item-2",
      "externalKey": "12346",
      "action": "create",
      "status": "pending",
      "before": null,
      "after":  { "requestId": "12346", "subject": "..." }
    },
    {
      "id": "item-3",
      "externalKey": "12347",
      "action": "error",
      "status": "error",
      "errorMessage": "field 'site' is required but missing"
    }
  ]
}
```

**พฤติกรรม:**
- ดึงข้อมูลจาก source (server-side)
- เทียบกับข้อมูลใน DB ปัจจุบัน (ใช้ externalKey)
- สร้าง `SyncRun` (mode=`preview`, status=`completed`) + `SyncRunItem[]`
- **ไม่เขียน** WorkOrder/Device/StockItem ใดๆ

### 5.2 `POST /api/sync/run`

**Request:**
```json
{
  "previewRunId": "clxxx...",
  "itemIds": null
}
```

**Response (200):**
```json
{
  "syncRun": {
    "id": "clyyy...",
    "mode": "apply",
    "status": "completed",
    "retryOf": null,
    "totalRows": 17,
    "createRows": 5,
    "updateRows": 12,
    "errorRows": 0,
    "durationMs": 2100
  }
}
```

**พฤติกรรม:**
- โหลด `SyncRun` (mode=preview) + items ที่ pending
- แต่ละ item apply ใน **transaction** (ดูส่วน 7)
- สร้าง `SyncRun` ใหม่ (mode=`apply`) เก็บสถิติผลลัพธ์
- อัปเดต `SyncRunItem.status` → `applied`/`error` + `entityId`

### 5.3 `GET /api/sync/runs?source=services&limit=20`

List SyncRun history (ทั้ง preview และ apply) — สำหรับหน้า "ประวัติการ Sync"

### 5.4 `GET /api/sync/runs/:id`

ดูรายละเอียด SyncRun หนึ่งรายการ + items (paginate)

### 5.5 `POST /api/sync/runs/:id/retry`

Retry เฉพาะ items ที่ `status=error` — สร้าง SyncRun ใหม่ (mode=`apply`, retryOf=original)

---

## 6. Idempotency

**กฎ:** การ sync ซ้ำ (preview หรือ apply) บนข้อมูลเดียวกันต้องให้ผลลัพธ์เดียวกัน ไม่สร้าง duplicate

**การ implement:**
1. ทุก lookup ใช้ `externalKey` (requestId / assetCode / productCode) — **ไม่ใช้** `id` ภายใน
2. Preview เปรียบเทียบ `after` กับ record ปัจจุบัน:
   - ถ้าเหมือนเป๊ะ → `action: 'skip'`, `status: 'skipped'`
   - ถ้าต่าง → `action: 'update'`
   - ถ้าไม่มีใน DB → `action: 'create'`
3. Apply ใช้ conditional versioned create/update (ไม่ใช่ Prisma upsert):
   - Re-read record ใน transaction
   - ตรวจ baseline: `expectedExists` + `expectedVersion`
   - Update ด้วย `where: { id, version: existing.version }` → `version: { increment: 1 }`
   - Create ถ้าไม่มี
   - Unique conflict จาก externalKey → `CONFLICT` error
4. ถ้าภายใน transaction เจอว่า record ถูกแก้ระหว่าง preview→apply (เช่น `version` เปลี่ยน):
   - ใช้ optimistic concurrency (เหมือน B4 pattern) — ถ้า `version` ไม่ตรง → ทำเครื่องหมาย item เป็น `error` พร้อมข้อความ "stale — re-run preview"
   - **ไม่ override** การแก้ไขที่เกิดหลัง preview

**Edge case — Soft delete:** ระบบยังไม่รองรับ delete จาก sync (legacy ไม่มี concept นี้) ถ้า record หายไปจาก source ระบบจะไม่ลบใน DB (เก็บไว้) — บันทึกเป็น warning ใน `SyncRun.errorMessage`

---

## 7. Transaction & Concurrency (สอดคล้องกับ B4)

Apply แต่ละ item ทำภายใต้ **serializable transaction** + **optimistic concurrency** — reuse pattern ที่ B4 สร้างไว้:

```typescript
import { withSerializableRetryTracked } from '@/lib/retry-transaction'
import { db } from '@/lib/db'

await withSerializableRetryTracked(async (tx) => {
  // 1. Re-check externalKey ใน transaction (กัน race)
  const existing = await tx.workOrder.findUnique({
    where: { requestId: item.externalKey },
    select: { id: true, version: true },
  })

  // 2. Conflict detection ด้วย preview baseline (P1 fix: TOCTOU window)
  //    expectedExists + expectedVersion persist ตอน preview (ใน SyncRunItem)
  //    ตอน apply ต้องตรวจสอบว่าสถานะยังตรงกับ baseline:
  //      a) preview คาดว่าจะ update (expectedExists=true) แต่ record หายไป → CONFLICT (deleted)
  //      b) preview คาดว่าจะ create (expectedExists=false) แต่ record ปรากฏ → CONFLICT (created by someone else)
  //      c) record ยังอยู่ แต่ version เปลี่ยน → CONFLICT (edited after preview)
  if (item.expectedExists && !existing) {
    throw new ConflictError('record deleted after preview — re-run preview')
  }
  if (!item.expectedExists && existing) {
    throw new ConflictError('record created by another source after preview — re-run preview')
  }

  // 3. Conditional versioned create/update (NOT Prisma upsert — F-07/F-14)
  //    Algorithm: re-read → check baseline → conditional update/create → unique conflict = CONFLICT
  let targetWorkOrderId: string

  if (existing) {
    // expectedVersion guaranteed non-null when expectedExists=true (preview set it)
    if (item.expectedVersion != null && existing.version !== item.expectedVersion) {
      throw new ConflictError(`version ${existing.version} ≠ preview baseline ${item.expectedVersion}`)
    }
    const updated = await tx.workOrder.update({
      where: { id: existing.id, version: existing.version },
      data: { ...patch, version: { increment: 1 } },
    })
    targetWorkOrderId = updated.id
  } else {
    const created = await tx.workOrder.create({ data: { ...newData } })
    targetWorkOrderId = created.id
  }

  // 4. Audit log ใน transaction เดียวกัน (atomic)
  //    AuditLog.detail เป็น String? — ต้อง JSON.stringify()
  //    before/after ผ่าน redaction allowlist ก่อน (ห้ามเก็บ credential/PII)
  const auditDetail = {
    before: redacted(item.before),   // redacted = ลบ PII/credential ตาม allowlist
    after: redacted(item.after),
    syncRunId: runId,
    externalKey: item.externalKey,
  }

  await tx.auditLog.create({
    data: {
      action: 'SYNC_APPLY',
      entity: 'WorkOrder',
      entityId: targetWorkOrderId,
      summary: `Sync ${item.action} from ${source} (key=${item.externalKey})`,
      detail: JSON.stringify(auditDetail),  // String, not object
      actor: triggeredBy,
      siteCode: derivedSite,
    },
  })

  // 5. อัปเดต SyncRunItem ใน transaction เดียวกัน
  await tx.syncRunItem.update({
    where: { id: item.id },
    data: { status: 'applied', entityId: targetWorkOrderId, processedAt: new Date() },
  })
})
```

**สิ่งที่ต้องระวัง:**
- **ไม่** reuse `WorkOrder.version` ของ B4 โดยตรงสำหรับ sync conflict detection — sync ใช้ `expectedVersion` ที่บันทึกตอน preview เป็น baseline ถ้า user แก้ WO หลัง preview แล้ว sync จะตรวจจับได้
- ถ้าเจอ P2034 (serialization conflict) → retry ผ่าน `withSerializableRetryTracked` (เหมือน B4)
- แต่ละ item apply แยก transaction — ไม่ wrap ทั้ง batch ใน transaction เดียว (เพราะ batch อาจ 500 แถว จะ lock นานเกินไป)

---

## 8. Site Authorization

Sync ต้องเคารพ Site scope ของผู้ใช้ที่กด sync — **ไม่** sync ข้าม Site ที่ผู้ใช้ไม่มีสิทธิ์

### 8.1 การตรวจสอบสิทธิ์

```typescript
// Auth helpers (target SHA — ไม่แก้ B4 frozen files):
// - requireAuth()              → src/lib/auth-middleware.ts
// - buildAuthorizationContext() → src/lib/authorization-context.ts
// - ctx.canAtSite()            → AuthorizationContext interface (authorization-context.ts)
// - canAccessSite()            → src/lib/auth-shared.ts (import only, frozen)
const auth = await requireAuth(req, 'ADMIN')  // ใช้ ADMIN แทน SYNC_RUN (B4 frozen rule)
const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

// superadmin → sync ได้ทุก Site (ctx.canAtSite always true)
// non-superadmin → sync ได้เฉพาะ Site ที่ ctx.canAtSite(siteCode, 'ADMIN') = true
```

### 8.2 การกรอง Site

- ถ้า `options.siteFilter` ระบุ → ตรวจ `ctx.canAtSite(siteFilter, 'ADMIN')` ก่อน
- ถ้าไม่ระบุและ non-superadmin → sync เฉพาะ Site ใน `ctx.siteScope.siteCodes`
- แต่ละ `SyncRunItem` ที่สร้างต้องมี Site ที่ผู้ใช้มีสิทธิ์ — ถ้า item ไหนมี Site นอก scope → ทำเครื่องหมายเป็น `error` พร้อมข้อความ "out of site scope"

### 8.3 Permission

**MVP (ไม่แก้ B4 frozen file):** ใช้ `ADMIN` permission ร่วมกับ `canAtSite()`:
- `requireAuth(req, 'ADMIN')` — แทนการเพิ่ม `SYNC_RUN` permission ใน `auth-shared.ts` (ซึ่งเป็น B4 frozen file)
- `canAtSite(siteFilter, 'ADMIN')` — reuse B4 helper สำหรับ Site scope
- admin role มี `ADMIN` permission อยู่แล้ว ไม่ต้องแก้ seed

**อนาคต (หลัง PR-SYNC-1 ผ่าน):** หากต้องการ `SYNC_RUN` permission แยกจาก `ADMIN` ต้องขอ freeze exception สำหรับ `auth-shared.ts` แยกต่างหาก

### 8.4 Audit

ทุก SyncRun บันทึก:
- `triggeredBy` = user email
- `siteScope` = Site code ที่ sync (หรือ null สำหรับ multi-site/superadmin)
- แต่ละ `SyncRunItem` apply → `AuditLog` row (action=`SYNC_APPLY`) พร้อม `siteCode` (สอดคล้องกับ B4 audit producers)

---

## 9. Preview (No-Write) Guarantee

**กฎเหล็ก:** Preview mode ต้อง **ไม่เขียน** ข้อมูลจริงใดๆ ลง WorkOrder/Device/StockItem

**การ implement:**
1. Adapter ดึงข้อมูลจาก source → array ของ records
2. สำหรับแต่ละ record: คำนวณ `action` โดย query แบบ read-only (`findUnique` เท่านั้น)
3. เก็บผลใน `SyncRunItem` (status=`pending`)
4. สร้าง `SyncRun` (mode=`preview`, status=`completed`)
5. **ไม่เรียก** `create`/`update`/`upsert` ใดๆ บนตาราง business data

**การทดสอบ:**
- Unit test: รัน preview 2 ครั้ง → จำนวน record ใน DB ไม่เปลี่ยน
- Integration test: รัน preview → ตรวจว่าไม่มี AuditLog row ใหม่ (ยกเว้น `SYNC_PREVIEW` ถ้าต้องการ audit preview ด้วย — เลือกได้)

---

## 10. Retry & Error Handling

### 10.1 Retry levels

| Level | อะไร | กลไก |
|-------|------|------|
| **Item-level retry** | item ที่ error ใน batch | `POST /api/sync/runs/:id/retry` → SyncRun ใหม่ (retryOf=original) |
| **Transaction-level retry** | P2034 serialization conflict | `withSerializableRetryTracked` (reuse B4) |
| **Source-level retry** | Apps Script ตอบ 5xx / timeout | exponential backoff ใน adapter (3 ครั้ง, 1s/2s/4s) |

### 10.2 Quarantine

Item ที่ error จะไม่ block batch — แต่จะถูกแยกไว้:
- `SyncRunItem.status = 'error'` + `errorMessage`
- แสดงในหน้าผลลัพธ์ ในส่วน "รายการที่ผิดพลาด"
- ผู้ใช้กด retry ได้เฉพาะกลุ่ม error หรือทีละ item

### 10.3 Error categories

| category | ตัวอย่าง | การจัดการ |
|----------|---------|----------|
| `SOURCE_UNREACHABLE` | Apps Script 5xx, timeout | retry 3 ครั้ง → ถ้ายัง fail → SyncRun.status=`failed` |
| `SOURCE_AUTH` | token หมดอายุ | ไม่ retry → แจ้ง admin ให้ refresh credential |
| `VALIDATION` | field required หาย, status ไม่ map | item-level error (ไม่ retry — ต้องแก้ข้อมูลต้นทาง) |
| `CONFLICT` | version mismatch (stale preview) | ไม่ retry อัตโนมัติ → แนะนำให้ re-preview |
| `DB` | Prisma error อื่นๆ | item-level error + log |
| `OUT_OF_SCOPE` | item มี Site นอกสิทธิ์ผู้ใช้ | item-level error (skip, ไม่ retry) |

---

## 11. UI / UX

### 11.1 หน้าใหม่: "ซิงค์ข้อมูล" (เพิ่มใน sidebar)

เปิดจาก sidebar → `activePage: 'sync'` → component `src/components/itam/sync-page.tsx`

**Layout (desktop):**
```
┌─────────────────────────────────────────────────────────┐
│ 🔄 ซิงค์ข้อมูลจากระบบเก่า                                  │
│   เลือกแหล่งข้อมูล → ดูตัวอย่าง → ยืนยัน                   │
├─────────────────────────────────────────────────────────┤
│ [Services ▾]  [Work Orders ▾]  [Site: ทั้งหมด ▾]        │
│                                                          │
│ ┌─ Preview ─────────────────────────────────────────┐  │
│ │ กด "ดูตัวอย่างการเปลี่ยนแปลง" เพื่อดึงข้อมูลจากระบบเก่า │  │
│ │ โดยยังไม่บันทึก — ระบบจะแสดงสรุป create/update/skip │  │
│ │                                                    │  │
│ │ [ 🔍 ดูตัวอย่างการเปลี่ยนแปลง ]  ← primary CTA      │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ (หลังกด Preview — แสดงผล)                               │
│ ┌─ สรุป ────────────────────────────────────────────┐  │
│ │ ✅ สร้างใหม่ 5  •  ✏️ แก้ไข 12  •  ⏭️ ข้าม 23  •  ⚠️ ผิดพลาด 2 │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌─ รายการ ──────────────────────────────────────────┐  │
│ │ [ทั้งหมด] [สร้าง] [แก้ไข] [ข้าม] [ผิดพลาด]  ← filter │  │
│ │ ┌──────────────────────────────────────────────┐   │  │
│ │ │ ☑ key=12345  update  PENDING→IN_PROGRESS    │   │  │
│ │ │ ☑ key=12346  create  (ใหม่)                 │   │  │
│ │ │ ☐ key=12347  error   field 'site' missing   │   │  │
│ │ └──────────────────────────────────────────────┘   │  │
│ │ [เลือกทั้งหมด] [ยกเลิกเลือก]                          │  │
│ │                                                    │  │
│ │ [ ✅ ยืนยันการนำเข้า (17 รายการ) ]  ← primary CTA │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌─ ประวัติการซิงค์ (collapsible) ────────────────────┐  │
│ │ 2024-...  apply  Services→WorkOrder  17/17 ✅     │  │
│ │ 2024-...  preview Services→WorkOrder  42 items    │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 11.2 Mobile

- Source/Target selector: horizontal scrollable (เหมือน import-page ที่แก้แล้ว)
- Primary CTA ("ดูตัวอย่าง" / "ยืนยัน"): `w-full` full-width
- รายการ diff: `max-h-[60vh] overflow-y-auto` พร้อม sticky filter bar
- ประวัติ: Collapsible (collapsed by default)

### 11.3 States

| state | แสดง |
|-------|------|
| **idle** | ปุ่ม "ดูตัวอย่าง" |
| **preview-loading** | spinner + "กำลังดึงข้อมูลจากระบบเก่า..." |
| **preview-done** | สรุป + รายการ diff + ปุ่ม "ยืนยัน" |
| **apply-loading** | progress bar (x/total) + ปุ่ม disabled |
| **apply-done** | สรุปผล + "ดูรายการที่ผิดพลาด" (ถ้ามี) + "ซิงค์อีกครั้ง" |
| **error (source)** | ข้อความ + ปุ่ม "ลองใหม่" |
| **empty** | "ยังไม่มีการซิงค์ — กด ดูตัวอย่าง เพื่อเริ่ม" |

---

## 12. Configuration & Secrets

Environment variables (ฝั่ง server เท่านั้น — ไม่ expose ให้ browser):

```env
# Apps Script Web App (Services / Stock)
APPS_SCRIPT_SERVICES_URL=https://script.google.com/macros/s/AKfyc.../exec
APPS_SCRIPT_SERVICES_TOKEN=...
APPS_SCRIPT_STOCK_URL=https://script.google.com/macros/s/AKfyc.../exec
APPS_SCRIPT_STOCK_TOKEN=...

# Google Sheets API v4 (IT-Asset-Management)
GOOGLE_SERVICE_ACCOUNT_JSON=@./secrets/service-account.json
GOOGLE_SHEETS_ITAM_SHEET_ID=1Abc...

# Sync behavior
SYNC_SOURCE_TIMEOUT_MS=30000
SYNC_SOURCE_MAX_RETRIES=3
SYNC_BATCH_SIZE=500
SYNC_PREVIEW_MAX_ROWS=1000
```

**การจัดการ credential:**
- ไม่ hardcode ในโค้ด
- ไม่ log token ใน dev.log
- ใน production ใช้ secret manager (Vercel env / Supabase vault)
- ถ้า credential หาย → sync ล้มเหลวพร้อมข้อความ "SOURCE_AUTH — ติดต่อ admin"

---

## 13. แผนการส่งมอบ (Phased PRs)

| PR | scope | ไฟล์หลัก | acceptance |
|----|-------|---------|-----------|
| **PR-SYNC-1** | MVP: Services → Work Orders | `SyncRun`, `SyncRunItem` model + migration; `/api/sync/preview`, `/api/sync/run`; `sync-page.tsx`; adapter `services-adapter.ts` | sync ใบงาน 50 รายการจาก Services เก่าได้ พร้อม preview + apply + retry |
| **PR-SYNC-2** | IT-Asset → Devices + Meter | `itam-adapter.ts` (Google Sheets API v4); เพิ่ม target `device` + `meter` | sync อุปกรณ์ + มิเตอร์ได้ พร้อม idempotency |
| **PR-SYNC-3** | Stock → Products + Transactions + PO | `stock-adapter.ts`; target `stock-item` + `stock-txn` + `purchase-order`; เพิ่ม `sourceKey` @unique | sync สต็อกได้ครบ |
| **PR-SYNC-4** | Cleanup | ซ่อน/ลบ LegacyImportSection CSV path; ย้าย import-page ให้เป็น "manual CSV fallback (collapsed)" | CSV upload ยังใช้ได้แต่ไม่เด่น |

**กฎการแยก PR:**
- แต่ละ PR ต้องผ่าน lint + tsc + test ได้เอง
- ไม่ merge PR ถัดไปจนกว่า PR ก่อนหน้า stable ≥ 3 วันใน staging
- **ไม่แตะ** B4 baseline (retry/transaction/authz) — reuse ผ่าน helper เท่านั้น

---

## 14. Acceptance Criteria

### 14.1 Phase 1 (MVP — Services → Work Orders)

| # | criteria | วิธีตรวจ |
|---|---------|---------|
| 1 | `POST /api/sync/preview` ดึง Work Orders จาก Services และคืน diff โดยไม่เขียน DB | รัน preview 2 ครั้ง → จำนวน WO ใน DB ไม่เปลี่ยน |
| 2 | `POST /api/sync/run` apply preview ได้ และ WorkOrder ใหม่/แก้ไขปรากฏในระบบ | ตรวจ `db.workOrder.count()` เพิ่มตาม createRows |
| 3 | sync ซ้ำ (apply 2 ครั้ง) ไม่สร้าง duplicate | `requestId` unique ไม่ duplicate |
| 4 | item ที่ unchanged ถูก mark `skip` (ไม่ update โดยไม่จำเป็น) | skipRows > 0 เมื่อ sync รอบที่ 2 |
| 5 | superadmin sync ได้ทุก Site; non-superadmin sync ได้เฉพาะ Site ที่มี grant | ลอง sync ด้วย demo_staff → item ที่ Site อื่นถูก mark error `OUT_OF_SCOPE` |
| 6 | ทุก apply สร้าง AuditLog (action=`SYNC_APPLY`) พร้อม `siteCode` | query AuditLog หลัง sync |
| 7 | ถ้า WO ถูกแก้หลัง preview → apply ตรวจจับ version mismatch → mark error `CONFLICT` | แก้ WO หลัง preview แล้ว apply |
| 8 | P2034 ระหว่าง batch → retry อัตโนมัติ ไม่ตอบ 500 | จำลอง conflict (เหมือน B4 test) |
| 9 | UI แสดง Preview → รายการ diff → ยืนยัน → ผลลัพธ์ ครบ flow | agent-browser walkthrough |
| 10 | ปุ่ม "ดูตัวอย่าง" / "ยืนยัน" visible ใน viewport แรก (mobile + desktop) | ตรวจด้วย agent-browser |
| 11 | credential ไม่ปรากฏใน browser (network tab, localStorage, response body) | ตรวจ DevTools |
| 12 | ประวัติ SyncRun แสดงได้ พร้อม filter ตาม source/status | UI + API |
| 13 | retry item ที่ error ได้ โดยไม่กระทบ item ที่ success แล้ว | `POST /api/sync/runs/:id/retry` |

### 14.2 Cross-cutting

| # | criteria |
|---|---------|
| 14 | `bunx eslint` ผ่าน 0 error ทุกไฟล์ใหม่ |
| 15 | `npx tsc --noEmit` ไม่มี error ใหม่ในไฟล์ที่แก้ |
| 16 | ไม่ break test เดิม (authorization-matrix, route-integration, concurrency) |
| 17 | migration ผ่าน PostgreSQL จริง (production gate) — SQLite ใช้เฉพาะ local development/testing เท่านั้น ไม่ใช่ evidence |
| 18 | ไม่แก้ B4 baseline — ใช้ `withSerializableRetryTracked` / `loadAuthorizedWorkOrder` / `buildAuthorizationContext` ผ่าน import เท่านั้น |

---

## 15. ความเสี่ยง & Mitigation

| ความเสี่ยง | impact | mitigation |
|-----------|--------|-----------|
| Apps Script เก่า rate limit / timeout | sync ล้มเหลว | batch + exponential backoff + แสดง error ชัดเจน |
| Credential หมดอายุระหว่าง sync | batch ครึ่งทาง fail | แต่ละ item แยก transaction → items ที่ success แล้วไม่ rollback; ผู้ใช้ retry เฉพาะที่เหลือ |
| ข้อมูล legacy สกปรก (field หาย, status แปลก) | validation error เยอะ | quarantine + รายงาน error รายแถว ให้ผู้ใช้แก้ที่ต้นทาง |
| Preview ใหญ่เกินไป (1000+ แถว) | UI ช้า / memory | cap `SYNC_PREVIEW_MAX_ROWS=1000` + paginate |
| Conflict ระหว่าง preview → apply | ข้อมูลไม่ตรง | optimistic version check → mark `CONFLICT` → re-preview |
| ผู้ใช้ sync ทับข้อมูลที่แก้ใน NextJS | สูญเสียการแก้ไข | version check + `CONFLICT` error → ไม่ override |
| Migration เพิ่ม @unique แต่มี duplicate เดิม | migration fail | backfill `sourceKey = "legacy-" + id` ก่อนใส่ constraint |

---

## 16. ไฟล์ที่คาดว่าจะสร้าง/แก้ (Phase 1)

**สร้างใหม่:**
- `prisma/schema.prisma` — เพิ่ม `SyncRun` + `SyncRunItem` model
- `prisma/migrations/{ts}_add_sync_run_tables/migration.sql`
- `src/lib/sync/types.ts` — shared types (SyncSource, SyncTarget, SyncRunStatus, ...)
- `src/lib/sync/adapter.ts` — adapter interface + factory
- `src/lib/sync/services-adapter.ts` — Services → WorkOrder adapter (Phase 1)
- `src/lib/sync/diff.ts` — compute create/update/skip diff
- `src/lib/sync/apply.ts` — apply logic (transaction + version check + audit)
- `src/app/api/sync/preview/route.ts`
- `src/app/api/sync/run/route.ts`
- `src/app/api/sync/runs/route.ts` (list)
- `src/app/api/sync/runs/[id]/route.ts` (detail)
- `src/app/api/sync/runs/[id]/retry/route.ts`
- `src/components/itam/sync-page.tsx`
- `src/components/itam/sync-preview-list.tsx`
- `src/components/itam/sync-history.tsx`

**แก้:**
- `src/lib/auth-shared.ts` — **ไม่แก้** (B4 frozen file) — ใช้ `ADMIN` แทน `SYNC_RUN` ใน MVP
- `src/components/itam/sidebar.tsx` — เพิ่ม nav item "ซิงค์ข้อมูล"
- `src/store/app-store.ts` — เพิ่ม `activePage: 'sync'`
- `src/app/page.tsx` — route `sync` → `SyncPage`

**ไม่แตะ (B4 baseline):**
- `src/lib/retry-transaction.ts` (ใช้ผ่าน import)
- `src/lib/wo-authz.ts` (ใช้ผ่าน import)
- `src/lib/authorization-context.ts` (ใช้ผ่าน import)

---

## 17. ข้อความพร้อมส่งทีมพัฒนา

> **หัวข้อ: โจทย์งาน — Legacy Apps Script → ITAM-NextJS Manual Sync (Server-side Pull Adapter)**
>
> ทีมพัฒนาครับ
>
> หลังจาก B4 Final Closure ผ่าน (GO ที่ ee75164) ขอเปิด workstream ใหม่เพื่อแทนที่ CSV Upload legacy path ด้วย **Server-side Pull Adapter** ที่ให้ผู้ใช้กด Preview / Sync จาก ITAM-NextJS ได้โดยตรง โดย backend เป็นผู้เรียก Apps Script ฝั่ง server — browser ไม่เห็น credential ใดๆ
>
> **เป้าหมายหลัก:**
> 1. ลดขั้นตอน export-download-upload ให้เหลือกดปุ่มเดียว
> 2. ให้ผู้ใช้เห็น diff (create/update/skip) ก่อน commit (Preview no-write)
> 3. Idempotent — sync ซ้ำไม่ duplicate
> 4. เคารพ Site authorization + audit ทุกครั้ง
>
> **ลำดับการส่งมอบ (แยก PR):**
> - **PR-SYNC-1 (MVP):** Services → Work Orders
> - **PR-SYNC-2:** IT-Asset → Devices + Meter
> - **PR-SYNC-3:** Stock → Products + Transactions + PO
> - **PR-SYNC-4:** Cleanup (ซ่อน CSV legacy path)
>
> CSV Upload ยังคงไว้เป็น fallback จนกว่า sync จะ stable ≥ 2 สัปดาห์
>
> **ขอย้ำกฎเหล็ก 3 ข้อ:**
> 1. Preview mode ต้อง **ไม่เขียน** ข้อมูลจริงใดๆ
> 2. ทุก apply ใช้ **transaction + optimistic version check** (reuse B4 `withSerializableRetryTracked`) — ถ้า WO ถูกแก้หลัง preview ต้องตรวจจับได้ และ **ไม่ override**
> 3. Credential ของ Apps Script / Google Sheets อยู่ฝั่ง **server เท่านั้น** — ห้ามส่งกลับ browser ไม่ว่ากรณีใด
>
> เอกสารฉบับเต็ม (สถาปัตยกรรม, API contract, data model, idempotency, acceptance criteria) อยู่ใน `docs/TASK-legacy-sync.md`
>
> ขอให้เริ่มจาก PR-SYNC-1 (MVP Services → Work Orders) โดยส่ง audit list ก่อน implementation เพื่อ review ด้วยกันก่อนครับ

---

*เอกสารนี้จัดทำบน baseline `ee75164` (หลัง B4 Final Closure) และแยกจากทั้ง B4 PR และ UX/UI PR — ไม่แก้ B4 baseline ใดๆ*
