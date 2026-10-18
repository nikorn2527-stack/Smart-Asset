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
