# PR-SYNC-1 G2 Staging Environment Readiness Report

**Operator:** ทีมพัฒนาที่ 1 (รับช่วงจาก G2)
**Date:** 2026-08-16
**Target SHA:** `453f0d606c391d686cab13edd5a29e7cfb746384`

---

## Pre-deploy Guard Results

| Check | Result |
|---|---|
| B4 frozen files (6 files) | ✅ PASS: 0-diff from `ee75164` |
| SYNC_RUN permission | ✅ PASS: not found in `auth-shared.ts` |
| db:push in workflows | ✅ PASS: workflows use `prisma migrate deploy` only |
| CSV upload fallback | ✅ PASS: `src/app/api/import/route.ts` exists |
| Production code changes | ✅ PASS: no production code modified |

## G2 Status: BLOCKED

### Blocking Issues

G2 ยังไม่สำเร็จเพราะต้องตั้งค่า Vercel staging environment และ Apps Script Services staging endpoint/token ซึ่งทีมพัฒนาไม่สามารถทำได้โดยไม่มี:

1. **Vercel dashboard access** — ต้องตั้งค่า environment variables (DATABASE_URL, JWT_SECRET, CRON_SECRET, APPS_SCRIPT_SERVICES_URL, APPS_SCRIPT_SERVICES_TOKEN) ใน Vercel Preview หรือ Custom Environment ซึ่งต้องทำผ่าน Vercel dashboard หรือ CLI (ไม่ได้ติดตั้งใน sandbox)

2. **Apps Script Services staging deployment** — ต้องมี Apps Script Web App ที่ deploy เป็น staging/test แยกจาก production พร้อม Bearer token validation ใน `doPost` — ซึ่งเป็น Google Apps Script project ที่อยู่นอก repository นี้

3. **Supabase staging database access** — G1 ยืนยันว่า `itam-staging` มีอยู่ (current_database = postgres, 0 tables) แต่ต้องได้รับ connection string ที่ถูกต้องสำหรับ staging

### What we verified (can do without Vercel/Supabase/Apps Script access)

| Item | Status | Notes |
|---|---|---|
| Target SHA | `453f0d606c391d686cab13edd5a29e7cfb746384` | confirmed on main |
| B4 frozen files | 0-diff ✅ | all 6 files verified |
| SYNC_RUN | not found ✅ | grep confirmed |
| Migration policy | `prisma migrate deploy` only ✅ | no `db:push` in CI/workflows |
| CSV fallback | exists ✅ | `src/app/api/import/route.ts` |
| Adapter contract | `Authorization: Bearer ${token}` ✅ | `src/lib/sync-adapter.ts:237` |
| Env var names | `APPS_SCRIPT_SERVICES_URL` / `APPS_SCRIPT_SERVICES_TOKEN` ✅ | matches runbook |
| `.env.example` template | exists ✅ | has DATABASE_URL, JWT_SECRET, CRON_SECRET |
| Monitoring SQL scripts | ready ✅ | `scripts/staging-monitoring-queries.sql` |
| Staging runbook | ready ✅ | `docs/PR-SYNC-1-STAGING-RUNBOOK.md` |

### What needs to be done by someone with Vercel/Supabase/Apps Script access

1. **Vercel: Create Preview or Custom Environment `staging`**
   - Set `DATABASE_URL` = itam-staging connection string (NOT production)
   - Set `JWT_SECRET` = new random value (NOT production)
   - Set `CRON_SECRET` = new random value (if cron enabled)
   - Set `APPS_SCRIPT_SERVICES_URL` = staging Apps Script Web App URL
   - Set `APPS_SCRIPT_SERVICES_TOKEN` = staging token (NOT production)
   - Verify: no production secrets reused

2. **Supabase: Verify itam-staging isolation**
   - Confirm staging DB is separate project from production
   - Run `prisma migrate deploy` on staging DB
   - Verify tables created (SyncRun, SyncRunItem, etc.)

3. **Apps Script: Create staging deployment**
   - Deploy Apps Script as Web App with `doPost` handler
   - Implement Bearer token validation in `doPost`
   - Create staging token in Script Properties
   - Verify: staging endpoint returns test data only (not production)

4. **After all above: Run pre-deploy checks + smoke tests**
   - B4 frozen files check (script in monitoring SQL)
   - SYNC_RUN check
   - `/api/health/authz` responds
   - Preview → Apply → Verify WorkOrder created
   - Run monitoring SQL queries

---

## Report (redacted)

```
Operator: ทีมพัฒนาที่ 1
Environment: Preview / staging (not yet configured)
Target SHA: 453f0d606c391d686cab13edd5a29e7cfb746384
Supabase project: itam-staging
DATABASE_URL: NOT YET CONFIGURED (requires Vercel dashboard access)
JWT_SECRET: NOT YET CONFIGURED (requires Vercel dashboard access)
CRON_SECRET: NOT YET CONFIGURED (requires Vercel dashboard access)
Apps Script staging URL: NOT YET DEPLOYED (requires Apps Script editor access)
Apps Script token: NOT YET CREATED (requires Apps Script Properties access)
B4 frozen files: 0-diff ✅
Pre-deploy guard: PASS (code-level checks) / BLOCKED (environment setup)
G2 status: BLOCKED
Blocking issue: Vercel environment variables + Apps Script staging deployment + Supabase staging connection string — all require dashboard/editor access that is not available in the current development environment
```

---

## Next Steps

G2 ต้องการการดำเนินการจากบุคคลที่มีสิทธิ์เข้าถึง:
1. **Vercel dashboard** — ตั้งค่า environment variables สำหรับ staging
2. **Google Apps Script editor** — deploy staging Web App + สร้าง token
3. **Supabase dashboard** — ยืนยัน staging connection string

เมื่อได้รับการตั้งค่าครบ ทีมพัฒนาสามารถ:
- รัน `prisma migrate deploy` บน staging
- ทำ smoke tests
- เริ่ม G3 canary
- นับ stability window 14 วัน
