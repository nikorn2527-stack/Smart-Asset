import {beforeEach,it,expect,vi} from 'vitest'
const db=vi.hoisted(()=>({findFirst:vi.fn(),update:vi.fn(),create:vi.fn()}))
vi.mock('@/lib/db',()=>({db:{organizationProfile:db}}))
import {getOrgProfile,updateOrgProfile} from '@/lib/org-profile'
beforeEach(()=>vi.resetAllMocks())
it('uses Smart-Asset and October fiscal defaults on an unconfigured government instance',async()=>{db.findFirst.mockResolvedValue(null);const p=await getOrgProfile();expect(p.appName).toBe('Smart-Asset');expect(p.industryType).toBe('government');expect(p.fiscalYearStartMonth).toBe(10)})
it('persists the financial policy that the existing settings screen submits',async()=>{db.findFirst.mockResolvedValue({id:'p1'});db.update.mockResolvedValue({appName:'หน่วยงาน A',assetTerminology:'ครุภัณฑ์',fiscalYearStartMonth:10,defaultCapitalizeThreshold:null});const p=await updateOrgProfile({assetTerminology:'ครุภัณฑ์',fiscalYearStartMonth:10,defaultCapitalizeThreshold:null});expect(db.update.mock.calls[0][0].data).toMatchObject({assetTerminology:'ครุภัณฑ์',fiscalYearStartMonth:10,defaultCapitalizeThreshold:null});expect(p.fiscalYearStartMonth).toBe(10);expect(p.defaultCapitalizeThreshold).toBeNull()})
