"""Everyday category and asset editing without exposing numbering implementation details."""
import hashlib
import json
import math
import re
import sqlite3
from datetime import date,datetime,timezone
from governance import (GovernanceError,OFFICER,ident,text,dump,today,check_account,
                        selected_binding,policy_snapshot,parse_pattern,audit,resolve,calculate)

PRESETS={
 'fsn':('{group:4}-{type:3}-{detail:4}','classification','เลขจำแนก 4–3–4'),
 'inventory':('{group:4}-{type:3}-{detail:4}-{seq:4}','inventory','เลขประจำชิ้น 4–3–4–4'),
}

def initialize(path):
    with sqlite3.connect(path) as db:
        db.execute('''CREATE TABLE IF NOT EXISTS account_category_labels(account_id INTEGER NOT NULL REFERENCES asset_accounts(id),category_id INTEGER NOT NULL REFERENCES asset_categories(id),name TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(account_id,category_id))''')
        if not db.execute("SELECT 1 FROM schema_migrations WHERE name='workspace-pending-kinds-v1'").fetchone():
            # The immutable original profile identifies the archive owner even after a unit rename.
            owner=db.execute("SELECT account_id FROM number_profiles WHERE source LIKE 'ทะเบียน Excel ในครุภัณฑ์แยกประเภท.rar%' ORDER BY id LIMIT 1").fetchone()
            if owner:
                for cid,name,source in db.execute("SELECT r.category_id,r.type_name,s.title FROM starter_catalog_rows r JOIN source_documents s ON s.id=r.source_document_id WHERE r.fsn_code=''").fetchall():
                    db.execute('INSERT OR IGNORE INTO account_catalog(account_id,category_id,name,code,values_json,source) VALUES(?,?,?,?,?,?)',(owner[0],cid,name or 'ไม่ระบุชนิดในต้นทาง','','{}',source))
            db.execute("INSERT INTO schema_migrations(name) VALUES('workspace-pending-kinds-v1')")


def fingerprint(value):return hashlib.sha256(dump(value).encode()).hexdigest()

def context(db,aid,bid,cid,on):
    nb,pb=selected_binding(db,aid,bid,cid,on)
    profile=dict(db.execute('SELECT * FROM number_profiles WHERE id=?',(nb['profile_id'],)).fetchone()) if nb else None
    policy=policy_snapshot(db,pb['policy_id']) if pb else None
    own=db.execute('''SELECT * FROM account_bindings WHERE account_id=? AND COALESCE(branch_id,0)=? AND category_id=? AND effective_from<=? AND is_active=1 ORDER BY effective_from DESC LIMIT 1''',(aid,bid or 0,cid,on)).fetchone()
    alias=db.execute('SELECT * FROM account_category_labels WHERE account_id=? AND category_id=?',(aid,cid)).fetchone()
    eligible=[dict(r) for r in db.execute('''SELECT * FROM account_bindings WHERE account_id=? AND (branch_id IS NULL OR branch_id=?) AND (category_id IS NULL OR category_id=?) AND effective_from<=? ORDER BY id''',(aid,bid,cid,on))]
    result={'profile':profile,'policy':policy,'ownBinding':dict(own) if own else None,'alias':dict(alias) if alias else None}
    result['version']=fingerprint({'result':result,'rules':eligible,'date':on,'branch':bid,'category':cid})
    return result

def category_rows(db,query):
    def one(k,default=''):return query.get(k,[default])[0]
    try:aid=ident(int(one('accountId')));bid=ident(int(one('branchId')),True) if one('branchId') else None
    except (TypeError,ValueError):raise GovernanceError('เลือกหน่วยงานและสาขาให้ถูกต้อง')
    check_account(db,aid,bid);on=one('date') or today().isoformat()
    try:date.fromisoformat(on)
    except ValueError:raise GovernanceError('วันที่ใช้หลักเกณฑ์ไม่ถูกต้อง')
    totals={r['category_id']:r['n'] for r in db.execute('SELECT category_id,COUNT(*) AS n FROM assets WHERE numbering_account_id=?'+(' AND branch_id=?' if bid else '')+' GROUP BY category_id',([aid,bid] if bid else [aid]))}
    kinds={r['category_id']:r['n'] for r in db.execute('SELECT category_id,COUNT(DISTINCT name) AS n FROM account_catalog WHERE account_id=? GROUP BY category_id',(aid,))}
    rows=[]
    for category in db.execute('SELECT id,category_name,source_workbook,notes FROM asset_categories WHERE is_active=1 ORDER BY category_name,id').fetchall():
        resolved=context(db,aid,bid,category['id'],on)
        rows.append({'id':category['id'],'name':resolved['alias']['name'] if resolved['alias'] else category['category_name'],'notes':resolved['alias']['notes'] if resolved['alias'] else category['notes'],'sourceName':category['category_name'],'sourceFile':category['source_workbook'],'assetCount':totals.get(category['id'],0),'kindCount':kinds.get(category['id'],0),**resolved})
    return {'accountId':aid,'branchId':bid,'date':on,'items':rows}

def save_category(db,body):
    if body.get('actor')!=OFFICER:raise GovernanceError('เลือกบทบาทเจ้าหน้าที่พัสดุเพื่อแก้ไข',403)
    aid=ident(body.get('accountId'));bid=ident(body.get('branchId'),True);cid=ident(body.get('categoryId'));check_account(db,aid,bid)
    cat=db.execute('SELECT * FROM asset_categories WHERE id=? AND is_active=1',(cid,)).fetchone()
    if not cat:raise GovernanceError('ไม่พบหมวดที่เปิดใช้')
    on=body.get('date') or today().isoformat()
    try:date.fromisoformat(on)
    except (ValueError,TypeError):raise GovernanceError('วันที่ใช้หลักเกณฑ์ไม่ถูกต้อง')
    db.execute('BEGIN IMMEDIATE');before=context(db,aid,bid,cid,on)
    if body.get('version')!=before['version']:raise GovernanceError('แถวนี้ถูกแก้ไขแล้ว ปิดแถวและเปิดใหม่เพื่ออ่านฉบับล่าสุด ร่างนี้ยังไม่ถูกบันทึก',409)
    name=text(body.get('name'),'ชื่อหมวด',300);notes=text(body.get('notes',''),'หมายเหตุหมวด',1000,False)
    choice=body.get('profileChoice','inherit');pid=None
    if isinstance(choice,str) and choice.startswith('preset:'):
        preset=PRESETS.get(choice.split(':',1)[1])
        if not preset:raise GovernanceError('ไม่พบแบบเลขสำเร็จรูป')
        pattern,kind,label=preset;parse_pattern(pattern,kind)
        found=db.execute('SELECT id FROM number_profiles WHERE account_id=? AND pattern=? AND number_kind=? ORDER BY id LIMIT 1',(aid,pattern,kind)).fetchone()
        pid=found[0] if found else db.execute('INSERT INTO number_profiles(account_id,name,pattern,number_kind,source) VALUES(?,?,?,?,?)',(aid,label,pattern,kind,'เลือกแบบสำเร็จรูปในตารางหมวด')).lastrowid
    elif choice!='inherit':
        try:pid=ident(int(choice))
        except (ValueError,TypeError):raise GovernanceError('เลือกแบบเลขให้ถูกต้อง')
        if not db.execute('SELECT 1 FROM number_profiles WHERE id=? AND account_id=?',(pid,aid)).fetchone():raise GovernanceError('แบบเลขไม่อยู่ในหน่วยงานนี้')
    policy=ident(body.get('policyId'),True)
    if policy:policy_snapshot(db,policy)
    previous=db.execute('SELECT * FROM account_bindings WHERE account_id=? AND COALESCE(branch_id,0)=? AND category_id=? AND effective_from=?',(aid,bid or 0,cid,on)).fetchone()
    if previous:
        db.execute('UPDATE account_bindings SET profile_id=?,policy_id=?,is_active=1,notes=?,revision=revision+1 WHERE id=?',(pid,policy,notes,previous['id']))
    else:db.execute('INSERT INTO account_bindings(account_id,branch_id,category_id,profile_id,policy_id,effective_from,notes) VALUES(?,?,?,?,?,?,?)',(aid,bid,cid,pid,policy,on,notes))
    db.execute('''INSERT INTO account_category_labels(account_id,category_id,name,notes) VALUES(?,?,?,?) ON CONFLICT(account_id,category_id) DO UPDATE SET name=excluded.name,notes=excluded.notes,revision=account_category_labels.revision+1''',(aid,cid,name,notes))
    audit(db,body['actor'],'category-workspace',cid,before,{'accountId':aid,'branchId':bid,'date':on,'name':name,'notes':notes,'profileId':pid,'policyId':policy})
    return {'ok':True}

# All old source rows and depreciation snapshots stay immutable. Only current fields change.
FIELDS={'name':('name',300),'code':('code',80),'detail':('detail',1000),'location':('location',300),'assetType':('asset_type',300),'model':('model',160),'gfmisNo':('gfmis_no',100),'poNo':('po_no',100),'fiscalYear':('fiscal_year_th',10),'acquisitionMethod':('acquisition_method',160),'serialNumber':('serial_number',160),'custodian':('custodian',160),'warrantyEnd':('warranty_end',10),'acquisitionDate':('acquisition_date',30)}

def asset_state(db,asset_id):
    row=db.execute('SELECT * FROM assets WHERE id=?',(asset_id,)).fetchone()
    if not row:raise GovernanceError('ไม่พบครุภัณฑ์',404)
    profile=db.execute('SELECT * FROM asset_profiles WHERE asset_id=?',(asset_id,)).fetchone()
    raw=dict(row);meta=dict(profile) if profile else {}
    fields={k:(meta.get(col) if k in ('custodian','warrantyEnd','serialNumber') and meta.get(col) is not None else raw.get(col,'')) for k,(col,_) in FIELDS.items()}
    fields.update(accountId=row['numbering_account_id'],branchId=row['branch_id'],categoryId=row['category_id'],purchasePrice=row['purchase_price'])
    fields['depreciationStartDate']=json.loads(row['depreciation_rule_snapshot']).get('startDate',row['acquisition_date'])
    numbering=json.loads(row['numbering_snapshot'])
    copy_catalog=numbering.get('catalog',{}).get('id') if numbering.get('catalog') else None
    if not copy_catalog and row['numbering_account_id'] and row['fsn_code']:
        matches=db.execute('SELECT id FROM account_catalog WHERE account_id=? AND category_id=? AND code=? AND name=? LIMIT 2',(row['numbering_account_id'],row['category_id'],row['fsn_code'],row['asset_type'])).fetchall()
        if len(matches)==1:copy_catalog=matches[0][0]
    return {'fsnCode':row['fsn_code'],'copyCatalogId':copy_catalog,'id':asset_id,'fields':fields,'numbering':json.loads(row['numbering_snapshot']),'depreciation':json.loads(row['depreciation_rule_snapshot']),'sourceDocumentId':row['source_document_id'],'version':fingerprint({'asset':raw,'profile':meta}),'status':row['status']}

def save_asset(db,asset_id,body):
    if body.get('actor')!=OFFICER:raise GovernanceError('เลือกบทบาทเจ้าหน้าที่พัสดุเพื่อแก้ไข',403)
    changes=body.get('changes')
    allowed=set(FIELDS)|{'accountId','branchId','categoryId','purchasePrice','depreciationStartDate'}
    if not isinstance(changes,dict) or set(changes)-allowed:raise GovernanceError('ข้อมูลแก้ไขไม่ถูกต้อง')
    db.execute('BEGIN IMMEDIATE');before=asset_state(db,asset_id)
    if before['version']!=body.get('version'):raise GovernanceError('ทะเบียนถูกแก้ไขแล้ว เปิดแถวใหม่ก่อนบันทึก ร่างปัจจุบันยังไม่ถูกส่งทับ',409)
    protected={'accountId','branchId','code','location','custodian','serialNumber'}
    if protected.intersection(changes) and db.execute('SELECT 1 FROM supply_reservations WHERE asset_id=?',(asset_id,)).fetchone():
        raise GovernanceError('รายการนี้อยู่ระหว่างเบิก/จัดสรร กรุณาดำเนินใบงานให้เสร็จหรือยกเลิกก่อนแก้บัญชี เลข ที่ตั้ง หรือผู้ดูแล',409)
    fields={**before['fields'],**changes}
    if 'acquisitionDate' in changes and 'depreciationStartDate' not in changes and 'startDate' not in before['depreciation']:
        fields['depreciationStartDate']=fields['acquisitionDate']
    for key,(col,limit) in FIELDS.items():
        if key not in changes:continue
        fields[key]=text(fields[key],key,limit,key in ('name','code'))
    for key in ('acquisitionDate','warrantyEnd','depreciationStartDate'):
        if key in changes and fields[key]:
            try:date.fromisoformat(fields[key])
            except (ValueError,TypeError):raise GovernanceError('รูปแบบวันที่ไม่ถูกต้อง')
    if ('depreciationStartDate' in changes or 'acquisitionDate' in changes) and fields['depreciationStartDate'] and re.fullmatch(r'\d{4}-\d{2}-\d{2}',fields['acquisitionDate'] or '') and fields['depreciationStartDate']<fields['acquisitionDate']:
        raise GovernanceError('วันเริ่มคิดค่าเสื่อมต้องไม่ก่อนวันที่ได้มา')
    for key in ('accountId','branchId'):fields[key]=ident(fields[key],True)
    fields['categoryId']=ident(fields['categoryId'])
    cat=db.execute('SELECT * FROM asset_categories WHERE id=? AND is_active=1',(fields['categoryId'],)).fetchone()
    if not cat:raise GovernanceError('ไม่พบหมวดที่เปิดใช้งาน')
    if fields['accountId']:check_account(db,fields['accountId'],fields['branchId'])
    elif fields['branchId']:raise GovernanceError('เลือกเจ้าของบัญชีก่อนเลือกสาขา')
    if 'purchasePrice' in changes:
        if fields['purchasePrice'] in (None,''):fields['purchasePrice']=None
        else:
            try:fields['purchasePrice']=float(fields['purchasePrice'])
            except (ValueError,TypeError):raise GovernanceError('ราคาทุนต้องเป็นตัวเลข')
            if not math.isfinite(fields['purchasePrice']) or fields['purchasePrice']<0:raise GovernanceError('ราคาทุนไม่ถูกต้อง')
    sensitive=any(fields[k]!=before['fields'][k] for k in ('accountId','branchId','categoryId','code','purchasePrice','acquisitionDate','depreciationStartDate'))
    action=body.get('policyAction','keep')
    if action not in ('keep','inherit','override','unassigned'):raise GovernanceError('การเลือกหลักเกณฑ์ไม่ถูกต้อง')
    reason=text(body.get('reason',''),'เหตุผลการเปลี่ยนเลข หมวด หรือหลักเกณฑ์',1000,sensitive or action!='keep')
    numbering=before['numbering'];depreciation=before['depreciation']
    unique=db.execute('SELECT code_unique FROM assets WHERE id=?',(asset_id,)).fetchone()[0]
    original_unique=unique
    # Reassigning the account/category must explicitly choose how to handle the policy.
    reclassify=any(fields[k]!=before['fields'][k] for k in ('accountId','categoryId'))
    if reclassify and action=='keep':raise GovernanceError('เปลี่ยนหน่วยงานหรือหมวด กรุณาเลือกใช้ค่าเสื่อมตามหมวด หรือระบุข้อยกเว้น')
    if reclassify or fields['code']!=before['fields']['code']:
        if fields['accountId']:
            resolved=resolve(db,{'accountId':fields['accountId'],'branchId':fields['branchId'],'categoryId':fields['categoryId'],'manualCode':fields['code'],'acquisitionDate':fields['acquisitionDate'] if re.fullmatch(r'\d{4}-\d{2}-\d{2}',fields['acquisitionDate'] or '') else '', 'actor':OFFICER})
            numbering={**resolved,'manualOriginal':True,'amendmentReason':reason}
            unique=int(resolved['profile']['number_kind']=='inventory')
        else:numbering={'manualOriginal':True,'amendmentReason':reason};unique=1
    if (unique!=original_unique or any(fields[k]!=before['fields'][k] for k in ('accountId','code'))) and db.execute('''SELECT 1 FROM assets WHERE COALESCE(numbering_account_id,0)=? AND code=? AND id<>? AND (?=1 OR code_unique=1)''',(fields['accountId'] or 0,fields['code'],asset_id,unique)).fetchone():raise GovernanceError('เลขซ้ำในบัญชีหน่วยงานนี้ กรุณาตรวจรายการ',409)
    if action!='keep':
        selected=None
        if action=='override':selected=policy_snapshot(db,ident(body.get('policyId')))
        elif action=='inherit':
            if not fields['accountId']:raise GovernanceError('เลือกหน่วยงานก่อนใช้หลักเกณฑ์ตามหมวด')
            policy_date=fields['acquisitionDate'] if re.fullmatch(r'\d{4}-\d{2}-\d{2}',fields['acquisitionDate'] or '') else today().isoformat()
            _,pb=selected_binding(db,fields['accountId'],fields['branchId'],fields['categoryId'],policy_date)
            if pb:selected=policy_snapshot(db,pb['policy_id'])
        depreciation={'policy':selected or {},'overrideReason':reason,'recordedAt':datetime.now(timezone.utc).isoformat(),'previousPolicyId':before['depreciation'].get('policy',{}).get('id'),'calculationConvention':'actual_days_365_excluding_start'}
    if 'startDate' in before['depreciation'] or 'depreciationStartDate' in changes:
        depreciation={**depreciation,'startDate':fields['depreciationStartDate']}
    numbering={**numbering,'currentFields':{**before['numbering'].get('currentFields',{}),**{k:True for k in changes}}}
    policy=depreciation.get('policy') or {}
    alias=db.execute('SELECT name FROM account_category_labels WHERE account_id=? AND category_id=?',(fields['accountId'],fields['categoryId'])).fetchone()
    # Only send fields explicitly changed, preserving unknown legacy formats and values.
    assignments={FIELDS[key][0]:fields[key] for key in changes if key in FIELDS and key not in ('custodian','warrantyEnd')}
    assignments.update(numbering_account_id=fields['accountId'],branch_id=fields['branchId'],category_id=fields['categoryId'],group_name=alias[0] if alias else cat['category_name'],code_unique=unique,numbering_snapshot=dump(numbering),depreciation_rule_snapshot=dump(depreciation),updated_at=datetime.now(timezone.utc).isoformat())
    if 'purchasePrice' in changes:assignments['purchase_price']=fields['purchasePrice']
    if action!='keep':assignments['depreciation_policy_id']=policy.get('id');assignments['useful_life_years']=policy.get('useful_life_years')
    if any(k in changes for k in ('code','categoryId','accountId')):assignments['fsn_code']=''  # Never invent an FSN mapping for an amended manual number.
    db.execute('UPDATE assets SET '+','.join(k+'=?' for k in assignments)+' WHERE id=?',(*assignments.values(),asset_id))
    if any(k in changes for k in ('serialNumber','custodian','warrantyEnd')):
        db.execute('''INSERT INTO asset_profiles(asset_id,serial_number,custodian,warranty_end) VALUES(?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET serial_number=excluded.serial_number,custodian=excluded.custodian,warranty_end=excluded.warranty_end''',(asset_id,fields['serialNumber'] or '',fields['custodian'] or '',fields['warrantyEnd'] or ''))
    after=asset_state(db,asset_id)
    db.execute('INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)',(asset_id,OFFICER,'แก้ไขจากแถวทะเบียน',before['status'],before['status'],dump({'before':before['fields'],'after':after['fields'],'beforeDepreciation':before['depreciation'],'afterDepreciation':after['depreciation'],'beforeNumbering':before['numbering'],'afterNumbering':after['numbering'],'reason':reason}),datetime.now(timezone.utc).isoformat()))
    return {'ok':True,'id':asset_id}

def handle(db,method,path,query,body):
    if not path.startswith('/api/workspace/'):return None
    if path=='/api/workspace/categories':
        if method=='GET':return category_rows(db,query)
        if method=='PUT':return save_category(db,body)
    match=re.fullmatch(r'/api/workspace/assets/(\d+)',path)
    if match:
        if method=='GET':return asset_state(db,int(match[1]))
        if method=='PUT':return save_asset(db,int(match[1]),body)
    raise GovernanceError('ไม่พบคำสั่ง',404)
