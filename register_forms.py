"""Versioned document values, separate from imported evidence and asset records."""
import json
import re
from work_api import WorkError, role, stamp

FIELDS = ('organization','department','type','code','description','model','location','vendor','address','phone','gfmis','po','serial','warranty','fiscalYear','fund','method')
COLUMNS = ('date','document','description','quantity','unitPrice','total','life','monthly','annual','accumulated','net','note')
NUMBERS = ('quantity','unitPrice','total','life','monthly','annual','accumulated','net')

def handle(db, method, path, body):
    match = re.fullmatch(r'/api/assets/(\d+)/register-form', path)
    if not match:
        return None
    aid=int(match[1])
    if not db.execute('SELECT 1 FROM assets WHERE id=?',(aid,)).fetchone():
        raise WorkError('ไม่พบครุภัณฑ์',404)
    if method=='GET':
        row=db.execute('SELECT * FROM register_forms WHERE asset_id=?',(aid,)).fetchone()
        return {'form':json.loads(row['data_json']) if row else None,'revision':row['revision'] if row else 0}
    if method!='PUT':
        raise WorkError('ไม่รองรับคำสั่งนี้',405)
    actor=role(body)
    form=body.get('form')
    if not isinstance(form,dict) or not isinstance(form.get('fields'),dict) or not isinstance(form.get('rows'),list) or not 1<=len(form['rows'])<=12:
        raise WorkError('เอกสารต้องมีข้อมูลหัวแบบฟอร์มและรายการ 1–12 แถว')
    fields={}
    for key in FIELDS:
        value=form['fields'].get(key,'')
        if not isinstance(value,str) or len(value)>500:
            raise WorkError('ข้อมูลหัวแบบฟอร์มไม่ถูกต้องหรือยาวเกิน 500 ตัวอักษร')
        fields[key]=value.strip()
    rows=[]
    for raw in form['rows']:
        if not isinstance(raw,dict):
            raise WorkError('แถวรายการไม่ถูกต้อง')
        row={}
        for key in COLUMNS:
            value=raw.get(key,'')
            if not isinstance(value,str) or len(value)>500:
                raise WorkError('ข้อมูลในตารางไม่ถูกต้องหรือยาวเกิน 500 ตัวอักษร')
            value=value.strip()
            if key in NUMBERS and value and not re.fullmatch(r'\d{1,12}(?:\.\d{1,4})?',value):
                raise WorkError('ช่องจำนวน/มูลค่าต้องเป็นตัวเลขไม่ติดลบ ไม่มีเครื่องหมายคั่นหลักพัน')
            row[key]=value
        rows.append(row)
    summary=form.get('summary',{})
    if not isinstance(summary,dict):
        raise WorkError('บรรทัดสรุปท้ายตารางไม่ถูกต้อง')
    checked_summary={}
    for key in ('annual','accumulated','net'):
        value=summary.get(key,next((r[key] for r in reversed(rows) if r[key]),''))
        if not isinstance(value,str) or (value and not re.fullmatch(r'\d{1,12}(?:\.\d{1,4})?',value)):
            raise WorkError('มูลค่าในบรรทัดสรุปต้องเป็นตัวเลขไม่ติดลบ')
        checked_summary[key]=value
    db.execute('BEGIN IMMEDIATE')
    old=db.execute('SELECT revision FROM register_forms WHERE asset_id=?',(aid,)).fetchone()
    revision=old[0] if old else 0
    if type(body.get('revision')) is not int or body['revision']!=revision:
        raise WorkError('เอกสารถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนบันทึก',409)
    db.execute('INSERT INTO register_forms(asset_id,data_json,revision,updated_at,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET data_json=excluded.data_json,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by',
        (aid,json.dumps({'fields':fields,'rows':rows,'summary':checked_summary},ensure_ascii=False),revision+1,stamp(),actor))
    status=db.execute('SELECT status FROM assets WHERE id=?',(aid,)).fetchone()[0]
    db.execute('INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)',
        (aid,actor,'แก้ไขเอกสารทะเบียนคุม',status,status,f'เอกสารฉบับแก้ไข {revision+1}',stamp()))
    return {'ok':True,'revision':revision+1}
