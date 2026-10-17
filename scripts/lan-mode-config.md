# ============================================================
# ITAM-NextJS LAN Mode Configuration
# ตาม section 3.3 ของพิมพ์เขียว — On-Premise/LAN deployment
# ============================================================
#
# วิธีใช้:
#   1. รัน install.ps1 -Mode LANServer
#   2. ตั้งค่าใน .env ตามด้านล่าง
#   3. รัน Caddy/Nginx เป็น reverse proxy (ด้านล่าง)
#   4. เปิดใช้ผ่าน http://itam-server (Hostname ภายในองค์กร)
#
# ข้อดี:
#   - ข้อมูลไม่ออกสู่อินเทอร์เน็ต
#   - ผู้ใช้เข้าผ่าน Hostname (เช่น http://itam-server)
#   - ทีม IT ดูแลได้เอง
# ============================================================

# ── .env configuration ──
# DATABASE_URL=file:./db/custom.db  # SQLite local
# หรือ
# DATABASE_URL=postgresql://itam_app:password@localhost:5432/itam
#
# JWT_SECRET=<generate-32-chars>
# NODE_ENV=production
# PORT=3000
# HOST=0.0.0.0              # bind ทุก interface (LAN access)
#
# ── Security settings ──
# DISABLE_SIGNUP=true        # ห้ามสมัครเอง
# ALLOW_SEED_IN_PRODUCTION=false

# ============================================================
# Caddyfile for LAN mode (Reverse Proxy)
# ============================================================
# วางใน Caddyfile แล้วรัน: caddy run --config Caddyfile

:80 {
    # bind ที่ hostname ภายในองค์กร (เช่น itam-server)
    # หรือ bind ที่ IP ภายใน (เช่น 192.168.1.100)
    bind 0.0.0.0

    reverse_proxy 127.0.0.1:3000 {
        header_up Host {host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }

    # บันทึก access log
    log {
        output file C:\ITAM-NextJS\logs\access.log
        format json
    }

    # Compression
    encode gzip zstd

    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options SAMEORIGIN
        Referrer-Policy strict-origin-when-cross-origin
        Permissions-Policy "geolocation=(), microphone=(), camera=()"
    }
}

# ============================================================
# Alternative: Nginx config for LAN mode
# ============================================================
# วางใน /etc/nginx/conf.d/itam.conf
#
# server {
#     listen 80;
#     server_name itam-server;
#
#     location / {
#         proxy_pass http://127.0.0.1:3000;
#         proxy_set_header Host $host;
#         proxy_set_header X-Real-IP $remote_addr;
#         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#         proxy_set_header X-Forwarded-Proto $scheme;
#     }
#
#     # WebSocket support (for SSE / socket.io)
#     location /api/realtime {
#         proxy_pass http://127.0.0.1:3000;
#         proxy_http_version 1.1;
#         proxy_set_header Upgrade $http_upgrade;
#         proxy_set_header Connection "upgrade";
#         proxy_set_header Host $host;
#     }
# }

# ============================================================
# Windows Firewall rule (PowerShell — run as Admin)
# ============================================================
# เปิด port 80 สำหรับ LAN access:
#
#   New-NetFirewallRule -DisplayName "ITAM-NextJS HTTP" `
#     -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow `
#     -Profile Private,Domain
#
# ปิด port เมื่อไม่ใช้:
#
#   Remove-NetFirewallRule -DisplayName "ITAM-NextJS HTTP"

# ============================================================
# Windows Service (using NSSM)
# ============================================================
# ดาวน์โหลด NSSM จาก https://nssm.cc
#
# สร้าง service:
#   nssm install ITAM-NextJS "C:\Program Files\bun\bun.exe" "run start"
#   nssm set ITAM-NextJS AppDirectory "C:\ITAM-NextJS"
#   nssm set ITAM-NextJS AppEnvironmentExtra "NODE_ENV=production"
#   nssm set ITAM-NextJS Start SERVICE_AUTO_START
#
# เริ่ม service:
#   nssm start ITAM-NextJS
#
# หยุด service:
#   nssm stop ITAM-NextJS
#
# ลบ service:
#   nssm remove ITAM-NextJS confirm
