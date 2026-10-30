#!/usr/bin/env python3
"""Validate a backup and restore to a NEW DB path; never replace a running database."""
import argparse,hashlib,json,os,shutil,sqlite3,tempfile,zipfile
from contextlib import closing
from pathlib import Path

def restore(archive_path,output):
    output=Path(output).resolve();sources=Path(str(output)+'.sources')
    if output.exists() or sources.exists():raise ValueError('ปลายทางมีอยู่แล้ว เลือกชื่อไฟล์ใหม่ ห้ามเขียนทับฐานที่กำลังใช้งาน')
    output.parent.mkdir(parents=True,exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix='smart-asset-restore-',dir=output.parent))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            if len(set(archive.namelist()))!=len(archive.namelist()):raise ValueError('Duplicate archive members')
            if archive.getinfo('manifest.json').file_size>5*1024*1024:raise ValueError('Manifest too large')
            manifest=json.loads(archive.read('manifest.json'))
            if manifest.get('format')!='smart-asset-backup' or manifest.get('version')!=1:raise ValueError('Unsupported backup')
            members=manifest['files'];expected={'manifest.json'}
            for entry in members:
                name=entry['path']
                if not (name=='database/smart-asset.sqlite3' or (name.startswith('sources/') and len(Path(name).parts)==2 and Path(name).name==name[8:] and '..' not in name and '\\' not in name)):raise ValueError('Unsafe archive path')
                if name in expected:raise ValueError('Duplicate manifest member')
                expected.add(name)
                if entry['size']!=archive.getinfo(name).file_size or entry['size']>4*1024**3:raise ValueError('Invalid file size')
                target=stage/name;target.parent.mkdir(parents=True,exist_ok=True)
                digest=hashlib.sha256()
                with archive.open(name) as src,target.open('xb') as dst:
                    for block in iter(lambda:src.read(1024*1024),b''):digest.update(block);dst.write(block)
                os.chmod(target,0o600)
                if digest.hexdigest()!=entry['sha256']:raise ValueError('Checksum mismatch: '+name)
            if set(archive.namelist())!=expected:raise ValueError('Unexpected archive members')
        db=stage/'database/smart-asset.sqlite3'
        with closing(sqlite3.connect(db.resolve().as_uri()+'?mode=ro',uri=True)) as check:
            if check.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or check.execute('PRAGMA foreign_key_check').fetchone():raise ValueError('Database validation failed')
            for table,count in manifest['counts'].items():
                if table not in ['assets','source_row_records','tickets','asset_qr_links','asset_accounts']:raise ValueError('Unexpected count')
                if check.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]!=count:raise ValueError('Record count mismatch')
            check.row_factory=sqlite3.Row
            for row in check.execute('SELECT * FROM source_attachments'):
                original=stage/'sources'/row['stored_name']
                if not original.is_file() or hashlib.sha256(original.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('Source attachment missing')
        # Exclusive creation also protects against another process creating output meanwhile.
        with output.open('xb') as dst,db.open('rb') as src:shutil.copyfileobj(src,dst)
        os.chmod(output,0o600)
        try:
            if (stage/'sources').exists():shutil.copytree(stage/'sources',sources)
        except BaseException:output.unlink(missing_ok=True);raise
        return manifest['counts']
    finally:shutil.rmtree(stage)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('backup',type=Path);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    try:print(json.dumps({'restored':str(args.output),'verifiedCounts':restore(args.backup,args.output)},ensure_ascii=False))
    except (ValueError,KeyError,zipfile.BadZipFile,sqlite3.Error) as exc:parser.exit(1,str(exc)+'\n')
