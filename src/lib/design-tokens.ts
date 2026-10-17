/**
 * design-tokens.ts — Central design tokens for ITAM-NextJS.
 *
 * Per UX/UI Standards §2.2: replaces scattered color/spacing values
 * with a single source of truth that all pages use.
 *
 * Usage in components:
 *   import { tokens } from '@/lib/design-tokens'
 *   <div style={{ padding: tokens.spacing.card }}>
 *
 * Or in Tailwind classes via the CSS variables defined in globals.css:
 *   <div className="p-[var(--space-card)]">
 */

export const tokens = {
  // ── Colors ──
  color: {
    background: 'bg-background',
    surface: 'bg-white dark:bg-slate-900',
    surfaceSecondary: 'bg-slate-50 dark:bg-slate-800',
    border: 'border-slate-200 dark:border-slate-800',
    borderStrong: 'border-slate-300 dark:border-slate-700',
    text: 'text-slate-900 dark:text-slate-100',
    textSecondary: 'text-slate-500 dark:text-slate-400',
    textMuted: 'text-slate-400 dark:text-slate-500',
    primary: '#f97316', // orange-500
    primaryHover: '#ea580c', // orange-600
    primaryLight: 'bg-[#f97316]/10 dark:bg-[#f97316]/20',
    success: '#10b981', // emerald-500
    successLight: 'bg-emerald-50 dark:bg-emerald-950/40',
    warning: '#f59e0b', // amber-500
    warningLight: 'bg-amber-50 dark:bg-amber-950/40',
    danger: '#ef4444', // red-500
    dangerLight: 'bg-red-50 dark:bg-red-950/40',
    info: '#3b82f6', // blue-500
    infoLight: 'bg-blue-50 dark:bg-blue-950/40',
  },

  // ── Typography ──
  typography: {
    pageTitle: 'text-2xl font-bold',
    sectionTitle: 'text-sm font-semibold uppercase tracking-wide',
    body: 'text-sm',
    label: 'text-xs font-medium',
    helper: 'text-xs text-slate-500 dark:text-slate-400',
    error: 'text-xs text-red-600 dark:text-red-400',
  },

  // ── Spacing ──
  spacing: {
    page: 'p-4 md:p-6',
    card: 'p-4',
    section: 'gap-4',
    formField: 'gap-2',
    tableRow: 'py-2.5',
  },

  // ── Radius / Shadow ──
  radius: {
    card: 'rounded-lg',
    dialog: 'rounded-xl',
    input: 'rounded-md',
    dropdown: 'rounded-md',
  },
  shadow: {
    card: 'shadow-sm',
    dialog: 'shadow-xl',
    dropdown: 'shadow-lg',
  },

  // ── Control heights ──
  control: {
    sm: 'h-8',
    md: 'h-9',
    lg: 'h-11',
    iconSm: 'h-3.5 w-3.5',
    iconMd: 'h-4 w-4',
    iconLg: 'h-5 w-5',
  },
} as const

// ── Status colors for badges/checklist ──
export const statusConfig = {
  complete: { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', icon: '✓', label: 'เสร็จแล้ว', labelEn: 'Complete' },
  incomplete: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40', icon: '⚠', label: 'ยังไม่ครบ', labelEn: 'Incomplete' },
  error: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40', icon: '✗', label: 'ผิดพลาด', labelEn: 'Error' },
  not_started: { color: 'text-slate-400 dark:text-slate-500', bg: 'bg-slate-50 dark:bg-slate-800/50', icon: '○', label: 'ยังไม่ได้ตั้งค่า', labelEn: 'Not started' },
  not_required: { color: 'text-slate-300 dark:text-slate-600', bg: 'bg-transparent', icon: '—', label: 'ไม่จำเป็น', labelEn: 'Not required' },
  permission_limited: { color: 'text-slate-400 dark:text-slate-500', bg: 'bg-slate-50 dark:bg-slate-800/50', icon: '🔒', label: 'ไม่มีสิทธิ์แก้ไข', labelEn: 'Permission limited' },
} as const

export type CompletionStatus = keyof typeof statusConfig
