# Smart-Asset และ ITAM-NextJS: ฐานสำหรับการพัฒนาร่วมกัน

ตรวจโค้ดวันที่ 15 ตุลาคม 2569 จาก:

- ITAM-NextJS, branch `main`, commit `133c36188145aa1cffe9fb555d4b745bcd9cab5d`, checkout `/workspace/ITAM-NextJS`
- GovAsset-Prototype (ชื่อเป้าหมาย Smart-Asset), HEAD `27732a44aa29a679dc62eb1b4aa5d7742dd7ecbd` พร้อมงานใน working tree ของเซสชันนี้ที่ยังไม่ได้ commit/push

## แนวทางที่แนะนำ

ใช้ ITAM-NextJS เป็นฐานแพลตฟอร์มของแอปรุ่นถัดไป เพราะมีโมดูล auth/authorization, devices, work orders, PM, QR, stickers, reports และ organization profile อยู่แล้ว จัด Smart-Asset เป็นรุ่นสำหรับภาครัฐที่ใช้แกนหลักเดียวกัน แล้วแยกส่วนทะเบียนคุม FSN ค่าเสื่อม และแบบเอกสารราชการออกเป็นโมดูลเฉพาะ โดยนำความต้องการและการทดสอบจากต้นแบบ Python ไปเป็นเกณฑ์ยอมรับ ไม่คัดลอก API Python ลง Next.js ตรง ๆ

การใช้สอง repository ไม่ทำให้แก้ฟังก์ชันร่วมแล้วอัปเดตให้อีกแอปเอง ต้องมีรุ่นของส่วนกลางและขั้นตอนอัปเดตที่ชัดเจน เป้าหมายระยะยาวเป็น shared packages ที่ตรึง version/commit และมี contract tests ร่วม หรือย้ายเป็น monorepo ที่มีสอง app เมื่อยืนยันขอบเขตผลิตภัณฑ์แล้ว ยังไม่มีการสร้าง shared package หรือย้ายแอปในขั้นตรวจครั้งนี้

## ส่วนที่เทียบได้จากโค้ดจริง

| งาน | ITAM-NextJS | งานฝั่ง Smart-Asset ที่ต้องรักษา |
|---|---|---|
| ผู้ใช้และสิทธิ์ | `src/lib/auth-middleware.ts`, `authorization-context.ts`, `src/app/api/auth`, User/Role/Permission ใน Prisma | แทนบทบาทจำลองด้วย session และสิทธิ์จริง ตรวจขอบเขตหน่วยงานทุก API |
| ทะเบียน | Device, Organization, Site และ `src/app/api/devices` | mapping ID ถาวร, FSN, หมวดราชการ, provenance และรายการที่อนุมัติแล้ว |
| ซ่อม | WorkOrder, messages/reviews/images, `src/app/api/work-orders`, public intake | คัดกรอง วงเงินอนุมัติ อนุมัติยอดจริง ตรวจรับ/ส่งกลับ และแยกข้อมูลสาธารณะ |
| PM | PMSchedule/PMExecution, `src/lib/pm-schedule.ts`, `src/app/api/pm` | วัน/สัปดาห์/เดือนจริง ทุก N หน่วย anchor วันที่ 31 เขตเวลาไทย จัดผู้รับผิดชอบ และสร้างงานไม่ซ้ำ |
| QR | `src/lib/smart-qr.ts`, `asset-qr.ts`, `src/app/qr/[type]/[id]` | QR ที่พิมพ์แล้วต้องใช้ต่อได้ ลิงก์เดิม `/q/<token>` ต้องมี mapping หากย้ายระบบ |
| ฉลาก | Sticker Studio และ `src/app/api/itam/sticker` | URL ถาวรของครุภัณฑ์ ชื่อ/โลโก้ที่แก้ได้ เครดิต POWER BY PNG TEAM สีส้ม |
| แบบราชการ | `src/app/api/reports/asset-register` ปัจจุบันเป็นรายงานรายการหลายสินทรัพย์ 17 คอลัมน์ | แบบทะเบียนคุมรายครุภัณฑ์ 12 คอลัมน์ A4 แนวนอนตาม PDF แนบ เป็นเอกสารคนละแบบ ต้องมี route/template แยก |
| อัตลักษณ์ | `src/lib/org-profile.ts`, OrganizationProfile | ชื่อ Smart-Asset เป็นค่าเริ่มต้นที่แก้ได้ เครดิตสี `#f97316`; ไม่แทรกเครดิตลงแบบราชการ |

## ลำดับการพัฒนา

1. เตรียมและทดสอบ ITAM แบบ isolated ด้วยฐานข้อมูลทดสอบเท่านั้น ตรวจ scripts ที่แก้ Prisma provider ก่อนรัน และอ่าน Next.js guide ตาม AGENTS.md ของ repo
2. ตรึงพฤติกรรมร่วมของ identity, สถานะซ่อม, เวลา PM และสิทธิ์ด้วย contract fixtures; อ้างอิง deviceId ถาวร ไม่จับคู่ชื่อหรือรหัสที่ผู้ใช้แก้ได้
3. ทำ government module บนฐาน Next.js: organization profile, FSN/categories, depreciation snapshot, register form และ provenance พร้อมนำแบบพิมพ์และฟอนต์จากต้นแบบไปทดสอบใน renderer ของ Next.js
4. ย้ายข้อมูลผ่าน importer ที่ตรวจจำนวน ID ซ้ำ foreign keys และ mapping QR/ใบรับแจ้ง สำรองและทำ dry run; เก็บของเดิมไว้จนกว่าจะตรวจครบ ไม่ใช้ฐานเดียวกันให้ Python กับ Prisma เขียนพร้อมกัน
5. จัดการส่วนกลางให้ทั้งสองแอปอัปเดตได้ผ่าน version ที่ระบุชัดเจน พร้อมทดสอบทั้งสอง consumer ก่อนอัปเกรด

## จุดที่ต้องยืนยันก่อนย้ายจริง

- Smart QR ของ ITAM ใช้ ID ย่อใน URL จึงต้องทดสอบการ resolve และ collision รวมถึงเก็บ alias ของ token เต็มที่ออกจากต้นแบบไว้
- PM ของ ITAM รองรับหลาย frequency แต่ custom ที่ตรวจพบอิง intervalDays; ทุก N สัปดาห์/เดือนของ Smart-Asset ต้องมี mapping ที่ไม่แปลงเดือนเป็น 30 วัน
- พบการเก็บ `autoCreateWO`, การคำนวณวัน และ calendar ใน ITAM แต่ยังไม่ได้ยืนยัน worker/cron ภายนอกที่สร้างใบงานอัตโนมัติ ต้องพิสูจน์การสร้างเมื่อไม่เปิดหน้าเว็บและการกลับมาหลัง server restart
- ต้องคง auth, site scope และข้อตกลง Repair/Stock/Devices ตามเอกสารของ ITAM ไม่ย้ายกลไกบทบาทจำลองจากต้นแบบเข้า production
- แบบทะเบียนคุมที่แก้ไว้มี revision และค่าบรรทัดสรุปแยก ห้ามเปลี่ยนเป็นรายงาน 17 คอลัมน์หรือรวมค่าเสื่อมสะสม/มูลค่าสุทธิข้ามปี
- ชื่อ repository บน GitHub ยังเป็น GovAsset-Prototype ใน remote ที่ตรวจได้ การเปลี่ยนชื่อเป็น Smart-Asset ยังไม่ได้ดำเนินการสำเร็จผ่าน API ห้ามเปลี่ยน remote โดยสมมุติว่า rename แล้ว

## ผลตรวจครั้งนี้

Clone และอ่าน `main` สำเร็จ; รัน `node scripts/check-module-manifest.mjs` ผ่าน พบ 17 modules ใน manifest ไม่มีการแก้ไฟล์ ITAM ไม่มีการติดตั้ง dependencies/start/build/test runtime จึงยังไม่อ้างว่าฟังก์ชัน ITAM ทุกส่วนพร้อมทำงานจริง และยังไม่ได้เชื่อมฐานข้อมูลหรือย้ายโค้ดสองแอปเข้าด้วยกัน
