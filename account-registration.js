/* Scoped registration shares the server's numbering and depreciation selection. */
(() => {
  const app=window.govAssetApp,$=(s,r=document)=>r.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names=window.govAssetGovernance.variables;
  let state=null,policies=[],catalog=[],profile=null,current=null,epoch=0,loading=false,lastContext=null;
  const form=$('#assetForm'),root=document.createElement('section');root.className='account-registration';
  root.innerHTML=`<h3>เจ้าของบัญชีเลขครุภัณฑ์</h3><label for="entryAccount">หน่วยงาน</label><select id="entryAccount" required><option value="">เลือกเจ้าของบัญชีเลข</option><option value="legacy">เลขเดิม / ยังไม่แยกหน่วยงาน</option></select><div id="scopedEntry" hidden><label for="entryBranch">สาขา</label><select id="entryBranch"></select><label for="entryNumberDate">วันที่ออกเลข / เลือกฉบับแบบเลข</label><input id="entryNumberDate" type="date"><label for="entryCatalog">ชนิด / คุณลักษณะในบัญชีหน่วยงาน</label><select id="entryCatalog"><option value="">กรอกค่าตัวแปรเอง</option></select><div id="entryVariables" class="admin-grid"></div><div class="admin-grid"><label>ราคาทุน (บาท)<input id="entryCost" type="number" min="0" step="0.01"></label><label>วันเริ่มคิดค่าเสื่อม / เลือกฉบับหลักเกณฑ์<input id="entryAcquired" type="date"></label></div><details id="entryPolicyException"><summary>ข้อยกเว้นหลักเกณฑ์ค่าเสื่อมรายชิ้น</summary><label>หลักเกณฑ์แทนที่<select id="entryPolicyOverride"><option value="">ใช้ตามที่ผูกไว้</option></select></label><label>เหตุผลข้อยกเว้น<textarea id="entryOverrideReason" maxlength="1000"></textarea></label></details><div id="entryResolution" class="account-resolution" role="status"></div><button class="button outline" id="entryRefreshPreview" type="button">ตรวจเลขและหลักเกณฑ์อีกครั้ง</button></div>`;
  $('.dialog-head',form).after(root);
  $('h3',root).remove();
  const headerGrid=document.createElement('div');headerGrid.className='entry-header-grid';
  const accountLabel=$('label[for=entryAccount]',root);root.insertBefore(headerGrid,accountLabel);
  const accountWrap=document.createElement('div');accountWrap.className='entry-account';accountWrap.append(accountLabel,$('#entryAccount'));headerGrid.append(accountWrap);
  const categoryWrap=document.createElement('div');categoryWrap.className='entry-category';
  categoryWrap.append($('label[for=assetCategoryId]'),$('#assetCategoryId'),$('#assetCategoryHelp'));headerGrid.append(categoryWrap);
  root.insertBefore($('label[for=assetNumberMode]'),$('#scopedEntry'));root.insertBefore($('#assetNumberMode'),$('#scopedEntry'));root.insertBefore($('#manualAssetCodeField'),$('#scopedEntry'));
  const variableDetails=document.createElement('details');variableDetails.id='entryVariableDetails';variableDetails.innerHTML='<summary>รายละเอียดรหัส — กรอกเองเมื่อไม่มีชนิดให้เลือก</summary>';$('#entryVariables').before(variableDetails);variableDetails.append($('#entryVariables'));
  const more=document.createElement('details');more.className='entry-more';more.innerHTML='<summary>สาขา วันที่ และข้อยกเว้นเพิ่มเติม</summary>';
  const scopedEntry=$('#scopedEntry');scopedEntry.append(more);
  more.append($('label[for=entryBranch]',root),$('#entryBranch'),$('label[for=entryNumberDate]',root),$('#entryNumberDate'),$('#entryPolicyException'));
  const extras=document.createElement('details');extras.className='entry-more';extras.innerHTML='<summary>รุ่น หมายเลขเครื่อง ผู้ดูแล และประกัน</summary><div class="admin-grid"><label>รุ่น<input id="entryModel" maxlength="160"></label><label>หมายเลขเครื่อง / Serial<input id="entrySerial" maxlength="160"></label><label>ผู้ดูแล<input id="entryCustodian" maxlength="160"></label><label>สิ้นสุดประกัน<input id="entryWarranty" type="date"></label></div>';$('#detailText').after(extras);extras.before($('#entryCost').closest('.admin-grid'));
  function categoryLabels(){const aid=Number($('#entryAccount').value);$('#assetCategoryId').querySelectorAll('option').forEach(o=>{if(!o.value)return;o.dataset.sourceName ||=o.textContent;const alias=state?.categoryLabels?.find(r=>r.account_id===aid&&r.category_id===Number(o.value));o.textContent=alias?.name||o.dataset.sourceName;});}
  function remember(){if(scoped())lastContext={accountId:Number($('#entryAccount').value),branchId:Number($('#entryBranch').value)||null,categoryId:Number($('#assetCategoryId').value)||null};}
  const legacyIds=['assetClassificationFields','numberingBreakdown','numberingEvidence'];
  const scoped=()=>/^[0-9]+$/.test($('#entryAccount').value);
  function payload(){if(!scoped())return {};return {expectedSelection:current?.selectionVersion,accountId:Number($('#entryAccount').value),branchId:$('#entryBranch').value?Number($('#entryBranch').value):null,numberDate:$('#entryNumberDate').value,categoryId:Number($('#assetCategoryId').value),catalogId:$('#entryCatalog').value?Number($('#entryCatalog').value):null,values:Object.fromEntries([...root.querySelectorAll('[data-entry-variable]')].map(i=>[i.dataset.entryVariable,i.value.trim()])),purchasePrice:$('#entryCost').value,acquisitionDate:$('#entryAcquired').value,model:$('#entryModel').value,serialNumber:$('#entrySerial').value,custodian:$('#entryCustodian').value,warrantyEnd:$('#entryWarranty').value,policyOverrideId:$('#entryPolicyOverride').value?Number($('#entryPolicyOverride').value):null,overrideReason:$('#entryOverrideReason').value,fsnCode:'',assetType:catalog.find(c=>c.id===Number($('#entryCatalog').value))?.name||''};}
  function render(){
    const yes=scoped();$('#scopedEntry').hidden=!yes;$('#entryVariableDetails').open=yes&&!$('#entryCatalog').value&&$('#assetNumberMode').value!=='manual';
    if(!yes)return;
    legacyIds.forEach(id=>$('#'+id).hidden=true);$('#generatedCode').parentElement.hidden=true;
    $('#assetClassification').required=false;
    $('#manualAssetCodeField').hidden=$('#assetNumberMode').value!=='manual';$('#manualAssetCode').required=$('#assetNumberMode').value==='manual';
    form.querySelector('button[type=submit]').disabled=loading||!current;
    $('#entryPolicyException').hidden=app.getRole()!=='เจ้าหน้าที่พัสดุ';
  }
  async function context(){
    if(!state||!scoped()){current=null;root.querySelector('#scopedEntry').hidden=true;$('#generatedCode').parentElement.hidden=false;window.govAssetNumbering?.renderPreview();return;}
    const request=++epoch,previousCatalog=$('#entryCatalog').value;current=null;loading=true;render();
    const aid=Number($('#entryAccount').value),bid=Number($('#entryBranch').value)||null,cid=Number($('#assetCategoryId').value),on=$('#entryNumberDate').value;
    const latest=new Map();state.bindings.filter(b=>b.account_id===aid&&b.is_active&&b.effective_from<=on&&(!b.branch_id||b.branch_id===bid)&&(!b.category_id||b.category_id===cid)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from)).forEach(b=>{const key=`${b.branch_id||0}/${b.category_id||0}`;if(!latest.has(key))latest.set(key,b);});const eligible=[...latest.values()].filter(b=>b.profile_id).sort((a,b)=>(Number(!!b.category_id)*2+Number(!!b.branch_id))-(Number(!!a.category_id)*2+Number(!!a.branch_id))||b.effective_from.localeCompare(a.effective_from));
    profile=state.profiles.find(p=>p.id===eligible[0]?.profile_id)||null;
    const prior=Object.fromEntries([...root.querySelectorAll('[data-entry-variable]')].map(i=>[i.dataset.entryVariable,i.value]));
    $('#entryVariables').innerHTML=profile?[...profile.pattern.matchAll(/\{([A-Za-z]+):(\d+)\}/g)].filter(m=>!['seq','year','yearBE','month'].includes(m[1])).map(m=>`<label>${esc(names[m[1]])} · ${Number(m[2])} หลัก<input data-entry-variable="${m[1]}" maxlength="${Number(m[2])}" value="${esc(m[1]==='branch'?state.branches.find(b=>b.id===bid)?.code||'':prior[m[1]]||'')}"></label>`).join(''):'';
    $('#entryResolution').textContent=profile?'เลือกรายการหรือกรอกค่าตัวแปรให้ครบ':'ยังไม่มีแบบเลขที่ผูกกับหน่วยงานและหมวดนี้';
    try{catalog=cid?(await app.api('/api/governance/catalog?'+new URLSearchParams({accountId:aid,categoryId:cid}))).items:[];if(request!==epoch)return;$('#entryCatalog').innerHTML='<option value="">กรอกค่าตัวแปรเอง / ใช้เลขเดิม</option>'+catalog.map(c=>`<option value="${c.id}" ${!c.code?'disabled':''}>${esc(c.name)} · ${c.code?esc(c.code):'รอเติมเลขในตารางหมวด'}</option>`).join('');if(catalog.some(c=>String(c.id)===previousCatalog))$('#entryCatalog').value=previousCatalog;}
    catch(e){if(request===epoch)$('#entryResolution').textContent=e.message;}
    finally{if(request===epoch){loading=false;render();preview();}}
  }
  async function preview(){
    if(!scoped())return;
    if($('#assetNumberMode').value!=='manual'&&(!profile||[...root.querySelectorAll('[data-entry-variable]')].some(i=>!i.value.trim()))){current=null;loading=false;$('#entryResolution').textContent=profile?'เลือกชนิด / แบบอุปกรณ์ก่อน ระบบจะออกเลขให้':'หมวดนี้ยังไม่มีแบบเลข ตั้งหมวดและค่าเสื่อมก่อนเพิ่มอุปกรณ์';render();return;}
    const request=++epoch;loading=true;current=null;render();
    try{const data=await app.api('/api/governance/preview',{method:'POST',body:JSON.stringify({...payload(),manualCode:$('#assetNumberMode').value==='manual'?$('#manualAssetCode').value.trim():'',actor:app.getRole()})});if(request!==epoch)return;current=data;
      $('#entryResolution').innerHTML=`<small>${data.profile.number_kind==='classification'?'เลขจำแนกชนิด':'เลขประจำชิ้น'}</small><strong>${esc(data.code)}</strong><span class="entry-policy-summary">ค่าเสื่อม: ${data.policy?esc(data.policy.category_name):'ยังไม่กำหนด'}</span><details><summary>ดูแบบเลขและเงื่อนไขค่าเสื่อม</summary><p>${esc(data.profile.name)} · รุ่น ${data.profile.version} · เลือกจาก: ${esc(data.matchedScope)}</p><p>${data.profile.number_kind==='classification'?'เลขนี้จำแนกชนิด หลายชิ้นใช้ซ้ำได้ แต่ ID และ QR แยกต่อชิ้น':'เลขประจำชิ้น ห้ามซ้ำในบัญชีหน่วยงาน'}</p><p>ค่าเสื่อม: ${data.policy?`${esc(data.policy.rule_no)} · ${esc(data.policy.category_name)} · ${{annual_rate:'อัตราต่อปี',useful_life:'เส้นตรงตามอายุ',case_by_case:'พิจารณารายกรณี'}[data.policy.calculation_method]}${data.policy.annual_rate_percent!=null?' '+esc(data.policy.annual_rate_percent)+'%':''}${data.policy.useful_life_years?' · '+esc(data.policy.useful_life_years)+' ปี':''}`:'ยังไม่ผูกหลักเกณฑ์ — เก็บรายการได้โดยไม่เดาอัตรา'}</p>${data.overrideReason?`<p>ข้อยกเว้น: ${esc(data.overrideReason)}</p>`:''}<small>เป็นเลขตัวอย่าง ระบบยืนยันและจัดสรรเลขเมื่อบันทึกอีกครั้ง</small></details>`;
    }catch(e){if(request===epoch)$('#entryResolution').textContent=e.message;}finally{if(request===epoch){loading=false;render();}}
  }
  async function load(){try{const [s,p]=await Promise.all([app.api('/api/governance'),app.api('/api/catalog/depreciation')]);state=s;policies=p.items;const old=$('#entryAccount').value;$('#entryAccount').innerHTML='<option value="">เลือกเจ้าของบัญชีเลข</option><option value="legacy">เลขเดิม / ยังไม่แยกหน่วยงาน</option>'+state.accounts.filter(a=>a.is_active).map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');$('#entryAccount').value=old;$('#entryPolicyOverride').innerHTML='<option value="">ใช้หลักเกณฑ์ตามที่ผูกไว้</option>'+policies.filter(p=>p.isActive!==false).map(p=>`<option value="${p.id}">${esc(p.ruleNo)} · ${esc(p.category)}</option>`).join('');}catch(e){$('#entryResolution').textContent=e.message;}}
  async function accountChanged(){categoryLabels();const aid=Number($('#entryAccount').value);$('#entryBranch').innerHTML='<option value="">ไม่ระบุสาขา</option>'+(state?.branches||[]).filter(b=>b.account_id===aid&&b.is_active).map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');$('#entryVariables').replaceChildren();await context();remember();}
  $('#entryAccount').onchange=accountChanged;$('#entryBranch').onchange=()=>{remember();context();};$('#entryNumberDate').onchange=context;$('#assetCategoryId').addEventListener('change',async()=>{$('#entryVariables').replaceChildren();await context();remember();});
  $('#entryCatalog').onchange=()=>{const c=catalog.find(c=>c.id===Number($('#entryCatalog').value));if(c){root.querySelectorAll('[data-entry-variable]').forEach(i=>i.value=c.values[i.dataset.entryVariable]||'');if(!$('#itemName').value.trim())$('#itemName').value=c.name;}preview();};
  let timer;root.addEventListener('input',e=>{if(e.target.matches('[data-entry-variable],#entryOverrideReason,#entryPolicyOverride')){clearTimeout(timer);current=null;render();timer=setTimeout(preview,250);}});$('#entryPolicyOverride').onchange=preview;
  $('#entryAcquired').addEventListener('change',preview);
  $('#entryRefreshPreview').onclick=async()=>{await load();await context();};$('#assetNumberMode').addEventListener('change',preview);$('#manualAssetCode').addEventListener('input',()=>{if(scoped()){current=null;render();clearTimeout(timer);timer=setTimeout(preview,250);}});
  document.addEventListener('govasset:asset-entry-open',async e=>{
    const preset=e.detail?.preset||lastContext;
    if(e.detail?.preset)form.reset();
    $('#entryNumberDate').value=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});$('#entryAccount').value='';$('#entryVariables').replaceChildren();current=null;await load();
    if(preset){$('#entryAccount').value=preset.accountId?String(preset.accountId):'legacy';if(preset.categoryId)$('#assetCategoryId').value=String(preset.categoryId);}
    await accountChanged();
    if(preset&&scoped()){
      if(preset.branchId){$('#entryBranch').value=String(preset.branchId);await context();}
      if(preset.catalogId&&catalog.some(c=>c.id===Number(preset.catalogId))){$('#entryCatalog').value=String(preset.catalogId);const c=catalog.find(c=>c.id===Number(preset.catalogId));root.querySelectorAll('[data-entry-variable]').forEach(i=>i.value=c.values[i.dataset.entryVariable]||'');if(!$('#itemName').value.trim())$('#itemName').value=c.name;}
      else if(preset.values){root.querySelectorAll('[data-entry-variable]').forEach(i=>i.value=preset.values[i.dataset.entryVariable]||'');}
      $('#assetNumberMode').value='auto';$('#manualAssetCode').value='';await preview();remember();
    }
    if(preset){
      if(!scoped()&&e.detail?.preset)await window.govAssetNumbering?.loadPreset(preset.fsnCode||'',preset.assetType||'');
      for(const [key,id] of Object.entries({name:'itemName',detail:'detailText',location:'location',purchasePrice:'entryCost',model:'entryModel'})){if(preset[key]!=null)$('#'+id).value=preset[key];}
    }
    document.dispatchEvent(new CustomEvent('govasset:asset-entry-ready'));
    if(e.detail?.preset)(scoped()&&!current?$('#entryCatalog'):$('#itemName')).focus();
  });
  window.govAssetAccountRegistration={scoped,payload,render,openWith:preset=>app.openAssetDialog({preset})};
  // Scoped filters are additive; legacy rows remain visible via the explicit option.
  const filterRow=$('#view-assets .filter-row'),filters=document.createElement('div');filters.className='account-inventory-filters';filters.innerHTML='<label>บัญชีหน่วยงาน<select id="inventoryAccount" aria-label="กรองบัญชีหน่วยงาน"><option value="">ทุกบัญชี</option><option value="legacy">ยังไม่แยกหน่วยงาน</option></select></label><label>สาขา<select id="inventoryBranch" aria-label="กรองสาขา"><option value="">ทุกสาขา</option></select></label>';filterRow.before(filters);
  async function filterOptions(){try{const s=await app.api('/api/governance');const value=$('#inventoryAccount').value;$('#inventoryAccount').innerHTML='<option value="">ทุกบัญชี</option><option value="legacy">ยังไม่แยกหน่วยงาน</option>'+s.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');$('#inventoryAccount').value=value;$('#inventoryAccount').onchange=()=>{$('#inventoryBranch').innerHTML='<option value="">ทุกสาขา</option>'+s.branches.filter(b=>b.account_id===Number($('#inventoryAccount').value)).map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');$('#assetSearch').dispatchEvent(new Event('input'));};}catch(e){app.showError(e);}}
  $('#inventoryBranch').onchange=()=>$('#assetSearch').dispatchEvent(new Event('input'));
  window.govAssetAccountFilters=()=>({accountId:$('#inventoryAccount').value,branchId:$('#inventoryBranch').value});
  document.addEventListener('govasset:view-changed',e=>{if(e.detail.name==='assets')filterOptions();});
  load();filterOptions();
  window.govAssetAccountContextMarkup=data=>{
    const n=data.numbering||{},p=data.depreciation?.policy,c=data.calculation;
    return `<section class="account-asset-context"><h3>บัญชีเลขและหลักเกณฑ์ประจำชิ้น</h3><p>เจ้าของบัญชี: ${esc(data.account||'ยังไม่แยกหน่วยงาน')}${data.branch?' · สาขา '+esc(data.branch):''}</p><p>แบบเลข: ${esc(n.profile?.name||'เลขเดิมตามทะเบียน')}${n.profile?' · รุ่น '+n.profile.version:''}${n.manualOriginal?' · เก็บเลขเดิม':''}</p>${n.catalog?.source?`<p>เงื่อนไข / ที่มาของชนิด: ${esc(n.catalog.source)}</p>`:''}<p>ค่าเสื่อม: ${p?`${esc(p.rule_no)} · ${esc(p.category_name)} · ${esc(p.calculation_method)}${p.useful_life_years?' · '+esc(p.useful_life_years)+' ปี':''}${p.annual_rate_percent!=null?' · '+esc(p.annual_rate_percent)+'%':''}`:'ยังไม่มีฉบับหลักเกณฑ์ผูกกับชิ้นนี้ — ยอดนำเข้าคงเดิม'}</p>${data.depreciation?.overrideReason?`<p>เหตุผลข้อยกเว้น: ${esc(data.depreciation.overrideReason)}</p>`:''}${c?.status==='calculated'?`<p>ตัวอย่างถึง ${esc(c.asOf)}: ค่าเสื่อมสะสม ${Number(c.accumulated).toLocaleString('th-TH')} บาท · มูลค่าคงเหลือ ${Number(c.netBookValue).toLocaleString('th-TH')} บาท</p><small>${esc(c.convention)} · คำนวณจากฉบับที่บันทึกกับชิ้นนี้ ไม่เขียนทับยอดต้นทาง</small>`:`<p>${esc(c?.message||'')}</p>`}</section>`;
  };
})();
