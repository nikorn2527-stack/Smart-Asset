/**
 * line-image-handler.ts — Process images sent via LINE OA.
 *
 * Flow:
 *   1. Download image from LINE (using messageId + access token)
 *   2. Try to decode as QR/barcode (jsQR + BarcodeDetector)
 *   3. If QR found → look up device by assetCode/serialNumber
 *   4. If no QR → try OCR (Tesseract.js) to read text (e.g. asset code label)
 *   5. Return extracted code for WO creation
 *
 * Usage (in LINE webhook):
 *   import { processLineImage } from '@/lib/line-image-handler'
 *
 *   const result = await processLineImage(messageId, accessToken)
 *   if (result.code) {
 *     // Create WO from device found by result.code
 *   }
 */

import { db } from './db'

export interface ImageProcessResult {
  /** Extracted code (assetCode, serialNumber, or QR content) */
  code?: string
  /** How the code was extracted */
  method: 'qr' | 'barcode' | 'ocr' | 'none'
  /** Raw OCR text (if OCR was used) */
  rawText?: string
  /** Device found (if any) */
  device?: {
    id: string
    assetCode: string | null
    name: string | null
    serialNumber: string | null
    site: string | null
    brand?: string | null
    model?: string | null
  }
  /** Error message (if any) */
  error?: string
}

/**
 * Download image content from LINE Messaging API.
 *
 * LINE API: GET https://api.line.me/v2/bot/message/{messageId}/content
 * Returns binary image data.
 */
async function downloadLineImage(
  messageId: string,
  accessToken: string,
): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )
    if (!res.ok) {
      console.warn('[line-image] Download failed:', res.status, res.statusText)
      return null
    }
    const arrayBuffer = await res.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (err) {
    console.error('[line-image] Download error:', err)
    return null
  }
}

/**
 * Decode QR code from image buffer.
 * Uses jsQR (same library as frontend QR scanner).
 *
 * Note: jsQR runs in Node.js (no browser needed).
 */
async function decodeQRFromImage(
  imageBuffer: Buffer,
): Promise<string | null> {
  try {
    // jsQR needs ImageData (RGBA pixels). We need to decode the image first.
    // Use sharp (already installed) to convert to raw pixels.
    const sharp = (await import('sharp')).default
    const { data, info } = await sharp(imageBuffer)
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true })

    // jsQR expects Uint8ClampedArray
    const { default: jsQR } = await import('jsqr')
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
      inversionAttempts: 'dontInvert',
    })

    if (code) {
      console.log('[line-image] QR decoded:', code.data.slice(0, 50))
      return code.data
    }
    return null
  } catch (err) {
    console.warn('[line-image] QR decode failed:', err)
    return null
  }
}

/**
 * Run OCR on image to extract text (e.g. asset code label).
 * Uses Tesseract.js (same as frontend OCR).
 */
async function ocrImageText(imageBuffer: Buffer): Promise<string> {
  try {
    const Tesseract = (await import('tesseract.js')).default
    const worker = await Tesseract.createWorker(['eng'], 1, {
      logger: () => {},
    })

    try {
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-',
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      })

      const { data } = await worker.recognize(imageBuffer)
      return (data.text || '').trim()
    } finally {
      await worker.terminate()
    }
  } catch (err) {
    console.warn('[line-image] OCR failed:', err)
    return ''
  }
}

/**
 * Look up a device by code (assetCode, serialNumber, or assetSiteCode).
 *
 * Tries multiple fields in order:
 *   1. assetCode (exact match)
 *   2. serialNumber (exact match)
 *   3. assetSiteCode (exact match)
 *   4. assetCode (suffix match — for short codes)
 */
async function findDeviceByCode(code: string) {
  const cleanCode = code.trim().toUpperCase()

  // Try exact matches first
  const device = await db.device.findFirst({
    where: {
      OR: [
        { assetCode: { equals: cleanCode } },
        { serialNumber: { equals: cleanCode } },
        { assetSiteCode: { equals: cleanCode } },
      ],
    },
    select: {
      id: true,
      assetCode: true,
      name: true,
      serialNumber: true,
      site: true,
      brand: true,
      model: true,
      status: true,
    },
  })

  if (device) return device

  // Try suffix match (for short codes scanned from QR)
  return db.device.findFirst({
    where: {
      OR: [
        { assetCode: { endsWith: cleanCode } },
        { serialNumber: { endsWith: cleanCode } },
      ],
    },
    select: {
      id: true,
      assetCode: true,
      name: true,
      serialNumber: true,
      site: true,
      brand: true,
      model: true,
      status: true,
    },
  })
}

/**
 * Process an image sent via LINE OA.
 *
 * @param messageId — LINE message ID
 * @param accessToken — LINE channel access token
 * @returns ImageProcessResult with extracted code + device (if found)
 */
export async function processLineImage(
  messageId: string,
  accessToken: string,
): Promise<ImageProcessResult> {
  // 1. Download image
  const imageBuffer = await downloadLineImage(messageId, accessToken)
  if (!imageBuffer) {
    return { method: 'none', error: 'ไม่สามารถดาวน์โหลดรูปภาพได้' }
  }

  // 2. Try QR/barcode decode first
  const qrCode = await decodeQRFromImage(imageBuffer)
  if (qrCode) {
    const device = await findDeviceByCode(qrCode)
    if (device) {
      return {
        code: qrCode,
        method: 'qr',
        device,
      }
    }
    // QR found but no device matched
    return {
      code: qrCode,
      method: 'qr',
      error: `ไม่พบอุปกรณ์จากรหัส QR: ${qrCode}`,
    }
  }

  // 3. Fallback: OCR to read text (e.g. asset code printed on sticker)
  const ocrText = await ocrImageText(imageBuffer)
  if (ocrText) {
    // Extract the most likely code (longest alphanumeric sequence)
    const codes = ocrText.match(/[A-Z0-9-]{4,}/g)
    if (codes && codes.length > 0) {
      // Try each extracted code
      for (const code of codes.sort((a, b) => b.length - a.length)) {
        const device = await findDeviceByCode(code)
        if (device) {
          return {
            code,
            method: 'ocr',
            rawText: ocrText,
            device,
          }
        }
      }
    }

    // No device found from OCR text
    return {
      method: 'ocr',
      rawText: ocrText,
      error: 'ไม่พบอุปกรณ์จากข้อความในรูปภาพ',
    }
  }

  // 4. No QR + no OCR text
  return {
    method: 'none',
    error: 'ไม่พบ QR code หรือข้อความในรูปภาพ',
  }
}

/**
 * Build a LINE reply message for image processing result.
 *
 * @param result — ImageProcessResult from processLineImage
 * @param woNumber — WO number if WO was created (optional)
 * @returns Array of LINE messages to reply
 */
export function buildImageReplyMessage(
  result: ImageProcessResult,
  woNumber?: string,
): Array<{ type: 'text'; text: string }> {
  if (result.device && woNumber) {
    const d = result.device
    return [
      {
        type: 'text',
        text: `✅ สร้างใบงานแล้ว\n\nเลขที่: ${woNumber}\nอุปกรณ์: ${d.assetCode ?? '-'}\nชื่อ: ${d.name ?? '-'}\nยี่ห้อ: ${d.brand ?? '-'} ${d.model ?? ''}\nสาขา: ${d.site ?? '-'}\n\nสถานะ: รอแอดมินจ่ายงาน\n\nติดตามสถานะได้โดยพิมพ์ "สถานะ" หรือเลขใบงาน`,
      },
    ]
  }

  if (result.device && !woNumber) {
    const d = result.device
    return [
      {
        type: 'text',
        text: `พบอุปกรณ์: ${d.assetCode ?? '-'} (${d.name ?? '-'})\n\nแต่ไม่สามารถสร้างใบงานได้ กรุณาแจ้งปัญหาเพิ่มเติม เช่น:\n- เครื่องพิมพ์ไม่ได้\n- กระดาษติด\n- หมึกหมด`,
      },
    ]
  }

  if (result.error) {
    return [
      {
        type: 'text',
        text: `⚠️ ${result.error}\n\nวิธีแจ้งซ่อม:\n1. ส่งรหัสเครื่อง (เช่น IT-00001)\n2. ส่งรูป QR code ที่สติกเกอร์อุปกรณ์\n3. พิมพ์ "แจ้งซ่อม" + รายละเอียดปัญหา`,
      },
    ]
  }

  return [
    {
      type: 'text',
      text: 'ไม่สามารถประมวลผลรูปภาพได้ กรุณาลองอีกครั้งหรือพิมพ์รหัสเครื่องแทน',
    },
  ]
}
