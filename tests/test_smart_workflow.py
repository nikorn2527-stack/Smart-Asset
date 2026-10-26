"""HTTP regression tests against a temporary SQLite database and real server."""
import base64
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OFFICER, APPROVER, TECH = 'เจ้าหน้าที่พัสดุ', 'ผู้อนุมัติ', 'ช่าง'


class HTTPFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.db = Path(cls.temp.name) / 'test.sqlite3'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.base = f'http://127.0.0.1:{cls.port}'
        cls.log = open(Path(cls.temp.name) / 'server.log', 'w+')
        cls.proc = subprocess.Popen([sys.executable, 'server.py'], cwd=ROOT,
            env={**os.environ, 'ASSET_DB_PATH': str(cls.db), 'PORT': str(cls.port), 'HOST':'127.0.0.1', 'PUBLIC_BASE_URL':'','WORK_SCHEDULER_INTERVAL_SECONDS':'1','ASSET_AUTH_REQUIRED':getattr(cls,'auth_required','0')},
            stdout=cls.log, stderr=cls.log)
        for _ in range(100):
            try:
                cls.call('/api/health')
                break
            except OSError:
                time.sleep(.05)
        else:
            cls.proc.terminate()
            cls.log.seek(0)
            raise RuntimeError(cls.log.read())

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.log.close()
        try:
            cls.temp.cleanup()
        except Exception:
            pass

    @classmethod
    def call(cls, path, body=None, method=None, expected=200):
        req = Request(cls.base+path, data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type':'application/json'}, method=method)
        try:
            response = urlopen(req, timeout=10)
        except HTTPError as exc:
            response = exc
        with response:
            raw = response.read()
            result = json.loads(raw) if 'application/json' in response.headers.get('Content-Type','') else raw
            if response.status != expected:
                raise AssertionError(f'{method or "GET"} {path}: {response.status} != {expected}: {result}')
            return result

    def asset(self, code):
        category=self.call('/api/catalog/categories')[0]['id']
        a=self.call('/api/assets',{'name':'เครื่องทดสอบ','code':code,'categoryId':category,'location':'ห้อง A'},expected=201)
        return a['id']

    def smart(self, asset_id):
        return self.call(f'/api/assets/{asset_id}/smart')

    def edit(self, smart, **changes):
        return {**smart['asset'], 'version':smart['version'], 'actor':OFFICER, **changes}

    def action(self, ticket_id, action, actor, **fields):
        return self.call(f'/api/tickets/{ticket_id}/action', {'action':action,'actor':actor,**fields})


class SmartWorkflow(HTTPFixture):
    def test_stable_qr_edit_and_optimistic_conflict(self):
        aid=self.asset('SMART-001'); before=self.smart(aid)
        self.call(f'/api/assets/{aid}/smart',self.edit(before,code='SMART-EDITED',name='เครื่องใหม่',location='ห้อง B',serialNumber='SN-01'),method='PUT')
        after=self.smart(aid)
        self.assertEqual(before['qrUrl'],after['qrUrl'])
        token=before['qrUrl'].rsplit('/',1)[1]
        scan=self.call('/api/scan/'+token)
        self.assertEqual((scan['code'],scan['name'],scan['location'],scan['serialNumber']),('SMART-EDITED','เครื่องใหม่','ห้อง B','SN-01'))
        self.call(f'/api/assets/{aid}/smart',self.edit(before),method='PUT',expected=409)
        self.call(f'/api/assets/{aid}/smart',self.edit(after,actor=TECH),method='PUT',expected=403)
        self.assertIn('scan.js', self.call('/q/'+token).decode())
        self.assertEqual(len(self.smart(aid)['events']),2) # registration + edit

    def test_scan_repair_approval_parts_rework_and_acceptance(self):
        aid=self.asset('SMART-002'); smart=self.smart(aid); token=smart['qrUrl'].rsplit('/',1)[1]
        receipt=self.call(f'/api/scan/{token}/repairs',{'requester':'ผู้ทดสอบ','contact':'private-contact','issue':'เปิดไม่ติด','assetId':999,'assetCode':'forged'},expected=201)
        ticket=self.smart(aid)['tickets'][0]; tid=ticket['id']
        self.assertEqual(ticket['assetId'],aid)
        self.assertEqual(ticket['assetCode'],'SMART-002')
        path='/api/receipts/'+receipt['receiptToken']
        self.call(path+'/action',{'action':'confirm'},expected=400)
        self.action(tid,'review',OFFICER,estimateCost=6000,requiresPurchase=True)
        self.call(f'/api/tickets/{tid}/action',{'action':'approve','actor':TECH},expected=403)
        self.action(tid,'approve',APPROVER,note='อนุมัติ')
        self.action(tid,'assign',OFFICER,assignedTo='ช่าง A')
        self.action(tid,'wait_parts',TECH,note='รออะไหล่')
        self.action(tid,'resume',TECH)
        self.action(tid,'complete',TECH,workNotes='เปลี่ยนอะไหล่',actualCost=7000)
        self.assertFalse(self.call(path)['canConfirm'])
        self.action(tid,'reject_final_cost',APPROVER,note='ขอรายละเอียด')
        self.action(tid,'resubmit_cost',OFFICER,actualCost=6500,note='แก้ไขยอด')
        self.action(tid,'approve_final_cost',APPROVER)
        self.call(path+'/action',{'action':'send_back','note':''},expected=400)
        self.call(path+'/action',{'action':'send_back','note':'ยังมีเสียงดัง'})
        self.action(tid,'complete',TECH,workNotes='แก้ไขเรียบร้อย',actualCost=6000)
        result=self.call(path+'/action',{'action':'confirm','note':'ใช้งานได้แล้ว'})
        self.assertEqual(result['status'],'ปิดงาน')
        self.assertTrue(result['closedAt'])
        self.assertGreater(len(result['events']),10)
        serialized=json.dumps(result)
        for field in ('contact','requester','workNotes','approvalReason'):
            self.assertNotIn('"'+field+'"',serialized)
        self.assertEqual(self.call('/api/scan/'+token)['activeRepairs'],0)
        self.call(path+'/action',{'action':'confirm'},expected=400)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_sticker_uses_same_stable_url(self):
        aid=self.asset('SMART-003');smart=self.smart(aid)
        printed=self.call('/api/sticker/render',{'assetIds':[aid]})
        self.assertIn(smart['qrImage'], printed['html'])
        self.assertEqual(printed['count'],1)
        svg=base64.b64decode(smart['qrImage'].split(',',1)[1])
        self.assertIn(b'<svg',svg)

    def test_branding_validation_persistence_and_logo(self):
        before=self.call('/api/branding')
        logo='data:image/png;base64,'+base64.b64encode((ROOT/'assets/govasset-icon-optimized.png').read_bytes()).decode()
        data={'appName':'ทะเบียนหน่วยงาน','organization':'กองพัสดุ','logo':logo,'publicBaseUrl':'https://assets.example.go.th','actor':OFFICER,'revision':before['revision']}
        saved=self.call('/api/branding',data,method='PUT')
        self.assertEqual(saved['developer'],'POWER BY PNG TEAM')
        self.assertEqual(saved['developerColor'],'#f97316')
        self.assertEqual(self.call('/api/branding')['logo'],logo)
        aid=self.asset('SMART-BRAND')
        self.assertTrue(self.smart(aid)['qrUrl'].startswith(data['publicBaseUrl']+'/q/'))
        self.call('/api/branding',{**data,'logo':'data:image/svg+xml;base64,PHN2Zz4='},method='PUT',expected=400)
        self.call('/api/branding',{**data,'publicBaseUrl':'javascript:alert(1)'},method='PUT',expected=400)
        self.call('/api/branding',{**data,'actor':TECH},method='PUT',expected=403)
        self.call('/api/branding',{**before,'revision':self.call('/api/branding')['revision'],'actor':OFFICER},method='PUT')

    def test_branding_revision_logo_retention_audit_and_sticker_name(self):
        cur=self.call('/api/branding')
        base={'appName':'ทดสอบ','organization':'หน่วยงาน ก','actor':OFFICER}
        logo='data:image/png;base64,'+base64.b64encode((ROOT/'assets/govasset-icon-optimized.png').read_bytes()).decode()
        self.call('/api/branding',base,method='PUT',expected=409)
        self.call('/api/branding',{**base,'revision':cur['revision']+5},method='PUT',expected=409)
        # A label that still follows the organization name is re-linked on save.
        self.call('/api/sticker/settings',{'orgName':cur['organization']},method='POST')
        first=self.call('/api/branding',{**base,'logo':logo,'revision':cur['revision']},method='PUT')
        self.assertEqual(first['revision'],cur['revision']+1)
        second=self.call('/api/branding',{**base,'organization':'หน่วยงาน ข','revision':first['revision']},method='PUT')
        self.assertEqual(second['logo'],logo,'omitting logo must keep the stored logo')
        self.assertEqual(self.call('/api/sticker/settings')['orgName'],'หน่วยงาน ข')
        self.call('/api/branding',{**base,'revision':first['revision']},method='PUT',expected=409)
        # A deliberately different label name is never overwritten.
        self.call('/api/sticker/settings',{'orgName':'ชื่อบนฉลาก'},method='POST')
        third=self.call('/api/branding',{**base,'organization':'หน่วยงาน ค','logo':'','revision':second['revision']},method='PUT')
        self.assertEqual(third['logo'],'')
        self.assertEqual(self.call('/api/sticker/settings')['orgName'],'ชื่อบนฉลาก')
        with sqlite3.connect(self.db) as db:
            rows=db.execute('SELECT actor,before_json,after_json FROM app_branding_events ORDER BY id DESC LIMIT 3').fetchall()
        self.assertEqual(len(rows),3);self.assertTrue(all(r[0]==OFFICER for r in rows))
        self.assertTrue(all(len(r[1])<2000 and len(r[2])<2000 for r in rows),'audit rows must not embed the logo image')

    def test_missing_tokens_and_private_files(self):
        self.call('/api/scan/'+'x'*32,expected=404)
        self.call('/api/receipts/'+'x'*32,expected=404)
        self.call('/.git/config',expected=404)
        self.call('/server.py',expected=404)
        self.call('/schema.sql',expected=404)
        self.call('/.git/config',method='HEAD',expected=404)

    def test_overview_is_aggregated_from_database(self):
        overview=self.call('/api/overview')
        with sqlite3.connect(self.db) as db:
            self.assertEqual(overview['assets'],db.execute('SELECT COUNT(*) FROM assets').fetchone()[0])
            self.assertEqual(overview['activeRepairs'],db.execute("SELECT COUNT(*) FROM tickets WHERE status NOT IN ('ปิดงาน','ยกเลิก','ไม่อนุมัติ')").fetchone()[0])
        self.assertGreater(overview['activeCategories'],0)

    def test_z_qr_and_branding_survive_process_restart(self):
        aid=self.asset('SMART-RESTART')
        before=self.smart(aid)
        branding=self.call('/api/branding')
        cls=type(self)
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.proc=subprocess.Popen([sys.executable,'server.py'],cwd=ROOT,
            env={**os.environ,'ASSET_DB_PATH':str(cls.db),'PORT':str(cls.port),'HOST':'127.0.0.1','PUBLIC_BASE_URL':'','WORK_SCHEDULER_INTERVAL_SECONDS':'1','ASSET_AUTH_REQUIRED':getattr(cls,'auth_required','0')},
            stdout=cls.log,stderr=cls.log)
        for _ in range(100):
            try:
                cls.call('/api/health')
                break
            except OSError:
                time.sleep(.05)
        else:
            self.fail('Server did not restart')
        self.assertEqual(before['qrUrl'],self.smart(aid)['qrUrl'])
        self.assertEqual(branding,self.call('/api/branding'))


if __name__=='__main__':
    unittest.main()
