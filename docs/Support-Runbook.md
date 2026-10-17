# ITAM-NextJS Support Runbook
# คู่มือสำหรับทีม IT ที่ดูแลระบบหลังติดตั้ง

**เวอร์ชั่น:** 1.0
**วันที่:** 2026-09-12

---

## 1. การตรวจสุขภาพระบบ (Health Check)

### 1.1 Application Health
```bash
curl http://localhost:3000/api/health
# Expected: {"status":"ok"}
```

### 1.2 Database Health
```bash
# SQLite
ls -la db/custom.db
# ถ้าไฟล์หาย → restore จาก backup

# PostgreSQL
psql -h localhost -U itam_app -d itam -c "SELECT 1"
```

### 1.3 Google Sheets Connection (ถ้าเปิดใช้)
```
Settings → Google Sheets → Connection tab → ตรวจ authProbe: ok=true
```

---

## 2. การสำรองข้อมูล (Backup)

### 2.1 Daily Backup (Cron — ตั้งตอน deploy)
```bash
# crontab -e
0 2 * * * cd /path/to/itam && bun scripts/pre-migration-backup.ts >> logs/backup.log 2>&1
```

### 2.2 Manual Backup
```bash
bun scripts/pre-migration-backup.ts
```

### 2.3 Export as TSV/CSV
```bash
curl http://localhost:3000/api/integrations/google-sheets/export-spreadsheet?format=tsv \
  -H "Authorization: Bearer <token>" -o itam-backup-$(date +%Y%m%d).tsv
```

### 2.4 Retention Policy
- เก็บ backup 7 วันล่าสุด (daily)
- เก็บ backup 4 สัปดาห์ล่าสุด (weekly)
- ลบไฟล์เก่า: `find db/backups/ -name "*.db" -mtime +7 -delete`

---

## 3. การกู้คืนข้อมูล (Restore)

### 3.1 Restore จาก local backup (Development/Staging เท่านั้น)
```bash
# ⚠️ ห้ามรันใน Production
RESTORE_CONFIRM=YES bun scripts/restore-from-supabase.ts
```

### 3.2 Restore จากไฟล์ backup
```bash
# หยุดแอป
# คัดลอก backup
cp db/backups/pre-migration-<timestamp>.db db/custom.db
# รัน restore test ก่อน
bun scripts/restore-test.ts db/backups/pre-migration-<timestamp>.db
# เริ่มแอปใหม่
```

### 3.3 Restore จาก Supabase (Emergency)
```bash
SUPABASE_DATABASE_URL="postgresql://..." RESTORE_CONFIRM=YES bun scripts/restore-from-supabase.ts
```

---

## 4. การอัปเกรด (Upgrade)

### 4.1 Upgrade Flow
```bash
bash scripts/upgrade.sh
```

Flow: Health → Backup → Maintenance → Migration → Smoke Test → Disable Maintenance

### 4.2 Manual Upgrade
```bash
# 1. Backup ก่อน
bun scripts/pre-migration-backup.ts

# 2. Pull latest code
git pull origin main

# 3. Install dependencies
bun install

# 4. Run migration
bun run db:push

# 5. Rebuild
bun run build

# 6. Restart
bun run start
```

### 4.3 Rollback (ถ้า upgrade พัง)
```bash
# Restore backup
cp db/backups/pre-migration-<timestamp>.db db/custom.db

# Rollback code
git checkout <previous-commit>

# Rebuild + restart
bun install && bun run build && bun run start
```

---

## 5. การจัดการผู้ใช้

### 5.1 Reset admin password
```bash
npx tsx -e "
import { db } from './src/lib/db'
import bcrypt from 'bcryptjs'
async function main() {
  const hash = await bcrypt.hash('new-password', 10)
  await db.user.update({ where: { email: 'admin@itam.local' }, data: { passwordHash: hash, passwordSalt: 'reset' } })
  console.log('✓ Admin password reset')
}
main().then(() => process.exit(0))
"
```

### 5.2 สร้าง user ใหม่
ผ่าน UI: Settings → Manage Users → Add

### 5.3 ปิด user
ผ่าน UI: Settings → Manage Users → Edit → active=false

---

## 6. การจัดการ Organization

### 6.1 ดูรายการองค์กร
Settings → Organizations

### 6.2 สร้างองค์กรใหม่
Settings → Setup Wizard → ทำตาม 11 steps

### 6.3 ตรวจ organizationId coverage
```bash
npx tsx scripts/check-scope-matrix.ts
```

---

## 7. การดู Audit Log

### 7.1 ผ่าน UI
Settings → ประวัติการใช้งาน (Audit)

### 7.2 ผ่าน API
```bash
curl http://localhost:3000/api/audit \
  -H "Authorization: Bearer <token>" \
  "?limit=50&action=LEGACY_IMPORT"
```

### 7.3 Event types ที่สำคัญ
| Action | ความหมาย |
|---|---|
| LOGIN | ผู้ใช้เข้าสู่ระบบ |
| LEGACY_SYNC_PREVIEW | ดูตัวอย่าง import |
| LEGACY_SYNC_EXPORT | ส่งออกข้อมูล |
| LEGACY_IMPORT_PREVIEW | Preview legacy import |
| LEGACY_IMPORT_APPLY | Apply legacy import |
| ORGANIZATION_CREATE | สร้างองค์กรใหม่ |
| SETUP_RUN_START | เริ่ม Setup Wizard |
| SETUP_STEP_UPDATE | อัปเดต step |
| CUSTOM_FIELD_CREATE | สร้าง custom field |
| MULTI_ORG_BACKFILL | Backfill organizationId |

---

## 8. การแก้ปัญหา (Troubleshooting)

### 8.1 แอปเข้าไม่ได้
```bash
# ตรวจ process
ps aux | grep next

# ตรวจ port
lsof -i :3000

# ตรวจ log
tail -f dev.log
```

### 8.2 Database locked
```bash
# SQLite WAL mode
sqlite3 db/custom.db "PRAGMA journal_mode=WAL;"
```

### 8.3 OOM (Out of Memory)
```bash
# ลด heap size
NODE_OPTIONS="--max-old-space-size=512" bun run start
```

### 8.4 Prisma Client ล้าง
```bash
rm -rf node_modules/.prisma
bun run db:generate
```

---

## 9. Emergency Contacts

| ระดับ | ติดต่อ | เมื่อไหร่ |
|---|---|---|
| Critical (ระบบล่ม) | Line/Phone ด่วน | แอปใช้ไม่ได้ |
| High (ข้อมูลหาย) | Email + Line | ข้อมูลสำคัญหาย |
| Medium (ฟีเจอร์พัง) | GitHub Issue | ฟีเจอร์ใช้ไม่ได้ |
| Low (คำถามทั่วไป) | Email | สอบถามการใช้งาน |
