# Legacy Coexistence Bridge Runbook

**สถานะ:** MVP พร้อมตรวจสอบบน branch `feature/itam01-parity-integration-2026-08-22`

**จุดประสงค์:** ทำให้แอปเก่าที่ยังใช้งานจริงส่งข้อมูลต่อเข้าสู่ Next.js/ITAM-DB ได้ระหว่างช่วงเปลี่ยนผ่าน โดยไม่ต้องย้ายข้อมูลทั้งหมดในครั้งเดียว และไม่ต้องเขียน logic ของแอปเก่าซ้ำทั้งระบบ

**หลักการสำคัญ:** ระบบเก่ายังคงเป็น operational source จนกว่าแต่ละโมดูลจะผ่าน cutover ส่วน ITAM-DB เป็น canonical target ของระบบใหม่ เมื่อข้อมูลเข้าระบบใหม่แล้ว API/UI ของ Next.js ต้องอ่าน canonical fields ของ ITAM-DB ไม่ผูกกับชื่อคอลัมน์หรือรูปแบบ response เก่าภายในโดยตรง

## 1. ขอบเขตที่สร้างแล้ว

Bridge รองรับ target แบบ opt-in ผ่านโมดูลต่อไปนี้

| โมดูล | Identity หลัก | Canonical payload ที่ส่งเข้า ITAM-DB | กติกาความปลอดภัย |
|---|---|---|---|
| `device` | `assetCode` + `serialNumber` | Device fields ตาม Prisma schema ใหม่ | Asset No. และ Serial Number ต้องมาคู่กันเสมอ |
| `work-order` | `requestId` หรือ legacy job identity | WorkOrder fields ใหม่ พร้อมรักษา `legacyJobNo` | ไม่เดา device/site หาก resolve ไม่ได้ |
| `meter-reading` | `readingId` หรือ deterministic source key | `readingDate`, `meterBw`, `pagesBw`, `siteAtReading` | เป็น append-only และตรวจ site scope |
| `stock-item` | `productCode` | `productCode`, `productName` และยอดตาม schema ใหม่ | ใช้ version baseline เมื่อ update |
| `stock-transaction` | deterministic `sourceKey` | IN/OUT/ADJUST ตาม semantics ใหม่ | append-only; source เดิมเปลี่ยน payload จะ quarantine |

ระบบใหม่สร้างหรือใช้ `systemJobNo` ได้ตามกติกาของระบบใหม่ ขณะที่ `legacyJobNo` ต้องเก็บค่าเดิมแบบ immutable เมื่อ source ส่งมา ทั้งสองค่าใช้สำหรับ traceability และการ link stock transaction ห้ามนำค่าหนึ่งไปเขียนทับอีกค่า

## 2. Flow ระหว่าง coexistence

```text
Legacy Apps / Apps Script
        |
        | server-side pull; credential ไม่ออกไปที่ browser
        v
POST /api/sync/preview
        |
        | normalize + validate + map canonical + quarantine
        | read-only diff against ITAM-DB
        v
SyncRun(mode=preview) + SyncRunItem
        |
        | Release/Audit ตรวจ counts, conflicts, site scope, unmapped columns
        v
POST /api/sync/run
        |
        | apply เฉพาะ preview ที่ completed และ item ที่ pending
        | serializable retry + version check + audit
        v
ITAM-DB canonical tables
        |
        v
Next.js APIs/UI
```

ไม่มี reverse write จาก bridge กลับไปแก้แอปเก่าโดยอัตโนมัติใน MVP นี้ ดังนั้นระหว่าง coexistence ต้องกำหนด owner ของแต่ละโมดูลให้ชัดเจน และห้ามเปิดให้ผู้ใช้เขียนรายการเดียวกันจากสองระบบพร้อมกันโดยไม่มี cutover decision

## 3. วิธี Preview

Endpoint คือ `POST /api/sync/preview` และต้องใช้ session/auth ของผู้ดูแลระบบตาม policy ปัจจุบัน

ตัวอย่างโครงสร้าง request โดยไม่ใส่ credential ในเอกสาร

```json
{
  "source": "services",
  "module": "work-order",
  "options": {
    "since": "2026-08-22T00:00:00.000Z",
    "siteFilter": "HQ",
    "limit": 500
  }
}
```

`module` เป็น opt-in bridge namespace หากไม่ส่ง `module` ระบบจะคง WorkOrder preview behavior เดิมไว้ เพื่อไม่ทำให้ caller เก่าเปลี่ยนพฤติกรรมโดยไม่ตั้งใจ ชื่อ `source` ต้องสอดคล้องกับ environment registry ฝั่ง server ซึ่งใช้รูปแบบ `APPS_SCRIPT_<SOURCE>_URL` และ `APPS_SCRIPT_<SOURCE>_TOKEN`; ค่าเหล่านี้ต้องอยู่ใน secret manager/Vercel environment เท่านั้น ห้ามใส่ใน browser หรือเอกสารที่แชร์สาธารณะ

Preview จะทำสิ่งต่อไปนี้

1. ดึงข้อมูลจาก source ฝั่ง server และจำกัดจำนวนแถวตาม `limit`
2. แปลงชื่อและรูปแบบข้อมูล legacy เป็น canonical payload ของโมดูลที่เลือก
3. บังคับ paired identity ของ Device และตรวจ site scope แบบ fail-closed
4. จำแนกแต่ละรายการเป็น `create`, `update`, `skip` หรือ `error`
5. สร้าง `SyncRun` และ `SyncRunItem` เพื่อเก็บ baseline ก่อน apply
6. ไม่เขียน `Device`, `WorkOrder`, `MeterReading`, `StockItem` หรือ `StockTransaction`

ผลที่ต้องตรวจจาก response และหน้า SyncRun ได้แก่ `totalRows`, `createRows`, `updateRows`, `skipRows`, `errorRows`, `unmappedColumns` และ `quarantinedRows` หากมี `error`, unknown site, missing paired identity หรือ unmapped field ที่มีความหมายทางธุรกิจ ห้ามกด apply ให้แก้ mapping/source แล้วสร้าง preview ใหม่

## 4. วิธี Apply

Endpoint คือ `POST /api/sync/run` โดย request หลักต้องระบุ `previewRunId`

```json
{
  "previewRunId": "<completed-preview-run-id>"
}
```

หากต้องการ apply เฉพาะรายการ สามารถส่ง `itemIds` เพิ่มได้ แต่ bridge จะ apply เฉพาะ item ที่ยังมี status `pending` เท่านั้น เพื่อป้องกัน replay รายการที่เคย apply แล้ว

Apply จะผ่านเงื่อนไขทั้งหมดนี้ก่อน

- preview run ต้องมีอยู่จริง, `mode=preview` และ `status=completed`
- ผู้ใช้ที่ไม่ใช่ superadmin ต้องเป็นเจ้าของ preview run เดิม
- site scope ของ run และของแต่ละ item ต้องได้รับอนุญาต
- target ที่เป็น `legacy-bridge:<module>` ต้องเป็น module ที่ระบบรองรับ; target ผิดรูปแบบจะ fail-closed
- item ที่เป็น `error` จะไม่ถูกเขียน
- item ที่เป็น `skip` จะถูกบันทึกเป็น successful no-op
- item ที่ baseline เปลี่ยนหลัง preview จะถูก reject เป็น conflict และต้อง preview ใหม่

การเขียนแต่ละรายการอยู่ใน transaction พร้อม serializable retry ตาม helper ของระบบเดิม และสร้าง audit แบบ redacted ใน transaction เดียวกัน การล้มเหลวของรายการหนึ่งต้องไม่ทำให้ระบบเดาข้อมูลแทน หรือเขียน reference ที่ resolve ไม่ได้

## 5. Semantics เฉพาะโมดูล

### Device

`assetCode` และ `serialNumber` เป็น mandatory paired identity หากขาดอย่างใดอย่างหนึ่งให้ quarantine ไม่สร้าง Device ครึ่งรายการ การ update ใช้ canonical identity และไม่สร้างแถวใหม่เพียงเพราะข้อมูล legacy เปลี่ยนรูปแบบการเขียนเล็กน้อย

### WorkOrder / Repair

เก็บ `legacyJobNo` จาก source เพื่อ traceability และใช้ `systemJobNo` ของระบบใหม่แยกต่างหากเมื่อมีการสร้างเลขระบบใหม่ การ link ไปยัง Device ต้อง resolve จาก identity ที่มีอยู่จริง หากไม่พบหรือพบหลายรายการให้ quarantine/fail-closed ไม่เดา link จากข้อความอิสระ

### MeterReading

ใช้ field ใหม่ `readingDate`, `meterBw` และ `pagesBw` โดยเก็บ `siteAtReading` เพื่อ authorization ณ เวลาที่บันทึก Meter เป็น append-only: หาก `readingId` หรือ source identity เดิมมีอยู่แล้ว ห้ามสร้างซ้ำ และห้ามแก้รายการเดิมโดยเงียบ ๆ ส่วนค่า snapshot บนอุปกรณ์ เช่น `lastMeterBw` ต้องปรับผ่าน apply semantics ของระบบใหม่เท่านั้น

### StockItem

ใช้ `productCode` เป็น identity และ `productName` เป็นชื่อสินค้า การ update ต้องมี version baseline จาก preview ถ้าสินค้าถูกแก้โดยผู้ใช้หลัง preview ให้หยุดด้วย conflict แล้ว preview ใหม่

### StockTransaction

Ledger เป็น append-only และ source key ต้อง deterministic รายการเดิมที่ payload เหมือนเดิมเป็น `skip` ส่วน source key เดิมแต่รายละเอียดเปลี่ยนเป็น hard conflict/quarantine ไม่แก้ยอดย้อนหลังโดยอัตโนมัติ `ADJUST` หมายถึงยอดคงเหลือปลายทางแบบ absolute ตาม semantics ของระบบใหม่ ไม่ใช่จำนวน delta ส่วน `OUT` ที่ทำให้ยอดติดลบต้อง reject

การ link transaction ไปยัง WorkOrder ต้องใช้ resolver ที่รองรับ `workOrderId`, `workOrderNo`, `legacyJobNo`, `systemJobNo` และ `requestId` เมื่อ reference ขัดแย้งกันหรือหาไม่พบ ให้แยกเป็น unlinked/quarantined ตามผล resolver ห้ามเดา

## 6. Cutover แบบทีละโมดูล

| ระยะ | เจ้าของการเขียนหลัก | สิ่งที่ทำ | เกณฑ์ผ่าน |
|---|---|---|---|
| A. Observe | แอปเก่า | ดึง legacy เข้า preview อย่างเดียว | counts และ mapping ตรงกับ source; error/quarantine อธิบายได้ |
| B. Shadow apply | ระบบใหม่แบบควบคุม | apply เฉพาะ test/controlled slice | duplicate ไม่เกิด; audit และ reconciliation ตรง |
| C. Module cutover | Next.js | ผู้ใช้เขียนโมดูลนั้นผ่าน API ใหม่ | legacy ถูกตั้งเป็น read-only สำหรับโมดูลนั้น หรือหยุด write ตาม decision |
| D. Stabilize | Next.js | sync เฉพาะรายการค้าง/ประวัติที่อนุมัติ | reconciliation ต่อเนื่องและ rollback plan พร้อม |
| E. Retire | Next.js | ปิด bridge เฉพาะ source/module ที่เลิกใช้งาน | มี signed-off evidence และไม่มี pending conflict |

ลำดับที่แนะนำสำหรับวันนี้คือ **Observe ให้ครบทั้ง 4 โมดูลก่อน**, จากนั้นเลือก 1 โมดูลที่ identity และ site mapping สะอาดที่สุดทำ controlled apply หากยังไม่มีการยืนยันจาก Release Owner/Audit ให้หยุดที่ preview และอย่า apply กับข้อมูล production

## 7. Reconciliation หลัง Apply

หลัง apply ให้เปรียบเทียบอย่างน้อยจำนวนแถว, จำนวน create/update/skip/error, จำนวน quarantine, ยอด StockItem, ยอด StockTransaction แยก IN/OUT/ADJUST, จำนวน MeterReading และจำนวน WorkOrder ที่มี `legacyJobNo` เทียบกับ source snapshot เดียวกัน การตรวจต้องใช้ source cursor/time window เดียวกับ preview และบันทึกผลใน SyncRun/evidence

ความแตกต่างที่ยอมรับได้ต้องมีเหตุผลที่ระบุได้ เช่น source row ไม่มี paired identity, site ไม่อยู่ใน scope, source key ซ้ำ หรือรายการถูกแก้หลัง preview ส่วนความแตกต่างที่ไม่ทราบสาเหตุให้สถานะเป็น blocker ไม่ใช่ปรับยอดด้วยมือ

## 8. CSV fallback และ failure handling

CSV fallback เดิมต้องคงใช้งานได้เสมอในช่วงที่ Apps Script source หรือ network ใช้งานไม่ได้ CSV ที่นำเข้าให้ผ่าน mapping/validation ชุดเดียวกันเท่าที่ทำได้ และต้องเก็บ source file hash หรือ batch identity เพื่อป้องกันการนำไฟล์เดิมเข้าซ้ำ

เมื่อ bridge ล้มเหลวให้ทำตามลำดับนี้: เก็บ SyncRun ที่ failed และ error message, หยุด apply ซ้ำ, ตรวจรายการที่สำเร็จแล้วจาก audit/entityId, แก้ source หรือ mapping, แล้วสร้าง preview ใหม่ ไม่ควร retry ทั้ง batch โดยไม่สร้าง preview ใหม่เมื่อมี conflict หรือ version mismatch

## 9. สิ่งที่ต้องเตรียมจากฝั่ง Release Owner

1. กำหนด source name ที่ใช้งานจริงของแต่ละ Apps Script และตรวจว่า server-side URL/token ถูกตั้งใน secret manager/Vercel environment โดยไม่ส่งค่า secretผ่านแชท
2. ระบุ site codes ที่อนุญาตให้แต่ละผู้ทดสอบเห็น และทำให้ Site allowlist ใน ITAM-DB ครบก่อน preview
3. เตรียม source snapshot หรือ time window ของแต่ละโมดูลสำหรับ reconciliation
4. ยืนยัน owner ของการเขียนในแต่ละโมดูลระหว่าง coexistence เพื่อป้องกัน dual-write
5. จัด test slice ที่ปลอดภัยสำหรับ controlled apply และผู้ตรวจผลจาก Audit
6. ปิดหรือชี้แจง conflict ที่พบก่อนเปิด module cutover

## 10. สถานะ implementation วันนี้

Bridge MVP ถูกสร้างใน PR #52 และ commit ล่าสุดของ branch คือ `36e0192` โดยมี adapter, preview engine, apply service, route dispatch และ regression tests แล้ว ผลตรวจที่บันทึกไว้คือ focused lint ผ่าน, production build ผ่าน และ bridge regression tests ผ่าน ส่วน full sync tests ที่ต้องเชื่อม PostgreSQL ต้องรันใน environment ที่มี database connection ที่ได้รับอนุญาต

การมีโค้ด bridge ไม่ได้แปลว่า G2/G3/Production ถูกเปิดแล้ว สถานะ governance ยังคงต้องผ่าน cross-review, Release Owner และ Audit ตาม gate เดิม โดยเฉพาะการ apply กับข้อมูลจริง

## References

- [PR #52 — ITAM-01 parity integration](https://github.com/nikorn2527-stack/ITAM-NextJS/pull/52)
- `src/lib/legacy-bridge.ts`
- `src/lib/legacy-bridge-preview.ts`
- `src/lib/legacy-bridge-apply.ts`
- `src/app/api/sync/preview/route.ts`
- `src/app/api/sync/run/route.ts`
- `docs/ITAM01-PARITY-INTEGRATION-TEST-EVIDENCE-TH.md`
