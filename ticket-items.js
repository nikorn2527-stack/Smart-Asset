(() => {
  const app = window.govAssetApp;
  if (!app) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const money = value => Number(value || 0).toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const CLOSED = ['ปิดงาน', 'ยกเลิก', 'ไม่อนุมัติ'];
  const STATUS = {
    requested: 'รอดำเนินการ', approved: 'อนุมัติแล้ว', received: 'รับของ/ดำเนินการแล้ว', cancelled: 'ยกเลิก'
  };
  const STEP = {
    requested: [['approve', 'อนุมัติ'], ['cancel', 'ยกเลิก']],
    approved: [['receive', 'บันทึกรับของ/ดำเนินการแล้ว'], ['cancel', 'ยกเลิก']],
    received: [],
    cancelled: [['reopen', 'ขอใหม่']]
  };

  function rowMarkup(item, open) {
    const buttons = open ? (STEP[item.status] || []).map(([action, label]) => `<button type="button" class="button outline small" data-item-action="${action}" data-item-id="${item.id}">${esc(label)}</button>`).join('') : '';
    const vendor = item.vendor ? `<small>${esc(item.vendor)}${item.vendorContact ? ' · ' + esc(item.vendorContact) : ''}</small>` : '';
    return `<tr class="${item.status === 'cancelled' ? 'is-cancelled' : ''}">
      <td><b>${esc(item.name)}</b><small>${esc(item.kindLabel)} · ${esc(item.sourceLabel)}</small>${vendor}</td>
      <td class="num">${esc(app.formatQuantity(item.qty))} ${esc(item.unit)}</td>
      <td class="num">${money(item.total)}</td>
      <td><span class="ticket-item-status ${esc(item.status)}">${esc(STATUS[item.status] || item.status)}</span></td>
      <td class="ticket-item-actions">${buttons}</td></tr>`;
  }

  function formMarkup(data) {
    const options = map => Object.entries(map).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    return `<form class="ticket-item-form" id="ticketItemForm">
      <label>ประเภท<select name="kind">${options(data.kinds)}</select></label>
      <label class="grow">ชื่อรายการ / งานที่จ้าง<input name="name" required maxlength="200"></label>
      <label>จำนวน<input name="qty" type="number" min="0.01" step="any" value="1" required></label>
      <label>หน่วย<input name="unit" maxlength="40" placeholder="ชิ้น/ชุด/งาน"></label>
      <label>ราคาต่อหน่วย (บาท)<input name="unitCost" type="number" min="0" step="any" value="0"></label>
      <label>แหล่งที่มา<select name="source">${options(data.sources)}</select></label>
      <label class="vendor-field">ช่างนอก / ร้าน / บริษัท<input name="vendor" maxlength="200" list="ticketVendorList" placeholder="จำเป็นเมื่อเลือกช่างนอก"></label>
      <label class="vendor-field">ติดต่อ<input name="vendorContact" maxlength="160"></label>
      <label class="grow">หมายเหตุ<input name="note" maxlength="1000"></label>
      <button class="button" type="submit">เพิ่มรายการ</button>
      <datalist id="ticketVendorList">${(data.externalVendors || []).map(v => `<option value="${esc(v)}">`).join('')}</datalist>
      <p id="ticketItemError" role="alert"></p></form>`;
  }

  async function render(ticketId, ticket) {
    const scroll = document.querySelector('#ticketDialogContent .ticket-dialog-scroll');
    if (!scroll || !document.querySelector('#ticketDialog')?.open) return;
    let section = scroll.querySelector('.ticket-items-panel');
    if (!section) {
      section = document.createElement('section');
      section.className = 'ticket-items-panel';
      scroll.querySelector('.ticket-columns')?.before(section);
    }
    const open = !CLOSED.includes(ticket.status);
    try {
      const data = await app.api(`/api/tickets/${ticketId}/items`);
      section.innerHTML = `<h3>อะไหล่ วัสดุ และช่างนอก <small>รวม ${money(data.total)} บาท</small></h3>
        ${data.items.length ? `<div class="ticket-items-wrap"><table class="ticket-items-table"><thead><tr><th>รายการ</th><th>จำนวน</th><th>รวม (บาท)</th><th>สถานะ</th><th></th></tr></thead><tbody>${data.items.map(i => rowMarkup(i, open)).join('')}</tbody></table></div>` : '<p class="field-hint">ยังไม่มีรายการ หากต้องขอเบิกอะไหล่ วัสดุ หรือจ้างช่างนอก ให้เพิ่มที่นี่เพื่อให้ผู้อนุมัติและงานซ่อมตามต่อได้</p>'}
        ${open ? `<details class="ticket-item-add"><summary>+ ขอเบิกอะไหล่ / วัสดุ / จ้างช่างนอก</summary>${formMarkup(data)}</details>` : ''}`;
      const form = section.querySelector('#ticketItemForm');
      if (form) {
        const sync = () => {
          const external = form.elements.kind.value === 'external_labor';
          form.elements.vendor.required = external;
          form.querySelectorAll('.vendor-field').forEach(el => { el.hidden = !external && !form.elements.vendor.value; });
          if (external) form.elements.source.value = 'vendor';
        };
        form.elements.kind.addEventListener('change', sync);
        sync();
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const payload = Object.fromEntries(new FormData(form));
          payload.actor = app.getRole?.() || '';
          try {
            await app.api(`/api/tickets/${ticketId}/items`, {method: 'POST', body: JSON.stringify(payload)});
            app.toast('เพิ่มรายการแล้ว');
            app.openTicket(ticketId);
          } catch (error) {
            section.querySelector('#ticketItemError').textContent = error.message;
          }
        });
      }
      section.querySelectorAll('[data-item-action]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await app.api(`/api/tickets/${ticketId}/items/${button.dataset.itemId}`, {method: 'PUT', body: JSON.stringify({action: button.dataset.itemAction, actor: app.getRole?.() || ''})});
          app.openTicket(ticketId);
        } catch (error) {
          button.disabled = false;
          app.toast(error.message);
        }
      }));
    } catch (error) {
      section.innerHTML = `<p role="alert">${esc(error.message)}</p>`;
    }
  }

  document.addEventListener('govasset:ticket-opened', event => render(event.detail.id, event.detail.ticket));
})();
