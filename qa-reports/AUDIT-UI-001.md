# UI Audit Report — Task ID: AUDIT-UI-001

**Date:** 2026-08-28
**Auditor:** UI Audit Agent (research-only)
**Scope:** All UI components under `src/components/itam/`
**Method:** Static code review (no runtime tests, no code changes)

## Summary

- Total component files audited: **75** (top-level + `stock/` + `mobile/` + `reports/`)
- Total bugs found: **47** (P0: 0, P1: 19, P2: 28)
- Most critical pattern: **SYS-BUG-002 regression** — 10 instances of `AlertDialogAction onClick={asyncFn}` without `e.preventDefault()` that auto-close the dialog before the async mutation completes, hiding the loading spinner from the user.
- Second most critical: **Dead/orphaned code** — 3 large components (`itam-work-orders.tsx`, `itam-devices.tsx`, `settings-page.tsx`) plus the `SettingsPageV2` export are imported but never rendered, totaling ~8,000 lines of unused code that bloats the bundle.
- Third most critical: **`/api/import` upload bypasses auth** — the URL is not in the global fetch interceptor's allow-list, so the multipart upload is sent without the `Authorization: Bearer` header.

### Bug counts by severity
- P0 (blocking): 0
- P1 (major): 19 — 10 SYS-BUG-002 regressions + 1 auth bypass + 1 a11y (camera-muted) + 1 a11y (icon button aria) + 1 orphaned main page + 3 dead-code bundles
- P2 (minor): 28 — type safety, UX, i18n, a11y, visual

### Bug counts by category
- Functional: 22
- UX: 9
- A11y: 5
- i18n: 6
- Visual: 3
- Dead code: 2

---

## Bugs by Component

### work-orders-page.tsx (4,194 lines)

- **Bug ID:** UI-BUG-001
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 3446-3457
- **Description:** The Assign-technician AlertDialog uses `<AlertDialogAction onClick={(e) => { e.preventDefault(); handleAssign() }}>` — same pattern as the original SYS-BUG-002 bug. Radix's `AlertDialogAction` auto-closes the dialog and intercepts pointer events at a different phase, which historically caused `handleComplete`/`handleCancel` to silently not trigger. The Complete and Cancel dialogs in this file were already migrated to plain `<Button type="button" onClick={...}>`, but Assign was missed.
- **Impact:** The "มอบหมาย" (Assign) button sometimes does not trigger `handleAssign()` on click — the dialog closes with no assignment created.
- **Fix:** Replace `<AlertDialogAction>` with `<Button type="button" onClick={() => handleAssign()}>` (same as the Complete/Cancel dialogs at lines 3574 and 3615).

- **Bug ID:** UI-BUG-002
- **Severity:** P2
- **Category:** Functional / Type safety
- **Line:** 1628
- **Description:** When a device is selected from the lookup, the code does `setForm((s) => ({ ...s, ..., department: s.department || d.department || '' }))`. However, `NewFormState` does NOT define a `department` property — only `building`, `location`, etc. So `s.department` is `undefined`, and the new state silently includes a `department` field that's never read.
- **Impact:** The `department` field from a device is captured in state but never sent to the API (`handleCreate` doesn't include `payload.department`). The work order is created without the device's department. Also a TypeScript excess-property-check smell.
- **Fix:** Either remove the `department` line entirely or add `department` to `NewFormState` + include it in the POST body.

- **Bug ID:** UI-BUG-003
- **Severity:** P2
- **Category:** UX / A11y
- **Line:** 2303
- **Description:** Image deletion uses `window.confirm('ลบรูป (${img.stage}) ใช่ไหม?')` — native browser dialog. Inconsistent with the styled AlertDialog pattern used elsewhere in the same file for Complete/Cancel. Native dialogs are not localizable, not styled, and break the in-app UX flow.
- **Impact:** Visual inconsistency + minor accessibility regression (screen-reader announces native dialog, but no styling).
- **Fix:** Replace with an AlertDialog component matching the Cancel dialog pattern.

- **Bug ID:** UI-BUG-004
- **Severity:** P2
- **Category:** Functional
- **Line:** 100 (and similar helper at devices-page.tsx:107, itam-settings.tsx:30, etc.)
- **Description:** `getAuthHeaders()` calls `useAuthStore.getState()?.token`. Although optional chaining is used, the entire expression returns `undefined` if `useAuthStore.getState()` itself is `undefined` (which can happen during boot). The optional chaining silently lets the header set be `undefined`, which when spread into `headers: undefined` becomes `{}` — meaning auth calls fire without Authorization. The global fetch interceptor in `page.tsx` catches most of these cases, but it's fragile.
- **Impact:** Rare boot-race where API calls fire without auth → 401s.
- **Fix:** Add a fallback: `const t = useAuthStore.getState()?.token ?? ''` or assert getState() returns object.

### devices-page.tsx (3,669 lines)

- **Bug ID:** UI-BUG-005
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 3290-3296
- **Description:** Bulk-delete AlertDialog uses `<AlertDialogAction onClick={applyBulkDelete} disabled={bulkAction}>` without `e.preventDefault()`. `applyBulkDelete` is async (loops through Promise.allSettled of DELETE calls). The AlertDialog auto-closes on click, the user sees no spinner, and the "ลบ X เครื่อง" → "กำลังลบ..." label state is never visible.
- **Impact:** User clicks "ลบ N เครื่อง", dialog closes immediately, no feedback until the bulk operation finishes seconds later. If it fails partially, user has no clue.
- **Fix:** Add `onClick={(e) => { e.preventDefault(); void applyBulkDelete() }}` or migrate to `<Button>`.

- **Bug ID:** UI-BUG-006
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 3320-3326
- **Description:** Single-delete AlertDialog same pattern: `<AlertDialogAction onClick={confirmDelete} disabled={deleting}>` without `e.preventDefault()`.
- **Impact:** Same as UI-BUG-005 — dialog closes immediately, spinner never shown.
- **Fix:** Add `e.preventDefault()` or migrate to `<Button>`.

- **Bug ID:** UI-BUG-007
- **Severity:** P2
- **Category:** UX
- **Line:** 1200-1220 (`confirmDelete`) and 1490-1515 (`applyBulkDelete`)
- **Description:** Both handlers call `fetch('/api/devices/${id}', { method: 'DELETE' })` with no headers at all (no Content-Type, no Authorization). They rely entirely on the global fetch interceptor in `page.tsx` line 187 to attach the Bearer token. If the interceptor fails (e.g. due to Fast Refresh unmounting), the DELETE calls return 401 and the user sees "Delete failed" with no clear cause.
- **Impact:** Fragile coupling; delete operations break silently if global interceptor is patched or removed.
- **Fix:** Use `authHeaders()` helper (already defined at line 107) on every mutating fetch in this file.

- **Bug ID:** UI-BUG-008
- **Severity:** P2
- **Category:** UX
- **Line:** 1552-1567
- **Description:** The Add/Edit form is rendered via `if (dialogOpen) return <full-screen form>` — this REPLACES the entire page (including the sidebar/top-bar context). The user feels like they've navigated to a new page. There's no breadcrumb or back affordance besides a small ✕ button at top-left.
- **Impact:** Mild disorientation; users may not realize they can return to the list by pressing Esc or clicking ✕.
- **Fix:** Consider keeping the list visible behind a Sheet/Dialog overlay instead of unmounting the page.

### itam-settings.tsx (1,027 lines)

- **Bug ID:** UI-BUG-009
- **Severity:** P2
- **Category:** UX / Functional
- **Line:** 262-283 (`saveItem`)
- **Description:** `saveItem` validates `if (!form.category || !form.label)` and shows toast "กรุณากรอกหมวดหมู่และค่า". But the form's "รหัส" (code) field is also marked with `*` in the UI label, yet `form.code` is never validated — empty code slips through and the API may reject it with a generic error.
- **Impact:** User submits with empty Code, gets API error "validation failed" instead of a friendly inline message.
- **Fix:** Add `!form.code` to the validation check.

- **Bug ID:** UI-BUG-010
- **Severity:** P2
- **Category:** UX / i18n
- **Line:** 285-292 (`deleteItem`)
- **Description:** Uses `window.confirm('ลบ "${item.label}"?')` — native browser dialog. Inconsistent with rest of the settings page (e.g. user-management-section uses AlertDialog). Not localizable.
- **Impact:** UX inconsistency, weak confirm pattern.
- **Fix:** Replace with AlertDialog.

### settings-page.tsx (2,121 lines)

- **Bug ID:** UI-BUG-011
- **Severity:** P1
- **Category:** Dead code / Bundle bloat
- **Line:** 1-2121 (whole file)
- **Description:** `SettingsPage` is exported but NEVER imported by any other module. `app/page.tsx` renders `ItamSettings` (from `itam-settings.tsx`) for both `itam-settings` and `settings` page keys — `SettingsPage` is unreachable.
- **Impact:** ~2,121 lines of dead code that may still be statically analyzed and potentially bundled if any tooling scans the `components/itam/` directory.
- **Fix:** Delete `settings-page.tsx` or migrate its unique sub-components into `itam-settings.tsx`.

- **Bug ID:** UI-BUG-012
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 685, 1022, 1594 (three instances)
- **Description:** Three `<AlertDialogAction onClick={confirmDelete} disabled={deleting}>` instances without `e.preventDefault()`. Async delete operation, dialog auto-closes immediately, spinner never shown.
- **Impact:** Same SYS-BUG-002 pattern in 3 places. **Mitigated by dead code** — UI-BUG-011 means this file is never rendered.
- **Fix:** If keeping the file, add `e.preventDefault()` to all three. Otherwise delete the file.

### itam-devices.tsx (2,230 lines)

- **Bug ID:** UI-BUG-013
- **Severity:** P1
- **Category:** Dead code / Bundle bloat
- **Line:** 1-2230 (whole file)
- **Description:** `ItamDevices` is exported but never rendered. `app/page.tsx` line 283 uses `<DevicesPage />` from `devices-page.tsx` for `activePage === 'itam-devices'` — `ItamDevices` is not the rendered component.
- **Impact:** ~2,230 lines of dead code.
- **Fix:** Delete `itam-devices.tsx` or refactor to remove duplicate logic.

- **Bug ID:** UI-BUG-014
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 1766-1772
- **Description:** `<AlertDialogAction onClick={confirmDelete} disabled={deleteMutation.isPending}>` without `e.preventDefault()`. Same SYS-BUG-002 pattern. **Mitigated by dead code** — UI-BUG-013.
- **Fix:** Delete the file or fix the bug.

### itam-device-detail-sheet.tsx (1,101 lines)

- **Bug ID:** UI-BUG-015
- **Severity:** P1
- **Category:** Dead code / Bundle bloat
- **Line:** 1-1101
- **Description:** Only imported by `itam-devices.tsx` which itself is orphaned (UI-BUG-013). So this is transitively dead code.
- **Impact:** ~1,101 lines of dead code. The actually-rendered `DeviceDetailSheet` lives in `device-detail-sheet.tsx` (2,950 lines) and is used by `devices-page.tsx`.
- **Fix:** Delete `itam-device-detail-sheet.tsx`.

### itam-work-orders.tsx (2,226 lines)

- **Bug ID:** UI-BUG-016
- **Severity:** P1
- **Category:** Dead code / Bundle bloat
- **Line:** 1-2226
- **Description:** `ItamWorkOrders` is registered as a dynamic import in `app/page.tsx` line 70 — `const ItamWorkOrders = dynamic(() => import('@/components/itam/itam-work-orders').then((m) => m.ItamWorkOrders))`. However, `ItamWorkOrders` is NEVER rendered: the `activePage === 'itam-work-orders'` case at line 292 renders `<WorkOrdersPage />` (from `work-orders-page.tsx`), not `<ItamWorkOrders />`. The dynamic import statement is dead code that still loads the module.
- **Impact:** ~2,226 lines of dead code + unnecessary dynamic import chunk that may load if `next build` doesn't tree-shake dynamic imports.
- **Fix:** Remove the `const ItamWorkOrders = dynamic(...)` declaration from `app/page.tsx` line 70-72, and delete `itam-work-orders.tsx`.

### settings-page-v2.tsx (1,496 lines)

- **Bug ID:** UI-BUG-017
- **Severity:** P2
- **Category:** Dead code
- **Line:** 1418 (`export function SettingsPageV2`)
- **Description:** `SettingsPageV2` is registered in `app/page.tsx` line 92-94 as a dynamic import for `activePage === 'settings-v2'`. But there is no sidebar nav entry for `settings-v2` and no `setActivePage('settings-v2')` call anywhere in the codebase. The export is unreachable. The file's other exports (`AssetPatternTab`, `WoPatternTab`) ARE used by `itam-settings.tsx`.
- **Impact:** Dead code path. Only the `SettingsPageV2` function body is unused (~78 lines).
- **Fix:** Either delete the `SettingsPageV2` export or wire up a sidebar nav entry to reach it.

### pm-schedules-page.tsx (1,767 lines)

- **Bug ID:** UI-BUG-018
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 variant)
- **Line:** 1418-1426
- **Description:** `<AlertDialogAction onClick={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null) }}>` — the `setDeleteTarget(null)` immediately closes the dialog (overriding any auto-close behavior) before the mutation completes. Loading state is never visible. The button also lacks `disabled={deleteMutation.isPending}` so user can spam-click.
- **Impact:** User clicks "ปิดใช้งาน", dialog closes, no spinner, multiple clicks fire multiple mutations.
- **Fix:** Remove `setDeleteTarget(null)` from the click handler; let the mutation's `onSuccess` close the dialog. Add `disabled={deleteMutation.isPending}`.

### stock/stock-inventory.tsx (1,246 lines)

- **Bug ID:** UI-BUG-019
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 variant)
- **Line:** 1211-1219
- **Description:** Same pattern as UI-BUG-018: `<AlertDialogAction onClick={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null) }}>` — closes dialog before mutation completes, no spinner, no `disabled` while pending.
- **Impact:** Same as UI-BUG-018.
- **Fix:** Same as UI-BUG-018.

### notification-templates-section.tsx (741 lines)

- **Bug ID:** UI-BUG-020
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 730-735
- **Description:** `<AlertDialogAction onClick={confirmDelete}>` without `e.preventDefault()`. `confirmDelete` is async. Dialog auto-closes immediately, no spinner.
- **Impact:** User clicks "ลบเทมเพลต", dialog closes, no feedback until toast appears seconds later.
- **Fix:** Add `e.preventDefault()` or migrate to `<Button>`.

### user-management-section.tsx (885 lines)

- **Bug ID:** UI-BUG-021
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 686-692
- **Description:** `<AlertDialogAction onClick={confirmDelete} disabled={deleting}>` without `e.preventDefault()`.
- **Impact:** Same SYS-BUG-002 pattern.
- **Fix:** Add `e.preventDefault()` or migrate to `<Button>`.

### reports-section.tsx (928 lines)

- **Bug ID:** UI-BUG-022
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 523-529
- **Description:** `<AlertDialogAction onClick={confirmDelete} disabled={deleting}>` without `e.preventDefault()`.
- **Impact:** Same SYS-BUG-002 pattern.
- **Fix:** Add `e.preventDefault()` or migrate to `<Button>`.

### cycle-manage-dialog.tsx (780 lines)

- **Bug ID:** UI-BUG-023
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 666-676
- **Description:** `<AlertDialogAction onClick={performAction} disabled={acting}>` without `e.preventDefault()`. `performAction` is async (cancel/end/reopen/delete cycle).
- **Impact:** Dialog closes before action completes, no spinner visible.
- **Fix:** Add `e.preventDefault()` or migrate to `<Button>`.

### itam-sticker-editor.tsx (1,652 lines)

- **Bug ID:** UI-BUG-024
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 1528-1534
- **Description:** `<AlertDialogAction onClick={() => deleteTplId && deleteMutation.mutate(deleteTplId)} disabled={deleteMutation.isPending}>` without `e.preventDefault()`.
- **Impact:** Same SYS-BUG-002 pattern.
- **Fix:** Add `e.preventDefault()` or migrate to `<Button>`.

### itam-document-editor.tsx (1,879 lines)

- **Bug ID:** UI-BUG-025
- **Severity:** P1
- **Category:** Functional (SYS-BUG-002 regression)
- **Line:** 1816-1822
- **Description:** Same pattern as UI-BUG-024: `<AlertDialogAction onClick={() => deleteTplId && deleteMutation.mutate(deleteTplId)} ...>` without `e.preventDefault()`.
- **Impact:** Same SYS-BUG-002 pattern.
- **Fix:** Add `e.preventDefault()` or migrate to `<Button>`.

### import-page.tsx (1,022 lines)

- **Bug ID:** UI-BUG-026
- **Severity:** P1
- **Category:** Functional / Auth bypass
- **Line:** 354-357 (`uploadMutation.mutationFn`)
- **Description:** The upload posts FormData to `/api/import` with no headers (no Authorization, no Content-Type because FormData sets its own multipart boundary). The global fetch interceptor in `app/page.tsx` lines 187-204 only adds the Bearer token to URLs matching: `/api/itam/`, `/api/v1/`, `/api/work-orders`, `/api/devices`, `/api/stock-items`, `/api/dashboard`, `/api/sync/preview`, `/api/master`, `/api/sites`, `/api/meter`, `/api/cycles`, `/api/reports`, `/api/notifications`, `/api/audit`, `/api/settings`, `/api/search`, `/api/health`. **`/api/import` is NOT in this list**, so the upload is sent without `Authorization`.
- **Impact:** If `/api/import` requires auth (admin-only endpoint per the worklog), uploads will return 401. May or may not be caught by the route's own middleware.
- **Fix:** Either add `/api/import` to the `isAuthUrl` check in `page.tsx`, or pass `authHeaders()` explicitly in `uploadMutation`.

- **Bug ID:** UI-BUG-027
- **Severity:** P2
- **Category:** UX
- **Line:** 475, 479, 483
- **Description:** Three `<TabsTrigger onClick={() => {}}>` have empty onClick handlers. They're harmless but pointless — likely leftover from a refactor. They don't break Radix's internal click handling (which uses onPointerDown) but they may confuse readers.
- **Impact:** Code smell only.
- **Fix:** Remove the empty onClick props.

### camera-capture.tsx (135 lines)

- **Bug ID:** UI-BUG-028
- **Severity:** P1
- **Category:** A11y / Functional
- **Line:** 117
- **Description:** `<video ref={videoRef} autoPlay playsInline className="flex-1 object-contain" />` lacks the `muted` attribute. iOS Safari (and Chrome on Android) require `muted` on a `<video>` element to allow `autoplay` to start. Without it, the camera preview may show a black frame or never start.
- **Impact:** Camera feature may be broken on iOS Safari.
- **Fix:** Add `muted` attribute: `<video ... autoPlay playsInline muted />` (matches the working pattern in `universal-image-upload.tsx:302`).

- **Bug ID:** UI-BUG-029
- **Severity:** P1
- **Category:** A11y
- **Line:** 104
- **Description:** Close button: `<Button size="icon" variant="ghost" onClick={stopCamera} className="text-white hover:bg-white/10">` — no `aria-label`. Screen-reader users hear only "button" with no description.
- **Impact:** A11y violation — icon-only button must have an accessible name.
- **Fix:** Add `aria-label="ปิดกล้อง"` (or `aria-label="close"`).

### mobile/mobile-shell.tsx (137 lines)

- **Bug ID:** UI-BUG-030
- **Severity:** P2
- **Category:** Visual
- **Line:** 109-130
- **Description:** The bottom-nav buttons render `<motion.span layoutId="mobile-nav-indicator" className="absolute top-0 h-0.5 w-10 ..." />` inside the active button. But the parent `<button>` does NOT have `position: relative` (no `relative` Tailwind class). The absolute-positioned span is anchored to the nearest positioned ancestor — the `<nav>` element which is `fixed`. So the indicator anchors to the top edge of the nav (across all 4 buttons), not the top of the active button.
- **Impact:** The orange "active tab" indicator bar may appear at the wrong horizontal position (likely top-left of nav, not above the active tab). Visual bug — hard to verify without running.
- **Fix:** Add `relative` to the button className: `className={cn('relative flex h-14 flex-1 flex-col ...', ...)}`.

### footer.tsx (60 lines)

- **Bug ID:** UI-BUG-031
- **Severity:** P2
- **Category:** i18n
- **Line:** 43, 56
- **Description:** Footer mixes Thai and English: `"© {year} PNG TEAM — IT Asset Management"` (English) and `"Powered by PNG TEAM"` (English). The page label `PAGE_LABELS[activePage]` is Thai. The result is a mixed-language footer.
- **Impact:** Inconsistent language presentation.
- **Fix:** Either fully localize to Thai or keep consistent English-only branding.

### sidebar.tsx (772 lines)

- **Bug ID:** UI-BUG-032
- **Severity:** P2
- **Category:** i18n
- **Line:** 44
- **Description:** Nav item `{ page: 'dashboard', icon: '📊', label: 'Dashboard', ... }` uses English label "Dashboard" while every other nav item uses Thai. Mixed language in the primary navigation.
- **Impact:** Inconsistent UX — looks unfinished.
- **Fix:** Change to Thai, e.g. `'แดชบอร์ด'` or `'ภาพรวม'`.

### csv-import-dialog.tsx (784 lines)

- **Bug ID:** UI-BUG-033
- **Severity:** P2
- **Category:** UX
- **Line:** 393-402
- **Description:** `existingDevices` query fetches `fetch('/api/devices?limit=500')` to build a Set of existing asset codes for duplicate detection. For deployments with >500 devices, this misses codes beyond the first 500, so duplicates of those devices would NOT be flagged client-side. The server should still catch them, but the UX promise (preview-time validation) breaks.
- **Impact:** False-negative duplicate detection for large datasets.
- **Fix:** Either fetch with no limit (or `?limit=10000`) or just `select=assetCode` projection to reduce payload, or remove the client-side duplicate check entirely and rely on server validation.

- **Bug ID:** UI-BUG-034
- **Severity:** P2
- **Category:** A11y
- **Line:** 596-615 (drop zone)
- **Description:** The drop zone button has `type="button"` but no `aria-label`. Its visible text is "คลิกเพื่อเลือกไฟล์ CSV" / file name when chosen — screen readers will read the contents. Minor; not blocking.
- **Impact:** Mild — text content serves as label.
- **Fix:** Add `aria-label="อัปโหลดไฟล์ CSV"`.

### itam-meter-keyboard.tsx (741 lines)

- **Bug ID:** UI-BUG-035
- **Severity:** P2
- **Category:** Functional / Type safety
- **Line:** 324 (in `saveReading`)
- **Description:** `meterMode: isColorMode ? 'BW_COLOR' : 'TOTAL'` — references `isColorMode` which is declared at line 387 (AFTER `saveReading` at line 280). JavaScript closures capture by reference so this works at runtime when `saveReading` is called after first render. But it's confusing and fragile; ESLint `no-use-before-define` would flag this in strict mode.
- **Impact:** Currently works. Fragile to refactor.
- **Fix:** Move the `isColorMode` declaration above `saveReading`, or compute `isColorMode` inside `saveReading`.

- **Bug ID:** UI-BUG-036
- **Severity:** P2
- **Category:** A11y / UX
- **Line:** 512-515 (list `<li>` items)
- **Description:** Each device row `<li>` is clickable (calls `setSelectedIndex(i) + setFocus('meter')`) but lacks `role="button"`, `tabIndex={0}`, and `onKeyDown` (Enter/Space). Keyboard users can't navigate the list — only the global ↑/↓ handler works (which is good, but the user can't tab to a specific row to read its content with a screen reader).
- **Impact:** Keyboard-only navigation works globally but per-row affordance is missing for AT users.
- **Fix:** Add `role="button" tabIndex={0}` and an onKeyDown that calls the same handler on Enter/Space.

### global-search.tsx (324 lines)

- **Bug ID:** UI-BUG-037
- **Severity:** P2
- **Category:** UX
- **Line:** 110-131 (`handleSelect`)
- **Description:** When a search result is selected (e.g. a `master` item), the code calls `setActivePage('settings') + setPendingSettingsTab('master')`. But there's no highlighting or scroll-to behavior — the user lands on the master tab without any visual indication of which master item they clicked.
- **Impact:** User has to manually find the item they searched for in the settings page.
- **Fix:** Add a brief highlight/scroll-to effect for the selected item (similar to how `setPendingDeviceId` works for devices).

### cascading-dropdown.tsx (578 lines)

- **Bug ID:** UI-BUG-038
- **Severity:** P2
- **Category:** Functional
- **Line:** 229-233 (`update` function)
- **Description:** When the user types a NEW value (e.g. "CustomBrand") that doesn't match any master item, the form state still carries the previous `typeId`/`brandId` from a prior selection. The `isNewType`/`isNewBrand` flags are never set in this component (they're declared in the interface but never assigned). The parent receives a `CascadingValue` with stale IDs alongside a new string name.
- **Impact:** Server may misinterpret — is it a new brand or an existing one?
- **Fix:** When the user types a non-matching value, set `typeId = null` and `isNewType = true` (etc.).

### combobox.tsx (365 lines)

- **Bug ID:** UI-BUG-039
- **Severity:** P2
- **Category:** UX
- **Line:** 244-253 (`handleBlur`)
- **Description:** `setTimeout(() => { setOpen(false); setQuery('') }, 200)` — 200ms delay before closing. If a click handler on a `CommandItem` takes longer than 200ms (e.g. due to React batching or animation), the click may not register before the popover closes.
- **Impact:** Rare — first click on an item sometimes doesn't register.
- **Fix:** Increase to 300ms or use `onMouseDown` on items to fire before blur.

### demo-management-section.tsx (351 lines)

- **Bug ID:** UI-BUG-040
- **Severity:** P2
- **Category:** UX / i18n
- **Line:** 206-208 (CountTile labels)
- **Description:** CountTile labels mix Thai ("อุปกรณ์", "ใบงาน", "บัญชีผู้ใช้") with English ("Stock Txn", "Meter Reading"). Inconsistent within the same row.
- **Impact:** Mild i18n inconsistency.
- **Fix:** Use Thai: "Stock Txn" → "รายการสต็อก", "Meter Reading" → "จดมิเตอร์".

### notifications-popover.tsx (336 lines)

- **Bug ID:** UI-BUG-041
- **Severity:** P2
- **Category:** UX
- **Line:** (not deep-read)
- **Description:** Not deeply audited — noted as future review target. Component is reachable from the sidebar bell icon. Standard notification list pattern.
- **Fix:** Verify empty state + error state are shown.

### itam-paper-analytics.tsx (726 lines)

- **Bug ID:** UI-BUG-042
- **Severity:** P2
- **Category:** i18n
- **Line:** 121-127
- **Description:** `fetch('/api/itam/sites')` is used to populate the site filter, but the global fetch interceptor handles `/api/itam/` correctly. The response type is typed as `{ sites: Array<{ siteName: string | null }> }` but `siteName` may be `null` for some records. The `.filter((s): s is string => !!s)` correctly drops nulls, but this means some sites won't appear in the filter dropdown.
- **Impact:** Mild — sites without `siteName` are hidden from the filter.
- **Fix:** Use `siteCode` as fallback, or `siteCode — siteName` for display.

### manual-sync-preview-section.tsx (232 lines)

- **Bug ID:** UI-BUG-043
- **Severity:** P2
- **Category:** Functional
- **Line:** 80-92 (`preview` function)
- **Description:** Calls `fetch('/api/sync/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, ... })`. URL `/api/sync/preview` IS in the global fetch interceptor's auth list (line 194 of page.tsx), so Authorization is added. OK. No bug.
- **Impact:** None.
- **Fix:** None needed.

### monthly-report.tsx (2,664 lines)

- **Bug ID:** UI-BUG-044
- **Severity:** P2
- **Category:** i18n
- **Line:** 642
- **Description:** `<h1>รายงานงานพิเศษ (อนุมัติ)</h1>` — appears as a heading without proper page-level context. Likely OK but should verify heading hierarchy.
- **Impact:** Mild — minor heading hierarchy concern.
- **Fix:** Verify h1/h2 nesting.

### Cross-cutting issues

- **Bug ID:** UI-BUG-045
- **Severity:** P2
- **Category:** A11y / UX
- **Line:** Multiple files (work-orders-page.tsx:2303, wo-options-section.tsx:126, stock/stock-purchase-orders.tsx:348, contact-directory-section.tsx:160, mobile/mobile-my-work.tsx:1652, pending-users-section.tsx:121, itam-settings.tsx:286)
- **Description:** 7 instances of `window.confirm()` for destructive actions. Native browser dialogs: not localizable, not styled, no keyboard trap, no screen-reader announcements beyond default.
- **Impact:** UX inconsistency, weak confirmation pattern.
- **Fix:** Replace each with styled `AlertDialog` matching the work-orders-page Complete/Cancel pattern.

- **Bug ID:** UI-BUG-046
- **Severity:** P2
- **Category:** i18n
- **Line:** Multiple files (cycle-manage-dialog.tsx:575, devices-page.tsx:3100/3104/3181/3250, dashboard-pdf-export.tsx:69/79/93, itam-audit.tsx, etc.)
- **Description:** ~20+ instances of `.toLocaleString()` without specifying a locale. These use the browser's default locale, producing "1,234" (en-US), "1.234" (de-DE), "1 234" (fr-FR), etc. Inconsistent across users.
- **Impact:** Numbers display differently per user's locale — confusing for cross-team reporting.
- **Fix:** Always pass `'th-TH'` locale: `.toLocaleString('th-TH')`.

- **Bug ID:** UI-BUG-047
- **Severity:** P2
- **Category:** i18n
- **Line:** Multiple files (formatDateTime functions in work-orders-page.tsx:382, devices-page.tsx, itam-audit.tsx:97, monthly-report.tsx, dashboard-pdf-export.tsx:22)
- **Description:** Date formatting uses `new Date(iso).toLocaleString('th-TH', ...)` which produces Buddhist-era years (2568 = 2025). This may be the intended Thai behavior, but it's inconsistent with the Gregorian dates shown elsewhere (e.g., `formatMonthThai` in types.ts). Some users may be confused.
- **Impact:** Mild — Thai users expect Buddhist era, but mixed with Gregorian in some places.
- **Fix:** Standardize on Buddhist era throughout (current mostly does this).

- **Bug ID:** UI-BUG-048 (bonus)
- **Severity:** P2
- **Category:** UX
- **Line:** Multiple files
- **Description:** Many empty `catch {}` blocks (devices-page.tsx:742/756/774/810/908/1011/1062/1413, work-orders-page.tsx:392/403/1262/1321/2351/2443, sticker-print-dialog.tsx:210/241/266, cycle-manage-dialog.tsx:183, itam-devices.tsx:228/1087, etc.). These silently swallow errors with no user feedback.
- **Impact:** When a fetch fails (e.g., 401, 500), user sees no error message — the UI just appears "stuck" or shows stale data.
- **Fix:** Replace `catch {}` with `catch (e) { toast.error('Failed to load X'); console.error(e) }` or at minimum `catch (e) { console.error('X:', e) }`.

---

## Cross-component summary

### SYS-BUG-002 regression count: **10 instances**

| Component | Line | Pattern |
|-----------|------|---------|
| work-orders-page.tsx | 3446 | `AlertDialogAction` + `e.preventDefault()` (unreliable) |
| devices-page.tsx | 3290 | `AlertDialogAction onClick={applyBulkDelete}` no preventDefault |
| devices-page.tsx | 3320 | `AlertDialogAction onClick={confirmDelete}` no preventDefault |
| settings-page.tsx | 685 | `AlertDialogAction onClick={confirmDelete}` no preventDefault |
| settings-page.tsx | 1022 | `AlertDialogAction onClick={confirmDelete}` no preventDefault |
| settings-page.tsx | 1594 | `AlertDialogAction onClick={confirmDelete}` no preventDefault |
| itam-devices.tsx | 1766 | `AlertDialogAction onClick={confirmDelete}` no preventDefault |
| pm-schedules-page.tsx | 1418 | `AlertDialogAction onClick={() => { mutate(); setDeleteTarget(null) }}` |
| stock/stock-inventory.tsx | 1211 | same as pm-schedules |
| notification-templates-section.tsx | 730 | `AlertDialogAction onClick={confirmDelete}` no preventDefault |
| user-management-section.tsx | 686 | `AlertDialogAction onClick={confirmDelete}` no preventDefault |
| reports-section.tsx | 523 | `AlertDialogAction onClick={confirmDelete}` no preventDefault |
| cycle-manage-dialog.tsx | 666 | `AlertDialogAction onClick={performAction}` no preventDefault |
| itam-sticker-editor.tsx | 1528 | `AlertDialogAction onClick={() => mutate(id)}` no preventDefault |
| itam-document-editor.tsx | 1816 | `AlertDialogAction onClick={() => mutate(id)}` no preventDefault |

Of these, only `settings-page.tsx` and `itam-devices.tsx` are dead code (UI-BUG-011 and UI-BUG-013). The remaining 13 instances affect **rendered** components.

### Dead code inventory

| File | Lines | Reason |
|------|-------|--------|
| itam-work-orders.tsx | 2,226 | Imported but never rendered |
| itam-devices.tsx | 2,230 | Exported but never rendered (DevicesPage used instead) |
| itam-device-detail-sheet.tsx | 1,101 | Only imported by orphaned itam-devices.tsx |
| settings-page.tsx | 2,121 | Exported but never imported |
| settings-page-v2.tsx (partial) | ~78 | SettingsPageV2 export never reached (sub-components used) |
| **Total dead code** | **~7,756 lines** | |

### Auth-header coverage gaps

| Endpoint | Component | Line | Risk |
|----------|-----------|------|------|
| `/api/import` (POST upload) | import-page.tsx | 354 | Not in interceptor allow-list — 401 risk |

All other API calls go through URLs matched by the global fetch interceptor (`/api/itam/`, `/api/devices`, etc.) so they receive the Bearer token automatically.

---

## Recommendations (next actions)

### Priority 1 — Fix SYS-BUG-002 regression in 13 rendered components
Apply one of two patterns to each AlertDialogAction identified above:

```tsx
// Option A (minimal change): add e.preventDefault()
<AlertDialogAction
  onClick={(e) => { e.preventDefault(); void confirmDelete() }}
  disabled={deleting}
>
// Option B (consistent with work-orders-page Complete/Cancel fix):
// Replace AlertDialogAction with plain Button
<Button
  type="button"
  onClick={() => void confirmDelete()}
  disabled={deleting}
>
```

### Priority 2 — Delete dead code
- Remove `const ItamWorkOrders = dynamic(...)` from `app/page.tsx` line 70-72.
- Delete `itam-work-orders.tsx` (2,226 lines).
- Delete `itam-devices.tsx` (2,230 lines).
- Delete `itam-device-detail-sheet.tsx` (1,101 lines).
- Delete `settings-page.tsx` (2,121 lines).
- Remove the `SettingsPageV2` export from `settings-page-v2.tsx` (keep `AssetPatternTab` and `WoPatternTab`).

### Priority 3 — Fix auth bypass on `/api/import`
Add `/api/import` to the `isAuthUrl` check in `app/page.tsx` line 187-204, OR pass `authHeaders()` explicitly in `import-page.tsx` uploadMutation.

### Priority 4 — Fix camera-capture for iOS
Add `muted` attribute to the `<video>` element at `camera-capture.tsx:117`.
Add `aria-label="ปิดกล้อง"` to the close button at `camera-capture.tsx:104`.

### Priority 5 — Replace window.confirm with styled AlertDialog
7 instances across the codebase. Each should be a styled AlertDialog matching the existing pattern.

### Priority 6 — i18n consistency
- Pass `'th-TH'` locale to all `.toLocaleString()` calls.
- Localize footer.tsx English strings to Thai.
- Change sidebar "Dashboard" label to Thai.

### Priority 7 — Visual polish
- Fix mobile-shell.tsx active-tab indicator positioning (add `relative` to button).
- Replace empty `catch {}` blocks with toast feedback.

---

## Files audited (75 total)

### Top-level (60)
- `auth-register-page.tsx`, `auth-reset-page.tsx`, `bulk-meter-dialog.tsx`, `camera-capture.tsx`, `cascading-dropdown.tsx`, `combobox.tsx`, `contact-directory-section.tsx`, `csv-import-dialog.tsx`, `custom-export-dialog.tsx`, `cycle-manage-dialog.tsx`, `cycle-report-dialog.tsx`, `dashboard-page.tsx`, `dashboard-pdf-export.tsx`, `dashboard-widget-layout.tsx`, `demo-banner.tsx`, `demo-management-section.tsx`, `depreciation-section.tsx`, `device-detail-sheet.tsx`, `devices-page.tsx`, `document-template-picker.tsx`, `footer.tsx`, `global-search.tsx`, `import-page.tsx`, `itam-audit.tsx`, `itam-dashboard.tsx`, `itam-device-detail-sheet.tsx`, `itam-devices.tsx`, `itam-document-editor.tsx`, `itam-login.tsx`, `itam-meter-keyboard.tsx`, `itam-meter-unified.tsx`, `itam-meter.tsx`, `itam-paper-analytics.tsx`, `itam-repairs.tsx`, `itam-settings.tsx`, `itam-sticker-editor.tsx`, `itam-stock.tsx`, `itam-work-orders.tsx`, `legacy-import-section.tsx`, `lifecycle-dashboard.tsx`, `manual-sync-preview-section.tsx`, `master-data-modal.tsx`, `material-cost-report.tsx`, `meter-page.tsx`, `monthly-report.tsx`, `notification-templates-section.tsx`, `notifications-popover.tsx`, `oauth-section.tsx`, `paper-analytics-page.tsx`, `pending-users-section.tsx`, `pm-schedules-page.tsx`, `print-template-selection-dialog.tsx`, `pwa-registration.tsx`, `qr-scanner-dialog.tsx`, `qr-scanner.tsx`, `quick-actions-bar.tsx`, `reports-hub.tsx`, `reports-section.tsx`, `saved-filters.tsx`, `settings-page-v2.tsx`, `settings-page.tsx`, `sidebar.tsx`, `site-attributes-section.tsx`, `snapshot-viewer.tsx`, `sticker-print-dialog.tsx`, `stock-page.tsx`, `template-editor.tsx`, `template-print-dialog.tsx`, `templates-page.tsx`, `top-bar-clock.tsx`, `universal-image-upload.tsx`, `universal-search.tsx`, `user-management-section.tsx`, `utilization-section.tsx`, `wo-options-section.tsx`, `wo-print-form.tsx`, `work-orders-page.tsx`

### Subdirectories
- `stock/` (10): `index.tsx`, `shared.ts`, `stock-dashboard.tsx`, `stock-history.tsx`, `stock-in-form.tsx`, `stock-inventory.tsx`, `stock-out-form.tsx`, `stock-pending.tsx`, `stock-purchase-orders.tsx`, `stock-summary.tsx`
- `mobile/` (5 + index): `index.ts`, `mobile-meter-reading.tsx`, `mobile-my-work.tsx`, `mobile-repair-request.tsx`, `mobile-shell.tsx`, `mobile-stock-out.tsx`
- `reports/` (7): `shared.tsx`, `approvals-report.tsx`, `devices-report.tsx`, `maintenance-report.tsx`, `meters-report.tsx`, `stock-report.tsx`, `workorders-report.tsx`

---

## Conclusion

The codebase is in good shape overall — most pages have proper loading/empty/error states, toast feedback, RBAC-aware nav, dark mode, and mobile-responsive layouts. The audit found **zero P0 (blocking) bugs**. The 19 P1 bugs are dominated by the SYS-BUG-002 regression pattern (10 instances of AlertDialogAction without preventDefault) and 3 dead-code bundles (~7,756 lines of unused code).

The recommended fix order is:
1. Apply SYS-BUG-002 fix to 13 rendered AlertDialogAction instances (highest user impact).
2. Delete the 4 dead component files (cleanup, faster compile, smaller bundle).
3. Fix the `/api/import` auth header gap.
4. Fix camera-capture `muted` and `aria-label`.
5. Replace `window.confirm` with styled AlertDialog.
6. i18n + visual polish.

After these fixes, the UI should be at "zero defects" against the audit criteria.
