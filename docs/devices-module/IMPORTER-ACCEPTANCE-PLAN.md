# Devices Module — Importer UI / Persistence Boundary Acceptance Plan

**Module:** Devices (Dev-3 / Asset & Meter Team)
**Work Package:** C — parallel preparation (per Acceleration Sprint order)
**Status:** Draft for cross-review
**Date:** 2026-08-21

## Purpose

This document defines the acceptance plan for the Devices importer UI and
persistence boundary. It is produced as parallel work while PR #29 + #35
await cross-review verdict. It does NOT change code — it prepares the
acceptance criteria that Audit and Release Owner will use to verify the
importer is production-ready.

## Scope

In scope:
- UI acceptance criteria for the device import flow
- Persistence boundary acceptance criteria (DB-only layer)
- Error reporting + audit summary acceptance
- Idempotency / retry acceptance

Out of scope:
- Code changes (separate PR if needed)
- Mobile UI implementation (separate workstream per module brief)
- Schema/migration changes (none planned)
- B4 frozen file changes (none planned)

## 1. UI acceptance criteria

### 1.1 File upload

- [ ] UI accepts CSV file via drag-drop OR file picker
- [ ] UI rejects non-CSV files with clear error message
- [ ] UI shows file size + row count preview before import
- [ ] UI enforces client-side MAX_IMPORT_ROWS = 5000 limit
- [ ] UI shows "Too many rows" error if file exceeds limit (does NOT auto-truncate)

### 1.2 Mode selection

- [ ] UI exposes 3 import modes: `upsert`, `create_only`, `update_only`
- [ ] UI explains each mode in plain Thai (ไม่ใช่แค่ชื่อ mode)
- [ ] UI defaults to `upsert` (most common use case)
- [ ] UI warns user when `create_only` selected + file contains existing assetCodes (preview only)

### 1.3 Preview / dry-run

- [ ] UI shows preview of first 10 rows (parsed + normalized, NOT validated yet)
- [ ] UI shows count of "ready" vs "quarantine" rows after validation
- [ ] UI shows list of duplicate-in-file assetCodes (if any)
- [ ] UI shows list of duplicate-in-DB assetCodes (if any, mode-aware)
- [ ] UI does NOT show full row data for out-of-scope Sites (site scope enforced server-side)

### 1.4 Import execution

- [ ] UI shows progress bar during import (not just spinner)
- [ ] UI shows result summary: inserted / updated / skipped / errors
- [ ] UI shows per-row result table (`byRow` from API response)
- [ ] UI allows download of error report as CSV (row, field, message)
- [ ] UI shows audit summary reference (mode, total, valid, duplicate counts)

### 1.5 Error states

- [ ] UI shows clear error if auth fails (HTTP 401 → "กรุณาเข้าสู่ระบบ")
- [ ] UI shows clear error if site scope denied (HTTP 403 → list of denied rows)
- [ ] UI shows clear error if row count exceeds limit (HTTP 413)
- [ ] UI shows clear error if DB connection fails (HTTP 500 → "เกิดข้อผิดพลาดภายในระบบ")
- [ ] UI does NOT expose raw DB error messages to user

## 2. Persistence boundary acceptance criteria

### 2.1 Layer separation

- [ ] HTTP route is orchestration only (auth → parse → validate → persist → audit)
- [ ] Parser is pure function (no DB, no I/O)
- [ ] Validator is pure function (no DB, no I/O)
- [ ] Persistence is DB-only (takes only validated rows)
- [ ] No layer bypasses (e.g., route does NOT call Prisma directly)

### 2.2 Mode-aware behavior

- [ ] `upsert` mode: creates new + updates existing
- [ ] `create_only` mode: only creates new, skips existing
- [ ] `update_only` mode: only updates existing, skips new
- [ ] Mode is validated at route level (400 if invalid mode)

### 2.3 Bounded DB queries

- [ ] `findExistingAssetCodes` is single bounded query (one `findMany` with IN clause)
- [ ] `createMany` for inserts (single query, not per-row `create`)
- [ ] `$transaction` for updates (atomic, all-or-nothing)
- [ ] No N+1 queries (verified by test mock assertions)

### 2.4 Actor binding

- [ ] `actor` (performedBy / updatedBy) is derived from authenticated session
- [ ] Client-supplied `actor` field is ignored
- [ ] Actor is propagated to every Prisma `create` and `update` call

## 3. Error reporting + audit summary acceptance

### 3.1 Per-row errors

- [ ] Each error includes: `row` (number), `field` (name), `message` (Thai)
- [ ] Errors are aggregated across validation + persistence layers
- [ ] Errors do NOT include secret values (assetCode is OK, password is not)

### 3.2 Audit summary

- [ ] Single AuditLog entry per import (not per-row)
- [ ] Audit includes: mode, totalRows, validRows, inserted, updated, skipped, errorCount
- [ ] Audit includes: duplicateInFile (list), duplicateInDb (list), maxImportRows
- [ ] Audit does NOT include: row-level data, secret values, user PII beyond actor identity

## 4. Idempotency / retry acceptance

### 4.1 Unique constraint

- [ ] `Device.assetCode` has `@unique` constraint (verified in prisma/schema.prisma)
- [ ] DB-level protection against duplicate assetCodes

### 4.2 Mode-aware retry

- [ ] `create_only` retry → existing rows skipped (not duplicated)
- [ ] `upsert` retry → existing rows updated (not duplicated)
- [ ] `update_only` retry → new rows skipped (not inserted)
- [ ] Verified by `simulatePersistDecision` pure helper in fixtures

### 4.3 Batch atomicity

- [ ] `createMany` with `skipDuplicates=false` (validator pre-dedup, not DB skip)
- [ ] `$transaction` wraps updates (atomic — all succeed or all fail)
- [ ] No partial state on failure (transaction rollback)

### 4.4 Concurrent imports

- [ ] Two concurrent `create_only` imports with same assetCode → second skipped (unique constraint + Set dedup)
- [ ] Two concurrent `upsert` imports → last write wins (acceptable, documented)
- [ ] No race condition that creates duplicate rows

## 5. Verification commands

```bash
# Run all Devices module tests
bunx vitest run tests/device-import-contract.test.ts tests/device-import-persistence.test.ts tests/devices-import-fixtures/

# Lint all Devices module files
bunx eslint src/lib/devices-import/ src/lib/device-import-contract.ts src/lib/device-import-persistence.ts src/app/api/itam/devices/import/route.ts tests/device-import-contract.test.ts tests/device-import-persistence.test.ts tests/devices-import-fixtures/

# B4 frozen files check (must be 0-diff)
git diff <base>..HEAD -- src/lib/retry-transaction.ts src/lib/wo-authz.ts src/lib/authorization-context.ts src/lib/auth-middleware.ts src/lib/auth-shared.ts src/lib/audit.ts

# SYNC_RUN check (must be empty)
git diff <base>..HEAD | grep "^\+.*SYNC_RUN"
```

## 6. Sign-off

- [ ] Dev-3 self-check complete (this document)
- [ ] Cross-review verdict (Dev-4 / Meter primary, Dev-1 / Repair backup)
- [ ] Audit technical review (if shared contract touched — none in current PRs)
- [ ] Release Owner operational evidence (Issue #14 four items)

## References

- PR #29: https://github.com/nikorn2527-stack/ITAM-NextJS/pull/29
- PR #35: https://github.com/nikorn2527-stack/ITAM-NextJS/pull/35
- Module brief: docs/modules/devices/README.md
- Work packages: docs/MODULAR-NEXT-WORK-PACKAGES-TH.md
- Cross-review matrix: docs/MODULAR-CROSS-REVIEW-MATRIX-TH.md
