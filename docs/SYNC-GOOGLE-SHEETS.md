# Sync ข้อมูลจาก App เดิม (Google Sheets) → ITAM NextJS

## ภาพรวม

ระบบ ITAM NextJS รองรับการ sync ข้อมูลจาก 3 Google Sheets แอปเดิม:

| App | Google Sheet | ข้อมูลที่ sync |
|-----|-------------|--------------|
| **ITAM** | IT-Asset-Management | Devices, Meter Readings, Transfers |
| **Services** | Services (แจ้งซ่อม) | Work Orders, Repair Tickets |
| **Stock** | Stock (สต๊อก) | Inventory, Stock In/Out, Purchase Orders |

## วิธีตั้งค่า

### ขั้นตอนที่ 1: เตรียม Google Sheets

แต่ละ Sheet ต้องเปิดแชร์เป็น **"Anyone with link"** (สามารถ view):

1. เปิด Google Sheet
2. กดปุ่ม **Share** (มุมขวาบน)
3. เปลี่ยน General access → **"Anyone with the link"**
4. เลือก **Viewer**
5. กด **Save**

### ขั้นตอนที่ 2: ดึง Sheet ID

จาก URL ของ Google Sheet:
```
https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit#gid=0
                                    ^^^^^^^^^
```

คัดลอกส่วน `[SHEET_ID]` ไว้

### ขั้นตอนที่ 3: ตั้งค่า Environment Variables บน Vercel

เข้าไปที่ Vercel Dashboard → Project → Settings → Environment Variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `GOOGLE_SHEETS_ID_ITAM` | `[SHEET_ID]` | Sheet ID ของ IT-Asset-Management |
| `GOOGLE_SHEETS_ID_SERVICES` | `[SHEET_ID]` | Sheet ID ของ Services (แจ้งซ่อม) |
| `GOOGLE_SHEETS_ID_STOCK` | `[SHEET_ID]` | Sheet ID ของ Stock |
| `CRON_SECRET` | `[random-string]` | Secret สำหรับ cron jobs (generate จาก `openssl rand -hex 32`) |

ตั้งค่าทั้งหมดใน Environment: **Production** + **Preview**

### ขั้นตอนที่ 4: ทดสอบ Sync (Manual)

หลังตั้งค่า env vars แล้ว ลอง trigger sync ผ่าน API:

```bash
# Login ก่อน
TOKEN=$(curl -s -X POST "https://itam-next-js.vercel.app/api/itam/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' | jq -r .token)

# ดูตัวอย่างข้อมูลจาก Google Sheets (preview)
curl -s "https://itam-next-js.vercel.app/api/sync/google-sheets?app=itam&gid=0" \
  -H "Authorization: Bearer $TOKEN" | jq .

# ดูตัวอย่างข้อมูล Services
curl -s "https://itam-next-js.vercel.app/api/sync/google-sheets?app=services&gid=0" \
  -H "Authorization: Bearer $TOKEN" | jq .

# ดูตัวอย่างข้อมูล Stock
curl -s "https://itam-next-js.vercel.app/api/sync/google-sheets?app=stock&gid=0" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### ขั้นตอนที่ 5: ตั้งค่า Auto Sync (Cron Job)

ระบบมี cron job ที่รันอัตโนมัติทุกวันเวลา 02:00 AM (Bangkok time):

```json
// vercel.json
{
  "crons": [
    { "path": "/api/cron/keepalive", "schedule": "0 9 * * *" },
    { "path": "/api/cron/daily-report", "schedule": "0 8 * * *" },
    { "path": "/api/cron/sync-legacy", "schedule": "0 2 * * *" }
  ]
}
```

Cron job จะ:
1. ดึงข้อมูลจาก Google Sheets (ถ้ามี env vars)
2. Sync devices, work orders, stock items
3. ประมวลผลเป็น batch (50 records/batch)
4. บันทึก audit log

## Sync UI (Manual)

ผู้ใช้สามารถ sync ผ่านหน้า Settings → นำเข้าข้อมูล:

1. Login เป็น admin
2. ไปที่เมนู **นำเข้าข้อมูล**
3. เลือก **Apps Script Sync** mode
4. เลือก data type (Devices / Work Orders / Stock)
5. กด **Preview Sync** เพื่อดูการเปลี่ยนแปลงก่อน
6. ตรวจสอบ diff แล้วกด **Apply** เพื่อ sync จริง

## Demo Mode vs Real Data (Isolation)

ระบบแยกข้อมูล demo กับจริงอย่างสมบูรณ์:

| User Type | เห็นข้อมูล | สร้างข้อมูล |
|-----------|----------|------------|
| **Demo user** (demo_admin, demo_staff, demo_viewer) | เฉพาะ `isDemo: true` | ทุก record ถูก tag `isDemo: true` อัตโนมัติ |
| **Real user** | เฉพาะ `isDemo: false` หรือ `null` | Record ปกติ (`isDemo: false`) |

### ประโยชน์:
- **Demo user** ทดสอบได้โดยไม่กระทบข้อมูลจริง
- **Real user** ไม่เห็นข้อมูล demo (ป้องกันความสับสน)
- ล้าง demo data ได้ง่าย: `POST /api/itam/demo/reset` (ลบทุก record ที่ `isDemo: true`)

### Demo Data (มีให้ทดสอบ):
- Devices: 115 เครื่อง (DEMO-DEV-001 to 100)
- Work Orders: 90 ใบ
- Stock Items: 39 รายการ
- Meter Readings: 100 records
- PM Schedules: 6 รายการ

## การล้าง Demo Data

```bash
# ล้าง demo data ทั้งหมด (เฉพาะ isDemo: true)
TOKEN=$(curl -s -X POST "https://itam-next-js.vercel.app/api/itam/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"demo_admin","password":"demo123"}' | jq -r .token)

curl -X POST "https://itam-next-js.vercel.app/api/itam/demo/reset" \
  -H "Authorization: Bearer $TOKEN"
```

## การเพิ่ม Demo Data ใหม่

ถ้าล้าง demo data แล้วต้องการเพิ่มใหม่:

```bash
cd /home/z/my-project
DATABASE_URL="..." bun run scripts/expand-demo-data.ts
```

Script นี้ idempotent — รันซ้ำได้โดยไม่สร้าง duplicate

## การแก้ปัญหา

### Sync ไม่ทำงาน
1. ตรวจสอบ env vars บน Vercel (Production + Preview)
2. ตรวจสอบ Google Sheets sharing = "Anyone with link"
3. ตรวจสอบ Vercel function logs

### Demo user เห็นข้อมูลจริง
- ปัญหานี้ถูกแก้แล้วใน commit `693a85d` — demo user เห็นเฉพาะ `isDemo: true`
- ถ้ายังเห็น ให้ logout + login ใหม่ (clear JWT cache)

### ข้อมูล sync ซ้ำ
- Sync ใช้ upsert + check ด้วย assetCode/productCode/woNumber — ไม่ duplicate
