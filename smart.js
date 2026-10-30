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

  function fullestText(...parts) {
    return parts.map(value => String(value ?? '').trim()).filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
  }
  function renderModalLedger(reg, a) {
    if (!reg) return '<p class="field-hint">ไม่พบข้อมูลใบคุมสำหรับรายการนี้</p>';
    const asset = reg.asset || a || {};
    const form = reg.register || {};
    const spec = fullestText(form.description, asset.detail, a?.detail, asset.name, a?.name);
    const acqs = (reg.acquisitions && reg.acquisitions.length) ? reg.acquisitions : [{
      acquired_on: asset.acquiredOn || asset.date,
      document_no: asset.poNo || asset.gfmisNo || '',
      item_description: spec,
      quantity: 1,
      unit_price: asset.purchasePrice,
      total_price: asset.purchasePrice,
      useful_life_years: asset.usefulLifeYears || '',
      monthly_depreciation: asset.monthlyDepreciation || '',
      annual_depreciation: asset.annualDepreciation || '',
      accumulated_depreciation: asset.accumulatedDepreciation || '',
      net_book_value: asset.netBookValue || '',
      notes: ''
    }];
    const meta = [
      ['ส่วนราชการ', form.organization_name || asset.organization],
      ['หน่วยงาน', form.department_name || asset.department || asset.responsibleUnit],
      ['ประเภท', form.asset_type || asset.assetType],
      ['หมวด', asset.group],
      ['รหัส', asset.code || form.asset_code_printed],
      ['ลักษณะ/คุณสมบัติ', spec],
      ['รุ่น/แบบ', form.model || asset.model],
      ['สถานที่ตั้ง / หน่วยงานรับผิดชอบ', form.location || asset.location],
      ['ชื่อผู้ขาย / ผู้รับจ้าง / ผู้บริจาค', form.vendor_name || asset.vendor],
      ['ที่อยู่', form.vendor_address],
      ['โทร.', form.vendor_phone],
      ['เลขที่ GFMIS', form.gfmis_no || asset.gfmisNo],
      ['เลขที่ PO', form.po_no || asset.poNo],
      ['S/N', form.serial_number || asset.serialNumber],
      ['สิ้นสุดประกัน', form.warranty_end || asset.warrantyEnd],
      ['ปีงบที่ได้มา', form.fiscal_year_th || asset.fiscalYear],
      ['ประเภทเงิน', form.fund_type || asset.fundType],
      ['วิธีการได้มา', form.acquisition_method || asset.acquisitionMethod]
    ];
    return `<div class="modal-ledger-meta">
      ${meta.map(([label, value]) => `<div class="${['ลักษณะ/คุณสมบัติ','ที่อยู่','สถานที่ตั้ง / หน่วยงานรับผิดชอบ','ชื่อผู้ขาย / ผู้รับจ้าง / ผู้บริจาค'].includes(label) ? 'full' : ''}"><span>${esc(label)}</span> <b>${esc(value || '—')}</b></div>`).join('')}
    </div>
    <div class="table-wrap">
      <table class="modal-ledger-table">
        <thead>
          <tr>
            <th>วัน เดือน ปี</th>
            <th>ที่เอกสาร</th>
            <th>รายการ</th>
            <th>จำนวนหน่วย</th>
            <th>ราคาต่อหน่วย</th>
            <th>มูลค่ารวม</th>
            <th>อายุใช้งาน</th>
            <th>ค่าเสื่อมราคาประจำเดือน</th>
            <th>ค่าเสื่อมราคาประจำปี</th>
            <th>ค่าเสื่อมราคาสะสม</th>
            <th>มูลค่าสุทธิ</th>
            <th>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          ${acqs.map(rw => `
            <tr>
              <td>${esc(app.fmtDate(rw.acquired_on || rw.date || asset.acquiredOn))}</td>
              <td>${esc(rw.document_no || rw.po_no || asset.poNo || '—')}</td>
              <td><b>${esc(rw.item_description || spec || asset.name)}</b></td>
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

  function money(value) {
    const amount = Number(value);
    return value == null || value === '' || Number.isNaN(amount) ? '—' : amount.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' บาท';
  }
  function dateShown(value) {
    if (value == null || String(value).trim() === '') return '—';
    const formatted = app.fmtDate(value);
    return formatted && formatted !== '—' ? formatted : String(value).trim();
  }
  function detailCell(label, value, wide = false) {
    const text = value == null || String(value).trim() === '' ? '—' : value;
    return `<div class="${wide ? 'full' : ''}"><dt>${esc(label)}</dt><dd>${esc(text)}</dd></div>`;
  }
  function detailSheet(a, data, reg, life, categoryName) {
    const book = reg?.asset || a || {};
    const form = reg?.register || {};
    const acq = (reg?.acquisitions || []).at?.(-1) || (reg?.acquisitions || []).slice(-1)[0] || {};
    const dep = (reg?.depreciationSnapshots || []).at?.(-1) || (reg?.depreciationSnapshots || []).slice(-1)[0] || {};
    const spec = fullestText(form.description, book.detail, a.detail, book.name, a.name);
    const events = data.events || [];
    const tickets = data.tickets || [];
    const custody = life?.history || [];
    const rows = [
      ['สถานะ', a.status],
      ['ส่วนราชการ', form.organization_name || book.organization],
      ['หน่วยงาน', form.department_name || book.department || book.responsibleUnit],
      ['บัญชี', book.accountName],
      ['สาขา', book.branchName],
      ['ประเภท', form.asset_type || book.assetType],
      ['หมวด', categoryName || book.group],
      ['รหัส', book.code || a.code || form.asset_code_printed],
      ['รหัส FSN', a.fsnCode || book.fsnCode],
      ['ชื่อครุภัณฑ์', a.name && a.name.trim() !== spec ? a.name : ''],
      ['ลักษณะ/คุณสมบัติ', spec, true],
      ['รุ่น/แบบ', form.model || book.model || acq.model],
      ['สถานที่ตั้ง / หน่วยงานรับผิดชอบ', form.location || a.location || book.location, true],
      ['ชื่อผู้ขาย / ผู้รับจ้าง / ผู้บริจาค', form.vendor_name || acq.vendor_name || book.vendor, true],
      ['ที่อยู่', form.vendor_address || acq.vendor_address, true],
      ['โทร.', form.vendor_phone || acq.vendor_phone],
      ['เลขที่ GFMIS', form.gfmis_no || acq.gfmis_no || book.gfmisNo],
      ['เลขที่ PO', form.po_no || acq.po_no || book.poNo],
      ['S/N', form.serial_number || acq.serial_number || a.serialNumber || book.serialNumber],
      ['สิ้นสุดประกัน', dateShown(form.warranty_end || a.warrantyEnd || book.warrantyEnd)],
      ['ปีงบที่ได้มา', form.fiscal_year_th || acq.fiscal_year_th || book.fiscalYear],
      ['ประเภทเงิน', form.fund_type || acq.fund_type || book.fundType],
      ['วิธีการได้มา', form.acquisition_method || acq.acquisition_method || book.acquisitionMethod],
      ['ผู้ดูแล', a.custodian || life?.state?.custodian],
      ['วัน เดือน ปี', dateShown(acq.acquired_on || book.acquiredOn)],
      ['ที่เอกสาร', acq.document_no],
      ['จำนวนหน่วย', acq.quantity == null || acq.quantity === '' ? '' : acq.quantity],
      ['ราคาต่อหน่วย', money(acq.unit_price ?? book.purchasePrice)],
      ['มูลค่ารวม', money(acq.total_price ?? book.purchasePrice)],
      ['อายุใช้งาน (ปี)', dep.useful_life_years ?? book.usefulLifeYears],
      ['ค่าเสื่อมราคาประจำเดือน', money(dep.monthly_depreciation ?? book.monthlyDepreciation)],
      ['ค่าเสื่อมราคาประจำปี', money(dep.annual_depreciation ?? book.annualDepreciation)],
      ['ค่าเสื่อมราคาสะสม', money(dep.accumulated_depreciation ?? book.accumulatedDepreciation)],
      ['มูลค่าสุทธิ', money(dep.net_book_value ?? book.netBookValue)],
      ['หมายเหตุ', form.notes || acq.notes || dep.notes, true]
    ].filter(([label, value]) => label !== 'ชื่อครุภัณฑ์' || String(value || '').trim());
    const tile = (label, value, wide=false) => {
      const text = value == null || String(value).trim() === '' || value === '—' ? '' : String(value).trim();
      return text ? `<div class="asset-app-tile${wide ? ' wide' : ''}"><span>${esc(label)}</span><b>${esc(text)}</b></div>` : '';
    };
    const group = (title, cells) => {
      const body = cells.filter(Boolean).join('');
      return body ? `<section class="asset-app-group"><h3>${esc(title)}</h3><div class="asset-app-grid">${body}</div></section>` : '';
    };
    const filled = new Map(rows.filter(([, value]) => value != null && String(value).trim() !== '' && value !== '—'));
    const pick = (label, wide=false) => tile(label, filled.get(label), wide);
    return `<div class="asset-app">${[
      group('เครื่อง', [pick('สถานะ'), pick('รหัส'), pick('รหัส FSN'), pick('หมวด'), pick('ประเภท'), pick('รุ่น/แบบ'), pick('S/N'), pick('ชื่อครุภัณฑ์', true), pick('ลักษณะ/คุณสมบัติ', true)]),
      group('ที่ตั้ง', [pick('ส่วนราชการ'), pick('หน่วยงาน'), pick('บัญชี'), pick('สาขา'), pick('สถานที่ตั้ง / หน่วยงานรับผิดชอบ', true), pick('ผู้ดูแล')]),
      group('ได้มา', [pick('ปีงบที่ได้มา'), pick('วัน เดือน ปี'), pick('วิธีการได้มา'), pick('ประเภทเงิน'), pick('เลขที่ GFMIS'), pick('เลขที่ PO'), pick('ที่เอกสาร'), pick('ชื่อผู้ขาย / ผู้รับจ้าง / ผู้บริจาค', true), pick('ที่อยู่', true), pick('โทร.'), pick('สิ้นสุดประกัน')]),
      group('มูลค่า', [pick('จำนวนหน่วย'), pick('ราคาต่อหน่วย'), pick('มูลค่ารวม'), pick('อายุใช้งาน (ปี)'), pick('ค่าเสื่อมราคาประจำเดือน'), pick('ค่าเสื่อมราคาประจำปี'), pick('ค่าเสื่อมราคาสะสม'), pick('มูลค่าสุทธิ'), pick('หมายเหตุ', true)])
    ].join('')}</div>
      <section class="asset-history-block"><h3>ประวัติการเปลี่ยนแปลงทะเบียน</h3><ol class="smart-history">${events.map(e => `<li><b>${esc(e.action)}</b><span>${esc(e.actor)} · ${esc(app.fmtDate(e.createdAt))}</span></li>`).join('') || '<li>ยังไม่มีการแก้ไขทะเบียน</li>'}</ol></section>
      <section class="asset-history-block"><h3>ประวัติงานซ่อม</h3><div class="smart-ticket-list">${tickets.map(t => `<button type="button" data-smart-ticket="${t.id}"><span><b>${esc(t.ticketNo)}</b><small>${esc(t.issue)}</small><small>${esc(app.fmtDate(t.createdAt))} · ${esc(t.status)}</small></span></button>`).join('') || '<div class="smart-empty">ยังไม่มีประวัติซ่อมสำหรับครุภัณฑ์นี้</div>'}</div></section>
      <section class="asset-history-block"><h3>ประวัติยืม เบิก คืน</h3><ol class="smart-history">${custody.map(e => `<li><b>${esc(e.kind)}</b><span>${esc(e.actor)} · ${esc(app.fmtDate(e.created_at))}${e.note ? ' · ' + esc(e.note) : ''}</span></li>`).join('') || '<li>ยังไม่มีประวัติยืม เบิก คืน</li>'}</ol></section>`;
  }

  // Photos are resized in the browser so a phone photo (often 3–8 MB) uploads as a few hundred KB.
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`เปิดไฟล์ ${file.name} ไม่ได้ ใช้ไฟล์ JPG หรือ PNG`)); };
      img.src = url;
    });
  }
  function shrink(img, max, quality) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return {dataUrl: canvas.toDataURL('image/jpeg', quality), width: canvas.width, height: canvas.height};
  }
  function photoBlock(photos, canEdit) {
    const items = photos.items || [];
    const main = items[0];
    const full = items.length >= (photos.max || 12);
    const thumbs = items.map((p, i) => `<button type="button" class="asset-photo-thumb${i === 0 ? ' is-active' : ''}" data-photo-pick="${p.id}" aria-label="ดูรูปที่ ${i + 1}"><img src="${esc(p.thumbUrl)}" alt="" loading="lazy">${p.isPrimary ? '<span>รูปหลัก</span>' : ''}</button>`).join('');
    const actions = canEdit ? `<div class="asset-photo-actions">
        <label class="button outline mini-action asset-photo-add${full ? ' is-disabled' : ''}">＋ เพิ่มรูป<input type="file" accept="image/*" multiple data-photo-input ${full ? 'disabled' : ''} hidden></label>
        ${main ? `<button type="button" class="button outline mini-action" data-photo-primary ${main.isPrimary ? 'hidden' : ''}>ตั้งเป็นรูปหลัก</button><button type="button" class="button outline mini-action reject" data-photo-remove>ลบรูปนี้</button>` : ''}
      </div>` : '';
    const stage = main
      ? `<a class="asset-photo-stage" href="${esc(main.url)}" target="_blank" rel="noopener" data-photo-stage title="เปิดรูปขนาดเต็ม"><img src="${esc(main.url)}" alt="รูปครุภัณฑ์"></a>`
      : `<div class="asset-photo-stage empty"><span aria-hidden="true">📷</span><b>ยังไม่มีรูปครุภัณฑ์</b><small>${canEdit ? 'กด “เพิ่มรูป” เพื่อถ่ายหรือเลือกรูปจากเครื่อง' : 'เจ้าหน้าที่เพิ่มรูปได้จากหน้านี้'}</small></div>`;
    return `<section class="asset-photos" data-photo-block data-current="${main ? main.id : ''}">
      ${stage}
      <div class="asset-photo-side">
        <div class="asset-photo-head"><h3>รูปครุภัณฑ์</h3><small>${items.length} / ${photos.max || 12} รูป</small></div>
        ${thumbs ? `<div class="asset-photo-strip">${thumbs}</div>` : ''}
        ${actions}
        <p class="asset-photo-status" data-photo-status role="status"></p>
      </div>
    </section>`;
  }
  function bindPhotos(root, assetId, photos, canEdit) {
    const block = $('[data-photo-block]', root);
    if (!block) return;
    const status = $('[data-photo-status]', block);
    const items = photos.items || [];
    const current = () => items.find(p => String(p.id) === block.dataset.current);
    const rerender = async next => {
      block.outerHTML = photoBlock(next, canEdit);
      bindPhotos(root, assetId, next, canEdit);
      app.refreshData?.();
    };
    block.querySelectorAll('[data-photo-pick]').forEach(button => button.onclick = () => {
      const p = items.find(x => String(x.id) === button.dataset.photoPick); if (!p) return;
      block.dataset.current = p.id;
      const stage = $('[data-photo-stage]', block);
      if (stage) { stage.href = p.url; $('img', stage).src = p.url; }
      block.querySelectorAll('[data-photo-pick]').forEach(b => b.classList.toggle('is-active', b === button));
      const primary = $('[data-photo-primary]', block); if (primary) primary.hidden = p.isPrimary;
    });
    const input = $('[data-photo-input]', block);
    if (input) input.onchange = async () => {
      const files = [...input.files]; input.value = '';
      if (!files.length) return;
      let next = photos;
      try {
        for (const [index, file] of files.entries()) {
          status.textContent = `กำลังย่อและอัปโหลดรูป ${index + 1}/${files.length}…`;
          const img = await loadImage(file);
          let full = shrink(img, 1600, 0.82);
          if (full.dataUrl.length > 3_200_000) full = shrink(img, 1280, 0.7);
          const thumb = shrink(img, 320, 0.72);
          await app.api(`/api/assets/${assetId}/photos`, {method:'POST', body:JSON.stringify({image:full.dataUrl, thumb:thumb.dataUrl, width:full.width, height:full.height, actor:app.getRole()})});
        }
        next = await app.api(`/api/assets/${assetId}/photos`);
        app.toast(files.length > 1 ? `เพิ่มรูป ${files.length} รูปแล้ว` : 'เพิ่มรูปแล้ว');
        await rerender(next);
      } catch (error) {
        try { next = await app.api(`/api/assets/${assetId}/photos`); await rerender(next); } catch { /* keep the old block */ }
        const fresh = $('[data-photo-status]', root); if (fresh) fresh.textContent = error.message;
      }
    };
    const act = async (kind, confirmText) => {
      const p = current(); if (!p) return;
      if (confirmText && !confirm(confirmText)) return;
      try {
        status.textContent = 'กำลังบันทึก…';
        const next = await app.api(`/api/assets/${assetId}/photos/${p.id}/${kind}`, {method:'POST', body:JSON.stringify({actor:app.getRole()})});
        app.toast(kind === 'primary' ? 'ตั้งเป็นรูปหลักแล้ว' : 'ลบรูปแล้ว');
        await rerender(next);
      } catch (error) { status.textContent = error.message; }
    };
    const primary = $('[data-photo-primary]', block); if (primary) primary.onclick = () => act('primary');
    const remove = $('[data-photo-remove]', block); if (remove) remove.onclick = () => act('remove', 'ลบรูปนี้ออกจากทะเบียน? ระบบจะเก็บประวัติว่าใครลบไว้');
  }

  async function openAsset(id) {
    try {
      const [data, categories, accountContext, regData, life, photos] = await Promise.all([
        app.api(`/api/assets/${id}/smart`),
        app.api('/api/catalog/categories'),
        app.api(`/api/governance/assets/${id}`),
        app.api(`/api/assets/${id}/register`).catch(() => null),
        app.api(`/api/lifecycle/assets/${id}`).catch(() => ({state:{}, history:[]})),
        app.api(`/api/assets/${id}/photos`).catch(() => ({items:[], max:12}))
      ]);
      const canPhoto = app.getRole() !== 'ผู้แจ้ง';
      selected = data;
      const a = data.asset, canEdit = app.getRole() === 'เจ้าหน้าที่พัสดุ';
      const categoryName = categories.find(c => Number(c.id) === Number(a.categoryId))?.name || '';
      const active = data.tickets.filter(t => !['ปิดงาน','ยกเลิก','ไม่อนุมัติ'].includes(t.status));
      dialog.innerHTML = `<div class="smart-dialog-head"><div><span class="eyebrow">ASSET WORKSPACE</span><h2>${esc(a.name)}</h2><span class="code-text">เลขประจำครุภัณฑ์ ${esc(a.code)}</span><p class="field-hint">รหัสจำแนก FSN: ${esc(a.fsnCode||'ยังไม่ได้ระบุแยก · คงเลขเดิมตามทะเบียน')}</p></div><button class="dialog-close" data-close-smart aria-label="ปิดรายละเอียด">×</button></div>
        <div class="smart-tabs" role="tablist">
          <button role="tab" aria-selected="true" data-smart-tab="detail">รายละเอียด</button>
          <button role="tab" aria-selected="false" data-smart-tab="info">แก้ไขข้อมูล</button>
          <button role="tab" aria-selected="false" data-smart-tab="ledger">📋 ใบคุมทรัพย์สิน</button>
          <button role="tab" aria-selected="false" data-smart-tab="repairs">ประวัติซ่อม (${data.tickets.length})</button>
          <button role="tab" aria-selected="false" data-smart-tab="history">ประวัติทะเบียน</button>
          <button role="tab" aria-selected="false" data-smart-tab="custody">ยืม / เบิก / คืน</button>
        </div>
        <div class="smart-layout"><div>
          <section data-smart-panel="detail">${photoBlock(photos, canPhoto)}${canPhoto ? `<div class="asset-feature-pin"><button type="button" class="button outline mini-action" data-dsc-pin="${a.id}">☆ ปักหมุดอุปกรณ์เด่น</button><small>แสดงเป็นการ์ดใหญ่บนหน้าภาพรวมพร้อมบันทึกย่อ</small></div>` : ''}${detailSheet(a, data, regData, life, categoryName)}</section>
          <section data-smart-panel="info" hidden><div class="smart-state"><span class="badge blue">${esc(a.status)}</span><span>${active.length ? `มีงานซ่อมที่กำลังดำเนินการ ${active.length} งาน` : 'ไม่มีงานซ่อมค้าง'}</span></div>
          ${window.govAssetAccountContextMarkup?.(accountContext)||''}<form id="smartAssetForm" class="smart-form"><div class="form-grid"><label>ชื่อครุภัณฑ์<input name="name" required maxlength="300" value="${esc(a.name)}"></label><label>รหัสครุภัณฑ์<input name="code" required maxlength="80" value="${esc(a.code)}"></label></div><label>หมวดครุภัณฑ์<select name="categoryId" required><option value="">เลือกหมวดครุภัณฑ์</option>${categories.map(c => `<option value="${c.id}" ${Number(c.id) === Number(a.categoryId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label>รายละเอียด<textarea name="detail" maxlength="1000" rows="3">${esc(a.detail)}</textarea></label><div class="form-grid"><label>สถานที่ตั้ง<input name="location" required maxlength="300" value="${esc(a.location)}"></label><label>หมายเลขเครื่อง / Serial<input name="serialNumber" maxlength="160" value="${esc(a.serialNumber)}"></label><label>ผู้ดูแลครุภัณฑ์<input name="custodian" maxlength="160" value="${esc(a.custodian)}"></label><label>สิ้นสุดประกัน<input name="warrantyEnd" type="date" value="${esc(a.warrantyEnd)}"></label></div><p class="field-hint">${canEdit ? 'การแก้ไขจะบันทึกประวัติ และแสดงข้อมูลใหม่ผ่าน QR เดิมทันที' : 'สำหรับเจ้าหน้าที่พัสดุที่มีสิทธิ์แก้ไขทะเบียนครุภัณฑ์'}</p><div class="dialog-actions"><button class="button outline" type="button" id="smartRegister">📋 เปิดใบคุมทรัพย์สินเต็มหน้า (A4)</button><button class="button outline" type="button" id="smartRepair">แจ้งซ่อมรายการนี้</button>${canEdit ? '<button class="button primary" type="submit">บันทึกข้อมูล</button>' : ''}</div><p id="smartSaveStatus" role="status"></p></form></section>
          <section data-smart-panel="ledger" hidden>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
              <div>
                <h3 style="margin:0;font-size:16px;color:var(--smart-ink)">ทะเบียนและประวัติคุมทรัพย์สิน</h3>
                <small style="color:#64798b">เอกสารมาตรฐานสำหรับตรวจสอบและควบคุมสินทรัพย์</small>
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
          <section data-smart-panel="history" hidden><h3>ประวัติการเปลี่ยนแปลงทะเบียน</h3><ol class="smart-history">${data.events.map(e => `<li><b>${esc(e.action)}</b><span>${esc(e.actor)} · ${esc(app.fmtDate(e.createdAt))}</span></li>`).join('') || '<li>ยังไม่มีการแก้ไขทะเบียน</li>'}</ol></section>
          <section data-smart-panel="custody" hidden>
            <h3>ยืม เบิก คืน</h3>
            <p class="field-hint">สถานะถือครอง ${esc(life.state?.loan_status || 'ยังไม่บันทึก')}${life.state?.overdue ? ' · เกินกำหนด' : ''} · ผู้ถือ ${esc(life.state?.custodian || '—')}</p>
            <form id="smartCustodyForm" class="smart-form">
              <div class="form-grid">
                <label>ประเภทงาน<select name="kind" required><option value="loan">ยืม</option><option value="issue">เบิก</option><option value="return">คืน</option></select></label>
                <label>ผู้ยืม / ผู้เบิก / ผู้รับผิดชอบ<input name="party" required maxlength="160" value="${esc(life.state?.custodian || '')}"></label>
                <label>กำหนดคืน<input name="dueAt" type="date" value="${esc((life.state?.due_at || '').slice(0,10))}"></label>
                <label>สถานที่<input name="location" maxlength="300" value="${esc(life.state?.location_text || a.location || '')}"></label>
              </div>
              <label>หมายเหตุ<textarea name="note" rows="2" maxlength="1000"></textarea></label>
              <div class="dialog-actions"><button class="button primary" type="submit">บันทึกรายการ</button></div>
              <p id="smartCustodyStatus" role="status"></p>
            </form>
            <ol class="smart-history">${(life.history||[]).map(e => `<li><b>${esc(e.kind)}</b><span>${esc(e.actor)} · ${esc(app.fmtDate(e.created_at))}${e.note ? ' · ' + esc(e.note) : ''}</span></li>`).join('') || '<li>ยังไม่มีประวัติยืม เบิก คืน</li>'}</ol>
          </section></div>
          <aside class="smart-qr-card"><span class="eyebrow">SMART ASSET QR</span><img class="smart-qr" src="${data.qrImage}" alt="QR ประจำครุภัณฑ์ ${esc(a.code)}"><h3>ฉลากติดที่ตัวเครื่อง</h3><p>หนึ่งเครื่องหนึ่งฉลาก ติดด้านที่สแกนง่าย ไม่บังป้ายเลขทะเบียน Location QR ติดที่ห้องแยกต่างหาก</p><a class="button primary" href="${esc(data.qrUrl)}" target="_blank" rel="noopener">เปิดหน้าสแกน</a><button type="button" class="button outline" id="copySmartUrl">คัดลอกลิงก์</button><button type="button" class="button outline" id="printSmartLabel">พิมพ์ฉลาก QR</button><small>โทรศัพท์ต้องเข้าถึงโดเมนระบบได้ ตั้งค่าโดเมนถาวรก่อนพิมพ์ใช้งาน</small><span>${credit}</span></aside></div>`;
      if(a.accountId) {
        dialog.querySelector('#smartAssetForm [name="code"]').readOnly=true;
        const category=dialog.querySelector('#smartAssetForm [name="categoryId"]');
        category.disabled=true;
        const preserved=document.createElement('input');preserved.type='hidden';preserved.name='categoryId';preserved.value=a.categoryId;dialog.querySelector('#smartAssetForm').append(preserved);
      }
      if (!canEdit) dialog.querySelectorAll('#smartAssetForm input,#smartAssetForm textarea,#smartAssetForm select').forEach(el => el.disabled = true);
      bindPhotos(dialog, a.id, photos, canPhoto);
      const tabStrip = $('.smart-tabs', dialog), body = $('.smart-layout', dialog);
      // On narrow screens the tab row scrolls sideways; fade the edge that still has tabs.
      const tabCue = () => {
        const max = tabStrip.scrollWidth - tabStrip.clientWidth;
        tabStrip.classList.toggle('has-more-left', max > 2 && tabStrip.scrollLeft > 2);
        tabStrip.classList.toggle('has-more-right', max > 2 && tabStrip.scrollLeft < max - 2);
      };
      tabStrip.addEventListener('scroll', tabCue, {passive: true});
      new ResizeObserver(tabCue).observe(tabStrip);
      dialog.querySelectorAll('[data-smart-tab]').forEach(button => button.onclick = () => {
        dialog.querySelectorAll('[data-smart-tab]').forEach(b => b.setAttribute('aria-selected', String(b === button)));
        dialog.querySelectorAll('[data-smart-panel]').forEach(p => p.hidden = p.dataset.smartPanel !== button.dataset.smartTab);
        body.scrollTop = 0;
        button.scrollIntoView({block: 'nearest', inline: 'nearest'});
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
      $('#smartCustodyForm', dialog)?.addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.submitter; if (button) button.disabled = true;
        const statusEl = $('#smartCustodyStatus', dialog);
        try {
          const fields = Object.fromEntries(new FormData(event.target));
          const body = {kind:fields.kind, note:fields.note || '', location:fields.location || '', dueAt:fields.dueAt || '', actor:app.getRole()};
          if (fields.kind === 'loan') body.borrower = fields.party;
          else if (fields.kind === 'issue') body.recipient = fields.party;
          else body.custodian = fields.party;
          await app.api(`/api/lifecycle/assets/${a.id}`, {method:'POST', body:JSON.stringify(body)});
          app.toast('บันทึกยืม เบิก หรือคืนแล้ว');
          await openAsset(a.id);
        } catch (error) {
          if (statusEl) statusEl.textContent = error.message;
          if (button) button.disabled = false;
        }
      });
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
    doc.open(); doc.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ฉลาก ${esc(a.code)}</title><style>@page{size:80mm 60mm;margin:3mm}*{box-sizing:border-box}body{font:11px Tahoma,sans-serif;margin:0;color:#123d56}.label{width:72mm;border:1px solid #b7c8d5;border-radius:3mm;padding:3mm;text-align:center}header{display:flex;align-items:center;gap:2mm;justify-content:center}header img{width:9mm;height:9mm;object-fit:contain}.qr{width:28mm;height:28mm;display:block;margin:auto}b{display:block}.team-credit{color:#f97316!important;font-size:8px}p{margin:1mm}</style></head><body><div class="label"><header><img src="${esc(branding?.logo || `${location.origin}/assets/govasset-mark-optimized.png`)}" alt=""><b>${esc(branding?.organization || 'GovAsset')}</b></header><img class="qr" src="${data.qrImage}" alt="QR"><b>${esc(a.code)}</b><p>${esc(a.name)}</p><p>ASSET QR · ติดที่ตัวเครื่อง</p>${credit}</div></body></html>`); doc.close();
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
    if(!app.canManageSettings()){$('#brandingStatus').textContent=window.govAssetAccess?.session?.required?'การบันทึกการตั้งค่าระบบใช้สิทธิ์ผู้ดูแลระบบส่วนกลาง':'สำหรับเจ้าหน้าที่พัสดุที่มีสิทธิ์บันทึกการตั้งค่าระบบ';return;}
    if(brandingSaving)return;
    brandingSaving=true;updateBrandingButton();
    try {
      await pendingLogo;
      if(logoError)throw new Error(logoError);
      const form=event.target;
      const b=await app.api('/api/branding',{method:'PUT',body:JSON.stringify({...Object.fromEntries(new FormData(form)),logo,revision:branding?.revision,actor:app.getRole()})});
      applyBranding(b);$('#brandingLogo').value='';$('#brandingStatus').textContent='บันทึกแล้ว ชื่อและโลโก้จะใช้ร่วมกับหน้าสแกนและฉลาก QR';app.toast('บันทึกอัตลักษณ์หน่วยงานแล้ว');
    }catch(error){$('#brandingStatus').textContent=error.message;}finally{brandingSaving=false;updateBrandingButton();}
  };
  const simDialog = document.createElement('dialog');
  simDialog.className = 'asset-dialog smart-dialog qr-simulator-modal';
  simDialog.setAttribute('aria-label', 'การใช้งาน Smart QR บนสมาร์ทโฟน');
  document.body.append(simDialog);

  let simSampleIndex = 0;
  let simSlideIndex = 0;
  let simAutoPlaying = true;
  let simInterval = null;
  let simProgressInterval = null;
  let simProgress = 0;

  const simSlides = [
    {
      id: 0,
      step: 'ขั้นตอนที่ 1',
      title: 'สแกนดูข้อมูลล่าสุดแบบเรียลไทม์',
      badge: 'Live Real-time Sync',
      icon: '🔍',
      headline: 'สแกนครั้งเดียว ข้อมูลตรงกับทะเบียนกลางเสมอ',
      description: 'เจ้าหน้าที่หรือทีมแพทย์พยาบาลเพียงยกสมาร์ทโฟนสแกน QR ประจำตัวเครื่อง จะเห็นข้อมูลคุณลักษณะ หมายเลขเครื่อง สถานที่ตั้ง และประวัติการบำรุงรักษา (PM) ล่าสุดทันที หากมีการแก้ไขในระบบ ข้อมูลหน้าสแกนจะอัปเดตอัตโนมัติโดยไม่ต้องพิมพ์ฉลากใหม่'
    },
    {
      id: 1,
      step: 'ขั้นตอนที่ 2',
      title: 'แจ้งซ่อมและเปิด Ticket ส่งตรงถึงช่าง',
      badge: 'Instant Dispatch',
      icon: '⚡',
      headline: 'แจ้งปัญหาได้ทันที ไม่ต้องจดจำหรือค้นหารหัสครุภัณฑ์',
      description: 'เมื่อพบปัญหาการใช้งาน สแกนแล้วระบุอาการชำรุดได้ทันที ระบบจะออกหมายเลขคำขอ (Ticket) อัตโนมัติ พร้อมส่งการแจ้งเตือนตรงถึงทีมช่างผู้รับผิดชอบ ทำให้ทีมช่างรับทราบปัญหาอย่างรวดเร็วและตรวจสอบประวัติการซ่อมเดิมได้ทันที'
    },
    {
      id: 2,
      step: 'ขั้นตอนที่ 3',
      title: 'ตรวจรับงานและปิดงานซ่อมผ่านมือถือ',
      badge: 'Digital Handover',
      icon: '✅',
      headline: 'ตรวจสอบผลงานซ่อมและกดยืนยันรับมอบงานทันที',
      description: 'เมื่อช่างดำเนินการซ่อมเสร็จสิ้น ผู้ขอรับบริการสามารถตรวจเช็คความเรียบร้อยและกดยืนยันตรวจรับงานผ่านมือถือได้ทันที ระบบจะบันทึกประวัติการซ่อมบำรุงและค่าใช้จ่ายเข้าทะเบียนคุมสินทรัพย์ 12 คอลัมน์โดยอัตโนมัติ'
    }
  ];

  function stopSimulatorAutoPlay() {
    simAutoPlaying = false;
    clearInterval(simInterval);
    clearInterval(simProgressInterval);
    simInterval = null;
    simProgressInterval = null;
    const btn = simDialog.querySelector('#simToggleAutoPlay');
    if (btn) btn.innerHTML = '▶ เล่นสไลด์อัตโนมัติ';
  }

  function startSimulatorAutoPlay() {
    stopSimulatorAutoPlay();
    simAutoPlaying = true;
    simProgress = 0;
    const btn = simDialog.querySelector('#simToggleAutoPlay');
    if (btn) btn.innerHTML = '⏸ หยุดอัตโนมัติ';
    const stepDuration = 5500;
    const tick = 50;
    simProgressInterval = setInterval(() => {
      simProgress += (tick / stepDuration) * 100;
      if (simProgress >= 100) simProgress = 0;
      const bar = simDialog.querySelector('#simProgressBar');
      if (bar) bar.style.width = `${Math.min(100, simProgress)}%`;
    }, tick);
    simInterval = setInterval(() => {
      setSimulatorSlide((simSlideIndex + 1) % 3, false);
    }, stepDuration);
  }

  simDialog.addEventListener('click', e => {
    if (e.target === simDialog || e.target.closest('[data-close-sim]')) {
      stopSimulatorAutoPlay();
      simDialog.close();
    }
  });
  simDialog.addEventListener('close', () => {
    stopSimulatorAutoPlay();
  });

  const sampleAssets = [
    {
      name: 'เครื่องฟังหัวใจเด็กในครรภ์ (Fetal Doppler)',
      code: '6515-027-1005-0012',
      fsn: '6515-027-1005',
      location: 'ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์ · แผนกสูติ-นรีเวชกรรม',
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
      location: 'ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์ · ห้องฉุกเฉิน (ER)',
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
      location: 'ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์ · แผนกผู้ป่วยนอก (OPD)',
      status: 'รอตรวจสอบ',
      custodian: 'พว. นงลักษณ์ รักษ์ธรรม',
      model: 'Omron HBP-9030 · S/N: OM-552190',
      lastChecked: '20 ตุลาคม 2569 · ครบกำหนดรอบตรวจสอบ',
      openRepairs: 1
    }
  ];

  function renderPhoneScreen(item, slideIdx) {
    if (slideIdx === 0) {
      return `
        <div class="phone-slide-view animate-fade-in">
          <div class="phone-laser-scanner">
            <div class="laser-beam"></div>
            <div class="phone-mini-qr">
              <img src="assets/govasset-mark-optimized.png" alt="Smart QR">
            </div>
            <div class="laser-status">
              <span class="live-dot-pulse"></span>
              <b>สแกนพบครุภัณฑ์ · ดึงข้อมูลเรียลไทม์</b>
            </div>
          </div>

          <div class="phone-asset-card-elevated">
            <div class="phone-card-top">
              <span class="phone-kicker">ข้อมูลครุภัณฑ์</span>
              <span class="phone-status-badge green">${esc(item.status)}</span>
            </div>
            <h3 class="phone-asset-name">${esc(item.name)}</h3>
            <div class="phone-code-pill">${esc(item.code)}</div>

            <div class="phone-detail-list">
              <div class="phone-detail-row">
                <span>📍 ที่ตั้ง:</span>
                <b>${esc(item.location)}</b>
              </div>
              <div class="phone-detail-row">
                <span>🏷️ รุ่น / SN:</span>
                <b>${esc(item.model)}</b>
              </div>
              <div class="phone-detail-row">
                <span>👤 ผู้รับผิดชอบ:</span>
                <b>${esc(item.custodian)}</b>
              </div>
              <div class="phone-detail-row">
                <span>🛡️ สถานะ PM:</span>
                <b style="color:#059669">${esc(item.lastChecked)}</b>
              </div>
            </div>

            <div class="phone-actions-container">
              <button type="button" class="phone-btn phone-btn-repair" data-jump-slide="1">
                <span>⚒</span> แจ้งซ่อมครุภัณฑ์นี้ →
              </button>
            </div>
          </div>
        </div>
      `;
    }

    if (slideIdx === 1) {
      return `
        <div class="phone-slide-view animate-fade-in">
          <div class="phone-screen-step-banner amber">
            <span>⚡ ขั้นตอนที่ 2 · แจ้งซ่อมและเปิด Ticket</span>
          </div>

          <div class="phone-repair-mockup-card">
            <div class="mockup-form-group">
              <span class="mockup-label">ครุภัณฑ์ที่พบปัญหา</span>
              <div class="mockup-input readonly">${esc(item.name.split(' (')[0])}</div>
            </div>
            <div class="mockup-form-group">
              <span class="mockup-label">อาการชำรุดที่พบ</span>
              <div class="mockup-input typed-text">เปิดเครื่องไม่ติด / มีสัญญาณเตือนเสียงดัง</div>
            </div>
            <div class="mockup-form-group">
              <span class="mockup-label">ระดับความเร่งด่วน</span>
              <div class="mockup-priority-badge">⚠️ เร่งด่วนปานกลาง (ส่งผลต่อบริการ)</div>
            </div>

            <div class="phone-dispatch-toast">
              <div class="toast-header">
                <span class="toast-bell">🔔</span>
                <div>
                  <strong>ออก Ticket #TK-2569-0089 สำเร็จ!</strong>
                  <small>ส่งข้อความแจ้งเตือนถึงทีมช่างทันที</small>
                </div>
              </div>
              <div class="toast-technician">
                <span>ช่างผู้รับผิดชอบ:</span>
                <b>นายสมบูรณ์ ช่างซ่อมดี (ช่างเทคนิค)</b>
              </div>
            </div>

            <div class="phone-actions-container">
              <button type="button" class="phone-btn phone-btn-verify" data-jump-slide="2">
                <span>✓</span> ช่างซ่อมเสร็จสิ้น · ตรวจรับงาน →
              </button>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="phone-slide-view animate-fade-in">
        <div class="phone-screen-step-banner green">
          <span>✅ ขั้นตอนที่ 3 · ตรวจรับมอบงาน</span>
        </div>

        <div class="phone-verify-mockup-card">
          <div class="verify-ticket-badge">
            <span>Ticket #TK-2569-0089</span>
            <span class="badge-done">ซ่อมเสร็จแล้ว</span>
          </div>

          <div class="verify-detail-box">
            <div class="verify-row">
              <span>🛠️ การแก้ไข:</span>
              <b>เปลี่ยนชุดฟิวส์ภาคจ่ายไฟและทดสอบระบบ 100% เรียบร้อย</b>
            </div>
            <div class="verify-row">
              <span>⏱️ แล้วเสร็จ:</span>
              <b>27 ต.ค. 2569 · 10:15 น.</b>
            </div>
            <div class="verify-row">
              <span>👨‍🔧 ช่างผู้ซ่อม:</span>
              <b>นายสมบูรณ์ ช่างซ่อมดี</b>
            </div>
          </div>

          <div class="phone-digital-stamp">
            <div class="stamp-inner">
              <span class="stamp-icon">✓</span>
              <strong class="stamp-text">ตรวจรับมอบงานแล้ว</strong>
              <small class="stamp-sign">ผู้ตรวจรับ: ${esc(item.custodian)}</small>
            </div>
          </div>

          <div class="verify-sync-note">
            <span class="sync-icon">📘</span>
            <span>บันทึกประวัติการซ่อมบำรุงเข้าทะเบียนคุม 12 คอลัมน์อัตโนมัติ</span>
          </div>

          <div class="phone-actions-container">
            <button type="button" class="phone-btn phone-btn-restart" data-jump-slide="0">
              <span>↺</span> เริ่มต้นชมการสาธิตอีกครั้ง
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function setSimulatorSlide(slideIdx, userTriggered = false) {
    if (userTriggered) stopSimulatorAutoPlay();
    simSlideIndex = slideIdx;
    simProgress = 0;

    const item = sampleAssets[simSampleIndex] || sampleAssets[0];
    const screenWrap = simDialog.querySelector('#phoneDynamicScreen');
    if (screenWrap) screenWrap.innerHTML = renderPhoneScreen(item, simSlideIndex);

    // Update active slide tabs
    simDialog.querySelectorAll('[data-step-tab]').forEach((tab, i) => {
      tab.classList.toggle('active', i === simSlideIndex);
    });

    // Update highlights
    simDialog.querySelectorAll('.highlight-item').forEach((hl, i) => {
      hl.classList.toggle('highlighted', i === simSlideIndex);
    });

    // Update slide explanation text
    const activeSlide = simSlides[simSlideIndex];
    const badgeEl = simDialog.querySelector('#activeSlideBadge');
    const headlineEl = simDialog.querySelector('#activeSlideHeadline');
    const descEl = simDialog.querySelector('#activeSlideDesc');
    const indEl = simDialog.querySelector('#activeSlideIndicator');

    if (badgeEl) badgeEl.textContent = activeSlide.badge;
    if (headlineEl) headlineEl.textContent = activeSlide.headline;
    if (descEl) descEl.textContent = activeSlide.description;
    if (indEl) indEl.textContent = `ขั้นตอนที่ ${simSlideIndex + 1} จาก 3`;

    // Re-bind jump slide buttons on phone screen
    simDialog.querySelectorAll('[data-jump-slide]').forEach(btn => {
      btn.onclick = () => setSimulatorSlide(Number(btn.dataset.jumpSlide), true);
    });
  }

  function openQrSimulator(sampleIndex = 0, initialSlide = 0) {
    simSampleIndex = sampleIndex;
    simSlideIndex = initialSlide;
    const item = sampleAssets[simSampleIndex] || sampleAssets[0];
    const activeSlide = simSlides[simSlideIndex];

    simDialog.innerHTML = `
      <div class="smart-dialog-head">
        <div>
          <span class="eyebrow"><span class="hero-live-beacon"></span> SMART ASSET QR • MOBILE WORKSPACE</span>
          <h2>การสแกน Smart QR บนสมาร์ทโฟน</h2>
          <p class="field-hint">ระบบเชื่อมโยงข้อมูลครุภัณฑ์แบบเรียลไทม์ · สแกนตรวจสอบ แจ้งซ่อมตรงถึงช่าง และตรวจรับงานผ่านมือถือได้ในจุดเดียว</p>
        </div>
        <button class="dialog-close" data-close-sim aria-label="ปิดหน้าต่าง">×</button>
      </div>

      <div class="sim-modal-body">
        <div class="sim-selector-bar">
          <span class="sim-select-label">เลือกครุภัณฑ์ทดสอบ:</span>
          <div class="sim-asset-pills">
            ${sampleAssets.map((a, i) => `
              <button type="button" class="sim-pill-btn ${i === simSampleIndex ? 'active' : ''}" data-sim-pick="${i}">
                ${esc(a.name.split(' (')[0])}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="sim-phone-wrapper">
          <div class="sim-phone-frame">
            <div class="phone-dynamic-island">
              <span class="island-camera"></span>
              <span class="island-sensor"></span>
            </div>
            <div class="phone-status-bar">
              <span class="status-time">09:41</span>
              <span class="status-carrier">ศูนย์แพทยศาสตรศึกษาชั้นคลินิก</span>
              <span class="status-battery">5G 100%</span>
            </div>

            <div class="phone-screen-content">
              <div class="phone-scan-header">
                <div class="phone-brand-mark">▦</div>
                <div>
                  <strong>GovAsset Smart QR</strong>
                  <small>ระบบครุภัณฑ์และแจ้งซ่อมดิจิทัล</small>
                </div>
                <span class="phone-scan-verified">● เชื่อมโยงเรียลไทม์</span>
              </div>

              <div id="phoneDynamicScreen" class="phone-dynamic-screen-wrap">
                ${renderPhoneScreen(item, simSlideIndex)}
              </div>

              <div class="phone-footer-credit">
                <b>POWER BY PNG TEAM</b>
                <small>ระบบทะเบียนครุภัณฑ์และบริหารงานซ่อม</small>
              </div>
            </div>

            <div class="phone-home-indicator"></div>
          </div>

          <div class="sim-side-explainer">
            <div class="sim-slides-controller">
              <div class="sim-slides-header">
                <div class="sim-slides-pills">
                  ${simSlides.map((s, idx) => `
                    <button type="button" class="sim-step-tab ${idx === simSlideIndex ? 'active' : ''}" data-step-tab="${idx}">
                      <span class="step-icon">${s.icon}</span>
                      <span class="step-text">${s.title}</span>
                    </button>
                  `).join('')}
                </div>
                <button type="button" class="sim-play-toggle-btn" id="simToggleAutoPlay">
                  ⏸ หยุดอัตโนมัติ
                </button>
              </div>

              <div class="sim-progress-track">
                <div class="sim-progress-bar" id="simProgressBar"></div>
              </div>
            </div>

            <div class="sim-active-slide-card">
              <div class="active-slide-top">
                <span id="activeSlideBadge" class="active-slide-badge">${activeSlide.badge}</span>
                <span id="activeSlideIndicator" class="active-slide-indicator">ขั้นตอนที่ ${simSlideIndex + 1} จาก 3</span>
              </div>
              <h3 id="activeSlideHeadline" class="active-slide-headline">${activeSlide.headline}</h3>
              <p id="activeSlideDesc" class="active-slide-desc">${activeSlide.description}</p>
              
              <div class="sim-feature-highlights">
                <div class="highlight-item ${simSlideIndex === 0 ? 'highlighted' : ''}">
                  <span class="hl-bullet">1</span>
                  <div>
                    <b>เชื่อมโยงข้อมูลแบบเรียลไทม์ (Live Sync)</b>
                    <p>ข้อมูลในระบบเปลี่ยน ข้อมูลหน้าสแกนเปลี่ยนทันที ไม่ต้องพิมพ์สติกเกอร์ใหม่</p>
                  </div>
                </div>
                <div class="highlight-item ${simSlideIndex === 1 ? 'highlighted' : ''}">
                  <span class="hl-bullet">2</span>
                  <div>
                    <b>แจ้งซ่อมและเปิด Ticket ส่งตรงถึงช่าง</b>
                    <p>ระบบแจ้งเตือนช่างทันที ไม่ต้องจดจำหรือค้นหารหัสครุภัณฑ์</p>
                  </div>
                </div>
                <div class="highlight-item ${simSlideIndex === 2 ? 'highlighted' : ''}">
                  <span class="hl-bullet">3</span>
                  <div>
                    <b>ตรวจรับงานและปิดจบงานผ่านมือถือ</b>
                    <p>ตรวจเช็คผลซ่อมและกดยืนยันรับมอบงาน พร้อมบันทึกลงทะเบียนคุมทันที</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="explainer-cta-box">
              <button type="button" class="button primary" id="simOpenFullScan">เปิดหน้าสแกนจริง (scan.html) ↗</button>
              <button type="button" class="button outline" data-close-sim>ปิดหน้าต่าง</button>
            </div>
          </div>
        </div>
      </div>
    `;

    simDialog.querySelectorAll('[data-sim-pick]').forEach(btn => {
      btn.onclick = () => openQrSimulator(Number(btn.dataset.simPick), simSlideIndex);
    });

    simDialog.querySelectorAll('[data-step-tab]').forEach(btn => {
      btn.onclick = () => setSimulatorSlide(Number(btn.dataset.stepTab), true);
    });

    simDialog.querySelectorAll('[data-jump-slide]').forEach(btn => {
      btn.onclick = () => setSimulatorSlide(Number(btn.dataset.jumpSlide), true);
    });

    const toggleBtn = simDialog.querySelector('#simToggleAutoPlay');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        if (simAutoPlaying) stopSimulatorAutoPlay();
        else startSimulatorAutoPlay();
      };
    }

    const openFullBtn = simDialog.querySelector('#simOpenFullScan');
    if (openFullBtn) {
      openFullBtn.onclick = () => window.open('/scan.html', '_blank');
    }

    simDialog.showModal();
    startSimulatorAutoPlay();
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
        <span class="hero-core-badge">ระบบ Smart QR ครุภัณฑ์</span>
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
        <button class="button hero-sim-btn" id="smartDemoScan" type="button" title="คลิกเพื่อเปิดหน้าสแกน Smart QR">
          <span class="sim-scan-radar"></span>
          <span>ทดลองสแกน Smart QR ⚡</span>
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

      <div class="hero-flow-card step-card-3 active-showcase" id="heroStep3" role="button" tabindex="0" title="คลิกเพื่อทดลองสแกนและแจ้งซ่อม">
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

  const heroTarget = $('#view-dashboard .notice') || $('#view-dashboard .page-heading');
  if (heroTarget) {
    heroTarget.after(hero);
  } else {
    $('#view-dashboard')?.prepend(hero);
  }

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

  function switchSettingsTab(tabKey) {
    const tabs = document.querySelectorAll('.settings-tab-btn');
    const panes = {
      master: $('#tabPaneMaster'),
      branding: $('#tabPaneBranding'),
      workflow: $('#tabPaneWorkflow'),
      line: $('#tabPaneLine'),
      access: $('#tabPaneAccess')
    };

    tabs.forEach(btn => {
      const active = btn.dataset.settingsTab === tabKey;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    Object.entries(panes).forEach(([key, pane]) => {
      if (!pane) return;
      const isCurrent = key === tabKey;
      pane.classList.toggle('active', isCurrent);
      pane.hidden = !isCurrent;
    });

    if (tabKey === 'workflow') {
      const wf = $('#workflowSettings');
      if (wf) {
        wf.open = true;
        $('#reloadWorkflowSettings')?.click();
      }
    } else if (tabKey === 'line') {
      const line = $('#lineSettings');
      if (line) {
        line.open = true;
        $('#reloadLineSettings')?.click();
      }
    } else if (tabKey === 'access') {
      window.govAssetAccess?.loadUsers?.();
    }
  }
  window.switchSettingsTab = switchSettingsTab;

  function initSettingsTabs() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.settings-tab-btn');
      if (btn && btn.dataset.settingsTab) {
        switchSettingsTab(btn.dataset.settingsTab);
      }
    });

    document.addEventListener('govasset:view-changed', e => {
      if (e.detail?.name === 'settings') {
        const activeBtn = document.querySelector('.settings-tab-btn.active');
        if (activeBtn?.dataset.settingsTab) {
          switchSettingsTab(activeBtn.dataset.settingsTab);
        }
      } else if (e.detail?.name === 'access-admin') {
        app.switchView('settings');
        switchSettingsTab('access');
      }
    });
  }
  initSettingsTabs();

  function switchApprovalTab(tabKey) {
    const tabs = document.querySelectorAll('.approval-tab-btn');
    const panes = {
      tickets: $('#tabPaneApprovalTickets'),
      assets: $('#tabPaneApprovalAssets'),
      supply: $('#tabPaneApprovalSupply')
    };
    tabs.forEach(btn => {
      const active = btn.dataset.approvalTab === tabKey;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    Object.entries(panes).forEach(([key, pane]) => {
      if (!pane) return;
      const isCurrent = key === tabKey;
      pane.classList.toggle('active', isCurrent);
      pane.hidden = !isCurrent;
    });
  }
  window.switchApprovalTab = switchApprovalTab;

  function initApprovalTabs() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.approval-tab-btn');
      if (btn && btn.dataset.approvalTab) {
        switchApprovalTab(btn.dataset.approvalTab);
      }
    });
  }
  initApprovalTabs();

  app.api('/api/branding').then(applyBranding).catch(app.showError);
  app.openAsset = openAsset;
  app.openQrSimulator = openQrSimulator;
})();
