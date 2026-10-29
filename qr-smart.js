/* QR Smart settings: feature flags, Location QR master, and overdue loans. */
(() => {
  const app = window.govAssetApp;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const KIND_LABELS = {building:'อาคาร',floor:'ชั้น',room:'ห้อง',service_point:'จุดบริการ',common_area:'พื้นที่ส่วนกลาง'};
  const view = $('#view-qr-smart');
  if (!view || !app) return;

  let features = {flags:{}, labels:{}, revision:1};
  let locations = [];
  let kinds = Object.keys(KIND_LABELS);
  let editingId = null;

  function status(message, alert = false) {
    const el = $('#qrSmartStatus');
    if (!el) return;
    el.setAttribute('role', alert ? 'alert' : 'status');
    el.textContent = message || '';
  }

  function forbidden(error) {
    return error?.status === 403 || /สิทธิ์|ยังไม่เปิด|ยังไม่ได้เปิด/.test(error?.message || '');
  }

  function headers() {
    const h = {'Content-Type':'application/json'};
    const csrf = window.govAssetAccess?.session?.csrf;
    if (csrf) h['X-CSRF-Token'] = csrf;
    return h;
  }

  async function call(path, options = {}) {
    try {
      return await app.api(path, {
        credentials:'include',
        headers:{...headers(), ...(options.headers || {})},
        ...options
      });
    } catch (error) {
      error.status = /สิทธิ์|ยังไม่เปิด|ยังไม่ได้เปิด/.test(error.message) ? 403 : error.status;
      throw error;
    }
  }

  function flagFields() {
    const labels = features.labels || {};
    const flags = features.flags || {};
    const keys = Object.keys(labels).length ? Object.keys(labels) : Object.keys(flags);
    $('#qrSmartFlagFields').innerHTML = keys.map(key => `<label class="check-inline qr-smart-flag">
      <input type="checkbox" name="${esc(key)}" ${flags[key] ? 'checked' : ''}>
      <span><b>${esc(labels[key] || key)}</b><small>${esc(key)}</small></span>
    </label>`).join('') || '<p class="field-hint">ไม่พบรายการบริการ</p>';
  }

  function locationOptions(exceptId) {
    return locations.filter(item => item.id !== exceptId).map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
  }

  function kindOptions(selected) {
    const list = kinds.length ? kinds : Object.keys(KIND_LABELS);
    return list.map(k => `<option value="${esc(k)}" ${k === selected ? 'selected' : ''}>${esc(KIND_LABELS[k] || k)}</option>`).join('');
  }

  function canWrite() {
    return !app.canManageSettings || app.canManageSettings();
  }

  function applyModuleVisibility() {
    const flags = features.flags || {};
    const hide = {
      numbering: flags.assetNumberGeneration === false,
      codes: flags.fullAssetRegistration === false && flags.assetNumberGeneration === false,
      depreciation: flags.depreciation === false,
      repairs: flags.repairManagement === false
    };
    Object.entries(hide).forEach(([viewName, hidden]) => {
      document.querySelectorAll(`[data-go-view="${viewName}"], [data-view="${viewName}"]`).forEach(node => {
        if (node.classList.contains('nav-item') || node.classList.contains('settings-link')) node.hidden = hidden;
      });
    });
  }

  function renderLocations() {
    const list = $('#qrSmartLocationList');
    const on = Boolean(features.flags?.locationQr);
    $('#qrSmartLocationsPanel').hidden = !on;
    const notice = $('#qrSmartSimpleNotice');
    if (notice) notice.hidden = on && Boolean(features.flags?.borrowIssueReturn);
    $('#qrSmartNewLocation').disabled = !on || !canWrite();
    if (!on) {
      list.innerHTML = '';
      $('#qrSmartLocationForm').hidden = true;
      return;
    }
    list.innerHTML = locations.length ? locations.map(item => {
      const active = item.isActive !== false && item.is_active !== 0;
      return `<article class="qr-smart-location panel">
        <div>
          <strong>${esc(item.name)}</strong>
          <span>${esc(KIND_LABELS[item.kind] || item.kind)} · ${active ? 'เปิดใช้งาน' : 'ปิดใช้งานชั่วคราว'}</span>
          <small>ชื่อสาธารณะ: ${esc(item.public_name || item.publicName || item.name)}</small>
          <label>URL ของ Location QR<input readonly value="${esc(item.qrUrl || '')}"></label>
          <label>โทเคน (คงที่เมื่อเปลี่ยนชื่อ)<input readonly value="${esc(item.qrToken || '')}"></label>
        </div>
        <div class="dialog-actions">
          <button type="button" class="button outline" data-print-location="${item.id}">พิมพ์ฉลากจุด</button>
          <button type="button" class="button outline" data-edit-location="${item.id}" ${canWrite()?'':'disabled'}>แก้ไข</button>
        </div>
      </article>`;
    }).join('') : '<p class="field-hint">ยังไม่มีจุดบริการ กดเพิ่มจุดบริการตามมาตรฐาน แล้วพิมพ์ฉลากไปติดที่ประตูหรือเคาน์เตอร์</p>';
  }

  function printLocation(item) {
    const branding = window.govAssetBranding || {};
    const name = item.publicName || item.public_name || item.name || 'จุดบริการ';
    const kind = KIND_LABELS[item.kind] || item.kind || 'จุดบริการ';
    const frame = document.createElement('iframe');
    frame.className = 'smart-print-frame';
    frame.title = 'พิมพ์ฉลาก Location QR';
    document.body.append(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Location QR ${esc(name)}</title><style>@page{size:80mm 70mm;margin:3mm}*{box-sizing:border-box}body{font:11px Tahoma,sans-serif;margin:0;color:#123d56}.label{width:72mm;border:1px solid #b7c8d5;border-radius:3mm;padding:3mm;text-align:center}header{display:flex;align-items:center;gap:2mm;justify-content:center}header img{width:9mm;height:9mm;object-fit:contain}.qr{width:28mm;height:28mm;display:block;margin:auto}b{display:block}.kicker{font-size:8px;letter-spacing:.12em;color:#087e82;margin:1mm 0}p{margin:1mm}</style></head><body><div class="label"><header><img src="${esc(branding.logo || `${location.origin}/assets/govasset-mark-optimized.png`)}" alt=""><b>${esc(branding.organization || 'GovAsset')}</b></header><p class="kicker">LOCATION QR · ติดที่จุดพื้นที่</p><img class="qr" src="${esc(item.qrImage || '')}" alt="QR"><b>${esc(name)}</b><p>${esc(kind)}</p><p>แจ้งปัญหาของห้องหรือจุดบริการ ห้ามติดบนตัวเครื่อง</p></div></body></html>`);
    doc.close();
    Promise.all([...doc.images].map(img => img.decode().catch(() => {}))).then(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    });
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), {once: true});
  }

  function showLocationForm(item = null) {
    editingId = item?.id || null;
    const form = $('#qrSmartLocationForm');
    const publicName = item?.publicName || item?.public_name || item?.name || '';
    const publicInfo = item?.publicInfo || item?.public_info || '';
    const active = item ? item.isActive !== false && item.is_active !== 0 : true;
    const canPlace = item ? item.guestCanReportPlace !== false && item.guest_can_report_place !== 0 : true;
    const ids = (item?.guestAssetIds || []).join(', ');
    form.hidden = false;
    form.innerHTML = `<h3>${item ? 'แก้ไขจุดบริการ' : 'เพิ่มจุดบริการ'}</h3>
      <p class="field-hint">มาตรฐาน: ฉลากจุดนี้ติดที่ประตูห้อง เคาน์เตอร์ หรือโถง ไม่ติดบนครุภัณฑ์ เปลี่ยนชื่อได้ โทเคนเดิม ไม่มีปุ่มลบ ให้ปิดใช้งานชั่วคราวแทน</p>
      ${item ? `<label>URL ของ Location QR<input readonly value="${esc(item.qrUrl || '')}"></label>
        <label>โทเคน<input readonly value="${esc(item.qrToken || '')}"></label>` : ''}
      <div class="qr-smart-grid">
        <label>ประเภทพื้นที่ <span class="required">*</span><select name="kind" required>${kindOptions(item?.kind || 'room')}</select></label>
        <label>พื้นที่แม่<select name="parentId"><option value="">ไม่มี</option>${locationOptions(item?.id)}</select></label>
        <label>ชื่อในระบบ <span class="required">*</span><input name="name" required maxlength="200" value="${esc(item?.name || '')}"></label>
        <label>ชื่อที่แสดงสาธารณะ<input name="publicName" maxlength="200" value="${esc(publicName)}"></label>
        <label>รหัสจุด<input name="code" maxlength="80" value="${esc(item?.code || '')}"></label>
      </div>
      <label>ข้อมูลสาธารณะ<textarea name="publicInfo" rows="3" maxlength="2000">${esc(publicInfo)}</textarea></label>
      <label>รหัสครุภัณฑ์ที่แขกเห็นได้ (คั่นด้วยจุลภาค)<input name="assetIds" value="${esc(ids)}" placeholder="เช่น 12, 15, 20"></label>
      <label class="check-inline"><input name="guestCanReportPlace" type="checkbox" ${canPlace ? 'checked' : ''}> ให้แจ้งปัญหาของพื้นที่โดยไม่ต้องเลือกครุภัณฑ์</label>
      <label class="check-inline"><input name="isActive" type="checkbox" ${active ? 'checked' : ''}> เปิดใช้งาน QR นี้ (ยกเลิกการติ๊กเพื่อปิดชั่วคราว ไม่ลบจุดบริการ)</label>
      <div class="dialog-actions">
        <button class="button outline" type="button" id="qrSmartCancelLocation">ยกเลิก</button>
        <button class="button primary" type="submit">บันทึกจุดบริการ</button>
      </div>
      <p id="qrSmartLocationStatus" role="status"></p>`;
    if (form.elements.parentId) form.elements.parentId.value = item?.parent_id || item?.parentId || '';
    $('#qrSmartCancelLocation').onclick = () => { form.hidden = true; form.innerHTML = ''; editingId = null; };
    form.scrollIntoView({block:'nearest'});
  }

  function parseAssetIds(raw) {
    return String(raw || '').split(/[,\s]+/).map(v => Number(v)).filter(n => Number.isInteger(n) && n > 0);
  }

  async function loadFeatures() {
    features = await call('/api/features');
    flagFields();
    applyModuleVisibility();
  }

  async function loadLocations() {
    if (!features.flags?.locationQr) {
      locations = [];
      renderLocations();
      return;
    }
    try {
      const data = await call('/api/qr/locations');
      locations = data.items || [];
      kinds = data.kinds || kinds;
      renderLocations();
    } catch (error) {
      locations = [];
      renderLocations();
      if (forbidden(error)) status(error.message, true);
      else throw error;
    }
  }

  async function loadOverdue() {
    const panel = $('#qrSmartOverduePanel');
    const list = $('#qrSmartOverdueList');
    if (!features.flags?.borrowIssueReturn) {
      panel.hidden = true;
      list.innerHTML = '';
      return;
    }
    panel.hidden = false;
    try {
      const data = await call('/api/lifecycle/overdue');
      const items = data.items || [];
      list.innerHTML = items.length ? `<div class="table-wrap"><table><thead><tr><th>ครุภัณฑ์</th><th>ผู้ยืม / ผู้เบิก</th><th>กำหนด</th><th>สถานะ</th></tr></thead><tbody>
        ${items.map(item => `<tr><td>${esc(item.name)}<div class="item-meta">${esc(item.code)}</div></td><td>${esc(item.custodian)}</td><td>${esc(item.dueAt)}</td><td>${esc(item.loanStatus === 'issued' ? 'เบิก' : 'ยืม')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="field-hint">ไม่มีรายการยืมหรือเบิกที่เกินกำหนด</p>';
    } catch (error) {
      list.innerHTML = `<p role="alert">${esc(error.message)}</p>`;
    }
  }

  async function load() {
    status('กำลังโหลด QR Smart…');
    const writable = canWrite();
    $('#qrSmartFlagsForm').querySelector('[type=submit]').disabled = !writable;
    $('#qrSmartNewLocation').disabled = !writable;
    try {
      await loadFeatures();
      await Promise.all([loadLocations(), loadOverdue()]);
      if (!writable) status(window.govAssetAccess?.session?.required ? 'การบันทึก QR Smart ใช้สิทธิ์จัดการตั้งค่า' : '');
      else status('');
    } catch (error) {
      status(error.message, true);
    }
  }

  $('#qrSmartFlagsForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    status('กำลังบันทึกบริการ…');
    try {
      const flags = {};
      event.target.querySelectorAll('input[type=checkbox][name]').forEach(input => { flags[input.name] = input.checked; });
      features = await call('/api/features', {method:'PUT', body:JSON.stringify({flags, revision:features.revision, actor:app.getRole?.() || 'เจ้าหน้าที่พัสดุ'})});
      flagFields();
      applyModuleVisibility();
      await Promise.all([loadLocations(), loadOverdue()]);
      status('บันทึกการเปิด-ปิดบริการแล้ว');
    } catch (error) {
      status(error.message, true);
    } finally { button.disabled = false; }
  };

  $('#qrSmartNewLocation').onclick = () => showLocationForm();

  $('#qrSmartLocationList').onclick = async event => {
    const printBtn = event.target.closest('[data-print-location]');
    if (printBtn) {
      try {
        const item = await call(`/api/qr/locations/${printBtn.dataset.printLocation}`);
        if (!item.qrImage) throw new Error('ยังสร้างภาพ QR ของจุดนี้ไม่ได้');
        printLocation(item);
      } catch (error) {
        status(error.message, true);
      }
      return;
    }
    const button = event.target.closest('[data-edit-location]');
    if (!button) return;
    const item = locations.find(row => String(row.id) === button.dataset.editLocation);
    if (item) showLocationForm(item);
  };

  $('#qrSmartLocationForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.target;
    const note = $('#qrSmartLocationStatus');
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    note.textContent = 'กำลังบันทึกจุดบริการ…';
    try {
      const fields = Object.fromEntries(new FormData(form));
      const body = {
        kind: fields.kind,
        name: fields.name,
        publicName: fields.publicName || fields.name,
        publicInfo: fields.publicInfo || '',
        code: fields.code || '',
        parentId: fields.parentId ? Number(fields.parentId) : null,
        isActive: form.elements.isActive.checked,
        guestCanReportPlace: form.elements.guestCanReportPlace.checked
      };
      const saved = editingId
        ? await call(`/api/qr/locations/${editingId}`, {method:'PUT', body:JSON.stringify(body)})
        : await call('/api/qr/locations', {method:'POST', body:JSON.stringify(body)});
      const id = saved.id;
      await call(`/api/qr/locations/${id}/assets`, {method:'PUT', body:JSON.stringify({assetIds:parseAssetIds(fields.assetIds)})});
      note.textContent = 'บันทึกแล้ว โทเคน QR ยังคงเดิม';
      form.hidden = true;
      editingId = null;
      await loadLocations();
    } catch (error) {
      note.setAttribute('role','alert');
      note.textContent = error.message;
    } finally { button.disabled = false; }
  };

  document.addEventListener('govasset:view-changed', event => {
    if (event.detail.name !== 'qr-smart') return;
    const crumb = $('#crumbCurrent');
    if (crumb) crumb.textContent = 'ตั้งค่า / QR Smart';
    document.title = `QR Smart — ${window.govAssetBranding?.appName || 'GovAsset'}`;
    load();
  });
  if (view.classList.contains('active')) load();
  else loadFeatures().catch(() => {});
})();
