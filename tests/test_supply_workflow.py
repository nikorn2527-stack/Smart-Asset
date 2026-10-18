"""Document transitions, rollback, reservations, immutable rules and stable QR identity."""
import base64
import json
import sqlite3
import uuid
from test_smart_workflow import HTTPFixture, OFFICER, APPROVER

class SupplyWorkflow(HTTPFixture):
    def setUp(self):
        self.aid=self.call('/api/governance/accounts',{'actor':OFFICER,'name':'หน่วยรับเข้า','code':uuid.uuid4().hex},expected=201)['id']
        self.cid=self.call('/api/catalog/categories')[0]['id']
        profile=self.call('/api/governance/profiles',{'actor':OFFICER,'accountId':self.aid,'name':'เลขรายชิ้น','pattern':'{group:4}-{type:3}-{detail:4}-{seq:4}','numberKind':'inventory'},expected=201)
        self.call('/api/governance/bindings',{'actor':OFFICER,'accountId':self.aid,'profileId':profile['id']},expected=201)
        self.catalog=self.call('/api/governance/catalog',{'actor':OFFICER,'accountId':self.aid,'categoryId':self.cid,'name':'ชนิดทดสอบ','code':'7110-002-0001','values':{'group':'7110','type':'002','detail':'0001'}},expected=201)['id']
    def settings(self,**extra):
        current=self.call(f'/api/supply/settings?accountId={self.aid}')
        return self.call('/api/supply/settings',{'actor':OFFICER,'accountId':self.aid,**current,**extra},method='PUT')
    def receipt(self,quantity=2,**extra):
        body={'actor':OFFICER,'kind':'receipt','accountId':self.aid,'date':'2026-10-18','supplier':'ผู้ขาย','poNo':'PO-123','deliveryNo':'DL-01','location':'คลัง','receiver':'ผู้รับของ','lines':[{'name':'เครื่องทดสอบ','categoryId':self.cid,'quantity':quantity,'unit':'เครื่อง','unitPrice':'1000.25'}],**extra}
        return self.call('/api/supply/documents',body,expected=201)
    def action(self,doc,action,expected=200,actor=OFFICER,**extra):
        return self.call(f'/api/supply/documents/{doc["id"]}',{'actor':actor,'revision':doc['revision'],'action':action,**extra},expected=expected)
    def inspect(self,r,accepted=2,rejected=0):
        r=self.action(r,'submit')
        return self.action(r,'inspect',inspector='กรรมการ',inspectionReference='คำสั่ง 123',inspectionDate='2026-10-18',inspection=[{'lineId':1,'accepted':accepted,'rejected':rejected,'note':'ชำรุด' if rejected else ''}])
    def register(self,r,**extra):
        return self.action(r,'register',**{'lineId':1,'catalogId':self.catalog,'acquisitionDate':'2026-10-18',**extra})
    def issue(self,ids,**extra):
        return self.call('/api/supply/documents',{'actor':OFFICER,'kind':'issue','accountId':self.aid,'date':'2026-10-18','department':'แผนก ก','requester':'ผู้ขอ','purpose':'ใช้ปฏิบัติงาน','assetIds':ids,**extra},expected=201)

    def test_receiving_partial_inspection_register_and_handover(self):
        self.settings(registrationApproval=False)
        r=self.inspect(self.receipt(3),accepted=2,rejected=1)
        r=self.register(r,serialNumbers=['S-1','S-2']);self.assertEqual(r['status'],'registered');self.assertEqual(len(r['assets']),2)
        ids=[a['id'] for a in r['assets']];qr=self.call(f'/api/assets/{ids[0]}/smart')['qrUrl']
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT po_no,vendor_name,quantity,unit_price FROM asset_acquisitions WHERE asset_id=?',(ids[0],)).fetchone(),('PO-123','ผู้ขาย',1.0,1000.25))
        i=self.action(self.issue([ids[0]]),'submit');self.assertEqual(i['status'],'pending')
        self.assertNotIn(ids[0],[a['id'] for a in self.call(f'/api/supply/available?accountId={self.aid}')['items']])
        i=self.action(i,'approve',actor=APPROVER,operator='หัวหน้า');i=self.action(i,'issue',operator='ผู้จ่าย',recipient='ผู้รับ',date='2026-10-18')
        self.assertEqual(self.call(f'/api/workspace/assets/{ids[0]}')['fields']['location'],'คลัง')
        i=self.action(i,'receive',actor='ผู้แจ้ง',operator='ผู้รับ',date='2026-10-18');self.assertEqual(i['status'],'completed')
        self.assertEqual(self.call(f'/api/workspace/assets/{ids[0]}')['fields']['location'],'แผนก ก');self.assertEqual(self.call(f'/api/assets/{ids[0]}/smart')['qrUrl'],qr)
        self.action(i,'receive',operator='ซ้ำ',date='2026-10-18',expected=400)

    def test_rules_are_snapshots_and_attachment_validation_rolls_back(self):
        old=self.receipt();self.settings(receiptAttachment=True,registrationApproval=False,issueApproval=False,issueReference=True)
        self.assertEqual(self.action(old,'submit')['status'],'received')
        new=self.receipt();self.action(new,'submit',expected=400)
        self.action(new,'submit',files=[{'name':'fake.pdf','mime':'application/pdf','content':base64.b64encode(b'bad').decode()}],expected=400)
        fresh=self.call(f'/api/supply/documents/{new["id"]}');self.assertEqual(fresh['revision'],1);self.assertEqual(fresh['status'],'draft')
        pdf=base64.b64encode(b'%PDF-1.4\nexample').decode()
        done=self.action(new,'submit',files=[{'name':'เอกสาร.pdf','mime':'application/pdf','content':pdf}]);self.assertEqual(len(done['files']),1)
        self.assertEqual(self.call('/api/supply/files/'+str(done['files'][0]['id']))['content'],pdf)

    def test_stale_roles_invalid_counts_and_registration_rollback(self):
        r=self.receipt();self.action(r,'submit',actor='ผู้แจ้ง',expected=403);received=self.action(r,'submit');self.action(r,'submit',expected=409)
        self.action(received,'inspect',inspector='กรรมการ',inspectionReference='คำสั่ง',inspectionDate='2026-10-18',inspection=[{'lineId':1,'accepted':3,'rejected':0}],expected=400)
        r=self.action(received,'inspect',inspector='กรรมการ',inspectionReference='คำสั่ง',inspectionDate='2026-10-18',inspection=[{'lineId':1,'accepted':2,'rejected':0}])
        self.register(r,serialNumbers=['DUP','DUP'],expected=400)
        with sqlite3.connect(self.db) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM assets WHERE numbering_account_id=?',(self.aid,)).fetchone()[0],0)
        r=self.register(r);self.assertTrue(all(a['status']=='รออนุมัติ' for a in r['assets']))
        self.action(self.issue([r['assets'][0]['id']]),'submit',expected=409)

    def test_no_approval_reservation_conflict_rejection_and_cancel(self):
        self.settings(registrationApproval=False,issueApproval=False)
        r=self.register(self.inspect(self.receipt()));ids=[a['id'] for a in r['assets']]
        first=self.issue([ids[0]]);second=self.issue([ids[0],ids[1]])
        first=self.action(first,'submit');self.assertEqual(first['status'],'approved');self.action(second,'submit',expected=409)
        # The failed multi-item reservation must leave the other asset available.
        self.assertIn(ids[1],[a['id'] for a in self.call(f'/api/supply/available?accountId={self.aid}')['items']])
        self.action(first,'cancel',note='เปลี่ยนแผน');self.assertEqual(self.action(second,'submit')['status'],'approved')

    def test_registration_failure_after_first_insert_is_atomic(self):
        # A catalog profile that cannot allocate a second sequence must roll back the entire line.
        p=self.call('/api/governance/profiles',{'actor':OFFICER,'accountId':self.aid,'name':'ช่องเลขสั้น','pattern':'{seq:1}','numberKind':'inventory'},expected=201)
        self.call('/api/governance/bindings',{'actor':OFFICER,'accountId':self.aid,'profileId':p['id'],'revision':1})
        r=self.inspect(self.receipt(10),accepted=10)
        self.register(r,expected=409)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM assets WHERE numbering_account_id=?',(self.aid,)).fetchone()[0],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM supply_receipt_assets WHERE document_id=?',(r['id'],)).fetchone()[0],0)
        self.assertEqual(self.call(f'/api/supply/documents/{r["id"]}')['revision'],r['revision'])

    def test_inbox_and_approval_queue_follow_configured_role_and_clear(self):
        self.settings(registrationApproval=False)
        r=self.register(self.inspect(self.receipt()))
        i=self.action(self.issue([r['assets'][0]['id']]),'submit')
        queue=self.call('/api/supply/pending?role='+__import__('urllib.parse',fromlist=['quote']).quote(APPROVER))
        self.assertIn(i['id'],[n['id'] for n in queue['items']])
        notices=self.call('/api/notifications?role='+__import__('urllib.parse',fromlist=['quote']).quote(APPROVER)+'&category=approval&limit=100')
        self.assertTrue(any(n['entity']=='supply' and n['entityId']==i['id'] for n in notices['items']))
        self.action(i,'reject',actor=APPROVER,operator='หัวหน้า',note='ขอใหม่')
        notices=self.call('/api/supply/pending?role='+__import__('urllib.parse',fromlist=['quote']).quote(APPROVER))
        self.assertNotIn(i['id'],[n['id'] for n in notices['items']])

    def test_serial_capture_dates_and_row_editor_keep_acquisition_independent(self):
        self.settings(registrationApproval=False)
        policy=self.call('/api/catalog/depreciation',{'actor':OFFICER,'ruleNo':uuid.uuid4().hex,'categoryName':'หลักเกณฑ์ทดสอบ','calculationMethod':'annual_rate','annualRate':20,'years':5,'categoryIds':[self.cid]},expected=201)
        profile=next(b['profile_id'] for b in self.call('/api/governance')['bindings'] if b['account_id']==self.aid)
        self.call('/api/governance/bindings',{'actor':OFFICER,'accountId':self.aid,'profileId':profile,'policyId':policy['id'],'revision':1})
        r=self.receipt(lines=[{'name':'เครื่องมีซีเรียล','categoryId':self.cid,'quantity':2,'unit':'เครื่อง','unitPrice':'1000.25','serialNumbers':['AT-RECEIVE','']}])
        self.assertEqual(r['data']['lines'][0]['serialNumbers'],['AT-RECEIVE',''])
        r=self.register(self.inspect(r),acquisitionDate='2025-01-01',serialNumbers=['AT-RECEIVE',''])
        aid=r['assets'][0]['id'];state=self.call(f'/api/workspace/assets/{aid}')
        self.assertEqual(state['fields']['depreciationStartDate'],'')
        self.assertIsNone(self.call(f'/api/inventory?accountId={self.aid}')['items'][0]['depreciationEstimate'])
        self.call(f'/api/workspace/assets/{aid}',{'actor':OFFICER,'version':state['version'],'changes':{'depreciationStartDate':'2026-10-01'},'reason':'เริ่มใช้งานตามหลักเกณฑ์'},method='PUT')
        current=self.call(f'/api/workspace/assets/{aid}');self.assertEqual(current['fields']['acquisitionDate'],'2025-01-01')
        self.assertEqual(current['depreciation']['startDate'],'2026-10-01')
        calc=self.call(f'/api/governance/assets/{aid}?asOf=2026-10-18')['calculation'];self.assertEqual(calc['days'],17)
        i=self.action(self.issue([aid]),'submit')
        self.call(f'/api/workspace/assets/{aid}',{'actor':OFFICER,'version':current['version'],'changes':{'location':'ย้ายก่อนส่ง'}},method='PUT',expected=409)
