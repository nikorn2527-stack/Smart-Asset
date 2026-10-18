"""Account-owned operational masters and immutable document references."""
import json
import re
import unicodedata
from governance import GovernanceError, OFFICER, ident, text, dump, check_account, audit

TYPES = {'supplier':'ผู้ขาย / ผู้ส่งมอบ','department':'หน่วยงาน / แผนก','location':'คลัง / สถานที่',
         'person':'บุคลากร','unit':'หน่วยนับ','method':'วิธีได้มา','fund':'แหล่งเงิน'}
EXTRAS = {'supplier':{'taxId':20,'address':1000,'phone':100,'contact':160},
          'person':{'position':160,'phone':100},'location':{'building':160,'floor':80}}
LINKS = {'supplier':('supplierId','supplier'),'location':('locationId','location'),
         'receiver':('receiverId','person'),'department':('departmentId','department'),
         'requester':('requesterId','person'),'recipient':('recipientId','person'),
         'inspector':('inspectorId','person'),'operator':('operatorId','person'),
         'fundType':('fundId','fund'),'acquisitionMethod':('methodId','method'),'unit':('unitId','unit')}

def fail(message,status=400):raise GovernanceError(message,status)
def normalized(value):return unicodedata.normalize('NFKC',' '.join(value.split())).casefold()
def item(row):
    result=dict(row);result['extra']=json.loads(result.pop('extra_json'));result['isActive']=bool(result.pop('is_active'))
    return result

def get_master(db,mid,aid,bid,kind,active=True):
    row=db.execute('SELECT * FROM operational_master WHERE id=? AND account_id=? AND kind=?',(ident(mid),aid,kind)).fetchone()
    if not row or (row['branch_id'] is not None and row['branch_id']!=bid):fail('ข้อมูลหลักไม่อยู่ในบัญชี/สาขาหรือประเภทที่เลือก')
    if active and not row['is_active']:fail('ข้อมูลหลักนี้ปิดใช้งานแล้ว กรุณาเลือกรายการที่ใช้งาน')
    return item(row)

def reference(db,body,aid,bid,field,data,required=False):
    idkey,kind=LINKS[field];mid=body.get(idkey)
    if mid in (None,''):
        data[field]=text(body.get(field,''),TYPES[kind],1000 if field=='location' else 300,required)
        return
    m=get_master(db,mid,aid,bid,kind)
    data[field]=m['name'];data.setdefault('masterLinks',{})[field]={k:m[k] for k in ('id','code','name','revision','kind','branch_id','extra')}

def check_references(db,data,aid,bid):
    for snapshot in data.get('masterLinks',{}).values():
        current=get_master(db,snapshot['id'],aid,bid,snapshot['kind'])
        if current['revision']!=snapshot['revision']:fail('ข้อมูลหลักถูกแก้ไขหลังบันทึกร่าง กรุณาแก้ร่างและเลือกข้อมูลล่าสุดก่อนส่ง',409)
    for line in data.get('lines',[]):check_references(db,line,aid,bid)

def candidates(db,aid,kind,q):
    # Imported organizations are not necessarily accounts. Follow actual account-owned asset links.
    statements={
      'supplier':"SELECT x.vendor_name AS name FROM asset_acquisitions x JOIN assets a ON a.id=x.asset_id WHERE a.numbering_account_id=?",
      'department':"SELECT u.name AS name FROM org_units u JOIN assets a ON (a.department_unit_id=u.id OR a.responsible_unit_id=u.id) WHERE a.numbering_account_id=?",
      'location':"SELECT a.location AS name FROM assets a WHERE a.numbering_account_id=?",
      'person':"SELECT p.custodian AS name FROM asset_profiles p JOIN assets a ON a.id=p.asset_id WHERE a.numbering_account_id=?",
      'method':"SELECT a.acquisition_method AS name FROM assets a WHERE a.numbering_account_id=?",
      'fund':"SELECT x.fund_type AS name FROM asset_acquisitions x JOIN assets a ON a.id=x.asset_id WHERE a.numbering_account_id=?",
      'unit':"SELECT json_extract(l.value,'$.unit') AS name FROM supply_documents s,json_each(s.data_json,'$.lines') l WHERE s.kind='receipt' AND s.account_id=?"}
    return [r['name'] for r in db.execute('SELECT DISTINCT trim(name) AS name FROM ('+statements[kind]+") WHERE trim(COALESCE(name,''))<>'' AND name LIKE ? ORDER BY name LIMIT 100",(aid,'%'+q+'%'))]

def handle(db,method,path,query,body):
    if not path.startswith('/api/operational-master'):return None
    one=lambda k,default='':query.get(k,[default])[0]
    if method=='GET':
        try:aid=ident(int(one('accountId')));bid=ident(int(one('branchId')),True) if one('branchId') else None
        except (TypeError,ValueError):fail('เลือกบัญชีหน่วยงานและสาขาให้ถูกต้อง')
        check_account(db,aid,bid);kind=one('kind');q=str(one('q'))[:200]
        if kind and kind not in TYPES:fail('ประเภทข้อมูลหลักไม่ถูกต้อง')
        if path=='/api/operational-master/candidates':
            if kind not in TYPES:fail('เลือกประเภทข้อมูลหลักก่อน')
            return {'items':candidates(db,aid,kind,q),'source':'ข้อความที่พบในข้อมูลของบัญชีนี้ ยังไม่ใช่ข้อมูลหลักจนกว่าจะเพิ่มและตรวจสอบ'}
        if path!='/api/operational-master':fail('ไม่พบเส้นทาง',404)
        try:offset=max(0,int(one('offset','0')));limit=max(1,min(200,int(one('limit','50'))))
        except ValueError:fail('หน้ารายการไม่ถูกต้อง')
        where='m.account_id=?';args=[aid]
        if kind:where+=' AND m.kind=?';args.append(kind)
        if one('allBranches')!='1':where+=' AND (m.branch_id IS NULL OR m.branch_id=?)';args.append(bid)
        if one('includeInactive')!='1':where+=' AND m.is_active=1'
        if q:where+=' AND (m.name LIKE ? OR m.code LIKE ?)';args.extend(['%'+q+'%']*2)
        total=db.execute('SELECT COUNT(*) FROM operational_master m WHERE '+where,args).fetchone()[0]
        rows=db.execute('SELECT m.*,b.name AS branchName,p.name AS parentName FROM operational_master m LEFT JOIN account_branches b ON b.id=m.branch_id LEFT JOIN operational_master p ON p.id=m.parent_id WHERE '+where+' ORDER BY m.is_active DESC,m.name,m.id LIMIT ? OFFSET ?',[*args,limit,offset]).fetchall()
        return {'items':[item(r) for r in rows],'total':total,'limit':limit,'offset':offset,'types':TYPES}
    if method not in ('POST','PUT'):fail('ไม่รองรับคำสั่ง',405)
    if body.get('actor')!=OFFICER:fail('ใช้บทบาทเจ้าหน้าที่พัสดุเพื่อจัดการข้อมูลหลัก',403)
    if path!='/api/operational-master':fail('ไม่พบเส้นทาง',404)
    aid=ident(body.get('accountId'));bid=ident(body.get('branchId'),True);check_account(db,aid,bid)
    kind=body.get('kind')
    if kind not in TYPES:fail('ประเภทข้อมูลหลักไม่ถูกต้อง')
    name=text(body.get('name'),TYPES[kind],{'person':160,'unit':40,'method':160}.get(kind,300));code=text(body.get('code',''),'รหัสข้อมูลหลัก',40,False)
    if code and not re.fullmatch(r'[A-Za-z0-9ก-๙._/-]{1,40}',code):fail('รหัสใช้ตัวอักษร ตัวเลข จุด ขีด และ / โดยไม่เว้นวรรค')
    active=body.get('isActive',True)
    if type(active) is not bool:fail('สถานะใช้งานไม่ถูกต้อง')
    extra=body.get('extra',{})
    if not isinstance(extra,dict) or set(extra)-set(EXTRAS.get(kind,{})):fail('รายละเอียดข้อมูลหลักไม่ถูกต้อง')
    extra={k:text(v,'รายละเอียด',EXTRAS[kind][k],False) for k,v in extra.items()}
    note=text(body.get('notes',''),'หมายเหตุ',1000,False);parent=ident(body.get('parentId'),True)
    db.execute('BEGIN IMMEDIATE');old=None;mid=ident(body.get('id'),True)
    if method=='PUT':
        if not mid:fail('ไม่พบรหัสรายการ')
        row=db.execute('SELECT * FROM operational_master WHERE id=?',(mid,)).fetchone()
        if not row or row['account_id']!=aid or row['kind']!=kind:fail('ไม่พบข้อมูลหลักในบัญชีนี้',404)
        old=item(row)
        if body.get('revision')!=old['revision']:fail('ข้อมูลหลักถูกแก้ไขแล้ว กรุณาเปิดรายการล่าสุด',409)
        if old['branch_id']!=bid:fail('เปลี่ยนขอบเขตสาขาของรายการเดิมไม่ได้ กรุณาสร้างรายการใหม่')
    elif mid:fail('การเพิ่มใหม่ไม่ต้องระบุรหัสรายการ')
    if parent:
        if kind not in ('department','location','person'):fail('ข้อมูลประเภทนี้ไม่มีหน่วยงานแม่')
        get_master(db,parent,aid,bid,'department')
        seen={mid} if mid else set();current=parent
        while current:
            if current in seen:fail('หน่วยงานแม่วนกลับมาที่รายการเดิม')
            seen.add(current);current=db.execute('SELECT parent_id FROM operational_master WHERE id=?',(current,)).fetchone()[0]
    duplicate=db.execute('SELECT id FROM operational_master WHERE account_id=? AND kind=? AND COALESCE(branch_id,0)=? AND name_key=? AND id<>?',(aid,kind,bid or 0,normalized(name),mid or 0)).fetchone()
    if duplicate:fail('มีชื่อนี้ในข้อมูลหลักแล้ว รวมถึงรายการที่ปิดใช้งาน กรุณาแก้หรือเปิดใช้รายการเดิม',409)
    if code and db.execute('SELECT 1 FROM operational_master WHERE account_id=? AND kind=? AND code_key=? AND id<>?',(aid,kind,normalized(code),mid or 0)).fetchone():fail('รหัสข้อมูลหลักซ้ำในบัญชีนี้',409)
    if old:
        code=code or old['code']
        db.execute('UPDATE operational_master SET name=?,name_key=?,code=?,code_key=?,parent_id=?,extra_json=?,notes=?,is_active=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',(name,normalized(name),code,normalized(code),parent,dump(extra),note,int(active),mid))
    else:
        # A temporary code stays inside the transaction; the actual ID makes generated codes unique.
        import uuid
        provisional=code or ('tmp-'+uuid.uuid4().hex)
        mid=db.execute('INSERT INTO operational_master(account_id,branch_id,kind,code,code_key,name,name_key,parent_id,extra_json,notes,is_active) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(aid,bid,kind,provisional,normalized(provisional),name,normalized(name),parent,dump(extra),note,int(active))).lastrowid
        if not code:
            code=kind.upper()+'-'+str(mid).zfill(6)
            if db.execute('SELECT 1 FROM operational_master WHERE account_id=? AND kind=? AND code_key=? AND id<>?',(aid,kind,normalized(code),mid)).fetchone():fail('รหัสอัตโนมัติชนกับรหัสเดิม กรุณาระบุรหัสเอง',409)
            db.execute('UPDATE operational_master SET code=?,code_key=? WHERE id=?',(code,normalized(code),mid))
    result=item(db.execute('SELECT * FROM operational_master WHERE id=?',(mid,)).fetchone())
    audit(db,body['actor'],'operational-master',mid,old,result)
    return result,200 if old else 201
