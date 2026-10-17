'use client'
import {useState,type FormEvent} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {useAuthStore} from '@/store/auth-store'
import {bearerHeaders} from '@/lib/http-headers'

interface Policy{assetTerminology:string;fiscalYearStartMonth:number;defaultCapitalizeThreshold:number|null}
export function GovernmentPolicySettings(){
  const token=useAuthStore(s=>s.token),user=useAuthStore(s=>s.user),cache=useQueryClient()
  const [saving,setSaving]=useState(false),[message,setMessage]=useState('')
  const {data,error,isLoading}=useQuery<Policy>({queryKey:['org-profile'],enabled:!!token,queryFn:async()=>{const r=await fetch('/api/settings/org-profile',{headers:bearerHeaders(token)});const j=await r.json();if(!r.ok)throw new Error(j.error||'โหลดนโยบายไม่สำเร็จ');return j.profile}})
  const canEdit=!!user?.permissions?.includes('SYSTEM_CONFIG')
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const raw=Object.fromEntries(new FormData(event.currentTarget));setSaving(true);setMessage('')
    try{const r=await fetch('/api/settings/org-profile',{method:'PUT',headers:bearerHeaders(token,{'Content-Type':'application/json'}),body:JSON.stringify({assetTerminology:raw.assetTerminology,fiscalYearStartMonth:Number(raw.fiscalYearStartMonth),defaultCapitalizeThreshold:raw.defaultCapitalizeThreshold===''?null:Number(raw.defaultCapitalizeThreshold)})});const j=await r.json();if(!r.ok)throw new Error(j.error||'บันทึกไม่สำเร็จ');await cache.invalidateQueries({queryKey:['org-profile']});setMessage('บันทึกนโยบายเอกสารแล้ว')}catch(e){setMessage(e instanceof Error?e.message:'บันทึกไม่สำเร็จ')}finally{setSaving(false)}
  }
  return <details className="mb-5 rounded-lg border border-slate-200 p-4 dark:border-slate-700"><summary className="cursor-pointer text-sm font-semibold">นโยบายทะเบียนคุมและปีงบประมาณ</summary><p className="my-3 text-xs text-slate-500">ใช้กับเอกสารใหม่ ไม่เปลี่ยนฉบับที่บันทึกไว้ย้อนหลัง วงเงินให้กำหนดตามหลักเกณฑ์ของหน่วยงาน</p>{isLoading?<p className="text-xs">กำลังโหลด…</p>:error?<p role="alert" className="text-xs text-red-600">{error.message}</p>:data&&<form key={JSON.stringify(data)} onSubmit={save}><div className="grid gap-4 sm:grid-cols-3"><label className="text-xs">ชื่อเรียกสินทรัพย์<input className="mt-2 w-full rounded border p-2" name="assetTerminology" defaultValue={data.assetTerminology} maxLength={80} required disabled={!canEdit||saving}/></label><label className="text-xs">เดือนเริ่มปีงบประมาณ<select className="mt-2 w-full rounded border p-2" name="fiscalYearStartMonth" defaultValue={data.fiscalYearStartMonth} disabled={!canEdit||saving}>{['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'].map((m,i)=><option key={m} value={i+1}>{m}</option>)}</select></label><label className="text-xs">เกณฑ์รับรู้สินทรัพย์ (บาท)<input className="mt-2 w-full rounded border p-2" name="defaultCapitalizeThreshold" type="number" min="0" max="1000000000000" step="0.01" defaultValue={data.defaultCapitalizeThreshold??''} placeholder="เว้นว่างหากยังไม่กำหนด" disabled={!canEdit||saving}/></label></div><button className="mt-4 rounded bg-teal-700 px-4 py-2 text-xs text-white disabled:opacity-50" type="submit" disabled={!canEdit||saving}>{saving?'กำลังบันทึก…':'บันทึกนโยบาย'}</button>{!canEdit&&<p className="mt-2 text-xs text-slate-500">ผู้มีสิทธิ์ตั้งค่าระบบเท่านั้นที่แก้ไขได้</p>}</form>}{message&&<p role="status" className="mt-3 text-xs text-teal-700">{message}</p>}</details>
}
