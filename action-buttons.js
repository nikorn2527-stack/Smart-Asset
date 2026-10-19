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
