/* Keep working data first, with a single document scroll and a stable page title. */
(() => {
  const root = document.documentElement;
  const topbar = document.querySelector('.topbar');
  const headings = [];
  document.querySelectorAll('.sidebar .nav-item').forEach(button => {
    const label = button.textContent.slice(button.querySelector('.nav-icon')?.textContent.length || 0).trim();
    if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', label);
    if (!button.hasAttribute('title')) button.title = label;
  });
  document.querySelectorAll('main > .view').forEach(view => {
    const heading = view.querySelector(':scope > .page-heading');
    if (!heading) return;
    const help = document.createElement('section');
    help.id = `${view.id}-help`;
    help.className = 'page-help panel';
    help.hidden = true;
    help.setAttribute('aria-label', 'คำอธิบายและแนวทางใช้งาน');
    const intro = heading.querySelector(':scope > div:first-child');
    intro?.querySelectorAll(':scope > .eyebrow, :scope > p').forEach(node => help.append(node));
    view.querySelectorAll(':scope > .notice').forEach(node => help.append(node));
    const guides = {
      'view-dashboard': '.smart-hero, .workflow-panel, .guide-card',
      'view-numbering': ':scope > .numbering-rule',
      'view-codes': ':scope > .fsn-explainer',
      'view-survey': '.fsn-preview'
    };
    if (guides[view.id]) view.querySelectorAll(guides[view.id]).forEach(node => help.append(node));
    const actions = document.createElement('div');
    actions.className = 'page-heading-controls';
    // Move original controls, preserving their listeners and input values.
    [...heading.children].filter(node => node !== intro).forEach(node => actions.append(node));
    const back = view.querySelector(':scope > .subpage-nav');
    if (back) { [...back.children].forEach(node => actions.prepend(node)); back.remove(); }
    if (help.childElementCount) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'button outline page-help-toggle';
      toggle.textContent = 'คำอธิบาย';
      toggle.setAttribute('aria-controls', help.id);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        help.hidden = !help.hidden;
        toggle.setAttribute('aria-expanded', String(!help.hidden));
        toggle.textContent = help.hidden ? 'คำอธิบาย' : 'ปิดคำอธิบาย';
      });
      actions.append(toggle);
      heading.after(help);
    }
    heading.append(actions);
    headings.push(heading);
  });
  // The daily work queue precedes the secondary totals by assignee.
  const workRows = document.querySelector('#workRows')?.closest('.work-section');
  const workSummary = document.querySelector('#workSummary')?.closest('.work-section');
  if (workRows && workSummary) workSummary.before(workRows);
  const measure = () => {
    const scale = Number.parseFloat(getComputedStyle(root).zoom) || 1;
    const top = topbar ? topbar.getBoundingClientRect().height / scale : 0;
    const active = document.querySelector('.view.active > .page-heading');
    const height = active ? active.getBoundingClientRect().height / scale : 0;
    root.style.setProperty('--page-topbar-height', `${top}px`);
    root.style.setProperty('--page-heading-height', `${height}px`);
  };
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(measure);
    if (topbar) observer.observe(topbar);
    headings.forEach(heading => observer.observe(heading));
  }
  window.addEventListener('resize', measure);
  document.addEventListener('govasset:view-changed', measure);
  measure();
})();

/* Settings hub: register a card once, then keep its existing form and state intact. */
(() => {
  const view = document.querySelector('#view-settings');
  const links = view?.querySelector('.settings-sections');
  if (!links) return;
  const title = view.querySelector('.page-heading h1');
  const sectionTitle = view.querySelector('.settings-section-title');
  sectionTitle?.remove();
  const hub = document.createElement('div');
  hub.className = 'settings-hub';
  hub.innerHTML = '<label class="settings-search-label" for="settingsSearch">ค้นหาการตั้งค่า</label><div class="settings-search-row"><input id="settingsSearch" type="search" placeholder="เช่น โลโก้ หมวด อนุมัติ LINE" autocomplete="off"><button class="button outline" type="button" id="settingsClearSearch">ล้างคำค้น</button></div><p id="settingsSearchStatus" class="field-hint" role="status"></p><div class="settings-groups"></div>';
  links.before(hub);
  const editor = document.createElement('section');
  editor.className = 'settings-editor';
  editor.hidden = true;
  editor.innerHTML = '<button class="button outline settings-back" type="button">← หมวดตั้งค่าทั้งหมด</button><div class="settings-editor-content"></div>';
  hub.after(editor);
  const content = editor.querySelector('.settings-editor-content');
  const groups = hub.querySelector('.settings-groups');
  const definitions = [
    { name: 'ทั่วไป', entries: [
      { id: 'brandingForm', icon: '◈', name: 'หน่วยงาน ชื่อแอป และโลโก้', description: 'ชื่อที่แสดง โลโก้หน่วยงาน และที่อยู่ระบบสำหรับ Smart QR', keywords: 'องค์กร branding โดเมน URL' }
    ] },
    { name: 'ทะเบียนและหลักเกณฑ์', views: ['administration', 'numbering', 'codes', 'depreciation'] },
    { name: 'เอกสารและการพิมพ์', views: ['stickers'] },
    { name: 'การทำงานและการเชื่อมต่อ', entries: [
      { id: 'workflowSettings', icon: '✓', name: 'แจ้งเตือนและเกณฑ์ส่งอนุมัติ', description: 'วงเงินส่งพิจารณางานซ่อม และจำนวนวันเตือนงานล่วงหน้า', keywords: 'PM ตรวจนับ ซ่อม reminder' },
      { id: 'lineSettings', icon: '↗', name: 'เชื่อมต่อ LINE', description: 'ผู้รับตามบทบาท สถานะการเชื่อมต่อ และผลส่งข้อความ', keywords: 'OA Messaging API webhook แจ้งเตือน' }
    ] }
  ];
  const cards = [];
  let origin = null;
  function showHub(focus = false) {
    editor.hidden = true;
    hub.hidden = false;
    title.textContent = 'ตั้งค่าระบบ';
    if (focus) origin?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  editor.querySelector('.settings-back').addEventListener('click', () => showHub(true));
  definitions.forEach(group => {
    const section = document.createElement('section');
    section.className = 'settings-group';
    const heading = document.createElement('h2');
    heading.textContent = group.name;
    const grid = document.createElement('div');
    grid.className = 'settings-card-grid';
    section.append(heading, grid);
    groups.append(section);
    (group.views || []).forEach(name => {
      const card = links.querySelector(`[data-go-view="${name}"]`);
      if (card) { grid.append(card); cards.push(card); }
    });
    (group.entries || []).forEach(entry => {
      const panel = document.getElementById(entry.id);
      if (!panel) return;
      panel.hidden = true;
      content.append(panel);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'settings-link panel';
      card.dataset.settingsKeywords = entry.keywords;
      const icon = document.createElement('span');
      icon.className = 'settings-link-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = entry.icon;
      const name = document.createElement('strong');
      name.textContent = entry.name;
      const description = document.createElement('span');
      description.textContent = entry.description;
      card.append(icon, name, description);
      card.dataset.settingsPanel = entry.id;
      card.addEventListener('click', () => {
        origin = card;
        [...content.children].forEach(node => { node.hidden = node !== panel; });
        // Keep open panels alive when navigating, preserving unfinished edits.
        if (panel.tagName === 'DETAILS') panel.open = true;
        hub.hidden = true;
        editor.hidden = false;
        title.textContent = entry.name;
        window.scrollTo({ top: 0, behavior: 'instant' });
        editor.querySelector('.settings-back').focus({ preventScroll: true });
      });
      grid.append(card);
      cards.push(card);
    });
  });
  links.remove();
  const search = hub.querySelector('#settingsSearch');
  function filter() {
    const query = search.value.trim().toLocaleLowerCase('th');
    let found = 0;
    cards.forEach(card => {
      card.hidden = !`${card.textContent} ${card.dataset.settingsKeywords || ''}`.toLocaleLowerCase('th').includes(query);
      if (!card.hidden) found++;
    });
    groups.querySelectorAll('.settings-group').forEach(group => {
      group.hidden = ![...group.querySelectorAll('.settings-link')].some(card => !card.hidden);
    });
    hub.querySelector('#settingsSearchStatus').textContent = found ? `${found} รายการตั้งค่า` : 'ไม่พบการตั้งค่า ลองเปลี่ยนคำค้นหรือล้างคำค้น';
  }
  search.addEventListener('input', filter);
  hub.querySelector('#settingsClearSearch').addEventListener('click', () => { search.value = ''; filter(); search.focus(); });
  document.addEventListener('govasset:view-changed', event => {
    if (event.detail.name === 'settings') showHub();
  });
  filter();
})();
