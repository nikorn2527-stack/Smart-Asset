/**
 * stepper.tsx — Stepper + form/cross-page components per UX/UI Standards §5-6.
 */

'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { AlertCircle } from 'lucide-react'

// ── Stepper (§5.1-5.2) ─────────────────────────────────────
export interface StepperStep {
  key: string
  label: string
  status: 'complete' | 'current' | 'incomplete' | 'error'
  description?: string
}

export function Stepper({
  steps,
  onStepClick,
}: {
  steps: StepperStep[]
  onStepClick?: (stepKey: string) => void
}) {
  return (
    <nav aria-label="Progress" className="flex flex-wrap items-center gap-1">
      {steps.map((step, i) => (
        <React.Fragment key={step.key}>
          {i > 0 && (
            <div
              className={cn(
                'h-0.5 w-6 flex-shrink-0 sm:w-8',
                step.status === 'complete' ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700',
              )}
            />
          )}
          <button
            type="button"
            onClick={() => onStepClick?.(step.key)}
            disabled={step.status === 'incomplete'}
            className="flex flex-shrink-0 items-center gap-1.5"
            aria-current={step.status === 'current' ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors',
                step.status === 'complete' && 'bg-emerald-500 text-white',
                step.status === 'current' && 'bg-[#f97316] text-white ring-2 ring-[#f97316]/30',
                step.status === 'incomplete' && 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
                step.status === 'error' && 'bg-red-500 text-white',
              )}
            >
              {step.status === 'complete' ? '✓' : i + 1}
            </span>
            <span
              className={cn(
                'hidden text-xs font-medium whitespace-nowrap sm:inline',
                step.status === 'current' ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {step.label}
            </span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  )
}

// ── UnsavedChangesGuard (§5.4) ──────────────────────────────
export function useUnsavedChanges(isDirty: boolean, message?: string) {
  React.useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = message || 'คุณมีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก'
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty, message])
}

// ── PermissionGate (§6.7) ──────────────────────────────────
export function PermissionGate({
  hasPermission,
  children,
  fallback,
}: {
  hasPermission: boolean
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  if (!hasPermission) {
    return (
      <>{fallback || (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-500">
          <span aria-hidden>🔒</span>
          <span>คุณไม่มีสิทธิ์ในส่วนนี้ ติดต่อผู้ดูแลระบบ</span>
        </div>
      )}</>
    )
  }
  return <>{children}</>
}

// ── FieldError (§2.4) ──────────────────────────────────────
export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400" role="alert">
      <AlertCircle className="h-3 w-3 flex-shrink-0" />
      <span>{message}</span>
    </p>
  )
}

// ── RequiredLabel (§2.4) ───────────────────────────────────
export function RequiredLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="flex items-center gap-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
      {children}
      {required && <span className="text-red-500" aria-label="จำเป็น">*</span>}
    </label>
  )
}

// ── InlineGuidance (§5.3) ──────────────────────────────────
// Cross-page guidance for dependencies
export function InlineGuidance({
  message,
  actionLabel,
  onAction,
  dismissLabel,
  onDismiss,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
  dismissLabel?: string
  onDismiss?: () => void
}) {
  const [dismissed, setDismissed] = React.useState(false)
  if (dismissed) return null
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-400">
      <span className="flex-1">{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="flex-shrink-0 rounded-md bg-amber-100 px-2 py-0.5 font-medium text-amber-700 transition-colors hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-800/50"
        >
          {actionLabel}
        </button>
      )}
      {dismissLabel && onDismiss && (
        <button
          type="button"
          onClick={() => { setDismissed(true); onDismiss() }}
          className="flex-shrink-0 text-amber-500 transition-colors hover:text-amber-700 dark:text-amber-600 dark:hover:text-amber-400"
        >
          {dismissLabel}
        </button>
      )}
    </div>
  )
}
