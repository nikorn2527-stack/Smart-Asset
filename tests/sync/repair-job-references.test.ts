import { describe, expect, it } from 'vitest'
import { getRepairJobReferences } from '@/lib/repair-job-references'

describe('getRepairJobReferences', () => {
  it('returns stable unique references across compatibility and new identifiers', () => {
    expect(
      getRepairJobReferences({
        woNumber: ' WO-100 ',
        systemJobNo: 'SYS-100',
        legacyJobNo: 'LEG-100',
      }),
    ).toEqual(['WO-100', 'SYS-100', 'LEG-100'])
  })

  it('removes duplicates and blank identifiers', () => {
    expect(
      getRepairJobReferences({
        woNumber: 'WO-100',
        systemJobNo: ' WO-100 ',
        legacyJobNo: null,
      }),
    ).toEqual(['WO-100'])
  })

  it('returns no references when the source has no usable job number', () => {
    expect(
      getRepairJobReferences({
        woNumber: ' ',
        systemJobNo: undefined,
        legacyJobNo: null,
      }),
    ).toEqual([])
  })
})
