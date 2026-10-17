'use client'

/**
 * NumberingSchemesTab — แท็บตั้งค่าระบบเลขทะเบียน/เลขเอกสารแบบยืดหยุ่น
 *
 * ใช้ร่วมกันได้ทุก docType (device / work-order / ...) — ผู้ใช้ประกอบรูปแบบเลข
 * จาก "ส่วนประกอบ" (หมวดหมู่ ปีที่ซื้อ สาขา เลขลำดับ ฯลฯ) ผ่านตัวช่วยคลิก
 * พร้อมพรีวิวสดที่ใช้รหัสหมวดหมู่จริงจากฐานข้อมูล
 *
 * ตัวอย่าง: {cat1:3}-{cat2:3}-{yearBE:4}-{seq:5} → 001-201-2569-00001
 */

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/auth-store'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Hash,
  Plus,
  Check,
  Sparkles,
  Trash2,
  Pencil,
  Wand2,
  Layers,
  ChevronRight,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react'

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** Build fetch headers with the user's JWT (if logged in). */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const t = useAuthStore.getState()?.token
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

export interface NumberingScheme {
  id: string
  docType: string
  name: string
  pattern: string
  prefix: string | null
  description: string | null
  resetPolicy: string
  isActive: boolean
}

export interface CategoryCodeRow {
  id: string
  docType: string
  code: string
  label: string
  parentCode: string | null
  matchKey: string | null
  active: boolean
  sortOrder: number
}

interface TokenDoc {
  token: string
  label: string
  desc: string
  example: string
  accent?: boolean
}

const TOKENS: TokenDoc[] = [
  { token: '{cat1:3}', label: 'หมวดใหญ่', desc: 'รหัสหมวดหมู่ระดับ 1 เช่น อุปกรณ์สำนักงาน', example: '001', accent: true },
  { token: '{cat2:3}', label: 'หมวดย่อย', desc: 'รหัสหมวดหมู่ระดับ 2 เช่น ปรินเตอร์ AIO', example: '201', accent: true },
  { token: '{yearBE:4}', label: 'ปี พ.ศ. ซื้อ', desc: 'ปีพุทธศักราชจากวันที่ซื้อ', example: '2569', accent: true },
  { token: '{yearBE:2}', label: 'ปี พ.ศ. (2หลัก)', desc: 'เช่น 69', example: '69' },
  { token: '{year:4}', label: 'ปี ค.ศ.', desc: 'ปีคริสต์ศักราชจากวันที่ซื้อ', example: '2026' },
  { token: '{month:2}', label: 'เดือน', desc: 'เดือนที่ซื้อ 01–12', example: '09' },
  { token: '{site}', label: 'รหัสสาขา', desc: 'สาขาที่ลงทะเบียน', example: 'UDH' },
  { token: '{dept:4}', label: 'รหัสแผนก', desc: 'รหัสแผนกผู้ใช้งาน', example: 'ACC' },
  { token: '{type}', label: 'ประเภท', desc: 'ประเภทอุปกรณ์ตรงๆ', example: 'PRINTER' },
  { token: '{prefix}', label: 'คำนำหน้า', desc: 'ตั้งค่าในช่องคำนำหน้าด้านบน', example: 'ASSET' },
  { token: '{seq:5}', label: 'เลขลำดับ', desc: 'นับต่อเนื่องต่อหมวด+ปี (แก้จำนวนหลักได้)', example: '00001', accent: true },
]

const SEPARATORS = ['-', '_', '/', '.']

// ────────────────────────────────────────────────────────────
// Live preview (client-side mirror ของ engine — ใช้รหัสจริงจาก DB)
// ────────────────────────────────────────────────────────────

function clientPreview(
  pattern: string,
  prefix: string,
  ctx: { cat1?: string; cat2?: string; type?: string; site?: string },
): string {
  const now = new Date()
  const be = now.getFullYear() + 543
  let out = pattern
  const replacements: Record<string, string> = {
    'cat1:3': (ctx.cat1 ?? '000').padStart(3, '0'),
    'cat2:3': (ctx.cat2 ?? ctx.cat1 ?? '000').padStart(3, '0'),
    'cat:3': (ctx.cat2 ?? ctx.cat1 ?? '000').padStart(3, '0'),
    'yearBE:4': String(be),
    'yearBE:2': String(be).slice(-2),
    'year:4': String(now.getFullYear()),
    'year:2': String(now.getFullYear()).slice(-2),
    'month:2': String(now.getMonth() + 1).padStart(2, '0'),
    site: ctx.site ?? 'UDH',
    dept: 'ACC',
    type: ctx.type ?? 'PRINTER',
    prefix: prefix || 'ASSET',
  }
  // แทนที่ token ที่รู้จัก ({seq} ต้องเคารพจำนวนหลักที่ระบุ เช่น {seq:4} → 0001)
  out = out.replace(/\{seq(:(\d+))?\}/g, (_, _colons, pad) => {
    const len = pad ? parseInt(pad, 10) : 5
    return '1'.padStart(Math.max(len, 1), '0')
  })
  for (const [tok, val] of Object.entries(replacements)) {
    out = out.split(`{${tok}}`).join(val)
  }
  // token ที่ไม่รู้จักเหลือค้าง → แสดงสีแดงใน UI (ตรวจจับได้จาก } เหลืออยู่)
  return out
}

function hasUnknownTokens(pattern: string): boolean {
  const known = new Set(TOKENS.map((t) => t.token))
  const found = pattern.match(/\{([^}]+)\}/g) ?? []
  return found.some((f) => !known.has(f))
}

// ────────────────────────────────────────────────────────────
// Scheme editor dialog (สร้าง/แก้ไข)
// ────────────────────────────────────────────────────────────

interface SchemeDialogState {
  open: boolean
  editing?: NumberingScheme // undefined = create
  name: string
  pattern: string
  prefix: string
  description: string
  resetPolicy: string
}

function SchemeDialog({
  state,
  onClose,
  onSave,
  saving,
  categories,
}: {
  state: SchemeDialogState
  onClose: () => void
  onSave: () => void
  saving: boolean
  categories: CategoryCodeRow[]
}) {
  const [previewType, setPreviewType] = React.useState<string>('')
  const typeInputRef = React.useRef<HTMLInputElement>(null)
  const patternSetter = React.useContext(PatternSetterContext)
  const nameSetter = React.useContext(NameSetterContext)
  const prefixSetter = React.useContext(PrefixSetterContext)
  const descriptionSetter = React.useContext(DescriptionSetterContext)
  const resetPolicySetter = React.useContext(ResetPolicySetterContext)

  // หา cat1/cat2 จากหมวดหมู่จริงตาม type ที่เลือกพรีวิว
  const previewCat = React.useMemo(() => {
    if (!previewType) {
      const first = categories.find((c) => c.parentCode)
      if (!first) return { cat1: '001', cat2: '201', type: '' }
      return {
        cat1: first.parentCode ?? '000',
        cat2: first.code,
        type: first.matchKey ?? '',
      }
    }
    const row = categories.find(
      (c) => (c.matchKey ?? '').toLowerCase() === previewType.toLowerCase(),
    )
    if (!row) return { cat1: '000', cat2: '000', type: previewType }
    return { cat1: row.parentCode ?? row.code, cat2: row.code, type: previewType }
  }, [previewType, categories])

  const insertToken = (token: string) => {
    // แทรกที่ตำแหน่ง cursor ของ input pattern
    const el = typeInputRef.current
    const cur = state.pattern
    if (el && document.activeElement === el) {
      const start = el.selectionStart ?? cur.length
      const end = el.selectionEnd ?? cur.length
      const next = cur.slice(0, start) + token + cur.slice(end)
      // ใช้ callback เพื่ออัปเดต state ของ parent
      patternSetter?.(next)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(start + token.length, start + token.length)
      })
    } else {
      patternSetter?.(cur + token)
    }
  }

  // patternSetter ถูก inject ผ่าน context จาก parent

  const preview = clientPreview(state.pattern, state.prefix, previewCat)
  const unknown = hasUnknownTokens(state.pattern)
  const hasSeq = /\{seq(:\d+)?\}/.test(state.pattern)

  const subCats = categories.filter((c) => c.parentCode)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
    <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-[#f97316]" />
          {state.editing ? 'แก้ไขรูปแบบเลข' : 'สร้างรูปแบบเลขใหม่'}
        </DialogTitle>
        <DialogDescription>
          ประกอบรูปแบบจากส่วนต่างๆ ด้านล่าง — คลิกส่วนที่ต้องการเพื่อแทรก หรือพิมพ์เองในช่องรูปแบบก็ได้
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* ── ชื่อ + คำอธิบาย ── */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ns-name">ชื่อรูปแบบ *</Label>
            <Input
              id="ns-name"
              value={state.name}
              onChange={(e) => nameSetter?.(e.target.value)}
              placeholder="เช่น หมวดหมู่–ปี พ.ศ.–ลำดับ"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ns-prefix">คำนำหน้า (สำหรับ {'{prefix}'})</Label>
            <Input
              id="ns-prefix"
              value={state.prefix}
              onChange={(e) => prefixSetter?.(e.target.value)}
              placeholder="ASSET / WO / ว่างได้"
              className="font-mono"
            />
          </div>
        </div>

        {/* ── ตัวช่วยเลือกส่วนประกอบ ── */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            คลิกเพื่อแทรกส่วนประกอบ
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TOKENS.map((tk) => (
              <button
                key={tk.token}
                type="button"
                title={`${tk.desc} — ตัวอย่าง ${tk.example}`}
                onClick={() => insertToken(tk.token)}
                className={`group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-all hover:shadow-sm ${
                  tk.accent
                    ? 'border-[#f97316]/40 bg-[#fff7ed] text-[#9a3412] hover:border-[#f97316] hover:bg-[#ffedd5] dark:border-[#f97316]/30 dark:bg-[#f97316]/10 dark:text-[#fdba74]'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                <code className="font-mono">{tk.token}</code>
                <span className="text-slate-400 group-hover:text-current">+{tk.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[10px] text-slate-400">ตัวคั่น:</span>
            {SEPARATORS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => insertToken(s)}
                className="h-6 w-6 rounded border border-slate-200 bg-white font-mono text-xs text-slate-500 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-900"
                title={`แทรกตัวคั่น ${s}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ── ช่องรูปแบบ ── */}
        <div className="space-y-1.5">
          <Label htmlFor="ns-pattern">รูปแบบ * (ต้องมี {'{seq}'} อย่างน้อย 1 จุด)</Label>
          <Input
            id="ns-pattern"
            ref={typeInputRef}
            value={state.pattern}
            onChange={(e) => patternSetter?.(e.target.value)}
            placeholder="{cat1:3}-{cat2:3}-{yearBE:4}-{seq:5}"
            className="bg-amber-50/50 font-mono dark:bg-amber-950/10"
          />
          {unknown && (
            <p className="flex items-center gap-1 text-xs text-red-500">
              <AlertTriangle className="h-3 w-3" />
              มีส่วนประกอบที่ระบบไม่รู้จัก (อยู่ในเครื่องหมาย {'{ }'} แต่ไม่ตรงรายการ)
            </p>
          )}
          {!hasSeq && (
            <p className="flex items-center gap-1 text-xs text-red-500">
              <AlertTriangle className="h-3 w-3" />
              ยังไม่มีเลขลำดับ {'{seq}'} — ทุกเลขจะซ้ำกัน
            </p>
          )}
        </div>

        {/* ── นโยบายรีเซ็ต ── */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>รีเซ็ตเลขลำดับ</Label>
            <Select value={state.resetPolicy} onValueChange={(v) => resetPolicySetter?.(v)}>
              <SelectTrigger className="w-full" id="ns-reset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">ไม่รีเซ็ต (นับต่อเนื่องตลอด)</SelectItem>
                <SelectItem value="yearly">รายปี (เริ่ม 00001 ทุกปีใหม่)</SelectItem>
                <SelectItem value="monthly">รายเดือน (เริ่มใหม่ทุกเดือน)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>ทดสอบกับประเภท</Label>
            <Select value={previewType || previewCat.type} onValueChange={setPreviewType}>
              <SelectTrigger className="w-full" id="ns-testtype">
                <SelectValue placeholder="เลือกประเภทอุปกรณ์" />
              </SelectTrigger>
              <SelectContent>
                {subCats.length === 0 ? (
                  <SelectItem value="PRINTER">PRINTER</SelectItem>
                ) : (
                  subCats.map((c) => (
                    <SelectItem key={c.id} value={c.matchKey ?? c.label}>
                      {c.label} {c.matchKey ? `(${c.matchKey})` : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── พรีวิวสด ── */}
        <div className="rounded-lg border-2 border-dashed border-[#f97316]/40 bg-gradient-to-br from-[#fff7ed] to-white p-4 dark:from-[#f97316]/5 dark:to-slate-900">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#c2410c]">
            <Sparkles className="h-3 w-3" />
            ตัวอย่างเลขที่จะได้
          </div>
          <div className="break-all font-mono text-xl font-bold tracking-wider text-[#9a3412] dark:text-[#fdba74]">
            {preview || '—'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            หมวด {previewCat.cat1} · หมวดย่อย {previewCat.cat2} · ปี พ.ศ. {new Date().getFullYear() + 543}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ns-desc">คำอธิบาย</Label>
          <Input
            id="ns-desc"
            value={state.description}
            onChange={(e) => descriptionSetter?.(e.target.value)}
            placeholder="อธิบายสั้นๆ ว่ารูปแบบนี้คืออะไร"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button
          onClick={onSave}
          disabled={saving || !state.name.trim() || !hasSeq}
          className="bg-[#f97316] text-white hover:bg-[#ea580c]"
        >
          {saving && <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {state.editing ? 'บันทึกการแก้ไข' : 'สร้างรูปแบบ'}
        </Button>
      </DialogFooter>
    </DialogContent>
    </Dialog>
  )
}

// Context สำหรับ setter ของ dialog fields (inject จาก parent)
const PatternSetterContext = React.createContext<((v: string) => void) | null>(null)
const NameSetterContext = React.createContext<((v: string) => void) | null>(null)
const PrefixSetterContext = React.createContext<((v: string) => void) | null>(null)
const DescriptionSetterContext = React.createContext<((v: string) => void) | null>(null)
const ResetPolicySetterContext = React.createContext<((v: string) => void) | null>(null)

// ────────────────────────────────────────────────────────────
// หมวดหมู่: dialog แก้ไขรหัสหมวด
// ────────────────────────────────────────────────────────────

interface CatDialogState {
  open: boolean
  editing?: CategoryCodeRow
  code: string
  label: string
  parentCode: string
  matchKey: string
}

function CategoryDialog({
  state,
  categories,
  onClose,
  onSave,
  saving,
}: {
  state: CatDialogState
  categories: CategoryCodeRow[]
  onClose: () => void
  onSave: () => void
  saving: boolean
}) {
  const majors = categories.filter((c) => !c.parentCode)
  const catSetter = React.useContext(CatDialogSettersContext)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {state.editing ? `แก้ไขหมวดหมู่ ${state.editing.code}` : 'เพิ่มหมวดหมู่'}
        </DialogTitle>
        <DialogDescription>
          รหัสหมวดถูกใช้ในเลขทะเบียน เช่น 001-201-… — ใช้ตัวเลข 3 หลักแนะนำ
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cat-code">รหัส *</Label>
            <Input
              id="cat-code"
              value={state.code}
              onChange={(e) => catSetter?.code(e.target.value)}
              placeholder="001"
              className="font-mono"
              maxLength={10}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-parent">หมวดแม่</Label>
            <Select value={state.parentCode || '__none'} onValueChange={(v) => catSetter?.parentCode(v === '__none' ? '' : v)}>
              <SelectTrigger className="w-full" id="cat-parent-sel">
                <SelectValue placeholder="(หมวดใหญ่)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">(หมวดใหญ่ — ระดับบนสุด)</SelectItem>
                {majors.map((m) => (
                  <SelectItem key={m.id} value={m.code}>
                    {m.code} — {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat-label">ชื่อหมวดหมู่ *</Label>
          <Input
            id="cat-label"
            value={state.label}
            onChange={(e) => catSetter?.label(e.target.value)}
            placeholder="เช่น ปรินเตอร์ AIO"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat-match">คีย์จับคู่ (matchKey)</Label>
          <Input
            id="cat-match"
            value={state.matchKey}
            onChange={(e) => catSetter?.matchKey(e.target.value)}
            placeholder="PRINTER — ประเภทอุปกรณ์ที่จะใช้หมวดนี้ (ว่างได้สำหรับหมวดใหญ่)"
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-slate-500">
            เมื่อเพิ่มอุปกรณ์ประเภทนี้ ระบบจะใช้รหัสหมวดนี้ในเลขทะเบียนอัตโนมัติ
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
        <Button
          onClick={onSave}
          disabled={saving || !state.code.trim() || !state.label.trim()}
          className="bg-[#f97316] text-white hover:bg-[#ea580c]"
        >
          บันทึก
        </Button>
      </DialogFooter>
    </DialogContent>
    </Dialog>
  )
}

interface CatDialogSetters {
  code: (v: string) => void
  label: (v: string) => void
  parentCode: (v: string) => void
  matchKey: (v: string) => void
}
const CatDialogSettersContext = React.createContext<CatDialogSetters | null>(null)

// ────────────────────────────────────────────────────────────
// Main tab component
// ────────────────────────────────────────────────────────────

export function NumberingSchemesTab({
  docType = 'device',
  title = 'รูปแบบเลขทะเบียนสินทรัพย์',
  subtitle = 'ประกอบรูปแบบเลขจากหมวดหมู่ ปีที่ซื้อ เลขลำดับ และอื่นๆ — ใช้งานทันทีทั้งเมนูและ API',
}: {
  docType?: string
  title?: string
  subtitle?: string
}) {
  const queryClient = useQueryClient()
  const [schemeDialog, setSchemeDialog] = React.useState<SchemeDialogState>({
    open: false,
    name: '',
    pattern: '',
    prefix: '',
    description: '',
    resetPolicy: 'never',
  })
  const [catDialog, setCatDialog] = React.useState<CatDialogState>({
    open: false,
    code: '',
    label: '',
    parentCode: '',
    matchKey: '',
  })
  const [showCategories, setShowCategories] = React.useState(docType === 'device')

  // ── Queries ──
  const schemesQuery = useQuery<{ schemes: NumberingScheme[]; active: NumberingScheme | null }>({
    queryKey: ['numbering-schemes', docType],
    queryFn: async () => {
      const res = await fetch(`/api/numbering/schemes?docType=${docType}`, { headers: authHeaders() })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const catsQuery = useQuery<{ categories: CategoryCodeRow[] }>({
    queryKey: ['numbering-categories', docType],
    queryFn: async () => {
      const res = await fetch(`/api/numbering/categories?docType=${docType}`, { headers: authHeaders() })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // ── Mutations: schemes ──
  const saveScheme = useMutation({
    mutationFn: async (s: SchemeDialogState) => {
      const payload = {
        docType,
        name: s.name,
        pattern: s.pattern,
        prefix: s.prefix,
        description: s.description,
        resetPolicy: s.resetPolicy,
      }
      const res = s.editing
        ? await fetch(`/api/numbering/schemes/${s.editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/numbering/schemes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify(payload),
          })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: (_d, s) => {
      toast.success(s.editing ? 'บันทึกการแก้ไขเรียบร้อย' : 'สร้างรูปแบบใหม่เรียบร้อย')
      setSchemeDialog((p) => ({ ...p, open: false }))
      queryClient.invalidateQueries({ queryKey: ['numbering-schemes', docType] })
    },
    onError: (e: Error) => toast.error(e.message || 'บันทึกไม่สำเร็จ'),
  })

  const activateScheme = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/numbering/schemes/${id}/activate`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('เปลี่ยนรูปแบบที่ใช้งานเรียบร้อย')
      queryClient.invalidateQueries({ queryKey: ['numbering-schemes', docType] })
    },
    onError: () => toast.error('เปลี่ยนรูปแบบไม่สำเร็จ'),
  })

  const deleteScheme = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/numbering/schemes/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('ลบรูปแบบเรียบร้อย')
      queryClient.invalidateQueries({ queryKey: ['numbering-schemes', docType] })
    },
    onError: (e: Error) => toast.error(e.message || 'ลบไม่สำเร็จ'),
  })

  // ── Mutations: categories ──
  const saveCat = useMutation({
    mutationFn: async (c: CatDialogState) => {
      const payload = {
        docType,
        code: c.code,
        label: c.label,
        parentCode: c.parentCode || null,
        matchKey: c.matchKey || null,
      }
      const res = c.editing
        ? await fetch(`/api/numbering/categories/${c.editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/numbering/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify(payload),
          })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: (_d, c) => {
      toast.success(c.editing ? 'แก้ไขหมวดหมู่เรียบร้อย' : 'เพิ่มหมวดหมู่เรียบร้อย')
      setCatDialog((p) => ({ ...p, open: false }))
      queryClient.invalidateQueries({ queryKey: ['numbering-categories', docType] })
    },
    onError: (e: Error) => toast.error(e.message || 'บันทึกไม่สำเร็จ'),
  })

  const deleteCat = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/numbering/categories/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('ลบหมวดหมู่เรียบร้อย')
      queryClient.invalidateQueries({ queryKey: ['numbering-categories', docType] })
    },
    onError: (e: Error) => toast.error(e.message || 'ลบไม่สำเร็จ'),
  })

  const schemes = schemesQuery.data?.schemes ?? []
  const active = schemesQuery.data?.active ?? null
  const categories = catsQuery.data?.categories ?? []
  const majors = categories.filter((c) => !c.parentCode)
  const subMap = new Map<string, CategoryCodeRow[]>()
  for (const c of categories) {
    if (c.parentCode) {
      const arr = subMap.get(c.parentCode) ?? []
      arr.push(c)
      subMap.set(c.parentCode, arr)
    }
  }

  // setters สำหรับ dialog fields
  const patternSetter = React.useCallback(
    (v: string) => setSchemeDialog((p) => ({ ...p, pattern: v })),
    [],
  )
  const nameSetter = React.useCallback(
    (v: string) => setSchemeDialog((p) => ({ ...p, name: v })),
    [],
  )
  const prefixSetter = React.useCallback(
    (v: string) => setSchemeDialog((p) => ({ ...p, prefix: v })),
    [],
  )
  const descriptionSetter = React.useCallback(
    (v: string) => setSchemeDialog((p) => ({ ...p, description: v })),
    [],
  )
  const resetPolicySetter = React.useCallback(
    (v: string) => setSchemeDialog((p) => ({ ...p, resetPolicy: v })),
    [],
  )
  const catSetters: CatDialogSetters = React.useMemo(
    () => ({
      code: (v) => setCatDialog((p) => ({ ...p, code: v })),
      label: (v) => setCatDialog((p) => ({ ...p, label: v })),
      parentCode: (v) => setCatDialog((p) => ({ ...p, parentCode: v })),
      matchKey: (v) => setCatDialog((p) => ({ ...p, matchKey: v })),
    }),
    [],
  )

  const firstSub = categories.find((c) => c.parentCode)

  return (
    <div className="space-y-4">
      {/* ═══ ส่วนที่ 1: รูปแบบเลข ═══ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Hash className="h-5 w-5 text-[#f97316]" />
              {title}
            </CardTitle>
            <CardDescription>{subtitle}</CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              setSchemeDialog({
                open: true,
                name: '',
                pattern: '{cat1:3}-{cat2:3}-{yearBE:4}-{seq:5}',
                prefix: '',
                description: '',
                resetPolicy: 'yearly',
              })
            }
            className="border-[#f97316] text-[#f97316] hover:bg-[#fff7ed]"
          >
            <Plus className="mr-2 h-4 w-4" />
            สร้างรูปแบบใหม่
          </Button>
        </CardHeader>
        <CardContent>
          {schemesQuery.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-36 w-full" />
              ))}
            </div>
          ) : schemes.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              ยังไม่มีรูปแบบ — คลิก &quot;สร้างรูปแบบใหม่&quot; เพื่อเริ่ม
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {schemes.map((s) => {
                const isActive = active?.id === s.id
                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border p-4 transition-all ${
                      isActive
                        ? 'border-[#f97316] bg-[#fff7ed] shadow-sm dark:bg-[#f97316]/5'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate font-semibold">{s.name}</h4>
                          {isActive && (
                            <Badge className="bg-[#f97316] text-white hover:bg-[#f97316]">
                              <Check className="mr-1 h-3 w-3" />
                              ใช้งานอยู่
                            </Badge>
                          )}
                        </div>
                        {s.description && (
                          <p className="mt-0.5 text-xs text-slate-500">{s.description}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          title="แก้ไข"
                          onClick={() =>
                            setSchemeDialog({
                              open: true,
                              editing: s,
                              name: s.name,
                              pattern: s.pattern,
                              prefix: s.prefix ?? '',
                              description: s.description ?? '',
                              resetPolicy: s.resetPolicy,
                            })
                          }
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title={isActive ? 'ลบไม่ได้ขณะใช้งาน' : 'ลบ'}
                          disabled={isActive}
                          onClick={() => {
                            if (confirm(`ลบรูปแบบ "${s.name}"?`)) deleteScheme.mutate(s.id)
                          }}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* pattern + ตัวอย่าง */}
                    <div className="mb-3 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        รูปแบบ
                      </div>
                      <code className="font-mono text-sm text-slate-700 dark:text-slate-200">
                        {s.pattern}
                      </code>
                      <div className="mt-1.5 border-t border-slate-200 pt-1.5 dark:border-slate-700">
                        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                          ตัวอย่าง
                        </div>
                        <div className="break-all font-mono text-sm font-semibold text-[#9a3412] dark:text-[#fdba74]">
                          {clientPreview(s.pattern, s.prefix ?? '', {
                            cat1: firstSub?.parentCode ?? undefined,
                            cat2: firstSub?.code ?? undefined,
                            type: firstSub?.matchKey ?? undefined,
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
                      <RotateCcw className="h-3 w-3" />
                      {s.resetPolicy === 'never'
                        ? 'นับต่อเนื่อง'
                        : s.resetPolicy === 'yearly'
                          ? 'รีเซ็ตรายปี'
                          : 'รีเซ็ตรายเดือน'}
                    </div>

                    {!isActive && (
                      <Button
                        size="sm"
                        onClick={() => activateScheme.mutate(s.id)}
                        disabled={activateScheme.isPending}
                        className="w-full bg-[#f97316] text-white hover:bg-[#ea580c]"
                      >
                        {activateScheme.isPending ? 'กำลังเปลี่ยน…' : 'ใช้รูปแบบนี้'}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ ส่วนที่ 2: หมวดหมู่และรหัส ═══ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-[#0d9488]" />
              หมวดหมู่และรหัสหมวด
            </CardTitle>
            <CardDescription>
              รหัสหมวดหมู่ที่ใช้ใน {'{cat1}'} / {'{cat2}'} — จัดการเพิ่ม/ลบ/แก้ได้ง่าย หมวดย่อยอยู่ใต้หมวดใหญ่
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCategories((v) => !v)}
              className="text-slate-500"
            >
              {showCategories ? 'ซ่อน' : 'แสดง'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCatDialog({ open: true, code: '', label: '', parentCode: '', matchKey: '' })
              }
              className="border-[#0d9488] text-[#0d9488] hover:bg-teal-50"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              เพิ่มหมวดหมู่
            </Button>
          </div>
        </CardHeader>
        {showCategories && (
          <CardContent>
            {catsQuery.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : categories.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
                ยังไม่มีหมวดหมู่ — คลิก &quot;เพิ่มหมวดหมู่&quot; เพื่อเริ่มกำหนดรหัส
              </div>
            ) : (
              <div className="space-y-2">
                {majors.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    {/* หมวดใหญ่ */}
                    <div className="flex items-center justify-between gap-2 rounded-t-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-[#0d9488]/10 px-1.5 py-0.5 font-mono text-xs font-bold text-[#0f766e]">
                          {m.code}
                        </code>
                        <span className="text-sm font-semibold">{m.label}</span>
                        <span className="text-[10px] text-slate-400">หมวดใหญ่</span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          title="แก้ไข"
                          onClick={() =>
                            setCatDialog({
                              open: true,
                              editing: m,
                              code: m.code,
                              label: m.label,
                              parentCode: '',
                              matchKey: m.matchKey ?? '',
                            })
                          }
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="ลบ (หมวดย่อยจะยกเป็นหมวดใหญ่)"
                          onClick={() => {
                            if (confirm(`ลบหมวด "${m.label}"?`)) deleteCat.mutate(m.id)
                          }}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {/* หมวดย่อย */}
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(subMap.get(m.code) ?? []).map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 pl-8">
                          <div className="flex min-w-0 items-center gap-2">
                            <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" />
                            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {c.code}
                            </code>
                            <span className="truncate text-sm">{c.label}</span>
                            {c.matchKey && (
                              <Badge
                                variant="outline"
                                className="shrink-0 border-slate-200 font-mono text-[10px] text-slate-500 dark:border-slate-700"
                              >
                                {c.matchKey}
                              </Badge>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              title="แก้ไข"
                              onClick={() =>
                                setCatDialog({
                                  open: true,
                                  editing: c,
                                  code: c.code,
                                  label: c.label,
                                  parentCode: c.parentCode ?? '',
                                  matchKey: c.matchKey ?? '',
                                })
                              }
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="ลบ"
                              onClick={() => {
                                if (confirm(`ลบหมวด "${c.label}"?`)) deleteCat.mutate(c.id)
                              }}
                              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                      {(subMap.get(m.code) ?? []).length === 0 && (
                        <div className="px-3 py-2 pl-8 text-xs text-slate-400">
                          ยังไม่มีหมวดย่อยใต้หมวดนี้
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ═══ Dialogs ═══ */}
      <PatternSetterContext.Provider value={patternSetter}>
        <NameSetterContext.Provider value={nameSetter}>
          <PrefixSetterContext.Provider value={prefixSetter}>
            <DescriptionSetterContext.Provider value={descriptionSetter}>
              <ResetPolicySetterContext.Provider value={resetPolicySetter}>
                {schemeDialog.open && (
                  <SchemeDialog
                    state={schemeDialog}
                    categories={categories}
                    onClose={() => setSchemeDialog((p) => ({ ...p, open: false }))}
                    onSave={() => saveScheme.mutate(schemeDialog)}
                    saving={saveScheme.isPending}
                  />
                )}
              </ResetPolicySetterContext.Provider>
            </DescriptionSetterContext.Provider>
          </PrefixSetterContext.Provider>
        </NameSetterContext.Provider>
      </PatternSetterContext.Provider>

      <CatDialogSettersContext.Provider value={catSetters}>
        {catDialog.open && (
          <CategoryDialog
            state={catDialog}
            categories={categories}
            onClose={() => setCatDialog((p) => ({ ...p, open: false }))}
            onSave={() => saveCat.mutate(catDialog)}
            saving={saveCat.isPending}
          />
        )}
      </CatDialogSettersContext.Provider>
    </div>
  )
}
