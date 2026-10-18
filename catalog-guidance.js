/* Working wording is editable; original document text stays separate. */
(() => {
  const app=window.govAssetApp,$=s=>document.querySelector(s);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url=context=>'/api/catalog/guidance?'+new URLSearchParams(context);
  const allowed=()=>app.getRole()==='เจ้าหน้าที่พัสดุ';
  function markup(data){
    return data?`<section class="guidance-reading"><p class="guidance-text">${esc(data.text)}</p>${data.conditions?`<h4>เงื่อนไขการใช้</h4><p class="guidance-text">${esc(data.conditions)}</p>`:''}${data.citation?`<small class="guidance-citation">${esc(data.citation)}</small>`:''}</section>`:'';
  }
  const dialog=document.createElement('dialog');dialog.id='guidanceDialog';dialog.className='asset-dialog guidance-dialog';
  dialog.innerHTML=`<form id="guidanceForm"><div class="dialog-head"><h2 id="guidanceTitle">คำอธิบายและเงื่อนไข</h2><button class="dialog-close" type="button" id="closeGuidance" aria-label="ปิด">×</button></div><p class="field-hint">แก้ข้อความที่ใช้แสดงในแอป การแก้ข้อความไม่เปลี่ยนเลขครุภัณฑ์หรือกฎคำนวณของระบบ</p><fieldset id="guidanceFields"><label>คำอธิบาย / ข้อความที่ใช้<textarea name="text" rows="6" maxlength="10000" required></textarea></label><label>เงื่อนไข / ขอบเขตการใช้<textarea name="conditions" rows="5" maxlength="10000" placeholder="ระบุเมื่อเอกสารหรือหน่วยงานกำหนดเงื่อนไขเพิ่มเติม"></textarea></label><label>ชื่อเอกสาร / ข้อ / หน้า<input name="citation" maxlength="4000"></label><label>เหตุผลการแก้ไข<textarea name="reason" rows="2" maxlength="1000" required placeholder="เช่น ปรับตามหนังสือฉบับใหม่ ข้อ 3"></textarea></label></fieldset><p id="guidanceVersion" class="field-hint"></p><p id="guidanceStatus" role="status"></p><div class="dialog-actions"><button type="button" class="button outline" id="reloadGuidance">โหลดฉบับล่าสุด</button><button type="submit" class="button primary" id="saveGuidance">บันทึกข้อความ</button></div><details class="guidance-original"><summary>ข้อความต้นฉบับที่เก็บไว้</summary><p id="guidanceOriginal" class="guidance-text"></p><small id="guidanceOriginalCitation"></small></details><details id="guidanceHistory"><summary>ประวัติการแก้ไข</summary><div id="guidanceHistoryRows"></div><button type="button" class="button outline" id="guidanceMoreHistory" hidden>ดูประวัติเพิ่ม</button></details></form>`;
  document.body.append(dialog);
  let current=null,context=null,epoch=0,busy=false,saving=false,historyOffset=0,historyEpoch=0;
  function controls(){const edit=allowed()&&!busy&&!!current;$('#guidanceFields').disabled=!edit;$('#saveGuidance').disabled=!edit;$('#reloadGuidance').disabled=busy;}
  async function load(){
    const request=++epoch;busy=true;current=null;controls();$('#guidanceStatus').textContent='กำลังโหลดข้อความ…';$('#guidanceTitle').textContent='กำลังโหลดข้อความ…';$('#guidanceOriginal').textContent='';$('#guidanceOriginalCitation').textContent='';$('#guidanceVersion').textContent='';for(const name of ['text','conditions','citation','reason'])$('#guidanceForm').elements[name].value='';
    try{const data=await app.api(url(context));if(request!==epoch||!dialog.open)return;current=data;const form=$('#guidanceForm');for(const key of ['text','conditions','citation'])form.elements[key].value=data[key];form.elements.reason.value='';$('#guidanceTitle').textContent=data.title;$('#guidanceVersion').textContent=data.revision?`ฉบับ ${data.revision} · ${data.updatedBy} · ${app.fmtDate(data.updatedAt)}`:'ข้อความตั้งต้นจากเอกสาร';$('#guidanceOriginal').textContent=data.originalText;$('#guidanceOriginalCitation').textContent=data.originalCitation;$('#guidanceStatus').textContent=allowed()?'':'อ่านได้ทุกบทบาท แก้ไขได้ในบทบาทเจ้าหน้าที่พัสดุ';historyOffset=0;$('#guidanceHistoryRows').textContent='';$('#guidanceHistory').open=false;$('#guidanceMoreHistory').hidden=true;++historyEpoch;}
    catch(error){if(request===epoch)$('#guidanceStatus').textContent=error.message;}
    finally{if(request===epoch){busy=false;controls();}}
  }
  async function open(next){context=next;$('#guidanceFields').disabled=true;dialog.showModal();await load();}
  async function history(more=false){
    if(!allowed()||!current)return;
    const request=++historyEpoch,configEpoch=epoch;$('#guidanceMoreHistory').disabled=true;
    try{const data=await app.api('/api/catalog/guidance/history?'+new URLSearchParams({...context,actor:app.getRole(),offset:String(more?historyOffset:0)}));if(request!==historyEpoch||configEpoch!==epoch||!dialog.open)return;
      const html=data.items.map(row=>`<article class="guidance-history-entry"><b>ฉบับ ${row.revision} · ${esc(row.actor)}</b><small>${esc(app.fmtDate(row.createdAt))} · ${esc(row.reason)}</small><details><summary>ดูข้อความก่อนและหลังแก้ไข</summary><h4>ก่อนแก้</h4>${markup(row.before)}<h4>หลังแก้</h4>${markup(row.after)}</details></article>`).join('')||'<p>ยังไม่มีการแก้ไข</p>';
      if(more)$('#guidanceHistoryRows').insertAdjacentHTML('beforeend',html);else $('#guidanceHistoryRows').innerHTML=html;
      historyOffset=data.offset+data.items.length;$('#guidanceMoreHistory').hidden=historyOffset>=data.total;
    }catch(error){if(request===historyEpoch&&configEpoch===epoch)$('#guidanceHistoryRows').textContent=error.message;}
    finally{if(request===historyEpoch)$('#guidanceMoreHistory').disabled=false;}
  }
  $('#closeGuidance').onclick=()=>{if(!saving)dialog.close();};
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  dialog.addEventListener('close',()=>{if(!dialog.open){++epoch;++historyEpoch;}});
  $('#reloadGuidance').onclick=load;
  $('#guidanceHistory').addEventListener('toggle',()=>{if($('#guidanceHistory').open)history();});
  $('#guidanceMoreHistory').onclick=()=>history(true);
  $('#guidanceForm').onsubmit=async event=>{
    event.preventDefault();if(busy||!current||!allowed())return;
    const form=event.target,body={...context,actor:app.getRole(),revision:current.revision};for(const key of ['text','conditions','citation','reason'])body[key]=form.elements[key].value;
    busy=true;saving=true;controls();$('#guidanceStatus').textContent='กำลังบันทึก…';
    try{current=await app.api('/api/catalog/guidance',{method:'PUT',body:JSON.stringify(body)});$('#guidanceStatus').textContent='บันทึกแล้ว เก็บข้อความต้นฉบับและประวัติการเปลี่ยนแปลงไว้';$('#guidanceVersion').textContent=`ฉบับ ${current.revision} · ${current.updatedBy} · ${app.fmtDate(current.updatedAt)}`;form.elements.reason.value='';document.dispatchEvent(new CustomEvent('govasset:guidance-changed',{detail:current}));if($('#guidanceHistory').open)history();}
    catch(error){$('#guidanceStatus').textContent=error.message;}
    finally{busy=false;saving=false;controls();}
  };
  document.addEventListener('govasset:role-changed',()=>{controls();if(!allowed()){$('#guidanceHistoryRows').textContent='';$('#guidanceHistory').open=false;++historyEpoch;}});
  const main=document.createElement('details');main.id='numberingGuidance';main.className='panel guidance-panel';main.innerHTML='<summary>ข้อความหลักเกณฑ์การออกเลข</summary><div id="numberingGuidanceText"></div><button class="button outline" type="button" id="editNumberingGuidance">แก้ไขข้อความหลักเกณฑ์</button>';
  $('#view-numbering .numbering-rule').after(main);
  const category=document.createElement('section');category.id='categoryGuidance';category.className='guidance-category';category.innerHTML='<div id="categoryGuidanceText"></div><button type="button" class="button outline" id="editCategoryGuidance">แก้ไขคำอธิบาย / เงื่อนไขหมวด</button>';
  $('#numberingCatalogStatus').after(category);
  let mainEpoch=0,categoryEpoch=0;
  async function refreshMain(){const request=++mainEpoch;try{const data=await app.api(url({scope:'numbering'}));if(request===mainEpoch)$('#numberingGuidanceText').innerHTML=markup(data);}catch(error){if(request===mainEpoch)$('#numberingGuidanceText').textContent=error.message;}}
  async function refreshCategory(){const id=$('#numberingCatalogCategory').value,request=++categoryEpoch;category.hidden=!id;if(!id)return;$('#categoryGuidanceText').textContent='กำลังโหลดคำอธิบาย…';try{const data=await app.api(url({scope:'category',categoryId:id}));if(request===categoryEpoch)$('#categoryGuidanceText').innerHTML=markup(data);}catch(error){if(request===categoryEpoch)$('#categoryGuidanceText').textContent=error.message;}}
  $('#editNumberingGuidance').onclick=()=>open({scope:'numbering'});
  $('#editCategoryGuidance').onclick=()=>open({scope:'category',categoryId:Number($('#numberingCatalogCategory').value)});
  $('#numberingCatalogCategory').addEventListener('change',refreshCategory);document.addEventListener('govasset:numbering-catalog-loaded',refreshCategory);
  document.addEventListener('govasset:view-changed',event=>{if(event.detail.name==='numbering'){refreshMain();refreshCategory();}});
  document.addEventListener('govasset:guidance-changed',()=>{refreshMain();refreshCategory();});
  document.addEventListener('click',event=>{const button=event.target.closest('[data-edit-code-guidance]');if(button)open({scope:'code',categoryId:Number(button.dataset.category),code:button.dataset.editCodeGuidance});});
  const assetCategory=document.createElement('div');assetCategory.className='guidance-reading';assetCategory.hidden=true;$('#assetCategoryHelp').after(assetCategory);let assetCategoryEpoch=0;
  async function refreshAssetCategory(){const id=$('#assetCategoryId').value,request=++assetCategoryEpoch;assetCategory.hidden=true;if(!id)return;try{const data=await app.api(url({scope:'category',categoryId:id}));if(request!==assetCategoryEpoch)return;assetCategory.hidden=!(data.revision||data.conditions||data.text!==data.title);assetCategory.innerHTML=markup(data);}catch(error){if(request===assetCategoryEpoch){assetCategory.hidden=false;assetCategory.textContent=error.message;}}}
  $('#assetCategoryId').addEventListener('change',refreshAssetCategory);document.addEventListener('govasset:asset-entry-open',refreshAssetCategory);document.addEventListener('govasset:guidance-changed',refreshAssetCategory);
  window.govAssetGuidance={markup,open};refreshMain();refreshCategory();
})();
