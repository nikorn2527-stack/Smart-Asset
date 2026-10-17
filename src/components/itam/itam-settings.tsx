'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWebAuthn } from '@/hooks/use-webauthn'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Database, Building2, Plus, RefreshCw, Pencil, Trash2, Bell, Send, Palette, BookUser, ListChecks, MessageSquare, Users, Shield, KeyRound, AlertTriangle, Hash, FlaskConical, FileText, Smartphone, Fingerprint, Loader2, Package, ClipboardList, Activity, BarChart3, User, Camera, Save, Sheet, Rocket, Tag, CheckCircle2 } from 'lucide-react'
import { type MasterItem, MASTER_CATEGORIES } from './types'
import { SiteAttributesSection } from './site-attributes-section'
import { ContactDirectorySection } from './contact-directory-section'
import { WoOptionsSection } from './wo-options-section'
import { AssetPatternTab, WoPatternTab } from './settings-page-v2'
import { NumberingSchemesTab } from './numbering-schemes-tab'
import { NotificationTemplatesSection } from './notification-templates-section'
import { NotificationLogSection } from './notification-log-section'
import { PendingUsersSection } from './pending-users-section'
import { UserManagementSection } from './user-management-section'
import { OauthSection } from './oauth-section'
import { DemoManagementSection } from './demo-management-section'
import { LicenseManagementSection } from './license-management-section'
import { AssetCategorySection } from './asset-category-section'
import { StockCountSection } from './stock-count-section'
import { SyncTestSection } from './sync-test-section'
import { GoogleSheetsSection } from './google-sheets-section'
import { ModuleFlagsSection } from './module-flags-section'
import { SetupWizard } from './setup-wizard'
import { CustomFieldManager } from './custom-field-manager'
import { OrganizationsList } from './organizations-list'
import { CustomReportBuilder } from './custom-report-builder'
import { useAuthStore } from '@/store/auth-store'
import { useT, useLang } from '@/store/i18n-store'
import { bearerHeaders } from '@/lib/http-headers'

/** Build fetch headers with the user's JWT (if logged in). */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

// ── Settings tab groups (Issue 5: organize 12 tabs into 4 groups) ──
// Each tab is now nested under a category header in the sidebar-style nav.
// Order: Data → System → Notify → Receivedecorate
type SettingsTab =
  | 'master'
  | 'site-attributes'
  | 'dash.unit.site'
  | 'notifications'
  | 'notification-templates'
  | 'notification-logs'
  | 'customize'
  | 'contacts'
  | 'wo-options'
  | 'pending'
  | 'users'
  | 'permissions'
  | 'oauth'
  | 'number-patterns'
  | 'wo-patterns'
  | 'demo'
  | 'mobile-nav'
  | 'sync-test'
  | 'google-sheets'
  | 'my-biometrics'
  | 'my-profile'
  | 'licenses'
  | 'stock-count'
  | 'modules'
  | 'organizations'
  | 'setup-wizard'
  | 'custom-fields'
  | 'custom-reports'
  | 'asset-categories'

interface SettingsTabGroup {
  /** i18n glossary key for the group heading (resolved with `t()` at render). */
  titleKey: string
  items: { value: SettingsTab; labelKey: string; icon: React.ComponentType<{ className?: string }> }[]
}

const SETTINGS_TAB_GROUPS: SettingsTabGroup[] = [
  {
    titleKey: 'settings.group.data',
    items: [
      { value: 'master', labelKey: 'settings.tab.master', icon: Database },
      { value: 'site-attributes', labelKey: 'settings.tab.site_attributes', icon: Building2 },
      { value: 'contacts', labelKey: 'settings.tab.contacts', icon: BookUser },
      { value: 'wo-options', labelKey: 'settings.tab.wo_options', icon: ListChecks },
      { value: 'number-patterns', labelKey: 'settings.tab.number_patterns', icon: Hash },
      { value: 'wo-patterns', labelKey: 'settings.tab.wo_patterns', icon: FileText },
      { value: 'dash.unit.site', labelKey: 'settings.tab.sites', icon: Building2 },
      { value: 'licenses', labelKey: 'settings.tab.licenses', icon: KeyRound },
      { value: 'asset-categories', labelKey: 'settings.tab.asset_categories', icon: Package },
      { value: 'stock-count', labelKey: 'settings.tab.stock_count', icon: ClipboardList },
      { value: 'custom-reports', labelKey: 'settings.tab.custom_reports', icon: BarChart3 },
    ],
  },
  {
    titleKey: 'settings.group.system',
    items: [
      { value: 'users', labelKey: 'settings.tab.users', icon: Users },
      { value: 'mobile-nav', labelKey: 'settings.tab.mobile_nav', icon: Smartphone },
      { value: 'sync-test', labelKey: 'settings.tab.sync_test', icon: RefreshCw },
      { value: 'google-sheets', labelKey: 'settings.tab.google_sheets', icon: Sheet },
      { value: 'organizations', labelKey: 'settings.tab.organizations', icon: Building2 },
      { value: 'setup-wizard', labelKey: 'settings.tab.setup_wizard', icon: Rocket },
      { value: 'custom-fields', labelKey: 'settings.tab.custom_fields', icon: Tag },
      { value: 'pending', labelKey: 'settings.tab.pending', icon: Users },
      { value: 'demo', labelKey: 'settings.tab.demo', icon: FlaskConical },
      { value: 'modules', labelKey: 'modules.tab_label', icon: Package },
      { value: 'customize', labelKey: 'settings.tab.customize', icon: Palette },
      { value: 'oauth', labelKey: 'settings.tab.oauth', icon: KeyRound },
      { value: 'my-profile', labelKey: 'settings.tab.my_profile', icon: User },
      { value: 'my-biometrics', labelKey: 'settings.tab.my_biometrics', icon: Fingerprint },
    ],
  },
  {
    titleKey: 'settings.group.notify',
    items: [
      { value: 'notifications', labelKey: 'settings.tab.notifications', icon: Bell },
      { value: 'notification-templates', labelKey: 'settings.tab.notification_templates', icon: MessageSquare },
      { value: 'notification-logs', labelKey: 'settings.tab.notification_logs', icon: Activity },
    ],
  },
]

// BUG-SETTINGS-009 fix: API returns `code` + `name`, but the original
// interface expected `siteCode` + `siteName`. Accept both shapes so the
// sites list renders correctly regardless of which endpoint shape wins.
interface Site {
  id: string
  siteCode: string
  siteName: string | null
  lineOa: string | null
  hotline: string | null
  paperRateBw: number | null
  paperRateColor: number | null
  deviceCount?: number
  activeCount?: number
  // API also returns these aliases (from /api/sites route)
  code?: string
  name?: string | null
}

interface NotifySettings {
  channels: { email: boolean; telegram: boolean; lineNotify: boolean; lineOA: boolean }
  events: { deviceAdded: boolean; deviceUpdated: boolean; transfer: boolean; lifecycle: boolean; meter: boolean }
  credentials: Record<string, string>
}

export function ItamSettings() {
  const t = useT()
  const qc = useQueryClient()
  const [tab, setTab] = React.useState<SettingsTab>(() => {
    if (typeof window === 'undefined') return 'master'
    const requested = new URLSearchParams(window.location.search).get('tab')
    const knownTabs = new Set(
      SETTINGS_TAB_GROUPS.flatMap((group) => group.items.map((item) => item.value)),
    )
    return requested && knownTabs.has(requested as SettingsTab)
      ? (requested as SettingsTab)
      : 'master'
  })
  const [category, setCategory] = React.useState('all')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editItem, setEditItem] = React.useState<MasterItem | null>(null)
  const [form, setForm] = React.useState({ category: '', code: '', label: '', displayLabel: '' })
  const [deleteTarget, setDeleteTarget] = React.useState<MasterItem | null>(null)

  // Master items
  const { data: masterData, isLoading: masterLoading } = useQuery({
    queryKey: ['itam-master', category],
    queryFn: async () => {
      const params = category !== 'all' ? `?category=${category}` : ''
      const res = await fetch(`/api/itam/master-items${params}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(t('status.failed'))
      return res.json() as Promise<{ items: MasterItem[] }>
    },
  })

  // Notification settings — fetched whenever the user is on the notifications tab.
  // The query is enabled regardless of auth state so the form is always visible;
  // on error (e.g. 401/403) we fall back to defaults (Issue 4: tab empty fix).
  const {
    data: notifyData,
    isLoading: notifyLoading,
    error: notifyError,
  } = useQuery<NotifySettings>({
    queryKey: ['itam-notify-settings'],
    queryFn: async () => {
      const res = await fetch('/api/itam/notifications/settings', {
        headers: authHeaders(),
      })
      if (!res.ok) {
        // Throw a structured error so we can show a useful message in the UI.
        throw new Error(`LoadSettingsNoSuccess (HTTP ${res.status})`)
      }
      return res.json()
    },
    enabled: tab === 'notifications',
    // Fall back to safe defaults if the API errors out — keeps the form visible.
    retry: false,
  })
  const [notifyDraft, setNotifyDraft] = React.useState<NotifySettings | null>(null)
  React.useEffect(() => {
    if (notifyData) {
      setNotifyDraft(JSON.parse(JSON.stringify(notifyData)) as NotifySettings)
    } else if (notifyError) {
      // Fall back to safe defaults so the form stays visible even when the
      // API errors out (e.g. 401/403 — admin without SYSTEM_CONFIG permission).
      setNotifyDraft({
        channels: { email: false, telegram: false, lineNotify: false, lineOA: false },
        events: {
          deviceAdded: false,
          deviceUpdated: false,
          transfer: false,
          lifecycle: false,
          meter: false,
        },
        credentials: {
          notifyEmails: '',
          telegramBotToken: '',
          telegramChatId: '',
          lineNotifyToken: '',
          lineOaChannelAccessToken: '',
          lineOaToUserId: '',
        },
      })
    }
  }, [notifyData, notifyError])

  async function saveNotify() {
    if (!notifyDraft) return
    try {
      const res = await fetch('/api/itam/notifications/settings', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          channels: notifyDraft.channels,
          events: notifyDraft.events,
          notifyEmails: notifyDraft.credentials.notifyEmails,
          telegramBotToken: notifyDraft.credentials.telegramBotToken,
          telegramChatId: notifyDraft.credentials.telegramChatId,
          lineNotifyToken: notifyDraft.credentials.lineNotifyToken,
          lineOaChannelAccessToken: notifyDraft.credentials.lineOaChannelAccessToken,
          lineOaToUserId: notifyDraft.credentials.lineOaToUserId,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'status.failed')
      }
      toast.success('บันทึกการตั้งค่าการแจ้งเตือนเรียบร้อย')
      await qc.invalidateQueries({ queryKey: ['itam-notify-settings'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    }
  }

  async function sendTestNotify() {
    try {
      const res = await fetch('/api/itam/notifications/test', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: '🔔 TestNotifyfrom ITAM' }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'status.failed')
      const ch = (j.channels ?? []).join(', ') || '—'
      toast.success(`SendNotifyTest (${ch}) — CheckchannelatCloseUse`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'SendNoSuccess')
    }
  }

  // Sites
  // Bug Group E fix: switch to /api/itam/sites (returns SiteAttribute
  // + deviceCount + activeCount). The old /api/sites endpoint returns
  // a flat shape without deviceCount/activeCount, which made the
  // "Site (ImageTotal)" tab show 0 units for every site.
  // /api/itam/sites also returns the original SiteAttribute fields
  // (SiteCode, SiteName, PaperRateBW, PaperRateColor) plus lowercase
  // aliases (siteCode, siteName, paperRateBw, paperRateColor).
  const { data: sitesData, isLoading: sitesLoading } = useQuery({
    queryKey: ['itam-sites-overview'],
    queryFn: async () => {
      const res = await fetch('/api/itam/sites', { headers: authHeaders() })
      if (!res.ok) throw new Error(t('status.failed'))
      return res.json() as Promise<{ sites: Site[] }>
    },
  })

  function openAdd() {
    setEditItem(null)
    setForm({ category: t('common.brand'), code: '', label: '', displayLabel: '' })
    setDialogOpen(true)
  }

  function openEdit(item: MasterItem) {
    setEditItem(item)
    setForm({ category: item.category, code: item.code, label: item.label, displayLabel: item.displayLabel || '' })
    setDialogOpen(true)
  }

  async function saveItem() {
    // SPRINT-5 #2 (UI-BUG-009): validate required fields including code
    if (!form.category || !form.label) { toast.error('PleasePendingCategoryandFee'); return }
    if (!form.code?.trim()) { toast.error('กรุณาระบุรหัส (Code)'); return }
    try {
      if (editItem) {
        const res = await fetch(`/api/itam/master-items/${editItem.id}`, {
          method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(form),
        })
        if (!res.ok) throw new Error(t('status.failed'))
        toast.success(t('common.edit'))
      } else {
        const res = await fetch('/api/itam/master-items', {
          method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(form),
        })
        if (!res.ok) throw new Error(t('status.failed'))
        toast.success(t('common.add'))
      }
      setDialogOpen(false)
      await qc.invalidateQueries({ queryKey: ['itam-master'] })
    } catch (e) { toast.error('บันทึกไม่สำเร็จ') }
  }

  async function deleteItem(item: MasterItem) {
    setDeleteTarget(item)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const item = deleteTarget
    try {
      await fetch(`/api/itam/master-items/${item.id}`, { method: 'DELETE', headers: authHeaders() })
      toast.success(t('common.delete'))
      await qc.invalidateQueries({ queryKey: ['itam-master'] })
    } catch { toast.error('ลบไม่สำเร็จ กรุณาลองใหม่') }
    finally { setDeleteTarget(null) }
  }

  const items = masterData?.items ?? []
  const sites = sitesData?.sites ?? []

  return (
    <div className="flex h-full w-full flex-col p-3 md:p-4">
      <div className="mb-3 flex flex-shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{t('settings.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('settings.subtitle')}
          </p>
        </div>
        {tab !== 'master' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTab('master')}
            className="self-start dark:bg-slate-800 dark:border-slate-700"
          >
            {t('settings.back')}
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* Grouped tab navigation */}
        <nav
          aria-label="Settings sections"
          className="itam-scroll flex max-h-[42vh] min-h-0 flex-shrink-0 flex-col gap-3 overflow-y-auto rounded-md border border-slate-300 bg-white p-2 shadow-sm lg:sticky lg:top-0 lg:max-h-[calc(100vh-10rem)] lg:w-56 lg:self-start dark:border-slate-800 dark:bg-slate-900"
        >
          {SETTINGS_TAB_GROUPS.map((group) => (
            <div key={t(group.titleKey)}>
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {t(group.titleKey)}
              </div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = tab === item.value
                  const Icon = item.icon
                  return (
                    <button
                      key={item.value}
                      type="button"
                      data-tab={item.value}
                      onClick={() => setTab(item.value)}
                      aria-current={active ? 'page' : undefined}
                      className={[
                        'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
                        active
                          ? 'bg-[#f97316]/10 text-[#f97316] dark:bg-[#f97316]/20 dark:text-[#fb923c]'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
                      ].join(' ')}
                    >
                      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Tab content — scrolls internally (Issue 3: heights fill space) */}
        <div className="itam-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-md border border-slate-200 bg-white p-3 shadow-sm md:p-4 dark:border-slate-800 dark:bg-slate-900">
          {/* UX-03: Breadcrumb showing current location */}
          <div className="mb-3 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>{t('settings.title')}</span>
            <span className="text-slate-300 dark:text-slate-400">/</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {(() => {
                const item = SETTINGS_TAB_GROUPS
                  .flatMap(g => g.items)
                  .find(i => i.value === tab)
                return item ? t(item.labelKey) : t('settings.title')
              })()}
            </span>
          </div>

          {/* Completion Guidance is a landing-state summary, not a second menu.
              Keep it off individual Settings forms so it does not repeat the
              sidebar while the user is editing a specific section. */}
          {tab === 'master' && <CompletionGuidance onNavigate={setTab} />}

          {tab === 'pending' && <PendingUsersSection />}

          {tab === 'users' && <UserManagementSection />}

      {tab === 'master' && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full sm:w-48 dark:bg-slate-800 dark:border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('settings.category_all')}</SelectItem>
                {MASTER_CATEGORIES.map((cat: string) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" size="sm" onClick={openAdd} className="flex-1 sm:flex-none"><Plus className="h-4 w-4" /> {t('settings.add')}</Button>
              <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['itam-master'] })}><RefreshCw className="h-4 w-4" /></Button>
            </div>
          </div>

          <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="p-0">
              <div className="itam-scroll max-h-[55vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-100/95 dark:bg-slate-900/95">
                    <TableRow>
                      <TableHead>หมวดหมู่</TableHead>
                      <TableHead>ชื่อรายการ</TableHead>
                      <TableHead>ป้ายแสดงผล</TableHead>
                      <TableHead>รหัส</TableHead>
                      <TableHead className="text-center">สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {masterLoading ? (
                      // Skeleton rows matching column widths
                      Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={`sk-${i}`}>
                          <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-8 rounded-full mx-auto" /></TableCell>
                          <TableCell><Skeleton className="h-6 w-20 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    ) : items.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="py-8 text-center text-slate-400 text-sm">ไม่มีข้อมูล</TableCell></TableRow>
                    ) : (
                      items.map((item) => (
                        <TableRow key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <TableCell><Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{item.category}</Badge></TableCell>
                          <TableCell className="text-sm font-medium">{item.label}</TableCell>
                          <TableCell className="text-xs text-slate-400">{item.displayLabel || '—'}</TableCell>
                          <TableCell className="text-xs">{item.code || '—'}</TableCell>
                          <TableCell className="text-center">{(item as { active?: boolean }).active ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">✓</Badge> : <Badge className="bg-slate-50 text-slate-400">—</Badge>}</TableCell>
                          <TableCell className="text-right">
                            {/* BUG-SETTINGS-008 fix: added title + aria-label */}
                            <Button size="sm" variant="ghost" onClick={() => openEdit(item)} title={`Edit ${item.label}`} aria-label={`Edit ${item.label}`}><Pencil className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => deleteItem(item)} className="text-rose-500 hover:bg-rose-50" title={`Delete ${item.label}`} aria-label={`Delete ${item.label}`}><Trash2 className="h-3 w-3" /></Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'site-attributes' && <SiteAttributesSection />}

      {tab === 'wo-options' && <WoOptionsSection />}

      {tab === 'contacts' && <ContactDirectorySection />}

      {tab === t('dash.unit.site') && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sitesLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader><Skeleton className="h-5 w-20" /></CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-32" />
                </CardContent>
              </Card>
            ))
          ) : sites.length === 0 ? (
            <div className="col-span-full py-12 text-center text-sm text-slate-400">ยังไม่มีสาขา</div>
          ) : (
            sites.map((s) => {
              // BUG-SETTINGS-009: support both `siteCode`/`siteName` (legacy
              // interface) and `code`/`name` (what /api/sites actually returns).
              const code = s.siteCode || s.code || '—'
              const name = s.siteName || s.name || null
              return (
              <Card key={s.id} className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-[#f97316]" /> {code}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{name ?? code}</div>
                  <div className="flex gap-4 text-xs text-slate-500">
                    <span>📦 {s.deviceCount ?? 0} units</span>
                    <span>✅ {s.activeCount ?? 0} Active</span>
                  </div>
                  <div className="flex gap-4 text-xs text-slate-400">
                    <span>📄 B&W: THB{s.paperRateBw ?? 0.5}/sheets</span>
                    <span>🎨 Color: THB{s.paperRateColor ?? 2}/sheets</span>
                  </div>
                  {s.hotline && <div className="text-xs text-slate-400">📞 {s.hotline}</div>}
                </CardContent>
              </Card>
              )
            })
          )}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader><DialogTitle>{editItem ? t('common.edit') : t('common.add')} ข้อมูลมาตรฐาน</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* BUG-SETTINGS-007 fix: added id/name/aria-label + disabled when incomplete */}
            <div className="space-y-1.5">
              <Label htmlFor="master-category" className="text-xs">หมวดหมู่ *</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger id="master-category" className="dark:bg-slate-800 dark:border-slate-700" aria-label={t('settings.col.category')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MASTER_CATEGORIES.map((cat: string) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="master-label" className="text-xs">ชื่อรายการ *</Label>
              <Input id="master-label" name="label" aria-label="ชื่อรายการ" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="เช่น BROTHER" className="dark:bg-slate-800 dark:border-slate-700" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="master-displayLabel" className="text-xs">ป้ายแสดงผล</Label>
              <Input id="master-displayLabel" name="displayLabel" aria-label={t('settings.col.display_label')} value={form.displayLabel} onChange={(e) => setForm({ ...form, displayLabel: e.target.value })} placeholder={t('common.optional')} className="dark:bg-slate-800 dark:border-slate-700" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="master-code" className="text-xs">รหัส</Label>
              <Input id="master-code" name="code" aria-label={t('settings.col.code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={t('common.optional')} className="dark:bg-slate-800 dark:border-slate-700" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>ยกเลิก</Button>
            {/* BUG-SETTINGS-007 fix: disable save button when required fields are empty */}
            <Button onClick={saveItem} disabled={!form.category || !form.label} className="bg-[#f97316] text-white hover:bg-[#ea580c] disabled:opacity-50 disabled:cursor-not-allowed">บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notifications tab — Issue 4: render form even on API error (with defaults) */}
      {tab === 'notifications' && (
        <div className="space-y-4">
          {notifyError && (
            <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <div className="font-medium text-amber-800 dark:text-amber-200">
                  ไม่สามารถโหลดการตั้งค่าการแจ้งเตือนจากเซิร์ฟเวอร์ได้
                </div>
                <div className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">
                  {notifyError instanceof Error ? notifyError.message : 'เกิดข้อผิดพลาด'} —
                  แสดงค่าเริ่มต้นเพื่อใช้งานชั่วคราว คลิกปุ่ม &quot;บันทึก&quot; เพื่อบันทึกค่าใหม่
                </div>
              </div>
            </div>
          )}
          {notifyLoading || !notifyDraft ? (
            <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
              <CardContent className="p-6">
                <Skeleton className="h-64 w-full rounded" />
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bell className="h-4 w-4 text-[#f97316]" /> ช่องทางการแจ้งเตือน
                  </CardTitle>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    เลือกช่องทางที่ต้องการให้ส่ง — Email (บันทึกใน log), Telegram (Bot API), LINE Notify, LINE OA
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <div>
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">📧 Email</div>
                      <div className="text-xs text-slate-400">บันทึกใน log ของเซิร์ฟเวอร์ (sandbox ยังไม่ส่งจริง)</div>
                    </div>
                    <Switch checked={notifyDraft.channels.email} onCheckedChange={(v) => setNotifyDraft({ ...notifyDraft, channels: { ...notifyDraft.channels, email: v } })} />
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <div>
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">✈️ Telegram</div>
                      <div className="text-xs text-slate-400">ส่งผ่าน Telegram Bot API</div>
                    </div>
                    <Switch checked={notifyDraft.channels.telegram} onCheckedChange={(v) => setNotifyDraft({ ...notifyDraft, channels: { ...notifyDraft.channels, telegram: v } })} />
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <div>
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">💬 LINE Notify</div>
                      <div className="text-xs text-slate-400">ส่งผ่าน LINE Notify API</div>
                    </div>
                    <Switch checked={notifyDraft.channels.lineNotify} onCheckedChange={(v) => setNotifyDraft({ ...notifyDraft, channels: { ...notifyDraft.channels, lineNotify: v } })} />
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <div>
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">🎯 LINE OA</div>
                      <div className="text-xs text-slate-400">ส่งผ่าน LINE Messaging API</div>
                    </div>
                    <Switch checked={notifyDraft.channels.lineOA} onCheckedChange={(v) => setNotifyDraft({ ...notifyDraft, channels: { ...notifyDraft.channels, lineOA: v } })} />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader>
                  <CardTitle className="text-base">เหตุการณ์ที่แจ้งเตือน (Events)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { key: 'deviceAdded' as const, label: '➕ เพิ่มอุปกรณ์ใหม่' },
                    { key: 'deviceUpdated' as const, label: '✏️ แก้ไขอุปกรณ์' },
                    { key: 'transfer' as const, label: '🔄 ย้ายตำแหน่งอุปกรณ์' },
                    { key: 'lifecycle' as const, label: '🔁 เปลี่ยนสถานะ' },
                    { key: 'meter' as const, label: '📈 จดมิเตอร์' },
                  ].map((ev) => (
                    <div key={ev.key} className="flex items-center justify-between rounded-md border border-slate-200 p-3 dark:border-slate-700">
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{ev.label}</div>
                      <Switch checked={notifyDraft.events[ev.key]} onCheckedChange={(v) => setNotifyDraft({ ...notifyDraft, events: { ...notifyDraft.events, [ev.key]: v } })} />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="shadow-sm border-slate-200 dark:border-slate-800 dark:bg-slate-900">
                <CardHeader>
                  <CardTitle className="text-base">ข้อมูลรับรองความถูกต้อง (Credentials)</CardTitle>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    โทเคนจะถูกซ่อนหลังบันทึก — แสดงค่าใหม่เพื่อเขียนทับ
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">อีเมลผู้รับ (คั่นด้วยเครื่องหมายจุลภาค)</Label>
                    <Input
                      value={notifyDraft.credentials.notifyEmails || ''}
                      onChange={(e) => setNotifyDraft({ ...notifyDraft, credentials: { ...notifyDraft.credentials, notifyEmails: e.target.value } })}
                      placeholder="admin@example.com, ops@example.com"
                      className="dark:bg-slate-800 dark:border-slate-700"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Telegram Bot Token</Label>
                      <Input
                        value={notifyDraft.credentials.telegramBotToken || ''}
                        onChange={(e) => setNotifyDraft({ ...notifyDraft, credentials: { ...notifyDraft.credentials, telegramBotToken: e.target.value } })}
                        placeholder="123456:ABC-DEF..."
                        className="dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Telegram Chat ID</Label>
                      <Input
                        value={notifyDraft.credentials.telegramChatId || ''}
                        onChange={(e) => setNotifyDraft({ ...notifyDraft, credentials: { ...notifyDraft.credentials, telegramChatId: e.target.value } })}
                        placeholder="-1001234567890"
                        className="dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">LINE Notify Token</Label>
                      <Input
                        value={notifyDraft.credentials.lineNotifyToken || ''}
                        onChange={(e) => setNotifyDraft({ ...notifyDraft, credentials: { ...notifyDraft.credentials, lineNotifyToken: e.target.value } })}
                        placeholder="abcXYZ..."
                        className="dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">LINE OA Channel Access Token</Label>
                      <Input
                        value={notifyDraft.credentials.lineOaChannelAccessToken || ''}
                        onChange={(e) => setNotifyDraft({ ...notifyDraft, credentials: { ...notifyDraft.credentials, lineOaChannelAccessToken: e.target.value } })}
                        placeholder="abcXYZ..."
                        className="dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">LINE OA Target User ID</Label>
                      <Input
                        value={notifyDraft.credentials.lineOaToUserId || ''}
                        onChange={(e) => setNotifyDraft({ ...notifyDraft, credentials: { ...notifyDraft.credentials, lineOaToUserId: e.target.value } })}
                        placeholder="U1234567890abcdef..."
                        className="dark:bg-slate-800 dark:border-slate-700 font-mono text-xs"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-wrap gap-2">
                <Button onClick={saveNotify} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
                  บันทึกการตั้งค่า
                </Button>
                <Button variant="outline" onClick={sendTestNotify} className="dark:bg-slate-800 dark:border-slate-700">
                  <Send className="h-4 w-4" /> ส่งทดสอบ
                </Button>
                <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['itam-notify-settings'] })} className="dark:bg-slate-800 dark:border-slate-700">
                  <RefreshCw className="h-4 w-4" /> รีเฟรช
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ReceivedecorateApp tab — appName, logo, tagline, search fields ── */}
      {tab === 'notification-templates' && <NotificationTemplatesSection />}

      {tab === 'notification-logs' && <NotificationLogSection />}

      {tab === 'oauth' && <OauthSection />}

      {tab === 'customize' && <AppCustomizeTab />}

      {tab === 'number-patterns' && <NumberingSchemesTab docType="device" title="รูปแบบเลขทะเบียนสินทรัพย์" subtitle="ประกอบรูปแบบเลขจากหมวดหมู่ ปีที่ซื้อ เลขลำดับ และอื่นๆ — ใช้งานทันทีทั้งฟอร์มเพิ่มอุปกรณ์และ API" />}

      {tab === 'wo-patterns' && <NumberingSchemesTab docType="work-order" title="รูปแบบเลขใบงาน" subtitle="ประกอบรูปแบบเลขใบงานจากหมวดหมู่ ปี เลขลำดับ — เปิดใช้งานเพื่อให้ระบบสร้างเลขใบงานตามรูปแบบนี้" />}

      {tab === 'demo' && <DemoManagementSection />}

      {tab === 'modules' && <ModuleFlagsSection />}

      {tab === 'mobile-nav' && <MobileNavConfigSection />}
      {tab === 'sync-test' && <SyncTestSection />}

      {tab === 'google-sheets' && <GoogleSheetsSection />}

      {tab === 'organizations' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-5 w-5 text-[#f97316]" />
              {t('organizations.title')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('organizations.subtitle')}</p>
          </CardHeader>
          <CardContent>
            <OrganizationsList />
          </CardContent>
        </Card>
      )}

      {tab === 'setup-wizard' && <SetupWizard organizationId="new" />}

      {tab === 'custom-fields' && <CustomFieldManager />}

      {tab === 'my-biometrics' && <MyBiometricsSection />}
      {tab === 'my-profile' && <MyProfileSection />}

      {tab === 'licenses' && <LicenseManagementSection />}
      {tab === 'asset-categories' && <AssetCategorySection />}
      {tab === 'stock-count' && (
        <div className="space-y-4">
          <StockCountSection scope="STOCK_ITEM" />
          <StockCountSection scope="DEVICE" />
        </div>
      )}
      {tab === 'custom-reports' && <CustomReportBuilder />}
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบ</AlertDialogTitle>
            <AlertDialogDescription>
              ต้องการลบ &quot;{deleteTarget?.label ?? ''}&quot; ใช่หรือไม่? การลบนี้ย้อนกลับไม่ได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault() // prevent Radix auto-close before async completes
                void confirmDelete()
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              ลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── AppCustomizeTab — ReceivedecorateNameApp, logo, tagline, Color, ReduceSearch ────────
// Uses /api/settings/org-profile (PUT) — the same source the sidebar reads via
// the ['org-profile'] query. Invalidating that query makes the sidebar update
// immediately after save.
function AppCustomizeTab() {
  const t = useT()
  const qc = useQueryClient()

  // Fetch the org profile (singleton) — supplies appName, appTagline, logoUrl,
  // primaryColor, accentColor, industryType, language, timezone, currency.
  const { data: profile, isLoading } = useQuery<{
    appName: string
    appTagline: string
    industryType: string
    logoUrl: string | null
    primaryColor: string
    accentColor: string
    language: string
    timezone: string
    currency: string
    allowExcelImport: boolean
  } | null>({
    queryKey: ['org-profile'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/settings/org-profile', { headers: authHeaders() })
        if (!res.ok) return null
        const j = await res.json()
        return j.profile ?? null
      } catch {
        return null
      }
    },
    staleTime: 60_000,
  })

  // searchFields lives in the separate itam settings table — load in parallel.
  const { data: searchFields } = useQuery<string>({
    queryKey: ['app-customization'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/settings', { headers: authHeaders() })
        if (!res.ok) return 'assetNo,serial,brand,model'
        const j = await res.json()
        // /api/settings returns { settings: { key: value, ... } }
        const map: Record<string, string> = j.settings ?? {}
        return map.searchFields ?? 'assetNo,serial,brand,model'
      } catch {
        return 'assetNo,serial,brand,model'
      }
    },
  })

  const [form, setForm] = React.useState({
    appName: 'SystemManageAsset',
    logoUrl: '',
    appTagline: t('footer.app_name'),
    primaryColor: '#f97316',
    accentColor: '#0d9488',
    industryType: 'general',
    searchFields: 'assetNo,serial,brand,model',
  })
  const [saving, setSaving] = React.useState(false)
  const logoFileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (profile) {
      setForm((prev) => ({
        ...prev,
        appName: profile.appName || 'SystemManageAsset',
        logoUrl: profile.logoUrl || '',
        appTagline: profile.appTagline || 'footer.app_name',
        primaryColor: profile.primaryColor || '#f97316',
        accentColor: profile.accentColor || '#0d9488',
        industryType: profile.industryType || 'general',
      }))
    }
  }, [profile])

  React.useEffect(() => {
    if (searchFields) {
      setForm((prev) => ({ ...prev, searchFields }))
    }
  }, [searchFields])

  async function save() {
    setSaving(true)
    try {
      // 1) Save org-profile fields via PUT /api/settings/org-profile
      const res = await fetch('/api/settings/org-profile', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          appName: form.appName,
          appTagline: form.appTagline,
          logoUrl: form.logoUrl,
          primaryColor: form.primaryColor,
          accentColor: form.accentColor,
          industryType: form.industryType,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to save org profile')
      }

      // 2) Save searchFields via PUT /api/settings (object map upsert)
      try {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ searchFields: form.searchFields }),
        })
      } catch {
        // Non-fatal — searchFields is a secondary setting
      }

      toast.success('บันทึกการตั้งค่าแล้ว — ไซด์บาร์อัปเดตทันที')
      // Invalidate both so the sidebar (reads org-profile) + this tab re-fetch
      await qc.invalidateQueries({ queryKey: ['org-profile'] })
      await qc.invalidateQueries({ queryKey: ['app-customization'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />

  // Live preview: show what the sidebar header will look like
  const previewLogo = form.logoUrl
  const previewIsImg = previewLogo && (previewLogo.startsWith('http') || previewLogo.startsWith('data:image/'))

  return (
    <div className="space-y-4">
      {/* Live preview card */}
      <Card className="border-[#f97316]/30 bg-gradient-to-br from-orange-50/50 to-white dark:border-[#fb923c]/20 dark:from-orange-950/20 dark:to-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Palette className="h-4 w-4 text-[#f97316]" /> unitLikefronteye (Live Preview)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            {previewIsImg ? (
              <img
                src={previewLogo}
                alt={form.appName}
                className="h-9 w-9 flex-shrink-0 rounded object-contain"
              />
            ) : (
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-slate-100 text-xl dark:bg-slate-800">
                {previewLogo || '📦'}
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                {form.appName || 'SystemManageAsset'}
              </div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {form.appTagline || 'footer.app_name'}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span
                className="h-4 w-4 rounded-full ring-2 ring-slate-200 dark:ring-white/10"
                style={{ background: form.primaryColor }}
                aria-hidden
              />
              <span
                className="h-4 w-4 rounded-full ring-2 ring-slate-200 dark:ring-white/10"
                style={{ background: form.accentColor }}
                aria-hidden
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-4 w-4 text-[#f97316]" /> ปรับแต่งแอป
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">ชื่อแอป (แสดงในไซด์บาร์)</Label>
              <Input
                value={form.appName}
                onChange={(e) => setForm({ ...form, appName: e.target.value })}
                placeholder="ระบบจัดการทรัพย์สิน"
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">คำโปรยใต้ชื่อแอป</Label>
              <Input
                value={form.appTagline}
                onChange={(e) => setForm({ ...form, appTagline: e.target.value })}
                placeholder={t('footer.app_name')}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('settings.logo_label')}</Label>
            {/* When logo is a base64 data URL (uploaded file), show thumbnail
                instead of the raw data URL text (which is very long and ugly). */}
            {form.logoUrl.startsWith('data:image/') ? (
              <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
                <img
                  src={form.logoUrl}
                  alt="Logo preview"
                  className="h-10 w-10 rounded object-contain"
                />
                <span className="flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
                  {t('settings.logo_uploaded')}
                </span>
              </div>
            ) : (
              <Input
                value={form.logoUrl}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                placeholder={t('settings.logo_placeholder')}
                className="dark:bg-slate-800 dark:border-slate-700"
              />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => logoFileRef.current?.click()}
                disabled={saving}
              >
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                {t('settings.logo_upload')}
              </Button>
              {form.logoUrl.startsWith('data:image/') && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setForm({ ...form, logoUrl: '' })}
                  disabled={saving}
                  className="text-red-500 hover:text-red-600"
                >
                  {t('settings.logo_delete')}
                </Button>
              )}
              <input
                ref={logoFileRef}
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (file.size > 2 * 1024 * 1024) {
                    toast.error(t('settings.logo_too_large'))
                    return
                  }
                  const reader = new FileReader()
                  reader.onload = () => {
                    const img = new Image()
                    img.onload = () => {
                      const canvas = document.createElement('canvas')
                      const maxDim = 128
                      let { width, height } = img
                      if (width > height && width > maxDim) {
                        height = Math.round((height * maxDim) / width)
                        width = maxDim
                      } else if (height > maxDim) {
                        width = Math.round((width * maxDim) / height)
                        height = maxDim
                      }
                      canvas.width = width
                      canvas.height = height
                      const ctx = canvas.getContext('2d')
                      if (!ctx) return
                      ctx.drawImage(img, 0, 0, width, height)
                      const dataUrl = canvas.toDataURL('image/png')
                      setForm({ ...form, logoUrl: dataUrl })
                    }
                    img.src = reader.result as string
                  }
                  reader.readAsDataURL(file)
                }}
                className="hidden"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              {t('settings.logo_hint')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">สีหลัก (Primary)</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.primaryColor}
                  onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
                  aria-label="เลือกสีหลัก"
                />
                <Input
                  value={form.primaryColor}
                  onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                  className="font-mono text-xs dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">สีเสริม (Accent)</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.accentColor}
                  onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
                  aria-label="เลือกสีเสริม"
                />
                <Input
                  value={form.accentColor}
                  onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                  className="font-mono text-xs dark:bg-slate-800 dark:border-slate-700"
                />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">ประเภทองค์กร</Label>
            <Select
              value={form.industryType}
              onValueChange={(v) => setForm({ ...form, industryType: v })}
            >
              <SelectTrigger className="dark:bg-slate-800 dark:border-slate-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">ทั่วไป</SelectItem>
                <SelectItem value="office">ราชการ / สำนักงาน</SelectItem>
                <SelectItem value="corporate">องค์กรธุรกิจ</SelectItem>
                <SelectItem value="education">การศึกษา</SelectItem>
                <SelectItem value="government">หน่วยงานรัฐ</SelectItem>
                <SelectItem value="healthcare">โรงพยาบาล</SelectItem>
                <SelectItem value="industrial">อุตสาหกรรม</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">ฟิลด์ที่ใช้ค้นหา (คั่นด้วยจุลภาค)</Label>
            <Input
              value={form.searchFields}
              onChange={(e) => setForm({ ...form, searchFields: e.target.value })}
              placeholder="assetNo,serial,brand,model"
              className="font-mono text-xs dark:bg-slate-800 dark:border-slate-700"
            />
            <p className="text-[11px] text-slate-500">
              💡 ฟิลด์ที่แนะนำ: assetNo, serial, brand, model, deviceType, department, location, site —
              ฟิลด์ที่อยู่หน้าสุดจะถูกค้นก่อน (เช่น &quot;serial,assetNo,brand&quot; ระบบจะค้น Serial ก่อน)
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={saving} className="bg-[#f97316] text-white hover:bg-[#ea580c]">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
              Save
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['org-profile'] })
                qc.invalidateQueries({ queryKey: ['app-customization'] })
              }}
              className="dark:bg-slate-800 dark:border-slate-700"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================
// MobileNavConfigSection — admin config for mobile bottom nav tabs.
// ============================================================
// Only shows toggles for pages that have REAL mobile components.
// Desktop-only pages (PM, paper-analytics, templates, import, reports,
// settings, audit) are NOT listed because they don't work on mobile.
function MobileNavConfigSection() {
  const t = useT()
  const qc = useQueryClient()
  const [config, setConfig] = React.useState<Record<string, Record<string, boolean>>>({})
  const [selectedRole, setSelectedRole] = React.useState('staff')
  const [saving, setSaving] = React.useState(false)

  const ROLES = [
    { value: 'admin', label: 'Administrator' },
    { value: 'manager', label: 'Manager' },
    { value: 'staff', label: 'Technician' },
    { value: 'coordinator', label: 'Coordinator' },
    { value: 'viewer', label: 'Viewer' },
  ]

  // Only mobile-native tabs that have real mobile components.
  // 'account' is NOT listed (always on — logout must remain accessible).
  const MOBILE_APP_TABS = [
    { page: 'mobileapp-dashboard', label: `📊 ${t('mobile.dashboard')}` },
    { page: 'mobileapp-devices',   label: `💻 ${t('mobile.devices')}` },
    { page: 'mobileapp-my-work',   label: `📋 ${t('mobile.my_work')}` },
    { page: 'mobileapp-repair',    label: `🔧 ${t('mobile.repair')}` },
    { page: 'mobileapp-meter',     label: `📈 ${t('mobile.meter')}` },
    { page: 'mobileapp-stock',     label: `📦 ${t('mobile.stock')}` },
  ]

  // Load config from AppSetting
  const { data: settingsData } = useQuery({
    queryKey: ['mobile-nav-config-settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings', { headers: authHeaders() })
      if (!res.ok) return { settings: [] }
      return res.json()
    },
  })

  React.useEffect(() => {
    // Guard: settingsData.settings may be undefined or not an array
    // (e.g. API returned an error object, or the auth token was missing)
    const settings = settingsData?.settings
    if (!Array.isArray(settings)) return
    const raw = settings.find((s: { key: string }) => s.key === 'mobileNavConfig')
    if (raw?.value) {
      try {
        setConfig(JSON.parse(raw.value))
      } catch {
        setConfig({})
      }
    }
  }, [settingsData])

  function togglePage(role: string, page: string, value: boolean) {
    setConfig((prev) => ({
      ...prev,
      [role]: {
        ...(prev[role] ?? {}),
        [page]: value,
      },
    }))
  }

  function setAllForRole(role: string, value: boolean) {
    setConfig((prev) => ({
      ...prev,
      [role]: Object.fromEntries(MOBILE_APP_TABS.map((p) => [p.page, value])),
    }))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mobileNavConfig: JSON.stringify(config),
        }),
      })
      if (!res.ok) throw new Error('บันทึกไม่สำเร็จ')
      toast.success('บันทึกการตั้งค่าเมนูมือถือเรียบร้อย')
      qc.invalidateQueries({ queryKey: ['mobile-nav-config'] })
      qc.invalidateQueries({ queryKey: ['mobile-nav-config-settings'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const roleConfig = config[selectedRole] ?? {}

  return (
    <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="h-5 w-5 text-[#f97316]" />
          {t('settings.tab.mobile_nav')}
        </CardTitle>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('mobile.config_subtitle')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Role selector */}
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs">{t('mobile.select_role')}</Label>
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setSelectedRole(r.value)}
              className={`rounded-md border px-3 py-1 text-xs transition ${
                selectedRole === r.value
                  ? 'border-[#f97316] bg-[#f97316]/10 text-[#f97316] dark:border-[#fb923c] dark:bg-[#fb923c]/10 dark:text-[#fb923c]'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-[#f97316]/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Quick actions */}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAllForRole(selectedRole, true)}>
            {t('mobile.enable_all')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAllForRole(selectedRole, false)}>
            {t('mobile.disable_all')}
          </Button>
        </div>

        {/* Mobile app tabs — only pages that have real mobile components */}
        <div className="rounded-md border border-orange-200 bg-orange-50/50 p-3 dark:border-orange-800/50 dark:bg-orange-950/20">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-orange-700 dark:text-orange-300">
            <Smartphone className="h-4 w-4" />
            {t('mobile.app_tabs_title')}
          </h4>
          <p className="mb-3 text-[11px] text-orange-600/80 dark:text-orange-400/80">
            {t('mobile.account_always_on')}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MOBILE_APP_TABS.map((tab) => {
              const visible = roleConfig[tab.page] ?? true
              return (
                <label
                  key={tab.page}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition ${
                    visible
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'border-slate-300 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50'
                  }`}
                >
                  <Switch
                    checked={visible}
                    onCheckedChange={(v) => togglePage(selectedRole, tab.page, v)}
                    className="scale-75"
                  />
                  <span>{tab.label}</span>
                </label>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] text-orange-600/70 dark:text-orange-400/70">
            {t('mobile.config_hint')}
          </p>
        </div>

        {/* Info: desktop-only pages are NOT shown here */}
        <div className="rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
          {t('mobile.desktop_pages_note')}
        </div>

        <Button
          onClick={save}
          disabled={saving}
          className="bg-[#f97316] text-white hover:bg-[#ea580c]"
        >
          {saving ? 'กำลังบันทึก…' : '💾 บันทึกการตั้งค่า'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// MyProfileSection — โปรไฟล์ของฉัน + อัปโหลดรูปโปรไฟล์
// ─────────────────────────────────────────────────────────────────────────
function MyProfileSection() {
  const t = useT()
  const { user: authUser, fetchMe } = useAuthStore()
  const token = useAuthStore((s) => s.token)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [department, setDepartment] = React.useState('')
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null)
  const [email, setEmail] = React.useState('')
  const [username, setUsername] = React.useState('')
  const [role, setRole] = React.useState('')
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const loadProfile = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/itam/auth/me/profile', {
        headers: bearerHeaders(token),
      })
      if (!res.ok) return
      const { user } = await res.json()
      setName(user.name ?? '')
      setPhone(user.phone ?? '')
      setDepartment(user.department ?? '')
      setAvatarUrl(user.avatarUrl ?? null)
      setEmail(user.email ?? '')
      setUsername(user.username ?? '')
      setRole(user.role ?? '')
    } finally {
      setLoading(false)
    }
  }, [token])

  React.useEffect(() => {
    loadProfile()
  }, [loadProfile])

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('imagelargeexceedto (HighEnd 5MB)')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const maxDim = 256
        let { width, height } = img
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width)
          width = maxDim
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height)
          height = maxDim
        }
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
        setAvatarUrl(dataUrl)
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/itam/auth/me/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name, avatarUrl, phone, department }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'บันทึกไม่สำเร็จ')
      }
      toast.success('บันทึกโปรไฟล์เรียบร้อย')
      await fetchMe()
      await loadProfile()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading...
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base md:text-lg">
          <User className="h-5 w-5 text-[#f97316]" />
          โปรไฟล์ของฉัน
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          แก้ไขข้อมูลส่วนตัวและรูปโปรไฟล์ของคุณ
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="avatar"
                className="h-20 w-20 rounded-full object-cover border-2 border-slate-200 dark:border-slate-700"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700">
                <User className="h-8 w-8 text-slate-400" />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={saving}>
              <Camera className="mr-2 h-4 w-4" />
              {avatarUrl ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
            </Button>
            {avatarUrl && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAvatarUrl(null)} disabled={saving} className="text-red-500 hover:text-red-600">
                ลบรูป
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">
              PendingReceive JPG/PNG · abbreviateAuto 256×256 · HighEnd 5MB
            </p>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">ชื่อ-นามสกุล</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="เช่น สมชาย ใจดี" className="text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">เบอร์โทร</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="เช่น 081-234-5678" className="text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">แผนก</Label>
          <Input value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={100} placeholder="เช่น IT" className="text-sm" />
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/50">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-muted-foreground">อีเมล:</span>
              <br />
              <span className="font-medium">{email}</span>
            </div>
            <div>
              <span className="text-muted-foreground">ชื่อผู้ใช้:</span>
              <br />
              <span className="font-medium">{username || '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">บทบาท:</span>
              <br />
              <span className="font-medium">{role}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            ต้องการเปลี่ยนอีเมล / ชื่อผู้ใช้ / บทบาท ติดต่อผู้ดูแลระบบ
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="w-full bg-[#f97316] text-white hover:bg-[#ea580c]">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          บันทึกโปรไฟล์
        </Button>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// MyBiometricsSection — ManagePasskeyofUserCurrent
// ─────────────────────────────────────────────────────────────────────────
// Register Touch ID / Face ID / Windows Hello / Android fingerprint
// AfterfromRegister UserCan login withPasskeyinstead password 
// ─────────────────────────────────────────────────────────────────────────
function MyBiometricsSection() {
  const t = useT()
  const { lang } = useLang()
  const { isSupported, register, listCredentials, removeCredential, loading } = useWebAuthn()
  const [credentials, setCredentials] = React.useState<Array<{
    id: string
    deviceType: string | null
    name: string | null
    createdAt: string
    lastUsedAt: string | null
  }>>([])
  const [refreshing, setRefreshing] = React.useState(false)
  const [newName, setNewName] = React.useState('')

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await listCredentials()
      setCredentials(list)
    } finally {
      setRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  async function handleRegister() {
    const result = await register(newName.trim() || undefined)
    if (result?.verified) {
      toast.success(`Register "${result.name ?? 'Passkey'}" Success`)
      setNewName('')
      refresh()
    }
  }

  async function handleRemove(id: string, name: string | null) {
    if (!confirm(`ต้องการลบ Passkey "${name ?? 'Passkey'}" ใช่หรือไม่?`)) return
    const ok = await removeCredential(id)
    if (ok) {
      toast.success('ลบ Passkey แล้ว')
      refresh()
    } else {
      toast.error('ลบ Passkey ไม่สำเร็จ')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base md:text-lg">
          <Fingerprint className="h-5 w-5 text-[#f97316]" />
          Passkey ของฉัน (Touch ID / Face ID / Windows Hello / Security Key)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          ลงทะเบียน Passkey ของอุปกรณ์นี้เพื่อเข้าใช้งานโดยไม่ต้องจำรหัสผ่าน
          รองรับ Touch ID, Face ID, Windows Hello, Passkey บน Android และ Security Key (YubiKey)
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isSupported ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <p className="font-medium">⚠️ เบราว์เซอร์นี้ยังไม่รองรับ Passkey</p>
            <p className="mt-1 text-xs">กรุณาใช้ Chrome / Safari / Edge เวอร์ชันล่าสุด หรือเปิดผ่าน HTTPS (ไม่ใช่ HTTP)</p>
          </div>
        ) : (
          <>
            {/* Register new credential */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">ลงทะเบียนอุปกรณ์ใหม่</h4>
              <div className="flex gap-2">
                <Input
                  placeholder="ชื่ออุปกรณ์ เช่น iPhone ของฉัน, Mac ส่วนตัว"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 text-sm"
                  maxLength={50}
                />
                <Button
                  onClick={handleRegister}
                  disabled={loading}
                  className="bg-[#f97316] text-white hover:bg-[#ea580c]"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  ลงทะเบียน
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                หลังคลิกปุ่ม เบราว์เซอร์จะขอยืนยันตัวตน (ลายนิ้วมือ/ใบหน้า/คีย์ความปลอดภัย) โปรดทำตามขั้นตอนบนหน้าจอ
              </p>
            </div>

            {/* List of registered credentials */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Passkey atRegister ({credentials.length})
                </h4>
                <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
                  {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Refresh
                </Button>
              </div>
              {credentials.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-muted-foreground dark:border-slate-700">
                  <Fingerprint className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  ยังไม่มี Passkey ที่ลงทะเบียนอยู่
                </div>
              ) : (
                <div className="space-y-2">
                  {credentials.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <div className="flex items-center gap-3">
                        <Fingerprint className="h-5 w-5 text-[#f97316]" />
                        <div>
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                            {c.name ?? 'Passkey'}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {c.deviceType ?? 'webauthn'} · Register {new Date(c.createdAt).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB')}
                            {c.lastUsedAt && ` · UseLatest ${new Date(c.lastUsedAt).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB')}`}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(c.id, c.name)}
                        className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Help section */}
            <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-muted-foreground dark:bg-slate-800/30">
              <p className="font-medium">💡 วิธีใช้งาน:</p>
              <ol className="mt-1 ml-4 list-decimal space-y-0.5">
                <li>ลงทะเบียน Passkey บนอุปกรณ์ (ด้านบน)</li>
                <li>ครั้งแรกที่เข้าสู่ระบบ — ระบบจะส่งอีเมล คลิกปุ่ม &quot;เข้าสู่ระบบด้วย Passkey&quot;</li>
                <li>เบราว์เซอร์จะขอยืนยันตัวตน ไม่ต้องกรอกรหัสผ่าน</li>
              </ol>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── CompletionGuidance ──────────────────────────────────────
// Per UX/UI Standards §4 + user clarification:
// Shows ONLY actionable items (incomplete / not_started / error)
// that the user can edit. Does NOT duplicate the nav menu —
// it shows status, reason, impact, and a deep-link button.
//
// Layout:
//   - When no actionable items: small green ✓ banner.
//   - When actionable items exist: amber banner with:
//       • Header: progress % + count + dismiss button
//       • Each item: status icon + label + reason + impact + button
//   - When dismissed: shows a tiny "ดูคำแนะนำ" link to restore.
//
// Items where canEdit=false (permission_limited) are NOT shown as
// pending work — they are filtered out so the user isn't nagged
// about things they cannot fix.

interface CompletionApiResponse {
  items: Array<{
    key: string
    label: string
    description?: string
    status: string
    reason?: string
    impact?: string
    href?: string
    section?: string
    canEdit: boolean
    requiredFor?: string[]
  }>
  percentage?: number
  total?: number
  completed?: number
}

function CompletionGuidance({ onNavigate }: { onNavigate: (tab: SettingsTab) => void }) {
  const [dismissed, setDismissed] = React.useState(false)
  const { data, isLoading } = useQuery<CompletionApiResponse | null>({
    queryKey: ['settings-completion'],
    queryFn: async () => {
      const res = await fetch('/api/settings/completion')
      if (!res.ok) return null
      return res.json() as Promise<CompletionApiResponse>
    },
    staleTime: 60_000,
  })

  // Restore button shown when previously dismissed
  if (dismissed) {
    return (
      <div className="mb-3 flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-800/50">
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {data?.percentage != null && (
            <>ความพร้อมใช้งานระบบ {data.percentage}%</>
          )}
        </span>
        <button
          type="button"
          onClick={() => setDismissed(false)}
          className="text-[11px] font-medium text-[#f97316] transition-colors hover:text-[#ea580c] dark:text-[#fb923c]"
        >
          ดูคำแนะนำการตั้งค่า
        </button>
      </div>
    )
  }

  if (isLoading || !data?.items) return null

  // Filter: only show actionable items that the user can edit.
  // NOT shown: 'complete', 'not_required', 'permission_limited' (canEdit=false)
  const actionable = data.items.filter(
    i =>
      i.canEdit &&
      (i.status === 'incomplete' ||
        i.status === 'not_started' ||
        i.status === 'error'),
  )

  // All-clear state
  if (actionable.length === 0) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="font-medium">การตั้งค่าที่จำเป็นครบแล้ว</span>
        {data.percentage != null && (
          <span className="ml-auto text-emerald-500 dark:text-emerald-600">
            พร้อม {data.percentage}%
          </span>
        )}
      </div>
    )
  }

  // Actionable state
  const percentage = data.percentage ?? 0
  return (
    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-950/30">
      {/* Row 1: title (left) + readiness % + dismiss (right) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500 dark:text-amber-400" />
          <span className="truncate text-xs font-semibold text-amber-700 dark:text-amber-400">
            ยังมี {actionable.length} รายการที่ควรตั้งค่า
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
            พร้อม {percentage}%
          </span>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-[11px] text-amber-500 transition-colors hover:text-amber-700 dark:text-amber-600 dark:hover:text-amber-400"
          >
            ซ่อน
          </button>
        </div>
      </div>

      {/* Row 2: full-width progress bar (visible on all screens) */}
      <div className="mt-2">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900/50"
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`ความพร้อมใช้งานระบบ ${percentage}%`}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Actionable items */}
      <div className="space-y-2">
        {actionable.map((item) => {
          const isErr = item.status === 'error'
          const iconColor = isErr
            ? 'text-red-500 dark:text-red-400'
            : 'text-amber-500 dark:text-amber-400'
          const icon = isErr ? '✗' : '⚠'
          return (
            <div
              key={item.key}
              className="flex flex-col gap-1 rounded-md border border-amber-100 bg-white/60 px-2.5 py-1.5 dark:border-amber-900/40 dark:bg-slate-900/40 sm:flex-row sm:items-center sm:gap-2"
            >
              <span className={`flex-shrink-0 text-sm font-bold ${iconColor}`} aria-hidden>
                {icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {item.label}
                  </span>
                  {item.reason && (
                    <span className="text-[11px] text-amber-700 dark:text-amber-400">
                      — {item.reason}
                    </span>
                  )}
                </div>
                {item.impact && (
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      ผลกระทบ:{' '}
                    </span>
                    {item.impact}
                  </p>
                )}
              </div>
              {item.href && (
                <button
                  type="button"
                  onClick={() => {
                    // Deep-link via URL → tab query + section hash.
                    // itam-settings reads ?tab= to switch tabs; the hash
                    // is consumed by the target section to scroll into view.
                    try {
                      const url = new URL(item.href!, window.location.origin)
                      const tabName = url.searchParams.get('tab')
                      if (tabName) {
                        const knownTabs = new Set(
                          SETTINGS_TAB_GROUPS.flatMap((group) => group.items.map((entry) => entry.value)),
                        )
                        if (knownTabs.has(tabName as SettingsTab)) {
                          onNavigate(tabName as SettingsTab)
                        }
                      }
                      // The app uses the root page with client-side page
                      // switching; /settings is not a standalone route.
                      if (item.section) {
                        const nextUrl = new URL(window.location.href)
                        nextUrl.pathname = '/'
                        if (tabName) nextUrl.searchParams.set('tab', tabName)
                        window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}${item.section}`)
                        // Scroll after the tab swap renders
                        setTimeout(() => {
                          const el = document.querySelector(item.section!)
                          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }, 250)
                      }
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="flex flex-shrink-0 items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-800/50"
                >
                  ไปตั้งค่า
                  <span aria-hidden>→</span>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
