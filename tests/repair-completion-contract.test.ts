import { describe, expect, it } from 'vitest'
import { validateRepairCompletionInput } from '@/lib/repair-completion-contract'

describe('validateRepairCompletionInput()', () => {
  it('trims optional text and preserves a valid completion payload', () => {
    expect(validateRepairCompletionInput({
      note: '  เปลี่ยนอะไหล่แล้ว  ',
      picAfter: '  after.jpg  ',
      picOnsite: null,
      resolution: '  เปลี่ยนชุดป้อนกระดาษ  ',
      resolutionGroup: '  Hardware  ',
    })).toEqual({
      ok: true,
      value: {
        note: 'เปลี่ยนอะไหล่แล้ว',
        picAfter: 'after.jpg',
        picOnsite: null,
        resolution: 'เปลี่ยนชุดป้อนกระดาษ',
        resolutionGroup: 'Hardware',
      },
    })
  })

  it('normalizes empty optional fields to null', () => {
    expect(validateRepairCompletionInput({
      note: '   ',
      picAfter: undefined,
      picOnsite: '',
      resolution: null,
      resolutionGroup: '  ',
    })).toMatchObject({
      ok: true,
      value: {
        note: null,
        picAfter: null,
        picOnsite: null,
        resolution: null,
        resolutionGroup: null,
      },
    })
  })

  it('fails closed for non-string and overlong user input', () => {
    expect(validateRepairCompletionInput({ note: { injected: true } })).toMatchObject({
      ok: false,
      code: 'INVALID_TEXT',
      field: 'note',
    })

    expect(validateRepairCompletionInput({ resolution: 'x'.repeat(2_001) })).toMatchObject({
      ok: false,
      code: 'TEXT_TOO_LONG',
      field: 'resolution',
    })
  })

  it('does not accept a resolution group without a resolution', () => {
    expect(validateRepairCompletionInput({
      resolutionGroup: 'Hardware',
    })).toEqual({
      ok: false,
      code: 'GROUP_WITHOUT_RESOLUTION',
      field: 'resolutionGroup',
    })
  })
})
