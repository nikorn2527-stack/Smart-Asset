import { describe, expect, it } from 'vitest'
import {
  parseDeviceImportCsv,
  validateDeviceImportRows,
} from '@/lib/device-import-contract'

describe('parseDeviceImportCsv()', () => {
  it('normalizes Thai headers and boolean values without DB access', () => {
    const result = parseDeviceImportCsv([
      'รหัสสินทรัพย์,ประเภท,รหัสแผนก,ต้องจดมิเตอร์,หมายเหตุ',
      'ASSET-01,Printer,IT,ใช่,หน้าห้อง Server',
    ].join('\n'))

    expect(result.errors).toHaveLength(0)
    expect(result.rows[0]).toMatchObject({
      rowNumber: 2,
      values: {
        assetNo: 'ASSET-01',
        deviceType: 'Printer',
        departmentCode: 'IT',
        meterRequired: true,
        remark: 'หน้าห้อง Server',
      },
    })
  })

  it('rejects a CSV without the required assetNo header', () => {
    const result = parseDeviceImportCsv('brand,model\nAcme,X1')

    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]).toMatchObject({
      field: 'assetNo',
      rowNumber: 1,
    })
  })

  it('rejects missing assetNo and invalid meterRequired per row', () => {
    const result = parseDeviceImportCsv([
      'assetNo,meterRequired',
      ',yes',
      'ASSET-02,maybe',
    ].join('\n'))

    expect(result.rows).toHaveLength(0)
    expect(result.errors).toEqual([
      { rowNumber: 2, field: 'assetNo', message: 'assetNo is required' },
      { rowNumber: 3, field: 'meterRequired', message: 'meterRequired must be a boolean value' },
    ])
  })

  it('rejects duplicate canonical headers instead of silently selecting one', () => {
    const result = parseDeviceImportCsv([
      'assetNo,brand,brand',
      'ASSET-03,Acme,Other',
    ].join('\n'))

    expect(result.errors).toContainEqual({
      rowNumber: 1,
      field: 'brand',
      message: 'duplicate CSV header for brand',
    })
  })
})

describe('validateDeviceImportRows()', () => {
  it('rejects duplicate asset numbers case-insensitively before persistence', () => {
    const parsed = parseDeviceImportCsv([
      'assetNo,brand',
      'Asset-04,Acme',
      'asset-04,Other',
    ].join('\n'))
    const result = validateDeviceImportRows(parsed.rows)

    expect(result.validRows).toHaveLength(1)
    expect(result.errors).toContainEqual({
      rowNumber: 3,
      field: 'assetNo',
      message: 'duplicate assetNo in CSV: asset-04',
    })
  })
})
