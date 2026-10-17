/* Registration selects a named catalogue entry; code maintenance lives in Settings. */
(() => {
  const app=window.govAssetApp,$=s=>document.querySelector(s);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ids=['groupCode','typeCode','descriptionCode'];
  let items=[],epoch=0,detailEpoch=0,loading=false,preview=null,autoName='';
  const parts=()=>ids.map(id=>$('#'+id).value);
  const manual=()=>$('#assetNumberMode').value==='manual';
  function renderPreview(){
    const isManual=manual(),complete=parts().every(Boolean);
    $('#assetClassificationFields').hidden=isManual;
    $('#assetClassification').required=!isManual;
    $('#clearAssetClassification').hidden=true;
    $('#numberingBreakdown').hidden=isManual||!complete;
    $('#numberingEvidence').hidden=isManual;
    $('#numberingResultLabel').textContent=isManual?'เลขครุภัณฑ์เดิม':'เลขครุภัณฑ์ที่จะได้รับ';
    $('#assetForm button[type="submit"]').disabled=loading||(!isManual&&!complete);
    if(isManual){$('#generatedCode').textContent=$('#manualAssetCode').value||'ระบุเลขเดิมตามทะเบียน';return;}
    $('#generatedCode').textContent=complete?(preview||parts().join('-')+'-…'):'เลือกรายการก่อน';
    ['numberingGroup','numberingType','numberingDescription'].forEach((id,i)=>$('#'+id).textContent=parts()[i]||'—');
    $('#numberingSequence').textContent=preview?preview.split('-')[3]:'…';
  }
  function selectCode(code,fillName=false){
    const item=items.find(row=>row.code===code);
    ids.forEach((id,i)=>$('#'+id).value=item?code.split('-')[i]:'');
    preview=null;renderPreview();
    if(item&&fillName){const input=$('#itemName');if(!input.value.trim()||input.value===autoName){autoName=item.names[0]||'';input.value=autoName;}}
    loadEvidence();
  }
  function renderChoices(desiredCode=$('#assetClassification').value,fillName=false){
    const q=$('#assetFsnSearch').value.trim().toLowerCase(),rows=items.filter(item=>!q||`${item.code} ${item.names.join(' ')}`.toLowerCase().includes(q));
    const select=$('#assetClassification');
    select.innerHTML='<option value="">เลือกรายการ…</option>'+rows.map(item=>`<option value="${esc(item.code)}">${esc(item.names[0]||'ไม่ระบุชื่อ')} · ${esc(item.code)}</option>`).join('');
    if(rows.some(item=>item.code===desiredCode))select.value=desiredCode;
    select.disabled=loading||!rows.length;
    selectCode(select.value,fillName);
    $('#numberingCoverage').textContent=loading?'กำลังโหลดรายการ…':items.length?(rows.length?`${rows.length} รายการให้เลือก`:'ไม่พบคำค้นนี้ ลองชื่ออื่นหรือเพิ่มรายการในบัญชี'):'หมวดนี้ยังไม่มีรายการ กดเพิ่มชนิด / คุณลักษณะในบัญชีก่อนได้';
  }
  async function load(desiredCode=''){
    const request=++epoch;++detailEpoch;items=[];preview=null;$('#numberingEvidence').textContent='';
    loading=true;renderChoices('');renderPreview();
    const categoryId=$('#assetCategoryId').value;
    if(!categoryId){loading=false;renderChoices('');$('#numberingCoverage').textContent='เลือกหมวด แล้วเลือกรายการที่ต้องการเพิ่ม';return;}
    try{
      const data=await app.api('/api/catalog/numbering?'+new URLSearchParams({categoryId}));
      if(request!==epoch)return;
      items=data.items;loading=false;renderChoices(desiredCode,Boolean(desiredCode));
    }catch(error){if(request===epoch){loading=false;renderChoices('');$('#numberingCoverage').textContent=error.message;renderPreview();}}
  }
  async function loadEvidence(){
    const request=++detailEpoch,code=parts().join('-'),item=items.find(row=>row.code===code),root=$('#numberingEvidence');
    root.textContent='';preview=null;
    if(!item){renderPreview();return;}
    try{
      const data=await app.api('/api/catalog/numbering?'+new URLSearchParams({categoryId:$('#assetCategoryId').value,code}));
      if(request!==detailEpoch)return;
      preview=data.nextCode;renderPreview();
      root.innerHTML=`<small>เลขถัดไปเป็นตัวอย่าง ระบบยืนยันเลขอีกครั้งเมื่อบันทึก</small><details><summary>ดูที่มาและตัวอย่างรายการเดิม</summary><p>${esc(item.names.join(' / '))}</p><p>${esc(item.sources.join(' + '))}${item.reference?' · '+esc(item.reference):''}</p>${data.examples.length?`<ul>${data.examples.map(row=>`<li><b>${esc(row.code)}</b> · ${esc(row.name)}${row.detail?' · '+esc(row.detail):''}<small>${esc(row.filename||'ทะเบียนในแอป')}${row.source_row_no?' · แถว '+row.source_row_no:''}</small></li>`).join('')}</ul>`:''}${data.references.length?`<p>เอกสารอ้างอิงชุดที่ 1–2</p><ul>${data.references.map(row=>`<li>${esc(row.name)} · ${esc(row.title)} หน้า ${row.page}</li>`).join('')}</ul>`:''}</details>`;
    }catch(error){if(request===detailEpoch){root.textContent=error.message;preview=null;renderPreview();}}
  }
  $('#assetCategoryId').addEventListener('change',()=>{$('#assetFsnSearch').value='';load();});
  $('#assetClassification').addEventListener('change',()=>selectCode($('#assetClassification').value,true));
  $('#assetFsnSearch').addEventListener('input',()=>renderChoices());
  $('#assetNumberMode').addEventListener('change',()=>{if(manual()){$('#assetClassification').value='';selectCode('');}renderPreview();});
  $('#clearAssetClassification').onclick=()=>selectCode('');
  $('#findAssetFsn').onclick=()=>{$('#assetDialog').close();app.switchView('numbering');const select=$('#numberingCatalogCategory');select.value=$('#assetCategoryId').value;select.dispatchEvent(new Event('change'));};
  document.addEventListener('govasset:asset-entry-open',()=>{$('#assetFsnSearch').value='';load();});
  window.govAssetNumbering={renderPreview};renderPreview();

  const panel=document.createElement('section');panel.className='panel numbering-catalog';
  panel.innerHTML=`<div class="panel-heading"><div><h2>บัญชีชนิดและคุณลักษณะ</h2><p>เลือกหมวดเพื่อดูรายการที่ตั้งไว้ หรือกดเพิ่มชนิด / คุณลักษณะ</p></div></div><div class="numbering-catalog-controls"><label>หมวด<select id="numberingCatalogCategory"><option value="">กำลังโหลดหมวด…</option></select></label><label>ค้นชื่อ/รหัส<input id="numberingCatalogSearch" type="search" placeholder="ค้นในหมวดที่เลือก"></label></div><p id="numberingCatalogStatus" class="field-hint" role="status"></p><div class="table-wrap"><table><thead><tr><th>ชุด 1<br>ประเภท</th><th>ชุด 2<br>ชนิด</th><th>ชุด 3<br>คุณลักษณะ</th><th>ชื่อ / คุณลักษณะ</th><th>ชิ้นในทะเบียน</th><th>ดำเนินการ</th></tr></thead><tbody id="numberingCatalogRows"></tbody></table></div><div id="numberingCatalogPager" class="fsn-pager"></div>`;
  $('#numberingManagement').append(panel);
  let catalogItems=[],catalogRequest=0,catalogPage=0;
  function renderCatalog(){
    const q=$('#numberingCatalogSearch').value.trim().toLowerCase(),filtered=catalogItems.filter(item=>!q||`${item.code} ${item.names.join(' ')}`.toLowerCase().includes(q));
    catalogPage=Math.min(catalogPage,Math.max(0,Math.ceil(filtered.length/50)-1));
    const visible=filtered.slice(catalogPage*50,(catalogPage+1)*50);
    $('#numberingCatalogRows').innerHTML=visible.length?visible.map(item=>`<tr>${item.code.split('-').map(part=>`<td><code>${esc(part)}</code></td>`).join('')}<td>${esc(item.names[0]||'ไม่ระบุชื่อ')}<small class="item-meta">${esc(item.sources.join(' + '))}</small></td><td>${item.assetCount}</td><td><button type="button" class="button outline mini-action" data-inspect-code="${esc(item.code)}">ดูเลข / จัดการ</button> <button type="button" class="button outline mini-action" data-register-code="${esc(item.code)}">ใช้เพิ่มครุภัณฑ์</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty-cell">ไม่พบรหัสในหมวด/คำค้นนี้ เพิ่มรหัสพร้อมหลักฐานด้านบนได้</td></tr>';
    $('#numberingCatalogPager').innerHTML=`<button type="button" id="numberingCatalogPrev" ${catalogPage===0?'disabled':''}>ก่อนหน้า</button><span>หน้า ${catalogPage+1} / ${Math.max(1,Math.ceil(filtered.length/50))} · ${filtered.length} รหัส</span><button type="button" id="numberingCatalogNext" ${(catalogPage+1)*50>=filtered.length?'disabled':''}>ถัดไป</button>`;
    $('#numberingCatalogPrev').onclick=()=>{catalogPage--;renderCatalog();};$('#numberingCatalogNext').onclick=()=>{catalogPage++;renderCatalog();};
  }
  async function loadCatalog(){
    const categoryId=$('#numberingCatalogCategory').value,request=++catalogRequest;catalogItems=[];catalogPage=0;renderCatalog();
    if(!categoryId){$('#numberingCatalogStatus').textContent='เลือกหมวดเพื่อดูบัญชีที่สัมพันธ์กับข้อมูลในฐานนี้';return;}
    $('#numberingCatalogStatus').textContent='กำลังอ่านบัญชีของหมวด…';
    try{const data=await app.api('/api/catalog/numbering?'+new URLSearchParams({categoryId}));if(request!==catalogRequest)return;catalogItems=data.items;const c=data.coverage;$('#numberingCatalogStatus').textContent=`${data.total} รหัส · ทะเบียนที่อ่านรูปแบบได้ ${c.recognizedRows} ชิ้น · รูปแบบอื่น ${c.otherFormatRows} ชิ้น (เก็บเลขเดิม) · บัญชี PDF ในฐานนี้ ${data.manualRows} แถว`;renderCatalog();}catch(error){if(request===catalogRequest)$('#numberingCatalogStatus').textContent=error.message;}
  }
  async function loadCategories(){
    try{const categories=await app.api('/api/catalog/categories'),select=$('#numberingCatalogCategory'),previous=select.value;select.innerHTML='<option value="">เลือกหมวด</option>'+categories.filter(row=>row.isActive!==false).map(row=>`<option value="${row.id}">${esc(row.name)}</option>`).join('');select.value=previous;if(previous)loadCatalog();}catch(error){$('#numberingCatalogStatus').textContent=error.message;}
  }
  $('#numberingCatalogCategory').onchange=loadCatalog;
  $('#numberingCatalogSearch').oninput=()=>{catalogPage=0;renderCatalog();};
  const detail=document.createElement('dialog');detail.id='numberingDetailDialog';detail.className='asset-dialog';detail.setAttribute('aria-label','รายละเอียดบัญชีเลขครุภัณฑ์');document.body.append(detail);
  let inspectEpoch=0;
  panel.addEventListener('click',async event=>{
    const button=event.target.closest('[data-inspect-code]');if(!button)return;
    const code=button.dataset.inspectCode,categoryId=$('#numberingCatalogCategory').value,request=++inspectEpoch;
    detail.innerHTML='<p role="status">กำลังอ่านข้อมูล…</p><button type="button" class="button outline" data-close-numbering>ปิด</button>';detail.showModal();
    try{
      const data=await app.api('/api/catalog/numbering?'+new URLSearchParams({categoryId,code}));if(request!==inspectEpoch||!detail.open)return;
      const item=data.selected,values=data.nextCode.split('-');
      detail.innerHTML=`<div class="dialog-head"><h2>${esc(item.names[0]||code)}</h2><button type="button" class="dialog-close" data-close-numbering aria-label="ปิด">×</button></div><div class="numbering-digits">${values.map((value,index)=>`<div><small>${['1 · ประเภท','2 · ชนิด','3 · คุณลักษณะ','4 · ชิ้นถัดไป'][index]}</small><strong>${esc(value)}</strong></div>`).join('')}</div><p>รหัสประจำชนิด/คุณลักษณะ: <b>${esc(code)}</b></p><p>เพิ่มครุภัณฑ์แบบนี้อีกชิ้น จะใช้เลขชุดที่ 1–3 เดิม และออกเลขชุดที่ 4 ใหม่ขณะบันทึก</p><p>ที่มา: ${esc(item.sources.join(' + '))}${item.reference?' · '+esc(item.reference):''}</p>${data.examples.length?`<details><summary>ดูตัวอย่าง ${item.assetCount} ชิ้นในทะเบียน</summary><ul>${data.examples.map(row=>`<li>${esc(row.code)} · ${esc(row.name)}</li>`).join('')}</ul></details>`:''}<div class="dialog-actions"><button class="button outline" type="button" data-new-variant="${esc(code)}" data-category="${categoryId}">＋ เพิ่มคุณลักษณะในชนิดนี้</button><button class="button primary" type="button" data-close-numbering>ปิด</button></div>`;
    }catch(error){if(request===inspectEpoch&&detail.open){detail.innerHTML=`<p role="alert">${esc(error.message)}</p><button type="button" class="button outline" data-close-numbering>ปิด</button>`;}}
  });
  detail.addEventListener('click',event=>{if(event.target===detail||event.target.closest('[data-close-numbering]'))detail.close();const button=event.target.closest('[data-new-variant]');if(button){detail.close();const prefix=button.dataset.newVariant.split('-').slice(0,2).join('-');window.govAssetMasterData.openFsnEntry({dataset:{adoptFsn:prefix+'-',categoryId:button.dataset.category,newVariant:'true'}});}});
  panel.addEventListener('click',async event=>{const button=event.target.closest('[data-register-code]');if(!button)return;const code=button.dataset.registerCode;$('#assetCategoryId').value=$('#numberingCatalogCategory').value;$('#assetNumberMode').value='auto';app.openAssetDialog();await load(code);});
  document.addEventListener('govasset:numbering-changed',event=>{if(event.detail?.categoryId)$('#numberingCatalogCategory').value=String(event.detail.categoryId);loadCatalog();if($('#assetDialog').open)load();});
  document.addEventListener('govasset:data-changed',event=>{if(event.detail?.path?.startsWith('/api/catalog/categories'))loadCategories();});
  loadCategories();renderCatalog();
})();
