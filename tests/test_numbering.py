"""Category relationships and source fidelity, using synthetic source documents."""
import sqlite3
from urllib.parse import urlencode
from test_smart_workflow import HTTPFixture, OFFICER


class Numbering(HTTPFixture):
    def new_category(self, name):
        return self.call('/api/catalog/categories', {'name':name,'actor':OFFICER},expected=201)['id']

    def imported(self, category, code, name='รายการต้นทาง', **changes):
        with sqlite3.connect(self.db) as db:
            source=db.execute("INSERT INTO source_documents(filename,title,source_kind) VALUES(?,?,'workbook')",(f'fixture-{category}-{code}', 'บัญชีทดสอบ')).lastrowid
            return db.execute('INSERT INTO assets(category_id,code,name,source_document_id,source_row_no,raw_data_json,status) VALUES(?,?,?,?,?,?,?)',
                (category,code,name,source,17,'{"source":"must remain intact"}',changes.get('status','ใช้งาน'))).lastrowid

    def catalog(self, category, **query):
        return self.call('/api/catalog/numbering?'+urlencode({'categoryId':category,**query}))

    def test_register_evidence_is_complete_and_preserves_legacy_and_source(self):
        category=self.new_category('หมวดเลขตามทะเบียน')
        ids=[self.imported(category,'7320-003-0042-0001/2','รายการเดียวกัน'),self.imported(category,'7320-003-0042-0002.1','อีกชื่อในบัญชี'),self.imported(category,'OLD/2569')]
        for n in range(155):self.imported(category,f'7320-003-0042-{n+10:04d}')
        before=self.call('/api/health')['assets']
        data=self.catalog(category,code='7320-003-0042')
        self.assertEqual(data['total'],1)
        self.assertEqual(data['coverage'],{'registerRows':158,'recognizedRows':157,'otherFormatRows':1})
        self.assertEqual(data['nextCode'],'7320-003-0042-0165')
        self.assertEqual(data['selected']['assetCount'],157)
        self.assertEqual(len(data['examples']),5)
        self.assertEqual(data['examples'][0]['source_row_no'],17)
        self.assertIn('อีกชื่อในบัญชี',data['selected']['names'])
        self.assertEqual(self.call('/api/health')['assets'],before)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT code,fsn_code,raw_data_json FROM assets WHERE id=?',(ids[0],)).fetchone(),('7320-003-0042-0001/2','','{"source":"must remain intact"}'))
        created=self.call('/api/assets',{'name':'เพิ่มชนิดเดิม','fsnCode':'7320-003-0042','categoryId':category},expected=201)
        self.assertEqual(created['code'],data['nextCode'])

    def test_pdf_examples_and_four_digit_types_are_not_agency_mappings(self):
        category=self.new_category('หมวดตัวอย่างไม่ใช่รหัสหน่วยงาน')
        with sqlite3.connect(self.db) as db:
            source=db.execute("INSERT INTO source_documents(filename,source_kind) VALUES('manual-fixture','fsn_manual')").lastrowid
            db.execute("INSERT INTO fsn_catalog_items(source_document_id,source_page,category_code,type_code,item_name,canonical_fsn_code) VALUES(?,2,'7110','002','ตู้ตัวอย่าง','7110-002-0001')",(source,))
            db.execute("INSERT INTO fsn_catalog_items(source_document_id,source_page,category_code,type_code,item_name) VALUES(?,32,'6530','0101','เตียงตามต้นฉบับ')",(source,))
        self.assertEqual(self.catalog(category)['items'],[])
        self.call('/api/assets',{'name':'ห้ามใช้เลขตัวอย่างทันที','fsnCode':'7110-002-0001','categoryId':category},expected=400)
        self.imported(category,'6530-0101-0001-0001')
        self.assertEqual(self.catalog(category)['coverage']['otherFormatRows'],1)
        refs=self.call('/api/catalog/fsn?'+urlencode({'q':'เตียงตามต้นฉบับ'}))['items']
        self.assertEqual(refs[0]['typeCode'],'0101')

    def test_category_boundary_is_checked_for_auto_and_explicit_classification(self):
        first=self.new_category('หมวดแรกเท่านั้น');second=self.new_category('หมวดอื่นต้องไม่เดา')
        self.imported(first,'7290-003-0123-0001')
        self.assertEqual(self.catalog(second)['items'],[])
        body={'name':'ผิดหมวด','fsnCode':'7290-003-0123','categoryId':second}
        self.call('/api/assets',body,expected=400)
        self.call('/api/assets',{**body,'code':'LEGACY-CLASSIFIED'},expected=400)
        saved=self.call('/api/assets',{**body,'fsnCode':'','code':'LEGACY/2569'},expected=201)
        self.assertEqual(saved['code'],'LEGACY/2569')

    def test_agency_code_can_be_explicitly_linked_to_multiple_categories(self):
        first=self.new_category('หมวดบัญชีกำหนดใหม่');second=self.new_category('หมวดใช้ชนิดร่วมกัน')
        payload={'code':'7110-002-0037','name':'คุณลักษณะบัญชีหน่วยงาน','reference':'บัญชีรหัสหน่วยงาน หน้า 7','actor':OFFICER,'categoryId':first}
        entry=self.call('/api/catalog/fsn',payload,expected=201)
        self.assertEqual(self.catalog(first)['items'][0]['assetCount'],0)
        self.assertEqual(self.catalog(second)['items'],[])
        link={'itemId':entry['id'],'categoryId':second,'reference':'ประกาศใช้ร่วม หมวดที่สอง','actor':OFFICER}
        self.call('/api/catalog/fsn/link',{**link,'actor':'ผู้แจ้ง'},expected=403)
        self.call('/api/catalog/fsn/link',{**link,'categoryId':True},expected=400)
        self.call('/api/catalog/fsn/link',link,expected=201)
        self.call('/api/catalog/fsn/link',link,expected=400)
        self.assertEqual(self.catalog(second)['items'][0]['reference'],link['reference'])
        self.imported(first,'7110-002-0037-0900')
        created=self.call('/api/assets',{'categoryId':second,'fsnCode':payload['code'],'name':'ชนิดร่วม'},expected=201)
        self.assertEqual(created['code'],'7110-002-0037-0901')

    def test_pending_unverified_and_malformed_rows_do_not_create_selectable_codes(self):
        category=self.new_category('หมวดรอทบทวน')
        self.call('/api/assets',{'name':'ยังรออนุมัติ','code':'7110-002-0888-0001','categoryId':category},expected=201)
        for code in ['7110-002-9999','7110-002-9999-1garbage','7110-002-9999--1','7110-002-9999-']:
            self.imported(category,code)
        self.assertEqual(self.catalog(category)['items'],[])
        self.assertEqual(self.catalog(category)['coverage']['otherFormatRows'],4)
        self.call('/api/catalog/numbering?categoryId=invalid',expected=400)
        self.call('/api/catalog/numbering?categoryId=999999',expected=400)
        self.call('/api/catalog/numbering?'+urlencode({'categoryId':category,'code':'7110-002'}),expected=400)
