import { NextRequest,NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { registerAccess } from '@/lib/government/register-access'
export async function GET(req: NextRequest) {
  const access=await registerAccess(req)
  if(!access.ok)return access.response
  const q=(req.nextUrl.searchParams.get('q')||'').slice(0,200)
  const requested=Number(req.nextUrl.searchParams.get('page')||1)
  const page=Number.isInteger(requested)&&requested>0?Math.min(requested,10000):1
  const where={...access.scope,organizationId:{not:null},...(access.scope.organizationId?{organizationId:access.scope.organizationId}:{}),...(q?{OR:[{assetCode:{contains:q}},{name:{contains:q}}]}:{})}
  const devices=await db.device.findMany({where,select:{id:true,assetCode:true,name:true,site:true},orderBy:{assetCode:'asc'},skip:(page-1)*50,take:51})
  const visible=devices.filter(d=>access.ctx.canAtSite(d.site,'VIEW_DEVICES'))
  return NextResponse.json({devices:visible.slice(0,50),page,hasMore:devices.length>50},{headers:{'Cache-Control':'no-store'}})
}
