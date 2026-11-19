/* Standard Document Export Dialog — unified Excel / CSV / A4 Print-PDF export across all operational views. */
(() => {
  const app = window.govAssetApp;
  if (!app) return;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const VIEW_DEFAULT_REPORT = [
    { viewId: 'view-dashboard', reportId: 'assets' },
    { viewId: 'view-assets', reportId: 'assets' },
    { viewId: 'view-supply', reportId: 'supply-documents' },
    { viewId: 'view-work', reportId: 'work-items' },
    { viewId: 'view-repairs', reportId: 'repairs' },
    { viewId: 'view-approvals', reportId: 'approvals' },
  ];

  let catalog = [];
  let accounts = [];
  let defaultAccountId = '';
  let loaded = false;

  const canExport = () => {
    const s = window.govAssetAccess?.session;
    return !s?.required || Boolean(s.isAdmin || s.permissions?.export);
  };

  function ensureDialog() {
    let dialog = $('#standardExportDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'standardExportDialog';
    dialog.className = 'asset-dialog standard-export-dialog';
    dialog.setAttribute('aria-labelledby', 'standardExportTitle');
    dialog.innerHTML = `
      <form id="standardExportForm" novalidate>
        <div class="dialog-head">
          <div>
            <div class="eyebrow">STANDARD DOCUMENT EXPORT</div>
            <h2 id="standardExportTitle">ส่งออกเอกสารมาตรฐาน</h2>
          </div>
          <button type="button" class="dialog-close" data-close-export aria-label="ปิด">×</button>
        </div>
        <div class="dialog-content-scroll">
          <p class="dialog-help" id="standardExportDesc">เลือกรายการเอกสาร บัญชีข้อมูล และรูปแบบไฟล์มาตรฐาน (Excel / CSV / PDF A4 พร้อมช่องลงนาม)</p>
          <div class="form-grid">
            <label>ประเภทเอกสาร
              <select name="reportId" id="stdExportReportId"></select>
            </label>
            <label>บัญชีข้อมูล / หน่วยงาน
              <select name="accountId" id="stdExportAccountId"></select>
            </label>
          </div>
          <div class="form-grid" id="stdExportDateRow">
            <label>ตั้งแต่วันที่ (ไม่บังคับ)
              <input type="date" name="from" id="stdExportFrom">
            </label>
            <label>ถึงวันที่ (ไม่บังคับ)
              <input type="date" name="to" id="stdExportTo">
            </label>
          </div>
          <fieldset class="repair-print-options" style="margin-top:12px">
            <legend>รูปแบบไฟล์เอกสารมาตรฐาน</legend>
            <label class="repair-print-option">
              <input type="radio" name="format" value="xlsx" checked>
              <span><b>Excel (.xlsx)</b><small>ตารางมาตรฐานพร้อมหัวคอลัมน์สีน้ำเงิน จัดความกว้างอัตโนมัติ</small></span>
            </label>
            <label class="repair-print-option">
              <input type="radio" name="format" value="csv">
              <span><b>CSV (.csv UTF-8)</b><small>เปิดใน Excel ภาษาไทยไม่เพี้ยน เหมาะสำหรับนำเข้าข้อมูลต่อ</small></span>
            </label>
            <label class="repair-print-option">
              <input type="radio" name="format" value="pdf">
              <span><b>PDF / พิมพ์เอกสารราชการ (A4)</b><small>หัวเอกสารหน่วยงาน ตารางครบทุกคอลัมน์ พร้อมช่องลงนามท้ายเอกสาร</small></span>
            </label>
          </fieldset>
          <label class="repair-location-check" id="stdExportSignRow" hidden>
            <input type="checkbox" name="includeSignatures" checked>
            <span>แสดงช่องลงนามมาตรฐาน (ผู้จัดทำ / ผู้ตรวจสอบ / ผู้อนุมัติ) ท้ายเอกสาร A4</span>
          </label>
          <p id="stdExportStatus" class="field-hint" role="status"></p>
        </div>
        <div class="dialog-actions">
          <button type="button" class="button outline" data-close-export>ยกเลิก</button>
          <button type="submit" class="button primary" id="stdExportSubmitBtn">ส่งออกเอกสาร</button>
        </div>
      </form>`;
    document.body.append(dialog);

    dialog.addEventListener('click', e => {
      if (e.target === dialog || e.target.closest('[data-close-export]')) dialog.close();
    });

    const form = $('#standardExportForm', dialog);
    form.addEventListener('change', () => {
      const fmt = form.elements.format.value;
      const signRow = $('#stdExportSignRow', dialog);
      if (signRow) signRow.hidden = fmt !== 'pdf';
      const spec = catalog.find(c => c.id === form.elements.reportId.value);
      const dateRow = $('#stdExportDateRow', dialog);
      if (dateRow && spec) {
        const hasDates = (spec.filters || []).includes('from') || (spec.filters || []).includes('to');
        dateRow.hidden = !hasDates;
      }
      const desc = $('#standardExportDesc', dialog);
      if (desc && spec) desc.textContent = spec.description || '';
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!canExport()) {
        app.toast('บัญชีนี้ไม่มีสิทธิ์ส่งออกเอกสาร', 'error');
        return;
      }
      const reportId = form.elements.reportId.value;
      const accountId = form.elements.accountId.value;
      const fmt = form.elements.format.value;
      const includeSignatures = form.elements.includeSignatures.checked;
      const query = new URLSearchParams();
      if (accountId) query.set('accountId', accountId);
      const spec = catalog.find(c => c.id === reportId);
      if ((spec?.filters || []).includes('from') && form.elements.from.value) query.set('from', form.elements.from.value);
      if ((spec?.filters || []).includes('to') && form.elements.to.value) query.set('to', form.elements.to.value);

      const btn = $('#stdExportSubmitBtn', dialog);
      const status = $('#stdExportStatus', dialog);
      btn.disabled = true;
      btn.textContent = 'กำลังสร้างเอกสาร…';
      status.textContent = 'กำลังเตรียมข้อมูลจากระบบ…';
      try {
        if (fmt === 'pdf') {
          const data = await app.api(`/api/reports/${reportId}/print-data${query.toString() ? '?' + query.toString() : ''}`);
          openStandardPrint(data, includeSignatures);
          status.textContent = 'เปิดหน้าต่างพิมพ์ / บันทึก PDF แล้ว';
          dialog.close();
        } else {
          const url = `/api/reports/${reportId}/export.${fmt}${query.toString() ? '?' + query.toString() : ''}`;
          const res = await fetch(url, { credentials: 'same-origin' });
          if (!res.ok) {
            let err = {};
            try { err = await res.json(); } catch {}
            throw new Error(err.error || `ไม่สามารถส่งออกเอกสารได้ (HTTP ${res.status})`);
          }
          const blob = await res.blob();
          const cd = res.headers.get('Content-Disposition') || '';
          const utfMatch = cd.match(/filename\*=UTF-8''([^;]+)/i);
          const asciiMatch = cd.match(/filename="?([^";]+)"?/i);
          const filename = utfMatch ? decodeURIComponent(utfMatch[1]) : (asciiMatch ? asciiMatch[1] : `${reportId}.${fmt}`);
          const objUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = objUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
          app.toast(`ส่งออกเอกสาร ${filename} เรียบร้อยแล้ว`);
          dialog.close();
        }
      } catch (err) {
        status.textContent = err.message || 'ส่งออกเอกสารไม่สำเร็จ';
        app.toast(err.message || 'ส่งออกเอกสารไม่สำเร็จ', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'ส่งออกเอกสาร';
      }
    });
    return dialog;
  }

  function openStandardPrint(data, includeSignatures) {
    const orgName = $('#brandOrg')?.textContent?.trim() || $('#brandingPreviewName')?.textContent?.trim() || 'Smart Asset';
    const appName = $('#brandName')?.textContent?.trim() || 'Smart Asset';
    const cols = data.columns || [];
    const rows = data.rows || [];
    const font = cols.length > 10 ? '7.5pt' : cols.length > 7 ? '8.5pt' : '9.5pt';
    const head = cols.map(c => `<th>${esc(c)}</th>`).join('');
    const body = rows.length
      ? rows.map(row => `<tr>${row.map(v => `<td>${esc(v ?? '')}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${Math.max(cols.length, 1)}" style="text-align:center;padding:12px">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</td></tr>`;
    const sigBlock = includeSignatures ? `
      <div class="sig-grid">
        <div class="sig-box"><div class="sig-line"></div><div>ผู้จัดทำเอกสาร</div><div class="sig-date">วันที่ ………/………/…………</div></div>
        <div class="sig-box"><div class="sig-line"></div><div>ผู้ตรวจสอบ</div><div class="sig-date">วันที่ ………/………/…………</div></div>
        <div class="sig-box"><div class="sig-line"></div><div>ผู้อนุมัติ</div><div class="sig-date">วันที่ ………/………/…………</div></div>
      </div>` : '';
    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(data.title)}</title>
      <style>
        @font-face{font-family:Sarabun;src:url('/assets/fonts/Sarabun-Regular.ttf')}
        @font-face{font-family:Sarabun;src:url('/assets/fonts/Sarabun-Bold.ttf');font-weight:700}
        @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}
        body{font-family:Sarabun,Tahoma,sans-serif;color:#142536;font-size:${font};margin:0}
        .doc-head{display:flex;align-items:center;gap:12px;border-bottom:2px solid #123d56;padding-bottom:8px;margin-bottom:10px}
        .doc-head img{width:42px;height:42px;object-fit:contain}
        .doc-head h1{font-size:15pt;margin:0;color:#123d56}
        .doc-sub{font-size:9.5pt;color:#40566a;margin-top:2px}
        .doc-meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:8.5pt;color:#40566a;margin-bottom:8px}
        table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid}
        th,td{border:1px solid #9aabba;padding:3px 5px;text-align:left;vertical-align:top;word-break:break-word}
        th{background:#123d56;color:#fff;font-weight:700}
        tbody tr:nth-child(even){background:#f7fafc}
        .sig-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:24px;break-inside:avoid}
        .sig-box{text-align:center;font-size:9pt;color:#142536}
        .sig-line{border-bottom:1px dotted #40566a;height:30px;margin:0 16px 6px}
        .sig-date{font-size:8.5pt;color:#5d7080;margin-top:3px}
        .print-bar{position:fixed;right:12mm;top:8mm;display:flex;gap:8px}
        .print-bar button{padding:7px 14px;border-radius:6px;border:1px solid #123d56;background:#123d56;color:#fff;font-family:inherit;font-size:10pt;cursor:pointer}
        @media screen{body{max-width:297mm;margin:12mm auto;padding:0 8mm 16mm}}
        @media print{.print-bar{display:none}}
      </style></head><body>
      <div class="print-bar"><button onclick="window.print()">พิมพ์ / บันทึก PDF</button></div>
      <div class="doc-head">
        <img src="/api/branding/icon.png" alt="">
        <div>
          <h1>${esc(data.title)}</h1>
          <div class="doc-sub">${esc(orgName)} (${esc(appName)}) · บัญชีข้อมูล: ${esc(data.account?.label || '-')}</div>
        </div>
      </div>
      <div class="doc-meta">
        <span>สรุป: ${esc(data.summary || '')} (${Number(data.total || 0).toLocaleString('th-TH')} รายการ)</span>
        <span>วันที่พิมพ์เอกสาร: ${esc(new Date(data.generatedAt || Date.now()).toLocaleString('th-TH'))}</span>
      </div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      ${sigBlock}
      </body></html>`;
    const win = window.open('', '_blank');
    if (!win) {
      app.toast('เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป กรุณาอนุญาตป๊อปอัปเพื่อพิมพ์ PDF', 'error');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  async function loadCatalog() {
    if (loaded && catalog.length) return;
    const data = await app.api('/api/reports');
    catalog = data.items || [];
    accounts = data.accounts || [];
    defaultAccountId = data.defaultAccountId ? String(data.defaultAccountId) : (accounts[0] ? String(accounts[0].id) : '');
    loaded = true;
  }

  async function open(reportId = 'assets') {
    if (!canExport()) {
      app.toast('บัญชีนี้ไม่มีสิทธิ์ส่งออกเอกสาร', 'error');
      return;
    }
    const dialog = ensureDialog();
    const form = $('#standardExportForm', dialog);
    const status = $('#stdExportStatus', dialog);
    status.textContent = '';
    try {
      await loadCatalog();
    } catch (err) {
      app.toast(err.message || 'โหลดรายการเอกสารไม่สำเร็จ', 'error');
      return;
    }
    const reportSel = $('#stdExportReportId', dialog);
    const accountSel = $('#stdExportAccountId', dialog);
    reportSel.innerHTML = catalog.map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');
    if (catalog.some(c => c.id === reportId)) reportSel.value = reportId;
    accountSel.innerHTML = accounts.map(a => `<option value="${esc(a.id)}">${esc(a.label)} (${Number(a.count || 0).toLocaleString('th-TH')} รายการ)</option>`).join('');
    if (defaultAccountId) accountSel.value = defaultAccountId;
    form.dispatchEvent(new Event('change'));
    dialog.showModal();
  }

  function injectButtons() {
    const allowed = canExport();
    for (const { viewId, reportId } of VIEW_DEFAULT_REPORT) {
      const view = $('#' + viewId);
      if (!view) continue;
      let existing = view.querySelector('[data-standard-export-btn]');
      if (!existing) {
        let actions = view.querySelector('.page-heading .page-actions, .hero-actions, .work-hero-actions, .supply-head-actions, .dsc-actions');
        if (!actions) {
          const heading = view.querySelector('.page-heading');
          if (heading) {
            actions = document.createElement('div');
            actions.className = 'page-actions';
            heading.appendChild(actions);
          }
        }
        if (!actions) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'button outline standard-export-btn';
        btn.dataset.standardExportBtn = reportId;
        btn.innerHTML = '📤 ส่งออกเอกสาร';
        btn.addEventListener('click', () => open(reportId));
        actions.appendChild(btn);
        existing = btn;
      }
      existing.hidden = !allowed;
    }
  }

  window.govAssetStandardExport = { open, injectButtons };
  const scheduleInject = () => { injectButtons(); setTimeout(injectButtons, 600); setTimeout(injectButtons, 1600); };
  document.addEventListener('DOMContentLoaded', scheduleInject);
  document.addEventListener('govasset:authenticated', () => { loaded = false; scheduleInject(); });
  document.addEventListener('govasset:view-changed', () => setTimeout(injectButtons, 100));
  if (document.readyState !== 'loading') scheduleInject();
})();
