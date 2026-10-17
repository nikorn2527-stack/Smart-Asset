# 📋 FOR ITAM-01 — MASTER FIX LIST (ZERO DEFECTS REQUIRED)

| ฟิลด์ | ค่า |
|------|-----|
| **Document ID** | FOR-ITAM-01-MASTER-FIX-LIST |
| **วันที่** | 2026-08-29 |
| **จาก** | QA Team |
| **ถึง** | ITAM-01 (Developer) |
| **เป้าหมาย** | **ความผิดพลาดเป็น 0** — แก้ทุก bug ก่อน release |
| **Audit Sources** | AUDIT-API-001.md + AUDIT-UI-001.md + AUDIT-DB-RUNTIME-001.md |

---

## 📊 สรุป Bugs ทั้งหมด

| Category | P0 🔴 | P1 🟠 | P2 🟡 | รวม |
|----------|-------|-------|-------|-----|
| API Endpoints | 38 | 26 | 14 | **78** |
| UI Components | 0 | 19 | 28 | **47** |
| DB Schema + Runtime | 10 | 21 | 17 | **48** |
| **รวมทั้งหมด** | **48** | **66** | **59** | **173** |

> ⚠️ **P0 ทั้ง 48 ตัวต้องแก้ก่อน release — เป็น security + data integrity issues**

---

## 🚨 PHASE 1 — P0 Critical (ต้องแก้ก่อน, ประมาณ 5-7 วัน)

### 1.1 Authentication Bypass (3 bugs) — 🔴 BLOCKER

#### 🐛 FIX-001: `/api/auth/login` (legacy) รับพาสเวิร์ดอะไรก็ได้
- **Bug ID:** API-BUG-001
- **File:** `src/app/api/auth/login/route.ts:38-39`
- **ปัญหา:** ไม่เรียก `verifyPassword()` — login ด้วย email อย่างเดียวก็ผ่าน
- **Impact:** Authentication bypass สมบูรณ์
- **Fix:**
```diff
- // password check skipped for now — accept any password (incl. empty)
+ if (!user.passwordHash || !user.passwordSalt) {
+   return NextResponse.json({ error: 'บัญชีไม่ได้ตั้งรหัสผ่าน' }, { status: 403 })
+ }
+ if (!verifyPassword(body.password, user.passwordHash, user.passwordSalt)) {
+   return NextResponse.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 })
+ }
```
- **Acceptance:** login ด้วยพาสเวิร์ดผิดต้องได้ 401

#### 🐛 FIX-002: `/api/auth/me` (legacy) ใช้ base64 session cookie ไม่มี signature
- **Bug ID:** API-BUG-002
- **File:** `src/app/api/auth/me/route.ts` + `src/lib/auth-session.ts`
- **ปัญหา:** Cookie `itam-session` เป็น base64 JSON ธรรมดา — แก้ไขได้ง่าย
- **Fix:** เปลี่ยนไปใช้ JWT signed cookie (เหมือน `/api/itam/auth/*`) หรือ deprecate legacy route
- **Acceptance:** แก้ cookie ไม่ได้รับ auth

#### 🐛 FIX-003: `/api/itam/debug` รั่ว password hashes + เทส backdoor passwords
- **Bug ID:** API-BUG-003
- **File:** `src/app/api/itam/debug/route.ts`
- **ปัญหา:** ไม่มี auth + คืน `passwordHash` + `passwordSalt` ของทุก user + มีโค้ดทดสอบ `P@ssw0rd!2025` สำหรับ `nikorn.p`
- **Fix:** **ลบไฟล์ทิ้งเลย** — ห้ามมีใน production
- **Acceptance:** `GET /api/itam/debug` ตอบ 404

---

### 1.2 Missing Auth on Sensitive Endpoints (25 bugs) — 🔴 BLOCKER

#### 🐛 FIX-004: 25 endpoints ไม่มี auth เลย

**รายการ endpoints ที่ต้องเพิ่ม `requireAuth`:**

| # | Endpoint | File | Impact |
|---|----------|------|--------|
| 1 | `GET /api/devices/[id]` | `src/app/api/devices/[id]/route.ts` | ดู device ใครก็ได้ |
| 2 | `PUT /api/devices/[id]` | `src/app/api/devices/[id]/route.ts` | แก้ device ใครก็ได้ |
| 3 | `DELETE /api/devices/[id]` | `src/app/api/devices/[id]/route.ts` | ลบ device ใครก็ได้ |
| 4 | `POST /api/devices/[id]/assign` | `src/app/api/devices/[id]/assign/route.ts` | มอบหมาย device |
| 5 | `POST /api/devices/[id]/return` | `src/app/api/devices/[id]/return/route.ts` | คืน device |
| 6 | `POST /api/devices/[id]/transfer` | `src/app/api/devices/[id]/transfer/route.ts` | ย้าย device |
| 7 | `GET /api/devices/warranty` | `src/app/api/devices/warranty/route.ts` | ดูข้อมูลรับประกัน |
| 8 | `GET /api/devices/utilization` | `src/app/api/devices/utilization/route.ts` | ดู utilization |
| 9 | `GET /api/devices/lifecycle` | `src/app/api/devices/lifecycle/route.ts` | ดู lifecycle |
| 10 | `GET /api/cycles` | `src/app/api/cycles/route.ts` | ดู cycles |
| 11 | `POST /api/cycles` | `src/app/api/cycles/route.ts` | สร้าง cycle |
| 12 | `GET /api/cycles/[id]` | `src/app/api/cycles/[id]/route.ts` | ดู cycle (ตอนนี้ 500) |
| 13 | `PUT /api/cycles/[id]` | `src/app/api/cycles/[id]/route.ts` | แก้ cycle |
| 14 | `DELETE /api/cycles/[id]` | `src/app/api/cycles/[id]/route.ts` | ลบ cycle |
| 15 | `GET /api/cycles/[id]/report` | `src/app/api/cycles/[id]/report/route.ts` | ดู report (ตอนนี้ 500) |
| 16 | `GET /api/stock-items` | `src/app/api/stock-items/route.ts` | ดู stock |
| 17 | `GET /api/purchase-orders` | `src/app/api/purchase-orders/route.ts` | ดู PO |
| 18 | `GET /api/notifications` | `src/app/api/notifications/route.ts` | ดูการแจ้งเตือน |
| 19 | `GET /api/audit` | `src/app/api/audit/route.ts` | ดู audit log |
| 20 | `POST /api/audit/log` | `src/app/api/audit/log/route.ts` | **ปลอมแปลง audit log** |
| 21 | `GET /api/settings` | `src/app/api/settings/route.ts` | **รั่ว LINE/OAuth tokens** |
| 22 | `GET /api/site-attributes` | `src/app/api/site-attributes/route.ts` | ดู site config |
| 23 | `GET /api/site-rates` | `src/app/api/site-rates/route.ts` | ดู rates |
| 24 | `POST /api/seed` | `src/app/api/seed/route.ts` | seed ข้อมูล |
| 25 | `GET /api/search` | `src/app/api/search/route.ts` | search ทุกอย่าง |

**Fix Pattern (ใช้ทุกไฟล์):**
```diff
+ import { requireAuth } from '@/lib/auth-middleware'
+ import { buildAuthorizationContext } from '@/lib/authorization-context'

  export async function GET(req: NextRequest) {
+   const auth = await requireAuth(req, 'VIEW_DEVICES')
+   if (!auth.ok) {
+     return NextResponse.json({ error: auth.error }, { status: auth.status })
+   }
+   const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)
    // ... existing code ...
  }
```

**Permission map:**
- Devices → `VIEW_DEVICES`
- Work Orders → `WO_VIEW_ALL` (or `WO_VIEW_OWN` for own)
- Stock → `STOCK_VIEW`
- Settings → `SYSTEM_CONFIG`
- Audit → `VIEW_AUDIT`
- Notifications → `VIEW_DASHBOARD`

- **Acceptance:** curl ทุก endpoint ข้างต้นโดยไม่ส่ง Bearer token ต้องได้ 401

---

### 1.3 Sensitive Data Leaks (3 bugs)

#### 🐛 FIX-005: `/api/settings` (root) รั่ว secrets ทั้งหมด
- **Bug ID:** API-BUG-004
- **File:** `src/app/api/settings/route.ts`
- **ปัญหา:** คืนค่าทุก AppSetting รวม `line_channel_access_token`, `line_channel_secret`, `oauth_google_client_secret`, `oauth_telegram_bot_token`
- **Fix:** กรองเฉพาะ keys ที่ปลอดภัย หรือ mask secrets (`secret****`)
- **Acceptance:** `GET /api/settings` ไม่คืน raw secret values

#### 🐛 FIX-006: `/api/line/reply` ไม่มี auth — ส่ง LINE message ได้ไม่จำกัด
- **Bug ID:** API-BUG-005
- **File:** `src/app/api/line/reply/route.ts`
- **ปัญหา:** ใครก็ได้ POST ส่ง LINE message โดยใส่ `actor` อะไรก็ได้
- **Fix:** เพิ่ม `requireAuth(req, 'ADMIN')`
- **Acceptance:** ไม่มี auth token → 401

#### 🐛 FIX-007: `/api/notifications/send` ไม่มี auth
- **Bug ID:** API-BUG-006
- **File:** `src/app/api/notifications/send/route.ts`
- **ปัญหา:** trigger ส่ง LINE/Telegram/email ได้ไม่จำกัด
- **Fix:** เพิ่ม `requireAuth(req, 'ADMIN')`
- **Acceptance:** ไม่มี auth → 401

---

### 1.4 Audit Log Field Mismatch (5 bugs) — 🔴 Silent failure

#### 🐛 FIX-008: 5 routes เขียน AuditLog ด้วย fields ที่ไม่มีใน schema

| Route | File |
|-------|------|
| `/api/itam/auth/logout` | `src/app/api/itam/auth/logout/route.ts` |
| `/api/auth/oauth/google/callback` | `src/app/api/auth/oauth/google/callback/route.ts` |
| `/api/auth/oauth/line/callback` | `src/app/api/auth/oauth/line/callback/route.ts` |
| `/api/itam/devices/bulk` | `src/app/api/itam/devices/bulk/route.ts` |
| `/api/users` (create) | `src/app/api/users/route.ts` |

**ปัญหา:** ใช้ `timestamp`, `user`, `details` แทน `createdAt`, `actor`, `detail` → Prisma throw error → silent catch → audit log หาย

**Fix Pattern:**
```diff
  await db.auditLog.create({
    data: {
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      summary: `เข้าสู่ระบบ: ${user.email}`,
-     timestamp: new Date(),        // ❌ ไม่มีใน schema
-     user: user.email,              // ❌ ไม่มีใน schema
-     details: { ... },             // ❌ ไม่มีใน schema
+     actor: user.email,             // ✅ มีใน schema
+     detail: JSON.stringify({ ... }), // ✅ มีใน schema
+     siteCode: null,               // ✅ มีใน schema
    },
  })
```

- **Acceptance:** Audit log มี entry ใหม่ทุกครั้งหลัง login/logout/OAuth register/bulk device update

---

### 1.5 v1 API Security Issues (3 bugs)

#### 🐛 FIX-009: v1 API ข้าม Site scope ทั้งหมด
- **Bug ID:** API-BUG-008
- **File:** `src/app/api/v1/work-orders/route.ts`
- **ปัญหา:** GET list ไม่เรียก `buildAuthorizationContext` — user ไหนก็เห็น WO ทุก site
- **Fix:** เพิ่ม `buildAuthorizationContext` + filter ด้วย `ctx.siteWhere()`

#### 🐛 FIX-010: v1 PUT อนุญาต `editUnlockActive=true` bypass terminal-WO lock
- **Bug ID:** API-BUG-009
- **File:** `src/app/api/v1/work-orders/[id]/route.ts`
- **ปัญหา:** body ส่ง `editUnlockActive: true` ได้ → privilege escalation
- **Fix:** ไม่รับ `editUnlockActive` จาก body — ใช้ endpoint `/edit-unlock` เท่านั้น

#### 🐛 FIX-011: v1 POST ส่ง `assetCode` ทำให้ 500
- **Bug ID:** API-BUG-010 (แก้แล้วใน VERIFY-010 แต่ตรวจใหม่)
- **File:** `src/app/api/v1/work-orders/route.ts:279`
- **สถานะ:** ✅ แก้แล้ว — แต่ขอ verify อีกครั้ง

---

### 1.6 500 Errors ที่ควรเป็น 400/404 (4 bugs)

#### 🐛 FIX-012: `/api/cycles/[id]` GET → 500 (query non-existent `MeterReading.cycleId`)
- **Bug ID:** API-BUG-011
- **File:** `src/app/api/cycles/[id]/route.ts`
- **ปัญหา:** Query `cycleId` และ `delta` บน MeterReading ซึ่งไม่มีใน schema
- **Fix:** เปลี่ยนใช้ field ที่มีอยู่จริง (`cycle` relation หรือ `MeterReading.cycle`)

#### 🐛 FIX-013: `/api/cycles/[id]/report` GET → 500 (same root cause)
- **Bug ID:** API-BUG-012

#### 🐛 FIX-014: `/api/itam/devices/bulk` → 500 (query non-existent `Device.assetNo`)
- **Bug ID:** API-BUG-013
- **File:** `src/app/api/itam/devices/bulk/route.ts`
- **ปัญหา:** Query `assetNo` แต่ schema ใช้ `assetCode`
- **Fix:** เปลี่ยน `assetNo` → `assetCode`

#### 🐛 FIX-015: `/api/seed` POST → ไม่จำกัด env
- **Bug ID:** API-BUG-014
- **Fix:** จำกัดเฉพาะ `NODE_ENV=development`

---

### 1.7 RBAC Regressions (2 bugs)

#### 🐛 FIX-016: WO mutation routes ต้องการ `WO_CREATE` ก่อน
- **Bug ID:** API-BUG-015
- **Files:**
  - `src/app/api/work-orders/[id]/assign/route.ts` → ต้องการ `WO_ASSIGN` ไม่ใช่ `WO_CREATE`
  - `src/app/api/work-orders/[id]/complete/route.ts` → `WO_COMPLETE`
  - `src/app/api/work-orders/[id]/cancel/route.ts` → `WO_CANCEL`
  - `src/app/api/work-orders/[id]/messages/route.ts` (POST) → `WO_CREATE`
  - `src/app/api/work-orders/[id]/parts/route.ts` (POST) → `WO_COMPLETE`
- **ปัญหา:** `requireAuth(req, 'WO_CREATE')` ก่อน `loadAuthorizedWorkOrder` → reject users ที่มีเฉพาะ WO_ASSIGN/WO_COMPLETE
- **Fix:** เอา `requireAuth` ออก — ให้ `loadAuthorizedWorkOrder` ตรวจสอบ permission เอง

#### 🐛 FIX-017: `/api/work-orders/[id]/print-template` PATCH ใช้ `WO_VIEW_ALL`
- **Bug ID:** API-BUG-016
- **File:** `src/app/api/work-orders/[id]/print-template/route.ts`
- **ปัญหา:** เป็น mutation แต่ใช้ permission อ่าน → viewer เปลี่ยน global template ได้
- **Fix:** เปลี่ยนเป็น `TEMPLATES_MANAGE`

---

### 1.8 DB Schema Critical (4 bugs)

#### 🐛 FIX-018: Float สำหรับเงิน (14 columns ใน 8 models)
- **Bug ID:** DB-BUG-001
- **ปัญหา:** Float จะมี IEEE-754 rounding → สะสมในรายงานการเงิน
- **Models ที่ได้รับผลกระทบ:**
  - `Device.purchasePrice`
  - `StockItem.unitCost`
  - `StockTransaction.cost`
  - `PurchaseOrder.totalValue`
  - `PurchaseOrderItem.unitPrice`
  - `SiteAttribute.PaperRateA4BW`, `PaperRateA4Color`, `PaperRateA3BW`, `PaperRateA3Color`
  - `WorkOrder.specialFeeAmount`
  - + อีก 6 fields
- **Fix:** เปลี่ยนเป็น `Decimal @db.Decimal(18,2)` (Prisma) + migration
- **Effort:** 2 วัน (migration + test)

#### 🐛 FIX-019: Plaintext secrets ใน AppSetting + SiteAttribute
- **Bug ID:** DB-BUG-002
- **ปัญหา:** `AppSetting.value` + `SiteAttribute.LineOA` + `SiteAttribute.TelegramChatId` เก็บ secrets แบบ plaintext
- **Fix:** เข้ารหัสด้วย `AES-256-GCM` (key จาก env) หรือใช้ vault service

#### 🐛 FIX-020: `WorkOrderPart` model MISSING
- **Bug ID:** DB-BUG-003
- **ปัญหา:** Spec บอกมี spare-parts workflow แต่ model ไม่มี → ใช้ `StockTransaction` workaround
- **Fix:** สร้าง `WorkOrderPart` model + migrate existing data

#### 🐛 FIX-021: AuditLog ไม่มี `userId` FK, `ipAddress`, `userAgent`, `isDemo`
- **Bug ID:** DB-BUG-004
- **ปัญหา:** ไม่มี forensic capability
- **Fix:** เพิ่ม fields ใหม่ใน schema + migration

---

### 1.9 UI P0 — SYS-BUG-002 Regression (10 instances)

#### 🐛 FIX-022: AlertDialogAction click handler regression — 10 จุด

**Pattern เดิมที่ผิด:**
```diff
- <AlertDialogAction onClick={asyncFn}>
-   Click me
- </AlertDialogAction>
```

**Pattern ที่ถูก:**
```diff
+ <Button type="button" onClick={() => asyncFn()}>
+   Click me
+ </Button>
```

**รายการไฟล์ที่ต้องแก้:**

| # | File | Line | Function |
|---|------|------|----------|
| 1 | `src/components/itam/devices-page.tsx` | 3290 | bulk delete |
| 2 | `src/components/itam/devices-page.tsx` | 3320 | single delete |
| 3 | `src/components/itam/notification-templates-section.tsx` | 730 | save template |
| 4 | `src/components/itam/user-management-section.tsx` | 686 | save user |
| 5 | `src/components/itam/reports-section.tsx` | 523 | generate report |
| 6 | `src/components/itam/cycle-manage-dialog.tsx` | 666 | save cycle |
| 7 | `src/components/itam/itam-sticker-editor.tsx` | 1528 | save sticker |
| 8 | `src/components/itam/itam-document-editor.tsx` | 1816 | save template |
| 9 | `src/components/itam/pm-schedules-page.tsx` | 1418 | save schedule |
| 10 | `src/components/itam/stock/stock-inventory.tsx` | 1211 | save inventory |
| 11 | `src/components/itam/work-orders-page.tsx` | 3446 | **Assign dialog (incomplete fix)** |

- **Acceptance:** ทุก dialog action ต้อง trigger handler + แสดง loading state จนกว่า async จะเสร็จ

---

## 🟠 PHASE 2 — P1 High (หลัง P0, ประมาณ 7-10 วัน)

### 2.1 Dead Code Removal (5 files, ~7,756 lines)

#### 🐛 FIX-023: ลบ dead code 4 ไฟล์ + 1 export
- `src/components/itam/itam-work-orders.tsx` (2,226 lines) — orphaned v1
- `src/components/itam/itam-devices.tsx` (2,230 lines) — orphaned
- `src/components/itam/itam-device-detail-sheet.tsx` (1,101 lines) — orphaned
- `src/components/itam/settings-page.tsx` (2,121 lines) — orphaned
- `SettingsPageV2` export — orphaned

- **Effort:** 1 วัน
- **Acceptance:** `bun run build` ผ่าน + bundle size ลด

---

### 2.2 Race Conditions in Sequence Numbers (9 bugs)

#### 🐛 FIX-024: 9 sequence number generators ใช้ `findMax + 1` pattern

| # | Field | File |
|---|-------|------|
| 1 | `WorkOrder.woNumber` | `src/app/api/work-orders/route.ts` |
| 2 | `WorkOrder.woNumber` (v1) | `src/app/api/v1/work-orders/route.ts` |
| 3 | `WorkOrder.woNumber` (LINE) | `src/app/api/line/webhook/route.ts` |
| 4 | `StockTransaction.txnNumber` | `src/app/api/stock/route.ts` |
| 5 | `StockItem.productCode` | `src/app/api/stock-items/route.ts` |
| 6 | `PurchaseOrder.poNumber` | `src/app/api/purchase-orders/route.ts` |
| 7 | `WorkOrder.systemJobNo` | `src/app/api/work-orders/route.ts` |
| 8 | `MeterReading.readingNumber` | `src/app/api/meter/route.ts` |
| 9 | `Report.reportNumber` | `src/app/api/reports/route.ts` |

**Fix Pattern (ใช้ retry-on-unique-violation):**
```typescript
async function generateSequence(prefix: string, generator: () => Promise<string>): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = await generator()
    try {
      return candidate  // caller will create record with this; if unique violation, retry
    } catch (err) {
      if (err.code === 'P2002') continue  // Prisma unique constraint
      throw err
    }
  }
  throw new Error('Failed to generate unique sequence after 5 attempts')
}
```

- **Effort:** 2 วัน

---

### 2.3 Missing `demoTag()` on 9 Routes

#### 🐛 FIX-025: 9 routes ไม่ tag demo data

| Route | File |
|-------|------|
| `/api/devices` (POST) | `src/app/api/devices/route.ts` |
| `/api/devices/[id]` (PUT) | `src/app/api/devices/[id]/route.ts` |
| `/api/stock-items` (POST) | `src/app/api/stock-items/route.ts` |
| `/api/purchase-orders` (POST) | `src/app/api/purchase-orders/route.ts` |
| `/api/cycles` (POST) | `src/app/api/cycles/route.ts` |
| `/api/site-attributes` (POST) | `src/app/api/site-attributes/route.ts` |
| `/api/notifications/send` (POST) | `src/app/api/notifications/send/route.ts` |
| `/api/audit/log` (POST) | `src/app/api/audit/log/route.ts` |
| `/api/seed` (POST) | `src/app/api/seed/route.ts` |

**Fix:** เพิ่ม `...demoTag(auth.user)` ในทุก `db.X.create({ data: { ... } })`

---

### 2.4 Missing Audit Log Actor (10 routes)

#### 🐛 FIX-026: 10 routes ไม่ส่ง `actor` ใน `logAudit()`

| Route | File |
|-------|------|
| `/api/devices` (POST) | `src/app/api/devices/route.ts` |
| `/api/devices/[id]` (PUT/DELETE) | `src/app/api/devices/[id]/route.ts` |
| `/api/stock` (POST) | `src/app/api/stock/route.ts` |
| `/api/cycles` (POST) | `src/app/api/cycles/route.ts` |
| `/api/notifications/send` (POST) | `src/app/api/notifications/send/route.ts` |
| + 5 อื่นๆ | |

**Fix:** ส่ง `auth.user.email` เป็น `actor` ในทุก mutation

---

### 2.5 Legacy `canAccessSite` Migration (10 routes)

#### 🐛 FIX-027: 10 routes ยังใช้ legacy `canAccessSite` แทน `ctx.canAtSite`

| Route | File |
|-------|------|
| `/api/itam/devices` | `src/app/api/itam/devices/route.ts` |
| `/api/itam/devices/[id]` | `src/app/api/itam/devices/[id]/route.ts` |
| `/api/itam/devices/[id]/transfer` | `src/app/api/itam/devices/[id]/transfer/route.ts` |
| `/api/itam/devices/bulk` | `src/app/api/itam/devices/bulk/route.ts` |
| `/api/itam/dashboard` | `src/app/api/itam/dashboard/route.ts` |
| `/api/itam/meter-readings` | `src/app/api/itam/meter-readings/route.ts` |
| `/api/itam/stock` | `src/app/api/itam/stock/route.ts` |
| `/api/itam/search` | `src/app/api/itam/search/route.ts` |
| `/api/master` | `src/app/api/master/route.ts` |
| `/api/meter` | `src/app/api/meter/route.ts` |

**Fix:** เปลี่ยนไปใช้ `buildAuthorizationContext` + `ctx.canAtSite(woSite, permission)`

---

### 2.6 UI Accessibility — `aria-label` บน Icon Buttons (15+ instances)

#### 🐛 FIX-028: Icon buttons ไม่มี `aria-label`

**รายการ:**
- `camera-capture.tsx:104` — close button
- ปุ่มปิด dialog ทุกตัว
- ปุ่ม refresh ทุกตัว
- ปุ่ม export ทุกตัว
- ปุ่ม print ทุกตัว
- ปุ่ม search ใน header

**Fix:** เพิ่ม `aria-label="ปิด"`, `aria-label="รีเฟรช"` ฯลฯ

---

### 2.7 UI `window.confirm()` → AlertDialog (7 instances)

#### 🐛 FIX-029: 7 `window.confirm()` calls ใช้ native browser dialog

**ไฟล์:**
- `itam-devices.tsx`
- `itam-stock.tsx`
- `itam-audit.tsx`
- `import-page.tsx`
- `templates-page.tsx`
- ฯลฯ

**Fix:** เปลี่ยนเป็น shadcn AlertDialog พร้อม styling ที่เข้ากับ app

---

### 2.8 i18n — `.toLocaleString()` ไม่ระบุ locale (20+ instances)

#### 🐛 FIX-030: 20+ `.toLocaleString()` ไม่ระบุ `'th-TH'`

**Fix:**
```diff
- value.toLocaleString()
+ value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
```

---

### 2.9 Mixed Language in UI

#### 🐛 FIX-031: ผสมภาษาไทย-อังกฤษใน UI

**ตัวอย่าง:**
- `footer.tsx` — "Powered by PNG TEAM · v1.0" (ควรเป็น "ขับเคลื่อนโดย PNG TEAM · เวอร์ชัน 1.0")
- `sidebar.tsx` — "Dashboard" label (ควรเป็น "แดชบอร์ด")
- ปุ่ม "Export CSV" (ควรเป็น "ส่งออก CSV")

---

### 2.10 `/api/import` Auth Header Gap

#### 🐛 FIX-032: `/api/import` ไม่อยู่ใน auth URL allow-list
- **File:** `src/app/page.tsx:187-204`
- **ปัญหา:** Uploads อาจ fail ด้วย 401
- **Fix:** เพิ่ม `/api/import` ใน allow-list

---

### 2.11 `camera-capture.tsx` Accessibility

#### 🐛 FIX-033: `<video>` ไม่มี `muted` attribute
- **File:** `src/components/itam/camera-capture.tsx:117`
- **ปัญหา:** iOS Safari อาจปฏิเสธ autoplay
- **Fix:** `<video muted autoPlay playsInline>`

---

## 🟡 PHASE 3 — P2 Medium (หลัง P1, ประมาณ 5-7 วัน)

### 3.1 Error Response Leaks

#### 🐛 FIX-034: `/api/work-orders` GET error รั่ว stack trace
- **Fix:** ใช้ `serverError()` helper ที่ไม่ leak stack

---

### 3.2 OAuth Callback URL Leaks

#### 🐛 FIX-035: OAuth callbacks รั่ว JWT + user JSON ใน URL
- **Files:**
  - `src/app/api/auth/oauth/google/callback/route.ts`
  - `src/app/api/auth/oauth/line/callback/route.ts`
- **Fix:** ใช้ session cookie แทน URL params + ใช้ fragment (#) แทน query (?)

---

### 3.3 Input Validation Missing

#### 🐛 FIX-036: ขาด input validation หลายแห่ง

- `status` enum check ใน WO filter
- `priority` enum check ใน WO filter
- `pageSize` max limit (1000) — ป้องกัน DoS
- `MIME type` check บน file uploads
- `length` cap บน `subject`, `details`, `picBefore`

---

### 3.4 Dead Code (unused functions)

#### 🐛 FIX-037: `nextTxnNumber` + `logAudit` บางที่ defined แต่ไม่ใช้
- **Fix:** ลบออก

---

### 3.5 N+1 Query Problems

#### 🐛 FIX-038: `/api/itam/sites` N+1 query + filter by SiteName แทน SiteCode
- **Fix:** ใช้ `include` แทน loop + filter ด้วย SiteCode

---

### 3.6 Case-Sensitive Role Check

#### 🐛 FIX-039: `/api/itam/search` ใช้ `user.role !== 'admin'` (case-sensitive)
- **Fix:** `user.role.toLowerCase() !== 'admin'`

---

### 3.7 Empty `catch {}` Blocks (8+ instances)

#### 🐛 FIX-040: 8+ empty `catch {}` blocks กลืน error เงียบ
- **Fix:** เพิ่ม `console.error(err)` ในทุก catch

---

### 3.8 DB Schema Improvements

#### 🐛 FIX-041: Missing `isDemo` field บน 28 mutable tables
- **Fix:** Migration เพิ่ม `isDemo Boolean @default(false)` ทุก mutable table

#### 🐛 FIX-042: Missing `siteCode` บน 15 tenant-scoped tables
- **Fix:** Migration เพิ่ม `siteCode String?` + index

#### 🐛 FIX-043: String dates แทน DateTime (16 fields)
- **Fix:** Migration เปลี่ยนเป็น `DateTime`

#### 🐛 FIX-044: `StockTransaction.txnNumber` nullable + ไม่ unique
- **Fix:** เพิ่ม `@unique` + NOT NULL

#### 🐛 FIX-045: `PurchaseOrderItem → StockItem` Cascade ควรเป็น Restrict
- **Fix:** เปลี่ยน `onDelete: Restrict`

---

### 3.9 UI Empty `catch {}` + Visual Polish

#### 🐛 FIX-046: Long list ไม่มี pagination/virtualization
- WO list (เกิน 100 rows จะช้า)
- Device list
- Audit log list

#### 🐛 FIX-047: Dark mode contrast issues
- ตรวจสอบทุกหน้าใน dark mode

#### 🐛 FIX-048: Mobile layout overflow บางหน้า
- Paper Analytics
- Monthly Report
- Settings

---

## 📅 TIMELINE SUMMARY

| Phase | ระยะเวลา | Bugs | Effort |
|-------|---------|------|--------|
| Phase 1 (P0) | 5-7 วัน | 48 | สูงมาก |
| Phase 2 (P1) | 7-10 วัน | 66 | ปานกลาง |
| Phase 3 (P2) | 5-7 วัน | 59 | ต่ำ |
| **รวม** | **17-24 วัน** | **173** | — |

---

## ✅ ACCEPTANCE CRITERIA (Zero Defects)

ITAM-01 ต้องผ่านเกณฑ์เหล่านี้ทั้งหมดก่อน release:

### Security
- [ ] `curl http://localhost:3000/api/itam/debug` → 404
- [ ] `curl http://localhost:3000/api/settings` (no auth) → 401
- [ ] `curl http://localhost:3000/api/notifications` (no auth) → 401
- [ ] `curl http://localhost:3000/api/audit` (no auth) → 401
- [ ] `curl http://localhost:3000/api/line/reply` (no auth POST) → 401
- [ ] `curl http://localhost:3000/api/audit/log` (no auth POST) → 401
- [ ] ทุก endpoint มี `requireAuth` + permission check
- [ ] Password hash ไม่ปรากฏใน response ใดๆ
- [ ] Secrets (LINE/OAuth tokens) ไม่ปรากฏใน response ใดๆ

### Functional
- [ ] WO lifecycle (create → assign → complete) ผ่านครบ
- [ ] Audit log มี entry ใหม่ทุกครั้งหลัง mutation
- [ ] Sequence numbers ไม่ชนกัน (concurrent test)
- [ ] Demo data tagged ด้วย `isDemo: true` ทุก record
- [ ] `/api/itam/demo/reset` ล้าง demo data ได้ครบ

### UI
- [ ] ทุก AlertDialogAction → Button (no regression)
- [ ] ทุก icon button มี `aria-label`
- [ ] ทุก `.toLocaleString()` ระบุ `'th-TH'`
- [ ] ไม่มี dead code (itam-work-orders.tsx, itam-devices.tsx, etc.)
- [ ] ไม่มี `window.confirm()` — ใช้ AlertDialog
- [ ] ทุกหน้า responsive (390px, 768px, 1280px)
- [ ] Dark mode contrast ผ่าน AA

### Schema
- [ ] Float → Decimal สำหรับทุก money field
- [ ] `WorkOrderPart` model สร้างแล้ว
- [ ] `AuditLog` มี `userId`, `ipAddress`, `userAgent`, `isDemo`
- [ ] `isDemo` field บนทุก mutable table
- [ ] `siteCode` บนทุก tenant-scoped table
- [ ] String dates → DateTime

---

## 📁 REFERENCES (Detailed Reports)

- **API bugs ละเอียด:** `/home/z/my-project/qa-reports/AUDIT-API-001.md` (984 บรรทัด, 67KB)
- **UI bugs ละเอียด:** `/home/z/my-project/qa-reports/AUDIT-UI-001.md` (599 บรรทัด, 38KB)
- **DB + Runtime bugs ละเอียด:** `/home/z/my-project/qa-reports/AUDIT-DB-RUNTIME-001.md` (353 บรรทัด, 30KB)
- **Worklog:** `/home/z/my-project/worklog.md` (2,768 บรรทัด)

---

## 🚦 ลำดับการแก้ (Suggested Order)

1. **FIX-001 ถึง FIX-008** — security blockers (3-4 วัน)
2. **FIX-009 ถึง FIX-017** — API RBAC + v1 fixes (2-3 วัน)
3. **FIX-018 ถึง FIX-021** — DB schema critical (2-3 วัน)
4. **FIX-022** — UI regression 10 จุด (1 วัน)
5. **FIX-023 ถึง FIX-033** — P1 fixes (5-7 วัน)
6. **FIX-034 ถึง FIX-048** — P2 polish (3-5 วัน)

---

## ⚠️ หมายเหตุสำคัญ

1. **ห้าม deploy production จนกว่า P0 ทั้ง 48 ตัวจะแก้เสร็จ**
2. หลังแก้ทุก bug — รัน `bun run lint` + `bun run db:push` + manual test
3. ส่ง PR ทีละ phase (ไม่รวม PR เดียว)
4. QA จะ re-verify ทุก fix ก่อน merge

---

**End of Master Fix List**

*Signed off by QA Team — 2026-08-29*
