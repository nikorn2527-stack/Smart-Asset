/**
 * edge-config.ts — Feature flags + system config via Vercel Edge Config.
 *
 * Why Edge Config:
 *   - Reads in <50ms globally (vs DB ~100-300ms)
 *   - No DB connection needed → no pool exhaustion risk
 *   - Free tier: 1MB storage, 300,000 reads/month
 *   - Perfect for feature flags, A/B tests, emergency toggles
 *
 * Setup:
 *   1. Vercel Dashboard → Storage → Create → Edge Config
 *   2. Link to project: vercel link + vercel env pull
 *   3. Set values via API or dashboard:
 *      POST /v1/edge-config/{ec_xxx}/items
 *      Body: { "feature.realtime": true, "maintenance.mode": false }
 *
 * Usage:
 *   import { getFeatureFlag, getSystemConfig } from '@/lib/edge-config'
 *
 *   if (await getFeatureFlag('realtime')) {
 *     // enable realtime
 *   }
 *
 *   const maintenanceMode = await getSystemConfig('maintenance.mode', false)
 *   if (maintenanceMode) return 503
 */

import { get } from '@vercel/edge-config'

/** Check if Edge Config is configured */
export function isEdgeConfigConfigured(): boolean {
  return !!process.env.EDGE_CONFIG
}

/**
 * Get a boolean feature flag.
 * Falls back to default if Edge Config not configured.
 *
 * @example
 *   if (await getFeatureFlag('enable_realtime', true)) { ... }
 */
export async function getFeatureFlag(
  key: string,
  defaultValue: boolean = false,
): Promise<boolean> {
  if (!isEdgeConfigConfigured()) return defaultValue
  try {
    const val = await get<boolean>(`feature.${key}`)
    return val ?? defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Get a system config value (any type).
 * Falls back to default if Edge Config not configured.
 *
 * @example
 *   const maxUploadSize = await getSystemConfig('max_upload_size', 5242880)
 */
export async function getSystemConfig<T>(
  key: string,
  defaultValue: T,
): Promise<T> {
  if (!isEdgeConfigConfigured()) return defaultValue
  try {
    const val = await get<T>(key)
    return val ?? defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Get multiple config values at once.
 * More efficient than calling getSystemConfig multiple times.
 */
export async function getSystemConfigs<T extends Record<string, unknown>>(
  keys: T,
): Promise<T> {
  if (!isEdgeConfigConfigured()) return keys
  try {
    const result: Partial<T> = { ...keys }
    for (const k of Object.keys(keys)) {
      const val = await get<T[Extract<keyof T, string>]>(k)
      if (val !== null) {
        result[k as keyof T] = val
      }
    }
    return result as T
  } catch {
    return keys
  }
}

// ── Standardized feature flags for ITAM ──
export interface FeatureFlags {
  /** Enable Supabase Realtime (vs polling fallback) */
  realtime: boolean
  /** Enable Web Push notifications */
  webPush: boolean
  /** Enable LINE notifications */
  lineNotify: boolean
  /** Enable file uploads (Supabase Storage) */
  fileUploads: boolean
  /** Enable maintenance mode (returns 503) */
  maintenanceMode: boolean
  /** Enable demo data (demo users, demo devices) */
  demoMode: boolean
  /** Read-only mode (disables writes for maintenance) */
  readOnly: boolean
  /** Enable rate limiting (KV-based if configured, in-memory otherwise) */
  rateLimit: boolean
}

/** Default feature flags (used when Edge Config not configured) */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  realtime: true,
  webPush: true,
  lineNotify: false,
  fileUploads: true,
  maintenanceMode: false,
  demoMode: true,
  readOnly: false,
  rateLimit: true,
}

/**
 * Get all feature flags at once.
 * Returns defaults if Edge Config not configured.
 */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  if (!isEdgeConfigConfigured()) return DEFAULT_FEATURE_FLAGS

  try {
    const [
      realtime,
      webPush,
      lineNotify,
      fileUploads,
      maintenanceMode,
      demoMode,
      readOnly,
      rateLimit,
    ] = await Promise.all([
      get<boolean>('feature.realtime'),
      get<boolean>('feature.webPush'),
      get<boolean>('feature.lineNotify'),
      get<boolean>('feature.fileUploads'),
      get<boolean>('feature.maintenanceMode'),
      get<boolean>('feature.demoMode'),
      get<boolean>('feature.readOnly'),
      get<boolean>('feature.rateLimit'),
    ])

    return {
      realtime: realtime ?? DEFAULT_FEATURE_FLAGS.realtime,
      webPush: webPush ?? DEFAULT_FEATURE_FLAGS.webPush,
      lineNotify: lineNotify ?? DEFAULT_FEATURE_FLAGS.lineNotify,
      fileUploads: fileUploads ?? DEFAULT_FEATURE_FLAGS.fileUploads,
      maintenanceMode: maintenanceMode ?? DEFAULT_FEATURE_FLAGS.maintenanceMode,
      demoMode: demoMode ?? DEFAULT_FEATURE_FLAGS.demoMode,
      readOnly: readOnly ?? DEFAULT_FEATURE_FLAGS.readOnly,
      rateLimit: rateLimit ?? DEFAULT_FEATURE_FLAGS.rateLimit,
    }
  } catch {
    return DEFAULT_FEATURE_FLAGS
  }
}
