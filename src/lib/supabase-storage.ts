/**
 * supabase-storage.ts — Supabase Storage helper for image uploads.
 *
 * Why use Supabase Storage (instead of/in addition to Vercel Blob):
 *   - 1GB free (vs Vercel Blob's 1GB — same, but Supabase integrates with DB)
 *   - Image optimization built-in (resize, format conversion)
 *   - Row-Level Security (RLS) for per-user access control
 *   - Signed URLs for private files
 *   - Same dashboard as DB (manage everything in one place)
 *
 * Recommended use:
 *   - WO photos, device images → Supabase Storage (user-specific, RLS)
 *   - CSV exports, PDF reports → Vercel Blob (temporary, auto-expire)
 *
 * Setup:
 *   1. Supabase Dashboard → Storage → Create bucket 'itam-uploads' (public)
 *   2. Set env vars:
 *      NEXT_PUBLIC_SUPABASE_URL
 *      NEXT_PUBLIC_SUPABASE_ANON_KEY
 *      SUPABASE_SERVICE_KEY (server-side, for admin operations)
 *
 * Usage:
 *   import { uploadImage, getPublicUrl, deleteImage } from '@/lib/supabase-storage'
 *
 *   const { url } = await uploadImage(file, 'wo-photos', `wo-${id}.jpg`)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Check if Supabase Storage is configured */
export function isStorageConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

let adminClient: SupabaseClient | null = null

/**
 * Get admin Supabase client (server-side, service role key).
 * Bypasses RLS — use only in trusted server-side code.
 */
function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    if (!process.env.SUPABASE_SERVICE_KEY) {
      throw new Error(
        'SUPABASE_SERVICE_KEY is not set. Required for server-side storage operations.',
      )
    }
    adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY,
    )
  }
  return adminClient
}

/**
 * Upload an image/file to Supabase Storage.
 *
 * @param file — File, Blob, or Buffer
 * @param bucket — bucket name (e.g. 'wo-photos', 'device-images')
 * @param path — file path within bucket (e.g. 'wo-123/photo.jpg')
 * @param contentType — MIME type
 * @returns { url, path, bucket }
 */
export async function uploadImage(
  file: File | Blob | Buffer,
  bucket: string,
  path: string,
  contentType: string = 'image/jpeg',
): Promise<{ url: string; path: string; bucket: string }> {
  if (!isStorageConfigured()) {
    throw new Error('Supabase Storage not configured. Set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  const client = getAdminClient()

  const { data, error } = await client
    .storage
    .from(bucket)
    .upload(path, file, {
      contentType,
      upsert: true, // overwrite if exists
    })

  if (error) {
    throw new Error(`Upload failed: ${error.message}`)
  }

  // Get public URL (if bucket is public)
  const { data: publicUrlData } = client
    .storage
    .from(bucket)
    .getPublicUrl(data.path)

  return {
    url: publicUrlData.publicUrl,
    path: data.path,
    bucket,
  }
}

/**
 * Get public URL for a file in a public bucket.
 */
export function getPublicUrl(bucket: string, path: string): string {
  if (!isStorageConfigured()) {
    return ''
  }
  const client = getAdminClient()
  const { data } = client.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

/**
 * Create a signed URL for a file in a private bucket.
 * Useful for files that shouldn't be publicly accessible.
 *
 * @param bucket — bucket name
 * @param path — file path
 * @param expiresIn — URL expiry in seconds (default 1 hour)
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600,
): Promise<string> {
  if (!isStorageConfigured()) {
    throw new Error('Supabase Storage not configured')
  }
  const client = getAdminClient()
  const { data, error } = await client
    .storage
    .from(bucket)
    .createSignedUrl(path, expiresIn)

  if (error) {
    throw new Error(`Signed URL failed: ${error.message}`)
  }
  return data.signedUrl
}

/**
 * Delete a file from Supabase Storage.
 */
export async function deleteImage(
  bucket: string,
  path: string,
): Promise<void> {
  if (!isStorageConfigured()) {
    return
  }
  const client = getAdminClient()
  const { error } = await client.storage.from(bucket).remove([path])
  if (error) {
    throw new Error(`Delete failed: ${error.message}`)
  }
}

/**
 * List files in a bucket (with optional path prefix).
 */
export async function listFiles(
  bucket: string,
  path?: string,
  limit: number = 100,
): Promise<Array<{ name: string; size: number; lastModified: string }>> {
  if (!isStorageConfigured()) {
    return []
  }
  const client = getAdminClient()
  const { data, error } = await client
    .storage
    .from(bucket)
    .list(path ?? '', { limit })

  if (error) {
    throw new Error(`List failed: ${error.message}`)
  }

  return (data ?? []).map((f) => ({
    name: f.name,
    size: f.metadata?.size ?? 0,
    lastModified: f.updated_at ?? '',
  }))
}

/**
 * Ensure a bucket exists (creates if not).
 * Uses admin client to create bucket if missing.
 *
 * @param bucket — bucket name
 * @param isPublic — whether bucket should be public
 */
export async function ensureBucketExists(
  bucket: string,
  isPublic: boolean = true,
): Promise<void> {
  if (!isStorageConfigured()) return
  const client = getAdminClient()

  const { data: existing } = await client.storage.getBucket(bucket)
  if (existing) return

  const { error } = await client.storage.createBucket(bucket, {
    public: isPublic,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    fileSizeLimit: 5 * 1024 * 1024, // 5MB per file
  })

  if (error && !error.message.includes('already exists')) {
    throw new Error(`Create bucket failed: ${error.message}`)
  }
}

/**
 * Default buckets for ITAM app.
 * Call ensureBuckets() on app init / first deploy.
 */
export const DEFAULT_BUCKETS = [
  { name: 'wo-photos', public: true },      // Work order photos
  { name: 'device-images', public: true },  // Device images
  { name: 'stickers', public: true },        // Device stickers (QR codes)
  { name: 'exports', public: false },        // CSV/PDF exports (signed URL only)
  { name: 'signatures', public: false },     // User signatures
] as const

/**
 * Ensure all default buckets exist.
 */
export async function ensureDefaultBuckets(): Promise<void> {
  for (const bucket of DEFAULT_BUCKETS) {
    try {
      await ensureBucketExists(bucket.name, bucket.public)
    } catch (err) {
      console.warn(`[supabase-storage] Failed to ensure bucket ${bucket.name}:`, err)
    }
  }
}
