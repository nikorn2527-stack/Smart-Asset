/**
 * sticker-settings-store.ts — server-only helpers that read/write the
 * `app_settings` table for sticker templates and sticker print settings.
 *
 * Storage layout (mirror of Apps Script):
 *   stickerTemplates            → JSON array of StickerTemplate objects
 *   activeStickerTemplateId     → string template id
 *   stickerTemplateEnabled      → 'true' / 'false'
 *   stickerCompanyName          → string
 *   stickerOrgName              → string  (renamed from stickerHospitalName
 *                                          in HOSPITALNAME-TERMINOLOGY-FIX-019)
 *   stickerFooterNote           → string
 *   stickerHotline              → string
 *   stickerLineOALink           → string
 *
 * Backward-compat: when reading the org-name, we try the new key
 * `stickerOrgName` first; if missing we fall back to the legacy key
 * `stickerHospitalName` so existing user data survives the rename without
 * a migration. New writes always go to `stickerOrgName`.
 */

import { db } from '@/lib/db'
import {
  buildDefaultTemplate,
  DEFAULT_STICKER_SETTINGS,
  normalizeTemplate,
  type StickerSettings,
  type StickerTemplate,
} from '@/lib/sticker-template'

export const SETTING_KEYS = {
  templates: 'stickerTemplates',
  activeId: 'activeStickerTemplateId',
  enabled: 'stickerTemplateEnabled',
  companyName: 'stickerCompanyName',
  /** New key — preferred. */
  orgName: 'stickerOrgName',
  /** Legacy key — used only as a read-time fallback for old data. */
  orgNameLegacy: 'stickerHospitalName',
  footerNote: 'stickerFooterNote',
  hotline: 'stickerHotline',
  lineOA: 'stickerLineOALink',
} as const

// ─── Low-level get/set ────────────────────────────────────────────────────
export async function getSetting(key: string): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

// ─── Templates ───────────────────────────────────────────────────────────
export async function getStickerTemplates(): Promise<StickerTemplate[]> {
  const raw = await getSetting(SETTING_KEYS.templates)
  if (!raw) {
    // First run — seed the default template
    const def = buildDefaultTemplate()
    await setSetting(SETTING_KEYS.templates, JSON.stringify([def]))
    await setSetting(SETTING_KEYS.activeId, def.id)
    return [def]
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('not array')
    const templates = parsed.map((t) => normalizeTemplate(t))
    // Always make sure default template exists
    if (!templates.some((t) => t.id === 'tpl-default')) {
      const def = buildDefaultTemplate()
      templates.unshift(def)
      await setSetting(SETTING_KEYS.templates, JSON.stringify(templates))
    }
    return templates
  } catch {
    // Corrupt JSON — reset to default
    const def = buildDefaultTemplate()
    await setSetting(SETTING_KEYS.templates, JSON.stringify([def]))
    await setSetting(SETTING_KEYS.activeId, def.id)
    return [def]
  }
}

export async function saveStickerTemplates(templates: StickerTemplate[]): Promise<void> {
  await setSetting(SETTING_KEYS.templates, JSON.stringify(templates))
}

export async function getActiveTemplateId(): Promise<string | null> {
  return getSetting(SETTING_KEYS.activeId)
}

export async function setActiveTemplateId(id: string): Promise<void> {
  await setSetting(SETTING_KEYS.activeId, id)
}

// ─── Settings (companyName, orgName, hotline, etc.) ───────────────────────
export async function getStickerSettings(): Promise<StickerSettings> {
  const [companyName, orgName, orgNameLegacy, footerNote, hotline, lineOALink] = await Promise.all([
    getSetting(SETTING_KEYS.companyName),
    getSetting(SETTING_KEYS.orgName),
    getSetting(SETTING_KEYS.orgNameLegacy),
    getSetting(SETTING_KEYS.footerNote),
    getSetting(SETTING_KEYS.hotline),
    getSetting(SETTING_KEYS.lineOA),
  ])
  // Backward-compat: prefer the new `stickerOrgName` key; fall back to the
  // legacy `stickerHospitalName` key when the new key has no value. This
  // preserves existing user data across the hospitalName → orgName rename.
  const orgNameValue = orgName ?? orgNameLegacy
  return {
    companyName: companyName ?? DEFAULT_STICKER_SETTINGS.companyName,
    orgName: orgNameValue ?? DEFAULT_STICKER_SETTINGS.orgName,
    footerNote: footerNote ?? DEFAULT_STICKER_SETTINGS.footerNote,
    hotline: hotline ?? DEFAULT_STICKER_SETTINGS.hotline,
    lineOALink: lineOALink ?? DEFAULT_STICKER_SETTINGS.lineOALink,
  }
}

export async function saveStickerSettings(s: StickerSettings): Promise<void> {
  await Promise.all([
    setSetting(SETTING_KEYS.companyName, s.companyName),
    // Always write to the new key. (Legacy `stickerHospitalName` is left
    // untouched — its old value, if any, remains as a stale fallback for
    // older readers. New code only reads `stickerOrgName` + legacy fallback.)
    setSetting(SETTING_KEYS.orgName, s.orgName),
    setSetting(SETTING_KEYS.footerNote, s.footerNote),
    setSetting(SETTING_KEYS.hotline, s.hotline),
    setSetting(SETTING_KEYS.lineOA, s.lineOALink),
  ])
}
