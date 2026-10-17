"""Category-scoped numbering from agency decisions and preserved register evidence.

PDF examples are references, never an automatic assertion about agency meanings.
Legacy codes are parsed for selection only; assets and source rows are not changed.
"""
import re

FSN = re.compile(r'[0-9]{4}-[0-9]{3}-[0-9]{4}')
INVENTORY = re.compile(r'([0-9]{4}-[0-9]{3}-[0-9]{4})-([0-9]+)(?:[/\.].*)?')


def registry(db, category_id):
    for row in db.execute('''SELECT a.id,a.code,a.name,a.detail,a.fsn_code,a.asset_type,a.source_row_no,
        s.filename FROM assets a LEFT JOIN source_documents s ON s.id=a.source_document_id
        WHERE a.category_id=? AND (a.source_document_id IS NOT NULL
        OR a.status NOT IN ('รออนุมัติ','ไม่อนุมัติ')) ORDER BY a.id''', (category_id,)):
        match = INVENTORY.fullmatch(row['code'])
        full = row['fsn_code'] if FSN.fullmatch(row['fsn_code'] or '') else match[1] if match else ''
        yield full, row


def category_codes(db, category_id):
    codes = {}
    total = recognized = 0
    for full, row in registry(db, category_id):
        total += 1
        if not full:
            continue
        recognized += 1
        item = codes.setdefault(full, {'code': full, 'names': [], 'assetCount': 0, 'sources': [], 'reference': ''})
        item['assetCount'] += 1
        if row['name'] and row['name'] not in item['names'] and len(item['names']) < 5:
            item['names'].append(row['name'])
        kind = 'ทะเบียนนำเข้า' if row['filename'] else 'ทะเบียนในแอป'
        if kind not in item['sources']:
            item['sources'].append(kind)
    for row in db.execute('''SELECT r.type_name,r.fsn_code,s.title FROM starter_catalog_rows r
        JOIN source_documents s ON s.id=r.source_document_id WHERE r.category_id=? AND r.fsn_code<>''
        ORDER BY r.type_name,r.fsn_code''',(category_id,)):
        name=row['type_name'] or 'ไม่ระบุชนิดในต้นทาง'
        item=codes.setdefault(row['fsn_code'], {'code':row['fsn_code'],'names':[],'assetCount':0,'sources':[],'reference':''})
        item.setdefault('typeNames',[])
        if name not in item['typeNames']:
            item['typeNames'].append(name)
        if name not in item['names']:
            item['names'].append(name)
        if 'บัญชีตั้งต้นจากข้อมูลเดิม' not in item['sources']:
            item['sources'].append('บัญชีตั้งต้นจากข้อมูลเดิม')
        item['reference']=row['title']
    for row in db.execute('''SELECT l.fsn_code,l.reference,f.item_name FROM category_fsn_codes l
        JOIN fsn_catalog_items f ON f.id=l.fsn_catalog_item_id WHERE l.category_id=? ORDER BY l.fsn_code''', (category_id,)):
        item = codes.setdefault(row['fsn_code'], {'code': row['fsn_code'], 'names': [], 'assetCount': 0, 'sources': [], 'reference': ''})
        if row['item_name'] not in item['names']:
            item['names'].insert(0, row['item_name'])
        item.setdefault('typeNames',[])
        if row['item_name'] not in item['typeNames']:
            item['typeNames'].insert(0,row['item_name'])
        item['sources'].append('บัญชีหน่วยงานที่ผูกหมวดแล้ว')
        item['reference'] = row['reference']
    for item in codes.values():
        item.setdefault('typeNames',item['names'][:])
    return sorted(codes.values(), key=lambda item: item['code']), {'registerRows': total, 'recognizedRows': recognized, 'otherFormatRows': total-recognized}


def valid_for_category(db, category_id, code):
    if db.execute('SELECT 1 FROM starter_catalog_rows WHERE category_id=? AND fsn_code=?',(category_id,code)).fetchone():
        return True
    if db.execute('SELECT 1 FROM category_fsn_codes WHERE category_id=? AND fsn_code=?', (category_id, code)).fetchone():
        return True
    return any(full == code for full, _ in registry(db, category_id))


def classification_type_exists(db, category_id, code, name):
    if not code and db.execute('SELECT 1 FROM starter_catalog_rows WHERE category_id=? AND type_name=?',(category_id,name)).fetchone():
        return True
    items,_=category_codes(db,category_id)
    return any((not code or item['code']==code) and name in item['typeNames'] for item in items)


def next_code(db, fsn):
    # Across every category, including pending entries and /subitem suffixes.
    baseline=db.execute('SELECT sequence_floor FROM starter_number_floors WHERE fsn_code=?',(fsn,)).fetchone()
    highest = baseline[0] if baseline else 0
    for row in db.execute('SELECT code FROM assets WHERE code GLOB ?', (fsn+'-[0-9]*',)):
        match = INVENTORY.fullmatch(row['code'])
        if match and match[1] == fsn:
            highest = max(highest, int(match[2]))
    return f'{fsn}-{highest+1:04d}'


def get_catalog(db, query):
    def one(key):
        value = query.get(key, [''])
        return value[0] if isinstance(value, list) else value
    try:
        category_id = int(one('categoryId'))
    except (ValueError, TypeError):
        return {'error': 'กรุณาเลือกหมวดก่อนเลือกรหัส'}, 400
    category = db.execute('SELECT id,category_name AS name,is_active AS isActive FROM asset_categories WHERE id=?', (category_id,)).fetchone()
    if not category or not category['isActive']:
        return {'error': 'ไม่พบหมวดที่ใช้งาน'}, 400
    code = one('code')
    if code and not FSN.fullmatch(code):
        return {'error': 'รหัสจำแนกต้องครบ 4-3-4 หลัก'}, 400
    items, coverage = category_codes(db, category_id)
    types={}
    for row in db.execute('SELECT type_name,fsn_code FROM starter_catalog_rows WHERE category_id=? ORDER BY type_name,fsn_code',(category_id,)):
        name=row['type_name'] or 'ไม่ระบุชนิดในต้นทาง'
        types.setdefault(name,set())
        if row['fsn_code']:
            types[name].add(row['fsn_code'])
    for item in items:
        for name in item['typeNames']:
            types.setdefault(name,set()).add(item['code'])
    type_options=[{'name':name,'codes':sorted(codes)} for name,codes in sorted(types.items())]
    result = {'types':type_options,'starterTypeCount':db.execute('SELECT COUNT(DISTINCT type_name) FROM starter_catalog_rows WHERE category_id=?',(category_id,)).fetchone()[0], 'category': dict(category), 'items': items, 'coverage': coverage,
              'total': len(items), 'manualRows': db.execute("SELECT COUNT(*) FROM fsn_catalog_items f JOIN source_documents s ON s.id=f.source_document_id WHERE s.source_kind='fsn_manual'").fetchone()[0]}
    if code:
        selected = next((item for item in items if item['code'] == code), None)
        if not selected:
            return {'error': 'รหัสนี้ยังไม่ผูกกับหมวดที่เลือก'}, 400
        examples = []
        for full, row in registry(db, category_id):
            if full == code:
                examples.append({key: row[key] for key in ('id', 'code', 'name', 'detail', 'filename', 'source_row_no')})
                if len(examples) == 5:
                    break
        group, kind, _ = code.split('-')
        # Exact type only. A printed four-digit type must not become three digits.
        references = [dict(row) for row in db.execute('''SELECT f.item_name AS name,f.type_code AS typeCode,
            f.source_page AS page,f.canonical_fsn_code AS code,s.title,f.raw_line AS rawLine
            FROM fsn_catalog_items f JOIN source_documents s ON s.id=f.source_document_id
            WHERE s.source_kind='fsn_manual' AND f.category_code=? AND f.type_code=? ORDER BY f.source_page,f.id LIMIT 20''', (group, kind))]
        source_types=[dict(row) for row in db.execute('''SELECT r.type_name AS name,s.title AS source FROM starter_catalog_rows r
            JOIN source_documents s ON s.id=r.source_document_id WHERE r.category_id=? AND r.fsn_code=? ORDER BY r.type_name''',(category_id,code))]
        floor=db.execute('SELECT sequence_floor FROM starter_number_floors WHERE fsn_code=?',(code,)).fetchone()
        result.update(sequenceFloor=floor[0] if floor else 0,sourceTypes=source_types,selected=selected, examples=examples, references=references, nextCode=next_code(db, code))
    return result


def link_code(db, category_id, code, item_id, reference, actor):
    if type(category_id) is not int or not db.execute('SELECT 1 FROM asset_categories WHERE id=? AND is_active=1', (category_id,)).fetchone():
        raise ValueError('กรุณาเลือกหมวดที่ใช้งานสำหรับรหัสนี้')
    existing = db.execute('SELECT fsn_catalog_item_id FROM category_fsn_codes WHERE category_id=? AND fsn_code=?', (category_id, code)).fetchone()
    if existing:
        raise ValueError('รหัสนี้ผูกกับหมวดแล้ว กรุณาใช้รายการเดิม')
    db.execute('INSERT INTO category_fsn_codes(category_id,fsn_code,fsn_catalog_item_id,reference,created_by) VALUES(?,?,?,?,?)', (category_id, code, item_id, reference, actor))
