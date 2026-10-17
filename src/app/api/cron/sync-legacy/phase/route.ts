import { NextRequest, NextResponse } from 'next/server'
import { db, getBaseClient } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { fetchSheet } from '@/lib/google-sheets-service'
import { mapCsvRow, FIELD_MAPPINGS, STATUS_MAPPINGS, normalizeKey } from '@/lib/csv-field-mapping'
import { normalizeStatus } from '@/lib/status-utils'
import { Prisma } from '@prisma/client'
import { moduleUnavailableResponse } from '@/lib/module-gate'

export const maxDuration = 60

function toInt(v: string | undefined): number { const n = parseInt(v ?? '0', 10); return Number.isFinite(n) ? n : 0 }
function toFloat(v: string | undefined): number | null { if (!v) return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null }
function parseBool(v: string | undefined): boolean { return ['true','1','yes'].includes((v ?? '').toLowerCase().trim()) }
function clean<T extends Record<string, unknown>>(obj: T): Partial<T> { return Object.fromEntries(Object.entries(obj).filter(([,v]) => v !== null && v !== undefined && v !== '')) as Partial<T> }

async function batchWrite<T>(rows: T[], fn: (row: T, tx: Prisma.TransactionClient) => Promise<void>, entity: string, dryRun: boolean) {
  let updated = 0, errors = 0; let error: string | undefined
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50)
    if (dryRun) { updated += batch.length; continue }
    try { await getBaseClient().$transaction(async (tx) => { for (const r of batch) await fn(r, tx) }); updated += batch.length }
    catch (err) { errors += batch.length; error = err instanceof Error ? err.message : String(err) }
  }
  return { updated, errors, error }
}

// Phase 1: ITAM (7 sheets)
async function phase1(dryRun: boolean) {
  const r = { devices:{fetched:0,updated:0,errors:0,error:undefined as string|undefined}, meterReadings:{fetched:0,updated:0,errors:0,error:undefined as string|undefined}, deviceTransfers:{fetched:0,updated:0,errors:0,error:undefined as string|undefined}, users:{fetched:0,updated:0,errors:0,error:undefined as string|undefined}, appSettings:{fetched:0,updated:0,errors:0,error:undefined as string|undefined}, masterItems:{fetched:0,updated:0,errors:0,error:undefined as string|undefined}, siteAttributes:{fetched:0,updated:0,errors:0,error:undefined as string|undefined} }
  const devIdMap = new Map<string, string>()
  try { const {rows,error}=await fetchSheet('itam','All_Devices'); if(error)throw new Error(error); r.devices.fetched=rows.length
    const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.device).data).filter(d=>d.assetCode)
    const res=await batchWrite(mapped,async(d,tx)=>{const p={assetCode:d.assetCode,name:d.brand&&d.model?`${d.brand} ${d.model}`:d.assetCode,brand:d.brand||'',model:d.model||'',type:d.type||'',serialNumber:d.serialNumber||null,status:normalizeStatus(d.status)||'Active',site:d.site||'',department:d.department||null,departmentCode:d.departmentCode||null,assetSiteCode:d.assetSiteCode||null,location:d.location||null,building:d.building||null,floor:d.floor||null,contractNo:d.contractNo||null,vendor:d.vendor||null,ip:d.ip||null,mac:d.mac||null,remoteId:d.remoteId||null,installDate:d.installDate||null,uninstallDate:d.uninstallDate||null,warrantyEnd:d.warrantyEnd||null,deviceGroup:d.deviceGroup||null,costCenter:d.costCenter||null,meterRequired:parseBool(d.meterRequired),meterMode:d.meterMode||null,remark:d.remark||null,updatedBy:d.updatedBy||'sync-legacy',isDemo:false};const rec=await tx.device.upsert({where:{assetCode:p.assetCode},create:p,update:clean(p)});devIdMap.set(rec.assetCode,rec.id)},'device',dryRun)
    r.devices.updated=res.updated;r.devices.errors=res.errors;r.devices.error=res.error
  } catch(e){r.devices.error=e instanceof Error?e.message:String(e)}
  // MeterReadings
  try { const {rows,error}=await fetchSheet('itam','Meter_Readings'); if(error)throw new Error(error); r.meterReadings.fetched=rows.length
    const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.meterReading).data)
    const res=await batchWrite(mapped,async(d,tx)=>{const lc=d.deviceId as string;const did=devIdMap.get(lc);if(!did)return;await tx.meterReading.upsert({where:{readingId:d.id??''},create:{readingId:d.id,deviceId:did,readingDate:d.readingDate||'',readingMonth:d.readingMonth||'',meterBw:toInt(d.meterBw),meterColor:toInt(d.meterColor),pagesBw:toInt(d.pagesBw),pagesColor:toInt(d.pagesColor),readingType:d.readingType||'MONTHLY',readBy:d.readBy||null,isDemo:false},update:{deviceId:did,isDemo:false}})},'meterReading',dryRun)
    r.meterReadings.updated=res.updated;r.meterReadings.errors=res.errors;r.meterReadings.error=res.error
  } catch(e){r.meterReadings.error=e instanceof Error?e.message:String(e)}
  // Transfers
  try { const {rows,error}=await fetchSheet('itam','Location_History'); if(error)throw new Error(error); r.deviceTransfers.fetched=rows.length
    const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.deviceTransfer).data)
    const res=await batchWrite(mapped,async(d,tx)=>{const lc=d.deviceId as string;const did=devIdMap.get(lc);if(!did)return;// DeviceTransfer requires BOTH `moveDate` is optional-but-present AND
// `transferDate: String` (required, non-null). `toSite` is also required
// (non-null String) — passing `|| null` made Prisma reject the write.
await tx.deviceTransfer.upsert({where:{logId:d.id??''},create:{logId:d.id,deviceId:did,moveDate:d.transferDate||null,transferDate:d.transferDate||'',fromSite:d.fromSite||null,toSite:d.toSite||'',fromDepartment:d.fromDepartment||null,toDepartment:d.toDepartment||null,fromDepartmentCode:d.fromDepartmentCode||null,toDepartmentCode:d.toDepartmentCode||null,fromBuilding:d.fromBuilding||null,toBuilding:d.toBuilding||null,fromFloor:d.fromFloor||null,toFloor:d.toFloor||null,fromLocation:d.fromLocation||null,toLocation:d.toLocation||null,movedBy:d.movedBy||null,reason:d.reason||null,isDemo:false},update:{deviceId:did,isDemo:false}})},'transfer',dryRun)
    r.deviceTransfers.updated=res.updated;r.deviceTransfers.errors=res.errors;r.deviceTransfers.error=res.error
  } catch(e){r.deviceTransfers.error=e instanceof Error?e.message:String(e)}
  // Users, AppSettings, MasterItems, SiteAttributes — abbreviated for brevity
  try { const {rows,error}=await fetchSheet('itam','User_Permissions'); if(error)throw new Error(error); r.users.fetched=rows.length;const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.user).data);// `batchWrite` expects `Promise<void>`; an expression-bodied arrow returning the
// upsert's result (`Promise<User>`) does not match, so use a block body.
const res=await batchWrite(mapped,async(d,tx)=>{await tx.user.upsert({where:{email:d.email||''},create:{email:d.email||'',role:d.role||'viewer',active:parseBool(d.active),name:d.name||null,username:d.username||null,passwordHash:d.passwordHash||'',passwordSalt:'legacy',allowedSites:d.allowedSites||'ALL',isDemo:false},update:{name:d.name||null,active:parseBool(d.active),isDemo:false}})},'user',dryRun);r.users.updated=res.updated;r.users.errors=res.errors } catch(e){r.users.error=e instanceof Error?e.message:String(e)}
  try { const {rows,error}=await fetchSheet('itam','App_Settings'); if(error)throw new Error(error); r.appSettings.fetched=rows.length;const res=await batchWrite(rows,async(row,tx)=>{const key=normalizeKey(row.Key||row.key||'');const value=row.Value||row.value||'';if(!key)return;await tx.appSetting.upsert({where:{key},create:{key,value,isDemo:false},update:{value,isDemo:false}})},'appSetting',dryRun);r.appSettings.updated=res.updated;r.appSettings.errors=res.errors } catch(e){r.appSettings.error=e instanceof Error?e.message:String(e)}
  try { const {rows,error}=await fetchSheet('itam','Master_Items'); if(error)throw new Error(error); r.masterItems.fetched=rows.length;const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.masterItem).data);const res=await batchWrite(mapped,async(d,tx)=>{
// MasterItem has NO unique constraint on (category, code) — `category` and
// `code` are plain indexed columns. Prisma's upsert therefore cannot be used
// here (a bogus `category_code` composite key was being passed before, which
// fails both typecheck and runtime validation). Do an explicit findFirst and
// branch to update/create instead.
const category=d.category||'';const code=d.code||'';if(!code)return;
const data={category,code,label:d.label||'',parentRef:d.parentRef||null,displayLabel:d.displayLabel||null,siteCode:d.siteCode||null,active:parseBool(d.active),isDemo:false};
const existing=await tx.masterItem.findFirst({where:{category,code},select:{id:true}});
if(existing)await tx.masterItem.update({where:{id:existing.id},data:{label:data.label,isDemo:false}});
else await tx.masterItem.create({data});
},'masterItem',dryRun);r.masterItems.updated=res.updated;r.masterItems.errors=res.errors } catch(e){r.masterItems.error=e instanceof Error?e.message:String(e)}
  try { const {rows,error}=await fetchSheet('itam','Site_Attributes'); if(error)throw new Error(error); r.siteAttributes.fetched=rows.length;const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.site).data);const res=await batchWrite(mapped,async(d,tx)=>{const code=d.code||d.siteCode||'';if(!code)return;
// SiteAttribute uses the legacy PascalCase column names (SiteCode/SiteName/LineOA/Hotline),
// and SiteCode is the @unique key — so `where`/`create`/`update` must use them too.
await tx.siteAttribute.upsert({where:{SiteCode:code},create:{SiteCode:code,SiteName:d.name||'',LineOA:d.phone||null,Hotline:d.phone||null,isDemo:false},update:{SiteName:d.name||'',isDemo:false}});
// SiteRate has a single current row per site (siteCode/bwRate/colorRate only —
// no isActive/effectiveFrom columns). One row per siteCode, updated in place.
const bw=toFloat(d.bwRate);const cl=toFloat(d.colorRate);if(bw||cl){const ex=await tx.siteRate.findFirst({where:{siteCode:code}});if(ex)await tx.siteRate.update({where:{id:ex.id},data:{bwRate:bw??ex.bwRate,colorRate:cl??ex.colorRate}});else await tx.siteRate.create({data:{siteCode:code,bwRate:bw??0.5,colorRate:cl??2}})}},'site',dryRun);r.siteAttributes.updated=res.updated;r.siteAttributes.errors=res.errors } catch(e){r.siteAttributes.error=e instanceof Error?e.message:String(e)}
  return r
}

// Phase 2: Services (WorkOrders)
async function phase2(dryRun: boolean) {
  const r = { workOrders:{fetched:0,updated:0,errors:0,error:undefined as string|undefined} }
  try { const {rows,error}=await fetchSheet('services','Data'); if(error)throw new Error(error); r.workOrders.fetched=rows.length
    const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.workOrder).data)
    const res=await batchWrite(mapped,async(d,tx)=>{const sm=STATUS_MAPPINGS.workOrder||{};const st=sm[normalizeKey(d.status||'')]||'PENDING';await tx.workOrder.upsert({where:{requestId:d.requestId||d.id||''},create:{requestId:d.requestId||d.id||'',woNumber:d.woNumber||null,legacyJobNo:d.legacyJobNo||null,subject:d.subject||'ไม่ระบุ',status:st as string,building:d.building||null,location:d.location||null,details:d.details||null,// WorkOrder.priority is `String @default("ปกติ")` — required, non-null.
reporterName:d.reporterName||null,tel:d.tel||null,priority:d.priority||'ปกติ',siteCode:d.siteCode||null,isDemo:false},update:{subject:d.subject||'ไม่ระบุ',status:st as string,isDemo:false}})},'wo',dryRun)
    r.workOrders.updated=res.updated;r.workOrders.errors=res.errors;r.workOrders.error=res.error
  } catch(e){r.workOrders.error=e instanceof Error?e.message:String(e)}
  return r
}

// Phase 3: Stock
async function phase3(dryRun: boolean) {
  const r = { stockItems:{fetched:0,updated:0,errors:0,error:undefined as string|undefined}, purchaseOrders:{fetched:0,updated:0,errors:0,error:undefined as string|undefined}, stockIn:{fetched:0,updated:0,errors:0,error:undefined as string|undefined}, stockOut:{fetched:0,updated:0,errors:0,error:undefined as string|undefined} }
  const prodMap = new Map<string,string>()
  try { const {rows,error}=await fetchSheet('stock','Products'); if(error)throw new Error(error); r.stockItems.fetched=rows.length;const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.stockItem).data);const res=await batchWrite(mapped,async(d,tx)=>{const p={productCode:d.productCode||'',productName:d.productName||'',quantity:toInt(d.quantity),minQuantity:toInt(d.minQuantity),unit:d.unit||'ชิ้น',category:d.category||null,unitCost:toFloat(d.unitCost),isDemo:false};const rec=await tx.stockItem.upsert({where:{productCode:p.productCode},create:p,update:clean(p)});prodMap.set(rec.productCode,rec.id)},'stockItem',dryRun);r.stockItems.updated=res.updated;r.stockItems.errors=res.errors } catch(e){r.stockItems.error=e instanceof Error?e.message:String(e)}
  try { const {rows,error}=await fetchSheet('stock','PurchaseOrders'); if(error)throw new Error(error); r.purchaseOrders.fetched=rows.length;const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.purchaseOrder).data);const res=await batchWrite(mapped,async(d,tx)=>{
// PurchaseOrder.poNumber is a plain nullable column (NOT @unique), so it cannot
// be used as the `where` of an upsert. Find by poNumber, then branch.
// `orderDate` is required (non-null String) on the model — default to today
// rather than null, which Prisma would reject at runtime.
const poNumber=d.poNumber||'';if(!poNumber)return;
const orderDate=d.orderDate||new Date().toISOString().slice(0,10);
const existing=await tx.purchaseOrder.findFirst({where:{poNumber},select:{id:true}});
if(existing)await tx.purchaseOrder.update({where:{id:existing.id},data:{supplier:d.supplier||null,status:d.status||'PENDING',isDemo:false}});
else await tx.purchaseOrder.create({data:{poNumber,orderDate,supplier:d.supplier||null,status:d.status||'PENDING',createdBy:d.createdBy||null,isDemo:false}});
},'po',dryRun);r.purchaseOrders.updated=res.updated;r.purchaseOrders.errors=res.errors } catch(e){r.purchaseOrders.error=e instanceof Error?e.message:String(e)}
  try { const {rows,error}=await fetchSheet('stock','StockIn'); if(error)throw new Error(error); r.stockIn.fetched=rows.length;const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.stockIn).data);const res=await batchWrite(mapped,async(d,tx)=>{const sid=prodMap.get(d.stockItemId||'');if(!sid)return;await tx.stockTransaction.create({data:{txnNumber:d.txnNumber||'',type:'IN',stockItemId:sid,txnDate:d.txnDate||new Date().toISOString().slice(0,10),quantity:toInt(d.quantity),cost:toFloat(d.unitCost),vendor:d.vendor||null,performedBy:d.receiver||null,remark:d.remark||null,purchaseOrderNo:d.purchaseOrderId||null,isDemo:false}})},'stockIn',dryRun);r.stockIn.updated=res.updated;r.stockIn.errors=res.errors } catch(e){r.stockIn.error=e instanceof Error?e.message:String(e)}
  try { const {rows,error}=await fetchSheet('stock','StockOut'); if(error)throw new Error(error); r.stockOut.fetched=rows.length;const mapped=rows.map(row=>mapCsvRow(row,FIELD_MAPPINGS.stockOut).data);const res=await batchWrite(mapped,async(d,tx)=>{const sid=prodMap.get(d.stockItemId||'');if(!sid)return;await tx.stockTransaction.create({data:{txnNumber:d.txnNumber||'',type:'OUT',stockItemId:sid,txnDate:d.txnDate||new Date().toISOString().slice(0,10),quantity:toInt(d.quantity),requester:d.requester||null,department:d.department||null,purpose:d.purpose||null,approver:d.approver||null,approvedAt:d.approvedAt||null,workOrderNo:d.workOrderNo||null,isDemo:false}})},'stockOut',dryRun);r.stockOut.updated=res.updated;r.stockOut.errors=res.errors } catch(e){r.stockOut.error=e instanceof Error?e.message:String(e)}
  return r
}

export async function GET(req: NextRequest) {
  const unavailable = await moduleUnavailableResponse('sync')
  if (unavailable) return unavailable


  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) { const authHeader = req.headers.get('authorization'); if (authHeader !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const phase = parseInt(req.nextUrl.searchParams.get('phase') ?? '1', 10)
  const startTime = Date.now()
  let phaseResults: unknown
  try {
    if (phase === 1) phaseResults = await phase1(dryRun)
    else if (phase === 2) phaseResults = await phase2(dryRun)
    else if (phase === 3) phaseResults = await phase3(dryRun)
    else return NextResponse.json({ error: 'Invalid phase (1-3)' }, { status: 400 })
    // `logAudit`'s `detail` is `Record<string, unknown>` — it JSON.stringifies it
// internally, so passing a pre-stringified value double-encodes the audit row.
await logAudit('SYNC','Device','legacy-sync',`Legacy sync phase ${phase} ${dryRun?'(DRY-RUN) ':''}in ${Date.now()-startTime}ms`,{ results: phaseResults }).catch(()=>{})
    return NextResponse.json({ ok: true, phase, dryRun, durationMs: Date.now() - startTime, results: phaseResults })
  } catch (err) { return NextResponse.json({ ok: false, phase, error: err instanceof Error ? err.message : String(err) }, { status: 500 }) }
}
