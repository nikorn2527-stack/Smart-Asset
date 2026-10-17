export interface RepairCompletionInput {
  note?: unknown
  picAfter?: unknown
  picOnsite?: unknown
  resolution?: unknown
  resolutionGroup?: unknown
}

export interface NormalizedRepairCompletionInput {
  note: string | null
  picAfter: string | null
  picOnsite: string | null
  resolution: string | null
  resolutionGroup: string | null
}

export type RepairCompletionValidation =
  | { ok: true; value: NormalizedRepairCompletionInput }
  | {
      ok: false
      code: 'INVALID_TEXT' | 'TEXT_TOO_LONG' | 'GROUP_WITHOUT_RESOLUTION'
      field: keyof NormalizedRepairCompletionInput
    }

const MAX_LENGTHS: Record<keyof NormalizedRepairCompletionInput, number> = {
  note: 2_000,
  // picAfter / picOnsite: base64 image data — a 1024px JPEG at 0.7 quality
  // is typically 50,000–200,000 characters. Allow up to 500,000 to be safe.
  // (Previously was 2,048 which rejected ALL real photos.)
  picAfter: 500_000,
  picOnsite: 500_000,
  resolution: 2_000,
  resolutionGroup: 120,
}

function normalizeText(
  value: unknown,
  field: keyof NormalizedRepairCompletionInput,
): { ok: true; value: string | null } | { ok: false; code: 'INVALID_TEXT' | 'TEXT_TOO_LONG'; field: keyof NormalizedRepairCompletionInput } {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, code: 'INVALID_TEXT', field }

  const normalized = value.trim()
  if (!normalized) return { ok: true, value: null }
  if (normalized.length > MAX_LENGTHS[field]) {
    return { ok: false, code: 'TEXT_TOO_LONG', field }
  }
  return { ok: true, value: normalized }
}

/**
 * Validate and normalize the user-controlled completion payload.
 * This contract is pure and intentionally does not know about auth or Prisma.
 */
export function validateRepairCompletionInput(
  input: RepairCompletionInput,
): RepairCompletionValidation {
  const fields = (Object.keys(MAX_LENGTHS) as Array<keyof NormalizedRepairCompletionInput>)
  const normalized = {} as NormalizedRepairCompletionInput

  for (const field of fields) {
    const result = normalizeText(input[field], field)
    if (!result.ok) return result
    normalized[field] = result.value
  }

  if (!normalized.resolution && normalized.resolutionGroup) {
    return { ok: false, code: 'GROUP_WITHOUT_RESOLUTION', field: 'resolutionGroup' }
  }

  return { ok: true, value: normalized }
}
