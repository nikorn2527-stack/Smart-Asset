import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getLifecycleReadingType } from '@/lib/lifecycle-reading-type'

const activeTransferSource = readFileSync(
  'src/app/api/devices/[id]/transfer/route.ts',
  'utf8',
)
const canonicalTransferSource = readFileSync(
  'src/app/api/itam/devices/[id]/transfer/route.ts',
  'utf8',
)
const activeLifecycleSource = readFileSync(
  'src/app/api/devices/[id]/lifecycle/route.ts',
  'utf8',
)
const canonicalLifecycleSource = readFileSync(
  'src/app/api/itam/devices/[id]/lifecycle/route.ts',
  'utf8',
)
const deviceSheetSource = readFileSync(
  'src/components/itam/device-detail-sheet.tsx',
  'utf8',
)
const meterKeyboardSource = readFileSync(
  'src/components/itam/itam-meter-keyboard.tsx',
  'utf8',
)

describe('Meter/Lifecycle active runtime boundary', () => {
  it('preserves the legacy transfer payload and response aliases through the active facade', () => {
    expect(activeTransferSource).toContain('postCanonicalTransfer')
    expect(activeTransferSource).toContain('body.toDepartment ?? body.toDept')
    expect(activeTransferSource).toContain('body.toDepartmentCode ?? body.toDeptCode')
    expect(activeTransferSource).toContain('transfer: locationHistory')
    expect(activeTransferSource).not.toContain('db.device.update({')
  })

  it('requires a meter id or an explicit acknowledgement, not a reason alone', () => {
    expect(canonicalTransferSource).toContain('device.meterRequired && !meterReadingId && !meterSkipAcknowledged')
    expect(canonicalTransferSource).toContain("code: 'METER_REQUIRED'")
    expect(canonicalLifecycleSource).toContain('meterRequired && !meterReadingId && !meterSkipAcknowledged')
    expect(canonicalLifecycleSource).toContain('body.meterSkipAcknowledged === true')
  })

  it('uses one transaction for device, history, and meter event linkage', () => {
    // The route was refactored to drive transactions through
    // `getBaseClient().$transaction(...)` instead of `db.$transaction(...)`.
    // Both are the same Prisma transaction — accept either so this source-shape
    // assertion does not break again on the next refactor.
    const oneTransaction = /(?:db|getBaseClient\(\))\.\$transaction\(async \(tx\) =>/
    expect(canonicalTransferSource).toMatch(oneTransaction)
    expect(canonicalLifecycleSource).toMatch(oneTransaction)
    expect(canonicalTransferSource).toContain('tx.device.update({')
    expect(canonicalTransferSource).toContain('tx.deviceTransfer.create({')
    expect(canonicalTransferSource).toContain('tx.meterReading.update({')
    expect(canonicalTransferSource).toContain('reading.deviceId !== device.id || reading.assetCode !== device.assetCode')
    expect(canonicalTransferSource).toContain("eventType: 'LIFECYCLE_METER_INCOMPLETE'")
    expect(canonicalTransferSource).toContain('body.transferDate ?? body.actionDate ?? body.moveDate')
    expect(canonicalLifecycleSource).toMatch(oneTransaction)
    expect(canonicalLifecycleSource).toContain('tx.device.update({')
    expect(canonicalLifecycleSource).toContain('tx.deviceTransfer.create({')
    expect(canonicalLifecycleSource).toContain('tx.meterReading.update({')
  })

  it('records the complete location snapshot and server-derived lifecycle type', () => {
    for (const field of [
      'fromSite',
      'fromAssetSiteCode',
      'fromBuilding',
      'fromFloor',
      'fromDepartment',
      'fromDepartmentCode',
      'fromLocation',
      'toSite',
      'toAssetSiteCode',
      'toBuilding',
      'toFloor',
      'toDepartment',
      'toDepartmentCode',
      'toLocation',
    ]) {
      expect(canonicalLifecycleSource).toMatch(new RegExp(`${field}\\s*(?::|,)`))
    }
    expect(canonicalLifecycleSource).toContain('getLifecycleReadingType(device.status, toStatus)')
    expect(canonicalTransferSource).toContain('getLifecycleReadingType(device.status, toStatus)')
  })

  it('uses the active lifecycle endpoint for status actions and passes back meter id/color', () => {
    expect(deviceSheetSource).toContain("fetch(`/api/devices/${deviceId}/lifecycle`")
    expect(deviceSheetSource).toContain('meterReadingId = meterPayload.reading?.id ?? null')
    expect(deviceSheetSource).toContain('meterColor: actMeterColor.trim() === \'\' ? 0 : Number(actMeterColor)')
    expect(deviceSheetSource).toContain('meterSkipAcknowledged: meterRequired && !meterReadingId && actMeterSkipAcknowledged')
    expect(deviceSheetSource).not.toContain('// 3. Status change → PUT /api/devices/[id]')
  })

  it('keeps the historical facade argument order while matching protected mapping', () => {
    expect(getLifecycleReadingType('Active', 'Disposed')).toBe('FINAL')
    expect(getLifecycleReadingType('Active', 'In Repair')).toBe('SEND_REPAIR')
    expect(getLifecycleReadingType('In Stock', 'Inactive')).toBe('CHECKOUT')
    expect(getLifecycleReadingType('Inactive', 'Active')).toBe('RETURN')
    // Active→Active used to collapse to MONTHLY. It is now its own TRANSFER
    // type so a move mid-cycle is distinguishable from an end-of-month read —
    // that distinction is what lets the transfer write the closing row and the
    // TRANSFER_IN opening row without polluting the monthly cycle report.
    expect(getLifecycleReadingType('Active', 'Active')).toBe('TRANSFER')
  })

  it('renders the successful reading in the primary visible area with the required fields', () => {
    for (const field of [
      'ล่าสุด {latest.assetCode}',
      'latest.assetCode',
      'latest.meterBw',
      'latest.meterColor',
      'latest.delta',
      // The primary line shows the time only; fmtDateTime is still used for the
      // title tooltip, so both helpers must still exist.
      'fmtTime(latest.at, lang)',
      'fmtDateTime(latest.at, lang)',
      "latest.reset ? 'RESET'",
      'role="status"',
      'aria-live="polite"',
    ]) {
      expect(meterKeyboardSource).toContain(field)
    }
    expect(meterKeyboardSource).toContain('คีย์ล่าสุด <span className="font-semibold text-emerald-600 dark:text-emerald-400">{recent.length}</span>')
    expect(meterKeyboardSource).toContain('setRecent((prev) => [savedReading, ...prev].slice(0, 5))')
    const latestPanel = meterKeyboardSource.indexOf('{latest && (')
    const progressBar = meterKeyboardSource.indexOf('<Progress value={pct}')
    // Anchor on the words, not the whole comment: the "Main split — left: …"
    // banner has been reworded over time, so matching the exact comment string
    // made this assertion fail on wording instead of on layout.
    const mainSplit = meterKeyboardSource.indexOf('Main split')
    expect(latestPanel).toBeGreaterThan(progressBar)
    expect(latestPanel).toBeLessThan(mainSplit)
    expect(meterKeyboardSource).not.toContain('Secondary history: retained for review; primary confirmation is above.')
    expect(meterKeyboardSource).not.toContain('recent.map((r, i)')
    expect(meterKeyboardSource).toContain('flex h-full min-h-0 flex-col')
    expect(meterKeyboardSource).not.toContain('h-[calc(100vh-3.5rem)]')
    expect(meterKeyboardSource).not.toContain('md:h-[calc(100vh-0px)]')
  })

  it('publishes latest and recent only after the meter API confirms success', () => {
    const responseGuard = meterKeyboardSource.indexOf("if (!res.ok)")
    const latestUpdate = meterKeyboardSource.indexOf('setLatest(savedReading)')
    const historyUpdate = meterKeyboardSource.indexOf('setRecent((prev) => [savedReading, ...prev].slice(0, 5))')
    expect(responseGuard).toBeGreaterThan(-1)
    expect(latestUpdate).toBeGreaterThan(responseGuard)
    expect(historyUpdate).toBeGreaterThan(latestUpdate)
    expect(meterKeyboardSource).toContain("throw new Error(j.error || 'Save failed')")
  })
})
