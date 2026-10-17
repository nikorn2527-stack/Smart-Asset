# 🔐 Setup Guide — SSH Keys + Service Credentials

คู่มือตั้งค่าสิทธิ์สำหรับ GitHub, Vercel, Supabase และอื่นๆ

---

## 1. SSH Key (ใช้ได้ทุก service ที่รองรับ SSH)

### 1.1 Public Key ที่สร้างให้แล้ว

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN9LLo+2OQEelC9LLDJaAw4cak6QoAiEU4XwLVKY8TQwAAAADGl0YW0tc2FuZGJveA== itam-sandbox
```

### 1.2 เพิ่มบน GitHub

1. ไปที่ https://github.com/settings/keys
2. คลิก **New SSH key**
3. Title: `ITAM Sandbox`
4. Key type: `Authentication Key`
5. Paste public key ด้านบน
6. คลิก **Add SSH key**

### 1.3 เพิ่มบน Vercel (ถ้าต้อง deploy ผ่าน SSH)

1. ไปที่ https://vercel.com/account/tokens (ใช้ Access Token แทน SSH)
2. คลิก **Create Token**
3. Name: `ITAM Deploy`
4. Scope: `Full Account` หรือ `Specific Project`
5. Copy token → เก็บใน `.env.local`:
   ```
   VERCEL_TOKEN=<token>
   ```

### 1.4 เพิ่มบน Supabase (ใช้ Database Password ไม่ใช่ SSH)

Supabase ไม่ใช้ SSH แต่ใช้ Connection String:
1. ไปที่ https://supabase.com/dashboard → Project → Settings → Database
2. คลิก **Connection string** → copy URL
3. เก็บใน `.env.local`:
   ```
   SUPABASE_DATABASE_URL=postgresql://postgres.[project]:[NEW_PASSWORD]@[REDACTED_SUPABASE_HOST]:5432/postgres
   ```

---

## 2. GitHub — วิธีใช้ SSH

หลังเพิ่ม SSH key บน GitHub:

```bash
# Push (ไม่ต้องใส่ token อีก)
git push origin main

# Pull
git pull origin main

# Clone (ถ้าต้องการ)
git clone git@github.com:nikorn2527-stack/ITAM-NextJS.git
```

---

## 3. Vercel — วิธี Deploy

### 3.1 ติดตั้ง Vercel CLI (ตอน deploy จริง)
```bash
npm i -g vercel
vercel login  # เข้าสู่ระบบผ่าน browser
```

### 3.2 Deploy
```bash
vercel --prod
```

### 3.3 Environment Variables บน Vercel
ไปที่ https://vercel.com/dashboard → Project → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://...` (Supabase connection string) |
| `JWT_SECRET` | `<random 32+ char string>` — สุ่มใหม่ทุกครั้งที่ deploy, ห้าม commit ค่าจริงลงที่นี่ |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | `{...JSON...}` (ถ้าใช้ Google Sheets sync) |
| `GOOGLE_SHEETS_ID_ITAM` | `1Zi2sDW...` |
| `GOOGLE_SHEETS_ID_SERVICES` | `1_YPa5f...` |
| `GOOGLE_SHEETS_ID_STOCK` | `18unmy8...` |

### 3.4 Build Command บน Vercel
```
prisma generate && next build
```

### 3.5 ห้ามใช้ `db push` บน Vercel
ใช้ `prisma migrate deploy` แทน (มี migration file พร้อมแล้ว)

---

## 4. Supabase — การจัดการ

### 4.1 Rotate Database Password (ทำทันที!)

1. ไปที่ https://supabase.com/dashboard → Project → Settings → Database
2. คลิก **Reset database password**
3. Copy password ใหม่ → เก็บใน `.env.local` + Vercel Environment Variables

### 4.2 แยก Database Users ตามหน้าที่

ไปที่ Supabase Dashboard → SQL Editor → รัน:

```sql
-- Application User (read/write tables)
CREATE USER itam_app WITH PASSWORD '[STRONG_PASSWORD_1]';
GRANT CONNECT ON DATABASE postgres TO itam_app;
GRANT USAGE ON SCHEMA public TO itam_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO itam_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO itam_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO itam_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO itam_app;

-- Migration User (DDL only)
CREATE USER itam_migration WITH PASSWORD '[STRONG_PASSWORD_2]';
GRANT CONNECT ON DATABASE postgres TO itam_migration;
GRANT USAGE, CREATE ON SCHEMA public TO itam_migration;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO itam_migration;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO itam_migration;

-- Dev Readonly User
CREATE USER itam_dev_readonly WITH PASSWORD '[STRONG_PASSWORD_3]';
GRANT CONNECT ON DATABASE postgres TO itam_dev_readonly;
GRANT USAGE ON SCHEMA public TO itam_dev_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO itam_dev_readonly;
```

### 4.3 Connection Strings สำหรับแต่ละ user

```
# Application (Next.js runtime)
postgresql://itam_app:[PASS_1]@[REDACTED_SUPABASE_HOST]:5432/postgres

# Migration (deploy only)
postgresql://itam_migration:[PASS_2]@[REDACTED_SUPABASE_HOST]:5432/postgres

# Dev Readonly
postgresql://itam_dev_readonly:[PASS_3]@[REDACTED_SUPABASE_HOST]:5432/postgres
```

---

## 5. Google Cloud — Service Account

### 5.1 สร้าง Service Account
1. ไปที่ https://console.cloud.google.com → IAM → Service Accounts
2. คลิก **Create Service Account**
3. Name: `itam-sheets-reader`
4. Role: ไม่ต้องใส่ (ใช้ Sheets API แบบ readonly)
5. คลิก **Create Key** → JSON → Download

### 5.2 Enable Google Sheets API
1. ไปที่ https://console.cloud.google.com → APIs & Services → Enable APIs
2. ค้นหา **Google Sheets API** → Enable

### 5.3 แชร์ Spreadsheets กับ Service Account
1. เปิด Google Sheet ของแอปเดิม
2. คลิก **Share**
3. ใส่ email ของ Service Account: `itam-qa-dev-reader@ageless-parity-500505-b3.iam.gserviceaccount.com`
4. สิทธิ์: **Viewer**
5. ทำทั้ง 3 spreadsheets (ITAM, Services, Stock)

### 5.4 เก็บ JSON key
```bash
# .env.local
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"ageless-parity-500505-b3",...}
GOOGLE_SHEETS_ID_ITAM=1Zi2sDW1xeAUdHb6MSt0AdpZttRY8C3-WB5agHLaeUpc
GOOGLE_SHEETS_ID_SERVICES=1_YPa5fvNnsoKA0I3JFk38x7A7kTGHCVfDhsvQ-aCmgw
GOOGLE_SHEETS_ID_STOCK=18unmy8rRwQYgFuunZkKueMwBUFvpVtqvokb6l-YihaM
```

---

## 6. สรุป Environment Variables ทั้งหมด

### `.env.local` (development — ไม่ commit)

```bash
# Database
DATABASE_URL=file:./db/custom.db

# Auth
JWT_SECRET=itam-production-secret-2025-png-team-32bytes

# Supabase (for scripts only)
SUPABASE_DATABASE_URL=postgresql://itam_dev_readonly:[PASS]@host:5432/postgres

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_KEY={...}
GOOGLE_SHEETS_ID_ITAM=...
GOOGLE_SHEETS_ID_SERVICES=...
GOOGLE_SHEETS_ID_STOCK=...

# Restore guard
RESTORE_CONFIRM=YES
DEV_DB_PUSH=1
```

### Vercel Environment Variables (production)

```bash
DATABASE_URL=postgresql://itam_app:[PASS]@host:5432/postgres
JWT_SECRET=itam-production-secret-2025-png-team-32bytes
GOOGLE_SERVICE_ACCOUNT_KEY={...}
GOOGLE_SHEETS_ID_ITAM=...
GOOGLE_SHEETS_ID_SERVICES=...
GOOGLE_SHEETS_ID_STOCK=...
```

---

## 7. Security Checklist

| รายการ | สถานะ |
|---|---|
| SSH key สร้างแล้ว | ✅ |
| SSH key เพิ่มบน GitHub | 📋 คุณต้องทำ |
| Supabase password rotate | 📋 คุณต้องทำ |
| แยก Database users | 📋 คุณต้องทำ |
| Google Service Account | ✅ มีแล้ว (key ใน upload/) |
| .env ใน .gitignore | ✅ |
| .env.example สร้างแล้ว | ✅ |
| 0 credentials ใน source code | ✅ |
| Vercel env vars | 📋 ตอน deploy |

---

## 8. วิธีรัน Scripts ใน Terminal

### 8.1 ตั้งค่า env var แบบชั่วคราว (ไม่บันทึกในไฟล์)

```bash
# ตั้งค่า env var สำหรับ session นี้เท่านั้น
export SUPABASE_DATABASE_URL="postgresql://postgres.xxx:[PASSWORD]@[REDACTED_SUPABASE_HOST]:5432/postgres"

# ตรวจว่าตั้งแล้ว
echo $SUPABASE_DATABASE_URL
```

### 8.2 รัน Migration (สำหรับ PostgreSQL production)

```bash
# ตั้ง env var ก่อน
export DATABASE_URL="postgresql://user:password@host:5432/itam"
export JWT_SECRET="your-secret-key"

# รัน migration (ใช้ migration.sql ที่สร้างไว้)
prisma migrate deploy

# หรือถ้าเป็น SQLite (dev)
export DATABASE_URL="file:./db/custom.db"
prisma db push
```

### 8.3 รัน Backup

```bash
# ก่อน migration เสมอ
bun scripts/pre-migration-backup.ts

# ตรวจ backup
bun scripts/restore-test.ts db/backups/pre-migration-<timestamp>.db
```

### 8.4 รัน Restore (เฉพาะ dev/staging)

```bash
# ต้องตั้ง SUPABASE_DATABASE_URL ก่อน
export SUPABASE_DATABASE_URL="postgresql://..."

# ต้องยืนยัน
RESTORE_CONFIRM=YES bun scripts/restore-from-supabase-v2.ts
```

### 8.5 รัน Upgrade Flow

```bash
# รันครั้งเดียว (Health → Backup → Migration → Smoke Test)
bash scripts/upgrade.sh
```

### 8.6 รัน Tests

```bash
# Cross-Org Authorization Tests
npx tsx tests/auth/cross-org-auth.test.ts

# Custom Field Acceptance Tests
npx tsx tests/custom-fields-acceptance.test.ts
```

### 8.7 รัน Dev Server

```bash
# แบบปกติ
bun run dev

# ถ้าต้องการให้ db:push รันได้ (local SQLite เท่านั้น)
DEV_DB_PUSH=1 bun run dev

# ถ้าหน้าแอป OOM (memory ไม่พอ)
NODE_OPTIONS="--max-old-space-size=512" bun run dev
```

### 8.8 รัน Production Server

```bash
# Build ก่อน
SANDBOX_PREVIEW=1 NODE_ENV=production JWT_SECRET="your-secret" bun run next build --webpack

# Start
SANDBOX_PREVIEW=1 NODE_ENV=production JWT_SECRET="your-secret" NODE_OPTIONS="--max-old-space-size=512" bun run next start -p 3000
```

### 8.9 รัน Scope Matrix Check

```bash
# ตรวจว่าทุก table มี organizationId
npx tsx scripts/check-scope-matrix.ts
```

### 8.10 ตั้งค่า env var แบบถาวร (เก็บใน .env.local)

```bash
# สร้าง .env.local (ไม่ถูก commit)
cp .env.example .env.local

# แก้ไข
nano .env.local
# กรอกค่าจริง:
# DATABASE_URL=file:./db/custom.db
# JWT_SECRET=your-secret-key
# SUPABASE_DATABASE_URL=postgresql://...
# GOOGLE_SERVICE_ACCOUNT_KEY={...}
# GOOGLE_SHEETS_ID_ITAM=...
# GOOGLE_SHEETS_ID_SERVICES=...
# GOOGLE_SHEETS_ID_STOCK=...
```

### 8.11 รัน Google Sheets Sync

```bash
# ต้องตั้ง Google creds ใน .env.local ก่อน
# แล้วรันผ่าน UI: Settings → Google Sheets → Sync tab
# หรือผ่าน API:
curl -X POST http://localhost:3000/api/cron/sync-legacy/phase?phase=1&dryRun=1 \
  -H "Authorization: Bearer <token>"
```

### 8.12 รัน Export (Backup เป็น TSV/CSV)

```bash
# Login ก่อน
TOKEN=$(curl -s -X POST http://localhost:3000/api/itam/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"test1234"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Export
curl -s "http://localhost:3000/api/integrations/google-sheets/export-spreadsheet?format=tsv" \
  -H "Authorization: Bearer $TOKEN" \
  -o itam-backup-$(date +%Y%m%d).tsv
```

### 8.13 ตรวจสถานะระบบ

```bash
# Health check
curl http://localhost:3000/api/health

# Google Sheets status
TOKEN=$(curl -s -X POST http://localhost:3000/api/itam/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"test1234"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

curl -s "http://localhost:3000/api/integrations/google-sheets/status" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
