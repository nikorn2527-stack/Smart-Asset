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
