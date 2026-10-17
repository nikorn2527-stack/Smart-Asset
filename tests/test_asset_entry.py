"""Registration and repair identity regressions against SQLite and the HTTP server."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3

from test_smart_workflow import HTTPFixture, OFFICER


class AssetEntry(HTTPFixture):
    def automatic(self, **changes):
        if not self.call('/api/catalog/fsn?q=9876-123-0001')['items']:
            self.call('/api/catalog/fsn',{'code':'9876-123-0001','name':'ชนิดตัวอย่าง','reference':'บัญชีทดสอบของหน่วยงาน','actor':OFFICER,'categoryId':self.call('/api/catalog/categories')[0]['id']},expected=201)
        return {'name':'ครุภัณฑ์ทดสอบเลขลำดับ', 'fsnCode':'9876-123-0001',
                'categoryId':self.call('/api/catalog/categories')[0]['id'],
                'actor':OFFICER, **changes}

    def test_codes_use_entire_register_and_serialize_concurrent_writers(self):
        old=self.call('/api/assets',self.automatic(code='9876-123-0001-0450'),expected=201)
        # A high existing sequence is outside the 150 recent records loaded by the UI.
        with sqlite3.connect(self.db) as db:
            db.executemany("INSERT INTO assets(name,code) VALUES(?,?)",
                           [(f'รายการเก่า {i}',f'HISTORY-{i}') for i in range(160)])
        self.assertNotIn(old['id'],[a['id'] for a in self.call('/api/assets')])
        self.assertIn(old['id'],[a['id'] for a in self.call('/api/assets/pending')])
        body=self.automatic()
        with ThreadPoolExecutor(max_workers=4) as pool:
            created=list(pool.map(lambda _:self.call('/api/assets',body,expected=201),range(4)))
        self.assertEqual(sorted(a['code'] for a in created),[f'9876-123-0001-{i:04}' for i in range(451,455)])
        for asset in created:
            self.assertEqual(asset['status'],'รออนุมัติ')
            self.assertEqual(asset['fsnCode'],'9876-123-0001')
            detail=self.smart(asset['id'])
            self.assertIn('/q/',detail['qrUrl'])
        self.call('/api/assets',self.automatic(code=old['code']),expected=409)

    def test_invalid_fsn_does_not_create_partial_registration(self):
        before=self.call('/api/health')['assets']
        for changes in ({'fsnCode':'9876-123'},{'fsnCode':'9876-abc-0001'},{'fsnCode':'๙๘๗๖-123-0001'},{'fsnCode':'9876-123-9999'},{'categoryId':999999}):
            self.call('/api/assets',self.automatic(**changes),expected=400)
        self.assertEqual(self.call('/api/health')['assets'],before)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_repair_resolves_canonical_name_and_rejects_ambiguous_codes(self):
        aid=self.asset('REPAIR-IDENTITY')
        body={'assetName':'ชื่อพิมพ์ผิด','assetCode':'REPAIR-IDENTITY','location':'ห้องตรวจ',
              'issue':'เปิดไม่ติด','requester':'ผู้ทดสอบ'}
        ticket=self.call('/api/tickets',body,expected=201)
        self.assertEqual(ticket['assetId'],aid)
        self.assertEqual(ticket['assetName'],'เครื่องทดสอบ')
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO assets(name,code) VALUES('รายการนำเข้ารหัสซ้ำ','REPAIR-IDENTITY')")
        self.call('/api/tickets',body,expected=400)
        explicit=self.call('/api/tickets',{**body,'assetId':str(aid)},expected=201)
        self.assertEqual(explicit['assetId'],aid)
        self.assertEqual(explicit['assetName'],'เครื่องทดสอบ')
        for invalid in (True,0,'',1.5,{},10**30):
            self.call('/api/tickets',{**body,'assetId':invalid},expected=400)

    def test_fsn_catalog_creation_and_legacy_inventory_numbers_are_separate(self):
        data={'code':'7110-002-9901','name':'ตู้คุณลักษณะทดสอบ','reference':'บัญชีหน่วยงาน ฉบับทดสอบ','actor':OFFICER}
        self.call('/api/catalog/fsn',{**data,'actor':'ช่าง'},expected=403)
        self.call('/api/catalog/fsn',{**data,'code':'7110-002'},expected=400)
        self.call('/api/catalog/fsn',{**data,'reference':''},expected=400)
        created=self.call('/api/catalog/fsn',data,expected=201)
        saved=self.call('/api/catalog/fsn?q=7110-002-9901')['items'][0]
        self.assertEqual(saved['reference'],data['reference'])
        self.assertEqual(saved['sourceKind'],'agency_fsn')
        self.assertEqual(saved['fullCode'],created['fullCode'])
        self.call('/api/catalog/fsn',data,expected=409)
        legacy=self.call('/api/assets',self.automatic(code='OLD-001/2569',fsnCode=''),expected=201)
        self.assertEqual(legacy['code'],'OLD-001/2569')
        self.assertEqual(legacy['fsnCode'],'')
        self.call('/api/assets',{'name':'ไม่ควรให้เลข 3 ชุดแทนเลขประจำชิ้น','categoryId':legacy['categoryId'],'fsnGroup':'7110','fsnType':'002'},expected=400)

    def test_numbering_respects_existing_subitem_suffixes(self):
        self.call('/api/assets',self.automatic(code='9876-123-0001-0800/1'),expected=201)
        self.call('/api/assets',self.automatic(code='9876-123-0001-0801.'),expected=201)
        created=self.call('/api/assets',self.automatic(),expected=201)
        self.assertEqual(created['code'],'9876-123-0001-0802')
        self.assertEqual(created['fsnCode'],'9876-123-0001')
