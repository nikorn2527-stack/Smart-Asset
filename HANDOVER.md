# Handover Document — ITAM-NextJS Stability Review

> **สำหรับทีมที่จะรับงานต่อ / ตรวจสอบความเสถียร**
> วันที่อัปเดต: 12 กันยายน 2026
> Commit ล่าสุด: `fba2d05`
> Repo: https://github.com/nikorn2527-stack/ITAM-NextJS

---

## 📋 ภาพรวมสถานะปัจจุบัน

แอป **รันได้และใช้งานได้จริง** บนเครื่อง Windows (clone + `.\setup.ps1` + `bun run dev`) และบน sandbox preview
Login: **admin / test1234**

### ข้อมูลที่มีในระบบ (จริง)
- 2,406 devices
- 4,950 work orders
- 60 stock items + 7,520 stock transactions
- 15,486 meter readings
- 426 MasterItem (28 categories)
- 15 users

---

## ✅ สิ่งที่ทำเสร็จและทำงานได้ (12 commits ล่าสุด)

| Commit | อธิบาย | สถานะ |
|--------|--------|-------|
| `60571b0` | แก้ OOM — lazy PrismaClient Proxy + เพิ่ม missing imports (requireAuth, db) ใน 10 routes | ✅ Verified |
| `6073edf` | สร้าง setup.ps1 (Windows) + setup.sh (Linux/Mac) + auto-sync Prisma provider | ✅ Verified |
| `3849e3a` | แก้ setup.ps1 encoding (UTF-8 BOM สำหรับ PowerShell 5.x) | ✅ Verified |
| `3208076` | แก้ db:seed failures — เพิ่ม VIEW_REPORTS/MANAGE_REPORTS + minimal MasterItem fallback + admin user | ✅ Verified |
| `6f4427c` | แก้ SQLite compatibility — strip `mode: insensitive` ผ่าน $extends interceptor | ✅ Verified |
| `19ef5cb` | แก้ layout.tsx raw `<script>` → `next/script` (หาย error overlay) | ✅ Verified |
| `3df5bd5` | แก้ Settings page crash — เพิ่ม BarChart3 import + ActivePage types | ✅ Verified |
| `161f6c9` | แก้ Work Orders page crash — เพิ่ม `const t = useT()` + skip strip สำหรับ raw query | ✅ Verified |

### หน้าที่ทดสอบผ่าน agent-browser แล้วทำงานได้
- ✅ Login (admin/test1234)
- ✅ Dashboard (KPI + charts + realtime SSE)
- ✅ Devices (list + search + filter)
- ✅ Work Orders (list + 412 items + filters)
- ✅ Settings (ทุก tab: Master Data, Sites, Users, Notifications, Custom Fields, Setup Wizard, ฯลฯ)
- ✅ Language switcher (TH/EN สลับได้ทุกหน้า ผ่าน Zustand persist store)

---

## 🔴 P0 — Windows Installer Critical (จากรายงานตรวจ Local Test)

รายงานตรวจจาก commit `3fd967d` พบปัญหา critical 5 ข้อ + restore/backup 4 ข้อ ที่บล็อกการส่ง Installer ให้ลูกค้า:

### C-01: QuickStart ใช้ SQLite แต่ Schema เป็น PostgreSQL (Critical)
`prisma/schema.prisma` ปัจจุบัน `provider = "postgresql"` แต่ `scripts/install.ps1` QuickStart สร้าง `DATABASE_URL=file:./db/custom.db`
**ผล**: QuickStart รันไม่ได้เพราะ Prisma Client (PostgreSQL) ไม่รองรับ SQLite URL

**ต้องเลือก**:
- **แนะนำ**: ตัด SQLite QuickStart ออก ใช้ PostgreSQL ทุก Mode
- หรือถ้าต้องการ SQLite จริง ต้องมี Build/Schema แยกอีกชุด

> หมายเหตุ: ใน dev sandbox เราใช้ `scripts/set-prisma-provider.mjs` auto-patch provider ตาม DATABASE_URL แล้ว แต่ Installer อาจจะยังไม่ได้เรียก script นี้

### C-02: Installer ไม่ Copy ไฟล์ Application จริง
`scripts/install.ps1` ส่วน Copy Application Files ยังเป็น comment:
```powershell
# Copy-Item -Path .\* -Destination $InstallDir -Recurse -Force
```

**ต้องแก้**:
- รับ `-PackagePath` เป็น ZIP/Release Directory
- ตรวจว่ามี `.next/standalone/server.js`, `public`, `.next/static`, `prisma` ครบ
- Copy ด้วย `Copy-Item` จริง + ตรวจ Hash/Version
- หยุดทันทีถ้าไฟล์สำคัญหาย

### C-03: Installer ไม่ได้ Build Application
Installer ทำ `bun install` แล้วไป start `.next/standalone/server.js` แต่ไม่มี `bun run build`
**ผล**: ถ้า Package ไม่มี standalone build อยู่ก่อน → start ไม่ได้

**ต้องเลือก**:
- **Release Installer**: บังคับให้ Package สร้างจาก CI และมี Standalone Build ครบ
- **Source Installer**: เพิ่ม `npm run build` หลังติดตั้ง Dependencies

### C-04: Password PostgreSQL ใน PowerShell ไม่ถูกต้อง
Installer ใช้ `ConvertFrom-SecureString` ซึ่งได้ Encrypted String ของ Windows (ไม่ใช่ password จริง) แล้วไปต่อเป็น connection string → เชื่อม DB ไม่ได้

**ต้องแก้**:
- รับ password เป็น `SecureString` แล้วแปลงชั่วคราวเฉพาะตอนประกอบ connection string
- หรือให้ผู้ติดตั้งกรอก connection string ผ่าน prompt ที่ไม่ echo
- เก็บใน `.env` ด้วย ACL เฉพาะ Service Account
- **ห้ามเขียน password ลง log**

### C-05: Installer รัน `db:push` แทน `prisma migrate deploy`
ตอนนี้ใช้ `bun run db:push` แต่ Production Schema มี Migration แล้ว ควรใช้ `prisma migrate deploy`
**ผล**: `db:push` ไม่ใช่ deployment migration → อาจทำให้ schema drift/ข้อมูลเสียหาย

**ต้องแก้**:
- Production/LANServer/ExistingDatabase → `prisma migrate deploy`
- Local Development เท่านั้น → อนุญาต `db push` ตาม Guard
- ตรวจ Migration ก่อน Start + ทำ Backup ก่อน Deploy

---

### Restore/Backup Issues (H-01 ถึง H-04)

#### H-01: `db:restore` ไม่ Atomic
`package.json` เรียก `scripts/restore-db.ts` ที่ทำ `deleteMany()` + `createMany()` ทีละตาราง (จับ error แล้วทำต่อ)
ขณะที่ `scripts/restore-from-supabase-v2.ts` ปลอดภัยกว่า แต่ไม่ได้ผูกกับ `db:restore`

**ต้องแก้**:
- ทำ Restore Engine เดียวให้ชัดเจน
- `db:restore` เรียกตัวที่มี Backup + Validation + Transaction/Atomic Replace
- ห้ามมี Restore Script เก่าที่ทีมอาจเลือกผิด
- ตรวจ Backup Encryption Key + Backup Schema ก่อน Restore
- หาก Restore ล้ม → Exit Code ≠ 0

#### H-02: `safe-migrate.sh` มี Path ตายตัว
```bash
cd /home/z/my-project  # ← ใช้ไม่ได้บน Windows/เครื่องอื่น
```
**ต้องแก้**: `PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"` หรือ `process.cwd()`

#### H-03: Backup Script ไม่ครบทุก Model
ต้องเพิ่ม Model ใหม่เข้า Backup/Restore:
```
Organization, LegacyReference, SetupRun, SetupStep,
CustomFieldDefinition, CustomFieldOption, CustomFieldValue
```
**แนะนำ**: ใช้ Prisma/SQL Dump ที่รับประกันครบกว่า Manual List

#### H-04: Backup ไม่มี Encryption เป็น Default
`backup-db.ts` ถ้าไม่มี `BACKUP_ENCRYPTION_KEY` จะสร้าง Plain JSON + Warning เฉยๆ
**ต้องแก้**: Production/LAN Server → ไม่มี key → **หยุดทันที** + กำหนดสิทธิ์ไฟล์ Backup เฉพาะ Service Account/Admin

---

### Scripts ที่มี Path/Environment เก่า (Section 3)
พบ Absolute Path `/home/z/my-project/...` ในหลาย script + `process.env.SUPABASE_DATABASE_URL || ''`

**ต้องแก้**:
- เปลี่ยนทั้งหมดเป็น `requireDatabaseUrl()` + `process.cwd()`/CLI Argument
- แยก scripts เป็น 2 กลุ่ม:
  - `runtime/installer scripts` → ต้อง Portable + Fail-Closed
  - `legacy/recovery scripts` → ย้ายไป `tools/legacy/` + ห้ามแสดงในคู่มือหลัก

---

### เอกสารที่ต้องปรับ (Section 4)
- คู่มือยังพูดถึง SQLite ทั้งที่ Schema เป็น PostgreSQL
- คู่มือยังแนะนำ `bun run db:push` ในบางขั้นตอน
- Support Runbook อ้าง Restore Script ตัวเก่า
- Customer Onboarding อ้าง `upload/IT_Asset_Management_Database.xlsx`
- มีตัวอย่าง JWT Secret ที่ดูเหมือน Secret จริง
- มีเอกสารอ้าง `/home/z/my-project`

**ต้องมีเอกสารหลัก 4 ฉบับ**:
```
Windows Installer Runbook
PostgreSQL Deployment Runbook
Backup/Restore Runbook
Local Developer Setup
```
ลบ/ติดป้าย `legacy` ให้เอกสารเก่า

---

### ขั้นตอนทดสอบ Local ที่แนะนำ (Section 5)

**Clean Install** (12 ขั้นตอน):
1. เครื่อง Windows ใหม่/VM ใหม่
2. ติดตั้ง Runtime ตาม Installer ต้องการ
3. ติดตั้ง PostgreSQL
4. สร้าง Database + User แบบ Least Privilege
5. รัน Installer ด้วย Package ใหม่
6. ตรวจว่า Installer Copy ไฟล์จริง
7. ตรวจว่า Build/Standalone Server มีอยู่
8. รัน `prisma migrate deploy`
9. Start Service
10. เปิด `/api/health`
11. เข้า Setup Wizard
12. สร้าง Organization + Admin

**Failure Tests** (Installer ต้องหยุดทันทีเมื่อ):
- DATABASE_URL ว่าง / PostgreSQL เชื่อมไม่ได้ / Migration ล้มเหลว
- Package ไม่มี server.js / JWT_SECRET สั้น/หาย / Port ถูกใช้
- Backup Key หาย / User Database สิทธิ์ไม่พอ

**Data Tests**:
- สร้าง Org A + Org B + User A/B → ตรวจว่า A อ่าน/แก้ข้อมูล B ไม่ได้
- ตรวจ Site Scope, Custom Field GET/PUT, Legacy Import, SetupRun/SetupStep, AuditLog

---

### สิ่งที่ควรเพิ่มก่อนส่งลูกค้า (Section 6 — 14 รายการ)
1. First-run Setup Wizard แบบบังคับ (ถ้ายังไม่มี Org/Admin)
2. Database Connection Test ก่อน Migration
3. Migration Preview แสดง Version ก่อน Apply
4. Automatic Backup ก่อน Migration/Restore
5. Rollback/Recovery Guide ที่ทดสอบจริง
6. Health Check แยก Readiness/Liveness
7. Windows Service Installer ที่ใช้งานได้จริง (ไม่ใช่แค่แนะนำ NSSM)
8. Version Manifest (App Version + Schema Version + Migration Status)
9. Log Rotation สำหรับ `server.log`
10. Secrets ACL (`.env` + Backup อ่านได้เฉพาะ Service Account)
11. Installer Uninstall/Upgrade Flow (ไม่ลบ Database โดยไม่ตั้งใจ)
12. Synthetic Demo Data แยกจากข้อมูลจริง
13. CI Release Artifact ที่ตรวจ `server.js`, static assets, migration, checksum
14. Automated Cross-Org Authorization Tests ใน CI

---

### สรุปสถานะ (Section 7)
```
Multi-Org Code: ดีขึ้นมาก
Custom Field Authorization: ดีขึ้นมาก
PostgreSQL Schema/Migration: ถูกทิศทาง
Local Developer Setup: ยังมีคำสั่ง/Path เก่า
Windows Installer: ยังไม่พร้อมใช้งานจริง
Backup: มี แต่ยังไม่บังคับ Encryption และรายการ Model ต้องตรวจ
Restore: ยังมีสองระบบและ db:restore เรียกตัวที่ไม่ Atomic
Deployment Migration: Installer ยังใช้ db:push ต้องเปลี่ยนเป็น migrate deploy
Production Readiness: ยังไม่ผ่าน
```

**ข้อเสนอแนะเร่งด่วนที่สุด**: แก้ Windows Installer ให้ใช้ PostgreSQL + `prisma migrate deploy`, ทำให้ Copy/Build ใช้งานจริง, แก้ Password Handling และผูก `db:restore` เข้ากับ Restore Engine ที่ปลอดภัยก่อน

---

## ✅ P1 Security Fixes — ทีมแก้เสร็จแล้ว (verified)

ทีมตรวจ P1 ต่อจนครบ + แก้ทุกจุดที่เหลือ สรุปสถานะ:

| จุด | สถานะ | รายละเอียด |
|-----|-------|-----------|
| Health endpoint leak | ✅ แก้แล้ว | เหลือแค่ up/down + latency ไม่มี error detail หลุด (`src/app/api/health/route.ts` ลบ `detail` field, log server-side เท่านั้น) |
| Seed API ALLOW_SEED_IN_PRODUCTION | ✅ ลบ override ทิ้งถาวร | บล็อกเด็ดขาดใน production ไม่มีทางเลี่ยง (`src/app/api/seed/route.ts` return 403 ใน production โดยไม่มี env var override) |
| Backup encryption | ✅ ใช้ AES-256-GCM จริง | มี warning ถ้าลืมตั้ง `BACKUP_ENCRYPTION_KEY` (`scripts/backup-db.ts` ใช้ `createCipheriv('aes-256-gcm', ...)`, key ต้อง 32 bytes/64 hex) |
| Offline-queue RNG | ✅ ใช้ crypto.randomUUID() เป็นหลัก | `src/lib/offline-queue.ts` ใช้ `crypto.randomUUID()` primary, Math.random() เป็น fallback เท่านั้น |
| Demo users (demo123) | ✅ แก้ถูกทาง | ย้ายเข้า `profile: 'demo'` เท่านั้น ไม่รันเลยถ้า production profile (`scripts/seed-all.ts` reject demo profile ใน production แม้บังคับผ่าน env var) |
| Seed fail-closed | ✅ ออกแบบดีมาก | reject demo profile ใน production แม้บังคับผ่าน `ITAM_SEED_PROFILE=demo` ก็ไม่ได้ เพราะเช็ค `NODE_ENV === 'production'` ด้วย |

**ข่าวดีเพิ่มเติม (ไม่ใช่บั๊ก)**:
- ระบบ i18n (`src/lib/i18n.ts`) เริ่มใช้งานจริงแล้ว 30 ไฟล์ ตรงตามที่แนะนำ (dictionary กลางไฟล์เดียว)
- เจอ `module-flags-section.tsx` แปลว่าระบบโมดูลก็เริ่มลงมือทำคู่ขนานไปด้วยแล้ว — ทีมเดินหน้าตามพิมพ์เขียวทั้ง 2 เรื่องพร้อมกัน

---

## ⚠️ ความเสถียร — ปัญหาที่ทีมต้องเช็คต่อ

### 🔴 Priority 1 — ความเสี่ยงสูง (อาจทำให้หน้าพังได้)

#### 1.1 "t is not defined" pattern bug (43 components ที่ต้องตรวจ)
สแกนพบว่ามี 43 functions ใน 10+ ไฟล์ที่ใช้ `t()` (i18n translate) โดยไม่ได้ประกาศ `const t = useT()` ใน scope นั้น

**ความเสี่ยง**: เหมือนกับ bug ที่ทำให้ Work Orders page crash — เมื่อ user ทำ action บางอย่าง (เช่น กดปุ่ม export, delete, save) แล้วจะ ReferenceError

**ไฟล์ที่ต้องตรวจ** (เรียงตามความเสี่ยง):
```
src/components/itam/devices-page.tsx          — 11 functions (applyBulkDelete, save, printSingleSticker, ฯลฯ)
src/components/itam/reports-section.tsx        — 6 functions (ReportDataView มี 23 t() calls!)
src/components/itam/custom-report-builder.tsx  — 6 functions
src/components/itam/templates-page.tsx         — 4 functions (WorkOrderTab, DocumentTab, StickerTab)
src/components/itam/itam-login.tsx             — 4 functions (submit)
src/components/itam/itam-dashboard.tsx         — 3 functions (exportPdf, drillDown)
src/components/itam/google-sheets-section.tsx   — 4 functions
src/components/itam/monthly-report.tsx          — 1 function (handleExportCSV — 17 t() calls)
src/components/itam/itam-settings.tsx          — 3 functions
src/components/itam/work-orders-page.tsx        — 1 function (handleComplete — อาจจะเหลือ)
```

**วิธีเช็ค**: ดูว่า function นั้นเป็น
- **Module-level function** (ประกาศนอก component) → **ต้องแก้** เพิ่ม `const t = useT()` หรือส่ง `t` เป็น parameter
- **Closure ใน component** (ประกาศใน component ที่มี `const t = useT()` แล้ว) → **ไม่ต้องแก้** (false positive)

**วิธีแก้** (ตัวอย่าง):
```tsx
// ก่อน (bug):
function CreateWorkOrderDialog({...}) {
  const fileInputRef = React.useRef(null)
  return <button aria-label={t('settings.close')}>...</button>  // ← t ไม่ได้ประกาศ
}

// หลัง (แก้แล้ว):
function CreateWorkOrderDialog({...}) {
  const t = useT()  // ← เพิ่มบรรทัดนี้
  const fileInputRef = React.useRef(null)
  return <button aria-label={t('settings.close')}>...</button>
}
```

#### 1.2 TypeScript ignoreBuildErrors = true (754 errors)
`next.config.ts` ตั้ง `typescript.ignoreBuildErrors: true` เพราะมี TS errors เดิม 754 ตัว
**ความเสี่ยง**: บั๊กประเภท "t is not defined" ไม่ถูกจับตอน build — จะเจอตอน runtime เท่านั้น

**วิธีแก้ (ระยะยาว)**:
```bash
# รัน TS check แบบเต็ม
NODE_OPTIONS='--max-old-space-size=3072' npx tsc --noEmit
# แก้ errors ทีละไฟล์ จนกว่าจะ 0
# แล้วเปลี่ยน next.config.ts เป็น ignoreBuildErrors: false
```

#### 1.3 Memory pressure ใน 4GB sandbox
Build (`next build --webpack`) บางครั้ง OOM-killed ใน sandbox 4GB

**วิธีแก้**:
- ใช้ `NODE_OPTIONS='--max-old-space-size=2048'` ตอน build
- ใช้ `--max-old-space-size=3072` ตอน start server
- Production deploy ไป Vercel (มี memory มากกว่า)

---

### 🟡 Priority 2 — ความเสี่ยงปานกลาง

#### 2.1 Language switcher บนเครื่อง user บางครั้งไม่ติด
ใน sandbox ทำงานได้ปกติ แต่ user รายงานว่าบางครั้งสลับไม่ติด

**สาเหตุที่เป็นไปได้**:
- Browser cache / service worker เก่า (แนะนำให้ hard refresh Ctrl+Shift+R)
- Turbopack dev mode HMR issue กับ Zustand persist
- localStorage hydration delay

**วิธีเช็ค**:
```powershell
# รัน production build แทน dev (เหมือน sandbox)
bun run next build --webpack
bun run next start
```

#### 2.2 Missing lucide icon imports (อาจจะมีอีก)
เราแก้ BarChart3 ใน itam-settings.tsx แล้ว แต่อาจจะมี icon อื่นที่หายไปใน components อื่น

**วิธีเช็ค**: รันสแกน (script อยู่ใน worklog Task ID: WORK-ORDERS-PAGE-CRASH-FIX) หรือเปิดทุกหน้าใน browser แล้วดู console errors

#### 2.3 Stale Prisma model references
เราแก้ `prisma.deviceType` / `prisma.brand` / `prisma.model` ใน seed scripts แล้ว แต่อาจจะมีใน route handlers อื่นอีก

**วิธีเช็ค**:
```bash
rg "\bdb\.(deviceType|brand|model|snapshot)\b|\bprisma\.(deviceType|brand|model|snapshot)\b" src/app/api/
```

---

### 🟢 Priority 3 — การปรับปรุง (nice-to-have)

#### 3.1 ไม่มี automated tests
มี `vitest.config.ts` และ `tests/` folder แต่ยังไม่ครอบคลุม golden paths

**แนะนำ**: สร้าง Playwright e2e tests สำหรับ:
- Login flow
- Dashboard render
- Devices CRUD
- Work Orders CRUD
- Settings render

#### 3.2 Database: SQLite (dev) vs PostgreSQL (prod)
ตอนนี้ dev ใช้ SQLite, prod ใช้ PostgreSQL (Supabase)
`scripts/set-prisma-provider.mjs` auto-sync provider ให้แล้ว แต่ต้องระวัง:
- SQLite ไม่รองรับ `mode: insensitive` (เราแก้ด้วย interceptor แล้ว)
- SQLite ไม่รองรับ `Prisma.join` บางรูปแบบ
- Raw SQL ใน dashboard route ใช้ syntax ที่รองรับทั้งสอง DB แล้ว

---

## 💡 P3 — ฟีเจอร์เสริม (ข้อเสนอจากการตรวจสอบจริง)

ข้อเสนอฟีเจอร์ที่มีประโยชน์จริง (ไม่ใช่ไอเดียทั่วไป อิงจากทุกอย่างที่ตรวจมา) — ทีมพิจารณาตามลำดับความสำคัญทางธุรกิจ:

### ฟีเจอร์ 1: Bulk Import สำหรับ Asset Categories + Contact Directory

**เหตุผล**: ค้างมาจากที่คุยกันไว้ก่อนหน้า — ตอนนี้ยิ่งจำเป็นเพราะมี `AssetCategory` model ใหม่แล้ว (ใช้กับค่าเสื่อมสภาพ) ถ้าองค์กรมีหมวดครุภัณฑ์ 15-20 ประเภทตามระเบียบราชการ ยังต้องคีย์ทีละอันอยู่

**ขอบเขต**:
- รับไฟล์ CSV/XLSX ที่มี columns: `code, name, usefulLife, salvageValuePercent, depreciationMethod`
- ใช้ `import-page.tsx` pattern เดิม (มีอยู่แล้วสำหรับ Devices)
- Preview + validate ก่อน apply (เหมือน legacy-import/preview)
- รองรับทั้ง AssetCategory + ContactDirectory (2 หน้า)

**ไฟล์ที่ต้องสร้าง/แก้**:
```
src/components/itam/asset-category-section.tsx   ← เพิ่มปุ่ม "Import CSV"
src/components/itam/contact-directory-section.tsx ← เพิ่มปุ่ม "Import CSV"
src/app/api/itam/asset-categories/import/route.ts  ← NEW: preview + apply
src/app/api/itam/contact-directory/import/route.ts ← NEW: preview + apply
```

**ขนาดงาน**: ~1-2 วัน (มี pattern เดิมใน legacy-import ให้ copy)

---

### ฟีเจอร์ 2: ผูกค่าเสื่อมสภาพเริ่มต้นเข้ากับ Asset Category

**เหตุผล**: ตอนสร้าง/แก้ไข device แล้วเลือกหมวดหมู่ครุภัณฑ์ ให้ระบบ auto-fill `usefulLife`/`salvageValue` ตามค่า default ของหมวดนั้น (ตั้งไว้ล่วงหน้าที่หน้า Asset Categories) — ตรงกับที่คุยกันเรื่องระเบียบกรมบัญชีกลางที่แต่ละประเภทอายุใช้งานไม่เท่ากัน ลดงานกรอกซ้ำและลดโอกาสกรอกผิดของผู้ใช้หน้างาน

**ขอบเขต**:
- ใน Device form (create/edit) เมื่อ user เลือก `assetCategory` จาก dropdown → fetch defaults จาก `AssetCategory` record
- Auto-fill `usefulLife` (เช่น คอมพิวเตอร์ = 4 ปี, เครื่องพิมพ์ = 5 ปี, รถยนต์ = 10 ปี)
- Auto-fill `salvageValue` (เช่น 10% ของมูลค่า)
- User ยังแก้ไขค่าได้หลัง auto-fill (ไม่บังคับ)
- แสดง badge "จากหมวดหมู่" ข้างช่องที่ auto-fill

**ไฟล์ที่ต้องสร้าง/แก้**:
```
src/components/itam/device-detail-sheet.tsx  ← เพิ่ม useEffect ตอน assetCategory เปลี่ยน
src/app/api/itam/asset-categories/[id]/route.ts ← เพิ่ม GET ที่ return usefulLife + salvageValue defaults
src/lib/depreciation-defaults.ts             ← NEW: map category → defaults (กรณีไม่มี AssetCategory record)
```

**ขนาดงาน**: ~0.5 วัน (logic ไม่ซับซ้อน ใช้ useEffect + fetch)

---

### ฟีเจอร์ 3: Restore Drill — สคริปต์ทดสอบกู้คืนจาก backup อัตโนมัติ

**เหตุผล**: ตอนนี้มี backup encryption แล้ว (P1 แก้เสร็จ) แต่ยังไม่มีอะไรพิสูจน์ว่า backup ที่เข้ารหัสไว้ restore กลับมาได้จริง — เหตุการณ์เมื่อคืนเป็นตัวอย่างชัดว่าทำไมเรื่องนี้สำคัญ

**ขอบเขต**:
- สคริปต์ `scripts/verify-backup-restore.ts` ที่:
  1. Decrypt + restore backup ล่าสุดเข้า database ทดสอบแยกต่างหาก (ไม่ใช่ production — ใช้ temp SQLite file หรือ test schema)
  2. เช็ค row count ของทุกตารางให้ตรงกับต้นฉบับ
  3. เช็ค checksum ของข้อมูลสำคัญ (Device.assetCode, WorkOrder.woNumber)
  4. ส่ง alert (email/telegram) ถ้า restore fail หรือ row count ไม่ตรง
- รันเป็น cron รายสัปดาห์ควบคู่กับ keepalive ที่มีอยู่แล้ว

**ไฟล์ที่ต้องสร้าง/แก้**:
```
scripts/verify-backup-restore.ts  ← NEW: decrypt + restore + verify
scripts/backup-db.ts              ← เพิ่ม checksum metadata ลงใน backup file
package.json                      ← เพิ่ม script "verify:backup"
```

**ขนาดงาน**: ~1 วัน (decrypt logic มีใน backup-db.ts แล้ว แค่ reverse + verify)

**ความสำคัญ**: 🔴 **สูง** — "จะได้รู้ทันทีถ้า backup เสียโดยไม่ต้องรอเจอเหตุการณ์แบบเมื่อคืนอีกรอบถึงจะรู้ว่า backup ใช้ไม่ได้"

---

### ลำดับแนะนำ (ถ้าทีมเลือกทำ)

| ลำดับ | ฟีเจอร์ | เหตุผล |
|------|--------|-------|
| 1 | **Restore Drill** (ฟีเจอร์ 3) | ความเสี่ยงสูงสุด — backup เสียจะไม่มีทางรู้จนกว่าจะต้องใช้จริง |
| 2 | **Auto-fill depreciation** (ฟีเจอร์ 2) | งานเล็ก (0.5 วัน) ลดงานกรอกซ้ำของผู้ใช้หน้างานทันที |
| 3 | **Bulk import** (ฟีเจอร์ 1) | งานกลาง (1-2 วัน) จำเป็นเมื่อ onboarding องค์กรใหม่ที่มีหมวดครุภัณฑ์หลายประเภท |

---

## 🧪 วิธีเทสความเสถียร (แนะนำให้ทีมทำ)

### Step 1: Setup บนเครื่อง Windows
```powershell
git clone https://github.com/nikorn2527-stack/ITAM-NextJS.git
cd ITAM-NextJS
.\setup.ps1
bun run db:seed
bun run dev
```

### Step 2: Manual testing ทุกหน้า
เปิด `http://localhost:3000` → login admin/test1234 → คลิกผ่านทุกเมนู:

| เมนู | สิ่งที่ต้องเช็ค |
|------|---------------|
| แดชบอร์ด | KPI แสดง, charts render, realtime badge (เขียว) |
| จัดการอุปกรณ์ | list โหลด, search ทำงาน, filter ทำงาน, คลิกดู detail |
| จดมิเตอร์ | cycle แสดง, keyboard input ทำงาน |
| แจ้งซ่อม | list โหลด (412 items), filter status/priority, สร้าง WO ใหม่ |
| ตาราง PM | schedule list แสดง |
| สต๊อก | stock items แสดง, stock-in/out form |
| วิเคราะห์กระดาษ | charts render |
| เทมเพลต | template list, editor |
| นำเข้าข้อมูล | CSV upload form |
| ศูนย์รายงาน | report list render |
| ตั้งค่าระบบ | ทุก tab render (Master Data, Sites, Users, ฯลฯ) |
| ประวัติการใช้งาน | audit log แสดง |

### Step 3: ทดสอบ action ที่ใช้ `t()`
ทดสอบ actions เหล่านี้เพราะเป็นจุดที่ "t is not defined" bug จะเกิด:
- สร้าง device ใหม่ + บันทึก
- ลบ device (bulk delete)
- Export CSV
- Print sticker
- สร้าง work order ใหม่
- ปิด work order (complete)
- สร้าง report
- Export report CSV
- สร้าง template
- Save settings

### Step 4: ทดสอบ language switcher
- คลิกปุ่ม TH/EN ใน sidebar ทุกหน้า
- ตรวจว่า nav text เปลี่ยนภาษา
- ตรวจ localStorage `itam-lang` เปลี่ยนค่า

### Step 5: ตรวจ console errors
- เปิด DevTools (F12) → Console
- คลิกผ่านทุกหน้า ดูว่ามี error ไหม
- ถ้าเจอ `ReferenceError: t is not defined` → ดู Priority 1.1 ด้านบน

---

## 📁 ไฟล์สำคัญที่ทีมต้องดู

### โค้ดหลัก
```
src/lib/db.ts                          ← lazy PrismaClient + SQLite interceptor (แก้ OOM + insensitive)
src/lib/auth-shared.ts                 ← ROLE_PERMISSIONS + PERMISSION_GROUPS (เพิ่ม VIEW_REPORTS/MANAGE_REPORTS แล้ว)
src/lib/i18n.ts                        ← GLOSSARY (1433 lines, TH/EN)
src/store/i18n-store.ts                ← Zustand persist store (lang switcher)
src/store/app-store.ts                 ← ActivePage type (เพิ่ม pm-schedules, material-cost แล้ว)
src/app/layout.tsx                     ← next/script (แก้ error overlay แล้ว)
src/app/home-client.tsx                ← KeepAlivePage pattern (เก็บ state ทุกหน้า)
src/components/itam/sidebar.tsx         ← nav config + lang/theme switcher
```

### Setup & Deployment
```
setup.ps1                              ← Windows PowerShell setup (one-step)
setup.sh                               ← Linux/Mac bash setup
scripts/set-prisma-provider.mjs        ← auto-sync provider กับ DATABASE_URL
.env.example                           ← template (Mode A SQLite / Mode B PostgreSQL)
README.md                              ← คำแนะนำ Windows + วิธีติดตั้ง
```

### Seed scripts
```
scripts/seed-all.ts                    ← master seed (9 modules, profile: demo/production)
scripts/seed-authorization-catalog.ts  ← Role/Permission/RolePermission (30 perms, 5 roles, 88 mappings)
scripts/seed-master-catalog-v2.ts      ← MasterItem 28 categories (64+ items)
scripts/create-demo-users.js           ← admin/test1234 + demo_admin/demo123 + 2 อื่น
```

### Documentation
```
worklog.md                             ← ประวัติการแก้ไขทั้งหมด (21600+ lines, ดู 300 บรรทัดสุดท้าย)
HANDOVER.md                            ← เอกสารนี้
SYSTEM-ARCHITECTURE.md                 ← สถาปัตยกรรมระบบ
```

---

## 🎯 ลำดับความสำคัญในการแก้ไข (แนะนำ)

### สัปดาห์ที่ 1 — ความเสถียรหลัก
1. **แก้ "t is not defined" bug** ใน 43 components (Priority 1.1) — ทำให้ทุก action ทำงานได้
2. **ทดสอบ action ทั้งหมด** ตาม Step 3 ด้านบน
3. **แก้ TS errors** ทีละไฟล์ จนกว่าจะเหลือ < 100 ตัว แล้วเปิด `ignoreBuildErrors: false`

### สัปดาห์ที่ 2 — ความครบถ้วน
4. **ทดสอบทุกหน้า** ตาม Step 2 ด้านบน จนครบทุกเมนู
5. **แก้ missing icon imports** ถ้าเจอเพิ่ม
6. **เขียน Playwright e2e tests** สำหรับ golden paths

### สัปดาห์ที่ 3 — Production readiness
7. **Deploy ไป Vercel** (มี memory มากกว่า sandbox)
8. **ทดสอบบน PostgreSQL** (เปลี่ยน DATABASE_URL + รัน migration)
9. **ตั้ง cron backup** ฐานข้อมูล

---

## 📞 ข้อมูลติดต่อ / อ้างอิง

- **Repo**: https://github.com/nikorn2527-stack/ITAM-NextJS
- **Login**: admin / test1234
- **Commit ล่าสุด**: `fba2d05`
- **Worklog**: `/home/z/my-project/worklog.md` (ดู 300 บรรทัดสุดท้ายสำหรับ context ล่าสุด)

### ประวัติการแก้ไขล่าสุด (12 commits)
ดูใน `worklog.md` — แต่ละ Task ID มีรายละเอียด root cause + fix + verification
