# รัน Smart-Asset บนเครื่อง Local

ใช้ Node.js 22 LTS, Git และ Bun 1.4.3 บน Windows/macOS/Linux ฐานข้อมูลทดสอบเป็น SQLite ไม่ต้องติดตั้ง PostgreSQL หรือ Docker

## ดึงโค้ด

ดึง Smart-Asset จาก branch `main` ด้วยคำสั่งด้านล่าง โค้ดนี้อยู่ใน repo แยกจาก ITAM และไม่ได้เปลี่ยน ITAM ต้นฉบับ

```bash
git clone https://github.com/nikorn2527-stack/GovAsset-Prototype.git Smart-Asset
cd Smart-Asset
npm install -g bun@1.4.3
bun install --frozen-lockfile --ignore-scripts
node scripts/setup-local.mjs
```

เมื่อ rename repository บน GitHub เป็น Smart-Asset แล้ว ให้ใช้ `https://github.com/nikorn2527-stack/Smart-Asset.git` แทน URL เดิม

ตัวช่วยสร้าง `.env` เฉพาะเครื่องพร้อม JWT secret แบบสุ่ม และฐาน `prisma/smart-asset-local.db` ไฟล์เหล่านี้ถูก gitignore ไว้ ไม่พิมพ์ secret และไม่เขียนทับ `.env` เดิม ถ้ามี `.env` อยู่แล้ว ต้องตั้ง `DATABASE_URL` และ `DIRECT_DATABASE_URL` ให้เป็น SQLite URL เดียวกัน การรันซ้ำเก็บข้อมูลเดิม ไม่ใช้คำสั่งล้างฐานหรือยอมรับ data loss อัตโนมัติ หาก schema เปลี่ยนจนต้องลบข้อมูล ให้สำรองฐานก่อนและอ่านผล Prisma

## สร้างบัญชีของเครื่องนี้

```bash
bun scripts/create-superadmin.ts
```

กรอกอีเมล รหัสผ่านอย่างน้อย 8 ตัว ชื่อ และ username ของคุณเอง สคริปต์ upstream นี้แสดงรหัสผ่านสรุปบน terminal จึงไม่ควรแชร์ภาพ terminal หรือบันทึก log ขั้นตอนนี้ ใช้กับฐาน SQLite ของเครื่องนี้เท่านั้น หากกรอกบัญชีเดิม สคริปต์จะรีเซ็ตรหัสผ่านและสิทธิ์ของบัญชีนั้น

ไม่ได้ seed ข้อมูลตัวอย่างหรือใช้บัญชี/รหัสผ่านกลางโดยอัตโนมัติ สร้างหน่วยงานและกำหนด organizationId ให้ครุภัณฑ์ก่อนทำใบคุมสินทรัพย์ ระบบจะไม่สร้างเอกสารให้ครุภัณฑ์ที่ยังไม่ผูกหน่วยงาน

## เปิดระบบ

```bash
node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3000
```

เปิด `http://localhost:3000` แล้วเข้าสู่ระบบด้วยบัญชีที่สร้างไว้ ใบคุมสินทรัพย์อยู่ `/government/register` ครั้งต่อไปใช้คำสั่งเปิดระบบได้เลย กด Ctrl+C เพื่อหยุด หากพอร์ตชน เปลี่ยนเลขเป็น 3001

## ตรวจงาน / อัปเดต

```bash
bun x vitest run tests/government
bun run typecheck:full
```

ก่อนอัปเดตหยุดแอปและสำรอง `prisma/smart-asset-local.db` จากนั้น `git pull --ff-only`, `bun install --frozen-lockfile --ignore-scripts` และ `node scripts/setup-local.mjs` แล้วเปิดระบบใหม่

เครื่องต้องเข้าถึง package registry และ `binaries.prisma.sh` เพื่อดาวน์โหลด Prisma engine อย่าปิด TLS/checksum เมื่อดาวน์โหลดไม่สำเร็จ การรัน Local ไม่ใช่ขั้นตอน deploy production; production ต้องเตรียม PostgreSQL/provider/migrations ตามเอกสาร ITAM ต่างหาก

ตรวจตัวช่วยติดตั้งบน Linux ด้วยฐาน SQLite แยกจากฐาน cloud แล้ว ส่วน Windows/macOS ยังไม่ได้ทดสอบบนเครื่องจริง

## อัปเดต PM และ QR (16 ตุลาคม 2569)

รัน `node scripts/setup-local.mjs` หลังอัปเดตซอร์ส เพื่อเพิ่ม `PMSchedule.organizationId` และ unique index ของรอบ PM โดยไม่ล้างฐาน ตัวช่วยตรวจงานซ้ำก่อนสร้าง index: หากมี execution ของแผน/วันเดียวกันซ้ำจะหยุดและเก็บข้อมูลเดิมไว้ ให้สำรองและตรวจรายการซ้ำก่อน ไม่ใช้ `--accept-data-loss` เพื่อข้ามคำเตือน

แผน PM เก่าที่ไม่มี `organizationId` ต้องตรวจและผูกหน่วยงานก่อนจึงจะแสดงให้เจ้าหน้าที่หน่วยงานนั้นเห็น ห้ามเดาจากสาขาอย่างเดียว เมื่อสร้างแผนใหม่ เลือกสาขาที่มีสิทธิ์ ระบุวันเริ่มแผนและรอบเวลา ดูวันนัด 5 ครั้งถัดไปก่อนบันทึก งานแบบทุก N วันนับจากวันเริ่มแผน วันที่ 29–31 ที่ไม่มีในเดือนนั้นจะใช้วันสุดท้ายของเดือน เปิดงานรอทำยังไม่ถือว่าตรวจแล้ว ปิด checklist บังคับครบจึงบันทึกวันที่ทำและเลื่อนวันนัด

QR ที่ออกใหม่ใช้รหัสครุภัณฑ์เต็มใน URL เดิม URL จึงไม่เปลี่ยนเมื่อแก้รายละเอียดในทะเบียน ป้ายเก่าที่เป็นรหัสย่อใช้ต่อได้เมื่อจับคู่ได้เพียงรายการเดียว หากรหัสซ้ำต้องออกป้ายใหม่เพื่อเลือกครุภัณฑ์ให้แน่นอน เจ้าหน้าที่ต้องมีสิทธิ์หน่วยงาน/สาขา ส่วนหน้าสาธารณะแสดงข้อมูลที่คัดไว้ ไม่เปิดราคา IP หรือรายละเอียดภายใน

ใบงานที่แจ้งจาก QR รับ `organizationId` จากครุภัณฑ์ และจะไม่รับแจ้งจากครุภัณฑ์ที่ยังไม่ผูกหน่วยงาน ตัวตน/เบอร์ที่ยืนยันผ่าน LINE มาจาก session ของเซิร์ฟเวอร์ การทดสอบ OAuth/ส่งข้อความ LINE จริงต้องตั้งค่าผู้ให้บริการแยกต่างหาก

**การสร้างใบงาน PM อัตโนมัติเมื่อถึงเวลา ยังไม่เปิดใช้งาน** รอบและปฏิทินคำนวณได้แล้ว แต่ worker/cron สร้างใบงานต้องพัฒนาต่อ ไม่ต้องตั้ง cron เพื่อรัน Local รอบนี้ การ deploy PostgreSQL ต้องทำ migration ที่ตรวจสอบกับฐานจริงก่อน ใช้ตัวช่วย SQLite นี้แทน production migration ไม่ได้
