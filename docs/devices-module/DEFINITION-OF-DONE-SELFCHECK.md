# Devices Module — Definition of Done Self-Check

**Module:** Devices (Dev-3 / Asset & Meter Team)
**Work Package:** C — Device importer boundary
**Status:** Ready for Audit (pending cross-review verdict)
**Date:** 2026-08-21
**Exact heads:**
- PR #29: `b9a097d37f3c23fea6dd5713678184420d0424d3_29`
- PR #35: see PR head SHA on GitHub (auto-tracked)

## Purpose

This document is the Dev-3 self-check against the Definition of Done
(DoD) defined in `docs/modules/devices/README.md`. It is prepared as
parallel work while PR #29 + #35 await cross-review verdict. When
cross-review PASS, this document will be submitted to Audit as part
of the technical package.

## DoD criteria (from module README)

### 1. Import is idempotent by assetCode ✅

- `Device.assetCode` has `@unique` constraint in prisma/schema.prisma (verified)
- Validator pre-deduplicates within file (DUPLICATE_SOURCE_KEY quarantine)
- `findExistingAssetCodes` returns Set for O(1) lookup
- `createMany` with `skipDuplicates=false` (validator pre-dedup, not DB skip)
- Mode-aware retry: `create_only` skips existing, `upsert` updates, `update_only` skips new

Evidence: `tests/device-import-persistence.test.ts` — 10 tests covering all modes + retry scenarios

### 2. Duplicate (in file + DB) and missing key are separated clearly ✅

- `DUPLICATE_IN_FILE` errors: reported in `validationResult.errors` + `duplicateInFile` list
- `DUPLICATE_IN_DB` errors: reported in `persistResult.duplicateInDb` list
- `MISSING_REQUIRED_FIELD` errors: per-field (assetCode, name, brand, model, type)
- Each error includes: `row`, `field`, `message`, `value` (when applicable)

Evidence: `tests/device-import-contract.test.ts` — 5 tests covering missing assetNo, duplicate, invalid meterRequired

### 3. Ownership policy: persistence takes only validated rows ✅

- HTTP route calls `parseDeviceImportCsv` (pure) → `validateDeviceImportRows` (pure) → `persistDevices` (DB)
- `persistDevices` accepts `ValidatedDeviceRow[]` — type signature enforces validation
- Route does NOT call Prisma directly (only via persistence layer)

Evidence: `src/app/api/itam/devices/import/route.ts` — orchestration only, no direct DB calls

### 4. Parser/validator are pure functions testable without DB ✅

- `parseDeviceImportCsv` — no DB imports, no I/O
- `validateDeviceImportRows` — no DB imports, no I/O
- Tests run with mocked Prisma (`vi.mock`) — no DB connection required
- All 49 tests pass without `DATABASE_URL` env var

Evidence: `tests/device-import-contract.test.ts` + `tests/device-import-persistence.test.ts` + `tests/devices-import-fixtures/fixtures.test.ts`

### 5. Persistence accepts only validated rows ✅

- `persistDevices(validatedRows: ValidatedDeviceRow[], ...)` — type enforces
- No `unknown` or `any` in persistence function signature
- Validator output type matches persistence input type

Evidence: `src/lib/device-import-persistence.ts` — type-safe signature

### 6. Error reporting identifies row + reason ✅

- `DeviceRowError` type: `{ row: number; field: string; message: string; value?: string | null }`
- All errors include row number + field name + Thai message
- Errors aggregated across validation + persistence layers in route response

Evidence: `src/lib/device-import-contract.ts` — `DeviceImportError` type

### 7. Import batch has upper bound (5000 rows) ✅

- `MAX_IMPORT_ROWS = 5000` constant in `src/app/api/itam/devices/import/route.ts`
- Route returns HTTP 413 if exceeded
- Parser also enforces limit (drops overflow, reports error)

Evidence: route returns 413, parser returns count error

### 8. Audit summary does not leak sensitive data ✅

- Single AuditLog entry per import (not per-row)
- Audit includes: mode, totalRows, validRows, inserted, updated, skipped, errorCount, duplicateInFile, duplicateInDb, maxImportRows
- Audit does NOT include: row-level data, asset values, user PII beyond actor identity
- No secret values (passwords, tokens, DATABASE_URL) in any audit field

Evidence: `src/app/api/itam/devices/import/route.ts` — logAudit call

### 9. Repair and Meter can still resolve identity (assetCode canonical) ✅

- `Device.assetCode` is the canonical key (unchanged)
- Repair reads `deviceId` (Prisma relation) — unaffected
- Meter reads `deviceId` (Prisma relation) — unaffected
- No schema changes in PR #29 or PR #35

Evidence: `git diff` shows no Prisma schema changes

### 10. Site scope enforced per row ✅

- Route uses `buildAuthorizationContext` (B4 frozen) for site scope
- Per-row site check BEFORE any DB query (prevents timing leak)
- Out-of-scope sites → HTTP 403 with list of denied rows
- Superadmin bypasses site scope check

Evidence: `src/app/api/itam/devices/import/route.ts` — siteErrors check

## Additional criteria (from Work Package C brief)

### 11. Parser/validator/persistence separation ✅

- Parser: `src/lib/device-import-contract.ts` (parseDeviceImportCsv)
- Validator: `src/lib/device-import-contract.ts` (validateDeviceImportRows)
- Persistence: `src/lib/device-import-persistence.ts` (persistDevices)
- Route: orchestration only

### 12. Error specifies row + reason ✅

(covered by criterion 6)

### 13. Import batch has upper bound ✅

(covered by criterion 7)

### 14. Audit summary does not leak sensitive data ✅

(covered by criterion 8)

### 15. B4/auth contract unchanged ✅

- B4 frozen files: 0-diff verified (all 6 files)
- No new permissions added
- No SYNC_RUN permission added
- No auth-middleware changes

## Test evidence summary

```
✓ tests/device-import-contract.test.ts (5 tests) 6ms
✓ tests/device-import-persistence.test.ts (10 tests) 10ms
✓ tests/devices-import-fixtures/fixtures.test.ts (34 tests) 8ms

Test Files 3 passed (3)
Tests 49 passed (49)
Duration 775ms
```

## Governance constraints

| Rule | Status |
|---|---|
| B4 frozen files (6) | ✅ 0-diff verified |
| SYNC_RUN permission | ✅ NOT added |
| prisma db:push | ✅ NOT used |
| Schema/migration | ✅ NOT changed |
| Source CSV contract | ✅ preserved (legacy + Thai headers) |
| Secret values | ✅ none in evidence |
| Production deployment | ✅ not authorized |
| PR #18 release merge | ✅ not authorized |

## Out of scope (separate workstreams)

- Transfer from/to site + actor check (`devices/[id]/transfer/route.ts`)
- Lifecycle transition authorization
- Mobile list/detail UI implementation
- Direct sync adapter (Preview/no-write) — Work Package A territory

## Sign-off

- [x] Dev-3 self-check complete (this document)
- [ ] Cross-review verdict (Dev-4 / Meter primary, Dev-1 / Repair backup)
- [ ] Audit technical review (pending cross-review PASS)
- [ ] Release Owner operational evidence (Issue #14 four items)

## References

- PR #29: https://github.com/nikorn2527-stack/ITAM-NextJS/pull/29
- PR #35: https://github.com/nikorn2527-stack/ITAM-NextJS/pull/35
- Module brief: docs/modules/devices/README.md
- Work packages: docs/MODULAR-NEXT-WORK-PACKAGES-TH.md
- Cross-review matrix: docs/MODULAR-CROSS-REVIEW-MATRIX-TH.md
- Importer acceptance plan: docs/devices-module/IMPORTER-ACCEPTANCE-PLAN.md
- Mobile checklist: docs/devices-module/MOBILE-RESPONSIVE-CHECKLIST.md
