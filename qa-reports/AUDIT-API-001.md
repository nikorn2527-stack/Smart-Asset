# API Audit Report — Task ID: AUDIT-API-001

**Audit Type:** THOROUGH audit of ALL API endpoints in the Next.js ITAM project
**Auditor:** Audit Subagent (research-only, no code modifications)
**Date:** 2026-08-29
**Project:** /home/z/my-project (ITAM-NextJS)
**Scope:** Every `route.ts` under `src/app/api/` (~145 endpoints)

---

## Summary

- **Total endpoints audited:** ~145 route files (~280 HTTP handler functions: GET/POST/PUT/PATCH/DELETE)
- **Total bugs found:** 78
  - **P0 (Critical / security):** 38
  - **P1 (High / functional):** 26
  - **P2 (Medium / quality):** 14

### Top concerns

1. **~25 endpoints have NO authentication at all** — including ones that mutate data (devices, settings, cycles, stock, purchase-orders, audit log).
2. **Legacy `/api/auth/login` accepts ANY password** — trivial authentication bypass.
3. **Legacy `/api/auth/me` uses forgeable base64 session cookie** — no signature, easily crafted.
4. **`/api/itam/debug` leaks password hashes + tests backdoor passwords** (`P@ssw0rd!2025` for `nikorn.p`).
5. **`/api/settings` (root) leaks ALL AppSetting values** including `line_channel_access_token`, `line_channel_secret`, `oauth_google_client_secret`, `oauth_telegram_bot_token`.
6. **`/api/line/reply` has NO auth and lets anyone push LINE messages** with a body-supplied `actor` field — perfect spam/impersonation vector.
7. **WO mutation routes (assign/complete/cancel/etc.) all require `WO_CREATE` first**, then check the actual permission via `loadAuthorizedWorkOrder` — rejects users who have only the specific permission (WO_ASSIGN/WO_COMPLETE/WO_CANCEL) but not WO_CREATE.
8. **v1 API (`/api/v1/work-orders/*`) skips Site scope entirely** — any authenticated user sees every WO across every Site.
9. **v1 PUT allows `body.editUnlockActive=true` to bypass terminal-WO lock** — privilege escalation.
10. **AuditLog writes in 5 routes use non-existent fields** (`timestamp`, `user`, `details`) → Prisma error every time.

---

## Bugs by Endpoint

### `/api/auth/login` (legacy) — POST
- **Bug ID:** API-BUG-001
- **Severity:** P0
- **File:** src/app/api/auth/login/route.ts
- **Line:** 38-39
- **Description:** Comment says "password check skipped for now — accept any password (incl. empty)". The code never calls `verifyPassword()`. Any user can log in as anyone by supplying just the email.
- **Impact:** Complete authentication bypass. Any account (including admin) can be compromised by knowing only the email.
- **Fix:** Add `verifyPassword(body.password, user.passwordHash, user.passwordSalt)` check; return 401 on mismatch.
- **Code snippet:**
```diff
- // password check skipped for now — accept any password (incl. empty)
+ if (!user.passwordHash || !user.passwordSalt) {
+   return NextResponse.json({ error: 'บัญชีไม่ได้ตั้งรหัสผ่าน' }, { status: 403 })
+ }
+ if (!verifyPassword(body.password, user.passwordHash, user.passwordSalt)) {
+   return NextResponse.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 })
+ }
```

### `/api/auth/me` (legacy) — GET
- **Bug ID:** API-BUG-002
- **Severity:** P0
- **File:** src/app/api/auth/me/route.ts + src/lib/auth-session.ts
- **Line:** auth-session.ts:25-45
- **Description:** `encodeSession()` / `decodeSession()` use plain base64 encoding (`Buffer.from(JSON).toString('base64')`) — no signature. Anyone can craft a fake `itam-session` cookie like `{"userId":"<target>","email":"admin@...","exp":9999999999}` and authenticate as any user.
- **Impact:** Complete authentication bypass via cookie forgery.
- **Fix:** Replace with HS256 JWT (use `createToken()` / `verifyToken()` from `src/lib/auth.ts`); reject unsigned tokens.

### `/api/auth/logout` (legacy) — DELETE
- **Bug ID:** API-BUG-003
- **Severity:** P1
- **File:** src/app/api/auth/logout/route.ts
- **Line:** 10-27
- **Description:** Only clears the cookie; no server-side token blacklist. A stolen cookie remains valid until expiry (7 days).
- **Impact:** Stolen sessions cannot be revoked.
- **Fix:** Call `blacklistToken()` (the JWT-based `/api/itam/auth/logout` does this — legacy should reuse it).

### `/api/itam/auth/logout` — POST
- **Bug ID:** API-BUG-004
- **Severity:** P0
- **File:** src/app/api/itam/auth/logout/route.ts
- **Line:** 21-28
- **Description:** Audit log insert uses `timestamp`, `user`, `details` fields — none exist on the `AuditLog` model (fields are `createdAt`, `actor`, `detail`, `entity`, `entityId`, `summary`, `action`, `siteCode`). Prisma will throw `Unknown arg` every call; the try/catch swallows the error silently so no logout is ever audited.
- **Impact:** Logout events never recorded — breaks audit trail; potentially masks malicious session use.
- **Fix:** Use the `logAudit()` helper from `src/lib/audit.ts` with correct field names.
- **Code snippet:**
```diff
- await db.auditLog.create({
-   data: {
-     timestamp: new Date().toISOString(),
-     action: 'LOGOUT',
-     user: auth.user.email,
-     details: JSON.stringify({ method: 'password' }),
-   },
- })
+ await logAudit('LOGOUT', 'User', auth.row.id, `ออกจากระบบ — ${auth.user.email}`, { method: 'password' }, auth.user.email)
```

### `/api/auth/oauth/google/callback` — GET
- **Bug ID:** API-BUG-005
- **Severity:** P0
- **File:** src/app/api/auth/oauth/google/callback/route.ts
- **Line:** 178-185
- **Description:** Audit log insert uses `timestamp`/`user`/`details` (same as API-BUG-004). Prisma error every time → no audit of OAuth registrations.
- **Impact:** Silent OAuth account creation; no audit trail.
- **Fix:** Same as API-BUG-004 — use `logAudit()`.

- **Bug ID:** API-BUG-006
- **Severity:** P1
- **File:** src/app/api/auth/oauth/google/callback/route.ts
- **Line:** 114, 119
- **Description:** `redirectToHome('oauth_error=token_exchange_failed')` and `redirectToHome('oauth_error=no_email')` are called with **only one argument** (the query string), but `redirectToHome(origin, query)` expects `origin` first. Result: URL becomes `/?oauth_error=token_exchange_failed` (relative to empty origin) — broken redirect.
- **Impact:** OAuth failure paths redirect to a broken URL.
- **Fix:** Pass `origin` as first arg: `redirectToHome(origin, 'oauth_error=...')`.

- **Bug ID:** API-BUG-007
- **Severity:** P1
- **File:** src/app/api/auth/oauth/google/callback/route.ts
- **Line:** 159-162
- **Description:** Issues a JWT and passes both `token` and `user` JSON as URL query params (`?oauth=success&token=...&user=...`). Tokens + PII (name, email, role, allowedSites) leak into browser history, server logs, referer headers, and proxy logs.
- **Impact:** JWT + user PII leak via URL.
- **Fix:** Use a short-lived HttpOnly cookie to transport the token, or postMessage to the opener window.

- **Bug ID:** API-BUG-008
- **Severity:** P2
- **File:** src/app/api/auth/oauth/google/callback/route.ts
- **Line:** 130-144
- **Description:** When an existing user is inactive (`!user.active`), the code first updates `lastLoginAt` (line 132-144) and THEN redirects to `oauth=pending`. An inactive user's `lastLoginAt` is bumped even though they didn't actually log in — misleading audit signal.
- **Fix:** Move the `lastLoginAt` update inside the `if (user.active)` branch.

- **Bug ID:** API-BUG-009
- **Severity:** P2
- **File:** src/app/api/auth/oauth/google/callback/route.ts
- **Line:** 130-138
- **Description:** `user.lineUserId !== \`google:${googleSub}\`` — the field is named `lineUserId` but stores a Google sub here. If a user previously linked LINE (`lineUserId: 'line:U123'`), logging in via Google will overwrite the LINE binding.
- **Fix:** Use a separate `oauthProvider`/`oauthSub` column or check before overwriting.

### `/api/auth/oauth/line/callback` — GET
- **Bug ID:** API-BUG-010
- **Severity:** P0
- **File:** src/app/api/auth/oauth/line/callback/route.ts
- **Line:** 200-207
- **Description:** Same audit-log bug as API-BUG-005 (`timestamp`/`user`/`details`).
- **Impact:** LINE OAuth registrations not audited.
- **Fix:** Use `logAudit()`.

- **Bug ID:** API-BUG-011
- **Severity:** P1
- **File:** src/app/api/auth/oauth/line/callback/route.ts
- **Line:** 149-157
- **Description:** Same `lineUserId` overwrite risk as API-BUG-009 — LINE login will overwrite a previously-stored Google sub.
- **Fix:** Separate OAuth provider/sub columns.

### `/api/itam/debug` — GET
- **Bug ID:** API-BUG-012
- **Severity:** P0
- **File:** src/app/api/itam/debug/route.ts
- **Line:** 5-17
- **Description:** **NO AUTH.** Returns every user's `passwordHash` + `passwordSalt` (both exposed via `select`). Worse: it tests hardcoded password guesses — `'P@ssw0rd!2025'` for user `nikorn.p` and `'1234'` for everyone else — and returns `verify: true/false` for each. This is a credential oracle: an attacker can confirm whether a user's password matches a known string, and use the leaked hash+salt for offline brute-force.
- **Impact:** Mass credential disclosure + interactive password oracle.
- **Fix:** Delete this endpoint from production entirely (it's a debug helper). If kept for local dev, gate behind `NODE_ENV !== 'production'` AND `requireAuth(req, 'SUPER_ADMIN')` AND never return hashes.

### `/api/line/reply` — POST
- **Bug ID:** API-BUG-013
- **Severity:** P0
- **File:** src/app/api/line/reply/route.ts
- **Line:** 55-146
- **Description:** **NO AUTH.** Anyone can POST `{ lineUserId, message, actor, author, woNumber }` and push arbitrary LINE messages to ANY LINE user ID (via `sendLINE`). The `actor` and `author` are body-controlled, so the audit log records whatever the attacker supplies. There's also no rate limiting.
- **Impact:** Unlimited spam to any LINE user; impersonation of staff; audit-log poisoning.
- **Fix:** Require `requireAuth(req, 'WO_ASSIGN')` (or new `LINE_SEND` permission); derive `actor` from `auth.user.email`; add per-user rate limit.

### `/api/notifications/send` — POST
- **Bug ID:** API-BUG-014
- **Severity:** P0
- **File:** src/app/api/notifications/send/route.ts
- **Line:** 51-113
- **Description:** **NO AUTH.** Anyone can trigger notifications (LINE OA push, Telegram, email) to arbitrary recipients. `actor` is body-controlled.
- **Impact:** Spam; impersonation; cost abuse (LINE Messaging API is billed per message).
- **Fix:** Require `requireAuth(req, 'SYSTEM_CONFIG')` (or restrict to server-side calls only — remove the public endpoint entirely if possible).

### `/api/audit` — GET
- **Bug ID:** API-BUG-015
- **Severity:** P0
- **File:** src/app/api/audit/route.ts
- **Line:** 4-40
- **Description:** **NO AUTH.** Anyone can read the entire audit log (every `actor`, `summary`, `detail`). The dedicated `/api/itam/audit` route correctly requires `VIEW_AUDIT` + scopes by user — but this legacy `/api/audit` route is wide open.
- **Impact:** Full audit-log disclosure (emails, internal actions, IP/PII in detail).
- **Fix:** Add `requireAuth(req, 'VIEW_AUDIT')`; or remove this route and migrate clients to `/api/itam/audit`.

### `/api/audit/log` — POST
- **Bug ID:** API-BUG-016
- **Severity:** P0
- **File:** src/app/api/audit/log/route.ts
- **Line:** 9-43
- **Description:** **NO AUTH.** Anyone can write arbitrary audit entries with any `action`, `entity`, `entityId`, `summary`, `detail`. Audit log integrity is destroyed — attackers can pollute the log to hide real actions or frame innocent users.
- **Impact:** Audit-log forgery; unreliable audit trail.
- **Fix:** Require `requireAuth(req, 'VIEW_AUDIT')`; derive `actor` from `auth.user.email` (ignore body.actor).

### `/api/notifications` — GET
- **Bug ID:** API-BUG-017
- **Severity:** P0
- **File:** src/app/api/notifications/route.ts
- **Line:** 71-269
- **Description:** **NO AUTH.** Returns warranty alerts, meter reminders, audit log entries for ALL sites — including device asset codes, names, sites, building/location.
- **Impact:** Cross-site information disclosure.
- **Fix:** Add `requireAuth(req, 'VIEW_DASHBOARD')`; scope device/warranty queries via `buildAuthorizationContext().siteWhere()`.

### `/api/settings` (root) — GET, PUT
- **Bug ID:** API-BUG-018
- **Severity:** P0
- **File:** src/app/api/settings/route.ts
- **Line:** 4-42
- **Description:** **NO AUTH on GET or PUT.** GET returns ALL `AppSetting` rows (raw key→value map) — including secrets like `line_channel_access_token`, `line_channel_secret`, `oauth_google_client_id`, `oauth_google_client_secret`, `oauth_line_channel_secret`, `oauth_telegram_bot_token`. PUT accepts an arbitrary `{key: value}` map and upserts every key — attacker can set `enablePasswordLogin=false` (lockout), change OAuth client IDs to attacker-controlled values, swap the LINE channel secret, etc.
- **Impact:** Total secrets leak + total config tampering. An attacker who reads `oauth_google_client_secret` can impersonate the Google OAuth client; with `line_channel_access_token` they can send LINE messages as the bot.
- **Fix:** GET → `requireAuth(req, 'SYSTEM_CONFIG')` and redact secret keys. PUT → `requireAuth(req, 'SYSTEM_CONFIG')` and whitelist allowed keys; reject keys matching `*_secret|*_token|*_password`.

### `/api/site-attributes` — GET, POST
- **Bug ID:** API-BUG-019
- **Severity:** P0
- **File:** src/app/api/site-attributes/route.ts
- **Line:** 12-25, 42-109
- **Description:** **NO AUTH on GET or POST.** GET returns every SiteAttribute including `LineOA`, `TelegramChatId`, `EmailAddress` (integration tokens). POST creates new SiteAttribute rows with attacker-controlled values — these are then picked up by every Site-scoped query in the app.
- **Impact:** Token leak + ability to inject fake sites into the site master.
- **Fix:** GET → `requireAuth(req, 'VIEW_DEVICES')` + redact `LineOA`/`TelegramChatId`/`EmailAddress` for non-admins. POST → `requireAuth(req, 'MASTER_DATA_EDIT')` + audit log with real actor.

### `/api/site-rates` — GET, POST
- **Bug ID:** API-BUG-020
- **Severity:** P0
- **File:** src/app/api/site-rates/route.ts
- **Line:** 5-58, 59-129
- **Description:** **NO AUTH on GET or POST.** Anyone can read/write billing rates. POST also doesn't validate that `bwRate`/`colorRate` are non-negative (an attacker could set `-100`).
- **Impact:** Billing manipulation; financial impact.
- **Fix:** GET → `requireAuth(req, 'VIEW_DASHBOARD')`. POST → `requireAuth(req, 'SYSTEM_CONFIG')` + `Math.max(0, bw)` validation + audit log with actor.

### `/api/settings/org-profile` — GET, PUT
- **Bug ID:** API-BUG-021
- **Severity:** P0
- **File:** src/app/api/settings/org-profile/route.ts
- **Line:** 6-36
- **Description:** **NO AUTH on GET or PUT.** Anyone can read or modify the org profile. PUT audit log hardcodes `actor: 'admin'` — every mutation is attributed to "admin" regardless of who actually called it.
- **Impact:** Branding/contact info tampering; broken audit attribution.
- **Fix:** GET → `requireAuth(req)`. PUT → `requireAuth(req, 'SYSTEM_CONFIG')` + `actor: auth.user.email` in audit log.

### `/api/settings/options` — GET
- **Bug ID:** API-BUG-022
- **Severity:** P1
- **File:** src/app/api/settings/options/route.ts
- **Line:** 261-287
- **Description:** GET has **NO AUTH** (POST correctly requires `MASTER_DATA_EDIT`). Returns all subject/building/resolution options. Lower sensitivity than secrets but still internal taxonomy.
- **Fix:** Add `requireAuth(req, 'VIEW_DEVICES')` to GET.

### `/api/settings/wo-patterns` — GET, POST
- **Bug ID:** API-BUG-023
- **Severity:** P0
- **File:** src/app/api/settings/wo-patterns/route.ts
- **Line:** 9-50
- **Description:** **NO AUTH on GET or POST.** Anyone can list/create WO number patterns. An attacker can create a pattern with a malicious template (e.g. `prefix=../../../`) or activate one that breaks WO numbering.
- **Impact:** WO numbering disruption; potential injection if pattern is interpolated unsafely.
- **Fix:** GET → `requireAuth(req, 'VIEW_DEVICES')`. POST → `requireAuth(req, 'SYSTEM_CONFIG')` + audit log.

### `/api/settings/wo-patterns/[id]/activate` — POST
- **Bug ID:** API-BUG-024
- **Severity:** P0
- **File:** src/app/api/settings/wo-patterns/[id]/activate/route.ts
- **Line:** 5-17
- **Description:** **NO AUTH.** Anyone can activate any WO number pattern (which is then used by every `POST /api/work-orders`).
- **Impact:** WO numbering hijack.
- **Fix:** `requireAuth(req, 'SYSTEM_CONFIG')` + audit log.

### `/api/settings/asset-patterns` — GET, POST
- **Bug ID:** API-BUG-025
- **Severity:** P0
- **File:** src/app/api/settings/asset-patterns/route.ts
- **Line:** 6-44
- **Description:** **NO AUTH on GET or POST.** Same issue as API-BUG-023 but for asset-code patterns.
- **Fix:** Same — `requireAuth(req, 'VIEW_DEVICES')` / `'SYSTEM_CONFIG'`.

### `/api/devices/[id]` — GET, PUT, DELETE
- **Bug ID:** API-BUG-026
- **Severity:** P0
- **File:** src/app/api/devices/[id]/route.ts
- **Line:** 52-67 (GET), 108-261 (PUT), 263-286 (DELETE)
- **Description:** **NO AUTH on any of GET/PUT/DELETE.** Anyone with a device ID can read the full device record (incl. serialNumber, IP, MAC, contractNo, vendor, purchasePrice), edit ANY field, or DELETE the device. The dedicated `/api/itam/devices/[id]` route correctly requires auth — but this legacy route is wide open.
- **Impact:** Total device CRUD bypass; data exfiltration; data destruction.
- **Fix:** Add `requireAuth(req, 'VIEW_DEVICES')` (GET), `'DEVICE_EDIT'` (PUT), `'DEVICE_DELETE'` (DELETE) + Site scope via `buildAuthorizationContext` + audit log with real actor (currently `logAudit` defaults to `'system'`).

- **Bug ID:** API-BUG-027
- **Severity:** P1
- **File:** src/app/api/devices/[id]/route.ts
- **Line:** 120, 177 (comment)
- **Description:** PUT allows editing `assetCode` even though the comment on line 177 says "assetCode remains read-only (no changes here)". Changing `assetCode` breaks every foreign key that references it (WorkOrderImages, MeterReadings, etc. — though Prisma uses surrogate `id`, the human-readable `assetCode` is used in QR codes, prints, search).
- **Fix:** Drop `assetCode` from the `updateData` map.

- **Bug ID:** API-BUG-028
- **Severity:** P2
- **File:** src/app/api/devices/[id]/route.ts
- **Line:** 209-215, 274-279
- **Description:** Audit log on PUT/DELETE omits `actor` — `logAudit('UPDATE', 'Device', id, summary, {changes})` defaults `actor` to `'system'`. No way to trace who changed what.
- **Fix:** Pass `actor: auth.user.email` (after adding auth per API-BUG-026).

### `/api/devices/[id]/assign` — GET, POST
- **Bug ID:** API-BUG-029
- **Severity:** P0
- **File:** src/app/api/devices/[id]/assign/route.ts
- **Line:** 5-27, 29-123
- **Description:** **NO AUTH on GET or POST.** Anyone can list assignment history or check out a device to anyone.
- **Fix:** `requireAuth(req, 'VIEW_DEVICES')` / `'DEVICE_TRANSFER'` + audit log with actor.

### `/api/devices/[id]/return` — POST
- **Bug ID:** API-BUG-030
- **Severity:** P0
- **File:** src/app/api/devices/[id]/return/route.ts
- **Line:** 5-70
- **Description:** **NO AUTH.** Anyone can return any device from its current assignee.
- **Fix:** `requireAuth(req, 'DEVICE_TRANSFER')` + audit log with actor.

### `/api/devices/[id]/transfer` — GET
- **Bug ID:** API-BUG-031
- **Severity:** P0
- **File:** src/app/api/devices/[id]/transfer/route.ts
- **Line:** 52-73
- **Description:** GET has **NO AUTH** (POST delegates to canonical `/api/itam/devices/[id]/transfer` which has auth). Anyone can list transfer history for any device.
- **Fix:** `requireAuth(req, 'VIEW_DEVICES')` + Site scope.

### `/api/devices/warranty` — GET
- **Bug ID:** API-BUG-032
- **Severity:** P0
- **File:** src/app/api/devices/warranty/route.ts
- **Line:** 86+ (`export async function GET()`)
- **Description:** **NO AUTH** (no `requireAuth` call). Returns warranty info for ALL devices across ALL sites (asset codes, names, sites, purchase dates, warranty expiry).
- **Fix:** `requireAuth(req, 'VIEW_DEVICES')` + scope via `buildAuthorizationContext().siteWhere()`.

### `/api/devices/utilization` — GET
- **Bug ID:** API-BUG-033
- **Severity:** P0
- **File:** src/app/api/devices/utilization/route.ts
- **Line:** 97+ (`export async function GET(req: NextRequest)`)
- **Description:** **NO AUTH.** Returns utilization metrics (pages per month per device) for ALL devices.
- **Fix:** `requireAuth(req, 'VIEW_DASHBOARD')` + Site scope.

### `/api/devices/lifecycle` — GET
- **Bug ID:** API-BUG-034
- **Severity:** P0
- **File:** src/app/api/devices/lifecycle/route.ts
- **Line:** 108+ (`export async function GET()`)
- **Description:** **NO AUTH.** Returns lifecycle/replacement data for ALL devices.
- **Fix:** `requireAuth(req, 'VIEW_DEVICES')` + Site scope.

### `/api/devices/depreciation` — GET
- **Bug ID:** API-BUG-035
- **Severity:** P2
- **File:** src/app/api/devices/depreciation/route.ts
- **Line:** 20-41
- **Description:** **NO AUTH** but currently returns a stub (`configured: false`). Comment says Device has no `purchasePrice`/`salvageValue` — but the actual Prisma schema DOES have these fields. The stub is misleading.
- **Fix:** Either implement real depreciation with `requireAuth(req, 'VIEW_DASHBOARD')` + Site scope, or remove the endpoint.

### `/api/devices/next-site-code` — GET
- **Bug ID:** API-BUG-036
- **Severity:** P1
- **File:** src/app/api/devices/next-site-code/route.ts
- **Line:** 15-74
- **Description:** **NO AUTH.** Anyone can probe the next asset-site-code for any site (info disclosure — reveals how many devices exist at each site).
- **Fix:** `requireAuth(req, 'VIEW_DEVICES')` + Site scope validation (caller must have access to the queried site).

### `/api/cycles` — GET, POST
- **Bug ID:** API-BUG-037
- **Severity:** P0
- **File:** src/app/api/cycles/route.ts
- **Line:** 12-53 (GET), 55-110 (POST)
- **Description:** **NO AUTH on GET or POST.** Anyone can list cycles or create new ones (and the POST auto-closes other active cycles — an attacker could mass-close cycles). Audit log has no actor (defaults to `'system'`); no `siteCode` in audit detail.
- **Impact:** Cycle management disruption.
- **Fix:** GET → `requireAuth(req, 'VIEW_DASHBOARD')` + Site scope (the auto-close `updateMany` should be Site-scoped). POST → `requireAuth(req, 'METER_WRITE')` + audit with `actor` and `siteCode`.

### `/api/cycles/[id]` — GET, PUT, DELETE
- **Bug ID:** API-BUG-038
- **Severity:** P0
- **File:** src/app/api/cycles/[id]/route.ts
- **Line:** 6-27 (GET), 30-166 (PUT), 169-208 (DELETE)
- **Description:** GET and DELETE have **NO AUTH**. PUT has a dynamic `requireAuth(req, 'METER_WRITE')` import — but it's wrapped in try/catch and on failure (any error — invalid token, network glitch, etc.) `user` stays null and the request proceeds ("for testing"). So PUT is effectively unauthenticated too.
- **Impact:** Anyone can read/update/delete any cycle. Closing a cycle creates a meter snapshot — an attacker could mass-close cycles to corrupt snapshot history.
- **Fix:** Hard-require `requireAuth(req, 'METER_WRITE')` (return 401/403 on failure, no try/catch bypass). GET → `requireAuth(req, 'VIEW_DASHBOARD')`. DELETE → `requireAuth(req, 'METER_WRITE')` + audit log.

- **Bug ID:** API-BUG-039
- **Severity:** P0
- **File:** src/app/api/cycles/[id]/route.ts
- **Line:** 16-22
- **Description:** GET query uses `where: { cycleId: id }` and `select: { delta: true }` on `MeterReading` — but `MeterReading` has NO `cycleId` field and NO `delta` field (per `prisma/schema.prisma`). The query will throw a Prisma "Unknown argument" error → 500.
- **Fix:** Use the cycle's `startDate`/`endDate` to filter readings: `where: { readingDate: { gte: cycle.startDate, lte: cycle.endDate } }` and compute `delta` client-side as `pagesBw + pagesColor`.

### `/api/cycles/[id]/report` — GET
- **Bug ID:** API-BUG-040
- **Severity:** P0
- **File:** src/app/api/cycles/[id]/report/route.ts
- **Line:** 62-80+
- **Description:** **NO AUTH.** Also queries `where: { cycleId: id }` and `orderBy: [{ date: 'asc' }, ...]` — `cycleId` and `date` fields don't exist on `MeterReading` (it's `readingDate`). Prisma error → 500.
- **Fix:** Add auth; fix field names (`readingDate`); filter by date range based on the cycle.

### `/api/stock-items` — GET, POST
- **Bug ID:** API-BUG-041
- **Severity:** P0
- **File:** src/app/api/stock-items/route.ts
- **Line:** 44-131 (GET), 133-201 (POST)
- **Description:** **NO AUTH on GET or POST.** Anyone can list all stock items (product codes, quantities, unit costs, locations) or create new ones. POST also calls `nextProductCode()` with a race condition (`findFirst` → compute → `create`). Audit log has no actor.
- **Impact:** Stock info disclosure; creation of fake stock entries; race condition generates duplicate product codes.
- **Fix:** GET → `requireAuth(req, 'STOCK_VIEW')`. POST → `requireAuth(req, 'STOCK_IN')` or `'DEVICE_EDIT'`; use a DB sequence or `upsert` with retry for product codes; audit with `actor`.

### `/api/purchase-orders` — GET, POST
- **Bug ID:** API-BUG-042
- **Severity:** P0
- **File:** src/app/api/purchase-orders/route.ts
- **Line:** 43-103 (GET), 111-226 (POST)
- **Description:** **NO AUTH on GET or POST.** Anyone can list/create purchase orders (financial records). POST `createdBy` is body-controlled (spoofable). `nextPoNumber()` has a race condition. Audit log has no actor.
- **Impact:** Financial record tampering; impersonation.
- **Fix:** GET → `requireAuth(req, 'STOCK_VIEW')`. POST → `requireAuth(req, 'STOCK_IN')` or new `'PO_CREATE'` permission; `createdBy: auth.user.email`; retry on Po number collision; audit with actor.

### `/api/seed` — POST
- **Bug ID:** API-BUG-043
- **Severity:** P1
- **File:** src/app/api/seed/route.ts
- **Line:** 12-236
- **Description:** **NO AUTH.** Anyone can trigger demo data seeding (only runs if DB is empty, but still). Also `readingsToCreate` (line 138-165) uses fields `cycleId`, `delta`, `reading`, `prevReading`, `date` that DON'T exist on `MeterReading` — the `db.meterReading.createMany({ data: readingsToCreate })` will throw → 500.
- **Fix:** Add `requireAuth(req, 'ADMIN')` or remove the endpoint (use `scripts/seed-master-data.ts` instead); fix field names.

### `/api/search` — GET
- **Bug ID:** API-BUG-044
- **Severity:** P0
- **File:** src/app/api/search/route.ts
- **Line:** 53-183
- **Description:** Auth check is **broken**: only verifies that the `Authorization` header *starts with* `Bearer ` — never calls `verifyToken()`. `Bearer garbage` passes. Combined with NO Site scope, an unauthenticated attacker can search across all devices (incl. serialNumber, IP, MAC), master items, meter readings (incl. PII remarks), audit logs (incl. actor emails + summaries), and sites.
- **Impact:** Full cross-site search without authentication.
- **Fix:** Replace the header-prefix check with `requireAuth(req, 'VIEW_DEVICES')` + `buildAuthorizationContext().siteWhere()` on the device/meter queries; gate audit log search behind `VIEW_AUDIT`.

### `/api/dashboard` — GET (legacy)
- **Bug ID:** API-BUG-045
- **Severity:** P1
- **File:** src/app/api/dashboard/route.ts
- **Line:** 91-224
- **Description:** Has `requireAuth(req, 'VIEW_DASHBOARD')` (good) but **NO Site scope** — returns global device counts, paper usage, top-usage devices across ALL sites. A viewer with access to only Site A sees Site B's data.
- **Impact:** Cross-site data leak via KPIs.
- **Fix:** Add `buildAuthorizationContext()` + filter all `db.device.*` / `db.meterReading.*` queries with `ctx.siteWhere()`.

### `/api/itam/updates` — GET
- **Bug ID:** API-BUG-046
- **Severity:** P1
- **File:** src/app/api/itam/updates/route.ts
- **Line:** 13-65
- **Description:** Has `requireAuth(req, 'VIEW_DEVICES')` but **NO Site scope** — returns audit log events from ALL sites to any authenticated user. Also `since` query param is parsed with `Number(...)` — if non-numeric (e.g. `?since=foo`), `new Date(NaN)` is constructed and the Prisma query throws.
- **Fix:** Scope events by Site (filter `auditLog.siteCode` against `ctx.siteScope`); validate `since` is a finite number before constructing Date.

### `/api/itam/events` — GET (SSE)
- **Bug ID:** API-BUG-047
- **Severity:** P1
- **File:** src/app/api/itam/events/route.ts
- **Line:** 30-115
- **Description:** JWT passed as `?token=` query param. EventSource can't set headers, so this is a known tradeoff — but tokens in URLs are logged in proxy logs, browser history, referer headers, and analytics tools. Long-lived (6h) JWT in URL = high leak risk.
- **Fix:** Issue a short-lived (5-min) SSE-only token via a POST endpoint; pass it via `?token=`; refresh on reconnect.

### `/api/itam/devices/bulk` — POST
- **Bug ID:** API-BUG-048
- **Severity:** P0
- **File:** src/app/api/itam/devices/bulk/route.ts
- **Line:** 70-73, 103-115
- **Description:** Two bugs: (1) `targets = await db.device.findMany({ where: { assetNo: { in: assetNos } } })` — Device has no `assetNo` column (it's `assetCode`); Prisma error → 500. (2) Audit log uses `timestamp`/`user`/`details` (non-existent fields) → Prisma error → silent catch. Also: uses legacy `canAccessSite` (should be `canAtSite`); not wrapped in a transaction (partial updates possible); no `demoTag` for demo users.
- **Fix:** Use `assetCode`; use `logAudit()` helper with correct fields; switch to `canAtSite`; wrap in `$transaction`; add `demoTag(auth.user)`.

### `/api/v1/work-orders` — GET, POST
- **Bug ID:** API-BUG-049
- **Severity:** P0
- **File:** src/app/api/v1/work-orders/route.ts
- **Line:** 69-178 (GET), 181-330 (POST)
- **Description:** GET requires `VIEW_DEVICES` but **NO Site scope** — returns ALL WOs to any authenticated user. POST requires `DEVICE_EDIT` (v0 uses `WO_CREATE` — divergence). POST `generateWoNumber()` has a race condition. POST does NOT set `siteCode` on created WOs (breaks Site scope for all future queries). POST does NOT call `demoTag()` for demo users. POST accepts `picBefore` with no size limit (DoS).
- **Impact:** Cross-site WO data leak; DoS; broken demo-tag isolation.
- **Fix:** Add `buildAuthorizationContext()` + Site filter on GET; align POST permission to `WO_CREATE`; derive `siteCode` from `body.deviceId`; add `demoTag(auth.ctx.user)`; cap `picBefore` size; retry on woNumber collision.

### `/api/v1/work-orders/[id]` — GET, PUT
- **Bug ID:** API-BUG-050
- **Severity:** P0
- **File:** src/app/api/v1/work-orders/[id]/route.ts
- **Line:** 42-82 (GET), 85-262 (PUT)
- **Description:** GET allows guest access via `?reporterTel=` — anyone who knows the WO id + reporter's phone can read the WO including `messages` and `reviews` (admin-side discussions). GET has no Site scope. PUT uses `DEVICE_EDIT` (v0 uses `WO_ASSIGN`); no Site scope. **Critical:** PUT accepts `body.editUnlockActive=true` from a non-admin caller to bypass the terminal-WO lock (privilege escalation — `isTerminal && !unlockActive && !isAdmin` check passes because `unlockActive` comes from the body). PUT also writes `body.assetNo` (line 149) which doesn't exist on WorkOrder → Prisma error.
- **Impact:** PII leak via guest flow; privilege escalation to edit completed/cancelled WOs; broken field.
- **Fix:** Remove guest access via `reporterTel` (require auth); add Site scope via `loadAuthorizedWorkOrder`; ignore `editUnlockActive` in body (only honor explicit `POST /edit-unlock`); drop `assetNo` from `scalarFields` list.

### `/api/v1/work-orders/[id]/assign` — POST
- **Bug ID:** API-BUG-051
- **Severity:** P1
- **File:** src/app/api/v1/work-orders/[id]/assign/route.ts
- **Line:** 25-102
- **Description:** Uses `ADMIN` OR `DEVICE_EDIT` permission (v0 uses `WO_ASSIGN`). No Site scope. Anyone with `DEVICE_EDIT` can assign any WO regardless of Site.
- **Fix:** Use `WO_ASSIGN`; add Site scope via `loadAuthorizedWorkOrder`.

### `/api/v1/work-orders/[id]/complete` — POST
- **Bug ID:** API-BUG-052
- **Severity:** P1
- **File:** src/app/api/v1/work-orders/[id]/complete/route.ts
- **Line:** 23-96
- **Description:** Uses `DEVICE_EDIT` (v0 uses `WO_COMPLETE`). No Site scope. Audit log missing `siteCode`.
- **Fix:** Use `WO_COMPLETE`; add Site scope.

### `/api/v1/work-orders/[id]/cancel` — POST
- **Bug ID:** API-BUG-053
- **Severity:** P1
- **File:** src/app/api/v1/work-orders/[id]/cancel/route.ts
- **Line:** 24-87
- **Description:** Uses `DEVICE_EDIT` (v0 uses `WO_CANCEL`). No Site scope.
- **Fix:** Use `WO_CANCEL`; add Site scope.

### `/api/v1/work-orders/[id]/messages` — GET, POST
- **Bug ID:** API-BUG-054
- **Severity:** P1
- **File:** src/app/api/v1/work-orders/[id]/messages/route.ts
- **Line:** 38-66 (GET), 69-146 (POST)
- **Description:** GET uses `VIEW_DEVICES` (v0 uses `WO_VIEW_ALL`). No Site scope. POST allows guest access via `?reporterTel=` — anyone with WO id + reporter's phone can post messages on the WO. Audit log missing `siteCode`.
- **Fix:** Use `WO_VIEW_ALL`; require auth (no guest); add Site scope.

### `/api/v1/work-orders/[id]/review` — POST
- **Bug ID:** API-BUG-055
- **Severity:** P1
- **File:** src/app/api/v1/work-orders/[id]/review/route.ts
- **Line:** 28-124
- **Description:** Allows guest (no auth) to submit a review on any completed WO. The unique constraint on `WorkOrderReview.workOrderId` enforces one review per WO — so a malicious guest can "review-bomb" a WO before the legitimate reporter gets a chance, denying them the ability to review.
- **Fix:** Require auth OR validate `reporterTel` like the messages endpoint; OR only allow the WO's `reporterEmail` user to review.

### `/api/work-orders` — POST
- **Bug ID:** API-BUG-056
- **Severity:** P1
- **File:** src/app/api/work-orders/route.ts
- **Line:** 105-117, 401-431, 505-511, 551-554, 599-623
- **Description:** Multiple issues:
  - `generateWoNumber()` has a race condition (5 retry attempts, but each has the same findUnique-then-create window).
  - Idempotency-key (`clientMutationId`/`requestId`) check has a race: two concurrent requests with the same key can both pass `findFirst` and create duplicate WOs. No unique index on `requestId`.
  - `actor` field is body-controlled for guest flow (line 551-554): a guest can supply `actor: "admin@example.com"` to spoof the audit log.
  - `picBefore` / `picBeforeImages` accept base64 data URLs with NO size limit (only the per-image cap of 9 images, no per-image byte limit). A 100MB image will be stored in SQLite.
  - `subject` / `details` have no length cap — a 10MB subject works.
- **Fix:** Add a unique index on `workOrder.requestId`; wrap the create+audit in a transaction; ignore body.actor and use `staffUser?.email ?? finalReporterName ?? 'guest'` for the actor; cap `picBefore` to 1.5MB (matching the images endpoint) and `subject`/`details` to 1KB / 10KB.

### `/api/work-orders` — GET
- **Bug ID:** API-BUG-057
- **Severity:** P2
- **File:** src/app/api/work-orders/route.ts
- **Line:** 306-313
- **Description:** Error response includes `detail: err.stack?.split('\n').slice(0, 3).join(' | ')` — leaks stack trace to client. Useful for debugging but should be off in production.
- **Fix:** In production (`NODE_ENV === 'production'`), omit `detail` or replace with a request ID.

### `/api/work-orders/[id]` — GET, PUT
- **Bug ID:** API-BUG-058
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/route.ts
- **Line:** 45 (GET), 117 (PUT)
- **Description:** GET first calls `requireAuth(req, 'WO_VIEW_ALL')` — this rejects viewers who have only `WO_VIEW_OWN` even though `loadAuthorizedWorkOrder` with `{ allowOwn: true }` is supposed to allow them to view their own WOs. PUT first calls `requireAuth(req, 'WO_COMPLETE')` but then `loadAuthorizedWorkOrder` checks `WO_ASSIGN` — the comment says "editing requires WO_ASSIGN" but the first check requires WO_COMPLETE (too strict for assigners who don't have complete). Both are redundant-with-wrong-perm checks; the call to `loadAuthorizedWorkOrder` already does the right check internally.
- **Impact:** RBAC regression — viewers can't see their own WOs; assigners can't edit.
- **Fix:** Remove the redundant first `requireAuth(req, ...)` call. `loadAuthorizedWorkOrder` calls `requireAuth(req)` (no perm) internally and then checks `canAtSite(woSite, permission)`. Drop the duplicate.

- **Bug ID:** API-BUG-059
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/route.ts
- **Line:** 157-160
- **Description:** PUT accepts `body.status` and sets it directly (if in `VALID_STATUSES`). This bypasses the dedicated `complete` / `cancel` endpoints, which enforce additional rules (pending parts check, cancel reason, completion message). A user with WO_ASSIGN can flip status to `COMPLETED` without resolving pending parts or setting `closedAt`.
- **Fix:** Drop `status` from the PUT editable fields; require clients to use `/complete` or `/cancel`.

### `/api/work-orders/[id]/assign` — POST
- **Bug ID:** API-BUG-060
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/assign/route.ts
- **Line:** 36
- **Description:** First line: `const auth = await requireAuth(req, 'WO_CREATE')` — wrong permission. Comment says "assigning requires WO_ASSIGN at its Site". A user with only `WO_ASSIGN` (not WO_CREATE) gets 403. The follow-up `loadAuthorizedWorkOrder(req, id, 'WO_ASSIGN')` is the correct check.
- **Fix:** Replace `requireAuth(req, 'WO_CREATE')` with `requireAuth(req, 'WO_ASSIGN')` OR drop the redundant call (let `loadAuthorizedWorkOrder` handle it).

### `/api/work-orders/[id]/complete` — POST
- **Bug ID:** API-BUG-061
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/complete/route.ts
- **Line:** 38
- **Description:** Same pattern: `requireAuth(req, 'WO_CREATE')` first, then `loadAuthorizedWorkOrder(req, id, 'WO_COMPLETE')`. Wrong redundant perm.
- **Fix:** Use `WO_COMPLETE` for the first check (or drop the redundant call).

### `/api/work-orders/[id]/cancel` — POST
- **Bug ID:** API-BUG-062
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/cancel/route.ts
- **Line:** 37
- **Description:** Same pattern: `requireAuth(req, 'WO_CREATE')` first, then `loadAuthorizedWorkOrder(req, id, 'WO_CANCEL')`. Wrong redundant perm.
- **Fix:** Use `WO_CANCEL`.

### `/api/work-orders/[id]/messages` — GET, POST
- **Bug ID:** API-BUG-063
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/messages/route.ts
- **Line:** 36 (GET), 68 (POST)
- **Description:** GET: `requireAuth(req, 'WO_VIEW_ALL')` blocks viewers with only `WO_VIEW_OWN` from reading messages on their own WOs. POST: `requireAuth(req, 'WO_CREATE')` blocks reporters from posting messages on their own WOs. The follow-up `loadAuthorizedWorkOrder` with `{ allowOwn: true }` was supposed to enable this.
- **Fix:** Drop the redundant first `requireAuth` call.

### `/api/work-orders/[id]/images` — POST, DELETE
- **Bug ID:** API-BUG-064
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/images/route.ts
- **Line:** 125 (POST), 219 (DELETE)
- **Description:** POST: `requireAuth(req, 'WO_CREATE')` first; should be `WO_ASSIGN`. DELETE: `requireAuth(req, 'WO_CANCEL')` first; should be `WO_ASSIGN` (matches `loadAuthorizedWorkOrder`). Also POST doesn't validate MIME type of `image_data` — accepts any base64 string.
- **Fix:** Use `WO_ASSIGN` for both; validate that `image_data` starts with `data:image/` prefix.

### `/api/work-orders/[id]/parts` — POST
- **Bug ID:** API-BUG-065
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/parts/route.ts
- **Line:** 105
- **Description:** `requireAuth(req, 'WO_CREATE')` first; should be `WO_ASSIGN` per the comment on line 97.
- **Fix:** Use `WO_ASSIGN`.

- **Bug ID:** API-BUG-066
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/parts/route.ts
- **Line:** 186-203
- **Description:** `txnNumber` generation has a race condition: two concurrent requests could both compute `max+1` and try to insert the same `SP-YYYYMMDD-001` number. The transaction wraps the insert, but the `findMany` happens inside the transaction — with default isolation (READ COMMITTED in PG, SERIALIZABLE not set), both transactions see the same set of existing txns and both pick the same next number. The unique constraint on `txnNumber` would catch the second one (need to verify it's @unique), but the error handling doesn't gracefully retry.
- **Fix:** Use a DB sequence, OR catch the unique-constraint error and retry with `max+2`, OR use `withSerializableRetry`.

### `/api/work-orders/[id]/parts/[txnId]/approve` — POST
- **Bug ID:** API-BUG-067
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/parts/[txnId]/approve/route.ts
- **Line:** 22
- **Description:** `requireAuth(req, 'WO_CREATE')` first; should be `STOCK_APPROVE` per the comment on line 14.
- **Fix:** Use `STOCK_APPROVE`.

- **Bug ID:** API-BUG-068
- **Severity:** P1
- **File:** src/app/api/work-orders/[id]/parts/[txnId]/approve/route.ts
- **Line:** 118-138
- **Description:** Auto-close logic: if `remainingPending === 0 && wo.status === 'WAITING_PARTS'`, auto-closes the WO. But this doesn't check `wo.assignedTo` — an unassigned WO that was never being worked on can be auto-closed by approving its parts. Also no notification to the reporter that the WO was auto-completed.
- **Fix:** Add `wo.assignedTo` check (only auto-close if assigned); send `notifyWorkOrderCompleted` on auto-close.

### `/api/work-orders/[id]/print-template` — PATCH
- **Bug ID:** API-BUG-069
- **Severity:** P0
- **File:** src/app/api/work-orders/[id]/print-template/route.ts
- **Line:** 33-35
- **Description:** Uses `loadAuthorizedWorkOrder(req, id, 'WO_VIEW_ALL', { allowOwn: true })` for a MUTATION (PATCH). This means any user with `WO_VIEW_OWN` (e.g. a meter reader who reported a WO) can change the `printTemplateId` on their own WO. Worse: `body.setAsDefault=true` lets them promote a template to be the default for ALL work orders of that type — a privilege escalation that affects other users' WOs.
- **Impact:** Privilege escalation: a viewer-tier user can change global print-template defaults.
- **Fix:** Use `WO_ASSIGN` (or `PRINT`); require `SYSTEM_CONFIG` for `setAsDefault=true`.

### `/api/work-orders/[id]/reporter-edit` — PUT
- **Bug ID:** API-BUG-070
- **Severity:** P2
- **File:** src/app/api/work-orders/[id]/reporter-edit/route.ts
- **Line:** 55
- **Description:** `requireAuth(req, 'WO_COMPLETE')` first; should be `WO_ASSIGN` per the comment on line 9. A user with only `WO_ASSIGN` (not WO_COMPLETE) gets 403.
- **Fix:** Use `WO_ASSIGN`.

### `/api/work-orders/[id]/print` — GET
- **Bug ID:** API-BUG-071
- **Severity:** P2
- **File:** src/app/api/work-orders/[id]/print/route.ts
- **Line:** ~740 (HTML generation)
- **Description:** `imgBefore` / `imgOnsite` / `imgAfter` are inserted directly into `<img src="${esc(imgBefore)}" />` without URL-scheme validation. `esc()` escapes HTML entities but doesn't prevent `javascript:` URLs. If a user uploaded `javascript:alert(1)` as image data (via the images endpoint — though that validates stage, not scheme), it would execute when the print page is opened. Low risk in practice (the images endpoint stores base64 data URLs), but defense-in-depth is missing.
- **Fix:** Validate `imgBefore.startsWith('data:image/')` before emitting the `<img>` tag.

### `/api/itam/auth/users` — POST, PUT, DELETE
- **Bug ID:** API-BUG-072
- **Severity:** P1
- **File:** src/app/api/itam/auth/users/route.ts + [id]/route.ts
- **Line:** 62-114 (POST), 9-65 (PUT), 67-88 (DELETE)
- **Description:** No audit log for any user mutation (create/update/delete). User-management actions are exactly what audit logs are for. Also POST has no password length validation (register route requires ≥6 chars). POST defaults `allowedSites` to `'ALL'` if not specified — creating a non-superadmin with `allowedSites='ALL'` is the exact anti-pattern `validateProductionAuthzConfig()` flags.
- **Fix:** Call `logAudit('USER_CREATE'/'USER_UPDATE'/'USER_DELETE', 'User', id, summary, detail, auth.user.email)` after each mutation. Validate `password.length >= 6`. Require explicit `allowedSites` for non-superadmin (reject `'ALL'` unless caller is superadmin).

### `/api/users` (legacy) — GET, POST, PUT
- **Bug ID:** API-BUG-073
- **Severity:** P1
- **File:** src/app/api/users/route.ts
- **Line:** 106-111 (requireAdmin), 200-294 (POST), 258-269 (create data)
- **Description:** Uses LEGACY `getCurrentUser(req)` (base64 session cookie) instead of JWT `requireAuth`. Inconsistent auth with the rest of the app. `requireAdmin` checks `user.role === 'admin'` OR `user.permissions.includes('*')` — doesn't use the `USER_MANAGE` permission. POST does NOT hash password (`passwordHash`/`passwordSalt` not set in create data) — users created here cannot log in. GET leaks full user list (email, role, allowedSites, lastLoginAt, customPermissions) to anyone passing the `requireAdmin` check.
- **Fix:** Migrate to JWT `requireAuth(req, 'USER_MANAGE')`; hash password with `hashNewPassword()`; remove this legacy route and migrate clients to `/api/itam/auth/users`.

### `/api/itam/devices/[id]` — GET, PUT, DELETE
- **Bug ID:** API-BUG-074
- **Severity:** P1
- **File:** src/app/api/itam/devices/[id]/route.ts
- **Line:** 28, 51-56, 136
- **Description:** Uses `canAccessSite(user, device.site)` (legacy union check) instead of `ctx.canAtSite(device.site, 'DEVICE_EDIT')`. The Phase 1 B1 fix migrated other routes to `canAtSite` (which checks the role AT the target Site only, not the union). This route was missed — a user with `admin` role at Site A and `viewer` at Site B can edit devices at Site B (because the union includes `DEVICE_EDIT` from Site A's admin role).
- **Fix:** Switch to `buildAuthorizationContext()` + `ctx.canAtSite(device.site, 'DEVICE_EDIT'/'DEVICE_DELETE')`.

### `/api/itam/devices/[id]/transfer` — POST
- **Bug ID:** API-BUG-075
- **Severity:** P1
- **File:** src/app/api/itam/devices/[id]/transfer/route.ts
- **Line:** 55, 62
- **Description:** Same legacy `canAccessSite` usage as API-BUG-074. Should use `ctx.canAtSite(site, 'DEVICE_TRANSFER')`.
- **Fix:** Switch to `canAtSite`.

### `/api/itam/devices` — POST
- **Bug ID:** API-BUG-076
- **Severity:** P1
- **File:** src/app/api/itam/devices/route.ts
- **Line:** 106, 110-141
- **Description:** Uses `canAccessSite` (legacy union) for site check. Does NOT call `demoTag(auth.user)` — demo users' device creations aren't tagged `isDemo: true`, so `/api/itam/demo/reset` won't clean them up.
- **Fix:** Switch to `ctx.canAtSite(body.site, 'DEVICE_EDIT')`; add `...demoTag(auth.user)` to the create data.

### `/api/itam/dashboard` — GET
- **Bug ID:** API-BUG-077
- **Severity:** P1
- **File:** src/app/api/itam/dashboard/route.ts
- **Line:** 31-32, throughout
- **Description:** Uses `siteFilterForUser(user)` (legacy union) and `getAllowedSites(user)` — should use `buildAuthorizationContext()` + `ctx.siteWhere()`. Also `db.device.findMany({ where: { site: { in: visibleSiteNames } }, select: { assetCode, site } })` (line 191) loads every device row at the visible sites — could be thousands of rows for performance regression.
- **Fix:** Switch to `buildAuthorizationContext()` + `ctx.siteWhere()`; replace the device→site map query with a `groupBy` on `device.site`.

### `/api/itam/meter-readings` — GET, POST
- **Bug ID:** API-BUG-078
- **Severity:** P1
- **File:** src/app/api/itam/meter-readings/route.ts
- **Line:** 44 (GET), 103 (POST)
- **Description:** GET uses `siteFilterForUser(user)` (legacy union). POST uses `canAccessSite(user, device.site)` (legacy union). Should use `ctx.canAtSite(device.site, 'METER_WRITE')` per the B1 fix.
- **Fix:** Switch to `buildAuthorizationContext()` + `ctx.canAtSite()`.

### `/api/itam/stock` — GET, POST
- **Bug ID:** API-BUG-079
- **Severity:** P1
- **File:** src/app/api/itam/stock/route.ts
- **Line:** 33 (GET), 75 (POST)
- **Description:** Uses `siteFilterForUser(user)` (legacy union). POST permission is `DEVICE_EDIT` — should probably be `STOCK_IN` or `STOCK_VIEW` for GET, `STOCK_IN`/`MASTER_DATA_EDIT` for POST. POST `productCode` generation: `\`STK-${String((await db.stockItem.count()) + 1).padStart(4, '0')}\`` — race condition (two concurrent creates get same count → same code → unique constraint error).
- **Fix:** Switch to `buildAuthorizationContext()` + `ctx.siteWhere()`; use `STOCK_VIEW`/`STOCK_IN`; use a DB sequence or retry on collision.

### `/api/itam/search` — GET
- **Bug ID:** API-BUG-080
- **Severity:** P1
- **File:** src/app/api/itam/search/route.ts
- **Line:** 20, 55
- **Description:** Uses `siteFilterForUser(user)` (legacy union). Also `user.role !== 'admin' && user.role !== 'superadmin'` is a case-sensitive string comparison — `'Admin'` (capitalized) would not match. Should use `isAdminRole(user.role)` from `auth-shared.ts`.
- **Fix:** Switch to `buildAuthorizationContext()` + `ctx.siteWhere()`; use `isAdminRole(user.role)`.

### `/api/master` — GET
- **Bug ID:** API-BUG-081
- **Severity:** P1
- **File:** src/app/api/master/route.ts
- **Line:** 68-82
- **Description:** Uses `parseAllowedSites(auth.user.allowedSites)` (legacy) for site scoping on `buildings`/`floors`/`locations` queries. Should use `buildAuthorizationContext()` + `ctx.canAtSite()`.
- **Fix:** Switch to authorization-context-based scoping.

### `/api/sites` — POST
- **Bug ID:** API-BUG-082
- **Severity:** P1
- **File:** src/app/api/sites/route.ts
- **Line:** 66-76, 99
- **Description:** Fallback auth pattern is broken: `const auth = await requireAuth(req, 'MASTER_DATA_EDIT')`; if fails, `const auth2 = await requireAuth(req, 'SYSTEM_CONFIG')`. If `auth2.ok` succeeds, the code proceeds — but `auth` is still the failed result. Line 99: `auth.ok ? auth.user.email : 'system'` → `'system'` (the actual user is lost). The mutation succeeds but the audit log attributes it to `'system'`.
- **Fix:** Use `auth2.ok ? auth2.user.email : 'system'` in the audit log; or restructure to use a single `requireAuth` with multiple acceptable permissions.

### `/api/itam/sites` — GET
- **Bug ID:** API-BUG-083
- **Severity:** P2
- **File:** src/app/api/itam/sites/route.ts
- **Line:** 13, 18, 20-28
- **Description:** (1) Uses `getAllowedSites(user)` (legacy union). (2) Filters visible sites by `userSites.includes(s.siteName || '')` — matches against `SiteName` (Thai name) instead of `SiteCode`. If the user's `allowedSites` contains codes (`'UDH'`) and the SiteAttribute has `SiteName='โรงพยาบาล...'`, the match fails → user sees no sites. (3) N+1 query: for each visible site, runs 2 `device.count` queries (10 sites × 2 = 20 queries).
- **Fix:** Switch to `ctx.siteScope`; match against `SiteCode`; replace the `Promise.all` count loop with a single `db.device.groupBy({ by: ['site'] })` query.

### `/api/itam/devices/bulk` — POST (additional)
- **Bug ID:** API-BUG-084
- **Severity:** P1
- **File:** src/app/api/itam/devices/bulk/route.ts
- **Line:** 57, 83, 88-99
- **Description:** Uses `canAccessSite` (legacy union). Not in a `$transaction` — if device 5 of 10 fails, devices 1-4 are updated but 5-10 are skipped (partial state). No `demoTag(auth.user)` for demo users.
- **Fix:** Use `ctx.canAtSite`; wrap the loop in `$transaction`; add `demoTag`.

### `/api/health` — GET
- **Bug ID:** API-BUG-085
- **Severity:** P1
- **File:** src/app/api/health/route.ts
- **Line:** 4-19
- **Description:** **NO AUTH.** Returns masked DB URL and infrastructure info (whether Supabase pooler, whether Vercel PG, masterItem count, repairTaxonomy count). Also uses `db.$queryRawUnsafe('SELECT COUNT(*)::int as c FROM "RepairTaxonomy"')` — PostgreSQL-specific cast syntax (`::int`) that won't work on SQLite (the sandbox DB). The try/catch swallows the SQLite error silently.
- **Fix:** Add `requireAuth(req, 'SYSTEM_CONFIG')` OR remove from public exposure; replace `$queryRawUnsafe` with a Prisma model query that works on both DBs.

### `/api/line/webhook` — POST
- **Bug ID:** API-BUG-086
- **Severity:** P1
- **File:** src/app/api/line/webhook/route.ts
- **Line:** 317-327, 122-149
- **Description:** When `line_channel_secret` is unset AND `NODE_ENV !== 'production'`, the webhook accepts requests without signature verification. In dev/staging/preview environments, anyone can POST fake LINE webhook events → create work orders, spam users via the bot. Also `generateWoNumber()` has a race condition (same as API-BUG-056).
- **Fix:** Reject unsigned requests in ALL environments (fail-closed); log a clear error if secret is missing. Use a DB sequence for `woNumber`.

### `/api/cron/keepalive` — GET
- **Bug ID:** API-BUG-087
- **Severity:** P1
- **File:** src/app/api/cron/keepalive/route.ts
- **Line:** 16-19
- **Description:** `if (authHeader !== \`Bearer ${process.env.CRON_SECRET}\`)` — if `CRON_SECRET` is unset, `process.env.CRON_SECRET` is `undefined`, so the comparison becomes `authHeader !== 'Bearer undefined'`. An attacker who knows the secret is unset can pass `Authorization: Bearer undefined` to bypass. Also doesn't use `crypto.timingSafeEqual` — vulnerable to timing attacks.
- **Fix:** Reject if `!process.env.CRON_SECRET` (fail-closed when unset); use `crypto.timingSafeEqual` for the comparison.

### `/api/stock-items/[id]/transaction` — POST
- **Bug ID:** API-BUG-088
- **Severity:** P1
- **File:** src/app/api/stock-items/[id]/transaction/route.ts
- **Line:** 67-70 (auth per type)
- **Description:** Solid transactional logic with idempotency key, but: (1) No Site scope check on the `StockItem` — a user with `STOCK_IN` at Site A can transact stock at Site B. (2) Audit log omits `actor` — `logAudit(action, entity, id, summary, detail)` defaults to `'system'`. (3) Dead code: `nextTxnNumber` function defined at top (lines 23-40) is never used (the actual number generation is duplicated inside the transaction at lines 121-140).
- **Fix:** Add Site scope check (`ctx.canAtSite(stockItem.site, permission)`); pass `actor: auth.user.email` to `logAudit`; remove the dead `nextTxnNumber` function.

### `/api/settings/contact-directory` — GET, POST
- **Bug ID:** API-BUG-089
- **Severity:** P2
- **File:** src/app/api/settings/contact-directory/route.ts
- **Line:** 42 (GET), 66 (POST)
- **Description:** Inconsistent permissions: GET uses `VIEW_DEVICES` (very broad — any viewer can see the contact directory including phone numbers); POST uses `ADMIN`. Should be `VIEW_DEVICES`/`MASTER_DATA_EDIT` or `USER_MANAGE` for both. GET returns `phone_primary` and `employee_code` — PII that should be more tightly gated.
- **Fix:** Use `USER_MANAGE` for both GET and POST; or `MASTER_DATA_EDIT` for POST and `VIEW_DEVICES` for GET (current) but redact phone for non-admins.

### `/api/templates` — GET
- **Bug ID:** API-BUG-090
- **Severity:** P2
- **File:** src/app/api/templates/route.ts
- **Line:** 21
- **Description:** GET requires `TEMPLATES_MANAGE` (a write permission) for a read-only list. A user who only needs to view templates (e.g. to pick one for printing) can't.
- **Fix:** Use `PRINT` or `VIEW_DEVICES` for GET; keep `TEMPLATES_MANAGE` for POST.

### `/api/notifications` — GET (additional)
- **Bug ID:** API-BUG-091
- **Severity:** P2
- **File:** src/app/api/notifications/route.ts
- **Line:** 71-269
- **Description:** Returns ALL notifications (no pagination, no `?page=` param). With many devices, the warranty + meter-reminder lists could be huge — DoS risk. Also fetches `db.device.findMany()` (all devices) at line 76 without pagination.
- **Fix:** Add `requireAuth` (per API-BUG-017); add pagination (`?page=&limit=`); scope by Site; limit the `db.device.findMany` to the user's visible sites.

### `/api/auth/oauth/telegram` — GET
- **Bug ID:** API-BUG-092
- **Severity:** P2
- **File:** src/app/api/auth/oauth/telegram/route.ts
- **Line:** 47-49
- **Description:** On error, returns 200 with `{ configured: false }` — masks infrastructure issues. Should return 500 in production so monitoring catches it.
- **Fix:** Return 500 on error in production; keep 200 for graceful degradation in dev.

### `/api/auth/oauth/status` — GET
- **Bug ID:** API-BUG-093
- **Severity:** P2
- **File:** src/app/api/auth/oauth/status/route.ts
- **Line:** 43-49
- **Description:** On error, returns 200 with all providers set to `false` — masks config issues. The login page would then hide all OAuth buttons even if the issue is transient (DB down).
- **Fix:** Return 500 on actual errors; only return 200 with `false` values when the DB query succeeds but no providers are configured.

---

## Cross-cutting issues

### Missing audit-log `actor` (defaults to `'system'`)
The following mutation routes call `logAudit()` without passing the `actor` argument, so every entry is attributed to `'system'`:
- `/api/devices/[id]` PUT/DELETE (API-BUG-028)
- `/api/devices/[id]/assign` POST
- `/api/devices/[id]/return` POST
- `/api/cycles` POST (API-BUG-037)
- `/api/cycles/[id]` PUT/DELETE
- `/api/stock-items` POST (API-BUG-041)
- `/api/purchase-orders` POST (API-BUG-042)
- `/api/site-rates` POST (API-BUG-020)
- `/api/stock-items/[id]/transaction` POST (API-BUG-088)
- `/api/itam/devices` POST (audit log block uses `user.email` correctly — actually OK)

### Audit log uses non-existent fields (Prisma error every time)
The following routes write `db.auditLog.create({ data: { timestamp, action, user, details } })` — but `AuditLog` has `createdAt` (DB default), `actor`, `detail` (singular). Prisma throws `Unknown arg`, caught by try/catch, audit silently fails:
- `/api/itam/auth/logout` (API-BUG-004)
- `/api/auth/oauth/google/callback` (API-BUG-005)
- `/api/auth/oauth/line/callback` (API-BUG-010)
- `/api/itam/devices/bulk` (API-BUG-048)

### Race conditions in sequence number generation
The following generate sequential IDs by `findMax + 1` without a unique constraint retry:
- `/api/work-orders` POST `generateWoNumber()` (API-BUG-056)
- `/api/work-orders/[id]/parts` POST `txnNumber` (API-BUG-066)
- `/api/stock-items` POST `nextProductCode()` (API-BUG-041)
- `/api/itam/stock` POST `productCode = STK-${count+1}` (API-BUG-079)
- `/api/purchase-orders` POST `nextPoNumber()` (API-BUG-042)
- `/api/line/webhook` `generateWoNumber()` (API-BUG-086)
- `/api/v1/work-orders` POST `generateWoNumber()` (API-BUG-049)

### Missing `demoTag()` on demo-user mutations
The following routes don't call `demoTag(auth.user)`, so demo-user-created records aren't tagged `isDemo: true` and won't be cleaned up by `/api/itam/demo/reset`:
- `/api/itam/devices` POST (API-BUG-076)
- `/api/itam/devices/bulk` POST (API-BUG-084)
- `/api/v1/work-orders` POST (API-BUG-049)
- `/api/v1/work-orders/[id]` PUT
- `/api/line/webhook` (creates WOs without `isDemo` tag)
- `/api/stock-items` POST
- `/api/itam/stock` POST
- `/api/purchase-orders` POST
- `/api/cycles` POST

### Legacy `canAccessSite` / `siteFilterForUser` instead of `canAtSite` (B1 fix not applied)
The Phase 1 B1 fix migrated some routes to `canAtSite` (per-Site role check), but these routes were missed and still use the legacy union check, allowing privilege escalation (admin at Site A editing devices at Site B where they're viewer):
- `/api/itam/devices` GET/POST (API-BUG-076)
- `/api/itam/devices/[id]` GET/PUT/DELETE (API-BUG-074)
- `/api/itam/devices/[id]/transfer` POST (API-BUG-075)
- `/api/itam/devices/bulk` POST (API-BUG-084)
- `/api/itam/dashboard` GET (API-BUG-077)
- `/api/itam/meter-readings` GET/POST (API-BUG-078)
- `/api/itam/stock` GET/POST (API-BUG-079)
- `/api/itam/search` GET (API-BUG-080)
- `/api/master` GET (API-BUG-081)
- `/api/meter` GET/POST (delegated POST is OK)

### Missing `siteCode` in audit log entries
Many `logAudit()` calls don't pass the `siteCode` argument, so the `AuditLog.siteCode` column (added per NF-2 fix for fast Site-scoped audit queries) stays null. This forces audit queries to JOIN entity → Site, causing N+1 patterns:
- Most WO routes (parts approve passes it; assign/complete/cancel do)
- `/api/cycles` POST
- `/api/devices/[id]` PUT/DELETE
- `/api/stock-items` POST
- `/api/stock-items/[id]/transaction` POST

### Hardcoded credentials / secrets in code
- `/api/itam/debug` (API-BUG-012): hardcoded `'P@ssw0rd!2025'` and `'1234'` as password test values — these may be real user passwords.
- `/home/z/my-project/src/lib/auth.ts:121`: dev fallback JWT secret `'itam-dev-secret-change-me-in-production-please-32bytes'` — fine for dev, but if `NODE_ENV` is not `'production'` and `JWT_SECRET` is unset, this is the production secret. The `if (NODE_ENV === 'production') throw` guard helps, but misconfigured deploys (e.g. `NODE_ENV=development` in prod) would silently use the dev secret.

### Sensitive data in URL query strings
- `/api/auth/oauth/google/callback` (API-BUG-007): JWT + user JSON in URL.
- `/api/auth/oauth/line/callback` (API-BUG-011): same.
- `/api/itam/events` SSE (API-BUG-047): JWT in `?token=`.
- `/api/auth/verify-token`: token in `?token=` query param (acceptable — it's a short-lived verification token).

### Timezone issues
- `/api/cycles` POST (line 23): `new Date().toISOString().slice(0, 10)` uses UTC date — a cycle created at 23:00 ICT (16:00 UTC) would have the wrong "today" date. Same pattern in many other routes.
- `/api/notifications` GET: `new Date()` for "today" comparison uses local time but `warrantyEnd` is parsed as UTC `T00:00:00` — off-by-one for warranties ending "today" in ICT.

### CSRF
- All state-changing endpoints use Bearer-token auth (not cookies) for the JWT path — CSRF-safe by design.
- Legacy `/api/auth/login` sets a cookie (`itam-session`) but doesn't validate CSRF tokens. Since the cookie is `SameSite=Lax`, cross-site POST is blocked by the browser — mostly safe but not fully.
- `/api/users` legacy uses the cookie session — `SameSite=Lax` provides CSRF protection for POST/PUT.

### SQL injection
- All queries use Prisma's parameterized API — no raw string interpolation. **No SQL injection found.**
- `/api/health` uses `db.$queryRawUnsafe('SELECT COUNT(*)::int as c FROM "RepairTaxonomy"')` — no parameters, no injection risk, but the syntax is PostgreSQL-specific (broken on SQLite).

### XSS via stored data
- Stored fields like `subject`, `details`, `reporterName`, `resolution` are HTML-escaped via `esc()` in the print endpoints (good).
- But `/api/work-orders/[id]/print` (API-BUG-071) doesn't validate the URL scheme of `imgBefore` etc. — a `javascript:` URL could execute.
- The message endpoint stores user-supplied `message` text — when displayed in the LINE reply (line 90-91 of `/api/line/reply`), it's interpolated into a plain-text LINE message (no HTML context) — safe.

---

## Recommendation: prioritized fix order

### Phase 1 — Critical security (P0, do immediately)
1. **Delete or hard-gate `/api/itam/debug`** (API-BUG-012) — leaks password hashes.
2. **Add auth to `/api/settings`** root GET/PUT (API-BUG-018) — leaks all integration secrets.
3. **Add auth to `/api/line/reply`** (API-BUG-013) — spam vector.
4. **Add auth to `/api/notifications/send`** (API-BUG-014) — spam vector.
5. **Add auth to `/api/audit` and `/api/audit/log`** (API-BUG-015, API-BUG-016) — audit trail integrity.
6. **Fix `/api/auth/login` legacy password check** (API-BUG-001) — auth bypass.
7. **Replace `/api/auth/me` legacy base64 session with JWT** (API-BUG-002) — cookie forgery.
8. **Add auth to `/api/site-attributes` and `/api/site-rates`** (API-BUG-019, API-BUG-020) — token leak + billing tampering.
9. **Add auth to `/api/devices/[id]` GET/PUT/DELETE** (API-BUG-026) — full device CRUD bypass.
10. **Add auth to `/api/devices/[id]/assign|return|transfer` and `/api/devices/warranty|utilization|lifecycle`** (API-BUG-029 to API-BUG-034).
11. **Add auth to `/api/cycles`, `/api/cycles/[id]`, `/api/cycles/[id]/report`** (API-BUG-037 to API-BUG-040).
12. **Add auth to `/api/stock-items`, `/api/purchase-orders`, `/api/notifications`, `/api/seed`, `/api/search`, `/api/settings/org-profile|options|wo-patterns|asset-patterns`** (API-BUG-017, API-BUG-020-025, API-BUG-041-044).
13. **Fix AuditLog field names** in `/api/itam/auth/logout`, `/api/auth/oauth/google/callback`, `/api/auth/oauth/line/callback`, `/api/itam/devices/bulk` (API-BUG-004, 005, 010, 048).
14. **Fix `/api/v1/work-orders/*` Site scope + `editUnlockActive` privilege escalation** (API-BUG-049, 050).
15. **Fix `/api/work-orders/[id]/print-template` PATCH permission** (API-BUG-069).

### Phase 2 — Functional bugs (P1)
16. Remove redundant `requireAuth(req, 'WO_CREATE')` from WO mutation routes (API-BUG-058 to API-BUG-067).
17. Migrate `/api/itam/devices`, `/api/itam/devices/[id]`, `/api/itam/devices/[id]/transfer`, `/api/itam/devices/bulk`, `/api/itam/dashboard`, `/api/itam/meter-readings`, `/api/itam/stock`, `/api/itam/search`, `/api/master`, `/api/meter` from legacy `canAccessSite`/`siteFilterForUser` to `ctx.canAtSite`/`ctx.siteWhere()` (API-BUG-074 to API-BUG-081).
18. Add audit logging to `/api/itam/auth/users` POST/PUT/DELETE (API-BUG-072).
19. Add `demoTag()` to all demo-user mutation routes (cross-cutting).
20. Add `actor` to all `logAudit()` calls (cross-cutting).
21. Fix race conditions in sequence number generation (cross-cutting).
22. Fix `/api/cycles/[id]` GET field names (`cycleId`→date range, `delta`→`pagesBw+pagesColor`) (API-BUG-039).
23. Fix `/api/cycles/[id]/report` GET field names + add auth (API-BUG-040).
24. Fix `/api/seed` field names + add auth (API-BUG-043).
25. Fix `/api/sites` POST audit actor (API-BUG-082).
26. Fix `/api/itam/devices/bulk` `assetNo`→`assetCode` + transaction + demoTag (API-BUG-048).
27. Fix `/api/v1/work-orders/[id]` PUT `assetNo` field (API-BUG-050).
28. Fix `/api/users` legacy auth + password hashing (API-BUG-073).
29. Fix `/api/stock-items/[id]/transaction` Site scope + actor (API-BUG-088).
30. Fix `/api/cron/keepalive` `Bearer undefined` + timing-safe comparison (API-BUG-087).
31. Fix `/api/line/webhook` signature enforcement in all envs (API-BUG-086).
32. Fix `/api/itam/events` SSE token-in-URL (API-BUG-047).
33. Fix `/api/health` PostgreSQL-specific query + add auth (API-BUG-085).
34. Fix `/api/work-orders` POST race conditions + image size limits + actor spoofing (API-BUG-056).
35. Fix `/api/work-orders/[id]` PUT `body.status` bypass (API-BUG-059).
36. Fix `/api/work-orders/[id]/parts/[txnId]/approve` auto-close without assignedTo check (API-BUG-068).

### Phase 3 — Quality (P2)
37. Fix OAuth callback redirect URLs (API-BUG-006).
38. Fix OAuth `lineUserId` overwrite (API-BUG-008, API-BUG-009).
39. Fix `/api/auth/oauth/telegram` and `/api/auth/oauth/status` error handling (API-BUG-092, API-BUG-093).
40. Fix `/api/devices/[id]` PUT assetCode editability (API-BUG-027).
41. Fix `/api/work-orders/[id]/print` URL scheme validation (API-BUG-071).
42. Fix `/api/itam/search` case-sensitive role check (API-BUG-080).
43. Fix `/api/itam/sites` SiteCode-vs-SiteName matching + N+1 (API-BUG-083).
44. Fix `/api/templates` GET permission (API-BUG-090).
45. Fix `/api/settings/contact-directory` permission inconsistency (API-BUG-089).
46. Fix `/api/notifications` pagination (API-BUG-091).
47. Fix `/api/work-orders` GET error stack leak (API-BUG-057).
48. Fix `/api/devices/depreciation` stub vs real schema (API-BUG-035).
49. Fix `/api/work-orders/[id]/reporter-edit` perm (API-BUG-070).
50. Remove dead code: `nextTxnNumber` in stock-items/[id]/transaction, `logAudit` in work-orders/[id]/route.ts.

---

## End of report
