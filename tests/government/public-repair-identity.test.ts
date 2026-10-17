import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mock=vi.hoisted(()=>({session:vi.fn(),resolve:vi.fn(),site:vi.fn()}))
vi.mock('@/lib/line-session',()=>({getLineSession:mock.session}))
vi.mock('@/lib/qr-identity',()=>({resolveDeviceQrIdentity:mock.resolve}))
vi.mock('@/lib/module-gate',()=>({moduleUnavailableResponse:async()=>null}))
vi.mock('@/lib/db',()=>({db:{siteAttribute:{findUnique:mock.site}}}))
vi.mock('@/lib/notifications',()=>({notifyWorkOrderCreated:vi.fn()}))
vi.mock('@/lib/wo-number-pattern',()=>({getActiveWoPattern:vi.fn(),generateWoNumberFromPattern:vi.fn(),ensureDefaultWoPatterns:vi.fn()}))
import { POST } from '@/app/api/public/repairs/route'
const base={deviceShortId:'full-device-id',siteCode:'SITE-A',name:'Synthetic requester',phone:'0000000000',subject:'Synthetic repair'}
const req=(body:object)=>new NextRequest('http://local/api/public/repairs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{vi.resetAllMocks();mock.session.mockResolvedValue(null)})
it('rejects client-supplied LINE verification without a server session',async()=>{
 const result=await POST(req({...base,lineUserId:'spoofed',lineScopePhone:'0000000000'}))
 expect(result.status).toBe(401);expect(mock.resolve).not.toHaveBeenCalled()
})
it('rejects a different LINE identity even with a valid session',async()=>{
 mock.session.mockResolvedValue({userId:'actual-line-user',displayName:'Actual',scopePhone:null})
 expect((await POST(req({...base,lineUserId:'spoofed'}))).status).toBe(401)
})
it('fails ambiguous or missing QR identity before touching reporters or work orders',async()=>{
 mock.resolve.mockResolvedValue(null)
 expect((await POST(req(base))).status).toBe(404);expect(mock.site).not.toHaveBeenCalled()
})
it('requires canonical organization ownership before creating repair data',async()=>{
 mock.resolve.mockResolvedValue({id:'full-device-id',organizationId:null,site:'SITE-A'})
 expect((await POST(req(base))).status).toBe(409);expect(mock.site).not.toHaveBeenCalled()
})
it('uses the resolved device site, refusing caller-supplied routing to another site',async()=>{
 mock.resolve.mockResolvedValue({id:'full-device-id',organizationId:'ORG-A',site:'SITE-A'})
 expect((await POST(req({...base,siteCode:'SITE-B'}))).status).toBe(400);expect(mock.site).not.toHaveBeenCalled()
})
