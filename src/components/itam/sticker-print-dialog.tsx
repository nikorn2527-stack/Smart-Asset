'use client'

/**
 * sticker-print-dialog.tsx — print dialog for device stickers.
 *
 * STICKER-EDITOR-DEEP-REVIEW (current revision):
 *   Root-cause fix for the user complaint "sticker doesn't match what I
 *   designed — even the size is wrong": the previous revision (STICKER-
 *   CUSTOM-SIZE) only let the user pick from 5 built-in *preset* templates.
 *   Custom templates the user designed in the ItamStickerEditor (and saved
 *   to the server via /api/itam/sticker/templates) were NOT loaded into the
 *   dialog — so no matter what the user designed, the dialog printed one of
 *   the 5 presets. The displayed size also mismatched because presets use
 *   their own canvas, not the saved template's canvas.
 *
 *   Fix:
 *     1. The dialog now fetches the user's saved templates via
 *        GET /api/itam/sticker/templates (alongside the built-in presets).
 *     2. The template dropdown shows BOTH groups: "เทมเพลตที่บันทึก"
 *        (saved) + "เทมเพลตสำเร็จ" (presets).
 *     3. When a saved template is selected, its own canvas size is used
 *        (the size-preset dropdown is hidden + read-only text shows the
 *        saved canvas dims). The preset size is bypassed entirely.
 *     4. When a preset is selected, the existing flow applies (preset
 *        builder + size preset → canvas).
 *     5. By default the active saved template is selected on first open.
 *     6. Print always uses canvas-as-page mode (1 sticker per page).
 *        A4 grid mode was removed — it caused layout issues.
 *        For bulk printing on A4 paper, users print one sticker per
 *        page and cut manually.
 *
 * STICKER-CUSTOM-SIZE (prior revision, still applies):
 *   - 9 size presets + 5 template presets + custom W/H inputs.
 *   - Live preview uses renderStickerFromTemplate (template engine).
 *   - @page CSS uses the canvas size (auto mode) for label-printer + A4.
 *   - Preferences persisted to localStorage via sticker-print-prefs.ts.
 */

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { Checkbox } from '@/components/ui/checkbox'
import { matchesSuffixOrContains } from '@/lib/suffix-search'
import { generateStickerQrData } from '@/lib/smart-qr'
import { Printer, Search, Loader2, Tag, QrCode, Ruler, LayoutTemplate, Star } from 'lucide-react'
import type { Device } from './types'
import {
  STICKER_SIZE_PRESETS,
  STICKER_TEMPLATE_PRESETS,
  DEFAULT_STICKER_SETTINGS,
  resolveStickerCanvas,
  substituteVariables,
  renderStickerFromTemplate,
  buildPrintDocument,
  calculateGridColumns,
  deviceToStickerData,
  type StickerCanvas,
  type StickerDeviceData,
  type StickerElement,
  type StickerSettings,
  type StickerTemplate,
} from '@/lib/sticker-template'
import {
  loadStickerPrintPrefs,
  saveStickerPrintPrefs,
  type StickerPrintPrefs,
} from '@/lib/sticker-print-prefs'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  devices: Device[]
  orgName?: string | null
  /**
   * Optional override for the QR code content of each device.
   * Default: encode `device.assetCode` (the historical behavior).
   *
   * Pass a function that returns a string (e.g. the Smart QR URL) to encode
   * something different — used by the accessory-sticker flow where we want
   * the QR to point at `/qr/a/{shortId}?action=view` instead of the asset code.
   *
   * Return `null`/`undefined` to fall back to the asset code for that device.
   */
  qrContentFor?: (device: Device) => string | null | undefined
  /**
   * Optional title override (e.g. "พิมพ์สติกเกอร์อุปกรณ์ต่อพ่วง").
   * Defaults to "🏷️ พิมพ์สติกเกอร์อุปกรณ์".
   */
  dialogTitle?: React.ReactNode
  /**
   * Optional description override shown under the title.
   */
  dialogDescription?: React.ReactNode
}

// ─── Print via hidden iframe (no new window/tab) ────────────────────────
// This matches the behavior of the old Apps Script app — the browser's
// print dialog opens directly without opening a new tab/window.
function printViaIframe(html: string) {
  if (typeof document === 'undefined') return
  // Remove any existing print iframe
  const existing = document.getElementById('sticker-print-iframe')
  if (existing) existing.remove()
  // Create hidden iframe
  const iframe = document.createElement('iframe')
  iframe.id = 'sticker-print-iframe'
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) {
    console.error('[printViaIframe] cannot access iframe document')
    return
  }
  doc.open()
  doc.write(html)
  doc.close()
  // Give the browser a tick to layout + load QR images
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      // Remove iframe after print dialog closes (delay to let it finish)
      setTimeout(() => iframe.remove(), 1000)
    } catch (err) {
      console.error('[printViaIframe] print failed:', err)
      iframe.remove()
    }
  }, 500)
}

// ─── Device → StickerDeviceData ──────────────────────────────────────────
// NOTE: deviceToStickerData is now imported from @/lib/sticker-template
// (single source of truth — preview and print use the same function).

// ─── Build a per-device QR cache honoring `qrContentFor` overrides ────────
// The cache key matches what `renderElement` would look up (i.e. the
// template-substituted `el.content`, falling back to `device.assetCode`).
// The cache value is the actual QR data URL — generated from `qrOverride`
// when provided, else from the default key.
//
// `device` may be null (no sample device available); in that case we still
// walk the template so the preview can render a placeholder QR.
async function buildQrCacheForDevice(
  device: StickerDeviceData | null,
  template: StickerTemplate,
  settings: StickerSettings,
  qrOverride?: string | null,
): Promise<Map<string, string>> {
  const cache = new Map<string, string>()
  for (const el of template.elements as readonly StickerElement[]) {
    if (el.type !== 'qr') continue
    const defaultData =
      substituteVariables(el.content ?? '', device, settings) ||
      device?.assetCode ||
      ''
    if (!defaultData || cache.has(defaultData)) continue
    const qrData = qrOverride ?? defaultData
    try {
      const url = await QRCode.toDataURL(qrData, {
        margin: 1,
        width: 240,
        errorCorrectionLevel: 'M',
      })
      cache.set(defaultData, url)
    } catch {
      // skip on error
    }
  }
  return cache
}

// ─── Component ────────────────────────────────────────────────────────────
export function StickerPrintDialog({
  open,
  onOpenChange,
  devices,
  orgName,
  qrContentFor,
  dialogTitle,
  dialogDescription,
}: Props) {
  const qc = useQueryClient()

  // ── Saved sticker templates (server-side) — STICKER-EDITOR-DEEP-REVIEW ──
  // Fetch the user's designed templates from /api/itam/sticker/templates
  // (the same store the ItamStickerEditor writes to). When the user has a
  // saved template marked as active, we auto-select it on first open so the
  // dialog prints what the user actually designed.
  const { data: tplData } = useQuery({
    queryKey: ['sticker-templates'],
    queryFn: async () => {
      const res = await fetch('/api/itam/sticker/templates')
      if (!res.ok) throw new Error('Failed to load sticker templates')
      return res.json() as Promise<{ templates: StickerTemplate[]; activeId: string | null }>
    },
    enabled: open,
  })
  const savedTemplates = tplData?.templates ?? []
  const activeSavedId = tplData?.activeId ?? null

  // ── Sticker-specific settings (STICKER-SYSTEM-REWRITE) ───────────────────
  // Fetch sticker-specific companyName / orgName / hotline /
  // footerNote / lineOALink from /api/itam/sticker/settings (which reads the
  // AppSetting rows: stickerCompanyName, stickerOrgName, stickerFooterNote,
  // stickerHotline, stickerLineOALink).
  //
  // Why: previously the dialog used the GLOBAL org name for BOTH
  // companyName AND orgName, so a user who customized their sticker
  // header / hotline / footer in the editor saw those edits silently dropped
  // in the dialog's preview + print output. This matches what
  // `printSingleSticker` in devices-page.tsx already does.
  const { data: stickerSettingsData } = useQuery({
    queryKey: ['sticker-settings'],
    queryFn: async () => {
      const res = await fetch('/api/itam/sticker/settings')
      return res.ok ? res.json() : null
    },
    enabled: open,
  })

  // ── Sticker prefs (size + template) — loaded once on mount ─────────────
  const [prefs, setPrefs] = React.useState<StickerPrintPrefs>(() => ({
    sizePresetId: 'default',
    customWidth: 75.2,
    customHeight: 36,
    templatePresetId: 'default',
    savedTemplateId: null,
  }))
  const [prefsLoaded, setPrefsLoaded] = React.useState(false)

  React.useEffect(() => {
    if (!open || prefsLoaded) return
    setPrefs(loadStickerPrintPrefs())
    setPrefsLoaded(true)
  }, [open, prefsLoaded])

  // ── Auto-select logic — STICKER-PREVIEW-FIX-FINAL ───────────────────────
  //
  // REQUIREMENT (from user complaint):
  //   The dialog MUST always print the sticker template the user designed in
  //   the editor and marked as active — not whatever preset the localStorage
  //   prefs happened to remember from a previous session.
  //
  // The previous revision (STICKER-EDITOR-DEEP-REVIEW) only auto-selected the
  // active saved template *once* per session AND only when prefs was empty +
  // still on the default preset. That left a landmine: if the user previously
  // selected an A4 preset (or a saved template that has since been deleted)
  // the prefs would persist a stale `savedTemplateId` / `sizePresetId`, the
  // auto-select would skip, and the preview would render whatever stale
  // template was in localStorage — which is exactly the bug the user filed
  // ("preview shows an A4 document with PPIT + จ่าหน้า + Asset No. +
  // DEMO-COPIER-001, size is A4 not 75.2×36").
  //
  // New behavior:
  //   - On every dialog open, we resync `prefs.savedTemplateId` to the
  //     server-side active id (or clear it to fall back to the default
  //     preset) — UNLESS the user has already manually picked a different
  //     template via the dropdown THIS session.
  //   - A `userOverrideThisSession` ref gates the resync so the user's
  //     manual choice survives the open state flipping during one session.
  //   - When the user closes & reopens the dialog, we resync again — the
  //     active server template always wins eventually.
  const userOverrideRef = React.useRef(false)

  // Reset the per-session override flag whenever the dialog closes so that
  // on the next open we resync to the active saved template again.
  React.useEffect(() => {
    if (!open) {
      userOverrideRef.current = false
    }
  }, [open])

  React.useEffect(() => {
    if (!open || !prefsLoaded) return
    if (!tplData) return
    if (userOverrideRef.current) return

    const desiredSavedId = activeSavedId ?? null
    if (prefs.savedTemplateId !== desiredSavedId) {
      // Resync to the server-side active template. When clearing (no active
      // template), we also reset the preset id so the user gets the default
      // preset, not whatever they happened to pick last time.
      const patch: Partial<StickerPrintPrefs> =
        desiredSavedId === null
          ? { savedTemplateId: null, templatePresetId: 'default' }
          : { savedTemplateId: desiredSavedId }
      updatePrefs(patch)
    } else if (desiredSavedId === null && prefs.templatePresetId !== 'default') {
      // Even when there's no active saved template, ensure we fall back to
      // the default preset (not a stale A4/minimal preset).
      updatePrefs({ templatePresetId: 'default' })
    }
  }, [open, prefsLoaded, tplData, activeSavedId, prefs.savedTemplateId, prefs.templatePresetId])

  function updatePrefs(patch: Partial<StickerPrintPrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      saveStickerPrintPrefs(next)
      return next
    })
  }

  // ── Device selection state (unchanged from previous version) ────────────
  const [search, setSearch] = React.useState('')
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [printing, setPrinting] = React.useState(false)

  // Active (non-disposed) devices only
  const activeDevices = React.useMemo(
    () => (devices ?? []).filter((d) => d.status !== 'disposed'),
    [devices],
  )

  const filteredDevices = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return activeDevices
    return activeDevices.filter(
      (d) =>
        matchesSuffixOrContains(d.assetCode, q) ||
        d.name.toLowerCase().includes(q) ||
        d.brand.toLowerCase().includes(q) ||
        d.model.toLowerCase().includes(q) ||
        matchesSuffixOrContains(d.serialNumber, q),
    )
  }, [activeDevices, search])

  React.useEffect(() => {
    if (open) {
      setSelectedIds(new Set(activeDevices.map((d) => d.id)))
    }
  }, [open, activeDevices])

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function selectAll() {
    setSelectedIds(new Set(filteredDevices.map((d) => d.id)))
  }
  function clearAll() {
    setSelectedIds(new Set())
  }

  const selectedDevices = React.useMemo(
    () => activeDevices.filter((d) => selectedIds.has(d.id)),
    [activeDevices, selectedIds],
  )

  // ── Resolve canvas + template from prefs ───────────────────────────────
  // Two paths (STICKER-EDITOR-DEEP-REVIEW):
  //   1. savedTemplateId set → use the saved server-side template + its canvas
  //   2. otherwise → use the preset builder + size-preset canvas
  const presetCanvas: StickerCanvas = React.useMemo(
    () => resolveStickerCanvas(prefs.sizePresetId, prefs.customWidth, prefs.customHeight),
    [prefs.sizePresetId, prefs.customWidth, prefs.customHeight],
  )

  const savedTemplate: StickerTemplate | null = React.useMemo(() => {
    if (!prefs.savedTemplateId) return null
    const found = savedTemplates.find((t) => t.id === prefs.savedTemplateId)
    return found ?? null
  }, [prefs.savedTemplateId, savedTemplates])

  // If the saved template id is stale (deleted by another session), fall back
  // to the preset flow + clear the saved id from prefs.
  React.useEffect(() => {
    if (prefs.savedTemplateId && prefsLoaded && tplData && !savedTemplate) {
      updatePrefs({ savedTemplateId: null })
    }
  }, [prefs.savedTemplateId, prefsLoaded, tplData, savedTemplate])

  const template: StickerTemplate = React.useMemo(() => {
    if (savedTemplate) return savedTemplate
    const preset = STICKER_TEMPLATE_PRESETS.find((p) => p.id === prefs.templatePresetId)
    if (!preset) {
      return STICKER_TEMPLATE_PRESETS[0].build(presetCanvas)
    }
    return preset.build(presetCanvas)
  }, [savedTemplate, prefs.templatePresetId, presetCanvas])

  // Effective canvas — when a saved template is selected, use ITS canvas
  // (not the size-preset canvas). This is the fix for the user's complaint
  // that the displayed size didn't match what they designed.
  const canvas: StickerCanvas = React.useMemo(
    () => (savedTemplate ? savedTemplate.canvas : presetCanvas),
    [savedTemplate, presetCanvas],
  )

  // STICKER-SYSTEM-REWRITE: prefer sticker-specific server settings
  // (companyName / orgName / hotline / footerNote / lineOALink) over
  // the global org name. Empty server values fall back to the global org
  // name (so we never print a blank header), then to the bundled defaults.
  const stickerSettings = stickerSettingsData?.settings
  const settingsSource: 'sticker' | 'global' | 'default' = stickerSettings
    ? 'sticker'
    : orgName?.trim()
      ? 'global'
      : 'default'
  const settings: StickerSettings = React.useMemo(
    () => ({
      ...DEFAULT_STICKER_SETTINGS,
      companyName:
        stickerSettings?.companyName?.trim() ||
        orgName?.trim() ||
        DEFAULT_STICKER_SETTINGS.companyName,
      orgName:
        stickerSettings?.orgName?.trim() ||
        orgName?.trim() ||
        DEFAULT_STICKER_SETTINGS.orgName,
      footerNote:
        stickerSettings?.footerNote?.trim() ||
        DEFAULT_STICKER_SETTINGS.footerNote,
      hotline: stickerSettings?.hotline?.trim() || DEFAULT_STICKER_SETTINGS.hotline,
      lineOALink:
        stickerSettings?.lineOALink?.trim() ||
        DEFAULT_STICKER_SETTINGS.lineOALink,
    }),
    [stickerSettings, orgName],
  )

  // ── Live preview (async) ────────────────────────────────────────────────
  // Uses the first selected device (or a placeholder device) to render an
  // in-dialog preview sticker HTML. Re-renders when canvas, template, or
  // sample device changes.
  const [previewHtml, setPreviewHtml] = React.useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)

  const sampleDevice: Device | null = selectedDevices[0] ?? activeDevices[0] ?? null

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setPreviewLoading(true)
    const deviceData = sampleDevice
          ? deviceToStickerData(sampleDevice as unknown as Record<string, unknown>)
          : null
    // APPENDIX-D: default the QR override to the Smart QR URL when no
    // caller-supplied override exists — this ensures preview renders the
    // scannable URL even for legacy templates that still use {{AssetNo}}.
    const qrOverride = sampleDevice
      ? (qrContentFor?.(sampleDevice) ?? generateStickerQrData('d', sampleDevice.id, 'repair'))
      : null
    Promise.resolve()
      .then(async () => {
        const cache = await buildQrCacheForDevice(deviceData, template, settings, qrOverride)
        const { html } = await renderStickerFromTemplate(deviceData, template, settings, {
          qrCache: cache,
        })
        return html
      })
      .then((html) => {
        if (!cancelled) {
          setPreviewHtml(html)
          setPreviewLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewHtml(null)
          setPreviewLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, sampleDevice, template, settings, qrContentFor])

  // ── Print ──────────────────────────────────────────────────────────────
  async function handlePrint() {
    if (selectedDevices.length === 0) {
      toast.error('กรุณาเลือกอุปกรณ์อย่างน้อย 1 เครื่อง')
      return
    }
    setPrinting(true)
    try {
      // STICKER-PREVIEW-FIX-FINAL: render each selected device's sticker HTML
      // using the *same* template engine + canvas that the live preview used.
      // The previous revision left `stickersHtml` and `withQr` as unresolved
      // references (TypeScript TS2304) — the dialog's print button would
      // crash at runtime the moment it was clicked. The fix restores the
      // original render-each-device loop and always includes QR (whether a
      // sticker has a QR element is controlled by the template itself, so a
      // separate `withQr` toggle is no longer needed).
      //
      // APPENDIX-D: default the QR data to the Smart QR URL so phone cameras
      // open the ITAM repair page on scan. The `qrContentFor` prop (used by
      // accessory stickers) still wins when supplied.
      const stickersHtml: string[] = []
      for (const d of selectedDevices) {
        const deviceData = deviceToStickerData(d as unknown as Record<string, unknown>)
        const qrOverride =
          qrContentFor?.(d) ?? generateStickerQrData('d', d.id, 'repair')
        const cache = await buildQrCacheForDevice(deviceData, template, settings, qrOverride)
        const { html: stickerHtml } = await renderStickerFromTemplate(
          deviceData,
          template,
          settings,
          { qrCache: cache },
        )
        stickersHtml.push(stickerHtml)
      }

      // STICKER-SYSTEM-REWRITE: ALWAYS use canvas-as-page mode.
      // Each sticker prints on its own page sized to the sticker canvas.
      // This is correct for:
      // - Label printers (Brother PT-P950NW, Dymo) — page = label size
      // - A4 printers — one sticker per A4 page (can be cut later)
      // No more A4 grid mode — it caused "3 sheets" + wrong layout.
      const cols = 1
      const html = buildPrintDocument(stickersHtml, template, cols, {
        pageSizeMode: 'canvas',
      })

      // Use a hidden iframe to print without opening a new window/tab.
      // This matches the behavior of the old Apps Script app (no popup).
      printViaIframe(html)

      // Log audit (fire-and-forget)
      try {
        await fetch('/api/audit/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'PRINT',
            entity: 'Device',
            entityId: null,
            summary: `พิมพ์สติกเกอร์อุปกรณ์ ${selectedDevices.length} ใบ`,
            detail: {
              count: selectedDevices.length,
              deviceIds: selectedDevices.map((d) => d.id),
              sizePreset: prefs.sizePresetId,
              canvasWidth: canvas.width,
              canvasHeight: canvas.height,
              templatePreset: prefs.templatePresetId,
              savedTemplateId: prefs.savedTemplateId,
              savedTemplateName: savedTemplate?.name ?? null,
              cols,
            },
          }),
        })
        await qc.invalidateQueries({ queryKey: ['audit'] })
      } catch (err) {
        console.error('[sticker-print-dialog]', err)
      }

      toast.success(`เตรียมสติกเกอร์ ${selectedDevices.length} ใบสำหรับพิมพ์แล้ว`)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Print failed')
    } finally {
      setPrinting(false)
    }
  }

  // STICKER-SYSTEM-REWRITE: preview scale is based on the CONTAINER width
  // (not the canvas). We estimate the dialog content area at ~380px on
  // desktop, ~300px on mobile — Math.min(1, …) keeps small stickers at
  // scale=1 (no up-scaling). The container itself has overflow-auto +
  // maxHeight so anything taller than the box scrolls.
  const previewScale = React.useMemo(() => {
    // 1mm ≈ 3.78px @ 96dpi
    const stickerWidthPx = canvas.width * 3.78
    const containerWidthPx = 380
    if (stickerWidthPx <= 0) return 1
    return Math.min(1, containerWidthPx / stickerWidthPx)
  }, [canvas.width])

  const isCustomSize = prefs.sizePresetId === 'custom'
  const usingSavedTemplate = !!savedTemplate

  // Composite select value for the template dropdown — encodes whether the
  // current selection is a saved template or a preset. Format: "saved:<id>" or
  // "preset:<id>". STICKER-EDITOR-DEEP-REVIEW.
  const templateSelectValue = usingSavedTemplate
    ? `saved:${savedTemplate!.id}`
    : `preset:${prefs.templatePresetId}`

  function handleTemplateSelect(composite: string) {
    // STICKER-PREVIEW-FIX-FINAL: a manual dropdown change means the user has
    // overridden the auto-synced active template; we must NOT clobber their
    // choice with the server's active id during this session.
    userOverrideRef.current = true
    if (composite.startsWith('saved:')) {
      const id = composite.slice('saved:'.length)
      updatePrefs({ savedTemplateId: id })
      return
    }
    if (composite.startsWith('preset:')) {
      const id = composite.slice('preset:'.length)
      updatePrefs({ savedTemplateId: null, templatePresetId: id })
      return
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-2xl dark:border-slate-800 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <Tag className="h-5 w-5 text-[#f97316]" />
            {dialogTitle ?? (
              <>🏷️ พิมพ์สติกเกอร์อุปกรณ์</>
            )}
          </DialogTitle>
          <DialogDescription>
            {dialogDescription ?? 'สร้างสติกเกอร์ฉลากอุปกรณ์สำหรับติดเครื่อง'}
          </DialogDescription>
        </DialogHeader>

        <div className="itam-scroll max-h-[68vh] space-y-4 overflow-y-auto pr-1">
          {/* ── Sticker settings: size + template ── */}
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/20">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Ruler className="h-3.5 w-3.5" />
              ตั้งค่าสติกเกอร์
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Size preset dropdown — disabled when a saved template is
                  selected (saved templates have their own canvas). */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  ขนาดสติกเกอร์
                </Label>
                {usingSavedTemplate ? (
                  // Read-only display of the saved template's canvas size
                  <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-100 px-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {canvas.width.toFixed(1)} × {canvas.height.toFixed(1)} มม.
                    <span className="ml-2 text-[10px] text-slate-400 dark:text-slate-500">
                      (จากเทมเพลต)
                    </span>
                  </div>
                ) : (
                  <Select
                    value={prefs.sizePresetId}
                    onValueChange={(v) => updatePrefs({ sizePresetId: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STICKER_SIZE_PRESETS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  ขนาดปัจจุบัน: {canvas.width.toFixed(1)} × {canvas.height.toFixed(1)} มม.
                </p>
              </div>

              {/* Template dropdown — shows saved templates (if any) + presets */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  เทมเพลต / รูปแบบ
                </Label>
                <Select
                  value={templateSelectValue}
                  onValueChange={handleTemplateSelect}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {savedTemplates.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase tracking-wide text-slate-500">
                          เทมเพลตที่บันทึก
                        </SelectLabel>
                        {savedTemplates.map((t) => (
                          <SelectItem key={`saved-${t.id}`} value={`saved:${t.id}`}>
                            <span className="flex items-center gap-1.5">
                              {activeSavedId === t.id && (
                                <Star className="h-3 w-3 fill-[#f97316] text-[#f97316]" />
                              )}
                              <span className="truncate">{t.name}</span>
                              <span className="ml-1 font-mono text-[10px] text-slate-400">
                                {t.canvas.width}×{t.canvas.height}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wide text-slate-500">
                        เทมเพลตสำเร็จ
                      </SelectLabel>
                      {STICKER_TEMPLATE_PRESETS.map((p) => (
                        <SelectItem key={`preset-${p.id}`} value={`preset:${p.id}`}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  <LayoutTemplate className="mr-1 inline h-3 w-3 align-text-bottom" />
                  เทมเพลต: {template.name}
                  {usingSavedTemplate && (
                    <span className="ml-1 text-[#f97316]">· ใช้ canvas ของเทมเพลต</span>
                  )}
                </p>
              </div>
            </div>

            {/* Custom size inputs (only when "custom" is selected AND no
                saved template is active — saved templates have their own
                canvas, so the custom W/H inputs don't apply). */}
            {isCustomSize && !usingSavedTemplate && (
              <div className="grid grid-cols-2 gap-3 rounded-md border border-dashed border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="space-y-1">
                  <Label
                    htmlFor="stk-custom-w"
                    className="text-[11px] font-medium text-slate-600 dark:text-slate-300"
                  >
                    ความกว้าง (มม.)
                  </Label>
                  <Input
                    id="stk-custom-w"
                    type="number"
                    min={10}
                    max={500}
                    step={0.1}
                    value={prefs.customWidth || ''}
                    onChange={(e) =>
                      updatePrefs({ customWidth: Number(e.target.value) || 0 })
                    }
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="stk-custom-h"
                    className="text-[11px] font-medium text-slate-600 dark:text-slate-300"
                  >
                    ความสูง (มม.)
                  </Label>
                  <Input
                    id="stk-custom-h"
                    type="number"
                    min={10}
                    max={500}
                    step={0.1}
                    value={prefs.customHeight || ''}
                    onChange={(e) =>
                      updatePrefs({ customHeight: Number(e.target.value) || 0 })
                    }
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Live preview ── */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              ตัวอย่างสติกเกอร์ (พรีวิว)
            </Label>
            {/*
             * STICKER-SYSTEM-REWRITE: the preview wrapper does NOT set
             * width/height in pixels. The inner sticker HTML (rendered by
             * `renderStickerFromTemplate`, the SAME engine `handlePrint`
             * uses) carries its own `width:${canvas.width}mm;height:${canvas.height}mm`
             * inline styles — letting the browser convert mm→px natively
             * means the wrapper always matches the inner content (no DPI
             * mismatch). The `transform: scale()` is purely visual.
             */}
            <div
              className="overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40"
              style={{ minHeight: 120, maxHeight: 350 }}
            >
              {previewLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400 dark:text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  กำลังเตรียมตัวอย่าง...
                </div>
              ) : previewHtml ? (
                <div className="flex justify-center">
                  <div
                    style={{
                      transform: `scale(${previewScale})`,
                      transformOrigin: 'center top',
                    }}
                    // Render the template-engine HTML — uses the same
                    // .stk-sticker / .stk-el classes as the print document.
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-6 text-slate-400 dark:text-slate-500">
                  <Tag className="h-6 w-6 text-slate-300 dark:text-slate-400" />
                  <span className="text-xs">เลือกอุปกรณ์ด้านล่างเพื่อดูตัวอย่าง</span>
                </div>
              )}
            </div>
            {/*
             * STICKER-SYSTEM-REWRITE: small debug strip below the preview so
             * the user can verify EXACTLY what is being rendered — template
             * name (saved or preset), canvas size in mm, where the sticker
             * text came from (sticker-specific server settings vs global
             * org name vs defaults), and which device is being previewed.
             */}
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-500 dark:border-slate-700 dark:bg-slate-800/20 dark:text-slate-400">
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span>
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    เทมเพลต:
                  </span>{' '}
                  {usingSavedTemplate
                    ? `${savedTemplate!.name} (บันทึก)`
                    : `เพรสเซ็ต: ${
                        STICKER_TEMPLATE_PRESETS.find(
                          (p) => p.id === prefs.templatePresetId,
                        )?.label ?? prefs.templatePresetId
                      }`}
                </span>
                <span>
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    ขนาด:
                  </span>{' '}
                  {canvas.width.toFixed(1)} × {canvas.height.toFixed(1)} มม.
                </span>
                <span>
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    แหล่งการตั้งค่า:
                  </span>{' '}
                  {settingsSource === 'sticker'
                    ? 'สติกเกอร์ (เฉพาะ)'
                    : settingsSource === 'global'
                      ? 'ชื่อองค์กรทั่วไป'
                      : 'ค่าเริ่มต้น'}
                </span>
                <span>
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    อุปกรณ์ตัวอย่าง:
                  </span>{' '}
                  {sampleDevice
                    ? `${sampleDevice.assetCode} · ${sampleDevice.name}`
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* ── Device selection ── */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                เลือกอุปกรณ์ ({selectedIds.size}/{activeDevices.length})
              </Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={selectAll}
                  className="h-7 text-xs text-[#f97316]"
                >
                  เลือกทั้งหมด
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearAll}
                  className="h-7 text-xs text-slate-500"
                >
                  ยกเลิกการเลือก
                </Button>
              </div>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="ค้นหารหัส / ชื่อ / SN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="itam-scroll max-h-52 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredDevices.length === 0 ? (
                  <li className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                    ไม่พบอุปกรณ์ที่ตรงกับเงื่อนไข
                  </li>
                ) : (
                  filteredDevices.map((d) => {
                    const checked = selectedIds.has(d.id)
                    return (
                      <li key={d.id}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleId(d.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-slate-700 dark:text-slate-200">
                              {d.name}
                            </div>
                            <div className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                              {d.assetCode} · {d.brand} {d.model} · {d.site}
                            </div>
                          </div>
                          <Badge className="ml-auto border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {d.type}
                          </Badge>
                        </label>
                      </li>
                    )
                  })
                )}
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={printing}
          >
            ยกเลิก
          </Button>
          <Button
            onClick={handlePrint}
            disabled={printing || selectedDevices.length === 0}
            className="bg-[#f97316] text-white hover:bg-[#ea580c] focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950"
          >
            {printing ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                กำลังเตรียม...
              </>
            ) : (
              <>
                <Printer className="mr-1.5 h-4 w-4" />
                พิมพ์สติกเกอร์ ({selectedDevices.length} ใบ)
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
