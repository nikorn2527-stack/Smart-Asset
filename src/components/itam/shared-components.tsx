/**
 * shared-components.tsx — Reusable UI components per UX/UI Standards §6.1.
 *
 * These components enforce consistent layout, spacing, and interaction
 * patterns across all pages.
 *
 * Components:
 *   - PageHeader: title + description + actions
 *   - Breadcrumb: navigation trail
 *   - StatusBadge: colored status indicator
 *   - EmptyState: meaningful empty content
 *   - ErrorState: error with retry
 *   - LoadingSkeleton: skeleton during load
 *   - SaveBar: sticky save/cancel bar
 *   - SectionCard: titled card with optional actions
 */

'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { statusConfig, type CompletionStatus } from '@/lib/design-tokens'
import { Loader2, AlertCircle, CheckCircle2, Inbox } from 'lucide-react'

// ── PageHeader ──────────────────────────────────────────────
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  breadcrumb?: React.ReactNode
}) {
  return (
    <div className="mb-4 space-y-1">
      {breadcrumb}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

// ── Breadcrumb ──────────────────────────────────────────────
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-slate-300 dark:text-slate-400">/</span>}
          <span className={i === items.length - 1 ? 'font-medium text-slate-700 dark:text-slate-200' : ''}>
            {item.label}
          </span>
        </React.Fragment>
      ))}
    </nav>
  )
}

// ── StatusBadge ─────────────────────────────────────────────
export function StatusBadge({ status, label }: { status: CompletionStatus; label?: string }) {
  const config = statusConfig[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
        config.color,
        config.bg,
      )}
    >
      <span aria-hidden>{config.icon}</span>
      <span>{label || config.label}</span>
    </span>
  )
}

// ── EmptyState ──────────────────────────────────────────────
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 text-slate-300 dark:text-slate-400">
        {icon || <Inbox className="h-12 w-12" />}
      </div>
      <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── ErrorState ──────────────────────────────────────────────
export function ErrorState({
  title,
  description,
  onRetry,
}: {
  title: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertCircle className="mb-3 h-12 w-12 text-red-400" />
      <h3 className="text-sm font-medium text-red-700 dark:text-red-400">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          ลองใหม่
        </button>
      )}
    </div>
  )
}

// ── LoadingSkeleton ────────────────────────────────────────
export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" style={{ width: `${100 - i * 15}%` }} />
      ))}
    </div>
  )
}

// ── SaveBar ─────────────────────────────────────────────────
export function SaveBar({
  isDirty,
  isSaving,
  onSave,
  onDiscard,
  saveLabel = 'บันทึก',
}: {
  isDirty: boolean
  isSaving: boolean
  onSave: () => void
  onDiscard?: () => void
  saveLabel?: string
}) {
  if (!isDirty && !isSaving) return null
  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      {onDiscard && (
        <button
          type="button"
          onClick={onDiscard}
          disabled={isSaving}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          ยกเลิก
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={isSaving}
        className="flex items-center gap-1.5 rounded-md bg-[#f97316] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#ea580c] disabled:opacity-50"
      >
        {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {saveLabel}
      </button>
    </div>
  )
}

// ── SectionCard ─────────────────────────────────────────────
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {title && (
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
            )}
          </div>
          {actions && <div className="flex flex-shrink-0 items-center gap-1">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

// ── CompletionChecklist ────────────────────────────────────
// Per UX/UI Standards §4: Settings Completion Checklist
export interface CompletionItem {
  key: string
  category: string
  label: string
  description?: string
  status: CompletionStatus
  href?: string
  requiredFor?: string[]
  canEdit: boolean
  reason?: string
}

export function CompletionChecklist({
  items,
  onNavigate,
}: {
  items: CompletionItem[]
  onNavigate?: (href: string) => void
}) {
  const requiredItems = items.filter(i => i.status !== 'not_required')
  const completedCount = requiredItems.filter(i => i.status === 'complete').length
  const totalCount = requiredItems.length
  const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-300">ความพร้อมใช้งานของระบบ</span>
            <span className="font-bold text-slate-900 dark:text-slate-100">{percentage}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-[#f97316] transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-1">
        {items.map((item) => {
          const config = statusConfig[item.status]
          return (
            <div
              key={item.key}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
            >
              <span className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded', config.bg, config.color)} aria-hidden>
                {config.icon}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">{item.label}</span>
                {item.reason && (
                  <span className="ml-1.5 text-slate-400 dark:text-slate-500">— {item.reason}</span>
                )}
              </div>
              {item.status === 'complete' && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
              )}
              {item.href && item.status !== 'complete' && item.status !== 'not_required' && (
                <button
                  type="button"
                  onClick={() => onNavigate?.(item.href!)}
                  disabled={!item.canEdit}
                  className="flex-shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium text-[#f97316] transition-colors hover:bg-[#f97316]/10 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                >
                  {item.canEdit ? 'ไปตั้งค่า →' : '🔒'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
