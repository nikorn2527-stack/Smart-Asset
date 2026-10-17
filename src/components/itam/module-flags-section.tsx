'use client'

/**
 * ModuleFlagsSection — Settings tab for admin to toggle module flags.
 *
 * Phase 4.7 per consultant blueprint:
 * - Switch per module (on/off)
 * - Required modules are disabled (can't toggle)
 * - "Reset to defaults" button
 * - Dependency info shown per module
 * - All changes are audit-logged on the server side
 *
 * Uses the global i18n store for TH/EN labels.
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { RotateCcw, Shield, Package, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useT } from '@/store/i18n-store'

interface ModuleFlagInfo {
  name: string
  enabled: boolean
  required: boolean
  dependencies: string[]
}

export function ModuleFlagsSection() {
  const qc = useQueryClient()
  const t = useT()
  const [resetting, setResetting] = React.useState(false)

  const { data: modules, isLoading } = useQuery<ModuleFlagInfo[]>({
    queryKey: ['module-flags'],
    queryFn: async () => {
      const res = await fetch('/api/settings/modules')
      if (!res.ok) throw new Error('Failed to load modules')
      const j = await res.json()
      return j.modules as ModuleFlagInfo[]
    },
    staleTime: 30_000,
  })

  const toggleMutation = useMutation({
    mutationFn: async (vars: { name: string; enabled: boolean }) => {
      const res = await fetch('/api/settings/modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to update')
      return j
    },
    onSuccess: (_data, vars) => {
      toast.success(
        `${vars.name} ${vars.enabled ? 'enabled' : 'disabled'}`,
      )
      qc.invalidateQueries({ queryKey: ['module-flags'] })
    },
    onError: (e: Error) => {
      toast.error(e.message)
    },
  })

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/modules', { method: 'DELETE' })
      if (!res.ok) throw new Error('Reset failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('All modules reset to defaults')
      qc.invalidateQueries({ queryKey: ['module-flags'] })
      setResetting(false)
    },
    onError: (e: Error) => {
      toast.error(e.message)
      setResetting(false)
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  if (!modules) return null

  const enabledCount = modules.filter((m) => m.enabled).length
  const requiredCount = modules.filter((m) => m.required).length

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <Card className="border-[#f97316]/30 bg-gradient-to-br from-orange-50/50 to-white dark:border-[#fb923c]/20 dark:from-orange-950/20 dark:to-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Package className="h-4 w-4 text-[#f97316]" />
            {t('modules.title')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('modules.subtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 text-xs">
            <Badge variant="outline" className="gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              {enabledCount} / {modules.length} {t('modules.enabled')}
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <Shield className="h-3 w-3 text-[#f97316]" />
              {requiredCount} {t('modules.required')}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Module list */}
      <div className="space-y-2">
        {modules.map((mod) => (
          <ModuleRow
            key={mod.name}
            mod={mod}
            onToggle={(enabled) =>
              toggleMutation.mutate({ name: mod.name, enabled })
            }
            disabled={toggleMutation.isPending}
          />
        ))}
      </div>

      {/* Reset button */}
      <div className="flex justify-end pt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (confirm(t('modules.confirm_reset'))) {
              setResetting(true)
              resetMutation.mutate()
            }
          }}
          disabled={resetting}
          className="border-slate-300 dark:border-slate-700"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t('modules.reset')}
        </Button>
      </div>
    </div>
  )
}

function ModuleRow({
  mod,
  onToggle,
  disabled,
}: {
  mod: ModuleFlagInfo
  onToggle: (enabled: boolean) => void
  disabled: boolean
}) {
  const t = useT()
  const isRequired = mod.required

  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {mod.name}
          </span>
          {isRequired && (
            <Badge
              variant="outline"
              className="gap-1 border-[#f97316]/30 bg-[#f97316]/5 text-[#f97316]"
            >
              <Shield className="h-3 w-3" />
              {t('modules.required_label')}
            </Badge>
          )}
          {!mod.enabled && !isRequired && (
            <Badge variant="outline" className="gap-1 text-slate-400">
              <AlertTriangle className="h-3 w-3" />
              {t('modules.disabled')}
            </Badge>
          )}
        </div>
        {mod.dependencies.length > 0 && (
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {t('modules.depends_on')}: {mod.dependencies.join(', ')}
          </p>
        )}
      </div>
      <Switch
        checked={mod.enabled}
        onCheckedChange={onToggle}
        disabled={disabled || isRequired}
        aria-label={mod.name}
      />
    </div>
  )
}
