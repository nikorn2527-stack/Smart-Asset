import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import {
  ALL_DEFAULT_TEMPLATES,
  STICKER_TEMPLATE_STANDARD,
  STICKER_TEMPLATE_LARGE,
} from '@/lib/default-templates'
import { DEFAULT_STICKER_SETTINGS } from '@/lib/sticker-template'
import { logAudit } from '@/lib/audit'
import { moduleUnavailableResponse } from '@/lib/module-gate'

/**
 * POST /api/templates/seed
 *
 * Auto-seeds ALL default templates if they don't exist:
 *   1. DocumentTemplate table (work-order, stock-in, stock-out, purchase-order, pdf)
 *   2. AppSetting sticker_template_* (sticker templates)
 *   3. AppSetting document_template_* (document/PDF report templates)
 *
 * Idempotent — only seeds templates that don't exist yet.
 * Safe to call multiple times.
 *
 * Auth: requires TEMPLATES_MANAGE permission (admin only).
 */
export async function POST(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('templates')
  if (unavailable) return unavailable


  const auth = await requireAuth(req, 'TEMPLATES_MANAGE')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const results = {
    documentTemplates: { created: 0, skipped: 0, total: 0 },
    stickerTemplates: { created: 0, skipped: 0, total: 0 },
    documentSettings: { created: 0, skipped: 0, total: 0 },
  }

  try {
    // ── 1. Seed DocumentTemplate table (work-order, stock, PO, pdf) ──
    for (const tmpl of ALL_DEFAULT_TEMPLATES) {
      results.documentTemplates.total++
      const existing = await db.documentTemplate.findFirst({
        where: { type: tmpl.type, isDefault: true },
      })
      if (existing) {
        results.documentTemplates.skipped++
        continue
      }
      await db.documentTemplate.create({
        data: {
          name: tmpl.name,
          type: tmpl.type,
          category: tmpl.category ?? null,
          content: tmpl.content,
          isActive: true,
          isDefault: true,
          isFixed: false,
        },
      })
      results.documentTemplates.created++
    }

    // ── 2. Seed sticker templates (AppSetting) ──
    const stickerTemplates = [
      { key: 'sticker_template_standard', name: STICKER_TEMPLATE_STANDARD.name, content: STICKER_TEMPLATE_STANDARD.content },
      { key: 'sticker_template_large', name: STICKER_TEMPLATE_LARGE.name, content: STICKER_TEMPLATE_LARGE.content },
    ]

    for (const tmpl of stickerTemplates) {
      results.stickerTemplates.total++
      const existing = await db.appSetting.findUnique({ where: { key: tmpl.key } })
      if (existing) {
        results.stickerTemplates.skipped++
        continue
      }
      await db.appSetting.create({
        data: {
          key: tmpl.key,
          value: tmpl.content,
        },
      })
      results.stickerTemplates.created++
    }

    // ── 3. Seed sticker default settings (if not set) ──
    const stickerSettingsKey = 'sticker_default_settings'
    const existingSettings = await db.appSetting.findUnique({ where: { key: stickerSettingsKey } })
    if (!existingSettings) {
      await db.appSetting.create({
        data: {
          key: stickerSettingsKey,
          value: JSON.stringify(DEFAULT_STICKER_SETTINGS),
        },
      })
    }

    // ── 4. Seed document/PDF report templates (AppSetting) ──
    const docTemplates = [
      {
        key: 'document_template_report_default',
        content: JSON.stringify({
          name: 'รายงานมาตรฐาน',
          format: 'A4',
          orientation: 'portrait',
          margins: { top: 20, bottom: 20, left: 20, right: 20 },
          sections: [
            {
              type: 'header',
              content: '{{orgName}} — {{reportTitle}}',
              style: { fontSize: 18, fontWeight: 700, align: 'center' },
            },
            {
              type: 'meta',
              content: 'วันที่ออกรายงาน: {{generatedAt}} · ช่วงเวลา: {{dateRange}}',
              style: { fontSize: 10, color: '#64748b', align: 'center' },
            },
            {
              type: 'summary',
              content: '{{summaryText}}',
              style: { fontSize: 12, marginTop: 20 },
            },
            {
              type: 'table',
              content: '{{tableData}}',
              style: { fontSize: 11, marginTop: 10 },
            },
            {
              type: 'footer',
              content: '{{orgName}} — Powered by PNG TEAM',
              style: { fontSize: 9, color: '#94a3b8', align: 'center', marginTop: 30 },
            },
          ],
        }),
      },
      {
        key: 'document_template_meter_report',
        content: JSON.stringify({
          name: 'รายงานการจดมิเตอร์',
          format: 'A4',
          orientation: 'landscape',
          margins: { top: 20, bottom: 20, left: 20, right: 20 },
          sections: [
            {
              type: 'header',
              content: '{{orgName}} — รายงานการจดมิเตอร์',
              style: { fontSize: 16, fontWeight: 700, align: 'center' },
            },
            {
              type: 'meta',
              content: 'รอบจดมิเตอร์: {{cycleName}} · เดือน: {{month}}',
              style: { fontSize: 10, color: '#64748b', align: 'center' },
            },
            {
              type: 'table',
              content: '{{meterTableData}}',
              style: { fontSize: 10, marginTop: 10 },
              columns: ['assetCode', 'deviceName', 'prevReading', 'currentReading', 'pages', 'remark'],
            },
            {
              type: 'footer',
              content: 'Powered by PNG TEAM',
              style: { fontSize: 9, color: '#94a3b8', align: 'center', marginTop: 20 },
            },
          ],
        }),
      },
      {
        key: 'document_template_wo_summary',
        content: JSON.stringify({
          name: 'สรุปใบงานประจำเดือน',
          format: 'A4',
          orientation: 'portrait',
          margins: { top: 20, bottom: 20, left: 20, right: 20 },
          sections: [
            {
              type: 'header',
              content: '{{orgName}} — สรุปใบงานประจำเดือน {{month}}',
              style: { fontSize: 16, fontWeight: 700, align: 'center' },
            },
            {
              type: 'summary',
              content: 'รวมใบงานทั้งหมด: {{totalWOs}} ใบ · เสร็จสิ้น: {{completedWOs}} · รอดำเนินการ: {{pendingWOs}}',
              style: { fontSize: 12, marginTop: 20 },
            },
            {
              type: 'table',
              content: '{{woTableData}}',
              style: { fontSize: 10, marginTop: 20 },
            },
            {
              type: 'footer',
              content: 'Powered by PNG TEAM',
              style: { fontSize: 9, color: '#94a3b8', align: 'center', marginTop: 30 },
            },
          ],
        }),
      },
      {
        key: 'document_template_device_list',
        content: JSON.stringify({
          name: 'รายการอุปกรณ์',
          format: 'A4',
          orientation: 'landscape',
          margins: { top: 20, bottom: 20, left: 20, right: 20 },
          sections: [
            {
              type: 'header',
              content: '{{orgName}} — รายการอุปกรณ์',
              style: { fontSize: 16, fontWeight: 700, align: 'center' },
            },
            {
              type: 'meta',
              content: 'วันที่ออกรายงาน: {{generatedAt}} · จำนวน: {{totalDevices}} เครื่อง',
              style: { fontSize: 10, color: '#64748b', align: 'center' },
            },
            {
              type: 'table',
              content: '{{deviceTableData}}',
              style: { fontSize: 9, marginTop: 10 },
              columns: ['assetCode', 'name', 'type', 'brand', 'model', 'status', 'site', 'department'],
            },
            {
              type: 'footer',
              content: 'Powered by PNG TEAM',
              style: { fontSize: 9, color: '#94a3b8', align: 'center', marginTop: 20 },
            },
          ],
        }),
      },
    ]

    for (const tmpl of docTemplates) {
      results.documentSettings.total++
      const existing = await db.appSetting.findUnique({ where: { key: tmpl.key } })
      if (existing) {
        results.documentSettings.skipped++
        continue
      }
      await db.appSetting.create({
        data: {
          key: tmpl.key,
          value: tmpl.content,
        },
      })
      results.documentSettings.created++
    }

    await logAudit(
      'SEED',
      'DocumentTemplate',
      undefined,
      `Seed default templates: ${results.documentTemplates.created} doc + ${results.stickerTemplates.created} sticker + ${results.documentSettings.created} doc-settings`,
      // `detail` is a Record that logAudit serializes itself — passing a
  // pre-stringified value here was double-encoding it into a JSON string.
  results,
    )

    return NextResponse.json({
      ok: true,
      results,
      message: `เทมเพลตเริ่มต้นติดตั้งแล้ว: ${results.documentTemplates.created + results.stickerTemplates.created + results.documentSettings.created} ใหม่, ${results.documentTemplates.skipped + results.stickerTemplates.skipped + results.documentSettings.skipped} มีอยู่แล้ว`,
    })
  } catch (err) {
    console.error('POST /api/templates/seed', err)
    return NextResponse.json(
      { error: 'Seed failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
