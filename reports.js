(() => {
  const app = window.govAssetApp;
  const $ = selector => document.querySelector(selector);
  if (!app || !$('#view-reports')) return;
  const FILTERS = {
    from: {label: 'ตั้งแต่วันที่', type: 'date'},
    to: {label: 'ถึงวันที่', type: 'date'},
    status: {label: 'สถานะ', type: 'text', placeholder: 'เช่น กำลังซ่อม'},
    group: {label: 'หมวด', type: 'text'},
    location: {label: 'ที่ตั้งมีคำว่า', type: 'text'},
    departmentUnitId: {label: 'หน่วยงาน', type: 'department'},
    kind: {label: 'รายการ', type: 'select', options: [['', 'ทั้งหมด'], ['relocate', 'ย้ายที่ตั้ง'], ['loan', 'ยืม'], ['issue', 'เบิก'], ['return', 'คืน'], ['assign', 'มอบผู้รับผิดชอบ'], ['intake', 'รับเข้าดูแล']]},
    itemKind: {label: 'ประเภท', type: 'select', options: [['', 'ทั้งหมด'], ['part', 'อะไหล่'], ['material', 'วัสดุ'], ['external_labor', 'ช่างนอก/จ้างภายนอก']]}
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const quantitativeColumns = {
    assets: ['ราคาซื้อ (บาท)'],
    'by-location': ['จำนวนครุภัณฑ์', 'ชำรุด'],
    repairs: ['ประเมิน (บาท)', 'ค่าใช้จ่ายจริง (บาท)'],
    'repair-summary': ['จำนวนใบแจ้ง', 'ประเมินรวม (บาท)', 'ค่าใช้จ่ายจริงรวม (บาท)', 'ใช้ช่างภายนอก (ใบ)'],
    'repair-items': ['จำนวน', 'ราคาต่อหน่วย', 'รวม (บาท)']
  };
  const displayValue = (data, column, value) =>
    quantitativeColumns[data.id]?.includes(column) ? app.formatQuantity(value) : value;
  let catalog = [];
  let accounts = [];
  let selectedAccountId = '';
  let departments = [];
  let departmentAccountId = '';
  let current = null;

  function params() {
    const query = new URLSearchParams();
    if (selectedAccountId) query.set('accountId', selectedAccountId);
    document.querySelectorAll('#reportsFilters [name]').forEach(input => {
      if (input.name === 'accountId') return;
      if (input.value.trim()) query.set(input.name, input.value.trim());
    });
    return query.toString();
  }

  function drawList() {
    $('#reportsList').innerHTML = catalog.map(item => `<button type="button" class="reports-item${current?.id === item.id ? ' active' : ''}" data-report="${esc(item.id)}"><b>${esc(item.title)}</b><small>${esc(item.description)}</small></button>`).join('');
  }

  function drawFilters() {
    const accountFilter = `<label>บัญชีข้อมูล<select name="accountId">${accounts.map(account =>
      `<option value="${esc(account.id)}"${String(account.id) === String(selectedAccountId) ? ' selected' : ''}>${esc(account.label)} · ${Number(account.count).toLocaleString('th-TH')} รายการ</option>`
    ).join('')}</select></label>`;
    const filters = (current?.filters || []).map(key => {
      const f = FILTERS[key];
      const control = f.type === 'select'
        ? `<select name="${key}">${f.options.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>`
        : f.type === 'department'
          ? `<select name="${key}"${departmentAccountId === selectedAccountId ? '' : ' disabled'}><option value="">${departmentAccountId === selectedAccountId ? 'ทุกหน่วยงาน' : 'กำลังโหลด…'}</option>${departmentAccountId === selectedAccountId ? departments.map(unit => `<option value="${esc(unit.id)}">${esc(unit.name)}</option>`).join('') : ''}</select>`
        : `<input name="${key}" type="${f.type}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`;
      return `<label>${esc(f.label)}${control}</label>`;
    }).join('');
    $('#reportsFilters').innerHTML = accountFilter + filters;
  }

  async function loadDepartments() {
    if (current?.id !== 'assets') return;
    const accountId = selectedAccountId;
    const select = $('#reportsFilters [name="departmentUnitId"]');
    if (!select) return;
    select.disabled = true;
    select.innerHTML = '<option value="">กำลังโหลด…</option>';
    try {
      const data = await app.api(`/api/reports/filters/departments?accountId=${encodeURIComponent(accountId)}`);
      if (current?.id !== 'assets' || selectedAccountId !== accountId) return;
      departments = data.items;
      departmentAccountId = accountId;
      select.innerHTML = `<option value="">ทุกหน่วยงาน</option>${departments.map(unit => `<option value="${esc(unit.id)}">${esc(unit.name)}</option>`).join('')}`;
      select.disabled = false;
    } catch (error) {
      if (current?.id !== 'assets' || selectedAccountId !== accountId) return;
      select.innerHTML = '<option value="">โหลดหน่วยงานไม่สำเร็จ</option>';
      app.toast(error.message, 'error');
    }
  }

  async function run() {
    if (!current) return;
    const summary = $('#reportsSummary');
    summary.textContent = 'กำลังสร้างรายงาน…';
    try {
      const data = await app.api(`/api/reports/${current.id}${params() ? '?' + params() : ''}`);
      lastTotal = Number(data.total) || 0;
      const maxLen = data.columns.map((c, i) => data.rows.reduce((m, row) => Math.max(m, String(displayValue(data, c, row[i]) ?? '').length), String(c).length));
      const numeric = data.columns.map(column => Boolean(quantitativeColumns[data.id]?.includes(column)));
      const cls = i => `${maxLen[i] <= 18 ? 'nw' : 'wide'}${numeric[i] ? ' num' : ''}`;
      $('#reportsHead').innerHTML = `<tr>${data.columns.map((c, i) => `<th class="${cls(i)}">${esc(c)}</th>`).join('')}</tr>`;
      $('#reportsBody').innerHTML = data.rows.length
        ? data.rows.map(row => `<tr>${row.map((v, i) => `<td class="${cls(i)}">${esc(displayValue(data, data.columns[i], v))}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${data.columns.length}" class="reports-empty">ไม่พบข้อมูลตามตัวกรองนี้</td></tr>`;
      summary.textContent = `${data.title} · ${data.account.label} · ${data.summary}${data.truncated ? ` · แสดงตัวอย่าง ${data.rows.length} จาก ${Number(data.total).toLocaleString('th-TH')} แถว ไฟล์ที่ดาวน์โหลดมีครบทุกแถว` : ''}`;
    } catch (error) {
      summary.textContent = error.message;
    }
  }

  function download(format) {
    if (!current) return;
    const query = params();
    const link = document.createElement('a');
    link.href = `/api/reports/${current.id}/export.${format}${query ? '?' + query : ''}`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function printHtml(data) {
    const sample = data.rows.length > 500 ? data.rows.filter((_, i) => i % Math.ceil(data.rows.length / 500) === 0) : data.rows;
    const numeric = data.columns.map(column => Boolean(quantitativeColumns[data.id]?.includes(column)));
    const assetWidths = [12, 17, 14, 17, 7, 8, 8, 8, 9];
    const widths = data.id === 'assets' && data.columns.length === assetWidths.length
      ? assetWidths
      : data.columns.map((column, i) => {
        const longest = sample.reduce((max, row) => Math.max(max, String(displayValue(data, column, row[i]) ?? '').length), String(column).length);
        const average = sample.reduce((sum, row) => sum + String(displayValue(data, column, row[i]) ?? '').length, 0) / Math.max(sample.length, 1);
        return Math.min(40, Math.max(5, Math.round(longest * 0.35 + average * 0.65)));
      });
    const total = widths.reduce((sum, value) => sum + value, 0);
    const cols = widths.map(value => `<col style="width:${(value / total * 100).toFixed(2)}%">`).join('');
    const font = data.id === 'assets' ? '8pt' : data.columns.length > 10 ? '7.5pt' : data.columns.length > 7 ? '8.5pt' : '9.5pt';
    const compact = column => /เลขครุภัณฑ์|สถานะ|ปีงบประมาณ|วันที่|ราคา|จำนวน|รหัส/.test(column);
    const classFor = (column, index) => `${numeric[index] ? 'n ' : ''}${compact(column) ? 'keep' : ''}`.trim();
    const head = data.columns.map((column, i) => `<th class="single-line ${classFor(column, i)}" title="${esc(column)}">${esc(column)}</th>`).join('');
    const rows = data.rows.map(row => `<tr>${row.map((value, i) => {
      if (data.columns[i] === 'หน่วยงาน' && data.account?.label && String(value || '').startsWith(data.account.label)) {
        value = String(value).slice(data.account.label.length).trim();
      }
      value = displayValue(data, data.columns[i], value);
      return `<td class="single-line ${classFor(data.columns[i], i)}" title="${esc(value)}">${esc(value)}</td>`;
    }).join('')}</tr>`).join('');
    return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(data.title)}</title>
      <style>
        @font-face{font-family:Sarabun;src:url('/assets/fonts/Sarabun-Regular.ttf')}@font-face{font-family:Sarabun;src:url('/assets/fonts/Sarabun-Bold.ttf');font-weight:700}
        @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Sarabun,sans-serif;color:#142536;font-size:${font}}.keep{white-space:nowrap}
        h1{font-size:18pt;margin:0 0 3mm}p{margin:0 0 6mm}.meta{color:#40566a;font-size:9pt}
        table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}
        th,td{border:1px solid #9aabba;padding:2px 3px;text-align:left;vertical-align:top;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        th{background:#e8eff4;font-weight:700}.n{text-align:right;white-space:nowrap}tfoot{display:table-footer-group}
        @media screen{body{max-width:297mm;margin:12mm auto}button{position:fixed;right:12mm;top:8mm;padding:7px 14px} }
        @media print{button{display:none}}
      </style></head><body><button onclick="window.print()">พิมพ์ / บันทึก PDF</button>
      <h1>${esc(data.title)}</h1><p>${esc(data.account.label)} · ${esc(data.summary)} · ${Number(data.total).toLocaleString('th-TH')} รายการ</p>
      <p class="meta">สร้างเมื่อ ${esc(new Date(data.generatedAt).toLocaleString('th-TH'))} · ข้อความยาวแสดงแบบย่อเพื่อให้อยู่แถวเดียว ดูข้อมูลเต็มได้ใน Excel/CSV${data.truncated ? ` · พิมพ์ ${data.rows.length.toLocaleString('th-TH')} จาก ${Number(data.total).toLocaleString('th-TH')} แถว` : ''}</p>
      <table><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
  }

  const PRINT_MAX = 5000;
  let lastTotal = 0;

  async function printPdf() {
    if (!current) return;
    if (lastTotal > PRINT_MAX && !window.confirm(`รายงานนี้มี ${lastTotal.toLocaleString('th-TH')} แถว การพิมพ์ PDF จะแสดงเฉพาะ ${PRINT_MAX.toLocaleString('th-TH')} แถวแรก (เพื่อไม่ให้เครื่องค้าง)\n\nหากต้องการครบทุกแถว ให้ดาวน์โหลด Excel หรือ CSV หรือกรองข้อมูลให้เหลือน้อยลงก่อน\n\nพิมพ์ ${PRINT_MAX.toLocaleString('th-TH')} แถวแรกต่อหรือไม่?`)) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      app.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาตป๊อปอัปสำหรับระบบนี้', 'error');
      return;
    }
    printWindow.document.write('<!doctype html><title>กำลังเตรียม PDF</title><p>กำลังเตรียมรายงาน…</p>');
    try {
      const query = params();
      const data = await app.api(`/api/reports/${current.id}/print-data${query ? '?' + query : ''}`);
      printWindow.document.open();
      printWindow.document.write(printHtml(data));
      printWindow.document.close();
    } catch (error) {
      printWindow.close();
      app.toast(error.message, 'error');
    }
  }

  function select(id) {
    current = catalog.find(item => item.id === id) || null;
    drawList();
    drawFilters();
    run();
    if (current?.id === 'assets' && departmentAccountId !== selectedAccountId) loadDepartments();
  }

  async function open() {
    try {
      const data = await app.api('/api/reports');
      catalog = data.items;
      accounts = data.accounts;
      if (!accounts.some(account => String(account.id) === String(selectedAccountId))) {
        selectedAccountId = String(data.defaultAccountId || '');
      }
      drawList();
      if (!current && catalog.length) select(catalog[0].id);
      else drawFilters();
    } catch (error) {
      $('#reportsSummary').textContent = error.message;
    }
  }

  $('#reportsFilters').addEventListener('change', event => {
    if (event.target.name === 'accountId') {
      selectedAccountId = event.target.value;
      departments = [];
      departmentAccountId = '';
      loadDepartments();
      run();
    }
  });
  $('#reportsList').addEventListener('click', event => {
    const button = event.target.closest('[data-report]');
    if (button) select(button.dataset.report);
  });
  $('#reportsRun').addEventListener('click', run);
  $('#reportsXlsx').addEventListener('click', () => download('xlsx'));
  $('#reportsCsv').addEventListener('click', () => download('csv'));
  $('#reportsPdf').addEventListener('click', printPdf);
  document.querySelectorAll('[data-view="reports"]').forEach(button => button.addEventListener('click', open));
  document.addEventListener('click', event => {
    if (event.target.closest('[data-go-view="reports"]')) open();
  });
})();
