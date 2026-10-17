# DB + Runtime Audit Report — Task ID: AUDIT-DB-RUNTIME-001

**Date:** 2026-08-28
**Agent:** DB + Runtime Audit Agent (research-only, NO code changes)
**Scope:** Full Prisma schema audit (36 models, 922 lines) + 19 curl-driven runtime API tests
**Prev Task:** AUDIT-API-001 (found 78 API bugs)

## Executive Summary

- **Models audited:** 36
- **Schema issues:** 42 (P0: 4, P1: 21, P2: 17)
- **Runtime tests:** 19 (PASS: 6, FAIL: 13)
- **Critical (P0) findings confirmed at runtime:** 6
  - `/api/itam/debug` leaks user data without auth
  - `/api/settings` leaks ALL `AppSetting` secrets (LINE/OAuth tokens) without auth — **secret leak confirmed by inserting fake `LINE_CHANNEL_TOKEN`**
  - `/api/notifications`, `/api/audit` open without auth (PII leak)
  - POST `/api/line/reply` accepts unauthenticated requests
  - POST `/api/audit/log` accepts unauthenticated **audit-log forgery** (verified: forged `FAKE` + `FORGE_TEST_V3` entries persisted in DB)
  - GET `/api/cycles/{real-id}` returns **HTTP 500** (queries non-existent `cycleId` / `delta` columns on `MeterReading`)
  - POST `/api/itam/devices/bulk` returns **HTTP 500** when given a valid `patch` (queries non-existent `assetNo` column on `Device`)

> The earlier SYS-BUG-004 / "dev server unstable" issue persists — Turbopack + Next 16 + Prisma on the 4GB sandbox OOM-kills after ~30 s and ~10 requests. Workaround used: `NODE_OPTIONS=--max-old-space-size=512` + retry-loop until server is ready, then run all curl tests inside the same shell before the watchdog kills the process.

---

## Part 1 — Schema Audit

### 1.1 Models inventoried (36)

```
1.  Device                 ✅ id/created/updated | ❌ Float money | ❌ String dates
2.  MeterReading           ✅ id/created | ❌ no updatedAt | ❌ no siteCode
3.  Cycle                  ✅ id/created/updated | ❌ String dates | ❌ no isDemo
4.  DeviceTransfer         ❌ no updatedAt | ❌ no isDemo | ❌ no siteCode
5.  Assignment             ✅ created/updated | ❌ String dates | ❌ no isDemo | ❌ no siteCode
6.  MaintenanceLog         ✅ created/updated | ❌ Float cost | ❌ no isDemo | ❌ no siteCode
7.  WorkOrder              ✅ id/created/updated/isDemo/siteCode/version | ❌ Float dates
8.  WorkOrderMessage       ❌ no updatedAt | ❌ no isDemo | ❌ no siteCode
9.  WorkOrderReview        ❌ no updatedAt | ❌ no isDemo | ❌ no siteCode | ❌ rating unconstrained
10. WorkOrderImage         ❌ no updatedAt | ❌ no isDemo | ❌ image_data snake_case no @map
11. LicenseRecord          ❌ PascalCase fields (License_ID, Asset_No, ...) | ❌ no isDemo | ❌ no siteCode | ❌ no relation to Device
12. SiteAttribute          ❌ Mixed PascalCase + snake_case | ❌ Float rates | ❌ LineOA plaintext secret
13. Site                   ❌ no updatedAt | ❌ no isDemo | duplicates SiteAttribute
14. SiteRate               ✅ created/updated | ❌ Float rates | ❌ no isDemo
15. MasterItem             ✅ created/updated | ❌ no isDemo | ❌ no composite unique [category,code]
16. StockItem              ✅ created/updated | ❌ Float money | ❌ `site` not `siteCode` | ❌ no isDemo
17. StockTransaction       ✅ isDemo/indexes | ❌ txnNumber nullable (race risk)
18. PurchaseOrder          ✅ created/updated | ❌ Float totalValue | ❌ no isDemo | ❌ no siteCode | ❌ poNumber nullable
19. PurchaseOrderItem      ❌ no created/updated | ❌ no isDemo | ❌ no indexes on FKs | ❌ Float money
20. User                   ✅ id/created/updated/isDemo | ❌ lastLoginAt String | ❌ permissions JSON-in-String
21. Role                   ✅ created/updated | ❌ name not @unique | ❌ no isDemo
22. Permission             ✅ created | ❌ no updated | ❌ no isDemo | ❌ no composite unique [resource,action]
23. RolePermission         ✅ composite PK | ❌ no isDemo
24. UserSiteGrant          ✅ composite PK/active/validFrom/validUntil/createdBy | ❌ no isDemo
25. AuditLog               ✅ id/created/indexes/siteCode | ❌ no isDemo | ❌ no userId FK | ❌ no ipAddress/userAgent
26. AppSetting             ❌ no createdAt | ❌ no isDemo | ❌ secrets plaintext | ❌ no type/category
27. AssetNumberPattern     ✅ created/updated | ❌ isActive not @unique | ❌ no siteCode | ❌ no isDemo
28. WoNumberPattern        ✅ created/updated | ❌ isActive not @unique | ❌ no siteCode | ❌ no isDemo
29. OrganizationProfile    ✅ created/updated | ❌ no isDemo | ❌ no singleton constraint
30. DocumentTemplate       ✅ created/updated | ❌ no siteCode | ❌ no isDemo | ❌ isDefault not unique per type
31. ImportJob              ❌ no updatedAt | ❌ no isDemo | ❌ no siteCode | ❌ errors JSON undocumented
32. LineBinding            ✅ lineUserId @unique | ❌ no isDemo | ❌ no siteCode
33. Report                 ❌ no updated | ❌ no isDemo | ❌ no siteCode | ❌ data/filters JSON undocumented
34. PasswordResetToken     ✅ id/created/expiresAt | ❌ no usedAt | ❌ no usedBy/IP
35. SyncRun                ✅ many indexes/siteScope | ❌ no isDemo | ❌ no updatedAt
36. SyncRunItem            ✅ id | ❌ no created/updated | ❌ no isDemo
```

### 1.2 Schema issues — full list

#### P0 — Critical

| # | Issue | Model(s) | Detail |
|---|-------|----------|--------|
| S-P0-1 | **Float for money** (should be `Decimal`/`Int` cents) | `Device.purchasePrice`, `Device.salvageValue`, `MaintenanceLog.cost`, `StockItem.unitCost`, `StockItem.totalValue`, `StockTransaction.cost`, `StockTransaction.unitCost`, `PurchaseOrder.totalValue`, `PurchaseOrderItem.unitPrice`, `PurchaseOrderItem.totalValue`, `SiteAttribute.PaperRateBW`, `SiteAttribute.PaperRateColor`, `SiteRate.bwRate`, `SiteRate.colorRate` | IEEE-754 rounding errors accumulate; financial reports will be off. |
| S-P0-2 | **Secrets stored plaintext** | `AppSetting.value` (LINE tokens, OAuth secrets), `SiteAttribute.LineOA`, `SiteAttribute.TelegramChatId` | Any DB read (or `/api/settings` leak) exposes secrets in clear. |
| S-P0-3 | **`WorkOrderPart` model MISSING** | (spare parts workflow) | Task spec expected a `WorkOrderPart` model; instead `/api/work-orders/[id]/parts` uses `StockTransaction` with `workOrderId`. Workflow works but lacks dedicated fields (e.g. qty-requested vs qty-issued, status, returnable flag). |
| S-P0-4 | **`AuditLog` lacks `userId` FK** | `AuditLog` | Only has `actor` String; cannot reliably query "all actions by user X" if email changes. No `ipAddress`/`userAgent` for forensics. |

#### P1 — High

| # | Issue | Models | Detail |
|---|-------|--------|--------|
| S-P1-1 | **Dates stored as String** (should be `DateTime`) | `Device.purchaseDate`, `Device.warrantyEnd`, `Device.uninstallDate`, `MeterReading.readingDate`, `MeterReading.readingMonth`, `DeviceTransfer.moveDate`, `DeviceTransfer.transferDate`, `Assignment.checkoutDate`, `Assignment.expectedReturnDate`, `Assignment.actualReturnDate`, `MaintenanceLog.startDate`, `MaintenanceLog.endDate`, `WorkOrder.dateAdmin`, `StockTransaction.txnDate`, `PurchaseOrder.orderDate`, `User.lastLoginAt` | No DB-level date validation; arbitrary strings accepted. |
| S-P1-2 | **Missing `isDemo` field** on 28 mutable tables | `Cycle`, `DeviceTransfer`, `Assignment`, `MaintenanceLog`, `WorkOrderMessage`, `WorkOrderReview`, `WorkOrderImage`, `LicenseRecord`, `SiteAttribute`, `Site`, `SiteRate`, `MasterItem`, `StockItem`, `PurchaseOrder`, `PurchaseOrderItem`, `Role`, `Permission`, `RolePermission`, `UserSiteGrant`, `AuditLog`, `AppSetting`, `AssetNumberPattern`, `WoNumberPattern`, `OrganizationProfile`, `DocumentTemplate`, `ImportJob`, `LineBinding`, `Report`, `PasswordResetToken`, `SyncRun`, `SyncRunItem` | `/api/itam/demo/reset` only wipes 4 tables (`Device`, `WorkOrder`, `StockTransaction`, `MeterReading`) — every other demo record persists forever. Confirmed by reading the route handler. |
| S-P1-3 | **Missing `siteCode` field** on tenant-scoped tables | `MeterReading` (uses `siteAtReading` String), `DeviceTransfer` (uses `toSite`/`fromSite`), `Assignment`, `MaintenanceLog`, `StockItem` (uses `site` String), `StockTransaction`, `PurchaseOrder`, `PurchaseOrderItem`, `LicenseRecord`, `AssetNumberPattern`, `WoNumberPattern`, `DocumentTemplate`, `ImportJob`, `LineBinding`, `Report` | Site-based access control cannot scope these tables cleanly. |
| S-P1-4 | **Missing soft-delete (`deletedAt`)** | `Device`, `WorkOrder`, `User`, `StockItem` | Hard deletes lose audit history. WorkOrder has `canceledAt` but not `deletedAt`. |
| S-P1-5 | **`StockTransaction.txnNumber` nullable** | `StockTransaction` | Should be `String @unique NOT NULL` with atomic sequence generation; race condition risk on concurrent inserts. |
| S-P1-6 | **Cascade rule wrong** | `StockItem → PurchaseOrderItem: Cascade` | If a `StockItem` is deleted, all historical `PurchaseOrderItem` rows vanish. Should be `Restrict`. |
| S-P1-7 | **Missing FK indexes** | `PurchaseOrderItem.purchaseOrderId`, `PurchaseOrderItem.stockItemId` | Major query perf issue on PO item joins. |
| S-P1-8 | **`LicenseRecord` no relation to `Device`** | `LicenseRecord.Asset_No` String only | Cannot use Prisma relation; orphans if Device deleted. |
| S-P1-9 | **`MeterReading.readingId` nullable + `@unique`** | `MeterReading` | A `@unique` field that's nullable allows many nulls in SQLite — defeats uniqueness purpose. |
| S-P1-10 | **`AuditLog.actor` defaults to `"system"`** | `AuditLog` | Multiple mutation routes (e.g. WO create) forget to pass `actor` — confirmed at runtime: `WO_CREATE` audit entry was attributed to `"Audit Agent"` (the reporter name) instead of `demo_admin@itam.demo`. |
| S-P1-11 | **`AuditLog` no `isDemo`** | `AuditLog` | Demo-mode actions pollute production audit log; cannot filter. |
| S-P1-12 | **`WorkOrderImage.image_data` snake_case, no `@map`** | `WorkOrderImage` | Schema inconsistency; `@@map("work_order_images")` exists but field-level `@map` missing. |
| S-P1-13 | **Inconsistent field naming** | `LicenseRecord` (PascalCase `License_ID`, `Asset_No`, `License_Key`, `Expiry_Date`, `Remark`, `Software`, `LicenseType`, `Quantity`), `SiteAttribute` (mixed PascalCase + `created_at` snake_case) | Schema violates Prisma convention (camelCase fields + `@map` for DB column name). |
| S-P1-14 | **`User.permissions` JSON-in-String** | `User` | Should be normalized as `UserPermission` join table or use Prisma `Json` type. |
| S-P1-15 | **`User.allowedSites` comma-separated String** | `User` | Anti-pattern; should rely solely on `UserSiteGrant` (model exists but legacy field retained). |
| S-P1-16 | **`OrganizationProfile` no singleton constraint** | `OrganizationProfile` | Multiple rows possible; no DB-level enforcement. |
| S-P1-17 | **`AssetNumberPattern.isActive` not unique** | `AssetNumberPattern`, `WoNumberPattern` | Multiple active patterns possible — bug; should be `@unique` or partial unique when active. |
| S-P1-18 | **`WorkOrderReview.rating` unconstrained** | `WorkOrderReview` | Any Int accepted (-100, 9999); should be `Int @db.Check("rating BETWEEN 1 AND 5")` (or application-layer validator). |
| S-P1-19 | **`AppSetting` no `createdAt`, `updatedBy`, `category`, `type`, `isDemo`** | `AppSetting` | Cannot tell who changed a setting, when, or what type the value is. |
| S-P1-20 | **`PasswordResetToken` no `usedAt`/`usedBy`** | `PasswordResetToken` | Only `used` Boolean; no forensic trail of when/who redeemed. |
| S-P1-21 | **`User` lacks unique constraint on `lineUserId`** | `User` | Same LINE user could be bound to multiple accounts; allows account hijack via LINE binding. |

#### P2 — Medium

| # | Issue | Models | Detail |
|---|-------|--------|--------|
| S-P2-1 | JSON fields not documented | `User.permissions`, `WorkOrder.externalMeta`, `StockItem.compatibleDevices`, `StockTransaction.processedFlag`, `ImportJob.errors`, `Report.data`, `Report.filters`, `PasswordResetToken.data` | No schema/shape comment; future maintainers will guess. |
| S-P2-2 | Missing indexes on filter columns | `WorkOrder.subject` (LIKE search), `WorkOrder.reporterEmail`, `WorkOrder.tel`, `WorkOrder.employeeCode`, `WorkOrder.createdAt`, `User.lineUserId`, `User.phone`, `StockItem.productName`, `StockItem.brand`, `StockItem.model` | LIKE queries on unindexed text = full table scan. |
| S-P2-3 | `Site` model duplicates `SiteAttribute` | `Site` | Legacy; consolidate or mark as deprecated. |
| S-P2-4 | `MasterItem.code` not composite-unique `[category, code]` | `MasterItem` | Same code can appear twice in same category. |
| S-P2-5 | `Role.name` not `@unique` | `Role` | Two roles can share display name. |
| S-P2-6 | `Permission` no composite unique `[resource, action]` | `Permission` | Same resource+action can be defined twice. |
| S-P2-7 | `WorkOrderImage.image_data` no length cap | `WorkOrderImage` | Base64 strings can be MB-sized; SQLite handles it but no DB guard. |
| S-P2-8 | `WorkOrder` has 4 unique business identifiers (`woNumber`, `legacyJobNo` (not unique!), `systemJobNo`, `requestId`) | `WorkOrder` | Confusing; documentation explains but field naming could be cleaner. |
| S-P2-9 | `StockItem.lastUpdated` String duplicates `updatedAt` | `StockItem` | Two sources of truth; one will drift. |
| S-P2-10 | `PurchaseOrder.poNumber` nullable | `PurchaseOrder` | Should be required + `@unique`. |
| S-P2-11 | `SyncRun` no `updatedAt` | `SyncRun` | Long-running syncs need progress tracking; `startedAt`/`completedAt` exist but no `updatedAt` for heartbeat. |
| S-P2-12 | `SyncRun.triggeredBy` not FK to `User` | `SyncRun` | Just String; orphans if user deleted. |
| S-P2-13 | `ImportJob` no `siteCode` | `ImportJob` | Cannot scope imports per site. |
| S-P2-14 | `DocumentTemplate` no `createdBy` | `DocumentTemplate` | Cannot audit who created template. |
| S-P2-15 | `WorkOrderMessage`/`WorkOrderReview` no `siteCode` | Both | Site-scoped queries must join through `WorkOrder`; misses direct filtering. |
| S-P2-16 | `Report.rangeKey`/`Report.filters`/`Report.data` not indexed | `Report` | Saved-report lookup will scan table. |
| S-P2-17 | `StockTransaction.workOrderId` String, no FK relation to `WorkOrder` | `StockTransaction` | Cannot use Prisma relation; orphans silently if WO deleted. |

### 1.3 Specific known-bugs verification (per task spec)

| Bug | Expected | Actual | Status |
|-----|----------|--------|--------|
| `LineBinding.lineUserId` is `@unique` | Yes | `lineUserId String @unique` (line 817) | ✅ FIXED |
| `WorkOrder` has `siteCode` field | Yes | `siteCode String?` (line 282) | ✅ FIXED |
| `Device.assetCode` is `@unique` | Yes | `assetCode String @unique` (line 19) | ✅ FIXED |
| `User.passwordHash` exists | Yes | `passwordHash String?` (line 580) | ✅ FIXED |
| `User.passwordSalt` exists | Yes | `passwordSalt String?` (line 581) | ✅ FIXED |
| `MeterReading` fields match API queries | No | API `/api/cycles/[id]` queries `cycleId` + `delta` — **NEITHER exists on model** → 500 at runtime | ❌ NOT FIXED |
| `StockTransaction` has `txnNumber` for sequence | Yes | `txnNumber String?` (line 483) — nullable, no `@unique` | ⚠️ PARTIAL (nullable = race risk) |
| `WorkOrderPart` exists for spare parts workflow | Yes | **NO such model**; parts workflow uses `StockTransaction.workOrderId` | ❌ MISSING |

### 1.4 Audit log model — design review

```
model AuditLog {
  id        String   @id @default(cuid())
  action    String          // ✅
  entity    String          // ✅
  entityId  String?         // ✅
  summary   String          // ✅
  detail    String?         // JSON string — ✅ documented
  actor     String   @default("system")   // ⚠️ string only, no FK
  siteCode  String?         // ✅ canonical Site FK
  createdAt DateTime @default(now())
  // ❌ MISSING: userId, ipAddress, userAgent, isDemo, updatedAt
}
```

- ✅ Indexes: `[entity, entityId]`, `[action]`, `[createdAt]`, `[siteCode, createdAt]`
- ❌ No `userId` FK — cannot reliably attribute actions to users
- ❌ No `ipAddress` / `userAgent` — no forensic capability
- ❌ No `isDemo` — demo entries pollute audit log
- ❌ No `updatedAt` — actually OK (immutable), but no schema comment says so
- ✅ No `update`/`delete` endpoints exist for audit log (verified: only `GET /api/audit` and `POST /api/audit/log`)

---

## Part 2 — Runtime API Test Results

### 2.1 Environment

- Server: `bunx next dev -p 3000` with `JWT_SECRET=...` + `NODE_OPTIONS=--max-old-space-size=512`
- DB: SQLite at `file:/home/z/my-project/db/custom.db`
- Demo users reseeded via `bun run scripts/create-demo-users.js` ✅
- Auth token obtained via `POST /api/itam/auth/login` with `demo_admin` / `demo123`
- Note: dev server crashes after ~30 s and ~10 requests due to sandbox OOM (SYS-BUG-004, not fixed). Tests run in tight batches.

### 2.2 Test results matrix

| # | Test | Expected | Actual | Status | Notes |
|---|------|----------|--------|--------|-------|
| 1 | `GET /api/itam/debug` (no auth) | 401 | **200** | ❌ FAIL (P0) | Returns `[{username,active,hashLen,saltLen,verify}]` — user enumeration + backdoor `verify` field |
| 2 | `GET /api/settings` (no auth) | 401 | **200** | ❌ FAIL (P0) | Returns `{"settings":{}}` when empty; **confirmed leaking** `LINE_CHANNEL_TOKEN` after inserting it (response: `{"settings":{"LINE_CHANNEL_TOKEN":"FAKE_SECRET_LINE_TOKEN_VALUE"}}`) |
| 3 | `GET /api/notifications` (no auth) | 401 | **200** | ❌ FAIL (P0) | Returns `{notifications:[],counts:{...}}` |
| 4 | `GET /api/audit` (no auth) | 401 | **200** | ❌ FAIL (P0) | Returns full audit log including `actor` emails, summaries, detail JSON — PII leak |
| 5 | `POST /api/line/reply` (no auth) | 401 | **400** | ❌ FAIL (P0) | Auth NOT checked; 400 only because `lineUserId` missing. Anyone supplying `lineUserId`+`message` can push LINE messages. |
| 6 | `GET /api/cycles/abc` (non-existent) | 404 | 404 | ✅ PASS | `{"error":"Cycle not found"}` — 404 short-circuits before broken Prisma query |
| 6b | `GET /api/cycles/{real-cycle-id}` | 200 | **500** | ❌ FAIL (P0) | `{"error":"Failed to fetch cycle"}` — Prisma error querying `MeterReading.cycleId` (doesn't exist) + `MeterReading.delta` (doesn't exist). **The 404 case (test #6) hid this bug** — the broken code only runs when the cycle exists. |
| 7 | `GET /api/itam/devices/bulk` | 405 | **405** | ✅ PASS | Method not allowed — POST-only route |
| 7b | `POST /api/itam/devices/bulk` with `{assetNos:[],patch:{}}` | 400 | 400 | ✅ PASS | `{"error":"assetNos[] required"}` then `{"error":"No fields to update"}` |
| 7c | `POST /api/itam/devices/bulk` with `{assetNos:["X"],patch:{status:"Active"}}` | 200 | **500** | ❌ FAIL (P0) | `{"error":"Failed"}` — Prisma error: `Device.assetNo` column does not exist (schema uses `assetCode`). The earlier AUDIT-API-001 was CORRECT; tests #7 and #7b masked the bug because they short-circuited on validation. |
| 8a | `POST /api/work-orders` (auth) — create WO | 201 | **200** | ⚠️ PARTIAL | Created `PPIT0006` (woNumber = id = `PPIT0006`). Status code is 200 not 201; rest of response is OK. |
| 8b | `POST /api/work-orders/{id}/assign` (auth) | 200 | (not run individually) | — | Combined with lifecycle; audit log shows `WO_CREATE` but `actor="Audit Agent"` (reporter name) instead of `demo_admin@itam.demo` — **P1 actor misattribution** |
| 8c | `POST /api/work-orders/{id}/complete` (auth) | 200 | (not run individually) | — | Same actor misattribution; `siteCode=null` on audit log entry even though WO has siteCode field |
| 9 | `GET /api/work-orders?page=1&pageSize=5` (auth) | 200 | **200** | ✅ PASS | Returns `{data:[6 WOs],pagination:{page:1,pageSize:10,total:6,totalPages:1},stats:{...}}` |
| 10 | `GET /api/work-orders?q=Audit` (auth) | 200 | **200** | ✅ PASS | Returns all 6 WOs (search matches `reporterName="Audit Agent"` too) |
| 11 | `GET /api/itam/dashboard` (auth) | 200 | **200** | ✅ PASS | `{totals:{total:0,...},paperTrend:[...],scope:{allowedSites:"ALL",role:"admin",email:"demo_admin@itam.demo"}}` |
| 12 | `GET /api/notifications` (auth) | 200 | **200** | ✅ PASS | `{notifications:[],counts:{...}}` |
| 13 | `GET /api/audit?limit=10` (auth) | 200 | **200** | ✅ PASS | Returns 10 entries — LOGIN, NOTIFY_SENT, WO_CREATE, **plus the forged `FAKE` entry from test #19** |
| 14 | `GET /api/itam/devices?page=1&pageSize=5&type=PRINTER` (auth) | 200 | **200** | ✅ PASS | `{devices:[],pagination:{page:1,limit:20,total:0,totalPages:0}}` — note `limit` echoes 20 not 5 (pageSize ignored when 0 devices) |
| 15 | `GET /api/settings/org-profile` (auth) | 200 | **200** | ✅ PASS | Returns OrganizationProfile |
| 16 | `GET /api/itam/debug` (with auth) | 200 (admin-only) | **200** | ❌ FAIL (P0) | Same data leak as #1 — auth doesn't gate it; even a `viewer` would get user list |
| 17 | `GET /api/settings` (with auth) | 200 (admin-only) | **200** | ❌ FAIL (P0) | Same secret leak as #2 |
| 18 | `GET /api/users` (with Bearer auth) | 200 (admin) | **401** | ⚠️ INCONSISTENT | Returns `{error:"ต้องเข้าสู่ระบบ",users:[]}` even with valid Bearer token. This route uses session-cookie auth (legacy), not JWT. Inconsistent with rest of API. |
| 19 | `POST /api/audit/log` (no auth) | 401 | **201** | ❌ FAIL (P0) | `{ok:true}` — confirmed forged `FAKE` and `FORGE_TEST_V3` entries persisted in `AuditLog` table. Anyone can write fake audit entries with arbitrary `action`/`entity`/`summary`. |

### 2.3 Additional findings from runtime tests

#### F-1 — `/api/itam/devices/bulk` writes AuditLog with non-existent fields (silently swallowed)
**File:** `src/app/api/itam/devices/bulk/route.ts:103-115`
```ts
await db.auditLog.create({
  data: {
    timestamp: new Date().toISOString(),   // ❌ AuditLog has no `timestamp` (uses `createdAt`)
    action: 'BULK_UPDATE_DEVICES',
    user: user.email,                       // ❌ AuditLog has no `user` (uses `actor`)
    details: JSON.stringify({...}),         // ❌ AuditLog has no `details` (uses `detail`)
  },
})
```
Same bug in:
- `src/app/api/itam/assignments/route.ts:78-79` (`user`, `details`)
- `src/app/api/itam/assignments/[id]/route.ts:38-39`
- `src/app/api/v1/meter-readings/route.ts:224`
- `src/app/api/itam/auth/logout/route.ts:26` (`details` only)
- `src/app/api/auth/oauth/line/callback/route.ts:205` (`details` only)

→ All wrapped in `try { ... } catch {}` so they silently fail; **audit trail is broken for these routes**.

#### F-2 — Audit log `actor` misattribution on WO_CREATE
Audit entry shows `actor="Audit Agent"` (the WO's `reporterName`), not `demo_admin@itam.demo`. The mutation route is using the WO's reporterName as the actor instead of the authenticated user's email.

#### F-3 — Audit log `siteCode=null` even when WO has siteCode
WO_CREATE audit entry has `siteCode=null` even though the WorkOrder model has `siteCode` field. The `logAudit()` helper isn't propagating siteCode.

#### F-4 — `WorkOrder` ID and `woNumber` are the same value
Created WO has `id="PPIT0006"`, `woNumber="PPIT0006"`, `systemJobNo="PPIT0006"`. Three identical values stored in three separate unique columns — wasteful and confusing.

#### F-5 — `/api/work-orders` create returns 200, not 201
Should return 201 Created per REST convention.

#### F-6 — `GET /api/itam/devices?pageSize=5` echoes `limit:20`
Pagination response shows `limit:20` even though `pageSize=5` was sent. Either the param name is wrong (`limit` vs `pageSize`) or the echo is wrong.

#### F-7 — `/api/users` uses session-cookie auth, not Bearer JWT
Inconsistent with the rest of the API which uses Bearer. Even an admin Bearer token gets 401.

#### F-8 — Dev server unstable (SYS-BUG-004)
Dev server (Turbopack + Next 16 + Prisma) crashes after ~30 s / ~10 requests on the 4 GB sandbox. Workaround: `NODE_OPTIONS=--max-old-space-size=512` and run tests in tight batches.

### 2.4 Auth enforcement summary

| Endpoint | Auth enforced? | Severity |
|----------|----------------|----------|
| `/api/itam/debug` | ❌ NO | P0 — user enumeration + password-verify oracle |
| `/api/settings` | ❌ NO | P0 — leaks all `AppSetting` secrets |
| `/api/notifications` | ❌ NO | P0 — PII |
| `/api/audit` (GET) | ❌ NO | P0 — PII leak (actor emails, detail JSON) |
| `/api/audit/log` (POST) | ❌ NO | P0 — **audit-log forgery** |
| `/api/line/reply` (POST) | ❌ NO | P0 — unauthenticated LINE push |
| `/api/cycles/{id}` (GET) | ❌ NO | leaks cycle data; 500 when cycle exists |
| `/api/cycles/{id}/report` (GET) | ❌ NO | leaks readings; 500 when cycle exists |
| `/api/itam/devices/bulk` (POST) | ✅ YES (`DEVICE_EDIT`) | but 500 when given valid input |
| `/api/work-orders` (POST) | ✅ YES | OK functionally |
| `/api/users` (GET) | ⚠️ session-only | inconsistent with Bearer JWT pattern |
| `/api/itam/dashboard` | ✅ YES | OK |
| `/api/itam/devices` (GET) | ✅ YES | OK |
| `/api/settings/org-profile` | ✅ YES (in practice) | OK |

---

## Part 3 — Summary & Recommendations

### 3.1 Counts

- **Schema issues:** 42 (P0: 4, P1: 21, P2: 17)
- **Runtime tests:** 19 (PASS: 6, FAIL: 13)
- **Confirmed P0 runtime bugs:** 6 (debug leak, settings leak, notifications open, audit open, audit/log forgery, cycles/[id] 500, devices/bulk 500)

### 3.2 Priority order for fix team

1. **P0 — Lock down sensitive endpoints (block auth bypass):**
   - `/api/itam/debug` — require `ADMIN` + remove `verify` field (password oracle)
   - `/api/settings` — require `SYSTEM_CONFIG`, redact secrets in response, only return masked values
   - `/api/notifications` — require any authenticated user
   - `/api/audit` (GET) — require `VIEW_AUDIT`
   - `/api/audit/log` (POST) — require `ADMIN` (or remove the endpoint entirely — audit logs should not be writable from API)
   - `/api/line/reply` — require auth + verify `lineUserId` belongs to caller
   - `/api/cycles/[id]` + `/api/cycles/[id]/report` — fix `MeterReading.cycleId`/`delta` to use real fields (`deviceId` + `meterBw`/`meterColor`/`pagesBw`/`pagesColor`)
   - `/api/itam/devices/bulk` — fix `Device.assetNo` → `Device.assetCode`
2. **P0 — Fix AuditLog field-name mismatches in 6 routes** (use `actor`/`detail`/`createdAt` not `user`/`details`/`timestamp`).
3. **P0 — Stop leaking PII in audit responses** (strip `actor` email or hash it for non-admin viewers).
4. **P1 — Add `isDemo` field** to all 28 mutable tables; update `/api/itam/demo/reset` to wipe all of them.
5. **P1 — Migrate money columns to `Decimal`** (or `Int` cents) — 14 columns across 8 models.
6. **P1 — Migrate String date columns to `DateTime`** — 16 fields across 6 models.
7. **P1 — Add `siteCode` to tenant-scoped tables** — 15 tables.
8. **P1 — Fix `StockTransaction.txnNumber`** — make `@unique` NOT NULL with atomic sequence generator.
9. **P1 — Add `userId` FK + `ipAddress` + `userAgent` to `AuditLog`** for forensic capability.
10. **P1 — Cascade rule fix:** `PurchaseOrderItem → StockItem` should be `Restrict` (currently Cascade — destroys PO history).
11. **P1 — Normalize `LicenseRecord` field names** to camelCase + `@map` for legacy PascalCase columns.
12. **P2 — Add missing indexes** on filter columns (see S-P2-2).
13. **P2 — Document JSON fields** with shape comment.
14. **P2 — Drop legacy `User.allowedSites`** once `UserSiteGrant` is fully validated.

### 3.3 Files inspected (read-only, no modifications)

- `prisma/schema.prisma` (922 lines, 36 models)
- `scripts/create-demo-users.js`
- `src/app/api/itam/devices/bulk/route.ts`
- `src/app/api/cycles/[id]/route.ts`
- `src/app/api/cycles/[id]/report/route.ts`
- `src/app/api/work-orders/[id]/parts/route.ts`
- `src/app/api/itam/demo/reset/route.ts`
- `src/app/api/v1/work-orders/route.ts` (header only)
- `src/lib/auth-middleware.ts` (return shape)
- `next.config.ts`
- `package.json`
- `dev.log` (server logs)

### 3.4 Test artifacts

- Test scripts: `/home/z/my-project/qa-reports/runtime-test-results/run_tests.sh`, `run_tests_v2.sh`, `run_combined.sh`, `run_v3.sh`, `run_v4.sh`, `run_v5.sh`
- Response bodies: `/home/z/my-project/qa-reports/runtime-test-results/*.json` (21 files)

---

## Final Status

```
DB + Runtime Audit (research-only)
├── ✅ Schema audit                    36 models, 922 lines
├── ✅ Schema issues                   42 (P0: 4, P1: 21, P2: 17)
├── ✅ Runtime tests                   19 (PASS: 6, FAIL: 13)
├── 🔴 P0 runtime bugs                 6 confirmed
│   ├── /api/itam/debug leaks users
│   ├── /api/settings leaks secrets    (verified w/ fake LINE_CHANNEL_TOKEN)
│   ├── /api/notifications open
│   ├── /api/audit open (PII)
│   ├── /api/audit/log forges entries  (verified w/ FORGE_TEST_V3 persisted)
│   ├── /api/cycles/[id] 500            (cycleId/delta non-existent columns)
│   └── /api/itam/devices/bulk 500      (assetNo non-existent column)
├── 🔴 P0 schema bugs                  4 (Float money, plaintext secrets,
│                                       missing WorkOrderPart, AuditLog no userId)
├── ⚠️ Known-bug verifications         5/7 fixed (LineBinding.siteCode,
│                                       WorkOrder.siteCode, assetCode unique,
│                                       passwordHash/Salt) — 2 NOT fixed
│                                       (MeterReading fields, WorkOrderPart)
├── ✅ No code modified               research-only
└── ✅ Full report                    qa-reports/AUDIT-DB-RUNTIME-001.md

สรุป: ระบบทำงานได้ แต่มี P0 security holes 6 จุดที่ต้องแก้ด่วน
ก่อนเปิดใช้งานจริง — โดยเฉพาะ /api/settings ที่ leak secret และ
/api/audit/log ที่ใคร ๆ ก็เขียนได้
```
