from access_control import document_scope_sql
"""Preview-first imports of organizational asset registers. Every source column is retained."""
import base64,binascii,hashlib,json,os,re,sqlite3,stat,tempfile,zipfile
from pathlib import Path,PurePosixPath
from uuid import uuid4
from datetime import date,datetime,timezone,time as datetime_time,timedelta
from governance import GovernanceError,OFFICER,ident,text,dump,check_account
from import_sources import HEADER_TO_FIELD,number,integer,clean_text,create_unit
from backup_store import store_source,snapshot_database
MAX_UPLOAD=24*1024*1024
LIMIT_BYTES=256*1024*1024
FIELDS={re.sub(r'\s+','',k).casefold():v for k,v in HEADER_TO_FIELD.items()}
GROUP_ALIASES={
    'ครุภัณฑ์วิทยาศาสตร์หรือการแพทย์':'ครุภัณฑ์วิทยาศาสตร์และการแพทย์',
    'ครุภัณฑ์กีฬา/กายภาพ':'ครุภัณฑ์กีฬาและกายภาพ',
    'ครุภัณฑ์ดนตรี/นาฏศิลป์':'ครุภัณฑ์ดนตรีนาฏศิลป์',
}

def category_for_group(db, group, fallback_id):
    label=(group or '').strip()
    name=GROUP_ALIASES.get(label, label)
    row=db.execute('SELECT id,category_name FROM asset_categories WHERE is_active=1 AND category_name=? ORDER BY id LIMIT 1',(name,)).fetchone() if name else None
    if not row and name:
        row=db.execute('SELECT id,category_name FROM asset_categories WHERE is_active=1 AND category_name LIKE ? ORDER BY length(category_name),id LIMIT 1',(name+'%',)).fetchone()
    if row: return row['id'], row['category_name']
    fallback=db.execute('SELECT id,category_name FROM asset_categories WHERE id=?',(fallback_id,)).fetchone()
    return fallback_id, fallback['category_name']
SCHEMA='''
CREATE TABLE IF NOT EXISTS asset_import_jobs(id TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES asset_accounts(id),branch_id INTEGER REFERENCES account_branches(id),filename TEXT NOT NULL,sha256 TEXT NOT NULL,status TEXT NOT NULL,summary_json TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS asset_import_links(job_id TEXT NOT NULL REFERENCES asset_import_jobs(id),source_document_id INTEGER NOT NULL REFERENCES source_documents(id),filename TEXT NOT NULL,sheet_name TEXT NOT NULL,PRIMARY KEY(job_id,filename,sheet_name));
'''

def initialize(path):
    with sqlite3.connect(path) as db:db.executescript(SCHEMA)
def fail(message,status=400):raise GovernanceError(message,status)
def field(header):return FIELDS.get(re.sub(r'\s+','',header).casefold())
def normal(value):
    if value is None:return ''
    if isinstance(value,(datetime,date,datetime_time)):return value.isoformat()
    if isinstance(value,timedelta):return {'type':'duration','seconds':value.total_seconds(),'text':str(value)}
    if isinstance(value,float):
        import math
        if not math.isfinite(value):return str(value)
        if value.is_integer():return int(value)
    return value

def worksheets(path):
    if path.suffix.lower()=='.xlsx':
        from openpyxl import load_workbook
        book=load_workbook(path,read_only=True,data_only=False);cached=load_workbook(path,read_only=True,data_only=True)
        try:
            for sheet in book.worksheets:
                if sheet.max_column>200 or sheet.max_row>200000:fail('ตารางมีขนาดเกินขีดจำกัด 200 คอลัมน์ / 200,000 แถวต่อแผ่น')
                def rows(sheet=sheet):
                    for raw,values in zip(sheet.iter_rows(values_only=True),cached[sheet.title].iter_rows(values_only=True)):
                        yield [({'formula':c,'cached':normal(v)} if isinstance(c,str) and c.startswith('=') else normal(c)) for c,v in zip(raw,values)]
                yield sheet.title,rows()
        finally:book.close();cached.close()
    else:
        import xlrd
        book=xlrd.open_workbook(path,on_demand=True,formatting_info=True)
        try:
            for sheet in book.sheets():
                if sheet.ncols>200 or sheet.nrows>200000:fail('ตารางมีขนาดเกินขีดจำกัด')
                def rows(sheet=sheet):
                    for row in range(sheet.nrows):
                        values=[]
                        for c in range(sheet.ncols):
                            cell=sheet.cell(row,c);value=cell.value
                            if cell.ctype==xlrd.XL_CELL_DATE:
                                try:value=xlrd.xldate_as_datetime(value,book.datemode).isoformat()
                                except (ValueError,OverflowError):pass
                            elif cell.ctype==xlrd.XL_CELL_NUMBER:
                                fmt=book.format_map.get(book.xf_list[cell.xf_index].format_key) if book.formatting_info else None
                                if fmt and re.fullmatch(r'0+',fmt.format_str) and float(value).is_integer():value=str(int(value)).zfill(len(fmt.format_str))
                            values.append(normal(value))
                        yield values
                yield sheet.name,rows()
        finally:book.release_resources()

def unpack(original,folder):
    suffix=original.suffix.lower();result=[];ignored=[]
    if suffix in ('.xls','.xlsx'):return [(original.name,original)],ignored
    if suffix!='.zip':fail('อัปโหลด ZIP, XLS หรือ XLSX ได้ หากเป็น RAR ให้แตกไฟล์แล้วบีบอัดเป็น ZIP ก่อน')
    try:archive=zipfile.ZipFile(original)
    except zipfile.BadZipFile:fail('ZIP ไม่ถูกต้องหรือไฟล์เสียหาย')
    total=0
    with archive:
        if len(archive.infolist())>200:fail('ZIP มีไฟล์เกิน 200 รายการ')
        for info in archive.infolist():
            name=info.filename.replace('\\','/');parts=PurePosixPath(name)
            if parts.is_absolute() or '..' in parts.parts or ':' in name or stat.S_ISLNK(info.external_attr>>16):fail('ZIP มีเส้นทางหรือไฟล์เชื่อมโยงที่ไม่อนุญาต')
            if info.is_dir():continue
            if info.flag_bits&1:fail('ZIP ที่มีรหัสผ่านยังไม่รองรับ')
            total+=info.file_size
            if total>LIMIT_BYTES or (info.file_size>1024*1024 and info.file_size>max(info.compress_size,1)*500):fail('ZIP เมื่อแตกไฟล์ใหญ่เกินขีดจำกัด')
            if parts.suffix.lower() not in ('.xls','.xlsx'):ignored.append(name);continue
            if len(result)>=100:fail('นำเข้าได้ไม่เกิน 100 workbook ต่อครั้ง')
            target=folder/(str(len(result))+parts.suffix.lower())
            try:
                with archive.open(info) as src,target.open('wb') as dst:
                    count=0
                    while chunk:=src.read(1024*1024):
                        count+=len(chunk)
                        if count>info.file_size or count>LIMIT_BYTES:fail('ขนาด ZIP ไม่ตรงกับข้อมูลที่แจ้ง')
                        dst.write(chunk)
            except (RuntimeError,zipfile.BadZipFile):fail('อ่าน ZIP ไม่สำเร็จ')
            result.append((name,target))
    if not result:fail('ไม่พบ XLS/XLSX ใน ZIP')
    return result,ignored

def stage(db,path,body):
    aid=ident(body.get('accountId'));bid=ident(body.get('branchId'),True);check_account(db,aid,bid)
    name=text(body.get('filename'),'ชื่อไฟล์',200)
    if Path(name).name!=name or '\\' in name or Path(name).suffix.lower() not in ('.zip','.xls','.xlsx'):fail('เลือกไฟล์ ZIP, XLS หรือ XLSX')
    try:data=base64.b64decode(body.get('content',''),validate=True)
    except (TypeError,ValueError,binascii.Error):fail('ข้อมูลไฟล์ไม่ถูกต้อง')
    if not 0<len(data)<=MAX_UPLOAD:fail('ไฟล์อัปโหลดต้องไม่เกิน 24 MB')
    digest=hashlib.sha256(data).hexdigest()
    old=db.execute("SELECT id,summary_json FROM asset_import_jobs WHERE account_id=? AND COALESCE(branch_id,0)=? AND sha256=? AND status='completed'",(aid,bid or 0,digest)).fetchone()
    if old:return {'id':old['id'],'alreadyImported':True,**json.loads(old['summary_json'])}
    jid=uuid4().hex;folder=Path(str(path)+'.imports')/jid;folder.mkdir(parents=True,exist_ok=False);original=folder/name;original.write_bytes(data);os.chmod(original,0o600)
    files,ignored=unpack(original,folder);summary={'accountId':aid,'branchId':bid,'filename':name,'sha256':digest,'files':[],'assetRows':0,'sourceRows':0,'nonStandardNumbers':0,'blankNumbers':0,'duplicateNumbers':0,'ignoredFiles':ignored,'fields':HEADER_TO_FIELD,'warnings':[]}
    try:
        with sqlite3.connect(folder/'stage.sqlite3') as staged:
            staged.executescript('CREATE TABLE rows(file_no INTEGER,sheet_name TEXT,row_no INTEGER,raw_json TEXT,norm_json TEXT,asset INTEGER,code TEXT);CREATE INDEX row_code ON rows(code);')
            file_no=0
            for filename,local in files:
                for sheet_name,iterator in worksheets(local):
                    first=[];found=None
                    for n,row in enumerate(iterator,1):
                        first.append((n,row))
                        if any(field(str(c))=='code' for c in row) and sum(bool(field(str(c))) for c in row)>=3:found=(n,row);break
                        if n>=15:break
                    if not found:
                        summary['warnings'].append(filename+' / '+sheet_name+': ไม่พบหัวเลขครุภัณฑ์และข้อมูลอย่างน้อย 3 ช่อง จึงยังไม่นำเข้าแผ่นนี้');continue
                    header_no,headers=found;names=[];used={}
                    for c,h in enumerate(headers,1):
                        key=str(h).strip() or f'คอลัมน์_{c:02d}';used[key]=used.get(key,0)+1;names.append(key if used[key]==1 else key+' ['+str(used[key])+']')
                    mapping={name:field(str(header)) for name,header in zip(names,headers)}
                    category=db.execute('SELECT id FROM asset_categories WHERE source_workbook=? OR category_name=? ORDER BY id LIMIT 1',(PurePosixPath(filename).name,PurePosixPath(filename).stem)).fetchone()
                    entry={'fileNo':file_no,'filename':filename,'sheet':sheet_name,'headerRow':header_no,'columns':[{'name':str(h),'key':key,'field':mapping[key]} for h,key in zip(headers,names)],'categoryId':category[0] if category else None,'rows':0,'assetRows':0,'samples':[]}
                    # A repeated header or subtotal remains a source row, rather than becoming a fake asset.
                    for row_no,values in enumerate(iterator,header_no+1):
                        if not any(v not in (None,'') for v in values):continue
                        if len(values)>len(names):
                            for c in range(len(names),len(values)):
                                key=f'คอลัมน์_{c+1:02d}';names.append(key);mapping[key]=None;entry['columns'].append({'name':'','key':key,'field':None})
                        raw={k:normal(values[c]) if c<len(values) else '' for c,k in enumerate(names)};norm={mapping[k]:(v.get('cached','') if isinstance(v,dict) and 'formula' in v else v) for k,v in raw.items() if mapping[k]};code=clean_text(norm.get('code'));description=clean_text(norm.get('description') or norm.get('detail') or norm.get('asset_type'))
                        is_header=field(code)=='code';is_asset=not is_header and bool(code or description)
                        staged.execute('INSERT INTO rows VALUES(?,?,?,?,?,?,?)',(file_no,sheet_name,row_no,dump(raw),dump(norm),int(is_asset),code))
                        entry['rows']+=1;summary['sourceRows']+=1
                        if summary['sourceRows']>300000:fail('ข้อมูลเกิน 300,000 แถวต่อชุด')
                        if is_asset:
                            entry['assetRows']+=1;summary['assetRows']+=1
                            if not code:summary['blankNumbers']+=1
                            elif not re.fullmatch(r'\d{4}-\d{3}-\d{4}-\d{4}(?:[/\.].*)?',code):summary['nonStandardNumbers']+=1
                            if len(entry['samples'])<3:entry['samples'].append({'row':row_no,'data':norm,'original':raw})
                    summary['files'].append(entry);file_no+=1
            summary['duplicateNumbers']=staged.execute("SELECT COALESCE(SUM(n),0) FROM (SELECT COUNT(*) AS n FROM rows WHERE asset=1 AND code<>'' GROUP BY code HAVING COUNT(*)>1)").fetchone()[0]
        if not summary['assetRows']:fail('ยังไม่พบแถวอุปกรณ์ที่นำเข้าได้ กรุณาตรวจหัวตาราง')
    except (ImportError,ModuleNotFoundError):fail('ติดตั้งตัวอ่าน Excel ด้วย python -m pip install -r requirements.txt')
    db.execute('INSERT INTO asset_import_jobs VALUES(?,?,?,?,?,?,?,?,?)',(jid,aid,bid,name,digest,'preview',dump(summary),datetime.now(timezone.utc).isoformat(),''))
    return {'id':jid,'alreadyImported':False,**summary}

def commit(db,path,body):
    jid=text(body.get('id'),'รหัสนำเข้า',40)
    if not re.fullmatch(r'[a-f0-9]{32}',jid):fail('รหัสนำเข้าไม่ถูกต้อง')
    job=db.execute('SELECT * FROM asset_import_jobs WHERE id=?',(jid,)).fetchone()
    if not job:fail('ไม่พบชุดนำเข้า',404)
    if job['status']=='completed':return {'id':jid,'alreadyImported':True,**json.loads(job['summary_json'])}
    if body.get('confirm') is not True:fail('ตรวจตัวอย่างแล้วเลือกยืนยันก่อนนำเข้า')
    mappings=body.get('categories',{})
    if not isinstance(mappings,dict):fail('หมวดของไฟล์ไม่ถูกต้อง')
    folder=Path(str(path)+'.imports')/jid;original=folder/job['filename'];summary=json.loads(job['summary_json'])
    if hashlib.sha256(original.read_bytes()).hexdigest()!=job['sha256']:fail('ไฟล์ต้นทางเปลี่ยน กรุณาอัปโหลดใหม่',409)
    # Snapshot through another connection before acquiring the writer lock.
    snapshot_database(path,'before-register-import')
    db.execute('BEGIN IMMEDIATE');job=db.execute('SELECT * FROM asset_import_jobs WHERE id=?',(jid,)).fetchone()
    if job['status']=='completed':return {'id':jid,'alreadyImported':True,**json.loads(job['summary_json'])}
    prior=db.execute("SELECT id,summary_json FROM asset_import_jobs WHERE account_id=? AND COALESCE(branch_id,0)=? AND sha256=? AND status='completed'",(job['account_id'],job['branch_id'] or 0,job['sha256'])).fetchone()
    if prior:return {'id':prior['id'],'alreadyImported':True,**json.loads(prior['summary_json'])}
    account=db.execute('SELECT * FROM asset_accounts WHERE id=?',(job['account_id'],)).fetchone();check_account(db,job['account_id'],job['branch_id'])
    db.execute('INSERT OR IGNORE INTO organizations(name,code) VALUES(?,?)',(account['name'],account['code']));org=db.execute('SELECT id FROM organizations WHERE name=? AND code=?',(account['name'],account['code'])).fetchone()[0]
    store_source(db,path,original.read_bytes(),job['filename'],job['account_id'],'asset_register')
    stamp=datetime.now(timezone.utc).isoformat();inserted=0;existing_duplicates=0
    with sqlite3.connect(folder/'stage.sqlite3') as staged:
        staged.row_factory=sqlite3.Row
        repeats={r[0] for r in staged.execute("SELECT code FROM rows WHERE asset=1 AND code<>'' GROUP BY code HAVING COUNT(*)>1")}
        existing={r[0] for r in db.execute('SELECT code FROM assets WHERE numbering_account_id=?',(job['account_id'],))}
        for file in summary['files']:
            file_cid=mappings.get(str(file['fileNo']),file['categoryId']);file_cid=ident(file_cid)
            if not db.execute('SELECT 1 FROM asset_categories WHERE id=? AND is_active=1',(file_cid,)).fetchone():fail('เลือกหมวดให้ครบทุกไฟล์ก่อนนำเข้า')
            filename=PurePosixPath(file['filename']).name;source_hash=hashlib.sha256((job['sha256']+'\0'+file['filename']+'\0'+file['sheet']+'\0'+str(job['account_id'])+'\0'+str(job['branch_id'])).encode()).hexdigest()
            source=db.execute('INSERT INTO source_documents(filename,title,media_type,source_kind,source_scope,sha256,container_filename,extraction_method,notes) VALUES(?,?,?,\'workbook\',?,?,?,?,?)',(filename,filename+' / '+file['sheet'],'application/vnd.ms-excel',account['name'],source_hash,job['filename'],'web import preview','ต้นฉบับครบทุกคอลัมน์; job '+jid)).lastrowid
            db.execute('INSERT INTO asset_import_links VALUES(?,?,?,?)',(jid,source,file['filename'],file['sheet']))
            for column in file['columns']:
                db.execute('INSERT INTO source_columns(source_document_id,column_no,source_header,canonical_field) VALUES(?,?,?,?)',(source,file['columns'].index(column),column['name'],column['field'] or ''))
            for row in staged.execute('SELECT * FROM rows WHERE file_no=? ORDER BY row_no',(file['fileNo'],)):
                norm=json.loads(row['norm_json']);raw=row['raw_json'];asset_id=None
                if row['asset']:
                    code=row['code'];desc=clean_text(norm.get('description'));detail=clean_text(norm.get('detail'));typ=clean_text(norm.get('asset_type'));dept=clean_text(norm.get('department'));responsible=clean_text(norm.get('responsible_unit'));cid,group=category_for_group(db,clean_text(norm.get('group_name')),file_cid);group=clean_text(norm.get('group_name')) or group
                    du=create_unit(db,org,dept,'department',source);ru=create_unit(db,org,responsible,'responsible_unit',source)
                    if code in existing:
                        existing_duplicates+=1;db.execute('UPDATE assets SET code_unique=0 WHERE numbering_account_id=? AND code=?',(job['account_id'],code))
                    unique=int(bool(code) and code not in repeats and code not in existing)
                    fields={'name':desc or detail or typ or group,'detail':detail,'code':code,'group_name':group,'location':clean_text(norm.get('location')) or responsible or dept,'status':'ทะเบียนแล้ว','created_at':stamp,'created_by':'นำเข้าทะเบียน','updated_at':stamp,'source_document_id':source,'source_row_no':row['row_no'],'organization_id':org,'department_unit_id':du,'responsible_unit_id':ru,'category_id':cid,'numbering_account_id':job['account_id'],'branch_id':job['branch_id'],'code_unique':unique,
                    'old_asset_code':clean_text(norm.get('old_asset_code')),'maintenance_status':clean_text(norm.get('maintenance_status')),'asset_status_source':clean_text(norm.get('asset_status')),'asset_type':typ,'fiscal_year_th':clean_text(norm.get('fiscal_year_th')),'acquisition_date':clean_text(norm.get('acquisition_date')),'delivery_date':clean_text(norm.get('delivery_date')),'acquisition_method':clean_text(norm.get('acquisition_method')),'purchase_price':number(norm.get('purchase_price')),'gfmis_no':clean_text(norm.get('gfmis_no')),'po_no':clean_text(norm.get('po_no')),'model':clean_text(norm.get('model')),'serial_number':clean_text(norm.get('serial_number')),'useful_life_years':number(norm.get('useful_life_years')),'depreciation_value':number(norm.get('depreciation_value')),'accumulated_depreciation':number(norm.get('accumulated_depreciation')),'net_book_value':number(norm.get('net_book_value')),'valuation_date':clean_text(norm.get('valuation_date')),'remaining_days':integer(norm.get('remaining_days')),'is_loaned':clean_text(norm.get('is_loaned')),'loan_price':number(norm.get('loan_price')),'latest_update':clean_text(norm.get('latest_update')),'delivery_note_no':clean_text(norm.get('delivery_note_no'))}
                    prefix='-'.join(code.split('-')[:3]);fields['fsn_code']=prefix if re.fullmatch(r'\d{4}-\d{3}-\d{4}',prefix) else ''
                    fields['numbering_snapshot']=dump({'importJob':jid,'originalNumber':code,'numberKind':'inventory','source':file['filename'],'requiresReview':not bool(re.fullmatch(r'\d{4}-\d{3}-\d{4}-\d{4}(?:[/\.].*)?',code)) or not unique})
                    columns=','.join(fields);placeholders=','.join('?' for _ in fields)
                    asset_id=db.execute('INSERT INTO assets('+columns+') VALUES('+placeholders+')',list(fields.values())).lastrowid;inserted+=1
                    db.execute('INSERT INTO asset_acquisitions(asset_id,source_document_id,fiscal_year_th,acquired_on,delivered_on,document_no,gfmis_no,po_no,acquisition_method,unit_price,total_price,model,serial_number) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(asset_id,source,fields['fiscal_year_th'],fields['acquisition_date'],fields['delivery_date'],fields['delivery_note_no'],fields['gfmis_no'],fields['po_no'],fields['acquisition_method'],fields['purchase_price'],fields['purchase_price'],fields['model'],fields['serial_number']))
                    # The source heading says only 'มูลค่าเสื่อม'; do not invent a monthly/annual period.
                    db.execute('INSERT INTO asset_depreciation_snapshots(asset_id,source_document_id,period_date,useful_life_years,accumulated_depreciation,net_book_value,remaining_days,raw_data_json) VALUES(?,?,?,?,?,?,?,?)',(asset_id,source,fields['valuation_date'],fields['useful_life_years'],fields['accumulated_depreciation'],fields['net_book_value'],fields['remaining_days'],dump({'sourceHeader':'มูลค่าเสื่อม','sourceDepreciationValue':norm.get('depreciation_value','')})))
                db.execute('INSERT INTO source_row_records(source_document_id,source_row_no,record_kind,asset_id,raw_data_json) VALUES(?,?,?,?,?)',(source,row['row_no'],'asset' if asset_id else 'unmapped',asset_id,raw))
    summary.update(importedAssets=inserted,existingDuplicateNumbers=existing_duplicates,completedAt=stamp)
    db.execute("UPDATE asset_import_jobs SET status='completed',summary_json=?,completed_at=? WHERE id=?",(dump(summary),stamp,jid))
    return {'id':jid,'alreadyImported':False,**summary}

def handle(db,path,method,url,query,body):
    if not url.startswith('/api/imports'):return None
    if method=='GET' and url=='/api/imports':
        aid=ident(int(query.get('accountId',['0'])[0]));check_account(db,aid)
        return {'items':[{'id':r['id'],'status':r['status'],'createdAt':r['created_at'],'summary':json.loads(r['summary_json'])} for r in db.execute('SELECT * FROM asset_import_jobs s WHERE account_id=? AND '+document_scope_sql(db)+' ORDER BY created_at DESC LIMIT 30',(aid,))]}
    if body.get('actor')!=OFFICER:fail('การนำเข้าต้องใช้สิทธิ์เจ้าหน้าที่พัสดุ',403)
    if method=='POST' and url=='/api/imports/preview':return stage(db,path,body)
    if method=='POST' and url=='/api/imports/commit':return commit(db,path,body)
    fail('ไม่พบเส้นทางนำเข้า',404)
