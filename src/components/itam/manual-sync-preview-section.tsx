'use client'

import * as React from 'react'
import { AlertCircle, Ban, CheckCircle2, Eye, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'

type PreviewAction = 'create' | 'update' | 'skip' | 'error'

type PreviewItem = {
  id: string
  externalKey: string
  action: PreviewAction
  status: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  errorMessage?: string | null
}

type PreviewResponse = {
  syncRun: {
    id: string
    mode: 'preview'
    status: string
    totalRows: number
    createRows: number
    updateRows: number
    skipRows: number
    errorRows: number
    durationMs: number
  }
  items: PreviewItem[]
  sourceMetadata: {
    totalFetched: number
    unmappedColumns: string[]
    quarantinedRows: number
  }
}

const ACTION_LABELS: Record<PreviewAction, string> = {
  create: 'จะสร้าง',
  update: 'จะปรับปรุง',
  skip: 'ข้าม',
  error: 'กักกัน/ผิดพลาด',
}

const ACTION_CLASSES: Record<PreviewAction, string> = {
  create: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  update: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  skip: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
}

function asDateOnly(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function ManualSyncPreviewSection() {
  const [source, setSource] = React.useState('services')
  const [siteFilter, setSiteFilter] = React.useState('')
  const [since, setSince] = React.useState('')
  const [limit, setLimit] = React.useState('100')
  const [result, setResult] = React.useState<PreviewResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  const preview = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    setResult(null)

    const parsedLimit = Math.min(1000, Math.max(1, Number.parseInt(limit, 10) || 100))
    try {
      const response = await fetch('/api/sync/preview', {
        method: 'POST',
        headers: bearerHeaders(useAuthStore.getState()?.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          source,
          target: 'work-order',
          options: {
            siteFilter: siteFilter.trim() || undefined,
            since: asDateOnly(since),
            limit: parsedLimit,
          },
        }),
      })
      const payload = (await response.json()) as Partial<PreviewResponse> & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Preview ไม่สำเร็จ')
      if (!payload.syncRun || !Array.isArray(payload.items) || !payload.sourceMetadata) {
        throw new Error('รูปแบบผลลัพธ์จาก Preview ไม่ถูกต้อง')
      }
      setResult(payload as PreviewResponse)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preview ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  const summary = result?.syncRun
  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
          <Eye className="h-5 w-5 text-[#f97316]" />
          Preview Sync แจ้งซ่อม
        </CardTitle>
        <CardDescription>
          อ่านข้อมูลจาก Apps Script เพื่อเปรียบเทียบกับ ITAM-DB เท่านั้น หน้านี้ยังไม่เขียนทับ WorkOrder และไม่เปิด Sync Now
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="sync-source">แหล่งข้อมูล</Label>
            <select
              id="sync-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="services">Services / แจ้งซ่อม</option>
              <option value="test-mock">Test mock (CI)</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sync-site">Site filter (ถ้ามี)</Label>
            <Input id="sync-site" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)} placeholder="เช่น HQ" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sync-since">ตั้งแต่วันที่</Label>
            <Input id="sync-since" type="date" value={since} onChange={(event) => setSince(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sync-limit">จำนวนสูงสุด</Label>
            <Input id="sync-limit" type="number" min={1} max={1000} value={limit} onChange={(event) => setLimit(event.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="button" onClick={preview} disabled={loading} className="w-full bg-[#f97316] text-white hover:bg-[#ea580c] sm:w-auto">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {loading ? 'กำลัง Preview…' : 'เรียก Preview (ไม่เขียนข้อมูล)'}
          </Button>
          <Button type="button" disabled className="w-full sm:w-auto" title="ต้องผ่าน Audit และ Release gate ก่อน">
            <Ban className="mr-2 h-4 w-4" />
            Sync Now (ปิดไว้)
          </Button>
          <span className="text-xs text-slate-500 dark:text-slate-400">ทุกผลลัพธ์ต้องตรวจสอบ exact-head และ cross-review ก่อน apply</span>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            กำลังอ่านข้อมูลเพื่อทำ Preview โดยไม่เขียนลง ITAM-DB…
          </div>
        )}

        {!loading && !result && !error && (
          <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            เลือกเงื่อนไขแล้วกด Preview เพื่อดูรายการ mapped, quarantine และ unmapped โดยไม่เปลี่ยนข้อมูลจริง
          </div>
        )}

        {result && summary && (
          <div className="space-y-5" aria-live="polite">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {([
                ['ทั้งหมด', summary.totalRows, 'text-slate-700 dark:text-slate-200'],
                ['สร้าง', summary.createRows, 'text-emerald-700 dark:text-emerald-300'],
                ['ปรับปรุง', summary.updateRows, 'text-sky-700 dark:text-sky-300'],
                ['ข้าม', summary.skipRows, 'text-slate-600 dark:text-slate-300'],
                ['ผิดพลาด', summary.errorRows, 'text-red-700 dark:text-red-300'],
              ] as const).map(([label, count, color]) => (
                <div key={label} className="rounded-md border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
                  <div className={cn('mt-1 text-xl font-semibold', color)}>{count}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
              <Badge variant="outline">Fetched: {result.sourceMetadata.totalFetched}</Badge>
              <Badge variant="outline">Quarantine: {result.sourceMetadata.quarantinedRows}</Badge>
              <Badge variant="outline">ใช้เวลา: {summary.durationMs} ms</Badge>
              {result.sourceMetadata.unmappedColumns.length > 0 && (
                <Badge className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  Unmapped: {result.sourceMetadata.unmappedColumns.join(', ')}
                </Badge>
              )}
            </div>

            {result.items.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                ไม่พบรายการที่ต้องแสดง
              </div>
            ) : (
              <div className="space-y-2">
                {result.items.slice(0, 100).map((item) => (
                  <div key={item.id} className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-slate-700 dark:text-slate-200">{item.externalKey}</div>
                      {item.errorMessage && <div className="mt-1 text-xs text-red-600 dark:text-red-300">{item.errorMessage}</div>}
                    </div>
                    <Badge className={cn('w-fit', ACTION_CLASSES[item.action])}>
                      {item.action === 'error' ? <AlertCircle className="mr-1 h-3 w-3" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                      {ACTION_LABELS[item.action]}
                    </Badge>
                  </div>
                ))}
                {result.items.length > 100 && <div className="text-xs text-slate-500">แสดง 100 รายการแรกจาก {result.items.length} รายการ เพื่อลดการใช้ทรัพยากรหน้าเว็บ</div>}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
