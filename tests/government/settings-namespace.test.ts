import {beforeEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({auth:vi.fn(),find:vi.fn(),upsert:vi.fn()}))
vi.mock('@/lib/auth-middleware',()=>({requireAuth:m.auth}))
vi.mock('@/lib/db',()=>({db:{appSetting:{findMany:m.find,upsert:m.upsert}}}))
vi.mock('@/lib/secret-crypto',()=>({encryptSecret:(v:string)=>v}))
import {GET,PUT} from '@/app/api/settings/route'
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({ok:true});m.find.mockResolvedValue([{key:'appName',value:'Smart-Asset'},{key:'government-register:v1:other-org:asset',value:'private document'},{key:'jwt_secret',value:'secret'}])})
it('does not export private documents through the generic settings API',async()=>{const r=await GET(new NextRequest('https://assets.example/api/settings'));expect((await r.json()).settings).toEqual({appName:'Smart-Asset'})})
it('cannot bypass document scopes or revision checks using the generic settings writer',async()=>{const r=await PUT(new NextRequest('https://assets.example/api/settings',{method:'PUT',body:JSON.stringify({'government-register:v1:org:device':'forged snapshot'})}));expect(r.status).toBe(400);expect(m.upsert).not.toHaveBeenCalled()})
it('still returns ordinary settings without private documents after a valid config update',async()=>{const r=await PUT(new NextRequest('https://assets.example/api/settings',{method:'PUT',body:JSON.stringify({appName:'ชื่อหน่วยงาน'})}));expect(r.status).toBe(200);expect((await r.json()).settings).toEqual({appName:'Smart-Asset'})})
