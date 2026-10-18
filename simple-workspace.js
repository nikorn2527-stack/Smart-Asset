/* Tables remain compact; category settings and type management open in dialogs. */
(() => {
  const app=window.govAssetApp, gov=window.govAssetGovernance;
  const $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v==null?'—':Number(v).toLocaleString('th-TH',{maximumFractionDigits:2});
  const option=(value,label)=>`<option value="${esc(value)}">${esc(label)}</option>`;
  const numberShape=p=>p?p.pattern.replace(/\{[A-Za-z]+:(\d+)\}/g,'$1')+' · '+(p.number_kind==='classification'?'จำแนกชนิด':'ประจำชิ้น'):'ยังไม่ตั้งแบบเลข';
  const policyName=p=>!p?'ยังไม่กำหนด':`${p.rule_no??p.ruleNo} · ${p.category_name??p.category}${(p.useful_life_years??p.years)?' · '+(p.useful_life_years??p.years)+' ปี':''}${(p.annual_rate_percent??p.annualRate)!=null?' · '+(p.annual_rate_percent??p.annualRate)+'%':''}`;
  let config=null,policies=[],board=null,boardEpoch=0,activeKey='',pendingPolicy=null;
  const account=()=>Number($('#adminAccount').value);
  const section=document.createElement('section');section.dataset.adminSection='overview';section.className='workspace-overview';
  section.innerHTML=`<div class="workspace-toolbar"><label>ค้นหาหมวด<input id="workspaceCategorySearch" type="search" placeholder="เช่น สำนักงาน คอมพิวเตอร์"></label><label>สาขา<select id="workspaceBranch"><option value="">ทุกสาขา / แบบหลัก</option></select></label><label>เริ่มใช้การตั้งค่าวันที่<input id="workspaceRuleDate" type="date"></label><button class="button outline" type="button" id="workspaceAddCategory">＋ เพิ่มหมวด</button></div><p class="field-hint">เลือกตั้งค่าหมวดหรือจัดการชนิดผ่านปุ่มของแต่ละรายการ การตั้งค่าใหม่ไม่เปลี่ยนเลขหรือยอดย้อนหลัง</p><p id="workspaceCategoryStatus" role="status"></p><section class="panel"><div class="table-wrap"><table class="workspace-category-table"><thead><tr><th>หมวดครุภัณฑ์</th><th>ชนิด / อุปกรณ์</th><th>รูปแบบเลขที่ใช้</th><th>หลักเกณฑ์ค่าเสื่อม</th><th>ดำเนินการ</th></tr></thead><tbody id="workspaceCategoryRows"></tbody></table></div></section>`;
  $('#view-administration .admin-account-bar').after(section);
  const overview=document.createElement('button');overview.type='button';overview.dataset.adminTab='overview';overview.textContent='ตั้งหมวดและค่าเสื่อม';overview.onclick=()=>gov.openTab('overview');$('.governance-tabs').prepend(overview);
  const advanced=document.createElement('button');advanced.type='button';advanced.id='administrationAdvanced';advanced.textContent='ขั้นสูง';advanced.setAttribute('aria-expanded','false');$('.governance-tabs').append(advanced);
  advanced.onclick=()=>{const open=advanced.getAttribute('aria-expanded')!=='true';advanced.setAttribute('aria-expanded',String(open));if(!open&&['profiles','bindings','catalog'].some(t=>$(`[data-admin-section="${t}"]`).hidden===false))gov.openTab('overview');};
  $('.governance-tabs').classList.add('simplified-administration');
  $('#workspaceRuleDate').value=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});
  const key=()=>`${account()}/${$('#workspaceBranch').value}/${$('#workspaceRuleDate').value}`;
  async function loadBoard(){
    if(!account())return;
    const request=++boardEpoch,target=key();
    if(activeKey&&activeKey!==target)section.querySelectorAll('dialog[open]').forEach(d=>d.close());$('#workspaceCategoryStatus').textContent='กำลังอ่านหมวดและหลักเกณฑ์…';
    try{
      const [data,state,p]=await Promise.all([app.api('/api/workspace/categories?'+new URLSearchParams({accountId:account(),branchId:$('#workspaceBranch').value,date:$('#workspaceRuleDate').value})),app.api('/api/governance'),app.api('/api/catalog/depreciation')]);
      if(request!==boardEpoch||target!==key())return;
      board=data;config=state;policies=p.items;activeKey=target;renderBoard();$('#workspaceCategoryStatus').textContent=`${data.items.length} หมวด · ${data.items.reduce((n,r)=>n+r.assetCount,0).toLocaleString()} อุปกรณ์ในบัญชี/สาขาที่เลือก`;
    }catch(e){if(request===boardEpoch)$('#workspaceCategoryStatus').textContent=e.message;}
  }
  function renderBoard(){
    const tbody=$('#workspaceCategoryRows');tbody.innerHTML=board.items.map(r=>`<tr data-category-row="${r.id}"><td><strong>${esc(r.name)}</strong></td><td>${r.kindCount.toLocaleString()} ชนิด<br><small>${r.assetCount.toLocaleString()} อุปกรณ์</small></td><td>${esc(numberShape(r.profile))}</td><td>${esc(policyName(r.policy))}</td><td><div class="workspace-row-actions"><button type="button" class="button outline mini-action" data-category-edit="${r.id}">ตั้งค่าหมวด</button><button type="button" class="button outline mini-action" data-category-kinds="${r.id}">ชนิดอุปกรณ์</button><button type="button" class="button primary mini-action" data-category-add-asset="${r.id}">＋ เพิ่มอุปกรณ์</button></div></td></tr>`).join('');
    // Add freshly created profiles/policies without replacing an unfinished row form.
    section.querySelectorAll('.workspace-category-form').forEach(f=>{const current=f.elements.profileChoice.value;f.elements.profileChoice.innerHTML=profileOptions();f.elements.profileChoice.value=current;const policy=f.elements.policyId.value;f.elements.policyId.innerHTML=policyOptions();f.elements.policyId.value=policy;});
    filterBoard();permission();
  }
  function profileOptions(){return option('inherit','ใช้แบบหลักของหน่วยงาน / สาขา')+option('preset:inventory','สำเร็จรูป 4–3–4–4 · เลขประจำชิ้น')+option('preset:fsn','สำเร็จรูป 4–3–4 · เลขจำแนกชนิด')+config.profiles.filter(p=>p.account_id===board.accountId).map(p=>option(p.id,`${p.name} · ${numberShape(p)}`)).join('');}
  function policyOptions(){return option('','ใช้ตามหลักเกณฑ์ระดับหน่วยงาน / สาขา')+policies.filter(p=>p.isActive!==false).map(p=>option(p.id,policyName(p))).join('');}
  function filterBoard(){const q=$('#workspaceCategorySearch').value.trim().toLowerCase();for(const r of board?.items||[]){const row=$(`[data-category-row="${r.id}"]`);if(!row)continue;row.hidden=!`${r.name} ${r.sourceName} ${r.sourceFile}`.toLowerCase().includes(q);}}
  $('#workspaceCategorySearch').oninput=filterBoard;$('#workspaceBranch').onchange=loadBoard;$('#workspaceRuleDate').onchange=loadBoard;
  $('#workspaceAddCategory').onclick=()=>$('#addCategoryBtn')?.click();
  const can=p=>!window.govAssetAccess?.session?.required||Boolean(window.govAssetAccess.session.permissions?.[p]);
  function permission(){const allowed=app.getRole()==='เจ้าหน้าที่พัสดุ'&&can('manage');section.querySelectorAll('[data-write],form button[type=submit],[data-category-edit],[data-edit-kind],[data-new-row-policy],[data-row-profile]').forEach(b=>b.disabled=!allowed||Boolean(b.dataset.sharedId&&window.govAssetAccess?.session?.required&&!window.govAssetAccess.session.isAdmin));section.querySelectorAll('[data-category-add-asset],[data-use-kind]').forEach(b=>{b.disabled=app.getRole()!=='เจ้าหน้าที่พัสดุ'||!can('create')||Boolean(b.dataset.useKind&&!b.dataset.hasCode);});$('#workspaceAddCategory').disabled=!allowed;}

  function openRow(id,tab='settings'){
    const existing=$(`.category-editor-dialog[data-category-id="${id}"]`,section);if(existing){existing.querySelector(`[data-category-panel="${tab}"]`)?.click();return;}
    const r=board.items.find(r=>r.id===id),scope={accountId:board.accountId,branchId:board.branchId,date:board.date},rowKey=activeKey;
    const tr=document.createElement('dialog');tr.className='workspace-editor-dialog category-editor-dialog';tr.dataset.categoryId=id;tr.setAttribute('aria-label','ตั้งค่าหมวดและชนิดอุปกรณ์');tr.addEventListener('close',()=>tr.remove());
    tr.innerHTML=`<div class="workspace-row-detail"><form class="workspace-category-form"><div class="workspace-detail-heading"><h2>${esc(r.name)}</h2><button type="button" class="button outline" data-close-category>ปิดโดยไม่บันทึก</button></div><div class="admin-grid"><label>ชื่อหมวดที่ใช้ในหน่วยงานนี้<input name="name" required maxlength="300" value="${esc(r.name)}"></label><label>ใช้รูปแบบเลข<select name="profileChoice">${profileOptions()}</select></label><label>คิดค่าเสื่อมตาม<select name="policyId">${policyOptions()}</select></label><label>หมายเหตุ / เงื่อนไขหมวด<input name="notes" maxlength="1000" value="${esc(r.notes)}"></label></div><p class="field-hint">ต้นทาง: ${esc(r.sourceName)}${r.sourceFile?' · '+esc(r.sourceFile):''} · ชื่อที่แก้ใช้เฉพาะหน่วยงานนี้</p><div class="workspace-row-actions"><button class="button primary" type="submit">บันทึกการตั้งค่า</button><button class="button outline" type="button" data-new-row-policy>＋ เพิ่มหลักเกณฑ์ค่าเสื่อม</button><button class="button outline" type="button" data-row-profile>ออกแบบเลขอื่น</button></div><p class="workspace-row-status" role="status"></p></form><section class="workspace-row-catalog"><div class="workspace-detail-heading"><h3>ชนิดและคุณลักษณะในหมวดนี้</h3><button class="button outline" type="button" data-new-row-kind data-write>＋ เพิ่มชนิด</button></div><label>ค้นชนิด<input type="search" data-row-kind-search placeholder="ชื่อหรือรหัส"></label><div data-row-kinds></div><dialog class="workspace-editor-dialog workspace-kind-dialog" data-row-kind-editor aria-label="จัดการชนิดอุปกรณ์"></dialog></section></div>`;
    section.append(tr);
    const heading=$('.workspace-detail-heading',tr);tr.prepend(heading);heading.classList.add('workspace-editor-header');
    const tabs=document.createElement('div');tabs.className='workspace-editor-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','ส่วนการจัดการหมวด');
    tabs.innerHTML='<button type="button" role="tab" data-category-panel="settings">ตั้งค่าหมวด เลข และค่าเสื่อม</button><button type="button" role="tab" data-category-panel="kinds">ชนิดอุปกรณ์</button>';heading.after(tabs);const top=document.createElement('header');top.className='workspace-editor-top';top.append(heading,tabs);tr.prepend(top);
    const panels={settings:$('.workspace-category-form',tr),kinds:$('.workspace-row-catalog',tr)};
    function showPanel(name){for(const [key,panel] of Object.entries(panels)){panel.hidden=key!==name;panel.id=`category-${id}-${key}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',`category-${id}-tab-${key}`);}tabs.querySelectorAll('button').forEach(b=>{b.id=`category-${id}-tab-${b.dataset.categoryPanel}`;b.setAttribute('aria-selected',String(b.dataset.categoryPanel===name));b.setAttribute('aria-controls',`category-${id}-${b.dataset.categoryPanel}`);b.tabIndex=b.dataset.categoryPanel===name?0:-1;});}
    tabs.onclick=e=>{const b=e.target.closest('[data-category-panel]');if(b)showPanel(b.dataset.categoryPanel);};
    tabs.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...tabs.querySelectorAll('button')],i=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?1:(i+1)%2;buttons[next].click();buttons[next].focus();};
    showPanel(tab);tr.showModal();
    const form=$('.workspace-category-form',tr);form.elements.profileChoice.value=r.ownBinding?.profile_id?String(r.ownBinding.profile_id):'inherit';form.elements.policyId.value=r.ownBinding?.policy_id?String(r.ownBinding.policy_id):'';
    $('[data-close-category]',tr).onclick=()=>tr.close();
    $('[data-new-row-policy]',tr).onclick=()=>{pendingPolicy={form,ids:new Set(policies.map(p=>p.id))};$('#addDepreciationBtn').click();};
    $('[data-row-profile]',tr).onclick=()=>{tr.close();gov.openTab('profiles');};
    form.onsubmit=async e=>{
      e.preventDefault();const b=$('[type=submit]',form),status=$('.workspace-row-status',form);b.disabled=true;status.textContent='กำลังบันทึก…';
      try{await app.api('/api/workspace/categories',{method:'PUT',body:JSON.stringify({...scope,categoryId:id,version:r.version,name:form.elements.name.value,notes:form.elements.notes.value,profileChoice:form.elements.profileChoice.value,policyId:form.elements.policyId.value?Number(form.elements.policyId.value):null,actor:app.getRole()})});tr.close();if(activeKey===rowKey){await loadBoard();$(`[data-category-edit="${id}"]`)?.focus({preventScroll:true});}app.toast('บันทึกหมวด แบบเลข และค่าเสื่อมแล้ว');}
      catch(error){status.textContent=error.message;}finally{b.disabled=app.getRole()!=='เจ้าหน้าที่พัสดุ';}
    };
    attachCatalog(tr,r,scope);permission();
  }
  async function attachCatalog(tr,r,scope){
    let items=[],page=0,editing=null;
    const root=$('[data-row-kinds]',tr),editor=$('[data-row-kind-editor]',tr);
    async function loadKinds(){try{items=(await app.api('/api/governance/catalog?'+new URLSearchParams({accountId:scope.accountId,categoryId:r.id}))).items;renderKinds();}catch(e){root.textContent=e.message;}}
    function renderKinds(){const q=$('[data-row-kind-search]',tr).value.trim().toLowerCase(),filtered=items.filter(i=>`${i.name} ${i.code}`.toLowerCase().includes(q));page=Math.min(page,Math.max(0,Math.ceil(filtered.length/20)-1));root.innerHTML=`<p class="field-hint">${filtered.length} รายการชนิด / รหัส · หน้า ${page+1}</p><div class="table-wrap"><table><thead><tr><th>ชนิด / คุณลักษณะ</th><th>รหัสตามบัญชี</th><th>ดำเนินการ</th></tr></thead><tbody>${filtered.slice(page*20,(page+1)*20).map(i=>`<tr><td>${esc(i.name)}</td><td><code>${esc(i.code||'รอเติมเลข')}</code></td><td><button class="button outline mini-action" type="button" data-edit-kind="${i.id}" ${i.shared_catalog_id?`data-shared-id="${i.shared_catalog_id}" title="การแก้ไขชนิดกลางใช้สิทธิ์ผู้ดูแลระบบส่วนกลาง"`:""}>แก้ไข</button><button class="button primary mini-action" type="button" data-use-kind="${i.id}" data-has-code="${i.code?'1':''}" ${!i.code?'disabled':''}>＋ อุปกรณ์</button></td></tr>`).join('')||'<tr><td colspan="3">ยังไม่มีชนิดในบัญชีนี้ เพิ่มจากปุ่มด้านบนได้</td></tr>'}</tbody></table></div><div class="workspace-row-actions"><button type="button" class="button outline" data-kind-prev ${page===0?'disabled':''}>ก่อนหน้า</button><button type="button" class="button outline" data-kind-next ${(page+1)*20>=filtered.length?'disabled':''}>ถัดไป</button></div>`;$('[data-kind-prev]',root).onclick=()=>{page--;renderKinds();};$('[data-kind-next]',root).onclick=()=>{page++;renderKinds();};permission();}
    function editKind(item=null){
      editing=item;const keys=[...new Map([...(r.profile?.pattern||'').matchAll(/\{([A-Za-z]+):(\d+)\}/g)].filter(m=>!['seq','year','yearBE','month','branch'].includes(m[1])).map(m=>[m[1],Number(m[2])])).entries()];
      if(!keys.length){app.toast('บันทึกแบบเลขให้หมวดนี้ก่อน แล้วเพิ่มชนิดได้ครับ');return;}
      editor.innerHTML=`<form class="workspace-kind-form"><h3>${item?'แก้ไขชนิด':'เพิ่มชนิด / คุณลักษณะ'}</h3><label>ชื่อชนิด / คุณลักษณะ<input name="name" required maxlength="300" value="${esc(item?.name||'')}"></label><div class="admin-grid">${keys.map(([k,w])=>`<label>${esc(gov.variables[k])} · ${w} หลัก<input data-kind-value="${k}" data-kind-width="${w}" maxlength="${w}" required value="${esc(item?.values[k]||'')}"></label>`).join('')}</div><label>รหัสบัญชีตามต้นทาง (เว้นว่างให้ประกอบจากค่าด้านบน)<input name="code" maxlength="80" value="${esc(item?.code||'')}"></label><label>เงื่อนไข / ที่มา<textarea name="source" maxlength="1200">${esc(item?.source||'')}</textarea></label><div class="workspace-row-actions"><button class="button primary" type="submit">บันทึกชนิด</button><button class="button outline" type="button" data-cancel-kind>ยกเลิก</button></div><p role="status"></p></form>`;
      $('[data-cancel-kind]',editor).onclick=()=>editor.close();
      editor.showModal();
      $('form',editor).onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=$('[type=submit]',f),values={};f.querySelectorAll('[data-kind-value]').forEach(i=>values[i.dataset.kindValue]=i.value.trim());const code=f.elements.code.value.trim()||keys.map(([k,w])=>/^[0-9]+$/.test(values[k])?values[k].padStart(w,'0'):values[k]).join('-');b.disabled=true;
        try{await app.api('/api/governance/catalog',{method:'POST',body:JSON.stringify({accountId:scope.accountId,categoryId:r.id,name:f.elements.name.value,code,source:f.elements.source.value,values,id:editing?.id,revision:editing?.revision,actor:app.getRole()})});editor.close();editor.replaceChildren();await loadKinds();if(board.accountId===scope.accountId&&board.branchId===scope.branchId&&board.date===scope.date)await loadBoard();app.toast('บันทึกชนิดแล้ว เลือกเพิ่มอุปกรณ์ได้ทันที');}catch(error){$('[role=status]',f).textContent=error.message;}finally{b.disabled=app.getRole()!=='เจ้าหน้าที่พัสดุ';}};
    }
    $('[data-row-kind-search]',tr).oninput=()=>{page=0;renderKinds();};$('[data-new-row-kind]',tr).onclick=()=>editKind();
    root.addEventListener('click',e=>{const edit=e.target.closest('[data-edit-kind]'),use=e.target.closest('[data-use-kind]');if(edit){const item=items.find(i=>i.id===Number(edit.dataset.editKind));if(item.shared_catalog_id){tr.close();window.govAssetEquipment.openEdit(item.shared_catalog_id);}else editKind(item);}if(use)window.govAssetAccountRegistration.openWith({...scope,categoryId:r.id,catalogId:Number(use.dataset.useKind)});});
    await loadKinds();
  }
  section.addEventListener('click',e=>{const edit=e.target.closest('[data-category-edit]'),kinds=e.target.closest('[data-category-kinds]'),add=e.target.closest('[data-category-add-asset]');if(edit)openRow(Number(edit.dataset.categoryEdit));if(kinds)openRow(Number(kinds.dataset.categoryKinds),'kinds');if(add)window.govAssetAccountRegistration.openWith({accountId:board.accountId,branchId:board.branchId,categoryId:Number(add.dataset.categoryAddAsset)});});
  $('#depreciationDialog').addEventListener('close',async()=>{if(!pendingPolicy)return;const pending=pendingPolicy;pendingPolicy=null;try{policies=(await app.api('/api/catalog/depreciation')).items;const newItems=policies.filter(p=>!pending.ids.has(p.id));section.querySelectorAll('.workspace-category-form').forEach(f=>{const value=f.elements.policyId.value;f.elements.policyId.innerHTML=policyOptions();f.elements.policyId.value=value;});if(newItems.length===1&&pending.form.isConnected)pending.form.elements.policyId.value=String(newItems[0].id);}catch(e){app.showError(e);}});
  $('#categoryDialog').addEventListener('close',loadBoard);
  document.addEventListener('govasset:administration-ready',()=>{const branch=$('#workspaceBranch').value;app.api('/api/governance').then(data=>{config=data;$('#workspaceBranch').innerHTML=option('','ทุกสาขา / แบบหลัก')+data.branches.filter(b=>b.account_id===account()).map(b=>option(b.id,b.name)).join('');if(data.branches.some(b=>b.account_id===account()&&String(b.id)===branch))$('#workspaceBranch').value=branch;loadBoard();}).catch(e=>app.showError(e));});
  document.addEventListener('govasset:administration-tab',e=>{if(e.detail.name==='overview')loadBoard();else section.querySelectorAll('dialog[open]').forEach(d=>d.close());});
  $('#actorRole').addEventListener('change',permission);
  window.govAssetCategoryWorkspace={reload:loadBoard};
  $('#view-administration .page-heading h1').textContent='ตั้งหมวดและค่าเสื่อม';
  $('[data-go-view="administration"] strong').textContent='ตั้งหมวด เลขครุภัณฑ์ และค่าเสื่อม';
  $('[data-go-view="administration"] > span:last-child').textContent='ตารางเดียวสำหรับตั้งหมวดและเพิ่มอุปกรณ์';
  document.addEventListener('DOMContentLoaded',()=>{
    const legacy=['numbering','codes','depreciation'].map(name=>$(`.settings-hub [data-go-view="${name}"]`)).filter(Boolean);
    if(!legacy.length)return;
    const advancedGroup=document.createElement('details');advancedGroup.className='settings-advanced';advancedGroup.innerHTML='<summary>เครื่องมือหมวดและหลักเกณฑ์ขั้นสูง</summary><div class="settings-card-grid"></div>';
    const grid=legacy[0].parentElement;grid.append(advancedGroup);legacy.forEach(card=>$('div',advancedGroup).append(card));
    $('#settingsSearch')?.addEventListener('input',()=>{const q=$('#settingsSearch').value.trim(),found=legacy.some(card=>!card.hidden);advancedGroup.hidden=Boolean(q)&&!found;advancedGroup.open=Boolean(q)&&found;});
    $('#settingsClearSearch')?.addEventListener('click',()=>{advancedGroup.open=false;advancedGroup.hidden=false;});
  });
  gov.openTab('overview');
})();
