# PR-SYNC-1 Staging/Canary Deployment Runbook

**สถานะเอกสาร:** Prepared for post-merge staging/canary; ยังไม่ใช่ production deployment approval  
**Release target:** `main` @ `86db0b126c35a2ba1545e680437028d221de1996`  
**Merge commit:** `dfb5e3fc3b496f14036c221a3c662f4a2dc49569`  
**Evidence commit:** `df87bf256e21830892c50b55a14489a5242c8f1c`  
**ผู้จัดทำ:** Manus AI  
**วันที่:** 16 สิงหาคม 2026

## 1. วัตถุประสงค์และขอบเขต

เอกสารนี้กำหนดวิธีนำ PR-SYNC-1 ไปทดสอบใน staging/canary หลัง merge โดยแยกฐานข้อมูล, credentials, URL และกลุ่มผู้ใช้ออกจาก production อย่างชัดเจน การผ่าน CI และการ merge ยืนยันคุณภาพระดับ implementation แล้ว แต่ยังไม่ใช่ unconditional production approval เพราะ final audit กำหนดให้ต้องมี staging/canary, monitoring และ CSV fallback ต่อเนื่องอย่างน้อยสองสัปดาห์ก่อนตัดสินใจขยาย rollout [1]

Runbook นี้ครอบคลุมเฉพาะ `services → work-order` ใน MVP และไม่อนุญาตให้เพิ่ม `SYNC_RUN` permission รูปแบบ authorization ต้องคง `requireAuth(req, 'ADMIN')` ร่วมกับ server-side `ctx.canAtSite(siteCode, 'ADMIN')` ต่อ item ตาม contract ที่ผ่าน Audit แล้ว [1] ห้ามแก้ไขไฟล์ B4 frozen ทั้งหกไฟล์โดยไม่มี explicit freeze exception และ Audit review ใหม่

> **Operational rule:** ระหว่าง staging/canary ให้ถือว่า Sync เป็นช่องทางเสริมที่ยังต้องมี CSV upload เป็น fallback เสมอ ห้ามลบ ปิดซ่อน หรือเปลี่ยนพฤติกรรม CSV จนกว่าจะครบ stability window อย่างน้อย 14 วันและมี production go/no-go ที่บันทึกเป็นลายลักษณ์อักษร

## 2. ทางเลือกสำหรับ staging environment

Vercel มี Preview environment สำหรับ deploy branch ที่ไม่ใช่ production branch และมี Custom Environment เช่น `staging` สำหรับ workflow ที่ต้องการ URL และ environment variables แยกถาวร โดย Custom Environment ต้องตรวจสอบสิทธิ์ของ Vercel plan ก่อนใช้งาน [2]

| แนวทาง | Tradeoffs | Cost | Setup complexity |
|---|---|---|---|
| **Preview deployment จาก dedicated canary branch** (แนะนำเป็น baseline) | เริ่มได้โดยไม่เปลี่ยน production project; URL เป็น preview และต้องควบคุม access; เหมาะกับการทดสอบรอบแรก | ไม่เพิ่มค่า environment จากตัว Vercel โดยตรง; ยังขึ้นกับ plan/usage ที่มีอยู่ | ต่ำถึงปานกลาง |
| **Custom Environment ชื่อ `staging`** | มี URL และ variables แยกชัดเจน, branch tracking และ operator workflow สม่ำเสมอ; ต้องตรวจว่า plan รองรับและต้องจัดการ domain/access เพิ่ม | ขึ้นกับ Vercel plan; Custom Environments มีข้อจำกัดตาม plan [2] | ปานกลาง |
| **แยก Vercel project สำหรับ staging** | isolation สูงสุดจาก production project; เหมาะเมื่อ production project มี setting หรือ domain ที่เสี่ยงปะปน; ต้องดูแล project settings ซ้ำ | ขึ้นกับ plan/usage และ resource ที่เพิ่ม | ปานกลางถึงสูง |

ในรอบนี้ให้เริ่มจาก Preview หรือ Custom Environment โดย deploy จาก commit หลัง merge และใช้ฐานข้อมูล staging แยกต่างหากก่อน หากต้องการใช้ URL คงที่สำหรับ monitoring ให้เลือก Custom Environment หรือ staging project; อย่าใช้ production domain และอย่าใช้ production `DATABASE_URL` แม้เพียงชั่วคราว

## 3. Environment configuration

สร้าง variables ใน Vercel environment ที่ใช้ staging เท่านั้น ค่าจริงต้องใส่ผ่าน Vercel Project Settings หรือ secret manager ที่องค์กรอนุมัติ ห้าม commit ค่า token, password, JWT secret หรือ Apps Script credential ลง repository โดยเด็ดขาด Vercel ระบุว่า environment variables มีผลกับ deployment ใหม่เท่านั้น ดังนั้นหลังเพิ่มหรือหมุน secret ต้อง redeploy staging เสมอ [3]

| Variable | Staging value/policy | Required | Security note |
|---|---|---:|---|
| `DATABASE_URL` | PostgreSQL **staging database** ที่แยกจาก production; ใช้ SSL ตาม policy ของ provider | Yes | ห้ามชี้ production DB; ใช้ least-privilege application role |
| `JWT_SECRET` | ค่า random ใหม่และไม่ซ้ำ production | Yes | ห้าม reuse secret ข้าม environment |
| `CRON_SECRET` | ค่า random ใหม่สำหรับ cron ที่เปิดใช้งาน | ตาม cron | ห้ามนำ production value มาใช้ |
| `NEXTAUTH_SECRET` | ค่า random ใหม่ หาก NextAuth integration เปิดใช้งาน | Conditional | ห้าม reuse `JWT_SECRET` โดยไม่จำเป็น |
| `APPS_SCRIPT_SERVICES_URL` | URL ของ Apps Script staging/test endpoint หรือ endpoint ที่จำกัดข้อมูล canary | Yes สำหรับ `services` | ต้องไม่ส่งข้อมูล production เกิน scope ที่อนุมัติ |
| `APPS_SCRIPT_SERVICES_TOKEN` | token ของ staging/test endpoint | Yes สำหรับ `services` | Server-side only; ห้าม prefix ด้วย `NEXT_PUBLIC_` |
| `APPS_SCRIPT_ITAM_URL` / `APPS_SCRIPT_ITAM_TOKEN` | เว้นว่างจนกว่าจะเปิด source นี้ใน scope ที่อนุมัติ | No for MVP | ห้ามใส่ credential จริงโดยไม่มี test plan |
| `APPS_SCRIPT_STOCK_URL` / `APPS_SCRIPT_STOCK_TOKEN` | เว้นว่างจนกว่าจะเปิด source นี้ใน scope ที่อนุมัติ | No for MVP | ห้ามเปิด source นอก canary scope |
| `SYNC_SOURCE_TIMEOUT_MS` | `30000` เป็นค่าเริ่มต้น | No | ปรับได้หลังมี latency baseline |
| `SYNC_SOURCE_MAX_RETRIES` | `3` เป็นค่าเริ่มต้น | No | ใช้ติดตาม retry และ P2034 ไม่ใช่เพิ่มจนกลบ incident |
| `SYNC_PREVIEW_MAX_ROWS` | `1000` เป็น hard ceiling ของ preview | No | Canary ควรใช้ limit ต่ำกว่านี้เมื่อทดสอบครั้งแรก |

ไฟล์ template ที่แนบคู่กับ runbook คือ `.env.staging.example` ซึ่งมีเพียงชื่อ variable และ placeholder ไม่มี secret จริง การ deploy ต้องตรวจให้ครบว่า `DATABASE_URL`, `JWT_SECRET` และ Apps Script credentials เป็นค่าของ staging จริง ไม่ใช่ค่า placeholder

## 4. Database migration และ build preflight

ก่อน deploy ให้ provision PostgreSQL staging ใหม่หรือใช้ database ที่ reset ได้ พร้อมทำ backup/snapshot ตาม policy ของผู้ดูแลฐานข้อมูล จากนั้นใช้ **เฉพาะ** `npx prisma migrate deploy` เพื่อ apply migration ที่ commit แล้ว ห้ามใช้ `prisma db push` ใน staging release workflow เพราะจะทำให้ schema drift และ evidence ผูกกับ migration history ได้ยาก [1]

ให้ตรวจคำสั่ง install ให้ตรงกับ deployment target ปัจจุบัน repository มีทั้ง `package-lock.json` และ `bun.lock`; CI evidence ใช้ `npm ci --legacy-peer-deps` ขณะที่ `vercel.json` กำหนด `bun install` เป็น `installCommand` [1] ประเด็นนี้ไม่ใช่เหตุให้ข้าม staging แต่เป็น **MEDIUM preflight finding** ที่ต้องบันทึกใน deployment evidence ดังนี้:

1. หากคง `bun install` ให้บันทึก Bun version, lockfile ที่ใช้ และ build log ของ staging ให้ครบ
2. หากต้องการ parity กับ CI ให้เปิด change แยกเพื่อปรับ install command เป็น `npm ci --legacy-peer-deps` แล้วให้ทีม Audit review config diff ก่อนใช้กับ production
3. ห้ามแก้ `vercel.json` เงียบ ๆ ในขั้นตอน deploy เพราะอาจทำให้ production build behavior เปลี่ยนโดยไม่มี evidence

ก่อนอนุมัติ staging ให้ยืนยันรายการต่อไปนี้: `prisma migrate deploy` ผ่าน, `prisma migrate status` ไม่มี pending migration, build ผ่าน, application boot ได้, `/api/health/authz` ตอบ `status: pass`, และไม่มี B4 frozen file diff จาก baseline `ee75164`

## 5. Site และ user scope ของ canary

Canary ต้องเริ่มจาก site เดียวหรือกลุ่ม site ที่ระบุชื่อได้ และผู้ใช้ ADMIN ที่ได้รับ site grant เฉพาะ scope นั้น การจำกัด scope ต้องทำผ่าน existing authorization context และ `options.siteFilter`/`siteScope`; ไม่ควรเพิ่ม environment bypass หรือ special role ใหม่เพียงเพื่อให้ canary ทำงาน

| Control | Canary policy | Stop condition |
|---|---|---|
| Database | staging DB เท่านั้น | พบ connection ไป production หรือมีข้อมูล production ปะปนโดยไม่มี approval |
| Source | `services` เท่านั้นใน MVP | มีการเรียก `itam`/`stock` โดยไม่มี test plan |
| Target | `work-order` เท่านั้น | มี target อื่นนอก approved scope |
| Site | 1 canary site ก่อน แล้วค่อยขยาย | มี item `UNKNOWN_SITE`, `MISSING_SITE` หรือ `OUT_OF_SCOPE` ที่ไม่ทราบสาเหตุ |
| User | ADMIN ที่มี site grant เฉพาะ canary site | ผู้ใช้เห็นหรือ apply ข้าม site ได้ |
| Permission | `ADMIN` + `canAtSite()` | พบ `SYNC_RUN` หรือ route bypass per-item authorization |
| CSV | เปิดใช้งานและทดสอบได้ | CSV fallback ใช้งานไม่ได้หรือ audit trail ขาด |

## 6. Deployment procedure

### Phase A — Prepare and record

สร้าง deployment record ที่ระบุ commit SHA, Vercel deployment URL, environment name, database identifier แบบ redacted, migration result, operator, canary site, canary user และเวลาที่เริ่ม stability window ใช้ commit หลัง merge ที่ตรวจสอบ ancestry แล้ว ไม่ deploy branch เก่าก่อน `dfb5e3f` และไม่ใช้ preview ที่ไม่สามารถระบุ SHA ได้

ใน Vercel ให้เลือก Preview deployment จาก branch ที่ไม่ใช่ production branch หรือ Custom Environment `staging` หาก plan รองรับ [2] ตั้ง access control ให้เฉพาะทีมพัฒนา, Audit และ operator ที่ได้รับอนุญาตเท่านั้น การ deploy branch/preview ไม่ควรใช้ `--prod`; การ merge `main` หรือคำสั่ง production deployment สามารถชี้ production domain ได้ จึงห้ามใช้ในขั้นตอนนี้ [2]

### Phase B — Apply migration and smoke test

หลัง build สำเร็จ ให้ run migration ตาม Section 4 แล้วทำ smoke test ตามลำดับที่ระบุด้านล่าง ทุกขั้นต้องเก็บ timestamp และผลลัพธ์ไว้ใน deployment evidence ไม่ใส่ JWT, cookie, Apps Script token หรือข้อมูล PII ลง log ที่แนบมา

| Test | Expected result | Gate |
|---|---|---|
| Open staging URL | Application boot และ login ได้ | Required |
| `GET /api/health/authz` ด้วย operator ที่มี `SYSTEM_CONFIG` | HTTP 200 และ `status: "pass"`; HTTP 503 = stop | Required |
| Preview `source=services`, `target=work-order`, `siteFilter=<canary>` | `mode=preview`, `status=completed`, ไม่มี business-table write | Required |
| ตรวจจำนวน WorkOrder ก่อน/หลัง preview | ไม่เพิ่ม ไม่แก้ และไม่ลบ | Required |
| Apply เฉพาะ approved item | สร้าง/แก้เฉพาะ item ใน canary scope และมี `SYNC_APPLY` audit | Required |
| Preview ซ้ำหลัง apply | รายการเดิมกลายเป็น `skip` หรือ diff ที่อธิบายได้; ไม่มี duplicate `requestId` | Required |
| ทดสอบ conflict ใน staging | item เป็น `error` ด้วย `CONFLICT:` และต้อง re-preview; ห้าม silent overwrite | Required |
| ทดสอบ retry | เกิด retry run ที่มี `retryOf`, `attempts`, `p2034Count` และ error ที่แก้ไม่ได้ถูกคงเป็น error | Required |
| Negative authorization | user นอก site ได้ HTTP 403 และไม่เกิด WorkOrder mutation | Required |
| CSV fallback | upload, validation, import และ audit trail ยังทำงานได้ | Required |

### Phase C — Canary operation

รอบแรกให้ operator ทำ Preview ก่อนทุกครั้ง อ่าน `createRows`, `updateRows`, `skipRows`, `errorRows`, `unmappedColumns` และรายการ error แล้วจึงเลือก item ที่อนุมัติให้ Apply การกด Apply ทั้ง run โดยไม่ตรวจ preview เป็นสิ่งต้องห้ามใน stability window แรก

ให้ขยาย scope แบบ step-up: เริ่มหนึ่ง siteและผู้ใช้หนึ่งกลุ่ม, ต่อด้วยหลาย siteที่มีข้อมูลต่ำ, แล้วจึงพิจารณาขยาย การขยายแต่ละขั้นต้องมีผล monitoring อย่างน้อยหนึ่งรอบ, ไม่มี critical alert, และมีผู้ตรวจคนที่สองรับรอง หากพบ conflict, unknown site, audit gap หรือ authorization anomaly ให้หยุดการขยายทันทีและเปิด incident record

## 7. Rollback และ fallback procedure

การ rollback ของ application ต้องหยุดการเรียก Preview/Apply ก่อน แล้วเก็บ SyncRun, SyncRunItem, AuditLog และ Vercel deployment metadata ไว้สำหรับ forensic review ห้ามลบข้อมูลเพื่อทำให้ dashboard กลับมาเขียว การกลับไปใช้ CSV ต้องเป็นการปฏิบัติงานตามขั้นตอนเดิมที่ผ่านการทดสอบ และต้องบันทึกว่ารายการใดถูกนำเข้าผ่าน CSV เพื่อป้องกัน duplicate กับข้อมูลที่ Sync ทำสำเร็จแล้ว

สำหรับ staging ให้ redeploy หรือ promote deployment ล่าสุดที่ทราบว่าทำงานได้ใน environment เดิม โดยตรวจ environment variables และ migration state ทุกครั้ง การ rollback binary ไม่ได้ rollback database schema หรือข้อมูล หาก migration มีปัญหาให้หยุด traffic และใช้ forward-fix ที่ผ่าน review แทนการเดา down migration

หากมี production incident ในอนาคต Vercel มี `vercel rollback` สำหรับย้อน production deployment และมี `vercel promote` เพื่อออกจาก rollback state [4] อย่างไรก็ตาม Vercel ระบุว่า rollback อาจทำให้ configuration เก่ากลับมา, ไม่ย้อน environment variables ที่เปลี่ยนภายหลัง และ cron อาจย้อนตาม deployment จึงต้องตรวจ variables, database compatibility และ cron behavior หลัง rollback ทุกครั้ง [4]

> **Emergency stop:** ปิดการเรียก Sync ที่ระดับ operator/access หรือถอน canary site grantก่อน ห้ามแก้ B4 frozen authorization files เพื่อแก้เหตุเฉพาะหน้า การแก้ frozen contract ต้องเป็น freeze exception และ Audit review ใหม่

## 8. Production go/no-go gate

Production ยังไม่สามารถอนุมัติจาก CI หรือจาก smoke test เพียงครั้งเดียว ต้องครบ stability window อย่างน้อย 14 วันนับจาก canary apply ครั้งแรก โดยมี monitoring evidence ต่อเนื่องและมี CSV fallback ที่ผ่าน periodic check

| Gate | Required evidence | Decision rule |
|---|---|---|
| Stability window | Daily/each-run monitoring record ครบ 14 วัน | ขาดข้อมูลสำคัญให้เริ่มนับใหม่หรือ mark as incomplete |
| Conflict | Conflict count/rate และ incident disposition | ไม่มี unresolved critical conflict; threshold ตาม monitoring spec |
| Quarantine | Error classification โดยเฉพาะ site mapping/scope | ไม่มี unknown/out-of-scope ที่ไม่ทราบสาเหตุ |
| Retry/P2034 | `attempts`, `p2034Count`, retry chain | ไม่มี retry storm หรือ P2034 ที่ยังไม่อธิบาย |
| Authorization | 401/403 event หรือ request log ที่คำนวณ rate ได้ | ไม่พบ cross-site access หรือ permission bypass |
| Audit completeness | Applied item ต่อ `SYNC_APPLY` audit เท่ากัน | ต้อง 100% สำหรับ applied item |
| CSV fallback | ผลทดสอบตามรอบและ rollback rehearsal | ต้องผ่านและยังใช้งานได้ |
| B4 freeze | diff check จาก `ee75164` | ต้องเป็น 0 diff |
| MVP permission | source/config/code scan | ต้องไม่พบ `SYNC_RUN` permission |

Final decision ต้องลงชื่อโดย owner/operations และ Audit หรือผู้มีอำนาจแทน พร้อมแนบ deployment SHA, monitoring export, CSV test record, rollback rehearsal และ exception list หากมี ห้ามเปลี่ยนสถานะเป็น `GO for Production` โดยอาศัยผลจาก implementation CI เพียงอย่างเดียว

## 9. Required evidence package

เก็บ evidence ในโฟลเดอร์หรือ issue เดียวกันโดยมี `deployment-record.md`, sanitized build/migration logs, smoke-test results, monitoring snapshot รายวัน, CSV fallback results, rollback rehearsal record และผล pre-deploy check ไฟล์ทุกชิ้นต้องระบุ commit SHA และ timestamp เดียวกันกับ deployment ที่ตรวจ

## References

[1]: https://github.com/nikorn2527-stack/ITAM-NextJS/blob/main/docs/PR-SYNC-1-FINAL-AUDIT-REVIEW.md "PR-SYNC-1 final audit review and operational conditions"

[2]: https://vercel.com/docs/deployments/environments "Vercel Environments: Local, Preview, Production, and Custom Environments"

[3]: https://vercel.com/docs/environment-variables "Vercel Environment Variables"

[4]: https://vercel.com/docs/instant-rollback "Vercel Instant Rollback"

[5]: https://github.com/nikorn2527-stack/ITAM-NextJS/blob/main/vercel.json "Repository Vercel configuration"

[6]: https://github.com/nikorn2527-stack/ITAM-NextJS/blob/main/.env.example "Repository environment variable template"
