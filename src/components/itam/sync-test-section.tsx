'use client'

/**
 * SyncTestSection — หน้าทดสอบ Sync สำหรับ admin
 * 
 * แทนการใช้ curl ใน terminal — กดปุ่มในหน้าเว็บได้เลย
 * แบ่งเป็น 3 phases (ไม่เกิน Vercel 60s limit):
 *   Phase 1: ITAM (Devices, MeterReadings, Transfers, Users, Settings, MasterItems, Sites)
 *   Phase 2: Services (WorkOrders)
 *   Phase 3: Stock (Products, StockIn, StockOut, PurchaseOrders)
 */

import * as React from 'react'
import { useAuthStore } from '@/store/auth-store'
import { toast } from 'sonner'
import { RefreshCw, Database, AlertCircle, CheckCircle, Loader2, Cloud } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { bearerHeaders } from '@/lib/http-headers'

interface SyncResult {
  ok: boolean
  phase: number
  dryRun: boolean
  durationMs: number
  results: Record<string, { fetched: number; updated: number; errors: number; error?: string }>
}

export function SyncTestSection() {
  const token = useAuthStore((s) => s.token)
  const [loading, setLoading] = React.useState<number | null>(null)
  const [results, setResults] = React.useState<SyncResult[]>([])
  const [lastAction, setLastAction] = React.useState<string>('')

  async function runPhase(phase: number, dryRun: boolean) {
    setLoading(phase)
    setLastAction(`Phase ${phase} ${dryRun ? '(Dry-Run)' : '(Sync จริง)'}`)
    try {
      const res = await fetch(`/api/cron/sync-legacy/phase?phase=${phase}&dryRun=${dryRun ? '1' : '0'}`, {
        headers: bearerHeaders(token),
      })
      const json = await res.json()
      if (json.ok) {
        setResults(prev => [...prev.filter(r => r.phase !== phase), json])
        // `json` is `any` from res.json(), so Object.values(...) is `any[]` and the
        // annotated reduce callbacks don't match its overloads. Normalize to a
        // typed record first.
        const phaseResults = (json.results ?? {}) as Record<string, { fetched?: number; errors?: number }>
        const totalFetched = Object.values(phaseResults).reduce((s, r) => s + (r?.fetched ?? 0), 0)
        const totalErrors = Object.values(phaseResults).reduce((s, r) => s + (r?.errors ?? 0), 0)
        if (totalErrors > 0) {
          toast.warning(`Phase ${phase}: ดึง ${totalFetched} แถว, ${totalErrors} errors`)
        } else {
          toast.success(`Phase ${phase}: ดึง ${totalFetched} แถว สำเร็จ`)
        }
      } else {
        toast.error(`Phase ${phase} ล้มเหลว: ${json.error || 'Unknown'}`)
      }
    } catch (err) {
      toast.error(`Phase ${phase} ล้มเหลว: ${err instanceof Error ? err.message : 'Network error'}`)
    } finally {
      setLoading(null)
    }
  }

  async function runAllDryRun() {
    for (let p = 1; p <= 3; p++) {
      await runPhase(p, true)
    }
  }

  async function runAllSync() {
    if (!confirm('ยืนยันการ sync จริง — ข้อมูลจะถูกเขียนลง database ทันที')) return
    for (let p = 1; p <= 3; p++) {
      await runPhase(p, false)
    }
  }

  const phases = [
    { num: 1, label: 'Phase 1: ITAM', desc: 'Devices, MeterReadings, Transfers, Users, Settings, MasterItems, Sites', icon: Database },
    { num: 2, label: 'Phase 2: Services', desc: 'WorkOrders (ใบแจ้งซ่อม)', icon: RefreshCw },
    { num: 3, label: 'Phase 3: Stock', desc: 'Products, StockIn, StockOut, PurchaseOrders', icon: Cloud },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="h-5 w-5 text-[#f97316]" />
          ทดสอบ Sync ข้อมูลจากแอปเดิม
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          ดึงข้อมูลจาก 3 Google Sheets (ITAM, Services, Stock) — ทั้งหมด 12 ตาราง
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={runAllDryRun}
            disabled={loading !== null}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            {loading === null ? <Database className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            ทดสอบทั้งหมด (Dry-Run)
          </Button>
          <Button
            onClick={runAllSync}
            disabled={loading !== null}
            size="sm"
            className="gap-1.5 bg-[#f97316] text-white hover:bg-[#ea580c]"
          >
            <Cloud className="h-3.5 w-3.5" />
            Sync จริงทั้งหมด
          </Button>
        </div>

        {/* Phase buttons */}
        <div className="space-y-2">
          {phases.map((p) => {
            const Icon = p.icon
            const result = results.find(r => r.phase === p.num)
            return (
              <div key={p.num} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium">{p.label}</p>
                      <p className="text-[11px] text-slate-400">{p.desc}</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runPhase(p.num, true)}
                      disabled={loading !== null}
                      className="h-7 text-xs"
                    >
                      {loading === p.num ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Dry-Run'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => runPhase(p.num, false)}
                      disabled={loading !== null}
                      className="h-7 bg-[#f97316] text-xs text-white hover:bg-[#ea580c]"
                    >
                      Sync
                    </Button>
                  </div>
                </div>
                {/* Result */}
                {result && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      {result.ok ? (
                        <><CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {result.dryRun ? 'Dry-Run' : 'Sync สำเร็จ'} · {result.durationMs}ms
                        </span></>
                      ) : (
                        <><AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                        <span className="text-rose-600 dark:text-rose-400">ล้มเหลว</span></>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(result.results || {}).map(([entity, r]) => (
                        <Badge
                          key={entity}
                          variant="outline"
                          className={`text-[10px] ${
                            r.errors > 0
                              ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300'
                              : r.fetched > 0
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                                : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50'
                          }`}
                        >
                          {entity}: {r.fetched} แถว
                          {r.errors > 0 && ` (${r.errors} err)`}
                        </Badge>
                      ))}
                    </div>
                    {/* Show errors */}
                    {Object.entries(result.results || {}).filter(([, r]) => r.error).map(([entity, r]) => (
                      <div key={entity} className="rounded bg-rose-50 px-2 py-1 text-[10px] text-rose-600 dark:bg-rose-950/20 dark:text-rose-400">
                        ⚠️ {entity}: {r.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Help */}
        <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500 dark:bg-slate-800/30 dark:text-slate-400">
          <p className="font-medium">💡 วิธีใช้:</p>
          <ol className="mt-1 ml-4 list-decimal space-y-0.5">
            <li>กด <strong>Dry-Run</strong> ก่อน — ดึงข้อมูลจริงแต่ไม่เขียนลง DB</li>
            <li>เช็คว่าทุก entity มี <code>แถว &gt; 0</code> และไม่มี error</li>
            <li>ถ้า Dry-Run ผ่าน → กด <strong>Sync จริง</strong></li>
            <li>ล็อกอินด้วยบัญชีจริง (ไม่ใช่ demo) → เช็คข้อมูลครบ</li>
            <li>ถ้าครบ → ปิดแอปเดิมได้</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  )
}
