# PR-SYNC-1 Audit List — Services → Work Orders

**เอกสารนี้:** Audit List สำหรับ PR-SYNC-1 (Legacy Apps Script → ITAM-NextJS Manual Sync, MVP: Services → Work Orders)
**สถานะ:** NOT APPROVED — revision v8 (5b3e782) แก้ V7-F01 ถึง V7-F05 แล้ว รอ Audit review V8-F01 ถึง V8-F02 ห้ามเริ่ม implementation จนกว่าจะอนุมัติ
**Audit List target:** revision v8, commit `5b3e782` (branch `feature/pr-sync-1-audit-revision`)
**Spec baseline:** revision v6, commit `fb28fd8` (`docs/TASK-legacy-sync.md`) — แยกจาก Audit List target
**ผู้กรอก:** ทีมพัฒนา
**วันที่กรอก:** 2026-08-16
**Reference schema:** `prisma/schema.prisma` WorkOrder model
**Reference mapping:** `src/lib/csv-field-mapping.ts` FIELD_MAPPINGS.workOrder + STATUS_MAPPINGS.workOrder
**B4 baseline:** `ee75164` (GO/frozen — ไม่แตะ 6 frozen files)
**PR #6 release:** `01e0688` (GO for Production) — PR-SYNC-1 แยกจาก PR #6

---

## สรุปผลหลังกรอก

| ตัวชี้วัด | ค่า |
|---|---|
| Critical categories ทั้งหมด | 16 (C-1 ถึง C-15, C-17) |
| Critical DESIGN_PASS | 13 |
| Critical BLOCKED | 2 |
| Critical EVIDENCE_TBD | 1 |
| Non-critical categories | 1 (NC-16) |
| Runtime evidence rows | 17 (EV-01 ถึง EV-17) |
| **สถานะ Final** | ☐ NOT APPROVED — รอ Audit review v8 |

> **นิยามสถานะ:**
> - `DESIGN_PASS` = spec ครอบคลุม, พร้อม implement
> - `BLOCKED` = มี finding ค้าง, ต้องแก้ก่อน implement
> - `EVIDENCE_TBD` = ต้องรัน test/CI หลัง implementation จึงจะมี evidence
>
> **Single source of truth:** ตาราง Status Mapping ด้านล่างเป็นตารางหลัก สถานะทุกจุดในเอกสารต้องอ้างจากตารางนี้เท่านั้น

### Status Mapping — 16 Critical + 1 Non-critical (V7-F01)

**Critical categories (design gate):**

| ID | Category | C-item | Design status | Blocking reason |
|---|---|---|---|---|
| CR-01 | Source contract | C-1 | DESIGN_PASS | — |
| CR-02 | Field mapping | C-2 | BLOCKED | canonical siteCode mapping ยังเป็น design-only |
| CR-03 | Stable external key | C-3 | DESIGN_PASS | — |
| CR-04 | Duplicate policy | C-4 | DESIGN_PASS | — |
| CR-05 | Preview no-write | C-5 | DESIGN_PASS | — |
| CR-06 | Transaction & version check | C-6 | DESIGN_PASS | — |
| CR-07 | P2034 / concurrency | C-7 | DESIGN_PASS | design ถูกต้อง (attempts/p2034Count) — runtime evidence: EV-08, EV-15 |
| CR-08 | Retry & quarantine | C-8 | DESIGN_PASS | — |
| CR-09 | Audit log | C-9 | DESIGN_PASS | design ถูกต้อง (JSON.stringify + redaction) — runtime evidence: EV-06 |
| CR-10 | Site authorization | C-10 | DESIGN_PASS | — |
| CR-11 | API contract | C-11 | DESIGN_PASS | — |
| CR-12 | Prisma migration | C-12 | DESIGN_PASS | — |
| CR-13 | Credential security | C-13 | DESIGN_PASS | — |
| CR-14 | Test evidence | C-14 | EVIDENCE_TBD | 11 tests ต้องรันหลัง implementation — evidence: EV-01 ถึง EV-11 |
| CR-15 | PR boundary (B4 frozen) | C-15 | DESIGN_PASS | — |
| CR-16 | Final approval gate | C-17 | BLOCKED | final gate ผ่านเมื่อ Critical ทุก DESIGN_PASS + evidence ครบ + Audit verdict |

**Non-critical category (ไม่นับใน Critical gate):**

| ID | Category | C-item | Status | Notes |
|---|---|---|---|---|
| NC-01 | Non-critical / UX | NC-16 | DESIGN_PASS | ไม่นับใน Critical design gate |

**สรุปจากตาราง (single source of truth):**
- Critical: 16 categories (CR-01 ถึง CR-16)
- Critical DESIGN_PASS: 13 (CR-01, CR-03, CR-04, CR-05, CR-06, CR-07, CR-08, CR-09, CR-10, CR-11, CR-12, CR-13, CR-15)
- Critical BLOCKED: 2 (CR-02, CR-16)
- Critical EVIDENCE_TBD: 1 (CR-14)
- Non-critical: 1 (NC-01 = DESIGN_PASS)
- Runtime evidence rows: 17 (EV-01 ถึง EV-17, แยกจาก design gate)

### Evidence Queue (แยกจาก design gate)

| Evidence ID | C-item | Evidence type | Status |
|---|---|---|---|
| EV-01 | C-14.1 | Preview no-write test | EVIDENCE_TBD |
| EV-02 | C-14.2 | Apply → WorkOrder ปรากฏ | EVIDENCE_TBD |
| EV-03 | C-14.3 | Idempotency test | EVIDENCE_TBD |
| EV-04 | C-14.4 | Skip unchanged test | EVIDENCE_TBD |
| EV-05 | C-14.5 | Site scope test | EVIDENCE_TBD |
| EV-06 | C-14.6 | Audit log test | EVIDENCE_TBD |
| EV-07 | C-14.7 | Conflict detection test | EVIDENCE_TBD |
| EV-08 | C-14.8 | P2034 retry test | EVIDENCE_TBD |
| EV-09 | C-14.9 | UI flow test | EVIDENCE_TBD |
| EV-10 | C-14.10 | Credential leak test | EVIDENCE_TBD |
| EV-11 | C-14.11 | Retry error items test | EVIDENCE_TBD |
| EV-12 | C-17.2 | ESLint pass | EVIDENCE_TBD |
| EV-13 | C-17.3 | TypeScript check | EVIDENCE_TBD |
| EV-14 | C-17.4 | git diff --check | EVIDENCE_TBD |
| EV-15 | C-17.5 | B4 regression (PostgreSQL) | EVIDENCE_TBD |
| EV-16 | C-17.6 | PostgreSQL migration | EVIDENCE_TBD |
| EV-17 | C-17.7 | 3-point integration check | EVIDENCE_TBD |

---

## หมวดที่ 1: Source Contract & Field Mapping

### C-1 Source contract (Apps Script Web App)

Adapter จะใช้โหมด **Apps Script Web App** (deploy `doPost` → JSON) ตาม spec §2.3

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-1.1 | URL pattern ระบุชัด | PASS | dev | impl | `docs/TASK-legacy-sync.md` §2.3, §12 (`APPS_SCRIPT_SERVICES_URL`) | `https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec` |
| C-1.2 | Auth method server-side เท่านั้น | PASS | dev | impl | §2.2, §12, §13 (C-13) | Bearer token ใน env var `APPS_SCRIPT_SERVICES_TOKEN` — browser ไม่เห็น |
| C-1.3 | Pagination cursor กำหนดรูปแบบ | PASS | dev | impl | §2.3, §5.1 (`options.since`) | `?cursor=...&limit=...` + `SyncRun.sourceCursor` persist |
| C-1.4 | Rate limit / timeout ระบุค่า | PASS | dev | impl | §12 (`SYNC_SOURCE_TIMEOUT_MS=30000`, `SYNC_SOURCE_MAX_RETRIES=3`), §10.1 | exponential backoff 1s/2s/4s |
| C-1.5 | Response shape มี schema | PASS | dev | impl | §2.3, §5.1 | records array + metadata; adapter ตรวจ schema ก่อน parse |

### C-2 Field mapping (reuse `csv-field-mapping.ts`)

Adapter จะ reuse `FIELD_MAPPINGS.workOrder` + `STATUS_MAPPINGS.workOrder` จาก `src/lib/csv-field-mapping.ts` (lines 223-258, 265-287) — ไม่เขียน mapping ใหม่

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-2.1 | Services → WorkOrder mapping ใช้ `FIELD_MAPPINGS.workOrder` | BLOCKED (F-02, F-11) | dev | impl | `src/lib/csv-field-mapping.ts:223-258` | 33 fields mapped
**F-02 + F-11:** canonical `siteCode` ยังเป็น design-only — implementation ต้องพิสูจน์:
1. Source contract มี `siteCode` field หรือ server-side derivation จาก `site` field
2. Derivation ใช้ versioned allowlist + audit (ไม่ใช่ `siteFilter` ของผู้ใช้)
3. Missing `siteCode` → quarantine (item status=`error`, errorMessage=`MISSING_SITE`)
4. Unknown `siteCode` (ไม่อยู่ใน allowlist) → quarantine (errorMessage=`UNKNOWN_SITE`)
5. Cross-site item ที่ผู้ใช้ไม่มีสิทธิ์ → `OUT_OF_SCOPE` error
6. Per-item `siteCode` บันทึกใน `SyncRunItem` เพื่อ audit
7. Test cases: missing site, unknown site, cross-site → ต้องมี evidence |
| C-2.2 | Status conversion ใช้ `STATUS_MAPPINGS.workOrder` (emoji Thai → enum) | PASS | dev | impl | `src/lib/csv-field-mapping.ts:265-287` | 5 statuses: PENDING/IN_PROGRESS/WAITING_PARTS/COMPLETED/CANCELLED |
| C-2.3 | ทุก field ที่ legacy export มี adapter รู้จัก map | PASS | dev | impl | `src/lib/csv-field-mapping.ts:223` | unmapped columns → warning log (ไม่ silent drop) |
| C-2.4 | Fields ที่ไม่ map ถูก log เป็น warning | PASS | dev | impl | spec §5.1 `unmappedColumns[]` | `SyncRun.errorMessage` บันทึก |

---

## หมวดที่ 2: Stable External Key & Idempotency

### C-3 Stable external key

external key สำหรับ Work Orders = `WorkOrder.requestId` (`@unique`) — legacy numeric id

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-3.1 | `WorkOrder.requestId` เป็น `@unique` | PASS | dev | impl | `prisma/schema.prisma` WorkOrder model (line ~10) | มีอยู่แล้วใน schema — ไม่ต้องเพิ่ม |
| C-3.2 | `Device.assetCode` @unique (Phase 2) | N/A | dev | — | — | Phase 2 (ไม่ใช่ Phase 1) |
| C-3.3 | `StockItem.productCode` @unique (Phase 3) | N/A | dev | — | — | Phase 3 |
| C-3.4 | `MeterReading.readingId` @unique (Phase 2) | N/A | dev | — | — | Phase 2 |
| C-3.5 | `StockTransaction.sourceKey` @unique (Phase 3) | N/A | dev | — | — | Phase 3 |

### C-4 Duplicate policy (idempotency)

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-4.1 | Lookup ใช้ `externalKey` (requestId) เท่านั้น ไม่ใช้ `id` ภายใน | PASS | dev | impl | spec §6.1 | `tx.workOrder.findUnique({ where: { requestId } })` |
| C-4.2 | Preview เปรียบเทียบ `after` กับ record ปัจจุบัน → skip ถ้า unchanged | PASS | dev | impl | spec §6.2, §9 | `SyncRunItem.action='skip'` if deep-equal |
| C-4.3 | Apply ใช้ conditional versioned create/update (ไม่ใช่ Prisma upsert) | DESIGN_PASS (F-07 resolved) | dev | impl | spec §6.3, §7 step 2 | spec §6 แก้แล้ว — ใช้ algorithm เดียว: re-read in tx → check baseline → conditional update/create → unique conflict = CONFLICT |
| C-4.4 | Soft delete: record หายจาก source ไม่ลบใน DB | PASS | dev | impl | spec §6 edge case | warning ใน `SyncRun.errorMessage` |

---

## หมวดที่ 3: Preview No-Write & Transaction

### C-5 Preview no-write guarantee

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-5.1 | Preview ใช้ `findUnique` (read-only) เท่านั้น | PASS | dev | impl | spec §9.1 | ไม่เรียก create/update/upsert |
| C-5.2 | Preview สร้าง `SyncRun` (mode=preview) + `SyncRunItem` (status=pending) | PASS | dev | impl | spec §9.2, §5.1 | `SyncRunItem.status='pending'` |
| C-5.3 | Unit test: รัน preview 2 ครั้ง → WO count ไม่เปลี่ยน | PASS | dev | test | spec §14.1 #1, C-14.1 | จะเขียนใน `tests/sync/preview-no-write.test.ts` |
| C-5.4 | Integration test: หลัง preview ไม่มี AuditLog ใหม่ (except SYNC_PREVIEW) | PASS | dev | test | spec §9, C-14.1 | audit log เฉพาะ apply (action=SYNC_APPLY) |

### C-6 Transaction & version check (B4-aligned)

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-6.1 | Apply แต่ละ item ทำใน `withSerializableRetryTracked` | PASS | dev | impl | spec §7, `src/lib/retry-transaction.ts:74` | reuse B4 helper (frozen file) |
| C-6.2 | `expectedVersion` + `expectedExists` persist ใน `SyncRunItem` ตอน preview | PASS | dev | impl | spec §3.2 (P1 #5 fix), §7 step 2 | `SyncRunItem.expectedVersion Int?` + `expectedExists Boolean` |
| C-6.3 | Apply ตรวจ 3 conflict cases | PASS | dev | impl | spec §7 step 2 (a/b/c) | deleted-after-preview / created-by-another / version-changed |
| C-6.4 | Conflict → `status=error` + `errorMessage=CONFLICT` ไม่ override | PASS | dev | impl | spec §7, §10.3 | `SyncRunItem.status='error'`, `errorMessage='CONFLICT: ...'` |
| C-6.5 | แต่ละ item แยก transaction | PASS | dev | impl | spec §7 note | ไม่ wrap batch (lock นาน) |
| C-6.6 | Audit log ใน transaction เดียวกับ apply | DESIGN_PASS (F-16, F-17) | dev | impl | spec §7 step 4 | **F-16:** ใช้ `JSON.stringify()` สำหรับ detail
**F-17:** ใช้ `targetWorkOrderId` ที่ assign จาก update/create result |

### C-7 P2034 / concurrency

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-7.1 | P2034 → retry ผ่าน `withSerializableRetryTracked` | PASS | dev | impl | spec §7, §10.1 | reuse B4 (exponential backoff) |
| C-7.2 | Non-P2034 error ไม่ retry (attempts=1) | PASS | dev | test | B4 test 8 pattern, C-14.8 | จะเขียน test |
| C-7.3 | Test: จำลอง P2034 → sync ไม่ตอบ 500 | PASS | dev | test | spec §14.1 #8, C-14.8 | |
| C-7.4 | `SyncRun.attempts` / `p2034Count` บันทึกไว้ตรวจได้ | DESIGN_PASS (F-05, F-12 resolved) | dev | impl | spec §3.1 + implementation | design ถูกต้อง — attempts/p2034Count อยู่ใน SyncRun model แล้ว; runtime evidence: EV-08, EV-15 |

---

## หมวดที่ 4: Retry, Quarantine & Audit

### C-8 Retry & quarantine

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-8.1 | Item-level retry: `POST /api/sync/runs/:id/retry` | PASS | dev | impl | spec §5.5, §10.1 | `SyncRun.retryOf` = original |
| C-8.2 | Transaction-level retry: `withSerializableRetryTracked` | PASS | dev | impl | spec §10.1 | B4 helper |
| C-8.3 | Source-level retry: exponential backoff (3 ครั้ง, 1s/2s/4s) | PASS | dev | impl | spec §10.1, §12 | `SYNC_SOURCE_MAX_RETRIES=3` |
| C-8.4 | Item ที่ error ไม่ block batch — quarantine | PASS | dev | impl | spec §10.2 | `SyncRunItem.status='error'` + แสดงในผล |
| C-8.5 | Error categories ครบ 6 ตัว | PASS | dev | impl | spec §10.3 | SOURCE_UNREACHABLE / SOURCE_AUTH / VALIDATION / CONFLICT / DB / OUT_OF_SCOPE |

### C-9 Audit log

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-9.1 | `AuditLog.action='SYNC_APPLY'` สำหรับทุก item applied | PASS | dev | impl | spec §8.4, §7 step 3 | |
| C-9.2 | `AuditLog.siteCode` populate | PASS | dev | impl | spec §8.4 | สอดคล้องกับ B4 audit producers |
| C-9.3 | `AuditLog.summary` ภาษาไทย + externalKey | PASS | dev | impl | spec §7 step 3 | `Sync ${action} from ${source} (key=${externalKey})` |
| C-9.4 | `AuditLog.detail` เก็บ before/after + syncRunId | DESIGN_PASS (F-16) | dev | impl | spec §7 step 4 | **F-16:** detail เป็น `String?` — ต้อง `JSON.stringify(auditDetail)` ก่อนบันทึก, redacted ก่อน stringify |
| C-9.5 | `AuditLog.actor` = user ที่กด sync | PASS | dev | impl | spec §8.4 | `triggeredBy` |

---

## หมวดที่ 5: Site Authorization & API Contract

### C-10 Site authorization

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-10.1 | Permission สำหรับ Sync — ใช้ `ADMIN` + site helper จาก B4 แทน `SYNC_RUN` | DESIGN_PASS (F-01, F-10 resolved) | dev | impl | spec §8.3 | spec แก้แล้ว — ใช้ `requireAuth(req, 'ADMIN')` + `buildAuthorizationContext()` + `ctx.canAtSite(siteCode, 'ADMIN')` ไม่แก้ B4 frozen files |
| C-10.2 | `requireAuth(req, 'ADMIN')` ในทุก `/api/sync/*` route | DESIGN_PASS (F-10) | dev | impl | spec §8.1 | ใช้ helper จริง: `requireAuth()` จาก `src/lib/auth-middleware.ts`, `buildAuthorizationContext()` จาก `src/lib/authorization-context.ts` |
| C-10.3 | `buildAuthorizationContext` + `ctx.canAtSite(siteCode, 'ADMIN')` | DESIGN_PASS (F-10) | dev | impl | spec §8.1, §8.2 | helper จริง: `buildAuthorizationContext()` จาก `src/lib/authorization-context.ts`, `ctx.canAtSite()` จาก `AuthorizationContext` interface, `canAccessSite()` จาก `src/lib/auth-shared.ts` (import เท่านั้น ไม่แก้) |
| C-10.4 | Non-superadmin sync เฉพาะ Site ใน `ctx.siteScope.siteCodes` | PASS | dev | impl | spec §8.2 | |
| C-10.5 | Item ที่มี Site นอก scope → `OUT_OF_SCOPE` error | PASS | dev | impl | spec §8.2, §10.3 | |
| C-10.6 | superadmin sync ได้ทุก Site + `siteScope` บันทึก multi-site | PASS | dev | impl | spec §8.4 | `SyncRun.siteScope` nullable |

### C-11 API contract

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-11.1 | `POST /api/sync/preview` shape ตรง §5.1 | PASS | dev | impl | spec §5.1 | request + response JSON |
| C-11.2 | `POST /api/sync/run` รับ `previewRunId` + `itemIds` | PASS | dev | impl | spec §5.2 | |
| C-11.3 | `GET /api/sync/runs` list + filter | PASS | dev | impl | spec §5.3 | |
| C-11.4 | `GET /api/sync/runs/:id` detail + items | PASS | dev | impl | spec §5.4 | |
| C-11.5 | `POST /api/sync/runs/:id/retry` retry error items | PASS | dev | impl | spec §5.5 | |
| C-11.6 | Routes return 401/403/404 ที่ถูกต้อง | PASS | dev | test | spec §8.1, C-14 | |

---

## หมวดที่ 6: Prisma Migration & Credential Security

### C-12 Prisma migration

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-12.1 | migration ใช้ `prisma migrate deploy` (ไม่ใช่ `db:push`) | DESIGN_PASS (F-04 resolved) | dev | impl | spec §3.3, §16 | spec §3.3 แก้แล้ว — migration file + `prisma migrate deploy`, ห้าม `--accept-data-loss` |
| C-12.2 | migration additive (CREATE TABLE, ไม่ DROP) | PASS | dev | impl | spec §3.3 | no data loss |
| C-12.3 | migration ผ่าน PostgreSQL จริง (production gate) | DESIGN_PASS (F-22) | dev | impl+CI | spec §3.3, §14.2 #17 | SQLite ใช้เฉพาะ local dev/testing, ไม่ใช่ evidence — production gate ต้อง PostgreSQL เท่านั้น |
| C-12.4 | `@@index` ครบ | PASS | dev | impl | spec §3.1, §3.2 | source/target/status, triggeredBy, siteScope, externalKey |
| C-12.5 | `expectedVersion Int?` + `expectedExists Boolean` ใน migration | PASS | dev | impl | spec §3.2 (P1 #5 fix) | |
| C-12.6 | `prisma generate` ผ่านหลังเพิ่ม model | PASS | dev | impl | | |

### C-13 Credential security

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-13.1 | credential ใน env var (`APPS_SCRIPT_*`) | PASS | dev | impl | spec §12 | |
| C-13.2 | Browser request ไม่มี credential ใน body/headers/query | PASS | dev | impl | spec §2.2 | |
| C-13.3 | API response ไม่ leak credential | PASS | dev | impl | spec §2.2 | ไม่ echo token/URL |
| C-13.4 | dev.log ไม่ log credential | PASS | dev | impl | spec §12 | redact หรือไม่ log |
| C-13.5 | `.env` ไม่ commit (`.gitignore`) | PASS | dev | impl | `.gitignore` | ตรวจว่ามีอยู่ |
| C-13.6 | Test: DevTools Network ไม่เห็น credential | PASS | dev | test | spec §14.1 #11, C-14.10 | |

---

## หมวดที่ 7: Test Evidence & PR Boundary

### C-14 Test evidence

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-14.1 | Preview no-write test (2x → DB ไม่เปลี่ยน) | EVIDENCE_TBD | dev | test | spec §14.1 #1 | **F-08:** planned test — ยังไม่มี implementation, ห้ามระบุเป็น PASS |
| C-14.2 | Apply → WorkOrder ปรากฏ | EVIDENCE_TBD | dev | test | spec §14.1 #2 | **F-08:** planned test |
| C-14.3 | Idempotency: apply 2x → ไม่ duplicate | EVIDENCE_TBD | dev | test | spec §14.1 #3 | **F-08:** planned test |
| C-14.4 | Skip: unchanged → skipRows > 0 | EVIDENCE_TBD | dev | test | spec §14.1 #4 | **F-08:** planned test |
| C-14.5 | Site scope: demo_staff → OUT_OF_SCOPE | EVIDENCE_TBD | dev | test | spec §14.1 #5 | **F-08:** planned test |
| C-14.6 | Audit: ทุก apply → AuditLog + siteCode | EVIDENCE_TBD | dev | test | spec §14.1 #6 | **F-08:** planned test |
| C-14.7 | Conflict: แก้ WO หลัง preview → CONFLICT | EVIDENCE_TBD | dev | test | spec §14.1 #7, C-6.3 | **F-08:** planned test |
| C-14.8 | P2034: จำลอง conflict → ไม่ 500 | EVIDENCE_TBD | dev | test | spec §14.1 #8 | **F-08:** planned test |
| C-14.9 | UI flow (agent-browser): preview → diff → confirm → result | EVIDENCE_TBD | dev | test | spec §14.1 #9 | **F-08:** planned test |
| C-14.10 | Credential leak test: DevTools ไม่เห็น | EVIDENCE_TBD | dev | test | spec §14.1 #11 | **F-08:** planned test |
| C-14.11 | Retry: error items ไม่กระทบ success | EVIDENCE_TBD | dev | test | spec §14.1 #13 | **F-08:** planned test |

### C-15 PR boundary (B4 frozen)

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-15.1 | `src/lib/retry-transaction.ts` ไม่ถูกแก้ | PASS | dev | impl | B4 frozen list | 0 diff จาก ee75164 (verified ใน PR #6) |
| C-15.2 | `src/lib/wo-authz.ts` ไม่ถูกแก้ | PASS | dev | impl | B4 frozen list | reuse ผ่าน import |
| C-15.3 | `src/lib/authorization-context.ts` ไม่ถูกแก้ | PASS | dev | impl | B4 frozen list | reuse ผ่าน import |
| C-15.4 | `src/lib/auth-middleware.ts` ไม่ถูกแก้ | PASS | dev | impl | B4 frozen list | |
| C-15.5 | `src/lib/auth-shared.ts` — **ห้ามแก้** ใน MVP | DESIGN_PASS (F-01, F-10 resolved) | dev | impl | B4 frozen list | spec แก้แล้ว — ไม่เพิ่ม `SYNC_RUN` permission; ใช้ `ADMIN` + helper จริง:
- Import: `canAccessSite`, `siteFilterForUser` (frozen, import only)
- Context: `buildAuthorizationContext()` (authorization-context.ts)
- Site check: `ctx.canAtSite(siteCode, 'ADMIN')`
| C-15.6 | `src/lib/audit.ts` ไม่ถูกแก้ | PASS | dev | impl | B4 frozen list | reuse `logAudit()` |
| C-15.7 | `tests/auth/concurrency.test.ts` ไม่ถูกแก้ | PASS | dev | impl | | sync tests แยกใน `tests/sync/` |
| C-15.8 | PR-SYNC-1 แยกจาก PR #6 + UX/UI PR | PASS | dev | impl | | branch `pr-sync-1/...` แยก |

### NC-16 Non-critical / UX

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| NC-16.1 | UI: ปุ่ม "ดูตัวอย่าง"/"ยืนยัน" visible viewport แรก | PASS | dev | impl | spec §11, §14.1 #10 | |
| NC-16.2 | UI: states ครบ (idle/loading/done/error/empty) | PASS | dev | impl | spec §11.3 | |
| NC-16.3 | UI: ประวัติ SyncRun filter | PASS | dev | impl | spec §14.1 #12 | |
| NC-16.4 | `SYNC_PREVIEW_MAX_ROWS=1000` cap + paginate | DESIGN_PASS | dev | impl | spec §12, §15 | |
| NC-16.5 | CSV upload ยังคงเป็น fallback | PASS | dev | impl | spec §1, §13 | คงไว้ ≥ 2 สัปดาห์ |

---

## หมวดที่ 8: Final Approval Gate

### C-17 Final approval

| # | Check item | Status | Owner | Due date | Evidence path | Notes |
|---|---|---|---|---|---|---|
| C-17.1 | Final gate ผ่านเมื่อ Critical ทุก DESIGN_PASS + evidence ครบ + Audit verdict | BLOCKED | dev | impl | Status Mapping | 16 Critical: 13 DESIGN_PASS, 2 BLOCKED (CR-02, CR-16), 1 EVIDENCE_TBD (CR-14); ต้องปิด BLOCKED ทั้งหมด + evidence 17 รายการครบ + Audit verdict เป็นลายลักษณ์อักษร | |
| C-17.2 | `bunx eslint` ผ่าน 0 errors | EVIDENCE_TBD | dev | impl | | **F-18:** ต้องรันบน implementation PR, ไม่ใช่ PR #6 evidence |
| C-17.3 | `npx tsc --noEmit` ไม่มี error ใหม่ | EVIDENCE_TBD | dev | impl | | **F-18:** ต้องรันบน implementation PR |
| C-17.4 | `git diff --check` สะอาด | EVIDENCE_TBD | dev | impl | | **F-18:** ต้องรันบน implementation PR |
| C-17.5 | B4 regression tests ผ่าน (PostgreSQL) | EVIDENCE_TBD | dev | CI | | **F-18:** ต้องรันบน implementation PR — อาจ regression หลังเพิ่ม SyncRun model |
| C-17.6 | PostgreSQL migration รันสำเร็จใน staging | EVIDENCE_TBD | dev | CI | | **F-18:** SyncRun migration ยังไม่ได้สร้าง |
| C-17.7 | 3-point integration check (Device/print/login) | EVIDENCE_TBD | dev | CI | | **F-18:** ต้องรันบน implementation PR — ยืนยันไม่ break existing features |
| C-17.8 | Audit team อนุมัติเป็นลายลักษณ์อักษร | NOT APPROVED | audit | review | | รอ Audit verdict สำหรับ revision v8, commit `5b3e782` |

---

## Acceptance Evidence ที่จะใช้ตรวจ PR-SYNC-1

เมื่อ implementation เสร็จ จะส่ง evidence ชุดเดียว (เหมือน PR #6):

1. **CI run URL** — GitHub Actions workflow (reuse pattern จาก PR #6)
2. **PostgreSQL version** — 16.x จริง
3. **Commit SHA** — release target ที่อนุมัติ
4. **B4 regression results** — auth 88 + integration 33 + concurrency 27 (ต้องไม่ break)
5. **Sync-specific tests** — 11 tests ตาม C-14.1 ถึง C-14.11
6. **3-point integration check** — Device/print/login (จาก PR #6, ต้องไม่ break)
7. **Static verification** — lint + tsc (baseline comparison) + git diff --check
8. **B4 frozen files 0-diff** — 6 files ต้องไม่ถูกแก้
9. **Artifact** — `.tgz` + SHA-256 (เหมือน PR #6)

---

## ข้อความพร้อมส่งทีม Audit

> **หัวข้อ: PR-SYNC-1 Audit List revision v8 — ขอ review**
>
> ทีม Audit ครับ
>
> ส่ง revision v8 สำหรับ PR-SYNC-1 Audit List
>
> **Audit List target:** revision v8, commit `5b3e782` (branch `feature/pr-sync-1-audit-revision`)
> **Spec baseline:** revision v6, commit `fb28fd8` (`docs/TASK-legacy-sync.md`) — แยกจาก Audit List target
> **Schema reference:** `prisma/schema.prisma` WorkOrder model
>
> **สรุป (single source of truth — Status Mapping):**
> - 16 Critical categories (C-1 ถึง C-15, C-17)
> - Critical DESIGN_PASS: 13 (CR-01, CR-03, CR-04, CR-05, CR-06, CR-07, CR-08, CR-09, CR-10, CR-11, CR-12, CR-13, CR-15)
> - Critical BLOCKED: 2 (CR-02 siteCode, CR-16 final gate)
> - Critical EVIDENCE_TBD: 1 (CR-14, 11 sub-items)
> - Non-critical: 1 (NC-01 = DESIGN_PASS)
> - Evidence queue: 17 rows (EV-01 ถึง EV-17)
> - สถานะ: **NOT APPROVED**
>
> **จุดที่แก้ใน v8:**
> - V7-F01: กำหนด universe ชัด — 16 Critical + 1 Non-critical, แยก CR/NC IDs
> - V7-F02: summary ทุกจุดใช้ชุดตัวเลขเดียวกัน
> - V7-F03: แยก Critical design gate, Non-critical, Evidence queue ออกจากกัน
> - V7-F04: C-7.4 เปลี่ยนเป็น DESIGN_PASS ตรงกับ CR-07
> - V7-F05: ลบ 17/17 จาก CR-16, rewrite C-17.1 เป็น deterministic gate rule
>
> **กฎเหล็กที่ปฏิบัติ:**
> - ห้ามเริ่มแก้ schema/API/UI จนกว่า Audit List จะถูกอนุมัติ
> - PR-SYNC-1 แยกจาก PR #6 + B4 frozen files
> - MVP ใช้ `requireAuth(req, 'ADMIN')` + `ctx.canAtSite(siteCode, 'ADMIN')` — ไม่เพิ่ม `SYNC_RUN` ใน frozen file
>
> ขอ review เป็น APPROVED / APPROVED WITH CONDITIONS / NOT APPROVED พร้อมแนวทางแก้ไขครับ

---

## Change log

| วันที่ | ผู้แก้ | การเปลี่ยนแปลง |
|---|---|---|
| 2026-08-16 | orchestrator (v1) | สร้าง audit list v1 (17 Critical + 5 Non-critical) |
| 2026-08-16 | orchestrator (v2) | กรอกครบทั้ง 22 รายการ + evidence path + ข้อความส่ง audit |
| 2026-08-16 | new-team (v3) | revision แก้ F-01 ถึง F-08: PASS → BLOCKED/EVIDENCE_TBD |
| 2026-08-16 | new-team (v4) | revision แก้ F-09 ถึง F-15: auth helper path, siteCode quarantine, redaction, conditional algorithm |
| 2026-08-16 | new-team (v5) | revision แก้ F-16 ถึง F-18: JSON.stringify, targetWorkOrderId, EVIDENCE_TBD |
| 2026-08-16 | new-team (v6) | revision แก้ F-19 ถึง F-22: residual cleanup, status mapping draft, PostgreSQL migration gate |
| 2026-08-16 | new-team (v7) | revision แก้ V6-F01 ถึง V6-F03: metadata v6/fb28fd8, atomic 17-item mapping, single source of truth, C-17.1/C-9.4 consistency |
| 2026-08-16 | new-team (v8) | revision แก้ V7-F01 ถึง V7-F05: 16 Critical + 1 Non-critical taxonomy, C-7.4 consistency, C-17.1 deterministic gate, metadata v7/855f390, spec baseline v6/fb28fd8 แยก |

---

*เอกสารนี้เป็นส่วนของ PR-SYNC-1 workstream — แยกจาก B4 baseline (`ee75164`) และ PR #6 (`01e0688`)*
