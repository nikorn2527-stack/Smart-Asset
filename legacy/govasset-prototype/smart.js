/* Asset workspace, persistent QR labels and configurable organization identity. */
(() => {
  const app = window.govAssetApp;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const credit = '<b class="team-credit">POWER BY PNG TEAM</b>';
  let branding = null, logo = '', selected = null;
  const dialog = document.createElement('dialog');
  dialog.className = 'asset-dialog smart-dialog';
  dialog.setAttribute('aria-label', 'รายละเอียดครุภัณฑ์และ Smart QR');
  document.body.append(dialog);
  dialog.addEventListener('click', e => { if (e.target === dialog || e.target.closest('[data-close-smart]')) dialog.close(); });

  async function openAsset(id) {
    try {
      const [data, categories] = await Promise.all([app.api(`/api/assets/${id}/smart`), app.api('/api/catalog/categories')]);
      selected = data;
      const a = data.asset, canEdit = app.getRole() === 'เจ้าหน้าที่พัสดุ';
      const active = data.tickets.filter(t => !['ปิดงาน','ยกเลิก','ไม่อนุมัติ'].includes(t.status));
      dialog.innerHTML = `<div class="smart-dialog-head"><div><span class="eyebrow">ASSET WORKSPACE</span><h2>${esc(a.name)}</h2><span class="code-text">${esc(a.code)}</span></div><button class="dialog-close" data-close-smart aria-label="ปิดรายละเอียด">×</button></div>
        <div class="smart-tabs" role="tablist"><button role="tab" aria-selected="true" data-smart-tab="info">ข้อมูลครุภัณฑ์</button><button role="tab" aria-selected="false" data-smart-tab="repairs">ประวัติซ่อม (${data.tickets.length})</button><button role="tab" aria-selected="false" data-smart-tab="history">ประวัติทะเบียน</button></div>
        <div class="smart-layout"><div><section data-smart-panel="info"><div class="smart-state"><span class="badge blue">${esc(a.status)}</span><span>${active.length ? `มีงานซ่อมที่กำลังดำเนินการ ${active.length} งาน` : 'ไม่มีงานซ่อมค้าง'}</span></div>
        <form id="smartAssetForm" class="smart-form"><div class="form-grid"><label>ชื่อครุภัณฑ์<input name="name" required maxlength="300" value="${esc(a.name)}"></label><label>รหัสครุภัณฑ์<input name="code" required maxlength="80" value="${esc(a.code)}"></label></div><label>หมวดครุภัณฑ์<select name="categoryId" required><option value="">เลือกหมวดครุภัณฑ์</option>${categories.map(c => `<option value="${c.id}" ${Number(c.id) === Number(a.categoryId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label>รายละเอียด<textarea name="detail" maxlength="1000" rows="3">${esc(a.detail)}</textarea></label><div class="form-grid"><label>สถานที่ตั้ง<input name="location" required maxlength="300" value="${esc(a.location)}"></label><label>หมายเลขเครื่อง / Serial<input name="serialNumber" maxlength="160" value="${esc(a.serialNumber)}"></label><label>ผู้ดูแลครุภัณฑ์<input name="custodian" maxlength="160" value="${esc(a.custodian)}"></label><label>สิ้นสุดประกัน<input name="warrantyEnd" type="date" value="${esc(a.warrantyEnd)}"></label></div><p class="field-hint">${canEdit ? 'การแก้ไขจะบันทึกประวัติ และแสดงข้อมูลใหม่ผ่าน QR เดิมทันที' : 'เลือกบทบาทเจ้าหน้าที่พัสดุเพื่อแก้ไขทะเบียนในโหมดทดสอบ'}</p><div class="dialog-actions"><button class="button outline" type="button" id="smartRepair">แจ้งซ่อมรายการนี้</button>${canEdit ? '<button class="button primary" type="submit">บันทึกข้อมูล</button>' : ''}</div><p id="smartSaveStatus" role="status"></p></form></section>
        <section data-smart-panel="repairs" hidden><h3>ประวัติงานซ่อม</h3><p class="field-hint">ค่าใช้จ่ายจริงรวม ${data.tickets.filter(t => t.status !== 'ยกเลิก').reduce((sum,t) => sum + Number(t.actualCost || 0), 0).toLocaleString('th-TH')} บาท</p><div class="smart-ticket-list">${data.tickets.map(t => `<button type="button" data-smart-ticket="${t.id}"><span><b>${esc(t.ticketNo)}</b><small>${esc(t.issue)}</small><small>${esc(app.fmtDate(t.createdAt))} · ${esc(t.assignedTo || 'ยังไม่มอบหมาย')}</small></span><span class="badge blue">${esc(t.status)}</span></button>`).join('') || '<div class="smart-empty">ยังไม่มีประวัติซ่อมสำหรับครุภัณฑ์นี้</div>'}</div></section>
        <section data-smart-panel="history" hidden><h3>ประวัติการเปลี่ยนแปลงทะเบียน</h3><ol class="smart-history">${data.events.map(e => `<li><b>${esc(e.action)}</b><span>${esc(e.actor)} · ${esc(app.fmtDate(e.createdAt))}</span></li>`).join('') || '<li>ยังไม่มีการแก้ไขทะเบียน</li>'}</ol></section></div>
        <aside class="smart-qr-card"><span class="eyebrow">SMART ASSET QR</span><img class="smart-qr" src="${data.qrImage}" alt="QR ประจำครุภัณฑ์ ${esc(a.code)}"><h3>หนึ่งฉลาก ข้อมูลล่าสุดเสมอ</h3><p>สแกนดูข้อมูลและแจ้งซ่อมได้ทันที เปลี่ยนชื่อ รหัส หรือที่ตั้งได้โดยใช้ QR เดิม</p><a class="button primary" href="${esc(data.qrUrl)}" target="_blank" rel="noopener">เปิดหน้าสแกน</a><button type="button" class="button outline" id="copySmartUrl">คัดลอกลิงก์</button><button type="button" class="button outline" id="printSmartLabel">พิมพ์ฉลาก QR</button><small>โทรศัพท์ต้องเข้าถึงโดเมนระบบได้ ตั้งค่าโดเมนถาวรก่อนพิมพ์ใช้งาน</small><span>${credit}</span></aside></div>`;
      if (!canEdit) dialog.querySelectorAll('#smartAssetForm input,#smartAssetForm textarea,#smartAssetForm select').forEach(el => el.disabled = true);
      dialog.querySelectorAll('[data-smart-tab]').forEach(button => button.onclick = () => {
        dialog.querySelectorAll('[data-smart-tab]').forEach(b => b.setAttribute('aria-selected', String(b === button)));
        dialog.querySelectorAll('[data-smart-panel]').forEach(p => p.hidden = p.dataset.smartPanel !== button.dataset.smartTab);
      });
      dialog.querySelectorAll('[data-smart-ticket]').forEach(button => button.onclick = () => { dialog.close(); app.openTicket(Number(button.dataset.smartTicket)); });
      $('#smartRepair', dialog).onclick = () => {
        dialog.close(); app.openRepairDialog();
        $('#repairAsset').value = a.name; $('#repairAssetCode').value = a.code; $('#repairLocation').value = a.location;
        let input = $('#repairForm input[name="assetId"]');
        if (!input) { input = document.createElement('input'); input.type='hidden'; input.name='assetId'; $('#repairForm').append(input); }
        input.value = a.id;
      };
      $('#copySmartUrl', dialog).onclick = async () => {
        try { await navigator.clipboard.writeText(data.qrUrl); app.toast('คัดลอกลิงก์ประจำครุภัณฑ์แล้ว'); }
        catch { $('#smartSaveStatus', dialog).textContent = `ลิงก์ประจำครุภัณฑ์: ${data.qrUrl}`; }
      };
      $('#printSmartLabel', dialog).onclick = () => printLabel(data);
      $('#smartAssetForm', dialog).onsubmit = async event => {
        event.preventDefault(); const button = event.submitter; button.disabled = true;
        try {
          await app.api(`/api/assets/${a.id}/smart`, {method:'PUT',body:JSON.stringify({...Object.fromEntries(new FormData(event.target)),actor:app.getRole(),version:data.version})});
          await app.refreshData(); await openAsset(a.id); app.toast('บันทึกข้อมูลแล้ว QR เดิมแสดงข้อมูลล่าสุด');
        } catch (error) { $('#smartSaveStatus', dialog).textContent = error.message; button.disabled = false; }
      };
      if (!dialog.open) dialog.showModal();
    } catch (error) { app.showError(error); }
  }
  function printLabel(data) {
    const frame = document.createElement('iframe'); frame.className='smart-print-frame'; frame.title='พิมพ์ฉลาก Smart QR'; document.body.append(frame);
    const a=data.asset;
    const doc=frame.contentDocument;
    doc.open(); doc.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ฉลาก ${esc(a.code)}</title><style>@page{size:80mm 60mm;margin:3mm}*{box-sizing:border-box}body{font:11px Tahoma,sans-serif;margin:0;color:#123d56}.label{width:72mm;border:1px solid #b7c8d5;border-radius:3mm;padding:3mm;text-align:center}header{display:flex;align-items:center;gap:2mm;justify-content:center}header img{width:9mm;height:9mm;object-fit:contain}.qr{width:28mm;height:28mm;display:block;margin:auto}b{display:block}.team-credit{color:#f97316!important;font-size:8px}p{margin:1mm}</style></head><body><div class="label"><header><img src="${esc(branding?.logo || `${location.origin}/assets/govasset-mark-optimized.png`)}" alt=""><b>${esc(branding?.organization || 'GovAsset')}</b></header><img class="qr" src="${data.qrImage}" alt="QR"><b>${esc(a.code)}</b><p>${esc(a.name)}</p><p>สแกนดูข้อมูล · แจ้งซ่อม</p>${credit}</div></body></html>`); doc.close();
    Promise.all([...doc.images].map(img => img.decode().catch(()=>{}))).then(() => { frame.contentWindow.focus(); frame.contentWindow.print(); });
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), {once:true});
  }
  document.addEventListener('click', event => { const b=event.target.closest('[data-smart-id]'); if(b)openAsset(Number(b.dataset.smartId)); });
  // Reset the explicit asset relation whenever a free-entry repair form is reopened.
  $('#repairDialog').addEventListener('close', () => $('#repairForm input[name="assetId"]')?.remove());

  function applyBranding(b) {
    branding=b; logo=b.logo; window.govAssetBranding=b; document.title=`${$('#crumbCurrent').textContent} — ${b.appName}`;
    $('.brand-copy strong').textContent=b.appName; $('.brand-copy span').textContent=b.organization;
    $('.brand-mark img').src=b.logo || 'assets/govasset-mark-optimized.png';
    $('.crumb > span').textContent=b.organization;
    $('.footer > span').textContent=`${b.appName} · ระบบจัดการครุภัณฑ์และงานซ่อม`;
    $('#brandingPreview').src=b.logo || 'assets/govasset-mark-optimized.png';
    $('#brandingPreviewName').textContent=b.appName;
    const form=$('#brandingForm');
    ['appName','organization','publicBaseUrl'].forEach(key => form.elements[key].value=b[key] || '');
  }
  $('#brandingLogo').onchange = async event => {
    const file=event.target.files[0]; if(!file)return;
    if(file.size>500000 || !['image/png','image/jpeg','image/webp'].includes(file.type)) { $('#brandingStatus').textContent='เลือกภาพ PNG, JPEG หรือ WebP ขนาดไม่เกิน 500 KB'; event.target.value=''; return; }
    const reader=new FileReader(); reader.onload=()=>{logo=reader.result;$('#brandingPreview').src=logo;}; reader.readAsDataURL(file);
  };
  $('#removeBrandingLogo').onclick=()=>{logo='';$('#brandingLogo').value='';$('#brandingPreview').src='assets/govasset-mark-optimized.png';};
  $('#brandingForm').elements.appName.addEventListener('input', e => $('#brandingPreviewName').textContent=e.target.value);
  $('#brandingForm').onsubmit=async event=>{
    event.preventDefault();const button=event.submitter;button.disabled=true;
    try { const b=await app.api('/api/branding',{method:'PUT',body:JSON.stringify({...Object.fromEntries(new FormData(event.target)),logo,actor:app.getRole()})});applyBranding(b);$('#brandingStatus').textContent='บันทึกแล้ว ชื่อและโลโก้จะใช้ร่วมกับหน้าสแกนและฉลาก QR';app.toast('บันทึกอัตลักษณ์หน่วยงานแล้ว'); }
    catch(error){$('#brandingStatus').textContent=error.message;}finally{button.disabled=false;}
  };
  const heading=$('#view-dashboard .page-heading p'); if(heading)heading.textContent='ทะเบียนที่เป็นปัจจุบัน งานซ่อมที่ติดตามได้ และ Smart QR ที่เชื่อมทุกขั้นตอน';
  const eyebrow=$('#view-dashboard .page-heading .eyebrow');if(eyebrow)eyebrow.textContent=new Date().toLocaleDateString('th-TH',{dateStyle:'full',timeZone:'Asia/Bangkok'});
  const hero=document.createElement('div');hero.className='smart-hero';hero.innerHTML=`<div><span class="eyebrow">CONNECTED ASSET MANAGEMENT</span><h2>ดูแลทุกครุภัณฑ์<br>เชื่อมทุกงานซ่อม</h2><p>สแกนดูข้อมูลล่าสุด แจ้งปัญหา และติดตามจนถึงตรวจรับงาน ด้วย QR ประจำครุภัณฑ์เพียงหนึ่งเดียว</p><div><button class="button primary" id="smartGoAssets">เปิดทะเบียน / ออก QR ↗</button><button class="button outline" id="smartGoRepairs">ติดตามงานซ่อม</button></div></div><div class="smart-hero-flow"><span>01 <b>ขึ้นทะเบียน</b></span><i>↓</i><span>02 <b>ติด QR ประจำรายการ</b></span><i>↓</i><span>03 <b>สแกน · แจ้งซ่อม · ตรวจรับ</b></span></div>`;
  $('#view-dashboard .notice').after(hero);
  $('#smartGoAssets').onclick=()=>app.switchView('assets');$('#smartGoRepairs').onclick=()=>app.switchView('repairs');
  app.api('/api/branding').then(applyBranding).catch(app.showError);
})();
