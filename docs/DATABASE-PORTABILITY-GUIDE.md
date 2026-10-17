# 🗄️ Database Portability Guide

คู่มือสำหรับผู้ดูแลระบบ — วิธีเปลี่ยน Database ที่คุณดูแลเอง

---

## 📊 Database Providers ที่รองรับ

| Provider | สถานะ | เหมาะกับ | Limitation |
|----------|------|---------|-----------|
| **SQLite** | ✅ Production-ready | Dev / Single-user / Small team | ไม่รองรับ concurrent writes ดี |
| **PostgreSQL** | ✅ Production-ready | Production / Multi-user | ต้องตั้ง server เอง |
| **MySQL** | ⚠️ Beta | ถ้ามีอยู่แล้ว | ยังไม่ได้ทดสอบเต็มที่ |

> **แนะนำ:** ใช้ **PostgreSQL** สำหรับ production (รองรับ concurrent users ดีที่สุด)

---

## 🚀 วิธีตั้งค่า Database ใหม่

### ตัวเลือก A: PostgreSQL (Self-hosted หรือ Cloud)

#### 1. ติดตั้ง PostgreSQL

**Docker (เร็วที่สุด):**
```bash
docker run -d \
  --name itam-postgres \
  -e POSTGRES_DB=itam \
  -e POSTGRES_USER=itam_user \
  -e POSTGRES_PASSWORD=your_secure_password \
  -p 5432:5432 \
  -v itam_pgdata:/var/lib/postgresql/data \
  postgres:17
```

**หรือติดตั้งตรง:**
```bash
# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib
sudo -u postgres createuser --superuser itam_user
sudo -u postgres psql -c "ALTER USER itam_user PASSWORD 'your_secure_password';"
sudo -u postgres createdb -O itam_user itam
```

#### 2. อัปเดต `.env`

```env
# แทนที่ DATABASE_URL เดิม
DATABASE_URL="postgresql://itam_user:your_secure_password@localhost:5432/itam?schema=public"

# (Optional) ถ้าใช้ connection pooler
# DATABASE_URL="postgresql://user:pass@pooler.host:6543/db?pgbouncer=true"
```

#### 3. อัปเดต `prisma/schema.prisma`

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"  // เปลี่ยนจาก "sqlite"
  url      = env("DATABASE_URL")
}
```

#### 4. สร้าง tables

```bash
bun run db:push
```

#### 5. (Optional) Seed demo users

```bash
bun run db:seed
```

---

### ตัวเลือก B: SQLite (ใช้สำหรับ dev / single-user)

#### 1. อัปเดต `.env`
```env
DATABASE_URL="file:/path/to/your/database.db"
```

#### 2. อัปเดต `prisma/schema.prisma`
```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

#### 3. สร้าง tables
```bash
bun run db:push
```

---

### ตัวเลือก C: Supabase (Cloud PostgreSQL ฟรี)

#### 1. สร้าง Supabase project
- ไป https://supabase.com → สร้าง project ใหม่
- คัดลอก connection string จาก Project Settings → Database

#### 2. อัปเดต `.env`
```env
# Transaction mode (แนะนำ — pool_size 200)
DATABASE_URL="postgresql://postgres:[password]@db.[project-ref].pooler.supabase.com:6543/postgres?pgbouncer=true"

# หรือ Session mode (pool_size 15)
# DATABASE_URL="postgresql://postgres:[password]@db.[project-ref].supabase.com:5432/postgres"
```

#### 3. อัปเดต `prisma/schema.prisma`
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

#### 4. สร้าง tables
```bash
bun run db:push
```

---

### ตัวเลือก D: MySQL (Self-hosted)

#### 1. ติดตั้ง MySQL
```bash
docker run -d \
  --name itam-mysql \
  -e MYSQL_ROOT_PASSWORD=your_password \
  -e MYSQL_DATABASE=itam \
  -e MYSQL_USER=itam_user \
  -e MYSQL_PASSWORD=your_password \
  -p 3306:3306 \
  mysql:8
```

#### 2. อัปเดต `.env`
```env
DATABASE_URL="mysql://itam_user:your_password@localhost:3306/itam"
```

#### 3. อัปเดต `prisma/schema.prisma`
```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}
```

#### 4. สร้าง tables
```bash
bun run db:push
```

---

## 🔄 การย้ายข้อมูลจาก Database เดิม

### จาก SQLite → PostgreSQL

#### 1. Export ข้อมูลจาก SQLite
```bash
# ใช้ prisma export (หรือเขียน script)
bun run scripts/export-sqlite.ts
# → ได้ไฟล์ JSON ใน /tmp/itam-export/
```

#### 2. เปลี่ยน config ไป PostgreSQL
(ตามขั้นตอนด้านบน)

#### 3. Import ข้อมูลเข้า PostgreSQL
```bash
bun run scripts/import-to-postgres.ts
```

#### 4. ตรวจสอบ
```bash
bun run scripts/verify-migration.ts
```

---

## ⚠️ สิ่งที่ต้องระวังเมื่อเปลี่ยน Database

### 1. SQL Dialect Differences

| Feature | SQLite | PostgreSQL | MySQL |
|---------|--------|-----------|-------|
| Case-insensitive LIKE | `LOWER(col) LIKE` | `col ILIKE` | `col LIKE` (default) |
| Boolean | 0/1 | true/false | 0/1 |
| Auto-increment | `INTEGER PRIMARY KEY` | `SERIAL` | `AUTO_INCREMENT` |
| JSON | text column | `jsonb` | `json` |
| Date functions | `datetime('now')` | `now()` | `now()` |
| `RETURNING *` | ❌ (newer versions only) | ✅ | ❌ |

**สิ่งที่ทำไว้แล้ว:** `src/lib/db-config.ts` มี `sqlDialect` helper สำหรับจัดการความแตกต่าง

### 2. Prisma Schema

- ตรวจสอบว่า `@db.Decimal(18,2)` รองรับ provider ใหม่
- ตรวจสอบ `@db.Text` และ `@db.JsonB`
- ลบ `@map` ที่ไม่จำเป็น

### 3. Raw Queries

**ห้ามใช้ raw SQL ที่ขึ้นกับ provider!** ใช้:
- Prisma's typed query API (`db.user.findMany()`)
- หรือ `$queryRaw` กับ SQL ที่รองรับทุก provider

### 4. Migrations

- หลังเปลี่ยน provider → รัน `bun run db:push` (ไม่ใช่ migrate)
- ถ้ามี migrations เดิม → ลบ folder `prisma/migrations/` แล้ว push ใหม่

---

## 🧪 ทดสอบหลังเปลี่ยน Database

### 1. ทดสอบการเชื่อมต่อ
```bash
# ทดสอบ health check
curl http://localhost:3000/api/health
```

### 2. ทดสอบ CRUD
```bash
# Create
curl -X POST http://localhost:3000/api/work-orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject":"test","reporterName":"test","tel":"0000000000","submissionSource":"guest"}'

# Read
curl http://localhost:3000/api/work-orders -H "Authorization: Bearer $TOKEN"

# Update + Delete ทดสอบเพิ่มเติม
```

### 3. ทดสอบ performance
```bash
# ใช้ Apache Bench
ab -n 100 -c 10 -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/work-orders
```

---

## 🔧 Environment Variables ทั้งหมด

```env
# === Database ===
DATABASE_URL="postgresql://user:pass@host:5432/dbname"
# หรือ "file:/path/to/db.sqlite" สำหรับ SQLite
# หรือ "mysql://user:pass@host:3306/dbname" สำหรับ MySQL

# Optional — override auto-detect
# DATABASE_PROVIDER="postgresql"  # sqlite | postgresql | mysql

# Optional — connection pool settings
# DATABASE_CONNECTION_LIMIT=5
# DATABASE_POOL_TIMEOUT=30

# === Vercel Blob (optional — for CSV/PDF exports) ===
BLOB_READ_WRITE_TOKEN=

# === Supabase Realtime (optional) ===
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# === Auth ===
JWT_SECRET=your-super-secret-key-min-32-chars

# === Cron Jobs ===
CRON_SECRET=your-cron-secret
```

---

## 📋 Checklist ก่อน Production

- [ ] เลือก Database provider
- [ ] ตั้งค่า `.env` ให้ถูกต้อง
- [ ] อัปเดต `prisma/schema.prisma` provider
- [ ] รัน `bun run db:push`
- [ ] รัน `bun run db:seed` (สำหรับ demo users)
- [ ] ทดสอบ health check: `curl /api/health` → ต้อง 200
- [ ] ทดสอบ login: `curl -X POST /api/itam/auth/login` → ต้อง 200 + token
- [ ] ทดสอบ CRUD endpoint อย่างน้อย 1 ตัว
- [ ] ตั้งค่า backup (cron หรือ script)
- [ ] ทดสอบ restore จาก backup

---

## 🆘 การแก้ปัญหา

### ปัญหา: "Database connection failed"

**ตรวจสอบ:**
1. URL ถูกต้องไหม (เช่น `postgresql://` ไม่ใช่ `postgres://`)
2. Username/Password ถูกไหม
3. Host สามารถเข้าถึงได้ไหม (firewall?)
4. Port ถูกไหม (PostgreSQL: 5432, MySQL: 3306)

**คำสั่งตรวจสอบ:**
```bash
# ทดสอบ PostgreSQL
psql -h host -U user -d dbname

# ทดสอบ MySQL
mysql -h host -u user -p dbname

# ทดสอบจาก Node.js
node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>console.log('OK')).catch(e=>console.error(e.message))"
```

### ปัญหา: "EMAXCONNSESSION" (Supabase เท่านั้น)

**สาเหตุ:** ใช้ session mode (port 5432) ที่มี pool_size 15

**แก้:** เปลี่ยน URL ไปใช้ transaction mode (port 6543):
```
DATABASE_URL="postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true"
```

### ปัญหา: "Prisma Client needs to be regenerated"

```bash
bun run db:generate
# หรือ
bunx prisma generate
```

---

## 📞 ติดต่อ

ถ้ามีปัญหา — ส่ง log + .env (ไม่รวม password) มาให้ทีมดูแล

---

*Last updated: 2026-08-29*
