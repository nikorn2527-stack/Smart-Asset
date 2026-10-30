/* Overview showcase: most borrowed, on loan, status ring, latest photos and quick actions. */
(() => {
  const view = document.querySelector('#view-dashboard');
  if (!view) return;
  const app = window.govAssetApp || {};
  const api = path => (app.api ? app.api(path) : fetch(path).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = value => Number(value || 0).toLocaleString('th-TH');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fineHover = matchMedia('(hover: hover) and (pointer: fine)');
  const FOCUS_KEY = 'govAsset.showcaseFocus';
  const REFRESH_MS = 60000;
  let focus = localStorage.getItem(FOCUS_KEY) === 'center' ? 'center' : 'all';
  let data = null;
  let loadedAt = 0;
  let request = 0;
  let stale = true;
  let ringShown = false;
  const items = new Map();
  const counters = new Map();

  view.querySelectorAll('.smart-hero').forEach(node => node.remove());

  const ICONS = {
    medical: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M6 11h3l1.5-3 3 6 1.5-3H18M9 21h6M12 17v4"/>',
    computer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    furniture: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 9h14M5 15h14M11 6h2M11 12h2M11 18h2"/>',
    education: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v6"/>',
    electric: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    media: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l2-3h4l2 3"/>',
    vehicle: '<path d="M3 16V8h11v8M14 11h4l3 3v2h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    building: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM21 14v.01M14 21h.01M17.5 21H21v-3.5"/>',
    swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6 12.6 21a2.1 2.1 0 0 1-3-3L18 9.6a4 4 0 0 0-5-5l2.6 2.6z"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    chevronL: '<path d="M15 5l-7 7 7 7"/>',
    chevronR: '<path d="M9 5l7 7-7 7"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>'
  };
  const svg = (name, cls = '') => `<svg class="dsc-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.box}</svg>`;
  const STATE_LABEL = { ready: 'ว่าง', loaned: 'ถูกยืม', issued: 'เบิกใช้', repair: 'ซ่อม', pending: 'รอตรวจ', other: 'อื่น ๆ' };

  function glyphKind(item) {
    const text = `${item.name || ''} ${item.category || ''}`;
    if (/แพทย์|ผู้ป่วย|หัวใจ|ชีพ|ออกซิเจน|หุ่น|วิทยาศาสตร์|ความดัน|เตียง/.test(text)) return 'medical';
    if (/คอมพิวเตอร์|โน้ตบุ๊ก|โน๊ตบุ๊ก|จอภาพ|แท็บเล็ต|เซิร์ฟเวอร์/.test(text)) return 'computer';
    if (/การศึกษา|ฝึก|สอน|อบรม/.test(text)) return 'education';
    if (/โฆษณา|เผยแพร่|กล้อง|โปรเจ|ภาพ|เสียง/.test(text)) return 'media';
    if (/ไฟฟ้า|วิทยุ/.test(text)) return 'electric';
    if (/ยานพาหนะ|ขนส่ง|รถ/.test(text)) return 'vehicle';
    if (/ถ่ายเอกสาร|พิมพ์|เครื่องจักรสำนักงาน/.test(text)) return 'printer';
    if (/ตู้|โต๊ะ|เก้าอี้|ตกแต่ง|สำนักงาน/.test(text)) return 'furniture';
    if (/อาคาร|สิ่งก่อสร้าง/.test(text)) return 'building';
    return 'box';
  }
  const art = item => item.photoUrl
    ? `<img src="${esc(item.photoUrl)}" alt="" loading="lazy" decoding="async">`
    : `<span class="dsc-glyph g-${glyphKind(item)}">${svg(glyphKind(item))}</span>`;
  const chip = item => item.overdue
    ? '<span class="dsc-chip s-late">เกินกำหนด</span>'
    : `<span class="dsc-chip s-${esc(item.state)}">${esc(item.stateLabel || STATE_LABEL[item.state] || '')}</span>`;
  const thaiDate = iso => {
    const day = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
    return Number.isNaN(day.getTime()) ? String(iso) : day.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  };
  function dueInfo(item) {
    if (!item.dueAt) return { cls: 'calm', text: item.state === 'issued' ? 'เบิกใช้ · ไม่มีกำหนดคืน' : 'ไม่ระบุกำหนดคืน' };
    const left = item.daysLeft;
    if (left == null) return { cls: 'calm', text: `กำหนดคืน ${item.dueAt}` };
    if (left < 0) return { cls: 'late', text: `เกินกำหนด ${num(-left)} วัน` };
    if (left === 0) return { cls: 'soon', text: 'ครบกำหนดวันนี้' };
    if (left <= 3) return { cls: 'soon', text: `คืนภายใน ${left} วัน` };
    return { cls: 'ok', text: `คืน ${thaiDate(item.dueAt)}` };
  }
  const remember = (key, item) => { items.set(key, item); return key; };

  const root = document.createElement('section');
  root.className = 'dsc';
  root.setAttribute('aria-label', 'ภาพรวมการใช้งานครุภัณฑ์');
  root.innerHTML = `
    <div class="dsc-stage">
      <div class="dsc-stage-title">
        <span class="dsc-eyebrow"><i class="dsc-live" aria-hidden="true"></i><span id="dscCenterName">ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์</span></span>
        <h2>ครุภัณฑ์ที่ใช้งานจริง วันนี้</h2>
      </div>
      <div class="dsc-focus" role="group" aria-label="ขอบเขตข้อมูลที่แสดง" hidden>
        <button type="button" data-dsc-focus="all" aria-pressed="true">ทั้งหน่วยงาน</button>
        <button type="button" data-dsc-focus="center" aria-pressed="false">ศูนย์แพทย์ <span id="dscCenterCount"></span></button>
      </div>
      <nav class="dsc-actions" aria-label="ทางลัดงานประจำวัน">
        <button type="button" class="dsc-action a-scan" data-dsc-action="scan"><span class="dsc-action-ico">${svg('qr')}</span><span><b>สแกน QR</b><small>ทดลอง Smart QR</small></span></button>
        <button type="button" class="dsc-action a-loan" data-dsc-action="loan"><span class="dsc-action-ico">${svg('swap')}</span><span><b>ยืม / เบิก / คืน</b><small>ค้นหาแล้วบันทึก</small></span></button>
        <button type="button" class="dsc-action a-repair" data-dsc-action="repair"><span class="dsc-action-ico">${svg('wrench')}</span><span><b>แจ้งซ่อม</b><small>เปิด Ticket ใหม่</small></span></button>
        <button type="button" class="dsc-action a-register" data-dsc-action="register"><span class="dsc-action-ico">${svg('book')}</span><span><b>เปิดทะเบียน</b><small>ค้นหา · ออก QR</small></span></button>
      </nav>
    </div>
    <div class="dsc-main">
      <section class="dsc-panel dsc-top" aria-labelledby="dscTopTitle">
        <header class="dsc-head">
          <div><h3 id="dscTopTitle">ยืมบ่อยที่สุด</h3><p id="dscTopSub">กำลังโหลดข้อมูล…</p></div>
          <div class="dsc-nav" hidden>
            <button type="button" class="dsc-nav-btn" data-dsc-scroll="-1" aria-label="เลื่อนดูรายการก่อนหน้า">${svg('chevronL')}</button>
            <button type="button" class="dsc-nav-btn" data-dsc-scroll="1" aria-label="เลื่อนดูรายการถัดไป">${svg('chevronR')}</button>
          </div>
        </header>
        <div class="dsc-track" id="dscTrack" role="list"></div>
      </section>
      <section class="dsc-panel dsc-loans" aria-labelledby="dscLoanTitle">
        <header class="dsc-head">
          <div><h3 id="dscLoanTitle">กำลังถูกยืม / เบิก</h3><p id="dscLoanSub">—</p></div>
          <span class="dsc-pill" id="dscOverduePill" hidden></span>
        </header>
        <div class="dsc-loan-list" id="dscLoanList" role="list"></div>
      </section>
    </div>
    <div class="dsc-lower">
      <section class="dsc-panel dsc-ring" aria-labelledby="dscRingTitle">
        <header class="dsc-head"><div><h3 id="dscRingTitle">สถานะครุภัณฑ์</h3><p id="dscRingSub">—</p></div></header>
        <div class="dsc-ring-body">
          <div class="dsc-donut" id="dscDonut"></div>
          <ul class="dsc-legend" id="dscLegend"></ul>
        </div>
      </section>
      <section class="dsc-panel dsc-photos" aria-labelledby="dscPhotoTitle">
        <header class="dsc-head"><div><h3 id="dscPhotoTitle">ภาพครุภัณฑ์ล่าสุด</h3><p id="dscPhotoSub">—</p></div></header>
        <div class="dsc-marquee" id="dscMarquee"></div>
      </section>
      <section class="dsc-panel dsc-bubbles" aria-labelledby="dscBubbleTitle">
        <header class="dsc-head"><div><h3 id="dscBubbleTitle">หมวดครุภัณฑ์</h3><p id="dscBubbleSub">—</p></div></header>
        <div class="dsc-bubble-field" id="dscBubbles"></div>
      </section>
    </div>`;
  const anchor = view.querySelector(':scope > .stats-grid');
  if (anchor) anchor.before(root); else view.querySelector(':scope > .page-heading')?.after(root);
  const $ = selector => root.querySelector(selector);

  const preview = document.createElement('div');
  preview.className = 'dsc-preview';
  preview.setAttribute('aria-hidden', 'true');
  preview.innerHTML = '<div class="dsc-preview-in"></div>';
  document.body.append(preview);

  const finder = document.createElement('dialog');
  finder.className = 'dsc-finder';
  finder.setAttribute('aria-labelledby', 'dscFinderTitle');
  finder.innerHTML = `
    <div class="dsc-finder-box">
      <header><div><span class="dsc-finder-ico">${svg('swap')}</span><h3 id="dscFinderTitle">ยืม / เบิก / คืน ครุภัณฑ์</h3></div><button type="button" class="dsc-x" data-dsc-close aria-label="ปิดหน้าต่าง">×</button></header>
      <p class="dsc-finder-hint">พิมพ์เลขครุภัณฑ์หรือชื่อ แล้วเลือกรายการ ระบบจะเปิดแท็บ “ยืม / เบิก / คืน” ให้ทันที</p>
      <label class="dsc-finder-field"><span class="sr-only">ค้นหาครุภัณฑ์</span><input type="search" id="dscFinderInput" placeholder="เช่น 7110-002 หรือ ตู้เอกสาร" autocomplete="off" maxlength="200"></label>
      <p class="dsc-finder-status" id="dscFinderStatus" role="status"></p>
      <div class="dsc-finder-results" id="dscFinderResults"></div>
    </div>`;
  document.body.append(finder);

  /* ---------- rendering ---------- */
  function card(item, index, mode) {
    const key = remember(`top:${item.id}`, { ...item, mode });
    const max = Math.max(1, ...(data?.topBorrowed || []).map(i => i.borrowCount || 0));
    const share = mode === 'top' ? Math.max(0.08, (item.borrowCount || 0) / max) : 0;
    const label = mode === 'top'
      ? `อันดับ ${index + 1} ${item.name} ยืมแล้ว ${item.borrowCount} ครั้ง สถานะ ${item.stateLabel}`
      : `${item.name} สถานะ ${item.stateLabel}`;
    const foot = mode === 'top'
      ? `<span class="dsc-count"><b data-count="${item.borrowCount}">${num(item.borrowCount)}</b> ครั้ง${item.recentCount ? ` · ${num(item.recentCount)} ใน ${data.windowDays} วัน` : ''}</span><span class="dsc-meter"><i style="--p:${share.toFixed(3)}"></i></span>`
      : `<span class="dsc-count dsc-count-soft">${item.photoCount ? `${num(item.photoCount)} รูป · ` : ''}ยังไม่มีประวัติยืม</span>`;
    return `<button type="button" class="dsc-card${index === 0 && mode === 'top' ? ' is-first' : ''}" role="listitem" data-smart-id="${item.id}" data-dsc-key="${key}" data-dsc-tilt aria-label="${esc(label)}" style="--i:${index}">
      <span class="dsc-card-media">${art(item)}${mode === 'top' ? `<span class="dsc-rank r-${Math.min(index + 1, 4)}">${index + 1}</span>` : ''}${chip(item)}</span>
      <span class="dsc-card-body"><span class="dsc-card-name">${esc(item.name)}</span><span class="dsc-card-code">${esc(item.code || 'ไม่ระบุเลข')}</span><span class="dsc-card-foot">${foot}</span></span>
    </button>`;
  }

  function guideCard(compact, steps = true) {
    const enabled = data?.borrowEnabled;
    return `<div class="dsc-guide${compact ? ' is-compact' : ''}" role="listitem">
      <b>${compact ? 'รายการถัดไปจะขึ้นที่นี่' : 'อันดับจะขึ้นที่นี่เมื่อเริ่มยืมผ่านระบบ'}</b>
      ${steps ? `<ol>
        <li><span>1</span>สแกน QR ที่ตัวเครื่อง หรือค้นหาในทะเบียน</li>
        <li><span>2</span>เลือกแท็บ “ยืม / เบิก / คืน” แล้วบันทึก</li>
        <li><span>3</span>ระบบนับครั้งและจัดอันดับให้อัตโนมัติ</li>
      </ol>` : '<p class="dsc-soft">ครุภัณฑ์ที่ถูกยืมบ่อยจะเรียงอันดับพร้อมรูป ให้ทุกคนเห็นว่าชิ้นไหนใช้งานมากที่สุด</p>'}
      ${enabled === false
        ? '<button type="button" class="dsc-link-btn" data-dsc-action="flags">บริการยืม-เบิก-คืนยังปิดอยู่ · เปิดที่ QR Smart →</button>'
        : '<button type="button" class="dsc-link-btn" data-dsc-action="loan">เริ่มบันทึกการยืม →</button>'}
    </div>`;
  }

  function renderTop() {
    const top = data.topBorrowed || [];
    const spot = top.length ? [] : (data.recentPhotos?.items || []).slice(0, 6);
    let html;
    if (top.length) {
      $('#dscTopTitle').textContent = 'ยืมบ่อยที่สุด';
      $('#dscTopSub').textContent = `${num(top.length)} อันดับจากประวัติยืมและเบิกทั้งหมด · แตะการ์ดเพื่อเปิดรายละเอียด`;
      html = top.map((item, i) => card(item, i, 'top')).join('') + (top.length < 4 ? guideCard(true) : '');
    } else if (spot.length) {
      $('#dscTopTitle').textContent = 'ครุภัณฑ์พร้อมให้ยืม';
      $('#dscTopSub').textContent = 'ยังไม่มีประวัติการยืม · แสดงครุภัณฑ์ที่มีรูปล่าสุดแทน';
      html = spot.map((item, i) => card(item, i, 'spot')).join('') + guideCard(spot.length > 2);
    } else {
      $('#dscTopTitle').textContent = 'ยืมบ่อยที่สุด';
      $('#dscTopSub').textContent = 'ยังไม่มีประวัติการยืมหรือเบิกในขอบเขตนี้';
      html = ['สแกน QR ที่ตัวเครื่อง', 'บันทึก ยืม / เบิก / คืน', 'ติดอันดับที่นี่อัตโนมัติ'].map((text, i) =>
        `<div class="dsc-ghost" role="listitem" style="--i:${i}"><span class="dsc-ghost-art">${svg(['qr', 'swap', 'check'][i])}</span><b>${i + 1}. ${text}</b></div>`).join('') + guideCard(false, false);
    }
    $('#dscTrack').innerHTML = html;
    requestAnimationFrame(updateNav);
  }

  function renderLoans() {
    const loans = data.onLoan || { total: 0, overdue: 0, items: [] };
    $('#dscLoanSub').textContent = loans.total ? `${num(loans.total)} รายการ · ตามกำหนดคืน` : 'ทุกชิ้นอยู่ที่หน่วยงาน';
    const pill = $('#dscOverduePill');
    pill.hidden = !loans.overdue;
    pill.innerHTML = loans.overdue ? `<i aria-hidden="true"></i>เกินกำหนด ${num(loans.overdue)}` : '';
    if (!loans.items.length) {
      $('#dscLoanList').innerHTML = `<div class="dsc-empty">
        <span class="dsc-empty-art">${svg('check')}</span>
        <b>ยังไม่มีครุภัณฑ์ที่ถูกยืมอยู่ในขณะนี้</b>
        <p>${data.borrowEnabled === false ? 'เปิดบริการยืม-เบิก-คืนที่หน้า QR Smart แล้วบันทึกผ่านรายละเอียดครุภัณฑ์' : 'เมื่อบันทึกยืมหรือเบิกในรายละเอียดครุภัณฑ์ รายการและวันครบกำหนดคืนจะแสดงที่นี่'}</p>
        <button type="button" class="dsc-link-btn" data-dsc-action="${data.borrowEnabled === false ? 'flags' : 'loan'}">${data.borrowEnabled === false ? 'ไปที่ QR Smart →' : 'บันทึกการยืม →'}</button>
      </div>`;
      return;
    }
    $('#dscLoanList').innerHTML = loans.items.map((item, i) => {
      const due = dueInfo(item);
      const key = remember(`loan:${item.id}`, { ...item, mode: 'loan', dueText: due.text });
      return `<button type="button" class="dsc-loan d-${due.cls}" role="listitem" data-smart-id="${item.id}" data-dsc-tab="custody" data-dsc-key="${key}" style="--i:${i}"
        aria-label="${esc(`${item.name} ${item.state === 'issued' ? 'ผู้เบิก' : 'ผู้ยืม'} ${item.holder || 'ไม่ระบุ'} ${due.text} เปิดแท็บยืมเบิกคืน`)}">
        <span class="dsc-loan-art">${art(item)}</span>
        <span class="dsc-loan-text"><b>${esc(item.name)}</b><span class="dsc-loan-meta"><span class="dsc-due">${esc(due.text)}</span><small>${item.state === 'issued' ? 'เบิกโดย' : 'ยืมโดย'} ${esc(item.holder || 'ไม่ระบุ')}</small></span></span>
      </button>`;
    }).join('') + (loans.total > loans.items.length ? `<p class="dsc-more">และอีก ${num(loans.total - loans.items.length)} รายการ</p>` : '');
  }

  const RING = [
    { key: 'ready', label: 'พร้อมใช้', color: '#0c7f82' },
    { key: 'loaned', label: 'ถูกยืม / เบิก', color: '#f9a35a' },
    { key: 'repair', label: 'ซ่อม', color: '#e2575f' },
    { key: 'pending', label: 'รอตรวจ', color: '#6c7fd8' },
    { key: 'other', label: 'อื่น ๆ', color: '#b6c4ce' }
  ];
  function renderRing() {
    const counts = data.statusCounts || {};
    const values = RING.map(seg => ({ ...seg, value: seg.key === 'loaned' ? (counts.loaned || 0) + (counts.issued || 0) : counts[seg.key] || 0 }));
    const total = counts.total || 0;
    const C = 2 * Math.PI * 46;
    const visible = values.filter(v => v.value > 0);
    const minShare = visible.length > 1 ? 0.025 : 0;
    const raw = visible.map(v => Math.max(minShare, v.value / Math.max(1, total)));
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    let start = -90;
    const gap = visible.length > 1 ? 2.2 : 0;
    const segs = visible.map((v, i) => {
      const share = raw[i] / sum;
      const len = Math.max(0.5, share * C - gap);
      const rot = start;
      start += share * 360;
      return `<circle class="dsc-seg" cx="60" cy="60" r="46" stroke="${v.color}" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" style="--rot:${rot.toFixed(2)}deg;--i:${i}"><title>${esc(v.label)} ${num(v.value)}</title></circle>`;
    }).join('');
    const readyPct = total ? Math.round(((counts.ready || 0) / total) * 100) : 0;
    $('#dscRingSub').textContent = total ? `พร้อมใช้ ${readyPct}% ของ ${num(total)} รายการ` : 'ยังไม่มีครุภัณฑ์ในขอบเขตนี้';
    $('#dscDonut').innerHTML = `<svg viewBox="0 0 120 120" role="img" aria-label="${esc(values.map(v => `${v.label} ${v.value}`).join(', '))}">
        <circle class="dsc-track-ring" cx="60" cy="60" r="46"/>${segs}
      </svg>
      <span class="dsc-donut-center"><b data-count="${total}" data-count-key="ring-total">${num(total)}</b><small>รายการ</small></span>`;
    const pct = v => (!total ? '' : v.value && v.value / total < 0.01 ? '<1%' : `${Math.round((v.value / total) * 100)}%`);
    $('#dscLegend').innerHTML = values.map(v => `<li style="--c:${v.color}"><i aria-hidden="true"></i><span>${esc(v.label)}<small>${pct(v)}</small></span><b data-count="${v.value}" data-count-key="ring-${v.key}">${num(v.value)}</b></li>`).join('');
    const donut = $('#dscDonut');
    if (ringShown || reduce.matches) donut.classList.add('is-in');
    else requestAnimationFrame(() => requestAnimationFrame(() => { donut.classList.add('is-in'); ringShown = true; }));
  }

  function renderPhotos() {
    const photos = data.recentPhotos || { total: 0, items: [] };
    const tiles = [];
    photos.items.forEach(item => (item.gallery?.length ? item.gallery : [item]).forEach((photo, i) => {
      if (tiles.length < 24) tiles.push({ ...item, ...photo, mode: 'photo', tileKey: `photo:${item.id}:${i}` });
    }));
    $('#dscPhotoSub').textContent = photos.total ? `${num(photos.total)} ครุภัณฑ์มีรูปแล้ว · ชี้หรือแตะเพื่อดูภาพใหญ่` : 'ยังไม่มีรูปครุภัณฑ์ในขอบเขตนี้';
    const tile = (t, hidden) => `<button type="button" class="dsc-tile" data-smart-id="${t.id}" data-dsc-key="${remember(t.tileKey, t)}"${hidden ? ' tabindex="-1" aria-hidden="true"' : ` aria-label="${esc(`รูป ${t.name}`)}"`}>
        <img src="${esc(t.photoUrl)}" alt="" loading="lazy" decoding="async"><span>${esc(t.name)}</span></button>`;
    const ghost = `<div class="dsc-tile-ghost">${svg('camera')}<b>เพิ่มรูปครุภัณฑ์</b><small>เปิดรายละเอียด › เพิ่มรูป</small></div>`;
    const box = $('#dscMarquee');
    const moving = tiles.length >= 5 && !reduce.matches;
    box.classList.toggle('is-moving', moving);
    box.classList.toggle('is-static', !moving);
    if (!tiles.length) {
      box.innerHTML = `<div class="dsc-reel">${ghost}${[0, 1, 2].map(i => `<div class="dsc-tile-ghost is-faint" style="--i:${i}" aria-hidden="true">${svg('camera')}</div>`).join('')}</div>`;
      return;
    }
    const strip = tiles.map(t => tile(t, false)).join('');
    box.style.setProperty('--dur', `${Math.max(28, tiles.length * 5)}s`);
    box.innerHTML = moving
      ? `<div class="dsc-reel">${strip}${tiles.map(t => tile(t, true)).join('')}</div>`
      : `<div class="dsc-reel">${strip}${tiles.length < 5 ? ghost : ''}</div>`;
  }

  function renderBubbles() {
    const center = data.center || {};
    const list = center.categories || [];
    const isCenter = center.categoriesScope === 'center';
    $('#dscBubbleTitle').textContent = isCenter ? `หมวดครุภัณฑ์ · ${center.shortName || 'ศูนย์แพทย์'}` : 'หมวดครุภัณฑ์ · ทั้งหน่วยงาน';
    $('#dscBubbleSub').textContent = isCenter ? `${num(center.total)} รายการที่ระบุเป็นของ${center.shortName || 'ศูนย์แพทย์'}` : 'ยังไม่พบรายการที่ระบุหน่วยงานเป็นศูนย์แพทย์';
    if (!list.length) {
      $('#dscBubbles').innerHTML = '<p class="dsc-soft">ยังไม่มีข้อมูลหมวดครุภัณฑ์</p>';
      return;
    }
    const max = Math.max(...list.map(c => c.count));
    const palette = ['#0c7f82', '#123d56', '#f9a35a', '#6c7fd8', '#2f9e8f', '#c9748f', '#4f86a8', '#b08a3e'];
    const short = n => n >= 10000 ? `${(n / 1000).toFixed(0)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
    $('#dscBubbles').innerHTML = list.map((c, i) => {
      const d = Math.round(40 + 44 * Math.sqrt(c.count / max));
      return `<div class="dsc-bubble" style="--d:${d}px;--c:${palette[i % palette.length]};--i:${i}" title="${esc(`${c.name}: ${num(c.count)} รายการ`)}">
        <span class="dsc-bubble-dot"><b>${esc(short(c.count))}</b></span><small>${esc(c.name)}</small></div>`;
    }).join('');
  }

  function renderFocus() {
    const center = data?.center;
    const group = $('.dsc-focus');
    if (center?.name) $('#dscCenterName').textContent = center.name;
    group.hidden = !center?.total;
    $('#dscCenterCount').textContent = center?.total ? num(center.total) : '';
    group.querySelectorAll('[data-dsc-focus]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dscFocus === focus)));
  }

  function animateCounts() {
    root.querySelectorAll('[data-count]').forEach(el => {
      const to = Number(el.dataset.count) || 0;
      const key = el.dataset.countKey || '';
      const from = key ? (counters.get(key) ?? 0) : 0;
      if (key) counters.set(key, to);
      if (reduce.matches || from === to || !key) { el.textContent = num(to); return; }
      const t0 = performance.now();
      const step = now => {
        const p = Math.min(1, (now - t0) / 900);
        el.textContent = num(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function renderAll() {
    items.clear();
    root.classList.remove('is-loading', 'is-error');
    renderFocus(); renderTop(); renderLoans(); renderRing(); renderPhotos(); renderBubbles();
    animateCounts();
  }

  function renderLoading() {
    root.classList.add('is-loading');
    $('#dscTrack').innerHTML = [0, 1, 2, 3].map(i => `<div class="dsc-skel" role="listitem" style="--i:${i}" aria-hidden="true"><span></span><i></i><i></i></div>`).join('');
  }

  function renderError(error) {
    root.classList.add('is-error');
    $('#dscTopSub').textContent = 'โหลดข้อมูลภาพรวมไม่สำเร็จ';
    $('#dscTrack').innerHTML = `<div class="dsc-guide" role="listitem"><b>ยังโหลดข้อมูลไม่ได้</b><p class="dsc-soft">${esc(error?.message || 'กรุณาลองอีกครั้ง')}</p><button type="button" class="dsc-link-btn" data-dsc-action="retry">ลองอีกครั้ง →</button></div>`;
  }

  async function load() {
    const id = ++request;
    stale = false;
    if (!data) renderLoading();
    try {
      const result = await api(`/api/dashboard/showcase?focus=${focus}`);
      if (id !== request) return;
      if (focus === 'center' && !result.center?.total) { focus = 'all'; localStorage.removeItem(FOCUS_KEY); return load(); }
      data = result;
      loadedAt = Date.now();
      renderAll();
    } catch (error) {
      if (id !== request) return;
      stale = true;
      if (!data) renderError(error);
    }
  }

  /* ---------- gallery scrolling ---------- */
  function updateNav() {
    const track = $('#dscTrack');
    $('.dsc-nav').hidden = track.scrollWidth <= track.clientWidth + 4;
  }

  /* ---------- tilt ---------- */
  let tiltCard = null;
  let tiltFrame = 0;
  let tiltPoint = [0.5, 0.5];
  function applyTilt() {
    tiltFrame = 0;
    if (!tiltCard) return;
    const [x, y] = tiltPoint;
    tiltCard.style.setProperty('--rx', `${((0.5 - y) * 12).toFixed(2)}deg`);
    tiltCard.style.setProperty('--ry', `${((x - 0.5) * 14).toFixed(2)}deg`);
    tiltCard.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
    tiltCard.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
  }
  function resetTilt(cardEl) {
    if (!cardEl) return;
    cardEl.classList.remove('is-tilting');
    ['--rx', '--ry', '--gx', '--gy'].forEach(p => cardEl.style.removeProperty(p));
  }
  root.addEventListener('pointermove', event => {
    if (reduce.matches || event.pointerType !== 'mouse') return;
    const cardEl = event.target.closest('[data-dsc-tilt]');
    if (cardEl !== tiltCard) { resetTilt(tiltCard); tiltCard = cardEl; }
    if (!cardEl) return;
    const r = cardEl.getBoundingClientRect();
    tiltPoint = [Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (event.clientY - r.top) / r.height))];
    cardEl.classList.add('is-tilting');
    if (!tiltFrame) tiltFrame = requestAnimationFrame(applyTilt);
  });
  root.addEventListener('pointerleave', () => { resetTilt(tiltCard); tiltCard = null; });

  /* ---------- preview popover ---------- */
  let previewFor = null;
  let previewTimer = 0;
  function previewMarkup(item) {
    const big = item.fullPhotoUrl || item.photoUrl;
    const media = big
      ? `<img src="${esc(item.photoUrl || big)}" alt="" data-full="${esc(big)}">`
      : `<span class="dsc-glyph g-${glyphKind(item)}">${svg(glyphKind(item))}</span>`;
    const rows = [];
    if (item.mode === 'top') rows.push(`<span><b>${num(item.borrowCount)}</b> ครั้งที่ยืม / เบิก${item.lastBorrowedAt ? ` · ล่าสุด ${esc(thaiDate(item.lastBorrowedAt))}` : ''}</span>`);
    if (item.state === 'loaned' || item.state === 'issued') rows.push(`<span class="${item.overdue ? 'is-late' : ''}">${esc(item.dueText || dueInfo(item).text)}${item.holder ? ` · ${esc(item.holder)}` : ''}</span>`);
    if (item.location) rows.push(`<span>📍 ${esc(item.location)}</span>`);
    if (item.category) rows.push(`<span>${esc(item.category)}</span>`);
    return `<span class="dsc-preview-media">${media}${chip(item)}</span>
      <span class="dsc-preview-body"><b>${esc(item.name)}</b><code>${esc(item.code || 'ไม่ระบุเลข')}</code>${rows.join('')}
      <em>${item.mode === 'loan' ? 'คลิกเพื่อเปิดแท็บ ยืม / เบิก / คืน' : 'คลิกเพื่อเปิดรายละเอียดครุภัณฑ์'}</em></span>`;
  }
  function placePreview(anchorEl) {
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const r = anchorEl.getBoundingClientRect();
    // Browsers differ on whether rects under CSS zoom are in screen or zoomed pixels; measure it.
    const body = document.body;
    const unit = body.offsetWidth ? body.getBoundingClientRect().width / body.offsetWidth : zoom;
    const vw = document.documentElement.clientWidth * unit / zoom;
    const vh = window.innerHeight * unit / zoom;
    const box = preview.getBoundingClientRect();
    const w = box.width;
    const h = box.height;
    const gap = 14;
    let x;
    let y;
    let origin = 'left center';
    if (r.right + gap + w <= vw - 8) { x = r.right + gap; }
    else if (r.left - gap - w >= 8) { x = r.left - gap - w; origin = 'right center'; }
    else { x = r.left + r.width / 2 - w / 2; origin = 'center top'; }
    if (origin === 'center top') {
      y = r.bottom + gap + h <= vh - 8 ? r.bottom + gap : r.top - gap - h;
      if (y < r.top) origin = 'center bottom';
    } else {
      y = r.top + r.height / 2 - h / 2;
    }
    x = Math.min(Math.max(8, x), vw - w - 8);
    y = Math.min(Math.max(8, y), vh - h - 8);
    preview.style.left = `${x / unit}px`;
    preview.style.top = `${y / unit}px`;
    preview.style.setProperty('--origin', origin);
  }
  function showPreview(el) {
    const item = items.get(el.dataset.dscKey);
    if (!item) return;
    previewFor = el;
    const inner = preview.firstElementChild;
    inner.innerHTML = previewMarkup(item);
    const img = inner.querySelector('img[data-full]');
    if (img && img.dataset.full !== img.getAttribute('src')) {
      const full = new Image();
      full.onload = () => { if (previewFor === el) img.src = full.src; };
      full.src = img.dataset.full;
    }
    preview.classList.add('is-measuring');
    placePreview(el);
    preview.classList.remove('is-measuring');
    requestAnimationFrame(() => { if (previewFor === el) preview.classList.add('is-visible'); });
  }
  function hidePreview() {
    clearTimeout(previewTimer);
    previewFor = null;
    preview.classList.remove('is-visible');
  }
  root.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse' || !fineHover.matches) return;
    const el = event.target.closest('[data-dsc-key]');
    if (!el || el === previewFor) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => showPreview(el), previewFor ? 60 : 220);
  });
  root.addEventListener('pointerout', event => {
    const el = event.target.closest('[data-dsc-key]');
    if (!el || el.contains(event.relatedTarget)) return;
    hidePreview();
  });
  let keyboardMode = false;
  document.addEventListener('keydown', event => { if (!event.metaKey && !event.ctrlKey && !event.altKey) keyboardMode = true; }, true);
  document.addEventListener('pointerdown', () => { keyboardMode = false; }, true);
  root.addEventListener('focusin', event => {
    const reel = event.target.closest('.dsc-marquee.is-moving');
    if (reel && keyboardMode) {
      reel.classList.add('is-held');
      event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    const el = event.target.closest('[data-dsc-key]');
    if (el && (keyboardMode || el.matches(':focus-visible'))) showPreview(el); else hidePreview();
  });
  root.addEventListener('focusout', event => {
    const held = event.target.closest('.dsc-marquee.is-held');
    if (held && !held.contains(event.relatedTarget)) { held.classList.remove('is-held'); held.scrollLeft = 0; }
    if (!root.contains(event.relatedTarget)) hidePreview();
  });
  document.addEventListener('scroll', () => { if (previewFor && document.activeElement !== previewFor) hidePreview(); else if (previewFor) placePreview(previewFor); }, true);
  window.addEventListener('resize', () => { hidePreview(); updateNav(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && previewFor) hidePreview(); });

  /* ---------- actions ---------- */
  function openAssetTab(tab) {
    const dialog = document.querySelector('dialog.smart-dialog:not(.qr-simulator-modal)');
    if (!dialog || !tab) return;
    const observer = new MutationObserver(() => {
      const button = dialog.querySelector(`[data-smart-tab="${tab}"]`);
      if (button) { observer.disconnect(); clearTimeout(timer); button.click(); }
    });
    const timer = setTimeout(() => observer.disconnect(), 8000);
    observer.observe(dialog, { childList: true });
  }
  let finderTimer = 0;
  let finderRequest = 0;
  async function searchFinder() {
    const q = finder.querySelector('#dscFinderInput').value.trim();
    const status = finder.querySelector('#dscFinderStatus');
    const results = finder.querySelector('#dscFinderResults');
    const id = ++finderRequest;
    if (!q) { status.textContent = ''; results.innerHTML = loanShortcuts(); return; }
    status.textContent = 'กำลังค้นหา…';
    try {
      const found = await api(`/api/assets/search?q=${encodeURIComponent(q)}`);
      if (id !== finderRequest) return;
      status.textContent = found.items.length ? `พบ ${found.items.length}${found.hasMore ? '+' : ''} รายการ` : 'ไม่พบรายการ ลองพิมพ์เลขครุภัณฑ์บางส่วน';
      results.innerHTML = found.items.map(a => `<button type="button" class="dsc-result" data-smart-id="${a.id}" data-dsc-tab="custody"><b>${esc(a.name)}</b><small>${esc(a.code || '')}${a.location ? ` · ${esc(a.location)}` : ''}</small></button>`).join('');
    } catch (error) {
      if (id === finderRequest) status.textContent = error.message || 'ค้นหาไม่สำเร็จ';
    }
  }
  function loanShortcuts() {
    const list = data?.onLoan?.items || [];
    if (!list.length) return '';
    return `<p class="dsc-finder-label">รอคืน</p>` + list.slice(0, 5).map(a => `<button type="button" class="dsc-result is-return" data-smart-id="${a.id}" data-dsc-tab="custody"><b>${esc(a.name)}</b><small>${esc(a.code || '')} · ${esc(dueInfo(a).text)}</small></button>`).join('');
  }
  function openFinder() {
    const input = finder.querySelector('#dscFinderInput');
    input.value = '';
    finder.querySelector('#dscFinderStatus').textContent = data?.borrowEnabled === false ? 'หมายเหตุ: บริการยืม-เบิก-คืนยังปิดอยู่ ผู้ดูแลเปิดได้ที่ ตั้งค่า › QR Smart' : '';
    finder.querySelector('#dscFinderResults').innerHTML = loanShortcuts();
    finder.showModal();
    input.focus();
  }
  finder.querySelector('#dscFinderInput').addEventListener('input', () => { clearTimeout(finderTimer); finderTimer = setTimeout(searchFinder, 250); });
  finder.addEventListener('click', event => {
    if (event.target === finder || event.target.closest('[data-dsc-close]')) finder.close();
    else if (event.target.closest('[data-smart-id]')) finder.close();
  });

  const actions = {
    scan: () => (app.openQrSimulator ? app.openQrSimulator(0) : window.open('/scan.html', '_blank', 'noopener')),
    loan: openFinder,
    repair: () => app.openRepairDialog?.(),
    register: () => app.switchView?.('assets'),
    flags: () => app.switchView?.('qr-smart'),
    retry: load
  };
  document.addEventListener('click', event => {
    const tabTarget = event.target.closest('[data-dsc-tab]');
    if (tabTarget) openAssetTab(tabTarget.dataset.dscTab);
    if (!root.contains(event.target)) return;
    if (event.target.closest('[data-smart-id]')) hidePreview();
    const action = event.target.closest('[data-dsc-action]');
    if (action) actions[action.dataset.dscAction]?.();
    const focusButton = event.target.closest('[data-dsc-focus]');
    if (focusButton && focusButton.dataset.dscFocus !== focus) {
      focus = focusButton.dataset.dscFocus;
      if (focus === 'center') localStorage.setItem(FOCUS_KEY, 'center'); else localStorage.removeItem(FOCUS_KEY);
      renderFocus();
      load();
    }
    const scroll = event.target.closest('[data-dsc-scroll]');
    if (scroll) {
      const track = $('#dscTrack');
      track.scrollBy({ left: Number(scroll.dataset.dscScroll) * track.clientWidth * 0.8, behavior: reduce.matches ? 'auto' : 'smooth' });
    }
  }, true);

  /* ---------- refresh ---------- */
  const isActive = () => view.classList.contains('active');
  let changeTimer = 0;
  document.addEventListener('govasset:view-changed', event => {
    hidePreview();
    if (event.detail?.name === 'dashboard' && (stale || Date.now() - loadedAt > REFRESH_MS)) load();
  });
  document.addEventListener('govasset:data-changed', () => {
    stale = true;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { if (isActive() && !document.querySelector('dialog[open]')) load(); }, 700);
  });
  document.addEventListener('close', event => {
    if (event.target instanceof HTMLDialogElement && stale && isActive()) load();
  }, true);
  reduce.addEventListener?.('change', () => data && renderAll());
  if (isActive()) load();
})();
