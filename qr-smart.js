/* QR Smart settings: feature flags and Location QR master. */
  (() => {
    const app = window.govAssetApp;
    const $ = (s, r = document) => r.querySelector(s);
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const KIND_LABELS = { building: 'อาคาร', floor: 'ชั้น', room: 'ห้อง', service_point: 'จุดบริการ', common_area: 'พื้นที่ส่วนกลาง' };
    const view = $('#view-qr-smart');
    if (!view || !app) return;

    let features = { flags: {}, labels: {}, revision: 1 };
    let locations = [];
    let kinds = Object.keys(KIND_LABELS);
    let editingId = null;
    let activeTab = 'services';
    let initializedTab = false;

    function selectQrTab(tabName) {
      activeTab = tabName === 'locations' ? 'locations' : 'services';
      const selectedButton = $(`[data-qr-smart-tab="${activeTab}"]`);
      view.querySelectorAll('[data-qr-smart-tab]').forEach(button => {
        const selected = button === selectedButton;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      $('#qrSmartFlagsPanel').hidden = activeTab !== 'services';
      $('#qrSmartLocationsPanel').hidden = activeTab !== 'locations';
    }

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
      const descriptions = {
        assetQr: 'ให้สแกน QR บนตัวครุภัณฑ์เพื่อดูข้อมูลและบริการของรายการนั้น',
        locationQr: 'ใช้ QR ที่ห้องหรือจุดบริการ และจัดการ Location QR ในหน้านี้',
        guestReporting: 'ให้ผู้สแกนส่งแจ้งปัญหาจากหน้า QR โดยไม่ต้องเข้าแอปเจ้าหน้าที่',
        assetIntake: 'เปิดขั้นตอนรับเข้าและตรวจรับครุภัณฑ์',
        borrowIssueReturn: 'เปิดการทำรายการยืม เบิก คืน และติดตามรายการเกินกำหนด',
        repairManagement: 'เปิดเมนูและขั้นตอนติดตามงานแจ้งซ่อม',
        returnNotifications: 'ระบบแจ้งเตือนอัตโนมัติยังไม่พร้อมใช้งาน',
        fullAssetRegistration: 'เปิดแบบฟอร์มทะเบียนครุภัณฑ์ที่มีข้อมูลครบ',
        assetNumberGeneration: 'เปิดการออกเลขครุภัณฑ์และรหัส FSN',
        depreciation: 'เปิดเมนูหลักเกณฑ์และข้อมูลค่าเสื่อมราคา',
        additionalQrServices: 'เปิดบริการเสริมที่ใช้งานผ่านหน้า QR'
      };
      const keys = Object.keys(labels).length ? Object.keys(labels) : Object.keys(flags);
      const writable = canWrite();
      const busy = $('#qrSmartFlagFields').getAttribute('aria-busy') === 'true';
      const availableKeys = keys.filter(key => key !== 'returnNotifications');
      const enabledCount = availableKeys.filter(key => Boolean(flags[key])).length;
      $('#qrSmartFlagsSummary').textContent = `เปิดใช้แล้ว ${enabledCount} / ${availableKeys.length} บริการ`;
      $('#qrSmartFlagFields').innerHTML = keys.map(key => {
        const enabled = Boolean(flags[key]);
        const label = labels[key] || key;
        const description = descriptions[key] || 'กำหนดว่าจะเปิดใช้บริการนี้ในระบบหรือไม่';
        const ready = key !== 'returnNotifications';
        return `<label class="qr-smart-flag" data-enabled="${enabled}">
          <input type="checkbox" role="switch" name="${esc(key)}" aria-label="${esc(label)}" aria-checked="${enabled}" ${enabled ? 'checked' : ''} ${writable && !busy && ready ? '' : 'disabled'}>
          <span class="qr-smart-flag-copy"><b>${esc(label)}</b><small>${esc(description)}</small><span class="qr-smart-flag-state">${ready ? (enabled ? 'เปิดใช้งาน' : 'ปิดอยู่') : 'ยังไม่พร้อมใช้งาน'}</span></span>
          <span class="qr-smart-switch" aria-hidden="true"></span>
        </label>`;
      }).join('') || '<p class="field-hint">ไม่พบรายการบริการ</p>';
      $('#qrSmartFlagFields').querySelectorAll('input[role="switch"]').forEach(input => {
        input.addEventListener('change', () => saveFeatureToggle(input));
      });
    }

    async function saveFeatureToggle(changedInput) {
      const fields = $('#qrSmartFlagFields');
      const inputs = [...fields.querySelectorAll('input[role="switch"]')];
      const selectedValue = changedInput.checked;
      const label = features.labels?.[changedInput.name] || changedInput.getAttribute('aria-label');
      inputs.forEach(input => { input.disabled = true; });
      fields.setAttribute('aria-busy', 'true');
      status(`กำลัง${selectedValue ? 'เปิด' : 'ปิด'}บริการ${label}…`);
      try {
        const flags = Object.fromEntries(inputs.map(input => [input.name, input.checked]));
        features = await call('/api/features', {
          method: 'PUT',
          body: JSON.stringify({ flags, revision: features.revision, actor: app.getRole?.() || 'เจ้าหน้าที่พัสดุ' })
        });
        flagFields();
        applyModuleVisibility();
        await loadLocations();
        status(`บันทึกแล้ว · ${label} — ${selectedValue ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}`);
      } catch (error) {
        flagFields();
        status(error.message, true);
      } finally {
        fields.removeAttribute('aria-busy');
        fields.querySelectorAll('input[role="switch"]').forEach(input => {
          input.disabled = !canWrite() || input.name === 'returnNotifications';
        });
      }
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
      $('#qrSmartLocationsSummary').textContent = on ? `${locations.length} จุดบริการ` : 'ยังไม่เปิดบริการ';
      const notice = $('#qrSmartSimpleNotice');
      if (notice) notice.hidden = on;
      $('#qrSmartNewLocation').disabled = !on || !canWrite();
      if (!on) {
        list.innerHTML = '';
        $('#qrSmartLocationForm').hidden = true;
        view.classList.remove('location-form-open');
        return;
      }
      list.innerHTML = locations.length ? locations.map(item => {
        const active = item.isActive !== false && item.is_active !== 0;
        return `<article class="qr-smart-location panel">
        <div>
          <strong>${esc(item.name)}</strong>
          <span>${esc(KIND_LABELS[item.kind] || item.kind)} · ${active ? 'พร้อมใช้งาน' : 'ปิดชั่วคราว'}</span>
          <small>ผู้สแกนเห็น: ${esc(item.public_name || item.publicName || item.name)}</small>
        </div>
        <div class="qr-smart-location-actions">
          <div class="qr-smart-location-buttons">
            <button type="button" class="button primary" data-use-location-template="${item.id}">ใช้เทมเพลตพิมพ์ QR</button>
            <button type="button" class="button outline" data-edit-location="${item.id}" ${canWrite() ? '' : 'disabled'}>แก้ไขข้อมูล</button>
          </div>
        </div>
        <details class="qr-smart-location-details">
          <summary>ข้อมูล QR สำหรับเปิดหรือเชื่อมต่อ</summary>
          <label>URL ของ Location QR<input readonly value="${esc(item.qrUrl || '')}"></label>
          <label>โทเคนประจำจุด (คงเดิมเมื่อเปลี่ยนชื่อ)<input readonly value="${esc(item.qrToken || '')}"></label>
        </details>
      </article>`;
      }).join('') : '<p class="field-hint">ยังไม่มีจุด Location เพิ่มตำแหน่ง แล้วพิมพ์ป้ายไปติด ณ จุดที่ต้องการให้สแกนดูครุภัณฑ์</p>';
    }

    function showLocationForm(item = null) {
      selectQrTab('locations');
      editingId = item?.id || null;
      const form = $('#qrSmartLocationForm');
      const publicName = item?.publicName || item?.public_name || item?.name || '';
      const publicInfo = item?.publicInfo || item?.public_info || '';
      const active = item ? item.isActive !== false && item.is_active !== 0 : true;
      const canPlace = item ? item.guestCanReportPlace !== false && item.guest_can_report_place !== 0 : true;
      const ids = (item?.guestAssetIds || []).join(', ');
      view.classList.add('location-form-open');
      form.hidden = false;
      form.innerHTML = `<div class="qr-location-form-heading">
        <div><span class="eyebrow">LOCATION QR</span><h3>${item ? 'แก้ไขจุดบริการ' : 'เพิ่มจุดบริการ'}</h3>
          <p>กรอกข้อมูลตำแหน่งก่อน แล้วกำหนดว่าผู้สแกนจะเห็นหรือทำอะไรได้</p></div>
        <button class="button outline" type="button" id="qrSmartCancelLocationTop">ปิด</button>
      </div>
      ${item ? `<details class="qr-location-qr-details"><summary>ข้อมูล QR ปัจจุบัน</summary>
        <label>URL สำหรับเปิด QR<input readonly value="${esc(item.qrUrl || '')}"></label>
        <label>โทเคนประจำจุด<input readonly value="${esc(item.qrToken || '')}"></label>
      </details>` : ''}
      <section class="qr-location-form-step">
        <h4><span>1</span> ระบุตำแหน่ง</h4>
        <div class="qr-location-field-grid">
        <label><span class="qr-location-field-label">ประเภทพื้นที่ <span class="required">*</span></span><select name="kind" required>${kindOptions(item?.kind || 'room')}</select></label>
        <label><span class="qr-location-field-label">อยู่ภายใต้พื้นที่</span><select name="parentId"><option value="">ไม่มี / เป็นพื้นที่หลัก</option>${locationOptions(item?.id)}</select></label>
        <label class="qr-location-field-wide"><span class="qr-location-field-label">ชื่อในระบบ <span class="required">*</span></span><input name="name" required maxlength="200" value="${esc(item?.name || '')}" placeholder="เช่น อาคารศูนย์แพทยศาสตรศึกษา ชั้น 3 ห้องบรรยาย 1"><small>ใช้สำหรับค้นหาและจัดการในระบบ</small></label>
        <label><span class="qr-location-field-label">ชื่อที่ผู้สแกนเห็น</span><input name="publicName" maxlength="200" value="${esc(publicName)}" placeholder="เช่น ห้องบรรยาย 1 ชั้น 3"><small>เว้นว่างเพื่อใช้ชื่อในระบบ</small></label>
        <label><span class="qr-location-field-label">รหัสจุด (ถ้ามี)</span><input name="code" maxlength="80" value="${esc(item?.code || '')}" placeholder="เช่น MED-FL3-RM01"></label>
        </div>
      </section>
      <section class="qr-location-form-step">
        <h4><span>2</span> สิ่งที่ผู้สแกนเห็น</h4>
        <label class="qr-location-form-label">คำแนะนำหรือข้อมูลเพิ่มเติม<textarea name="publicInfo" rows="3" maxlength="2000" placeholder="ตัวอย่าง: เลือกเครื่องปรับอากาศหรืออุปกรณ์ในห้องเพื่อแจ้งซ่อม">${esc(publicInfo)}</textarea></label>
        <label class="qr-location-check"><input name="guestCanReportPlace" type="checkbox" ${canPlace ? 'checked' : ''}><span><b>อนุญาตให้แจ้งปัญหาของพื้นที่</b><small>ผู้สแกนแจ้งปัญหาห้องหรือจุดบริการได้ โดยไม่ต้องเลือกครุภัณฑ์</small></span></label>
      </section>
      <section class="qr-location-form-step">
        <h4><span>3</span> ผูกครุภัณฑ์ประจำจุด <small>ไม่บังคับ</small></h4>
        <p class="qr-location-step-help">ค้นหาด้วยชื่อหรือเลขครุภัณฑ์ แล้วกด “เพิ่ม” รายการที่เลือกจะปรากฏด้านล่าง</p>
        <div class="qr-location-asset-search">
          <input type="search" id="qrLocationAssetSearch" aria-label="ค้นหาครุภัณฑ์" placeholder="ค้นหาชื่อหรือเลขครุภัณฑ์ เช่น แอร์ หรือโปรเจคเตอร์">
          <button type="button" class="button outline" id="qrLocationAssetSearchBtn">ค้นหา</button>
        </div>
        <div id="qrLocationAssetResults" class="qr-location-asset-results" aria-live="polite"></div>
        <div id="qrLocationSelectedAssets" class="qr-location-selected-assets"></div>
        <input type="hidden" name="assetIds" id="qrLocationAssetIdsInput" value="${esc(ids)}">
      </section>
      <label class="qr-location-check"><input name="isActive" type="checkbox" ${active ? 'checked' : ''}><span><b>เปิดใช้งาน QR จุดนี้</b><small>ปิดชั่วคราวได้ภายหลัง โดยไม่ลบข้อมูลหรือโทเคน</small></span></label>
      <div class="dialog-actions">
        <button class="button outline" type="button" id="qrSmartCancelLocation">ยกเลิก</button>
        <button class="button primary" type="submit">บันทึกจุดบริการ</button>
      </div>
      <p id="qrSmartLocationStatus" role="status"></p>`;
      if (form.elements.parentId) form.elements.parentId.value = item?.parent_id || item?.parentId || '';
      const closeForm = () => {
        form.hidden = true;
        form.innerHTML = '';
        editingId = null;
        view.classList.remove('location-form-open');
      };
      $('#qrSmartCancelLocation').onclick = closeForm;
      $('#qrSmartCancelLocationTop').onclick = closeForm;
      const searchInput = $('#qrLocationAssetSearch', form);
      const searchBtn = $('#qrLocationAssetSearchBtn', form);
      const resultsBox = $('#qrLocationAssetResults', form);
      const idsInput = $('#qrLocationAssetIdsInput', form);
      const selectedAssets = $('#qrLocationSelectedAssets', form);
      const renderSelectedAssets = () => {
        const selectedIds = parseAssetIds(idsInput.value);
        selectedAssets.innerHTML = selectedIds.length
          ? `<p>ครุภัณฑ์ที่เลือก ${selectedIds.length} รายการ</p>${selectedIds.map(id => `<span class="qr-location-asset-chip">#${id}<button type="button" data-remove-location-asset="${id}" aria-label="นำครุภัณฑ์ ${id} ออกจากรายการ">×</button></span>`).join('')}`
          : '<p>ยังไม่ได้เลือกครุภัณฑ์</p>';
      };
      renderSelectedAssets();
      selectedAssets.onclick = event => {
        const remove = event.target.closest('[data-remove-location-asset]');
        if (!remove) return;
        idsInput.value = parseAssetIds(idsInput.value).filter(id => id !== Number(remove.dataset.removeLocationAsset)).join(', ');
        renderSelectedAssets();
      };
      const doSearch = async () => {
        const q = (searchInput?.value || '').trim();
        if (!q) {
          resultsBox.innerHTML = '<p class="qr-location-search-message">พิมพ์ชื่อหรือเลขครุภัณฑ์ก่อนค้นหา</p>';
          searchInput?.focus();
          return;
        }
        resultsBox.innerHTML = '<p class="qr-location-search-message">กำลังค้นหา…</p>';
        try {
          const res = await app.api(`/api/inventory?q=${encodeURIComponent(q)}&pageSize=15`);
          const rows = res.items || [];
          if (!rows.length) {
            resultsBox.innerHTML = '<p class="qr-location-search-message">ไม่พบครุภัณฑ์ที่ตรงกับคำค้น ลองค้นด้วยชื่อหรือเลขทะเบียนอีกครั้ง</p>';
            return;
          }
          resultsBox.innerHTML = rows.map(r => `<div class="qr-location-asset-result">
            <span><b>${esc(r.name)}</b><small>${esc(r.code || `ID ${r.id}`)}${r.location ? ` · ${esc(r.location)}` : ''}</small></span>
            <button type="button" class="button outline mini-action" data-add-loc-asset="${r.id}">เพิ่ม</button>
          </div>`).join('');
          resultsBox.querySelectorAll('[data-add-loc-asset]').forEach(btn => {
            btn.onclick = () => {
              const pickId = Number(btn.dataset.addLocAsset);
              const currentIds = parseAssetIds(idsInput.value);
              if (!currentIds.includes(pickId)) {
                currentIds.push(pickId);
                idsInput.value = currentIds.join(', ');
              }
              renderSelectedAssets();
              btn.textContent = currentIds.includes(pickId) ? 'เพิ่มแล้ว' : 'เพิ่ม';
              btn.disabled = true;
            };
          });
        } catch (e) {
          resultsBox.innerHTML = `<p class="qr-location-search-message" role="alert">${esc(e.message)}</p>`;
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

    async function load() {
      status('กำลังโหลด QR Smart…');
      const writable = canWrite();
      $('#qrSmartNewLocation').disabled = !writable;
      try {
        await loadFeatures();
        await loadLocations();
        if (!initializedTab) {
          selectQrTab(features.flags?.locationQr ? 'locations' : 'services');
          initializedTab = true;
        }
        if (!writable) status(window.govAssetAccess?.session?.required ? 'การบันทึก QR Smart ใช้สิทธิ์จัดการตั้งค่า' : '');
        else status('');
      } catch (error) {
        status(error.message, true);
      }
    }

    $('#qrSmartNewLocation').onclick = () => showLocationForm();
    view.querySelectorAll('[data-qr-smart-tab]').forEach(button => {
      button.addEventListener('click', () => selectQrTab(button.dataset.qrSmartTab));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextTab = event.key === 'Home' ? 'services'
          : event.key === 'End' ? 'locations'
            : activeTab === 'services' ? 'locations' : 'services';
        selectQrTab(nextTab);
        $(`[data-qr-smart-tab="${nextTab}"]`).focus();
      });
    });

    $('#qrSmartLocationList').onclick = async event => {
      const templateBtn = event.target.closest('[data-use-location-template]');
      if (templateBtn) {
        const openSticker = window.govAssetSticker?.openLocation;
        if (typeof openSticker !== 'function') {
          status('หน้าเทมเพลตสติกเกอร์ยังโหลดไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองอีกครั้ง', true);
          return;
        }
        try {
          await openSticker(templateBtn.dataset.useLocationTemplate);
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
        view.classList.remove('location-form-open');
        await loadLocations();
        app.toast('บันทึกจุดบริการแล้ว · เลือกเทมเพลตในหน้า Sticker Studio เพื่อพิมพ์');
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
