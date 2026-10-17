/**
 * vercel-blob-storage.ts — Helper สำหรับ Vercel Blob Storage
 *
 * ใช้สำหรับเก็บไฟล์ชั่วคราว เช่น:
 * - CSV export (export แล้วให้ user download ภายใน 1 ชม.)
 * - PDF report (สร้าง + ส่ง URL ให้ download)
 * - Excel export
 *
 * Free tier: 1GB total storage + 512MB max per blob
 *
 * Usage:
 *   import { uploadToBlob, getBlobUrl, deleteBlob } from '@/lib/vercel-blob-storage'
 *
 *   // Upload CSV export
 *   const { url } = await uploadToBlob(csvString, `exports/devices-${Date.now()}.csv`, 'text/csv')
 *
 *   // Auto-expire after 1 hour (Vercel Blob supports addLifecycle)
 *   const { url } = await uploadToBlob(pdf, `reports/monthly-${ym}.pdf`, 'application/pdf', 3600)
 *
 *   // Delete after download
 *   await deleteBlob(url)
 */

import { put, del, head } from '@vercel/blob'

/**
 * Check if Vercel Blob is configured (env vars set)
 */
export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN
}

/**
 * Upload content to Vercel Blob storage.
 *
 * @param content — string | Buffer | File | Blob
 * @param pathname — path in blob (e.g. 'exports/devices.csv')
 * @param contentType — MIME type (e.g. 'text/csv', 'application/pdf')
 * @param cacheDurationSeconds — optional max-age (default 0 = no-cache)
 * @returns { url, pathname, contentType }
 *
 * @example
 *   const { url } = await uploadToBlob(
 *     csvString,
 *     `exports/devices-${Date.now()}.csv`,
 *     'text/csv'
 *   )
 *   // → https://xxx.public.blob.vercel-storage.com/exports/devices-123.csv
 */
export async function uploadToBlob(
  content: string | Buffer | File | Blob,
  pathname: string,
  contentType: string,
  cacheDurationSeconds: number = 0,
): Promise<{ url: string; pathname: string; contentType: string }> {
  if (!isBlobConfigured()) {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is not set. Configure Vercel Blob in your environment.',
    )
  }

  const blob = await put(pathname, content, {
    access: 'public',
    contentType,
    addRandomSuffix: true, // prevent name collisions
    cacheControlMaxAge: cacheDurationSeconds,
  })

  return {
    url: blob.url,
    pathname: blob.pathname,
    contentType,
  }
}

/**
 * Delete a blob by URL.
 * Use after user downloads the file to free up space.
 */
export async function deleteBlob(url: string): Promise<void> {
  if (!isBlobConfigured()) return
  await del(url)
}

/**
 * Get metadata for a blob (size, contentType, uploadedAt).
 * Useful for checking if file exists.
 */
export async function getBlobInfo(url: string): Promise<{
  size: number
  contentType: string
  uploadedAt: Date
} | null> {
  if (!isBlobConfigured()) return null
  try {
    const info = await head(url)
    return {
      size: info.size,
      contentType: info.contentType,
      uploadedAt: new Date(info.uploadedAt),
    }
  } catch {
    return null
  }
}

/**
 * Upload a CSV string and return a download URL.
 * Auto-deletes after 1 hour (Vercel Blob lifecycle).
 *
 * @example
 *   const url = await uploadCsvExport(csvString, 'devices-export')
 *   // → returns URL valid for 1 hour
 */
export async function uploadCsvExport(
  csvString: string,
  filename: string,
): Promise<string> {
  const { url } = await uploadToBlob(
    csvString,
    `exports/${filename}-${Date.now()}.csv`,
    'text/csv; charset=utf-8',
    3600, // cache 1 hour
  )
  return url
}

/**
 * Upload a PDF buffer and return a download URL.
 * Auto-deletes after 24 hours.
 *
 * @example
 *   const url = await uploadPdfReport(pdfBuffer, 'monthly-report-2026-08')
 *   // → returns URL valid for 24 hours
 */
export async function uploadPdfReport(
  pdfBuffer: Buffer,
  filename: string,
): Promise<string> {
  const { url } = await uploadToBlob(
    pdfBuffer,
    `reports/${filename}.pdf`,
    'application/pdf',
    86400, // cache 24 hours
  )
  return url
}

/**
 * Upload an Excel (.xlsx) buffer and return a download URL.
 * Auto-deletes after 1 hour.
 */
export async function uploadExcelExport(
  xlsxBuffer: Buffer,
  filename: string,
): Promise<string> {
  const { url } = await uploadToBlob(
    xlsxBuffer,
    `exports/${filename}-${Date.now()}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    3600,
  )
  return url
}
