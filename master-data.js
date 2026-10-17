(() => {
  const app = window.govAssetApp;
  if (!app) return;
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let categories = [];
  let policies = [];
  const methodLabels = { annual_rate: 'อัตราต่อปีที่กำหนด', useful_life: 'เส้นตรงตามอายุใช้งาน', case_by_case: 'พิจารณาเป็นรายกรณี' };

  async function loadMasterData() {
    try {
      const [categoryRows, policyData] = await Promise.all([
        app.api('/api/catalog/categories?include_inactive=1'),
        app.api('/api/catalog/depreciation?include_inactive=1')
      ]);
      categories = categoryRows;
      policies = policyData.items || [];
      populateCategoryOptions();
      renderCategories();
      renderPolicies();
    } catch (error) {
      app.showError(error);
    }
  }

  function populateCategoryOptions(excludeId = '') {
    const parent = $('#categoryParent');
    if (parent) parent.innerHTML = '<option value="">ไม่มีหมวดแม่</option>' + categories.filter(item => item.isActive && String(item.id) !== String(excludeId)).map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
    const links = $('#policyCategoryIds');
    if (links) links.innerHTML = categories.map(item => `<option value="${item.id}">${esc(item.name)}${item.isActive ? '' : ' · ปิดใช้งาน'}</option>`).join('');
  }

  function renderCategories() {
    const list = $('#archiveCategoryList');
    if (!list) return;
    const query = ($('#codeSearch')?.value || '').trim().toLocaleLowerCase('th-TH');
    const includeInactive = $('#showInactiveCategories')?.checked;
    const visible = categories.filter(item => (includeInactive || item.isActive) && `${item.name} ${item.source || ''} ${item.parentName || ''}`.toLocaleLowerCase('th-TH').includes(query));
    list.innerHTML = visible.length ? visible.map(item => `<article class="master-data-row ${item.isActive ? '' : 'is-inactive'}">
      <span class="category-mark" aria-hidden="true">▤</span>
      <div class="master-data-main"><b>${esc(item.name)}</b><small>${item.parentName ? `หมวดแม่: ${esc(item.parentName)} · ` : ''}ต้นทาง: ${esc(item.source || 'หมวดที่เพิ่มเอง')} · ผูกครุภัณฑ์ ${Number(item.linkedAssets || 0).toLocaleString('th-TH')} · ผูกกฎค่าเสื่อม ${Number(item.linkedPolicies || 0).toLocaleString('th-TH')}</small>${item.notes ? `<small class="category-notes-preview">${esc(item.notes)}</small>` : ''}</div>
      <div class="master-data-actions"><span class="master-state ${item.isActive ? 'active' : ''}">${item.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</span><button type="button" class="button outline mini-action" data-master-action="guide-category" data-id="${item.id}">คู่มือหมวด</button><button type="button" class="button outline mini-action" data-master-action="edit-category" data-id="${item.id}">แก้ไข</button>${item.isActive ? `<button type="button" class="button outline mini-action reject" data-master-action="delete-category" data-id="${item.id}">ลบ</button>` : `<button type="button" class="button outline mini-action" data-master-action="restore-category" data-id="${item.id}">กู้คืน</button>`}</div>
    </article>`).join('') : '<div class="category-empty">ไม่พบหมวดที่ตรงกับตัวกรอง · กด “เพิ่มหมวด” เพื่อสร้างรายการ</div>';
    const tag = $('.archive-category-panel .sheet-count');
    if (tag) tag.textContent = `${visible.length} / ${categories.length} หมวด`;
  }

  function renderPolicies() {
    const body = $('#depreciationRows');
    if (!body) return;
    const query = ($('#depreciationSearch')?.value || '').trim().toLocaleLowerCase('th-TH');
    const includeInactive = $('#showInactivePolicies')?.checked;
    const visible = policies.filter(item => (includeInactive || item.isActive) && `${item.ruleNo} ${item.category} ${item.years ?? ''} ${item.annualRate ?? ''} ${item.scope || ''} ${item.note || ''} ${item.linkedCategoryNames || ''}`.toLocaleLowerCase('th-TH').includes(query));
    body.innerHTML = visible.length ? visible.map(item => `<tr class="${item.isActive ? '' : 'is-inactive'}">
      <td class="depr-no">${esc(item.ruleNo)}<div class="item-meta">${item.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</div></td>
      <td class="depr-category"><b>${esc(item.category)}</b>${item.scope ? `<div class="item-meta">${esc(item.scope)}</div>` : ''}${item.note ? `<div class="item-meta">${esc(item.note)}</div>` : ''}</td>
      <td>${item.years == null ? 'รายกรณี' : `${esc(item.years)} ปี`}</td>
      <td>${item.annualRate == null ? 'รายกรณี' : `${esc(item.annualRate)}%`}</td>
      <td>${esc(methodLabels[item.calculationMethod] || item.calculationMethod || 'อัตราต่อปีที่กำหนด')}</td>
      <td>${esc(item.linkedCategoryNames || '—')}</td>
      <td class="master-data-actions">${item.id ? `<button type="button" class="button outline mini-action" data-master-action="edit-policy" data-id="${item.id}">แก้ไข</button>${item.isActive ? `<button type="button" class="button outline mini-action reject" data-master-action="delete-policy" data-id="${item.id}">ลบ</button>` : `<button type="button" class="button outline mini-action" data-master-action="restore-policy" data-id="${item.id}">กู้คืน</button>`}` : '<span class="item-meta">ตัวอย่างอ่านอย่างเดียว</span>'}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty-cell">ไม่พบรายการ · กด “เพิ่มหลักเกณฑ์” เพื่อสร้างรายการและกำหนดอัตราเอง</td></tr>';
    const count = $('#depreciationCount');
    if (count) count.textContent = `แสดง ${visible.length} จาก ${policies.length} หลักเกณฑ์ · จัดการอัตรา/วิธีคำนวณได้จาก SQLite`;
  }

  const guideDialog=document.createElement('dialog');
  guideDialog.className='asset-dialog master-data-dialog category-guide-dialog';
  guideDialog.setAttribute('aria-labelledby','categoryGuideTitle');
  document.body.append(guideDialog);
  function openCategoryGuide(item) {
    if(!item)return;
    const linked=policies.filter(policy=>(policy.categoryIds||[]).some(id=>String(id)===String(item.id)));
    guideDialog.innerHTML=`<div class="dialog-head"><div><div class="eyebrow">แนวทางเลือกหมวดครุภัณฑ์</div><h2 id="categoryGuideTitle">${esc(item.name)}</h2></div><button class="dialog-close" type="button" data-close-category-guide aria-label="ปิดคู่มือหมวด">×</button></div><p>สถานะ: <b>${item.isActive?'ใช้งาน':'ปิดใช้งาน — ตรวจสอบก่อนกู้คืน'}</b> · หมวดแม่: ${esc(item.parentName||'ไม่มีหมวดแม่')}</p><h3>แนวทางที่บันทึกไว้ในหมวดนี้</h3><p class="category-guide-notes">${esc(item.notes||'ยังไม่มีแนวทางเฉพาะหมวด ให้เจ้าหน้าที่พัสดุเพิ่มชนิดอุปกรณ์ที่รวม/ไม่รวม ตัวอย่าง และเอกสารอ้างอิงก่อนใช้เป็นไกด์')}</p><h3>หลักเกณฑ์ค่าเสื่อมที่เชื่อมอยู่</h3>${linked.length?`<ul>${linked.map(policy=>`<li>${esc(policy.ruleNo||'ไม่ระบุเลขที่')} · ${esc(policy.category)}${policy.isActive===false?' (ปิดใช้งาน)':''}</li>`).join('')}</ul>`:'<p>ยังไม่ได้เชื่อมหลักเกณฑ์ ต้องตรวจหลักเกณฑ์ที่หน่วยงานใช้ก่อนบันทึกอายุและค่าเสื่อม</p>'}<p class="field-hint">ใช้ประกอบการจัดหมวด การตัดสินใจให้ยึดบัญชี/หลักเกณฑ์ที่หน่วยงานรับรอง ไม่ใช้ข้อความตัวอย่างเป็นระเบียบกลาง</p><div class="dialog-actions"><button class="button outline" type="button" data-close-category-guide>ปิด</button><button class="button primary" type="button" id="editCategoryGuide">แก้ไขแนวทางหมวดนี้</button></div>`;
    guideDialog.querySelectorAll('[data-close-category-guide]').forEach(button=>button.onclick=()=>guideDialog.close());
    $('#editCategoryGuide',guideDialog).onclick=()=>{guideDialog.close();openCategory(item);$('#categoryNotes').focus();};
    guideDialog.showModal();
  }

  function openCategory(item = null) {
    const form = $('#categoryForm');
    form.reset();
    populateCategoryOptions(item?.id || '');
    form.elements.id.value = item?.id || '';
    form.elements.name.value = item?.name || '';
    form.elements.notes.value = item?.notes || '';
    form.elements.parentCategoryId.value = item?.parentCategoryId || '';
    form.elements.isActive.value = item?.isActive === false ? 'false' : 'true';
    $('#categoryDialogTitle').textContent = item ? 'แก้ไขหมวดครุภัณฑ์' : 'เพิ่มหมวดครุภัณฑ์';
    $('#categorySourceNote').textContent = item?.source ? `ข้อมูลต้นทาง: ${item.source} · แก้ไขชื่อ/หมายเหตุได้โดยคงที่มาต้นฉบับไว้` : 'หมวดที่เพิ่มเองจะบันทึกใน SQLite และแก้ไข/ปิดใช้งาน/กู้คืนได้';
    $('#categoryDialog').showModal();
  }

  function openPolicy(item = null) {
    const form = $('#depreciationForm');
    form.reset();
    populateCategoryOptions();
    form.elements.id.value = item?.id || '';
    form.elements.ruleNo.value = item?.ruleNo || '';
    form.elements.categoryName.value = item?.category || '';
    form.elements.calculationMethod.value = item ? (item.years == null && item.annualRate == null ? 'case_by_case' : (item.calculationMethod || 'annual_rate')) : 'annual_rate';
    form.elements.years.value = item?.years ?? '';
    form.elements.annualRate.value = item?.annualRate ?? '';
    form.elements.residualValuePercent.value = item?.residualValuePercent ?? 0;
    form.elements.scope.value = item?.scope || '';
    form.elements.note.value = item?.note || '';
    form.elements.isActive.value = item?.isActive === false ? 'false' : 'true';
    [...form.elements.categoryIds.options].forEach(option => { option.selected = (item?.categoryIds || []).map(String).includes(option.value); });
    $('#policyDialogTitle').textContent = item ? 'แก้ไขหลักเกณฑ์ค่าเสื่อม' : 'เพิ่มหลักเกณฑ์ค่าเสื่อม';
    $('#policySourceNote').textContent = item?.sourcePage ? `นำเข้าจากเอกสารต้นทาง หน้า ${item.sourcePage} · ปรับกฎได้โดยเก็บค่าต้นฉบับไว้ในแหล่งข้อมูล` : 'ตั้งอายุ อัตราร้อยละ วิธีคำนวณ และหมวดที่ใช้ได้เอง';
    updateCalculationPreview();
    $('#depreciationDialog').showModal();
  }

  function updateCalculationPreview() {
    const method = $('#depreciationForm')?.elements.calculationMethod.value;
    const cost = Math.max(0, Number($('#policyBaseCost')?.value || 0));
    const years = Number($('#depreciationForm')?.elements.years.value || 0);
    const enteredRate = Number($('#depreciationForm')?.elements.annualRate.value || 0);
    const residual = Number($('#depreciationForm')?.elements.residualValuePercent.value || 0);
    const rateInput = $('#depreciationForm')?.elements.annualRate;
    const yearsInput = $('#depreciationForm')?.elements.years;
    const residualInput = $('#depreciationForm')?.elements.residualValuePercent;
    if (rateInput) rateInput.disabled = method === 'useful_life' || method === 'case_by_case';
    if (yearsInput) yearsInput.disabled = method === 'case_by_case';
    if (residualInput) residualInput.disabled = method === 'case_by_case';
    const output = $('#policyCalculationPreview');
    if (!output) return;
    if (method === 'case_by_case') {
      output.textContent = 'หลักเกณฑ์นี้ไม่มีอัตราอัตโนมัติ ต้องให้ผู้มีอำนาจพิจารณาเป็นรายกรณี';
      return;
    }
    if (method === 'useful_life' && years <= 0) {
      output.textContent = 'ระบุอายุการใช้งานเพื่อคำนวณค่าเสื่อมแบบเส้นตรง';
      return;
    }
    const rateText = $('#depreciationForm')?.elements.annualRate.value;
    const rate = method === 'useful_life' ? (100 - residual) / years : (rateText !== '' ? enteredRate : (years > 0 ? 100 / years : 0));
    const annual = method === 'useful_life' ? cost * (1 - residual / 100) / years : cost * rate / 100;
    const cap = cost * (1 - residual / 100);
    const safeAnnual = Math.min(Math.max(0, annual), cap);
    output.textContent = `ตัวอย่างทุน ${cost.toLocaleString('th-TH')} บาท · อัตราประมาณ ${rate.toLocaleString('th-TH', { maximumFractionDigits: 4 })}%/ปี · ค่าเสื่อมประมาณ ${safeAnnual.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท/ปี (${(safeAnnual / 12).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท/เดือน) · เป็นตัวอย่างก่อนหน่วยงานยืนยันวิธีใช้`;
  }

  async function saveCategory(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.elements.id.value;
    const payload = { name: form.elements.name.value, notes: form.elements.notes.value, parentCategoryId: form.elements.parentCategoryId.value || null, isActive: form.elements.isActive.value === 'true', actor: 'เจ้าหน้าที่พัสดุ' };
    try {
      await app.api(id ? `/api/catalog/categories/${id}` : '/api/catalog/categories', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      $('#categoryDialog').close();
      app.toast(id ? 'บันทึกการแก้ไขหมวดแล้ว' : 'เพิ่มหมวดแล้ว');
      await app.refreshData();
    } catch (error) { app.showError(error); }
  }

  async function savePolicy(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.elements.id.value;
    const payload = {
      ruleNo: form.elements.ruleNo.value,
      categoryName: form.elements.categoryName.value,
      calculationMethod: form.elements.calculationMethod.value,
      years: form.elements.years.value || null,
      annualRate: form.elements.annualRate.value || null,
      residualValuePercent: form.elements.residualValuePercent.value || 0,
      scope: form.elements.scope.value,
      note: form.elements.note.value,
      categoryIds: [...form.elements.categoryIds.selectedOptions].map(option => Number(option.value)),
      isActive: form.elements.isActive.value === 'true',
      actor: 'เจ้าหน้าที่พัสดุ'
    };
    try {
      await app.api(id ? `/api/catalog/depreciation/${id}` : '/api/catalog/depreciation', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      $('#depreciationDialog').close();
      app.toast(id ? 'บันทึกการแก้ไขหลักเกณฑ์แล้ว' : 'เพิ่มหลักเกณฑ์แล้ว');
      await app.refreshData();
    } catch (error) { app.showError(error); }
  }

  async function setActive(type, id, active) {
    const isCategory = type === 'category';
    const path = isCategory ? `/api/catalog/categories/${id}` : `/api/catalog/depreciation/${id}`;
    const item = (isCategory ? categories : policies).find(row => String(row.id) === String(id));
    if (!item) return;
    try {
      if (!active && !window.confirm(`ปิดใช้งาน “${item.name || item.category}” ไว้หรือไม่? ระบบจะเก็บการเชื่อมโยงเดิมและสามารถกู้คืนได้`)) return;
      if (active) {
        const payload = isCategory
          ? { name: item.name, notes: item.notes || '', parentCategoryId: item.parentCategoryId || null, isActive: true, actor: 'เจ้าหน้าที่พัสดุ' }
          : { ruleNo: item.ruleNo, categoryName: item.category, calculationMethod: item.calculationMethod || 'annual_rate', years: item.years, annualRate: item.annualRate, residualValuePercent: item.residualValuePercent || 0, scope: item.scope || '', note: item.note || '', categoryIds: item.categoryIds || [], isActive: true, actor: 'เจ้าหน้าที่พัสดุ' };
        await app.api(path, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await app.api(path, { method: 'DELETE', body: JSON.stringify({ actor: 'เจ้าหน้าที่พัสดุ' }) });
      }
      app.toast(active ? 'กู้คืนรายการแล้ว' : 'ปิดใช้งานแล้ว · ประวัติและการเชื่อมโยงยังอยู่');
      await app.refreshData();
    } catch (error) { app.showError(error); }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-master-action]');
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.masterAction;
    if (action === 'guide-category') openCategoryGuide(categories.find(item => String(item.id) === String(id)));
    if (action === 'edit-category') openCategory(categories.find(item => String(item.id) === String(id)));
    if (action === 'edit-policy') openPolicy(policies.find(item => String(item.id) === String(id)));
    if (action === 'delete-category') setActive('category', id, false);
    if (action === 'restore-category') setActive('category', id, true);
    if (action === 'delete-policy') setActive('policy', id, false);
    if (action === 'restore-policy') setActive('policy', id, true);
  });

  $('#showCategoryGuide')?.addEventListener('click',()=>{
    const guide=$('#categoryGuide');guide.open=!guide.open;
    if(guide.open)guide.scrollIntoView({behavior:'smooth',block:'start'});
  });
  $('#categoryGuide')?.addEventListener('toggle',()=>$('#showCategoryGuide').setAttribute('aria-expanded',String($('#categoryGuide').open)));
  $('#categoryGuideTemplate')?.addEventListener('click',()=>{
    const notes=$('#categoryNotes');
    if(notes.value.trim()){app.toast('มีข้อความเดิมอยู่แล้ว กรุณาแก้ไขหรือคัดลอกเก็บไว้ก่อนใช้แม่แบบ');return;}
    notes.value='ใช้กับอุปกรณ์ประเภท:\nรวมตัวอย่าง:\nไม่รวม:\nหมวดแม่ / ความเกี่ยวข้อง:\nเอกสารอ้างอิงของหน่วยงาน:\nผู้ตรวจสอบ / วันที่ทบทวน:';
    notes.focus();
  });
  $('#addCategoryBtn')?.addEventListener('click', () => openCategory());
  $('#addDepreciationBtn')?.addEventListener('click', () => openPolicy());
  $('#categoryForm')?.addEventListener('submit', saveCategory);
  $('#depreciationForm')?.addEventListener('submit', savePolicy);
  $('#closeCategoryDialog')?.addEventListener('click', () => $('#categoryDialog').close());
  $('#cancelCategoryDialog')?.addEventListener('click', () => $('#categoryDialog').close());
  $('#closePolicyDialog')?.addEventListener('click', () => $('#depreciationDialog').close());
  $('#cancelPolicyDialog')?.addEventListener('click', () => $('#depreciationDialog').close());
  $('#codeSearch')?.addEventListener('input', renderCategories);
  $('#depreciationSearch')?.addEventListener('input', renderPolicies);
  $('#showInactiveCategories')?.addEventListener('change', renderCategories);
  $('#showInactivePolicies')?.addEventListener('change', renderPolicies);
  ['calculationMethod', 'years', 'annualRate', 'residualValuePercent'].forEach(name => {
    const element = $('#depreciationForm')?.elements[name];
    element?.addEventListener('input', updateCalculationPreview);
    element?.addEventListener('change', updateCalculationPreview);
  });
  $('#policyBaseCost')?.addEventListener('input', updateCalculationPreview);
  $('#manualDialog .manual-content')?.insertAdjacentHTML('afterbegin', '<section><h3>จัดการหมวดและหลักเกณฑ์ค่าเสื่อม</h3><p>เพิ่ม/แก้ไขหมวด และหลักเกณฑ์ค่าเสื่อมได้จากหน้าบัญชี FSN/หน้าอายุการใช้งาน; ปรับอัตราร้อยละ วิธีคำนวณ และความเชื่อมโยงหมวดได้ ปุ่มลบเป็นการปิดใช้งานเพื่อคงประวัติ และกู้คืนได้จากตัวกรองรายการที่ปิดใช้งาน การเปลี่ยนนโยบายไม่แก้ snapshot ค่าเสื่อมเดิมย้อนหลัง ตัวเลขคำนวณเป็นตัวอย่าง ต้องตรวจหลักเกณฑ์ของหน่วยงานก่อนใช้จริง</p></section>');
  window.govAssetMasterData = { load: loadMasterData, renderCategories, renderPolicies };
  loadMasterData();
  const fsnDialog=document.createElement('dialog');fsnDialog.className='asset-dialog';fsnDialog.setAttribute('aria-label','เพิ่มรหัส FSN ของหน่วยงาน');
  fsnDialog.innerHTML=`<form id="fsnEntryForm"><div class="dialog-head"><h2>เพิ่มรหัสจำแนก FSN</h2><button type="button" class="dialog-close" id="closeFsnEntry" aria-label="ปิด">×</button></div><p>เพิ่มเมื่อเป็นชนิดหรือคุณลักษณะที่ยังไม่มีในบัญชี ซื้อเพิ่มชนิดเดิมให้ใช้ FSN เดิม แล้วออกเลขประจำชิ้นใหม่ กลุ่ม/ประเภทต้องอ้างอิงคู่มือ และเลขรายละเอียดต้องยึดบัญชีของหน่วยงาน</p><label>ชุดที่ 1 · กลุ่ม/ประเภท 4 หลัก<input name="group" pattern="[0-9]{4}" maxlength="4" required placeholder="7110"></label><label>ชุดที่ 2 · ชนิด 3 หลัก<input name="type" pattern="[0-9]{3}" maxlength="3" required placeholder="002"></label><label>ชุดที่ 3 · รายละเอียด 4 หลัก<input name="description" pattern="[0-9]{4}" maxlength="4" required placeholder="0001"></label><label>ชื่อและคุณลักษณะที่เลขนี้หมายถึง<input name="name" maxlength="300" required placeholder="เช่น ตู้เก็บเอกสาร 4 ลิ้นชัก"></label><label>หลักฐาน / ที่มาของเลข<textarea name="reference" maxlength="1000" required rows="3" placeholder="ชื่อคู่มือและหน้า หรือบัญชีรหัสที่หน่วยงานรับรอง"></textarea></label><p id="fsnEntryError" role="alert"></p><div class="dialog-actions"><button type="submit" class="button primary">บันทึกบัญชีรหัส</button></div></form>`;
  document.body.append(fsnDialog);
  $('#closeFsnEntry').onclick=()=>fsnDialog.close();
  $('#addFsnBtn').onclick=()=>{$('#fsnEntryError').textContent='';fsnDialog.showModal();};
  $('#fsnEntryForm').onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
    try{const fields=Object.fromEntries(new FormData(form));await app.api('/api/catalog/fsn',{method:'POST',body:JSON.stringify({code:[fields.group,fields.type,fields.description].join('-'),name:fields.name,reference:fields.reference,actor:app.getRole()})});fsnDialog.close();form.reset();$('#codeSearch').value=fields.name;await app.loadFsn(0);app.toast('เพิ่มรหัสจำแนก FSN แล้ว สามารถใช้กับครุภัณฑ์หลายชิ้นที่มีคุณลักษณะเดียวกัน');}catch(error){$('#fsnEntryError').textContent=error.message;}finally{button.disabled=false;}
  };
})();
