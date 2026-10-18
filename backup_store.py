"""Consistent SQLite snapshots plus byte-exact source attachments, outside the web root."""
import base64
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from governance import GovernanceError, OFFICER, ident, text

BACKUP_LOCK=threading.Lock()

def source_dir(db_path): return Path(str(db_path)+'.sources')
def backup_dir(db_path): return Path(str(db_path)+'.backups')
def file_hash(path):
    digest=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def snapshot_database(db_path,label='manual'):
    db_path=Path(db_path);folder=backup_dir(db_path);folder.mkdir(parents=True,exist_ok=True)
    target=folder/f'{label}-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}.sqlite3'
    try:
        with sqlite3.connect(db_path) as src,sqlite3.connect(target) as dst:src.backup(dst)
        os.chmod(target,0o600)
    except BaseException:
        target.unlink(missing_ok=True);raise
    return target

def store_source(db,db_path,data,filename,account_id,purpose):
    filename=text(filename,'ชื่อไฟล์',200)
    if Path(filename).name!=filename or '\\' in filename or Path(filename).suffix.lower() not in ('.pdf','.rar','.zip','.xlsx','.xls'):raise GovernanceError('ชื่อหรือชนิดไฟล์ต้นทางไม่รองรับ')
    if not isinstance(data,bytes) or not data or len(data)>24*1024*1024:raise GovernanceError('ไฟล์ต้นทางต้องไม่เกิน 24 MB')
    if purpose not in ('reference_catalog','asset_register','depreciation_policy'):raise GovernanceError('ประเภทเอกสารไม่ถูกต้อง')
    aid=ident(account_id)
    if not db.execute('SELECT 1 FROM asset_accounts WHERE id=?',(aid,)).fetchone():raise GovernanceError('ไม่พบหน่วยงาน')
    digest=hashlib.sha256(data).hexdigest()
    old=db.execute('SELECT id FROM source_attachments WHERE sha256=? AND account_id=? AND purpose=?',(digest,aid,purpose)).fetchone()
    if old:return {'id':old[0],'alreadyStored':True}
    folder=source_dir(db_path);folder.mkdir(parents=True,exist_ok=True)
    stored=digest+Path(filename).suffix.lower();target=folder/stored
    if not target.exists():
        temp=folder/(uuid.uuid4().hex+'.tmp')
        try:
            with temp.open('xb') as f:f.write(data)
            os.chmod(temp,0o600);os.replace(temp,target)
        finally:temp.unlink(missing_ok=True)
    if file_hash(target)!=digest:raise GovernanceError('ไฟล์ที่เก็บไว้ตรวจสอบไม่ผ่าน',409)
    cur=db.execute('INSERT INTO source_attachments(filename,stored_name,sha256,byte_size,account_id,purpose) VALUES(?,?,?,?,?,?)',(filename,stored,digest,len(data),aid,purpose))
    return {'id':cur.lastrowid,'sha256':digest},201

def handle(db,db_path,method,path,query,body):
    if path not in ('/api/backups','/api/backups/sources'):return None
    if (body.get('actor') if method=='POST' else query.get('actor',[''])[0])!=OFFICER:raise GovernanceError('การสำรองข้อมูลต้องใช้บทบาทเจ้าหน้าที่พัสดุ',403)
    if method=='GET' and path=='/api/backups':
        files=[dict(r) for r in db.execute('SELECT id,filename,sha256,byte_size,account_id,purpose,created_at FROM source_attachments ORDER BY id')]
        for item in files:
            name=db.execute('SELECT stored_name FROM source_attachments WHERE id=?',(item['id'],)).fetchone()[0]
            item['available']=(source_dir(db_path)/name).is_file()
        return {'sources':files,'assets':db.execute('SELECT COUNT(*) FROM assets').fetchone()[0],'rawRows':db.execute('SELECT COUNT(*) FROM source_row_records').fetchone()[0],'snapshotCount':len(list(backup_dir(db_path).glob('*.sqlite3'))) if backup_dir(db_path).exists() else 0,'prepared':prepared_exports(db_path)}
    if method=='POST' and path=='/api/backups/sources':
        try:data=base64.b64decode(body.get('data',''),validate=True)
        except (ValueError,TypeError):raise GovernanceError('ข้อมูลไฟล์ไม่ถูกต้อง')
        return store_source(db,db_path,data,body.get('filename'),body.get('accountId'),body.get('purpose'))
    raise GovernanceError('ไม่พบคำสั่ง',404)

def create_bundle(db_path,actor):
    if actor!=OFFICER:raise GovernanceError('การสำรองข้อมูลต้องใช้บทบาทเจ้าหน้าที่พัสดุ',403)
    if not BACKUP_LOCK.acquire(blocking=False):raise GovernanceError('กำลังสร้างชุดสำรอง กรุณารอให้เสร็จ',409)
    folder=Path(tempfile.mkdtemp(prefix='smart-asset-backup-'))
    try:
        snapshot=folder/'smart-asset.sqlite3'
        with sqlite3.connect(db_path) as src,sqlite3.connect(snapshot) as dst:src.backup(dst)
        with sqlite3.connect(snapshot.resolve().as_uri()+'?mode=ro',uri=True) as check:
            check.row_factory=sqlite3.Row
            if check.execute('PRAGMA quick_check').fetchone()[0]!='ok' or check.execute('PRAGMA foreign_key_check').fetchone():raise GovernanceError('ฐานข้อมูลตรวจสอบไม่ผ่าน ไม่สร้างชุดสำรอง',409)
            sources=[dict(r) for r in check.execute('SELECT * FROM source_attachments')]
            counts={t:check.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['assets','source_row_records','tickets','asset_qr_links','asset_accounts']}
        manifest={'format':'smart-asset-backup','version':1,'createdAt':datetime.now(timezone.utc).isoformat(),'counts':counts,'files':[{'path':'database/smart-asset.sqlite3','sha256':file_hash(snapshot),'size':snapshot.stat().st_size}],'sources':sources,'notes':'Original bytes retained; no renumbering or source row conversion. Restore into a new location with scripts/restore-backup.py.'}
        output=folder/'Smart-Asset-backup.zip'
        with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3) as archive:
            archive.write(snapshot,'database/smart-asset.sqlite3')
            seen=set()
            for entry in sources:
                source=source_dir(db_path)/entry['stored_name']
                if not source.is_file() or file_hash(source)!=entry['sha256']:raise GovernanceError('ไฟล์ต้นทางสูญหายหรือเปลี่ยนแปลง: '+entry['filename'],409)
                path='sources/'+entry['stored_name']
                if path not in seen:
                    archive.write(source,path);manifest['files'].append({'path':path,'sha256':entry['sha256'],'size':source.stat().st_size});seen.add(path)
            archive.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
        return folder,output
    except BaseException:shutil.rmtree(folder);raise
    finally:BACKUP_LOCK.release()


def prepared_exports(db_path):
    items=[]
    for path in sorted(backup_dir(db_path).glob('*.zip')):
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.zip',path.name) or path.is_symlink():continue
        try:
            with zipfile.ZipFile(path) as archive:
                if archive.getinfo('manifest.json').file_size>5*1024*1024:continue
                manifest=json.loads(archive.read('manifest.json'))
                if manifest.get('format')!='smart-asset-backup' or manifest.get('version')!=1:continue
            items.append({'filename':path.name,'size':path.stat().st_size,'counts':manifest.get('counts',{}),'createdAt':manifest.get('createdAt'),'originalFiles':len(manifest.get('sources',[]))})
        except (OSError,ValueError,KeyError,zipfile.BadZipFile):continue
    return items

def prepared_file(db_path,filename,actor):
    if actor!=OFFICER:raise GovernanceError('การสำรองข้อมูลต้องใช้บทบาทเจ้าหน้าที่พัสดุ',403)
    if filename not in {item['filename'] for item in prepared_exports(db_path)}:raise GovernanceError('ไม่พบชุดสำรองที่เตรียมไว้',404)
    return backup_dir(db_path)/filename
