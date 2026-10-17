/**
 * document-template-store.ts — server-only helpers that read/write the
 * `app_settings` table for document templates.
 *
 * Storage layout (mirror of Apps Script):
 *   documentTemplates            → JSON array of DocumentTemplate objects
 *   activeDocumentTemplateId     → string template id
 *   documentTemplateEnabled      → 'true' / 'false'
 */

import { db } from '@/lib/db'
import {
  buildDefaultDocumentTemplate,
  normalizeTemplate,
  type DocumentTemplate,
} from '@/lib/document-template'

export const DOC_SETTING_KEYS = {
  templates: 'documentTemplates',
  activeId: 'activeDocumentTemplateId',
  enabled: 'documentTemplateEnabled',
} as const

// ─── Low-level get/set ────────────────────────────────────────────────────
export async function getDocSetting(key: string): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setDocSetting(key: string, value: string): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

// ─── Templates ───────────────────────────────────────────────────────────
export async function getDocumentTemplates(): Promise<DocumentTemplate[]> {
  const raw = await getDocSetting(DOC_SETTING_KEYS.templates)
  if (!raw) {
    // First run — seed the default template
    const def = buildDefaultDocumentTemplate()
    await setDocSetting(DOC_SETTING_KEYS.templates, JSON.stringify([def]))
    await setDocSetting(DOC_SETTING_KEYS.activeId, def.id)
    await setDocSetting(DOC_SETTING_KEYS.enabled, 'true')
    return [def]
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('not array')
    const templates = parsed.map((t) => normalizeTemplate(t))
    // Always make sure default template exists
    if (!templates.some((t) => t.id === 'doc-tpl-default')) {
      const def = buildDefaultDocumentTemplate()
      templates.unshift(def)
      await setDocSetting(DOC_SETTING_KEYS.templates, JSON.stringify(templates))
    }
    return templates
  } catch {
    // Corrupt JSON — reset to default
    const def = buildDefaultDocumentTemplate()
    await setDocSetting(DOC_SETTING_KEYS.templates, JSON.stringify([def]))
    await setDocSetting(DOC_SETTING_KEYS.activeId, def.id)
    return [def]
  }
}

export async function saveDocumentTemplates(templates: DocumentTemplate[]): Promise<void> {
  await setDocSetting(DOC_SETTING_KEYS.templates, JSON.stringify(templates))
}

export async function getActiveDocumentTemplateId(): Promise<string | null> {
  return getDocSetting(DOC_SETTING_KEYS.activeId)
}

export async function setActiveDocumentTemplateId(id: string): Promise<void> {
  await setDocSetting(DOC_SETTING_KEYS.activeId, id)
}

export async function getDocumentTemplateEnabled(): Promise<boolean> {
  const raw = await getDocSetting(DOC_SETTING_KEYS.enabled)
  return raw === 'true'
}

export async function setDocumentTemplateEnabled(enabled: boolean): Promise<void> {
  await setDocSetting(DOC_SETTING_KEYS.enabled, enabled ? 'true' : 'false')
}

// ─── Convenience: get the active template object ─────────────────────────
export async function getActiveDocumentTemplate(): Promise<DocumentTemplate | null> {
  const [templates, activeId] = await Promise.all([
    getDocumentTemplates(),
    getActiveDocumentTemplateId(),
  ])
  if (!activeId) return templates[0] ?? null
  return templates.find((t) => t.id === activeId) ?? templates[0] ?? null
}
