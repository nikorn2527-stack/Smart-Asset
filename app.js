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
const smartFilterMultiKeys=['fiscalYear','category','status','building','floor','room'];
const smartFilterGroupLabels={fiscalYear:'ปีงบประมาณ',category:'หมวดครุภัณฑ์',status:'สถานะ',account:'หน่วยงาน',branch:'สาขา',building:'อาคาร',floor:'ชั้น',room:'ห้อง / งานย่อย'};
let smartFilterCommitted={fiscalYear:[],category:[],status:[],building:[],floor:[],room:[],account:'',branch:''};
let smartFilterDraft=cloneSmartFilter(smartFilterCommitted);
let smartFilterCatalog={},smartFilterActiveGroup='fiscalYear',smartFilterFacets={};
let currentRole=window.govAssetAccess?.session?.actor||localStorage.getItem('govAssetPrototype.role') || ROLE_OFFICER;
let activeTicketId=null;
const assetApprovalsInFlight=new Set();
let fontScale=Number(localStorage.getItem('govAssetPrototype.fontScale')) || 1;

async function api(path, options={}) {
  const loading = document.getElementById('app-loading');
  if(loading) loading.classList.add('show');
  try {
    const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const payload=await response.json().catch(()=>({error:'ไม่สามารถอ่านผลจาก server ได้'}));
    if(!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if(options.method&&options.method!=='GET')document.dispatchEvent(new CustomEvent('govasset:data-changed',{detail:{path}}));
    return payload;
  } finally {
    if(loading) loading.classList.remove('show');
  }
}
function toast(message, type = 'info') { const el=$('#toast'); if(!el) return; el.setAttribute('data-type', type); const icon = type === 'error' ? '✕' : type === 'warning' ? '⚠' : '✓'; el.innerHTML=`<span class="toast-icon">${icon}</span> <span>${esc(message)}</span> <button class="toast-close" onclick="this.closest('#toast').classList.remove('show');clearTimeout(toast.timer)">×</button>`; if(typeof el.showPopover==='function'){el.popover='manual';if(el.matches(':popover-open'))el.hidePopover();el.showPopover();} el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'), type === 'error' ? 8000 : type === 'warning' ? 6000 : 5000); }
function showError(error) { const message=error?.message || 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้'; toast(message, 'error'); const badge=$('#dbIndicator'); if(badge){badge.textContent='เชื่อมต่อระบบไม่ได้';badge.classList.add('offline');} }
function setConnected() { const badge=$('#dbIndicator'); if(badge){badge.innerHTML='<i></i> ระบบพร้อมใช้งาน';badge.classList.remove('offline');} }
function confirmDialog(message, title = 'ยืนยันการดำเนินการ') { return new Promise((resolve) => { document.getElementById('confirm-title').textContent = title; document.getElementById('confirm-message').textContent = message; const dlg = document.getElementById('confirm-dialog'); window.confirmDialogResult = (value) => { dlg.close(); delete window.confirmDialogResult; resolve(value); }; window.closeConfirmDialog = (value) => { dlg.close(); delete window.confirmDialogResult; resolve(value === true); }; dlg.showModal(); }); }
function populateAssetCategoryOptions(rows) {
  const categories=(Array.isArray(rows)?rows:[]).filter(item=>item&&item.isActive!==false&&Number.isInteger(Number(item.id))&&Number(item.id)>0);
  const select=$('#assetCategoryId');
  if(select){
    const current=select.value;
    select.innerHTML=`<option value="">${categories.length?'เลือกหมวดครุภัณฑ์...':'ไม่พบหมวดที่ใช้งาน'}</option>`+categories.map(item=>`<option value="${Number(item.id)}" title="${esc(item.source||'')}">${esc(item.name)}</option>`).join('');
    if(categories.some(item=>String(item.id)===current))select.value=current;
    select.disabled=categories.length===0;
  }
  const catFilter=$('#categoryFilter');
  if(catFilter){
    const currentCat=catFilter.value;
    catFilter.innerHTML=`<option value="">ทุกหมวดหมู่ (${categories.length} หมวด)</option>`+categories.map(item=>`<option value="${Number(item.id)}">${esc(item.name)}</option>`).join('');
    if(categories.some(item=>String(item.id)===currentCat))catFilter.value=currentCat;
  }
  renderSmartFilterCatalog(smartFilterFacets);
}
function inventoryQueryParams(offset=0) {
  const params=new URLSearchParams({...window.govAssetAccountFilters?.(),q:($('#assetSearch')?.value||'').trim(),limit:String(inventoryLimit),offset:String(Math.max(0,offset))});
  const category=$('#categoryFilter')?.value;
  if(category)params.append('category',category);
  smartFilterMultiKeys.forEach(key=>smartFilterCommitted[key].forEach(value=>params.append(key,value)));
  return params;
}
function cloneSmartFilter(source) {
  return Object.fromEntries([...smartFilterMultiKeys.map(key=>[key,[...(source[key]||[])]]),['account',source.account||''],['branch',source.branch||'']]);
}
function optionList(select,counts=new Map()) {
  if(!select)return [];
  return [...select.options].slice(1).map(option=>({value:option.value,label:option.textContent.replace(/\s*\(\d[\d,]*\)\s*$/,'').trim(),count:counts.get(option.value)}));
}
function smartFilterSelectionCount(source=smartFilterCommitted) {
  return smartFilterMultiKeys.reduce((total,key)=>total+(source[key]?.length||0),0)+(source.account?1:0)+(source.branch?1:0);
}
function renderSmartFilterCatalog(facets={}) {
  smartFilterFacets=facets||smartFilterFacets||{};
  const mergeSelected=(items,selected)=>{const known=new Set(items.map(item=>item.value));return [...items,...selected.filter(value=>value&&!known.has(value)).map(value=>({value,label:value==='__unassigned__'?'ไม่ระบุ':value,count:0}))];};
  smartFilterCatalog={
    fiscalYear:(smartFilterFacets.fiscalYears||[]).map(item=>({value:item.value,label:item.value==='__unassigned__'?'ไม่ระบุปี':item.value,count:item.count})),
    category:(smartFilterFacets.categories||[]).map(item=>({value:String(item.value),label:item.label,count:item.count})),
    status:(smartFilterFacets.statuses||[]).map(item=>({value:item.value,label:optionList($('#statusFilter')).find(option=>option.value===item.value)?.label||item.value,count:item.count})),
    building:(smartFilterFacets.buildings||[]).map(item=>({value:item.name,label:item.name==='__unassigned__'?'ยังไม่ระบุอาคาร':item.name,count:item.count})),
    floor:(smartFilterFacets.floors||[]).map(item=>({value:item.name,label:item.name==='__unassigned__'?'ยังไม่ระบุชั้น':item.name,count:item.count})),
    room:(smartFilterFacets.rooms||[]).map(item=>({value:item.name,label:item.name==='__unassigned__'?'ยังไม่ระบุห้อง / งานย่อย':item.name,count:item.count})),
    account:(window.govAssetAccountFilterChoices?.accounts||[]).map(item=>({value:String(item.id),label:item.name})),
    branch:(window.govAssetAccountFilterChoices?.branches||[]).map(item=>({value:String(item.id),label:item.name,accountId:String(item.account_id)}))
  };
  smartFilterMultiKeys.forEach(key=>smartFilterCatalog[key]=mergeSelected(smartFilterCatalog[key]||[],smartFilterCommitted[key]));
  if($('#inventoryAccount')?.value==='legacy'&&!smartFilterCatalog.account.some(item=>item.value==='legacy'))smartFilterCatalog.account.unshift({value:'legacy',label:'ยังไม่แยกหน่วยงาน'});
  renderSmartFilterMenu();
}
function renderSmartFilterMenu() {
  const tabs=$('#smartFilterTabs'),list=$('#smartFilterOptions'),trigger=$('#smartFilterButton');
  if(!tabs||!list)return;
  const keys=['fiscalYear','category','status','account','branch','building','floor','room'];
  if(!keys.includes(smartFilterActiveGroup))smartFilterActiveGroup='fiscalYear';
  tabs.innerHTML=keys.map(key=>{
    const count=smartFilterMultiKeys.includes(key)?smartFilterDraft[key].length:Number(Boolean(smartFilterDraft[key]));
    return `<button type="button" role="tab" aria-selected="${smartFilterActiveGroup===key}" data-filter-group="${key}">${esc(smartFilterGroupLabels[key])}${count?`<span>${count}</span>`:''}</button>`;
  }).join('');
  const query=($('#smartFilterSearch')?.value||'').trim().toLocaleLowerCase('th-TH');
  let options=smartFilterCatalog[smartFilterActiveGroup]||[];
  if(smartFilterActiveGroup==='branch')options=options.filter(option=>!smartFilterDraft.account||option.accountId===smartFilterDraft.account);
  options=options.filter(option=>!query||option.label.toLocaleLowerCase('th-TH').includes(query));
  const multi=smartFilterMultiKeys.includes(smartFilterActiveGroup),selected=smartFilterDraft[smartFilterActiveGroup];
  list.innerHTML=options.length?options.map(option=>{
    const checked=multi?selected.includes(option.value):selected===option.value;
    return `<label class="smart-filter-option"><input type="${multi?'checkbox':'radio'}" name="smart-filter-${smartFilterActiveGroup}" value="${esc(option.value)}"${checked?' checked':''}><span>${esc(option.label)}</span>${option.count!=null?`<small>${Number(option.count).toLocaleString('th-TH')}</small>`:''}</label>`;
  }).join(''):'<p class="smart-filter-empty">ไม่พบตัวเลือกที่ตรงกับคำค้น</p>';
  const count=$('#smartFilterGroupCount'),selectVisible=$('#selectVisibleFilters'),clearCurrent=$('#clearCurrentFilter');
  if(count)count.textContent=multi?`${options.length} ตัวเลือก · เลือกได้หลายค่า`:`${options.length} ตัวเลือก`;
  if(selectVisible)selectVisible.hidden=!multi||!options.length;
  if(clearCurrent)clearCurrent.textContent=multi?'ล้างหมวดนี้':'ไม่เลือก';
  if(trigger){
    const selectedCount=smartFilterSelectionCount();
    trigger.setAttribute('aria-label',selectedCount?`ตัวกรองที่ใช้ ${selectedCount} รายการ`:'เปิดตัวกรองทะเบียน');
    $('#smartFilterCount').textContent=String(selectedCount);
    trigger.classList.toggle('has-filters',selectedCount>0);
  }
  renderSmartFilterChips();
  requestAnimationFrame(positionSmartFilterMenu);
}
function renderSmartFilterChips() {
  const root=$('#smartFilterChips');
  if(!root)return;
  const chips=[];
  smartFilterMultiKeys.forEach(key=>smartFilterCommitted[key].forEach(value=>{
    const option=smartFilterCatalog[key]?.find(item=>item.value===value);
    chips.push({key,value,label:`${smartFilterGroupLabels[key]}: ${option?.label||value}`});
  }));
  for(const key of ['account','branch']){
    const value=smartFilterCommitted[key];
    if(value){const option=(smartFilterCatalog[key]||[]).find(item=>item.value===value);chips.push({key,value,label:`${smartFilterGroupLabels[key]}: ${option?.label||value}`});}
  }
  root.innerHTML=chips.map(chip=>`<button type="button" class="smart-filter-chip" data-remove-filter="${chip.key}" data-filter-value="${esc(chip.value)}" aria-label="นำตัวกรอง ${esc(chip.label)} ออก">${esc(chip.label)} <span aria-hidden="true">×</span></button>`).join('');
  root.hidden=chips.length===0;
}
function applySmartFilterDraft() {
  const requested=cloneSmartFilter(smartFilterDraft);
  smartFilterCommitted=cloneSmartFilter(requested);
  const account=$('#inventoryAccount'),branch=$('#inventoryBranch');
  if(account&&account.value!==smartFilterCommitted.account){
    account.value=smartFilterCommitted.account;
    account.dispatchEvent(new Event('change'));
  }
  if(branch){
    branch.value=requested.branch;
    if(branch.value!==requested.branch)smartFilterCommitted.branch='';
    else smartFilterCommitted.branch=requested.branch;
    branch.dispatchEvent(new Event('change'));
  }
  smartFilterDraft=cloneSmartFilter(smartFilterCommitted);
  renderSmartFilterMenu();
  $('#smartFilterMenu')?.hidePopover();
  loadInventory(0);
}
function clearSmartFilterGroup(group) {
  if(smartFilterMultiKeys.includes(group))smartFilterDraft[group]=[];
  else if(group==='account'){smartFilterDraft.account='';smartFilterDraft.branch='';}
  else if(group==='branch')smartFilterDraft.branch='';
  renderSmartFilterMenu();
}
function syncSmartFilterAccountChoices(choices,selectedAccount,selectedBranch) {
  window.govAssetAccountFilterChoices=choices||{accounts:[],branches:[]};
  smartFilterCommitted.account=selectedAccount||'';
  smartFilterCommitted.branch=selectedBranch||'';
  smartFilterDraft.account=smartFilterCommitted.account;
  smartFilterDraft.branch=smartFilterCommitted.branch;
  renderSmartFilterCatalog(smartFilterFacets);
}
function positionSmartFilterMenu() {
  const menu=$('#smartFilterMenu'),trigger=$('#smartFilterButton');
  if(!menu?.matches(':popover-open')||!trigger)return;
  const triggerRect=trigger.getBoundingClientRect(),menuRect=menu.getBoundingClientRect();
  const left=Math.max(8,Math.min(triggerRect.left,window.innerWidth-menuRect.width-8));
  const below=triggerRect.bottom+6;
  menu.style.left=`${left}px`;
  menu.style.top=`${below+menuRect.height<=window.innerHeight-8?below:Math.max(8,triggerRect.top-menuRect.height-6)}px`;
}
async function refreshData() {
  const request=++inventoryRequest;
  clearTimeout(inventorySearchTimer);
  const inventoryParams=inventoryQueryParams(0);
  try {
    const [assetData,surveyData,ticketData,config,inventoryData,fsnData,categoryData,depreciationData,pendingData]=await Promise.all([api('/api/assets'),api('/api/survey'),api('/api/tickets'),api('/api/config'),api(`/api/inventory?${inventoryParams}`),api(`/api/catalog/fsn?limit=${fsnLimit}`),api('/api/catalog/categories'),api('/api/catalog/depreciation'),api('/api/assets/pending')]);
    document.dispatchEvent(new CustomEvent('govasset:inventory-rendering'));assets=assetData; approvalAssets=pendingData; sheet=surveyData; repairs=ticketData; appConfig=config;
    if(request===inventoryRequest){inventoryRows=inventoryData.items; inventoryTotal=inventoryData.total; inventoryOffset=inventoryData.offset;}
    fsnRows=fsnData.items; fsnTotal=fsnData.total; fsnOffset=fsnData.offset;
    liveCategories=categoryData.length?categoryData:null;populateAssetCategoryOptions(categoryData);
    liveDepreciationRows=depreciationData.items?.length?depreciationData.items.map(row=>({no:row.ruleNo,category:row.category,years:row.years==null?'พิจารณาเฉพาะกรณี':String(row.years),rate:row.annualRate==null?'พิจารณาเฉพาะกรณี':String(row.annualRate),note:row.note||''})):null;
    setConnected();
    const overview=await api('/api/overview'); appConfig.overview=overview;
    const totalAssets = overview.assets ?? inventoryTotal ?? 0;
    const activeReps = overview.activeRepairs || 0;
    const pendingCount = overview.pendingAssets || 0;
    const readyCount = Math.max(0, totalAssets - activeReps - pendingCount);
    setText('#kpiTotalAssets', totalAssets.toLocaleString('th-TH'));
    setText('#kpiReadyAssets', readyCount.toLocaleString('th-TH'));
    setText('#kpiPendingAssets', pendingCount.toLocaleString('th-TH'));
    setText('#kpiRepairAssets', activeReps.toLocaleString('th-TH'));
    const navBadge = $('#navAssetBadge'); if(navBadge) navBadge.textContent = totalAssets >= 10000 ? Math.round(totalAssets/1000) + 'K' : totalAssets.toLocaleString('th-TH');
    const footerScope = $('#assetFooterScope'); if(footerScope) footerScope.textContent = `ฐานข้อมูลหน่วยงานปัจจุบัน ${totalAssets.toLocaleString('th-TH')} รายการ · ระบบทะเบียนและประวัติครุภัณฑ์`;
    loadLocationFacets();
    renderAssets(); renderRepairs(); renderSheet(); renderCatalog(); renderDepreciation(); renderApprovals(); updateCode();
    await window.govAssetMasterData?.load();
    const threshold=$('#thresholdAmount'); if(threshold) threshold.textContent=Number(config.approvalThreshold).toLocaleString('th-TH');
    return true;
  } catch(error) { showError(error); return false; }
}
const statusClass = status => ['พร้อมใช้','ทะเบียนแล้ว','ปิดงาน'].includes(status) ? 'ready' : ['รอตรวจสอบ','รออนุมัติ','รับแจ้งใหม่','รอผู้แจ้งยืนยัน'].includes(status) ? 'pending' : ['กำลังซ่อม','รออะไหล่'].includes(status) ? 'repair' : 'inactive';
function badge(status) { return `<span class="gov-badge ${statusClass(status)}">${esc(status)}</span>`; }
function assetNameCell(item, withPhoto=false) {
  const modelText = [item.model, item.serialNumber ? `S/N: ${item.serialNumber}` : ''].filter(Boolean).join(' · ');
  const text = `<div class="asset-info-cell"><div class="asset-primary-name" title="${esc(item.name || 'ไม่ระบุชื่อพัสดุ')}">${esc(item.name || 'ไม่ระบุชื่อพัสดุ')}</div><div class="asset-secondary-meta" title="${esc(modelText || item.detail || '—')}">${esc(modelText || item.detail || '—')}</div></div>`;
  if(!withPhoto) return text;
  const photo = item.photoUrl
    ? `<button type="button" class="asset-thumb" data-smart-id="${item.id}" title="ดูรูปและรายละเอียด"><img src="${esc(item.photoUrl)}" alt="รูป ${esc(item.name || '')}" loading="lazy"></button>`
    : `<button type="button" class="asset-thumb empty" data-smart-id="${item.id}" title="ยังไม่มีรูป · เปิดรายละเอียดเพื่อเพิ่มรูป" aria-label="ยังไม่มีรูป เปิดรายละเอียดเพื่อเพิ่มรูป"><span aria-hidden="true">📷</span></button>`;
  return `<div class="asset-name-with-photo">${photo}${text}</div>`;
}
function renderAssets() {
  const can=permission=>!window.govAssetAccess?.session?.required||Boolean(window.govAssetAccess.session.permissions?.[permission]);

  queueMicrotask(()=>document.dispatchEvent(new CustomEvent('govasset:inventory-rendered')));
  document.dispatchEvent(new CustomEvent('govasset:inventory-rendering'));

  const search=($('#assetSearch')?.value||'').trim().toLowerCase(), status=$('#statusFilter')?.value||'all', catVal=$('#categoryFilter')?.value||'';
  const filtered=inventoryRows!==null?inventoryRows:assets.filter(item=>`${item.name} ${item.code} ${item.group} ${item.location} ${item.status}`.toLowerCase().includes(search)&&(status==='all'||item.status===status));
  const rows=$('#assetRows');
  if(rows) {
    rows.innerHTML=filtered.length?filtered.map(item=>{
      const cost = item.purchasePrice != null ? Number(item.purchasePrice).toLocaleString('th-TH') + ' บาท' : '—';
      const netVal = (item.depreciationEstimate?.netBookValue ?? item.netBookValue) != null ? Number(item.depreciationEstimate?.netBookValue ?? item.netBookValue).toLocaleString('th-TH') + ' บาท' : '—';
      const deptDisplay = [item.location, item.accountName].filter(Boolean).join(' · ');
      return `<tr>
        <td>
          <div class="asset-code-badge">
            <span>${esc(item.code || 'ยังไม่มีรหัส')}</span>
          </div>
        </td>
        <td>${assetNameCell(item, true)}</td>
        <td><span class="category-badge-chip">${esc(item.group || 'ทั่วไป')}</span></td>
        <td>
          <div class="asset-loc-line">
            <span class="asset-primary-name" style="font-size:12px;" title="${esc(item.location || '—')}">${esc(item.location || '—')}</span>
            ${(item.building || item.floor || item.room) ? `<span class="asset-loc-pill" title="${esc([item.building, item.floor, item.room].filter(Boolean).join(' · '))}">📍 ${esc([item.building, item.floor, item.room].filter(Boolean).join(' · '))}</span>` : ''}
          </div>
          <div class="asset-secondary-meta" title="${esc(item.accountName || '')}${item.branchName ? ' · ' + esc(item.branchName) : ''}">${esc(item.accountName || '')}${item.branchName ? ' · ' + esc(item.branchName) : ''}</div>
        </td>
        <td>
          <div class="asset-cost-main">${cost}</div>
          <small class="asset-cost-sub">สุทธิ: ${netVal}</small>
        </td>
        <td>${badge(item.status)}</td>
        <td style="text-align:center;">
          <div class="table-action-group">
            <button class="btn-dossier" type="button" data-smart-id="${item.id}" title="ดูรายละเอียด ประวัติ และใบคุมทรัพย์สิน">รายละเอียด</button>
            <button class="btn-quick-repair" type="button" data-quick-repair="${item.id}" title="แจ้งซ่อมชิ้นนี้">⚒️ ซ่อม</button>
            ${can('edit') ? `<button class="btn-more-action" type="button" data-assign-location="${item.id}" title="ระบุตึก / ชั้น / ห้อง">📍 ที่ตั้ง</button>` : ''}
            ${currentRole===ROLE_OFFICER && can('edit') ? `<button class="btn-more-action" type="button" data-workspace-edit="${item.id}" title="แก้ไขข้อมูล">✏️ แก้ไข</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join(''):'<tr><td colspan="7" class="empty-cell">ไม่พบรายการครุภัณฑ์ที่ตรงกับเงื่อนไขการค้นหา</td></tr>';
  }
  const shownStart=inventoryTotal?inventoryOffset+1:1, shownEnd=Math.min(inventoryOffset+filtered.length,inventoryTotal||filtered.length);
  const result=$('#resultCount'); if(result) result.textContent=`แสดง ${filtered.length?shownStart:0}–${shownEnd} จาก ${inventoryRows!==null?inventoryTotal.toLocaleString('th-TH'):assets.length} รายการ`;
  const total=$('#totalCount'); if(total) total.textContent=String(appConfig.overview?.assets ?? inventoryTotal ?? assets.length);
  const pending=$('#pendingCount'); if(pending) pending.textContent=String(appConfig.overview?.pendingAssets ?? assets.filter(item=>item.status==='รออนุมัติ'||item.status==='รอตรวจสอบ').length);
  $$('[data-asset-action]',rows||document).forEach(button=>button.addEventListener('click',()=>handleAssetApproval(button.dataset.assetId,button.dataset.assetAction)));
  const panel=rows?.closest('.listing-panel');
  if(panel){
    let pager=$('#inventoryPager');
    if(!pager){pager=document.createElement('div');pager.id='inventoryPager';pager.className='inventory-pager';panel.append(pager);}
    const totalCount = inventoryRows!==null?inventoryTotal:filtered.length;
    const page = Math.floor(inventoryOffset/inventoryLimit)+1;
    const pages = Math.max(1, Math.ceil(totalCount/inventoryLimit));
    const sStart = totalCount ? inventoryOffset + 1 : 0;
    const sEnd = Math.min(inventoryOffset + (inventoryRows ? inventoryRows.length : filtered.length), totalCount);
    let pageOpts = '';
    // List every page so any part of the 66k register can be reached directly.
    for(let p=1; p<=pages; p++){ pageOpts += `<option value="${p}" ${p===page?'selected':''}>หน้า ${p}</option>`; }

    pager.innerHTML = `
      <div class="pager-left">
        <label class="pager-size-control">
          <span>แสดง:</span>
          <select id="inventoryLimitSelect" class="pager-select" aria-label="จำนวนแถวต่อหน้า">
            <option value="15" ${inventoryLimit===15?'selected':''}>15 แถว</option>
            <option value="25" ${inventoryLimit===25?'selected':''}>25 แถว</option>
            <option value="50" ${inventoryLimit===50?'selected':''}>50 แถว</option>
            <option value="100" ${inventoryLimit===100?'selected':''}>100 แถว</option>
          </select>
          <span>ต่อหน้า</span>
        </label>
        <span class="pager-info">แสดง <strong>${sStart.toLocaleString('th-TH')}–${sEnd.toLocaleString('th-TH')}</strong> จาก <strong>${totalCount.toLocaleString('th-TH')}</strong> รายการ</span>
      </div>
      <div class="pager-nav">
        <button type="button" class="pager-btn" id="inventoryFirst" title="หน้าแรก" ${page<=1?'disabled':''}>« หน้าแรก</button>
        <button type="button" class="pager-btn" id="inventoryPrev" title="ก่อนหน้า" ${page<=1?'disabled':''}>‹ ก่อนหน้า</button>
        <div class="pager-page-picker">
          <select id="inventoryPageSelect" class="pager-select" aria-label="เลือกหน้า">${pageOpts}</select>
          <span>/ ${pages.toLocaleString('th-TH')}</span>
        </div>
        <button type="button" class="pager-btn" id="inventoryNext" title="ถัดไป" ${page>=pages?'disabled':''}>ถัดไป ›</button>
        <button type="button" class="pager-btn" id="inventoryLast" title="หน้าสุดท้าย" ${page>=pages?'disabled':''}>หน้าสุดท้าย »</button>
      </div>
    `;
    $('#inventoryLimitSelect')?.addEventListener('change', e=>{ inventoryLimit=Number(e.target.value); loadInventory(0); });
    $('#inventoryFirst')?.addEventListener('click', ()=>loadInventory(0));
    $('#inventoryPrev')?.addEventListener('click', ()=>loadInventory(Math.max(0, inventoryOffset - inventoryLimit)));
    $('#inventoryNext')?.addEventListener('click', ()=>loadInventory(inventoryOffset + inventoryLimit));
    $('#inventoryLast')?.addEventListener('click', ()=>loadInventory((pages - 1) * inventoryLimit));
    $('#inventoryPageSelect')?.addEventListener('change', e=>loadInventory((Number(e.target.value) - 1) * inventoryLimit));
  }
}
async function loadInventory(offset=0){
  const request=++inventoryRequest;
  const params=inventoryQueryParams(offset);
  try{const result=await api(`/api/inventory?${params}`);if(request!==inventoryRequest)return;inventoryRows=result.items;inventoryTotal=result.total;inventoryOffset=result.offset;renderAssets();document.dispatchEvent(new CustomEvent('govasset:inventory-rendered'));}catch(error){if(request===inventoryRequest){const rows=$('#assetRows');if(rows)rows.innerHTML=`<tr><td colspan="7" class="empty-cell" role="alert">โหลดทะเบียนไม่สำเร็จ: ${esc(error?.message||'ไม่สามารถเชื่อมต่อฐานข้อมูลได้')} · ลองค้นหาใหม่อีกครั้ง</td></tr>`;setText('#resultCount','โหลดข้อมูลไม่สำเร็จ');showError(error);}}
}
function fmtDate(value) {
  if(!value) return '—';
  const str = String(value).trim();
  if (/^1899-12-(30|31)/.test(str) || /^1900-01-0[01]/.test(str)) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 1920) return '—';
  return date.toLocaleDateString('th-TH', {day:'numeric', month:'short', year:'numeric'});
}
function repairStatusClass(status) { return ['ปิดงาน','ซ่อมเสร็จ'].includes(status)?'green':['รออนุมัติ','รออนุมัติค่าใช้จ่ายจริง','รับแจ้งใหม่','รอผู้แจ้งยืนยัน','รอมอบหมาย','รอแก้ไขค่าใช้จ่าย'].includes(status)?'amber':status==='ไม่อนุมัติ'?'red':status==='รออะไหล่'?'violet':'blue'; }
function repairBadge(status) { return `<span class="badge ${repairStatusClass(status)}">${esc(status)}</span>`; }
function isUserReport(item) { return ['asset_qr','location_qr'].includes(item?.sourceChannel); }
function userReportBadge(item) {
  if (!isUserReport(item)) return '';
  if (item.status === 'ยกเลิก') return '<span class="badge red">แจ้งไม่จริง</span>';
  return item.provisional ? '<span class="badge amber">รอตรวจจริง/ไม่จริง</span>' : '<span class="badge teal">แจ้งจริงจากผู้ใช้</span>';
}
function urgencyBadge(urgency) { const type=urgency==='เร่งด่วนมาก'?'critical':urgency==='เร่งด่วน'?'high':'normal'; return `<span class="urgency ${type}">${esc(urgency)}</span>`; }
function renderRepairs() {
  const search=($('#repairSearch')?.value||'').trim().toLowerCase(), status=$('#repairStatusFilter')?.value||'all';
  const filtered=repairs.filter(item=>`${item.ticketNo} ${item.assetCode} ${item.assetName} ${item.issue} ${item.location} ${item.reporterNote||''} ${item.requester} ${item.assignedTo} ${item.status}`.toLowerCase().includes(search)&&(status==='all'||item.status===status));
  const rowMarkup=item=>`<tr><td><button class="link-button ticket-number" data-ticket-detail="${item.id}">${esc(item.ticketNo)}</button><div class="item-meta">${esc(fmtDate(item.createdAt))}${isUserReport(item)?' · จากผู้ใช้':''}</div></td><td><div class="item-name">${esc(item.assetName)}</div><div class="item-meta">${esc(item.issue)}</div></td><td>${esc(item.location)}</td><td>${urgencyBadge(item.urgency)}</td><td>${userReportBadge(item)}${repairBadge(item.status)}</td><td>${esc(item.assignedTo||'—')}</td><td><div class="ticket-row-actions"><button class="button outline mini-action" data-ticket-detail="${item.id}" aria-label="ดูรายละเอียด" title="ดูรายละเอียด"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg></button><button class="button outline mini-action" data-ticket-print="${item.id}" aria-label="พิมพ์เอกสาร" title="พิมพ์เอกสาร"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><path d="M6 14h12v7H6zM18 12h.01"></path></svg></button></div></td></tr>`;
  const body=$('#repairRows'); if(body) body.innerHTML=filtered.length?filtered.map(rowMarkup).join(''):'<tr><td colspan="7" class="empty-cell">ไม่พบ Ticket ที่ตรงกับคำค้น</td></tr>';
  // Overview shows open work first; closed and cancelled tickets only fill leftover rows.
  const count=$('#repairResultCount'); if(count) count.textContent=`แสดง ${filtered.length} จาก ${repairs.length} Ticket`;
  setText('#repairTotal',repairs.length); setText('#repairWaiting',repairs.filter(x=>x.status==='รับแจ้งใหม่').length); setText('#repairPendingApproval',repairs.filter(x=>['รออนุมัติ','รออนุมัติค่าใช้จ่ายจริง'].includes(x.status)).length); setText('#repairActive',repairs.filter(x=>['กำลังซ่อม','รออะไหล่','รอผู้แจ้งยืนยัน','รอมอบหมาย'].includes(x.status)).length);
  $$('#repairRows [data-ticket-detail]').forEach(button=>button.addEventListener('click',()=>openTicket(Number(button.dataset.ticketDetail))));
  $$('[data-ticket-print]',body||document).forEach(button=>button.addEventListener('click',()=>openRepairPrintDialog(Number(button.dataset.ticketPrint))));
}
function setText(id,value) { const el=$(id); if(el) el.textContent=String(value); }
function renderApprovals() {
  const pendingTickets=repairs.filter(item=>['รออนุมัติ','รออนุมัติค่าใช้จ่ายจริง'].includes(item.status)), pendingAssets=approvalAssets;
  setText('#approvalTicketCount',`${pendingTickets.length} รายการ`); setText('#approvalAssetCount',`${pendingAssets.length} รายการ`);
  setText('#approvalTabBadgeTickets', pendingTickets.length); setText('#approvalTabBadgeAssets', pendingAssets.length);
  setText('#approvalKpiTickets', pendingTickets.length); setText('#approvalKpiAssets', pendingAssets.length);
  // The nav badge counts only what this screen lists, so it can be cleared from here.
  setText('#navApprovalBadge', pendingTickets.length + pendingAssets.length);
  const t=$('#approvalTicketRows'); if(t) t.innerHTML=pendingTickets.length?pendingTickets.map(item=>`<tr><td><button class="link-button ticket-number" data-ticket-detail="${item.id}">${esc(item.ticketNo)}</button></td><td>${esc(item.assetName)}<div class="item-meta">${esc(item.status)} · ${esc(item.approvalReason||'ตรวจยอดค่าใช้จ่ายจริง')}</div></td><td>${Number(item.status==='รออนุมัติค่าใช้จ่ายจริง'?item.actualCost:item.estimateCost||0).toLocaleString('th-TH')} บาท</td><td><button class="button outline mini-action" data-ticket-detail="${item.id}">ตรวจสอบ / อนุมัติ</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty-cell">ไม่มี Ticket รออนุมัติ</td></tr>';
  const a=$('#approvalAssetRows'); if(a) a.innerHTML=pendingAssets.length?pendingAssets.map(item=>`<tr><td><span class="code-text">${esc(item.code)}</span></td><td>${esc(item.name)}<div class="item-meta">${esc(item.location)}</div></td><td>${esc(item.createdBy||'—')}</td><td>${currentRole===ROLE_APPROVER?`<button class="button outline mini-action" data-asset-action="approve" data-asset-id="${item.id}">อนุมัติ</button> <button class="button outline mini-action reject" data-asset-action="reject" data-asset-id="${item.id}">ไม่อนุมัติ</button>`:'<span class="item-meta">เลือกบทบาทผู้อนุมัติเพื่อจัดการ</span>'}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-cell">ไม่มีครุภัณฑ์ใหม่รออนุมัติ</td></tr>';
  $$('[data-ticket-detail]',document.querySelector('#view-approvals')||document).forEach(button=>button.addEventListener('click',()=>openTicket(Number(button.dataset.ticketDetail))));
  $$('[data-asset-action]',document.querySelector('#view-approvals')||document).forEach(button=>button.addEventListener('click',()=>handleAssetApproval(button.dataset.assetId,button.dataset.assetAction)));
}
function renderSheet() { const list=$('#surveyList'); if(!list) return; list.innerHTML=sheet.map((item,index)=>`<div class="survey-row"><span class="survey-no">${String(index+1).padStart(2,'0')}</span><div><b>${esc(item.name)}</b><small>${esc(item.detail||'รายการตัวอย่างที่เพิ่มในใบสำรวจ')}</small></div><span class="survey-code">${esc(item.code)}</span></div>`).join(''); const count=$('#surveyItemCount'); if(count) count.textContent=`${sheet.length} รายการ`; }
function renderDepreciation() { const source=liveDepreciationRows||depreciationRows,search=($('#depreciationSearch')?.value||'').trim().toLowerCase(); const filtered=source.filter(row=>`${row.no} ${row.category} ${row.years} ${row.rate} ${row.note||''}`.toLowerCase().includes(search)); const body=$('#depreciationRows'); if(!body)return; body.innerHTML=filtered.length?filtered.map(row=>`<tr><td class="depr-no">${esc(row.no)}</td><td class="depr-category">${esc(row.category)}</td><td>${esc(row.years==='พิจารณาเฉพาะกรณี'?row.years:`${row.years} ปี`)}</td><td>${esc(row.rate==='พิจารณาเฉพาะกรณี'?row.rate:`${row.rate}%`)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-cell">ไม่พบประเภททรัพย์สินที่ค้นหา</td></tr>'; const count=$('#depreciationCount'); if(count)count.textContent=`แสดง ${filtered.length} จาก ${source.length} รายการ · หลักเกณฑ์ตามเอกสารที่นำเข้า`; }
function renderCatalog() { const search=($('#codeSearch')?.value||'').trim().toLowerCase(); const categorySource=liveCategories||archiveCategories; const categories=categorySource.filter(item=>`${item.name} ${item.source||''}`.toLowerCase().includes(search)); const list=$('#archiveCategoryList'); if(list&&!window.govAssetMasterData)list.innerHTML=categories.length?categories.map(item=>`<div class="archive-category"><span class="category-mark" aria-hidden="true">▤</span><div><b>${esc(item.name)}</b><small>เอกสารอ้างอิง: ${esc(item.source||'บัญชีมาตรฐานครุภัณฑ์ภาครัฐ')}</small></div></div>`).join(''):'<div class="category-empty">ไม่พบหมวดหมู่จากชุดข้อมูลแนบ</div>'; const tag=$('.archive-category-panel .sheet-count'); if(tag&&!window.govAssetMasterData)tag.textContent=`${categories.length} หมวด`;
  window.govAssetMasterData?.renderCategories();
  const cards=$('#codeCards'); if(!cards) return;
  if(fsnRows!==null){cards.innerHTML=fsnRows.length?fsnRows.map(item=>{const code=item.fullCode||[item.categoryCode,item.typeCode].filter(Boolean).join('-')||'—';return `<article class="panel code-card"><div class="code-card-top"><h3>${esc(item.name||'รายการไม่ระบุชื่อ')}</h3><span class="fsn-tag">${esc(code)}</span></div><p>${esc(item.groupTitle||`กลุ่มรหัส ${item.categoryCode||'—'}`)}</p><div class="sample-list"><div class="sample-row"><span>${esc(item.sourceTitle||'หมวดมาตรฐานครุภัณฑ์ภาครัฐ')}</span><code>${esc(item.groupTitle||'มาตรฐานจำแนกตามคุณลักษณะและการใช้งาน')}</code></div></div>${item.reference?`<p>${esc(item.reference)}</p>`:''}${/^[0-9]{4}-[0-9]{3}-[0-9]{4}$/.test(item.fullCode||'')?`<button type="button" class="button outline" data-adopt-fsn="${esc(item.fullCode)}" data-fsn-id="${item.id}" data-fsn-name="${esc(item.name)}" data-fsn-kind="${esc(item.sourceKind)}">กำหนดใช้รหัสนี้กับหมวด</button>`:'<p class="field-hint">รหัสอ้างอิงตามต้นฉบับ ยังไม่ใช่รหัสเต็มสำหรับออกเลขประจำชิ้น</p>'}</article>`}).join(''):'<div class="panel code-card">ไม่พบรายการในบัญชี FSN</div>'; let pager=$('#fsnPager');
  if(!pager){pager=document.createElement('div');pager.id='fsnPager';pager.className='fsn-pager';cards.after(pager);}
  const page = Math.floor(fsnOffset/fsnLimit)+1;
  const pages = Math.max(1, Math.ceil(fsnTotal/fsnLimit));
  let fsnOpts = '';
  for(let p=1; p<=pages; p++){ fsnOpts += `<option value="${p}" ${p===page?'selected':''}>หน้า ${p}</option>`; }
  pager.innerHTML = `
    <div class="pager-left">
      <label class="pager-size-control">
        <span>แสดง:</span>
        <select id="fsnLimitSelect" class="pager-select" aria-label="จำนวนแถวต่อหน้า">
          <option value="20" ${fsnLimit===20?'selected':''}>20 รายการ</option>
          <option value="50" ${fsnLimit===50?'selected':''}>50 รายการ</option>
          <option value="100" ${fsnLimit===100?'selected':''}>100 รายการ</option>
        </select>
        <span>ต่อหน้า</span>
      </label>
      <span class="pager-info">บัญชีอ้างอิงทั้งหมด <strong>${fsnTotal.toLocaleString('th-TH')}</strong> รายการ</span>
    </div>
    <div class="pager-nav">
      <button type="button" class="pager-btn" id="fsnFirst" title="หน้าแรก" ${page<=1?'disabled':''}>« หน้าแรก</button>
      <button type="button" class="pager-btn" id="fsnPrev" title="ก่อนหน้า" ${page<=1?'disabled':''}>‹ ก่อนหน้า</button>
      <div class="pager-page-picker">
        <select id="fsnPageSelect" class="pager-select" aria-label="เลือกหน้า">${fsnOpts}</select>
        <span>/ ${pages.toLocaleString('th-TH')}</span>
      </div>
      <button type="button" class="pager-btn" id="fsnNext" title="ถัดไป" ${page>=pages?'disabled':''}>ถัดไป ›</button>
      <button type="button" class="pager-btn" id="fsnLast" title="หน้าสุดท้าย" ${page>=pages?'disabled':''}>หน้าสุดท้าย »</button>
    </div>
  `;
  $('#fsnLimitSelect')?.addEventListener('change', e=>{ fsnLimit=Number(e.target.value); loadFsn(0); });
  $('#fsnFirst')?.addEventListener('click', ()=>loadFsn(0));
  $('#fsnPrev')?.addEventListener('click', ()=>loadFsn(Math.max(0, fsnOffset - fsnLimit)));
  $('#fsnNext')?.addEventListener('click', ()=>loadFsn(fsnOffset + fsnLimit));
  $('#fsnLast')?.addEventListener('click', ()=>loadFsn((pages - 1) * fsnLimit));
  $('#fsnPageSelect')?.addEventListener('change', e=>loadFsn((Number(e.target.value) - 1) * fsnLimit));
  } else {const filtered=codeCatalog.filter(group=>`${group.code} ${group.title} ${group.desc} ${group.items.map(item=>item.name).join(' ')}`.toLowerCase().includes(search));cards.innerHTML=filtered.length?filtered.map(group=>`<article class="panel code-card"><div class="code-card-top"><h3>${esc(group.title)}</h3><span class="fsn-tag">${esc(group.code)}</span></div><p>${esc(group.desc)}</p><div class="sample-list">${group.items.map(item=>`<div class="sample-row"><span>${esc(item.name)}</span><code>${esc(item.code)}</code></div>`).join('')}</div></article>`).join(''):'<div class="panel code-card">ไม่พบหมวดตัวอย่างตามคู่มือที่ค้นหา</div>';}
}
async function loadFsn(offset=0){fsnOffset=Math.max(0,offset);try{const q=$('#codeSearch')?.value||'';const params=new URLSearchParams({q,limit:String(fsnLimit),offset:String(fsnOffset)});const result=await api(`/api/catalog/fsn?${params}`);fsnRows=result.items;fsnTotal=result.total;renderCatalog();}catch(error){showError(error);}}
let currentView='dashboard';
const viewHistory=[];

function switchView(name, isBack=false) {
  if (!document.getElementById(`view-${name}`)) return;
  if (!isBack && currentView && currentView !== name) {
    viewHistory.push(currentView);
  }
  currentView = name;

  const parents={equipment:'settings','access-admin':'settings','operational-master':'settings','supply-settings':'settings',administration:'settings',register:'assets',survey:'assets',codes:'settings',numbering:'settings',depreciation:'settings',stickers:'settings'};
  const activeMenu=parents[name]||name;
  $$('.view').forEach(section=>section.classList.toggle('active',section.id===`view-${name}`));
  $$('.nav-item[data-view]').forEach(button=>{
    const active=button.dataset.view===activeMenu;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  const titles={equipment:'บัญชีอุปกรณ์และนำเข้าทะเบียน','access-admin':'ผู้ใช้งานและสิทธิ์','operational-master':'ข้อมูลหลักหน่วยงาน',supply:'รับเข้า / เบิกจ่าย','supply-settings':'เงื่อนไขรับเข้าและเบิกจ่าย',administration:'ตั้งหมวดและค่าเสื่อม',work:'PM / ตรวจนับครุภัณฑ์',settings:'ตั้งค่า',dashboard:'ภาพรวม',assets:'ทะเบียนครุภัณฑ์',repairs:'แจ้งซ่อมและติดตามงาน',approvals:'คิวรออนุมัติ',register:'เอกสารทะเบียนคุมทรัพย์สิน',stickers:'แบบสติกเกอร์และการพิมพ์',depreciation:'อายุใช้งานและค่าเสื่อม',survey:'สำรวจและออกเลข',codes:'หมวดและเอกสารอ้างอิง',numbering:'จัดการเลขครุภัณฑ์'};
  const title=titles[name]||'ภาพรวม';
  $('#crumbCurrent').textContent=parents[name]?`${titles[activeMenu]} / ${title}`:title;
  document.title=`${title} — ${window.govAssetBranding?.appName || 'Smart Asset'}`;

  // Update prominent global back button in topbar: ONLY for subpages
  const backBtn = $('#globalBackBtn');
  if (backBtn) {
    if (parents[name]) {
      const parentView = parents[name];
      const parentTitle = titles[parentView] || 'หน้าเดิม';
      backBtn.hidden = false;
      const textEl = backBtn.querySelector('.back-text');
      if (textEl) textEl.textContent = `ย้อนกลับ (${parentTitle})`;
    } else {
      backBtn.hidden = true;
    }
  }

  document.dispatchEvent(new CustomEvent('govasset:view-changed',{detail:{name}}));
  window.scrollTo({top:0,behavior:'smooth'});
}

function openCategory(categoryId, categoryName) {
  const filter=$('#categoryFilter');
  if(!filter)return;
  const id=String(categoryId||'');
  let option=id?[...filter.options].find(item=>item.value===id):null;
  if(!option){
    const name=String(categoryName||'').trim();
    if(!name)return;
    const value=id||name;
    option=[...filter.options].find(item=>item.value===value);
    if(!option){option=document.createElement('option');option.value=value;option.textContent=name;filter.append(option);}
  }
  filter.value=option.value;
  if($('#assetSearch'))$('#assetSearch').value='';
  if($('#statusFilter'))$('#statusFilter').value='all';
  smartFilterMultiKeys.forEach(key=>smartFilterCommitted[key]=[]);
  smartFilterDraft=cloneSmartFilter(smartFilterCommitted);
  if($('#smartFilterSearch'))$('#smartFilterSearch').value='';
  renderSmartFilterMenu();
  switchView('assets');
  loadInventory(0);
}

function goBack() {
  if (viewHistory.length > 0) {
    const prev = viewHistory.pop();
    switchView(prev, true);
  } else {
    const parents={equipment:'settings','access-admin':'settings','operational-master':'settings','supply-settings':'settings',administration:'settings',register:'assets',survey:'assets',codes:'settings',numbering:'settings',depreciation:'settings',stickers:'settings'};
    const parent = parents[currentView] || 'dashboard';
    switchView(parent, true);
  }
}

function actionMarkup(ticket) {
  const status=ticket.status, role=currentRole;
  if(role===ROLE_OFFICER&&status==='รับแจ้งใหม่') return `<div class="action-form"><p>${isUserReport(ticket)?'ผู้ใช้แจ้งผ่าน QR ได้แล้ว แต่ยังไม่รู้ว่าเป็นปัญหาจริงหรือไม่ ตรวจก่อนจึงรับเป็นงานซ่อม หรือปิดว่าแจ้งไม่จริง':'ตรวจอาการและเลือกว่าต้องขออนุมัติก่อนหรือไม่'}</p><label>ประมาณการค่าใช้จ่าย (บาท)<input id="estimateCost" type="number" min="0" step="0.01" value="0"></label><label class="check-label"><input id="requiresPurchase" type="checkbox"> ต้องซื้ออะไหล่</label><label class="check-label"><input id="requiresExternal" type="checkbox"> ส่งซ่อม/จ้างภายนอก</label><label class="check-label"><input id="requiresReplacement" type="checkbox"> พิจารณาทดแทน/จำหน่าย</label><label class="check-label"><input id="approvalRequired" type="checkbox"> ส่งขออนุมัติ (ระบุเอง)</label><label>หมายเหตุคัดกรอง<input id="reviewNote" maxlength="500" placeholder="เหตุผล ขอบเขตงาน หรือทำไมจึงแจ้งไม่จริง"></label><div class="dialog-actions">${isUserReport(ticket)?'<button class="button outline reject" data-ticket-action="dismiss">ไม่ใช่การแจ้งจริง</button>':''}<button class="button primary" data-ticket-action="review">${isUserReport(ticket)?'รับเป็นงานซ่อมจริง':'บันทึกผลคัดกรอง'}</button></div><small>ระบบจะส่งเข้าคิวอนุมัติเมื่อเข้าเงื่อนไขหรือยอดประมาณการถึงวงเงิน ${Number(appConfig.approvalThreshold).toLocaleString('th-TH')} บาท</small></div>`;
  if(role===ROLE_APPROVER&&status==='รออนุมัติ') return `<div class="action-form"><p>โปรดพิจารณาเหตุผล/ยอดประมาณการ และบันทึกเหตุผลประกอบการตัดสินใจ</p><label>ความเห็นผู้อนุมัติ<textarea id="approvalNote" rows="3" maxlength="1000" placeholder="ระบุเหตุผลประกอบ"></textarea></label><div class="dialog-actions"><button class="button outline reject" data-ticket-action="reject">ไม่อนุมัติ</button><button class="button primary" data-ticket-action="approve">อนุมัติและส่งมอบหมาย</button></div></div>`;
  if(role===ROLE_APPROVER&&status==='รออนุมัติค่าใช้จ่ายจริง') return `<div class="action-form"><p>ยอดจริง ${Number(ticket.actualCost||0).toLocaleString('th-TH')} บาท สูงกว่าวงเงินหรือยอดที่อนุมัติไว้ ต้องตรวจทานก่อนส่งผู้แจ้งปิดงาน</p><label>ความเห็นผู้อนุมัติ<textarea id="finalCostNote" rows="3" maxlength="1000" placeholder="ระบุเหตุผลประกอบ"></textarea></label><div class="dialog-actions"><button class="button outline reject" data-ticket-action="reject_final_cost">ขอแก้ไขข้อมูลยอดจริง</button><button class="button primary" data-ticket-action="approve_final_cost">อนุมัติยอดจริง</button></div></div>`;
  if(role===ROLE_OFFICER&&status==='รอแก้ไขค่าใช้จ่าย') return `<div class="action-form"><p>ผู้อนุมัติขอข้อมูลเพิ่ม/แก้ไขยอดก่อนตรวจรับงาน</p><label>ยอดค่าใช้จ่ายจริงที่เสนอใหม่<input id="revisionCost" type="number" min="0" step="0.01" value="${Number(ticket.actualCost||0)}"></label><label>คำชี้แจง<textarea id="revisionNote" rows="3" maxlength="1000" placeholder="ระบุรายละเอียดที่แก้ไข"></textarea></label><button class="button primary" data-ticket-action="resubmit_cost">ส่งยอดให้อนุมัติอีกครั้ง</button></div>`;
  if(role===ROLE_OFFICER&&status==='รอมอบหมาย') return `<div class="action-form"><label>มอบหมายให้ช่าง <input id="assignedTo" maxlength="160" placeholder="ชื่อผู้รับผิดชอบ" required></label><label>หมายเหตุ<input id="assignNote" maxlength="500" placeholder="วันนัด/ขอบเขตงาน (ถ้ามี)"></label><button class="button primary" data-ticket-action="assign">มอบหมายและเริ่มงาน</button></div>`;
  if(role===ROLE_TECHNICIAN&&status==='กำลังซ่อม') return `<div class="action-form"><label>ผลการตรวจ/ซ่อม<textarea id="workNotes" rows="3" maxlength="3000" placeholder="บันทึกอาการที่พบ วิธีแก้ และอะไหล่"></textarea></label><label>ค่าใช้จ่ายจริง (บาท)<input id="actualCost" type="number" min="0" step="0.01" value="0"></label><div class="dialog-actions"><button class="button outline" data-ticket-action="wait_parts">บันทึกรออะไหล่</button><button class="button primary" data-ticket-action="complete">ส่งผู้แจ้งตรวจรับ</button></div></div>`;
  if(role===ROLE_TECHNICIAN&&status==='รออะไหล่') return `<div class="action-form"><p>บันทึกเหตุการณ์ใน timeline แล้ว เมื่ออะไหล่พร้อมให้กลับมาดำเนินงานต่อ</p><button class="button primary" data-ticket-action="resume">อะไหล่มาแล้ว · ทำงานต่อ</button></div>`;
  if(role===ROLE_REQUESTER&&status==='รอผู้แจ้งยืนยัน') return `<div class="action-form"><label>ความเห็นผู้แจ้ง (กรณีส่งกลับให้แก้ไขให้ระบุเหตุผล)<textarea id="requesterNote" rows="3" maxlength="1000"></textarea></label><div class="dialog-actions"><button class="button outline" data-ticket-action="send_back">ส่งกลับให้แก้ไข</button><button class="button primary" data-ticket-action="confirm">ยืนยันรับงานและปิด Ticket</button></div></div>`;
  if(status==='รออนุมัติ'&&role!==ROLE_APPROVER) return `<div class="action-form"><p>ใบนี้อยู่คิวผู้อนุมัติ${ticket.approvalReason?` · ${esc(ticket.approvalReason)}`:''} ขั้นตอนถัดไปเป็นของผู้อนุมัติ ไม่ใช่การยกเลิก</p><button type="button" class="button primary" id="switchToApprover">เปิดในบทบาทผู้อนุมัติ</button>${[ROLE_REQUESTER,ROLE_OFFICER].includes(role)?`<label>เหตุผลยกเลิก<textarea id="cancelNote" rows="2" maxlength="1000" placeholder="ระบุสาเหตุ ถ้าต้องการยกเลิกใบนี้"></textarea></label><button class="button outline reject" data-ticket-action="cancel">ยกเลิก Ticket</button>`:''}</div>`;
  if([ROLE_REQUESTER,ROLE_OFFICER].includes(role)&&['รับแจ้งใหม่','รออนุมัติ','รอมอบหมาย','ไม่อนุมัติ'].includes(status)) return `<div class="action-form"><label>เหตุผลยกเลิก<textarea id="cancelNote" rows="2" maxlength="1000" placeholder="ระบุสาเหตุ (จำเป็น)"></textarea></label><button class="button outline reject" data-ticket-action="cancel">ยกเลิก Ticket</button></div>`;
  return `<div class="action-form muted-action">ขั้นตอนนี้ยังไม่เปิดให้บทบาท “${esc(role)}” ดำเนินการ หรือรอผู้เกี่ยวข้องขั้นถัดไป</div>`;
}
async function openTicket(id) {
  try {
    const ticket=await api(`/api/tickets/${id}`); activeTicketId=id;
    const timeline=ticket.events.map(event=>`<li><span class="timeline-dot"></span><div><b>${esc(event.action)} · ${esc(event.actor)}</b><small>${esc(fmtDate(event.createdAt))} ${esc(new Date(event.createdAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}))}</small><p>${esc(event.note||`${event.from_status||'เริ่ม'} → ${event.to_status}`)}</p></div></li>`).join('');
    const ticketPhotos=(ticket.photos||[]).map(photo=>`<a href="${esc(photo.url)}" target="_blank" rel="noopener"><img src="${esc(photo.thumbUrl)}" alt="รูปประกอบ ${esc(ticket.ticketNo)}" loading="lazy"></a>`).join('');
    $('#ticketDialogContent').innerHTML=`<div class="ticket-dialog-inner"><div class="dialog-head"><div><div class="eyebrow">ติดตาม Ticket · ${esc(ticket.ticketNo)}</div><h2 id="ticketDialogTitle">${esc(ticket.assetName)}</h2></div><button type="button" class="dialog-close" data-close-ticket aria-label="ปิด">×</button></div><div class="ticket-status-row">${userReportBadge(ticket)} ${repairBadge(ticket.status)} ${urgencyBadge(ticket.urgency)}<span class="ticket-date">เปิด ${esc(fmtDate(ticket.createdAt))}</span></div><div class="ticket-detail-grid"><div><small>เลข Ticket</small><b>${esc(ticket.ticketNo)}</b></div><div><small>รหัสครุภัณฑ์</small><b>${esc(ticket.assetCode||'—')}</b></div><div><small>ผู้แจ้ง / ช่องทางติดต่อ</small><b>${esc(ticket.requester)} · ${esc(ticket.contact||'—')}</b></div><div><small>สถานที่</small><b>${esc(ticket.location)}</b></div><div class="wide"><small>อาการ</small><b>${esc(ticket.issue)}</b></div>${ticket.reporterNote?`<div class="wide reporter-note"><small>หมายเหตุผู้แจ้ง / ที่ตั้งจริงที่ขอตรวจสอบ</small><b>${esc(ticket.reporterNote)}</b></div>`:''}<div><small>ผู้รับผิดชอบ</small><b>${esc(ticket.assignedTo||'ยังไม่มอบหมาย')}</b></div><div><small>ค่าใช้จ่ายประมาณ / จริง</small><b>${Number(ticket.estimateCost||0).toLocaleString('th-TH')} / ${Number(ticket.actualCost||0).toLocaleString('th-TH')} บาท</b></div>${ticket.approvalRequired?`<div class="wide"><small>เหตุผลที่ต้องอนุมัติ</small><b>${esc(ticket.approvalReason)} · ผู้อนุมัติ ${esc(ticket.approvedBy||'รอดำเนินการ')}</b></div>`:''}${ticket.workNotes?`<div class="wide"><small>ผลซ่อม</small><b>${esc(ticket.workNotes)}</b></div>`:''}${ticket.finalCostApprovalRequired?`<div class="wide"><small>อนุมัติค่าใช้จ่ายจริง</small><b>${esc(ticket.finalCostStatus)} · ${esc(ticket.finalCostApprovedBy||'รอผู้อนุมัติ')}</b></div>`:''}${ticketPhotos?`<div class="wide"><small>รูปถ่ายประกอบ (${(ticket.photos||[]).length} รูป)</small><div class="ticket-photo-gallery">${ticketPhotos}</div></div>`:''}</div><div class="ticket-columns"><section class="timeline-panel"><h3>ประวัติการดำเนินงาน</h3><ol class="ticket-timeline">${timeline||'<li>ยังไม่มีเหตุการณ์</li>'}</ol></section><section class="ticket-actions-panel"><h3>ดำเนินการในฐานะ: ${esc(currentRole)}</h3>${actionMarkup(ticket)}<p id="ticketActionError" role="alert"></p><div class="ticket-dialog-buttons"><label>ประเภทเอกสาร<select class="modal-print-format"><option value="work-order">ใบงาน A4</option><option value="slip">สลิป</option><option value="both">ทั้งคู่</option></select></label><label>ขนาดสลิป<select class="modal-slip-size"><option value="80mm">80 มม.</option><option value="58mm">58 มม.</option></select></label><button class="button outline" data-print-current="${ticket.id}">พิมพ์</button></div></section></div></div>`;
    $('.ticket-dialog-buttons').innerHTML=`<button class="button outline" data-print-current="${ticket.id}">พิมพ์</button>`;
    if(!$('#ticketDialog').open) $('#ticketDialog').showModal();
    $('[data-close-ticket]')?.addEventListener('click',()=>$('#ticketDialog').close());
    $('[data-print-current]')?.addEventListener('click',()=>openRepairPrintDialog(id));
    $('#switchToApprover')?.addEventListener('click',()=>{$('#actorRole').value=ROLE_APPROVER;switchRole(ROLE_APPROVER);});
    $$('[data-ticket-action]').forEach(button=>button.addEventListener('click',()=>runTicketAction(id,button.dataset.ticketAction)));
  } catch(error) { showError(error); }
}
async function runTicketAction(id,action) {
  const panel=$('#ticketDialog .ticket-actions-panel');if(panel?.dataset.saving)return;if(panel)panel.dataset.saving='1';
  const buttons=[...document.querySelectorAll('#ticketDialog [data-ticket-action]')];buttons.forEach(button=>button.disabled=true);
  if(action === 'cancel') {
    const confirmed = await confirmDialog('คุณแน่ใจหรือไม่ที่จะยกเลิก Ticket นี้? การยกเลิกไม่สามารถกู้คืนได้', 'ยืนยันการยกเลิก Ticket');
    if(!confirmed) { delete panel.dataset.saving; buttons.forEach(button=>button.disabled=false); return; }
  }
  const data={action,actor:currentRole};
  if(action==='review') Object.assign(data,{estimateCost:$('#estimateCost')?.value||0,requiresPurchase:$('#requiresPurchase')?.checked,requiresExternal:$('#requiresExternal')?.checked,requiresReplacement:$('#requiresReplacement')?.checked,approvalRequired:$('#approvalRequired')?.checked,note:$('#reviewNote')?.value||''});
  if(action==='approve'||action==='reject') data.note=$('#approvalNote')?.value||'';
  if(action==='approve_final_cost'||action==='reject_final_cost') data.note=$('#finalCostNote')?.value||'';
  if(action==='resubmit_cost') Object.assign(data,{actualCost:$('#revisionCost')?.value||0,note:$('#revisionNote')?.value||''});
  if(action==='assign') Object.assign(data,{assignedTo:$('#assignedTo')?.value||'',note:$('#assignNote')?.value||''});
  if(action==='complete') Object.assign(data,{workNotes:$('#workNotes')?.value||'',actualCost:$('#actualCost')?.value||0});
  if(action==='confirm'||action==='send_back') data.note=$('#requesterNote')?.value||'';
  if(action==='cancel') data.note=$('#cancelNote')?.value||'';
  if(action==='dismiss') data.note=$('#reviewNote')?.value||'ตรวจแล้วไม่ใช่การแจ้งจริง';
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
function openRepairPrintDialog(id) {
  const ticket=repairs.find(item=>item.id===id);
  if(!ticket){showError(new Error('ไม่พบ Ticket สำหรับพิมพ์'));return;}
  const dialog=$('#repairPrintDialog'),form=$('#repairPrintForm');
  form.reset();
  dialog.dataset.ticketId=String(id);
  $('#repairPrintTicketInfo').textContent=`${ticket.ticketNo} · ${ticket.assetName}`;
  $('#repairSlipSizeField').hidden=true;
  dialog.showModal();
}
async function printTicket(id,format='work-order',slipSize='80mm') {
  const summary=repairs.find(item=>item.id===id); if(!summary){showError(new Error('ไม่พบ Ticket สำหรับพิมพ์'));return;}
  const ticket=await api(`/api/tickets/${id}`);
  slipSize=slipSize==='58mm'?'58mm':'80mm';
  const configs={'80mm':{page:'80mm 297mm',margin:'4mm',width:'72mm'},'58mm':{page:'58mm 210mm',margin:'3mm',width:'52mm'}};
  const slip=configs[slipSize],brand=`${esc(window.govAssetBranding?.organization||'ครุภัณฑ์')} · ${esc(window.govAssetBranding?.appName||'Smart Asset')}`;
  const field=(label,value)=>`<div><span>${label}</span><b>${value||'—'}</b></div>`;
  const workOrder=()=>`<section class="repair-work-order"><div class="repair-print-card work-order-card"><header class="repair-print-head"><div class="print-brand-mark">${brand}</div><h1>ใบงานซ่อมบำรุงครุภัณฑ์</h1><div class="print-ticket-no">${esc(ticket.ticketNo)}</div></header><div class="print-status">สถานะ: ${esc(ticket.status)} · ความเร่งด่วน: ${esc(ticket.urgency)}</div><section class="work-order-section"><h2>1. ข้อมูลการแจ้งซ่อม</h2><div class="print-details">${field('วันที่แจ้ง',esc(fmtDate(ticket.createdAt)))}${field('ผู้แจ้ง',esc(ticket.requester))}${field('ช่องทางติดต่อ',esc(ticket.contact||'—'))}${field('สถานที่ตั้ง',esc(ticket.location))}<div class="print-wide"><span>อาการ/รายละเอียดที่แจ้ง</span><b>${esc(ticket.issue)}</b></div>${ticket.reporterNote?`<div class="print-wide"><span>หมายเหตุเพิ่มเติม</span><b>${esc(ticket.reporterNote)}</b></div>`:''}</div></section>${(ticket.photos||[]).length?`<section class="work-order-section"><h2>รูปถ่ายประกอบการแจ้งซ่อม</h2><div class="print-ticket-photos">${ticket.photos.map(photo=>`<figure><img src="${esc(photo.url)}" alt="รูปประกอบ ${esc(ticket.ticketNo)}"></figure>`).join('')}</div></section>`:''}<section class="work-order-section"><h2>2. ข้อมูลครุภัณฑ์และมอบหมายงาน</h2><div class="print-details">${field('ชื่อครุภัณฑ์',esc(ticket.assetName))}${field('รหัสครุภัณฑ์',esc(ticket.assetCode||'—'))}${field('ผู้รับผิดชอบ/ช่าง',esc(ticket.assignedTo||'ยังไม่มอบหมาย'))}${field('สถานะอนุมัติ',esc(ticket.approvalRequired?`${ticket.finalCostStatus||'รอพิจารณา'} · ${ticket.approvedBy||'ยังไม่มีผู้อนุมัติ'}`:'ไม่ต้องขออนุมัติ'))}${field('เหตุผลอนุมัติ',esc(ticket.approvalReason||'—'))}${field('ประมาณการค่าใช้จ่าย',`${Number(ticket.estimateCost||0).toLocaleString('th-TH')} บาท`)}${field('ค่าใช้จ่ายจริง',`${Number(ticket.actualCost||0).toLocaleString('th-TH')} บาท`)}</div></section><section class="work-order-section"><h2>3. ผลการปฏิบัติงาน</h2><div class="work-result">${esc(ticket.workNotes||'ยังไม่ได้บันทึกผลการซ่อม')}</div></section><section class="work-order-section"><h2>4. ประวัติการดำเนินงาน</h2><ol class="print-timeline">${(ticket.events||[]).map(event=>`<li><b>${esc(event.action)} · ${esc(event.actor)}</b><span>${esc(fmtDate(event.createdAt))} · ${esc(event.note||`${event.from_status||'เริ่ม'} → ${event.to_status}`)}</span></li>`).join('')||'<li>ยังไม่มีประวัติ</li>'}</ol></section><div class="print-signatures"><div>ผู้แจ้ง ____________________ วันที่ __________</div><div>ผู้ตรวจรับ ________________ วันที่ __________</div><div>ผู้อนุมัติ _________________ วันที่ __________</div><div>ผู้ปฏิบัติงาน ______________ วันที่ __________</div></div><footer>เอกสารใบงานซ่อมบำรุง · ${esc(ticket.ticketNo)}</footer></div></section>`;
  const receiptSlip=()=>`<section class="repair-slip" style="--paper-width:${slip.width}"><header class="slip-head"><div>${brand}</div><h1>สลิปแจ้งซ่อม</h1><b class="slip-ticket-no">${esc(ticket.ticketNo)}</b></header><div class="slip-status">${esc(ticket.status)} · ${esc(ticket.urgency)}</div><div class="slip-details">${field('วันที่แจ้ง',esc(fmtDate(ticket.createdAt)))}${field('ผู้แจ้ง',esc(ticket.requester))}${field('ติดต่อ',esc(ticket.contact||'—'))}${field('ครุภัณฑ์',esc(ticket.assetName))}${field('รหัสครุภัณฑ์',esc(ticket.assetCode||'—'))}${field('สถานที่',esc(ticket.location))}<div class="slip-wide"><span>อาการที่แจ้ง</span><b>${esc(ticket.issue)}</b></div>${ticket.assignedTo?field('ผู้รับผิดชอบ',esc(ticket.assignedTo)):''}</div><footer>โปรดเก็บเลข Ticket นี้ไว้สำหรับติดตามงาน</footer></section>`;
  let style=$('#dynamicPrintPage'); if(!style){style=document.createElement('style');style.id='dynamicPrintPage';document.head.append(style);} style.textContent=`@media print{@page workorder{size:A4 portrait;margin:12mm}@page slip80{size:${slip.page};margin:${slip.margin}}}`;
  const root=$('#repairPrintArea'); root.className=`repair-print-sheet format-${['slip','both'].includes(format)?format:'work-order'} slip-${slipSize}`;
  root.innerHTML=`${format==='slip'?receiptSlip():workOrder()}${format==='both'?receiptSlip():''}`;
  await Promise.all([...root.querySelectorAll('img')].map(image=>image.decode()));
  const ticketDialog=$('#ticketDialog'),restoreTicketDialog=ticketDialog.open;
  if($('#repairPrintDialog').open)$('#repairPrintDialog').close();
  if(restoreTicketDialog)ticketDialog.close();
  document.body.dataset.printing='ticket';
  window.addEventListener('afterprint',()=>{delete document.body.dataset.printing;root.innerHTML='';if(restoreTicketDialog&&ticketDialog.isConnected)ticketDialog.showModal();},{once:true});
  window.print();
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
function openAssetDialog(options={}) { populateAssetCategoryOptions(liveCategories||[]); $('#assetFormError').textContent='';updateCode(); $('#assetDialog').showModal(); document.dispatchEvent(new CustomEvent('govasset:asset-entry-open',{detail:{preset:options?.preset||null}})); $('#assetCategoryId').focus(); }
let repairSearchTimer=null,repairSearchVersion=0,repairSearchItems=[],selectedRepairAsset=null,repairSubmitting=false,repairPhotoFiles=[];
function resetRepairPhotos(){
  repairPhotoFiles.forEach(photo=>URL.revokeObjectURL(photo.previewUrl));repairPhotoFiles=[];
  $('#repairPhotos').value='';$('#repairPhotoPreviews').replaceChildren();
}
function renderRepairPhotoPreviews(){
  const root=$('#repairPhotoPreviews');
  root.innerHTML=repairPhotoFiles.map((photo,index)=>`<div class="repair-photo-preview"><img src="${photo.previewUrl}" alt="${esc(photo.file.name)}"><span>${esc(photo.file.name)}</span><button type="button" data-remove-repair-photo="${index}" aria-label="นำรูปออก">×</button></div>`).join('');
}
function readDataUrl(blob){
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));reader.readAsDataURL(blob);});
}
async function encodeRepairPhoto(file){
  if(!file.type.startsWith('image/'))throw new Error(`ไฟล์ ${file.name} ไม่ใช่รูปภาพ`);
  const bitmap=await createImageBitmap(file);
  if(bitmap.width*bitmap.height>40_000_000){bitmap.close();throw new Error(`ไฟล์ ${file.name} มีความละเอียดสูงเกินไป`);}
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const image=canvas.toDataURL('image/jpeg',.82);
  const thumbCanvas=document.createElement('canvas'),thumbScale=Math.min(1,320/Math.max(canvas.width,canvas.height));
  thumbCanvas.width=Math.max(1,Math.round(canvas.width*thumbScale));thumbCanvas.height=Math.max(1,Math.round(canvas.height*thumbScale));
  thumbCanvas.getContext('2d').drawImage(canvas,0,0,thumbCanvas.width,thumbCanvas.height);
  return{image,thumb:thumbCanvas.toDataURL('image/jpeg',.72),width:canvas.width,height:canvas.height};
}
function repairSelectionState(){
  const note=$('#repairReporterNote'),missing=Boolean(selectedRepairAsset&&!selectedRepairAsset.location),mismatch=$('#repairLocationMismatch').checked;
  note.required=missing||mismatch;note.setAttribute('aria-required',String(note.required));$('#repairNoteRequired').hidden=!note.required;
  const button=$('#repairForm [type=submit]');button.disabled=repairSubmitting||!selectedRepairAsset;button.dataset.disabledReason=repairSubmitting?'กำลังส่งคำขอ กรุณารอ':selectedRepairAsset?'':'เลือกครุภัณฑ์จากผลค้นหาก่อนส่งคำขอ';
}
function selectRepairAsset(asset){
  clearTimeout(repairSearchTimer);++repairSearchVersion;repairSearchItems=[];selectedRepairAsset=asset;
  $('#repairAsset').value=asset?.name||'';$('#repairAssetCode').value=asset?.code||'';$('#repairLocation').value=asset?.location||'';
  let input=$('#repairForm [name=assetId]');if(asset){if(!input){input=document.createElement('input');input.type='hidden';input.name='assetId';$('#repairForm').append(input);}input.value=asset.id;}else input?.remove();
  $('#repairAssetResults').replaceChildren();$('#repairAssetResults').hidden=true;$('#repairAssetSearch').setAttribute('aria-expanded','false');$('#repairAssetSearch').removeAttribute('aria-activedescendant');
  if(asset){$('#repairAssetSearch').value=`${asset.code||'ยังไม่มีเลข'} · ${asset.name}`;$('#repairSearchStatus').textContent=asset.location?'เลือกรายการแล้ว ที่ตั้งแสดงตามทะเบียน':'ทะเบียนยังไม่มีที่ตั้ง กรุณาระบุที่ตั้งจริงในหมายเหตุเพิ่มเติม';}
  repairSelectionState();
}
function openRepairDialog(asset=null){
  $('#repairForm').reset();resetRepairPhotos();$('#repairFormError').textContent='';$('#repairSearchStatus').textContent='พิมพ์เพื่อค้นทะเบียนที่คุณมีสิทธิ์เข้าถึง แล้วเลือกรายการ';selectRepairAsset(Number.isSafeInteger(asset?.id)?asset:null);
  $('#repairReporter').value=window.govAssetAccess?.session?.user?.name||'';$('#repairDialog').showModal();(selectedRepairAsset?$('#repairIssue'):$('#repairAssetSearch')).focus();
}
async function searchRepairAssets(){
  const q=$('#repairAssetSearch').value.trim(),version=++repairSearchVersion;
  if(!q){$('#repairSearchStatus').textContent='พิมพ์ชื่อหรือเลขครุภัณฑ์ แล้วเลือกรายการ';return;}
  $('#repairSearchStatus').textContent='กำลังค้นทะเบียน…';
  try{const result=await api('/api/assets/search?'+new URLSearchParams({q}));if(version!==repairSearchVersion||!$('#repairDialog').open)return;repairSearchItems=result.items;
    const results=$('#repairAssetResults');results.innerHTML=result.items.map((a,i)=>`<button type="button" role="option" aria-selected="false" id="repair-result-${i}" data-repair-choice="${a.id}"><strong>${esc(a.name)}</strong><span>เลขครุภัณฑ์ ${esc(a.code||'ยังไม่มีเลข')} · ที่ตั้ง ${esc(a.location||'ยังไม่ระบุ')}</span><small>${esc([a.accountName,a.branchName].filter(Boolean).join(' · '))} · ID ${a.id}</small></button>`).join('');results.hidden=!result.items.length;$('#repairAssetSearch').setAttribute('aria-expanded',String(Boolean(result.items.length)));
    $('#repairSearchStatus').textContent=result.items.length?(result.hasMore?'พบมากกว่า 12 รายการ เพิ่มคำค้นเพื่อให้เจาะจง หรือเลือกรายการด้านล่าง':`พบ ${result.items.length} รายการ เลือกชิ้นที่ต้องการแจ้งซ่อม`):'ไม่พบรายการที่มีสิทธิ์เข้าถึง ลองค้นชื่อหรือเลขครุภัณฑ์อื่น';
  }catch(error){if(version===repairSearchVersion)$('#repairSearchStatus').textContent=error.message;}
}


async function loadLocationFacets(){
  const bSel=$('#buildingFilter'),fSel=$('#floorFilter'),rSel=$('#roomFilter');
  if(!bSel||!fSel||!rSel)return;
  try{
    const params=new URLSearchParams(window.govAssetAccountFilters?.()||{});
    const facets=await api(`/api/inventory/facets?${params}`);
    const curB=bSel.value,curF=fSel.value,curR=rSel.value;
    const presetB=['อาคารศูนย์แพทยศาสตรศึกษาชั้นคลินิก','อาคารหอพักนักศึกษาแพทย์','อาคาร 100 ปี การสาธารณสุขไทย','อาคารเฉลิมพระเกียรติ','อาคารอำนวยการ'];
    const allB=[...new Map([...(facets.buildings||[]).map(x=>[x.name,x.count]),...presetB.map(n=>[n,null])]).entries()];
    bSel.innerHTML='<option value="">ทุกอาคาร / ตึก</option><option value="__unassigned__">— ยังไม่ระบุอาคาร —</option>'+allB.map(([n,c])=>`<option value="${esc(n)}">${esc(n)}${c!=null?` (${c.toLocaleString('th-TH')})`:''}</option>`).join('');
    if([...bSel.options].some(o=>o.value===curB))bSel.value=curB;
    const presetF=['ชั้น 1','ชั้น 2','ชั้น 3','ชั้น 4','ชั้น 5','ชั้น 6','ชั้น 7','ชั้น 8','ชั้น 9'];
    const allF=[...new Map([...(facets.floors||[]).map(x=>[x.name,x.count]),...presetF.map(n=>[n,null])]).entries()];
    fSel.innerHTML='<option value="">ทุกชั้น</option><option value="__unassigned__">— ยังไม่ระบุชั้น —</option>'+allF.map(([n,c])=>`<option value="${esc(n)}">${esc(n)}${c!=null?` (${c.toLocaleString('th-TH')})`:''}</option>`).join('');
    if([...fSel.options].some(o=>o.value===curF))fSel.value=curF;
    const presetR=['งานบริหารทั่วไป','งานแพทยศาสตรศึกษา','ห้องเรียนรวม','ห้องปฏิบัติการทักษะทางคลินิก (Skill Lab)','ห้องสมุดศูนย์แพทย์','ห้องประชุมศูนย์แพทย์','ห้องพักอาจารย์แพทย์','ห้องพักนักศึกษาแพทย์'];
    const allR=[...new Map([...(facets.rooms||[]).map(x=>[x.name,x.count]),...presetR.map(n=>[n,null])]).entries()];
    rSel.innerHTML='<option value="">ทุกห้อง / จุดติดตั้ง / งานย่อย</option><option value="__unassigned__">— ยังไม่ระบุห้อง/งานย่อย —</option>'+allR.map(([n,c])=>`<option value="${esc(n)}">${esc(n)}${c!=null?` (${c.toLocaleString('th-TH')})`:''}</option>`).join('');
    if([...rSel.options].some(o=>o.value===curR))rSel.value=curR;
    renderSmartFilterCatalog(facets);
  }catch(error){showError(error);}
}
function openLocationAssignDialog(targetItems){
  const list=Array.isArray(targetItems)&&targetItems.length?targetItems:(inventoryRows||[]);
  if(!list.length){toast('ไม่มีรายการครุภัณฑ์ให้กำหนดตำแหน่ง');return;}
  let dlg=$('#assignLocationDialog');
  if(!dlg){dlg=document.createElement('dialog');dlg.id='assignLocationDialog';dlg.className='smart-modal';document.body.append(dlg);}
  const first=list[0]||{};
  dlg.innerHTML=`<form id="assignLocationForm" style="min-width:min(520px,92vw);padding:20px;">
    <h2 style="margin:0 0 6px;font-size:18px;color:#123d56;">📍 กำหนดอาคาร / ชั้น / ห้อง / งานย่อย</h2>
    <p style="margin:0 0 14px;font-size:12.5px;color:#475569;">แยกโครงสร้างที่ตั้งเพื่อให้กรองค้นหาและดูแลรับผิดชอบภายในหน่วยงานได้ง่าย (${list.length===1?`รหัส <b>${esc(first.code||first.name)}</b>`:`เลือก <b>${list.length} รายการ</b> ในหน้านี้`})</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:600;">อาคาร / ตึก
        <input name="building" list="presetBuildingsList" value="${esc(first.building||'อาคารศูนย์แพทยศาสตรศึกษาชั้นคลินิก')}" placeholder="เช่น อาคารศูนย์แพทยศาสตรศึกษาฯ" style="padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:600;">ชั้น
        <input name="floor" list="presetFloorsList" value="${esc(first.floor||'')}" placeholder="เช่น ชั้น 1, ชั้น 2, ชั้น 3" style="padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:600;">ห้อง / จุดติดตั้ง (เช่น ห้องตรวจ, โถงแอร์)
        <input name="room" list="presetRoomsList" value="${esc(first.room||'')}" placeholder="เช่น ห้องเรียนรวม 1 / โถงชั้น 2" style="padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:600;">งานย่อย / ผู้รับผิดชอบในหน่วยงาน
        <input name="subUnit" value="${esc(first.subUnit||'ศูนย์แพทย์')}" placeholder="เช่น งานแพทยศาสตรศึกษา / งานบริหาร" style="padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;">
      </label>
    </div>
    <datalist id="presetBuildingsList"><option value="อาคารศูนย์แพทยศาสตรศึกษาชั้นคลินิก"><option value="อาคารหอพักนักศึกษาแพทย์"><option value="อาคาร 100 ปี การสาธารณสุขไทย"><option value="อาคารเฉลิมพระเกียรติ"><option value="อาคารอำนวยการ"></datalist>
    <datalist id="presetFloorsList"><option value="ชั้น 1"><option value="ชั้น 2"><option value="ชั้น 3"><option value="ชั้น 4"><option value="ชั้น 5"><option value="ชั้น 6"><option value="ชั้น 7"><option value="ชั้น 8"><option value="ชั้น 9"></datalist>
    <datalist id="presetRoomsList"><option value="ห้องเรียนรวม"><option value="ห้องปฏิบัติการทักษะทางคลินิก (Skill Lab)"><option value="ห้องสมุดศูนย์แพทย์"><option value="ห้องประชุมศูนย์แพทย์"><option value="สำนักงานศูนย์แพทย์"><option value="ห้องพักอาจารย์แพทย์"><option value="ห้องพักนักศึกษาแพทย์"></datalist>
    <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;margin-bottom:14px;"><input type="checkbox" name="updateLocationText" checked> อัปเดตข้อความช่องสถานที่ตั้งหลักให้ตรงกันด้วย</label>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button type="button" class="button outline" data-close-loc>ยกเลิก</button>
      <button type="submit" class="button primary">บันทึกตำแหน่ง (${list.length} รายการ)</button>
    </div>
  </form>`;
  dlg.querySelector('[data-close-loc]').onclick=()=>dlg.close();
  dlg.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);
    try{
      const res=await api('/api/inventory/bulk-location',{method:'POST',body:JSON.stringify({assetIds:list.map(x=>x.id),building:fd.get('building'),floor:fd.get('floor'),room:fd.get('room'),subUnit:fd.get('subUnit'),updateLocationText:fd.get('updateLocationText')==='on'})});
      dlg.close();await loadLocationFacets();await loadInventory(inventoryOffset);toast(`บันทึกตำแหน่ง ตึก/ชั้น/ห้อง แล้ว (${res.updated} รายการ)`);
    }catch(err){showError(err);}
  };
  dlg.showModal();
}

$$('.nav-item[data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
document.addEventListener('click',event=>{const quick=event.target.closest('[data-quick-repair]');if(quick){const item=(inventoryRows||assets).find(a=>a.id===Number(quick.dataset.quickRepair));if(item)openRepairDialog(item);return;}const locBtn=event.target.closest('[data-assign-location]');if(locBtn){const item=(inventoryRows||assets).find(a=>a.id===Number(locBtn.dataset.assignLocation));if(item)openLocationAssignDialog([item]);}});
document.addEventListener('click',event=>{const target=event.target.closest('[data-go-view]');if(target)switchView(target.dataset.goView);const record=event.target.closest('[data-register-id]');if(record)window.govAssetApp.openRegister(Number(record.dataset.registerId));const chip=event.target.closest('[data-remove-filter]');if(chip){const key=chip.dataset.removeFilter,value=chip.dataset.filterValue;if(smartFilterMultiKeys.includes(key))smartFilterCommitted[key]=smartFilterCommitted[key].filter(item=>item!==value);else if(key==='account'){smartFilterCommitted.account='';smartFilterCommitted.branch='';}else smartFilterCommitted.branch='';smartFilterDraft=cloneSmartFilter(smartFilterCommitted);applySmartFilterDraft();}});
$$('[data-open-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.openView)));
$('#assetSearch')?.addEventListener('input',()=>{++inventoryRequest;clearTimeout(inventorySearchTimer);inventorySearchTimer=setTimeout(()=>loadInventory(0),220);});
$('#categoryFilter')?.addEventListener('change',()=>loadInventory(0));
$('#bulkLocationBtn')?.addEventListener('click',()=>openLocationAssignDialog(inventoryRows||[]));
$('#clearAssetFilter')?.addEventListener('click',()=>{
  const search=$('#assetSearch');if(search)search.value='';
  smartFilterMultiKeys.forEach(key=>smartFilterCommitted[key]=[]);
  smartFilterCommitted.account='';smartFilterCommitted.branch='';
  smartFilterDraft=cloneSmartFilter(smartFilterCommitted);
  if($('#smartFilterSearch'))$('#smartFilterSearch').value='';
  applySmartFilterDraft();
});
$('#codeSearch')?.addEventListener('input',()=>{renderCatalog();clearTimeout(fsnSearchTimer);fsnSearchTimer=setTimeout(()=>loadFsn(0),220);});
$('#smartFilterTabs')?.addEventListener('click',event=>{
  const tab=event.target.closest('[data-filter-group]');if(!tab)return;
  smartFilterActiveGroup=tab.dataset.filterGroup;$('#smartFilterSearch').value='';renderSmartFilterMenu();
});
$('#smartFilterSearch')?.addEventListener('input',renderSmartFilterMenu);
$('#smartFilterOptions')?.addEventListener('change',event=>{
  const input=event.target.closest('input');if(!input)return;
  const group=smartFilterActiveGroup;
  const value=input.value;
  if(smartFilterMultiKeys.includes(group)){
    const values=smartFilterDraft[group];
    smartFilterDraft[group]=input.checked?[...new Set([...values,input.value])]:values.filter(value=>value!==input.value);
  }else if(group==='account'){
    smartFilterDraft.account=input.value;
    if(smartFilterDraft.branch&&!smartFilterCatalog.branch.some(item=>item.value===smartFilterDraft.branch&&item.accountId===input.value))smartFilterDraft.branch='';
  }else smartFilterDraft.branch=input.value;
  renderSmartFilterMenu();
  $$('#smartFilterOptions input').find(candidate=>candidate.value===value)?.focus();
});
$('#selectVisibleFilters')?.addEventListener('click',()=>{
  const group=smartFilterActiveGroup;
  const visible=$$('#smartFilterOptions input[type="checkbox"]').map(input=>input.value);
  smartFilterDraft[group]=[...new Set([...smartFilterDraft[group],...visible])];
  renderSmartFilterMenu();
});
$('#clearCurrentFilter')?.addEventListener('click',()=>clearSmartFilterGroup(smartFilterActiveGroup));
$('#clearAllSmartFilters')?.addEventListener('click',()=>{$('#clearAssetFilter')?.click();});
$('#applySmartFilters')?.addEventListener('click',applySmartFilterDraft);
$('#closeSmartFilter')?.addEventListener('click',()=>$('#smartFilterMenu')?.hidePopover());
$('#smartFilterMenu')?.addEventListener('toggle',event=>{
  const open=event.newState==='open';
  $('#smartFilterButton')?.setAttribute('aria-expanded',String(open));
  if(open){smartFilterDraft=cloneSmartFilter(smartFilterCommitted);renderSmartFilterMenu();$('#smartFilterSearch')?.focus({preventScroll:true});requestAnimationFrame(positionSmartFilterMenu);}
});
window.addEventListener('resize',positionSmartFilterMenu);
window.addEventListener('scroll',positionSmartFilterMenu,true);
document.addEventListener('govasset:view-changed',e=>{if(e.detail?.name==='codes'&&(fsnRows===null||fsnRows.length===0))loadFsn(0);});
$('#repairSearch')?.addEventListener('input',renderRepairs); $('#repairStatusFilter')?.addEventListener('change',renderRepairs); $('#depreciationSearch')?.addEventListener('input',renderDepreciation);
$('#actorRole').value=currentRole; $('#actorRole').addEventListener('change',event=>switchRole(event.target.value));
$('#globalBackBtn')?.addEventListener('click', goBack); $('#fontDecrease').addEventListener('click',()=>applyFontScale(fontScale-.05)); $('#fontIncrease').addEventListener('click',()=>applyFontScale(fontScale+.05)); applyFontScale(fontScale);
$('#newRepairButton')?.addEventListener('click',openRepairDialog);
$('#closeRepairDialog').addEventListener('click',()=>$('#repairDialog').close()); $('#cancelRepairDialog').addEventListener('click',()=>$('#repairDialog').close());
$('#repairDialog').addEventListener('click',event=>{if(event.target===$('#repairDialog'))$('#repairDialog').close();});
$('#repairAssetSearch').addEventListener('input',()=>{selectRepairAsset(null);$('#repairSearchStatus').textContent='กำลังรอค้นหา…';repairSearchTimer=setTimeout(searchRepairAssets,250);});
$('#repairAssetResults').addEventListener('click',e=>{const b=e.target.closest('[data-repair-choice]');if(b){selectRepairAsset(repairSearchItems.find(a=>a.id===Number(b.dataset.repairChoice)));$('#repairIssue').focus();}});
$('#repairAssetSearch').addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&repairSearchItems.length){e.preventDefault();$('#repairAssetResults button')?.focus();}else if(e.key==='Enter'&&!selectedRepairAsset){e.preventDefault();clearTimeout(repairSearchTimer);searchRepairAssets();}});
$('#repairAssetResults').addEventListener('keydown',e=>{const buttons=[...$('#repairAssetResults').querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();$('#repairAssetSearch').focus();}});
$('#repairLocationMismatch').addEventListener('change',repairSelectionState);
$('#repairPhotos').addEventListener('change',event=>{
  const files=[...event.currentTarget.files];event.currentTarget.value='';
  const remaining=5-repairPhotoFiles.length;
  if(files.length>remaining){$('#repairFormError').textContent='แนบรูปได้สูงสุด 5 รูปต่อใบแจ้งซ่อม';}
  files.slice(0,remaining).forEach(file=>{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){ $('#repairFormError').textContent=`${file.name}: รองรับเฉพาะ JPG, PNG หรือ WebP`;return; }
    if(file.size>15_000_000){$('#repairFormError').textContent=`${file.name}: ไฟล์ใหญ่เกิน 15 MB`;return;}
    repairPhotoFiles.push({file,previewUrl:URL.createObjectURL(file)});
  });
  renderRepairPhotoPreviews();
});
$('#repairPhotoPreviews').addEventListener('click',event=>{
  const button=event.target.closest('[data-remove-repair-photo]');if(!button)return;
  const [photo]=repairPhotoFiles.splice(Number(button.dataset.removeRepairPhoto),1);if(photo)URL.revokeObjectURL(photo.previewUrl);
  renderRepairPhotoPreviews();
});
$('#repairDialog').addEventListener('close',()=>{clearTimeout(repairSearchTimer);++repairSearchVersion;selectedRepairAsset=null;});
$('#repairForm').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');if(button.disabled)return;
  if(!selectedRepairAsset){$('#repairFormError').textContent='กรุณาเลือกครุภัณฑ์จากผลค้นหา';return;}
  const data=Object.fromEntries(new FormData(form));data.assetId=selectedRepairAsset.id;repairSubmitting=true;button.disabled=true;button.textContent='กำลังเตรียมรูป…';$('#repairFormError').textContent='';
  try{data.photos=await Promise.all(repairPhotoFiles.map(photo=>encodeRepairPhoto(photo.file)));button.textContent='กำลังส่งคำขอ…';const ticket=await api('/api/tickets',{method:'POST',body:JSON.stringify(data)});form.reset();resetRepairPhotos();$('#repairForm input[name="assetId"]')?.remove();$('#repairDialog').close();await refreshData();toast(`เปิด Ticket ${ticket.ticketNo} แล้ว`);switchView('repairs');await openTicket(ticket.id);}catch(error){$('#repairFormError').textContent=error.message;}finally{repairSubmitting=false;button.textContent='ส่งคำขอแจ้งซ่อม';repairSelectionState();}
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
    const asset=await api('/api/assets',{method:'POST',body:JSON.stringify({code:form.get('numberMode')==='manual'?String(form.get('inventoryCode')||'').trim():'',fsnCode,assetType:window.govAssetNumbering?.getType()||'',name:String(form.get('name')).trim(),detail:String(form.get('detail')||'').trim(),categoryId,location:String(form.get('location')||'').trim(),actor:currentRole,...(window.govAssetAccountRegistration?.payload()||{})})});
    $('#assetDialog').close();formElement.reset();updateCode();await refreshData();toast(`ส่งรายการ ${asset.code} เข้าคิวอนุมัติแล้ว`);switchView('approvals');
  }catch(error){$('#assetFormError').textContent=error.message;}finally{button.disabled=false;}
});
$('#exportCsv').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{const all=[];let offset=0,total=Infinity;while(offset<total){const page=await api(`/api/inventory?limit=200&offset=${offset}`);all.push(...page.items);total=page.total;offset+=page.items.length;if(!page.items.length)break;}const rows=[['ชื่อรายการ','รายละเอียด','รหัส FSN','กลุ่ม','หน่วยงาน/ที่ตั้ง','วันที่บันทึก','สถานะ'],...all.map(item=>[item.name,item.detail,item.code,item.group,item.location,fmtDate(item.date),item.status])];const csv='\ufeff'+rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='ทะเบียนครุภัณฑ์-SQLite.csv';link.click();URL.revokeObjectURL(link.href);toast(`ส่งออก ${all.length.toLocaleString('th-TH')} รายการจาก SQLite แล้ว`);}catch(error){showError(error);}finally{button.disabled=false;}});
$('#printSheet').addEventListener('click',()=>window.print()); $('#printRegister').addEventListener('click',()=>{document.body.dataset.printing='register';window.addEventListener('afterprint',()=>delete document.body.dataset.printing,{once:true});window.print();});
$('#manualDialog .manual-content')?.insertAdjacentHTML('afterbegin',`<section><h3>เลือกหมวดครุภัณฑ์</h3><p>ตอนเพิ่มรายการใหม่ ให้เลือกหมวดที่หน่วยงานใช้งาน หากยังไม่มีให้เปิด ตั้งค่า → หมวดและเอกสารอ้างอิง แล้วอ่านคู่มือก่อนสร้างหมวด การเลือกหมวดไม่ได้เลือกหลักเกณฑ์ค่าเสื่อมให้อัตโนมัติ ต้องตรวจให้ตรงตามเกณฑ์ของหน่วยงาน</p></section><section><h3>ค้นข้อมูลแนบและทะเบียนคุม</h3><p>เปิดทะเบียนครุภัณฑ์ ค้นหารายการ แล้วกดใบทะเบียนคุมเพื่อดูที่มาและพิมพ์เอกสารเฉพาะทรัพย์สินนั้น รายการที่นำเข้าจะแสดงไฟล์และแถวต้นทางที่เชื่อมไว้ ระบบจะแสดงเฉพาะข้อมูลที่มีอยู่ในฐานที่กำลังใช้งาน</p></section><section><h3>ออกแบบสติกเกอร์</h3><p>เข้าเมนูสติกเกอร์ ค้นหา/เลือกทรัพย์สินหลายรายการ เลือกหรือสร้างเทมเพลต กำหนดขนาด 5–500 มม. เพิ่ม/ลากข้อความ QR กรอบหรือภาพ และใช้ตัวแปรอย่าง <code>{{AssetNo}}</code>, <code>{{AssetName}}</code>, <code>{{Location}}</code>, <code>{{QrUrl}}</code> กดบันทึกก่อนพิมพ์; แต่ละรายการพิมพ์หนึ่งฉลากตามขนาดจริง ติดที่ตัวเครื่อง Location QR พิมพ์จากตั้งค่า QR Smart แล้วติดที่จุดพื้นที่</p></section>`);
$('#helpBtn').addEventListener('click',()=>$('#manualDialog').showModal()); $('#closeManual').addEventListener('click',()=>$('#manualDialog').close()); $('#manualDialog').addEventListener('click',event=>{if(event.target===$('#manualDialog'))$('#manualDialog').close();});
$('.close-notice')?.addEventListener('click',event=>event.currentTarget.closest('.notice').remove());
$('#ticketDialog').addEventListener('click',event=>{if(event.target===$('#ticketDialog'))$('#ticketDialog').close();});
$('#closeRepairPrintDialog').addEventListener('click',()=>$('#repairPrintDialog').close());
$('#cancelRepairPrint').addEventListener('click',()=>$('#repairPrintDialog').close());
$('#repairPrintDialog').addEventListener('click',event=>{if(event.target===$('#repairPrintDialog'))$('#repairPrintDialog').close();});
$('#repairPrintForm').addEventListener('change',event=>{if(event.target.name==='printFormat')$('#repairSlipSizeField').hidden=event.target.value==='work-order';});
$('#repairPrintForm').addEventListener('submit',event=>{
  event.preventDefault();
  const dialog=$('#repairPrintDialog'),data=new FormData(event.currentTarget),id=Number(dialog.dataset.ticketId);
  const format=data.get('printFormat'),slipSize=data.get('slipSize');
  dialog.close();
  printTicket(id,format,slipSize).catch(showError);
});
applyFontScale(fontScale);
window.govAssetApp={api,toast,showError,refreshData,switchView,openCategory,goBack,fmtDate,openTicket,openRepairDialog,getRole:()=>currentRole,canManageSettings:()=>{const s=window.govAssetAccess?.session;return s?.required?Boolean(s.isAdmin):currentRole===ROLE_OFFICER;},loadFsn,loadLocationFacets,loadInventory,setSmartFilterAccountChoices:syncSmartFilterAccountChoices,openAssetDialog};
refreshData();
