# เอกสารการ Deploy — ITAM-NextJS

> หลักการ: **push ได้เลยโดยไม่กินโควต้า build ของ Vercel — deploy เมื่อสั่งเท่านั้น**

## สรุปสถานะเรื่องฐานข้อมูล

| สถานการณ์ | `DATABASE_URL` | provider ใน `schema.prisma` |
|---|---|---|
| พัฒนาปกติ (ค่าเริ่มต้น) | `file:./db/custom.db` | `sqlite` |
| ทดสอบแบบเหมือนของจริง | `postgresql://itam_app:...@localhost:5432/itam` | `postgresql` |

สลับด้วยคำสั่งเดียว — `scripts/use-db.mjs` เขียน `.env` ให้ แล้ว `set-prisma-provider.mjs`
อ่าน `.env` แล้ว sync `schema.prisma` ให้ตรงกันเอง

```bash
npm run db:use            # ดูว่าตอนนี้ใช้อะไร
npm run db:use:sqlite     # กลับไป SQLite (มีข้อมูลจริงอยู่ตรงนี้)
npm run db:pg:up          # เปิด Docker + สร้างตารางใน PostgreSQL
npm run db:pg:down        # ปิด PostgreSQL (ประหยัด RAM)
```

> **PostgreSQL จาก Docker เริ่มว่างเปล่า** — ข้อมูลจริงมาจาก Google Sheet ผ่าน
> legacy bridge (`/api/sync/preview` → `/api/sync/run`) ไม่ได้ย้ายมาจาก SQLite

> **หมายเหตุเรื่อง path:** SQLite resolve path จากโฟลเดอร์ `prisma/` ไม่ใช่ project root
> ดังนั้น `file:./db/custom.db` = `prisma/db/custom.db` (ถูกต้องอยู่แล้ว)

---

ทำไม: เดิม Vercel ผูกกับ GitHub แบบ auto-deploy ทุกครั้งที่ push เข้า `main`
ทำให้ **1 push = 1 build** และโควต้า Vercel หมดเร็ว (เรื่อง "ลิมิต" ที่เคยเจอ)

GitHub Actions กับ Vercel ใช้ **โควต้าแยกกัน** → เราใช้ GitHub Actions ตรวจงานให้หมด
แล้วค่อยกด deploy ทีเดียวตอนท้าย

---

## 1. ตั้งค่า Vercel (ทำครั้งเดียว — ✅ ทำแล้ว 2026-10-04)

**Vercel → Project → Settings → Git → ปุ่ม `Disconnect`**

ตัดการเชื่อม GitHub ออกทั้งหมด → **push ไป GitHub ไม่สร้าง build บน Vercel อีก**

> **หมายเหตุ:** เมนูนี้ยังแสดงสิทธิ์ GitHub App (Pull Request Comments, Commit Comments,
> `deployment_status` Events, `repository_dispatch` Events) — **อย่าไปปิดสวิตช์พวกนั้น**
> เพราะไม่เกี่ยวกับการ build และ `repository_dispatch` จำเป็นต่อการ deploy ผ่าน CLI

> **ข้อแลกที่ต้องรู้:** จะเสีย Preview deployment อัตโนมัติ (ตอนเปิด PR จะไม่มี URL ให้ทดสอบ)
> ถ้าต้องการ Preview ต้อง deploy เอง (`vercel` หรือ workflow)

ตรวจว่าปิดแล้ว: พอ push `main` แล้ว **ไม่มี build ใหม่โผล่บน Vercel**

---

## 2. ตั้งค่า GitHub Secrets (ทำครั้งเดียว)

GitHub → Repo → **Settings → Secrets and variables → Actions** → New repository secret

| ชื่อ secret | ค่า |
|---|---|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens → Create |
| `VERCEL_ORG_ID` | Project → Settings → General → API Reference → Organization ID |
| `VERCEL_PROJECT_ID` | หน้าเดียวกัน → Project ID |
| `VERCEL_DATABASE_URL` | Supabase connection string (ใช้ตอน `prisma generate`) |
| `JWT_SECRET` | ค่าเดียวกับ production |

---

## 3. การใช้งานปกติ

### แบบที่ใช้ทุกวัน (ปลอดภัย ไม่กินโควต้า)

```bash
git add -A
git commit -m "..."
git push origin main
```

→ GitHub Actions รันเอง: typecheck → lint → tests → `next build`
→ **ไม่ deploy อะไรเลย** ดูผลได้ที่แท็บ Actions

### เมื่อพร้อมจะขึ้นของจริง (1 ครั้ง = 1 build)

**ทางเลือก A — กดปุ่ม (แนะนำ)**
GitHub → แท็บ **Actions** → เลือก **Deploy** → **Run workflow** → Run

**ทางเลือก B — ใช้ tag (เก็บประวัติการปล่อยได้ด้วย)**
```bash
git tag v1.2.3
git push origin v1.2.3
```

ทั้งสองทางใช้ `concurrency` กัน build ซ้อนกัน และเช็ค secret ก่อนเสียโควต้า

---

## 4. ถ้าไม่อยากใช้ GitHub Actions เลย

deploy จากเครื่องตัวเองได้ (ยังกินโควต้าเท่ากัน 1 ครั้ง แต่ไม่ต้องตั้ง secret ใน GitHub):

```bash
npm install -g vercel
vercel login
vercel link
vercel --prod
```

---

## 5. Workflows ที่มีอยู่

| ไฟล์ | ทำอะไร | ทำงานเมื่อ |
|---|---|---|
| `.github/workflows/ci.yml` | ตรวจ typecheck/lint/tests/build | push หรือ PR → `main` |
| `.github/workflows/deploy.yml` | deploy ขึ้น Vercel production | กดปุ่ม หรือ push tag `v*` |
| `.github/workflows/postgres-verification.yml` | ชุดทดสอบ Postgres แบบเต็มรูปแบบ | กดปุ่มเท่านั้น (ใช้ตอน release) |
| `.github/workflows/pr-sync-1-tests.yml` | ชุดทดสอบ sync เฉพาะ branch | ผูกกับ branch ที่ระบุ |

---

## 6. ปัญหาที่รู้จัก

| อาการ | สาเหตุ |
|---|---|
| ยัง auto deploy อยู่ | Automatic Deployments ยังไม่ได้ปิดใน Vercel |
| `next build` OOM | เพิ่ม `NODE_OPTIONS='--max-old-space-size=4096'` ในสคริปต์ `build` แล้ว |
| Prisma client ไม่ตรง schema | `scripts/set-prisma-provider.mjs` อ่าน `DATABASE_URL` ก่อน `.env` จะถูกโหลด — ดูหมายเหตุด้านล่าง |
| Dockerfile สร้างไม่ได้ | ตั้ง `SANDBOX_PREVIEW=1` ทำให้ `next.config.ts` ไม่เปิด `output: 'standalone'` แต่ Dockerfile ต้องการมัน — **ยังไม่แก้** เพราะ deploy จริงเป็น Vercel ไม่ได้ใช้ Docker |

### หมายเหตุ `set-prisma-provider.mjs`

สคริปต์นี้เลือก `provider` ของ Prisma จาก `process.env.DATABASE_URL`
แต่ตอนที่ `prebuild` hook ทำงาน **ยังไม่ได้โหลด `.env`** → เห็นค่าว่าง → เดาว่า `postgresql`
ทำให้ `prisma/schema.prisma` ไม่ตรงกับ DB ที่ใช้จริง

ทางแก้ถาวร: ให้สคริปต์อ่านไฟล์ `.env` เองก่อนตัดสินใจ