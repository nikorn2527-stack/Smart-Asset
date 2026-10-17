/**
 * sticker-print-prefs.ts — client-side (localStorage) persistence for the
 * user's last-used sticker print settings (size preset, custom W/H,
 * template preset).
 *
 * Used by StickerPrintDialog so that when a user reopens the dialog, their
 * last-selected size + template are pre-selected instead of always defaulting
 * to the medium size + default template.
 *
 * Server-side persistence of sticker *templates* themselves is handled by
 * `sticker-settings-store.ts` (AppSetting table). This file is only for the
 * ephemeral "last print dialog state".
 */

export interface StickerPrintPrefs {
  /** Size preset id (e.g. 'default', 'a4', 'label-50x30', 'custom'). */
  sizePresetId: string
  /** Custom width in mm — only used when `sizePresetId === 'custom'`. */
  customWidth: number
  /** Custom height in mm — only used when `sizePresetId === 'custom'`. */
  customHeight: number
  /** Template preset id (e.g. 'default', 'minimal', 'qr-only', 'compact', 'detailed'). */
  templatePresetId: string
  /**
   * Optional saved template id — when set, the dialog uses the server-side
   * saved template (from `/api/itam/sticker/templates`) instead of one of the
   * built-in preset builders. The saved template's canvas overrides the size
   * preset. Set to `null` (or omit) to use a preset template.
   *
   * STICKER-EDITOR-DEEP-REVIEW: this is the fix for "sticker doesn't match
   * what I designed" — the user's designed templates from the sticker editor
   * are now selectable in the print dialog, not just the 5 built-in presets.
   */
  savedTemplateId: string | null
}

const STORAGE_KEY = 'itam:sticker-print-prefs:v2'

export const DEFAULT_STICKER_PRINT_PREFS: StickerPrintPrefs = {
  sizePresetId: 'default',
  customWidth: 75.2,
  customHeight: 36,
  templatePresetId: 'default',
  savedTemplateId: null,
}

/**
 * Load sticker print preferences from localStorage. Returns defaults if
 * storage is unavailable (SSR), empty, or fails to parse.
 */
export function loadStickerPrintPrefs(): StickerPrintPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_STICKER_PRINT_PREFS }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // Migrate from v1 key — preserves the user's prior preset selection
      // (sizePresetId / customWidth / customHeight / templatePresetId) and
      // adds savedTemplateId=null default. We still write to v2 going forward.
      const v1Raw = window.localStorage.getItem('itam:sticker-print-prefs:v1')
      if (v1Raw) {
        try {
          const v1 = JSON.parse(v1Raw) as Partial<StickerPrintPrefs>
          const migrated: StickerPrintPrefs = {
            sizePresetId:
              typeof v1.sizePresetId === 'string' && v1.sizePresetId.length > 0
                ? v1.sizePresetId
                : DEFAULT_STICKER_PRINT_PREFS.sizePresetId,
            customWidth:
              typeof v1.customWidth === 'number' && v1.customWidth > 0
                ? v1.customWidth
                : DEFAULT_STICKER_PRINT_PREFS.customWidth,
            customHeight:
              typeof v1.customHeight === 'number' && v1.customHeight > 0
                ? v1.customHeight
                : DEFAULT_STICKER_PRINT_PREFS.customHeight,
            templatePresetId:
              typeof v1.templatePresetId === 'string' && v1.templatePresetId.length > 0
                ? v1.templatePresetId
                : DEFAULT_STICKER_PRINT_PREFS.templatePresetId,
            savedTemplateId: null,
          }
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
          return migrated
        } catch {
          // fall through to defaults
        }
      }
      return { ...DEFAULT_STICKER_PRINT_PREFS }
    }
    const parsed = JSON.parse(raw) as Partial<StickerPrintPrefs>
    return {
      sizePresetId:
        typeof parsed.sizePresetId === 'string' && parsed.sizePresetId.length > 0
          ? parsed.sizePresetId
          : DEFAULT_STICKER_PRINT_PREFS.sizePresetId,
      customWidth:
        typeof parsed.customWidth === 'number' && parsed.customWidth > 0
          ? parsed.customWidth
          : DEFAULT_STICKER_PRINT_PREFS.customWidth,
      customHeight:
        typeof parsed.customHeight === 'number' && parsed.customHeight > 0
          ? parsed.customHeight
          : DEFAULT_STICKER_PRINT_PREFS.customHeight,
      templatePresetId:
        typeof parsed.templatePresetId === 'string' && parsed.templatePresetId.length > 0
          ? parsed.templatePresetId
          : DEFAULT_STICKER_PRINT_PREFS.templatePresetId,
      savedTemplateId:
        typeof parsed.savedTemplateId === 'string' && parsed.savedTemplateId.length > 0
          ? parsed.savedTemplateId
          : null,
    }
  } catch {
    return { ...DEFAULT_STICKER_PRINT_PREFS }
  }
}

/**
 * Save sticker print preferences to localStorage. No-ops on SSR.
 */
export function saveStickerPrintPrefs(prefs: StickerPrintPrefs): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage may be unavailable (private mode, quota exceeded, etc.)
    // — silently ignore; the prefs are a convenience, not a critical feature.
  }
}
