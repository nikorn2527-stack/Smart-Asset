/**
 * r2-storage.ts — Cloudflare R2 storage helper (S3-compatible).
 *
 * Why Cloudflare R2 (vs Vercel Blob / Supabase Storage):
 *   - **No egress fees** — reads are free (huge cost saving for image-heavy apps)
 *   - 10GB free storage (vs 1GB Vercel Blob)
 *   - S3-compatible API → can use @aws-sdk/client-s3
 *   - Global CDN built-in → low latency globally
 *   - No bandwidth charges → perfect for serving images
 *
 * Setup:
 *   1. Sign up: https://dash.cloudflare.com → R2 (free 10GB)
 *   2. Create bucket: R2 → Create bucket → 'itam-uploads' (public access)
 *   3. Get API credentials: R2 → Manage R2 API Tokens → Create
 *      - Need: Account ID, Access Key ID, Secret Access Key
 *   4. Set env vars (in .env / Vercel):
 *      R2_ACCOUNT_ID=your-account-id
 *      R2_ACCESS_KEY_ID=your-access-key-id
 *      R2_SECRET_ACCESS_KEY=your-secret-access-key
 *      R2_BUCKET_NAME=itam-uploads
 *      R2_PUBLIC_URL=https://pub-xxxx.r2.dev  (or custom domain)
 *
 * Usage:
 *   import { uploadFile, getFileUrl, deleteFile } from '@/lib/r2-storage'
 *
 *   const { url } = await uploadFile(file, 'wo-photos/wo-123.jpg', 'image/jpeg')
 *   await deleteFile('wo-photos/wo-123.jpg')
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'

/** Check if R2 is configured */
export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  )
}

let clientInstance: S3Client | null = null

/**
 * Get R2 (S3-compatible) client.
 * Uses Cloudflare R2 endpoint: https://<account_id>.r2.cloudflarestorage.com
 */
function getClient(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      'R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME',
    )
  }
  if (!clientInstance) {
    clientInstance = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  }
  return clientInstance
}

/**
 * Upload a file to Cloudflare R2.
 *
 * @param content — Buffer | Uint8Array | string
 * @param key — object key (e.g. 'wo-photos/wo-123.jpg')
 * @param contentType — MIME type (e.g. 'image/jpeg')
 * @param cacheControl — cache header (default: 1 year for images)
 * @returns { url, key, bucket }
 *
 * @example
 *   const buffer = await file.arrayBuffer()
 *   const { url } = await uploadFile(
 *     Buffer.from(buffer),
 *     `wo-photos/wo-${woId}-${Date.now()}.jpg`,
 *     'image/jpeg'
 *   )
 */
export async function uploadFile(
  content: Buffer | Uint8Array | string,
  key: string,
  contentType: string,
  cacheControl: string = 'public, max-age=31536000, immutable',
): Promise<{ url: string; key: string; bucket: string }> {
  if (!isR2Configured()) {
    throw new Error('R2 not configured')
  }

  const client = getClient()
  const bucket = process.env.R2_BUCKET_NAME!

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: contentType,
    CacheControl: cacheControl,
  })

  await client.send(command)

  // Build public URL (if custom domain or R2.dev public URL is configured)
  const publicUrl = process.env.R2_PUBLIC_URL
    ? `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`
    : `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${key}`

  return {
    url: publicUrl,
    key,
    bucket,
  }
}

/**
 * Get public URL for a file in R2.
 * Returns the R2 public URL (or custom domain if configured).
 */
export function getFileUrl(key: string): string {
  if (!isR2Configured()) return ''
  const publicUrl = process.env.R2_PUBLIC_URL
  if (publicUrl) {
    return `${publicUrl.replace(/\/$/, '')}/${key}`
  }
  return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET_NAME}/${key}`
}

/**
 * Delete a file from R2.
 */
export async function deleteFile(key: string): Promise<void> {
  if (!isR2Configured()) return
  const client = getClient()
  const command = new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  })
  await client.send(command)
}

/**
 * Check if a file exists in R2.
 */
export async function fileExists(key: string): Promise<boolean> {
  if (!isR2Configured()) return false
  try {
    const client = getClient()
    const command = new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })
    await client.send(command)
    return true
  } catch {
    return false
  }
}

/**
 * Upload an image with auto-generated key (UUID + extension).
 * Convenient for user uploads where the path doesn't matter.
 *
 * @example
 *   const { url } = await uploadImage(buffer, 'jpg', 'wo-photos')
 *   // → https://pub-xxx.r2.dev/wo-photos/uuid.jpg
 */
export async function uploadImage(
  buffer: Buffer | Uint8Array,
  extension: string,
  folder: string = 'uploads',
): Promise<{ url: string; key: string }> {
  const uuid = crypto.randomUUID()
  const key = `${folder}/${uuid}.${extension}`
  const contentType = `image/${extension === 'jpg' ? 'jpeg' : extension}`
  const result = await uploadFile(buffer, key, contentType)
  return { url: result.url, key }
}

/**
 * Generate a presigned URL for temporary access to a private file.
 * Useful for files that shouldn't be publicly accessible.
 *
 * @param key — object key
 * @param expiresIn — URL expiry in seconds (default 1 hour)
 */
export async function getSignedUrl(
  key: string,
  expiresIn: number = 3600,
): Promise<string> {
  if (!isR2Configured()) return ''
  // Note: requires @aws-sdk/s3-request-presigner (already installed)
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
  const { GetObjectCommand } = await import('@aws-sdk/client-s3')
  const client = getClient()
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  })
  return getSignedUrl(client, command, { expiresIn })
}

/**
 * Default folder structure for ITAM app.
 * Keeps files organized by purpose.
 */
export const DEFAULT_FOLDERS = {
  woPhotos: 'wo-photos',          // Work order photos (before/onsite/after)
  deviceImages: 'device-images',  // Device photos
  stickers: 'stickers',            // QR code stickers
  signatures: 'signatures',       // User signatures (private)
  exports: 'exports',             // CSV/PDF exports (auto-expire)
  temp: 'temp',                    // Temporary uploads (clean up daily)
} as const
