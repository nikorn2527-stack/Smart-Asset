'use client'

/**
 * sticker-print-helpers.ts — client-side helpers for the sticker print flow.
 *
 * Single print:  POST /api/itam/sticker/render       → 1 sticker HTML
 * Bulk print:    POST /api/itam/sticker/bulk-render  → grid of sticker HTMLs
 *
 * Both open a new window, write a print document with @page sized to the
 * template canvas, then call window.print().
 */

import { buildPrintDocument, type StickerTemplate } from '@/lib/sticker-template'

interface RenderResponse {
  html: string
  template: StickerTemplate
  paperWidth: number
  paperHeight: number
}

interface BulkRenderResponse {
  stickers: { assetNo: string; html: string }[]
  cols: number
  paperWidth: number
  paperHeight: number
  template: StickerTemplate
}

/**
 * Print a single sticker for one device.
 * Returns true on success, false on failure (caller should toast on failure).
 */
export async function printSingleSticker(assetNo: string, templateId?: string): Promise<boolean> {
  try {
    const res = await fetch('/api/itam/sticker/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetNo, templateId }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || `HTTP ${res.status}`)
    }
    const data = (await res.json()) as RenderResponse
    const html = buildPrintDocument([data.html], data.template, 1)
    return openPrintWindow(html)
  } catch (e) {
    console.error('printSingleSticker', e)
    throw e
  }
}

/**
 * Bulk-print stickers for multiple devices.
 */
export async function printBulkStickers(assetNos: string[], templateId?: string): Promise<number> {
  if (assetNos.length === 0) throw new Error('ต้องเลือกอุปกรณ์อย่างน้อย 1 เครื่อง')
  const res = await fetch('/api/itam/sticker/bulk-render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetNos, templateId }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error || `HTTP ${res.status}`)
  }
  const data = (await res.json()) as BulkRenderResponse
  if (data.stickers.length === 0) {
    throw new Error('ไม่พบอุปกรณ์ที่เลือก (อาจไม่มีสิทธิ์เข้าถึงสาขา)')
  }
  const html = buildPrintDocument(
    data.stickers.map((s) => s.html),
    data.template,
    data.cols,
  )
  const ok = openPrintWindow(html)
  if (!ok) throw new Error('ไม่สามารถเปิดหน้าต่างพิมพ์ได้ — กรุณาอนุญาตป๊อปอัป')
  return data.stickers.length
}

function openPrintWindow(html: string): boolean {
  if (typeof window === 'undefined') return false
  // Use hidden iframe instead of window.open — matches old app behavior
  // (no new tab/window opened, print dialog appears directly)
  if (typeof document === 'undefined') return false
  const existing = document.getElementById('sticker-print-iframe')
  if (existing) existing.remove()
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
  if (!doc) return false
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => iframe.remove(), 1000)
    } catch (err) {
      console.error('[openPrintWindow] print failed:', err)
      iframe.remove()
    }
  }, 500)
  return true
}
