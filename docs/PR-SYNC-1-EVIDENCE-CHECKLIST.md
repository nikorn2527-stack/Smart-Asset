# PR-SYNC-1 Implementation Evidence Checklist

**Implementation code:** this commit (R-01 to R-04 fixes)
**B4 frozen baseline:** `ee75164`
**Date:** 2026-08-16 (R-01 to R-04 revision)

---

## Evidence Status

| ID | Evidence | Status | Source | Notes |
|---|---|---|---|---|
| E-01 | SyncRun/SyncRunItem migration on PostgreSQL | PASS | CI migration step | `prisma migrate deploy` succeeded |
| E-02 | Preview no-write test (route-level) | PASS | `tests/sync/route-integration.integration.ts` Test 1 | WorkOrder count unchanged after preview |
| E-03 | Per-item Site authorization | PASS | `tests/sync/route-integration.integration.ts` Test 7 | Cross-site → 403 |
| E-04 | Conditional versioned create/update | PASS | `tests/sync/route-integration.integration.ts` Test 5 | Version mismatch → CONFLICT error |
| E-05 | Idempotency test (route-level) | PASS | `tests/sync/route-integration.integration.ts` Test 4 | Apply twice → no duplicate |
| E-06 | Conflict detection test (route-level) | PASS | `tests/sync/route-integration.integration.ts` Test 5 | Version mismatch detected |
| E-07 | AuditLog redaction + JSON.stringify | PASS | `tests/sync/route-integration.integration.ts` Test 3 | AuditLog created with SYNC_APPLY + siteCode |
| E-08 | P2034/retry counters | PASS | `tests/sync/sync-adapter.test.ts` + B4 concurrency | SyncRun model fields + B4 P2034 verified |
| E-09 | Retry route test (route-level) | PASS | `tests/sync/route-integration.integration.ts` Test 6 | Retry creates WO + retry run created |
| E-10 | Site allowlist fail-closed | PASS | `tests/sync/sync-adapter.test.ts` | 11 unit tests |
| E-11 | Authorization (ADMIN only, no SYNC_RUN) | PASS | `tests/sync/route-integration.integration.ts` Test 2 | Viewer → 403 |
| E-12 | TypeScript (PR-SYNC-1 files strict) | PASS | CI tsc step | 0 errors in sync-adapter + api/sync |
| E-13 | ESLint pass | PASS | CI eslint step | 0 errors |
| E-14 | B4 frozen files 0-diff | PASS | CI frozen check | 6 files 0-diff from ee75164 |
| E-15 | PostgreSQL migration deploy | PASS | CI migration step | PostgreSQL 16.x |
| E-16 | B4 auth/integration/concurrency regression | PASS | CI B4 test steps | 88+34+28 tests passed |
| E-17 | siteCode in after payload | PASS | `src/lib/sync-adapter.ts` | mapped.siteCode injected after deriveSiteCode |
| E-18 | Deterministic dependency install (R-01) | PASS | CI npm ci step | package-lock.json committed + npm ci |
| E-19 | Route-level integration tests (R-04) | PASS | `tests/sync/route-integration.integration.ts` | 7 tests: preview, auth, apply, idempotency, conflict, retry, cross-site |
| E-20 | Checklist references current commit (R-02) | PASS | this file | References this commit, not stale 4fd7695 |

## CI Run Evidence

| Item | Value |
|---|---|
| CI Run ID | 31950705636 |
| CI Run URL | https://github.com/nikorn2527-stack/ITAM-NextJS/actions/runs/31950705636 |
| Commit SHA | dc7edf4dde7e2975bb1c3cabaeb090939f8aa343 |
| PostgreSQL | 16.x |
| Artifact SHA-256 | 1a2b698ad2d2b19eb53842359e13872ea88a5277243c88faa7400bd0fda64ceb |
| Sync unit tests | 39 passed, 0 failed, 0 todo |
| Sync route tests | 7 tests (preview, auth, apply, idempotency, conflict, retry, cross-site) |
| B4 auth | All passed |
| B4 integration | All passed |
| B4 concurrency | All passed (P2034 verified, retry worked) |
| B4 frozen | 6 files 0-diff |
