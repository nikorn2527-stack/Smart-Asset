/* Role-scoped workflow inbox. Roles remain the prototype's simulated actors. */
(() => {
  const app=window.govAssetApp,$=(selector,root=document)=>root.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bell=document.createElement('button');bell.id='notificationBell';bell.className='notification-bell';bell.type='button';bell.setAttribute('aria-label','เปิดศูนย์แจ้งเตือน');bell.setAttribute('aria-haspopup','dialog');bell.setAttribute('aria-controls','notificationsDialog');
  bell.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span id="notificationBadge" hidden></span>';
  $('.top-actions').insertBefore(bell,$('.role-picker'));
  const dialog=document.createElement('dialog');dialog.id='notificationsDialog';dialog.className='asset-dialog notification-dialog';dialog.setAttribute('aria-labelledby','notificationsTitle');
  dialog.innerHTML=`<div class="notification-header"><div><h2 id="notificationsTitle">ศูนย์แจ้งเตือน</h2><p id="notificationRole"></p></div><button class="dialog-close" type="button" id="closeNotifications" aria-label="ปิดแจ้งเตือน">×</button></div><div class="notification-toolbar"><label>แสดง<select id="notificationCategory"><option value="">ทุกประเภท</option><option value="approval">รออนุมัติ</option><option value="repair">งานซ่อม</option><option value="work">PM / ตรวจนับ</option><option value="asset">ผลขึ้นทะเบียน</option></select></label><label class="notification-unread"><input id="notificationUnreadOnly" type="checkbox"> ยังไม่อ่าน</label><button type="button" class="button outline" id="refreshNotifications">อัปเดต</button><button type="button" class="text-button" id="readAllNotifications">อ่านทั้งหมดของบทบาทนี้</button></div><p id="notificationStatus" class="field-hint" role="status"></p><div id="notificationItems"></div><div class="notification-pager"><button type="button" class="button outline" id="notificationPrev">ก่อนหน้า</button><span id="notificationPage"></span><button type="button" class="button outline" id="notificationNext">ถัดไป</button></div><p class="notification-scope">แสดงงานและสถานะล่าสุดตามบทบาททดสอบ สถานะอ่านใช้ร่วมกันในบทบาทเดียวกัน การอ่านแจ้งเตือนไม่ใช่การอนุมัติ</p>`;
  document.body.append(dialog);
  let page=null,epoch=0,offset=0,loading=false,acting=false,refreshTimer=null,workflow=null,workflowEpoch=0,workflowLoading=false,workflowSaving=false;
  const limit=20,labels={approval:'อนุมัติ',repair:'งานซ่อม',work:'PM / ตรวจนับ',asset:'ครุภัณฑ์'};
  function render(){
    $('#notificationRole').textContent=`บทบาท: ${app.getRole()} · ${page?.unreadCount??0} รายการที่ยังไม่อ่าน`;
    const count=page?.unreadCount||0;$('#notificationBadge').hidden=!count;$('#notificationBadge').textContent=count>99?'99+':String(count);bell.setAttribute('aria-label',`เปิดศูนย์แจ้งเตือน ${count} รายการที่ยังไม่อ่าน`);
    $('#notificationItems').innerHTML=page?.items.length?page.items.map(n=>`<article class="notification-item ${n.readAt?'is-read':'is-unread'}"><div class="notification-item-top"><span class="badge ${n.priority>=80?'amber':'blue'}">${esc(labels[n.category]||n.category)}</span>${n.readAt?'<span class="notification-read-label">อ่านแล้ว</span>':'<span class="notification-new">ยังไม่อ่าน</span>'}</div><h3>${esc(n.title)}</h3><p><b>${esc(n.reference||'ไม่ระบุรหัส')}</b> · ${esc(n.subject)}</p><p>${esc(n.detail)}${n.assignee?` · ผู้รับผิดชอบ ${esc(n.assignee)}`:''}${n.dueOn?` · กำหนด ${esc(n.dueOn)}`:''}</p><div class="notification-item-actions"><button class="button outline" type="button" data-open-notification="${esc(n.key)}">${n.category==='approval'?'เปิดรายการเพื่อพิจารณา':'เปิดรายการ'}</button>${n.readAt?'':`<button class="text-button" type="button" data-read-notification="${esc(n.key)}">อ่านแล้ว</button>`}</div></article>`).join(''):'<div class="notification-empty">ไม่มีแจ้งเตือนตามตัวกรองนี้</div>';
    $('#notificationPage').textContent=`${page?.total?offset+1:0}–${Math.min(offset+limit,page?.total||0)} จาก ${page?.total||0}`;
    $('#notificationPrev').disabled=loading||offset===0;$('#notificationNext').disabled=loading||offset+limit>=(page?.total||0);$('#readAllNotifications').disabled=loading||acting||!count;
    dialog.querySelectorAll('[data-open-notification],[data-read-notification]').forEach(button=>button.disabled=acting);
  }
  async function load(){
    const request=++epoch,recipient=app.getRole();loading=true;
    try{
      const q=new URLSearchParams({role:recipient,category:$('#notificationCategory').value,onlyUnread:$('#notificationUnreadOnly').checked?'1':'0',limit:String(limit),offset:String(offset)});
      const data=await app.api('/api/notifications?'+q);
      if(request!==epoch||recipient!==app.getRole())return;
      if(offset>0&&offset>=data.total){offset=Math.max(0,Math.floor(Math.max(0,data.total-1)/limit)*limit);return await load();}
      page=data;loading=false;render();$('#notificationStatus').textContent=`อัปเดต ${new Date(data.serverTime).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok'})} · อัปเดตอัตโนมัติทุก 30 วินาที`;
    }catch(error){if(request===epoch){$('#notificationStatus').textContent='โหลดแจ้งเตือนไม่สำเร็จ: '+error.message;}}
    finally{if(request===epoch){loading=false;$('#refreshNotifications').disabled=false;}}
  }
  function schedule(){clearTimeout(refreshTimer);refreshTimer=setTimeout(load,200);}
  async function read(keys,all=false){await app.api('/api/notifications/read',{method:'POST',body:JSON.stringify({actor:app.getRole(),keys,all})});}
  async function navigate(n){
    if(n.entity==='ticket'){app.switchView('repairs');await app.openTicket(n.entityId);}
    if(n.entity==='work')await app.openWork(n.entityId);
    if(n.entity==='asset'){
      if(n.status==='รออนุมัติ'&&app.getRole()==='ผู้อนุมัติ'){
        await app.refreshData();app.switchView('approvals');
        const row=$(`#approvalAssetRows [data-asset-id="${n.entityId}"]`)?.closest('tr');
        if(row){row.tabIndex=-1;row.focus();row.scrollIntoView({block:'center'});row.classList.add('notification-target');setTimeout(()=>row.classList.remove('notification-target'),4000);}
        else await app.openAsset(n.entityId);
      }else await app.openAsset(n.entityId);
    }
  }
  dialog.addEventListener('click',async event=>{
    const open=event.target.closest('[data-open-notification]'),readButton=event.target.closest('[data-read-notification]');
    if(!open&&!readButton)return;if(acting)return;
    const key=open?.dataset.openNotification||readButton.dataset.readNotification,n=page?.items.find(item=>item.key===key),recipient=app.getRole();if(!n)return;
    acting=true;render();
    try{await read([key]);if(recipient!==app.getRole())return;if(open){dialog.close();await navigate(n);}await load();}
    catch(error){if(dialog.open)$('#notificationStatus').textContent=error.message;else app.toast(error.message);}
    finally{acting=false;if(page)render();}
  });
  $('#readAllNotifications').onclick=async()=>{if(acting)return;acting=true;render();try{await read([],true);await load();}catch(error){$('#notificationStatus').textContent=error.message;}finally{acting=false;if(page)render();}};
  bell.onclick=()=>{if(!dialog.open)dialog.showModal();offset=0;load();};
  $('#closeNotifications').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  for(const id of ['notificationCategory','notificationUnreadOnly'])$('#'+id).addEventListener('change',()=>{offset=0;load();});
  $('#refreshNotifications').onclick=load;$('#notificationPrev').onclick=()=>{offset=Math.max(0,offset-limit);load();};$('#notificationNext').onclick=()=>{offset+=limit;load();};
  document.addEventListener('govasset:role-changed',()=>{++epoch;offset=0;page=null;render();load();renderWorkflow();});
  document.addEventListener('govasset:data-changed',event=>{if(!event.detail.path.startsWith('/api/notifications'))schedule();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
  setInterval(()=>{if(!document.hidden)load();},30000);

  const configuration=document.createElement('details');configuration.className='panel notification-settings';configuration.id='workflowSettings';
  configuration.innerHTML=`<summary>แจ้งเตือนและเกณฑ์ส่งอนุมัติ</summary><form id="workflowSettingsForm"><p>แจ้งเตือนในแอปตามบทบาท: ขึ้นทะเบียนครุภัณฑ์ → คัดกรองซ่อม → อนุมัติ → มอบหมาย → ตรวจยอดจริง → ตรวจรับ พร้อมงาน PM / ตรวจนับตามรอบ</p><fieldset id="workflowFields"><label>วงเงินส่งอนุมัติงานซ่อม (บาท)<input name="approvalThreshold" type="number" min="0" max="1000000000" step="0.01" required></label><small>ใช้เกณฑ์ที่หน่วยงานกำหนด ค่าเริ่มต้นไม่ใช่การรับรองวงเงินราชการ งานซื้ออะไหล่ จ้างภายนอก ทดแทน หรือเลือกขออนุมัติเองยังต้องส่งพิจารณา</small><label>เตือนงานใกล้ครบกำหนดล่วงหน้า (วัน)<input name="reminderDays" type="number" min="0" max="30" step="1" required></label><small>0 = เตือนเมื่อถึงกำหนด งานเกินกำหนดยังคงแสดงจนบันทึกผล</small></fieldset><p class="field-hint">แก้ไขได้ในบทบาทเจ้าหน้าที่พัสดุ งานที่บันทึกเกณฑ์ตอนคัดกรองไว้แล้วจะคงเกณฑ์เดิม แม้เปลี่ยนค่านี้ภายหลัง</p><div class="dialog-actions"><button class="button outline" type="button" id="reloadWorkflowSettings">โหลดค่าล่าสุด</button><button class="button primary" type="submit" id="saveWorkflowSettings">บันทึกเกณฑ์</button></div><p id="workflowSettingsStatus" role="status"></p></form>`;
  $('#view-settings .settings-sections').after(configuration);
  function workflowPermissions(){const editable=!!workflow&&app.getRole()==='เจ้าหน้าที่พัสดุ'&&!workflowLoading&&!workflowSaving;$('#workflowFields').disabled=!editable;$('#saveWorkflowSettings').disabled=!editable;$('#reloadWorkflowSettings').disabled=workflowLoading||workflowSaving;}
  function renderWorkflow(){if(workflow){const form=$('#workflowSettingsForm');form.elements.approvalThreshold.value=workflow.approvalThreshold;form.elements.reminderDays.value=workflow.reminderDays;}workflowPermissions();}
  async function loadWorkflow(){
    const request=++workflowEpoch;workflowLoading=true;workflowPermissions();$('#workflowSettingsStatus').textContent='กำลังโหลดเกณฑ์ล่าสุด…';
    try{const data=await app.api('/api/workflow/settings');if(request!==workflowEpoch)return;workflow=data;renderWorkflow();$('#workflowSettingsStatus').textContent='';}
    catch(error){if(request===workflowEpoch)$('#workflowSettingsStatus').textContent=error.message;}
    finally{if(request===workflowEpoch){workflowLoading=false;workflowPermissions();}}
  }
  $('#reloadWorkflowSettings').onclick=loadWorkflow;
  configuration.addEventListener('toggle',()=>{if(configuration.open)loadWorkflow();});
  $('#workflowSettingsForm').onsubmit=async event=>{
    event.preventDefault();if(!workflow||app.getRole()!=='เจ้าหน้าที่พัสดุ')return;const button=$('#saveWorkflowSettings');if(button.disabled)return;const fields=Object.fromEntries(new FormData(event.target));workflowSaving=true;workflowPermissions();
    try{workflow=await app.api('/api/workflow/settings',{method:'PUT',body:JSON.stringify({approvalThreshold:Number(fields.approvalThreshold),reminderDays:Number(fields.reminderDays),revision:workflow.revision,actor:app.getRole()})});renderWorkflow();await app.refreshData();$('#workflowSettingsStatus').textContent='บันทึกแล้ว เกณฑ์ใหม่ใช้กับการคัดกรองครั้งถัดไป';}
    catch(error){$('#workflowSettingsStatus').textContent=error.message;}
    finally{workflowSaving=false;workflowPermissions();}
  };
  load();loadWorkflow();
})();
