/* LINE OA configuration. Tokens and channel secrets are never sent to this page. */
(() => {
  const app=window.govAssetApp,$=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roles=['เจ้าหน้าที่พัสดุ','ผู้อนุมัติ','ช่าง','ผู้แจ้ง'];
  const root=document.createElement('details');root.id='lineSettings';root.className='panel notification-settings line-settings';
  root.innerHTML=`<summary>เชื่อมต่อ LINE Official Account</summary><p>ส่งแจ้งเตือนควบคู่กับในแอป พร้อมลิงก์กลับมาเปิดงานและพิจารณาอนุมัติในแอป การอ่านข้อความใน LINE ไม่อนุมัติหรือปิดงาน</p><p id="lineAccessHint" class="field-hint"></p><div id="lineOperatorPanel" hidden><div id="lineConnectionStatus" class="line-status"></div><details class="line-help"><summary>วิธีเตรียม LINE ก่อนเปิดใช้งาน</summary><ol><li>สร้าง LINE Official Account และเปิด Messaging API ใช้ Channel access token ของช่องทางนี้ ไม่ใช่ LINE Notify</li><li>กำหนด <code>LINE_CHANNEL_ACCESS_TOKEN</code> และ <code>LINE_CHANNEL_SECRET</code> ใน environment ของเซิร์ฟเวอร์ แล้วเริ่มเซิร์ฟเวอร์ใหม่ ไม่ต้องวางค่าลับในหน้าเว็บหรือแชต</li><li>บันทึกที่อยู่ HTTPS ของแอปที่โทรศัพท์เข้าถึงได้ ตั้ง Webhook URL ใน LINE Developers และเปิด Use webhook</li><li>เพิ่ม OA เป็นเพื่อน หรือเชิญเข้ากลุ่มที่เปิดให้บอตเข้าร่วม แล้วส่งข้อความหนึ่งครั้ง ผู้รับที่ตรวจลายเซ็นแล้วจะปรากฏด้านล่าง หรือกรอก ID ที่ทราบอยู่แล้วได้</li><li>เลือกบทบาท/ผู้รับ บันทึก และส่งข้อความทดสอบ ก่อนเปิดแจ้งเตือนอัตโนมัติ</li></ol></details><form id="lineSettingsForm"><fieldset id="lineFields"><label>ที่อยู่ HTTPS ของแอปสำหรับเปิดจาก LINE<input name="baseUrl" type="url" placeholder="https://assets.example.go.th"></label><label class="line-enable"><input name="enabled" type="checkbox"> เปิดส่งแจ้งเตือน LINE อัตโนมัติ</label><p class="field-hint">เมื่อเปิดหรือเปลี่ยนการตั้งค่า จะเริ่มจากงาน/สถานะใหม่ งานค้างเดิมยังอยู่ในกระดิ่งและจะไม่ถูกส่งย้อนหลังทั้งหมด</p><h3>ผู้รับตามบทบาท</h3><p class="field-hint">เลือกกลุ่มหรือบุคคลที่ควรได้รับข้อมูลของแต่ละบทบาท กลุ่มเดียวที่รับหลายบทบาทจะได้รับข้อความขั้นเดียวกันเพียงครั้งเดียว นี่ยังเป็นการจับคู่บทบาทจำลอง ไม่ได้ผูกบัญชีผู้ใช้จริง</p><div id="lineRecipients"></div><button type="button" class="button outline" id="addLineRecipient">＋ เพิ่มผู้รับ</button></fieldset><div class="dialog-actions"><button type="button" class="button outline" id="reloadLineSettings">โหลดค่าล่าสุด</button><button type="submit" class="button primary" id="saveLineSettings">บันทึก LINE</button></div></form><p id="lineFormStatus" role="status"></p><label>Webhook URL ที่บันทึกไว้<input id="lineWebhookUrl" readonly placeholder="บันทึก HTTPS ก่อน"></label><h3>ผู้รับที่พบจาก webhook ที่ตรวจลายเซ็นแล้ว</h3><div id="lineCandidates"></div><h3>ส่งข้อความทดสอบ</h3><p class="field-hint">ส่งเฉพาะข้อความทดสอบไปยังผู้รับที่บันทึกและเลือกไว้ ใช้ทดสอบได้ขณะที่ปิดแจ้งเตือนอัตโนมัติ</p><div class="line-test"><select id="lineTestRecipient" aria-label="ผู้รับข้อความทดสอบ"></select><button id="testLineConnection" type="button" class="button outline">ส่งข้อความทดสอบ</button></div><h3>คิวและผลส่งล่าสุด</h3><p class="field-hint">“LINE รับคำขอแล้ว” หมายถึง LINE รับการส่ง ไม่ได้ยืนยันว่าผู้รับเปิดอ่าน ข้อความที่งานเปลี่ยนสถานะแล้วจะถูกข้ามก่อนส่ง</p><div class="table-wrap"><table><thead><tr><th>ผู้รับ / บทบาท</th><th>สถานะ</th><th>ครั้ง</th><th>รายละเอียด</th><th></th></tr></thead><tbody id="lineDeliveries"></tbody></table></div></div>`;
  $('#workflowSettings').after(root);
  let cfg=null,epoch=0,statusEpoch=0,loading=false,saving=false,testing=false;
  const editable=()=>app.getRole()==='เจ้าหน้าที่พัสดุ';
  function controls(){const ready=editable()&&!!cfg&&!loading&&!saving;$('#lineFields').disabled=!ready;$('#saveLineSettings').disabled=!ready;$('#reloadLineSettings').disabled=loading||saving;$('#testLineConnection').disabled=!ready||testing||!cfg.tokenConfigured||!cfg.baseUrl||!cfg.recipients.length;}
  function routes(){return [...$('#lineRecipients').querySelectorAll('.line-recipient-row')].map(row=>({role:$('[data-line-role]',row).value,targetId:$('[data-line-target]',row).value.trim(),label:$('[data-line-label]',row).value.trim()}));}
  function renderRoutes(values){$('#lineRecipients').innerHTML=values.map((r,i)=>`<div class="line-recipient-row"><label>บทบาท<select data-line-role>${roles.map(role=>`<option ${role===r.role?'selected':''}>${esc(role)}</option>`).join('')}</select></label><label>LINE user/group/room ID<input data-line-target value="${esc(r.targetId)}" required pattern="[UCR][0-9a-fA-F]{32}" placeholder="U… / C… / R…"></label><label>ชื่อเรียกผู้รับ<input data-line-label value="${esc(r.label)}" required maxlength="80" placeholder="เช่น กลุ่มผู้อนุมัติ"></label><button type="button" class="text-button" data-remove-line="${i}">เอาออก</button></div>`).join('')||'<p class="field-hint">ยังไม่ได้กำหนดผู้รับ</p>';}
  function renderStatus(data){
    $('#lineConnectionStatus').textContent=[data.tokenConfigured?'กำหนด Token แล้ว (ต้องทดสอบ)':'ยังไม่กำหนด LINE_CHANNEL_ACCESS_TOKEN',data.secretConfigured?'กำหนด Channel secret แล้ว':'ยังไม่กำหนด LINE_CHANNEL_SECRET',data.worker.running?'ตัวส่งทำงาน':'ตัวส่งยังไม่พร้อม'].join(' · ');
    if(data.worker.lastError)$('#lineConnectionStatus').textContent+=' · ตัวส่งมีข้อผิดพลาด: '+data.worker.lastError;
    $('#lineCandidates').innerHTML=data.candidates.length?data.candidates.map((c,i)=>`<div class="line-candidate"><span>${esc(c.source_type)} · <code>${esc(c.target_id)}</code><small>พบล่าสุด ${esc(app.fmtDate(c.last_seen_at))}</small></span><button type="button" class="button outline" data-line-candidate="${i}">เพิ่มในฟอร์ม</button></div>`).join(''):'<p class="field-hint">ยังไม่พบผู้รับ ตรวจ Webhook/Channel secret และให้ผู้รับเพิ่ม OA หรือเชิญบอตเข้ากลุ่ม</p>';
    const status={pending:'รอส่ง',sending:'กำลังส่ง',retry:'รอส่งซ้ำ',sent:'LINE รับคำขอแล้ว',failed:'ส่งไม่สำเร็จ',skipped:'ข้ามแล้ว'};
    $('#lineDeliveries').innerHTML=data.deliveries.length?data.deliveries.map(d=>{const recipient=data.recipients.find(r=>r.targetId===d.targetId&&r.role===d.role);return `<tr><td>${esc(recipient?.label||d.targetId)}<div class="item-meta">${esc(d.role)}${d.kind==='test'?' · ทดสอบ':''}</div></td><td>${esc(status[d.status]||d.status)}</td><td>${d.attempts}</td><td>${esc(d.lastError||app.fmtDate(d.acceptedAt||d.createdAt))}</td><td>${['failed','skipped'].includes(d.status)?`<button type="button" class="button outline mini-action" data-retry-line="${d.id}">ลองส่งใหม่</button>`:''}</td></tr>`;}).join(''):'<tr><td colspan="5" class="empty-cell">ยังไม่มีรายการส่ง LINE</td></tr>';
    root.lineCandidates=data.candidates;
  }
  async function load(full=true){
    if(!editable())return;
    const request=full?++epoch:++statusEpoch,configEpoch=epoch;if(full){++statusEpoch;loading=true;controls();$('#lineFormStatus').textContent='กำลังโหลด LINE…';}
    try{const data=await app.api('/api/line/settings?'+new URLSearchParams({actor:app.getRole()}));if((full?request!==epoch:request!==statusEpoch||configEpoch!==epoch)||!editable())return;
      renderStatus(data);
      if(full){cfg=data;const form=$('#lineSettingsForm');form.elements.baseUrl.value=cfg.baseUrl;form.elements.enabled.checked=cfg.enabled;renderRoutes(cfg.recipients);$('#lineWebhookUrl').value=cfg.baseUrl?cfg.baseUrl+'/api/line/webhook':'';$('#lineTestRecipient').innerHTML=cfg.recipients.map((r,i)=>`<option value="${i}">${esc(r.label)} · ${esc(r.role)}</option>`).join('')||'<option>ยังไม่มีผู้รับ</option>';$('#lineFormStatus').textContent='';}
      else if(cfg&&cfg.revision!==data.revision)$('#lineFormStatus').textContent='การตั้งค่าเปลี่ยนจากอีกหน้าต่าง กรุณาโหลดค่าล่าสุดก่อนบันทึก/ทดสอบ';
    }catch(error){if(full?request===epoch:request===statusEpoch&&configEpoch===epoch)$('#lineFormStatus').textContent=error.message;}
    finally{if(full&&request===epoch)loading=false;controls();}
  }
  function access(){++epoch;++statusEpoch;loading=false;const allowed=editable();$('#lineOperatorPanel').hidden=!allowed;$('#lineAccessHint').textContent=allowed?'คีย์ลับเก็บที่เซิร์ฟเวอร์ หน้านี้แสดงเฉพาะสถานะการกำหนดค่า':'เลือกบทบาทเจ้าหน้าที่พัสดุเพื่อเชื่อมต่อ LINE';if(allowed&&root.open)load();controls();}
  root.addEventListener('toggle',()=>{if(root.open)access();});
  document.addEventListener('govasset:role-changed',access);
  $('#reloadLineSettings').onclick=()=>load();
  $('#addLineRecipient').onclick=()=>{const values=routes();if(values.length>=20){$('#lineFormStatus').textContent='กำหนดได้ไม่เกิน 20 บทบาท/ปลายทาง';return;}values.push({role:roles[0],targetId:'',label:''});renderRoutes(values);};
  root.addEventListener('click',async event=>{
    const remove=event.target.closest('[data-remove-line]');if(remove){renderRoutes(routes().filter((_,i)=>i!==Number(remove.dataset.removeLine)));return;}
    const candidate=event.target.closest('[data-line-candidate]');if(candidate){if(saving||loading)return;const entry=root.lineCandidates[Number(candidate.dataset.lineCandidate)],values=routes();if(values.length>=20)return;values.push({role:roles[0],targetId:entry.target_id,label:''});renderRoutes(values);return;}
    const retry=event.target.closest('[data-retry-line]');if(retry){if(loading||saving||testing)return;retry.disabled=true;try{await app.api(`/api/line/deliveries/${retry.dataset.retryLine}/retry`,{method:'POST',body:JSON.stringify({actor:app.getRole()})});$('#lineFormStatus').textContent='เข้าคิวส่งซ้ำแล้ว';await load(false);}catch(error){$('#lineFormStatus').textContent=error.message;}finally{retry.disabled=false;}}
  });
  $('#lineSettingsForm').onsubmit=async event=>{
    event.preventDefault();if(saving||loading||!cfg||!editable())return;
    const form=event.target,body={actor:app.getRole(),revision:cfg.revision,enabled:form.elements.enabled.checked,baseUrl:form.elements.baseUrl.value,recipients:routes()};saving=true;controls();
    try{await app.api('/api/line/settings',{method:'PUT',body:JSON.stringify(body)});await load();$('#lineFormStatus').textContent='บันทึกแล้ว เริ่มจากงาน/สถานะใหม่หลังการตั้งค่านี้';}
    catch(error){$('#lineFormStatus').textContent=error.message;}
    finally{saving=false;controls();}
  };
  $('#testLineConnection').onclick=async()=>{if(testing||!cfg)return;const recipient=cfg.recipients[Number($('#lineTestRecipient').value)];if(!recipient)return;testing=true;controls();try{const result=await app.api('/api/line/test',{method:'POST',body:JSON.stringify({actor:app.getRole(),revision:cfg.revision,role:recipient.role,targetId:recipient.targetId})});$('#lineFormStatus').textContent=`เข้าคิวข้อความทดสอบ #${result.id} แล้ว ดูผลส่งด้านล่าง`;await load(false);}catch(error){$('#lineFormStatus').textContent=error.message;}finally{testing=false;controls();}};
  setInterval(()=>{if(root.open&&editable()&&!document.hidden&&!loading&&!saving)load(false);},10000);
  access();

  async function openTask(){
    const match=/^#task=(ticket|asset|work|supply):([1-9][0-9]{0,14})$/.exec(location.hash);if(!match)return;
    history.replaceState(null,'',location.pathname+location.search);const id=Number(match[2]);
    try{
      if(match[1]==='supply'){await new Promise(resolve=>setTimeout(resolve,0));await window.govAssetSupply.open(id);}
      if(match[1]==='ticket'){app.switchView('repairs');await app.openTicket(id);}
      if(match[1]==='work')await app.openWork(id);
      if(match[1]==='asset'){
        const data=await app.api(`/api/assets/${id}/smart`);
        if(app.getRole()==='ผู้อนุมัติ'&&data.asset.status==='รออนุมัติ'){
          await app.refreshData();app.switchView('approvals');const row=$(`#approvalAssetRows [data-asset-id="${id}"]`)?.closest('tr');if(row){row.tabIndex=-1;row.focus();row.scrollIntoView({block:'center'});row.classList.add('notification-target');}else await app.openAsset(id);
        }else await app.openAsset(id);
      }
    }catch(error){app.toast(error.message);}
  }
  window.addEventListener('hashchange',openTask);openTask();
})();
