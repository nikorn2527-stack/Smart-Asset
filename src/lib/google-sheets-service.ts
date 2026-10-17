/**
 * google-sheets-service.ts — Google Sheets API v4 with Service Account.
 *
 * Replaces the old public CSV export approach (google-sheets-sync.ts)
 * which required "Anyone with link" sharing. Now uses a Service Account
 * (private key) to read private sheets securely.
 *
 * Setup:
 *   1. Create a Google Service Account in Google Cloud Console
 *   2. Enable Google Sheets API
 *   3. Share the 3 sheets with the service account email (Viewer)
 *   4. Set env vars:
 *      - GOOGLE_SERVICE_ACCOUNT_KEY (JSON key as string, or path to JSON file)
 *      - GOOGLE_SHEETS_ID_ITAM (IT Asset Management spreadsheet ID)
 *      - GOOGLE_SHEETS_ID_SERVICES (Services/repair spreadsheet ID)
 *      - GOOGLE_SHEETS_ID_STOCK (Stock spreadsheet ID)
 *
 * Usage:
 *   const sheets = new GoogleSheetsService()
 *   const rows = await sheets.fetchSheet('itam', 'All_Devices')
 *   // rows = array of objects keyed by header row
 */

import { google } from 'googleapis'

export type SheetApp = 'itam' | 'services' | 'stock'

const SHEET_IDS: Record<SheetApp, string> = {
  itam: process.env.GOOGLE_SHEETS_ID_ITAM ?? '',
  services: process.env.GOOGLE_SHEETS_ID_SERVICES ?? '',
  stock: process.env.GOOGLE_SHEETS_ID_STOCK ?? '',
}

export interface SheetRow {
  [key: string]: string
}

let _sheetsClient: ReturnType<typeof google.sheets> | null = null
let _authClient: any = null

/**
 * Get or create an authenticated JWT client using the Service Account key.
 * The key can be provided as:
 *   - GOOGLE_SERVICE_ACCOUNT_KEY env var (full JSON string)
 *   - GOOGLE_SERVICE_ACCOUNT_KEY_FILE env var (path to JSON file)
 */
function getAuthClient() {
  if (_authClient) return _authClient

  const keyStr = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE

  let credentials: { client_email: string; private_key: string }

  if (keyStr) {
    // Key provided as JSON string in env var
    try {
      credentials = JSON.parse(keyStr)
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON')
    }
  } else if (keyFile) {
    // Key provided as file path
    // Note: in Vercel, use GOOGLE_SERVICE_ACCOUNT_KEY (string) not file path
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_FILE not supported in serverless. Use GOOGLE_SERVICE_ACCOUNT_KEY env var.')
  } else {
    throw new Error(
      'No Google Service Account key configured. Set GOOGLE_SERVICE_ACCOUNT_KEY env var.',
    )
  }

  _authClient = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })

  return _authClient
}

/**
 * Get or create the Sheets API client.
 */
function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient
  const auth = getAuthClient()
  _sheetsClient = google.sheets({ version: 'v4', auth })
  return _sheetsClient
}

/**
 * Fetch a single sheet (tab) as an array of row objects.
 *
 * @param app Which legacy app ('itam' | 'services' | 'stock')
 * @param sheetName The tab/sheet name (e.g. 'All_Devices', 'Data', 'Products')
 * @param range Optional range override (default: entire sheet)
 * @returns Array of row objects (keys from header row). Empty array on error.
 */
export interface FetchSheetResult {
  rows: SheetRow[]
  error?: string // if set, rows is empty and this explains why
}

/**
 * Fetch a single sheet (tab) as an array of row objects.
 * Returns { rows, error } — check `error` to distinguish "sheet is empty"
 * from "auth failed / sheet not found / rate limited".
 *
 * SPRINT-1 #7 (SYNC-AUDIT-010 #14): adds retry logic for Google Sheets
 * API rate limit (HTTP 429 / RESOURCE_EXHAUSTED). Previously a 429 was
 * caught and returned as `{ rows: [], error }` — sync reported "ok" but
 * synced 0 rows silently. Now we retry up to 3 times with exponential
 * backoff (1s → 2s → 4s) before giving up.
 */
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  // Google Sheets API rate limit signatures
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('quota')
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchSheet(
  app: SheetApp,
  sheetName: string,
  range?: string,
): Promise<FetchSheetResult> {
  const spreadsheetId = SHEET_IDS[app]
  if (!spreadsheetId) {
    const error = `No GOOGLE_SHEETS_ID_${app.toUpperCase()} env var set`
    console.warn(`[google-sheets-service] ${error}`)
    return { rows: [], error }
  }

  const sheets = getSheetsClient()
  const fullRange = range ?? `${sheetName}!A:Z`

  // SPRINT-1 #7: retry loop for 429 RESOURCE_EXHAUSTED
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: fullRange,
      })

      const rows = response.data.values
      if (!rows || rows.length === 0) return { rows: [] }

      const headers = rows[0].map((h) => String(h).trim())
      const result: SheetRow[] = []

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        const obj: SheetRow = {}
        for (let j = 0; j < headers.length; j++) {
          const key = headers[j]
          if (key) {
            obj[key] = String(row[j] ?? '').trim()
          }
        }
        result.push(obj)
      }

      return { rows: result }
    } catch (err) {
      // If this is a rate limit error AND we haven't exhausted retries,
      // wait and retry instead of returning empty rows.
      if (isRateLimitError(err) && attempt < MAX_RETRIES) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
        console.warn(
          `[google-sheets-service] fetchSheet(${app}, ${sheetName}) got 429 on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${backoffMs}ms...`,
        )
        await sleep(backoffMs)
        continue
      }

      const error = err instanceof Error ? err.message : String(err)
      console.error(`[google-sheets-service] fetchSheet(${app}, ${sheetName}) failed after ${attempt + 1} attempt(s):`, error)
      return { rows: [], error }
    }
  }

  // Should not reach here (loop returns), but TS needs a fallback
  return { rows: [], error: 'Max retries exceeded' }
}

/**
 * Fetch multiple sheets in parallel.
 * Returns a map of sheetName → rows.
 */
export async function fetchMultipleSheets(
  app: SheetApp,
  sheetNames: string[],
): Promise<Record<string, SheetRow[]>> {
  const entries = await Promise.all(
    sheetNames.map(async (name) => [name, (await fetchSheet(app, name)).rows] as const),
  )
  return Object.fromEntries(entries)
}

/**
 * Check if the Service Account is configured and can authenticate.
 * Returns { ok: boolean, error?: string }
 */
export async function checkServiceAccount(): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = getAuthClient()
    await auth.authorize()
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Authorization failed',
    }
  }
}
