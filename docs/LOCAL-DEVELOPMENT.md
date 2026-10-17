# รัน Smart-Asset บนโครงสร้าง GovAsset เดิม

แอปใช้ **Python + SQLite + HTML/CSS/JavaScript** เช่นเดิม ใช้ ITAM เป็นแหล่งอ้างอิงฟังก์ชันเท่านั้น เวอร์ชัน Next.js ที่ทดลองแยกไว้ใน branch `archive/itam-based-smart-asset`; ไม่ต้องติดตั้ง Bun, Node.js, Next.js หรือ Prisma สำหรับแอปนี้

## Windows / VS Code

ติดตั้ง [Python 3.12](https://www.python.org/downloads/) และ Git ก่อน เปิด Terminal PowerShell ใน VS Code:

```powershell
git clone https://github.com/nikorn2527-stack/Smart-Asset.git
cd Smart-Asset
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:HOST = "127.0.0.1"
$env:PORT = "8000"
$env:ASSET_DB_PATH = "$env:LOCALAPPDATA\Smart-Asset\smart-asset.sqlite3"
.\.venv\Scripts\python.exe server.py
```

เปิด **http://localhost:8000** ครั้งแรกสร้างฐานสาธิตให้เอง กด Ctrl+C เพื่อหยุด ครั้งถัดไปเข้าโฟลเดอร์ ตั้งค่า HOST/PORT/ASSET_DB_PATH เดิม แล้วรัน `server.py` ได้เลย ไม่ต้อง activate venv หรือแก้ execution policy

หากมี clone เก่าที่เป็น Next.js อยู่แล้ว ให้หยุด server เดิมและสำรอง `.env` กับ `prisma/smart-asset-local.db` ไว้นอกโฟลเดอร์ จากนั้น `git switch main` และ `git pull --ff-only` แล้วทำขั้นตอน Python ตั้งแต่สร้าง `.venv` หาก Git แจ้งว่ามีไฟล์แก้ค้าง ให้เก็บงานหรือใช้โฟลเดอร์ clone ใหม่ อย่า reset หรือลบงานค้างเพื่อข้ามข้อความเตือน

ข้อมูลในฐาน Prisma ของเวอร์ชัน Next.js **ไม่ได้แปลงเป็นฐาน Python อัตโนมัติ** และไม่ควรเปลี่ยนชื่อไฟล์แล้วใช้แทนกัน ฐาน GovAsset เดิมยังใช้ผ่าน `ASSET_DB_PATH` ได้ โดยสำรองไฟล์ SQLite ก่อนอัปเดตเสมอ ห้ามนำฐานราชการจริงมาใส่ Git

## macOS / Linux

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
HOST=127.0.0.1 PORT=8000 ASSET_DB_PATH="$HOME/.local/share/Smart-Asset/smart-asset.sqlite3" .venv/bin/python server.py
```

## ตรวจระบบ

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

บน macOS/Linux ใช้ `.venv/bin/python` แทน เส้นทางทดสอบสร้างฐานชั่วคราวของตัวเอง ไม่ใช้ฐานที่ผู้ใช้ตั้งไว้

PM/ตรวจนับตั้งได้รายวัน สัปดาห์ เดือน และทุก N หน่วย มีทั้งรอบที่สั่งสร้างเองกับ scheduler ใน server; QR ใช้ token คงที่ แก้ทะเบียนแล้วสแกนป้ายเดิมได้; ตั้งค่าชื่อ/โลโก้ได้ และใบคุมสินทรัพย์ใช้ฟอร์ม A4 แนวนอน 12 คอลัมน์พร้อมฟอนต์ Sarabun ในแอป

การสแกนจากโทรศัพท์ต้องตั้ง public base URL เป็นโดเมนหรือ IP ที่โทรศัพท์เข้าถึงได้ `localhost` ของคอมพิวเตอร์จะไม่ชี้มายังเครื่องเดียวกันบนโทรศัพท์ การเปิดผ่าน LAN ต้องจัดการการเข้าถึงเครือข่ายให้เหมาะสมก่อน

ต้นแบบยังใช้บทบาทจำลอง ไม่ใช่ระบบ login/authorization จริง จึงใช้กับข้อมูลสังเคราะห์เพื่อทดสอบเท่านั้นจนกว่าจะพัฒนาสิทธิ์และตรวจความปลอดภัยครบ Windows instructions ยังไม่ได้รันบนเครื่อง Windows จริง; ตรวจ workflow/API บน Linux แล้ว


## ใช้ไฟล์ฐานข้อมูล SQLite ที่ได้รับมา

หยุด server ด้วย Ctrl+C แล้วสำรองฐานเดิมก่อน วางไฟล์ SQLite ของแอป Python ไว้นอกโฟลเดอร์ Git เช่น `D:\Smart-Asset-data\Smart-Asset-demo.sqlite3` จากนั้นเปิดจากโฟลเดอร์โปรเจกต์:

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "8000"
$env:ASSET_DB_PATH = "D:\Smart-Asset-data\Smart-Asset-demo.sqlite3"
.\.venv\Scripts\python.exe server.py
```

ไฟล์ชื่อ demo เป็นข้อมูลสาธิต ไม่ใช่ทะเบียนจริง หากเคยใช้ฐานอื่น ให้เก็บไฟล์เดิมไว้และสลับ path แทนการเขียนทับ หลีกเลี่ยงการคัดลอกไฟล์ DB ขณะ server ยังทำงานเพราะข้อมูลอาจอยู่ในไฟล์ WAL ให้ใช้ SQLite backup หรือปิด server ให้เรียบร้อยก่อน

## สร้างฐานจริงจากเอกสารบน Windows โดยตรง

ลิงก์พาธ `/workspace/...` ในแชตเป็นไฟล์ในเครื่อง Cloud ไม่ใช่ลิงก์ดาวน์โหลดที่รับประกันว่าเปิดได้จากเครื่องผู้ใช้ สามารถสร้างฐานใหม่บนเครื่องตนเองจากเอกสารต้นฉบับได้:

1. แตก `ครุภัณฑ์แยกประเภท.rar` ให้ได้โฟลเดอร์ Excel 19 ไฟล์ และเก็บ `คู่มือ การออกเลขครุภัณฑ์.pdf` ไว้ในเครื่อง
2. หยุดเซิร์ฟเวอร์เดิมด้วย Ctrl+C แล้วเปิด PowerShell ในโฟลเดอร์แอป:

```powershell
git pull --ff-only
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-import.txt
.\.venv\Scripts\python.exe scripts\import-local.py --run
```

3. หน้าต่างแรกให้เลือกโฟลเดอร์ Excel ที่แตกแล้ว หน้าต่างถัดไปให้เลือก PDF คู่มือ รอข้อความนำเข้าสำเร็จ ตัวช่วยจะเปิดเซิร์ฟเวอร์ Local ที่พอร์ต 8000 ให้

ฐานใหม่อยู่ใน `%LOCALAPPDATA%\Smart-Asset\smart-asset-imported-วันเวลา-รหัส.sqlite3` และมีไฟล์ `.import.log` อยู่ข้างกัน ไม่เขียนทับฐานเดิม ข้อมูล 2 ชุดที่ตรวจแล้วให้ครุภัณฑ์ 66,394 รายการและแถวต้นทาง 66,395 แถว หากใช้อุปกรณ์/ไฟล์คนละรุ่น ให้ตรวจจำนวนที่แสดงก่อนใช้จริง

เมื่อหยุดเซิร์ฟเวอร์ ตัวช่วยไม่เปลี่ยน environment variables ของ PowerShell แม่ ครั้งถัดไปใช้คำสั่ง `ASSET_DB_PATH` และคำสั่งรันที่ตัวช่วยแสดงหลังนำเข้าสำเร็จ ไม่ต้องนำเข้าทั้งชุดใหม่ทุกครั้ง

ตัวอ่าน PDF ใช้ `pdftotext` ถ้ามี หรือ `pypdf` จาก requirements-import บน Windows จึงไม่ต้องติดตั้ง Poppler แยก การเลือกไฟล์ผ่านหน้าต่างใช้ tkinter ของ Python สำหรับ Windows; หากไม่มี ใช้พาธโดยตรง:

```powershell
.\.venv\Scripts\python.exe scripts\import-local.py --workbook-dir 'D:\เอกสาร\ครุภัณฑ์แยกประเภท' --fsn-manual 'D:\เอกสาร\คู่มือ การออกเลขครุภัณฑ์.pdf' --run
```

เพิ่ม `--archive 'D:\เอกสาร\ครุภัณฑ์แยกประเภท.rar'` เพื่อบันทึก hash ของแฟ้มรวมต้นฉบับด้วย ตัวช่วยค้น RAR ชื่อนี้ในโฟลเดอร์ Excel และโฟลเดอร์แม่ให้อัตโนมัติเมื่อพบ ไฟล์ Excel แต่ละไฟล์และ PDF มี hash แยกอยู่แล้ว หากไม่ใช้ `--run` จะสร้าง/ตรวจฐานและแสดงคำสั่งเปิดใช้งานโดยไม่เริ่มเซิร์ฟเวอร์

ตรวจตัวช่วยและ PDF fallback กับไฟล์จริงบน Linux แล้ว ยังไม่ได้ทดสอบหน้าต่างเลือกไฟล์บนเครื่อง Windows จริง
