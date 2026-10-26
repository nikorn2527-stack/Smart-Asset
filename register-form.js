/* Official document geometry follows the supplied scanned register, in millimetres. */
(() => {
  const app=window.govAssetApp, $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=[['organization','ส่วนราชการ'],['department','หน่วยงาน'],['type','ประเภท'],['code','รหัส'],['description','ลักษณะ/คุณสมบัติ'],['model','รุ่น/แบบ'],['location','สถานที่ตั้ง/หน่วยงานรับผิดชอบ'],['vendor','ชื่อผู้ขาย/ผู้รับจ้าง/ผู้บริจาค'],['address','ที่อยู่'],['phone','โทร.'],['gfmis','เลขที่ GFMIS'],['po','เลขที่ PO'],['serial','S/N :'],['warranty','สิ้นสุดประกัน :'],['fiscalYear','ปีงบที่ได้มา'],['fund','ประเภทเงิน'],['method','วิธีการได้มา']];
  const columns=[['date','วันเดือนปี'],['document','ที่เอกสาร'],['description','รายการ'],['quantity','จำนวนหน่วย'],['unitPrice','ราคาต่อหน่วย'],['total','มูลค่ารวม'],['life','อายุใช้งาน'],['monthly','อัตราค่าเสื่อมราคา/ประจำเดือน'],['annual','ค่าเสื่อมราคาประจำปี'],['accumulated','ค่าเสื่อมราคาสะสม'],['net','มูลค่าสุทธิ'],['note','หมายเหตุ']];
  const moneyKeys=['unitPrice','total','monthly','annual','accumulated','net'];
  let state=null, epoch=0;
  let currentZoom='fit';
  const panel=$('#view-register .register-selection');
  const actions=document.createElement('div');actions.className='register-form-actions';
  actions.innerHTML='<button type="button" class="button outline" id="editOfficialRegister">แก้ไขข้อมูลเอกสาร</button><div class="register-zoom-group" role="group" aria-label="ปรับขนาดย่อ/ขยายเอกสาร"><button type="button" class="register-zoom-btn active" data-zoom="fit" title="ย่อพอดีหน้าจอ">พอดีหน้าจอ</button><button type="button" class="register-zoom-btn" data-zoom="0.55" title="ย่อ 55%">55%</button><button type="button" class="register-zoom-btn" data-zoom="0.75" title="ย่อ 75%">75%</button><button type="button" class="register-zoom-btn" data-zoom="1.0" title="ขนาดจริง 100%">100%</button></div><span id="registerFormStatus" role="status">A4 แนวนอน · ตรวจและเติมช่องว่างก่อนพิมพ์</span>';
  panel.append(actions);
  const paper=$('.register-paper'),scroll=document.createElement('div');scroll.className='register-preview-scroll';paper.before(scroll);scroll.append(paper);
  function updateScale(){
    if(!paper)return;
    if(currentZoom==='fit'){
      const scrollEl=$('.register-preview-scroll');
      if(!scrollEl)return;
      const targetW=1122.5, targetH=793.7;
      const availW=Math.max(280, scrollEl.clientWidth - 28);
      const view=$('#view-register');
      const main=document.querySelector('main#main')||document.body;
      const totalH=(view&&view.clientHeight>200)?view.clientHeight:(main.clientHeight||(window.innerHeight-80));
      const navH=$('#view-register > .subpage-nav')?.offsetHeight||26;
      const headH=$('#view-register > .page-heading')?.offsetHeight||32;
      const selH=$('#view-register > .register-selection')?.offsetHeight||38;
      const provH=$('#registerProvenanceSummary')?.offsetHeight||46;
      const srcH=$('#view-register .register-source-details')?.offsetHeight||24;
      const extraH=navH+headH+selH+provH+srcH+44;
      const availH=Math.max(260, totalH - extraH);
      const scaleW=availW/targetW;
      const scaleH=availH/targetH;
      let fit=Math.min(scaleW, scaleH);
      fit=Math.max(0.35, Math.min(fit, 0.75));
      fit=Math.round(fit*100)/100;
      paper.style.setProperty('--register-scale', fit);
      paper.style.zoom=fit;
    }else{
      const s=parseFloat(currentZoom)||1.0;
      paper.style.setProperty('--register-scale', s);
      paper.style.zoom=s;
    }
    actions.querySelectorAll('.register-zoom-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.zoom===currentZoom);
    });
  }
  actions.querySelectorAll('.register-zoom-btn').forEach(btn=>{
    btn.onclick=()=>{
      currentZoom=btn.dataset.zoom;
      updateScale();
    };
  });
  const editor=document.createElement('dialog');editor.className='asset-dialog register-editor';editor.setAttribute('aria-label','แก้ไขเอกสารทะเบียนคุมทรัพย์สิน');document.body.append(editor);
  const printOld=$('#printRegister'),printButton=printOld.cloneNode(true);printOld.replaceWith(printButton);printButton.textContent='พิมพ์ / บันทึก PDF';
  const dateText=v=>{if(!v)return '';const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);if(!m)return String(v);return `${Number(m[3])} ${['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][Number(m[2])-1]} ${Number(m[1])<2400?Number(m[1])+543:Number(m[1])}`;};
  const plain=v=>v==null?'':String(v);
  function defaultForm(data){
    const a=data.asset||{},r=data.register||{},acq=(data.acquisitions||[]).at(-1)||{},d=(data.depreciationSnapshots||[]).at(-1)||{};
    const f={organization:r.organization_name||a.organization||window.govAssetBranding?.organization||'',department:r.department_name||a.department||a.responsibleUnit||'',type:r.asset_type||a.assetType||a.group||'',code:a.code||r.asset_code_printed||'',description:a.name||r.description||'',model:r.model||acq.model||a.model||'',location:a.location||r.location||'',vendor:r.vendor_name||acq.vendor_name||a.vendor||'',address:r.vendor_address||acq.vendor_address||'',phone:r.vendor_phone||acq.vendor_phone||'',gfmis:r.gfmis_no||acq.gfmis_no||a.gfmisNo||'',po:r.po_no||acq.po_no||a.poNo||'',serial:a.serialNumber||r.serial_number||acq.serial_number||'',warranty:r.warranty_end||a.warrantyEnd||'',fiscalYear:r.fiscal_year_th||acq.fiscal_year_th||a.fiscalYear||'',fund:r.fund_type||acq.fund_type||a.fundType||'',method:r.acquisition_method||acq.acquisition_method||a.acquisitionMethod||''};
    Object.keys(f).forEach(k=>f[k]=plain(f[k]));
    return {fields:f,rows:[{date:dateText(acq.acquired_on||a.acquiredOn),document:plain(acq.document_no||r.po_no||r.gfmis_no),description:f.description,quantity:plain(acq.quantity),unitPrice:plain(acq.unit_price??acq.total_price??a.purchasePrice),total:plain(acq.total_price??acq.unit_price??a.purchasePrice),life:plain(d.useful_life_years??a.usefulLifeYears),monthly:plain(d.monthly_depreciation??a.monthlyDepreciation),annual:plain(d.annual_depreciation??a.annualDepreciation),accumulated:plain(d.accumulated_depreciation??a.accumulatedDepreciation),net:plain(d.net_book_value??a.netBookValue),note:plain(r.notes||acq.notes||d.notes)}]};
  }
  function field(key,cls=''){return `<div class="rf-field ${cls}" data-field="${key}"><span>${esc(fields.find(f=>f[0]===key)[1])}</span><b>${esc(state.form.fields[key])}</b></div>`;}
  function summaryValue(key){return state.form.summary?.[key] ?? [...state.form.rows].reverse().find(r=>r[key]!=='')?.[key] ?? '';}
  function total(key){const value=summaryValue(key);return value!==''?Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'';}
  function display(key,value){return value!==''&&moneyKeys.includes(key)?Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):value;}
  function render(){
    const rows=state.form.rows, pages=[];
    for(let offset=0;offset<rows.length;offset+=3){
      const chunk=rows.slice(offset,offset+3),last=offset+chunk.length===rows.length;
      pages.push(`<section class="official-register-page" aria-label="ทะเบียนคุมทรัพย์สิน หน้า ${pages.length+1}"><div class="register-title rf-title">ทะเบียนคุมทรัพย์สิน</div><div class="rf-org">${field('organization')}${field('department')}</div><div class="rf-fields"><div class="rf-line rf-line-1">${field('type')}${field('code')}</div><div class="rf-line rf-line-2">${field('description')}${field('model')}</div><div class="rf-line rf-line-3">${field('location')}${field('vendor')}</div><div class="rf-line rf-line-4">${field('address')}${field('phone')}</div><div class="rf-line rf-line-5">${field('gfmis')}${field('po')}${field('serial')}${field('warranty')}</div><div class="rf-line rf-line-6">${field('fiscalYear')}${field('fund')}${field('method')}</div></div><table class="register-table rf-table"><colgroup>${[7.13,8.55,14.13,4.34,8.67,9.98,4.28,8.92,8.61,8.92,9.17,7.30].map(w=>`<col style="width:${w}%">`).join('')}</colgroup><thead><tr>${['วันเดือนปี','ที่เอกสาร','รายการ','จำนวน<br>หน่วย','ราคาต่อ<br>หน่วย','มูลค่ารวม','อายุใช้<br>งาน','อัตราค่าเสื่อมราคา<br>/ประจำเดือน','ค่าเสื่อมราคา<br>ประจำปี','ค่าเสื่อมราคา<br>สะสม','มูลค่าสุทธิ','หมายเหตุ'].map(s=>`<th>${s}</th>`).join('')}</tr></thead><tbody>${chunk.map((r,i)=>`<tr>${columns.map(([key])=>`<td><div class="rf-cell-value">${esc(display(key,r[key]||''))}</div>${last&&i===chunk.length-1&&(key==='date'||['annual','accumulated','net'].includes(key))?`<div class="rf-cell-total">${esc(key==='date'?state.form.fields.fiscalYear:total(key))}</div>`:''}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`);
    }
    paper.innerHTML=pages.join('');
    fitText(paper);
    setTimeout(updateScale, 10);
  }
  document.addEventListener('govasset:view-changed',event=>{
    if(event.detail.name==='register'){
      if(state)fitText(paper);
      setTimeout(updateScale, 20);
    }
  });
  window.addEventListener('resize',()=>{
    if($('#view-register')?.classList.contains('active')) updateScale();
  });
  function fitText(root){
    let fits=true;
    root.querySelectorAll('.rf-field b').forEach(el=>{
      let size=12;el.style.fontSize=`${size}pt`;
      while(el.scrollWidth>el.clientWidth+1&&size>8){size-=.25;el.style.fontSize=`${size}pt`;}
      if(el.scrollWidth>el.clientWidth+1)fits=false;
    });
    root.querySelectorAll('.rf-cell-value').forEach(el=>{let size=10;el.style.fontSize=`${size}pt`;while((el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)&&size>8){size-=.25;el.style.fontSize=`${size}pt`;}if(el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)fits=false;});
    return fits;
  }
  printButton.disabled=true;
  $('#editOfficialRegister').disabled=true;
  document.addEventListener('govasset:register-loading',()=>{
    ++epoch;state=null;paper.replaceChildren();printButton.disabled=true;$('#editOfficialRegister').disabled=true;
    $('#registerFormStatus').textContent='กำลังโหลดเอกสารของครุภัณฑ์ที่เลือก…';
  });
  document.addEventListener('govasset:register-loaded',async event=>{
    const n=++epoch,data=event.detail;
    const source=defaultForm(data).fields;
    const entries=[['วิธีการได้มา',source.method],['แหล่งเงิน',source.fund],['ผู้ขาย / ผู้บริจาค',source.vendor],['เลขที่ GFMIS / PO',[source.gfmis,source.po].filter(Boolean).join(' / ')],['ปีงบประมาณที่ได้มา',source.fiscalYear],['สถานที่ / หน่วยงานรับผิดชอบ',source.location]];
    $('#registerProvenanceSummary').innerHTML='<h2>ที่มาของครุภัณฑ์จากทะเบียน</h2><dl>'+entries.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'ยังไม่ระบุ')}</dd></div>`).join('')+'</dl>';
    try{
      const saved=await app.api(`/api/assets/${data.asset.id}/register-form`);
      if(n!==epoch)return;
      state={assetId:data.asset.id,revision:saved.revision,form:saved.form||defaultForm(data)};
      await document.fonts.ready;if(n!==epoch)return;
      render();printButton.disabled=false;$('#editOfficialRegister').disabled=false;
      $('#registerFormStatus').textContent=`A4 แนวนอน · ${saved.form?'เอกสารที่บันทึกไว้ ฉบับแก้ไข '+saved.revision:'ตรวจและเติมช่องว่างก่อนพิมพ์'}`;
    }catch(error){if(n!==epoch)return;$('#registerFormStatus').textContent='โหลดเอกสารไม่สำเร็จ กรุณากลับไปเปิดจากรายการครุภัณฑ์อีกครั้ง';app.showError(error);}
  });
  $('#editOfficialRegister').onclick=()=>{
    if(!state)return app.toast('เลือกรายการครุภัณฑ์ก่อน');
    if(app.getRole()!=='เจ้าหน้าที่พัสดุ')return app.toast('เลือกบทบาทเจ้าหน้าที่พัสดุเพื่อแก้ไขเอกสาร');
    const editingState=state;
    editor.innerHTML=`<form id="registerEditorForm"><div class="dialog-head"><div><div class="eyebrow">เอกสารราชการ · แก้ไขข้อมูลก่อนพิมพ์</div><h2>ทะเบียนคุมทรัพย์สิน</h2></div><button class="dialog-close" type="button" id="closeRegisterEditor">×</button></div><p>ข้อมูลเอกสารเก็บแยกจากหลักฐานนำเข้า ช่องที่ไม่มีข้อมูลให้เว้นว่าง ไม่สร้างยอดขึ้นเอง</p><div class="register-editor-fields">${fields.map(([key,label])=>`<label>${esc(label)}<input name="${key}" maxlength="500" value="${esc(state.form.fields[key])}"></label>`).join('')}</div><h3>รายการในตาราง</h3><div id="registerRowEditors"></div><button class="button outline" id="addRegisterRow" type="button">＋ เพิ่มแถวรายการ</button><h3>บรรทัดสรุปท้ายตาราง</h3><p>ใช้ค่าสุดท้ายที่มีข้อมูลเป็นค่าเริ่มต้น ตรวจทานกับต้นทางได้เอง ไม่บวกมูลค่าสะสมและมูลค่าสุทธิข้ามปี</p><div class="register-editor-fields">${['annual','accumulated','net'].map(key=>`<label>${esc(columns.find(c=>c[0]===key)[1])}<input name="sum_${key}" type="number" min="0" step="0.0001" value="${esc(summaryValue(key))}"></label>`).join('')}</div><div class="dialog-actions"><button class="button primary" type="submit">บันทึกเอกสาร</button></div><p role="alert" id="registerEditorStatus"></p></form>`;
    let rows=structuredClone(editingState.form.rows);
    function renderRows(){
      $('#registerRowEditors').innerHTML=rows.map((r,i)=>`<fieldset class="register-row-editor" data-row="${i}"><legend>รายการที่ ${i+1}</legend><div class="register-editor-fields">${columns.map(([key,label])=>`<label>${esc(label)}<input data-column="${key}" value="${esc(r[key])}" maxlength="500" ${['quantity','life',...moneyKeys].includes(key)?'type="number" min="0" step="0.0001"':''}></label>`).join('')}</div><button class="button outline" type="button" data-remove-row="${i}" ${rows.length===1?'disabled':''}>ลบแถวนี้</button></fieldset>`).join('');
      $('#registerRowEditors').querySelectorAll('input').forEach(input=>input.oninput=()=>rows[Number(input.closest('[data-row]').dataset.row)][input.dataset.column]=input.value);
      $('#registerRowEditors').querySelectorAll('[data-remove-row]').forEach(b=>b.onclick=()=>{rows.splice(Number(b.dataset.removeRow),1);renderRows();});
    }
    renderRows();$('#closeRegisterEditor').onclick=()=>editor.close();$('#addRegisterRow').onclick=()=>{if(rows.length>=12)return app.toast('รองรับ 12 แถวต่อเอกสาร');rows.push(Object.fromEntries(columns.map(([k])=>[k,''])));renderRows();};
    $('#registerEditorForm').onsubmit=async event=>{event.preventDefault();const b=event.submitter;b.disabled=true;try{const raw=Object.fromEntries(new FormData(event.target));const form={fields:Object.fromEntries(fields.map(([key])=>[key,raw[key]])),rows,summary:Object.fromEntries(['annual','accumulated','net'].map(key=>[key,raw['sum_'+key]]))};const saved=await app.api(`/api/assets/${editingState.assetId}/register-form`,{method:'PUT',body:JSON.stringify({actor:app.getRole(),revision:editingState.revision,form})});if(state!==editingState)return;state.form=form;state.revision=saved.revision;render();editor.close();$('#registerFormStatus').textContent=`เอกสารที่บันทึกไว้ ฉบับแก้ไข ${saved.revision}`;app.toast('บันทึกเอกสารทะเบียนคุมแล้ว');}catch(error){if(state!==editingState)return;$('#registerEditorStatus').textContent=error.message;b.disabled=false;}};
    editor.showModal();
  };
  printButton.onclick=async()=>{
    if(!state)return app.toast('เลือกรายการครุภัณฑ์ก่อนพิมพ์');
    const frame=document.createElement('iframe');frame.className='smart-print-frame';frame.title='ทะเบียนคุมทรัพย์สิน A4 แนวนอน';document.body.append(frame);
    const doc=frame.contentDocument;doc.open();doc.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ทะเบียนคุมทรัพย์สิน ${esc(state.form.fields.code)}</title><link rel="stylesheet" href="${location.origin}/register-form.css"></head><body class="register-print">${paper.innerHTML}</body></html>`);doc.close();
    await new Promise(resolve=>{if(doc.readyState==='complete')resolve();else frame.onload=resolve;});await doc.fonts.ready;if(!fitText(doc)){frame.remove();return app.toast('มีข้อความยาวเกินช่องเอกสาร กรุณาย่อข้อความหรือแยกเป็นแถวเพิ่มเติมก่อนพิมพ์');}frame.contentWindow.focus();frame.contentWindow.print();frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});
  };
})();
