'use client'

import { useEffect,useRef,useState,useSyncExternalStore } from 'react'
import { useAuthStore } from '@/store/auth-store'
import { bearerHeaders } from '@/lib/http-headers'
import { REGISTER_FIELDS,REGISTER_COLUMNS,NUMERIC_COLUMNS,emptyRegisterRow,validateRegister,type GovernmentRegister,type RegisterField,type RegisterColumn } from '@/lib/government/register'
import { governmentPrintHtml,renderGovernmentRegister } from '@/lib/government/register-render'
import './register-workspace.css'

type DeviceOption={id:string;assetCode:string;name:string;site:string}
interface DocumentData{form:GovernmentRegister;revision:number;sourceChanged:boolean;canEdit:boolean;updatedAt:string|null;device:DeviceOption}
const message=(error:unknown)=>error instanceof Error?error.message:'ดำเนินการไม่สำเร็จ'
async function payload(response:Response){const data=await response.json();if(!response.ok)throw new Error(data.error||'ดำเนินการไม่สำเร็จ');return data}
function fitPaper(root:ParentNode){
  let fits=true
  root.querySelectorAll<HTMLElement>('.rf-field b,.rf-cell-value').forEach(el=>{
    let size=el.classList.contains('rf-cell-value')?10:12;el.style.fontSize=`${size}pt`
    while((el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)&&size>8){size-=.25;el.style.fontSize=`${size}pt`}
    if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)fits=false
  })
  return fits
}
const hydrationSubscribe=()=>()=>{}
export function GovernmentRegisterWorkspace(){
  const token=useAuthStore(s=>s.token)
  const ready=useSyncExternalStore(hydrationSubscribe,()=>true,()=>false)
  return <RegisterSession key={ready&&token?token:'anonymous'} token={ready?token:null} ready={ready}/>
}
function RegisterSession({token,ready}:{token:string|null;ready:boolean}){
  const [devices,setDevices]=useState<DeviceOption[]>([]),[query,setQuery]=useState(''),[page,setPage]=useState(1),[more,setMore]=useState(false)
  const [doc,setDoc]=useState<DocumentData|null>(null),[dirty,setDirty]=useState(false),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [brand,setBrand]=useState({appName:'Smart-Asset',appTagline:'ระบบจัดการครุภัณฑ์ภาครัฐ',logoUrl:null as string|null})
  const listEpoch=useRef(0),docEpoch=useRef(0),preview=useRef<HTMLDivElement>(null)
  const tokenRef=useRef(token);tokenRef.current=token
  async function loadList(n=1,term=query){
    const ticket=++listEpoch.current
    try{const data=await payload(await fetch('/api/government/register/devices?'+new URLSearchParams({q:term,page:String(n)}),{headers:bearerHeaders(token)}));if(ticket!==listEpoch.current)return;setError('');setDevices(data.devices);setMore(data.hasMore);setPage(n)}catch(e){if(ticket===listEpoch.current)setError(message(e))}
  }
  async function loadDocument(id:string){
    const ticket=++docEpoch.current;setBusy(true);setError('');setNotice('');setDoc(null)
    try{const data=await payload(await fetch(`/api/government/register/${encodeURIComponent(id)}`,{headers:bearerHeaders(token)}));if(ticket!==docEpoch.current)return;setDoc(data);setDirty(false);setEditing(false)}catch(e){if(ticket===docEpoch.current)setError(message(e))}finally{if(ticket===docEpoch.current)setBusy(false)}
  }
  useEffect(()=>{fetch('/api/public/branding').then(payload).then(v=>setBrand(v.profile)).catch(()=>{})},[])
  useEffect(()=>{
    if(!token)return
    const controller=new AbortController(),ticket=++listEpoch.current
    const id=new URLSearchParams(window.location.search).get('device')
    fetch('/api/government/register/devices?page=1',{headers:bearerHeaders(token),signal:controller.signal})
      .then(payload).then(data=>{
        if(controller.signal.aborted||ticket!==listEpoch.current)return
        setDevices(data.devices);setMore(data.hasMore);setPage(1)
        if(id)void loadDocument(id)
      }).catch(e=>{if(!controller.signal.aborted&&ticket===listEpoch.current)setError(message(e))})
    return()=>{controller.abort();listEpoch.current++;docEpoch.current++}
  },[token])
  useEffect(()=>{if(!preview.current)return;let live=true;document.fonts.ready.then(()=>{if(live&&preview.current)fitPaper(preview.current)});return()=>{live=false}},[doc?.form])
  useEffect(()=>{if(!dirty)return;const listener=(e:BeforeUnloadEvent)=>{e.preventDefault()};window.addEventListener('beforeunload',listener);return()=>window.removeEventListener('beforeunload',listener)},[dirty])
  function select(id:string){if(dirty&&!window.confirm('มีข้อมูลยังไม่บันทึก ต้องการเปลี่ยนรายการหรือไม่?'))return;void loadDocument(id)}
  function updateForm(form:GovernmentRegister){if(!doc)return;setDoc({...doc,form});setDirty(true);setNotice('')}
  function field(key:RegisterField,value:string){if(doc)updateForm({...doc.form,fields:{...doc.form.fields,[key]:value}})}
  function row(index:number,key:RegisterColumn,value:string){if(doc)updateForm({...doc.form,rows:doc.form.rows.map((r,i)=>i===index?{...r,[key]:value}:r)})}
  async function save(){
    if(!doc)return;const session=tokenRef.current;setBusy(true);setError('');setNotice('')
    try{const form=validateRegister(doc.form);const result=await payload(await fetch(`/api/government/register/${encodeURIComponent(doc.device.id)}`,{method:'PUT',headers:bearerHeaders(token,{'Content-Type':'application/json'}),body:JSON.stringify({revision:doc.revision,form})}));if(session!==tokenRef.current)return;await loadDocument(doc.device.id);setNotice(`บันทึกเอกสารฉบับแก้ไข ${result.revision} แล้ว`)}catch(e){if(session===tokenRef.current)setError(message(e))}finally{if(session===tokenRef.current)setBusy(false)}
  }
  async function print(){
    if(!doc)return;setError('')
    let frame:HTMLIFrameElement|null=null
    try{
      const form=validateRegister(doc.form);frame=document.createElement('iframe');frame.className='government-print-frame';frame.title='ทะเบียนคุมทรัพย์สิน';document.body.append(frame)
      const win=frame.contentWindow!,paper=frame.contentDocument!
      await new Promise<void>(resolve=>{frame!.onload=()=>resolve();paper.open();paper.write(governmentPrintHtml(form,window.location.origin));paper.close()})
      await Promise.all([paper.fonts.load('12pt OfficialSarabun'),paper.fonts.load('bold 13pt OfficialSarabun')])
      if(!fitPaper(paper))throw new Error('ข้อความยาวเกินช่องแบบฟอร์ม กรุณาย่อหรือแยกแถวก่อนพิมพ์')
      win.addEventListener('afterprint',()=>frame?.remove(),{once:true});win.focus();win.print()
    }catch(e){frame?.remove();setError(message(e))}
  }
  const logo=brand.logoUrl&&(/^(https:\/\/|\/[^/]|data:image\/(png|jpeg|webp);base64,)/.test(brand.logoUrl))?brand.logoUrl:null
  return <main className="government-workspace">
    <header className="government-header"><a href="/" className="government-brand">{logo?<img src={logo} alt="โลโก้หน่วยงาน"/>:<span className="government-brand-mark">▤</span>}<span><b>{brand.appName}</b><small>{brand.appTagline}</small></span></a><a href="/" className="government-back">← กลับหน้าระบบ</a></header>
    <section className="government-heading"><span>GOVERNMENT ASSET REGISTER</span><h1>ทะเบียนคุมทรัพย์สิน</h1><p>จัดทำเอกสารรายครุภัณฑ์ตามแบบราชการ ตรวจข้อมูลให้ครบก่อนพิมพ์และลงนาม</p></section>
    {!ready?<p role="status">กำลังเตรียมหน้าจอ…</p>:!token?<section className="government-card"><h2>กรุณาเข้าสู่ระบบ</h2><p>เอกสารแสดงเฉพาะครุภัณฑ์ในหน่วยงานและสาขาที่คุณมีสิทธิ์</p><a href="/" className="gov-primary">ไปหน้าเข้าสู่ระบบ</a></section>:<>
      <section className="government-card government-selection"><form onSubmit={e=>{e.preventDefault();void loadList(1)}}><label htmlFor="government-search">ค้นหาชื่อหรือรหัสครุภัณฑ์</label><div className="government-search-row"><input id="government-search" value={query} onChange={e=>setQuery(e.target.value)} maxLength={200} placeholder="พิมพ์ชื่อหรือรหัสครุภัณฑ์"/><button type="submit">ค้นหา</button></div></form><label htmlFor="government-device">เลือกครุภัณฑ์</label><select id="government-device" value={doc?.device.id||''} onChange={e=>e.target.value&&select(e.target.value)} disabled={busy}><option value="">เลือกรายการเพื่อจัดทำเอกสาร…</option>{doc&&!devices.some(d=>d.id===doc.device.id)&&<option value={doc.device.id}>{doc.device.assetCode} · {doc.device.name}</option>}{devices.map(d=><option key={d.id} value={d.id}>{d.assetCode} · {d.name} · {d.site}</option>)}</select><div className="government-pagination"><button disabled={page===1||busy} onClick={()=>void loadList(page-1)}>ก่อนหน้า</button><span>หน้า {page} · ครั้งละ 50 รายการ</span><button disabled={!more||busy} onClick={()=>void loadList(page+1)}>ถัดไป</button></div></section>
      {busy&&!doc&&<p role="status">กำลังโหลดเอกสาร…</p>}
      {doc&&<>
        <section className="government-card government-toolbar"><div><h2>{doc.device.name}</h2><span>{doc.device.assetCode} · {doc.revision?`ฉบับแก้ไข ${doc.revision}`:'เอกสารใหม่จากทะเบียน'}{dirty?' · ยังไม่ได้บันทึก':''}</span></div><div className="government-actions">{doc.canEdit&&<button onClick={()=>setEditing(!editing)} disabled={busy}>{editing?'ซ่อนช่องแก้ไข':'แก้ไขข้อมูลเอกสาร'}</button>}{doc.canEdit&&<button className="gov-primary" onClick={()=>void save()} disabled={!dirty||busy}>บันทึกฉบับแก้ไข</button>}<button className="gov-primary" onClick={()=>void print()} disabled={busy||dirty}>พิมพ์ / บันทึก PDF</button></div><p>พิมพ์ A4 แนวนอน ขนาดจริง 100% และปิดหัว/ท้ายกระดาษของเบราว์เซอร์ · เอกสารราชการไม่มีโลโก้และเครดิตทีมแทรก</p></section>
        {doc.sourceChanged&&<p className="government-warning" role="status">ข้อมูลทะเบียนเปลี่ยนหลังบันทึกเอกสารนี้ โปรดตรวจรหัส ชื่อ ที่ตั้ง และมูลค่าก่อนจัดทำฉบับใหม่ เอกสารที่บันทึกไว้จะไม่ถูกทับอัตโนมัติ</p>}
        {editing&&doc.canEdit&&<section className="government-card government-editor"><h2>ข้อมูลหัวเอกสาร</h2><p>ช่องที่ไม่มีหลักฐานให้เว้นว่าง ข้อมูลนี้เก็บเป็นฉบับเอกสารแยกจากทะเบียนต้นทาง</p><div className="government-fields">{REGISTER_FIELDS.map(([key,label])=><label key={key}>{label}<input value={doc.form.fields[key]} maxLength={500} onChange={e=>field(key,e.target.value)} disabled={busy}/></label>)}</div><h2>รายการในตาราง</h2>{doc.form.rows.map((r,i)=><fieldset key={i}><legend>แถวที่ {i+1}</legend><div className="government-fields">{REGISTER_COLUMNS.map(([key,label])=><label key={key}>{label}<input data-row={i} data-column={key} type={NUMERIC_COLUMNS.includes(key)?'number':'text'} min={NUMERIC_COLUMNS.includes(key)?'0':undefined} step={NUMERIC_COLUMNS.includes(key)?'0.0001':undefined} value={r[key]} maxLength={500} onChange={e=>row(i,key,e.target.value)} disabled={busy}/></label>)}</div><button disabled={doc.form.rows.length===1||busy} onClick={()=>updateForm({...doc.form,rows:doc.form.rows.filter((_,n)=>n!==i)})}>ลบแถวนี้</button></fieldset>)}<button disabled={doc.form.rows.length>=12||busy} onClick={()=>updateForm({...doc.form,rows:[...doc.form.rows,emptyRegisterRow()]})}>＋ เพิ่มแถวรายการ</button><h2>ค่าบรรทัดสรุปท้ายตาราง</h2><p>กรอกตามหลักฐาน ไม่บวกค่าเสื่อมสะสมหรือมูลค่าสุทธิข้ามปีอัตโนมัติ</p><div className="government-fields">{(['annual','accumulated','net'] as const).map(key=><label key={key}>{REGISTER_COLUMNS.find(c=>c[0]===key)![1]}<input type="number" min="0" step="0.0001" value={doc.form.summary[key]} onChange={e=>updateForm({...doc.form,summary:{...doc.form.summary,[key]:e.target.value}})} disabled={busy}/></label>)}</div><button className="gov-primary" disabled={!dirty||busy} onClick={()=>void save()}>บันทึกฉบับแก้ไข</button></section>}
        <section className="government-preview" aria-label="ตัวอย่างเอกสารก่อนพิมพ์"><div ref={preview} dangerouslySetInnerHTML={{__html:renderGovernmentRegister(doc.form)}}/></section>
      </>}
    </>}
    {error&&<p className="government-error" role="alert">{error}</p>}{notice&&<p className="government-success" role="status">{notice}</p>}
    <footer className="government-footer"><span>{brand.appName} · จัดการครุภัณฑ์และเอกสารราชการ</span><b>POWER BY PNG TEAM</b></footer>
  </main>
}
