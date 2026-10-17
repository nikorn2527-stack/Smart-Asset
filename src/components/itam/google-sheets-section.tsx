'use client'

/**
 * GoogleSheetsSection — Unified Google Sheets integration hub.
 *
 * Replaces the older SyncTestSection with a 4-tab experience:
 *   1. Connection — env-var status + auth probe + service-account helper
 *   2. Sync      — pull data FROM legacy Google Sheets (3 phases)
 *   3. Backup    — download a multi-sheet TSV/CSV of all ITAM data
 *   4. History   — recent sync/export audit entries
 *
 * Design goals:
 *   - Self-documenting: every status shows exactly what's missing
 *   - Fail-safe: if Google creds aren't set, the Sync tab is disabled
 *     but the Backup tab (which reads from the local DB) still works —
 *     this is critical for the post-data-loss recovery scenario
 *   - Fully bilingual (TH/EN) via useT()
 */
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Sheet as SheetIcon,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Download,
  Database,
  Cloud,
  Loader2,
  KeyRound,
  Eye,
  History,
  FileSpreadsheet,
  Info,
  Copy,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react'
import { useAuthStore } from '@/store/auth-store'
import { useT } from '@/store/i18n-store'
import { cn } from '@/lib/utils'
import { bearerHeaders } from '@/lib/http-headers'

// ── Types ─────────────────────────────────────────────────────────────

interface StatusResponse {
  configured: boolean
  missingEnvVars: string[]
  sheetIds: { itam: boolean; services: boolean; stock: boolean }
  serviceAccountEmail: string | null
  authProbe: { ok: boolean; error?: string } | null
  recentSyncs: Array<{
    action: string
    summary: string
    actor: string
    createdAt: string
    detail: string | null
  }>
  dbRowCounts: Record<string, number>
}

interface PreviewTab {
  app: string
  tab: string
  entity: string
  rowCount: number
  headers: string[]
  sample: Record<string, string>[]
  error: string | null
  durationMs: number
}

interface PreviewResponse {
  configured: boolean
  filter: string
  tabs: PreviewTab[]
  totals: { tabs: number; rows: number; errors: number }
}

type SubTab = 'connection' | 'sync' | 'backup' | 'history'

// ── Main component ────────────────────────────────────────────────────

export function GoogleSheetsSection() {
  const t = useT()
  const [subTab, setSubTab] = React.useState<SubTab>('connection')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <SheetIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            {t('google_sheets.title')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t('google_sheets.subtitle')}
          </p>
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs value={subTab} onValueChange={(v) => setSubTab(v as SubTab)}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="connection" className="gap-1.5 text-xs">
            <KeyRound className="h-3.5 w-3.5" />
            {t('google_sheets.tab.connection')}
          </TabsTrigger>
          <TabsTrigger value="sync" className="gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            {t('google_sheets.tab.sync')}
          </TabsTrigger>
          <TabsTrigger value="backup" className="gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5" />
            {t('google_sheets.tab.backup')}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5 text-xs">
            <History className="h-3.5 w-3.5" />
            {t('google_sheets.tab.history')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="mt-4">
          <ConnectionTab />
        </TabsContent>
        <TabsContent value="sync" className="mt-4">
          <SyncTab />
        </TabsContent>
        <TabsContent value="backup" className="mt-4">
          <BackupTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── 1. Connection tab ─────────────────────────────────────────────────

function ConnectionTab() {
  const t = useT()
  const token = useAuthStore((s) => s.token)
  const qc = useQueryClient()

  const { data, isLoading, refetch, isFetching } = useQuery<StatusResponse>({
    queryKey: ['google-sheets-status'],
    queryFn: async () => {
      const res = await fetch('/api/integrations/google-sheets/status', {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    refetchOnWindowFocus: false,
  })

  const configured = data?.configured ?? false
  const missing = data?.missingEnvVars ?? []

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <Card className={cn(
        'border-l-4',
        configured
          ? 'border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
          : 'border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20',
      )}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            ) : configured ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {configured
                  ? t('google_sheets.connection.connected')
                  : t('google_sheets.connection.not_connected')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {configured
                  ? t('google_sheets.connection.connected_desc')
                  : t('google_sheets.connection.not_connected_desc')}
              </p>
              {data?.serviceAccountEmail && (
                <p className="mt-1.5 inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <ShieldCheck className="h-3 w-3" />
                  {data.serviceAccountEmail}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-7 px-2"
            >
              {isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Auth probe result */}
      {data?.authProbe && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              {data.authProbe.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <XCircle className="h-4 w-4 text-rose-500" />
              )}
              {t('google_sheets.connection.auth_probe')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.authProbe.ok ? (
              <p className="text-xs text-muted-foreground">
                {t('google_sheets.connection.auth_probe_ok')}
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  {t('google_sheets.connection.auth_probe_fail')}
                </p>
                <pre className="overflow-x-auto rounded bg-rose-50 p-2 text-[11px] text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                  {data.authProbe.error}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Env vars checklist */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {t('google_sheets.connection.env_vars')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('google_sheets.connection.env_vars_desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {ENV_VARS.map((v) => {
            const isSet = !missing.includes(v.key)
            return (
              <div
                key={v.key}
                className="flex items-start justify-between gap-3 rounded-md border border-slate-200 p-2.5 dark:border-slate-700"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {v.key}
                    </code>
                    {isSet ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                        <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" />
                        {t('google_sheets.connection.set')}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                        <AlertCircle className="mr-0.5 h-2.5 w-2.5" />
                        {t('google_sheets.connection.missing')}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {v.desc}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5"
                  onClick={() => {
                    navigator.clipboard.writeText(v.key)
                    toast.success(t('google_sheets.connection.copied'))
                  }}
                  title={t('google_sheets.connection.copy')}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* DB row counts */}
      {data?.dbRowCounts && Object.keys(data.dbRowCounts).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-slate-500" />
              {t('google_sheets.connection.db_counts')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('google_sheets.connection.db_counts_desc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(data.dbRowCounts).map(([key, count]) => (
                <div
                  key={key}
                  className="rounded-md border border-slate-200 bg-slate-50 p-2 text-center dark:border-slate-700 dark:bg-slate-800/50"
                >
                  <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {count.toLocaleString()}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {key}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Setup helper */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Info className="h-4 w-4 text-blue-500" />
            {t('google_sheets.connection.setup_title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 text-xs text-muted-foreground">
          <ol className="ml-4 list-decimal space-y-1.5">
            <li>{t('google_sheets.connection.step1')}</li>
            <li>{t('google_sheets.connection.step2')}</li>
            <li>{t('google_sheets.connection.step3')}</li>
            <li>{t('google_sheets.connection.step4')}</li>
            <li>{t('google_sheets.connection.step5')}</li>
          </ol>
          <div className="mt-3 rounded-md bg-slate-50 p-2.5 dark:bg-slate-800/50">
            <p className="mb-1 text-[11px] font-medium text-slate-600 dark:text-slate-400">
              {t('google_sheets.connection.example')}:
            </p>
            <pre className="overflow-x-auto text-[10px] leading-relaxed text-slate-700 dark:text-slate-300">
{`# .env
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n","client_email":"itam@project.iam.gserviceaccount.com",...}
GOOGLE_SHEETS_ID_ITAM=1AbC...xyz
GOOGLE_SHEETS_ID_SERVICES=2DeF...uvw
GOOGLE_SHEETS_ID_STOCK=3HiJ...rst`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

const ENV_VARS = [
  {
    key: 'GOOGLE_SERVICE_ACCOUNT_KEY',
    desc: 'Service Account JSON key (full JSON string from Google Cloud Console)',
  },
  {
    key: 'GOOGLE_SHEETS_ID_ITAM',
    desc: 'Spreadsheet ID for ITAM (devices, meters, users, settings)',
  },
  {
    key: 'GOOGLE_SHEETS_ID_SERVICES',
    desc: 'Spreadsheet ID for Services (work orders / repairs)',
  },
  {
    key: 'GOOGLE_SHEETS_ID_STOCK',
    desc: 'Spreadsheet ID for Stock (products, stock-in/out, POs)',
  },
]

// ── 2. Sync tab ───────────────────────────────────────────────────────

function SyncTab() {
  const t = useT()
  const token = useAuthStore((s) => s.token)
  const qc = useQueryClient()
  const [phaseLoading, setPhaseLoading] = React.useState<number | null>(null)
  const [results, setResults] = React.useState<Record<number, PhaseResult>>({})
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)

  // First — check connection status to enable/disable sync
  const { data: status } = useQuery<StatusResponse>({
    queryKey: ['google-sheets-status'],
    queryFn: async () => {
      const res = await fetch('/api/integrations/google-sheets/status', {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    refetchOnWindowFocus: false,
  })

  const configured = status?.configured ?? false

  async function runPhase(phase: number, dryRun: boolean) {
    setPhaseLoading(phase)
    try {
      const res = await fetch(
        `/api/cron/sync-legacy/phase?phase=${phase}&dryRun=${dryRun ? '1' : '0'}`,
        { headers: bearerHeaders(token) },
      )
      const json = await res.json()
      if (json.ok) {
        setResults((prev) => ({ ...prev, [phase]: json }))
        // `json` is `any` from res.json(), so Object.values(...) is `any[]` and the
        // annotated reduce callbacks don't match its overloads. Normalize to a
        // typed record first.
        const phaseResults = (json.results ?? {}) as Record<string, { fetched?: number; errors?: number }>
        const totalFetched = Object.values(phaseResults).reduce(
          (s, r) => s + (r?.fetched ?? 0),
          0,
        )
        const totalErrors = Object.values(phaseResults).reduce(
          (s, r) => s + (r?.errors ?? 0),
          0,
        )
        if (totalErrors > 0) {
          toast.warning(
            `${t('google_sheets.sync.phase')} ${phase}: ${totalFetched} ${t('google_sheets.sync.rows')}, ${totalErrors} ${t('google_sheets.sync.errors')}`,
          )
        } else {
          toast.success(
            `${t('google_sheets.sync.phase')} ${phase}: ${totalFetched} ${t('google_sheets.sync.rows')} ✓`,
          )
        }
        qc.invalidateQueries({ queryKey: ['google-sheets-status'] })
      } else {
        toast.error(`${t('google_sheets.sync.phase')} ${phase}: ${json.error || 'Error'}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setPhaseLoading(null)
    }
  }

  async function runPreview() {
    setPreviewLoading(true)
    try {
      const res = await fetch('/api/integrations/google-sheets/preview', {
        headers: bearerHeaders(token),
      })
      const json = await res.json()
      if (json.error) {
        toast.error(json.error)
        return
      }
      setPreview(json)
      toast.success(
        `${t('google_sheets.sync.preview_done')} — ${json.totals.rows} ${t('google_sheets.sync.rows')}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function runAllSync() {
    if (!confirm(t('google_sheets.sync.confirm'))) return
    for (let p = 1; p <= 3; p++) {
      await runPhase(p, false)
    }
  }

  const phases = [
    {
      num: 1,
      label: t('google_sheets.sync.phase1_label'),
      desc: t('google_sheets.sync.phase1_desc'),
      icon: Database,
    },
    {
      num: 2,
      label: t('google_sheets.sync.phase2_label'),
      desc: t('google_sheets.sync.phase2_desc'),
      icon: RefreshCw,
    },
    {
      num: 3,
      label: t('google_sheets.sync.phase3_label'),
      desc: t('google_sheets.sync.phase3_desc'),
      icon: Cloud,
    },
  ]

  return (
    <div className="space-y-4">
      {/* Not-configured warning */}
      {!configured && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {t('google_sheets.sync.disabled_title')}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('google_sheets.sync.disabled_desc')}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-xs"
                  onClick={() => {
                    // Switch to connection tab — find the parent tabs trigger
                    const trigger = document.querySelector('[data-value="connection"]') as HTMLButtonElement | null
                    trigger?.click()
                  }}
                >
                  <KeyRound className="mr-1 h-3 w-3" />
                  {t('google_sheets.sync.go_to_connection')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview button */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Eye className="h-4 w-4 text-blue-500" />
            {t('google_sheets.sync.preview_title')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('google_sheets.sync.preview_desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Button
            size="sm"
            variant="outline"
            onClick={runPreview}
            disabled={!configured || previewLoading}
            className="gap-1.5"
          >
            {previewLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {t('google_sheets.sync.preview_button')}
          </Button>

          {preview && (
            <div className="mt-3 space-y-2">
              {/* Totals */}
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                  {t('google_sheets.sync.tabs_count')}: <strong className="ml-1">{preview.totals.tabs}</strong>
                </Badge>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                  {t('google_sheets.sync.total_rows')}: <strong className="ml-1">{preview.totals.rows.toLocaleString()}</strong>
                </Badge>
                {preview.totals.errors > 0 && (
                  <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
                    {t('google_sheets.sync.errors')}: <strong className="ml-1">{preview.totals.errors}</strong>
                  </Badge>
                )}
              </div>

              {/* Per-tab results */}
              <div className="max-h-80 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                    <TableRow>
                      <TableHead className="h-8 text-[11px]">{t('google_sheets.sync.col_app')}</TableHead>
                      <TableHead className="h-8 text-[11px]">{t('google_sheets.sync.col_tab')}</TableHead>
                      <TableHead className="h-8 text-[11px]">{t('google_sheets.sync.col_entity')}</TableHead>
                      <TableHead className="h-8 text-right text-[11px]">{t('google_sheets.sync.col_rows')}</TableHead>
                      <TableHead className="h-8 text-right text-[11px]">{t('google_sheets.sync.col_ms')}</TableHead>
                      <TableHead className="h-8 text-[11px]">{t('google_sheets.sync.col_status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.tabs.map((tab) => (
                      <TableRow key={`${tab.app}-${tab.tab}`} className="h-8">
                        <TableCell className="py-1 text-[11px] font-medium">{tab.app}</TableCell>
                        <TableCell className="py-1 text-[11px] font-mono">{tab.tab}</TableCell>
                        <TableCell className="py-1 text-[11px]">{tab.entity}</TableCell>
                        <TableCell className="py-1 text-right text-[11px] tabular-nums">
                          {tab.rowCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="py-1 text-right text-[11px] text-muted-foreground tabular-nums">
                          {tab.durationMs}
                        </TableCell>
                        <TableCell className="py-1">
                          {tab.error ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-600 dark:text-rose-400">
                              <XCircle className="h-3 w-3" />
                              {t('google_sheets.sync.error')}
                            </span>
                          ) : tab.rowCount > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" />
                              {t('google_sheets.sync.ok')}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync phases */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4 text-[#f97316]" />
            {t('google_sheets.sync.run_title')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('google_sheets.sync.run_desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={runAllSync}
              disabled={!configured || phaseLoading !== null}
              size="sm"
              className="gap-1.5 bg-[#f97316] text-white hover:bg-[#ea580c]"
            >
              {phaseLoading !== null ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Cloud className="h-3.5 w-3.5" />
              )}
              {t('google_sheets.sync.run_all')}
            </Button>
          </div>

          {/* Phase buttons */}
          <div className="space-y-2">
            {phases.map((p) => {
              const Icon = p.icon
              const result = results[p.num]
              return (
                <div
                  key={p.num}
                  className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 flex-shrink-0 text-slate-400" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{p.desc}</p>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => runPhase(p.num, true)}
                        disabled={!configured || phaseLoading !== null}
                        className="h-7 text-xs"
                      >
                        {phaseLoading === p.num ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          t('google_sheets.sync.dry_run')
                        )}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => runPhase(p.num, false)}
                        disabled={!configured || phaseLoading !== null}
                        className="h-7 bg-[#f97316] text-xs text-white hover:bg-[#ea580c]"
                      >
                        {t('google_sheets.sync.sync')}
                      </Button>
                    </div>
                  </div>
                  {/* Result */}
                  {result && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        {result.ok ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {result.dryRun
                                ? t('google_sheets.sync.dry_run_ok')
                                : t('google_sheets.sync.sync_ok')}
                              {' · '}{result.durationMs}ms
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                            <span className="text-rose-600 dark:text-rose-400">
                              {t('google_sheets.sync.failed')}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(result.results || {}).map(([entity, r]) => (
                          <Badge
                            key={entity}
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              r.errors > 0
                                ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300'
                                : r.fetched > 0
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                                  : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50',
                            )}
                          >
                            {entity}: {r.fetched} {t('google_sheets.sync.rows')}
                            {r.errors > 0 && ` (${r.errors} err)`}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Help */}
          <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500 dark:bg-slate-800/30 dark:text-slate-400">
            <p className="font-medium">💡 {t('google_sheets.sync.help_title')}</p>
            <ol className="ml-4 mt-1 list-decimal space-y-0.5">
              <li>{t('google_sheets.sync.help1')}</li>
              <li>{t('google_sheets.sync.help2')}</li>
              <li>{t('google_sheets.sync.help3')}</li>
              <li>{t('google_sheets.sync.help4')}</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface PhaseResult {
  ok: boolean
  phase: number
  dryRun: boolean
  durationMs: number
  results: Record<string, { fetched: number; updated: number; errors: number; error?: string }>
}

// ── 3. Backup tab ────────────────────────────────────────────────────

function BackupTab() {
  const t = useT()
  const token = useAuthStore((s) => s.token)
  const [format, setFormat] = React.useState<'tsv' | 'csv'>('tsv')
  const [selected, setSelected] = React.useState<Set<string>>(new Set(BACKUP_ENTITIES.map((e) => e.key)))
  const [downloading, setDownloading] = React.useState(false)

  function toggleEntity(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function downloadBackup() {
    setDownloading(true)
    try {
      const entitiesParam =
        selected.size === BACKUP_ENTITIES.length
          ? 'all'
          : Array.from(selected).join(',')
      const url = `/api/integrations/google-sheets/export-spreadsheet?format=${format}&entities=${entitiesParam}`
      const res = await fetch(url, {
        headers: bearerHeaders(token),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        toast.error(err.error || `HTTP ${res.status}`)
        return
      }
      const blob = await res.blob()
      const stamp = new Date().toISOString().slice(0, 10)
      const ext = format === 'csv' ? 'csv' : 'tsv'
      const filename = `itam-backup-${stamp}.${ext}`
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objUrl
      a.download = filename
      a.click()
      URL.revokeObjectURL(objUrl)
      toast.success(t('google_sheets.backup.downloaded'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setDownloading(false)
    }
  }

  function openGoogleSheets() {
    // Open a blank Google Sheet — user can then File → Import → Upload the TSV
    window.open('https://docs.google.com/spreadsheets/create', '_blank')
  }

  const totalEntities = selected.size

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {t('google_sheets.backup.title')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('google_sheets.backup.desc')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Format selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{t('google_sheets.backup.format_title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFormat('tsv')}
              className={cn(
                'flex flex-col items-start rounded-md border p-3 text-left transition-colors',
                format === 'tsv'
                  ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
              )}
            >
              <div className="flex items-center gap-2">
                <div className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full border',
                  format === 'tsv' ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 dark:border-slate-600',
                )}>
                  {format === 'tsv' && <div className="h-2 w-2 rounded-full bg-white" />}
                </div>
                <span className="text-sm font-medium">TSV</span>
                <Badge variant="outline" className="text-[10px]">{t('google_sheets.backup.recommended')}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('google_sheets.backup.tsv_desc')}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setFormat('csv')}
              className={cn(
                'flex flex-col items-start rounded-md border p-3 text-left transition-colors',
                format === 'csv'
                  ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
              )}
            >
              <div className="flex items-center gap-2">
                <div className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full border',
                  format === 'csv' ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 dark:border-slate-600',
                )}>
                  {format === 'csv' && <div className="h-2 w-2 rounded-full bg-white" />}
                </div>
                <span className="text-sm font-medium">CSV</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('google_sheets.backup.csv_desc')}
              </p>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Entity selector */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">
              {t('google_sheets.backup.entities_title')}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px]"
                onClick={() => setSelected(new Set(BACKUP_ENTITIES.map((e) => e.key)))}
              >
                {t('google_sheets.backup.select_all')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px]"
                onClick={() => setSelected(new Set())}
              >
                {t('google_sheets.backup.select_none')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {BACKUP_ENTITIES.map((entity) => {
              const checked = selected.has(entity.key)
              return (
                <label
                  key={entity.key}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 transition-colors',
                    checked
                      ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/20'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
                  )}
                >
                  <Switch
                    checked={checked}
                    onCheckedChange={() => toggleEntity(entity.key)}
                    className="mt-0.5 data-[state=checked]:bg-emerald-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{entity.label}</p>
                    <p className="text-[10px] text-muted-foreground">{entity.desc}</p>
                  </div>
                </label>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t('google_sheets.backup.selected')}: <strong>{totalEntities}</strong> / {BACKUP_ENTITIES.length}
          </p>
        </CardContent>
      </Card>

      {/* Download button */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 flex-shrink-0 text-blue-500" />
              <p className="text-xs text-muted-foreground">
                {t('google_sheets.backup.note')}
              </p>
            </div>
            <div className="flex flex-shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openGoogleSheets}
                className="gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('google_sheets.backup.open_sheets')}
              </Button>
              <Button
                size="sm"
                onClick={downloadBackup}
                disabled={downloading || selected.size === 0}
                className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {downloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {t('google_sheets.backup.download')} .{format}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Import instructions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ChevronRight className="h-4 w-4 text-slate-400" />
            {t('google_sheets.backup.import_title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          <ol className="ml-4 list-decimal space-y-1.5">
            <li>{t('google_sheets.backup.import_step1')}</li>
            <li>{t('google_sheets.backup.import_step2')}</li>
            <li>{t('google_sheets.backup.import_step3')}</li>
            <li>{t('google_sheets.backup.import_step4')}</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}

const BACKUP_ENTITIES = [
  { key: 'devices', label: 'Devices', desc: 'Asset register (printers, scanners, etc.)' },
  { key: 'workorders', label: 'Work Orders', desc: 'Repair / service tickets' },
  { key: 'meterreadings', label: 'Meter Readings', desc: 'BW / color page counts' },
  { key: 'stockitems', label: 'Stock Items', desc: 'Spare parts & consumables' },
  { key: 'stocktransactions', label: 'Stock Transactions', desc: 'IN / OUT movement history' },
  { key: 'users', label: 'Users', desc: 'Account list (passwords stripped)' },
  { key: 'sites', label: 'Sites', desc: 'Branch / location directory' },
  { key: 'masteritems', label: 'Master Items', desc: 'Dropdown option catalog' },
  { key: 'purchaseorders', label: 'Purchase Orders', desc: 'Procurement records' },
  { key: 'auditlogs', label: 'Audit Logs', desc: 'Last 1,000 system events' },
]

// ── 4. History tab ───────────────────────────────────────────────────

function HistoryTab() {
  const t = useT()
  const token = useAuthStore((s) => s.token)

  const { data, isLoading, refetch, isFetching } = useQuery<StatusResponse>({
    queryKey: ['google-sheets-status'],
    queryFn: async () => {
      const res = await fetch('/api/integrations/google-sheets/status', {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    refetchOnWindowFocus: false,
  })

  const syncs = data?.recentSyncs ?? []
  const fmt = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4 text-slate-500" />
              {t('google_sheets.history.title')}
            </CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-7 px-2"
            >
              {isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <CardDescription className="text-xs">
            {t('google_sheets.history.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : syncs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <History className="h-8 w-8 text-slate-300 dark:text-slate-400" />
              <p className="mt-2 text-xs text-muted-foreground">
                {t('google_sheets.history.empty')}
              </p>
            </div>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
              <Table>
                <TableHeader className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                  <TableRow>
                    <TableHead className="h-8 text-[11px]">{t('google_sheets.history.col_when')}</TableHead>
                    <TableHead className="h-8 text-[11px]">{t('google_sheets.history.col_action')}</TableHead>
                    <TableHead className="h-8 text-[11px]">{t('google_sheets.history.col_summary')}</TableHead>
                    <TableHead className="h-8 text-[11px]">{t('google_sheets.history.col_actor')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncs.map((s, i) => (
                    <TableRow key={i} className="align-top">
                      <TableCell className="py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                        {fmt.format(new Date(s.createdAt))}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {s.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 text-[11px]">
                        {s.summary}
                      </TableCell>
                      <TableCell className="py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                        {s.actor}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
