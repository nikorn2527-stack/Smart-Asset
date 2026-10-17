-- ============================================================
-- PR-SYNC-1 Staging/Canary Monitoring SQL Scripts
-- ============================================================
-- Run against STAGING PostgreSQL only (never production).
-- Each query maps to a monitoring metric from the runbook.
-- Usage: psql $DATABASE_URL -f <script.sql> or run individually.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. Sync run summary (daily)
-- Shows all sync runs with stats for the day
-- ──────────────────────────────────────────────────────────────
-- Metric: sync activity, success/error rates
-- Alert: errorRows > 50% of totalRows → investigate

SELECT
  id,
  source,
  target,
  mode,
  status,
  triggered_by,
  site_scope,
  total_rows,
  create_rows,
  update_rows,
  skip_rows,
  error_rows,
  attempts,
  p2034_count,
  started_at,
  completed_at,
  duration_ms,
  error_message
FROM "SyncRun"
WHERE started_at >= CURRENT_DATE - INTERVAL '1 day'
ORDER BY started_at DESC;

-- ──────────────────────────────────────────────────────────────
-- 2. Conflict detection (CONFLICT errors)
-- Items that failed due to version/exists mismatch
-- ──────────────────────────────────────────────────────────────
-- Metric: conflict count and rate
-- Alert: any CONFLICT → must re-preview; >5 conflicts → stop canary

SELECT
  sri.id AS item_id,
  sri.sync_run_id,
  sri.external_key,
  sri.action,
  sri.status,
  sri.error_message,
  sri.processed_at,
  sr.triggered_by,
  sr.site_scope
FROM "SyncRunItem" sri
JOIN "SyncRun" sr ON sri.sync_run_id = sr.id
WHERE sri.status = 'error'
  AND sri.error_message LIKE '%CONFLICT%'
  AND sri.processed_at >= CURRENT_DATE - INTERVAL '1 day'
ORDER BY sri.processed_at DESC;

-- ──────────────────────────────────────────────────────────────
-- 3. Quarantine items (all error types)
-- Items quarantined for any reason (VALIDATION, OUT_OF_SCOPE, etc.)
-- ──────────────────────────────────────────────────────────────
-- Metric: quarantine count by error category
-- Alert: unknown site mapping errors → investigate source data

SELECT
  CASE
    WHEN error_message LIKE '%MISSING_SITE%' THEN 'MISSING_SITE'
    WHEN error_message LIKE '%UNKNOWN_SITE%' THEN 'UNKNOWN_SITE'
    WHEN error_message LIKE '%OUT_OF_SCOPE%' THEN 'OUT_OF_SCOPE'
    WHEN error_message LIKE '%CONFLICT%' THEN 'CONFLICT'
    WHEN error_message LIKE '%VALIDATION%' THEN 'VALIDATION'
    WHEN error_message LIKE '%SOURCE_UNREACHABLE%' THEN 'SOURCE_UNREACHABLE'
    WHEN error_message LIKE '%SOURCE_AUTH%' THEN 'SOURCE_AUTH'
    ELSE 'OTHER'
  END AS error_category,
  COUNT(*) AS item_count,
  COUNT(DISTINCT external_key) AS unique_keys
FROM "SyncRunItem"
WHERE status = 'error'
  AND processed_at >= CURRENT_DATE - INTERVAL '1 day'
GROUP BY error_category
ORDER BY item_count DESC;

-- ──────────────────────────────────────────────────────────────
-- 4. Retry/P2034 metrics
-- SyncRuns with P2034 conflicts and retry attempts
-- ──────────────────────────────────────────────────────────────
-- Metric: retry storm detection
-- Alert: p2034_count > 10 per run OR attempts > 5x totalRows → retry storm

SELECT
  id,
  mode,
  status,
  total_rows,
  attempts,
  p2034_count,
  CASE
    WHEN p2034_count > 10 THEN 'WARN: high P2034 count'
    WHEN attempts > total_rows * 5 THEN 'WARN: retry storm suspected'
    ELSE 'OK'
  END AS alert,
  started_at,
  completed_at
FROM "SyncRun"
WHERE mode = 'apply'
  AND started_at >= CURRENT_DATE - INTERVAL '1 day'
ORDER BY p2034_count DESC, attempts DESC;

-- ──────────────────────────────────────────────────────────────
-- 5. Authorization denial check
-- Check AuditLog for denied sync operations (403 responses)
-- ──────────────────────────────────────────────────────────────
-- Metric: authorization denial rate
-- Alert: any cross-site access attempt → security incident

-- Note: HTTP 403 responses are logged in Next.js server logs, not in
-- AuditLog. To capture authorization denials, check the server logs
-- for "403" responses on /api/sync/* routes. This query checks
-- AuditLog for SYNC_APPLY entries to verify audit completeness.

SELECT
  action,
  entity,
  site_code,
  actor,
  COUNT(*) AS entry_count,
  MIN(created_at) AS first_entry,
  MAX(created_at) AS last_entry
FROM "AuditLog"
WHERE action = 'SYNC_APPLY'
  AND created_at >= CURRENT_DATE - INTERVAL '1 day'
GROUP BY action, entity, site_code, actor
ORDER BY entry_count DESC;

-- ──────────────────────────────────────────────────────────────
-- 6. Audit-log completeness (applied items vs audit entries)
-- Every applied SyncRunItem should have a corresponding AuditLog entry
-- ──────────────────────────────────────────────────────────────
-- Metric: audit completeness = 100%
-- Alert: ANY missing audit entry → critical gap

SELECT
  sr.id AS sync_run_id,
  sr.mode,
  sr.status,
  COUNT(sri.id) AS applied_items,
  COUNT(al.id) AS audit_entries,
  CASE
    WHEN COUNT(sri.id) = COUNT(al.id) THEN 'PASS: 100%'
    ELSE 'FAIL: audit gap'
  END AS completeness_check
FROM "SyncRun" sr
LEFT JOIN "SyncRunItem" sri ON sri.sync_run_id = sr.id AND sri.status = 'applied'
LEFT JOIN "AuditLog" al ON al.action = 'SYNC_APPLY'
  AND al.entity = 'WorkOrder'
  AND al.entity_id = sri.entity_id
  AND al.created_at >= sr.started_at
WHERE sr.mode = 'apply'
  AND sr.started_at >= CURRENT_DATE - INTERVAL '1 day'
GROUP BY sr.id, sr.mode, sr.status
ORDER BY sr.started_at DESC;

-- ──────────────────────────────────────────────────────────────
-- 7. 14-day stability tracker
-- Daily summary for the full stability window
-- ──────────────────────────────────────────────────────────────
-- Metric: daily sync activity + error rate over 14 days
-- Alert: any day with 0 successful syncs (if sync was attempted) → gap

SELECT
  DATE(sr.started_at) AS sync_date,
  COUNT(DISTINCT sr.id) AS total_runs,
  COUNT(DISTINCT CASE WHEN sr.status = 'completed' THEN sr.id END) AS completed_runs,
  COUNT(DISTINCT CASE WHEN sr.status = 'failed' THEN sr.id END) AS failed_runs,
  SUM(sr.total_rows) AS total_rows,
  SUM(sr.create_rows) AS total_created,
  SUM(sr.update_rows) AS total_updated,
  SUM(sr.skip_rows) AS total_skipped,
  SUM(sr.error_rows) AS total_errors,
  SUM(sr.p2034_count) AS total_p2034,
  ROUND(
    CASE WHEN SUM(sr.total_rows) > 0
      THEN SUM(sr.error_rows)::FLOAT / SUM(sr.total_rows) * 100
      ELSE 0
    END, 2
  ) AS error_rate_pct
FROM "SyncRun" sr
WHERE sr.started_at >= CURRENT_DATE - INTERVAL '14 days'
GROUP BY DATE(sr.started_at)
ORDER BY sync_date DESC;

-- ──────────────────────────────────────────────────────────────
-- 8. CSV fallback check (verify CSV upload still works)
-- Check that ImportJob table still has recent activity
-- ──────────────────────────────────────────────────────────────
-- Metric: CSV upload still functional
-- Alert: no CSV uploads in 7 days when sync is active → verify fallback

SELECT
  DATE(created_at) AS upload_date,
  job_type,
  COUNT(*) AS job_count,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
  SUM(processed_rows) AS total_processed,
  SUM(error_rows) AS total_errors
FROM "ImportJob"
WHERE created_at >= CURRENT_DATE - INTERVAL '14 days'
GROUP BY DATE(created_at), job_type
ORDER BY upload_date DESC;

-- ──────────────────────────────────────────────────────────────
-- 9. Pre-deploy guard: B4 frozen files check
-- Verify 6 B4 frozen files have 0 diff from baseline
-- ──────────────────────────────────────────────────────────────
-- Run BEFORE deploy (not SQL — shell command)
-- Alert: ANY diff → STOP deploy

-- for f in src/lib/retry-transaction.ts src/lib/wo-authz.ts \
--   src/lib/authorization-context.ts src/lib/auth-middleware.ts \
--   src/lib/auth-shared.ts src/lib/audit.ts; do
--   diff=$(git diff ee75164...HEAD -- "$f")
--   if [ -n "$diff" ]; then echo "FAIL: $f has diff"; exit 1; fi
-- done
-- echo "PASS: All 6 B4 frozen files have 0 diff"

-- ──────────────────────────────────────────────────────────────
-- 10. SYNC_RUN permission check (must NOT exist)
-- Verify SYNC_RUN was not added to auth-shared.ts
-- ──────────────────────────────────────────────────────────────
-- Run BEFORE deploy (not SQL — shell command)
-- Alert: SYNC_RUN found → STOP deploy, requires Audit review

-- if grep -q "SYNC_RUN" src/lib/auth-shared.ts; then
--   echo "FAIL: SYNC_RUN found in auth-shared.ts — requires Audit review"
--   exit 1
-- fi
-- echo "PASS: SYNC_RUN not found"

-- ============================================================
-- End of monitoring scripts
-- ============================================================
-- Save daily outputs to: staging-monitoring/YYYY-MM-DD/
-- Attach to deployment evidence package
-- ============================================================
