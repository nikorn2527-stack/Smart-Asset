import { NextRequest,NextResponse } from 'next/server'
import { db,getBaseClient } from '@/lib/db'
import { getOrgProfile } from '@/lib/org-profile'
import { registerDevice } from '@/lib/government/register-access'
import { REGISTER_FIELDS,emptyRegisterRow,fiscalYear,thaiDocumentDate,validateRegister,RegisterInputError,registerStorageKey,type GovernmentRegister,type RegisterSnapshot } from '@/lib/government/register'

interface Context { params: Promise<{id:string}> }
const headers={'Cache-Control':'no-store'}
class Conflict extends Error {}
function decode(value: string): RegisterSnapshot {
  const raw=JSON.parse(value) as RegisterSnapshot
  if(raw.schemaVersion!==1||!Number.isSafeInteger(raw.revision)||raw.revision<1)throw new Error('Unsupported document version')
  return {...raw,form:validateRegister(raw.form)}
}
export async function GET(req: NextRequest,{params}:Context) {
  const access=await registerDevice(req,(await params).id)
  if(!access.ok)return access.response
  try{
    const device=access.device,orgId=device.organizationId!
    const [saved,profile,organization]=await Promise.all([
      db.appSetting.findUnique({where:{key:registerStorageKey(orgId,device.id)}}),getOrgProfile(),db.organization.findUnique({where:{id:orgId},select:{name:true}}),
    ])
    const snapshot=saved?decode(saved.value):null
    const fields=Object.fromEntries(REGISTER_FIELDS.map(([key])=>[key,''])) as GovernmentRegister['fields']
    Object.assign(fields,{organization:organization?.name||'',department:device.department||'',type:device.type,code:device.assetCode,description:device.name,model:device.model,location:device.location||[device.site,device.building,device.floor,device.room].filter(Boolean).join(' · '),vendor:device.vendor||'',serial:device.serialNumber||'',warranty:thaiDocumentDate(device.warrantyEnd),fiscalYear:fiscalYear(device.purchaseDate,profile.fiscalYearStartMonth)})
    const row={...emptyRegisterRow(),date:thaiDocumentDate(device.purchaseDate),description:device.name,quantity:'1',unitPrice:device.purchasePrice?.toString()||'',total:device.purchasePrice?.toString()||'',life:device.usefulLife?.toString()||''}
    const initial:GovernmentRegister={fields,rows:[row],summary:{annual:'',accumulated:'',net:''}}
    return NextResponse.json({form:snapshot?.form||initial,revision:snapshot?.revision||0,updatedAt:snapshot?.updatedAt||null,sourceUpdatedAt:device.updatedAt.toISOString(),sourceChanged:!!snapshot&&snapshot.sourceUpdatedAt!==device.updatedAt.toISOString(),canEdit:access.ctx.canAtSite(device.site,'DEVICE_EDIT'),device:{id:device.id,assetCode:device.assetCode,name:device.name,site:device.site}},{headers})
  }catch{
    return NextResponse.json({error:'อ่านเอกสารไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล'},{status:500,headers})
  }
}
export async function PUT(req:NextRequest,{params}:Context){
  const access=await registerDevice(req,(await params).id,true)
  if(!access.ok)return access.response
  try{
    const raw=await req.text()
    if(raw.length>100_000)return NextResponse.json({error:'ข้อมูลเอกสารใหญ่เกินกำหนด'},{status:413,headers})
    let body:{revision?:unknown;form?:unknown}
    try{body=JSON.parse(raw)}catch{return NextResponse.json({error:'JSON ไม่ถูกต้อง'},{status:400,headers})}
    if(!body||!Number.isSafeInteger(body.revision)||Number(body.revision)<0)throw new RegisterInputError('เลขฉบับแก้ไขไม่ถูกต้อง')
    const form=validateRegister(body.form),expected=body.revision as number
    const result=await getBaseClient().$transaction(async tx=>{
      const device=await tx.device.findFirst({where:{id:access.device.id,...access.scope}})
      if(!device||device.organizationId!==access.device.organizationId||!access.ctx.canAtSite(device.site,'DEVICE_EDIT'))throw new Conflict('ข้อมูลครุภัณฑ์หรือสิทธิ์เปลี่ยนไป กรุณาโหลดใหม่')
      const key=registerStorageKey(device.organizationId!,device.id)
      const current=await tx.appSetting.findUnique({where:{key}})
      const previous=current?decode(current.value):null
      if((previous?.revision||0)!==expected)throw new Conflict('เอกสารถูกแก้ไขแล้ว กรุณาโหลดฉบับล่าสุดก่อนบันทึก')
      const snapshot:RegisterSnapshot={schemaVersion:1,revision:expected+1,form,sourceUpdatedAt:device.updatedAt.toISOString(),updatedAt:new Date().toISOString(),updatedBy:access.auth.row.id}
      const value=JSON.stringify(snapshot)
      if(current){
        const updated=await tx.appSetting.updateMany({where:{id:current.id,value:current.value},data:{value}})
        if(updated.count!==1)throw new Conflict('เอกสารถูกแก้ไขแล้ว กรุณาโหลดใหม่')
      }else await tx.appSetting.create({data:{key,value,isDemo:device.isDemo}})
      await tx.auditLog.create({data:{organizationId:device.organizationId,action:'UPDATE',entity:'GovernmentRegister',entityId:device.id,summary:`บันทึกทะเบียนคุมทรัพย์สิน ฉบับแก้ไข ${snapshot.revision}`,detail:JSON.stringify({revision:snapshot.revision,sourceUpdatedAt:snapshot.sourceUpdatedAt}),actor:access.auth.user.email,userId:access.auth.row.id,siteCode:device.site,isDemo:device.isDemo}})
      return {revision:snapshot.revision,updatedAt:snapshot.updatedAt}
    })
    return NextResponse.json(result,{headers})
  }catch(error){
    if(error instanceof RegisterInputError)return NextResponse.json({error:error.message},{status:400,headers})
    if(error instanceof Conflict)return NextResponse.json({error:error.message},{status:409,headers})
    const code=(error as {code?:string})?.code
    if(code==='P2002'||code==='P2034')return NextResponse.json({error:'มีการบันทึกพร้อมกัน กรุณาโหลดฉบับล่าสุดก่อนลองอีกครั้ง'},{status:409,headers})
    return NextResponse.json({error:'บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่'},{status:500,headers})
  }
}
