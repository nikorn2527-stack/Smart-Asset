import { NextResponse } from 'next/server'
import { getOrgProfile } from '@/lib/org-profile'
/** Public projection only: no financial policy, user, credential, or internal settings. */
export async function GET(){
  const p=await getOrgProfile()
  return NextResponse.json({profile:{appName:p.appName,appTagline:p.appTagline,logoUrl:p.logoUrl,primaryColor:p.primaryColor,accentColor:p.accentColor}},{headers:{'Cache-Control':'no-store'}})
}
