from access_control import document_scope_sql
"""Receiving and allocation documents. Roles follow the prototype's simulated role selector."""
import base64
import binascii
import json
import re
import sqlite3
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from governance import GovernanceError, OFFICER, ident, text, dump, check_account, create_asset, audit, today

from operational_master import reference, check_references

APPROVER = 'ผู้อนุมัติ'
DEFAULTS = {'receiptPrefix':'RC','issuePrefix':'IS','issueApproval':True,
            'registrationApproval':True,'receiptAttachment':False,'issueAttachment':False,
            'issueReference':False,'inspectionRole':OFFICER,'approvalRole':APPROVER,
            'issueRole':OFFICER}
ROLES = (OFFICER, APPROVER, 'ผู้แจ้ง', 'ช่าง')
def stamp(): return datetime.now(timezone.utc).isoformat()
def fail(message, status=400): raise GovernanceError(message, status)
def role(body, required):
    if body.get('actor') != required: fail('ขั้นตอนนี้ใช้บทบาท'+required+'ในต้นแบบ',403)
def string(b,key,label,required=False,limit=300): return text(b.get(key,''),label,limit,required)
def on_date(value):
    try: return date.fromisoformat(value).isoformat()
    except (TypeError,ValueError): fail('กรุณาระบุวันที่ให้ถูกต้อง')
def integer(value, label, low=0, high=200):
    if type(value) is not int or not low <= value <= high: fail('กรุณาตรวจ'+label)
    return value
def money(value):
    try:
        n=Decimal(str(value))
        if not n.is_finite() or n<0 or n>Decimal('1000000000') or n.quantize(Decimal('.01'))!=n: raise ValueError()
        return str(n.quantize(Decimal('.01')))
    except (InvalidOperation,ValueError): fail('ราคาต่อหน่วยต้องเป็นจำนวนเงินไม่ติดลบและไม่เกินสองทศนิยม')

def settings(db, aid):
    row=db.execute('SELECT * FROM supply_settings WHERE account_id=?',(aid,)).fetchone()
    return {'revision':row['revision'] if row else 0,**DEFAULTS,**(json.loads(row['data_json']) if row else {})}

def detail(db, row):
    result=dict(row);result['data']=json.loads(result.pop('data_json'));result['rules']=json.loads(result.pop('rules_json'))
    result['files']=[dict(r) for r in db.execute('SELECT id,name,mime,length(content) AS size FROM supply_files WHERE document_id=?',(row['id'],))]
    result['assets']=[dict(r) for r in db.execute('SELECT a.id,a.code,a.name,a.status,a.location,r.line_id FROM supply_receipt_assets r JOIN assets a ON a.id=r.asset_id WHERE r.document_id=?',(row['id'],))]
    result['events']=[{**dict(r),'data':json.loads(r['data_json'])} for r in db.execute('SELECT id,actor,action,data_json,created_at FROM supply_events WHERE document_id=? ORDER BY id',(row['id'],))]
    for e in result['events']:e.pop('data_json')
    return result

def get_doc(db,did):
    row=db.execute('SELECT * FROM supply_documents WHERE id=?',(did,)).fetchone()
    if not row:fail('ไม่พบใบงาน',404)
    return row

def event(db,did,body,action,data):
    db.execute('INSERT INTO supply_events(document_id,actor,action,data_json,created_at) VALUES(?,?,?,?,?)',(did,body['actor'],action,dump(data),stamp()))

def add_files(db,did,files):
    if not isinstance(files,list) or len(files)>3:fail('แนบได้ไม่เกิน 3 ไฟล์ต่อครั้ง')
    total=db.execute('SELECT COUNT(*) FROM supply_files WHERE document_id=?',(did,)).fetchone()[0]
    if total+len(files)>6:fail('ใบงานหนึ่งใบแนบได้ไม่เกิน 6 ไฟล์')
    for f in files:
        if not isinstance(f,dict):fail('รูปแบบไฟล์แนบไม่ถูกต้อง')
        name=string(f,'name','ชื่อไฟล์',True,180);mime=f.get('mime')
        if mime not in ('application/pdf','image/png','image/jpeg'):fail('แนบได้เฉพาะ PDF, PNG และ JPEG')
        try:content=base64.b64decode(f.get('content',''),validate=True)
        except (ValueError,TypeError,binascii.Error):fail('ไฟล์แนบไม่ถูกต้อง')
        if not 0<len(content)<=2*1024*1024:fail('ไฟล์แนบต้องไม่เกิน 2 MB ต่อไฟล์')
        signature={'application/pdf':b'%PDF','image/png':b'\x89PNG\r\n\x1a\n','image/jpeg':b'\xff\xd8\xff'}[mime]
        if not content.startswith(signature):fail('เนื้อหาไฟล์ไม่ตรงกับประเภทไฟล์')
        db.execute('INSERT INTO supply_files(document_id,name,mime,content) VALUES(?,?,?,?)',(did,name,mime,content))

def receipt_data(db,b):
    lines=b.get('lines')
    if not isinstance(lines,list) or not 1<=len(lines)<=30:fail('เพิ่มรายการรับเข้า 1–30 แถว')
    out=[]
    for i,l in enumerate(lines,1):
        if not isinstance(l,dict):fail('รูปแบบแถวไม่ถูกต้อง')
        cid=ident(l.get('categoryId'))
        if not db.execute('SELECT 1 FROM asset_categories WHERE id=? AND is_active=1',(cid,)).fetchone():fail('เลือกหมวดที่เปิดใช้งาน')
        serials=l.get('serialNumbers',[])
        if not isinstance(serials,list) or (serials and len(serials)!=l.get('quantity')):fail('จำนวนซีเรียลต้องเท่าจำนวนส่ง หรือเว้นว่างทั้งหมด')
        serials=[text(v,'ซีเรียล',160,False) for v in serials]
        nonblank=[v for v in serials if v]
        if len(set(nonblank))!=len(nonblank):fail('ซีเรียลซ้ำในแถวรับเข้า')
        out.append({'id':i,'name':string(l,'name','ชื่อรายการ',True),'categoryId':cid,
                    'quantity':integer(l.get('quantity'),'จำนวน',1),'unit':string(l,'unit','หน่วยนับ',True,40),
                    'unitPrice':money(l.get('unitPrice',0)),'model':string(l,'model','รุ่น',False,160),'serialNumbers':serials})
    serials=[v for l in out for v in l['serialNumbers'] if v]
    if len(serials)!=len(set(serials)):fail('ซีเรียลซ้ำระหว่างแถวรับเข้า')
    if sum(l['quantity'] for l in out)>500:fail('รับเข้าได้ไม่เกิน 500 ชิ้นต่อใบ')
    return {'date':on_date(b.get('date')),'supplier':string(b,'supplier','ผู้ส่งมอบ',True),
            'poNo':string(b,'poNo','เลข PO/สัญญา'),'deliveryNo':string(b,'deliveryNo','เลขใบส่งของ'),
            'location':string(b,'location','จุดรับ/คลัง',True),'receiver':string(b,'receiver','ชื่อผู้รับของ',True,160),
            'notes':string(b,'notes','หมายเหตุ',False,1000),'lines':out,
            'totalAmount':str(sum(Decimal(l['unitPrice'])*l['quantity'] for l in out)),
            'acquisitionMethod':string(b,'acquisitionMethod','วิธีได้มา'),'fundType':string(b,'fundType','แหล่งเงิน'),
            'fiscalYear':string(b,'fiscalYear','ปีงบประมาณ',False,10),'gfmisNo':string(b,'gfmisNo','เลข GFMIS',False,100)}

def issue_data(db,b):
    ids=b.get('assetIds')
    if not isinstance(ids,list) or not 1<=len(ids)<=100:fail('เลือกครุภัณฑ์ 1–100 ชิ้น')
    ids=[ident(i) for i in ids]
    if len(set(ids))!=len(ids):fail('เลือกครุภัณฑ์ซ้ำ')
    return {'date':on_date(b.get('date')),'department':string(b,'department','หน่วยงานปลายทาง',True),
            'requester':string(b,'requester','ผู้ขอ',True,160),'purpose':string(b,'purpose','เหตุผล',True,1000),
            'reference':string(b,'reference','เลขเอกสารคำขอ'),'assetIds':ids}

def available(db,aid,q="",bid=None):
    return [dict(r) for r in db.execute("""SELECT a.id,a.code,a.name,a.location,a.serial_number,a.branch_id FROM assets a
        LEFT JOIN supply_reservations r ON r.asset_id=a.id
        WHERE a.numbering_account_id=? AND a.status IN ('ทะเบียนแล้ว','พร้อมใช้','สำรวจแล้ว','รอตรวจสอบ') AND r.asset_id IS NULL AND (? IS NULL OR a.branch_id=?) AND (a.name LIKE ? OR a.code LIKE ? OR a.serial_number LIKE ?) ORDER BY a.id DESC LIMIT 501""",(aid,bid,bid,*(["%"+q+"%"]*3)))]

def reserve(db,row,data):
    for aid in data['assetIds']:
        a=db.execute("SELECT * FROM assets WHERE id=? AND numbering_account_id=? AND status IN ('ทะเบียนแล้ว','พร้อมใช้','สำรวจแล้ว','รอตรวจสอบ')",(aid,row['account_id'])).fetchone()
        if not a:fail('ครุภัณฑ์ไม่อยู่ในบัญชีหน่วยงาน หรือยังไม่พร้อมเบิก',409)
        if row['branch_id'] and a['branch_id']!=row['branch_id']:fail('ครุภัณฑ์ไม่อยู่ในสาขาที่เลือก')
        if db.execute('SELECT 1 FROM supply_reservations WHERE asset_id=?',(aid,)).fetchone():fail('ครุภัณฑ์ถูกจองในใบเบิกอื่นแล้ว',409)
        db.execute('INSERT INTO supply_reservations(asset_id,document_id) VALUES(?,?)',(aid,row['id']))
    data['items']=[dict(db.execute('SELECT id,code,name,location,serial_number FROM assets WHERE id=?',(i,)).fetchone()) for i in data['assetIds']]


def build_data(db,body,aid,bid,kind):
    fields=('supplier','location','receiver','fundType','acquisitionMethod') if kind=='receipt' else ('department','requester')
    resolved={};canonical={**body}
    for field in fields:reference(db,body,aid,bid,field,resolved,field not in ('fundType','acquisitionMethod'))
    canonical.update(resolved)
    line_links=[]
    if kind=='receipt':
        if not isinstance(body.get('lines'),list) or any(not isinstance(l,dict) for l in body['lines']):fail('รูปแบบรายการรับเข้าไม่ถูกต้อง')
        canonical['lines']=[]
        for line in body['lines']:
            result={};reference(db,line,aid,bid,'unit',result,True)
            canonical['lines'].append({**line,**result});line_links.append(result.get('masterLinks',{}))
    data=receipt_data(db,canonical) if kind=='receipt' else issue_data(db,canonical)
    data['masterLinks']=resolved.get('masterLinks',{})
    if kind=='receipt':
        for line,links in zip(data['lines'],line_links):line['masterLinks']=links
    return data

def handle(db,method,path,query,body):
    if not path.startswith('/api/supply/'):return None
    one=lambda k,default='':query.get(k,[default])[0]
    if method=='GET' and path=='/api/supply/pending':
        actor=one('role')
        if actor not in ROLES:fail('เลือกบทบาทที่ระบบรองรับ',403)
        return {'items':[{**dict(r),'summary':json.loads(r['data_json'])['department']} for r in db.execute("SELECT s.id,s.number,s.account_id,s.data_json,a.name AS accountName FROM supply_documents s JOIN asset_accounts a ON a.id=s.account_id WHERE s.kind='issue' AND "+document_scope_sql(db)+" AND s.status='pending' AND json_extract(s.rules_json,'$.approvalRole')=? ORDER BY s.id DESC LIMIT 100",(actor,))]}
    if method=='GET' and path=='/api/supply/documents':
        try:aid=ident(int(one('accountId')))
        except (ValueError,TypeError):fail('เลือกหน่วยงานก่อน')
        check_account(db,aid,None)
        rows=db.execute('SELECT id,kind,number,status,revision,created_at,updated_at,data_json FROM supply_documents s WHERE account_id=? AND '+document_scope_sql(db)+' ORDER BY id DESC LIMIT 200',(aid,)).fetchall()
        return {'items':[{**{k:r[k] for k in r.keys() if k!='data_json'},'summary':json.loads(r['data_json']).get('supplier') or json.loads(r['data_json']).get('department')} for r in rows]}
    if method=='GET' and path=='/api/supply/available':
        try:aid=ident(int(one('accountId')))
        except (ValueError,TypeError):fail('เลือกหน่วยงานก่อน')
        try:bid=ident(int(one("branchId")),True) if one("branchId") else None
        except (ValueError,TypeError):fail('เลือกสาขาให้ถูกต้อง')
        check_account(db,aid,bid);items=available(db,aid,str(one("q"))[:200],bid)
        return {'items':items[:500],'limited':len(items)>500}
    if path=='/api/supply/settings':
        try:aid=ident(int(one('accountId'))) if method=='GET' else ident(body.get('accountId'))
        except (ValueError,TypeError):fail('เลือกหน่วยงานก่อน')
        check_account(db,aid,None)
        if method=='GET':return settings(db,aid)
        if method!='PUT':fail('ไม่รองรับคำสั่ง',405)
        role(body,OFFICER);db.execute('BEGIN IMMEDIATE');old=settings(db,aid)
        if body.get('revision')!=old['revision']:fail('การตั้งค่าถูกแก้ไขแล้ว กรุณาโหลดใหม่',409)
        data={}
        for k,v in DEFAULTS.items():
            value=body.get(k,v)
            if type(v) is bool:
                if type(value) is not bool:fail('ค่าการตั้งค่าไม่ถูกต้อง')
            elif k.endswith('Role'):
                if value not in ROLES:fail('เลือกบทบาทที่ระบบรองรับ')
            elif not isinstance(value,str) or not re.fullmatch(r'[A-Z0-9]{1,10}',value):fail('อักษรนำเลขเอกสารใช้ A–Z หรือ 0–9 ไม่เกิน 10 ตัว')
            data[k]=value
        db.execute('INSERT INTO supply_settings VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,data_json=excluded.data_json',(aid,old['revision']+1,dump(data)))
        audit(db,body['actor'],'supply-settings',aid,old,data);return settings(db,aid)
    if path=='/api/supply/documents' and method=='POST':
        role(body,OFFICER);aid=ident(body.get('accountId'));bid=ident(body.get('branchId'),True);check_account(db,aid,bid)
        kind=body.get('kind')
        if kind not in ('receipt','issue'):fail('ประเภทใบงานไม่ถูกต้อง')
        db.execute('BEGIN IMMEDIATE')
        data=build_data(db,body,aid,bid,kind)
        rules=settings(db,aid);now=stamp()
        did=db.execute("INSERT INTO supply_documents(kind,account_id,branch_id,number,status,rules_json,data_json,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?,?,?)",(kind,aid,bid,'pending-'+now,dump(rules),dump(data),now,now)).lastrowid
        number=f"{rules['receiptPrefix' if kind=='receipt' else 'issuePrefix']}-{today().year+543}-{did:06d}"
        db.execute('UPDATE supply_documents SET number=? WHERE id=?',(number,did));add_files(db,did,body.get('files',[]))
        event(db,did,body,'สร้างร่าง',data);return detail(db,get_doc(db,did)),201
    match=re.fullmatch(r'/api/supply/files/(\d+)',path)
    if match and method=='GET':
        row=db.execute('SELECT * FROM supply_files WHERE id=?',(int(match[1]),)).fetchone()
        if not row:fail('ไม่พบไฟล์',404)
        return {'name':row['name'],'mime':row['mime'],'content':base64.b64encode(row['content']).decode('ascii')}
    match=re.fullmatch(r'/api/supply/documents/(\d+)',path)
    if not match:fail('ไม่พบเส้นทางใบงาน',404)
    did=int(match[1])
    if method=='GET':return detail(db,get_doc(db,did))
    if method not in ('POST','PUT'):fail('ไม่รองรับคำสั่ง',405)
    db.execute('BEGIN IMMEDIATE');row=get_doc(db,did)
    if body.get('revision')!=row['revision']:fail('ใบงานเปลี่ยนแล้ว กรุณาเปิดข้อมูลล่าสุด ร่างยังไม่ถูกบันทึก',409)
    data=json.loads(row['data_json']);rules=json.loads(row['rules_json']);status=row['status'];action=body.get('action','save')
    if action=='save':
        role(body,OFFICER)
        if status!='draft':fail('แก้ข้อมูลได้เฉพาะร่าง')
        data=build_data(db,body,row['account_id'],row['branch_id'],row['kind'])
    elif action=='submit':
        role(body,OFFICER)
        if status!='draft':fail('ส่งใบงานนี้แล้ว',409)
        files=db.execute('SELECT COUNT(*) FROM supply_files WHERE document_id=?',(did,)).fetchone()[0]+len(body.get('files',[]))
        if rules['receiptAttachment' if row['kind']=='receipt' else 'issueAttachment'] and not files:fail('หน่วยงานกำหนดให้แนบเอกสารก่อนส่ง')
        check_references(db,data,row['account_id'],row['branch_id'])
        if row['kind']=='receipt':status='received'
        else:
            if rules['issueReference'] and not data['reference']:fail('หน่วยงานกำหนดให้ระบุเลขเอกสารคำขอ')
            reserve(db,row,data);status='pending' if rules['issueApproval'] else 'approved'
    elif action=='inspect':
        role(body,rules['inspectionRole'])
        if row['kind']!='receipt' or status!='received':fail('ใบรับเข้ายังไม่อยู่ขั้นตรวจรับ')
        inspection=body.get('inspection')
        if not isinstance(inspection,list) or len(inspection)!=len(data['lines']):fail('ระบุผลตรวจรับให้ครบทุกแถว')
        mapped={}
        for i in inspection:
            if not isinstance(i,dict):fail('ผลตรวจรับไม่ถูกต้อง')
            key=integer(i.get('lineId'),'แถว',1,30)
            if key in mapped:fail('ผลตรวจรับซ้ำแถว')
            mapped[key]=i
        for l in data['lines']:
            i=mapped.get(l['id'])
            if not i:fail('ระบุผลตรวจรับให้ครบทุกแถว')
            accepted=integer(i.get('accepted'),'จำนวนผ่าน');rejected=integer(i.get('rejected'),'จำนวนไม่ผ่าน')
            if accepted+rejected!=l['quantity']:fail('จำนวนผ่านและไม่ผ่านต้องรวมเท่าจำนวนที่ส่ง')
            l.update(accepted=accepted,rejected=rejected,inspectionNote=string(i,'note','ผลตรวจ',bool(rejected),1000))
        data['inspector']=string(body,'inspector','ชื่อผู้ตรวจรับ/คณะกรรมการ',not bool(body.get('inspectorId')))
        data['inspectionReference']=string(body,'inspectionReference','คำสั่งแต่งตั้ง/เลขเอกสารตรวจรับ',True)
        reference(db,body,row['account_id'],row['branch_id'],'inspector',data,True)
        data['inspectionDate']=on_date(body.get('inspectionDate'))
        if data['inspectionDate']<data['date']:fail('วันตรวจรับต้องไม่ก่อนวันรับของ')
        status='inspected' if any(l['accepted'] for l in data['lines']) else 'rejected'
    elif action=='register':
        role(body,OFFICER)
        if row['kind']!='receipt' or status!='inspected':fail('ต้องตรวจรับผ่านก่อนขึ้นทะเบียน')
        lineid=integer(body.get('lineId'),'แถว',1,30);line=next((l for l in data['lines'] if l['id']==lineid),None)
        if not line or not line.get('accepted'):fail('แถวนี้ไม่มีรายการผ่านตรวจรับ')
        if db.execute('SELECT 1 FROM supply_receipt_assets WHERE document_id=? AND line_id=?',(did,lineid)).fetchone():fail('แถวนี้ขึ้นทะเบียนแล้ว',409)
        acquired=on_date(body.get('acquisitionDate'))
        start=on_date(body.get('depreciationStartDate')) if body.get('depreciationStartDate') else ''
        if start and start<acquired:fail('วันเริ่มคิดค่าเสื่อมต้องไม่ก่อนวันที่ได้มา')
        serials=body.get('serialNumbers',[])
        if not isinstance(serials,list) or (serials and len(serials)!=line['accepted']):fail('ใส่ซีเรียลให้ครบจำนวนผ่าน หรือเว้นว่างทั้งหมด')
        serials=[text(s,'ซีเรียล',160,False) for s in serials] or ['']*line['accepted']
        nonblank=[s for s in serials if s]
        if len(set(nonblank))!=len(nonblank):fail('ซีเรียลซ้ำในรายการ')
        for serial in nonblank:
            if db.execute('SELECT 1 FROM assets WHERE numbering_account_id=? AND serial_number=?',(row['account_id'],serial)).fetchone():fail('ซีเรียลนี้มีในบัญชีหน่วยงานแล้ว',409)
        for serial in serials:
            a=create_asset(db,{'actor':OFFICER,'accountId':row['account_id'],'branchId':row['branch_id'],
                'categoryId':line['categoryId'],'catalogId':ident(body.get('catalogId')),
                'expectedSelection':body.get('expectedSelection'),
                'name':line['name'],'model':line['model'],'serialNumber':serial,'location':data['location'],
                'purchasePrice':float(line['unitPrice']),'acquisitionDate':acquired},stamp())
            dep=json.loads(db.execute('SELECT depreciation_rule_snapshot FROM assets WHERE id=?',(a['id'],)).fetchone()[0]);dep['startDate']=start
            db.execute('UPDATE assets SET depreciation_rule_snapshot=? WHERE id=?',(dump(dep),a['id']))
            if not rules['registrationApproval']:
                db.execute("UPDATE assets SET status='ทะเบียนแล้ว' WHERE id=?",(a['id'],))
                db.execute("INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,'ลงทะเบียนตามเงื่อนไขใบรับเข้า','รออนุมัติ','ทะเบียนแล้ว',?,?)",(a['id'],OFFICER,row['number'],stamp()))
            db.execute('INSERT INTO asset_acquisitions(asset_id,acquired_on,delivered_on,document_no,po_no,quantity,unit_price,total_price,vendor_name,model,serial_number) VALUES(?,?,?,?,?,1,?,?,?,?,?)',(a['id'],acquired,data['date'],data['deliveryNo'],data['poNo'],float(line['unitPrice']),float(line['unitPrice']),data['supplier'],line['model'],serial))
            supplier=data.get('masterLinks',{}).get('supplier',{}).get('extra',{})
            db.execute('UPDATE asset_acquisitions SET vendor_address=?,vendor_phone=? WHERE asset_id=?',(supplier.get('address',''),supplier.get('phone',''),a['id']))
            db.execute('UPDATE asset_acquisitions SET fiscal_year_th=?,fund_type=?,acquisition_method=?,gfmis_no=? WHERE asset_id=?',(data.get('fiscalYear',''),data.get('fundType',''),data.get('acquisitionMethod',''),data.get('gfmisNo',''),a['id']))
            db.execute('UPDATE assets SET fiscal_year_th=?,acquisition_method=?,po_no=?,gfmis_no=? WHERE id=?',(data.get('fiscalYear',''),data.get('acquisitionMethod',''),data['poNo'],data.get('gfmisNo',''),a['id']))
            db.execute('INSERT INTO supply_receipt_assets VALUES(?,?,?)',(did,lineid,a['id']))
        line['acquisitionDate']=acquired;line['depreciationStartDate']=start
        needed=sum(l['accepted'] for l in data['lines'])
        if db.execute('SELECT COUNT(*) FROM supply_receipt_assets WHERE document_id=?',(did,)).fetchone()[0]==needed:status='registered'
    elif action in ('approve','reject'):
        role(body,rules['approvalRole'])
        if row['kind']!='issue' or status!='pending':fail('ใบเบิกไม่ได้รออนุมัติ')
        data['approvalNote']=string(body,'note','เหตุผล',action=='reject',1000);data['approver']='' if body.get('operatorId') else string(body,'operator','ชื่อผู้พิจารณา',True,160)
        stage_master={};reference(db,body,row['account_id'],row['branch_id'],'operator',stage_master,True)
        data['approver']=stage_master['operator'];data.setdefault('stageMasters',{})['approval']=stage_master.get('masterLinks',{})
        status='approved' if action=='approve' else 'rejected'
        if action=='reject':db.execute('DELETE FROM supply_reservations WHERE document_id=?',(did,))
    elif action=='issue':
        role(body,rules['issueRole'])
        if row['kind']!='issue' or status!='approved':fail('ต้องผ่านอนุมัติก่อนจ่าย')
        data['issuer']='' if body.get('operatorId') else string(body,'operator','ชื่อผู้จ่าย',True,160);data['issuedOn']=on_date(body.get('date'));data['recipient']='' if body.get('recipientId') else string(body,'recipient','ชื่อผู้รับมอบ',True,160)
        stage_master={};reference(db,body,row['account_id'],row['branch_id'],'operator',stage_master,True);reference(db,body,row['account_id'],row['branch_id'],'recipient',stage_master,True)
        data['issuer']=stage_master['operator'];data['recipient']=stage_master['recipient'];data.setdefault('stageMasters',{})['issue']=stage_master.get('masterLinks',{})
        if data['issuedOn']<data['date']:fail('วันจ่ายต้องไม่ก่อนวันคำขอ')
        for aid in data['assetIds']:
            if not db.execute("SELECT 1 FROM assets a JOIN supply_reservations r ON r.asset_id=a.id WHERE a.id=? AND a.numbering_account_id=? AND r.document_id=? AND a.status IN ('ทะเบียนแล้ว','พร้อมใช้','สำรวจแล้ว','รอตรวจสอบ')",(aid,row['account_id'],did)).fetchone():fail('ครุภัณฑ์เปลี่ยนสถานะ/บัญชีหลังอนุมัติ กรุณาตรวจสอบก่อนจ่าย',409)
        data['items']=[dict(db.execute('SELECT id,code,name,location,serial_number FROM assets WHERE id=?',(i,)).fetchone()) for i in data['assetIds']]
        status='issued'
    elif action=='receive':
        if body.get('actor') not in ('ผู้แจ้ง',OFFICER):fail('ใช้บทบาทผู้แจ้งหรือเจ้าหน้าที่พัสดุเพื่อยืนยันรับมอบ',403)
        if row['kind']!='issue' or status!='issued':fail('ยังไม่ได้จ่ายครุภัณฑ์')
        stage_master={};reference(db,body,row['account_id'],row['branch_id'],'operator',stage_master,True)
        operator=stage_master['operator'];data.setdefault('stageMasters',{})['receive']=stage_master.get('masterLinks',{});data['receivedBy']=operator;data['receivedOn']=on_date(body.get('date'))
        if data['receivedOn']<data['issuedOn']:fail('วันรับมอบต้องไม่ก่อนวันจ่าย')
        for aid in data['assetIds']:
            old=db.execute('SELECT location,status,numbering_account_id FROM assets WHERE id=?',(aid,)).fetchone()
            source=next(a for a in data['items'] if a['id']==aid)
            if old['location']!=source['location']:fail('ที่ตั้งครุภัณฑ์เปลี่ยนระหว่างส่งมอบ กรุณาตรวจสอบก่อนยืนยัน',409)
            if old['numbering_account_id']!=row['account_id'] or old['status'] not in ('ทะเบียนแล้ว','พร้อมใช้','สำรวจแล้ว','รอตรวจสอบ'):fail('บัญชีหรือสถานะครุภัณฑ์เปลี่ยนหลังจ่าย กรุณาตรวจสอบ',409)
            db.execute('UPDATE assets SET location=?,updated_at=? WHERE id=?',(data['department'],stamp(),aid))
            db.execute('INSERT OR IGNORE INTO asset_profiles(asset_id) VALUES(?)',(aid,))
            db.execute('UPDATE asset_profiles SET custodian=? WHERE asset_id=?',(data['recipient'],aid))
            db.execute('INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)',(aid,body['actor'],'รับมอบตามใบจัดสรร',old['status'],old['status'],dump({'documentId':did,'number':row['number'],'from':old['location'],'to':data['department'],'recipient':data['recipient'],'confirmedBy':operator}),stamp()))
        db.execute('DELETE FROM supply_reservations WHERE document_id=?',(did,));status='completed'
    elif action=='cancel':
        role(body,OFFICER)
        if status not in ('draft','pending','approved','received'):fail('ยกเลิกขั้นตอนนี้ไม่ได้')
        data['cancelReason']=string(body,'note','เหตุผลยกเลิก',True,1000)
        db.execute('DELETE FROM supply_reservations WHERE document_id=?',(did,));status='cancelled'
    else:fail('ไม่รู้จักคำสั่ง')
    add_files(db,did,body.get('files',[]))
    db.execute('UPDATE supply_documents SET status=?,revision=revision+1,data_json=?,updated_at=? WHERE id=?',(status,dump(data),stamp(),did))
    event(db,did,body,action,{'status':status,'data':data})
    return detail(db,get_doc(db,did))
