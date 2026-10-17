"""Install the user-provided category/type reference pack without importing assets."""
import hashlib
import json
from pathlib import Path
import re

PACK = Path(__file__).resolve().parent/'reference-data'/'classification-v1.json'
MIGRATION = 'classification-starter-v1'
FSN = re.compile(r'[0-9]{4}-[0-9]{3}-[0-9]{4}')


def seed(db):
    db.execute('BEGIN IMMEDIATE')
    if db.execute('SELECT 1 FROM schema_migrations WHERE name=?',(MIGRATION,)).fetchone():
        db.commit()
        return
    raw=PACK.read_bytes();data=json.loads(raw)
    if data['version']!=1:
        raise ValueError('Unsupported classification pack')
    digest=hashlib.sha256(raw).hexdigest()
    for entry in data['categories']:
        # Preserve IDs, user notes, policy links, and disabled categories.
        row=db.execute('''SELECT id FROM asset_categories WHERE source_workbook=? OR category_name=?
            ORDER BY (source_workbook=?) DESC,(category_name=?) DESC,id LIMIT 1''',(entry['source'],entry['name'],entry['source'],entry['name'])).fetchone()
        if row:
            category_id=row['id']
        else:
            category_id=db.execute('''INSERT INTO asset_categories(category_name,source_workbook,notes,updated_at)
                VALUES(?,?,?,CURRENT_TIMESTAMP)''',(entry['name'],entry['source'],'บัญชีตั้งต้นจากข้อมูลแยกประเภทที่หน่วยงานให้มา')).lastrowid
        filename='classification-starter/'+entry['source']
        db.execute('''INSERT OR IGNORE INTO source_documents(filename,title,source_kind,sha256,extraction_method)
            VALUES(?,?,'classification_starter',?,?)''',(filename,'บัญชีหมวดและชนิดจาก '+entry['source'],digest,'เฉพาะหมวด ชนิด เลขจำแนก และลำดับสูงสุดเดิม; ไม่มีทะเบียนรายชิ้น'))
        source_id=db.execute('SELECT id FROM source_documents WHERE filename=? AND sha256=?',(filename,digest)).fetchone()[0]
        for kind in entry['types']:
            for code in kind['codes'] or ['']:
                if code and not FSN.fullmatch(code):
                    raise ValueError('Invalid classification code in starter pack')
                db.execute('''INSERT OR IGNORE INTO starter_catalog_rows(category_id,type_name,fsn_code,source_document_id)
                    VALUES(?,?,?,?)''',(category_id,kind['name'],code,source_id))
    for code,floor in data['sequenceFloors'].items():
        if not FSN.fullmatch(code) or type(floor) is not int or floor<0:
            raise ValueError('Invalid numbering floor in starter pack')
        db.execute('INSERT OR IGNORE INTO starter_number_floors(fsn_code,sequence_floor) VALUES(?,?)',(code,floor))
    db.execute('INSERT INTO schema_migrations(name) VALUES(?)',(MIGRATION,))
    db.commit()
