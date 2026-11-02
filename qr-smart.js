/* QR Smart settings: feature flags, Location QR master, and overdue loans. */
  (() => {
    const app = window.govAssetApp;
    const $ = (s, r = document) => r.querySelector(s);
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const KIND_LABELS = { building: 'อาคาร', floor: 'ชั้น', room: 'ห้อง', service_point: 'จุดบริการ', common_area: 'พื้นที่ส่วนกลาง' };
    const LOCATION_PRINT_PROFILES = {
      a6: { label: 'A6 · 105 × 148 มม.', page: '105mm 148mm', margin: '6mm', scale: 1 },
      a5: { label: 'A5 · 148 × 210 มม.', page: '148mm 210mm', margin: '6mm', scale: 1.46 },
      a4: { label: 'A4 · 210 × 297 มม.', page: '210mm 297mm', margin: '12mm', scale: 2 }
    };
    const view = $('#view-qr-smart');
    if (!view || !app) return;

    let features = { flags: {}, labels: {}, revision: 1 };
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
      const h = { 'Content-Type': 'application/json' };
      const csrf = window.govAssetAccess?.session?.csrf;
      if (csrf) h['X-CSRF-Token'] = csrf;
      return h;
    }

    async function call(path, options = {}) {
      try {
        return await app.api(path, {
          credentials: 'include',
          headers: { ...headers(), ...(options.headers || {}) },
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
        <div class="qr-smart-location-actions">
          <label class="qr-smart-location-paper">ขนาดกระดาษ · ใช้แบบเดียวกันทุกขนาด
          <select class="qr-smart-location-size" data-print-location-size="${item.id}" aria-label="ขนาดกระดาษป้าย Location QR">
            ${Object.entries(LOCATION_PRINT_PROFILES).map(([id, profile]) => `<option value="${id}" ${id === 'a6' ? 'selected' : ''}>${esc(profile.label)}</option>`).join('')}
          </select>
          </label>
          <button type="button" class="button outline" data-print-location="${item.id}">🖨️ พิมพ์ป้าย Location QR</button>
          <button type="button" class="button outline" data-edit-location="${item.id}" ${canWrite() ? '' : 'disabled'}>แก้ไข</button>
        </div>
      </article>`;
      }).join('') : '<p class="field-hint">ยังไม่มีจุด Location เพิ่มตำแหน่ง แล้วพิมพ์ป้ายไปติด ณ จุดที่ต้องการให้สแกนดูครุภัณฑ์</p>';
    }

    function printLocation(item, sizePreset = 'a6') {
      const branding = window.govAssetBranding || {};
      const name = item.publicName || item.public_name || item.name || 'จุดบริการ';
      const kind = KIND_LABELS[item.kind] || item.kind || 'จุดบริการ';
      const profile = LOCATION_PRINT_PROFILES[sizePreset] || LOCATION_PRINT_PROFILES.a6;
      const logoUrl = branding.logo || `${location.origin}/assets/govasset-mark-optimized.png`;
      const orgName = branding.organization || branding.appName || 'Smart Asset';
      const locationCode = item.code || 'ยังไม่ระบุ';
      const frame = document.createElement('iframe');
      frame.className = 'smart-print-frame';
      frame.title = 'พิมพ์ฉลาก Location QR';
      document.body.append(frame);
      const doc = frame.contentDocument;
      doc.open();
      doc.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ป้ายจุด · ${esc(name)}</title><style>
@font-face{font-family:LocationSarabun;src:url('/assets/fonts/Sarabun-Regular.ttf') format('truetype');font-weight:400}
@font-face{font-family:LocationSarabun;src:url('/assets/fonts/Sarabun-Bold.ttf') format('truetype');font-weight:700}
@page{size:${profile.page};margin:${profile.margin}}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{min-height:100vh;display:flex;justify-content:center;align-items:flex-start;color:#17384b;font-family:LocationSarabun,Tahoma,sans-serif}
.sign{position:relative;flex:none;width:93mm;height:132mm;transform:scale(${profile.scale});transform-origin:top center;overflow:hidden;border:1mm solid #174b62;border-radius:4mm;background:#fff;padding:6mm 7mm;display:flex;flex-direction:column;align-items:center;text-align:center}
.brand{width:100%;min-height:12mm;display:flex;align-items:center;justify-content:center;gap:3mm;padding-bottom:3mm;border-bottom:.35mm solid #d5e2e8}
.brand img{width:9mm;height:9mm;object-fit:contain;flex:none}
.brand-name{font-size:9pt;font-weight:700;line-height:1.25;text-align:left}
.brand-caption{display:block;margin-top:.7mm;color:#607987;font-size:7.5pt;font-weight:400}
.kicker{margin:4mm 0 1.5mm;color:#147d78;font-size:9pt;font-weight:700;letter-spacing:.35mm}
.title{width:100%;margin:0;color:#123d56;font-size:17pt;font-weight:700;line-height:1.2;overflow-wrap:anywhere}
.kind{margin:1.5mm 0 0;color:#607987;font-size:9pt}
.code{width:100%;margin:3mm 0 0;padding:1.5mm 2mm;border:.35mm solid #d5e2e8;border-radius:2mm;color:#17384b;font-size:10pt;line-height:1.25}
.code span,.code strong{display:block}
.code span{color:#607987;font-size:8pt}
.code strong{margin-top:.5mm;overflow-wrap:anywhere}
.qr{width:48mm;height:48mm;object-fit:contain;margin:3mm auto 0;padding:1.5mm;border:.4mm solid #d5e2e8;border-radius:2mm;background:#fff}
.instruction{margin:2mm 0 0;color:#334e5e;font-size:9pt;line-height:1.3}
.footer{margin-top:auto;padding-top:1.5mm;color:#82939d;font-size:7pt;letter-spacing:.2mm}
@media print{body{min-height:0}.sign{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main class="sign">
<header class="brand"><img src="${esc(logoUrl)}" alt=""><div class="brand-name">${esc(orgName)}<span class="brand-caption">ป้ายระบุตำแหน่งครุภัณฑ์</span></div></header>
<p class="kicker">ป้ายจุด · ${esc(kind)}</p>
<h1 class="title">${esc(name)}</h1>
<p class="kind">ตำแหน่งสำหรับดูครุภัณฑ์ประจำจุด</p>
<div class="code"><span>รหัส Location</span><strong>${esc(locationCode)}</strong></div>
<img class="qr" src="${esc(item.qrImage || '')}" alt="QR สำหรับดูครุภัณฑ์ประจำตำแหน่งนี้">
<p class="instruction">สแกนเพื่อดูรายการครุภัณฑ์และแจ้งปัญหาประจำจุด</p>
<footer class="footer">SMART ASSET · QR ประจำจุด</footer>
</main></body></html>`);
      doc.close();
      Promise.all([...doc.images].map(img => img.decode().catch(() => undefined)))
        .then(() => doc.fonts.ready)
        .then(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      });
      frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
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
      <p class="field-hint">มาตรฐาน: ฉลากจุดนี้ติดที่ประตูห้อง เคาน์เตอร์ หรือผนังจุดสังเกตง่าย (รองรับพิมพ์ถึงขนาด A4 สำหรับครุภัณฑ์ที่อยู่สูง เช่น แอร์บนฝ้า) เปลี่ยนชื่อได้ โทเคนเดิม</p>
      ${item ? `<label>URL ของ Location QR<input readonly value="${esc(item.qrUrl || '')}"></label>
        <label>โทเคน<input readonly value="${esc(item.qrToken || '')}"></label>` : ''}
      <div class="qr-smart-grid">
        <label>ประเภทพื้นที่ <span class="required">*</span><select name="kind" required>${kindOptions(item?.kind || 'room')}</select></label>
        <label>พื้นที่แม่<select name="parentId"><option value="">ไม่มี</option>${locationOptions(item?.id)}</select></label>
        <label>ชื่อในระบบ <span class="required">*</span><input name="name" required maxlength="200" value="${esc(item?.name || '')}" placeholder="เช่น อาคารศูนย์แพทยศาสตรศึกษา ชั้น 3 ห้องบรรยาย 1"></label>
        <label>ชื่อที่แสดงสาธารณะ<input name="publicName" maxlength="200" value="${esc(publicName)}" placeholder="เช่น ห้องบรรยาย 1 ชั้น 3"></label>
        <label>รหัสจุด<input name="code" maxlength="80" value="${esc(item?.code || '')}" placeholder="เช่น MED-FL3-RM01"></label>
      </div>
      <label>ข้อมูลสาธารณะ<textarea name="publicInfo" rows="2" maxlength="2000" placeholder="คำแนะนำเมื่อสแกน เช่น เลือกแอร์หรืออุปกรณ์ในห้องเพื่อแจ้งซ่อม">${esc(publicInfo)}</textarea></label>
      <div class="panel" style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0">
        <label style="margin-bottom:6px">🔍 ค้นหาครุภัณฑ์ในห้อง/จุดนี้เพื่อผูกกับ QR (เช่น แอร์บนฝ้า, โปรเจคเตอร์)
          <div style="display:flex;gap:6px">
            <input type="search" id="qrLocationAssetSearch" placeholder="พิมพ์เลขครุภัณฑ์ หรือชื่อ เช่น แอร์, เครื่องปรับอากาศ, ชั้น 3...">
            <button type="button" class="button outline" id="qrLocationAssetSearchBtn">ค้นหา</button>
          </div>
        </label>
        <div id="qrLocationAssetResults" style="max-height:160px;overflow:auto;margin-bottom:6px"></div>
        <label>รายการ ID ครุภัณฑ์ที่ผูกกับจุดนี้ (คั่นด้วยจุลภาค)<input name="assetIds" id="qrLocationAssetIdsInput" value="${esc(ids)}" placeholder="เช่น 12, 15, 20"></label>
      </div>
      <label class="check-inline"><input name="guestCanReportPlace" type="checkbox" ${canPlace ? 'checked' : ''}> ให้แจ้งปัญหาของพื้นที่โดยไม่ต้องเลือกครุภัณฑ์</label>
      <label class="check-inline"><input name="isActive" type="checkbox" ${active ? 'checked' : ''}> เปิดใช้งาน QR นี้ (ยกเลิกการติ๊กเพื่อปิดชั่วคราว ไม่ลบจุดบริการ)</label>
      <div class="dialog-actions">
        <button class="button outline" type="button" id="qrSmartCancelLocation">ยกเลิก</button>
        <button class="button primary" type="submit">บันทึกจุดบริการ</button>
      </div>
      <p id="qrSmartLocationStatus" role="status"></p>`;
      if (form.elements.parentId) form.elements.parentId.value = item?.parent_id || item?.parentId || '';
      $('#qrSmartCancelLocation').onclick = () => { form.hidden = true; form.innerHTML = ''; editingId = null; };
      const searchInput = $('#qrLocationAssetSearch', form);
      const searchBtn = $('#qrLocationAssetSearchBtn', form);
      const resultsBox = $('#qrLocationAssetResults', form);
      const idsInput = $('#qrLocationAssetIdsInput', form);
      const doSearch = async () => {
        const q = (searchInput?.value || '').trim();
        resultsBox.innerHTML = '<small class="field-hint">กำลังค้นหา...</small>';
        try {
          const res = await app.api(`/api/inventory?q=${encodeURIComponent(q)}&pageSize=15`);
          const rows = res.items || [];
          if (!rows.length) {
            resultsBox.innerHTML = '<small class="field-hint">ไม่พบครุภัณฑ์ที่ตรงกับคำค้น</small>';
            return;
          }
          resultsBox.innerHTML = rows.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;border-bottom:1px solid #e2e8f0;font-size:12.5px">
          <span><b>#${r.id}</b> · ${esc(r.code)} — ${esc(r.name)} <small style="color:#64748b">(${esc(r.location || '')})</small></span>
          <button type="button" class="button outline mini-action" data-add-loc-asset="${r.id}">＋ เพิ่ม</button>
        </div>`).join('');
          resultsBox.querySelectorAll('[data-add-loc-asset]').forEach(btn => {
            btn.onclick = () => {
              const pickId = Number(btn.dataset.addLocAsset);
              const currentIds = parseAssetIds(idsInput.value);
              if (!currentIds.includes(pickId)) {
                currentIds.push(pickId);
                idsInput.value = currentIds.join(', ');
              }
              btn.textContent = '✓ เพิ่มแล้ว';
              btn.disabled = true;
            };
          });
        } catch (e) {
          resultsBox.innerHTML = `<small role="alert">${esc(e.message)}</small>`;
        }
      };
      if (searchBtn) searchBtn.onclick = doSearch;
      if (searchInput) searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
      form.scrollIntoView({ block: 'nearest' });
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
        features = await call('/api/features', { method: 'PUT', body: JSON.stringify({ flags, revision: features.revision, actor: app.getRole?.() || 'เจ้าหน้าที่พัสดุ' }) });
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
          const locId = printBtn.dataset.printLocation;
          const sizeEl = $(`[data-print-location-size="${locId}"]`, $('#qrSmartLocationList'));
          const sizePreset = sizeEl ? sizeEl.value : 'a4';
          const item = await call(`/api/qr/locations/${locId}`);
          if (!item.qrImage) throw new Error('ยังสร้างภาพ QR ของจุดนี้ไม่ได้');
          printLocation(item, sizePreset);
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
          ? await call(`/api/qr/locations/${editingId}`, { method: 'PUT', body: JSON.stringify(body) })
          : await call('/api/qr/locations', { method: 'POST', body: JSON.stringify(body) });
        const id = saved.id;
        await call(`/api/qr/locations/${id}/assets`, { method: 'PUT', body: JSON.stringify({ assetIds: parseAssetIds(fields.assetIds) }) });
        note.textContent = 'บันทึกแล้ว โทเคน QR ยังคงเดิม';
        form.hidden = true;
        editingId = null;
        await loadLocations();
      } catch (error) {
        note.setAttribute('role', 'alert');
        note.textContent = error.message;
      } finally { button.disabled = false; }
    };

    document.addEventListener('govasset:view-changed', event => {
      if (event.detail.name !== 'qr-smart') return;
      const crumb = $('#crumbCurrent');
      if (crumb) crumb.textContent = 'ตั้งค่า / QR Smart';
      document.title = `${crumb?.textContent || 'QR Smart'} — ${window.govAssetBranding?.appName || 'Smart Asset'}`;
      load();
    });
    if (view.classList.contains('active')) load();
    else loadFeatures().catch(() => { });
  })();
