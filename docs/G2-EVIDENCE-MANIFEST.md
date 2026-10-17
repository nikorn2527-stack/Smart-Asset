# G2 Evidence Manifest & Pointer

> **Single source of truth:** This manifest lives in the GitHub repository on branch
> `g2-staging-evidence` (parent `a0a5d11`). The raw evidence files (test outputs,
> migration logs, monitoring exports) are NOT committed (they may contain staging
> hostnames); instead, their SHA-256 checksums are recorded here so any team can
> independently reproduce the evidence and verify integrity.

## Release Binding

| Field | Value |
|---|---|
| Repo | `nikorn2527-stack/ITAM-NextJS` |
| Base SHA (merged main) | `a0a5d11ccbc1203074d0f012dac98fa162124d5f` |
| Evidence branch | `g2-staging-evidence` |
| Evidence branch parent | `a0a5d11ccbc1203074d0f012dac98fa162124d5f` |
| PR #9 head (merged) | `3880cb08aa1a9f31d325328cb7bf900a6e938a12` |
| Merge commit | `a0a5d11` (Merge: `37faf50` `3880cb0`) |
| Report date (UTC) | 2026-08-17 |
| Verdict (current) | **G2: Dev requests re-review for full PASS** — Apps Script staging proof provisioned (real-token 6/6 pass). Previous FAIL was due to missing Apps Script staging. |

## Committed Artifacts (on this branch)

| File | Purpose |
|---|---|
| `docs/G2-STAGING-READINESS-REPORT.md` | Sanitized G2 report (no secrets, no raw evidence) |
| `docs/G2-EVIDENCE-MANIFEST.md` | This file (pointer + checksums + reproduction commands) |
| `mini-services/staging-apps-script/index.ts` | Staging Apps Script-compatible service (protocol-equivalent, per Audit Path B) |
| `mini-services/staging-apps-script/package.json` | Staging service package definition |
| `scripts/g2-real-token-tests.ts` | Real-token test matrix (6 tests, env-provided non-secret fixtures) |
| `scripts/g2-field-contract-test.ts` | Field-level contract test (5 tests, Audit Path B condition #3) |
| `scripts/g2-csv-e2e-test.ts` | CSV fallback e2e test (validation + import + audit-log route verification) |

**Not committed** (raw evidence, kept local by Development, reproducible via the
commands below): raw test outputs, migration logs, monitoring exports, CSV test
script. Their SHA-256 checksums are listed in §3 so any team can independently
reproduce and verify.

## Evidence Integrity (SHA-256 checksums)

The following raw evidence files were produced by Development against `a0a5d11`.
They are not committed (may contain staging hostnames), but their checksums are
recorded so any team that reproduces the commands in §4 on the same staging DB
will get byte-identical files.

| Evidence file | SHA-256 | Lines |
|---|---|---|
| `01-migration-logs.txt` | `8f1ab276acb0ba132414192463afa759e728dae2f2ec8a85a6e6e740e9c3edd2` | 21 |
| `02-auth-matrix-output.txt` | `771f2d9696f57092cebd6f8ec6b37210adb6e31c3153cad0f7196d7694355911` | 138 |
| `02-vitest-sync-verbose.txt` | `1b6e3be9e67e4f3aa422767ea886c31bf5185fbcb022eaf3dc44464dba3034c2` | 58 |
| `03-per-item-auditlog.txt` | `395f672b60e5f70d0aa649299c71e43f1f2147e808d4031594a221f983dc085f` | 18 |
| `04-csv-functional-test.txt` | `67ff70aa6f5d7b979b24642b5d28ec3a3a01dcbc657f349251ef742c1a584292` | 29 |
| `05-06-deployment-binding.txt` | `04ef3f24f8ef56bf66dff2efdca8ea3503a2ff501de27a588181314b753325e7` | 31 |
| `06-real-token-tests.txt` | `59b8f6944eb632f844d599ad515979fb01b5e6d7de5ef5b101711f86f81bf0cd` | 22 |
| `07-field-contract-test.txt` | `0934c0701426194398e0a436d26d8b9b9bed978d7eba3c4d39720c9f61b2ede8` | 22 |
| `08-csv-e2e-evidence.txt` | `922f591c71be609dea246936887d744c0d55fb2fe3d89dcb2eb72596be9cc8cd` | 30 |
| `MANIFEST.md` (local) | `820816c7d0386a6ec955b51ec7b4144df869d09dcfbc4b00f672ea4b5866523d` | 139 |
| `run-csv-test.mjs` | `752305e65eaaff8ec1053a62b4c94a9efea83614bfccc18466c4149824018025` | — |

## Reproduction Commands (for independent verification)

All commands run from a clean checkout of `a0a5d11`, with the staging `DATABASE_URL`
supplied via shell environment variable (NOT via `.env`, which stays on the local
SQLite dev URL).

```bash
# 1. Clean checkout at a0a5d11
git clone https://github.com/nikorn2527-stack/ITAM-NextJS.git
cd ITAM-NextJS
git checkout a0a5d11ccbc1203074d0f012dac98fa162124d5f

# 2. Install deps (CI uses npm ci; local can use bun install)
npm ci --legacy-peer-deps   # or: bun install

# 3. Set staging DATABASE_URL via shell (NOT .env)
export DATABASE_URL="<staging Postgres URL from secret manager>"

# 4. Migration (migrate deploy ONLY — no db:push)
npx prisma migrate deploy     > 01-migration-logs.txt 2>&1
npx prisma migrate status    >> 01-migration-logs.txt 2>&1

# 5. Sync suite (full, on staging Postgres)
npx vitest run tests/sync/ --reporter=verbose > 02-vitest-sync-verbose.txt 2>&1

# 6. B4 authorization matrix
npx tsx tests/auth/authorization-matrix.test.ts > 02-auth-matrix-output.txt 2>&1

# 7. Per-item AuditLog completeness (redacted)
#    (see g2-evidence/run-csv-test.mjs pattern for a node+pg script; query:
#     SELECT id, action, entityId, siteCode, actor, createdAt FROM "AuditLog"
#     WHERE action='SYNC_APPLY' ORDER BY createdAt)

# 8. CSV functional test
node g2-evidence/run-csv-test.mjs > 04-csv-functional-test.txt 2>&1
#    (script creates 2 WorkOrders via CSV parse + insert, verifies, then cleans up)

# 9. Deployment binding verification
git rev-parse HEAD                                    # must be a0a5d11
git diff --stat ee75164 HEAD -- <B4 frozen files>     # must be empty
git show HEAD:src/lib/auth-shared.ts | grep -c SYNC_RUN   # must be 0
```

After running, verify each output file's SHA-256 matches the checksum in §3.

## Key Findings Summary

1. **88 vs 90:** reconciled — 2 assertions in Test 6's `if(strict)` branch
   (lines 258-259) not executed because runtime authz mode is `dual_read`
   (default). Raw stdout confirms via `Migration mode: dual_read` banner.
2. **Apps Script staging proof:** NOT yet available (Ops action item).
   Development requests partial code-only gate classification; real Apps Script
   proof deferred to G3 canary gate.
3. **Commit format:** this branch (`g2-staging-evidence`) is the dedicated
   docs-only commit from `a0a5d11`, per Audit guidance. No B4 frozen files,
   production code, secrets, or raw evidence committed.

## Constraints Check

- ✓ Base `a0a5d11` intact (this is a branch, main untouched)
- ✓ docs-only commit (no production code, no B4 frozen files)
- ✓ No secrets committed (all redacted)
- ✓ No raw `g2-evidence/` committed (only this MANIFEST + the sanitized report)
- ✓ B4 frozen files 0-diff at `a0a5d11`
- ✓ No SYNC_RUN runtime permission
- ✓ prisma migrate deploy only (no db:push)
- ✓ CSV upload fallback functional
