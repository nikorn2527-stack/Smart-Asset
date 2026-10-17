/* Sticker Studio + linked register view. Depends on app.js exposing window.govAssetApp. */
(() => {
  const app = window.govAssetApp;
  if (!app) return;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { assets: [], total: 0, offset: 0, limit: 50, selected: new Map(), templates: [], template: null, selectedElementId: null, settings: {} };
  let searchTimer = null, registerItems = [];
  const elementLabels = {text:'ข้อความ',qr:'QR Code',rect:'กรอบ/แถบสี',image:'ภาพ'};
  const variableMap = {
    AssetNo:'code', AssetName:'name', AssetSiteCode:'code', Serial:'serialNumber', Type:'assetType', Brand:'brand', Model:'model',
    Building:'building', Floor:'floor', Room:'room', Department:'department', DepartmentCode:'departmentCode', Location:'location',
    Site:'organization', ContractNo:'poNo', Vendor:'vendor', DeviceStatus:'status', CurrentAssignee:'', WarrantyEnd:'warrantyEnd',
    PurchaseDate:'acquiredOn', PurchasePrice:'purchasePrice', Ip:'', Mac:'', QrUrl:'code', orgName:'orgName', companyName:'companyName'
  };
  function toast(message) { app.toast(message); }
  function selectedPreviewAsset() { return [...state.selected.values()][0] || state.assets[0] || {code:'รหัสครุภัณฑ์',name:'ชื่อครุภัณฑ์',location:'สถานที่ตั้ง',organization:state.settings.orgName||'หน่วยงาน'}; }
  function previewText(text) {
    const asset = selectedPreviewAsset();
    const values = {...asset, ...state.settings};
    return String(text || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => {
      const field = variableMap[key] || key;
      const value = values[field] ?? values[key] ?? '';
      return String(value ?? '');
    });
  }
  async function loadStickerAssets(offset = 0) {
    state.offset = Math.max(0, offset);
    const q = $('#stickerSearchInput').value.trim();
    const params = new URLSearchParams({q, limit:String(state.limit), offset:String(state.offset)});
    const result = await app.api(`/api/inventory?${params}`);
    state.assets = result.items; state.total = result.total; state.offset = result.offset;
    renderStickerAssets(); renderSelected(); renderPreview();
  }
  function renderStickerAssets() {
    const root = $('#stickerAssetResults');
    root.innerHTML = state.assets.length ? state.assets.map(asset => `<label class="sticker-result-card"><input type="checkbox" data-sticker-asset="${asset.id}" ${state.selected.has(String(asset.id))?'checked':''}><span><b>${esc(asset.name)}</b><small><code>${esc(asset.code||'ไม่ระบุรหัส')}</code> · ${esc(asset.group||'')}<br>${esc(asset.location||'')}</small></span></label>`).join('') : '<div class="empty-cell">ไม่พบรายการครุภัณฑ์</div>';
    const page = Math.floor(state.offset/state.limit)+1, pages = Math.max(1,Math.ceil(state.total/state.limit));
    $('#stickerResultPage').textContent = `หน้า ${page}/${pages} · ${state.total.toLocaleString('th-TH')} รายการ`;
    $('#stickerPrevPage').disabled = state.offset <= 0;
    $('#stickerNextPage').disabled = state.offset + state.limit >= state.total;
    root.querySelectorAll('[data-sticker-asset]').forEach(input => input.addEventListener('change', () => {
      const id = String(input.dataset.stickerAsset), asset = state.assets.find(item => String(item.id) === id);
      if (input.checked && asset) state.selected.set(id, asset); else state.selected.delete(id);
      renderSelected(); renderStickerAssets(); renderPreview();
    }));
  }
  function renderSelected() {
    $('#stickerSelectionCount').textContent = `${state.selected.size} รายการ`;
    $('#stickerSelectedList').innerHTML = state.selected.size ? [...state.selected.values()].slice(0,12).map(item => `<span class="sticker-selected-chip">${esc(item.code||item.name)}</span>`).join('') + (state.selected.size>12?`<span class="sticker-selected-chip">+${state.selected.size-12} รายการ</span>`:'') : 'ยังไม่ได้เลือก';
    $('#printSelectedStickers').disabled = !state.selected.size;
    $('#stickerPrintSummary').textContent = state.selected.size ? `เลือก ${state.selected.size} รายการ · ${Number(state.template?.canvas?.width||75.2).toLocaleString('th-TH')} × ${Number(state.template?.canvas?.height||36).toLocaleString('th-TH')} มม. · หนึ่งฉลากต่อหน้า` : 'เลือกครุภัณฑ์และขนาดแบบก่อนพิมพ์';
  }
  function renderTemplateSelect() {
    const select = $('#stickerTemplateSelect');
    const id = state.template?.id || '';
    select.innerHTML = state.templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.isActive?' · แบบหลัก':''}</option>`).join('');
    if (state.template && !state.templates.some(t => t.id === id)) select.insertAdjacentHTML('beforeend', `<option value="">แบบใหม่ (ยังไม่บันทึก)</option>`);
    select.value = id;
  }
  async function loadStickerTemplates() {
    const result = await app.api('/api/sticker/templates');
    state.templates = result.templates || [];
    state.template = state.templates.find(t => t.id === result.activeId) || state.templates[0] || null;
    if (state.template) selectTemplate(state.template);
  }
  function cloneTemplate(t) { return JSON.parse(JSON.stringify(t)); }
  function selectTemplate(template) {
    state.template = cloneTemplate(template); state.selectedElementId = state.template.elements?.[0]?.id || null;
    $('#stickerTemplateName').value = state.template.name || '';
    $('#stickerCanvasWidth').value = state.template.canvas?.width || 75.2;
    $('#stickerCanvasHeight').value = state.template.canvas?.height || 36;
    $('#stickerOverflowVisible').checked = state.template.overflow === 'visible';
    renderTemplateSelect(); renderElementList(); renderProperties(); renderPreview(); renderSelected();
  }
  function newTemplate() {
    const base = cloneTemplate(state.template || {canvas:{width:75.2,height:36,unit:'mm'},overflow:'clip',elements:[]});
    const oldWidth=Number(base.canvas.width)||75.2, oldHeight=Number(base.canvas.height)||36;
    const width=75.2, height=36, sx=width/oldWidth, sy=height/oldHeight;
    base.id=''; base.name='เทมเพลตใหม่'; base.isDefault=false; base.isActive=false; base.canvas={width,height,unit:'mm'};
    base.elements=(base.elements||[]).map((element,i)=>({...element,id:`new-${Date.now()}-${i}`,x:Number(element.x||0)*sx,y:Number(element.y||0)*sy,width:Number(element.width||5)*sx,height:Number(element.height||5)*sy}));
    selectTemplate(base); toast('สร้างสำเนาใหม่แล้ว ปรับขนาดและองค์ประกอบได้');
  }
  function updateCanvas() {
    if (!state.template) return;
    state.template.canvas.width=Number($('#stickerCanvasWidth').value)||75.2;
    state.template.canvas.height=Number($('#stickerCanvasHeight').value)||36;
    state.template.canvas.unit='mm'; state.template.name=$('#stickerTemplateName').value || 'เทมเพลตใหม่';
    state.template.overflow=$('#stickerOverflowVisible').checked?'visible':'clip';
    renderPreview(); renderSelected();
  }
  function elementName(element) {
    const text=String(element.content||'').replace(/\s+/g,' ').trim();
    return `${elementLabels[element.type]||element.type}${text?` · ${text.slice(0,22)}`:''}`;
  }
  function renderElementList() {
    const root=$('#stickerElementList');
    if (!state.template || !state.template.elements?.length) {root.innerHTML='<span class="item-meta">ยังไม่มีองค์ประกอบ</span>';return;}
    root.innerHTML=state.template.elements.map(el=>`<button type="button" class="sticker-element-chip ${el.id===state.selectedElementId?'selected':''}" data-element-select="${esc(el.id)}">${esc(elementName(el))}</button>`).join('');
    root.querySelectorAll('[data-element-select]').forEach(button=>button.addEventListener('click',()=>selectElement(button.dataset.elementSelect)));
  }
  function selectElement(id) { state.selectedElementId=id; renderElementList(); renderProperties(); renderPreview(); }
  function addElement(type) {
    if (!state.template) return;
    const count=state.template.elements.length;
    const e={id:`el-${Date.now()}-${count}`,type,x:2+(count%4)*2,y:3+(count%4)*2,width:type==='qr'?18:42,height:type==='qr'?18:type==='rect'?8:6,zIndex:count+1,opacity:1};
    if(type==='text')Object.assign(e,{content:'{{AssetNo}}',fontSize:8,fontWeight:700,color:'#123d56',align:'left',valign:'center'});
    if(type==='qr')Object.assign(e,{content:'{{QrUrl}}'});
    if(type==='rect')Object.assign(e,{background:'#e8f5f3',border:'1px solid #147d78',borderRadius:1});
    if(type==='image')Object.assign(e,{content:'',source:'',width:24,height:18});
    state.template.elements.push(e); state.selectedElementId=e.id; renderElementList(); renderProperties(); renderPreview();
  }
  function renderProperties() {
    const root=$('#stickerElementProperties'), el=state.template?.elements?.find(item=>item.id===state.selectedElementId);
    $('#stickerSelectedElementLabel').textContent=el?elementName(el):'เลือกข้อความหรือวัตถุในตัวอย่าง';
    if(!el){root.innerHTML='<p class="item-meta">เลือกองค์ประกอบบนฉลาก หรือกดปุ่มเพิ่มองค์ประกอบ</p>';return;}
    const field=(label,prop,value,type='number',extra='')=>`<label>${label}<input data-element-prop="${prop}" type="${type}" value="${esc(value??'')}" ${extra}></label>`;
    let html=`<div class="sticker-property-grid">${field('X (มม.)','x',el.x,'number','step="0.1"')}${field('Y (มม.)','y',el.y,'number','step="0.1"')}${field('กว้าง (มม.)','width',el.width,'number','min="0.2" step="0.1"')}${field('สูง (มม.)','height',el.height,'number','min="0.2" step="0.1"')}${field('ลำดับชั้น','zIndex',el.zIndex??0,'number','step="1"')}${field('หมุน (องศา)','rotation',el.rotation??0,'number','step="1"')}`;
    if(el.type==='text') html+=`<label class="wide">ข้อความ / ตัวแปร<textarea data-element-prop="content">${esc(el.content||'')}</textarea></label>${field('ขนาดตัวอักษร (pt)','fontSize',el.fontSize??7,'number','min="1" max="72" step="0.5"')}${field('น้ำหนักตัวอักษร','fontWeight',el.fontWeight??500,'number','min="100" max="900" step="100"')}<label>สีตัวอักษร<input data-element-prop="color" type="color" value="${/^#[0-9a-f]{6}$/i.test(el.color||'')?el.color:'#172b3a'}"></label><label>จัดแนว<select data-element-prop="align"><option value="left" ${el.align==='left'?'selected':''}>ซ้าย</option><option value="center" ${el.align==='center'?'selected':''}>กลาง</option><option value="right" ${el.align==='right'?'selected':''}>ขวา</option></select></label>`;
    if(el.type==='qr') html+=`<label class="wide">ข้อความ QR<textarea data-element-prop="content">${esc(el.content||'{{QrUrl}}')}</textarea></label>`;
    if(el.type==='rect') html+=`<label>สีพื้น<input data-element-prop="background" type="color" value="${/^#[0-9a-f]{6}$/i.test(el.background||'')?el.background:'#e8f5f3'}"></label><label>สีเส้น<input data-element-prop="borderColor" type="color" value="${/^#[0-9a-f]{6}$/i.test(el.border||'')?el.border:'#147d78'}"></label>`;
    if(el.type==='image') html+=`<label class="wide">URL ภาพ (https://) <input data-element-prop="source" type="url" value="${esc(el.source||'')}" placeholder="https://..."></label>`;
    html+='</div>'; root.innerHTML=html;
    root.querySelectorAll('[data-element-prop]').forEach(input=>input.addEventListener('input',()=>{
      const key=input.dataset.elementProp; let value=input.value;
      if(input.type==='number')value=Number(value);
      if(key==='borderColor')el.border=`1px solid ${value}`;else el[key]=value;
      renderPreview(); renderElementList();
    }));
  }
  function renderPreview() {
    const root=$('#stickerPreview'); if(!root||!state.template)return;
    const w=Math.max(5,Number(state.template.canvas.width)||75.2),h=Math.max(5,Number(state.template.canvas.height)||36);
    const scale=Math.min(7.5,560/w,330/h),pxW=w*scale,pxH=h*scale;
    $('#stickerCanvasSizeLabel').textContent=`${w.toLocaleString('th-TH')} × ${h.toLocaleString('th-TH')} มม.`;
    const asset=selectedPreviewAsset();
    const nodes=(state.template.elements||[]).slice().sort((a,b)=>(a.zIndex||0)-(b.zIndex||0)).map(el=>{
      const style=`left:${Number(el.x||0)*scale}px;top:${Number(el.y||0)*scale}px;width:${Number(el.width||0)*scale}px;height:${Number(el.height||0)*scale}px;z-index:${Number(el.zIndex||0)};opacity:${Number(el.opacity??1)};transform:rotate(${Number(el.rotation||0)}deg);`;
      const selected=el.id===state.selectedElementId?'selected':'';
      if(el.type==='rect')return `<div class="sticker-preview-node ${selected}" data-preview-id="${esc(el.id)}" style="${style}background:${esc(el.background||'transparent')};border:${esc(el.border||'none')};border-radius:${Number(el.borderRadius||0)*scale}px"></div>`;
      if(el.type==='qr')return `<div class="sticker-preview-node sticker-preview-qr ${selected}" data-preview-id="${esc(el.id)}" style="${style}">QR</div>`;
      if(el.type==='image')return `<img class="sticker-preview-node sticker-preview-image ${selected}" data-preview-id="${esc(el.id)}" style="${style}" src="${/^https:\/\//.test(el.source||'')?esc(el.source):''}" alt="">`;
      const size=Number(el.fontSize||7)*scale*25.4/72, align=el.align||'left';
      return `<div class="sticker-preview-node sticker-preview-text ${selected}" data-preview-id="${esc(el.id)}" style="${style}font-size:${size}px;font-weight:${Number(el.fontWeight||500)};color:${esc(el.color||'#172b3a')};text-align:${align};align-items:${el.valign==='bottom'?'flex-end':el.valign==='center'?'center':'flex-start'};justify-content:${align==='center'?'center':align==='right'?'flex-end':'flex-start'}">${esc(previewText(el.content||''))}</div>`;
    }).join('');
    root.innerHTML=`<div class="sticker-preview-canvas" style="width:${pxW}px;height:${pxH}px;overflow:${state.template.overflow==='visible'?'visible':'hidden'}">${nodes}</div>`;
    root.querySelectorAll('[data-preview-id]').forEach(node=>{
      node.addEventListener('pointerdown',event=>startDrag(event,node.dataset.previewId,scale));
      node.addEventListener('click',event=>{event.stopPropagation();selectElement(node.dataset.previewId);});
    });
  }
  function startDrag(event,id,scale) {
    if(event.button!==0)return;
    const element=state.template.elements.find(e=>e.id===id);if(!element)return;
    state.selectedElementId=id; const sx=event.clientX,sy=event.clientY,ox=Number(element.x||0),oy=Number(element.y||0);
    const move=e=>{element.x=Math.round((ox+(e.clientX-sx)/scale)*10)/10;element.y=Math.round((oy+(e.clientY-sy)/scale)*10)/10;const node=$(`[data-preview-id="${CSS.escape(id)}"]`);if(node){node.style.left=`${element.x*scale}px`;node.style.top=`${element.y*scale}px`;}};
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);renderElementList();renderProperties();};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});event.preventDefault();
  }
  async function saveTemplate(active=false) {
    if(!state.template)return;
    updateCanvas(); state.template.name=$('#stickerTemplateName').value.trim()||'เทมเพลตใหม่';
    try {const saved=await app.api('/api/sticker/templates',{method:'POST',body:JSON.stringify({template:state.template,isActive:active||Boolean(state.template.isActive)})});state.template=saved;const existing=state.templates.findIndex(t=>t.id===saved.id);if(existing>=0)state.templates[existing]=saved;else state.templates.unshift(saved);renderTemplateSelect();selectTemplate(saved);toast(active?'บันทึกและตั้งเป็นแบบหลักแล้ว':'บันทึกเทมเพลตแล้ว');return true;}
    catch(error){app.showError(error);return false;}
  }
  async function printSelected() {
    if(!state.selected.size||!state.template)return;
    try {
      if(!await saveTemplate(false))return;
      const result=await app.api('/api/sticker/bulk-render',{method:'POST',body:JSON.stringify({assetIds:[...state.selected.keys()],templateId:state.template.id||undefined,requestedBy:'ผู้ปฏิบัติงาน (ทดสอบ)'})});
      const iframe=document.createElement('iframe');iframe.style.position='fixed';iframe.style.width='0';iframe.style.height='0';iframe.style.opacity='0';iframe.style.border='0';iframe.setAttribute('aria-hidden','true');document.body.appendChild(iframe);
      const doc=iframe.contentWindow.document;doc.open();doc.write(result.html);doc.close();
      setTimeout(()=>{try{iframe.contentWindow.focus();iframe.contentWindow.print();toast(`เตรียมพิมพ์ ${result.count} ฉลากแล้ว · บันทึกงานพิมพ์ #${result.jobId}`);setTimeout(()=>iframe.remove(),1200);}catch(e){iframe.remove();app.showError(e);}},500);
    } catch(error){app.showError(error);}
  }
  async function loadRegisterOptions(q='',preferredId=null) {
    try {
      const params=new URLSearchParams({q,limit:'50'});const data=await app.api(`/api/inventory?${params}`);registerItems=data.items||[];
      const select=$('#registerAssetSelect');
      select.innerHTML=registerItems.map(item=>`<option value="${item.id}">${esc(item.code||'ไม่มีรหัส')} · ${esc(item.name)}</option>`).join('');
      if(preferredId&&registerItems.some(i=>String(i.id)===String(preferredId)))select.value=String(preferredId);
      if(select.value)await loadRegister(Number(select.value));
    } catch(error){app.showError(error);}
  }
  async function initRegister() {
    try {
      const [featured,list]=await Promise.all([app.api('/api/register/featured').catch(()=>null),app.api('/api/inventory?limit=50')]);
      registerItems=list.items||[];
      if(featured?.asset&&!registerItems.some(i=>String(i.id)===String(featured.asset.id)))registerItems.unshift(featured.asset);
      const select=$('#registerAssetSelect');select.innerHTML=registerItems.map(item=>`<option value="${item.id}">${esc(item.code||'ไม่มีรหัส')} · ${esc(item.name)}</option>`).join('');
      const preferred=featured?.asset?.id??registerItems[0]?.id;if(preferred){select.value=String(preferred);await loadRegister(Number(preferred),featured||null);}
    } catch(error){app.showError(error);}
  }
  const findValue=(root,label)=>[...root.querySelectorAll('.register-org div,.register-meta-grid div')].find(node=>node.querySelector('span')?.textContent.trim()===label)?.querySelector('b');
  function setLabel(label,value){const node=findValue($('.register-paper'),label);if(node)node.textContent=value??'';}
  const fmtMoney=value=>value==null||value===''?'':Number(value).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
  function formatRegisterDate(value,fiscalYear=''){
    const text=String(value??'').trim();if(!text)return{label:'',year:String(fiscalYear||'')};
    const match=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
    if(!match){const year=String(fiscalYear||'');return{label:year&&text.endsWith(year)?text.slice(0,-year.length).trim():text,year};}
    const months=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const rawYear=Number(match[1]);return{label:`${Number(match[3])} ${months[Number(match[2])-1]||''}`,year:String(fiscalYear||(rawYear>=2400?rawYear:rawYear+543))};
  }
  async function loadRegister(id,featured=null) {
    try {
      const data=featured||await app.api(`/api/assets/${id}/register`),a=data.asset||{},r=data.register||{},acq=(data.acquisitions||[]).at(-1)||{},dep=(data.depreciationSnapshots||[]).at(-1)||{};
      const org=r.organization_name||a.organization||'หน่วยงานตัวอย่าง',dept=r.department_name||a.department||a.responsibleUnit||'',name=r.description||a.name||'',code=r.asset_code_printed||a.code||'';
      setLabel('ส่วนราชการ',org);setLabel('หน่วยงาน',dept);setLabel('ประเภท',r.asset_type||a.assetType||a.group);setLabel('รหัส',code);setLabel('ลักษณะ/คุณสมบัติ',name);setLabel('รุ่น/แบบ',r.model||acq.model||a.model);setLabel('สถานที่ตั้ง/หน่วยงานรับผิดชอบ',r.location||a.location);setLabel('ชื่อผู้ขาย/ผู้รับจ้าง/ผู้บริจาค',r.vendor_name||acq.vendor_name||a.vendor);setLabel('ที่อยู่',r.vendor_address||acq.vendor_address);setLabel('โทร.',r.vendor_phone||acq.vendor_phone);setLabel('เลขที่ GFMIS',r.gfmis_no||acq.gfmis_no||a.gfmisNo);setLabel('เลขที่ PO',r.po_no||acq.po_no||a.poNo);setLabel('S/N',r.serial_number||acq.serial_number||a.serialNumber);setLabel('สิ้นสุดประกัน',r.warranty_end||acq.warranty_end||a.warrantyEnd);setLabel('ปีงบที่ได้มา',r.fiscal_year_th||acq.fiscal_year_th||a.fiscalYear);setLabel('ประเภทเงิน',r.fund_type||acq.fund_type||a.fundType);setLabel('วิธีการได้มา',r.acquisition_method||acq.acquisition_method||a.acquisitionMethod);
      const acquired=acq.acquired_on||a.acquiredOn||'';const year=acq.fiscal_year_th||a.fiscalYear||'';const dateParts=formatRegisterDate(acquired,year);const documentNo=acq.document_no||r.po_no||r.gfmis_no||'';const qty=acq.quantity??'';const unit=acq.unit_price??acq.total_price??a.purchasePrice;const total=acq.total_price??unit;const usefulLife=dep.useful_life_years??a.usefulLifeYears;const note=r.notes||r.note||r.remarks||acq.notes||acq.note||acq.remarks||dep.notes||dep.note||'';const tbody=$('.register-table tbody');
      tbody.innerHTML=`<tr><td>${esc(dateParts.label)}${dateParts.year?`<br><small>${esc(dateParts.year)}</small>`:''}</td><td>${esc(documentNo)}</td><td>${esc(name)}</td><td>${esc(qty)}</td><td>${esc(fmtMoney(unit))}</td><td>${esc(fmtMoney(total))}</td><td>${usefulLife?`${esc(usefulLife)} ปี`:''}</td><td>${esc(fmtMoney(dep.monthly_depreciation??a.monthlyDepreciation))}</td><td>${esc(fmtMoney(dep.annual_depreciation??a.annualDepreciation))}</td><td>${esc(fmtMoney(dep.accumulated_depreciation??a.accumulatedDepreciation))}</td><td>${esc(fmtMoney(dep.net_book_value??a.netBookValue))}</td><td>${esc(note)}</td></tr>`;
      const sourceNames=[...new Set([r.source_filename,acq.source_filename,dep.source_filename,...(data.sourceRows||[]).map(x=>x.source_filename)].filter(Boolean))];
      $('#registerSourceInfo').textContent=sourceNames.length?`เชื่อมจาก ${sourceNames.join(' · ')} · ${data.sourceRows?.length||0} แถวต้นทาง`:(r.id?'เชื่อมข้อมูลทะเบียนแล้ว':'ไม่มีแถวทะเบียน PDF ที่จับคู่ได้; แสดงข้อมูลครุภัณฑ์เท่าที่มี');
      const footnote=$('.register-footnote');if(footnote)footnote.textContent=sourceNames.length?`แหล่งข้อมูลที่เชื่อม: ${sourceNames.join(' · ')} · ค่าในช่องคำนวณ/อ่านจากเอกสารต้นทาง โปรดตรวจทานกับต้นฉบับก่อนใช้งานจริง`:'ข้อมูลสาธิตจากฐาน SQLite · ช่องที่ไม่มีข้อมูล acquisition/depreciation เว้นว่าง';
      const provenance={asset:{id:a.id,code:a.code,name:a.name,sourceDocumentId:a.sourceDocumentId,sourceRowNo:a.sourceRowNo},sourceRows:data.sourceRows||[],acquisitions:data.acquisitions||[],depreciationSnapshots:data.depreciationSnapshots||[],fsnMatches:data.fsnMatches||[]};
      $('#registerSourceJson').textContent=JSON.stringify(provenance,null,2);
      window.govAssetRegisterData=data;document.dispatchEvent(new CustomEvent('govasset:register-loaded',{detail:data}));
    } catch(error){app.showError(error);}
  }
  async function saveStickerSettings() {
    try {state.settings=await app.api('/api/sticker/settings',{method:'POST',body:JSON.stringify({orgName:$('#stickerOrgName').value,hotline:$('#stickerHotline').value})});renderPreview();toast('บันทึกข้อมูลที่แสดงบนฉลากแล้ว');}catch(error){app.showError(error);}
  }
  $('#stickerSearchForm').addEventListener('submit',event=>{event.preventDefault();loadStickerAssets(0).catch(app.showError);});
  $('#stickerSearchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadStickerAssets(0).catch(app.showError),250);});
  $('#stickerPrevPage').addEventListener('click',()=>loadStickerAssets(Math.max(0,state.offset-state.limit)).catch(app.showError));
  $('#stickerNextPage').addEventListener('click',()=>loadStickerAssets(state.offset+state.limit).catch(app.showError));
  $('#stickerSelectVisible').addEventListener('click',()=>{state.assets.forEach(item=>state.selected.set(String(item.id),item));renderStickerAssets();renderSelected();renderPreview();});
  $('#stickerClearSelection').addEventListener('click',()=>{state.selected.clear();renderStickerAssets();renderSelected();renderPreview();});
  $('#stickerTemplateSelect').addEventListener('change',()=>{const template=state.templates.find(t=>t.id===$('#stickerTemplateSelect').value);if(template)selectTemplate(template);});
  $('#stickerNewTemplate').addEventListener('click',newTemplate);
  $('#stickerTemplateName').addEventListener('input',()=>{if(state.template){state.template.name=$('#stickerTemplateName').value;renderTemplateSelect();$('#stickerTemplateSelect').value=state.template.id||'';}});
  ['stickerCanvasWidth','stickerCanvasHeight','stickerOverflowVisible'].forEach(id=>$('#'+id).addEventListener('input',updateCanvas));
  $('#stickerSaveTemplate').addEventListener('click',()=>saveTemplate(false));$('#stickerSetActive').addEventListener('click',()=>saveTemplate(true));
  $('#stickerAddText').addEventListener('click',()=>addElement('text'));$('#stickerAddQr').addEventListener('click',()=>addElement('qr'));$('#stickerAddRect').addEventListener('click',()=>addElement('rect'));$('#stickerAddImage').addEventListener('click',()=>addElement('image'));
  $('#stickerDeleteElement').addEventListener('click',()=>{if(!state.template||!state.selectedElementId)return;state.template.elements=state.template.elements.filter(e=>e.id!==state.selectedElementId);state.selectedElementId=state.template.elements[0]?.id||null;renderElementList();renderProperties();renderPreview();});
  $('#stickerVariableSelect').addEventListener('change',event=>{const value=event.target.value,el=state.template?.elements?.find(item=>item.id===state.selectedElementId);if(value&&el&&['text','qr'].includes(el.type)){el.content=(el.content||'')+value;renderProperties();renderElementList();renderPreview();}event.target.value='';});
  $('#printSelectedStickers').addEventListener('click',printSelected);
  $('#registerSearchButton').addEventListener('click',()=>loadRegisterOptions($('#registerAssetSearch').value.trim()));
  $('#registerAssetSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();loadRegisterOptions(event.target.value.trim());}});
  $('#registerAssetSelect').addEventListener('change',()=>loadRegister(Number($('#registerAssetSelect').value)));
  $('#saveStickerSettings').addEventListener('click',saveStickerSettings);
  Promise.all([loadStickerTemplates(),loadStickerAssets(0),initRegister(),app.api('/api/sticker/settings').then(data=>{state.settings=data;$('#stickerOrgName').value=data.orgName||'';$('#stickerHotline').value=data.hotline||'';renderPreview();}).catch(app.showError)]).catch(app.showError);
})();
