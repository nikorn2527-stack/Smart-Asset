"""Registration and repair identity regressions against SQLite and the HTTP server."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3

from test_smart_workflow import HTTPFixture, OFFICER


class AssetEntry(HTTPFixture):
    def automatic(self, **changes):
        return {'name':'ครุภัณฑ์ทดสอบเลขลำดับ', 'fsnGroup':'9876', 'fsnType':'123',
                'categoryId':self.call('/api/catalog/categories')[0]['id'],
                'actor':OFFICER, **changes}

    def test_codes_use_entire_register_and_serialize_concurrent_writers(self):
        old=self.call('/api/assets',self.automatic(code='9876-123-0450'),expected=201)
        # A high existing sequence is outside the 150 recent records loaded by the UI.
        with sqlite3.connect(self.db) as db:
            db.executemany("INSERT INTO assets(name,code) VALUES(?,?)",
                           [(f'รายการเก่า {i}',f'HISTORY-{i}') for i in range(160)])
        self.assertNotIn(old['id'],[a['id'] for a in self.call('/api/assets')])
        self.assertIn(old['id'],[a['id'] for a in self.call('/api/assets/pending')])
        body=self.automatic()
        with ThreadPoolExecutor(max_workers=4) as pool:
            created=list(pool.map(lambda _:self.call('/api/assets',body,expected=201),range(4)))
        self.assertEqual(sorted(a['code'] for a in created),[f'9876-123-{i:04}' for i in range(451,455)])
        for asset in created:
            self.assertEqual(asset['status'],'รออนุมัติ')
            detail=self.smart(asset['id'])
            self.assertIn('/q/',detail['qrUrl'])
        self.call('/api/assets',self.automatic(code=old['code']),expected=409)

    def test_invalid_fsn_does_not_create_partial_registration(self):
        before=self.call('/api/health')['assets']
        for changes in ({'fsnGroup':'12'},{'fsnType':'abc'},{'fsnGroup':'๑๒๓๔'},{'categoryId':999999}):
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
