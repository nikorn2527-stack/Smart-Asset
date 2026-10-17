# PR-SYNC-3 Stock Site Scope — Pre-Implementation Design

**เอกสารนี้:** Scope design สำหรับ PR-SYNC-3 (Stock → Products / Transactions / PO) — กำหนด Site model + permission catalog ก่อนเริ่ม implementation
**สถานะ:** Draft — รอทีม Audit ตรวจ
**Baseline:** `ee75164` (B4 GO, frozen) — แยกจาก B4 และ PR-SYNC-1/2
**Reference spec:** `docs/TASK-legacy-sync.md` (Phase 3 = Stock)
**ผู้จัดทำ:** orchestrator
**วันที่:** 2026-08-16

---

## 1. บทสรุป

PR-SYNC-3 จะโอนย้ายข้อมูล Stock (Products, Transactions, Purchase Orders) จาก Apps Script เก่าเข้า ITAM-NextJS ก่อนเริ่ม implementation ต้องกำหนด:

1. **Site model ของ Stock entities** — StockItem, StockTransaction, PurchaseOrder แต่ละตัวมี Site field อย่างไร
2. **Permission catalog** — 6 permissions ตามที่ทีม Audit ระบุ
3. **Schema changes** — field/index/migration ที่ต้องเพิ่ม
4. **Authorization rules** — ใครทำอะไรได้ที่ Site ไหน

**เหตุผล:** ปัจจุบัน Stock models ใน Prisma schema มี Site field ไม่ครบ:
- `StockItem.site` — มีแต่ nullable และไม่มี `@@index`
- `StockTransaction` — **ไม่มี site field เลย** (ต้อง derive จาก `stockItem.site` ทุกครั้ง → slow + race-prone)
- `PurchaseOrder` — **ไม่มี site field เลย**

การ sync โดยไม่กำหนด Site model ที่ชัดเจนจะทำให้ Stock ข้าม Site รั่วไหล (Site A เห็น stock ของ Site B) เหมือนปัญหา WO ก่อน B4

---

## 2. Site Model ของ Stock Entities

### 2.1 StockItem (Product master)

| field | type | ปัจจุบัน | ที่ต้องการ | หมายเหตุ |
|---|---|---|---|---|
| `site` | `String?` | nullable, no index | `String` (required) + `@@index([site])` | ทุก Stock product ต้องมี Site ประจำ (ไม่มี "shared stock" ใน Phase 3) |
| `assetSiteCode` | — | ไม่มี | `String?` (optional) | รหัสประจำ Site (เช่น `SITE-NNNNN`) เหมือน Device — สำหรับ sync mapping |

**การตัดสินใจ:**
- StockItem ไม่สามารถอยู่ "ไม่มี Site" ได้ใน Phase 3 (เพื่อให้ Site scope ทำงานได้)
- ถ้า migration เจอ row ที่ `site IS NULL` → backfill เป็น Site default (เช่น `UDH`) หรือ mark `isDemo=true` แล้วให้ admin แก้ภายหลัง

### 2.2 StockTransaction (รับเข้า/เบิกออก/ปรับปรุง)

| field | type | ปัจจุบัน | ที่ต้องการ | หมายเหตุ |
|---|---|---|---|---|
| `site` | — | ไม่มี | `String` (required) + `@@index([site, type, createdAt])` | Site ที่ transaction เกิด — ไม่ derive จาก stockItem เพราะ stockItem อาจย้าย Site ภายหลัง |
| `sourceKey` | `String?` | มีแต่ไม่ @unique | `String? @unique` + `@@index([sourceKey])` | external key สำหรับ idempotency (ตาม spec §4) |

**การตัดสินใจ:**
- `StockTransaction.site` จำเป็นเพราะ:
  1. ถ้า derive จาก `stockItem.site` ทุกครั้ง → N+1 query + race condition
  2. ถ้า StockItem ย้าย Site ภายหลัง → transaction เดิมควรอยู่ที่ Site ที่เกิดจริง ไม่ใช่ Site ใหม่
  3. Site-scoped queries (Reports Hub, Stock balance per Site) ต้อง filter ได้โดยตรง

### 2.3 PurchaseOrder (ใบสั่งซื้อ)

| field | type | ปัจจุบัน | ที่ต้องการ | หมายเหตุ |
|---|---|---|---|---|
| `site` | — | ไม่มี | `String` (required) + `@@index([site, status])` | Site ที่สั่งซื้อ |
| `poNumber` | `String?` | nullable | `String @unique` (required) | external key สำหรับ idempotency |

**การตัดสินใจ:**
- PO เป็นเอกสารการจัดซื้อ ต้องมี Site ประจำ (Site A สั่งซื้อ = Site A รับเข้า)
- `poNumber` ต้อง unique เพราะ sync ใช้เป็น externalKey (ตาม spec §4)

### 2.4 Warehouse (ใหม่ — optional สำหรับ Phase 3+)

ปัจจุบัน Stock ใช้ `StockItem.location` (free text) ไม่มี concept ของ Warehouse แยก

**การตัดสินใจ:** Phase 3 ยังไม่สร้าง Warehouse model ใหม่ — ใช้ `StockItem.location` + `StockItem.site` เป็นหลัก ถ้าจำเป็นต้องมี Warehouse master แยก (เช่น คลังหลายหลังใน Site เดียว) จะเปิดใน Phase 5

---

## 3. Permission Catalog (6 permissions)

ทีม Audit ระบุ 6 permissions สำหรับ Stock workstream:

| Permission | ความหมาย | เทียบกับของเดิม | Default role |
|---|---|---|---|
| `STOCK_VIEW` | ดู Stock balance + transactions ใน Site ที่มีสิทธิ์ | มีอยู่แล้ว (เดิม) | viewer, editor, admin |
| `STOCK_RECEIVE` | รับเข้าสินค้า (IN transaction) | `STOCK_IN` (เดิม) — เปลี่ยนชื่อ | editor, admin |
| `STOCK_ISSUE` | เบิกออกสินค้า (OUT transaction) | `STOCK_OUT` (เดิม) — เปลี่ยนชื่อ | editor, admin |
| `STOCK_ADJUST` | ปรับปรุงยอด (ADJUST transaction) — ใหม่ | ไม่มี (ใหม่) | admin เท่านั้น |
| `STOCK_APPROVE` | อนุมัติ pending transactions | มีอยู่แล้ว (เดิม) | admin เท่านั้น |
| `STOCK_TRANSFER` | โอนย้าย Stock ข้าม Site — ใหม่ | ไม่มี (ใหม่) | admin เท่านั้น |

### 3.1 Migration ของ permission names (เดิม → ใหม่)

| เดิม | ใหม่ | เหตุผล |
|---|---|---|
| `STOCK_IN` | `STOCK_RECEIVE` | ชื่อชัดเจนขึ้น — "รับเข้า" ไม่ใช่แค่ "in" |
| `STOCK_OUT` | `STOCK_ISSUE` | ชื่อชัดเจนขึ้น — "เบิกออก" ไม่ใช่แค่ "out" |
| `STOCK_VIEW` | `STOCK_VIEW` | คงเดิม |
| `STOCK_APPROVE` | `STOCK_APPROVE` | คงเดิม |
| — | `STOCK_ADJUST` | ใหม่ — ปรับปรุงยอด (adjustment) แยกจาก receive/issue |
| — | `STOCK_TRANSFER` | ใหม่ — โอนย้ายข้าม Site (ต้องมีสิทธิ์ทั้ง Site ต้น + ปลาย) |

**คำเตือน:** การเปลี่ยนชื่ม permission กระทบ:
- `src/lib/auth-shared.ts` (Permission type)
- `prisma/seed-authorization-catalog.ts` (role → permission mapping)
- `src/lib/rbac.ts` (role definitions)
- ทุก route ที่ใช้ `requireAuth(req, 'STOCK_IN')` หรือ `'STOCK_OUT'` → ต้องเปลี่ยนเป็น `'STOCK_RECEIVE'` / `'STOCK_ISSUE'`

### 3.2 Site-scoped authorization rules

ทุก Stock operation ต้องเคารพ Site scope (เหมือน B4 canAtSite):

```typescript
// ตัวอย่าง: รับเข้าสินค้าที่ Site UDH
const auth = await requireAuth(req, 'STOCK_RECEIVE')
const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)

// ตรวจว่า user มี STOCK_RECEIVE ที่ targetSite หรือไม่
if (!ctx.isSuperAdmin && !ctx.canAtSite(targetSite, 'STOCK_RECEIVE')) {
  return NextResponse.json({ error: 'ไม่มีสิทธิ์รับเข้าที่ Site นี้' }, { status: 403 })
}
```

**STOCK_TRANSFER พิเศษ:** ต้องมีสิทธิ์ที่ **ทั้ง Site ต้น + Site ปลาย**:

```typescript
if (!ctx.isSuperAdmin) {
  const canFrom = ctx.canAtSite(fromSite, 'STOCK_TRANSFER')
  const canTo = ctx.canAtSite(toSite, 'STOCK_TRANSFER')
  if (!canFrom || !canTo) {
    return NextResponse.json({ error: 'ต้องมีสิทธิ์ STOCK_TRANSFER ทั้ง Site ต้นและปลาย' }, { status: 403 })
  }
}
```

### 3.3 Permission matrix (role × permission × Site)

| Role | STOCK_VIEW | STOCK_RECEIVE | STOCK_ISSUE | STOCK_ADJUST | STOCK_APPROVE | STOCK_TRANSFER |
|---|---|---|---|---|---|---|
| superadmin | ✅ all sites | ✅ all sites | ✅ all sites | ✅ all sites | ✅ all sites | ✅ all sites |
| admin (at Site X) | ✅ Site X | ✅ Site X | ✅ Site X | ✅ Site X | ✅ Site X | ✅ Site X (ต้น+ปลาย) |
| editor (at Site X) | ✅ Site X | ✅ Site X | ✅ Site X | ❌ | ❌ | ❌ |
| viewer (at Site X) | ✅ Site X | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 4. Schema Changes (สำหรับ PR-SYNC-3 implementation)

### 4.1 StockItem

```prisma
model StockItem {
  // ... existing fields ...
  site              String?  // → เปลี่ยนเป็น String (required) — ต้อง backfill null ก่อน
  assetSiteCode     String?  // เพิ่มใหม่ (เหมือน Device)

  @@index([productCode])
  @@index([category])
  @@index([site])           // เพิ่มใหม่ — สำหรับ Site-scoped queries
}
```

### 4.2 StockTransaction

```prisma
model StockTransaction {
  // ... existing fields ...
  site          String   // เพิ่มใหม่ (required) — Site ที่ txn เกิด
  sourceKey     String?  @unique  // เพิ่ม @unique (ตาม spec §4)

  @@index([stockItemId])
  @@index([type])
  @@index([approvalStatus])
  @@index([isDemo])
  @@index([site, type, createdAt])   // เพิ่มใหม่ — Site-scoped + time filter
  @@index([sourceKey])               // เพิ่มใหม่ — idempotency lookup
}
```

### 4.3 PurchaseOrder

```prisma
model PurchaseOrder {
  // ... existing fields ...
  poNumber   String?  // → เปลี่ยนเป็น String @unique (required) — external key
  site       String   // เพิ่มใหม่ (required)

  @@index([status])
  @@index([site, status])   // เพิ่มใหม่
}
```

### 4.4 Migration plan

```sql
-- Migration: Add Site + sourceKey to Stock models
-- Additive where possible, but StockItem.site and PurchaseOrder.poNumber
-- need backfill before NOT NULL constraint.

-- Step 1: Add nullable columns first (additive)
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "assetSiteCode" TEXT;
ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "site" TEXT;
ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "sourceKey_unique" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "site" TEXT;

-- Step 2: Backfill
-- StockItem.site: null → 'UDH' (default Site) — admin จะแก้ภายหลัง
UPDATE "StockItem" SET "site" = 'UDH' WHERE "site" IS NULL;
-- StockTransaction.site: derive จาก stockItem.site
UPDATE "StockTransaction" t SET "site" = s."site"
  FROM "StockItem" s WHERE t."stockItemId" = s."id" AND t."site" IS NULL;
-- StockTransaction.sourceKey: null → 'legacy-' + id (เพื่อให้ unique)
UPDATE "StockTransaction" SET "sourceKey_unique" = 'legacy-' || "id" WHERE "sourceKey_unique" IS NULL;
-- PurchaseOrder.site: null → 'UDH'
UPDATE "PurchaseOrder" SET "site" = 'UDH' WHERE "site" IS NULL;
-- PurchaseOrder.poNumber: null → 'PO-legacy-' + id
UPDATE "PurchaseOrder" SET "poNumber" = 'PO-legacy-' || "id" WHERE "poNumber" IS NULL;

-- Step 3: Enforce NOT NULL + unique
ALTER TABLE "StockItem" ALTER COLUMN "site" SET NOT NULL;
ALTER TABLE "StockTransaction" ALTER COLUMN "site" SET NOT NULL;
ALTER TABLE "StockTransaction" ALTER COLUMN "sourceKey_unique" SET NOT NULL;
-- (rename sourceKey_unique → sourceKey after data migration, or use sourceKey directly if no conflict)
ALTER TABLE "PurchaseOrder" ALTER COLUMN "site" SET NOT NULL;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "poNumber" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "StockTransaction_sourceKey_key" ON "StockTransaction"("sourceKey_unique");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- Step 4: Indexes
CREATE INDEX IF NOT EXISTS "StockItem_site_idx" ON "StockItem"("site");
CREATE INDEX IF NOT EXISTS "StockTransaction_site_type_createdAt_idx" ON "StockTransaction"("site", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_site_status_idx" ON "PurchaseOrder"("site", "status");
```

**คำเตือน:** migration นี้มี data backfill — ต้องทดสอบใน staging ก่อน production

---

## 5. Edge Cases & Test Plan

### 5.1 Edge cases

| # | case | การจัดการ |
|---|---|---|
| 1 | StockItem ที่มี `site IS NULL` ใน DB เดิม | backfill `UDH` (default) + mark `remark = 'auto-backfill-site'` ให้ admin ตรวจ |
| 2 | StockTransaction ที่ stockItem ถูกลบไปแล้ว (orphan) | ใช้ `site = 'UDH'` (default) + log warning |
| 3 | PurchaseOrder ที่ `poNumber` duplicate ใน DB เดิม | backfill `'PO-legacy-' + id` ให้ unique ก่อน constraint |
| 4 | StockTransfer ที่ Site ต้น = Site ปลาย | reject: "ต้นและปลายต้องเป็น Site ต่างกัน" |
| 5 | StockTransfer ที่ user มีสิทธิ์ Site ต้น แต่ไม่มี Site ปลาย | reject 403: "ไม่มีสิทธิ์ STOCK_TRANSFER ที่ Site ปลาย" |
| 6 | sync StockTransaction ที่ sourceKey duplicate ใน legacy | mark `CONFLICT` error (ตาม spec §6) |
| 7 | Stock balance ติดลบหลัง ISSUE | reject: "จำนวนเบิกเกิน stock คงเหลือ" (ยกเว้น STOCK_ADJUST) |

### 5.2 Test plan

| # | test | คาดหวัง |
|---|---|---|
| 1 | viewer พยายาม STOCK_RECEIVE | 403 |
| 2 | editor พยายาม STOCK_ADJUST | 403 |
| 3 | admin Site A พยายามดู stock Site B | ไม่เห็น (filter ออก) |
| 4 | admin Site A พยายาม STOCK_TRANSFER ไป Site B (ไม่มีสิทธิ์ B) | 403 |
| 5 | admin Site A+B ทำ STOCK_TRANSFER A→B | สำเร็จ + สร้าง 2 transactions (OUT A, IN B) |
| 6 | sync ซ้ำ (apply 2 ครั้ง) | ไม่ duplicate (sourceKey unique) |
| 7 | sync StockTransaction ที่ sourceKey หาย | error `VALIDATION` |
| 8 | Site-scoped Stock balance query | คืนเฉพาะ Site ที่ user มีสิทธิ์ |
| 9 | Reports Hub Stock section | กรองตาม Site scope ของ user |
| 10 | Migration บน PostgreSQL จริง | สำเร็จ ไม่พัง data ที่มี |

---

## 6. Audit Checklist (สำหรับทีม Audit ตรวจก่อน implementation)

ก่อนเปิด PR-SYNC-3 implementation ทีม Audit ตรวจ:

- [ ] Site model ของ StockItem/StockTransaction/PurchaseOrder ถูกต้อง (field + index + NOT NULL)
- [ ] Permission catalog 6 ตัวครบ + mapping role × permission × Site ถูกต้อง
- [ ] Migration plan มี backfill + ไม่พัง data เดิม
- [ ] STOCK_TRANSFER ตรวจสิทธิ์ทั้งต้น + ปลาย
- [ ] Edge cases 7 กรณีครบ
- [ ] Test plan 10 กรณีครบ
- [ ] ไม่กระทบ B4 baseline (6 lib files)
- [ ] แยก PR จาก PR-SYNC-1, PR-SYNC-2, PR #6

---

## 7. ข้อความพร้อมส่งทีม Audit

> **หัวข้อ: PR-SYNC-3 Stock Site Scope — Draft เพื่อ Review**
>
> ทีม Audit ครับ
>
> ตาม Official Follow-up ที่ระบุว่า "การแยก Stock ตาม Site ให้บันทึกเป็น scope ของ PR-SYNC-3/Stock workstream" ผมได้จัดทำ scope document ฉบับ draft แล้วที่ `docs/PR-SYNC-3-STOCK-SCOPE.md`
>
> **เนื้อหาครอบคลุม:**
> 1. Site model ของ StockItem / StockTransaction / PurchaseOrder (field + index + NOT NULL)
> 2. Permission catalog 6 ตัว: STOCK_VIEW, STOCK_RECEIVE, STOCK_ISSUE, STOCK_ADJUST, STOCK_APPROVE, STOCK_TRANSFER
> 3. Schema changes + migration plan (มี backfill สำหรับ data เดิม)
> 4. Site-scoped authorization rules (เหมือน B4 canAtSite)
> 5. STOCK_TRANSFER พิเศษ: ต้องมีสิทธิ์ทั้ง Site ต้น + ปลาย
> 6. Edge cases 7 กรณี + test plan 10 กรณี
> 7. Audit checklist สำหรับทีมตรวจก่อน implementation
>
> **ขอให้ทีม Audit ตรวจ:**
> - Site model ถูกต้องหรือไม่ (โดยเฉพาะ StockTransaction.site ที่เป็น required ใหม่)
> - Permission mapping role × permission × Site ถูกต้องหรือไม่
> - Migration plan ปลอดภัยหรือไม่ (backfill + NOT NULL transition)
> - STOCK_TRANSFER 2-Site check เพียงพอหรือไม่
>
> **หลังผ่าน review** จะนำ scope นี้ไปใช้ใน PR-SYNC-3 Audit List (คล้าย PR-SYNC-1 Audit List) ก่อนเปิด implementation จริง
>
> ขอ feedback ก่อนเริ่มทำ Audit List ของ PR-SYNC-3 ครับ

---

*เอกสารนี้เป็น scope design สำหรับ PR-SYNC-3 — แยกจาก B4 baseline (`ee75164`) และแยกจาก PR-SYNC-1/2, PR #6*
