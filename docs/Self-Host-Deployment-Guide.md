# Self-Host Deployment Guide

**สำหรับ:** VPS, Cloud Server, Windows Server, หรือเครื่องใดก็ได้ที่มี Docker

---

## ข้อดี Self-Host

- ✅ ไม่จำกัด quota (ต่างจาก Vercel)
- ✅ ควบคุมข้อมูลได้ 100%
- ✅ ใช้ PostgreSQL ของตัวเอง (หรือ Supabase)
- ✅ รองรับ LAN mode (ไม่ต้องออกอินเทอร์เน็ต)
- ✅ ค่าใช้จ่ายต่ำ (VPS $5-10/เดือน)

---

## วิธีที่ 1: Docker Compose (แนะนำ — ง่ายสุด)

### สิ่งที่ต้องมีบน Server:
- Docker 24+
- Docker Compose v2

### ขั้นตอน:

```bash
# 1. Clone repo
git clone git@github.com:nikorn2527-stack/ITAM-NextJS.git
cd ITAM-NextJS

# 2. สร้าง .env จาก template
cp .env.selfhost .env

# 3. แก้ .env — กรอกค่าจริง
nano .env
#   DB_PASSWORD=<strong-password>
#   DATABASE_URL=postgresql://itam_app:<strong-password>@db:5432/itam
#   JWT_SECRET=<32-char-random-string>
#   GOOGLE_* (ถ้าใช้)

# 4. Build + Start
docker-compose up -d --build

# 5. รัน Migration (ครั้งแรก)
docker-compose exec app npx prisma migrate deploy

# 6. ตรวจสุขภาพ
curl http://localhost:3000/api/health
# Expected: {"status":"ok"}

# 7. เปิด Setup Wizard
# เปิด browser → http://localhost:3000
# Login: admin / test1234
# Settings → Setup Wizard → ทำตาม 11 steps
```

### จัดการ:

```bash
# ดู logs
docker-compose logs -f app

# หยุด
docker-compose down

# อัปเดต (pull โค้ดใหม่ + rebuild)
git pull origin main
docker-compose up -d --build

# Backup database
docker-compose exec db pg_dump -U itam_app itam > backup.sql

# Restore database
docker-compose exec db psql -U itam_app itam < backup.sql
```

---

## วิธีที่ 2: ใช้ Supabase (แทน PostgreSQL ใน Docker)

ถ้ามี Supabase อยู่แล้ว — ไม่ต้องรัน PostgreSQL ใน Docker:

```bash
# 1. แก้ docker-compose.yml — ลบ service "db" ออก
# 2. แก้ .env
DATABASE_URL=postgresql://itam_app:[PASSWORD]@[SUPABASE_HOST]:5432/postgres

# 3. Build + Start (มีแค่ app + proxy)
docker-compose up -d --build app proxy

# 4. รัน Migration
docker-compose exec app npx prisma migrate deploy
```

---

## วิธีที่ 3: Windows Server (ไม่ใช้ Docker)

```powershell
# 1. ติดตั้ง Bun
irm bun.sh/install.ps1 | iex

# 2. Clone repo
git clone https://github.com/nikorn2527-stack/ITAM-NextJS.git
cd ITAM-NextJS

# 3. ติดตั้ง dependencies
bun install

# 4. สร้าง .env
cp .env.example .env
# แก้ค่าใน .env

# 5. รัน Migration
bun run db:generate
npx prisma migrate deploy

# 6. Build
bun run next build --webpack

# 7. Start
bun run next start -p 3000

# 8. หรือสร้าง Windows Service
nssm install ITAM-NextJS "C:\Program Files\bun\bun.exe" "run next start"
nssm set ITAM-NextJS AppDirectory "C:\ITAM-NextJS"
nssm start ITAM-NextJS
```

---

## วิธีที่ 4: VPS (Linux — ไม่ใช้ Docker)

```bash
# 1. ติดตั้ง Bun
curl -fsSL https://bun.sh/install | bash

# 2. Clone + Install
git clone git@github.com:nikorn2527-stack/ITAM-NextJS.git
cd ITAM-NextJS
bun install

# 3. สร้าง .env
cp .env.example .env
nano .env  # กรอกค่าจริง

# 4. ติดตั้ง PostgreSQL (ถ้าไม่มี)
sudo apt install postgresql -y
sudo -u postgres createuser itam_app -P
sudo -u postgres createdb itam -O itam_app

# 5. Migration
bun run db:generate
npx prisma migrate deploy

# 6. Build
bun run next build --webpack

# 7. รันเป็น systemd service
sudo tee /etc/systemd/system/itam.service << 'EOF'
[Unit]
Description=ITAM-NextJS
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/ITAM-NextJS
ExecStart=/home/ubuntu/.bun/bin/bun run next start -p 3000
Restart=always
EnvironmentFile=/home/ubuntu/ITAM-NextJS/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable itam
sudo systemctl start itam

# 8. ติดตั้ง Caddy (reverse proxy + HTTPS)
sudo apt install caddy -y
# แก้ Caddyfile → sudo nano /etc/caddy/Caddyfile
# รีสตาร์ท Caddy
sudo systemctl restart caddy
```

---

## สรุปเปรียบเทียบ

| วิธี | ความยาก | เวลาติดตั้ง | ค่าใช้จ่าย | เหมาะกับ |
|---|---|---|---|---|
| Docker Compose | ง่าย | 5 นาที | $5-10/เดือน VPS | แนะนำ |
| Supabase + Docker | ง่าย | 5 นาที | $0 (Supabase free) | มี Supabase แล้ว |
| Windows Server | ปานกลาง | 15 นาที | $0 (เครื่องเดิม) | On-Premise |
| VPS Linux | ปานกลาง | 15 นาที | $5-10/เดือน | Cloud |

---

## ไฟล์ที่เตรียมไว้:

| ไฟล์ | ใช้สำหรับ |
|---|---|
| `Dockerfile` | Docker image |
| `docker-compose.yml` | Docker Compose (app + db + proxy) |
| `Caddyfile.selfhost` | Reverse proxy + HTTPS |
| `.env.selfhost` | env template สำหรับ self-host |
| `scripts/install.ps1` | Windows Installer |
| `docs/Setup-Guide-Credentials.md` | คู่มือตั้งค่าทั้งหมด |
| `docs/Support-Runbook.md` | คู่มือทีม IT |
