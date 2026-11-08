/* Application icon standard.
   One outlined 24px icon family with a fixed colour per meaning, used everywhere in the app.
   Emoji / Unicode symbols that appear at the start of a label are swapped for these icons
   automatically (including content rendered later), and `data-icon="name"` adds an icon to any element. */
(function () {
  // name: [inner SVG markup, colour on light surfaces, colour on dark surfaces]
  var ICONS = {
    dashboard: ['<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', '#0f766e', '#5eead4'],
    register: ['<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>', '#0f766e', '#5eead4'],
    chart: ['<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', '#2563eb', '#93c5fd'],
    swap: ['<path d="M17 4l4 4-4 4M21 8H8M7 20l-4-4 4-4M3 16h13"/>', '#ea580c', '#fdba74'],
    repair: ['<path d="M14.7 6.3a4.5 4.5 0 0 0-5.9 5.9L3.5 17.5a2.1 2.1 0 0 0 3 3l5.3-5.3a4.5 4.5 0 0 0 5.9-5.9l-3 3-2.5-.6-.6-2.5 3-3Z"/>', '#0369a1', '#7dd3fc'],
    refresh: ['<path d="M20 11a8 8 0 0 0-14.5-3.5L3 10M3 4v6h6M4 13a8 8 0 0 0 14.5 3.5L21 14M21 20v-6h-6"/>', '#0284c7', '#7dd3fc'],
    check: ['<path d="M4 12.5l5 5L20 6.5"/>', '#16a34a', '#86efac'],
    checkcircle: ['<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>', '#16a34a', '#86efac'],
    x: ['<path d="M6 6l12 12M18 6L6 18"/>', '#dc2626', '#fca5a5'],
    warn: ['<path d="M12 3.5l9.5 16.5h-19L12 3.5Z"/><path d="M12 10v4.5M12 17.5v.1"/>', '#d97706', '#fcd34d'],
    settings: ['<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>', '#475569', '#cbd5e1'],
    search: ['<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', '#475569', '#cbd5e1'],
    chevron: ['<path d="M6 9l6 6 6-6"/>', '#475569', '#cbd5e1'],
    location: ['<path d="M12 21.5s7-6.2 7-11.5a7 7 0 0 0-14 0c0 5.3 7 11.5 7 11.5Z"/><circle cx="12" cy="10" r="2.5"/>', '#e11d48', '#fda4af'],
    tag: ['<path d="M3 12.2V4.5A1.5 1.5 0 0 1 4.5 3h7.7a1.5 1.5 0 0 1 1 .4l7.4 7.4a1.5 1.5 0 0 1 0 2.1l-7.3 7.3a1.5 1.5 0 0 1-2.1 0L3.4 13.2a1.5 1.5 0 0 1-.4-1Z"/><circle cx="8" cy="8" r="1.2"/>', '#7c3aed', '#c4b5fd'],
    clipboard: ['<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>', '#0f766e', '#5eead4'],
    building: ['<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/>', '#475569', '#cbd5e1'],
    qr: ['<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.1M14 20h.1M17 20h4v-3"/>', '#7c3aed', '#c4b5fd'],
    camera: ['<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>', '#0284c7', '#7dd3fc'],
    image: ['<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M21 16l-5-5-8 8"/>', '#0284c7', '#7dd3fc'],
    palette: ['<path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.4-1-2.5 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3Z"/><path d="M7.5 11v.1M10 7.5v.1M14.5 7.5v.1"/>', '#c026d3', '#f0abfc'],
    type: ['<path d="M5 6V4.5h14V6M12 4.5V20M9 20h6"/>', '#475569', '#cbd5e1'],
    ruler: ['<path d="M3.5 16.5l13-13 4 4-13 13-4-4Z"/><path d="M8 8l2 2M11 5l2 2M5 11l2 2"/>', '#475569', '#cbd5e1'],
    edit: ['<path d="M4 20l4-1L19.5 7.5a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/><path d="M14.5 6.5l3 3"/>', '#d97706', '#fcd34d'],
    trash: ['<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5h10L18 7M9 7V4h6v3"/>', '#dc2626', '#fca5a5'],
    save: ['<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>', '#2563eb', '#93c5fd'],
    star: ['<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>', '#f59e0b', '#fcd34d'],
    print: ['<path d="M7 9V3.5h10V9"/><path d="M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2"/><rect x="7" y="14" width="10" height="6.5" rx="1"/>', '#4f46e5', '#a5b4fc'],
    file: ['<path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5M8.5 13h7M8.5 17h5"/>', '#475569', '#cbd5e1'],
    folder: ['<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6.5Z"/>', '#d97706', '#fcd34d'],
    package: ['<path d="M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9L12 3Z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>', '#b45309', '#fcd34d'],
    money: ['<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>', '#16a34a', '#86efac'],
    pin: ['<path d="M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7"/>', '#e11d48', '#fda4af'],
    users: ['<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14a6.500 6.500 0 0 1 3.500 6"/>', '#0f766e', '#5eead4'],
    user: ['<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', '#0f766e', '#5eead4'],
    key: ['<circle cx="8" cy="15" r="4.500"/><path d="M11.300 11.800L20 3M16 7l3 3M14 9l2 2"/>', '#d97706', '#fcd34d'],
    door: ['<path d="M6 21V4.500A1.500 1.500 0 0 1 7.500 3h9A1.500 1.500 0 0 1 18 4.500V21M3 21h18M14 12v.1"/>', '#475569', '#cbd5e1'],
    message: ['<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>', '#16a34a', '#86efac'],
    shield: ['<path d="M12 3l8 3v6c0 4.500-3.300 8-8 9.500C7.300 20 4 16.500 4 12V6l8-3Z"/><path d="M8.500 12l2.500 2.500 4.500-5"/>', '#0f766e', '#5eead4'],
    bell: ['<path d="M6 17V11a6 6 0 0 1 12 0v6l1.500 2h-15L6 17ZM10 21h4"/>', '#d97706', '#fcd34d'],
    clock: ['<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', '#d97706', '#fcd34d'],
    flash: ['<path d="M13 3L5 13.500h6L10 21l8-10.500h-6L13 3Z"/>', '#f59e0b', '#fcd34d'],
    play: ['<path d="M7 4.500v15l12-7.500-12-7.500Z"/>', '#16a34a', '#86efac'],
    pause: ['<path d="M8 5v14M16 5v14"/>', '#d97706', '#fcd34d'],
    download: ['<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', '#0f766e', '#5eead4'],
    external: ['<path d="M8 16L18 6M10 6h8v8"/>', '#2563eb', '#93c5fd'],
    vertical: ['<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>', '#475569', '#cbd5e1'],
    layers: ['<path d="M12 3l9 5-9 5-9-5 9-5Z"/><path d="M3 13l9 5 9-5"/>', '#475569', '#cbd5e1'],
    box: ['<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12h6"/>', '#0f766e', '#5eead4'],
    book: ['<path d="M5 4.500A1.500 1.500 0 0 1 6.500 3H19v15H6.500A1.500 1.500 0 0 0 5 19.500v-15ZM5 19.500A1.500 1.500 0 0 0 6.500 21H19v-3"/>', '#2563eb', '#93c5fd']
  };

  // symbols (without the emoji variation selector) -> icon name
  var GLYPHS = {
    '▦': 'dashboard', '▤': 'register', '▥': 'chart', '📊': 'chart', '▧': 'register', '◩': 'qr', '📱': 'qr', '◈': 'layers', '⌘': 'settings',
    '⇄': 'swap', '↻': 'refresh', '↺': 'refresh', '🔄': 'refresh', '⚒': 'repair', '🛠': 'repair', '🔧': 'repair',
    '✓': 'check', '✅': 'checkcircle', '✕': 'x', '✖': 'x', '⚠': 'warn', '⚙': 'settings',
    '⌕': 'search', '🔍': 'search', '⌄': 'chevron', '▾': 'chevron', '⌃': 'chevron',
    '📍': 'location', '🏷': 'tag', '📋': 'clipboard', '🏢': 'building', '📷': 'camera', '🖼': 'image', '🎨': 'palette', '🔤': 'type', '📐': 'ruler',
    '✏': 'edit', '🗑': 'trash', '💾': 'save', '⭐': 'star', '★': 'star', '☆': 'star', '🖨': 'print',
    '📄': 'file', '📁': 'folder', '📂': 'folder', '📦': 'package', '💰': 'money', '📌': 'pin', '👥': 'users', '👤': 'user', '👨': 'user',
    '🔑': 'key', '🚪': 'door', '💬': 'message', '🛡': 'shield', '🔔': 'bell', '◷': 'clock', '◴': 'clock', '⏱': 'clock', '⚡': 'flash',
    '▶': 'play', '⏸': 'pause', '↓': 'download', '↗': 'external', '⬍': 'vertical', '▣': 'box', '▱': 'box', '♧': 'box', '📘': 'book'
  };

  var SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|OPTION|OPTGROUP|SELECT|SVG|TITLE|CODE|PRE|NOSCRIPT)$/;
  var keys = Object.keys(GLYPHS).map(function (k) { return k.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'); });
  var LEAD = new RegExp('^(\\s*)(' + keys.join('|') + ')\\uFE0F?[\\s\\u00a0]?');
  var NS = 'http://www.w3.org/2000/svg';

  function icon(name) {
    var def = ICONS[name];
    if (!def) return null;
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'ai ai-' + name);
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.style.setProperty('--ai', def[1]);
    s.style.setProperty('--ai-dark', def[2]);
    s.innerHTML = def[0];
    return s;
  }

  function blocked(node) {
    for (var el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
      if (SKIP.test(el.nodeName) || el.isContentEditable || el.hasAttribute('data-no-icons')) return true;
    }
    return false;
  }

  function enhance(root) {
    if (!root || root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && root.hasAttribute && (root.hasAttribute('data-icon') && !root.querySelector(':scope > .ai'))) addDataIcon(root);
    var nodes = root.querySelectorAll ? root.querySelectorAll('[data-icon]') : [];
    for (var i = 0; i < nodes.length; i++) if (!nodes[i].querySelector(':scope > .ai')) addDataIcon(nodes[i]);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var hits = [], n;
    while ((n = walker.nextNode())) {
      if (LEAD.test(n.nodeValue) && !blocked(n)) hits.push(n);
    }
    hits.forEach(function (t) {
      var m = LEAD.exec(t.nodeValue);
      var svg = m && icon(GLYPHS[m[2]]);
      if (!svg) return;
      t.nodeValue = m[1] + t.nodeValue.slice(m[0].length);
      t.parentNode.insertBefore(svg, t);
    });
  }

  function addDataIcon(el) {
    var svg = icon(el.getAttribute('data-icon'));
    if (svg) el.insertBefore(svg, el.firstChild);
  }

  var pending = new Set(), scheduled = false;
  function flush() {
    scheduled = false;
    var list = Array.from(pending); pending.clear();
    list.forEach(function (el) { if (el.isConnected) enhance(el); });
  }
  function queue(el) {
    pending.add(el);
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  }

  function start() {
    enhance(document.body);
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        if (r.type === 'characterData') { if (r.target.parentNode) queue(r.target.parentNode); return; }
        r.addedNodes.forEach(function (n) {
          if (n.nodeType === 1 && n.nodeName !== 'svg' && !(n.classList && n.classList.contains('ai'))) queue(n);
          else if (n.nodeType === 3 && n.parentNode) queue(n.parentNode);
        });
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.AppIcons = { icon: icon, names: Object.keys(ICONS), enhance: enhance };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
