# Devices Module — Mobile-Responsive Evidence Checklist

**Module:** Devices (Dev-3 / Asset & Meter Team)
**Work Package:** C — parallel preparation (per Acceleration Sprint order)
**Status:** Draft for cross-review
**Date:** 2026-08-21

## Purpose

This document defines the mobile-responsive evidence checklist for the
Devices module UI. It is produced as parallel work while PR #29 + #35
await cross-review verdict. It does NOT change code — it prepares the
evidence checklist that Audit will use to verify mobile responsiveness.

## Scope

In scope:
- Device list page (devices-page.tsx)
- Device detail sheet (device-detail-sheet.tsx)
- Device import flow (when implemented)
- Common UI components (sidebar, header, footer)

Out of scope:
- Code changes (separate workstream per module brief)
- Other module UIs (Repair, Stock, Meter)

## 1. Viewport breakpoints

Per Tailwind CSS 4 default breakpoints:

| Breakpoint | Min width | Target devices |
|---|---|---|
| `sm` | 640px | Small phones (landscape), large phones (portrait) |
| `md` | 768px | Tablets (portrait) |
| `lg` | 1024px | Tablets (landscape), small laptops |
| `xl` | 1280px | Desktops |
| `2xl` | 1536px | Large desktops |

## 2. Device list page (devices-page.tsx)

### 2.1 Layout

- [ ] Mobile (<640px): single column, full width
- [ ] Tablet (768-1023px): 2 columns
- [ ] Desktop (≥1024px): 3-4 columns or table view
- [ ] No horizontal scroll on any breakpoint

### 2.2 Table behavior

- [ ] Mobile: table converts to card list (or horizontal scroll with sticky first column)
- [ ] Tablet: table with horizontal scroll if needed
- [ ] Desktop: full table view
- [ ] Sticky header on scroll
- [ ] Column visibility toggle on mobile (hide non-essential columns)

### 2.3 Filter + search

- [ ] Filter inputs stack vertically on mobile
- [ ] Search bar full-width on mobile
- [ ] Filter chips wrap on mobile (no horizontal scroll)
- [ ] Active filter count badge visible on all breakpoints

### 2.4 Pagination

- [ ] Pagination controls accessible on mobile (≥44px touch target)
- [ ] Page size selector accessible on mobile
- [ ] Total count visible on all breakpoints

### 2.5 Empty + loading + error states

- [ ] Loading skeleton (not just spinner) on initial load
- [ ] Empty state with helpful message + CTA
- [ ] Error state with retry button
- [ ] All states mobile-responsive (no overflow)

## 3. Device detail sheet (device-detail-sheet.tsx)

### 3.1 Sheet behavior

- [ ] Mobile: full-screen sheet (bottom sheet or modal)
- [ ] Tablet: 80% width sheet
- [ ] Desktop: 50% width sheet or side panel
- [ ] Close button ≥44px touch target

### 3.2 Form fields

- [ ] Form fields stack vertically on mobile
- [ ] Labels above inputs (not inline) on mobile
- [ ] Required field indicators visible
- [ ] Error messages below inputs (not tooltip) on mobile

### 3.3 Actions

- [ ] Primary action (Save) sticky at bottom on mobile
- [ ] Secondary action (Cancel) accessible
- [ ] Destructive action (Delete) requires confirmation
- [ ] All buttons ≥44px touch target

## 4. Device import flow (when implemented)

### 4.1 File upload

- [ ] Drag-drop area visible on mobile (full width)
- [ ] File picker fallback for mobile browsers without drag-drop
- [ ] File size warning if >5MB
- [ ] Row count preview before import

### 4.2 Mode selection

- [ ] Mode selector accessible on mobile (radio buttons or dropdown)
- [ ] Mode description visible on all breakpoints
- [ ] Default mode (`upsert`) pre-selected

### 4.3 Result display

- [ ] Result summary cards stack on mobile
- [ ] Per-row error table converts to card list on mobile
- [ ] Download error report button accessible on mobile

## 5. Common UI components

### 5.1 Sidebar navigation

- [ ] Mobile: hamburger menu, slide-in drawer
- [ ] Tablet: collapsible sidebar (icon-only or full)
- [ ] Desktop: full sidebar (240px)
- [ ] Active page indicator visible on all breakpoints

### 5.2 Header

- [ ] Mobile: condensed header (logo + hamburger)
- [ ] Tablet/Desktop: full header with breadcrumbs + actions
- [ ] User menu accessible on all breakpoints

### 5.3 Footer

- [ ] Sticky footer at bottom (no floating gap when content short)
- [ ] Pushed down naturally when content overflows (no overlap)
- [ ] Mobile: condensed footer (essential links only)

## 6. Touch target compliance

Per WCAG 2.5.5 (Target Size — Enhanced):

- [ ] All interactive elements ≥44×44px on mobile
- [ ] Buttons have ≥8px padding on mobile
- [ ] Link spacing ≥8px on mobile
- [ ] Form inputs ≥44px height on mobile

## 7. Performance on mobile

- [ ] Initial page load <3s on 4G connection
- [ ] No layout shift (CLS <0.1)
- [ ] Images lazy-loaded
- [ ] No unused JavaScript shipped to mobile

## 8. Accessibility (mobile-specific)

- [ ] All interactive elements keyboard accessible
- [ ] Focus visible on all breakpoints
- [ ] Screen reader labels for icon-only buttons
- [ ] Color contrast ≥4.5:1 for text
- [ ] No color-only state indication (use icon + text)

## 9. Verification methodology

### 9.1 Manual testing

- [ ] Chrome DevTools device emulation (iPhone SE, iPhone 12 Pro, iPad, iPad Pro)
- [ ] Real device testing (if available): at least 1 phone + 1 tablet
- [ ] Landscape + portrait orientation

### 9.2 Automated testing

- [ ] Lighthouse mobile audit (accessibility + performance ≥90)
- [ ] Playwright mobile viewport tests (existing test suite)
- [ ] axe-core accessibility scan (no critical violations)

### 9.3 Evidence artifacts

- [ ] Screenshots at each breakpoint (mobile, tablet, desktop)
- [ ] Lighthouse report (mobile)
- [ ] axe-core report
- [ ] Playwright test results

## 10. Sign-off

- [ ] Dev-3 self-check complete (this document)
- [ ] Cross-review verdict (Dev-4 / Meter primary, Dev-1 / Repair backup)
- [ ] Audit technical review (mobile responsiveness is part of DoD)
- [ ] Release Owner operational evidence

## References

- PR #29: https://github.com/nikorn2527-stack/ITAM-NextJS/pull/29
- PR #35: https://github.com/nikorn2527-stack/ITAM-NextJS/pull/35
- Module brief: docs/modules/devices/README.md
- Work packages: docs/MODULAR-NEXT-WORK-PACKAGES-TH.md
- WCAG 2.5.5: https://www.w3.org/TR/WCAG21/#target-size-enhanced
