/* Asset workspace, persistent QR labels and configurable organization identity. */
(() => {
  const app = window.govAssetApp;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const credit = '<b class="team-credit">POWER BY PNG TEAM</b>';
  let branding = null, logo = '', selected = null;
  let logoVersion = 0, logoLoading = false, brandingSaving = false, logoError = '';
  let pendingLogo = Promise.resolve();
  const dialog = document.createElement('dialog');
  dialog.className = 'asset-dialog smart-dialog';
  dialog.setAttribute('aria-label', 'รายละเอียดครุภัณฑ์และ Smart QR');
  document.body.append(dialog);
  dialog.addEventListener('click', e => { if (e.target === dialog || e.target.closest('[data-close-smart]')) dialog.close(); });

  function renderModalLedger(reg, a) {
    if (!reg) return '<p class="field-hint">ไม่พบข้อมูลใบคุมสำหรับรายการนี้</p>';
    const asset = reg.asset || a || {}, acqs = (reg.acquisitions && reg.acquisitions.length) ? reg.acquisitions : [{
      acquired_on: asset.acquiredOn || asset.date,
      document_no: asset.poNo || asset.gfmisNo || '—',
      item_description: asset.name,
      quantity: 1,
      unit_price: asset.purchasePrice,
      total_price: asset.purchasePrice,
      useful_life_years: asset.usefulLifeYears || '—',
      monthly_depreciation: asset.monthlyDepreciation || '—',
      annual_depreciation: asset.annualDepreciation || '—',
      accumulated_depreciation: asset.accumulatedDepreciation || '—',
      net_book_value: asset.netBookValue || asset.purchasePrice || '—',
      notes: asset.detail || '—'
    }];
    return `<div class="modal-ledger-meta">
      <div><span>ส่วนราชการ / หน่วยงาน:</span> <b>${esc(asset.organization || '—')} / ${esc(asset.department || asset.responsibleUnit || '—')}</b></div>
      <div><span>ประเภท / หมวด:</span> <b>${esc(asset.group || asset.assetType || '—')}</b></div>
      <div><span>เลขที่ GFMIS / PO:</span> <b>${esc([asset.gfmisNo, asset.poNo].filter(Boolean).join(' / ') || '—')}</b></div>
      <div><span>ผู้ขาย / ผู้ส่งมอบ:</span> <b>${esc(asset.vendor || '—')}</b></div>
      <div><span>วิธีการได้มา / แหล่งเงิน:</span> <b>${esc(asset.acquisitionMethod || 'จัดซื้อ')} / ${esc(asset.fundType || 'เงินงบประมาณ')}</b></div>
      <div><span>มูลค่าจัดซื้อ / มูลค่าสุทธิ:</span> <b>${asset.purchasePrice ? Number(asset.purchasePrice).toLocaleString('th-TH') + ' บาท' : '—'} / ${asset.netBookValue ? Number(asset.netBookValue).toLocaleString('th-TH') + ' บาท' : '—'}</b></div>
    </div>
    <div class="table-wrap">
      <table class="modal-ledger-table">
        <thead>
          <tr>
            <th>1. วันเดือนปี</th>
            <th>2. ที่เอกสาร</th>
            <th>3. รายการ</th>
            <th>4. จำนวน</th>
            <th>5. ราคา/หน่วย</th>
            <th>6. มูลค่ารวม</th>
            <th>7. อายุ (ปี)</th>
            <th>8. ค่าเสื่อม/ด.</th>
            <th>9. ค่าเสื่อม/ปี</th>
            <th>10. ค่าเสื่อมสะสม</th>
            <th>11. มูลค่าสุทธิ</th>
            <th>12. หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          ${acqs.map(rw => `
            <tr>
              <td>${esc(app.fmtDate(rw.acquired_on || rw.date || asset.acquiredOn))}</td>
              <td>${esc(rw.document_no || rw.po_no || asset.poNo || '—')}</td>
              <td><b>${esc(rw.item_description || asset.name)}</b></td>
              <td style="text-align:center">${esc(rw.quantity || 1)}</td>
              <td style="text-align:right">${rw.unit_price ? Number(rw.unit_price).toLocaleString('th-TH', {minimumFractionDigits:2}) : '—'}</td>
              <td style="text-align:right">${rw.total_price ? Number(rw.total_price).toLocaleString('th-TH', {minimumFractionDigits:2}) : '—'}</td>
              <td style="text-align:center">${esc(rw.useful_life_years || asset.usefulLifeYears || '—')}</td>
              <td style="text-align:right">${rw.monthly_depreciation ? Number(rw.monthly_depreciation).toLocaleString('th-TH', {minimumFractionDigits:2}) : '—'}</td>
              <td style="text-align:right">${rw.annual_depreciation ? Number(rw.annual_depreciation).toLocaleString('th-TH', {minimumFractionDigits:2}) : '—'}</td>
              <td style="text-align:right">${rw.accumulated_depreciation ? Number(rw.accumulated_depreciation).toLocaleString('th-TH', {minimumFractionDigits:2}) : '—'}</td>
              <td style="text-align:right"><b>${rw.net_book_value ? Number(rw.net_book_value).toLocaleString('th-TH', {minimumFractionDigits:2}) : '—'}</b></td>
              <td>${esc(rw.notes || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
  }

  async function openAsset(id) {
    try {
      const [data, categories, accountContext, regData] = await Promise.all([
        app.api(`/api/assets/${id}/smart`),
        app.api('/api/catalog/categories'),
        app.api(`/api/governance/assets/${id}`),
        app.api(`/api/assets/${id}/register`).catch(() => null)
      ]);
      selected = data;
      const a = data.asset, canEdit = app.getRole() === 'เจ้าหน้าที่พัสดุ';
      const active = data.tickets.filter(t => !['ปิดงาน','ยกเลิก','ไม่อนุมัติ'].includes(t.status));
      dialog.innerHTML = `<div class="smart-dialog-head"><div><span class="eyebrow">ASSET WORKSPACE</span><h2>${esc(a.name)}</h2><span class="code-text">เลขประจำครุภัณฑ์ ${esc(a.code)}</span><p class="field-hint">รหัสจำแนก FSN: ${esc(a.fsnCode||'ยังไม่ได้ระบุแยก · คงเลขเดิมตามทะเบียน')}</p></div><button class="dialog-close" data-close-smart aria-label="ปิดรายละเอียด">×</button></div>
        <div class="smart-tabs" role="tablist">
          <button role="tab" aria-selected="true" data-smart-tab="info">ข้อมูลครุภัณฑ์</button>
          <button role="tab" aria-selected="false" data-smart-tab="ledger">📋 ใบคุม 12 คอลัมน์</button>
          <button role="tab" aria-selected="false" data-smart-tab="repairs">ประวัติซ่อม (${data.tickets.length})</button>
          <button role="tab" aria-selected="false" data-smart-tab="history">ประวัติทะเบียน</button>
        </div>
        <div class="smart-layout"><div>
          <section data-smart-panel="info"><div class="smart-state"><span class="badge blue">${esc(a.status)}</span><span>${active.length ? `มีงานซ่อมที่กำลังดำเนินการ ${active.length} งาน` : 'ไม่มีงานซ่อมค้าง'}</span></div>
          ${window.govAssetAccountContextMarkup?.(accountContext)||''}<form id="smartAssetForm" class="smart-form"><div class="form-grid"><label>ชื่อครุภัณฑ์<input name="name" required maxlength="300" value="${esc(a.name)}"></label><label>รหัสครุภัณฑ์<input name="code" required maxlength="80" value="${esc(a.code)}"></label></div><label>หมวดครุภัณฑ์<select name="categoryId" required><option value="">เลือกหมวดครุภัณฑ์</option>${categories.map(c => `<option value="${c.id}" ${Number(c.id) === Number(a.categoryId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label>รายละเอียด<textarea name="detail" maxlength="1000" rows="3">${esc(a.detail)}</textarea></label><div class="form-grid"><label>สถานที่ตั้ง<input name="location" required maxlength="300" value="${esc(a.location)}"></label><label>หมายเลขเครื่อง / Serial<input name="serialNumber" maxlength="160" value="${esc(a.serialNumber)}"></label><label>ผู้ดูแลครุภัณฑ์<input name="custodian" maxlength="160" value="${esc(a.custodian)}"></label><label>สิ้นสุดประกัน<input name="warrantyEnd" type="date" value="${esc(a.warrantyEnd)}"></label></div><p class="field-hint">${canEdit ? 'การแก้ไขจะบันทึกประวัติ และแสดงข้อมูลใหม่ผ่าน QR เดิมทันที' : 'สำหรับเจ้าหน้าที่พัสดุที่มีสิทธิ์แก้ไขทะเบียนครุภัณฑ์'}</p><div class="dialog-actions"><button class="button outline" type="button" id="smartRegister">📋 เปิดใบคุมทรัพย์สินเต็มหน้า (A4)</button><button class="button outline" type="button" id="smartRepair">แจ้งซ่อมรายการนี้</button>${canEdit ? '<button class="button primary" type="submit">บันทึกข้อมูล</button>' : ''}</div><p id="smartSaveStatus" role="status"></p></form></section>
          <section data-smart-panel="ledger" hidden>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
              <div>
                <h3 style="margin:0;font-size:16px;color:var(--smart-ink)">ทะเบียนคุมทรัพย์สิน (ตามระเบียบกระทรวงการคลังฯ)</h3>
                <small style="color:#64798b">เอกสารมาตรฐาน 12 คอลัมน์สำหรับตรวจสอบและควบคุมสินทรัพย์</small>
              </div>
              <div style="display:flex;gap:8px">
                <button type="button" class="button outline mini-action" id="openFullRegisterPage">หน้าใบคุม A4 เต็ม</button>
              </div>
            </div>
            <div class="modal-ledger-wrap" id="modalLedgerContent">
              ${renderModalLedger(regData, a)}
            </div>
          </section>
          <section data-smart-panel="repairs" hidden><h3>ประวัติงานซ่อม</h3><p class="field-hint">ค่าใช้จ่ายจริงรวม ${data.tickets.filter(t => t.status !== 'ยกเลิก').reduce((sum,t) => sum + Number(t.actualCost || 0), 0).toLocaleString('th-TH')} บาท</p><div class="smart-ticket-list">${data.tickets.map(t => `<button type="button" data-smart-ticket="${t.id}"><span><b>${esc(t.ticketNo)}</b><small>${esc(t.issue)}</small><small>${esc(app.fmtDate(t.createdAt))} · ${esc(t.assignedTo || 'ยังไม่มอบหมาย')}</small></span><span class="badge blue">${esc(t.status)}</span></button>`).join('') || '<div class="smart-empty">ยังไม่มีประวัติซ่อมสำหรับครุภัณฑ์นี้</div>'}</div></section>
          <section data-smart-panel="history" hidden><h3>ประวัติการเปลี่ยนแปลงทะเบียน</h3><ol class="smart-history">${data.events.map(e => `<li><b>${esc(e.action)}</b><span>${esc(e.actor)} · ${esc(app.fmtDate(e.createdAt))}</span></li>`).join('') || '<li>ยังไม่มีการแก้ไขทะเบียน</li>'}</ol></section></div>
          <aside class="smart-qr-card"><span class="eyebrow">SMART ASSET QR</span><img class="smart-qr" src="${data.qrImage}" alt="QR ประจำครุภัณฑ์ ${esc(a.code)}"><h3>หนึ่งฉลาก ข้อมูลล่าสุดเสมอ</h3><p>สแกนดูข้อมูลและแจ้งซ่อมได้ทันที เปลี่ยนชื่อ รหัส หรือที่ตั้งได้โดยใช้ QR เดิม</p><a class="button primary" href="${esc(data.qrUrl)}" target="_blank" rel="noopener">เปิดหน้าสแกน</a><button type="button" class="button outline" id="copySmartUrl">คัดลอกลิงก์</button><button type="button" class="button outline" id="printSmartLabel">พิมพ์ฉลาก QR</button><small>โทรศัพท์ต้องเข้าถึงโดเมนระบบได้ ตั้งค่าโดเมนถาวรก่อนพิมพ์ใช้งาน</small><span>${credit}</span></aside></div>`;
      if(a.accountId) {
        dialog.querySelector('#smartAssetForm [name="code"]').readOnly=true;
        const category=dialog.querySelector('#smartAssetForm [name="categoryId"]');
        category.disabled=true;
        const preserved=document.createElement('input');preserved.type='hidden';preserved.name='categoryId';preserved.value=a.categoryId;dialog.querySelector('#smartAssetForm').append(preserved);
      }
      if (!canEdit) dialog.querySelectorAll('#smartAssetForm input,#smartAssetForm textarea,#smartAssetForm select').forEach(el => el.disabled = true);
      dialog.querySelectorAll('[data-smart-tab]').forEach(button => button.onclick = () => {
        dialog.querySelectorAll('[data-smart-tab]').forEach(b => b.setAttribute('aria-selected', String(b === button)));
        dialog.querySelectorAll('[data-smart-panel]').forEach(p => p.hidden = p.dataset.smartPanel !== button.dataset.smartTab);
      });
      dialog.querySelectorAll('[data-smart-ticket]').forEach(button => button.onclick = () => { dialog.close(); app.openTicket(Number(button.dataset.smartTicket)); });
      $('#smartRepair', dialog).onclick = () => {
        dialog.close(); app.openRepairDialog(a);
      };
      $('#copySmartUrl', dialog).onclick = async () => {
        try { await navigator.clipboard.writeText(data.qrUrl); app.toast('คัดลอกลิงก์ประจำครุภัณฑ์แล้ว'); }
        catch { $('#smartSaveStatus', dialog).textContent = `ลิงก์ประจำครุภัณฑ์: ${data.qrUrl}`; }
      };
      $('#smartRegister', dialog).onclick = () => { dialog.close(); app.openRegister(a.id); };
      $('#openFullRegisterPage', dialog).onclick = () => { dialog.close(); app.openRegister(a.id); };
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
  const brandingSubmit=$('#brandingForm button[type="submit"]');
  const updateBrandingButton=()=>{brandingSubmit.disabled=logoLoading||brandingSaving;$('#brandingLogo').disabled=brandingSaving;$('#removeBrandingLogo').disabled=brandingSaving;};
  async function prepareLogo(file) {
    if(file.size>8*1024*1024)throw new Error('เลือกภาพโลโก้ขนาดไม่เกิน 8 MB');
    const ext=file.name.split('.').at(-1).toLowerCase();
    const mime=({'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp'})[ext] || file.type;
    if(!['image/png','image/jpeg','image/webp'].includes(mime))throw new Error('เลือกภาพ PNG, JPEG หรือ WebP');
    const source=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('อ่านไฟล์โลโก้ไม่สำเร็จ กรุณาเลือกไฟล์อีกครั้ง'));
      reader.readAsDataURL(new Blob([file],{type:mime}));
    });
    const image=await new Promise((resolve,reject)=>{const value=new Image();value.onload=()=>resolve(value);value.onerror=()=>reject(new Error('ไฟล์ภาพโลโก้ไม่ถูกต้องหรือเปิดอ่านไม่ได้'));value.src=source;});
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw new Error('ภาพมีความละเอียดสูงเกินไป กรุณาย่อภาพก่อนเลือก');
    const canvas=document.createElement('canvas');let scale=Math.min(1,1024/image.naturalWidth,1024/image.naturalHeight);
    for(let attempt=0;attempt<8;attempt++){
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      const result=canvas.toDataURL('image/png');
      if(result.startsWith('data:image/png;base64,')&&atob(result.split(',')[1]).length<=500000)return result;
      scale*=0.75;
    }
    throw new Error('ยังย่อภาพให้จัดเก็บไม่ได้ กรุณาเลือกภาพที่เล็กลง');
  }
  $('#brandingLogo').onchange = event => {
    const file=event.target.files[0];if(!file)return;
    const version=++logoVersion;logoError='';logoLoading=true;updateBrandingButton();
    $('#brandingStatus').textContent='กำลังอ่านและปรับขนาดโลโก้…';
    pendingLogo=prepareLogo(file).then(value=>{
      if(version!==logoVersion)return;
      logo=value;$('#brandingPreview').src=value;
      $('#brandingStatus').textContent='เตรียมโลโก้แล้ว กด “บันทึกการตั้งค่า” เพื่อใช้งาน';
    }).catch(error=>{
      if(version!==logoVersion)return;
      logoError=error.message;$('#brandingStatus').textContent=error.message;event.target.value='';
    }).finally(()=>{if(version===logoVersion){logoLoading=false;updateBrandingButton();}});
  };
  $('#removeBrandingLogo').onclick=()=>{
    ++logoVersion;logoLoading=false;logoError='';pendingLogo=Promise.resolve();logo='';$('#brandingLogo').value='';
    $('#brandingPreview').src='assets/govasset-mark-optimized.png';
    $('#brandingStatus').textContent='เลือกโลโก้เริ่มต้นแล้ว กด “บันทึกการตั้งค่า” เพื่อใช้งาน';updateBrandingButton();
  };
  $('#brandingForm').elements.appName.addEventListener('input', e => $('#brandingPreviewName').textContent=e.target.value);
  $('#brandingForm').onsubmit=async event=>{
    event.preventDefault();
    if(app.getRole()!=='เจ้าหน้าที่พัสดุ'){$('#brandingStatus').textContent='สำหรับเจ้าหน้าที่พัสดุที่มีสิทธิ์บันทึกการตั้งค่าระบบ';return;}
    if(brandingSaving)return;
    brandingSaving=true;updateBrandingButton();
    try {
      await pendingLogo;
      if(logoError)throw new Error(logoError);
      const form=event.target;
      const b=await app.api('/api/branding',{method:'PUT',body:JSON.stringify({...Object.fromEntries(new FormData(form)),logo,actor:app.getRole()})});
      applyBranding(b);$('#brandingLogo').value='';$('#brandingStatus').textContent='บันทึกแล้ว ชื่อและโลโก้จะใช้ร่วมกับหน้าสแกนและฉลาก QR';app.toast('บันทึกอัตลักษณ์หน่วยงานแล้ว');
    }catch(error){$('#brandingStatus').textContent=error.message;}finally{brandingSaving=false;updateBrandingButton();}
  };
  const simDialog = document.createElement('dialog');
  simDialog.className = 'asset-dialog smart-dialog qr-simulator-modal';
  simDialog.setAttribute('aria-label', 'จำลองการใช้งาน Smart QR บนสมาร์ทโฟน');
  document.body.append(simDialog);
  simDialog.addEventListener('click', e => { if (e.target === simDialog || e.target.closest('[data-close-sim]')) simDialog.close(); });

  function openQrSimulator(sampleIndex = 0) {
    const sampleAssets = [
      {
        name: 'เครื่องฟังหัวใจเด็กในครรภ์ (Fetal Doppler)',
        code: '6515-027-1005-0012',
        fsn: '6515-027-1005',
        location: 'ศูนย์แพทย์โรงพยาบาลสุรินทร์ · แผนกสูติ-นรีเวชกรรม',
        status: 'พร้อมใช้งาน',
        custodian: 'พว. กัลยา วารีสุข',
        model: 'Edan Sonotrax B · S/N: SN-884210',
        lastChecked: '26 ตุลาคม 2569 · ผ่านเกณฑ์ PM',
        openRepairs: 0
      },
      {
        name: 'เครื่องตรวจคลื่นไฟฟ้าหัวใจ (EKG 12 Leads)',
        code: '6515-001-0019-0004',
        fsn: '6515-001-0019',
        location: 'ศูนย์แพทย์โรงพยาบาลสุรินทร์ · ห้องฉุกเฉิน (ER)',
        status: 'พร้อมใช้งาน',
        custodian: 'นพ. สมเกียรติ พยาธิกุล',
        model: 'GE MAC 2000 · S/N: GE-992144',
        lastChecked: '25 ตุลาคม 2569 · ผ่านเกณฑ์ PM',
        openRepairs: 0
      },
      {
        name: 'เครื่องวัดความดันโลหิตแบบสอดแขนอัตโนมัติ',
        code: '6515-014-0008-0021',
        fsn: '6515-014-0008',
        location: 'ศูนย์แพทย์โรงพยาบาลสุรินทร์ · แผนกผู้ป่วยนอก (OPD)',
        status: 'รอตรวจสอบ',
        custodian: 'พว. นงลักษณ์ รักษ์ธรรม',
        model: 'Omron HBP-9030 · S/N: OM-552190',
        lastChecked: '20 ตุลาคม 2569 · ครบกำหนดรอบตรวจสอบ',
        openRepairs: 1
      }
    ];
    const item = sampleAssets[sampleIndex] || sampleAssets[0];
    simDialog.innerHTML = `
      <div class="smart-dialog-head">
        <div>
          <span class="eyebrow"><span class="hero-live-beacon"></span> SMART QR SCAN SIMULATION</span>
          <h2>จำลองการสแกน QR บนสมาร์ทโฟน</h2>
          <p class="field-hint">สแกนดูข้อมูลล่าสุด แจ้งปัญหา และติดตามจนถึงตรวจรับงาน ด้วย QR ประจำครุภัณฑ์เพียงหนึ่งเดียว</p>
        </div>
        <button class="dialog-close" data-close-sim aria-label="ปิดหน้าต่างจำลอง">×</button>
      </div>
      <div class="sim-modal-body">
        <div class="sim-selector-bar">
          <span class="sim-select-label">เลือกครุภัณฑ์ทดสอบ:</span>
          <div class="sim-asset-pills">
            ${sampleAssets.map((a, i) => `
              <button type="button" class="sim-pill-btn ${i === sampleIndex ? 'active' : ''}" data-sim-pick="${i}">
                ${esc(a.name.split(' (')[0])}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="sim-phone-wrapper">
          <div class="sim-phone-frame">
            <div class="phone-notch"><span class="camera-lens"></span><span class="speaker-grill"></span></div>
            <div class="phone-status-bar">
              <span>09:41</span>
              <span>ศูนย์แพทย์โรงพยาบาลสุรินทร์</span>
              <span>5G 100%</span>
            </div>
            <div class="phone-screen-content">
              <div class="phone-scan-header">
                <div class="phone-brand-mark">▦</div>
                <div>
                  <strong>GovAsset Smart QR</strong>
                  <small>ศูนย์แพทย์โรงพยาบาลสุรินทร์</small>
                </div>
                <span class="phone-scan-verified">✓ ข้อมูลล่าสุด</span>
              </div>

              <div class="phone-asset-card">
                <div class="phone-card-top">
                  <span class="phone-kicker">ข้อมูลครุภัณฑ์</span>
                  <span class="phone-status-badge ${item.status === 'พร้อมใช้งาน' ? 'green' : 'amber'}">${esc(item.status)}</span>
                </div>
                <h3 class="phone-asset-name">${esc(item.name)}</h3>
                <div class="phone-code-pill">${esc(item.code)}</div>

                <div class="phone-detail-list">
                  <div class="phone-detail-row">
                    <span>📍 ที่ตั้ง:</span>
                    <b>${esc(item.location)}</b>
                  </div>
                  <div class="phone-detail-row">
                    <span>🏷️ รุ่น / S/N:</span>
                    <b>${esc(item.model)}</b>
                  </div>
                  <div class="phone-detail-row">
                    <span>👤 ผู้รับผิดชอบ:</span>
                    <b>${esc(item.custodian)}</b>
                  </div>
                  <div class="phone-detail-row">
                    <span>↻ สถานะ PM:</span>
                    <b style="color:#059669">${esc(item.lastChecked)}</b>
                  </div>
                </div>

                <div class="phone-qr-showcase">
                  <div class="phone-mini-qr">
                    <img src="assets/govasset-mark-optimized.png" alt="QR Code" style="width:48px;height:48px;object-fit:contain;">
                  </div>
                  <div>
                    <small style="color:#087e82;font-weight:700">QR ประจำครุภัณฑ์เพียงหนึ่งเดียว</small>
                    <p style="margin:2px 0 0;font-size:11px;color:#64748b">สแกนดูประวัติเดิม หรือแจ้งซ่อมได้ทันที ไม่ต้องค้นหารหัส</p>
                  </div>
                </div>

                <div class="phone-actions-container">
                  <button type="button" class="phone-btn phone-btn-repair" id="simActionRepair">
                    <span>⚒</span> แจ้งซ่อมครุภัณฑ์นี้ (จำลอง)
                  </button>
                  <button type="button" class="phone-btn phone-btn-verify" id="simActionVerify">
                    <span>✓</span> สแกนตรวจรับงาน / ยืนยันสภาพ
                  </button>
                </div>
                <p id="simFeedbackMsg" class="sim-feedback-msg" role="status"></p>
              </div>

              <div class="phone-footer-credit">
                <b>POWER BY PNG TEAM</b>
                <small>ระบบทะเบียนครุภัณฑ์และบริหารงานซ่อมภาครัฐ</small>
              </div>
            </div>
          </div>

          <div class="sim-side-explainer">
            <div class="explainer-card">
              <div class="explainer-icon">💡</div>
              <div>
                <b>เป้าหมายการเชื่อมโยงงานพัสดุ</b>
                <p>เจ้าหน้าที่ผู้ใช้งานหรือทีมแพทย์พยาบาล เพียงยกสมาร์ทโฟนสแกน QR ที่ตัวเครื่อง จะเห็นประวัติการตรวจรับและแจ้งซ่อมทันทีโดยไม่ต้องจำรหัสครุภัณฑ์ 11 หลัก</p>
              </div>
            </div>

            <div class="explainer-card">
              <div class="explainer-icon">⚡</div>
              <div>
                <b>3 ลูกเล่นสำคัญของ Smart QR</b>
                <ul>
                  <li><b>1. อัปเดตข้อมูลอัตโนมัติ:</b> เปลี่ยนแปลงข้อมูลในระบบ ข้อมูลหน้าสแกนเปลี่ยนทันทีโดยไม่ต้องพิมพ์ฉลากใหม่</li>
                  <li><b>2. ส่งเรื่องตรงถึงช่าง:</b> ผู้แจ้งกรอกอาการ ระบบส่งไลน์แจ้งเตือนและออก Ticket อัตโนมัติ</li>
                  <li><b>3. ตรวจรับงานได้ทันที:</b> เมื่อช่างซ่อมเสร็จ ผู้แจ้งตรวจเช็คและกดรับงานผ่านหน้าสแกนได้ทันที</li>
                </ul>
              </div>
            </div>

            <div class="explainer-cta-box">
              <button type="button" class="button primary" id="simOpenFullScan">เปิดหน้าสแกนจริง (scan.html) ↗</button>
              <button type="button" class="button outline" data-close-sim>ปิดหน้าต่างจำลอง</button>
            </div>
          </div>
        </div>
      </div>
    `;

    simDialog.querySelectorAll('[data-sim-pick]').forEach(btn => {
      btn.onclick = () => openQrSimulator(Number(btn.dataset.simPick));
    });

    const feedback = simDialog.querySelector('#simFeedbackMsg');
    simDialog.querySelector('#simActionRepair').onclick = () => {
      feedback.className = 'sim-feedback-msg success show';
      feedback.innerHTML = '⚡ <b>จำลองสำเร็จ:</b> ระบบรับคำขอแจ้งซ่อมของ ' + esc(item.name.split(' (')[0]) + ' แล้ว ส่ง Ticket ถึงช่างทันที!';
      app.toast('จำลองการแจ้งซ่อมผ่าน Smart QR สำเร็จ');
    };
    simDialog.querySelector('#simActionVerify').onclick = () => {
      feedback.className = 'sim-feedback-msg success show';
      feedback.innerHTML = '✓ <b>ตรวจรับงานสำเร็จ:</b> ยืนยันสภาพพัสดุและตำแหน่งปัจจุบันเรียบร้อยแล้ว!';
      app.toast('ยืนยันผลการตรวจรับผ่าน Smart QR สำเร็จ');
    };
    simDialog.querySelector('#simOpenFullScan').onclick = () => {
      window.open('/scan.html', '_blank');
    };

    simDialog.showModal();
  }

  const heading = $('#view-dashboard .page-heading p');
  if (heading) heading.textContent = 'ทะเบียนที่เป็นปัจจุบัน งานซ่อมที่ติดตามได้ และ Smart QR ที่เชื่อมทุกขั้นตอน';
  const eyebrow = $('#view-dashboard .page-heading .eyebrow');
  if (eyebrow) eyebrow.textContent = new Date().toLocaleDateString('th-TH', { dateStyle: 'full', timeZone: 'Asia/Bangkok' });

  const hero = document.createElement('div');
  hero.className = 'smart-hero';
  hero.innerHTML = `
    <div class="smart-hero-main">
      <div class="hero-eyebrow-row">
        <span class="eyebrow"><span class="hero-live-beacon"></span> CONNECTED ASSET MANAGEMENT</span>
        <span class="hero-core-badge">นวัตกรรม Smart QR ภาครัฐ</span>
      </div>
      <h2 class="hero-title">ดูแลทุกครุภัณฑ์ <span class="hero-title-accent">เชื่อมทุกงานซ่อม</span></h2>
      <div class="hero-target-box">
        <p class="hero-quote-text">
          <strong>สแกนดูข้อมูลล่าสุด แจ้งปัญหา และติดตามจนถึงตรวจรับงาน</strong>
          <span class="hero-qr-highlight">ด้วย QR ประจำครุภัณฑ์เพียงหนึ่งเดียว</span>
        </p>
      </div>
      <div class="hero-buttons-row">
        <button class="button primary" id="smartGoAssets" type="button">เปิดทะเบียน / ออก QR ↗</button>
        <button class="button outline" id="smartGoRepairs" type="button">ติดตามงานซ่อม</button>
        <button class="button hero-sim-btn" id="smartDemoScan" type="button" title="คลิกเพื่อเปิดหน้าจำลองการสแกน QR">
          <span class="sim-scan-radar"></span>
          <span>ทดลองสแกน QR จำลอง ⚡</span>
        </button>
      </div>
    </div>

    <div class="smart-hero-interactive-flow" aria-label="ขั้นตอนการทำงาน Smart QR 3 ขั้นตอน">
      <div class="hero-flow-card step-card-1" id="heroStep1" role="button" tabindex="0" title="คลิกเพื่อไปที่ทะเบียนครุภัณฑ์">
        <div class="hero-flow-head">
          <span class="hero-step-num">01</span>
          <span class="hero-flow-icon">▤</span>
          <div class="hero-flow-text">
            <b>1. ขึ้นทะเบียนสินทรัพย์</b>
            <small>ออกเลข FSN &amp; บัญชีคุมทรัพย์สิน</small>
          </div>
          <span class="hero-flow-pill">ทะเบียน</span>
        </div>
        <div class="hero-flow-hover-hint">คลิกเปิดทะเบียนคุม <span>→</span></div>
      </div>

      <div class="hero-flow-connector"><span class="flow-dot"></span></div>

      <div class="hero-flow-card step-card-2" id="heroStep2" role="button" tabindex="0" title="คลิกเพื่อไปที่แบบพิมพ์ฉลาก QR">
        <div class="hero-flow-head">
          <span class="hero-step-num">02</span>
          <span class="hero-flow-icon qr-icon-wrap">
            <span class="mini-qr-code">◩</span>
            <span class="laser-scan-beam"></span>
          </span>
          <div class="hero-flow-text">
            <b>2. ติดฉลาก Smart QR</b>
            <small>พิมพ์ฉลากทนทาน ลิงก์ถาวรประจำเครื่อง</small>
          </div>
          <span class="hero-flow-pill highlight">Smart QR</span>
        </div>
        <div class="hero-flow-hover-hint">คลิกออกแบบฉลาก <span>→</span></div>
      </div>

      <div class="hero-flow-connector"><span class="flow-dot"></span></div>

      <div class="hero-flow-card step-card-3 active-showcase" id="heroStep3" role="button" tabindex="0" title="คลิกเพื่อทดลองสแกนและแจ้งซ่อมจำลอง">
        <div class="hero-flow-head">
          <span class="hero-step-num pulse-num">03</span>
          <span class="hero-flow-icon scan-pulse">📱</span>
          <div class="hero-flow-text">
            <b>3. สแกน · แจ้งซ่อม · ตรวจรับ</b>
            <small>มือถือเครื่องเดียว จบครบทุกขั้นตอน</small>
          </div>
          <span class="hero-flow-pill live"><span class="radar-ping"></span> ลองสแกน</span>
        </div>
        <div class="hero-flow-hover-hint">คลิกทดลองสแกนสด <span>⚡</span></div>
      </div>
    </div>
  `;

  $('#view-dashboard .notice').after(hero);

  $('#smartGoAssets').onclick = () => app.switchView('assets');
  $('#smartGoRepairs').onclick = () => app.switchView('repairs');
  $('#smartDemoScan').onclick = () => openQrSimulator(0);

  $('#heroStep1').onclick = () => app.switchView('assets');
  $('#heroStep2').onclick = () => app.switchView('stickers');
  $('#heroStep3').onclick = () => openQrSimulator(0);

  ['heroStep1', 'heroStep2', 'heroStep3'].forEach((id, idx) => {
    const el = $('#' + id);
    if (el) {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (idx === 0) app.switchView('assets');
          else if (idx === 1) app.switchView('stickers');
          else openQrSimulator(0);
        }
      });
    }
  });

  app.api('/api/branding').then(applyBranding).catch(app.showError);
  app.openAsset = openAsset;
  app.openQrSimulator = openQrSimulator;
})();
