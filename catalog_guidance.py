"""Editable catalogue wording, with immutable source snapshots and revision history."""
from datetime import datetime, timezone
from functools import lru_cache
import json
from pathlib import Path
import re

OFFICER='เจ้าหน้าที่พัสดุ'
KEY='scope=? AND category_id=? AND fsn_code=?'


class GuidanceError(ValueError):
    def __init__(self,message,status=400):
        super().__init__(message);self.status=status


def one(query,key,default=''):
    value=query.get(key,default)
    return value[0] if isinstance(value,list) and value else value


def target(db,values):
    scope=values.get('scope','numbering')
    if scope not in ('numbering','category','code'):
        raise GuidanceError('ไม่พบระดับคำอธิบายที่เลือก')
    category=values.get('categoryId',0);code=values.get('code','')
    if scope=='numbering':
        return (scope,0,'')
    if type(category) is not int or not 1<=category<=9223372036854775807 or not db.execute('SELECT 1 FROM asset_categories WHERE id=?',(category,)).fetchone():
        raise GuidanceError('กรุณาเลือกหมวดที่มีอยู่')
    if scope=='category':
        return (scope,category,'')
    from numbering import valid_for_category
    if not isinstance(code,str) or not re.fullmatch(r'[0-9]{4}-[0-9]{3}-[0-9]{4}',code) or not valid_for_category(db,category,code):
        raise GuidanceError('รหัสไม่อยู่ในหมวดที่เลือก')
    return (scope,category,code)


@lru_cache(maxsize=1)
def manual():
    return json.loads((Path(__file__).resolve().parent/'reference-data'/'numbering-wording.json').read_text(encoding='utf-8'))


def original(db,key):
    scope,category,code=key
    if scope=='numbering':
        return dict(manual())
    if scope=='category':
        row=db.execute('SELECT category_name,source_workbook,notes FROM asset_categories WHERE id=?',(category,)).fetchone()
        notes=row['notes'] or ''
        if notes.startswith(('บัญชีตั้งต้นจากข้อมูลแยกประเภท','ตัวอย่างหมวดสำหรับทดสอบ')):
            notes=''
        sources=[r[0].removeprefix('classification-starter/') for r in db.execute('SELECT DISTINCT s.filename FROM starter_catalog_rows r JOIN source_documents s ON s.id=r.source_document_id WHERE r.category_id=?',(category,))]
        citation='; '.join(sources) if sources else (row['source_workbook'] if row['source_workbook']!='ข้อมูลสาธิต' else '')
        return {'title':row['category_name'],'text':notes or row['category_name'],'conditions':'','citation':citation}
    from numbering import category_codes
    items,_=category_codes(db,category);item=next(item for item in items if item['code']==code)
    sources=[row[0].removeprefix('classification-starter/') for row in db.execute('SELECT DISTINCT s.filename FROM starter_catalog_rows r JOIN source_documents s ON s.id=r.source_document_id WHERE r.category_id=? AND r.fsn_code=?',(category,code))]
    sources += [row[0] for row in db.execute('SELECT reference FROM category_fsn_codes WHERE category_id=? AND fsn_code=?',(category,code)) if row[0]]
    citation='; '.join(dict.fromkeys(sources)) if sources else item['reference']
    return {'title':code,'text':'\n'.join(item['typeNames'] or item['names']),'conditions':'','citation':citation}


def content(db,key):
    row=db.execute('SELECT * FROM catalogue_wording WHERE '+KEY,key).fetchone()
    base=original(db,key)
    result={'scope':key[0],'categoryId':key[1],'code':key[2],'title':base['title']}
    if row:
        result.update(text=row['content_text'],conditions=row['conditions'],citation=row['citation'],revision=row['revision'],
                      originalText=row['source_text'],originalCitation=row['source_citation'],updatedBy=row['updated_by'],updatedAt=row['updated_at'])
    else:
        result.update(text=base['text'],conditions=base['conditions'],citation=base['citation'],revision=0,
                      originalText=base['text']+('\n\n'+base['conditions'] if base['conditions'] else ''),originalCitation=base['citation'],updatedBy='',updatedAt='')
    return result


def read(db,scope='numbering',category_id=0,code=''):
    return content(db,target(db,{'scope':scope,'categoryId':category_id,'code':code}))


def text_field(body,key,limit,required=False):
    value=body.get(key,'')
    if not isinstance(value,str):
        raise GuidanceError('ข้อความต้องเป็นตัวอักษร')
    value=value.replace('\r\n','\n').replace('\r','\n').strip()
    if (required and not value) or len(value)>limit:
        raise GuidanceError('กรุณาระบุข้อความให้ครบและไม่เกินขนาดที่กำหนด')
    return value


def handle(db,method,path,query,body):
    if path not in ('/api/catalog/guidance','/api/catalog/guidance/history'):
        return None
    if method=='GET':
        raw=one(query,'categoryId','0')
        try:category=int(raw)
        except (ValueError,TypeError):raise GuidanceError('หมวดไม่ถูกต้อง')
        key=target(db,{'scope':one(query,'scope','numbering'),'categoryId':category,'code':one(query,'code')})
        if path.endswith('/history'):
            if one(query,'actor')!=OFFICER:
                raise GuidanceError('ประวัติคำอธิบายใช้บทบาทเจ้าหน้าที่พัสดุในโหมดทดสอบ',403)
            try:offset=max(0,int(one(query,'offset','0')))
            except (ValueError,TypeError):raise GuidanceError('หน้าประวัติไม่ถูกต้อง')
            rows=db.execute('SELECT revision,actor,reason,before_json,after_json,created_at FROM catalogue_wording_events WHERE '+KEY+' ORDER BY revision DESC LIMIT 20 OFFSET ?',(*key,offset)).fetchall()
            return {'items':[{'revision':r['revision'],'actor':r['actor'],'reason':r['reason'],'before':json.loads(r['before_json']),'after':json.loads(r['after_json']),'createdAt':r['created_at']} for r in rows],
                    'total':db.execute('SELECT COUNT(*) FROM catalogue_wording_events WHERE '+KEY,key).fetchone()[0],'offset':offset,'limit':20}
        return content(db,key)
    if method!='PUT' or path.endswith('/history'):
        raise GuidanceError('ไม่รองรับคำสั่งนี้',405)
    if body.get('actor')!=OFFICER:
        raise GuidanceError('การแก้ไขข้อความใช้บทบาทเจ้าหน้าที่พัสดุในโหมดทดสอบ',403)
    key=target(db,body)
    values={name:text_field(body,name,limit,required) for name,limit,required in [('text',10000,True),('conditions',10000,False),('citation',4000,False),('reason',1000,True)]}
    db.execute('BEGIN IMMEDIATE')
    if key[1] and not db.execute('SELECT 1 FROM asset_categories WHERE id=? AND is_active=1',(key[1],)).fetchone():
        raise GuidanceError('หมวดถูกปิดใช้งานแล้ว')
    before=content(db,key)
    if type(body.get('revision')) is not int or body['revision']!=before['revision']:
        raise GuidanceError('ข้อความถูกแก้ไขจากอีกหน้าต่าง กรุณาโหลดฉบับล่าสุดก่อนบันทึก',409)
    if all(values[name]==before[name] for name in ('text','conditions','citation')):
        return before
    now=datetime.now(timezone.utc).isoformat(timespec='seconds');revision=before['revision']+1
    db.execute('''INSERT INTO catalogue_wording(scope,category_id,fsn_code,content_text,conditions,citation,source_text,source_citation,revision,updated_by,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope,category_id,fsn_code) DO UPDATE SET
        content_text=excluded.content_text,conditions=excluded.conditions,citation=excluded.citation,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at''',
        (*key,values['text'],values['conditions'],values['citation'],before['originalText'],before['originalCitation'],revision,OFFICER,now))
    after=content(db,key)
    db.execute('INSERT INTO catalogue_wording_events(scope,category_id,fsn_code,revision,actor,reason,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        (*key,revision,OFFICER,values['reason'],json.dumps(before,ensure_ascii=False),json.dumps(after,ensure_ascii=False),now))
    return after
