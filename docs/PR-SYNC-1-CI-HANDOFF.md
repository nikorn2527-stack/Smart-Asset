# PR-SYNC-1 CI Handoff — สำหรับทีมผู้ดูแล GitHub

## สิ่งที่ต้องทำ (เรียงลำดับ)

### 1. Generate package-lock.json

```bash
cd ITAM-NextJS
git checkout feature/pr-sync-1-implementation
npm install --legacy-peer-deps
# ตรวจสอบว่า package-lock.json ถูกสร้างแล้ว
ls -la package-lock.json
git add package-lock.json
git commit -m "chore: add package-lock.json for CI reproducibility"
git push
```

### 2. Copy workflow ไป .github/workflows/

```bash
cp docs/pr-sync-1-tests-workflow.yml .github/workflows/pr-sync-1-tests.yml
git add .github/workflows/pr-sync-1-tests.yml
git commit -m "ci: activate PR-SYNC-1 sync tests workflow"
git push
```

### 3. Trigger CI

Workflow จะ trigger อัตโนมัติเมื่อ push ไป branch `feature/pr-sync-1-implementation`
หรือ trigger manual ผ่าน Actions tab → "PR-SYNC-1 Sync Tests" → Run workflow

### 4. ตรวจสอบผล CI

ตรวจว่า run ผ่าน gate ทั้งหมด:
- [ ] Migration (`prisma migrate deploy`) สำเร็จ
- [ ] Seed (`prisma/seed.ts`) สำเร็จ
- [ ] TypeScript (`tsc --noEmit`) ไม่มี error
- [ ] ESLint ไม่มี error
- [ ] Vitest sync tests ผ่านหมด (it.todo() = 0 หรือ documented exclusion)
- [ ] B4 regression ผ่าน (auth 88 + integration 33 + concurrency 27)
- [ ] B4 frozen files 0 diff

### 5. เก็บ evidence

- Full commit SHA ที่ CI run
- CI run URL (จาก Actions tab)
- Logs: migration, seed, tsc, eslint, vitest, B4
- Artifact + SHA-256 checksum
- ยืนยัน it.todo() count

### 6. ส่งให้ทีม Audit

ส่งข้อมูลดังกล่าวให้ทีม Audit ตรวจอีกครั้ง

---

## ข้อมูลสำคัญ

- **Branch:** `feature/pr-sync-1-implementation`
- **Latest commit:** `7421902` (หรือ commit ล่าสุดหลังเพิ่ม lockfile)
- **Workflow file:** `docs/pr-sync-1-tests-workflow.yml` → copy ไป `.github/workflows/pr-sync-1-tests.yml`
- **Database:** PostgreSQL 16.x (workflow ใช้ postgres:16 service container)
- **Node.js:** 22

## หมายเหตุ

- Workflow ใช้ `npm ci --legacy-peer-deps` — ต้องมี `package-lock.json` ก่อน
- `prisma/seed.ts` ใช้ field `siteCode` (แก้แล้วจาก `site`)
- 18 `it.todo()` tests ต้อง PostgreSQL fixture — ถ้ายังเป็น TODO ต้อง documented exclusion
- B4 frozen files 6 ไฟล์ต้อง 0 diff จาก `ee75164`
