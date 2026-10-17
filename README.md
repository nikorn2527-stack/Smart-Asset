# Smart-Asset — ระบบครุภัณฑ์ภาครัฐ

แอปแยกที่ใช้ ITAM-NextJS เป็นฐาน Next.js/React/Prisma โดยเก็บ ITAM ต้นฉบับไว้สำหรับพัฒนาคู่กัน ไม่รวม branch นี้กลับเข้า ITAM โดยอัตโนมัติ ฐานที่นำมาใช้ระบุใน `SMART-ASSET-UPSTREAM.json`

งานต้นแบบ Python ทั้งหมด รวมฟังก์ชัน QR แจ้งซ่อม PM ตรวจนับ และแบบเอกสารเดิม เก็บไว้ใน `legacy/govasset-prototype` พร้อมการทดสอบเดิม ฐาน SQLite เดิมอยู่นอก checkout และไม่ได้ย้ายหรือใช้ร่วมกับ Prisma

## ส่วนที่เพิ่มบนฐาน ITAM

- ชื่อเริ่มต้น Smart-Asset และประเภทหน่วยงานรัฐ ฟอนต์ภาษาไทยอยู่ในแอป ไม่ต้องดาวน์โหลดฟอนต์ตอน build
- เครดิต `POWER BY PNG TEAM` สีส้ม `#f97316` บนหน้าระบบและหน้าล็อกอิน เอกสารราชการไม่ใส่เครดิต/โลโก้
- หน้า `/government/register` เลือกครุภัณฑ์ในหน่วยงานและสาขาที่ได้รับสิทธิ์ ค้นหาและแบ่งหน้าครั้งละ 50 รายการ เปิดได้จากรายละเอียดอุปกรณ์ หรือเมนูตั้งค่าหมวดหมู่สินทรัพย์
- แบบทะเบียนคุม A4 แนวนอน 12 คอลัมน์ตามภาพสแกนที่ผู้ใช้ให้ แก้ข้อมูลหัวเอกสาร แถวรายการ และค่าบรรทัดสรุปได้ ไม่คำนวณอัตราค่าเสื่อมที่ไม่มีหลักฐานขึ้นเอง และไม่บวกมูลค่าสะสม/มูลค่าสุทธิข้ามปี
- การบันทึกตรวจสิทธิ์ `DEVICE_EDIT` รายสาขา ร่วมกับ organization/demo scope ตรวจ revision และบันทึก AuditLog ใน transaction เดียวกัน ใช้ AppSetting namespace เฉพาะต่อองค์กร/ครุภัณฑ์ ปิดการอ่านและเขียน namespace นี้ผ่าน generic settings API
- เอกสารเป็น snapshot แยกจากทะเบียน ถ้าทะเบียนเปลี่ยนจะเตือนให้ตรวจฉบับเอกสาร ไม่เขียนทับเอกสารย้อนหลังอัตโนมัติ
- การตั้งค่านโยบายปีงบประมาณในหมวดสินทรัพย์ บันทึก `assetTerminology`, `fiscalYearStartMonth`, `defaultCapitalizeThreshold` ได้จริง เดือนเริ่มต้นตุลาคม วงเงินรับรู้สินทรัพย์เริ่มต้นเว้นว่างให้หน่วยงานกำหนด

## เริ่มพัฒนาใน cloud workspace

ต้องใช้ Node.js 20.9+ และเครือข่ายเข้าถึง npm registry กับ `binaries.prisma.sh` โดยคง TLS และ checksum verification:

```bash
cd /workspace/GovAsset-Prototype
bash scripts/setup-smart-asset.sh
bash scripts/start-smart-asset.sh
```

สคริปต์ติดตั้ง Bun 1.4.3 ใน `/workspace/.tools` ถ้ายังไม่มี ติดตั้ง dependency แบบ frozen lockfile แล้ว generate Prisma client และเตรียมฐาน SQLite **เฉพาะพัฒนา** ที่ `/workspace/.itam/development.sqlite3` โดยไม่ใช้ฐานเดิมหรือฐาน production ไม่ใช้ `--accept-data-loss` หรือ reset ฐานข้อมูล หาก Prisma แจ้งผลกระทบต่อข้อมูลให้ตรวจ migration ก่อนทำต่อ

JWT สำหรับเครื่องพัฒนาสร้างจาก random bytes ใน `/workspace/.itam/development.env` โดยไม่แสดงค่าออก log และไม่ commit ไฟล์นี้ สคริปต์ไม่สร้างบัญชี admin หรือรหัสผ่านมาตรฐานให้เอง การเตรียมผู้ใช้/ข้อมูลสำหรับเข้าใช้งานต้องทำตามขั้นตอนของ ITAM บนฐานทดสอบที่ตรวจสอบแล้ว

เอกสารการตั้งค่า upstream เดิมอยู่ใน `docs/government/ITAM-UPSTREAM-README.md` ห้ามนำ schema SQLite นี้ไป deploy PostgreSQL โดยไม่เตรียม provider/migrations และตรวจ build ตามขั้นตอน production ของ ITAM

## การตรวจงาน

```bash
/workspace/.tools/node_modules/.bin/bun x vitest run tests/government
node scripts/check-module-manifest.mjs
node node_modules/eslint/bin/eslint.js src/lib/government src/app/api/government src/app/api/public/branding src/components/government src/app/government tests/government
```

ชุดทดสอบมีทั้ง validation/renderer, tenant/site/demo authorization boundary, snapshot revision/compare-and-swap, การปิดช่องทาง generic settings และ financial policy persistence โดยใช้ mock สำหรับ Prisma และ auth ที่เป็น dependency ไม่ใช่การรับรองฐานข้อมูลจริง

ตรวจเบราว์เซอร์ Next.js ด้วย API fixtures แล้ว: เลือก/แก้/บันทึกเอกสาร ป้องกันพิมพ์ข้อมูลค้าง ปุ่มพิมพ์จริงผ่าน iframe การฝังฟอนต์ Sarabun และ PDF 12 คอลัมน์ รวมถึงจอมือถือ พิมพ์ A4 แนวนอน 100% และปิดหัว/ท้ายกระดาษของเบราว์เซอร์ก่อนใช้ลงนาม

## สถานะ ณ 16 ตุลาคม 2569

- Frozen installation, module manifest และชุดทดสอบ government ผ่าน
- ITAM-NextJS ต้นฉบับไม่มีไฟล์แก้ค้าง; ไฟล์ auth/audit B4 ที่กำหนด frozen คงเดิมเทียบกับ upstream
- Prisma Client generate และ schema sync บน SQLite cloud ผ่านแล้ว ตัวช่วยติดตั้งรันซ้ำได้
- Full TypeScript typecheck ผ่านหลัง generate client
- ตรวจ HTTP กับ SQLite จริงผ่าน: anonymous 401, แยก org/site 404, บันทึก/อ่านกลับ, revision conflict 409, read-only และ AuditLog
- Browser fixtures/PDF ผ่าน; production build/deploy และ end-to-end ทั้งแอปยังไม่ได้รับรอง
- คู่มือ Local พร้อมตัวช่วยสร้าง `.env`/SQLite: [LOCAL-DEVELOPMENT.md](docs/government/LOCAL-DEVELOPMENT.md)
- ชุดงาน Smart-Asset รวมใน branch `main` แล้ว; ชื่อ repo ใน remote ยังเป็น GovAsset-Prototype จนกว่าจะ rename บน GitHub จริง

## อัปเดต PM / QR

- รอบ PM รายวัน สัปดาห์ เดือน ไตรมาส ครึ่งปี ปี และทุก N วันใช้กติกาเดียวกันทั้งวันนัดและปฏิทิน อิงวันเริ่มแผนและเวลาไทย ปรับวันที่สิ้นเดือนและแสดงตัวอย่าง 5 นัด
- แผนมี organizationId ตรวจ org/site/demo/soft-delete ทุก API ของ PM ตรวจวันของ execution ให้ตรงแผน ปิดงานต้องผ่าน checklist และเลื่อนวันนัดพร้อม audit ใน transaction
- unique index ป้องกันการสร้าง execution ซ้ำของแผน/วันเดียวกัน ตัวช่วย Local ตรวจ duplicate ก่อนสร้าง index และหยุดโดยไม่ลบข้อมูลหากพบ
- QR ใหม่ใช้ ID เต็ม คง URL เมื่อแก้ข้อมูล เก่าที่รหัสย่อซ้ำไม่เลือกผลลัพธ์แรก เจ้าหน้าที่ resolve ผ่านขอบเขตหน่วยงาน/สาขา อุปกรณ์ต่อพ่วงตรวจสิทธิ์ผ่านครุภัณฑ์แม่
- public repair ใช้ตัวระบุเดียวกับหน้าดูข้อมูล รับเจ้าของหน่วยงานจากทะเบียน และยืนยัน LINE ผ่าน session เซิร์ฟเวอร์
- ทดสอบ government รวม 83 ข้อ ผ่าน; HTTP/SQLite จริงผ่าน PM recurrence/calendar/checklist/next date และ QR scope/ข้อมูลแก้ล่าสุด/รหัสซ้ำ/ข้อมูลสาธารณะ; browser จริงผ่าน PM preview จอใหญ่/มือถือ
- **Auto-create WO ของ PM ยังไม่เปิดใช้งาน** ต้องพัฒนา worker/cron ต่อ และยังไม่ได้รับรอง production migration/build หรือ OAuth/ส่งข้อความ LINE จริง

แผน PM เก่าที่ไม่มี organizationId ต้องตรวจเจ้าของและ backfill ก่อนใช้งาน ห้ามอนุมานจากสาขาเดียว รายละเอียดอัปเดตฐาน Local อยู่ในคู่มือ Local ข้างต้น
