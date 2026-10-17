import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { getOrgScope } from '@/lib/org-scope'
import { demoFilter } from '@/lib/demo-mode'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { NextResponse } from 'next/server'

export async function registerAccess(req: Request) {
  const disabled=await moduleUnavailableResponse('reports')
  if(disabled)return {ok:false as const,response:disabled}
  const auth=await requireAuth(req)
  if(!auth.ok)return {ok:false as const,response:NextResponse.json({error:auth.error},{status:auth.status})}
  const org=getOrgScope(auth.user)
  if(!org.ok)return {ok:false as const,response:NextResponse.json({error:org.error.message},{status:org.error.status})}
  const ctx=await buildAuthorizationContext(auth.user,auth.row.id,auth.row.allowedSites)
  const scope={...org.where,...demoFilter(auth.user),...ctx.siteWhere()}
  return {ok:true as const,auth,ctx,scope}
}
export async function registerDevice(req: Request,id: string,write=false) {
  const access=await registerAccess(req)
  if(!access.ok)return access
  const device=await db.device.findFirst({where:{id,...access.scope}})
  if(!device||!access.ctx.canAtSite(device.site,write?'DEVICE_EDIT':'VIEW_DEVICES')){
    return {ok:false as const,response:NextResponse.json({error:'ไม่พบครุภัณฑ์หรือไม่มีสิทธิ์ดำเนินการ'},{status:404})}
  }
  // A document is tenant-owned. Legacy devices need an explicit org backfill first.
  if(!device.organizationId)return {ok:false as const,response:NextResponse.json({error:'กรุณาผูกครุภัณฑ์กับหน่วยงานก่อนจัดทำเอกสาร'},{status:409})}
  return {...access,device}
}
