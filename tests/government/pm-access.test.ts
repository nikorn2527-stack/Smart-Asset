import { beforeEach, expect, it, vi } from 'vitest'
const mock=vi.hoisted(()=>({auth:vi.fn(),gate:vi.fn(),org:vi.fn(),ctx:vi.fn()}))
vi.mock('@/lib/auth-middleware',()=>({requireAuth:mock.auth}))
vi.mock('@/lib/module-gate',()=>({moduleUnavailableResponse:mock.gate}))
vi.mock('@/lib/org-scope',()=>({getOrgScope:mock.org}))
vi.mock('@/lib/authorization-context',()=>({buildAuthorizationContext:mock.ctx}))
import { pmAccess } from '@/lib/pm-access'
beforeEach(()=>{
 vi.resetAllMocks();mock.gate.mockResolvedValue(null)
 mock.auth.mockResolvedValue({ok:true,user:{email:'staff@example.invalid',organizationId:'ORG-A',isDemo:false},row:{id:'user-a',allowedSites:'SITE-A'}})
 mock.org.mockReturnValue({ok:true,where:{organizationId:'ORG-A'}})
 mock.ctx.mockResolvedValue({siteWhere:()=>({site:{in:['SITE-A']}})})
})
it('gates disabled PM before querying auth',async()=>{
 mock.gate.mockResolvedValue(new Response(null,{status:404}))
 const result=await pmAccess(new Request('http://local'))
 expect(result.ok).toBe(false);expect(mock.auth).not.toHaveBeenCalled()
})
it('requires actual authentication',async()=>{
 mock.auth.mockResolvedValue({ok:false,error:'login',status:401})
 const result=await pmAccess(new Request('http://local'))
 expect(result.ok).toBe(false);if(!result.ok)expect(result.response.status).toBe(401)
})
it('combines organization, site, demo and soft-delete for all PM reads',async()=>{
 const result=await pmAccess(new Request('http://local'))
 expect(result.ok).toBe(true)
 if(result.ok){expect(result.scope).toEqual({organizationId:'ORG-A',site:{in:['SITE-A']},isDemo:false,deletedAt:null});expect(result.deviceScope).toEqual(result.scope)}
})
it('uses WO_CREATE for writes and denies users without organization scope',async()=>{
 mock.org.mockReturnValue({ok:false,error:{message:'organization required',status:403}})
 const result=await pmAccess(new Request('http://local'),'WO_CREATE')
 expect(mock.auth).toHaveBeenCalledWith(expect.any(Request),'WO_CREATE')
 expect(result.ok).toBe(false);if(!result.ok)expect(result.response.status).toBe(403)
})
