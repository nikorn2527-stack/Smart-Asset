"""Account-scoped numbering and depreciation. Existing asset IDs and evidence survive upgrades."""
import json
import hashlib
import re
import sqlite3
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

OFFICER = 'เจ้าหน้าที่พัสดุ'
VARIABLES = {'group', 'type', 'detail', 'category', 'branch', 'department', 'prefix', 'year', 'yearBE', 'month', 'seq'}
TOKEN = re.compile(r'\{([A-Za-z]+):([0-9]+)\}')

class GovernanceError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message); self.status = status

def text(value, label, limit=300, required=True):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise GovernanceError('กรุณาตรวจ' + label)
    return value.strip()

def ident(value, optional=False):
    if optional and value in (None, ''): return None
    if type(value) is not int or value <= 0 or value > 2**53: raise GovernanceError('รหัสรายการไม่ถูกต้อง')
    return value

def dump(value): return json.dumps(value, ensure_ascii=False, sort_keys=True)

def today(): return datetime.now(timezone(timedelta(hours=7))).date()

def audit(db, actor, kind, entity_id, before, after):
    db.execute('INSERT INTO account_events(actor,kind,entity_id,before_json,after_json) VALUES(?,?,?,?,?)', (actor,kind,entity_id,dump(before),dump(after)))

def _initialize_account_schema(db_path):
    """Backup before DDL; rebuild only the old global code constraint in one transaction."""
    from backup_store import snapshot_database
    db = sqlite3.connect(db_path); db.row_factory = sqlite3.Row
    try:
        if db.execute("SELECT 1 FROM schema_migrations WHERE name='account-numbering-v1'").fetchone(): return
        snapshot_database(db_path, 'before-account-numbering')
        db.execute('PRAGMA foreign_keys=OFF')
        db.execute('BEGIN IMMEDIATE')
        # Keep DDL transactional: executescript would commit an open migration.
        statements = [
          '''CREATE TABLE IF NOT EXISTS asset_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,code TEXT NOT NULL UNIQUE,notes TEXT NOT NULL DEFAULT '',is_active INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1)''',
          '''CREATE TABLE IF NOT EXISTS account_branches(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES asset_accounts(id),name TEXT NOT NULL,code TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1,UNIQUE(account_id,code))''',
          '''CREATE TABLE IF NOT EXISTS number_profiles(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES asset_accounts(id),name TEXT NOT NULL,pattern TEXT NOT NULL,number_kind TEXT NOT NULL,reset_policy TEXT NOT NULL DEFAULT 'never',sequence_scope TEXT NOT NULL DEFAULT 'account',version INTEGER NOT NULL DEFAULT 1,supersedes_id INTEGER REFERENCES number_profiles(id),source TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)''',
          '''CREATE TABLE IF NOT EXISTS account_bindings(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES asset_accounts(id),branch_id INTEGER REFERENCES account_branches(id),category_id INTEGER REFERENCES asset_categories(id),profile_id INTEGER REFERENCES number_profiles(id),policy_id INTEGER REFERENCES depreciation_policies(id),effective_from TEXT NOT NULL DEFAULT '1900-01-01',revision INTEGER NOT NULL DEFAULT 1,is_active INTEGER NOT NULL DEFAULT 1,notes TEXT NOT NULL DEFAULT '')''',
          '''CREATE UNIQUE INDEX IF NOT EXISTS idx_account_bindings_scope ON account_bindings(account_id,COALESCE(branch_id,0),COALESCE(category_id,0),effective_from)''',
          '''CREATE TABLE IF NOT EXISTS account_catalog(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES asset_accounts(id),category_id INTEGER NOT NULL REFERENCES asset_categories(id),name TEXT NOT NULL,code TEXT NOT NULL,values_json TEXT NOT NULL,source TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,UNIQUE(account_id,category_id,name,code))''',
          '''CREATE TABLE IF NOT EXISTS account_sequences(account_id INTEGER NOT NULL REFERENCES asset_accounts(id),profile_id INTEGER NOT NULL REFERENCES number_profiles(id),scope_key TEXT NOT NULL,value INTEGER NOT NULL,PRIMARY KEY(account_id,profile_id,scope_key))''',
          '''CREATE TABLE IF NOT EXISTS account_events(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,kind TEXT NOT NULL,entity_id INTEGER,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)''',
          '''CREATE TABLE IF NOT EXISTS source_attachments(id INTEGER PRIMARY KEY AUTOINCREMENT,filename TEXT NOT NULL,stored_name TEXT NOT NULL UNIQUE,sha256 TEXT NOT NULL,byte_size INTEGER NOT NULL,account_id INTEGER REFERENCES asset_accounts(id),purpose TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(sha256,account_id,purpose))'''
        ]
        for statement in statements: db.execute(statement)
        columns={r['name'] for r in db.execute('PRAGMA table_info(assets)')}
        extensions={'numbering_account_id':'INTEGER REFERENCES asset_accounts(id)', 'branch_id':'INTEGER REFERENCES account_branches(id)', 'numbering_profile_id':'INTEGER REFERENCES number_profiles(id)', 'numbering_snapshot':"TEXT NOT NULL DEFAULT '{}'",'depreciation_rule_snapshot':"TEXT NOT NULL DEFAULT '{}'",'code_unique':'INTEGER NOT NULL DEFAULT 1'}
        for key, declaration in extensions.items():
            if key not in columns: db.execute(f'ALTER TABLE assets ADD COLUMN {key} {declaration}')
        original=db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='assets'").fetchone()[0]
        replacement=re.sub(r'(\bcode\s+TEXT\s+NOT\s+NULL)\s+UNIQUE', r'\1', original, flags=re.I)
        if replacement == original and any(r['unique'] and r['origin']=='u' and [c['name'] for c in db.execute(f'PRAGMA index_info("{r["name"]}")')]==['code'] for r in db.execute('PRAGMA index_list(assets)')):
            raise RuntimeError('Unsupported existing assets code constraint; backup kept, migration stopped')
        if replacement != original:
            sequence=db.execute("SELECT seq FROM sqlite_sequence WHERE name='assets'").fetchone()
            sequence=sequence[0] if sequence else 0
            saved=[r[0] for r in db.execute("SELECT sql FROM sqlite_master WHERE tbl_name='assets' AND type IN ('index','trigger') AND sql IS NOT NULL")]
            replacement=re.sub(r'CREATE TABLE\s+(?:"assets"|assets)', 'CREATE TABLE assets_upgrade', replacement, count=1, flags=re.I)
            db.execute(replacement)
            names=','.join('"'+r['name']+'"' for r in db.execute('PRAGMA table_info(assets)'))
            db.execute(f'INSERT INTO assets_upgrade({names}) SELECT {names} FROM assets')
            db.execute('DROP TABLE assets'); db.execute('ALTER TABLE assets_upgrade RENAME TO assets')
            for statement in saved: db.execute(statement)
            db.execute("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='assets'",(sequence,))
        db.execute('CREATE INDEX IF NOT EXISTS idx_assets_account_lookup ON assets(numbering_account_id,code)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_assets_account_branch ON assets(numbering_account_id,branch_id)')
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_account_code ON assets(COALESCE(numbering_account_id,0),code) WHERE code_unique=1 AND numbering_account_id IS NOT NULL')
        hospital=db.execute('INSERT INTO asset_accounts(name,code,notes) VALUES(?,?,?)', ('โรงพยาบาลสุรินทร์','SURIN','เจ้าของทะเบียน RAR ตามที่ผู้ใช้ยืนยัน')).lastrowid
        center=db.execute('INSERT INTO asset_accounts(name,code,notes) VALUES(?,?,?)', ('ศูนย์แพทย์โรงพยาบาลสุรินทร์','MEDCENTER','ใช้ PDF เป็นบัญชีอ้างอิง ไม่ใช่ทะเบียนทรัพย์สินจริง')).lastrowid
        hp=db.execute('INSERT INTO number_profiles(account_id,name,pattern,number_kind,source) VALUES(?,?,?,?,?)',(hospital,'ทะเบียน 4–3–4–4','{group:4}-{type:3}-{detail:4}-{seq:4}','inventory','ทะเบียน Excel ในครุภัณฑ์แยกประเภท.rar; ยังเก็บเลขนอกรูปแบบเดิมไว้')).lastrowid
        cp=db.execute('INSERT INTO number_profiles(account_id,name,pattern,number_kind,source) VALUES(?,?,?,?,?)',(center,'เลขจำแนกตาม PDF 4–3–4','{group:4}-{type:3}-{detail:4}','classification','PDF หน้า 2; เป็นเลขจำแนกชนิด ใช้ซ้ำกับหลายชิ้นได้; ID/QR แยกรายชิ้น')).lastrowid
        for aid,pid in [(hospital,hp),(center,cp)]: db.execute('INSERT INTO account_bindings(account_id,profile_id) VALUES(?,?)',(aid,pid))
        # Only the user-confirmed archive reference pack belongs to this account.
        pack=json.loads((Path(__file__).parent/'reference-data/classification-v1.json').read_text(encoding='utf-8'))
        filenames=[entry['source'] for entry in pack['categories']]
        for row in db.execute('SELECT r.*,s.title FROM starter_catalog_rows r JOIN source_documents s ON s.id=r.source_document_id').fetchall():
            parts=row['fsn_code'].split('-')
            if len(parts)==3:
                db.execute('INSERT OR IGNORE INTO account_catalog(account_id,category_id,name,code,values_json,source) VALUES(?,?,?,?,?,?)',(hospital,row['category_id'],row['type_name'] or 'ไม่ระบุชนิดในต้นทาง',row['fsn_code'],dump(dict(zip(['group','type','detail'],parts))),row['title']))
        for filename in filenames:
            db.execute("UPDATE assets SET numbering_account_id=?,code_unique=CASE WHEN code IN (SELECT code FROM assets GROUP BY code HAVING COUNT(*)>1) THEN 0 ELSE code_unique END WHERE source_document_id IN (SELECT id FROM source_documents WHERE source_kind='workbook' AND filename=?) AND numbering_account_id IS NULL",(hospital,filename))
        if db.execute('PRAGMA foreign_key_check').fetchone(): raise RuntimeError('Foreign key validation failed; migration rolled back')
        db.execute("INSERT INTO schema_migrations(name) VALUES('account-numbering-v1')")
        db.commit()
    finally: db.close()

def check_account(db, account_id, branch_id=None):
    aid=ident(account_id)
    row=db.execute('SELECT * FROM asset_accounts WHERE id=? AND is_active=1',(aid,)).fetchone()
    if not row: raise GovernanceError('ไม่พบหน่วยงานที่เปิดใช้งาน')
    if branch_id is not None and not db.execute('SELECT 1 FROM account_branches WHERE id=? AND account_id=? AND is_active=1',(ident(branch_id),aid)).fetchone(): raise GovernanceError('สาขาไม่อยู่ในหน่วยงานนี้')
    return row

def parse_pattern(pattern, kind):
    pattern=text(pattern,'รูปแบบเลข',160)
    segments=TOKEN.findall(pattern)
    if not segments or len(segments)>10 or re.sub(TOKEN,'',pattern).strip('-/. _') or '{' in TOKEN.sub('',pattern) or '}' in TOKEN.sub('',pattern): raise GovernanceError('รูปแบบต้องประกอบจากตัวแปร เช่น {group:4}-{seq:4} และตัวคั่น - / . _')
    names=[];total=0
    for name,width in segments:
        if name not in VARIABLES or not 1<=int(width)<=30: raise GovernanceError('ตัวแปรหรือจำนวนหลักไม่ถูกต้อง')
        if name in names: raise GovernanceError('ตัวแปรซ้ำในรูปแบบ')
        names.append(name);total+=int(width)
    if total+len(TOKEN.sub('',pattern))>80: raise GovernanceError('เลขเต็มต้องไม่เกิน 80 ตัวอักษร')
    if kind not in ('inventory','classification'): raise GovernanceError('เลือกเลขประจำชิ้นหรือเลขจำแนก')
    if kind=='classification' and 'seq' in names: raise GovernanceError('เลขจำแนกไม่ใช้ตัวแปรลำดับชิ้น')
    return pattern,segments

def selected_binding(db, aid, bid, cid, on):
    rows=db.execute('''SELECT * FROM account_bindings WHERE account_id=? AND is_active=1 AND effective_from<=?
      AND (branch_id IS NULL OR branch_id=?) AND (category_id IS NULL OR category_id=?)''',(aid,on,bid,cid)).fetchall()
    latest={}
    for row in sorted(rows,key=lambda r:r['effective_from'],reverse=True):
        latest.setdefault((row['branch_id'],row['category_id']),row)
    rows=list(latest.values())
    def rank(r): return (int(r['category_id'] is not None)*2+int(r['branch_id'] is not None),r['effective_from'])
    # Resolve the two independent settings using the same explicit precedence.
    def choose(key):
        eligible=sorted([r for r in rows if r[key] is not None],key=rank,reverse=True)
        if len(eligible)>1 and rank(eligible[0])==rank(eligible[1]): raise GovernanceError('เงื่อนไขใช้แบบซ้ำซ้อน กรุณาแก้การตั้งค่า',409)
        return eligible[0] if eligible else None
    return choose('profile_id'),choose('policy_id')

def policy_snapshot(db, pid):
    row=db.execute('SELECT * FROM depreciation_policies WHERE id=? AND is_active=1',(pid,)).fetchone()
    if not row: raise GovernanceError('หลักเกณฑ์ค่าเสื่อมถูกปิดใช้งานหรือไม่พบ')
    return dict(row)

def resolve(db, body, allocate=False):
    aid=ident(body.get('accountId'));bid=ident(body.get('branchId'),True);cid=ident(body.get('categoryId'))
    check_account(db,aid,bid)
    if not db.execute('SELECT 1 FROM asset_categories WHERE id=? AND is_active=1',(cid,)).fetchone(): raise GovernanceError('ไม่พบหมวดที่เปิดใช้งาน')
    on=body.get('numberDate') or today().isoformat()
    try: day=date.fromisoformat(on)
    except (ValueError,TypeError): raise GovernanceError('วันที่ออกเลขไม่ถูกต้อง')
    nb,_=selected_binding(db,aid,bid,cid,on)
    policy_on=body.get('acquisitionDate') or on
    try:date.fromisoformat(policy_on)
    except (ValueError,TypeError):raise GovernanceError('วันเริ่มคิดค่าเสื่อมไม่ถูกต้อง')
    _,pb=selected_binding(db,aid,bid,cid,policy_on)
    if not nb: raise GovernanceError('ยังไม่ได้ผูกแบบเลขให้หน่วยงานและหมวดนี้')
    profile=dict(db.execute('SELECT * FROM number_profiles WHERE id=?',(nb['profile_id'],)).fetchone())
    pattern,segments=parse_pattern(profile['pattern'],profile['number_kind'])
    values=body.get('values',{})
    if not isinstance(values,dict): raise GovernanceError('ค่าตัวแปรไม่ถูกต้อง')
    entry=None
    if body.get('catalogId'):
        entry=db.execute('SELECT * FROM account_catalog WHERE id=? AND account_id=? AND category_id=?',(ident(body['catalogId']),aid,cid)).fetchone()
        if not entry: raise GovernanceError('รายการบัญชีไม่ตรงหน่วยงานหรือหมวด')
        if 'shared_catalog_id' in entry.keys() and entry['shared_catalog_id'] and not db.execute('SELECT 1 FROM shared_equipment_catalog WHERE id=? AND is_active=1',(entry['shared_catalog_id'],)).fetchone():raise GovernanceError('ชนิดอุปกรณ์กลางนี้ปิดใช้งานแล้ว')
        if not entry['code'] and not body.get('manualCode'):raise GovernanceError('ชนิดนี้ยังไม่มีรหัสครบ เติมเลขในตารางหมวดก่อนออกเลขใหม่')
        values={**values,**json.loads(entry['values_json'])}
    branch=db.execute('SELECT code FROM account_branches WHERE id=?',(bid,)).fetchone() if bid else None
    values={**values,'year':str(day.year),'yearBE':str(day.year+543),'month':str(day.month)}
    if branch:values['branch']=branch[0]
    resolved={}
    manual=bool(body.get('manualCode'))
    for key,width in ([] if manual else segments):
        if key=='seq':continue
        raw=values.get(key,'')
        if not isinstance(raw,(str,int)) or isinstance(raw,bool): raise GovernanceError('ค่าตัวแปร '+key+' ไม่ถูกต้อง')
        raw=str(raw).strip();width=int(width)
        if key in ('year','yearBE') and width==2:raw=raw[-2:]
        if not raw or not re.fullmatch(r'[A-Za-z0-9ก-๙]+',raw) or len(raw)>width: raise GovernanceError(f'ตัวแปร {key} ต้องมีค่าไม่เกิน {width} หลัก ห้ามตัดเลขทิ้ง')
        resolved[key]=raw.zfill(width) if raw.isascii() and raw.isdigit() else raw
        if len(resolved[key])!=width: raise GovernanceError(f'ตัวแปร {key} ต้องครบ {width} ตัวอักษร')
    scope_values={key:val for key,val in resolved.items()}
    reset=profile['reset_policy'];scope={'values':scope_values,'reset':day.year if reset=='year' else f'{day.year}-{day.month:02}' if reset=='month' else ''}
    if profile['sequence_scope']=='branch':scope['branch']=bid
    if profile['sequence_scope']=='category':scope['category']=cid
    key=dump(scope)
    seqwidth=next((int(w) for k,w in segments if k=='seq'),None)
    code=pattern
    next_value=None
    if seqwidth and not manual:
        row=db.execute('SELECT value FROM account_sequences WHERE account_id=? AND profile_id=? AND scope_key=?',(aid,profile['id'],key)).fetchone()
        highest=row[0] if row else 0
        # Existing account codes are evidence; reserve around imported floors without renumbering.
        template=TOKEN.sub(lambda m:'@SEQ@' if m[1]=='seq' else resolved[m[1]],pattern)
        rx=re.compile('^'+re.escape(template).replace('@SEQ@',f'([0-9]{{{seqwidth}}})')+r'(?:[/\.].*)?$')
        for old in db.execute('SELECT code FROM assets WHERE numbering_account_id=? AND code GLOB ?',(aid,template.split('@SEQ@')[0]+'*')):
            match=rx.fullmatch(old[0])
            if match:highest=max(highest,int(match[1]))
        if profile['source'].startswith('ทะเบียน Excel') and all(k in resolved for k in ['group','type','detail']):
            floor=db.execute('SELECT sequence_floor FROM starter_number_floors WHERE fsn_code=?',('-'.join(resolved[k] for k in ['group','type','detail']),)).fetchone()
            if floor:highest=max(highest,floor[0])
        next_value=highest+1
        if len(str(next_value))>seqwidth: raise GovernanceError('เลขลำดับเต็มจำนวนหลักแล้ว กรุณากำหนดแบบรุ่นใหม่',409)
        resolved['seq']=str(next_value).zfill(seqwidth)
        if allocate: db.execute('INSERT INTO account_sequences(account_id,profile_id,scope_key,value) VALUES(?,?,?,?) ON CONFLICT(account_id,profile_id,scope_key) DO UPDATE SET value=excluded.value',(aid,profile['id'],key,next_value))
    code=body['manualCode'] if manual else TOKEN.sub(lambda m:resolved[m[1]],pattern)
    ps=policy_snapshot(db,pb['policy_id']) if pb else None
    override=body.get('policyOverrideId')
    reason=''
    if override:
        if body.get('actor')!=OFFICER: raise GovernanceError('ข้อยกเว้นต้องเป็นเจ้าหน้าที่พัสดุ',403)
        reason=text(body.get('overrideReason'),'เหตุผลข้อยกเว้นค่าเสื่อม',1000)
        ps=policy_snapshot(db,ident(override))
    selection={'profile':profile,'numberBinding':[nb['id'],nb['revision']],'policy':ps,'policyBinding':[pb['id'],pb['revision']] if pb else None,'catalog':dict(entry) if entry else None,'values':{k:v for k,v in resolved.items() if k!='seq'},'accountId':aid,'branchId':bid,'categoryId':cid,'numberDate':on,'policyDate':policy_on,'manualCode':body.get('manualCode','')}
    selection_version=hashlib.sha256(dump(selection).encode()).hexdigest()
    return {'selectionVersion':selection_version,'code':code,'catalog':dict(entry) if entry else None,'profile':profile,'bindingId':nb['id'],'matchedScope':('สาขา + หมวด' if nb['branch_id'] and nb['category_id'] else 'หมวดของหน่วยงาน' if nb['category_id'] else 'สาขา' if nb['branch_id'] else 'แบบหลักของหน่วยงาน'),'policy':ps,'policyBindingId':pb['id'] if pb else None,'overrideReason':reason,'values':resolved,'accountId':aid,'branchId':bid,'categoryId':cid,'numberDate':on,'depreciationRuleDate':policy_on,'sequence':next_value,'previewOnly':not allocate}

def calculate(snapshot, cost, acquired, as_of=None):
    if not snapshot or snapshot.get('calculation_method')=='case_by_case': return {'status':'review','message':'ยังไม่มีหลักเกณฑ์ หรือให้พิจารณารายกรณี'}
    try:
        cost=float(cost); start=date.fromisoformat(acquired); end=date.fromisoformat(as_of or today().isoformat())
        import math
        if not math.isfinite(cost) or cost<0:raise ValueError()
    except (ValueError,TypeError):return {'status':'incomplete','message':'ระบุราคาทุนและวันเริ่มคิดค่าเสื่อมก่อนคำนวณ'}
    residual=cost*float(snapshot.get('residual_value_percent') or 0)/100
    if snapshot['calculation_method']=='useful_life': annual=(cost-residual)/float(snapshot['useful_life_years'])
    else: annual=cost*float(snapshot.get('annual_rate_percent') or 0)/100
    days=max(0,(end-start).days);acc=min(cost-residual,max(0,annual*days/365))
    return {'status':'calculated','annual':round(annual,2),'accumulated':round(acc,2),'netBookValue':round(cost-acc,2),'residual':round(residual,2),'asOf':end.isoformat(),'days':days,'convention':'จำนวนวันจริง / 365; ไม่นับวันเริ่มต้น; จำกัดไม่ต่ำกว่ามูลค่าคงเหลือ'}

def apply_asset(db, asset_id, body, result):
    ps=result['policy'] or {}
    cost=body.get('purchasePrice');acquired=body.get('acquisitionDate') or ''
    if cost not in (None,''):
        try:
            import math
            cost=float(cost)
            if not math.isfinite(cost) or cost<0:raise ValueError()
        except (ValueError,TypeError):raise GovernanceError('ราคาทุนไม่ถูกต้อง')
    else:cost=None
    if acquired:
        try:date.fromisoformat(acquired)
        except (ValueError,TypeError):raise GovernanceError('วันเริ่มคิดค่าเสื่อมไม่ถูกต้อง')
    db.execute('''UPDATE assets SET numbering_account_id=?,branch_id=?,numbering_profile_id=?,numbering_snapshot=?,depreciation_rule_snapshot=?,code_unique=?,depreciation_policy_id=?,purchase_price=?,acquisition_date=?,useful_life_years=? WHERE id=?''',(result['accountId'],result['branchId'],result['profile']['id'],dump(result),dump({'policy':ps,'effectiveDate':result['depreciationRuleDate'],'bindingId':result['policyBindingId'],'overrideReason':result['overrideReason'],'recordedAt':datetime.now(timezone.utc).isoformat(),'calculationConvention':'actual_days_365_excluding_start'}),result.get('codeUnique',int(result['profile']['number_kind']=='inventory')),ps.get('id'),cost,acquired,ps.get('useful_life_years'),asset_id))

def handle(db, method, path, query, body):
    if not path.startswith('/api/governance'):return None
    if method=='GET' and path=='/api/governance':
        return {'categoryLabels':[dict(r) for r in db.execute('SELECT * FROM account_category_labels')],'accounts':[dict(r) for r in db.execute('SELECT * FROM asset_accounts ORDER BY id')],'branches':[dict(r) for r in db.execute('SELECT * FROM account_branches ORDER BY id')],'profiles':[dict(r) for r in db.execute('SELECT * FROM number_profiles ORDER BY id DESC')],'bindings':[dict(r) for r in db.execute('SELECT * FROM account_bindings ORDER BY account_id,id')],'variables':sorted(VARIABLES)}
    if method=='GET' and path=='/api/governance/references':
        try:aid=int(query.get('accountId',[''])[0]);offset=max(0,int(query.get('offset',['0'])[0]))
        except (ValueError,TypeError):raise GovernanceError('เลือกหน่วยงานหรือหน้ารายการให้ถูกต้อง')
        q=str(query.get('q',[''])[0]).strip()[:200]
        check_account(db,aid)
        where='1=1';args=[]
        if q:where+=' AND (name LIKE ? OR group_code LIKE ? OR type_code LIKE ?)';args.extend(['%'+q+'%']*3)
        total=db.execute('SELECT COUNT(*) FROM equipment_references WHERE '+where,args).fetchone()[0]
        return {'items':[dict(r) for r in db.execute('SELECT r.*,(SELECT filename FROM equipment_standards WHERE id=1) AS filename FROM equipment_references r WHERE '+where+' ORDER BY page,id LIMIT 50 OFFSET ?',[*args,offset])],'total':total,'offset':offset,'limit':50}
    if method=='GET' and path=='/api/governance/catalog':
        try:aid=int(query.get('accountId',[''])[0]);cid=int(query.get('categoryId',[''])[0])
        except (ValueError,TypeError):raise GovernanceError('เลือกหน่วยงานและหมวด')
        return {'items':[{**dict(r),'values':json.loads(r['values_json'])} for r in db.execute('SELECT * FROM account_catalog WHERE account_id=? AND category_id=? ORDER BY name,code',(aid,cid))]}
    match=re.fullmatch(r'/api/governance/assets/(\d+)',path)
    if method=='GET' and match:
        r=db.execute('SELECT a.*,n.name AS account_name,b.name AS branch_name FROM assets a LEFT JOIN asset_accounts n ON n.id=a.numbering_account_id LEFT JOIN account_branches b ON b.id=a.branch_id WHERE a.id=?',(int(match[1]),)).fetchone()
        if not r:raise GovernanceError('ไม่พบครุภัณฑ์',404)
        dep=json.loads(r['depreciation_rule_snapshot'])
        return {'account':r['account_name'],'branch':r['branch_name'],'numbering':json.loads(r['numbering_snapshot']),'depreciation':dep,'calculation':calculate(dep.get('policy'),r['purchase_price'],dep.get('startDate',r['acquisition_date']),query.get('asOf',[None])[0]),'legacyPolicyId':r['depreciation_policy_id']}
    if method=='POST' and path=='/api/governance/preview':return resolve(db,body)
    if method not in ('POST','PUT'):raise GovernanceError('ไม่พบคำสั่ง',404)
    if body.get('actor')!=OFFICER:raise GovernanceError('การตั้งค่าต้องใช้บทบาทเจ้าหน้าที่พัสดุ',403)
    actor=body['actor']; db.execute('BEGIN IMMEDIATE')
    if path=='/api/governance/accounts':
        name=text(body.get('name'),'ชื่อหน่วยงาน');code=text(body.get('code'),'รหัสหน่วยงาน',40)
        if not re.fullmatch(r'[A-Za-z0-9_-]+',code):raise GovernanceError('รหัสหน่วยงานใช้ตัวอักษรอังกฤษ ตัวเลข - _')
        notes=text(body.get('notes',''),'หมายเหตุ',1000,False)
        if body.get('id'):
            old=db.execute('SELECT * FROM asset_accounts WHERE id=?',(ident(body['id']),)).fetchone()
            if not old:raise GovernanceError('ไม่พบหน่วยงาน',404)
            if type(body.get('revision')) is not int or body['revision']!=old['revision']:raise GovernanceError('ข้อมูลหน่วยงานเปลี่ยนแล้ว โหลดค่าล่าสุด',409)
            db.execute('UPDATE asset_accounts SET name=?,code=?,notes=?,revision=revision+1 WHERE id=?',(name,code,notes,old['id']))
            audit(db,actor,'accounts',old['id'],dict(old),body);return {'id':old['id'],'revision':old['revision']+1}
        cur=db.execute('INSERT INTO asset_accounts(name,code,notes) VALUES(?,?,?)',(name,code,notes))
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='shared_equipment_catalog'").fetchone():
            from shared_catalog import link_account
            link_account(db,cur.lastrowid)
            if body.get('useSharedStandard'):
                pid=db.execute("INSERT INTO number_profiles(account_id,name,pattern,number_kind,source) VALUES(?,?,'{group:4}-{type:3}-{detail:4}-{seq:4}','inventory',?)",(cur.lastrowid,'หลักเกณฑ์ร่วม + เลขรันประจำชิ้น','หลักเกณฑ์ PDF ร่วมกัน')).lastrowid
                db.execute('INSERT INTO account_bindings(account_id,profile_id) VALUES(?,?)',(cur.lastrowid,pid))
    elif path=='/api/governance/branches':
        aid=ident(body.get('accountId'));check_account(db,aid)
        name=text(body.get('name'),'ชื่อสาขา');code=text(body.get('code'),'รหัสสาขา',30)
        if body.get('id'):
            old=db.execute('SELECT * FROM account_branches WHERE id=? AND account_id=?',(ident(body['id']),aid)).fetchone()
            if not old:raise GovernanceError('ไม่พบสาขาในหน่วยงานนี้',404)
            if type(body.get('revision')) is not int or body['revision']!=old['revision']:raise GovernanceError('ข้อมูลสาขาเปลี่ยนแล้ว โหลดค่าล่าสุด',409)
            db.execute('UPDATE account_branches SET name=?,code=?,revision=revision+1 WHERE id=?',(name,code,old['id']))
            audit(db,actor,'branches',old['id'],dict(old),body);return {'id':old['id'],'revision':old['revision']+1}
        cur=db.execute('INSERT INTO account_branches(account_id,name,code) VALUES(?,?,?)',(aid,name,code))
    elif path=='/api/governance/profiles':
        aid=ident(body.get('accountId'));check_account(db,aid)
        pattern,_=parse_pattern(body.get('pattern'),body.get('numberKind'))
        reset=body.get('resetPolicy','never');scope=body.get('sequenceScope','account')
        if reset not in ('never','year','month') or scope not in ('account','branch','category'):raise GovernanceError('ขอบเขตหรือรอบเลขลำดับไม่ถูกต้อง')
        if reset in ('year','month') and not any(k in ('year','yearBE') for k,w in TOKEN.findall(pattern)):raise GovernanceError('เริ่มเลขใหม่รายปีต้องมีตัวแปรปีในแบบเลข')
        if reset=='month' and not any(k=='month' for k,w in TOKEN.findall(pattern)):raise GovernanceError('เริ่มเลขใหม่รายเดือนต้องมีทั้งปีและเดือน')
        parent=ident(body.get('supersedesId'),True);version=1
        if parent:
            old=db.execute('SELECT * FROM number_profiles WHERE id=? AND account_id=?',(parent,aid)).fetchone()
            if not old:raise GovernanceError('แบบเลขรุ่นเดิมไม่อยู่ในหน่วยงานนี้')
            version=old['version']+1
        cur=db.execute('INSERT INTO number_profiles(account_id,name,pattern,number_kind,reset_policy,sequence_scope,source,version,supersedes_id) VALUES(?,?,?,?,?,?,?,?,?)',(aid,text(body.get('name'),'ชื่อแบบเลข'),pattern,body['numberKind'],reset,scope,text(body.get('source',''),'ที่มา',1200,False),version,parent))
    elif path=='/api/governance/bindings':
        aid=ident(body.get('accountId'));bid=ident(body.get('branchId'),True);cid=ident(body.get('categoryId'),True);check_account(db,aid,bid)
        pid=ident(body.get('profileId'),True);did=ident(body.get('policyId'),True)
        if not pid and not did:raise GovernanceError('เลือกแบบเลขหรือหลักเกณฑ์ค่าเสื่อมอย่างน้อยหนึ่งรายการ')
        if cid and not db.execute('SELECT 1 FROM asset_categories WHERE id=? AND is_active=1',(cid,)).fetchone():raise GovernanceError('ไม่พบหมวด')
        if pid and not db.execute('SELECT 1 FROM number_profiles WHERE id=? AND account_id=?',(pid,aid)).fetchone():raise GovernanceError('แบบเลขต้องอยู่ในหน่วยงานเดียวกัน')
        if did:policy_snapshot(db,did)
        effective=body.get('effectiveFrom') or '1900-01-01'
        try:date.fromisoformat(effective)
        except (ValueError,TypeError):raise GovernanceError('วันที่เริ่มใช้ไม่ถูกต้อง')
        existing=db.execute('SELECT * FROM account_bindings WHERE account_id=? AND COALESCE(branch_id,0)=? AND COALESCE(category_id,0)=? AND effective_from=?',(aid,bid or 0,cid or 0,effective)).fetchone()
        before=dict(existing) if existing else None
        active=body.get('isActive',True)
        if type(active) is not bool:raise GovernanceError('สถานะไม่ถูกต้อง')
        note=text(body.get('notes',''),'หมายเหตุ',1200,False)
        if existing:
            if body.get('revision')!=existing['revision'] or type(body.get('revision')) is not int:raise GovernanceError('การตั้งค่าถูกแก้ไขแล้ว โหลดค่าล่าสุดก่อน',409)
            db.execute('UPDATE account_bindings SET profile_id=?,policy_id=?,notes=?,is_active=?,revision=revision+1 WHERE id=?',(pid,did,note,int(active),existing['id']))
            audit(db,actor,'bindings',existing['id'],before,body)
            return {'id':existing['id'],'revision':existing['revision']+1}
        cur=db.execute('INSERT INTO account_bindings(account_id,branch_id,category_id,profile_id,policy_id,effective_from,notes,is_active) VALUES(?,?,?,?,?,?,?,?)',(aid,bid,cid,pid,did,effective,note,int(active)))
    elif path=='/api/governance/catalog':
        aid=ident(body.get('accountId'));cid=ident(body.get('categoryId'));check_account(db,aid)
        if not db.execute('SELECT 1 FROM asset_categories WHERE id=? AND is_active=1',(cid,)).fetchone():raise GovernanceError('ไม่พบหมวด')
        values=body.get('values')
        if not isinstance(values,dict) or not values or any(k not in VARIABLES-{'seq','year','yearBE','month'} or not isinstance(v,str) or len(v)>30 for k,v in values.items()):raise GovernanceError('ค่ารหัสในบัญชีไม่ถูกต้อง')
        name=text(body.get('name'),'ชื่อชนิด/คุณลักษณะ');code=text(body.get('code'),'รหัสบัญชี',80);source=text(body.get('source',''),'ที่มา',1200,False)
        if body.get('id'):
            old=db.execute('SELECT * FROM account_catalog WHERE id=? AND account_id=? AND category_id=?',(ident(body['id']),aid,cid)).fetchone()
            if not old:raise GovernanceError('ไม่พบรายการในบัญชีหน่วยงานและหมวดนี้',404)
            if type(body.get('revision')) is not int or body['revision']!=old['revision']:raise GovernanceError('บัญชีถูกแก้ไขแล้ว โหลดค่าล่าสุด',409)
            db.execute('UPDATE account_catalog SET name=?,code=?,values_json=?,source=?,revision=revision+1 WHERE id=?',(name,code,dump(values),source,old['id']))
            audit(db,actor,'catalog',old['id'],dict(old),body);return {'id':old['id'],'revision':old['revision']+1}
        cur=db.execute('INSERT INTO account_catalog(account_id,category_id,name,code,values_json,source) VALUES(?,?,?,?,?,?)',(aid,cid,name,code,dump(values),source))
    else:raise GovernanceError('ไม่พบคำสั่ง',404)
    audit(db,actor,path.rsplit('/',1)[-1],cur.lastrowid,None,body)
    return {'id':cur.lastrowid},201

def create_asset(db,body,stamp):
    name=text(body.get('name'),'ชื่อครุภัณฑ์');detail=text(body.get('detail',''),'รายละเอียด',1000,False);location=text(body.get('location',''),'ที่ตั้ง',300,False)
    code=text(body.get('code',''),'เลขเดิม',80,False)
    actor=text(body.get('actor','ผู้แจ้ง'),'ผู้บันทึก',80)
    context={**body,'manualCode':code}
    if not db.in_transaction: db.execute('BEGIN IMMEDIATE')
    result=resolve(db,context,allocate=not bool(code))
    if body.get('expectedSelection') and body['expectedSelection']!=result['selectionVersion']:raise GovernanceError('แบบเลข บัญชีชนิด หรือหลักเกณฑ์เปลี่ยนหลังดูตัวอย่าง กรุณาตรวจเลขและหลักเกณฑ์อีกครั้ง',409)
    code=code or result['code']
    unique=int(result['profile']['number_kind']=='inventory')
    if db.execute('SELECT 1 FROM assets WHERE numbering_account_id=? AND code=? AND (?=1 OR code_unique=1)',(result['accountId'],code,unique)).fetchone():raise GovernanceError('เลขนี้มีในบัญชีหน่วยงานแล้ว',409)
    category=db.execute('SELECT COALESCE(l.name,c.category_name) FROM asset_categories c LEFT JOIN account_category_labels l ON l.category_id=c.id AND l.account_id=? WHERE c.id=?',(result['accountId'],result['categoryId'])).fetchone()[0]
    values=result['values'];fsn='-'.join(values.get(k,'') for k in ['group','type','detail'])
    if not re.fullmatch(r'[0-9]{4}-[0-9]{3}-[0-9]{4}',fsn):fsn=''
    asset_type=text(body.get('assetType',''),'ชนิดครุภัณฑ์',300,False)
    if body.get('catalogId'):
        asset_type=db.execute('SELECT name FROM account_catalog WHERE id=?',(body['catalogId'],)).fetchone()[0]
    cur=db.execute('''INSERT INTO assets(name,detail,code,group_name,location,category_id,status,created_at,created_by,updated_at,fsn_code,asset_type,numbering_account_id,code_unique) VALUES(?,?,?,?,?,?,'รออนุมัติ',?,?,?,?,?,?,?)''',(name,detail,code,category,location,result['categoryId'],stamp,actor,stamp,fsn,asset_type,result['accountId'],unique))
    result['manualOriginal']=bool(body.get('code'));result['codeUnique']=unique
    apply_asset(db,cur.lastrowid,body,result)
    model=text(body.get('model',''),'รุ่น',160,False);serial=text(body.get('serialNumber',''),'หมายเลขเครื่อง',160,False);custodian=text(body.get('custodian',''),'ผู้ดูแล',160,False);warranty=text(body.get('warrantyEnd',''),'วันสิ้นสุดประกัน',10,False)
    if warranty:
        try:date.fromisoformat(warranty)
        except ValueError:raise GovernanceError('วันสิ้นสุดประกันไม่ถูกต้อง')
    db.execute('UPDATE assets SET model=?,serial_number=? WHERE id=?',(model,serial,cur.lastrowid))
    if serial or custodian or warranty:db.execute('INSERT INTO asset_profiles(asset_id,serial_number,custodian,warranty_end) VALUES(?,?,?,?)',(cur.lastrowid,serial,custodian,warranty))
    db.execute('INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)',(cur.lastrowid,actor,'ส่งขออนุมัติลงทะเบียน','','รออนุมัติ',dump({'accountId':result['accountId'],'profileId':result['profile']['id'],'policyId':(result['policy'] or {}).get('id'),'manualOriginal':result['manualOriginal']}),stamp))
    return dict(db.execute('SELECT * FROM assets WHERE id=?',(cur.lastrowid,)).fetchone())


def initialize_manual_references(db_path):
    with sqlite3.connect(db_path) as db:
        if db.execute("SELECT 1 FROM schema_migrations WHERE name='account-manual-reference-v1'").fetchone():return
        pack=json.loads((Path(__file__).parent/'reference-data/manual-catalog-v1.json').read_text(encoding='utf-8'))
        db.execute('''CREATE TABLE IF NOT EXISTS account_manual_references(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES asset_accounts(id),page INTEGER NOT NULL,name TEXT NOT NULL,group_code TEXT NOT NULL,type_code TEXT NOT NULL,raw_line TEXT NOT NULL,filename TEXT NOT NULL,sha256 TEXT NOT NULL)''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_manual_ref_account ON account_manual_references(account_id,group_code,type_code)')
        account=db.execute("SELECT id FROM asset_accounts WHERE code='MEDCENTER'").fetchone()
        if account:
            db.executemany('INSERT INTO account_manual_references(account_id,page,name,group_code,type_code,raw_line,filename,sha256) VALUES(?,?,?,?,?,?,?,?)',[(account[0],r['page'],r['name'],r['group'],r['type'],r['rawLine'],pack['filename'],pack['sha256']) for r in pack['items']])
        db.execute("INSERT INTO schema_migrations(name) VALUES('account-manual-reference-v1')")

def initialize(db_path):
    _initialize_account_schema(db_path)
    initialize_manual_references(db_path)
