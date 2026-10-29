(() => {
  const main = document.querySelector('#scanMain');
  const NOTICE = 'การสแกน QR ไม่ใช่การยืนยันตัวตน และไม่ยืนยันว่าผู้ใช้กำลังอยู่ในสถานที่จริง';
  const KIND_LABELS = {building:'อาคาร',floor:'ชั้น',room:'ห้อง',service_point:'จุดบริการ',common_area:'พื้นที่ส่วนกลาง'};
  const DEFAULT_GUEST = [
    {id:'info',label:'ดูข้อมูล',enabled:true},
    {id:'repair',label:'แจ้งซ่อม',enabled:true},
    {id:'track',label:'ติดตามคำแจ้งของฉัน',enabled:true}
  ];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const route = location.pathname.match(/^\/(q|t|l)\/([A-Za-z0-9_-]{32})$/);
  const date = v => new Date(v).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'});
  const honeypot = () => `<label class="scan-honeypot" aria-hidden="true">เว็บไซต์<input name="website" autocomplete="off" tabindex="-1" aria-hidden="true"></label>`;
  let config = {flags:{},authenticated:false,actor:'',permissions:{},services:{guest:DEFAULT_GUEST,staff:[]},csrf:''};

  function csrfHeaders() {
    const headers = {'Content-Type':'application/json'};
    const token = window.govAssetAccess?.session?.csrf || config.csrf;
    if (token) headers['X-CSRF-Token'] = token;
    return headers;
  }

  async function api(path, body, method) {
    const init = {credentials:'include', headers:csrfHeaders()};
    if (body !== undefined) {
      init.method = method || 'POST';
      init.body = JSON.stringify(body);
    } else if (method) init.method = method;
    const response = await fetch(path, init);
    const data = await response.json().catch(() => ({error:'ไม่สามารถอ่านผลจากระบบได้'}));
    if (!response.ok) {
      const err = new Error(data.error || (response.status === 403 ? 'ไม่มีสิทธิ์ใช้งานบริการนี้' : 'ไม่สามารถดำเนินการได้'));
      err.status = response.status;
      throw err;
    }
    return data;
  }

  function error(message, alert=true) {
    main.innerHTML = `<section class="scan-card"><span class="scan-kicker">ไม่สามารถเปิดรายการ</span><h1>กรุณาตรวจสอบลิงก์</h1><p id="scanErrorMessage" role="${alert?'alert':'status'}">${esc(message)}</p><button class="scan-button" type="button" id="retryScan">ลองอีกครั้ง</button></section>`;
    document.querySelector('#retryScan').onclick = init;
  }

  function disabled(title, message) {
    main.innerHTML = `<section class="scan-card"><span class="scan-kicker">บริการยังไม่เปิด</span><h1>${esc(title)}</h1><p role="status">${esc(message)}</p></section>`;
  }

  function savedReceipts() {
    try {
      const list = JSON.parse(localStorage.getItem('govasset.receipts') || '[]');
      return Array.isArray(list) ? list.filter(r => r && /^[A-Za-z0-9_-]{32}$/.test(r.token)).slice(0, 20) : [];
    } catch { return []; }
  }

  function rememberReceipt(result, extra={}) {
    try {
      localStorage.setItem('govasset.receipts', JSON.stringify([{token:result.receiptToken,number:result.ticketNo,...extra}, ...savedReceipts()].slice(0, 20)));
    } catch { /* Receipt remains available through the navigation URL. */ }
    location.assign(`/t/${result.receiptToken}`);
  }

  function formPayload(form) {
    const data = Object.fromEntries(new FormData(form));
    data.website = typeof data.website === 'string' ? data.website : '';
    if (form.elements.locationMismatch) data.locationMismatch = form.elements.locationMismatch.checked;
    if (data.assetId === '' || data.assetId == null) delete data.assetId;
    else data.assetId = Number(data.assetId);
    return data;
  }

  function flagOn(name, fallback=false) {
    return config.flags?.[name] !== undefined ? Boolean(config.flags[name]) : fallback;
  }

  function serviceList(kind) {
    const items = kind === 'staff' ? (config.services?.staff || []) : (config.services?.guest || DEFAULT_GUEST);
    return items.filter(s => s && s.enabled !== false);
  }

  function noticeCard() {
    return `<p class="scan-notice scan-legal" role="note">${esc(NOTICE)}</p>`;
  }

  function serviceMenu(ids, selected) {
    const buttons = ids.map(({id,label}) => `<button type="button" class="scan-button scan-service-btn${id===selected?' is-active':''}" data-service="${esc(id)}" aria-pressed="${id===selected?'true':'false'}">${esc(label)}</button>`).join('');
    return `<nav class="scan-services" aria-label="บริการจาก QR">${buttons}</nav><div id="scanServicePanel" class="scan-service-panel"></div><p id="scanServiceStatus" role="status"></p>`;
  }

  function bindServices(ids, renderPanel) {
    const panel = document.querySelector('#scanServicePanel');
    const status = document.querySelector('#scanServiceStatus');
    async function show(id) {
      document.querySelectorAll('[data-service]').forEach(btn => {
        const on = btn.dataset.service === id;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      status.textContent = '';
      status.setAttribute('role', 'status');
      try {
        const html = await renderPanel(id, status, panel);
        if (typeof html === 'string') panel.innerHTML = html;
        const copy = panel.querySelector('#copyExtraQr');
        if (copy) copy.onclick = async () => {
          const note = panel.querySelector('#extraQrStatus');
          try { await navigator.clipboard.writeText(location.href); if (note) note.textContent = 'คัดลอกลิงก์แล้ว'; }
          catch { if (note) note.textContent = location.href; }
        };
      } catch (err) {
        panel.innerHTML = '';
        status.setAttribute('role', err.status === 403 ? 'alert' : 'status');
        status.textContent = err.message;
      }
    }
    document.querySelectorAll('[data-service]').forEach(btn => {
      btn.onclick = () => show(btn.dataset.service);
    });
    const start = ids.some(s => s.id === 'info') ? 'info' : ids[0]?.id;
    if (start) return show(start);
  }

  function receiptLinks(list, empty) {
    if (!list.length) return `<p>${esc(empty)}</p>`;
    return `<p>ลิงก์ติดตามเป็นของผู้แจ้ง โปรดเก็บไว้และไม่เผยแพร่</p>${list.map(r => `<a class="scan-receipt-link" href="/t/${esc(r.token)}">${esc(r.number || 'ใบรับแจ้ง')} <span>ติดตามงาน →</span></a>`).join('')}`;
  }

  function urgencyField(name='urgency') {
    return `<label>ความเร่งด่วน<select name="${name}"><option>ปกติ</option><option>เร่งด่วน</option><option>เร่งด่วนมาก</option></select></label>`;
  }

  function contactFields() {
    return `<div class="scan-form-grid"><label>ชื่อผู้แจ้ง <span>*</span><input name="requester" required maxlength="160" autocomplete="name"></label><label>เบอร์โทร / ช่องทางติดต่อ <span>*</span><input name="contact" required maxlength="160" autocomplete="tel"></label></div><p class="scan-privacy">ระบบใช้ข้อมูลนี้เพื่อติดต่อประสานงาน กรุณาอย่าใส่ข้อมูลอ่อนไหวในรายละเอียดปัญหา</p>`;
  }

  async function resolveAssetId(code) {
    if (!config.authenticated || !code) return null;
    try {
      const data = await api(`/api/assets/search?q=${encodeURIComponent(code)}`);
      const match = (data.items || []).find(item => item.code === code);
      return match?.id || null;
    } catch { return null; }
  }

  async function assetPage(token) {
    if (!flagOn('assetQr', true)) {
      disabled('ยังไม่ได้เปิด Asset QR', 'บริการสแกนครุภัณฑ์ยังไม่เปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่ของหน่วยงาน');
      return;
    }
    const a = await api(`/api/scan/${token}`);
    document.title = `${a.name} · ข้อมูลครุภัณฑ์`;
    const guest = serviceList('guest').filter(s => {
      if (s.id === 'repair') return flagOn('guestReporting', true) && flagOn('repairManagement', true);
      return true;
    });
    const staff = config.authenticated ? serviceList('staff').filter(s => {
      if (s.id === 'borrow') return flagOn('borrowIssueReturn', false);
      if (s.id === 'more') return flagOn('additionalQrServices', false);
      return true;
    }) : [];
    const services = [...guest, ...staff];
    main.innerHTML = `<div class="scan-breadcrumb">ฉลากติดที่ตัวครุภัณฑ์ · หนึ่งเครื่องหนึ่งฉลาก <span>✓ ข้อมูลล่าสุด</span></div>
      <section class="scan-card scan-asset-card">
        <div class="scan-asset-symbol">▤</div>
        <span class="scan-kicker">ASSET QR</span>
        <h1>${esc(a.name)}</h1>
        <p class="scan-code">${esc(a.code)}</p>
        <span class="scan-badge">${esc(a.status)}</span>
        ${noticeCard()}
        ${serviceMenu(services, 'info')}
      </section>`;
    await bindServices(services, async (id, status, panel) => {
      if (id === 'info') {
        return `<span class="scan-kicker">ASSET INFORMATION</span><h2>ข้อมูลสาธารณะ</h2>
          <dl class="scan-details">
            <div><dt>สถานที่ตั้ง</dt><dd>${esc(a.location || 'ยังไม่ระบุ')}</dd></div>
            <div><dt>หมวดครุภัณฑ์</dt><dd>${esc(a.group || 'ยังไม่ระบุ')}</dd></div>
            ${a.serialNumber ? `<div><dt>Serial number</dt><dd>${esc(a.serialNumber)}</dd></div>` : ''}
            <div><dt>รายละเอียด</dt><dd>${esc(a.detail || 'ไม่มีรายละเอียดเพิ่มเติม')}</dd></div>
          </dl>
          ${a.activeRepairs ? `<p class="scan-notice">มีงานซ่อมที่กำลังดำเนินการ ${a.activeRepairs} งาน หากเป็นอาการเดิม โปรดติดตามใบรับแจ้งของคุณก่อนแจ้งซ้ำ</p>` : ''}
          <small class="scan-updated">อัปเดตล่าสุด ${esc(date(a.updatedAt))}</small>`;
      }
      if (id === 'repair') {
        if (!flagOn('guestReporting', true) || !flagOn('repairManagement', true)) {
          status.textContent = 'บริการแจ้งซ่อมยังไม่เปิดใช้งาน';
          return '';
        }
        panel.innerHTML = `<span class="scan-kicker">REPAIR REQUEST</span><h2>พบปัญหา ให้เราช่วยดูแล</h2>
          <p>ส่งคำแจ้งได้เลย ใบจะเข้าสถานะรับแจ้งใหม่ เจ้าหน้าที่จะตรวจว่าเป็นปัญหาจริงหรือไม่ ก่อนเปิดงานซ่อม</p>
          <form id="scanRepairForm">
            ${honeypot()}
            <label>อาการหรือปัญหาที่พบ <span>*</span><textarea name="issue" required maxlength="3000" rows="4" placeholder="เช่น เปิดเครื่องไม่ติด มีเสียงผิดปกติ เริ่มพบเมื่อใด"></textarea></label>
            <label>ที่ตั้งตามทะเบียน<input readonly value="${esc(a.location || 'ยังไม่ระบุที่ตั้งในทะเบียน')}"></label>
            <label class="scan-location-check"><input type="checkbox" name="locationMismatch" id="scanLocationMismatch"> ที่ตั้งไม่ตรง / ขอให้ตรวจสอบแก้ไข</label>
            <label>หมายเหตุเพิ่มเติม / ที่ตั้งจริง <span id="scanNoteRequired" ${a.location ? 'hidden' : ''}>*</span><textarea name="reporterNote" rows="3" maxlength="2000" ${a.location ? '' : 'required'} placeholder="ระบุที่ตั้งจริงหรือข้อมูลที่ต้องการให้เจ้าหน้าที่ตรวจสอบ"></textarea></label>
            <p class="scan-privacy">ที่ตั้งตามทะเบียนไม่เปลี่ยนทันทีจากการแจ้งซ่อม เจ้าหน้าที่จะตรวจสอบหมายเหตุก่อนแก้ทะเบียน</p>
            ${urgencyField()}
            ${contactFields()}
            <button class="scan-button" type="submit">ส่งคำขอแจ้งซ่อม</button>
            <p id="scanFormStatus" role="alert"></p>
          </form>`;
        document.querySelector('#scanLocationMismatch').onchange = e => {
          const required = !a.location || e.target.checked;
          document.querySelector('[name=reporterNote]').required = required;
          document.querySelector('#scanNoteRequired').hidden = !required;
        };
        document.querySelector('#scanRepairForm').onsubmit = async e => {
          e.preventDefault();
          const button = e.submitter || e.target.querySelector('[type=submit]');
          button.disabled = true;
          button.textContent = 'กำลังส่งคำขอ…';
          try {
            const result = await api(`/api/scan/${token}/repairs`, formPayload(e.target));
            rememberReceipt(result, {assetToken: token});
          } catch (err) {
            document.querySelector('#scanFormStatus').textContent = err.message;
            button.disabled = false;
            button.textContent = 'ส่งคำขอแจ้งซ่อม';
          }
        };
        return;
      }
      if (id === 'track') {
        return `<span class="scan-kicker">MY REPORTS</span><h2>ใบรับแจ้งบนอุปกรณ์นี้</h2>${receiptLinks(savedReceipts(), 'ยังไม่มีใบรับแจ้งที่บันทึกบนอุปกรณ์นี้')}`;
      }
      if (id === 'history' || id === 'borrow') {
        if (!config.authenticated) {
          status.textContent = 'ต้องเข้าสู่ระบบก่อนใช้บริการเจ้าหน้าที่';
          return '';
        }
        const assetId = await resolveAssetId(a.code);
        if (!assetId) {
          status.setAttribute('role','alert');
          status.textContent = 'ไม่พบครุภัณฑ์นี้ในขอบเขตสิทธิ์ของคุณ';
          return '';
        }
        if (id === 'history') {
          const life = await api(`/api/lifecycle/assets/${assetId}`);
          const history = life.history || [];
          return `<span class="scan-kicker">STAFF HISTORY</span><h2>ประวัติการเคลื่อนไหว</h2>
            <p>สถานะถือครอง ${esc(life.state?.loan_status || '—')}${life.state?.overdue ? ' · เกินกำหนด' : ''}${life.state?.openRepair ? ' · มีงานซ่อมค้าง' : ''}</p>
            ${history.length ? `<ol class="scan-timeline">${history.map((e,i)=>`<li class="${i===0?'current':''}"><b>${esc(e.kind)}</b><small>${esc(date(e.created_at))} · ${esc(e.actor)}</small>${e.note?`<small>${esc(e.note)}</small>`:''}</li>`).join('')}</ol>` : '<p>ยังไม่มีประวัติการเคลื่อนไหว</p>'}`;
        }
        if (!flagOn('borrowIssueReturn', false)) {
          status.textContent = 'ยังไม่ได้เปิดบริการยืม / เบิก / คืน';
          return '';
        }
        panel.innerHTML = `<span class="scan-kicker">BORROW / ISSUE / RETURN</span><h2>บันทึกยืม เบิก หรือคืน</h2>
          <form id="scanLifecycleForm">
            <label>ประเภทงาน <span>*</span>
              <select name="kind" required>
                <option value="loan">ยืม</option>
                <option value="issue">เบิก</option>
                <option value="return">คืน</option>
              </select>
            </label>
            <label>ผู้ยืม / ผู้เบิก / ผู้รับผิดชอบ <span>*</span><input name="party" required maxlength="160"></label>
            <label>กำหนดคืน (กรณียืม)<input name="dueAt" type="date"></label>
            <label>สถานที่<input name="location" maxlength="300" value="${esc(a.location || '')}"></label>
            <label>หมายเหตุ<textarea name="note" rows="2" maxlength="1000"></textarea></label>
            <button class="scan-button" type="submit">บันทึกรายการ</button>
            <p id="scanFormStatus" role="alert"></p>
          </form>`;
        document.querySelector('#scanLifecycleForm').onsubmit = async e => {
          e.preventDefault();
          const button = e.submitter || e.target.querySelector('[type=submit]');
          const statusEl = document.querySelector('#scanFormStatus');
          button.disabled = true;
          button.textContent = 'กำลังส่งคำขอ…';
          try {
            if (!flagOn('borrowIssueReturn', false)) throw Object.assign(new Error('ยังไม่ได้เปิดบริการยืม / เบิก / คืน'), {status:403});
            const data = formPayload(e.target);
            const body = {kind:data.kind, note:data.note || '', location:data.location || '', dueAt:data.dueAt || '', actor:config.actor || 'เจ้าหน้าที่พัสดุ'};
            if (data.kind === 'loan') body.borrower = data.party;
            else if (data.kind === 'issue') body.recipient = data.party;
            else body.custodian = data.party;
            await api(`/api/lifecycle/assets/${assetId}`, body);
            statusEl.setAttribute('role','status');
            statusEl.textContent = 'บันทึกรายการแล้ว';
          } catch (err) {
            statusEl.setAttribute('role','alert');
            statusEl.textContent = err.message;
          } finally {
            button.disabled = false;
            button.textContent = 'บันทึกรายการ';
          }
        };
        return;
      }
      if (id === 'more') {
        return extraServices(location.href, a.qrUrl || location.href, a.name);
      }
      return `<p>ไม่พบบริการนี้</p>`;
    });
  }

  function extraServices(pageUrl, qrUrl, title) {
    const url = qrUrl || pageUrl;
    return `<span class="scan-kicker">ADDITIONAL SERVICES</span><h2>บริการเพิ่มจาก QR</h2>
      <p>${esc(title || 'รายการนี้')}</p>
      <div class="scan-actions">
        <button class="scan-button" type="button" id="copyExtraQr">คัดลอกลิงก์ QR</button>
        <a class="scan-button secondary" href="${esc(pageUrl)}" target="_blank" rel="noopener">เปิดหน้านี้อีกครั้ง</a>
      </div>
      <p id="extraQrStatus" role="status"></p>
      <p class="scan-privacy">ใช้ลิงก์นี้พิมพ์ฉลากหรือส่งให้เจ้าหน้าที่ อย่าส่งต่อลิงก์ติดตามงานซ่อมของผู้แจ้ง</p>`;
  }

  async function locationPage(token) {
    if (!flagOn('locationQr', false)) {
      disabled('ยังไม่ได้เปิด Location QR', 'บริการสแกนจุดบริการยังไม่เปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่ของหน่วยงาน');
      return;
    }
    const place = await api(`/api/places/${token}`);
    document.title = `${place.name} · จุดบริการ`;
    const canRepair = flagOn('guestReporting', true) && (place.canReportPlace || (place.guestAssets || []).length);
    const guest = serviceList('guest').filter(s => {
      if (s.id === 'repair') return canRepair || !place.active;
      return true;
    });
    const staff = config.authenticated ? serviceList('staff').filter(s => {
      if (s.id === 'borrow' || s.id === 'history') return false;
      if (s.id === 'more') return flagOn('additionalQrServices', false);
      return true;
    }) : [];
    const services = [...guest, ...staff];
    const assets = place.active ? (place.guestAssets || []) : [];
    main.innerHTML = `<div class="scan-breadcrumb">${esc(place.placement || 'ฉลากติดที่จุดพื้นที่ ไม่ใช่ตัวครุภัณฑ์')} <span>${place.active ? '✓ พร้อมรับบริการ' : 'ปิดรับคำแจ้งใหม่'}</span></div>
      <section class="scan-card">
        <span class="scan-kicker">LOCATION QR</span>
        <h1>${esc(place.name)}</h1>
        <p>${esc(KIND_LABELS[place.kind] || place.kind || 'จุดบริการ')}</p>
        ${place.active ? '' : '<span class="scan-badge">ปิดใช้งานชั่วคราว</span>'}
        ${noticeCard()}
        ${place.active ? '' : `<p class="scan-notice" role="status">QR จุดนี้ถูกปิดใช้งานแล้ว สามารถดูชื่อและติดตามใบรับแจ้งเดิมได้ แต่ยังไม่รับคำแจ้งใหม่</p>`}
        ${serviceMenu(services, 'info')}
      </section>`;
    await bindServices(services, async (id, status, panel) => {
      if (id === 'info') {
        return `<span class="scan-kicker">PLACE INFORMATION</span><h2>ข้อมูลสาธารณะ</h2>
          <dl class="scan-details">
            <div><dt>ประเภท</dt><dd>${esc(KIND_LABELS[place.kind] || place.kind || '—')}</dd></div>
            <div><dt>ข้อมูลจุดบริการ</dt><dd>${esc(place.publicInfo || 'ไม่มีข้อมูลเพิ่มเติม')}</dd></div>
          </dl>
          ${place.notice ? `<p class="scan-notice">${esc(place.notice)}</p>` : ''}`;
      }
      if (id === 'repair') {
        if (!place.active) {
          status.textContent = 'QR จุดนี้ถูกปิดใช้งานแล้ว ไม่รับคำแจ้งใหม่';
          return '';
        }
        if (!flagOn('guestReporting', true)) {
          status.textContent = 'บริการแจ้งปัญหาจากผู้ไม่มีบัญชียังไม่เปิดใช้งาน';
          return '';
        }
        const requireAsset = !place.canReportPlace;
        const options = assets.map(item => `<option value="${item.id}">${esc(item.name)} · ${esc(item.code)}</option>`).join('');
        panel.innerHTML = `<span class="scan-kicker">PLACE REPORT</span><h2>แจ้งปัญหาที่จุดนี้</h2>
          <p>${place.canReportPlace ? 'แจ้งปัญหาของพื้นที่ หรือเลือกครุภัณฑ์จากรายการที่อนุญาต' : 'กรุณาเลือกครุภัณฑ์จากรายการที่จุดนี้เปิดให้แจ้ง'}</p>
          <form id="scanPlaceForm">
            ${honeypot()}
            <label>ประเภทปัญหา <span>*</span>
              <select name="problemType" required>${(place.problemTypes || []).map(t => `<option>${esc(t)}</option>`).join('')}</select>
            </label>
            ${assets.length ? `<label>ครุภัณฑ์ที่เกี่ยวข้อง ${requireAsset ? '<span>*</span>' : '(ถ้ามี)'}
              <select name="assetId" ${requireAsset ? 'required' : ''}>
                ${requireAsset ? '<option value="">เลือกครุภัณฑ์</option>' : '<option value="">ไม่ระบุครุภัณฑ์ · แจ้งปัญหาของพื้นที่</option>'}
                ${options}
              </select>
            </label>` : (place.canReportPlace ? '<p class="scan-privacy">คำแจ้งนี้จะบันทึกเป็นปัญหาของพื้นที่ ไม่ผูกครุภัณฑ์รายชิ้น</p>' : '<p role="alert">จุดนี้ยังไม่มีครุภัณฑ์ที่เปิดให้แจ้ง</p>')}
            <label>รายละเอียดปัญหา <span>*</span><textarea name="issue" required maxlength="3000" rows="4" placeholder="ระบุอาการหรือสิ่งที่พบ"></textarea></label>
            <label>หมายเหตุเพิ่มเติม<textarea name="reporterNote" rows="2" maxlength="2000"></textarea></label>
            ${urgencyField()}
            ${contactFields()}
            <button class="scan-button" type="submit" ${!place.canReportPlace && !assets.length ? 'disabled' : ''}>ส่งคำแจ้ง</button>
            <p id="scanFormStatus" role="alert"></p>
          </form>`;
        const form = document.querySelector('#scanPlaceForm');
        if (form) form.onsubmit = async e => {
          e.preventDefault();
          const button = e.submitter || e.target.querySelector('[type=submit]');
          const statusEl = document.querySelector('#scanFormStatus');
          button.disabled = true;
          button.textContent = 'กำลังส่งคำขอ…';
          try {
            const result = await api(`/api/places/${token}/reports`, formPayload(e.target));
            rememberReceipt(result, {locationToken: token});
          } catch (err) {
            statusEl.textContent = err.message;
            button.disabled = false;
            button.textContent = 'ส่งคำแจ้ง';
          }
        };
        return;
      }
      if (id === 'track') {
        return `<span class="scan-kicker">MY REPORTS</span><h2>ใบรับแจ้งบนอุปกรณ์นี้</h2>${receiptLinks(savedReceipts(), 'ยังไม่มีใบรับแจ้งที่บันทึกบนอุปกรณ์นี้')}`;
      }
      if (id === 'more') {
        return extraServices(location.href, location.href, place.name);
      }
      return `<p>ไม่พบบริการนี้</p>`;
    });
  }

  async function receiptPage(token) {
    const t = await api(`/api/receipts/${token}`);
    document.title = `${t.ticketNo} · ติดตามงานซ่อม`;
    main.innerHTML = `<div class="scan-breadcrumb">ใบรับแจ้งซ่อม / ติดตามสถานะ</div>
      <section class="scan-card">
        <div class="scan-success">✓</div>
        <span class="scan-kicker">REPAIR TRACKING</span>
        <h1>${esc(t.ticketNo)}</h1>
        <p>${esc(t.assetName)} · ${esc(t.assetCode)}</p>
        <span class="scan-badge">${esc(t.status)}</span>
        ${noticeCard()}
        <p class="scan-notice">เก็บลิงก์หน้านี้ไว้เพื่อติดตามและตรวจรับงาน ลิงก์นี้ใช้ดำเนินการกับใบแจ้งของคุณได้ จึงไม่ควรส่งต่อสาธารณะ</p>
        <button class="scan-button secondary" type="button" id="copyReceipt">คัดลอกลิงก์ติดตาม</button>
        <p id="receiptCopyStatus" role="status"></p>
        <h2>ความคืบหน้าของงาน</h2>
        <ol class="scan-timeline">${t.events.map((e,i)=>`<li class="${i===t.events.length-1?'current':''}"><b>${esc(e.status)}</b><small>${esc(date(e.createdAt))}</small></li>`).join('')}</ol>
        <button class="scan-button secondary" type="button" id="refreshReceipt">อัปเดตสถานะ</button>
      </section>
      ${t.canConfirm ? `<section class="scan-card"><span class="scan-kicker">ACCEPTANCE</span><h2>งานซ่อมเสร็จแล้ว กรุณาตรวจรับ</h2><p>ตรวจสอบการทำงานของครุภัณฑ์ก่อนยืนยันรับงาน หากยังพบปัญหาหรืออาการชำรุดสามารถส่งกลับให้ช่างแก้ไขได้</p><label>ความเห็น / ปัญหาที่พบ<textarea id="acceptanceNote" rows="3" maxlength="1000"></textarea></label><div class="scan-actions"><button class="scan-button" type="button" data-receipt-action="confirm">ยืนยันรับงานและปิดงาน</button><button class="scan-button secondary" type="button" data-receipt-action="send_back">ส่งกลับให้แก้ไข</button></div><p id="acceptanceStatus" role="alert"></p></section>` : ''}`;
    document.querySelector('#copyReceipt').onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); document.querySelector('#receiptCopyStatus').textContent = 'คัดลอกลิงก์แล้ว'; }
      catch { document.querySelector('#receiptCopyStatus').textContent = location.href; }
    };
    document.querySelector('#refreshReceipt').onclick = () => receiptPage(token).catch(e => error(e.message));
    document.querySelectorAll('[data-receipt-action]').forEach(button => button.onclick = async () => {
      const note = document.querySelector('#acceptanceNote').value.trim();
      if (button.dataset.receiptAction === 'send_back' && !note) {
        document.querySelector('#acceptanceStatus').textContent = 'กรุณาระบุปัญหาที่ต้องการให้แก้ไข';
        return;
      }
      document.querySelectorAll('[data-receipt-action]').forEach(b => b.disabled = true);
      try {
        await api(`/api/receipts/${token}/action`, {action:button.dataset.receiptAction, note});
        await receiptPage(token);
      } catch (e) {
        document.querySelector('#acceptanceStatus').textContent = e.message;
        document.querySelectorAll('[data-receipt-action]').forEach(b => b.disabled = false);
      }
    });
  }

  async function loadConfig() {
    try {
      config = {...config, ...await api('/api/qr/public-config')};
      config.flags = config.flags || {};
      config.services = config.services || {guest:DEFAULT_GUEST, staff:[]};
    } catch {
      config.flags = {assetQr:true, locationQr:false, guestReporting:true, repairManagement:true, borrowIssueReturn:false, additionalQrServices:false};
      config.services = {guest:DEFAULT_GUEST, staff:[]};
    }
    if (config.authenticated) return;
    try {
      const session = await api('/api/auth/session');
      if (!session?.authenticated && session?.required !== false) return;
      config.authenticated = true;
      config.actor = session.actor || (typeof localStorage !== 'undefined' && localStorage.getItem('govAssetPrototype.role')) || 'เจ้าหน้าที่พัสดุ';
      config.permissions = session.permissions || {};
      config.csrf = session.csrf || '';
      const flags = config.flags;
      const staff = [
        {id:'history', label:'ดูประวัติ', enabled:true},
        {id:'borrow', label:'ยืม / เบิก / คืน', enabled:Boolean(flags.borrowIssueReturn)}
      ];
      if (flags.additionalQrServices) staff.push({id:'more', label:'บริการเพิ่มเติม', enabled:true});
      config.services = {...config.services, staff};
    } catch { /* Guest remains unauthenticated. */ }
  }

  async function init() {
    try {
      await loadConfig();
      if (!route) throw new Error('เปิดหน้านี้ด้วยการสแกน QR บนครุภัณฑ์ จุดบริการ หรือลิงก์ใบรับแจ้ง');
      if (route[1] === 'q') await assetPage(route[2]);
      else if (route[1] === 'l') await locationPage(route[2]);
      else await receiptPage(route[2]);
    } catch (e) { error(e.message); }
  }

  api('/api/branding').then(b => {
    document.querySelector('#scanAppName').textContent = b.appName;
    document.querySelector('#scanOrganization').textContent = b.organization;
    if (b.logo) document.querySelector('#scanLogo').src = b.logo;
  }).catch(() => {});
  init();
})();
