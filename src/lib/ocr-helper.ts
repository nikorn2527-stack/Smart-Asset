'use client'

/**
 * ocr-helper.ts — OCR helpers for reading meter values from camera.
 *
 * Uses Tesseract.js (in-browser, no API call needed).
 * Optimized for reading numeric meter displays (printer counters).
 *
 * Usage:
 *   import { readMeterFromImage, readMeterFromCamera } from '@/lib/ocr-helper'
 *
 *   // From captured image:
 *   const value = await readMeterFromImage(imageBlob)
 *   // → '12345' (extracted number)
 *
 *   // From camera (opens camera, captures, reads):
 *   const value = await readMeterFromCamera()
 *   // → '12345'
 */

import Tesseract from 'tesseract.js'

export interface OCRResult {
  /** Extracted numeric value (digits only) */
  value: string
  /** Full raw text from OCR */
  rawText: string
  /** Confidence score (0-100) */
  confidence: number
  /** Processing time in ms */
  durationMs: number
}

/**
 * Read text from an image using Tesseract.js.
 * Optimized for meter readings (numeric digits).
 *
 * @param image — Image as Blob, File, or data URL
 * @returns OCRResult with extracted value
 */
export async function readMeterFromImage(
  image: Blob | File | string,
): Promise<OCRResult> {
  const startTime = Date.now()

  const worker = await Tesseract.createWorker(['eng'], 1, {
    logger: () => {}, // silent
  })

  try {
    // Configure for digit recognition (meter readings are numeric)
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    })

    const { data } = await worker.recognize(image)

    // Extract digits from text
    const rawText = data.text || ''
    const digits = rawText.replace(/\D/g, '')

    return {
      value: digits,
      rawText,
      confidence: data.confidence ?? 0,
      durationMs: Date.now() - startTime,
    }
  } finally {
    await worker.terminate()
  }
}

/**
 * Read text from camera — opens camera, captures one frame, runs OCR.
 * Returns null if user cancels or camera unavailable.
 *
 * This is a helper — for full UI, use the UniversalSearch component's OCR mode.
 */
export async function readMeterFromCamera(): Promise<OCRResult | null> {
  // This is a placeholder — actual camera capture is handled by
  // UniversalSearch component's OCR mode. This helper is for programmatic use.
  throw new Error('Use UniversalSearch component with mode="ocr" instead')
}

/**
 * Preprocess image for better OCR accuracy.
 * - Converts to grayscale
 * - Increases contrast
 * - Thresholds to black/white
 *
 * This runs in-browser via Canvas API (no external service).
 */
export async function preprocessImage(
  imageBlob: Blob,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas not supported'))
        return
      }

      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)

      // Convert to grayscale + threshold
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data

      for (let i = 0; i < data.length; i += 4) {
        // Grayscale: Y = 0.299R + 0.587G + 0.114B
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]

        // Increase contrast
        const contrast = 1.5
        const adjusted = Math.min(255, Math.max(0, (gray - 128) * contrast + 128))

        // Threshold to black/white (128 = midpoint)
        const threshold = adjusted > 128 ? 255 : 0

        data[i] = threshold
        data[i + 1] = threshold
        data[i + 2] = threshold
      }

      ctx.putImageData(imageData, 0, 0)

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Failed to convert canvas to blob'))
        },
        'image/png',
      )
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(imageBlob)
  })
}

/**
 * Validate extracted meter value.
 * - Must be numeric
 * - Must be reasonable (1-9999999)
 * - Must not be 0 (unless explicitly allowed)
 */
export function validateMeterValue(value: string): {
  valid: boolean
  reason?: string
} {
  if (!value || !/^\d+$/.test(value)) {
    return { valid: false, reason: 'ไม่ใช่ตัวเลข' }
  }
  const num = parseInt(value, 10)
  if (num < 1) {
    return { valid: false, reason: 'ค่าต้องมากกว่า 0' }
  }
  if (num > 9999999) {
    return { valid: false, reason: 'ค่ามากเกินไป (> 9,999,999)' }
  }
  return { valid: true }
}

/**
 * Get the best meter value from OCR text.
 * Handles cases where OCR returns multiple numbers.
 * Picks the longest numeric sequence (most likely the meter reading).
 */
export function extractBestMeterValue(text: string): string {
  // Find all numeric sequences
  const matches = text.match(/\d+/g)
  if (!matches || matches.length === 0) return ''

  // Pick the longest one (meter readings are usually 4-7 digits)
  const sorted = matches.sort((a, b) => b.length - a.length)
  return sorted[0]
}
