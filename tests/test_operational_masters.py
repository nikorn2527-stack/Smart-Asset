"""Scoped master references, optimistic updates, history and existing-data suggestions."""
import json
import sqlite3
import uuid
from urllib.parse import urlencode
from test_smart_workflow import HTTPFixture, OFFICER

class OperationalMasters(HTTPFixture):
    def setUp(self):
        self.aid=self.call('/api/governance/accounts',{'actor':OFFICER,'name':'หน่วยข้อมูลหลัก','code':uuid.uuid4().hex},expected=201)['id']
        self.cid=self.call('/api/catalog/categories')[0]['id']
    def master(self,kind,name,**extra):return self.call('/api/operational-master',{'actor':OFFICER,'accountId':self.aid,'kind':kind,'name':name,**extra},expected=201)
    def update(self,m,**changes):return self.call('/api/operational-master',{'actor':OFFICER,'accountId':m['account_id'],'branchId':m['branch_id'],'kind':m['kind'],'id':m['id'],'name':m['name'],'code':m['code'],'revision':m['revision'],'extra':m['extra'],**changes},method='PUT')
    def list(self,**params):return self.call('/api/operational-master?'+urlencode({'accountId':self.aid,**params}))
    def receipt(self,**extra):return self.call('/api/supply/documents',{'actor':OFFICER,'kind':'receipt','accountId':self.aid,'date':'2026-10-18','supplier':'ผู้ขายข้อความเดิม','location':'คลังข้อความเดิม','receiver':'ผู้รับข้อความเดิม','lines':[{'name':'รายการ','categoryId':self.cid,'unit':'ชิ้น','quantity':1,'unitPrice':'100'}],**extra},expected=201)
    def submit(self,r,expected=200):return self.call('/api/supply/documents/'+str(r['id']),{'actor':OFFICER,'action':'submit','revision':r['revision']},expected=expected)

    def test_ids_supply_canonical_names_and_snapshots_not_display_text(self):
        supplier=self.master('supplier','บริษัท ก',extra={'address':'ที่อยู่จริง','taxId':'123','phone':'044'})
        location=self.master('location','คลังพัสดุ');receiver=self.master('person','เจ้าหน้าที่ ก');unit=self.master('unit','เครื่อง')
        r=self.receipt(supplierId=supplier['id'],supplier='ชื่อที่ส่งผิด',locationId=location['id'],receiverId=receiver['id'],lines=[{'name':'รายการ','categoryId':self.cid,'unitId':unit['id'],'quantity':1,'unitPrice':'100'}])
        self.assertEqual(r['data']['supplier'],'บริษัท ก');self.assertEqual(r['data']['location'],'คลังพัสดุ')
        self.assertEqual(r['data']['lines'][0]['unit'],'เครื่อง');self.assertEqual(r['data']['masterLinks']['supplier']['extra']['address'],'ที่อยู่จริง')
        r=self.submit(r);self.update(supplier,name='บริษัท ก ใหม่')
        later=self.call('/api/supply/documents/'+str(r['id']))
        self.assertEqual(later['data']['supplier'],'บริษัท ก');self.assertEqual(later['data']['masterLinks']['supplier']['revision'],1)

    def test_rename_or_deactivation_blocks_stale_draft_not_historical_documents(self):
        m=self.master('supplier','ผู้ขาย');r=self.receipt(supplierId=m['id']);m=self.update(m,name='ผู้ขายใหม่');self.submit(r,expected=409)
        body={'actor':OFFICER,'action':'save','revision':r['revision'],**r['data'],'supplierId':m['id']}
        r=self.call('/api/supply/documents/'+str(r['id']),body,method='PUT');self.assertEqual(r['data']['supplier'],'ผู้ขายใหม่')
        r=self.submit(r);self.update(m,isActive=False)
        self.assertEqual(self.call('/api/supply/documents/'+str(r['id']))['data']['supplier'],'ผู้ขายใหม่')
        self.assertNotIn(m['id'],[x['id'] for x in self.list(kind='supplier')['items']])
        self.assertIn(m['id'],[x['id'] for x in self.list(kind='supplier',includeInactive=1)['items']])

    def test_account_branch_type_and_optimistic_validation(self):
        other=self.call('/api/governance/accounts',{'actor':OFFICER,'name':'อีกหน่วย','code':uuid.uuid4().hex},expected=201)['id']
        m=self.master('supplier','ต่างบัญชี',accountId=other)
        self.call('/api/supply/documents',{'actor':OFFICER,'kind':'receipt','accountId':self.aid,'supplierId':m['id']},expected=400)
        b=self.call('/api/governance/branches',{'actor':OFFICER,'accountId':self.aid,'name':'สาขา ก','code':'B'},expected=201)['id']
        m=self.master('supplier','เฉพาะสาขา',branchId=b)
        self.assertNotIn(m['id'],[v['id'] for v in self.list(kind='supplier')['items']])
        self.assertIn(m['id'],[v['id'] for v in self.list(kind='supplier',branchId=b)['items']])
        self.assertIn(m['id'],[v['id'] for v in self.list(kind='supplier',allBranches=1)['items']])
        new=self.update(m,notes='ฉบับใหม่')
        self.call('/api/operational-master',{'actor':OFFICER,'accountId':self.aid,'branchId':b,'kind':'supplier','id':m['id'],'revision':m['revision'],'name':m['name']},method='PUT',expected=409)
        self.call('/api/operational-master',{'actor':'ผู้แจ้ง','accountId':self.aid,'kind':'supplier','name':'ไม่มีสิทธิ์'},expected=403)

    def test_duplicate_names_codes_and_department_cycles(self):
        a=self.master('department','แผนก ก',code='DEP-A');b=self.master('department','แผนก ข',parentId=a['id'])
        self.call('/api/operational-master',{'actor':OFFICER,'accountId':self.aid,'kind':'department','name':'  แผนก   ก  '},expected=409)
        self.call('/api/operational-master',{'actor':OFFICER,'accountId':self.aid,'kind':'department','name':'อีกชื่อ','code':'dep-a'},expected=409)
        self.call('/api/operational-master',{'actor':OFFICER,'accountId':self.aid,'kind':'department','id':a['id'],'revision':a['revision'],'name':a['name'],'parentId':b['id']},method='PUT',expected=400)
        self.assertEqual(self.list(kind='department')['total'],2)

    def test_existing_text_candidates_are_scoped_and_require_explicit_adoption(self):
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO assets(name,code,group_name,location,category_id,created_at,numbering_account_id) VALUES('เดิม',?,'ทดสอบ','คลังจากทะเบียน',?,'2026-10-18',?)",(uuid.uuid4().hex,self.cid,self.aid))
        before=self.list(kind='location')['total']
        choices=self.call('/api/operational-master/candidates?'+urlencode({'accountId':self.aid,'kind':'location'}))
        self.assertIn('คลังจากทะเบียน',choices['items']);self.assertEqual(before,self.list(kind='location')['total'])
        self.master('location','คลังจากทะเบียน');self.assertEqual(self.list(kind='location')['total'],before+1)
        with sqlite3.connect(self.db) as db:self.assertEqual(db.execute('SELECT location FROM assets WHERE numbering_account_id=?',(self.aid,)).fetchone()[0],'คลังจากทะเบียน')

    def test_supplier_snapshot_contacts_flow_into_registered_acquisition(self):
        m=self.master('supplier','บริษัทต้นทาง',extra={'address':'ที่อยู่ ณ วันรับ','phone':'044-000-000'})
        p=self.call('/api/governance/profiles',{'actor':OFFICER,'accountId':self.aid,'name':'แบบเลข','pattern':'{group:4}-{type:3}-{detail:4}-{seq:4}','numberKind':'inventory'},expected=201)
        self.call('/api/governance/bindings',{'actor':OFFICER,'accountId':self.aid,'profileId':p['id']},expected=201)
        catalog=self.call('/api/governance/catalog',{'actor':OFFICER,'accountId':self.aid,'categoryId':self.cid,'name':'ชนิด','code':'7110-002-0001','values':{'group':'7110','type':'002','detail':'0001'}},expected=201)['id']
        r=self.submit(self.receipt(supplierId=m['id']))
        self.update(m,name='บริษัทชื่อใหม่',extra={'address':'ที่อยู่ใหม่','phone':'999'})
        r=self.call('/api/supply/documents/'+str(r['id']),{'actor':OFFICER,'action':'inspect','revision':r['revision'],'inspector':'กรรมการ','inspectionReference':'คำสั่ง 1','inspectionDate':'2026-10-18','inspection':[{'lineId':1,'accepted':1,'rejected':0}]})
        r=self.call('/api/supply/documents/'+str(r['id']),{'actor':OFFICER,'action':'register','revision':r['revision'],'lineId':1,'catalogId':catalog,'acquisitionDate':'2026-10-18'})
        aid=r['assets'][0]['id']
        with sqlite3.connect(self.db) as db:self.assertEqual(db.execute('SELECT vendor_name,vendor_address,vendor_phone FROM asset_acquisitions WHERE asset_id=?',(aid,)).fetchone(),('บริษัทต้นทาง','ที่อยู่ ณ วันรับ','044-000-000'))
        self.assertEqual(self.call('/api/inventory?'+urlencode({'accountId':self.aid}))['items'][0]['vendor'],'บริษัทต้นทาง')
