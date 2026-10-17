# 📋 FOR ITAM-01 — Merge Checklist + Detailed Change Report

| ฟิลด์ | ค่า |
|------|-----|
| **Document ID** | FOR-ITAM-01-MERGE-CHECKLIST-006 |
| **วันที่** | 2026-08-29 |
| **จาก** | QA Team |
| **ถึง** | ITAM-01 (Developer) |
| **เป้าหมาย** | ป้องกันฟังก์ชันหายตอน merge |
| **Root Cause** | เคยเกิดปัญหา merge แล้วฟังก์ชันบางตัวหาย |

---

## 🚨 ปัญหาที่เคยเกิด:

> "พอจะ merge ฟังก์ชันนั้นหาย ฟังก์ชันนี้หายบ้าง"

**สาเหตุ:**
1. Conflict resolution ที่ไม่รอบคอบ — เลือก "mine" ทั้งหมดโดยไม่อ่าน
2. ไม่มี checklist ตรวจสอบหลัง merge
3. ไม่มี test รันหลัง merge
4. ไม่มีการ verify ฟังก์ชันที่ควรมีอยู่

---

## 📦 การเปลี่ยนแปลงทั้งหมดในรอบนี้ (7 ไฟล์)

### 📁 ไฟล์ใหม่ (5 ไฟล์):

#### 1. `src/lib/db-config.ts` — Database portability abstraction
**ฟังก์ชันที่ต้องตรวจ:**
- `detectProvider(url)` — ตรวจ provider จาก URL
- `getDbConfig()` — อ่าน config จาก env
- `buildConnectionUrl(url)` — สร้าง URL พร้อม pool params
- `sqlDialect.caseInsensitiveLike(col, val)` — SQL dialect abstraction
- `sqlDialect.boolean(value)` — Boolean value per provider
- `printDbConfig()` — debug helper

**สำคัญ:** ห้ามลบ! ใช้ในการรองรับการเปลี่ยน database

#### 2. `src/lib/vercel-blob-storage.ts` — Vercel Blob helper
**ฟังก์ชันที่ต้องตรวจ:**
- `uploadToBlob(content, pathname, contentType)`
- `uploadCsvExport(csvString, filename)` — auto-expire 1 ชม.
- `uploadPdfReport(pdfBuffer, filename)` — auto-expire 24 ชม.
- `uploadExcelExport(xlsxBuffer, filename)`
- `deleteBlob(url)`, `getBlobInfo(url)`
- `isBlobConfigured()`

**สำคัญ:** ใช้สำหรับเก็บ CSV/PDF exports → ลด API response size

#### 3. `src/lib/supabase-realtime.ts` — Supabase Realtime helper
**ฟังก์ชันที่ต้องตรวจ:**
- `getSupabaseClient()` — singleton client
- `subscribeToTable(table, callback, filter?)` — subscribe table changes
- `subscribeToRow(table, column, value, callback)` — subscribe 1 row
- `broadcastEvent(event, payload)` — server-side broadcast
- `isSupabaseConfigured()`

**สำคัญ:** แทนที่ polling 30 วินาที → <100ms latency

#### 4. `src/app/api/health-edge/route.ts` — Edge runtime health check
**ฟังก์ชันที่ต้องตรวจ:**
- `export const runtime = 'edge'` ← ห้ามลบ!
- `GET()` — return `{ ok, runtime, region, ts, deployment, gitCommit }`

**สำคัญ:** ใช้ Vercel Edge Runtime (1M requests/เดือน free)

#### 5. `src/app/api/cron/daily-report/route.ts` — Daily report cron
**ฟังก์ชันที่ต้องตรวจ:**
- `export const dynamic = 'force-dynamic'` ← ห้ามลบ!
- `export const maxDuration = 60` ← ห้ามลบ! (Hobby: 300s max)
- `GET()` — generate daily report at 8am Bangkok
  - WO created/completed/cancelled yesterday
  - Meter readings yesterday
  - Stock transactions + low-stock
  - New devices + warranty expiring (90 days)
  - Audit log summary

**สำคัญ:** Cron job #2 (Vercel Hobby limit 2 jobs)

---

### 📝 ไฟล์ที่แก้ (2 ไฟล์):

#### 6. `src/app/layout.tsx` — เพิ่ม Analytics + Speed Insights
**สิ่งที่เพิ่ม (ห้ามลบ!):**
```tsx
// บรรทัดที่เพิ่มใน imports (ห้ามลบ):
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

// บรรทัดที่เพิ่มใน <body> (ห้ามลบ):
{/* Vercel Analytics + Speed Insights (free tier) */}
<Analytics />
<SpeedInsights />
```

**ตรวจสอบหลัง merge:** ดูว่า `<Analytics />` และ `<SpeedInsights />` ยังอยู่ใน layout.tsx

#### 7. `vercel.json` — เพิ่ม cron daily-report
**สิ่งที่เพิ่ม (ห้ามลบ!):**
```json
{
  "path": "/api/cron/daily-report",
  "schedule": "0 1 * * *"
}
```

**ตรวจสอบหลัง merge:** `vercel.json` ต้องมี crons 2 ตัว (keepalive + daily-report)

---

## 📦 Dependencies ที่เพิ่ม (4 packages):

```json
"@vercel/analytics": "^2.0.1",
"@vercel/speed-insights": "^2.0.0",
"@vercel/blob": "^2.8.0",
"@supabase/supabase-js": "^2.112.4"
```

**ตรวจสอบหลัง merge:** รัน `bun install` แล้วเช็คว่า packages ทั้ง 4 ติดตั้งครบ

---

## 📦 ไฟล์ Bug Fixes ก่อนหน้า (จากการทดสอบ):

### จาก VERIFY-010:
- `src/app/api/v1/work-orders/route.ts` — แก้ assetCode → deviceId (lookup Device)

### จาก SCENARIO tests:
- `src/lib/wo-authz.ts:108-115` — เพิ่ม admin bypass
- `prisma/schema.prisma:817` — เพิ่ม @unique ให้ LineBinding.lineUserId
- `src/app/api/line/webhook/route.ts` — เปลี่ยน findUnique → findFirst (3 จุด)
- `src/lib/notifications.ts:542-572` — เพิ่ม lineUserId/reporterEmail ใน notifyWorkOrderAssigned

### จาก SYSTEM-TEST-002:
- `src/components/itam/work-orders-page.tsx:3563-3587` — เปลี่ยน AlertDialogAction → Button (Complete dialog)
- `src/components/itam/work-orders-page.tsx:3612-3627` — เปลี่ยน AlertDialogAction → Button (Cancel dialog)

---

## ✅ MERGE CHECKLIST (ITAM-01 ต้องทำก่อน merge)

### Phase 1: Pre-merge (ก่อนเริ่ม)

- [ ] อ่านเอกสารนี้ครบทุกบรรทัด
- [ ] ระบุ conflict areas ที่อาจเกิด (จากรายการด้านบน)
- [ ] สร้าง backup branch: `git checkout -b backup-before-merge`
- [ ] ดาวน์โหลด test script: `/home/z/my-project/qa-reports/merge-verify.sh`

### Phase 2: During merge (ตอน resolve conflicts)

- [ ] **อย่าเลือก "mine" หรือ "theirs" แบบทั้งหมด!**
- [ ] อ่านทุก conflict block ทีละบรรทัด
- [ ] รักษา imports ใหม่ทั้งหมด (Analytics, SpeedInsights, Blob, Supabase)
- [ ] รักษา `<Analytics />` และ `<SpeedInsights />` ใน layout.tsx
- [ ] รักษา `runtime = 'edge'` ใน health-edge/route.ts
- [ ] รักษา `maxDuration = 60` ใน cron/daily-report/route.ts
- [ ] รักษา cron 2 ตัวใน vercel.json
- [ ] รักษา bug fixes ทั้งหมด (wo-authz, notifications, work-orders-page)

### Phase 3: Post-merge (หลัง merge)

รันคำสั่งต่อไปนี้เพื่อ verify:

```bash
# 1. ตรวจ imports ใน layout.tsx
grep -E "Analytics|SpeedInsights" src/app/layout.tsx
# ต้องเจอ: import { Analytics } + import { SpeedInsights } + <Analytics /> + <SpeedInsights />

# 2. ตรวจ Edge runtime
grep "runtime.*edge" src/app/api/health-edge/route.ts
# ต้องเจอ: export const runtime = 'edge'

# 3. ตรวจ maxDuration
grep "maxDuration" src/app/api/cron/daily-report/route.ts
# ต้องเจอ: export const maxDuration = 60

# 4. ตรวจ cron jobs ใน vercel.json
grep "path.*cron" vercel.json
# ต้องเจอ 2 บรรทัด: keepalive + daily-report

# 5. ตรวจ bug fixes
grep "globalRole === 'admin'" src/lib/wo-authz.ts
# ต้องเจอ: if (ctx.isSuperAdmin || ctx.globalRole === 'admin')

grep "@unique" prisma/schema.prisma | grep lineUserId
# ต้องเจอ: lineUserId String @unique

grep "AlertDialogAction" src/components/itam/work-orders-page.tsx
# ต้องเจอ: จำนวนน้อยลง (เปลี่ยนเป็น Button แล้ว 2 จุด)

# 6. ตรวจ dependencies
grep -E "@vercel/analytics|@vercel/speed-insights|@vercel/blob|@supabase/supabase-js" package.json
# ต้องเจอ 4 packages

# 7. ลอง build
bun run build
# ต้องผ่านโดยไม่มี error

# 8. ลอง lint
bunx eslint src/app/layout.tsx src/lib/vercel-blob-storage.ts src/lib/supabase-realtime.ts src/lib/db-config.ts src/app/api/health-edge/route.ts src/app/api/cron/daily-report/route.ts
# ต้องผ่าน (no errors)
```

### Phase 4: Runtime verify (หลัง deploy)

```bash
# 1. ทดสอบ Edge health check
curl https://your-domain.vercel.app/api/health-edge
# ต้องได้: {"ok":true,"runtime":"edge","region":"...","ts":"..."}

# 2. ทดสอบ Node.js health check
curl https://your-domain.vercel.app/api/health
# ต้องได้: {"ok":true,"dbUrl":"...","masterItem":N,...}

# 3. ทดสอบ cron daily-report (manual trigger)
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.vercel.app/api/cron/daily-report
# ต้องได้: {"ok":true,"report":{...}}

# 4. ตรวจ Vercel Analytics
# ไป Vercel Dashboard → Analytics tab → ต้องเห็นข้อมูลเริ่มเก็บ
```

---

## 🎯 ฟังก์ชันที่ต้องตรวจว่ายังอยู่ (Functional Tests)

### A. Work Order Lifecycle (ทดสอบครบ flow)

```bash
# 1. Login as admin
TOKEN=$(curl -s -X POST https://your-domain/api/itam/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo_admin","password":"demo123"}' | jq -r .token)

# 2. Create WO
WO=$(curl -s -X POST https://your-domain/api/work-orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject":"test","reporterName":"test","tel":"0000000000","submissionSource":"guest"}')
WO_ID=$(echo $WO | jq -r .data.id)

# 3. Assign
curl -X POST https://your-domain/api/work-orders/$WO_ID/assign \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assignedTo":"test_tech"}'
# ต้องได้ 200 + status=IN_PROGRESS

# 4. Complete
curl -X POST https://your-domain/api/work-orders/$WO_ID/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resolution":"test","actor":"admin"}'
# ต้องได้ 200 + status=COMPLETED + closedAt set
```

### B. LINE Webhook (ถ้ามี LINE setup)

```bash
curl -X POST https://your-domain/api/line/webhook \
  -H "Content-Type: application/json" \
  -d '{"events":[{"type":"message","replyToken":"test","message":{"type":"text","id":"msg-1","text":"แจ้งซ่อม"},"source":{"type":"user","userId":"U-test"},"timestamp":1700000000000}]}'
# ต้องได้: {"ok":true,"handled":1}
```

### C. Vercel Blob (ถ้า setup แล้ว)

```bash
# ทดสอบ upload (ต้องการ BLOB_READ_WRITE_TOKEN)
curl -X POST https://your-domain/api/test-blob-upload \
  -H "Authorization: Bearer $TOKEN"
# ต้องได้ URL ของ blob ที่ upload สำเร็จ
```

---

## 🚨 อาการที่บอกว่าฟังก์ชันหายหลัง merge:

### อาการที่ 1: Analytics ไม่ทำงาน
- ไป Vercel Dashboard → Analytics tab → ไม่มีข้อมูล
- **สาเหตุ:** `<Analytics />` หายจาก layout.tsx
- **แก้:** เพิ่มกลับไป (ดูไฟล์ต้นฉบับ)

### อาการที่ 2: Cron daily-report ไม่รัน
- ไป Vercel Dashboard → Cron Jobs tab → ไม่เห็น daily-report
- **สาเหตุ:** vercel.json ไม่มี cron นี้
- **แก้:** เพิ่ม cron config กลับไป

### อาการที่ 3: Health-edge ไม่ตอบ
- `curl /api/health-edge` ตอบ 500 หรือใช้เวลานาน
- **สาเหตุ:** `runtime = 'edge'` หาย → ใช้ Node.js แทน
- **แก้:** เพิ่ม `export const runtime = 'edge'` กลับไป

### อาการที่ 4: Admin มอบหมาย WO ไม่ได้
- POST `/api/work-orders/[id]/assign` ตอบ 404 สำหรับ admin
- **สาเหตุ:** `ctx.globalRole === 'admin'` หายจาก wo-authz.ts
- **แก้:** เพิ่ม admin bypass กลับไป

### อาการที่ 5: ปุ่ม "ปิดงาน" ไม่ทำงาน
- Click ปุ่ม "ปิดงาน" ใน AlertDialog → ไม่เกิดอะไร
- **สาเหตุ:** AlertDialogAction กลับมา (แทนที่ Button ที่แก้ไว้)
- **แก้:** เปลี่ยนกลับเป็น Button type="button"

---

## 📋 Pre-Merge Verification Script

สร้างไฟล์ `scripts/verify-merge.sh`:

```bash
#!/bin/bash
# รันหลัง merge เพื่อตรวจสอบว่าฟังก์ชันครบ

set -e

echo "=== Verify Merge ==="

echo "1. Layout.tsx imports..."
grep -q "Analytics" src/app/layout.tsx && echo "  ✅ Analytics imported" || echo "  ❌ Analytics MISSING"
grep -q "SpeedInsights" src/app/layout.tsx && echo "  ✅ SpeedInsights imported" || echo "  ❌ SpeedInsights MISSING"

echo "2. Edge runtime..."
grep -q "runtime.*edge" src/app/api/health-edge/route.ts && echo "  ✅ Edge runtime set" || echo "  ❌ Edge runtime MISSING"

echo "3. Cron jobs..."
COUNT=$(grep -c "path.*cron" vercel.json)
echo "  Cron jobs: $COUNT (expected 2)"
[ "$COUNT" -eq 2 ] && echo "  ✅ Both crons present" || echo "  ❌ Cron MISSING"

echo "4. Bug fixes..."
grep -q "globalRole === 'admin'" src/lib/wo-authz.ts && echo "  ✅ admin bypass" || echo "  ❌ admin bypass MISSING"
grep -q "@unique" prisma/schema.prisma && grep -q "lineUserId" prisma/schema.prisma && echo "  ✅ LineBinding unique" || echo "  ❌ LineBinding MISSING"

echo "5. Dependencies..."
grep -q "@vercel/analytics" package.json && echo "  ✅ @vercel/analytics" || echo "  ❌ MISSING"
grep -q "@vercel/speed-insights" package.json && echo "  ✅ @vercel/speed-insights" || echo "  ❌ MISSING"
grep -q "@vercel/blob" package.json && echo "  ✅ @vercel/blob" || echo "  ❌ MISSING"
grep -q "@supabase/supabase-js" package.json && echo "  ✅ @supabase/supabase-js" || echo "  ❌ MISSING"

echo "6. Build test..."
bun run build 2>&1 | tail -3

echo "=== Done ==="
```

รัน: `bash scripts/verify-merge.sh` หลัง merge ทุกครั้ง

---

## 📞 การรายงานปัญหา

ถ้าเจอปัญหาหลัง merge:
1. ส่ง output ของ `verify-merge.sh` มาให้ QA
2. ระบุ commit hash ก่อน + หลัง merge
3. ระบุ conflict areas ที่แก้
4. อย่า push ไป production จนกว่า QA จะ verify ผ่าน

---

## 📊 สรุป

### ฟังก์ชันใหม่ที่ต้องรักษาไว้ (5 ไฟล์):
1. `src/lib/db-config.ts` — Database portability
2. `src/lib/vercel-blob-storage.ts` — Vercel Blob helper
3. `src/lib/supabase-realtime.ts` — Supabase Realtime helper
4. `src/app/api/health-edge/route.ts` — Edge health check
5. `src/app/api/cron/daily-report/route.ts` — Daily report cron

### การแก้ไขที่ต้องรักษาไว้ (2 ไฟล์):
6. `src/app/layout.tsx` — Analytics + SpeedInsights imports + components
7. `vercel.json` — 2 cron jobs (keepalive + daily-report)

### Bug fixes ที่ต้องรักษาไว้:
8. `src/lib/wo-authz.ts` — admin bypass
9. `prisma/schema.prisma` — LineBinding.lineUserId @unique
10. `src/app/api/line/webhook/route.ts` — findFirst (3 จุด)
11. `src/lib/notifications.ts` — notifyWorkOrderAssigned lineUserId
12. `src/components/itam/work-orders-page.tsx` — AlertDialogAction → Button (2 จุด)

### Dependencies ที่ต้องติดตั้ง:
- `@vercel/analytics@^2.0.1`
- `@vercel/speed-insights@^2.0.0`
- `@vercel/blob@^2.8.0`
- `@supabase/supabase-js@^2.112.4`

---

**⚠️ ห้าม merge โดยไม่รัน `verify-merge.sh` ก่อน!**

---

*Prepared by QA Team — 2026-08-29*
