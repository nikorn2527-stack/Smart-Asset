# QR Smart Architecture (Development Branch)

เอกสารนี้เป็นสัญญาการออกแบบบนโค้ดเดิม ไม่ใช่ระบบใหม่ แชทต้นทางจาก ChatGPT **ไม่ได้ถูกอ่านในรอบนี้** ข้อกำหนดในคำสั่ง Lead เป็น baseline

## Existing capabilities reused

- Stable Asset QR: `asset_qr_links.token` → `/q/{token}` → `/api/scan/{token}`
- Public projection: `smart_assets.public_asset` (ไม่เปิดผู้ครอบครอง)
- Guest repair: `POST /api/scan/{token}/repairs` → `create_ticket` → `ticket_receipts`
- Tracking / acceptance: `/t/{token}` → `/api/receipts/{token}`
- Ticket workflow: รับแจ้งใหม่ → คัดกรอง (review) → อนุมัติ/มอบหมาย → ซ่อม → ตรวจรับ
- Auth bypass สำหรับ scan/receipts ใน `access_control.authenticate`
- Supply รับเข้า/เบิกจ่าย (`supply_*`) และข้อมูลหลักสถานที่ (`operational_master.kind=location`) คงเดิม
- `assets.code` คือเลขครุภัณฑ์เดิม / รหัสอ้างอิง ไม่ถูกแทนที่

## Gaps this branch fills

- Location QR แบบ token คงที่ ไม่ผูกชื่อห้องใน URL
- เมนูบริการบนหน้า QR แยก Guest / ผู้มีบัญชี
- Feature flags บังคับทั้ง UI, API, permission
- Rate limit / honeypot / duplicate / screening / audit สำหรับ Guest
- วงจรยืม–เบิก–คืน–ย้าย แยกจากสถานะซ่อม โดยไม่สร้าง Ticket engine ใหม่

## Interface contracts

Public (ไม่ล็อกอิน):

- `GET /api/qr/public-config`
- `GET|POST /api/scan/{assetToken}` และ `/repairs` (ของเดิม)
- `GET /api/places/{locationToken}`
- `POST /api/places/{locationToken}/reports`
- `GET /l/{locationToken}` ใช้ `scan.html` ชุดเดิม

Staff (ต้องสิทธิ์องค์กร):

- `/api/features` GET/PUT
- `/api/qr/locations` CRUD + QR + guest asset allowlist
- `/api/lifecycle/assets/{id}` GET, POST action: intake/assign/loan/issue/return/relocate

Tickets จาก QR ใช้ตาราง `tickets` เดิม คอลัมน์เพิ่ม: `source_channel`, `location_point_id`, `problem_type`, `guest_screened`

Guest ต้องผ่าน `review` ก่อนมอบหมาย/อนุมัติค่าใช้จ่าย ไม่มี auto-assign

## Feature flag defaults (preserve current product)

เปิดอยู่แล้ว: `assetQr`, `guestReporting`, `assetIntake`, `repairManagement`, `fullAssetRegistration`, `assetNumberGeneration`, `depreciation`

ปิดจนกว่าผู้ดูแลเปิด: `locationQr`, `borrowIssueReturn`, `returnNotifications`, `additionalQrServices`

## File ownership

- `qr_smart.py` — schema migration, flags, location QR, guest guards, lifecycle
- `qr-smart.js` — settings UI
- `scan.js` / `scan.html` / `smart.css` — QR frontend
- `server.py` / `access_control.py` — hooks เท่านั้น
- `tests/test_qr_smart.py` — regression + security

## Placement standard

- Asset QR ติดที่ตัวเครื่อง หนึ่งเครื่องหนึ่งฉลาก ด้านที่สแกนง่าย ไม่บังป้ายเลขทะเบียน ลิงก์ `/q/{token}`
- Location QR ติดที่ประตูห้อง เคาน์เตอร์ โถง หรือจุดบริการ ไม่ติดบนเครื่อง ลิงก์ `/l/{token}`
- ผู้ใช้หน้างานสแกนมือถืออย่างเดียว เจ้าหน้าที่ทำงานที่คอมพิวเตอร์ คัดกรองจริง/ไม่จริง และยืม–เบิก–คืน
- การถือ QR ไม่ยืนยันตัวตนและไม่ยืนยันว่าอยู่สถานที่จริง ลงพื้นที่แผนกนำร่องก่อนแล้วค่อยขยาย

## Assumptions

- Location master ของ QR แยกจาก `operational_master` เพื่อให้มี hierarchy + token + soft-disable โดยไม่เปลี่ยนใบรับเข้า/เบิกจ่าย
- การถือ QR ไม่ถือว่ายืนยันตัวตนหรือยืนยันว่าอยู่สถานที่จริง
- Guest ติดตามงานด้วย receipt token (ของเดิม) เก็บในเครื่องผู้แจ้ง
- แชทต้นทาง ChatGPT **ไม่ได้ถูกอ่าน** ในรอบนี้ ใช้ข้อความคำสั่ง Lead เป็น baseline
- Location report ยังสร้างแถวในตาราง `tickets` เดิม (ไม่สร้าง engine ใหม่) แต่ใช้ helper คนละตัวกับ `create_ticket` ของ staff เพื่อใส่ `source_channel`/`location_point_id`
- การยืนยันช่องทางติดต่อของผู้ไม่มีบัญชีเป็นทางเลือก: เก็บ `contact_verified=0` จนกว่าเจ้าหน้าที่จะคัดกรอง ไม่มี auto-verify
- ยังไม่รับไฟล์แนบจาก Guest ในรอบนี้ (ป้องกันสแปม/มัลแวร์) ใช้ข้อความและ honeypot แทน
- Feature ใหม่ (`locationQr`, `borrowIssueReturn`, `returnNotifications`, `additionalQrServices`) ปิดเป็นค่าเริ่มต้น จะไม่เปิดเองบน Production
