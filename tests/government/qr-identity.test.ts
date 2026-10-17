import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock=vi.hoisted(()=>({device:{findFirst:vi.fn(),findMany:vi.fn()},deviceAccessory:{findFirst:vi.fn(),findMany:vi.fn()}}))
vi.mock('@/lib/db',()=>({db:mock}))
import { resolveDeviceQrIdentity, resolveAccessoryQrIdentity } from '@/lib/qr-identity'
import { generateDeviceQrUrl, generateAccessoryQrUrl, generateStickerQrData, parseSmartQr, resolveQrToDevice } from '@/lib/smart-qr'
beforeEach(()=>{vi.resetAllMocks();mock.device.findFirst.mockResolvedValue(null);mock.deviceAccessory.findFirst.mockResolvedValue(null)})
describe('stable QR identity',()=>{
  it('keeps full IDs including dashes and underscores',()=>{
    expect(generateDeviceQrUrl('asset_full-ID','view','https://assets.example')).toBe('https://assets.example/qr/d/asset_full-ID?action=view')
    expect(generateAccessoryQrUrl('accessory_full-ID','view','https://assets.example')).toContain('/qr/a/accessory_full-ID')
    expect(generateStickerQrData('d','asset_full-ID','repair','https://assets.example')).toContain('/qr/d/asset_full-ID?action=repair')
  })
  it('does not produce the same sticker identity for matching suffixes',()=>{
    expect(generateDeviceQrUrl('firstabcdefgh')).not.toBe(generateDeviceQrUrl('secondabcdefgh'))
  })
  it('rejects identifiers rather than silently stripping characters',()=>expect(()=>generateDeviceQrUrl('bad/id')).toThrow())
  it('keeps exact identity and does not attempt an alias after success',async()=>{
    mock.device.findFirst.mockResolvedValue({id:'full-id'})
    expect(await resolveDeviceQrIdentity('full-id')).toEqual({id:'full-id'})
    expect(mock.device.findMany).not.toHaveBeenCalled()
  })
  it('accepts a unique legacy code',async()=>{
    mock.device.findMany.mockResolvedValue([{id:'one'}])
    expect(await resolveDeviceQrIdentity('ASSET-01')).toEqual({id:'one'})
  })
  it('refuses ambiguous suffixes instead of taking the first repair target',async()=>{
    mock.device.findMany.mockResolvedValue([{id:'one'},{id:'two'}])
    expect(await resolveDeviceQrIdentity('same-end')).toBeNull()
  })
  it('places org/site/demo scope in BOTH exact and legacy queries',async()=>{
    mock.device.findMany.mockResolvedValue([])
    const scope={organizationId:'ORG-A',site:'SITE-A',isDemo:false}
    await resolveDeviceQrIdentity('abcdefgh',scope,true)
    for(const call of [mock.device.findFirst.mock.calls[0],mock.device.findMany.mock.calls[0]]){
      const query=JSON.stringify(call)
      expect(query).toContain('ORG-A');expect(query).toContain('SITE-A');expect(query).toContain('deletedAt');expect(query).toContain('isDemo')
    }
    expect(JSON.stringify(mock.device.findMany.mock.calls[0])).toContain('serialNumber')
  })
  it('does not allow serial-number lookup through the public resolver',async()=>{
    mock.device.findMany.mockResolvedValue([])
    await resolveDeviceQrIdentity('serial-number')
    expect(JSON.stringify(mock.device.findMany.mock.calls[0])).not.toContain('serialNumber')
  })
  it('scopes accessories through their parent and refuses duplicate suffixes',async()=>{
    mock.deviceAccessory.findMany.mockResolvedValue([{id:'one'},{id:'two'}])
    expect(await resolveAccessoryQrIdentity('abcdefgh',{organizationId:'ORG-A'})).toBeNull()
    expect(JSON.stringify(mock.deviceAccessory.findMany.mock.calls[0])).toContain('parentDevice')
    expect(JSON.stringify(mock.deviceAccessory.findMany.mock.calls[0])).toContain('ORG-A')
  })
  it('retains legacy QR parsing and validates unsupported actions',()=>{
    expect(parseSmartQr('/qr/d/abcdefgh?action=unsupported').action).toBe('repair')
    expect(parseSmartQr('ASSET-01').isLegacy).toBe(true)
  })
  it('uses identity resolution for legacy scans rather than fuzzy first-result search',async()=>{
    const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({deviceId:'exact'})})
    vi.stubGlobal('fetch',fetchMock)
    try{
      expect(await resolveQrToDevice(parseSmartQr('ASSET-01'),'token')).toMatchObject({deviceId:'exact',notFound:false})
      expect(fetchMock.mock.calls[0][0]).toBe('/api/devices/resolve?shortId=ASSET-01')
    }finally{vi.unstubAllGlobals()}
  })
})

it('does not crash on malformed URLs and only recognizes the actual QR path',()=>{
 expect(parseSmartQr('https://[bad/qr/d/abcdefgh').isLegacy).toBe(true)
 expect(parseSmartQr('https://assets.example/?next=/qr/d/abcdefgh').isLegacy).toBe(true)
 expect(parseSmartQr('?assetNo=ASSET%2D01').id).toBe('ASSET-01')
})
