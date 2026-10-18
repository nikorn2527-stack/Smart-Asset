"""One shared rulebook and equipment catalog; organizations own assets and sequences."""
import json,re,sqlite3
from pathlib import Path
from governance import GovernanceError,OFFICER,dump,audit,text,ident
ROOT=Path(__file__).parent
SCHEMA='''
CREATE TABLE IF NOT EXISTS equipment_standards(id INTEGER PRIMARY KEY,filename TEXT NOT NULL,sha256 TEXT NOT NULL,rules_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS equipment_references(id INTEGER PRIMARY KEY AUTOINCREMENT,page INTEGER NOT NULL,group_code TEXT NOT NULL,type_code TEXT NOT NULL,name TEXT NOT NULL,raw_line TEXT NOT NULL,standard_id INTEGER NOT NULL REFERENCES equipment_standards(id));
CREATE TABLE IF NOT EXISTS shared_equipment_catalog(id INTEGER PRIMARY KEY AUTOINCREMENT,category_id INTEGER NOT NULL REFERENCES asset_categories(id),name TEXT NOT NULL,code TEXT NOT NULL,values_json TEXT NOT NULL,source TEXT NOT NULL,reference_id INTEGER REFERENCES equipment_references(id),is_active INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1,UNIQUE(category_id,name,code));
CREATE INDEX IF NOT EXISTS idx_shared_equipment_code ON shared_equipment_catalog(code,name);
'''

def initialize(path):
    with sqlite3.connect(path) as db:
        db.row_factory=sqlite3.Row;db.executescript(SCHEMA)
        if 'shared_catalog_id' not in {r[1] for r in db.execute('PRAGMA table_info(account_catalog)')}:
            db.execute('ALTER TABLE account_catalog ADD COLUMN shared_catalog_id INTEGER REFERENCES shared_equipment_catalog(id)')
        if not db.execute("SELECT 1 FROM schema_migrations WHERE name='shared-rulebook-v1'").fetchone():
            pack=json.loads((ROOT/'reference-data/manual-catalog-v1.json').read_text(encoding='utf-8'))
            rules=json.loads((ROOT/'reference-data/manual-rules-v1.json').read_text(encoding='utf-8'))
            db.execute('INSERT INTO equipment_standards VALUES(1,?,?,?,1)',(pack['filename'],pack['sha256'],dump(rules)))
            db.executemany('INSERT INTO equipment_references(page,group_code,type_code,name,raw_line,standard_id) VALUES(?,?,?,?,?,1)',[(r['page'],r['group'],r['type'],r['name'],r['rawLine']) for r in pack['items']])
            for r in db.execute('SELECT r.*,s.title FROM starter_catalog_rows r JOIN source_documents s ON s.id=r.source_document_id').fetchall():
                parts=r['fsn_code'].split('-');values=dict(zip(['group','type','detail'],parts)) if len(parts)==3 else {}
                db.execute('INSERT OR IGNORE INTO shared_equipment_catalog(category_id,name,code,values_json,source) VALUES(?,?,?,?,?)',(r['category_id'],r['type_name'] or 'ไม่ระบุชนิดในต้นทาง',r['fsn_code'],dump(values),'บัญชีชนิดจากทะเบียนเดิม: '+r['title']))
            # Link only exact seed matches. Existing local additions and source evidence stay untouched.
            db.execute('''UPDATE account_catalog SET shared_catalog_id=(SELECT s.id FROM shared_equipment_catalog s WHERE s.category_id=account_catalog.category_id AND s.name=account_catalog.name AND s.code=account_catalog.code AND s.values_json=account_catalog.values_json)''')
            db.execute("INSERT INTO schema_migrations(name) VALUES('shared-rulebook-v1')")
        for a in db.execute('SELECT id FROM asset_accounts').fetchall():link_account(db,a[0])
        if not db.execute("SELECT 1 FROM schema_migrations WHERE name='shared-standard-center-v1'").fetchone():
            rows=db.execute("SELECT b.id,b.account_id FROM account_bindings b JOIN number_profiles p ON p.id=b.profile_id JOIN asset_accounts a ON a.id=b.account_id WHERE a.code='MEDCENTER' AND p.source LIKE 'PDF หน้า 2;%' AND b.revision=1 AND NOT EXISTS(SELECT 1 FROM assets x WHERE x.numbering_account_id=a.id)").fetchall()
            for row in rows:
                pid=db.execute("INSERT INTO number_profiles(account_id,name,pattern,number_kind,source) VALUES(?,?,'{group:4}-{type:3}-{detail:4}-{seq:4}','inventory',?)",(row['account_id'],'เลขครุภัณฑ์ตามหลักเกณฑ์ร่วม + เลขรันประจำชิ้น','หลักเกณฑ์ PDF ร่วมกัน; เลขชุดที่สี่แยกแต่ละชิ้น')).lastrowid
                db.execute('UPDATE account_bindings SET profile_id=?,revision=revision+1 WHERE id=?',(pid,row['id']))
            db.execute("INSERT INTO schema_migrations(name) VALUES('shared-standard-center-v1')")

def link_account(db,aid):
    db.execute('''INSERT OR IGNORE INTO account_catalog(account_id,category_id,name,code,values_json,source,shared_catalog_id)
      SELECT ?,category_id,name,code,values_json,source,id FROM shared_equipment_catalog WHERE is_active=1''',(aid,))

def handle(db,method,path,query,body):
    if not path.startswith('/api/equipment/'):return None
    one=lambda k,d='':query.get(k,[d])[0]
    if method=='GET' and path=='/api/equipment/standard':
        row=dict(db.execute('SELECT * FROM equipment_standards WHERE id=1').fetchone());row['rules']=json.loads(row.pop('rules_json'))
        row['references']=db.execute('SELECT COUNT(*) FROM equipment_references').fetchone()[0]
        row['catalogItems']=db.execute('SELECT COUNT(*) FROM shared_equipment_catalog').fetchone()[0]
        return row
    if method=='PUT' and path=='/api/equipment/standard':
        if body.get('actor')!=OFFICER:raise GovernanceError('ใช้สิทธิ์ผู้ดูแลหลักเกณฑ์กลาง',403)
        db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM equipment_standards WHERE id=1').fetchone()
        if body.get('revision')!=row['revision']:raise GovernanceError('หลักเกณฑ์เปลี่ยนแล้ว เปิดฉบับล่าสุดก่อนบันทึก',409)
        rules=json.loads(row['rules_json']);rules['operationalText']=text(body.get('operationalText'),'ข้อความหลักเกณฑ์ที่ใช้งาน',16000)
        db.execute('UPDATE equipment_standards SET rules_json=?,revision=revision+1 WHERE id=1',(dump(rules),))
        audit(db,body['actor'],'shared-rulebook',1,json.loads(row['rules_json']),rules);return {'ok':True}
    if method=='GET' and path in ('/api/equipment/references','/api/equipment/catalog'):
        try:offset=max(0,int(one('offset','0')))
        except ValueError:raise GovernanceError('หน้ารายการไม่ถูกต้อง')
        table='equipment_references' if path.endswith('references') else 'shared_equipment_catalog';where='1=1';args=[]
        if one('id'):
            try:eid=ident(int(one('id')))
            except ValueError:raise GovernanceError('รหัสรายการไม่ถูกต้อง')
            where+=' AND id=?';args.append(eid)
        if one('q'):where+=' AND (name LIKE ? OR '+('group_code LIKE ? OR type_code LIKE ?' if table=='equipment_references' else 'code LIKE ?')+')';args.extend(['%'+one('q')+'%']*(3 if table=='equipment_references' else 2))
        if one('categoryId') and table=='shared_equipment_catalog':
            try:cid=ident(int(one('categoryId')))
            except ValueError:raise GovernanceError('หมวดไม่ถูกต้อง')
            where+=' AND category_id=?';args.append(cid)
        total=db.execute('SELECT COUNT(*) FROM '+table+' WHERE '+where,args).fetchone()[0]
        return {'items':[dict(r) for r in db.execute('SELECT * FROM '+table+' WHERE '+where+' ORDER BY id LIMIT 50 OFFSET ?',[*args,offset])],'total':total,'offset':offset}
    if path=='/api/equipment/catalog' and method in ('POST','PUT'):
        if body.get('actor')!=OFFICER:raise GovernanceError('ใช้สิทธิ์ผู้ดูแลบัญชีกลางเพื่อแก้ไข',403)
        cid=ident(body.get('categoryId'));name=text(body.get('name'),'ชื่ออุปกรณ์');code=text(body.get('code'),'รหัสจำแนก',80)
        if not re.fullmatch(r'\d{4}-\d{3}-\d{4}',code):raise GovernanceError('รหัสจำแนกใช้ 4–3–4 ชุดที่สี่ระบบจะออกเป็นเลขรันรายชิ้น')
        if not db.execute('SELECT 1 FROM asset_categories WHERE id=? AND is_active=1',(cid,)).fetchone():raise GovernanceError('เลือกหมวดที่ใช้งาน')
        ref=ident(body.get('referenceId'),True)
        if ref and not db.execute('SELECT 1 FROM equipment_references WHERE id=?',(ref,)).fetchone():raise GovernanceError('ไม่พบรายการใน PDF')
        source=text(body.get('conditions',''),'คำอธิบาย/เงื่อนไข',2000,False);values=dump(dict(zip(('group','type','detail'),code.split('-'))));db.execute('BEGIN IMMEDIATE');before=None
        if method=='PUT':
            eid=ident(body.get('id'));r=db.execute('SELECT * FROM shared_equipment_catalog WHERE id=?',(eid,)).fetchone()
            if not r:raise GovernanceError('ไม่พบชนิดอุปกรณ์',404)
            before=dict(r)
            if r['revision']!=body.get('revision'):raise GovernanceError('ข้อมูลเปลี่ยนแล้ว กรุณาเปิดล่าสุด',409)
            db.execute('UPDATE shared_equipment_catalog SET category_id=?,name=?,code=?,values_json=?,source=?,reference_id=?,revision=revision+1 WHERE id=?',(cid,name,code,values,source,ref,eid))
            # Keep compatibility IDs but make the shared definition authoritative for future selections.
            db.execute('UPDATE account_catalog SET category_id=?,name=?,code=?,values_json=?,source=?,revision=revision+1 WHERE shared_catalog_id=?',(cid,name,code,values,source,eid))
        else:eid=db.execute('INSERT INTO shared_equipment_catalog(category_id,name,code,values_json,source,reference_id) VALUES(?,?,?,?,?,?)',(cid,name,code,values,source,ref)).lastrowid
        for a in db.execute('SELECT id FROM asset_accounts').fetchall():link_account(db,a[0])
        audit(db,body['actor'],'shared-equipment',eid,before,body)
        return {'id':eid},200 if before else 201
    raise GovernanceError('ไม่พบเส้นทางบัญชีอุปกรณ์',404)
