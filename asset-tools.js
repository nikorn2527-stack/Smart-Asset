/* Sticker Studio + linked register view. Depends on app.js exposing window.govAssetApp. */
(() => {
  const app = window.govAssetApp;
  if (!app) return;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { assets: [], total: 0, offset: 0, limit: 50, selected: new Map(), templates: [], template: null, selectedElementId: null, settings: {} };
  let searchTimer = null, registerLoadEpoch = 0;
  const elementLabels = {text:'ข้อความ',qr:'QR Code',rect:'กรอบ/แถบสี',image:'ภาพ'};
  const variableMap = {
    AssetNo:'code', Code:'code', AssetSiteCode:'code', FsnCode:'fsnCode', OldCode:'inventoryCode',
    AssetName:'name', Name:'name', Detail:'detail', Category:'group', Group:'group',
    Type:'assetType', AssetType:'assetType', Brand:'brand', Model:'model',
    Serial:'serialNumber', SerialNumber:'serialNumber',
    Location:'location', Room:'room', Floor:'floor', Building:'building',
    Department:'department', DepartmentCode:'departmentCode',
    Custodian:'custodian', CurrentAssignee:'custodian',
    Site:'orgName', OrgName:'orgName', orgName:'orgName',
    Hotline:'hotline', hotline:'hotline',
    PurchasePrice:'purchasePrice', purchasePrice:'purchasePrice',
    AcquisitionDate:'acquiredOn', PurchaseDate:'acquiredOn', acquiredOn:'acquiredOn',
    FiscalYear:'fiscalYear', fiscalYear:'fiscalYear',
    PoNo:'poNo', ContractNo:'poNo', poNo:'poNo',
    GfmisNo:'gfmisNo', gfmisNo:'gfmisNo',
    Vendor:'vendor', vendor:'vendor',
    WarrantyEnd:'warrantyEnd', warrantyEnd:'warrantyEnd',
    UsefulLife:'usefulLife', usefulLife:'usefulLife',
    Status:'status', DeviceStatus:'status', status:'status',
    QrUrl:'code', qrUrl:'code', Ip:'ip', Mac:'mac', companyName:'companyName'
  };
  function toast(message) { app.toast(message); }
  function selectedPreviewAsset() {
    return [...state.selected.values()][0] || state.assets[0] || {
      code:'7110-002-0001-0001', fsnCode:'7110-002-0001', inventoryCode:'สถ.0005-0031',
      name:'ตู้เหล็กเก็บเอกสาร 4 ลิ้นชัก', group:'ครุภัณฑ์สำนักงาน', assetType:'ตู้เก็บเอกสาร',
      model:'รุ่นมาตรฐาน 4 ชั้น', serialNumber:'SN-DEMO-9988', location:'กลุ่มงานพัสดุและสินทรัพย์ อาคาร 1 ชั้น 2',
      department:'ฝ่ายบริหารทั่วไป', custodian:'นายสมศักดิ์ รักงาน', purchasePrice:8500,
      acquiredOn:'2025-10-01', fiscalYear:'2569', poNo:'PO-69-0012', gfmisNo:'GF-2569-8801',
      vendor:'บริษัท พัสดุภัณฑ์ไทย จำกัด', warrantyEnd:'2028-09-30', usefulLife:5, status:'ใช้งานปกติ'
    };
  }
  function formatCleanDate(str) {
    if (!str) return '';
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(str);
    const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (y < 1920) return '';
    const thM = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const thY = y < 2400 ? y + 543 : y;
    return `${d} ${thM[mo-1]} ${thY}`;
  }
  function formatPreviewValue(field, val) {
    if (val === null || val === undefined || val === '') return '';
    if (field === 'purchasePrice') {
      const n = Number(val);
      if (!isNaN(n)) return `${n.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2})} บาท`;
    }
    if (['acquiredOn', 'warrantyEnd'].includes(field)) {
      return formatCleanDate(val);
    }
    return String(val);
  }
  function previewText(text) {
    const asset = selectedPreviewAsset();
    const values = {...asset, ...state.settings};
    return String(text || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => {
      const field = variableMap[key] || key;
      const rawVal = values[field] ?? values[key] ?? '';
      return formatPreviewValue(field, rawVal);
    });
  }
  async function loadStickerAssets(offset = 0) {
    state.offset = Math.max(0, offset);
    const q = $('#stickerSearchInput').value.trim();
    const params = new URLSearchParams({q, limit:String(state.limit), offset:String(state.offset)});
    const result = await app.api(`/api/inventory?${params}`);
    state.assets = result.items; state.total = result.total; state.offset = result.offset;
    renderStickerAssets(); renderSelected(); renderPreview();
  }
  function renderStickerAssets() {
    const root = $('#stickerAssetResults');
    root.innerHTML = state.assets.length ? state.assets.map(asset => `<label class="sticker-result-card"><input type="checkbox" data-sticker-asset="${asset.id}" ${state.selected.has(String(asset.id))?'checked':''}><span><b>${esc(asset.name)}</b><small><code>${esc(asset.code||'ไม่ระบุรหัส')}</code> · ${esc(asset.group||'')}<br>${esc(asset.location||'')}</small></span></label>`).join('') : '<div class="empty-cell">ไม่พบรายการครุภัณฑ์</div>';
    const page = Math.floor(state.offset/state.limit)+1, pages = Math.max(1,Math.ceil(state.total/state.limit));
    $('#stickerResultPage').textContent = `หน้า ${page}/${pages} · ${state.total.toLocaleString('th-TH')} รายการ`;
    $('#stickerPrevPage').disabled = state.offset <= 0;
    $('#stickerNextPage').disabled = state.offset + state.limit >= state.total;
    root.querySelectorAll('[data-sticker-asset]').forEach(input => input.addEventListener('change', () => {
      const id = String(input.dataset.stickerAsset), asset = state.assets.find(item => String(item.id) === id);
      if (input.checked && asset) state.selected.set(id, asset); else state.selected.delete(id);
      renderSelected(); renderStickerAssets(); renderPreview();
    }));
  }
  function renderSelected() {
    $('#stickerSelectionCount').textContent = `${state.selected.size} รายการ`;
    $('#stickerSelectedList').innerHTML = state.selected.size ? [...state.selected.values()].slice(0,12).map(item => `<span class="sticker-selected-chip">${esc(item.code||item.name)}</span>`).join('') + (state.selected.size>12?`<span class="sticker-selected-chip">+${state.selected.size-12} รายการ</span>`:'') : 'ยังไม่ได้เลือก';
    $('#printSelectedStickers').disabled = !state.selected.size;
    $('#stickerPrintSummary').textContent = state.selected.size ? `เลือก ${state.selected.size} รายการ · ${Number(state.template?.canvas?.width||75.2).toLocaleString('th-TH')} × ${Number(state.template?.canvas?.height||36).toLocaleString('th-TH')} มม. · หนึ่งฉลากต่อหน้า` : 'เลือกครุภัณฑ์และขนาดแบบก่อนพิมพ์';
  }
  function renderTemplateSelect() {
    const select = $('#stickerTemplateSelect');
    const id = state.template?.id || '';
    select.innerHTML = state.templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.isActive?' · แบบหลัก':''}</option>`).join('');
    if (state.template && !state.templates.some(t => t.id === id)) select.insertAdjacentHTML('beforeend', `<option value="">แบบใหม่ (ยังไม่บันทึก)</option>`);
    select.value = id;
  }
  async function loadStickerTemplates() {
    const result = await app.api('/api/sticker/templates');
    state.templates = result.templates || [];
    state.template = state.templates.find(t => t.id === result.activeId) || state.templates[0] || null;
    if (state.template) selectTemplate(state.template);
  }
  function cloneTemplate(t) { return JSON.parse(JSON.stringify(t)); }
  function selectTemplate(template) {
    state.template = cloneTemplate(template); state.selectedElementId = state.template.elements?.[0]?.id || null;
    $('#stickerTemplateName').value = state.template.name || '';
    $('#stickerCanvasWidth').value = state.template.canvas?.width || 75.2;
    $('#stickerCanvasHeight').value = state.template.canvas?.height || 36;
    $('#stickerOverflowVisible').checked = state.template.overflow === 'visible';
    renderTemplateSelect(); renderElementList(); renderProperties(); renderPreview(); renderSelected();
  }
  function newTemplate() {
    const base = cloneTemplate(state.template || {canvas:{width:75.2,height:36,unit:'mm'},overflow:'clip',elements:[]});
    const oldWidth=Number(base.canvas.width)||75.2, oldHeight=Number(base.canvas.height)||36;
    const width=75.2, height=36, sx=width/oldWidth, sy=height/oldHeight;
    base.id=''; base.name='เทมเพลตใหม่'; base.isDefault=false; base.isActive=false; base.canvas={width,height,unit:'mm'};
    base.elements=(base.elements||[]).map((element,i)=>({...element,id:`new-${Date.now()}-${i}`,x:Number(element.x||0)*sx,y:Number(element.y||0)*sy,width:Number(element.width||5)*sx,height:Number(element.height||5)*sy}));
    selectTemplate(base); toast('สร้างสำเนาใหม่แล้ว ปรับขนาดและองค์ประกอบได้');
  }
  function updateCanvas() {
    if (!state.template) return;
    state.template.canvas.width=Number($('#stickerCanvasWidth').value)||75.2;
    state.template.canvas.height=Number($('#stickerCanvasHeight').value)||36;
    state.template.canvas.unit='mm'; state.template.name=$('#stickerTemplateName').value || 'เทมเพลตใหม่';
    state.template.overflow=$('#stickerOverflowVisible').checked?'visible':'clip';
    renderPreview(); renderSelected();
  }
  function elementName(element) {
    const text=String(element.content||'').replace(/\s+/g,' ').trim();
    return `${elementLabels[element.type]||element.type}${text?` · ${text.slice(0,22)}`:''}`;
  }
  function renderElementList() {
    const root=$('#stickerElementList');
    if (!state.template || !state.template.elements?.length) {root.innerHTML='<span class="item-meta">ยังไม่มีองค์ประกอบ</span>';return;}
    root.innerHTML=state.template.elements.map(el=>`<button type="button" class="sticker-element-chip ${el.id===state.selectedElementId?'selected':''}" data-element-select="${esc(el.id)}">${esc(elementName(el))}</button>`).join('');
    root.querySelectorAll('[data-element-select]').forEach(button=>button.addEventListener('click',()=>selectElement(button.dataset.elementSelect)));
  }
  function selectElement(id) { state.selectedElementId=id; renderElementList(); renderProperties(); renderPreview(); }
  function addElement(type) {
    if (!state.template) return;
    const count=state.template.elements.length;
    const e={id:`el-${Date.now()}-${count}`,type,x:2+(count%4)*2,y:3+(count%4)*2,width:type==='qr'?18:42,height:type==='qr'?18:type==='rect'?8:6,zIndex:count+1,opacity:1};
    if(type==='text')Object.assign(e,{content:'{{AssetNo}}',fontSize:8,fontWeight:700,color:'#123d56',align:'left',valign:'center'});
    if(type==='qr')Object.assign(e,{content:'{{QrUrl}}'});
    if(type==='rect')Object.assign(e,{background:'#e8f5f3',border:'1px solid #147d78',borderRadius:1});
    if(type==='image')Object.assign(e,{content:'',source:'',width:24,height:18});
    state.template.elements.push(e); state.selectedElementId=e.id; renderElementList(); renderProperties(); renderPreview();
  }
  function renderProperties() {
    const root = $('#stickerElementProperties'), el = state.template?.elements?.find(item => item.id === state.selectedElementId);
    $('#stickerSelectedElementLabel').textContent = el ? elementName(el) : 'เลือกข้อความหรือวัตถุในตัวอย่าง';
    if (!el) {
      root.innerHTML = '<p class="item-meta">คลิกเลือกข้อความหรือวัตถุบนฉลากเพื่อตั้งค่า หรือกดปุ่มเพิ่มด้านบน</p>';
      return;
    }
    const canvasW = Number(state.template?.canvas?.width) || 75.2;
    const canvasH = Number(state.template?.canvas?.height) || 36;

    const numField = (label, prop, val, step = '0.1', unit = 'มม.') => `
      <label class="prop-field-num">
        <span class="prop-label">${label}</span>
        <div class="input-with-unit">
          <input data-element-prop="${prop}" type="number" step="${step}" value="${esc(val ?? 0)}">
          <small>${unit}</small>
        </div>
      </label>`;

    let html = `
      <div class="prop-section">
        <div class="prop-section-title">📐 ตำแหน่งและขนาด (ลากจุดมุมบนฉลากได้)</div>
        <div class="sticker-property-grid">
          ${numField('ระยะจากซ้าย (X)', 'x', el.x, '0.1', 'มม.')}
          ${numField('ระยะจากบน (Y)', 'y', el.y, '0.1', 'มม.')}
          ${numField('ความกว้าง', 'width', el.width, '0.1', 'มม.')}
          ${numField('ความสูง', 'height', el.height, '0.1', 'มม.')}
        </div>
        <div class="prop-quick-align">
          <div class="prop-align-row" style="margin-bottom:6px;">
            <span class="prop-sublabel">จัดแนวนอน:</span>
            <div class="btn-group-mini">
              <button type="button" class="mini-prop-btn" data-align-canvas="left" title="ชิดขอบซ้าย">⫷ ชิดซ้าย</button>
              <button type="button" class="mini-prop-btn" data-align-canvas="center" title="กึ่งกลางแนวนอน">≡ กลาง</button>
              <button type="button" class="mini-prop-btn" data-align-canvas="right" title="ชิดขอบขวา">⫸ ชิดขวา</button>
            </div>
          </div>
          <div class="prop-align-row">
            <span class="prop-sublabel">จัดแนวตั้ง:</span>
            <div class="btn-group-mini">
              <button type="button" class="mini-prop-btn" data-valign-canvas="top" title="ชิดขอบบน">⤊ ชิดบน</button>
              <button type="button" class="mini-prop-btn" data-valign-canvas="middle" title="กึ่งกลางแนวตั้ง">⬍ กึ่งกลาง</button>
              <button type="button" class="mini-prop-btn" data-valign-canvas="bottom" title="ชิดขอบล่าง">⤋ ชิดล่าง</button>
            </div>
          </div>
        </div>
      </div>
    `;

    if (el.type === 'text') {
      const fSize = Number(el.fontSize || 7);
      const fWeight = Number(el.fontWeight || 500);
      const fAlign = el.align || 'left';
      const fColor = /^#[0-9a-f]{6}$/i.test(el.color || '') ? el.color : '#172b3a';

      html += `
        <div class="prop-section">
          <div class="prop-section-title">✏️ ข้อความและตัวแปรข้อมูล</div>
          <label class="wide">
            <span class="prop-label">ข้อความที่แสดง (พิมพ์ข้อความ หรือใส่ตัวแปร <code>{{...}}</code>)</span>
            <textarea id="propContentInput" data-element-prop="content" rows="3">${esc(el.content || '')}</textarea>
          </label>
          <div class="quick-var-chips">
            <span class="prop-sublabel">แทรกตัวแปรด่วน:</span>
            <div class="chips-row">
              <button type="button" class="quick-chip" data-insert-var="{{AssetNo}}">＋ รหัสครุภัณฑ์</button>
              <button type="button" class="quick-chip" data-insert-var="{{AssetName}}">＋ ชื่อครุภัณฑ์</button>
              <button type="button" class="quick-chip" data-insert-var="{{Location}}">＋ สถานที่ตั้ง</button>
              <button type="button" class="quick-chip" data-insert-var="{{Department}}">＋ แผนก</button>
              <button type="button" class="quick-chip" data-insert-var="{{Serial}}">＋ S/N</button>
              <button type="button" class="quick-chip" data-insert-var="{{WarrantyEnd}}">＋ วันสิ้นสุดประกัน</button>
            </div>
          </div>
        </div>

        <div class="prop-section">
          <div class="prop-section-title">🔤 รูปแบบตัวอักษร</div>
          <div class="format-control-row">
            <label class="prop-field-num flex-1">
              <span class="prop-label">ขนาดตัวอักษร (pt)</span>
              <div class="input-with-unit">
                <input data-element-prop="fontSize" type="number" min="2" max="72" step="0.5" value="${fSize}">
                <small>pt</small>
              </div>
            </label>
            <div class="font-presets">
              <button type="button" class="size-preset-btn ${fSize === 6 ? 'active' : ''}" data-set-size="6">6</button>
              <button type="button" class="size-preset-btn ${fSize === 8 ? 'active' : ''}" data-set-size="8">8</button>
              <button type="button" class="size-preset-btn ${fSize === 10 ? 'active' : ''}" data-set-size="10">10</button>
              <button type="button" class="size-preset-btn ${fSize === 12 ? 'active' : ''}" data-set-size="12">12</button>
              <button type="button" class="size-preset-btn ${fSize === 14 ? 'active' : ''}" data-set-size="14">14</button>
            </div>
          </div>

          <div class="format-toggle-group">
            <span class="prop-label">ความหนาตัวอักษร:</span>
            <div class="toggle-buttons">
              <button type="button" class="toggle-btn ${fWeight <= 400 ? 'active' : ''}" data-set-weight="400">ปกติ</button>
              <button type="button" class="toggle-btn ${fWeight === 500 || fWeight === 600 ? 'active' : ''}" data-set-weight="600">ปานกลาง</button>
              <button type="button" class="toggle-btn ${fWeight >= 700 ? 'active' : ''}" data-set-weight="700">ตัวหนา</button>
            </div>
          </div>

          <div class="format-toggle-group">
            <span class="prop-label">การจัดชิดขอบ:</span>
            <div class="toggle-buttons">
              <button type="button" class="toggle-btn ${fAlign === 'left' ? 'active' : ''}" data-set-align="left">⫷ ชิดซ้าย</button>
              <button type="button" class="toggle-btn ${fAlign === 'center' ? 'active' : ''}" data-set-align="center">≡ กึ่งกลาง</button>
              <button type="button" class="toggle-btn ${fAlign === 'right' ? 'active' : ''}" data-set-align="right">⫸ ชิดขวา</button>
            </div>
          </div>

          <div class="format-color-row">
            <label class="color-picker-label">
              <span class="prop-label">สีตัวอักษร</span>
              <div class="color-picker-box">
                <input data-element-prop="color" type="color" value="${fColor}">
                <span class="color-hex">${fColor}</span>
              </div>
            </label>
          </div>
        </div>
      `;
    }

    if (el.type === 'qr') {
      html += `
        <div class="prop-section">
          <div class="prop-section-title">📱 ข้อมูล QR Code</div>
          <label class="wide">
            <span class="prop-label">เนื้อหาสำหรับสร้าง QR (ค่าเริ่มต้นสร้างลิงก์ Smart QR อัตโนมัติ)</span>
            <textarea id="propContentInput" data-element-prop="content" rows="2">${esc(el.content || '{{QrUrl}}')}</textarea>
          </label>
          <p class="field-hint">สแกนเพื่อเปิดประวัติครุภัณฑ์และแจ้งซ่อมออนไลน์ทันที</p>
        </div>
      `;
    }

    if (el.type === 'rect') {
      const bg = /^#[0-9a-f]{6}$/i.test(el.background || '') ? el.background : '#e8f5f3';
      const border = /^#[0-9a-f]{6}$/i.test(el.border || '') ? el.border : '#147d78';
      html += `
        <div class="prop-section">
          <div class="prop-section-title">🎨 แถบสีและเส้นขอบ</div>
          <div class="sticker-property-grid">
            <label class="color-picker-label">
              <span class="prop-label">สีพื้นหลัง</span>
              <div class="color-picker-box">
                <input data-element-prop="background" type="color" value="${bg}">
                <span class="color-hex">${bg}</span>
              </div>
            </label>
            <label class="color-picker-label">
              <span class="prop-label">สีเส้นขอบ</span>
              <div class="color-picker-box">
                <input data-element-prop="borderColor" type="color" value="${border}">
                <span class="color-hex">${border}</span>
              </div>
            </label>
          </div>
          ${numField('ความโค้งมนขอบ (Radius)', 'borderRadius', el.borderRadius || 0, '0.5', 'มม.')}
        </div>
      `;
    }

    if (el.type === 'image') {
      html += `
        <div class="prop-section">
          <div class="prop-section-title">🖼️ ตราสัญลักษณ์ / ภาพ</div>
          <div class="image-file-upload-block" style="margin-bottom: 10px;">
            <span class="prop-label">เลือกรูปภาพจากเครื่อง (PNG, JPG, SVG, WebP)</span>
            <div style="display:flex;gap:6px;align-items:center;margin-top:4px;">
              <input type="file" id="propImageFileInput" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="font-size:12px;flex:1;">
            </div>
            <small style="color:#64748b;font-size:10.5px;display:block;margin-top:3px;">ระบบแปลงไฟล์เป็นข้อมูลภาพพร้อมบันทึกในแบบสติกเกอร์ทันที</small>
          </div>
          <label class="wide">
            <span class="prop-label">หรือระบุ URL รูปภาพ (https:// หรือ data:image/...)</span>
            <input data-element-prop="source" id="propImageSourceInput" type="text" value="${esc(el.source || '')}" placeholder="https://example.com/logo.png หรือเลือกไฟล์ด้านบน">
          </label>
        </div>
      `;
    }

    html += `
      <div class="prop-section">
        <div class="prop-section-title">🔄 การหมุนและลำดับชั้น</div>
        <div class="sticker-property-grid">
          ${numField('หมุนองศา', 'rotation', el.rotation || 0, '1', '°')}
          ${numField('ลำดับชั้น (Z-Index)', 'zIndex', el.zIndex || 0, '1', '')}
        </div>
      </div>
    `;

    root.innerHTML = html;

    root.querySelectorAll('[data-element-prop]').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.elementProp;
        let value = input.value;
        if (input.type === 'number') value = Number(value);
        if (key === 'borderColor') el.border = `1px solid ${value}`;
        else el[key] = value;
        const hex = input.closest('.color-picker-box')?.querySelector('.color-hex');
        if (hex) hex.textContent = value;
        renderPreview();
        renderElementList();
      });
    });

    root.querySelectorAll('[data-align-canvas]').forEach(btn => {
      btn.addEventListener('click', () => {
        const align = btn.dataset.alignCanvas;
        const w = Number(el.width || 5);
        if (align === 'left') el.x = 0;
        else if (align === 'center') el.x = Math.max(0, Math.round(((canvasW - w) / 2) * 10) / 10);
        else if (align === 'right') el.x = Math.max(0, Math.round((canvasW - w) * 10) / 10);
        renderProperties();
        renderPreview();
      });
    });

    root.querySelectorAll('[data-valign-canvas]').forEach(btn => {
      btn.addEventListener('click', () => {
        const valign = btn.dataset.valignCanvas;
        const h = Number(el.height || 5);
        if (valign === 'top') el.y = 0;
        else if (valign === 'middle') el.y = Math.max(0, Math.round(((canvasH - h) / 2) * 10) / 10);
        else if (valign === 'bottom') el.y = Math.max(0, Math.round((canvasH - h) * 10) / 10);
        renderProperties();
        renderPreview();
      });
    });

    const imgFileInput = root.querySelector('#propImageFileInput');
    if (imgFileInput) {
      imgFileInput.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = evt => {
          el.source = evt.target.result;
          const srcInput = root.querySelector('#propImageSourceInput');
          if (srcInput) srcInput.value = el.source;
          renderPreview();
          renderElementList();
        };
        reader.readAsDataURL(file);
      });
    }

    root.querySelectorAll('[data-set-size]').forEach(btn => {
      btn.addEventListener('click', () => {
        el.fontSize = Number(btn.dataset.setSize);
        renderProperties();
        renderPreview();
      });
    });

    root.querySelectorAll('[data-set-weight]').forEach(btn => {
      btn.addEventListener('click', () => {
        el.fontWeight = Number(btn.dataset.setWeight);
        renderProperties();
        renderPreview();
      });
    });

    root.querySelectorAll('[data-set-align]').forEach(btn => {
      btn.addEventListener('click', () => {
        el.align = btn.dataset.setAlign;
        renderProperties();
        renderPreview();
      });
    });

    root.querySelectorAll('[data-insert-var]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.insertVar;
        const txt = root.querySelector('#propContentInput');
        if (txt) {
          const start = txt.selectionStart || txt.value.length;
          const end = txt.selectionEnd || txt.value.length;
          const prev = txt.value;
          txt.value = prev.substring(0, start) + v + prev.substring(end);
          el.content = txt.value;
          renderPreview();
          renderElementList();
        }
      });
    });
  }

  function previewScale(root, w, h) {
    // Border-box width ignores the scrollbar, so showing one cannot shrink the scale and loop.
    const boxW = root.getBoundingClientRect().width - 24;
    const fit = boxW > 40 ? boxW / w : Infinity;
    return Math.min(7.5, 560 / w, 330 / h, fit);
  }
  let previewObserver = null, lastPreviewScale = 0;
  function renderPreview() {
    const root = $('#stickerPreview'); if (!root || !state.template) return;
    const w = Math.max(5, Number(state.template.canvas.width) || 75.2), h = Math.max(5, Number(state.template.canvas.height) || 36);
    const scale = previewScale(root, w, h), pxW = w * scale, pxH = h * scale;
    lastPreviewScale = scale;
    if (!previewObserver && 'ResizeObserver' in window) {
      previewObserver = new ResizeObserver(() => {
        if (!state.template) return;
        const cw = Math.max(5, Number(state.template.canvas.width) || 75.2), ch = Math.max(5, Number(state.template.canvas.height) || 36);
        if (Math.abs(previewScale(root, cw, ch) - lastPreviewScale) > 0.01) renderPreview();
      });
      previewObserver.observe(root);
    }
    $('#stickerCanvasSizeLabel').textContent = `${w.toLocaleString('th-TH')} × ${h.toLocaleString('th-TH')} มม.`;

    const nodes = (state.template.elements || []).slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)).map(el => {
      const isSelected = el.id === state.selectedElementId;
      const style = `left:${Number(el.x || 0) * scale}px;top:${Number(el.y || 0) * scale}px;width:${Number(el.width || 0) * scale}px;height:${Number(el.height || 0) * scale}px;z-index:${Number(el.zIndex || 0)};opacity:${Number(el.opacity ?? 1)};transform:rotate(${Number(el.rotation || 0)}deg);`;
      const selectedClass = isSelected ? 'selected' : '';
      const handles = isSelected ? `
        <div class="sticker-resize-handle handle-se" data-resize-handle="se" title="ลากเพื่อขยาย/ย่อ"></div>
        <div class="sticker-resize-handle handle-e" data-resize-handle="e" title="ลากเพื่อปรับความกว้าง"></div>
        <div class="sticker-resize-handle handle-s" data-resize-handle="s" title="ลากเพื่อปรับความสูง"></div>
      ` : '';

      if (el.type === 'rect') {
        return `<div class="sticker-preview-node ${selectedClass}" data-preview-id="${esc(el.id)}" style="${style}background:${esc(el.background || 'transparent')};border:${esc(el.border || 'none')};border-radius:${Number(el.borderRadius || 0) * scale}px">${handles}</div>`;
      }
      if (el.type === 'qr') {
        return `<div class="sticker-preview-node sticker-preview-qr ${selectedClass}" data-preview-id="${esc(el.id)}" style="${style}"><span>QR Code</span>${handles}</div>`;
      }
      if (el.type === 'image') {
        return `<div class="sticker-preview-node sticker-preview-image ${selectedClass}" data-preview-id="${esc(el.id)}" style="${style}"><img src="${/^https:\/\//.test(el.source || '') ? esc(el.source) : ''}" alt="">${handles}</div>`;
      }
      const size = Number(el.fontSize || 7) * scale * 25.4 / 72, align = el.align || 'left';
      return `<div class="sticker-preview-node sticker-preview-text ${selectedClass}" data-preview-id="${esc(el.id)}" style="${style}font-size:${size}px;font-weight:${Number(el.fontWeight || 500)};color:${esc(el.color || '#172b3a')};text-align:${align};align-items:${el.valign === 'bottom' ? 'flex-end' : el.valign === 'center' ? 'center' : 'flex-start'};justify-content:${align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'}">${esc(previewText(el.content || ''))}${handles}</div>`;
    }).join('');

    root.innerHTML = `<div class="sticker-preview-canvas" style="width:${pxW}px;height:${pxH}px;overflow:${state.template.overflow === 'visible' ? 'visible' : 'hidden'}">${nodes}</div>`;

    root.querySelectorAll('[data-preview-id]').forEach(node => {
      node.addEventListener('pointerdown', event => startDrag(event, node.dataset.previewId, scale));
      node.addEventListener('click', event => { event.stopPropagation(); selectElement(node.dataset.previewId); });
    });

    root.querySelectorAll('[data-resize-handle]').forEach(handle => {
      handle.addEventListener('pointerdown', event => {
        event.stopPropagation();
        const nodeId = handle.closest('[data-preview-id]')?.dataset.previewId;
        if (nodeId) startResize(event, nodeId, handle.dataset.resizeHandle, scale);
      });
    });
  }

  function startResize(event, id, handle, scale) {
    if (event.button !== 0) return;
    const element = state.template.elements.find(e => e.id === id);
    if (!element) return;
    state.selectedElementId = id;
    const sx = event.clientX, sy = event.clientY;
    const ow = Number(element.width || 5), oh = Number(element.height || 5);
    const canvasW = Number(state.template.canvas.width) || 75.2;
    const canvasH = Number(state.template.canvas.height) || 36;

    const move = e => {
      const dx = (e.clientX - sx) / scale;
      const dy = (e.clientY - sy) / scale;
      if (handle === 'se' || handle === 'e') {
        const newW = Math.max(1, Math.round((ow + dx) * 10) / 10);
        element.width = Math.min(newW, Math.round((canvasW - (element.x || 0)) * 10) / 10);
      }
      if (handle === 'se' || handle === 's') {
        const newH = Math.max(1, Math.round((oh + dy) * 10) / 10);
        element.height = Math.min(newH, Math.round((canvasH - (element.y || 0)) * 10) / 10);
      }
      const node = $(`[data-preview-id="${CSS.escape(id)}"]`);
      if (node) {
        node.style.width = `${element.width * scale}px`;
        node.style.height = `${element.height * scale}px`;
      }
      const wInput = $(`[data-element-prop="width"]`);
      const hInput = $(`[data-element-prop="height"]`);
      if (wInput) wInput.value = element.width;
      if (hInput) hInput.value = element.height;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      renderElementList();
      renderProperties();
      renderPreview();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    event.preventDefault();
  }

  function startDrag(event, id, scale) {
    if (event.button !== 0) return;
    if (event.target.closest('.sticker-resize-handle')) return;
    const element = state.template.elements.find(e => e.id === id);
    if (!element) return;
    state.selectedElementId = id;
    const sx = event.clientX, sy = event.clientY, ox = Number(element.x || 0), oy = Number(element.y || 0);
    const move = e => {
      element.x = Math.round((ox + (e.clientX - sx) / scale) * 10) / 10;
      element.y = Math.round((oy + (e.clientY - sy) / scale) * 10) / 10;
      const node = $(`[data-preview-id="${CSS.escape(id)}"]`);
      if (node) {
        node.style.left = `${element.x * scale}px`;
        node.style.top = `${element.y * scale}px`;
      }
      const xInput = $(`[data-element-prop="x"]`);
      const yInput = $(`[data-element-prop="y"]`);
      if (xInput) xInput.value = element.x;
      if (yInput) yInput.value = element.y;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      renderElementList();
      renderProperties();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    event.preventDefault();
  }
  async function saveTemplate(active=false) {
    if(!state.template)return;
    updateCanvas(); state.template.name=$('#stickerTemplateName').value.trim()||'เทมเพลตใหม่';
    try {const saved=await app.api('/api/sticker/templates',{method:'POST',body:JSON.stringify({template:state.template,isActive:active||Boolean(state.template.isActive)})});state.template=saved;const existing=state.templates.findIndex(t=>t.id===saved.id);if(existing>=0)state.templates[existing]=saved;else state.templates.unshift(saved);renderTemplateSelect();selectTemplate(saved);toast(active?'บันทึกและตั้งเป็นแบบหลักแล้ว':'บันทึกเทมเพลตแล้ว');return true;}
    catch(error){app.showError(error);return false;}
  }
  async function printSelected() {
    if(!state.selected.size||!state.template)return;
    try {
      if(!await saveTemplate(false))return;
      const result=await app.api('/api/sticker/bulk-render',{method:'POST',body:JSON.stringify({assetIds:[...state.selected.keys()],templateId:state.template.id||undefined,requestedBy:'ผู้ปฏิบัติงาน (ทดสอบ)'})});
      const iframe=document.createElement('iframe');iframe.style.position='fixed';iframe.style.width='0';iframe.style.height='0';iframe.style.opacity='0';iframe.style.border='0';iframe.setAttribute('aria-hidden','true');document.body.appendChild(iframe);
      const doc=iframe.contentWindow.document;doc.open();doc.write(result.html);doc.close();
      setTimeout(()=>{try{iframe.contentWindow.focus();iframe.contentWindow.print();toast(`เตรียมพิมพ์ ${result.count} ฉลากแล้ว · บันทึกงานพิมพ์ #${result.jobId}`);setTimeout(()=>iframe.remove(),1200);}catch(e){iframe.remove();app.showError(e);}},500);
    } catch(error){app.showError(error);}
  }
  async function loadRegister(id) {
    const request=++registerLoadEpoch;
    document.dispatchEvent(new CustomEvent('govasset:register-loading'));
    $('#registerAssetContext').textContent='กำลังเปิดเอกสารครุภัณฑ์…';
    $('#registerProvenanceSummary').replaceChildren();
    try {
      const data=await app.api(`/api/assets/${id}/register`);
      if(request!==registerLoadEpoch)return;
      const a=data.asset||{},r=data.register||{},acq=(data.acquisitions||[]).at(-1)||{},dep=(data.depreciationSnapshots||[]).at(-1)||{};
      const sourceNames=[...new Set([r.source_filename,acq.source_filename,dep.source_filename,...(data.sourceRows||[]).map(x=>x.source_filename)].filter(Boolean))];
      $('#registerAssetContext').textContent=`${a.code||'ยังไม่มีรหัส'} · ${a.name||'ครุภัณฑ์'}`;
      $('#registerSourceInfo').textContent=sourceNames.length?`แหล่งหลักฐาน: ${sourceNames.join(' · ')}`:'ข้อมูลจากทะเบียนปัจจุบัน · ยังไม่มีเอกสารนำเข้าที่เชื่อมไว้';
      const provenance={asset:{id:a.id,code:a.code,name:a.name,sourceDocumentId:a.sourceDocumentId,sourceRowNo:a.sourceRowNo},sourceRows:data.sourceRows||[],acquisitions:data.acquisitions||[],depreciationSnapshots:data.depreciationSnapshots||[],fsnMatches:data.fsnMatches||[]};
      if($('#registerSourceJson'))$('#registerSourceJson').textContent=JSON.stringify(provenance,null,2);
      let imported=$('#registerImportedFields');
      if(!imported){imported=document.createElement('details');imported.id='registerImportedFields';imported.className='register-imported-fields';const target=$('#registerSourceJson')?.closest('details')||$('#registerProvenanceSummary');if(target)target.after(imported);}
      function formatCleanValue(val){
        if(val===null||val===undefined||val==='')return '-';
        if(typeof val==='object')return JSON.stringify(val);
        const str=String(val).trim();
        if(/^1899-12-(30|31)/.test(str)||/^1900-01-0[01]/.test(str))return '-';
        const m=str.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
        if(m){
          const y=parseInt(m[1],10),mo=parseInt(m[2],10),d=parseInt(m[3],10);
          if(y<1920)return '-';
          const thM=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
          const thY=y<2400?y+543:y;
          return `${d} ${thM[mo-1]} ${thY}`;
        }
        return str.replace(/T00:00:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})?$/,'');
      }
      imported.innerHTML='<summary>ข้อมูลทุกหัวข้อตามไฟล์นำเข้า</summary>'+(data.sourceRows||[]).map(row=>`<section><p class="imported-file-label">เอกสารนำเข้า: ${esc(row.source_filename||'ไฟล์ข้อมูล')}</p><div class="table-wrap"><table><thead><tr><th>หัวข้อในต้นฉบับ</th><th>ค่าที่นำเข้า</th></tr></thead><tbody>${Object.entries(row.rawData||{}).map(([name,value])=>`<tr><th>${esc(name)}</th><td>${esc(formatCleanValue(value))}</td></tr>`).join('')}</tbody></table></div></section>`).join('');

      window.govAssetRegisterData=data;
      document.dispatchEvent(new CustomEvent('govasset:register-loaded',{detail:data}));
    } catch(error){
      if(request!==registerLoadEpoch)return;
      $('#registerAssetContext').textContent='เปิดเอกสารไม่สำเร็จ';
      $('#registerSourceInfo').textContent=error.message;
      app.showError(error);
    }
  }
  app.openRegister=id=>{
    const assetId=Number(id);
    if(!Number.isSafeInteger(assetId)||assetId<1)return app.toast('รหัสครุภัณฑ์ไม่ถูกต้อง');
    app.switchView('register');
    return loadRegister(assetId);
  };
  async function saveStickerSettings() {
    try {state.settings=await app.api('/api/sticker/settings',{method:'POST',body:JSON.stringify({orgName:$('#stickerOrgName').value,hotline:$('#stickerHotline').value})});renderPreview();toast('บันทึกข้อมูลที่แสดงบนฉลากแล้ว');}catch(error){app.showError(error);}
  }
  $('#stickerSearchForm').addEventListener('submit',event=>{event.preventDefault();loadStickerAssets(0).catch(app.showError);});
  $('#stickerSearchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadStickerAssets(0).catch(app.showError),250);});
  $('#stickerPrevPage').addEventListener('click',()=>loadStickerAssets(Math.max(0,state.offset-state.limit)).catch(app.showError));
  $('#stickerNextPage').addEventListener('click',()=>loadStickerAssets(state.offset+state.limit).catch(app.showError));
  $('#stickerSelectVisible').addEventListener('click',()=>{state.assets.forEach(item=>state.selected.set(String(item.id),item));renderStickerAssets();renderSelected();renderPreview();});
  $('#stickerClearSelection').addEventListener('click',()=>{state.selected.clear();renderStickerAssets();renderSelected();renderPreview();});
  $('#stickerTemplateSelect').addEventListener('change',()=>{const template=state.templates.find(t=>t.id===$('#stickerTemplateSelect').value);if(template)selectTemplate(template);});
  $('#stickerNewTemplate').addEventListener('click',newTemplate);
  $('#stickerTemplateName').addEventListener('input',()=>{if(state.template){state.template.name=$('#stickerTemplateName').value;renderTemplateSelect();$('#stickerTemplateSelect').value=state.template.id||'';}});
  ['stickerCanvasWidth','stickerCanvasHeight','stickerOverflowVisible'].forEach(id=>$('#'+id).addEventListener('input',updateCanvas));
  $('#stickerSaveTemplate').addEventListener('click',()=>saveTemplate(false));$('#stickerSetActive').addEventListener('click',()=>saveTemplate(true));
  $('#stickerAddText').addEventListener('click',()=>addElement('text'));$('#stickerAddQr').addEventListener('click',()=>addElement('qr'));$('#stickerAddRect').addEventListener('click',()=>addElement('rect'));$('#stickerAddImage').addEventListener('click',()=>addElement('image'));
  $('#stickerDeleteElement').addEventListener('click',()=>{if(!state.template||!state.selectedElementId)return;state.template.elements=state.template.elements.filter(e=>e.id!==state.selectedElementId);state.selectedElementId=state.template.elements[0]?.id||null;renderElementList();renderProperties();renderPreview();});
  $('#stickerVariableSelect').addEventListener('change',event=>{const value=event.target.value,el=state.template?.elements?.find(item=>item.id===state.selectedElementId);if(value&&el&&['text','qr'].includes(el.type)){el.content=(el.content||'')+value;renderProperties();renderElementList();renderPreview();}event.target.value='';});
  $('#printSelectedStickers').addEventListener('click',printSelected);
  $('#saveStickerSettings').addEventListener('click',saveStickerSettings);
  Promise.all([loadStickerTemplates(),loadStickerAssets(0),app.api('/api/sticker/settings').then(data=>{state.settings=data;$('#stickerOrgName').value=data.orgName||'';$('#stickerHotline').value=data.hotline||'';renderPreview();}).catch(app.showError)]).catch(app.showError);
})();
