const defaultAssets = [
  { id: 'a1', name: 'ตู้เหล็กเก็บเอกสาร 4 ลิ้นชัก', detail: 'ขนาดมาตรฐาน · เหล็กพ่นสี', code: '7110-002-0001', group: 'เครื่องตกแต่งสำนักงาน', location: 'งานสารบรรณ · ชั้น 2', date: '12 ต.ค. 2569', status: 'พร้อมใช้', icon: '▤' },
  { id: 'a2', name: 'ตู้เหล็กเก็บเอกสาร 2 ลิ้นชัก', detail: 'ขนาดมาตรฐาน · เหล็กพ่นสี', code: '7110-002-0002', group: 'เครื่องตกแต่งสำนักงาน', location: 'กองคลัง · ชั้น 1', date: '10 ต.ค. 2569', status: 'สำรวจแล้ว', icon: '▤' },
  { id: 'a3', name: 'โต๊ะทำงานเหล็ก', detail: 'ขนาด 120 × 60 ซม.', code: '7110-721-0001', group: 'เครื่องตกแต่งสำนักงาน', location: 'งานพัสดุ · ชั้น 3', date: '8 ต.ค. 2569', status: 'รอตรวจสอบ', icon: '▱' },
  { id: 'a4', name: 'เก้าอี้ทำงานมีพนักพิง', detail: 'ปรับระดับได้ · มีล้อเลื่อน', code: '7110-627-0001', group: 'เครื่องตกแต่งสำนักงาน', location: 'กองแผนงาน · ชั้น 2', date: '7 ต.ค. 2569', status: 'พร้อมใช้', icon: '♧' },
  { id: 'a5', name: 'เครื่องถ่ายเอกสารระบบหมึกผง', detail: 'ความเร็ว 10 แผ่นต่อนาที', code: '7430-003-0001', group: 'เครื่องจักรสำนักงาน', location: 'ศูนย์บริการ · ชั้น 1', date: '5 ต.ค. 2569', status: 'รอตรวจสอบ', icon: '▣' }
];
const sampleSheet = [
  { name: 'ตู้เก็บเอกสาร 4 ลิ้นชัก', detail: 'ตัวอย่างตามคู่มือ · เครื่องตกแต่งสำนักงาน', code: '7110-002-0001' },
  { name: 'โต๊ะพิมพ์ดีดทำด้วยเหล็ก', detail: 'ตัวอย่างรายการจากแบบใบสำรวจพัสดุ', code: '7110-712-0001' },
  { name: 'เครื่องพิมพ์ดีดไฟฟ้า 2 ภาษา', detail: 'ตัวอย่างใน Working Sheet · หมวดเครื่องจักรสำนักงาน', code: '7430-001-0001' }
];
const depreciationRows = [
  { no: '1', category: 'อาคารถาวร', years: '25', rate: '4' },
  { no: '2.1', category: 'อาคารชั่วคราว / โรงเรือน (โรงเก็บรถ ที่พักชั่วคราว เรือนเพาะชำ และอื่น ๆ ที่รื้อถอนได้)', years: '10', rate: '10' },
  { no: '2.2.1', category: 'สิ่งก่อสร้างอื่นที่ใช้คอนกรีตเสริมเหล็กหรือโครงเหล็กเป็นส่วนประกอบหลัก', years: '15', rate: '6.5' },
  { no: '2.2.2', category: 'สิ่งก่อสร้างอื่นที่ใช้ไม้หรือวัสดุอื่นเป็นส่วนประกอบหลัก', years: '5', rate: '20' },
  { no: '2.3', category: 'งานต่อเติมอาคาร (ส่งหนังสือหารือเป็นรายกรณี)', years: 'พิจารณาเฉพาะกรณี', rate: 'พิจารณาเฉพาะกรณี' },
  { no: '2.4.1', category: 'งานปรับปรุง: ไม้ / ไม้อัด', years: '5', rate: '20' },
  { no: '2.4.2', category: 'งานปรับปรุง: แผ่นยิปซั่ม / ลามิเนต / วัสดุคงทนอื่น ๆ', years: '10', rate: '10' },
  { no: '3', category: 'ครุภัณฑ์สำนักงาน', years: '3', rate: '33' },
  { no: '3 (กรณีเปลี่ยนแทน)', category: 'ลิฟต์ (บันทึกเป็นสินทรัพย์ย่อย)', years: '12', rate: '8' },
  { no: '4', category: 'ครุภัณฑ์ยานพาหนะและขนส่ง', years: '5', rate: '20' },
  { no: '5.1', category: 'ครุภัณฑ์ไฟฟ้าและวิทยุ', years: '5', rate: '20' },
  { no: '5.2', category: 'เครื่องกำเนิดไฟฟ้า', years: '15', rate: '6.5' },
  { no: '6', category: 'ครุภัณฑ์โฆษณาและเผยแพร่', years: '5', rate: '20' },
  { no: '7.1', category: 'ครุภัณฑ์การเกษตร: เครื่องมือและอุปกรณ์', years: '2', rate: '50' },
  { no: '7.2', category: 'ครุภัณฑ์การเกษตร: เครื่องจักรกล', years: '5', rate: '20' },
  { no: '8.1', category: 'ครุภัณฑ์โรงงาน: เครื่องมือและอุปกรณ์', years: '2', rate: '50' },
  { no: '8.2', category: 'ครุภัณฑ์โรงงาน: เครื่องจักรกล', years: '5', rate: '20' },
  { no: '9.1', category: 'ครุภัณฑ์ก่อสร้าง: เครื่องมือและอุปกรณ์', years: '2', rate: '50' },
  { no: '9.2', category: 'ครุภัณฑ์ก่อสร้าง: เครื่องจักรกล', years: '5', rate: '20' },
  { no: '10', category: 'ครุภัณฑ์สำรวจ', years: '8', rate: '12.5' },
  { no: '11', category: 'ครุภัณฑ์วิทยาศาสตร์และการแพทย์', years: '5', rate: '20' },
  { no: '12', category: 'ครุภัณฑ์คอมพิวเตอร์', years: '3', rate: '33' },
  { no: '13', category: 'ครุภัณฑ์การศึกษา', years: '3', rate: '33' },
  { no: '14', category: 'ครุภัณฑ์งานบ้านงานครัว', years: '3', rate: '33' },
  { no: '15', category: 'ครุภัณฑ์กีฬา / กายภาพ', years: '5', rate: '20' },
  { no: '16', category: 'ครุภัณฑ์ดนตรี / นาฏศิลป์', years: '5', rate: '20' },
  { no: '17', category: 'ครุภัณฑ์อาวุธ', years: '10', rate: '10' },
  { no: '18', category: 'ครุภัณฑ์สนาม', years: '2', rate: '50' },
  { no: '19', category: 'ครุภัณฑ์อื่น', years: '5', rate: '20' },
  { no: '20', category: 'สินทรัพย์ไม่มีตัวตน', years: '3', rate: '33' }
];
const archiveCategories = [
  { name: 'ครุภัณฑ์งานบ้านงานครัว', source: 'ครุภัณฑ์งานบ้านงานครัว.xls' },
  { name: 'ครุภัณฑ์ดนตรีนาฏศิลป์', source: 'ครุภัณฑ์ดนตรีนาฏศิลป์.xls' },
  { name: 'ครุภัณฑ์ไฟฟ้าและวิทยุ (เครื่องกำเนิดไฟฟ้า)', source: 'ครุภัณฑ์ไฟฟ้าและวิทยุ (เครื่องกำเนิดไฟฟ้า).xls' },
  { name: 'ครุภัณฑ์ไฟฟ้าและวิทยุ', source: 'ครุภัณฑ์ไฟฟ้าและวิทยุ.xls' },
  { name: 'ครุภัณฑ์ยานพาหนะและขนส่ง', source: 'ครุภัณฑ์ยานพาหนะและขนส่ง.xls' },
  { name: 'ครุภัณฑ์โรงงาน', source: 'ครุภัณฑ์โรงงาน.xls' },
  { name: 'ครุภัณฑ์วิทยาศาสตร์และการแพทย์', source: 'ครุภัณฑ์วิทยาศาสตร์และการแพทย์.xls' },
  { name: 'ครุภัณฑ์สำนักงาน (ลิฟต์)', source: 'ครุภัณฑ์สำนักงาน (ลิฟต์).xls' },
  { name: 'ครุภัณฑ์สำนักงาน', source: 'ครุภัณฑ์สำนักงาน.xls' },
  { name: 'สินทรัพย์ software', source: 'สินทรัพย์ software.xlsx' },
  { name: 'อาคารถาวร', source: 'อาคารถาวร.xls' },
  { name: 'อาคารประโยชน์อื่นๆ', source: 'อาคารประโยชน์อื่นๆ.xls' },
  { name: 'อาคารพักอาศัย', source: 'อาคารพักอาศัย.xls' },
  { name: 'อาคารสำนักงาน', source: 'อาคารสำนักงาน.xls' },
  { name: 'ครุภัณฑ์ก่อสร้าง', source: 'ครุภัณฑ์ก่อสร้าง.xls' },
  { name: 'ครุภัณฑ์การศึกษา', source: 'ครุภัณฑ์การศึกษา.xls' },
  { name: 'ครุภัณฑ์กีฬาและกายภาพ', source: 'ครุภัณฑ์กีฬาและกายภาพ.xls' },
  { name: 'ครุภัณฑ์คอมพิวเตอร์', source: 'ครุภัณฑ์คอมพิวเตอร์.xls' },
  { name: 'ครุภัณฑ์โฆษณาและเผยแพร่', source: 'ครุภัณฑ์โฆษณาและเผยแพร่.xls' }
];
const codeCatalog = [
  { code: '7110', title: 'เครื่องตกแต่งสำนักงาน', desc: 'กลุ่มเครื่องตกแต่ง (71) · ประเภทเครื่องตกแต่งสำนักงาน', items: [{ name: 'ตู้เก็บเอกสารแบบลิ้นชัก', code: '7110-002' }, { name: 'โต๊ะพิมพ์ดีด · เลขรายการในบัญชีตัวอย่าง', code: '0712' }, { name: 'เก้าอี้ทำงานมีพนักพิง · เลขรายการในบัญชีตัวอย่าง', code: '0627' }, { name: 'โต๊ะทำงานทำด้วยเหล็ก · เลขรายการในบัญชีตัวอย่าง', code: '0721' }] },
  { code: '7430', title: 'เครื่องพิมพ์ดีดและกรรมวิธีบันทึกข้อมูล', desc: 'กลุ่มเครื่องจักรและอุปกรณ์สำนักงาน', items: [{ name: 'เครื่องพิมพ์ดีดไฟฟ้า 2 ภาษา', code: '7430-001' }, { name: 'เครื่องถ่ายเอกสารระบบหมึกผง', code: '7430-003' }] },
  { code: '7105', title: 'เครื่องตกแต่งภายใน / ที่พัก', desc: 'กลุ่มเครื่องตกแต่ง (71) · ประเภทที่ใช้ในสำนักงานและที่พัก', items: [{ name: 'โต๊ะรับแขก / โต๊ะกลางชุดรับแขก', code: '7105-0603' }, { name: 'โต๊ะรับประทานอาหาร', code: '7105-0604' }, { name: 'เก้าอี้เหล็กชนิดบุนวม', code: '7105-0502' }] }
];
const defaultRepairs = [
  { id: 'r1', number: 'SR-2569-001', asset: 'เครื่องถ่ายเอกสารระบบหมึกผง', issue: 'กระดาษติดภายในเครื่องบ่อย', location: 'ศูนย์บริการ · ชั้น 1', urgency: 'เร่งด่วน', reporter: 'เจ้าหน้าที่ศูนย์บริการ', date: '14 ต.ค. 2569', status: 'กำลังซ่อม' },
  { id: 'r2', number: 'SR-2569-002', asset: 'เครื่องปรับอากาศ ห้องประชุม 2', issue: 'เครื่องไม่เย็นและมีน้ำหยด', location: 'อาคารสำนักงาน · ชั้น 2', urgency: 'เร่งด่วนมาก', reporter: 'งานอาคารสถานที่', date: '13 ต.ค. 2569', status: 'รับแจ้งแล้ว' },
  { id: 'r3', number: 'SR-2569-003', asset: 'ตู้เหล็กเก็บเอกสาร 4 ลิ้นชัก', issue: 'รางลิ้นชักติดขัด เปิด-ปิดไม่สะดวก', location: 'งานสารบรรณ · ชั้น 2', urgency: 'ปกติ', reporter: 'งานสารบรรณ', date: '10 ต.ค. 2569', status: 'ซ่อมเสร็จ' }
];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const ROLE_REQUESTER='ผู้แจ้ง', ROLE_OFFICER='เจ้าหน้าที่พัสดุ', ROLE_APPROVER='ผู้อนุมัติ', ROLE_TECHNICIAN='ช่าง';
let assets=[], approvalAssets=[], sheet=[], repairs=[], appConfig={approvalThreshold:5000};
let inventoryRows=null, inventoryTotal=0, inventoryOffset=0, inventoryLimit=50;
let fsnRows=null, fsnTotal=0, fsnOffset=0, fsnLimit=50, liveCategories=null, liveDepreciationRows=null;
let inventorySearchTimer=null, fsnSearchTimer=null, inventoryRequest=0;
let currentRole=localStorage.getItem('govAssetPrototype.role') || ROLE_REQUESTER;
let activeTicketId=null;
const assetApprovalsInFlight=new Set();
let fontScale=Number(localStorage.getItem('govAssetPrototype.fontScale')) || 1;

async function api(path, options={}) {
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const payload=await response.json().catch(()=>({error:'ไม่สามารถอ่านผลจาก server ได้'}));
  if(!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  if(options.method&&options.method!=='GET')document.dispatchEvent(new CustomEvent('govasset:data-changed',{detail:{path}}));
  return payload;
}
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),3800); }
function showError(error) { const message=error?.message || 'เชื่อมต่อ SQLite ไม่สำเร็จ'; toast(message); const badge=$('#dbIndicator'); if(badge){badge.textContent='เชื่อมต่อระบบไม่ได้';badge.classList.add('offline');} }
function setConnected() { const badge=$('#dbIndicator'); if(badge){badge.innerHTML='<i></i> ระบบพร้อมใช้งาน';badge.classList.remove('offline');} }
function populateAssetCategoryOptions(rows) { const select=$('#assetCategoryId'); if(!select)return; const current=select.value; const categories=(Array.isArray(rows)?rows:[]).filter(item=>item&&item.isActive!==false&&Number.isInteger(Number(item.id))&&Number(item.id)>0); select.innerHTML=`<option value="">${categories.length?'เลือกหมวดครุภัณฑ์...':'ไม่พบหมวดที่ใช้งาน'}</option>`+categories.map(item=>`<option value="${Number(item.id)}" title="${esc(item.source||'')}">${esc(item.name)}</option>`).join(''); if(categories.some(item=>String(item.id)===current))select.value=current; select.disabled=categories.length===0; }
async function refreshData() {
  const request=++inventoryRequest;
  clearTimeout(inventorySearchTimer);
  const inventoryParams=new URLSearchParams({q:($('#assetSearch')?.value||'').trim(),status:$('#statusFilter')?.value||'all',limit:String(inventoryLimit),offset:'0'});
  try {
    const [assetData,surveyData,ticketData,config,inventoryData,fsnData,categoryData,depreciationData,pendingData]=await Promise.all([api('/api/assets'),api('/api/survey'),api('/api/tickets'),api('/api/config'),api(`/api/inventory?${inventoryParams}`),api(`/api/catalog/fsn?limit=${fsnLimit}`),api('/api/catalog/categories'),api('/api/catalog/depreciation'),api('/api/assets/pending')]);
    assets=assetData; approvalAssets=pendingData; sheet=surveyData; repairs=ticketData; appConfig=config;
    if(request===inventoryRequest){inventoryRows=inventoryData.items; inventoryTotal=inventoryData.total; inventoryOffset=inventoryData.offset;}
    fsnRows=fsnData.items; fsnTotal=fsnData.total; fsnOffset=fsnData.offset;
    liveCategories=categoryData.length?categoryData:null;populateAssetCategoryOptions(categoryData);
    liveDepreciationRows=depreciationData.items?.length?depreciationData.items.map(row=>({no:row.ruleNo,category:row.category,years:row.years==null?'พิจารณาเฉพาะกรณี':String(row.years),rate:row.annualRate==null?'พิจารณาเฉพาะกรณี':String(row.annualRate),note:row.note||''})):null;
    setConnected();
    const overview=await api('/api/overview'); appConfig.overview=overview;
    setText('#openRepairCount',overview.activeRepairs);setText('#actualRepairCost',Number(overview.actualRepairCost).toLocaleString('th-TH'));setText('#activeCategoryCount',overview.activeCategories);
    renderAssets(); renderRepairs(); renderSheet(); renderCatalog(); renderDepreciation(); renderApprovals(); updateCode();
    await window.govAssetMasterData?.load();
    const threshold=$('#thresholdAmount'); if(threshold) threshold.textContent=Number(config.approvalThreshold).toLocaleString('th-TH');
    return true;
  } catch(error) { showError(error); return false; }
}
const statusClass = status => ['พร้อมใช้','ทะเบียนแล้ว','ปิดงาน'].includes(status) ? 'green' : ['รอตรวจสอบ','รออนุมัติ','รับแจ้งใหม่','รอผู้แจ้งยืนยัน'].includes(status) ? 'amber' : 'blue';
function badge(status) { return `<span class="badge ${statusClass(status)}">${esc(status)}</span>`; }
function assetNameCell(item) { return `<div class="item-cell"><span class="item-thumb" aria-hidden="true">${esc(item.icon||'▤')}</span><div><div class="item-name">${esc(item.name)}</div><div class="item-meta">${esc(item.detail||'รายการตัวอย่าง')}</div></div></div>`; }
function renderAssets() {
  const recent=$('#recentRows'); if(recent) recent.innerHTML=assets.slice(0,4).map(item=>`<tr><td>${assetNameCell(item)}</td><td><span class="code-text">${esc(item.code)}</span></td><td>${esc(item.group)}</td><td>${badge(item.status)}</td></tr>`).join('');
  const search=($('#assetSearch')?.value||'').trim().toLowerCase(), status=$('#statusFilter')?.value||'all';
  const filtered=inventoryRows!==null?inventoryRows:assets.filter(item=>`${item.name} ${item.code} ${item.group} ${item.location} ${item.status}`.toLowerCase().includes(search)&&(status==='all'||item.status===status));
  const rows=$('#assetRows'); if(rows) rows.innerHTML=filtered.length?filtered.map(item=>`<tr><td>${assetNameCell(item)}</td><td><span class="code-text">${esc(item.code)}</span></td><td>${esc(item.group)}</td><td>${esc(item.location)}</td><td>${esc(fmtDate(item.date))}</td><td>${badge(item.status)}</td><td><button class="button outline mini-action" data-smart-id="${item.id}">รายละเอียด / QR</button> <button class="button outline mini-action" type="button" data-register-id="${item.id}">ใบทะเบียนคุม</button> ${item.status==='รออนุมัติ'?(currentRole===ROLE_APPROVER?`<button class="button outline mini-action" data-asset-action="approve" data-asset-id="${item.id}">อนุมัติ</button> <button class="button outline mini-action reject" data-asset-action="reject" data-asset-id="${item.id}">ไม่อนุมัติ</button>`:'<span class="item-meta">รอผู้อนุมัติ</span>'):'—'}</td></tr>`).join(''):'<tr><td colspan="7" class="empty-cell">ไม่พบรายการที่ตรงกับคำค้น</td></tr>';
  const shownStart=inventoryTotal?inventoryOffset+1:1, shownEnd=Math.min(inventoryOffset+filtered.length,inventoryTotal||filtered.length);
  const result=$('#resultCount'); if(result) result.textContent=`แสดง ${filtered.length?shownStart:0}–${shownEnd} จาก ${inventoryRows!==null?inventoryTotal:assets.length} รายการ`;
  const total=$('#totalCount'); if(total) total.textContent=String(appConfig.overview?.assets ?? inventoryTotal ?? assets.length);
  const pending=$('#pendingCount'); if(pending) pending.textContent=String(appConfig.overview?.pendingAssets ?? assets.filter(item=>item.status==='รออนุมัติ'||item.status==='รอตรวจสอบ').length);
  $$('[data-asset-action]',rows||document).forEach(button=>button.addEventListener('click',()=>handleAssetApproval(button.dataset.assetId,button.dataset.assetAction)));
  const panel=rows?.closest('.listing-panel'); if(panel){let pager=$('#inventoryPager');if(!pager){pager=document.createElement('div');pager.id='inventoryPager';pager.className='inventory-pager';panel.append(pager);}const page=Math.floor(inventoryOffset/inventoryLimit)+1,pages=Math.max(1,Math.ceil((inventoryRows!==null?inventoryTotal:filtered.length)/inventoryLimit));pager.innerHTML=`<button id="inventoryPrev" ${inventoryOffset<=0?'disabled':''}>ก่อนหน้า</button><span>หน้า ${page} / ${pages} · ${inventoryTotal.toLocaleString('th-TH')} รายการ</span><button id="inventoryNext" ${inventoryOffset+inventoryLimit>=inventoryTotal?'disabled':''}>ถัดไป</button>`;$('#inventoryPrev')?.addEventListener('click',()=>loadInventory(Math.max(0,inventoryOffset-inventoryLimit)));$('#inventoryNext')?.addEventListener('click',()=>loadInventory(inventoryOffset+inventoryLimit));}
}
async function loadInventory(offset=0){
  const request=++inventoryRequest;
  const params=new URLSearchParams({q:($('#assetSearch')?.value||'').trim(),status:$('#statusFilter')?.value||'all',limit:String(inventoryLimit),offset:String(Math.max(0,offset))});
  try{const result=await api(`/api/inventory?${params}`);if(request!==inventoryRequest)return;inventoryRows=result.items;inventoryTotal=result.total;inventoryOffset=result.offset;renderAssets();}catch(error){if(request===inventoryRequest)showError(error);}
}
function fmtDate(value) { if(!value) return '—'; const date=new Date(value); return Number.isNaN(date.getTime())?String(value):date.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}); }
function repairStatusClass(status) { return ['ปิดงาน','ซ่อมเสร็จ'].includes(status)?'green':['รออนุมัติ','รออนุมัติค่าใช้จ่ายจริง','รับแจ้งใหม่','รอผู้แจ้งยืนยัน','รอมอบหมาย','รอแก้ไขค่าใช้จ่าย'].includes(status)?'amber':status==='ไม่อนุมัติ'?'red':status==='รออะไหล่'?'violet':'blue'; }
function repairBadge(status) { return `<span class="badge ${repairStatusClass(status)}">${esc(status)}</span>`; }
function urgencyBadge(urgency) { const type=urgency==='เร่งด่วนมาก'?'critical':urgency==='เร่งด่วน'?'high':'normal'; return `<span class="urgency ${type}">${esc(urgency)}</span>`; }
function renderRepairs() {
  const search=($('#repairSearch')?.value||'').trim().toLowerCase(), status=$('#repairStatusFilter')?.value||'all';
  const filtered=repairs.filter(item=>`${item.ticketNo} ${item.assetCode} ${item.assetName} ${item.issue} ${item.location} ${item.requester} ${item.assignedTo} ${item.status}`.toLowerCase().includes(search)&&(status==='all'||item.status===status));
  const rowMarkup=item=>`<tr><td><button class="link-button ticket-number" data-ticket-detail="${item.id}">${esc(item.ticketNo)}</button><div class="item-meta">${esc(fmtDate(item.createdAt))}</div></td><td><div class="item-name">${esc(item.assetName)}</div><div class="item-meta">${esc(item.issue)}</div></td><td>${esc(item.location)}</td><td>${urgencyBadge(item.urgency)}</td><td>${repairBadge(item.status)}</td><td>${esc(item.assignedTo||'—')}</td><td><button class="button outline mini-action" data-ticket-detail="${item.id}">ติดตาม</button> <button class="button outline mini-action" data-ticket-print="${item.id}" aria-label="พิมพ์ใบแจ้งซ่อม ${esc(item.ticketNo)}">พิมพ์</button></td></tr>`;
  const body=$('#repairRows'); if(body) body.innerHTML=filtered.length?filtered.map(rowMarkup).join(''):'<tr><td colspan="7" class="empty-cell">ไม่พบ Ticket ที่ตรงกับคำค้น</td></tr>';
  const dash=$('#dashboardRepairRows'); if(dash) dash.innerHTML=repairs.slice(0,3).map(item=>`<tr><td><button class="link-button ticket-number" data-ticket-detail="${item.id}">${esc(item.ticketNo)}</button></td><td><div class="item-name">${esc(item.assetName)}</div><div class="item-meta">${esc(item.issue)}</div></td><td>${urgencyBadge(item.urgency)}</td><td>${repairBadge(item.status)}</td></tr>`).join('');
  const count=$('#repairResultCount'); if(count) count.textContent=`แสดง ${filtered.length} จาก ${repairs.length} Ticket`;
  setText('#repairTotal',repairs.length); setText('#repairWaiting',repairs.filter(x=>x.status==='รับแจ้งใหม่').length); setText('#repairPendingApproval',repairs.filter(x=>['รออนุมัติ','รออนุมัติค่าใช้จ่ายจริง'].includes(x.status)).length); setText('#repairActive',repairs.filter(x=>['กำลังซ่อม','รออะไหล่','รอผู้แจ้งยืนยัน','รอมอบหมาย'].includes(x.status)).length);
  [$('#repairRows'),$('#dashboardRepairRows')].filter(Boolean).forEach(scope=>$$('[data-ticket-detail]',scope).forEach(button=>button.addEventListener('click',()=>openTicket(Number(button.dataset.ticketDetail)))));
  $$('[data-ticket-print]',body||document).forEach(button=>button.addEventListener('click',()=>printTicket(Number(button.dataset.ticketPrint))));
}
function setText(id,value) { const el=$(id); if(el) el.textContent=String(value); }
function renderApprovals() {
  const pendingTickets=repairs.filter(item=>['รออนุมัติ','รออนุมัติค่าใช้จ่ายจริง'].includes(item.status)), pendingAssets=approvalAssets;
  setText('#approvalTicketCount',`${pendingTickets.length} รายการ`); setText('#approvalAssetCount',`${pendingAssets.length} รายการ`);
  const t=$('#approvalTicketRows'); if(t) t.innerHTML=pendingTickets.length?pendingTickets.map(item=>`<tr><td><button class="link-button ticket-number" data-ticket-detail="${item.id}">${esc(item.ticketNo)}</button></td><td>${esc(item.assetName)}<div class="item-meta">${esc(item.status)} · ${esc(item.approvalReason||'ตรวจยอดค่าใช้จ่ายจริง')}</div></td><td>${Number(item.status==='รออนุมัติค่าใช้จ่ายจริง'?item.actualCost:item.estimateCost||0).toLocaleString('th-TH')} บาท</td><td><button class="button outline mini-action" data-ticket-detail="${item.id}">ตรวจสอบ / อนุมัติ</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty-cell">ไม่มี Ticket รออนุมัติ</td></tr>';
  const a=$('#approvalAssetRows'); if(a) a.innerHTML=pendingAssets.length?pendingAssets.map(item=>`<tr><td><span class="code-text">${esc(item.code)}</span></td><td>${esc(item.name)}<div class="item-meta">${esc(item.location)}</div></td><td>${esc(item.createdBy||'—')}</td><td>${currentRole===ROLE_APPROVER?`<button class="button outline mini-action" data-asset-action="approve" data-asset-id="${item.id}">อนุมัติ</button> <button class="button outline mini-action reject" data-asset-action="reject" data-asset-id="${item.id}">ไม่อนุมัติ</button>`:'<span class="item-meta">เลือกบทบาทผู้อนุมัติเพื่อจัดการ</span>'}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-cell">ไม่มีครุภัณฑ์ใหม่รออนุมัติ</td></tr>';
  $$('[data-ticket-detail]',document.querySelector('#view-approvals')||document).forEach(button=>button.addEventListener('click',()=>openTicket(Number(button.dataset.ticketDetail))));
  $$('[data-asset-action]',document.querySelector('#view-approvals')||document).forEach(button=>button.addEventListener('click',()=>handleAssetApproval(button.dataset.assetId,button.dataset.assetAction)));
}
function renderSheet() { const list=$('#surveyList'); if(!list) return; list.innerHTML=sheet.map((item,index)=>`<div class="survey-row"><span class="survey-no">${String(index+1).padStart(2,'0')}</span><div><b>${esc(item.name)}</b><small>${esc(item.detail||'รายการตัวอย่างที่เพิ่มในใบสำรวจ')}</small></div><span class="survey-code">${esc(item.code)}</span></div>`).join(''); const count=$('#surveyItemCount'); if(count) count.textContent=`${sheet.length} รายการ`; }
function renderDepreciation() { const source=liveDepreciationRows||depreciationRows,search=($('#depreciationSearch')?.value||'').trim().toLowerCase(); const filtered=source.filter(row=>`${row.no} ${row.category} ${row.years} ${row.rate} ${row.note||''}`.toLowerCase().includes(search)); const body=$('#depreciationRows'); if(!body)return; body.innerHTML=filtered.length?filtered.map(row=>`<tr><td class="depr-no">${esc(row.no)}</td><td class="depr-category">${esc(row.category)}</td><td>${esc(row.years==='พิจารณาเฉพาะกรณี'?row.years:`${row.years} ปี`)}</td><td>${esc(row.rate==='พิจารณาเฉพาะกรณี'?row.rate:`${row.rate}%`)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-cell">ไม่พบประเภททรัพย์สินที่ค้นหา</td></tr>'; const count=$('#depreciationCount'); if(count)count.textContent=`แสดง ${filtered.length} จาก ${source.length} รายการ · หลักเกณฑ์ตามเอกสารที่นำเข้า`; }
function renderCatalog() { const search=($('#codeSearch')?.value||'').trim().toLowerCase(); const categorySource=liveCategories||archiveCategories; const categories=categorySource.filter(item=>`${item.name} ${item.source||''}`.toLowerCase().includes(search)); const list=$('#archiveCategoryList'); if(list&&!window.govAssetMasterData)list.innerHTML=categories.length?categories.map(item=>`<div class="archive-category"><span class="category-mark" aria-hidden="true">▤</span><div><b>${esc(item.name)}</b><small>ไฟล์ต้นทาง: ${esc(item.source||'ข้อมูลนำเข้า')}</small></div></div>`).join(''):'<div class="category-empty">ไม่พบหมวดหมู่จากชุดข้อมูลแนบ</div>'; const tag=$('.archive-category-panel .sheet-count'); if(tag&&!window.govAssetMasterData)tag.textContent=`${categories.length} หมวด`;
  window.govAssetMasterData?.renderCategories();
  const cards=$('#codeCards'); if(!cards)return;
  if(fsnRows!==null){cards.innerHTML=fsnRows.length?fsnRows.map(item=>{const code=item.fullCode||[item.categoryCode,item.typeCode].filter(Boolean).join('-')||'—';return `<article class="panel code-card"><div class="code-card-top"><h3>${esc(item.name||'รายการไม่ระบุชื่อ')}</h3><span class="fsn-tag">${esc(code)}</span></div><p>${esc(item.groupTitle||`กลุ่มรหัส ${item.categoryCode||'—'}`)}</p><div class="sample-list"><div class="sample-row"><span>${esc(item.sourceTitle||'คู่มือออกเลขครุภัณฑ์')}</span><code>${item.page?`หน้า PDF ${esc(item.page)}`:'หน่วยงานกำหนด'}</code></div></div>${item.reference?`<p>${esc(item.reference)}</p>`:''}${/^[0-9]{4}-[0-9]{3}-[0-9]{4}$/.test(item.fullCode||'')?`<button type="button" class="button outline" data-adopt-fsn="${esc(item.fullCode)}" data-fsn-id="${item.id}" data-fsn-name="${esc(item.name)}" data-fsn-kind="${esc(item.sourceKind)}">กำหนดใช้รหัสนี้กับหมวด</button>`:'<p class="field-hint">รหัสอ้างอิงตามต้นฉบับ ยังไม่ใช่รหัสเต็มสำหรับออกเลขประจำชิ้น</p>'}</article>`}).join(''):'<div class="panel code-card">ไม่พบรายการในบัญชี FSN</div>'; let pager=$('#fsnPager');if(!pager){pager=document.createElement('div');pager.id='fsnPager';pager.className='fsn-pager';cards.after(pager);}const page=Math.floor(fsnOffset/fsnLimit)+1,pages=Math.max(1,Math.ceil(fsnTotal/fsnLimit));pager.innerHTML=`<button id="fsnPrev" ${fsnOffset<=0?'disabled':''}>ก่อนหน้า</button><span>หน้า ${page} / ${pages} · ${fsnTotal.toLocaleString('th-TH')} รายการอ้างอิง</span><button id="fsnNext" ${fsnOffset+fsnLimit>=fsnTotal?'disabled':''}>ถัดไป</button>`;$('#fsnPrev')?.addEventListener('click',()=>loadFsn(Math.max(0,fsnOffset-fsnLimit)));$('#fsnNext')?.addEventListener('click',()=>loadFsn(fsnOffset+fsnLimit));
  } else {const filtered=codeCatalog.filter(group=>`${group.code} ${group.title} ${group.desc} ${group.items.map(item=>item.name).join(' ')}`.toLowerCase().includes(search));cards.innerHTML=filtered.length?filtered.map(group=>`<article class="panel code-card"><div class="code-card-top"><h3>${esc(group.title)}</h3><span class="fsn-tag">${esc(group.code)}</span></div><p>${esc(group.desc)}</p><div class="sample-list">${group.items.map(item=>`<div class="sample-row"><span>${esc(item.name)}</span><code>${esc(item.code)}</code></div>`).join('')}</div></article>`).join(''):'<div class="panel code-card">ไม่พบหมวดตัวอย่างตามคู่มือที่ค้นหา</div>';}
}
async function loadFsn(offset=0){fsnOffset=Math.max(0,offset);try{const q=$('#codeSearch')?.value||'';const params=new URLSearchParams({q,limit:String(fsnLimit),offset:String(fsnOffset)});const result=await api(`/api/catalog/fsn?${params}`);fsnRows=result.items;fsnTotal=result.total;renderCatalog();}catch(error){showError(error);}}
function switchView(name) {
  if (!document.getElementById(`view-${name}`)) return;
  const parents={register:'assets',survey:'assets',codes:'settings',numbering:'settings',depreciation:'settings',stickers:'settings'};
  const activeMenu=parents[name]||name;
  $$('.view').forEach(section=>section.classList.toggle('active',section.id===`view-${name}`));
  $$('.nav-item[data-view]').forEach(button=>{
    const active=button.dataset.view===activeMenu;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  const titles={work:'PM / ตรวจนับครุภัณฑ์',settings:'ตั้งค่า',dashboard:'ภาพรวม',assets:'ทะเบียนครุภัณฑ์',repairs:'แจ้งซ่อมและติดตามงาน',approvals:'คิวรออนุมัติ',register:'เอกสารทะเบียนคุมทรัพย์สิน',stickers:'แบบสติกเกอร์และการพิมพ์',depreciation:'อายุใช้งานและค่าเสื่อม',survey:'สำรวจและออกเลข',codes:'หมวดและเอกสารอ้างอิง',numbering:'จัดการเลขครุภัณฑ์'};
  const title=titles[name]||'ภาพรวม';
  $('#crumbCurrent').textContent=parents[name]?`${titles[activeMenu]} / ${title}`:title;
  document.title=`${title} — ${window.govAssetBranding?.appName || 'GovAsset'}`;
  document.dispatchEvent(new CustomEvent('govasset:view-changed',{detail:{name}}));
  window.scrollTo({top:0,behavior:'smooth'});
}

function actionMarkup(ticket) {
  const status=ticket.status, role=currentRole;
  if(role===ROLE_OFFICER&&status==='รับแจ้งใหม่') return `<div class="action-form"><p>ตรวจอาการและเลือกว่าต้องขออนุมัติก่อนหรือไม่</p><label>ประมาณการค่าใช้จ่าย (บาท)<input id="estimateCost" type="number" min="0" step="0.01" value="0"></label><label class="check-label"><input id="requiresPurchase" type="checkbox"> ต้องซื้ออะไหล่</label><label class="check-label"><input id="requiresExternal" type="checkbox"> ส่งซ่อม/จ้างภายนอก</label><label class="check-label"><input id="requiresReplacement" type="checkbox"> พิจารณาทดแทน/จำหน่าย</label><label class="check-label"><input id="approvalRequired" type="checkbox"> ส่งขออนุมัติ (ระบุเอง)</label><label>หมายเหตุคัดกรอง<input id="reviewNote" maxlength="500" placeholder="เหตุผลหรือขอบเขตงาน"></label><button class="button primary" data-ticket-action="review">บันทึกผลคัดกรอง</button><small>ระบบจะส่งเข้าคิวอนุมัติเมื่อเข้าเงื่อนไขหรือยอดประมาณการถึงวงเงิน ${Number(appConfig.approvalThreshold).toLocaleString('th-TH')} บาท</small></div>`;
  if(role===ROLE_APPROVER&&status==='รออนุมัติ') return `<div class="action-form"><p>โปรดพิจารณาเหตุผล/ยอดประมาณการ และบันทึกเหตุผลประกอบการตัดสินใจ</p><label>ความเห็นผู้อนุมัติ<textarea id="approvalNote" rows="3" maxlength="1000" placeholder="ระบุเหตุผลประกอบ"></textarea></label><div class="dialog-actions"><button class="button outline reject" data-ticket-action="reject">ไม่อนุมัติ</button><button class="button primary" data-ticket-action="approve">อนุมัติและส่งมอบหมาย</button></div></div>`;
  if(role===ROLE_APPROVER&&status==='รออนุมัติค่าใช้จ่ายจริง') return `<div class="action-form"><p>ยอดจริง ${Number(ticket.actualCost||0).toLocaleString('th-TH')} บาท สูงกว่าวงเงินหรือยอดที่อนุมัติไว้ ต้องตรวจทานก่อนส่งผู้แจ้งปิดงาน</p><label>ความเห็นผู้อนุมัติ<textarea id="finalCostNote" rows="3" maxlength="1000" placeholder="ระบุเหตุผลประกอบ"></textarea></label><div class="dialog-actions"><button class="button outline reject" data-ticket-action="reject_final_cost">ขอแก้ไขข้อมูลยอดจริง</button><button class="button primary" data-ticket-action="approve_final_cost">อนุมัติยอดจริง</button></div></div>`;
  if(role===ROLE_OFFICER&&status==='รอแก้ไขค่าใช้จ่าย') return `<div class="action-form"><p>ผู้อนุมัติขอข้อมูลเพิ่ม/แก้ไขยอดก่อนตรวจรับงาน</p><label>ยอดค่าใช้จ่ายจริงที่เสนอใหม่<input id="revisionCost" type="number" min="0" step="0.01" value="${Number(ticket.actualCost||0)}"></label><label>คำชี้แจง<textarea id="revisionNote" rows="3" maxlength="1000" placeholder="ระบุรายละเอียดที่แก้ไข"></textarea></label><button class="button primary" data-ticket-action="resubmit_cost">ส่งยอดให้อนุมัติอีกครั้ง</button></div>`;
  if(role===ROLE_OFFICER&&status==='รอมอบหมาย') return `<div class="action-form"><label>มอบหมายให้ช่าง <input id="assignedTo" maxlength="160" placeholder="ชื่อผู้รับผิดชอบ" required></label><label>หมายเหตุ<input id="assignNote" maxlength="500" placeholder="วันนัด/ขอบเขตงาน (ถ้ามี)"></label><button class="button primary" data-ticket-action="assign">มอบหมายและเริ่มงาน</button></div>`;
  if(role===ROLE_TECHNICIAN&&status==='กำลังซ่อม') return `<div class="action-form"><label>ผลการตรวจ/ซ่อม<textarea id="workNotes" rows="3" maxlength="3000" placeholder="บันทึกอาการที่พบ วิธีแก้ และอะไหล่"></textarea></label><label>ค่าใช้จ่ายจริง (บาท)<input id="actualCost" type="number" min="0" step="0.01" value="0"></label><div class="dialog-actions"><button class="button outline" data-ticket-action="wait_parts">บันทึกรออะไหล่</button><button class="button primary" data-ticket-action="complete">ส่งผู้แจ้งตรวจรับ</button></div></div>`;
  if(role===ROLE_TECHNICIAN&&status==='รออะไหล่') return `<div class="action-form"><p>บันทึกเหตุการณ์ใน timeline แล้ว เมื่ออะไหล่พร้อมให้กลับมาดำเนินงานต่อ</p><button class="button primary" data-ticket-action="resume">อะไหล่มาแล้ว · ทำงานต่อ</button></div>`;
  if(role===ROLE_REQUESTER&&status==='รอผู้แจ้งยืนยัน') return `<div class="action-form"><label>ความเห็นผู้แจ้ง (กรณีส่งกลับให้แก้ไขให้ระบุเหตุผล)<textarea id="requesterNote" rows="3" maxlength="1000"></textarea></label><div class="dialog-actions"><button class="button outline" data-ticket-action="send_back">ส่งกลับให้แก้ไข</button><button class="button primary" data-ticket-action="confirm">ยืนยันรับงานและปิด Ticket</button></div></div>`;
  if([ROLE_REQUESTER,ROLE_OFFICER].includes(role)&&['รับแจ้งใหม่','รออนุมัติ','รอมอบหมาย','ไม่อนุมัติ'].includes(status)) return `<div class="action-form"><label>เหตุผลยกเลิก<textarea id="cancelNote" rows="2" maxlength="1000" placeholder="ระบุสาเหตุ (จำเป็น)"></textarea></label><button class="button outline reject" data-ticket-action="cancel">ยกเลิก Ticket</button></div>`;
  return `<div class="action-form muted-action">ขั้นตอนนี้ยังไม่เปิดให้บทบาท “${esc(role)}” ดำเนินการ หรือรอผู้เกี่ยวข้องขั้นถัดไป</div>`;
}
async function openTicket(id) {
  try {
    const ticket=await api(`/api/tickets/${id}`); activeTicketId=id;
    const timeline=ticket.events.map(event=>`<li><span class="timeline-dot"></span><div><b>${esc(event.action)} · ${esc(event.actor)}</b><small>${esc(fmtDate(event.createdAt))} ${esc(new Date(event.createdAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}))}</small><p>${esc(event.note||`${event.from_status||'เริ่ม'} → ${event.to_status}`)}</p></div></li>`).join('');
    $('#ticketDialogContent').innerHTML=`<div class="ticket-dialog-inner"><div class="dialog-head"><div><div class="eyebrow">ติดตาม Ticket · ${esc(ticket.ticketNo)}</div><h2 id="ticketDialogTitle">${esc(ticket.assetName)}</h2></div><button type="button" class="dialog-close" data-close-ticket aria-label="ปิด">×</button></div><div class="ticket-status-row">${repairBadge(ticket.status)} ${urgencyBadge(ticket.urgency)}<span class="ticket-date">เปิด ${esc(fmtDate(ticket.createdAt))}</span></div><div class="ticket-detail-grid"><div><small>เลข Ticket</small><b>${esc(ticket.ticketNo)}</b></div><div><small>รหัสครุภัณฑ์</small><b>${esc(ticket.assetCode||'—')}</b></div><div><small>ผู้แจ้ง / ช่องทางติดต่อ</small><b>${esc(ticket.requester)} · ${esc(ticket.contact||'—')}</b></div><div><small>สถานที่</small><b>${esc(ticket.location)}</b></div><div class="wide"><small>อาการ</small><b>${esc(ticket.issue)}</b></div><div><small>ผู้รับผิดชอบ</small><b>${esc(ticket.assignedTo||'ยังไม่มอบหมาย')}</b></div><div><small>ค่าใช้จ่ายประมาณ / จริง</small><b>${Number(ticket.estimateCost||0).toLocaleString('th-TH')} / ${Number(ticket.actualCost||0).toLocaleString('th-TH')} บาท</b></div>${ticket.approvalRequired?`<div class="wide"><small>เหตุผลที่ต้องอนุมัติ</small><b>${esc(ticket.approvalReason)} · ผู้อนุมัติ ${esc(ticket.approvedBy||'รอดำเนินการ')}</b></div>`:''}${ticket.workNotes?`<div class="wide"><small>ผลซ่อม</small><b>${esc(ticket.workNotes)}</b></div>`:''}${ticket.finalCostApprovalRequired?`<div class="wide"><small>อนุมัติค่าใช้จ่ายจริง</small><b>${esc(ticket.finalCostStatus)} · ${esc(ticket.finalCostApprovedBy||'รอผู้อนุมัติ')}</b></div>`:''}</div><div class="ticket-columns"><section class="timeline-panel"><h3>ประวัติการดำเนินงาน</h3><ol class="ticket-timeline">${timeline||'<li>ยังไม่มีเหตุการณ์</li>'}</ol></section><section class="ticket-actions-panel"><h3>ดำเนินการในฐานะ: ${esc(currentRole)}</h3>${actionMarkup(ticket)}<p id="ticketActionError" role="alert"></p><div class="ticket-dialog-buttons"><label>ขนาดพิมพ์<select class="modal-print-size"><option value="a4">A4</option><option value="a5">A5</option><option value="80mm">80 มม.</option><option value="58mm">58 มม.</option></select></label><button class="button outline" data-print-current="${ticket.id}">พิมพ์ใบแจ้งซ่อม</button></div></section></div></div>`;
    if(!$('#ticketDialog').open) $('#ticketDialog').showModal();
    $('[data-close-ticket]')?.addEventListener('click',()=>$('#ticketDialog').close());
    $('[data-print-current]')?.addEventListener('click',()=>printTicket(id,$('.modal-print-size')?.value));
    $$('[data-ticket-action]').forEach(button=>button.addEventListener('click',()=>runTicketAction(id,button.dataset.ticketAction)));
  } catch(error) { showError(error); }
}
async function runTicketAction(id,action) {
  const panel=$('#ticketDialog .ticket-actions-panel');if(panel?.dataset.saving)return;if(panel)panel.dataset.saving='1';
  const buttons=[...document.querySelectorAll('#ticketDialog [data-ticket-action]')];buttons.forEach(button=>button.disabled=true);
  const data={action,actor:currentRole};
  if(action==='review') Object.assign(data,{estimateCost:$('#estimateCost')?.value||0,requiresPurchase:$('#requiresPurchase')?.checked,requiresExternal:$('#requiresExternal')?.checked,requiresReplacement:$('#requiresReplacement')?.checked,approvalRequired:$('#approvalRequired')?.checked,note:$('#reviewNote')?.value||''});
  if(action==='approve'||action==='reject') data.note=$('#approvalNote')?.value||'';
  if(action==='approve_final_cost'||action==='reject_final_cost') data.note=$('#finalCostNote')?.value||'';
  if(action==='resubmit_cost') Object.assign(data,{actualCost:$('#revisionCost')?.value||0,note:$('#revisionNote')?.value||''});
  if(action==='assign') Object.assign(data,{assignedTo:$('#assignedTo')?.value||'',note:$('#assignNote')?.value||''});
  if(action==='complete') Object.assign(data,{workNotes:$('#workNotes')?.value||'',actualCost:$('#actualCost')?.value||0});
  if(action==='confirm'||action==='send_back') data.note=$('#requesterNote')?.value||'';
  if(action==='cancel') data.note=$('#cancelNote')?.value||'';
  try { await api(`/api/tickets/${id}/action`,{method:'POST',body:JSON.stringify(data)}); await refreshData(); await openTicket(id); toast('บันทึกการดำเนินงานและประวัติแล้ว'); }
  catch(error) { if($('#ticketActionError'))$('#ticketActionError').textContent=error.message;else toast(error.message); }
  finally{if(panel)delete panel.dataset.saving;buttons.forEach(button=>button.disabled=false);}
}
async function handleAssetApproval(id,action) {
  const key=String(id);if(assetApprovalsInFlight.has(key))return;
  let note='';if(action==='reject'){note=window.prompt('เหตุผลที่ไม่อนุมัติรายการนี้:')||'';if(!note.trim())return;}
  assetApprovalsInFlight.add(key);const buttons=$$(`[data-asset-id="${Number(id)}"]`);buttons.forEach(button=>button.disabled=true);
  try{await api(`/api/assets/${id}/action`,{method:'POST',body:JSON.stringify({action,actor:currentRole,note})});await refreshData();toast(action==='approve'?'อนุมัติรายการเข้าทะเบียนแล้ว':'ไม่อนุมัติรายการ');}
  catch(error){toast(error.message);}
  finally{assetApprovalsInFlight.delete(key);buttons.forEach(button=>button.disabled=false);}
}
function printTicket(id,size) {
  const ticket=repairs.find(item=>item.id===id); if(!ticket){showError(new Error('ไม่พบ Ticket สำหรับพิมพ์'));return;}
  const printSize=size||$('#repairPrintSize')?.value||'a4'; const configs={a4:{page:'A4 portrait',margin:'10mm',width:'190mm'},a5:{page:'A5 portrait',margin:'7mm',width:'134mm'},'80mm':{page:'80mm 297mm',margin:'4mm',width:'72mm'},'58mm':{page:'58mm 210mm',margin:'3mm',width:'52mm'}}; const config=configs[printSize]||configs.a4;
  let style=$('#dynamicPrintPage'); if(!style){style=document.createElement('style');style.id='dynamicPrintPage';document.head.append(style);} style.textContent=`@media print{@page{size:${config.page};margin:${config.margin}}}`;
  const root=$('#repairPrintArea'); root.className=`repair-print-sheet size-${printSize}`;
  root.innerHTML=`<div class="repair-print-card" style="--paper-width:${config.width}"><header class="repair-print-head"><div class="print-brand-mark">${esc(window.govAssetBranding?.organization || 'ครุภัณฑ์')} · ${esc(window.govAssetBranding?.appName || 'GovAsset')}</div><h1>ใบแจ้งซ่อมครุภัณฑ์</h1><div class="print-ticket-no">${esc(ticket.ticketNo)}</div></header><div class="print-status">สถานะ: ${esc(ticket.status)} · ความเร่งด่วน: ${esc(ticket.urgency)}</div><div class="print-details"><div><span>วันที่แจ้ง</span><b>${esc(fmtDate(ticket.createdAt))}</b></div><div><span>ผู้แจ้ง</span><b>${esc(ticket.requester)}</b></div><div><span>ช่องทางติดต่อ</span><b>${esc(ticket.contact||'—')}</b></div><div><span>สถานที่ตั้ง</span><b>${esc(ticket.location)}</b></div><div><span>ครุภัณฑ์</span><b>${esc(ticket.assetName)}</b></div><div><span>รหัสครุภัณฑ์</span><b>${esc(ticket.assetCode||'—')}</b></div><div class="print-wide"><span>อาการ/รายละเอียด</span><b>${esc(ticket.issue)}</b></div><div><span>ผู้รับผิดชอบ</span><b>${esc(ticket.assignedTo||'ยังไม่มอบหมาย')}</b></div><div><span>ผลการซ่อม</span><b>${esc(ticket.workNotes||'รอดำเนินการ')}</b></div><div><span>ประมาณการ</span><b>${Number(ticket.estimateCost||0).toLocaleString('th-TH')} บาท</b></div><div><span>ค่าใช้จ่ายจริง</span><b>${Number(ticket.actualCost||0).toLocaleString('th-TH')} บาท</b></div></div><div class="print-signatures"><div>ผู้แจ้ง ____________________ วันที่ __________</div><div>ผู้ตรวจรับ ________________ วันที่ __________</div><div>ผู้อนุมัติ _________________ วันที่ __________</div><div>ผู้ปฏิบัติงาน ______________ วันที่ __________</div></div><footer><b class="team-credit">POWER BY PNG TEAM</b> · เอกสารจากต้นแบบสำหรับทดสอบ · ไม่ใช่แบบฟอร์มราชการที่รับรอง</footer></div>`;
  document.body.dataset.printing='ticket'; window.addEventListener('afterprint',()=>{delete document.body.dataset.printing;root.innerHTML='';},{once:true}); window.print();
}
function applyFontScale(value) { fontScale=Math.min(1.4,Math.max(0.95,Math.round(value*100)/100)); document.documentElement.style.zoom=String(fontScale); setText('#fontScaleLabel',`${Math.round(fontScale*100)}%`); localStorage.setItem('govAssetPrototype.fontScale',String(fontScale)); }
function switchRole(role) { currentRole=role; localStorage.setItem('govAssetPrototype.role',role); renderAssets(); renderApprovals(); if(activeTicketId&&$('#ticketDialog')?.open)openTicket(activeTicketId);document.dispatchEvent(new CustomEvent('govasset:role-changed')); }
function updateCode() {
  const parts=[$('#groupCode').value,$('#typeCode').value,$('#descriptionCode').value];
  const manual=$('#assetNumberMode').value==='manual';
  $('#manualAssetCodeField').hidden=!manual;$('#manualAssetCode').required=manual;
  for(const id of ['groupCode','typeCode','descriptionCode'])$('#'+id).required=!manual;
  $('#generatedCode').textContent=manual?($('#manualAssetCode').value||'ระบุเลขประจำครุภัณฑ์เดิม'):parts.every((v,i)=>new RegExp(`^[0-9]{${[4,3,4][i]}}$`).test(v))?`${parts.join('-')}-[ลำดับประจำชิ้น]`:'เลือกรหัส FSN ให้ครบ 4-3-4 ก่อน';
  window.govAssetNumbering?.renderPreview();
}
function openAssetDialog() { populateAssetCategoryOptions(liveCategories||[]); $('#assetFormError').textContent='';updateCode(); $('#assetDialog').showModal(); document.dispatchEvent(new CustomEvent('govasset:asset-entry-open')); $('#assetCategoryId').focus(); }
function openRepairDialog() { $('#assetSuggestions').innerHTML=assets.map(item=>`<option value="${esc(item.name)}">`).join(''); $('#assetCodes').innerHTML=assets.map(item=>`<option value="${esc(item.code)}">`).join(''); $('#repairForm').reset(); $('#repairForm input[name="assetId"]')?.remove(); $('#repairFormError').textContent=''; $('#repairDialog').showModal(); $('#repairAsset').focus(); }

$$('.nav-item[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
document.addEventListener('click',event=>{const target=event.target.closest('[data-go-view]');if(target)switchView(target.dataset.goView);const record=event.target.closest('[data-register-id]');if(record)window.govAssetApp.openRegister(Number(record.dataset.registerId));});
$$('[data-open-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.openView)));
$('#assetSearch')?.addEventListener('input',()=>{++inventoryRequest;clearTimeout(inventorySearchTimer);inventorySearchTimer=setTimeout(()=>loadInventory(0),220);}); $('#statusFilter')?.addEventListener('change',()=>loadInventory(0)); $('#codeSearch')?.addEventListener('input',()=>{renderCatalog();clearTimeout(fsnSearchTimer);fsnSearchTimer=setTimeout(()=>loadFsn(0),220);});
$('#repairSearch')?.addEventListener('input',renderRepairs); $('#repairStatusFilter')?.addEventListener('change',renderRepairs); $('#depreciationSearch')?.addEventListener('input',renderDepreciation);
$('#actorRole').value=currentRole; $('#actorRole').addEventListener('change',event=>switchRole(event.target.value));
$('#fontDecrease').addEventListener('click',()=>applyFontScale(fontScale-.05)); $('#fontIncrease').addEventListener('click',()=>applyFontScale(fontScale+.05)); applyFontScale(fontScale);
$('#newRepairButton')?.addEventListener('click',openRepairDialog);
$('#closeRepairDialog').addEventListener('click',()=>$('#repairDialog').close()); $('#cancelRepairDialog').addEventListener('click',()=>$('#repairDialog').close());
$('#repairDialog').addEventListener('click',event=>{if(event.target===$('#repairDialog'))$('#repairDialog').close();});
for(const input of [$('#repairAsset'),$('#repairAssetCode')])input.addEventListener('input',()=>{
  const linked=$('#repairForm input[name="assetId"]');
  if(linked&&input.id==='repairAsset')$('#repairAssetCode').value='';
  linked?.remove();
});
$('#repairForm').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');if(button.disabled)return;
  const data=Object.fromEntries(new FormData(form));button.disabled=true;$('#repairFormError').textContent='';
  try{const ticket=await api('/api/tickets',{method:'POST',body:JSON.stringify(data)});form.reset();$('#repairForm input[name="assetId"]')?.remove();$('#repairDialog').close();await refreshData();toast(`เปิด Ticket ${ticket.ticketNo} แล้ว`);switchView('repairs');await openTicket(ticket.id);}catch(error){$('#repairFormError').textContent=error.message;}finally{button.disabled=false;}
});
$('#newAssetTop')?.addEventListener('click',openAssetDialog); $('#newAssetList')?.addEventListener('click',openAssetDialog); $('#newSurvey')?.addEventListener('click',openAssetDialog);
$('#closeDialog').addEventListener('click',()=>$('#assetDialog').close()); $('#cancelDialog').addEventListener('click',()=>$('#assetDialog').close()); $('#assetDialog').addEventListener('click',event=>{if(event.target===$('#assetDialog'))$('#assetDialog').close();});
$('#groupCode').addEventListener('input',updateCode); $('#typeCode').addEventListener('input',updateCode);$('#descriptionCode').addEventListener('input',updateCode);$('#assetNumberMode').addEventListener('change',updateCode);$('#manualAssetCode').addEventListener('input',updateCode);

$('#assetForm').addEventListener('submit',async event=>{
  event.preventDefault();const formElement=event.currentTarget,button=formElement.querySelector('[type="submit"]');if(button.disabled)return;
  const form=new FormData(formElement),categoryId=Number(form.get('categoryId'));
  $('#assetFormError').textContent='';
  if(!liveCategories?.some(item=>Number(item.id)===categoryId&&item.isActive!==false)){$('#assetFormError').textContent='กรุณาเลือกหมวดครุภัณฑ์จากรายการที่ใช้งาน';return;}
  const parts=[form.get('group'),form.get('type'),form.get('fsnDescription')],fsnCode=parts.some(Boolean)?parts.join('-'):'';
  button.disabled=true;
  try{
    const asset=await api('/api/assets',{method:'POST',body:JSON.stringify({code:form.get('numberMode')==='manual'?String(form.get('inventoryCode')||'').trim():'',fsnCode,assetType:window.govAssetNumbering?.getType()||'',name:String(form.get('name')).trim(),detail:String(form.get('detail')||'').trim(),categoryId,location:String(form.get('location')||'').trim(),actor:currentRole})});
    $('#assetDialog').close();formElement.reset();updateCode();await refreshData();toast(`ส่งรายการ ${asset.code} เข้าคิวอนุมัติแล้ว`);switchView('approvals');
  }catch(error){$('#assetFormError').textContent=error.message;}finally{button.disabled=false;}
});
$('#exportCsv').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{const all=[];let offset=0,total=Infinity;while(offset<total){const page=await api(`/api/inventory?limit=200&offset=${offset}`);all.push(...page.items);total=page.total;offset+=page.items.length;if(!page.items.length)break;}const rows=[['ชื่อรายการ','รายละเอียด','รหัส FSN','กลุ่ม','หน่วยงาน/ที่ตั้ง','วันที่บันทึก','สถานะ'],...all.map(item=>[item.name,item.detail,item.code,item.group,item.location,fmtDate(item.date),item.status])];const csv='\ufeff'+rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='ทะเบียนครุภัณฑ์-SQLite.csv';link.click();URL.revokeObjectURL(link.href);toast(`ส่งออก ${all.length.toLocaleString('th-TH')} รายการจาก SQLite แล้ว`);}catch(error){showError(error);}finally{button.disabled=false;}});
$('#printSheet').addEventListener('click',()=>window.print()); $('#printRegister').addEventListener('click',()=>{document.body.dataset.printing='register';window.addEventListener('afterprint',()=>delete document.body.dataset.printing,{once:true});window.print();});
$('#manualDialog .manual-content')?.insertAdjacentHTML('afterbegin',`<section><h3>เลือกหมวดครุภัณฑ์</h3><p>ตอนเพิ่มรายการใหม่ ให้เลือกหมวดที่หน่วยงานใช้งาน หากยังไม่มีให้เปิด ตั้งค่า → หมวดและเอกสารอ้างอิง แล้วอ่านคู่มือก่อนสร้างหมวด การเลือกหมวดไม่ได้เลือกหลักเกณฑ์ค่าเสื่อมให้อัตโนมัติ ต้องตรวจให้ตรงตามเกณฑ์ของหน่วยงาน</p></section><section><h3>ค้นข้อมูลแนบและทะเบียนคุม</h3><p>เปิดทะเบียนครุภัณฑ์ ค้นหารายการ แล้วกดใบทะเบียนคุมเพื่อดูที่มาและพิมพ์เอกสารเฉพาะทรัพย์สินนั้น รายการที่นำเข้าจะแสดงไฟล์และแถวต้นทางที่เชื่อมไว้ ระบบจะแสดงเฉพาะข้อมูลที่มีอยู่ในฐานที่กำลังใช้งาน</p></section><section><h3>ออกแบบสติกเกอร์</h3><p>เข้าเมนูสติกเกอร์ ค้นหา/เลือกทรัพย์สินหลายรายการ เลือกหรือสร้างเทมเพลต กำหนดขนาด 5–500 มม. เพิ่ม/ลากข้อความ QR กรอบหรือภาพ และใช้ตัวแปรอย่าง <code>{{AssetNo}}</code>, <code>{{AssetName}}</code>, <code>{{Location}}</code>, <code>{{QrUrl}}</code> กดบันทึกก่อนพิมพ์; แต่ละรายการพิมพ์หนึ่งฉลากตามขนาดจริง</p></section>`);
$('#helpBtn').addEventListener('click',()=>$('#manualDialog').showModal()); $('#closeManual').addEventListener('click',()=>$('#manualDialog').close()); $('#manualDialog').addEventListener('click',event=>{if(event.target===$('#manualDialog'))$('#manualDialog').close();});
$('.close-notice')?.addEventListener('click',event=>event.currentTarget.closest('.notice').remove());
$('#ticketDialog').addEventListener('click',event=>{if(event.target===$('#ticketDialog'))$('#ticketDialog').close();});
applyFontScale(fontScale);
window.govAssetApp={api,toast,showError,refreshData,switchView,fmtDate,openTicket,openRepairDialog,getRole:()=>currentRole,loadFsn,openAssetDialog};
refreshData();
