/* Select category-linked codes; never generate an agency meaning from PDF examples. */
(() => {
  const app=window.govAssetApp,$=s=>document.querySelector(s);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ids=['groupCode','typeCode','descriptionCode'];
  let items=[],epoch=0,detailEpoch=0,loading=false,preview=null;
  const parts=()=>ids.map(id=>$('#'+id).value);
  const manual=()=>$('#assetNumberMode').value==='manual';
  function renderPreview(){
    $('#clearAssetClassification').hidden=!manual();
    const complete=parts().every(Boolean);
    $('#assetForm button[type="submit"]').disabled=loading||(!manual()&&!complete);
    if(manual())$('#generatedCode').textContent=$('#manualAssetCode').value||'ระบุเลขประจำครุภัณฑ์เดิม';
    else $('#generatedCode').textContent=complete?(preview||`${parts().join('-')}-[ชุดที่ 4 · ระบบออกเมื่อบันทึก]`):'เลือกชุดที่ 1 → 2 → 3 ให้ครบก่อน';
  }
  function options(index,rows,value=''){
    const select=$('#'+ids[index]);
    select.innerHTML=`<option value="">${['เลือกกลุ่ม/ประเภท','เลือกชนิด','เลือกรายละเอียดชนิด'][index]}</option>`+rows.map(row=>`<option value="${esc(row.code)}">${esc(row.code)} · ${esc(row.name)}</option>`).join('');
    if(rows.some(row=>row.code===value))select.value=value;
    select.disabled=loading||!rows.length;
  }
  function filtered(){const q=$('#assetFsnSearch').value.trim().toLowerCase();return items.filter(item=>!q||`${item.code} ${item.names.join(' ')}`.toLowerCase().includes(q));}
  function populate(level=0){
    const previous=parts(),rows=filtered();
    for(let index=level;index<3;index++){
      const parent=parts(),matches=rows.filter(item=>item.code.split('-').slice(0,index).every((part,i)=>part===parent[i]));
      const codes=new Map();for(const item of matches){const code=item.code.split('-')[index];const entry=codes.get(code)||{code,names:[],count:0};for(const name of item.names)if(!entry.names.includes(name)&&entry.names.length<2)entry.names.push(name);entry.count+=item.assetCount;codes.set(code,entry);}
      const values=[...codes.values()].sort((a,b)=>a.code.localeCompare(b.code)).map(row=>({code:row.code,name:row.names.join(' / ')+(index===2?` · ${row.count} ชิ้นในทะเบียน`:'')}));
      options(index,values,previous[index]);
    }
    preview=null;renderPreview();loadEvidence();
  }
  async function load(desiredCode=''){
    const request=++epoch;++detailEpoch;items=[];preview=null;$('#numberingEvidence').textContent='';
    loading=true;ids.forEach((_,i)=>options(i,[]));renderPreview();
    const categoryId=$('#assetCategoryId').value;
    if(!categoryId){loading=false;$('#numberingCoverage').textContent='เลือกหมวดก่อน ระบบจะแสดงรหัสจากทะเบียนของหมวดและบัญชีหน่วยงานที่ผูกไว้';renderPreview();return;}
    $('#numberingCoverage').textContent='กำลังอ่านบัญชีรหัสของหมวด…';
    try{
      const data=await app.api('/api/catalog/numbering?'+new URLSearchParams({categoryId}));
      if(request!==epoch)return;
      items=data.items;const c=data.coverage;
      $('#numberingCoverage').textContent=`${data.category.name} · ${data.total.toLocaleString('th-TH')} รหัสจำแนก · อ่านรูปแบบได้ ${c.recognizedRows.toLocaleString('th-TH')} จาก ${c.registerRows.toLocaleString('th-TH')} ชิ้นในทะเบียน${c.otherFormatRows?` · เลขรูปแบบอื่น ${c.otherFormatRows.toLocaleString('th-TH')} ชิ้น คงเลขเดิมไว้`:''}${items.length?'':' · ยังไม่มีรหัสผูกหมวด เพิ่มในตั้งค่า หรือใช้โหมดเลขทะเบียนเดิม'}`;
      loading=false;populate();
      if(desiredCode){const values=desiredCode.split('-');for(let i=0;i<3;i++){$('#'+ids[i]).value=values[i];if(i<2)populate(i+1);}renderPreview();loadEvidence();}
    }catch(error){if(request===epoch){$('#numberingCoverage').textContent=error.message;loading=false;renderPreview();}}
  }
  async function loadEvidence(){
    const request=++detailEpoch,code=parts().join('-'),item=items.find(row=>row.code===code);
    const root=$('#numberingEvidence');root.textContent='';preview=null;
    if(!item){renderPreview();return;}
    root.textContent='กำลังอ่านที่มาของรหัสและตรวจลำดับถัดไป…';
    try{
      const data=await app.api('/api/catalog/numbering?'+new URLSearchParams({categoryId:$('#assetCategoryId').value,code}));
      if(request!==detailEpoch)return;
      preview=data.nextCode+' · ตัวอย่างเลขถัดไป';renderPreview();
      root.innerHTML=`<strong>รหัสจำแนก ${esc(code)}</strong><p>${esc(item.names.join(' / '))}</p><p>ที่มา: ${esc(item.sources.join(' + '))}${item.reference?' · '+esc(item.reference):''}</p><small>ใช้กับชนิด/คุณลักษณะเดียวกัน ตรวจรายการตัวอย่างก่อนเลือก เลขชุดที่ 4 จะยืนยันอีกครั้งขณะบันทึกเพื่อไม่ให้ซ้ำ</small>${data.examples.length?`<details><summary>ดูตัวอย่างการใช้รหัสนี้ ${item.assetCount} ชิ้น (แสดงไม่เกิน 5)</summary><ul>${data.examples.map(row=>`<li><b>${esc(row.code)}</b> · ${esc(row.name)}${row.detail?' · '+esc(row.detail):''}<small>${esc(row.filename||'ทะเบียนในแอป')}${row.source_row_no?' · แถว '+row.source_row_no:''}</small></li>`).join('')}</ul></details>`:''}${data.references.length?`<details><summary>บัญชีอ้างอิง PDF ที่ตรงชุดที่ 1–2 (ไม่ใช้ยืนยันความหมายชุดที่ 3)</summary><ul>${data.references.map(row=>`<li>${esc(row.name)} · ${esc(row.code||code.slice(0,8))} · ${esc(row.title)} หน้า PDF ${row.page}</li>`).join('')}</ul></details>`:'<small>ยังไม่พบบัญชี PDF ที่ตรงเลขชุดที่ 1–2 ในฐานนี้ ระบบไม่เดาหรือย่อเลขชนิดให้ตรงกัน</small>'}`;
    }catch(error){if(request===detailEpoch){root.textContent=error.message;preview=null;renderPreview();}}
  }
  $('#assetCategoryId').addEventListener('change',()=>{$('#assetFsnSearch').value='';load();});
  ids.forEach((id,index)=>$('#'+id).addEventListener('change',()=>{for(let i=index+1;i<3;i++)$('#'+ids[i]).value='';populate(index+1);}));
  $('#assetFsnSearch').addEventListener('input',()=>populate());
  $('#assetNumberMode').addEventListener('change',renderPreview);
  $('#clearAssetClassification').onclick=()=>{ids.forEach(id=>$('#'+id).value='');$('#numberingEvidence').textContent='';preview=null;++detailEpoch;populate();};
  document.addEventListener('govasset:asset-entry-open',()=>{$('#assetFsnSearch').value='';load();});
  window.govAssetNumbering={renderPreview};renderPreview();

  const panel=document.createElement('section');panel.className='panel numbering-catalog';
  panel.innerHTML=`<div class="panel-heading"><div><h2>รหัสที่ใช้ลงทะเบียนได้ แยกตามหมวด</h2><p>จากทะเบียนของหมวดและรหัสที่หน่วยงานกำหนดไว้ เลขตัวอย่างในคู่มือจะแสดงแยกด้านล่าง</p></div></div><div class="numbering-catalog-controls"><label>หมวด<select id="numberingCatalogCategory"><option value="">กำลังโหลดหมวด…</option></select></label><label>ค้นชื่อ/รหัส<input id="numberingCatalogSearch" type="search" placeholder="ค้นในหมวดที่เลือก"></label></div><p id="numberingCatalogStatus" class="field-hint" role="status"></p><div class="table-wrap"><table><thead><tr><th>รหัสชุดที่ 1–3</th><th>ชื่อ / คุณลักษณะที่พบ</th><th>ที่มา</th><th>ชิ้นในทะเบียน</th><th>ดำเนินการ</th></tr></thead><tbody id="numberingCatalogRows"></tbody></table></div><div id="numberingCatalogPager" class="fsn-pager"></div>`;
  $('#view-codes .page-heading').after(panel);
  let catalogItems=[],catalogRequest=0,catalogPage=0;
  function renderCatalog(){
    const q=$('#numberingCatalogSearch').value.trim().toLowerCase(),filtered=catalogItems.filter(item=>!q||`${item.code} ${item.names.join(' ')}`.toLowerCase().includes(q));
    catalogPage=Math.min(catalogPage,Math.max(0,Math.ceil(filtered.length/50)-1));
    const visible=filtered.slice(catalogPage*50,(catalogPage+1)*50);
    $('#numberingCatalogRows').innerHTML=visible.length?visible.map(item=>`<tr><td><code>${esc(item.code)}</code></td><td>${esc(item.names.join(' / '))}</td><td>${esc(item.sources.join(' + '))}</td><td>${item.assetCount}</td><td><button type="button" class="button outline mini-action" data-register-code="${esc(item.code)}">ใช้เพิ่มครุภัณฑ์</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty-cell">ไม่พบรหัสในหมวด/คำค้นนี้ เพิ่มรหัสพร้อมหลักฐานด้านบนได้</td></tr>';
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
  panel.addEventListener('click',async event=>{const button=event.target.closest('[data-register-code]');if(!button)return;const code=button.dataset.registerCode;$('#assetCategoryId').value=$('#numberingCatalogCategory').value;$('#assetNumberMode').value='auto';app.openAssetDialog();await load(code);});
  document.addEventListener('govasset:numbering-changed',event=>{if(event.detail?.categoryId)$('#numberingCatalogCategory').value=String(event.detail.categoryId);loadCatalog();if($('#assetDialog').open)load();});
  document.addEventListener('govasset:data-changed',event=>{if(event.detail?.path?.startsWith('/api/catalog/categories'))loadCategories();});
  loadCategories();renderCatalog();
})();
