/* Give action buttons consistent meaning, including dynamically rendered dialogs. */
(() => {
  const purposes={confirm:'ยืนยันหรือบันทึกข้อมูล',back:'กลับหน้าหรือขั้นตอนก่อนหน้า',cancel:'ปิดหรือออกจากการแก้ไขโดยไม่บันทึก',danger:'การลบ ปฏิเสธ หรือยกเลิกรายการ',edit:'แก้ไขหรือตั้งค่าข้อมูล',info:'เปิดดูข้อมูลหรือทำงานต่อ'};
  function tone(button){
    const text=(button.textContent||'').trim(),action=button.dataset.ticketAction||button.dataset.assetAction||button.dataset.supplyAction||button.dataset.receiptAction||'';
    if(button.dataset.actionIntent)return button.dataset.actionIntent;
    if(/^(reject|reject_final_cost|cancel|delete)$/.test(action)||/^(ลบ|ไม่อนุมัติ|ปฏิเสธ|ยกเลิก(?:งาน|ใบ|รายการ|คำขอ))/.test(text)||button.classList.contains('reject'))return 'danger';
    if(/^[←↶]/.test(text)||/^(ย้อนกลับ|กลับ|ก่อนหน้า)/.test(text)||button.classList.contains('settings-back')||button.hasAttribute('data-back-view'))return 'back';
    if(/^(ยกเลิก|ปิดโดยไม่บันทึก|ปิดร่าง|ปิด$)/.test(text))return 'cancel';
    if(button.dataset.receiptAction==='send_back')return 'edit';
    if(button.type==='submit'&&button.form||/^(บันทึก|ตกลง|ยืนยัน|อนุมัติ|ส่งคำขอ|ส่งตรวจรับ|ส่งใบเบิก|รับมอบ|ตรวจรับ)/.test(text))return 'confirm';
    if(/^(แก้ไข|ตั้งค่า|ออกแบบ)/.test(text)||button.hasAttribute('data-workspace-edit'))return 'edit';
    return button.classList.contains('primary')?'confirm':'info';
  }
  function disabledReason(button){
    if(button.dataset.disabledReason)return button.dataset.disabledReason;
    if(/กำลัง|รอสักครู่/.test(button.textContent))return 'กำลังดำเนินการ กรุณารอ';
    if(button.hasAttribute('data-kind-next')||button.hasAttribute('data-page-next'))return 'ไม่มีหน้าถัดไป';
    if(button.hasAttribute('data-kind-prev')||button.hasAttribute('data-page-prev'))return 'อยู่หน้าแรกแล้ว';
    if(button.dataset.sharedId)return 'แก้บัญชีกลางได้เฉพาะผู้ดูแลระบบส่วนกลาง';
    if(button.hasAttribute('data-write')||button.hasAttribute('data-category-edit')||button.hasAttribute('data-edit-kind'))return 'ต้องมีสิทธิ์จัดการข้อมูลและเลือกบทบาทเจ้าหน้าที่พัสดุ';
    return button.dataset.originalTitle||'ปุ่มนี้ยังไม่พร้อมใช้งานตามสิทธิ์หรือสถานะปัจจุบัน';
  }
  function refresh(){
    scheduled=false;
    document.querySelectorAll('button.button,button.scan-button,a.scan-button').forEach(button=>{
      if(button.dataset.originalTitle===undefined)button.dataset.originalTitle=button.title||'';
      const intent=tone(button);button.dataset.actionTone=intent;
      button.dataset.actionBusy=String(button.disabled&&/กำลัง|รอสักครู่/.test(button.textContent));
      button.title=button.disabled?disabledReason(button):(button.dataset.originalTitle||purposes[intent]||'');
    });
  }
  let scheduled=false;
  const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(refresh);}});
  observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','disabled','data-disabled-reason','data-action-intent']});
  refresh();
})();

/* Use a Thai Buddhist-era calendar instead of the browser-locale date picker. */
(() => {
  const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const weekdays=['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];
  let active=null,popup=null,month=new Date(new Date().getFullYear(),new Date().getMonth(),1);
  const pad=value=>String(value).padStart(2,'0');
  const toIso=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  const fromIso=value=>{
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');
    if(!match)return null;
    const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
    return date.getFullYear()===Number(match[1])&&date.getMonth()===Number(match[2])-1&&date.getDate()===Number(match[3])?date:null;
  };
  const format=value=>{const date=fromIso(value);return date?`${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()+543}`:'';};
  const parse=value=>{
    const match=/^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$/.exec(value||'');
    if(!match)return null;
    const day=Number(match[1]),monthNumber=Number(match[2]),rawYear=Number(match[3]),year=rawYear>=2400?rawYear-543:rawYear;
    const date=new Date(year,monthNumber-1,day);
    return date.getFullYear()===year&&date.getMonth()===monthNumber-1&&date.getDate()===day?date:null;
  };
  const labelText=input=>[...input.closest('label')?.childNodes||[]].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent.trim()).filter(Boolean).join(' ');

  function createPopup(){
    if(popup)return;
    popup=document.createElement('section');
    popup.id='thaiDateCalendar';
    popup.className='thai-calendar';
    popup.setAttribute('role','dialog');
    popup.setAttribute('aria-label','เลือกวันที่');
    popup.hidden=true;
    document.body.append(popup);
    popup.addEventListener('pointerdown',event=>event.preventDefault());
    popup.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if(!button||!active)return;
      if(button.dataset.month){
        month=new Date(month.getFullYear(),month.getMonth()+Number(button.dataset.month),1);
        render();
      }else if(button.dataset.date){
        selectDate(active,button.dataset.date);
        close(true);
      }else if(button.dataset.action==='today'){
        selectDate(active,toIso(new Date()));
        close(true);
      }else if(button.dataset.action==='clear'){
        selectDate(active,'');
        close(true);
      }
    });
  }

  function place(){
    if(!active||!popup)return;
    const rect=active.display.getBoundingClientRect(),width=Math.min(292,window.innerWidth-24);
    popup.style.width=`${width}px`;
    const height=popup.offsetHeight||330;
    popup.style.left=`${Math.max(12,Math.min(rect.left,window.innerWidth-width-12))}px`;
    popup.style.top=`${rect.bottom+height+8<=window.innerHeight?rect.bottom+6:Math.max(12,rect.top-height-6)}px`;
  }

  function render(){
    if(!active||!popup)return;
    const year=month.getFullYear(),monthIndex=month.getMonth(),first=new Date(year,monthIndex,1).getDay(),days=new Date(year,monthIndex+1,0).getDate(),selected=active.value.value,today=toIso(new Date());
    const cells=Array(first).fill('<span class="thai-calendar-blank" aria-hidden="true"></span>');
    for(let day=1;day<=days;day++){
      const value=toIso(new Date(year,monthIndex,day)),classes=['thai-calendar-day'];
      if(value===selected)classes.push('is-selected');
      if(value===today)classes.push('is-today');
      cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${value}" aria-label="${day} ${months[monthIndex]} ${year+543}" ${value<active.min||(active.max&&value>active.max)?'disabled':''}>${day}</button>`);
    }
    popup.innerHTML=`<header class="thai-calendar-head"><button type="button" data-month="-1" aria-label="เดือนก่อนหน้า">‹</button><b>${months[monthIndex]} ${year+543}</b><button type="button" data-month="1" aria-label="เดือนถัดไป">›</button></header><div class="thai-calendar-grid thai-calendar-weekdays">${weekdays.map(day=>`<span>${day}</span>`).join('')}</div><div class="thai-calendar-grid">${cells.join('')}</div><footer><button type="button" data-action="clear">ล้างวันที่</button><button type="button" data-action="today">วันนี้</button></footer>`;
    place();
  }

  function selectDate(field,value){
    if(value&&(value<field.min||(field.max&&value>field.max)))return;
    field.value.value=value;
    field.display.value=format(value);
    field.display.setCustomValidity('');
    field.value.dispatchEvent(new Event('input',{bubbles:true}));
    field.value.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function open(field){
    if(field.display.disabled||field.display.readOnly)return;
    createPopup();
    active=field;
    const selected=fromIso(field.value.value)||new Date();
    month=new Date(selected.getFullYear(),selected.getMonth(),1);
    field.display.setAttribute('aria-expanded','true');
    render();
    popup.hidden=false;
    place();
  }

  function close(focus=false){
    if(!active)return;
    const field=active;
    active=null;
    popup.hidden=true;
    field.display.setAttribute('aria-expanded','false');
    if(focus)field.display.focus();
  }

  function enhance(input){
    if(input.dataset.thaiDateReady||input.type!=='date')return;
    input.dataset.thaiDateReady='1';
    const initial=input.value,required=input.required,disabled=input.disabled,readOnly=input.readOnly,min=input.min,max=input.max;
    const displayInput=document.createElement('input'),wrapper=document.createElement('span');
    wrapper.className='thai-date-field';
    displayInput.type='text';
    displayInput.id=input.id;
    displayInput.className=`${input.className} thai-date-display`.trim();
    displayInput.placeholder='วัน/เดือน/ปี พ.ศ.';
    displayInput.autocomplete='off';
    displayInput.inputMode='numeric';
    displayInput.required=required;
    displayInput.disabled=disabled;
    displayInput.readOnly=readOnly;
    displayInput.setAttribute('role','combobox');
    displayInput.setAttribute('aria-haspopup','dialog');
    displayInput.setAttribute('aria-controls','thaiDateCalendar');
    displayInput.setAttribute('aria-expanded','false');
    displayInput.setAttribute('aria-label',labelText(input)?`${labelText(input)} วัน/เดือน/ปี พ.ศ.`:'เลือกวันที่ วัน/เดือน/ปี พ.ศ.');
    input.type='hidden';
    input.id='';
    input.required=false;
    input.removeAttribute('min');
    input.removeAttribute('max');
    input.removeAttribute('class');
    input.before(wrapper);
    wrapper.append(displayInput,input);
    displayInput.value=format(initial);
    const field={display:displayInput,value:input,min,max};
    displayInput.addEventListener('focus',()=>open(field));
    displayInput.addEventListener('click',()=>open(field));
    displayInput.addEventListener('input',()=>{
      const parsed=parse(displayInput.value);
      if(!displayInput.value.trim()){
        input.value='';
        displayInput.setCustomValidity('');
      }else if(parsed&&(!min||toIso(parsed)>=min)&&(!max||toIso(parsed)<=max)){
        input.value=toIso(parsed);
        displayInput.setCustomValidity('');
      }else{
        input.value='';
        displayInput.setCustomValidity('กรุณาระบุวันที่ให้ถูกต้อง เช่น 02/11/2569');
      }
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      if(active===field)render();
    });
    displayInput.addEventListener('blur',()=>{if(input.value)displayInput.value=format(input.value);});
    displayInput.addEventListener('keydown',event=>{
      if(event.key==='Escape')close();
      if(event.key==='ArrowDown'&&popup&&!popup.hidden){event.preventDefault();popup.querySelector('.thai-calendar-day:not(:disabled)')?.focus();}
    });
    input.form?.addEventListener('reset',()=>setTimeout(()=>{displayInput.value=format(input.value);displayInput.setCustomValidity('');},0));
  }

  document.addEventListener('pointerdown',event=>{if(active&&!popup.contains(event.target)&&active.display!==event.target)close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active)close();});
  window.addEventListener('resize',place);
  window.addEventListener('scroll',place,true);
  document.querySelectorAll('input[type="date"]').forEach(enhance);
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    if(node.matches('input[type="date"]'))enhance(node);
    node.querySelectorAll?.('input[type="date"]').forEach(enhance);
  }))).observe(document.body,{childList:true,subtree:true});
})();
