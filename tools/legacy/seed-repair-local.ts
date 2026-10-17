import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('/home/z/my-project/db/custom.db')
db.exec('PRAGMA foreign_keys = OFF')

const GROUPS = [
  { code: 'IT-PRN', label: 'เครื่องพิมพ์และเครื่องพิมพ์ฉลาก', status: 'active' },
  { code: 'IT-COM', label: 'คอมพิวเตอร์และโน้ตบุ๊ก', status: 'active' },
  { code: 'IT-NET', label: 'Network และการเชื่อมต่อ', status: 'active' },
  { code: 'IT-SFT', label: 'Software และระบบปฏิบัติการ', status: 'active' },
  { code: 'IT-ACC', label: 'บัญชีผู้ใช้และสิทธิ์การใช้งาน', status: 'active' },
  { code: 'IT-SCN', label: 'Scanner และอุปกรณ์สแกน', status: 'active' },
  { code: 'IT-PER', label: 'อุปกรณ์ต่อพ่วง', status: 'future' },
  { code: 'IT-INS', label: 'ติดตั้ง ย้าย และตั้งค่าอุปกรณ์', status: 'active' },
  { code: 'IT-SRV', label: 'Server, Storage และ Backup', status: 'future' },
  { code: 'IT-EML', label: 'Email และการสื่อสาร', status: 'future' },
  { code: 'IT-SEC', label: 'ระบบความปลอดภัยและอุปกรณ์รักษาความปลอดภัย', status: 'future' },
  { code: 'IT-TEL', label: 'โทรศัพท์และระบบสื่อสารภายใน', status: 'future' },
  { code: 'IT-MNT', label: 'บำรุงรักษาและตรวจสอบเชิงป้องกัน', status: 'active' },
  { code: 'IT-OTH', label: 'งาน IT อื่น ๆ', status: 'active' },
]
const PROBLEMS = [
  ['RP-PRN-001', 'วัสดุสิ้นเปลือง หมึก ดรัม หรือกล่องบำรุงรักษา', 'IT-PRN'],
  ['RP-PRN-002', 'พิมพ์ไม่ออก Offline หรือเครื่องไม่ทำงาน', 'IT-PRN'],
  ['RP-PRN-003', 'งานพิมพ์ไม่ชัด สีเพี้ยน เป็นเส้น หรือเลอะ', 'IT-PRN'],
  ['RP-PRN-004', 'กระดาษติดหรือเครื่องไม่ดึงกระดาษ', 'IT-PRN'],
  ['RP-PRN-005', 'Error Code หรือไฟแจ้งเตือน', 'IT-PRN'],
  ['RP-PRN-006', 'Driver, Spooler, Share Printer หรือ IP ของ Printer', 'IT-PRN'],
  ['RP-PRN-007', 'ติดตั้ง ย้าย หรือเปลี่ยนจุดใช้งาน Printer', 'IT-PRN'],
  ['RP-COM-001', 'เปิดไม่ติด ไฟไม่เข้า หรือจอมืด', 'IT-COM'],
  ['RP-COM-002', 'Windows ช้า ค้าง หรือ Error บ่อย', 'IT-COM'],
  ['RP-COM-003', 'โปรแกรมเปิดไม่ได้ ใช้งานไม่ได้', 'IT-COM'],
  ['RP-NET-001', 'อินเทอร์เน็ตใช้ไม่ได้ หรือเน็ตช้า', 'IT-NET'],
  ['RP-NET-002', 'Wi-Fi ไม่เข้า หรือสัญญาณอ่อน', 'IT-NET'],
  ['RP-NET-003', 'Share Drive, Printer หรือ Network Folder ไม่ได้', 'IT-NET'],
  ['RP-SFT-001', 'ติดตั้งหรืออัปเดตโปรแกรม', 'IT-SFT'],
  ['RP-SFT-002', 'License หรือ Activation มีปัญหา', 'IT-SFT'],
  ['RP-SFT-003', 'ไวรัส มัลแวร์ หรือปัญหาความปลอดภัย', 'IT-SFT'],
  ['RP-ACC-001', 'ขอรหัสผ่านใหม่ หรือลืมรหัสผ่าน', 'IT-ACC'],
  ['RP-ACC-002', 'ขอสิทธิ์เข้าถึงระบบเพิ่มเติม', 'IT-ACC'],
  ['RP-ACC-003', 'บัญชีผู้ใช้ถูกล็อกหรือระงับ', 'IT-ACC'],
  ['RP-SCN-001', 'สแกนไม่ได้ หรือสแกนไม่ครบ', 'IT-SCN'],
  ['RP-SCN-002', 'สแกนแล้วภาพไม่ชัด หรือสีเพี้ยน', 'IT-SCN'],
  ['RP-INS-001', 'ติดตั้งอุปกรณ์ใหม่ หรือย้ายจุดวาง', 'IT-INS'],
  ['RP-MNT-001', 'บำรุงรักษาตามรอบ (PM) หรือเช็กสภาพ', 'IT-MNT'],
  ['RP-OTH-999', 'อื่น ๆ / รอเจ้าหน้าที่จำแนก', 'IT-OTH'],
]
const RESOLUTIONS = [
  ['RX-PRN-001', 'เติมหรือเปลี่ยนหมึก ดรัม หรือกล่องบำรุงรักษา', 'IT-PRN'],
  ['RX-PRN-002', 'ตรวจชุดพิมพ์ หัวพิมพ์ คุณภาพงานพิมพ์ หรือ Error Code', 'IT-PRN'],
  ['RX-PRN-003', 'เคลียร์กระดาษติดและตรวจชุดป้อนกระดาษ', 'IT-PRN'],
  ['RX-PRN-004', 'ติดตั้งหรือปรับ Driver, Spooler, Share และ IP', 'IT-PRN'],
  ['RX-COM-001', 'ตรวจไฟเลี้ยง สายไฟ อุปกรณ์ และ Hardware', 'IT-COM'],
  ['RX-COM-002', 'ตรวจระบบ Windows, Driver หรือโปรแกรม', 'IT-COM'],
  ['RX-COM-003', 'เปลี่ยนหรือซ่อมอุปกรณ์คอมพิวเตอร์/โน้ตบุ๊ก', 'IT-COM'],
  ['RX-NET-001', 'ตรวจสาย Port Switch Wi-Fi และสัญญาณเครือข่าย', 'IT-NET'],
  ['RX-NET-002', 'ตรวจหรือปรับ IP, DNS, Share และ Network Configuration', 'IT-NET'],
  ['RX-NET-003', 'เปลี่ยนสายหรืออุปกรณ์เครือข่ายที่ชำรุด', 'IT-NET'],
  ['RX-SFT-001', 'ติดตั้ง อัปเดต หรือตั้งค่าโปรแกรมและ Driver', 'IT-SFT'],
  ['RX-SFT-002', 'แก้ไข Configuration หรือประสานเจ้าของระบบ', 'IT-SFT'],
  ['RX-ACC-001', 'Reset Password หรือแก้ไขบัญชีผู้ใช้', 'IT-ACC'],
  ['RX-ACC-002', 'ปรับสิทธิ์หรือกำหนดสิทธิ์การใช้งาน', 'IT-ACC'],
  ['RX-SCN-001', 'ตั้งค่า Scan, Folder, Email หรือ Driver', 'IT-SCN'],
  ['RX-INS-001', 'ติดตั้ง ย้าย และตั้งค่าจุดใช้งานใหม่', 'IT-INS'],
  ['RX-MNT-001', 'ทำความสะอาด ตรวจเช็ก และบันทึกผลบำรุงรักษา', 'IT-MNT'],
  ['RX-OTH-999', 'อื่น ๆ / รอจำแนก', 'IT-OTH'],
]

const ts = Date.now()
const stmt = db.prepare(`INSERT OR REPLACE INTO MasterItem (id, category, code, label, parentRef, displayLabel, active, "createdAt", "updatedAt", isDemo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)

let n = 0
for (const g of GROUPS) {
  stmt.run(`repair-RepairGroup-${g.code}`, 'RepairGroup', g.code, g.label, null, g.label, g.status === 'active' ? 1 : 0, ts, ts)
  n++
}
for (const p of PROBLEMS) {
  stmt.run(`repair-RepairProblem-${p[0]}`, 'RepairProblem', p[0], p[1], p[2], p[1], 1, ts, ts)
  n++
}
for (const r of RESOLUTIONS) {
  stmt.run(`repair-RepairResolution-${r[0]}`, 'RepairResolution', r[0], r[1], r[2], r[1], 1, ts, ts)
  n++
}

const count = db.prepare('SELECT count(*) as c FROM MasterItem').get().c
console.log(`✓ Inserted ${n} repair taxonomy rows`)
console.log(`MasterItem total: ${count}`)

const cats = db.prepare("SELECT category, count(*) as c FROM MasterItem GROUP BY category ORDER BY c DESC").all()
console.log('Categories:')
cats.forEach(c => console.log(`  ${c.category}: ${c.c}`))
db.close()
