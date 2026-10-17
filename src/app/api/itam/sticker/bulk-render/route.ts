import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { siteFilterForUser } from '@/lib/auth'
import {
  getStickerTemplates,
  getActiveTemplateId,
  getStickerSettings,
} from '@/lib/sticker-settings-store'
import {
  renderStickerFromTemplate,
  deviceToStickerData,
  calculateGridColumns,
  preGenerateQrCodes,
  substituteVariables,
  normalizeTemplate,
  type StickerDeviceData,
  type StickerTemplate,
} from '@/lib/sticker-template'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// POST /api/itam/sticker/bulk-render
//   Body: { assetNos: string[], templateId?: string }
//   Returns: { stickers: [{assetNo, html}], cols, paperWidth, paperHeight }
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stickers')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'PRINT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json().catch(() => ({})) as { assetNos?: string[]; templateId?: string }
    const assetNos = Array.isArray(body.assetNos)
      ? body.assetNos.map((s) => String(s).trim()).filter(Boolean)
      : []
    if (assetNos.length === 0) {
      return NextResponse.json({ error: 'assetNos is required' }, { status: 400 })
    }
    if (assetNos.length > 500) {
      return NextResponse.json(
        { error: 'พิมพ์ได้ไม่เกิน 500 ใบต่อครั้ง' },
        { status: 400 },
      )
    }

    // Resolve template
    const [templates, activeId, settings] = await Promise.all([
      getStickerTemplates(),
      getActiveTemplateId(),
      getStickerSettings(),
    ])
    let template: StickerTemplate | undefined
    if (body.templateId) {
      const found = templates.find((t) => t.id === body.templateId)
      if (found) template = found
    }
    if (!template && activeId) {
      template = templates.find((t) => t.id === activeId)
    }
    if (!template) {
      template = templates[0]
    }
    if (!template) {
      return NextResponse.json({ error: 'ไม่มีเทมเพลตสติกเกอร์ในระบบ' }, { status: 500 })
    }

    // Fetch all requested devices, restricted to user's site access
    const siteFilter = siteFilterForUser(auth.row)
    const where: Record<string, unknown> = { assetCode: { in: assetNos } }
    if (Object.keys(siteFilter).length) {
      where.AND = [siteFilter]
    }
    const devices = await db.device.findMany({ where })
    // Maintain caller's order
    const byNo = new Map(devices.map((d) => [d.assetCode, d] as const))

    // Pre-generate QR codes for ALL unique data values across the batch
    // (most efficient: one QR per unique assetNo since most templates use {{AssetNo}})
    const uniqueDataKeys = new Set<string>()
    for (const el of template.elements) {
      if (el.type !== 'qr') continue
      for (const d of devices) {
        // STICKER-EDITOR-DEEP-REVIEW: StickerDeviceData fields must be
        //   assetCode / serialNumber / type  (NOT assetNo / serial / deviceType).
        // APPENDIX-D: also pass `id` so {{QrUrl}} generates the Smart QR URL.
        // See render/route.ts for the full comment — the wrong names caused
        // blank substitutions in printed stickers.
        // Use shared deviceToStickerData (single source of truth — all 19 fields)
        const deviceData = deviceToStickerData(d as Record<string, unknown>)
        const data = substituteVariables(el.content ?? '', deviceData, settings) || d.assetCode
        if (data) uniqueDataKeys.add(data)
      }
    }
    // Build a dummy template-shaped call for pre-generation
    const sharedQrCache = await preGenerateQrCodes(template, null, settings)
    // Merge in per-device unique keys (preGenerateQrCodes already covers {{AssetNo}} paths
    // when device=null — for static content. For variable-based content we need to
    // generate per-device QRs separately.)
    for (const data of uniqueDataKeys) {
      if (!sharedQrCache.has(data)) {
        try {
          const url = await QRCode.toDataURL(data, {
            margin: 1, width: 240, errorCorrectionLevel: 'M',
          })
          sharedQrCache.set(data, url)
        } catch (err) { console.error('[route]', err) }
      }
    }

    // Render each sticker
    const stickers: { assetNo: string; html: string }[] = []
    for (const assetNo of assetNos) {
      const d = byNo.get(assetNo)
      if (!d) {
        // Skip missing devices (or ones outside user's site access)
        continue
      }
      // Use shared deviceToStickerData (single source of truth — all 19 fields)
      const deviceData = deviceToStickerData(d as Record<string, unknown>)
      const { html } = await renderStickerFromTemplate(deviceData, template, settings, {
        qrCache: sharedQrCache,
      })
      stickers.push({ assetNo, html })
    }

    // Auto-calculate columns based on template width and A4 page width
    const isLandscape = template.canvas.width > template.canvas.height
    const pageWidth = isLandscape ? 297 : 210 // A4
    const cols = calculateGridColumns(template.canvas.width, pageWidth)

    await logAudit(
      'STICKER_BULK_RENDER',
      'Device',
      null,
      `พิมพ์สติกเกอร์จำนวน ${stickers.length} ใบ ด้วยเทมเพลต "${template.name}"`,
      {
        count: stickers.length,
        requested: assetNos.length,
        templateId: template.id,
        templateName: template.name,
        cols,
      },
      auth.user.email,
    )

    return NextResponse.json({
      stickers,
      cols,
      paperWidth: template.canvas.width,
      paperHeight: template.canvas.height,
      template: normalizeTemplate(template),
    })
  } catch (err) {
    console.error('POST /api/itam/sticker/bulk-render', err)
    return NextResponse.json({ error: 'Failed to bulk render' }, { status: 500 })
  }
}
