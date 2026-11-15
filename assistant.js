(function initSmartAssistant() {
  if (document.getElementById('smartAssistantFab')) return;

  const FAB_POS_KEY = 'smartAsset.assistantFabPos.v1';
  let suppressClickUntil = 0;
  let panelDraggedManually = false;

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'assistant-fab';
  fab.id = 'smartAssistantFab';
  fab.setAttribute('aria-label', 'เปิดผู้ช่วย Smart Asset (ลากย้ายตำแหน่งได้)');
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'smartAssistantPanel');
  fab.title = 'ลากเพื่อย้ายตำแหน่ง · คลิกเพื่อเปิดผู้ช่วย Smart Asset';
  fab.innerHTML = '<span class="assistant-fab-grip" aria-hidden="true">⋮⋮</span><span class="assistant-fab-label">✨ ผู้ช่วย Smart Asset</span>';

  const panel = document.createElement('section');
  panel.className = 'assistant-panel';
  panel.id = 'smartAssistantPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'ผู้ช่วยอัจฉริยะ Smart Asset');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="assistant-head" title="ลากเพื่อย้ายหน้าต่างผู้ช่วย">
      <div class="assistant-head-title">
        <strong>✨ ผู้ช่วย Smart Asset</strong>
        <small>ค้นหา สรุป เปิดรายงาน และกรอกข้อมูลล่วงหน้าให้ทันที</small>
      </div>
      <div class="assistant-head-actions">
        <button type="button" class="assistant-icon-btn" id="assistantClearBtn" title="ล้างบทสนทนา">ล้าง</button>
        <button type="button" class="assistant-icon-btn" id="assistantCloseBtn" aria-label="ปิดหน้าต่างผู้ช่วย">✕</button>
      </div>
    </div>
    <div class="assistant-chips" id="assistantQuickChips">
      <button type="button" class="assistant-chip" data-prompt="หาแอร์">หาแอร์</button>
      <button type="button" class="assistant-chip" data-prompt="สรุปยอดครุภัณฑ์ทั้งหมด">สรุปยอดทั้งหมด</button>
      <button type="button" class="assistant-chip" data-prompt="ขอรายงานทะเบียนครุภัณฑ์">ขอรายงาน</button>
      <button type="button" class="assistant-chip" data-prompt="งานซ่อมค้างอยู่กี่งาน">งานซ่อมค้าง</button>
      <button type="button" class="assistant-chip" data-prompt="งานตรวจนับและ PM">ตรวจนับ/PM</button>
      <button type="button" class="assistant-chip" data-prompt="ครุภัณฑ์ที่ยังไม่ระบุห้อง">ยังไม่ระบุห้อง</button>
    </div>
    <div class="assistant-messages" id="assistantMessages" aria-live="polite"></div>
    <form class="assistant-form" id="assistantForm">
      <input id="assistantInput" type="text" maxlength="500" placeholder="เช่น หาแอร์, แจ้งซ่อม แอร์ ไม่เย็น, เปิดรายงานซ่อม..." autocomplete="off">
      <button type="submit" id="assistantSendBtn">ส่ง</button>
    </form>
  `;

  document.body.append(fab, panel);

  const msgs = panel.querySelector('#assistantMessages');
  const form = panel.querySelector('#assistantForm');
  const input = panel.querySelector('#assistantInput');
  const sendBtn = panel.querySelector('#assistantSendBtn');
  const head = panel.querySelector('.assistant-head');

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatReply(text) {
    return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function getScale(el) {
    const r = el.getBoundingClientRect();
    if (el.offsetWidth > 0 && r.width > 0) {
      const ratio = r.width / el.offsetWidth;
      if (Number.isFinite(ratio) && ratio > 0.25 && ratio < 4) return ratio;
    }
    const z = parseFloat(getComputedStyle(document.documentElement).zoom || '1');
    return Number.isFinite(z) && z > 0 ? z : 1;
  }

  function clampPosition(el, left, top, margin = 10) {
    const scale = getScale(el);
    const vw = window.innerWidth / scale;
    const vh = window.innerHeight / scale;
    const w = el.offsetWidth || 120;
    const h = el.offsetHeight || 40;
    const maxL = Math.max(margin, vw - w - margin);
    const maxT = Math.max(margin, vh - h - margin);
    return {
      left: Math.round(Math.max(margin, Math.min(maxL, left))),
      top: Math.round(Math.max(margin, Math.min(maxT, top))),
    };
  }

  function applyFixedPos(el, left, top, margin = 10) {
    const clamped = clampPosition(el, left, top, margin);
    el.style.left = `${clamped.left}px`;
    el.style.top = `${clamped.top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    return clamped;
  }

  function saveFabPos(pos) {
    try {
      localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos));
    } catch {}
  }

  function restoreFabPos() {
    if (fab.hidden) return;
    try {
      const raw = localStorage.getItem(FAB_POS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
          applyFixedPos(fab, saved.left, saved.top);
          return;
        }
      }
    } catch {}
    if (fab.style.left && fab.style.top) {
      applyFixedPos(fab, parseFloat(fab.style.left), parseFloat(fab.style.top));
    }
  }

  function setPanelMaxHeight(px) {
    const next = `${Math.max(220, Math.floor(px))}px`;
    if (panel.style.getPropertyValue('--assistant-max-h') !== next) {
      panel.style.setProperty('--assistant-max-h', next);
    }
  }

  function positionPanelRelativeToFab() {
    if (panel.hidden || fab.hidden) return;
    const scale = getScale(panel);
    const vw = window.innerWidth / scale;
    const vh = window.innerHeight / scale;
    const margin = 10;
    const gap = 12;

    setPanelMaxHeight(Math.min(520, vh - margin * 2));

    const fr = fab.getBoundingClientRect();
    const fx = fr.left / scale;
    const fy = fr.top / scale;
    const fw = fab.offsetWidth || 160;
    const fh = fab.offsetHeight || 42;
    const pw = panel.offsetWidth || 410;
    let ph = panel.offsetHeight || 520;

    const spaceAbove = fy - gap - margin;
    const spaceBelow = vh - (fy + fh + gap) - margin;
    const spaceLeft = fx - gap - margin;
    const spaceRight = vw - (fx + fw + gap) - margin;

    let left;
    let top;

    if (spaceAbove >= ph || spaceBelow >= ph) {
      const preferLeft = (fx + fw / 2) > (vw / 2) ? (fx + fw - pw) : fx;
      left = Math.max(margin, Math.min(Math.max(margin, vw - pw - margin), preferLeft));
      top = spaceAbove >= ph ? (fy - ph - gap) : (fy + fh + gap);
    } else if (spaceLeft >= pw || spaceRight >= pw) {
      const useLeft = spaceLeft >= pw && (fx + fw / 2 > vw / 2 || spaceRight < pw);
      left = useLeft ? (fx - pw - gap) : (fx + fw + gap);
      top = Math.max(margin, Math.min(Math.max(margin, vh - ph - margin), fy + fh / 2 - ph / 2));
    } else {
      setPanelMaxHeight(Math.max(220, Math.floor(Math.max(spaceAbove, spaceBelow))));
      ph = panel.offsetHeight || ph;
      const preferLeft = (fx + fw / 2) > (vw / 2) ? (fx + fw - pw) : fx;
      left = Math.max(margin, Math.min(Math.max(margin, vw - pw - margin), preferLeft));
      top = spaceAbove >= spaceBelow
        ? Math.max(margin, fy - ph - gap)
        : Math.min(Math.max(margin, vh - ph - margin), fy + fh + gap);
    }

    applyFixedPos(panel, left, top, margin);
  }

  let isFittingPanel = false;
  function fitPanelToViewport() {
    if (panel.hidden || isFittingPanel) return;
    isFittingPanel = true;
    try {
      const scale = getScale(panel);
      const vh = window.innerHeight / scale;
      const margin = 10;

      if (panelDraggedManually) {
        setPanelMaxHeight(Math.min(520, vh - margin * 2));
        const rect = panel.getBoundingClientRect();
        const curLeft = panel.style.left && panel.style.left !== 'auto'
          ? parseFloat(panel.style.left)
          : (rect.left / scale);
        const curTop = panel.style.top && panel.style.top !== 'auto'
          ? parseFloat(panel.style.top)
          : (rect.top / scale);
        applyFixedPos(panel, curLeft, curTop, margin);
      } else if (!fab.hidden) {
        positionPanelRelativeToFab();
      } else {
        setPanelMaxHeight(Math.min(520, vh - margin * 2));
        const rect = panel.getBoundingClientRect();
        applyFixedPos(panel, rect.left / scale, rect.top / scale, margin);
      }
    } finally {
      isFittingPanel = false;
    }
  }

  function makeDraggable({ handle, target, ignoreSelector, onMove, onDragEnd }) {
    if (!handle || !target) return;
    let active = null;

    handle.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (ignoreSelector && e.target.closest(ignoreSelector)) return;
      const scale = getScale(target);
      const rect = target.getBoundingClientRect();
      active = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: rect.left / scale,
        startTop: rect.top / scale,
        scale,
        moved: false,
      };
    });

    window.addEventListener('pointermove', e => {
      if (!active) return;
      if (active.pointerId != null && e.pointerId !== active.pointerId) return;
      const rawDx = e.clientX - active.startX;
      const rawDy = e.clientY - active.startY;
      if (!active.moved && Math.hypot(rawDx, rawDy) < 5) return;
      if (!active.moved) {
        active.moved = true;
        target.classList.add('is-dragging');
        try { handle.setPointerCapture?.(e.pointerId); } catch {}
      }
      e.preventDefault();
      const pos = applyFixedPos(
        target,
        active.startLeft + rawDx / active.scale,
        active.startTop + rawDy / active.scale,
      );
      onMove?.(pos);
    });

    function finish(e) {
      if (!active) return;
      if (active.pointerId != null && e.pointerId !== active.pointerId) return;
      const wasMoved = active.moved;
      const pid = active.pointerId;
      active = null;
      target.classList.remove('is-dragging');
      try { handle.releasePointerCapture?.(pid); } catch {}
      if (wasMoved) {
        suppressClickUntil = Date.now() + 260;
        const rect = target.getBoundingClientRect();
        const scale = getScale(target);
        onDragEnd?.({ left: Math.round(rect.left / scale), top: Math.round(rect.top / scale) });
      }
    }

    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  makeDraggable({
    handle: fab,
    target: fab,
    onMove: () => {
      if (!panel.hidden && !panelDraggedManually) positionPanelRelativeToFab();
    },
    onDragEnd: pos => {
      saveFabPos(pos);
      if (!panel.hidden && !panelDraggedManually) positionPanelRelativeToFab();
    },
  });

  makeDraggable({
    handle: head,
    target: panel,
    ignoreSelector: 'button, a, input, select, textarea',
    onDragEnd: () => {
      panelDraggedManually = true;
    },
  });

  function canOpenView(view) {
    const sess = window.govAssetAccess?.session;
    if (!sess?.required) return true;
    if (view === 'settings' || view === 'qr-smart') return Boolean(sess.isAdmin || sess.permissions?.manage);
    if (view === 'approvals') return Boolean(sess.isAdmin || sess.permissions?.approve);
    return true;
  }

  function getActiveScope() {
    try {
      const f = window.govAssetAccountFilters?.();
      if (f && (f.account || f.branch)) {
        return { accountId: f.account || '', branchId: f.branch || '' };
      }
    } catch {}
    return {
      accountId: document.getElementById('inventoryAccount')?.value || '',
      branchId: document.getElementById('inventoryBranch')?.value || '',
    };
  }

  async function applyUiAction(action) {
    if (!action) return;
    const app = window.govAssetApp;
    if (!app) return;

    if (action.view && !canOpenView(action.view)) {
      app.toast?.('บัญชีของคุณไม่มีสิทธิ์เปิดหน้านี้');
      return;
    }

    if (action.type === 'switch_view' && action.view) {
      app.switchView?.(action.view);
      if (action.settingsTab) setTimeout(() => window.switchSettingsTab?.(action.settingsTab), 30);
      if (action.approvalTab) setTimeout(() => window.switchApprovalTab?.(action.approvalTab), 30);
      return;
    }

    if (action.type === 'filter_assets') {
      if (typeof app.applyInventoryFilters === 'function') {
        await app.applyInventoryFilters(action);
      } else {
        app.switchView?.('assets');
        const qInput = document.getElementById('assetSearch');
        if (qInput) qInput.value = action.q || '';
        const statusSel = document.getElementById('statusFilter');
        if (statusSel && action.status) statusSel.value = action.status;
        app.loadInventory?.(0);
      }
      return;
    }

    if (action.type === 'open_report') {
      if (window.govAssetReports?.openReport) {
        await window.govAssetReports.openReport(action);
      } else {
        app.switchView?.('reports');
      }
      return;
    }

    if (action.type === 'filter_repairs') {
      if (typeof app.applyRepairFilters === 'function') {
        app.applyRepairFilters(action);
      } else {
        app.switchView?.('repairs');
      }
      return;
    }

    if (action.type === 'prefill_repair') {
      if (typeof app.prefillRepairDialog === 'function') {
        app.prefillRepairDialog(action);
      } else {
        app.switchView?.('repairs');
      }
      return;
    }

    if (action.type === 'prefill_asset') {
      if (typeof app.prefillAssetDialog === 'function') {
        app.prefillAssetDialog(action);
      } else {
        app.switchView?.('assets');
      }
      return;
    }

    if (action.type === 'open_work') {
      if (window.govAssetWork?.openView) {
        await window.govAssetWork.openView(action);
      } else {
        app.switchView?.('work');
      }
      return;
    }

    if (action.type === 'open_supply') {
      if (window.govAssetSupply?.openView) {
        await window.govAssetSupply.openView(action);
      } else {
        app.switchView?.('supply');
      }
    }
  }

  async function downloadReport(url, btn) {
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'กำลังเตรียมไฟล์...';
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('ไม่สามารถดาวน์โหลดรายงานได้');
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') || '';
      const utf = /filename\*=UTF-8''([^;]+)/i.exec(disp);
      const ascii = /filename="([^"]+)"/i.exec(disp);
      const filename = utf ? decodeURIComponent(utf[1]) : (ascii ? ascii[1] : 'smart-asset-report');
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    } catch (err) {
      addBotMessage({ reply: `ไม่สามารถดาวน์โหลดไฟล์ได้: ${err.message}` });
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  function addUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'assistant-msg user';
    el.textContent = text;
    msgs.append(el);
    if (!panel.hidden) fitPanelToViewport();
    msgs.scrollTop = msgs.scrollHeight;
  }

  function addBotMessage(data) {
    const el = document.createElement('div');
    el.className = 'assistant-msg bot';
    const statsHtml = Array.isArray(data.stats) && data.stats.length
      ? `<div class="assistant-stats">${data.stats.map(s => `<div class="assistant-stat"><span>${esc(s.label)}</span><strong>${esc(s.value)}</strong></div>`).join('')}</div>`
      : '';
    const itemsHtml = Array.isArray(data.items) && data.items.length
      ? `<div class="assistant-items">${data.items.map(it => `<button type="button" class="assistant-item" data-kind="${esc(it.kind)}" data-id="${esc(it.id)}" data-code="${esc(it.code)}"><b>${esc(it.code)} · ${esc(it.title)}</b><small>${esc(it.meta)}</small></button>`).join('')}</div>`
      : '';
    const dlHtml = Array.isArray(data.downloads) && data.downloads.length
      ? `<div class="assistant-items">${data.downloads.map(d => `<button type="button" class="assistant-action-btn assistant-download-btn" data-download-url="${esc(d.url)}">${esc(d.label)}</button>`).join('')}</div>`
      : '';
    const actHtml = data.uiAction
      ? `<button type="button" class="assistant-action-btn" data-ui-action="1">${esc(data.uiAction.label || 'เปิดดูข้อมูล')}</button>`
      : '';
    el.innerHTML = `<div>${formatReply(data.reply || '')}</div>${statsHtml}${itemsHtml}${dlHtml}${actHtml}`;

    el.querySelectorAll('.assistant-item').forEach(btn => {
      btn.onclick = () => {
        const kind = btn.dataset.kind;
        const id = Number(btn.dataset.id);
        const code = btn.dataset.code || '';
        const app = window.govAssetApp;
        if (kind === 'ticket') {
          app?.switchView?.('repairs');
          if (Number.isFinite(id)) app?.openTicket?.(id);
        } else if (kind === 'supply') {
          if (Number.isFinite(id)) window.govAssetSupply?.open?.(id);
        } else if (kind === 'work') {
          if (Number.isFinite(id)) (window.govAssetWork?.openWork || app?.openWork)?.(id);
        } else {
          if (Number.isFinite(id) && typeof app?.openAsset === 'function') {
            app.openAsset(id);
          } else if (code) {
            app?.applyInventoryFilters?.({ q: code });
          } else {
            app?.switchView?.('assets');
          }
        }
      };
    });

    el.querySelectorAll('.assistant-download-btn').forEach(btn => {
      btn.onclick = () => downloadReport(btn.dataset.downloadUrl, btn);
    });

    const actBtn = el.querySelector('[data-ui-action]');
    if (actBtn && data.uiAction) {
      actBtn.onclick = () => applyUiAction(data.uiAction);
    }

    msgs.append(el);
    if (!panel.hidden) fitPanelToViewport();
    msgs.scrollTop = msgs.scrollHeight;
  }

  function addWelcome() {
    if (msgs.children.length) return;
    addBotMessage({
      reply:
        'สวัสดีครับ ผมคือผู้ช่วย Smart Asset ประจำหน่วยงาน\n' +
        'พิมพ์คำถามหรือคำสั่งได้เลย เช่น:\n' +
        '• **หาแอร์**, **หาคอมพิวเตอร์ ชั้น 2**\n' +
        '• **เปิดรายงานงานซ่อม กำลังซ่อม**\n' +
        '• **แจ้งซ่อม แอร์ อาการ ไม่เย็น ด่วน**\n' +
        '• **เพิ่มครุภัณฑ์** หรือ **เปิดหน้าตั้งค่า ผู้ใช้งาน**',
    });
  }

  async function ask(prompt) {
    const clean = (prompt || '').trim();
    if (!clean) return;
    addUserMessage(clean);
    input.value = '';

    const loadingEl = document.createElement('div');
    loadingEl.className = 'assistant-msg bot is-loading';
    loadingEl.textContent = 'กำลังค้นหาและเตรียมข้อมูล...';
    msgs.append(loadingEl);
    if (!panel.hidden) fitPanelToViewport();
    msgs.scrollTop = msgs.scrollHeight;

    sendBtn.disabled = true;
    input.disabled = true;
    panel.querySelectorAll('.assistant-chip').forEach(c => { c.disabled = true; });

    try {
      const headers = { 'Content-Type': 'application/json' };
      const csrf = window.govAssetAccess?.session?.csrf;
      if (csrf) headers['X-CSRF-Token'] = csrf;
      const res = await fetch('/api/assistant/query', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ prompt: clean, ...getActiveScope() }),
      });
      const data = await res.json();
      loadingEl.remove();
      if (!res.ok) {
        addBotMessage({ reply: data?.error || 'เกิดข้อผิดพลาดในการประมวลผลคำสั่ง' });
        return;
      }
      addBotMessage(data);
      if (data.uiAction?.autoApply) {
        await applyUiAction(data.uiAction);
      }
    } catch {
      loadingEl.remove();
      addBotMessage({ reply: 'ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้งครับ' });
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      panel.querySelectorAll('.assistant-chip').forEach(c => { c.disabled = false; });
      if (!panel.hidden) input.focus();
    }
  }

  function toggle(force) {
    const show = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !show;
    fab.setAttribute('aria-expanded', String(show));
    if (show) {
      panelDraggedManually = false;
      addWelcome();
      requestAnimationFrame(() => {
        fitPanelToViewport();
        input.focus();
      });
    }
  }

  fab.onclick = e => {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      return;
    }
    toggle();
  };

  panel.querySelector('#assistantCloseBtn').onclick = () => toggle(false);
  panel.querySelector('#assistantClearBtn').onclick = () => {
    msgs.replaceChildren();
    addWelcome();
  };
  panel.querySelector('#assistantQuickChips').onclick = e => {
    const chip = e.target.closest('.assistant-chip');
    if (chip && !chip.disabled) ask(chip.dataset.prompt);
  };
  form.onsubmit = e => {
    e.preventDefault();
    ask(input.value);
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) toggle(false);
  });

  function syncVisibility() {
    const sess = window.govAssetAccess?.session;
    const hasAccessMod = Boolean(window.govAssetAccess);
    const hide = hasAccessMod ? (!sess || (sess.required && (!sess.authenticated || sess.needsAccess))) : false;
    fab.hidden = hide;
    if (hide) {
      toggle(false);
    } else {
      requestAnimationFrame(() => {
        restoreFabPos();
        if (!panel.hidden) fitPanelToViewport();
      });
    }
  }

  window.addEventListener('resize', () => {
    if (!fab.hidden && fab.style.left && fab.style.top) {
      const clamped = applyFixedPos(fab, parseFloat(fab.style.left), parseFloat(fab.style.top));
      saveFabPos(clamped);
    }
    if (!panel.hidden) fitPanelToViewport();
  });

  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => {
      if (panel.hidden || isFittingPanel || panel.classList.contains('is-dragging')) return;
      requestAnimationFrame(() => {
        if (!panel.hidden && !panel.classList.contains('is-dragging')) {
          fitPanelToViewport();
        }
      });
    });
    resizeObserver.observe(panel);
    resizeObserver.observe(msgs);
  }

  panel.addEventListener('toggle', () => {
    if (!panel.hidden) fitPanelToViewport();
  }, true);

  document.addEventListener('govasset:authenticated', syncVisibility);
  document.addEventListener('govasset:session-expired', () => {
    toggle(false);
    fab.hidden = true;
  });
  syncVisibility();
  setTimeout(syncVisibility, 400);
})();
