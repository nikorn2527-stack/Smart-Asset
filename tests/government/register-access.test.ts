import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),ctx:vi.fn(),find:vi.fn(),gate:vi.fn()}))
vi.mock('@/lib/db',()=>({db:{device:{findFirst:mocks.find}}}))
vi.mock('@/lib/auth-middleware',()=>({requireAuth:mocks.auth}))
vi.mock('@/lib/authorization-context',()=>({buildAuthorizationContext:mocks.ctx}))
vi.mock('@/lib/module-gate',()=>({moduleUnavailableResponse:mocks.gate}))
import {registerDevice} from '@/lib/government/register-access'
const req=new Request('https://assets.example/api/government/register/d1')
beforeEach(()=>{vi.resetAllMocks();mocks.gate.mockResolvedValue(null);mocks.auth.mockResolvedValue({ok:true,user:{id:'u1',email:'u@sample.test',role:'viewer',organizationId:'org-a',isDemo:false},row:{id:'u1',allowedSites:'SITE-A'}});mocks.ctx.mockResolvedValue({siteWhere:()=>({site:{in:['SITE-A']}}),canAtSite:(site:string,permission:string)=>site==='SITE-A'&&permission==='VIEW_DEVICES'});mocks.find.mockResolvedValue({id:'d1',organizationId:'org-a',site:'SITE-A'})})
describe('government register authorization boundary',()=>{
 it('rejects anonymous requests before reading devices',async()=>{mocks.auth.mockResolvedValue({ok:false,status:401,error:'เข้าสู่ระบบ'});const r=await registerDevice(req,'d1');expect(r.ok).toBe(false);if(!r.ok)expect(r.response.status).toBe(401);expect(mocks.find).not.toHaveBeenCalled()})
 it('hides the module before auth when reports are disabled',async()=>{mocks.gate.mockResolvedValue(new Response(null,{status:404}));expect((await registerDevice(req,'d1')).ok).toBe(false);expect(mocks.auth).not.toHaveBeenCalled()})
 it('scopes the lookup to organization, site and demo mode',async()=>{expect((await registerDevice(req,'d1')).ok).toBe(true);expect(mocks.find).toHaveBeenCalledWith({where:{id:'d1',organizationId:'org-a',isDemo:false,site:{in:['SITE-A']}}})})
 it('does not distinguish inaccessible devices from missing devices',async()=>{mocks.find.mockResolvedValue(null);const r=await registerDevice(req,'other-org-device');if(r.ok)throw Error('allowed');expect(r.response.status).toBe(404)})
 it('does not let read-only users save a document',async()=>{const r=await registerDevice(req,'d1',true);if(r.ok)throw Error('allowed');expect(r.response.status).toBe(404)})
 it('requires a tenant identity for legacy assets',async()=>{mocks.find.mockResolvedValue({id:'d1',organizationId:null,site:'SITE-A'});const r=await registerDevice(req,'d1');if(r.ok)throw Error('allowed');expect(r.response.status).toBe(409)})
})
