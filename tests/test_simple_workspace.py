"""Daily row editing never rewrites source evidence, QR identity or historical policies."""
import json
import sqlite3
import uuid
from urllib.parse import urlencode
from test_smart_workflow import HTTPFixture,OFFICER

class SimpleWorkspace(HTTPFixture):
    def setUp(self):
        self.aid=self.call('/api/governance/accounts',{'actor':OFFICER,'name':'หน่วยทดสอบ','code':uuid.uuid4().hex},expected=201)['id']
        self.cid=self.call('/api/catalog/categories')[0]['id']
    def board(self,**fields):return self.call('/api/workspace/categories?'+urlencode({'accountId':self.aid,**fields}))
    def row(self,**fields):return next(r for r in self.board(**fields)['items'] if r['id']==self.cid)
    def save_row(self,**fields):
        current=self.row();return self.call('/api/workspace/categories',{'actor':OFFICER,'accountId':self.aid,'categoryId':self.cid,'date':self.board()['date'],'version':current['version'],'name':current['name'],'notes':current['notes'],'profileChoice':'preset:inventory',**fields},method='PUT')
    def policy(self,rate=20):return self.call('/api/catalog/depreciation',{'actor':OFFICER,'ruleNo':uuid.uuid4().hex,'categoryName':'ค่าเสื่อมทดสอบ','calculationMethod':'annual_rate','annualRate':rate,'years':5,'residualValuePercent':0,'categoryIds':[self.cid]},expected=201)
    def asset(self,**fields):
        self.save_row();return self.call('/api/assets',{'name':'เครื่องทดสอบ','accountId':self.aid,'categoryId':self.cid,'values':{'group':'7110','type':'002','detail':'0001'},'actor':OFFICER,'purchasePrice':10000,'acquisitionDate':'2025-01-01',**fields},expected=201)
    def edit(self,aid,changes=None,**fields):
        before=self.call(f'/api/workspace/assets/{aid}')
        return self.call(f'/api/workspace/assets/{aid}',{'actor':OFFICER,'version':before['version'],'changes':changes or {},**fields},method='PUT')

    def test_archive_categories_and_counts_are_available_without_importing_assets(self):
        hospital=next(a['id'] for a in self.call('/api/governance')['accounts'] if a['code']=='SURIN')
        data=self.board(accountId=hospital)
        self.assertEqual(len(data['items']),19)
        self.assertGreater(sum(r['kindCount'] for r in data['items']),1000)
        self.assertEqual(sum(r['assetCount'] for r in data['items']),0)

    def test_uncoded_source_kinds_remain_visible_without_inventing_numbers(self):
        hospital=next(a['id'] for a in self.call('/api/governance')['accounts'] if a['code']=='SURIN')
        with sqlite3.connect(self.db) as db:
            pending=db.execute("SELECT id,category_id,name,code,values_json FROM account_catalog WHERE account_id=? AND code=''",(hospital,)).fetchall()
        self.assertEqual(len(pending),3)
        for item,cid,name,code,values in pending:
            self.assertEqual(values,'{}')
            rows=self.call('/api/governance/catalog?'+urlencode({'accountId':hospital,'categoryId':cid}))['items']
            self.assertIn(item,[r['id'] for r in rows])
            self.call('/api/governance/preview',{'accountId':hospital,'categoryId':cid,'catalogId':item,'values':{'group':'9999','type':'1','detail':'1'}},method='POST',expected=400)

    def test_save_number_and_depreciation_on_one_row_with_account_only_label(self):
        original=self.call('/api/catalog/categories')[0]['name'];policy=self.policy()
        self.save_row(name='ชื่อหมวดของหน่วยนี้',policyId=policy['id'])
        row=self.row();self.assertEqual(row['name'],'ชื่อหมวดของหน่วยนี้');self.assertEqual(row['policy']['id'],policy['id'])
        self.assertEqual(row['profile']['pattern'],'{group:4}-{type:3}-{detail:4}-{seq:4}')
        self.assertEqual(self.call('/api/catalog/categories')[0]['name'],original)
        hospital=next(a['id'] for a in self.call('/api/governance')['accounts'] if a['code']=='SURIN')
        self.assertEqual(self.row(accountId=hospital)['name'],original)
        created=self.call('/api/assets',{'name':'ตามหมวด','accountId':self.aid,'categoryId':self.cid,'values':{'group':'7110','type':'2','detail':'1'}},expected=201)
        self.assertEqual(created['group'],'ชื่อหมวดของหน่วยนี้')
        self.assertEqual(self.call(f'/api/governance/assets/{created["id"]}')['depreciation']['policy']['id'],policy['id'])

    def test_stale_category_draft_does_not_overwrite_or_create_extra_profile(self):
        row=self.row();self.save_row(name='ฉบับใหม่')
        before=len(self.call('/api/governance')['profiles'])
        self.call('/api/workspace/categories',{'actor':OFFICER,'accountId':self.aid,'categoryId':self.cid,'version':row['version'],'name':'ร่างเก่า','profileChoice':'preset:fsn'},method='PUT',expected=409)
        self.assertEqual(self.row()['name'],'ฉบับใหม่');self.assertEqual(len(self.call('/api/governance')['profiles']),before)

    def test_edit_code_category_price_keeps_qr_source_and_original_snapshots(self):
        policy=self.policy();self.save_row(policyId=policy['id'])
        asset=self.call('/api/assets',{'name':'เดิม','accountId':self.aid,'categoryId':self.cid,'values':{'group':'7110','type':'2','detail':'1'},'purchasePrice':10000,'acquisitionDate':'2025-01-01'},expected=201)
        aid=asset['id'];qr=self.smart(aid)['qrUrl']
        with sqlite3.connect(self.db) as db:
            sid=db.execute("INSERT INTO source_documents(filename,source_kind) VALUES('test.xls','workbook')").lastrowid
            db.execute('INSERT INTO source_row_records(source_document_id,source_row_no,asset_id,record_kind,raw_data_json) VALUES(?,1,?,\'asset\',?)',(sid,aid,json.dumps({'original':'unchanged','code':asset['code']})))
            db.execute('INSERT INTO asset_depreciation_snapshots(asset_id,annual_depreciation,net_book_value) VALUES(?,?,?)',(aid,2000,8000))
            original=db.execute('SELECT raw_data_json FROM source_row_records WHERE asset_id=?',(aid,)).fetchone()[0]
        self.call('/api/governance/bindings',{'actor':OFFICER,'accountId':self.aid,'profileId':self.row()['profile']['id']},expected=201)
        cats=self.call('/api/catalog/categories');other=next(c['id'] for c in cats if c['id']!=self.cid)
        self.edit(aid,{'name':'ใหม่','code':'แก้เลข/0001','categoryId':other,'purchasePrice':20000},policyAction='override',policyId=policy['id'],reason='ตรวจตามเอกสารฉบับจริง')
        self.assertEqual(self.smart(aid)['qrUrl'],qr)
        state=self.call(f'/api/workspace/assets/{aid}');self.assertEqual(state['fields']['code'],'แก้เลข/0001');self.assertEqual(state['fields']['purchasePrice'],20000)
        inv=self.call('/api/inventory?'+urlencode({'accountId':self.aid}))['items'][0]
        self.assertEqual(inv['purchasePrice'],20000);self.assertEqual(inv['netBookValue'],8000);self.assertIsNotNone(inv['depreciationEstimate'])
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT raw_data_json FROM source_row_records WHERE asset_id=?',(aid,)).fetchone()[0],original)
            self.assertEqual(db.execute('SELECT net_book_value FROM asset_depreciation_snapshots WHERE asset_id=?',(aid,)).fetchall(),[(8000,)])
            event=json.loads(db.execute("SELECT note FROM asset_events WHERE asset_id=? AND action='แก้ไขจากแถวทะเบียน'",(aid,)).fetchone()[0])
            self.assertEqual(event['before']['code'],asset['code']);self.assertEqual(event['after']['code'],'แก้เลข/0001')

    def test_reason_duplicate_stale_and_cross_account_branch_validation(self):
        one=self.asset();two=self.asset()
        before=self.call(f'/api/workspace/assets/{one["id"]}')
        self.call(f'/api/workspace/assets/{one["id"]}',{'actor':OFFICER,'version':before['version'],'changes':{'code':'NEW'}},method='PUT',expected=400)
        self.call(f'/api/workspace/assets/{one["id"]}',{'actor':OFFICER,'version':before['version'],'changes':{'code':two['code']},'reason':'แก้เลข'},method='PUT',expected=409)
        self.edit(one['id'],{'name':'แก้แล้ว'})
        self.call(f'/api/workspace/assets/{one["id"]}',{'actor':OFFICER,'version':before['version'],'changes':{'name':'ร่างเก่า'}},method='PUT',expected=409)
        self.assertEqual(self.call(f'/api/workspace/assets/{one["id"]}')['fields']['name'],'แก้แล้ว')
        self.call(f'/api/workspace/assets/{one["id"]}',{'actor':'ผู้แจ้ง','version':before['version'],'changes':{}},method='PUT',expected=403)

    def test_metadata_and_new_item_creation_store_serial_without_reusing_old_identity(self):
        asset=self.asset(model='รุ่น A',serialNumber='SERIAL-ONE',custodian='ผู้ดูแล',warrantyEnd='2028-01-01')
        state=self.call(f'/api/workspace/assets/{asset["id"]}');self.assertEqual(state['fields']['serialNumber'],'SERIAL-ONE')
        self.edit(asset['id'],{'model':'รุ่น B','serialNumber':'SERIAL-CORRECT','custodian':'ผู้ดูแลใหม่'})
        state=self.call(f'/api/workspace/assets/{asset["id"]}');self.assertEqual(state['fields']['model'],'รุ่น B');self.assertEqual(state['fields']['serialNumber'],'SERIAL-CORRECT')
        self.assertEqual(self.smart(asset['id'])['asset']['serialNumber'],'SERIAL-CORRECT')

    def test_search_and_count_share_account_branch_and_category_label_joins(self):
        asset=self.asset(name='เครื่องค้นหาเฉพาะ')
        self.save_row(name='หมวดชื่อเฉพาะหน่วยงาน')
        query=lambda q:self.call('/api/inventory?'+urlencode({'accountId':self.aid,'q':q}))
        self.assertEqual(query('เครื่องค้นหาเฉพาะ')['total'],1)
        self.assertEqual(query('หมวดชื่อเฉพาะหน่วยงาน')['items'][0]['id'],asset['id'])
        self.assertEqual(query('ไม่พบรายการแน่นอน')['total'],0)

    def test_unchanged_legacy_formats_and_historic_policy_are_not_normalized_on_name_edit(self):
        asset=self.asset();aid=asset['id']
        with sqlite3.connect(self.db) as db:db.execute("UPDATE assets SET acquisition_date='วันที่เดิมที่ยังตรวจไม่ได้' WHERE id=?",(aid,))
        before=self.call(f'/api/workspace/assets/{aid}')
        self.edit(aid,{'name':'แก้เฉพาะชื่อ'})
        after=self.call(f'/api/workspace/assets/{aid}')
        self.assertEqual(after['fields']['acquisitionDate'],before['fields']['acquisitionDate']);self.assertEqual(after['depreciation'],before['depreciation'])
