# ITAM-01 Parity Integration Manifest

**Owner:** ITAM-01 — Dev-1 / Repair  
**Branch:** `feature/itam01-parity-integration-2026-08-22`  
**Base:** `97a43745e5dfe9fc805318e2fb41544d4aa8647a` (`feature/itam-next-direction-repair-workflow`)  
**Purpose:** รวมความสามารถที่มีการพัฒนาไว้แล้วเข้ากับระบบหลัก เพื่อทดสอบ parity ของ Repair, Stock, Devices และ Meter ก่อนเปิดงาน enhancement รอบใหม่

## หลักการรวม

การรวมจะทำบน branch ใหม่เท่านั้น ไม่ push แก้ main หรือ REVIEW-FROZEN PR โดยตรง โดยใช้ dependency order ตาม base branch ของแต่ละ PR และบันทึกผลทุกครั้งว่ารวมสำเร็จ, ต้องแก้ conflict, หรือคัดออกด้วยเหตุผลใด

การใช้ commit จาก PR ที่ยังไม่ผ่าน Audit ถือเป็น **integration candidate สำหรับการทดสอบ** ไม่ใช่การอนุมัติ release และไม่เปลี่ยนสถานะ G2/G3/Production gate

## Code integration candidates

| ลำดับ | PR | ขอบเขต | เหตุผลที่รวม |
|---:|---:|---|---|
| 1 | #18 | CSV import gaps | รักษา fallback และแก้ query/import defect; ต้อง cherry-pick เฉพาะ code commit ไม่เอา evidence ที่ทำให้ baseline ย้อนกลับ |
| 2 | #27 | Services → Repair adapter | ทำให้ source work order เข้า pipeline ของ Repair |
| 3 | #28 | Stock issue adapter | ทำให้ข้อมูลเบิกถูก normalize และผูก identity กับ session |
| 4 | #29 | Devices import boundary | เพิ่ม parser/validator/persistence และ mixed-case lookup |
| 5 | #30 | Meter reading contract | เพิ่ม validation boundary ของค่า meter |
| 6 | #31 | Meter API boundary | บังคับ validation ที่ route โดยต่อจาก #30 |
| 7 | #36 | Repair completion guard | ต่อจาก #27 และ harden completion boundary |
| 8 | #37 | Stock transaction validation | ต่อจาก #28 และตรวจ input transaction |
| 9 | #38 | Devices transfer contract | ต่อจาก #29 และแก้ schema alignment |
| 10 | #39 | Meter persistence safety | ต่อจาก #31 และป้องกัน stale monthly reading |
| 11 | #35 | Devices fixtures/DoD | ต่อจาก #29; รวม fixture และแก้ provenance ของ DoD |
| 12 | #41 | Devices bounded list | ต่อจาก #29; จำกัด query และ field exposure |
| 13 | #42 | Repair manual sync shell | ต่อจาก #27; รวมเฉพาะ preview shell ที่ทดสอบ no-write ได้ |
| 14 | #43 | Stock CSV fallback evidence | ต่อจาก #28; คง fail-closed resolution |
| 15 | #44 | Meter history/reminder performance | ต่อจาก #30; ต้องตรวจ race/idempotency ก่อนยอมรับ |
| 16 | #45 | Devices importer/transfer integration | ต่อจาก #29; รวม integration scenarios |
| 17 | #46 | Devices ↔ Meter contract tests | ต่อจาก #29; รวม cross-module scenarios |
| 18 | #47 | Devices lifecycle contract | ต่อจาก #29; รวม status/warranty/depreciation contract |
| 19 | #48 | Devices audit history | ต่อจาก #29; ต้องรักษา redaction และไม่คืน raw logs |
| 20 | #49 | Devices import error report | ต่อจาก #29; รวม classification/redaction/CSV report |
| 21 | #50 | Devices export contract | ต่อจาก #29; bounded export และ field-level policy |
| 22 | #51 | Devices search/filter contract | ต่อจาก #29; query/index และ site scope ต้องตรวจร่วมกับ authorization |

## Selective / excluded candidates

PR #1 เป็น deployment preparation ที่อาจมี code ที่ยังจำเป็น แต่ต้อง cherry-pick แบบ selective หลังตรวจ diff กับ baseline เนื่องจาก branch แยกจากสายปัจจุบัน ส่วน PR #6 และ #16 เป็น release/evidence branches ที่มีเอกสารและการเปลี่ยนแปลงย้อนกลับหลายส่วน จึงไม่รวมทั้ง branch ใน parity batch; จะดึงเฉพาะ code ที่พิสูจน์แล้วว่าขาดจริงเท่านั้น

PR #32–#34 และ #40 เป็น governance/documentation/CI changes ไม่ใช่ business workflow implementation จึงไม่รวมใน code parity batch นี้ เว้นแต่จำเป็นต่อการรัน test หรือ evidence และจะบันทึกแยกเป็น governance update

## Acceptance หลังรวม

ต้องผ่านอย่างน้อย: production build, typecheck ของ `src`, lint ของ `src` ตามเกณฑ์ที่กำหนด, targeted tests ของแต่ละ candidate, read/write workflow replay ของทั้ง 4 โมดูล, no-write preview, authorization/site scope, audit/redaction, retry/idempotency และ CSV fallback

ห้ามแตะ B4 frozen files 6 ไฟล์, ห้ามใช้ `prisma db:push`, ห้ามเพิ่ม `SYNC_RUN` โดยไม่มี Audit review และต้องเก็บ `legacy_job_no` แบบ immutable ตาม data contract

## References

1. [ITAM-NextJS repository](https://github.com/nikorn2527-stack/ITAM-NextJS)
2. [PR #27](https://github.com/nikorn2527-stack/ITAM-NextJS/pull/27) ถึง [PR #51](https://github.com/nikorn2527-stack/ITAM-NextJS/pull/51)
3. [PR #18](https://github.com/nikorn2527-stack/ITAM-NextJS/pull/18)
