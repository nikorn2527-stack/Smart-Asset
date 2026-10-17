import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { canAccessSite } from '@/lib/auth'
import {
  getStickerTemplates,
  getActiveTemplateId,
  getStickerSettings,
} from '@/lib/sticker-settings-store'
import {
  renderStickerFromTemplate,
  deviceToStickerData,
  normalizeTemplate,
  type StickerDeviceData,
  type StickerTemplate,
} from '@/lib/sticker-template'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

// POST /api/itam/sticker/render
//   Body: { assetNo: string, templateId?: string }
//   Returns: { html, qrDataUrls, template }
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('stickers')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'PRINT')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await req.json().catch(() => ({})) as { assetNo?: string; templateId?: string }
    const assetNo = String(body.assetNo ?? '').trim()
    if (!assetNo) {
      return NextResponse.json({ error: 'assetNo is required' }, { status: 400 })
    }

    const device = await db.device.findUnique({ where: { assetCode: assetNo } })
    if (!device) {
      return NextResponse.json({ error: `ไม่พบอุปกรณ์ ${assetNo}` }, { status: 404 })
    }
    if (!canAccessSite(auth.row, device.site)) {
      return NextResponse.json(
        { error: 'ไม่มีสิทธิ์เข้าถึงอุปกรณ์ในสาขานี้' },
        { status: 403 },
      )
    }

    // Resolve template: explicit id → active → first available
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

    // STICKER-EDITOR-DEEP-REVIEW: field names must match the StickerDeviceData
    // interface in sticker-template.ts (assetCode / serialNumber / type) — the
    // previous code used `assetNo` / `serial` / `deviceType`, which left
    // {{AssetNo}} / {{Serial}} / {{Type}} substitutions blank in printed
    // stickers. (substituteVariables looks up `device.assetCode` etc., not
    // `device.assetNo`.)
    // Use the shared deviceToStickerData function (single source of truth).
    // Previously this route built its own partial object missing 9 fields
    // (room, status, currentAssignee, warrantyEnd, purchaseDate, purchasePrice,
    // ip, mac, licenses) — causing printed stickers to show blank for
    // {{Status}}, {{WarrantyEnd}}, {{PurchasePrice}}, etc.
    const deviceData = deviceToStickerData(device as Record<string, unknown>)

    const { html, qrDataUrls } = await renderStickerFromTemplate(deviceData, template, settings)

    await logAudit(
      'STICKER_RENDER',
      'Device',
      device.assetCode,
      `เรนเดอร์สติกเกอร์สำหรับ ${device.assetCode} ด้วยเทมเพลต "${template.name}"`,
      { assetNo, templateId: template.id, templateName: template.name },
      auth.user.email,
    )

    return NextResponse.json({
      html,
      qrDataUrls,
      template: normalizeTemplate(template),
      paperWidth: template.canvas.width,
      paperHeight: template.canvas.height,
    })
  } catch (err) {
    console.error('POST /api/itam/sticker/render', err)
    return NextResponse.json({ error: 'Failed to render sticker' }, { status: 500 })
  }
}
