"""Scoped generation, evidence preservation, policy snapshots and recoverable backups."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urlencode
from test_smart_workflow import HTTPFixture,OFFICER,ROOT
sys.path.insert(0,str(ROOT))
from governance import CENTER_NAME, CENTER_NAME_EN, initialize,calculate,GovernanceError,rehome_split_register_to_hospital

class AccountGovernance(HTTPFixture):
    def setUp(self):
        self.aid=self.post('accounts',name='หน่วยงานทดสอบ',code='TEST-'+uuid.uuid4().hex[:12])['id']
        self.cid=self.call('/api/catalog/categories')[0]['id']
    def post(self,kind,**fields):
        return self.call('/api/governance/'+kind,{'actor':OFFICER,**fields},method='POST',expected=201)
    def profile(self,pattern='{group:4}-{type:3}-{seq:3}',kind='inventory',**fields):
        return self.post('profiles',accountId=self.aid,name='แบบทดสอบ',pattern=pattern,numberKind=kind,**fields)['id']
    def bind(self,pid=None,policy=None,**fields):
        return self.post('bindings',accountId=self.aid,profileId=pid,policyId=policy,**fields)['id']
    def context(self,**fields):return {'accountId':self.aid,'categoryId':self.cid,'values':{'group':'7110','type':'2','detail':'1'},'actor':OFFICER,**fields}
    def register(self,**fields):return self.call('/api/assets',{'name':'อุปกรณ์','purchasePrice':10000,'acquisitionDate':'2025-01-01',**self.context(**fields)},method='POST',expected=201)
    def preview(self,**fields):return self.call('/api/governance/preview',self.context(**fields),method='POST')
    def policy(self,rate=20):
        return self.call('/api/catalog/depreciation',{'actor':OFFICER,'ruleNo':'TEST-'+uuid.uuid4().hex[:8],'categoryName':'คอมพิวเตอร์','years':5,'annualRate':rate,'calculationMethod':'annual_rate','residualValuePercent':10,'categoryIds':[self.cid]},method='POST',expected=201)

    def test_patterns_8_10_11_15_digits_no_truncation_or_silent_sequence(self):
        for pattern,kind,count in [('{group:4}{detail:4}','classification',8),('{group:4}-{type:3}-{seq:3}','inventory',10),('{group:4}-{type:3}-{detail:4}','classification',11),('{group:4}-{type:3}-{detail:4}-{seq:4}','inventory',15)]:
            pid=self.profile(pattern,kind)
            branch=self.post('branches',accountId=self.aid,name='สาขาทดสอบ',code='B'+str(count))['id']
            self.bind(pid,branchId=branch)
            result=self.preview(branchId=branch)
            self.assertEqual(len(result['code'].replace('-','')),count)
            self.assertEqual('seq' in result['values'],kind=='inventory')
        self.call('/api/governance/preview',self.context(branchId=branch,values={'group':'12345','type':'2','detail':'1'}),method='POST',expected=400)

    def test_specific_bindings_choose_number_and_policy_independently(self):
        default=self.profile();self.bind(default)
        branch=self.post('branches',accountId=self.aid,name='สาขา',code='B1')['id']
        branch_profile=self.profile('{group:4}{detail:4}','classification');self.bind(branch_profile,branchId=branch)
        category_profile=self.profile('{group:4}-{type:3}-{detail:4}','classification');self.bind(category_profile,categoryId=self.cid)
        policy=self.policy();self.bind(policy=policy['id'],branchId=branch,categoryId=self.cid)
        result=self.preview(branchId=branch)
        self.assertEqual(result['profile']['id'],category_profile)
        self.assertEqual(result['policy']['id'],policy['id'])
        self.assertEqual(result['matchedScope'],'หมวดของหน่วยงาน')
        # A future version does not affect the earlier issue date.
        future=self.profile('{group:4}/{seq:5}')
        self.bind(future,branchId=branch,categoryId=self.cid,effectiveFrom='2099-01-01')
        self.assertEqual(self.preview(branchId=branch,numberDate='2026-10-18')['profile']['id'],category_profile)
        self.assertEqual(self.preview(branchId=branch,numberDate='2099-01-02')['profile']['id'],future)

    def test_cross_account_same_number_and_classification_multiple_assets_keep_distinct_qr(self):
        self.bind(self.profile('{group:4}-{type:3}-{detail:4}','classification'))
        one=self.register();two=self.register()
        self.assertEqual(one['code'],two['code']);self.assertNotEqual(one['id'],two['id'])
        smart=self.smart(one['id'])
        self.assertNotEqual(smart['qrUrl'],self.smart(two['id'])['qrUrl'])
        self.call(f'/api/assets/{one["id"]}/smart',self.edit(smart,name='ชื่อแก้ไขโดยคงเลขและ QR',location='ห้องทดสอบ'),method='PUT')
        self.assertEqual(self.smart(one['id'])['qrUrl'],smart['qrUrl'])
        other=self.post('accounts',name='หน่วยงานที่สอง',code=uuid.uuid4().hex)['id']
        p=self.post('profiles',accountId=other,name='เลขชิ้น',pattern='{group:4}-{type:3}-{detail:4}',numberKind='inventory')['id']
        self.post('bindings',accountId=other,profileId=p)
        third=self.register(accountId=other);self.assertEqual(third['code'],one['code'])
        self.call('/api/assets',{'name':'ซ้ำ','accountId':other,'categoryId':self.cid,'values':{'group':'7110','type':'2','detail':'1'}},method='POST',expected=409)
        inv=self.call('/api/inventory?'+urlencode({'accountId':other}))
        self.assertEqual([i['id'] for i in inv['items']],[third['id']])
        # Code-only repairs must reject ambiguous identity.
        self.call('/api/tickets',{'assetCode':one['code'],'assetName':'ไม่ควรเลือกเอง','location':'A','issue':'เสีย','requester':'ทดสอบ'},method='POST',expected=400)

    def test_atomic_sequence_preview_non_consuming_and_overflow_rollback(self):
        self.bind(self.profile('{group:4}-{seq:3}'))
        first=self.preview()['code'];self.assertEqual(self.preview()['code'],first)
        with ThreadPoolExecutor(max_workers=6) as pool:assets=list(pool.map(lambda _:self.register(),range(8)))
        self.assertEqual(len({a['code'] for a in assets}),8)
        self.assertEqual(min(a['code'] for a in assets),first)
        # Width one exhausts cleanly without creating asset/events or reserving a number.
        branch=self.post('branches',accountId=self.aid,name='เต็ม',code='F')['id'];pid=self.profile('{group:4}/{seq:1}');self.bind(pid,branchId=branch)
        for _ in range(9):self.register(branchId=branch)
        before=self.call('/api/health')['assets']
        self.call('/api/assets',{'name':'เต็ม','branchId':branch,**self.context()},method='POST',expected=409)
        self.assertEqual(self.call('/api/health')['assets'],before)

    def test_policy_snapshot_exception_and_no_retroactive_recalculation(self):
        policy=self.policy();self.bind(self.profile(),policy['id'])
        asset=self.register();before=self.call(f'/api/governance/assets/{asset["id"]}?asOf=2026-01-01')
        self.assertEqual(before['calculation']['accumulated'],2000)
        body={'actor':OFFICER,'ruleNo':policy['ruleNo'],'categoryName':'คอมพิวเตอร์','years':5,'annualRate':40,'calculationMethod':'annual_rate','residualValuePercent':10,'categoryIds':[self.cid]}
        self.call(f'/api/catalog/depreciation/{policy["id"]}',body,method='PUT')
        after=self.call(f'/api/governance/assets/{asset["id"]}?asOf=2026-01-01')
        self.assertEqual(after,before)
        override=self.policy(10)
        self.call('/api/governance/preview',self.context(policyOverrideId=override['id'],overrideReason=''),method='POST',expected=400)
        exceptional=self.register(policyOverrideId=override['id'],overrideReason='ตามหนังสือเฉพาะรายการ')
        saved=self.call(f'/api/governance/assets/{exceptional["id"]}')
        self.assertEqual(saved['depreciation']['overrideReason'],'ตามหนังสือเฉพาะรายการ')
        self.assertEqual(saved['depreciation']['policy']['annual_rate_percent'],10)
        self.assertEqual(calculate(saved['depreciation']['policy'],10000,'2020-01-01','2099-01-01')['netBookValue'],1000)

    def test_binding_revision_cross_scope_and_bad_patterns_rejected(self):
        pid=self.profile();binding=self.bind(pid)
        for pattern,kind in [('{group:4}-{seq:4}','classification'),('{group:0}','inventory'),('{oops:4}','inventory'),('{group:4}-{group:4}','inventory'),('{group:4}X','inventory')]:
            self.call('/api/governance/profiles',{'accountId':self.aid,'name':'ผิด','pattern':pattern,'numberKind':kind,'actor':OFFICER},method='POST',expected=400)
        body={'accountId':self.aid,'profileId':pid,'revision':1,'actor':OFFICER}
        self.call('/api/governance/bindings',body,method='POST')
        self.call('/api/governance/bindings',body,method='POST',expected=409)
        branch=self.post('branches',accountId=self.aid,name='สาขา',code='OTHER')['id']
        other=self.post('accounts',name='อื่น',code=uuid.uuid4().hex)['id']
        self.call('/api/governance/preview',self.context(accountId=other,branchId=branch),method='POST',expected=400)
        self.call('/api/governance/accounts',{'actor':'ผู้แจ้ง','name':'ไม่อนุญาต','code':'DENIED'},method='POST',expected=403)

    def test_catalog_separated_and_manual_original_preserved(self):
        self.bind(self.profile())
        row=self.post('catalog',accountId=self.aid,categoryId=self.cid,name='ตู้เฉพาะบัญชี',code='ต้นฉบับ/08',values={'group':'9999','type':'22'},source='เงื่อนไขเฉพาะ')
        asset=self.register(catalogId=row['id'],values={})
        self.assertTrue(asset['code'].startswith('9999-022-'))
        original=self.register(code='เลขเดิม/8-พิเศษ',values={})
        self.assertEqual(original['code'],'เลขเดิม/8-พิเศษ')
        other=self.post('accounts',name='อีกบัญชี',code=uuid.uuid4().hex)['id']
        shared=self.call('/api/governance/catalog?'+urlencode({'accountId':other,'categoryId':self.cid}))['items']
        self.assertTrue(shared);self.assertTrue(all(r['shared_catalog_id'] for r in shared));self.assertNotIn('ตู้เฉพาะบัญชี',[r['name'] for r in shared])
        self.call('/api/governance/preview',self.context(accountId=other,catalogId=row['id']),method='POST',expected=400)

    def test_latest_scope_version_masks_old_values_and_policy_uses_acquisition_date(self):
        default=self.profile();self.bind(default)
        old=self.profile('{group:4}/{seq:4}');policy=self.policy()
        self.bind(old,policy['id'],categoryId=self.cid,effectiveFrom='2020-01-01')
        self.bind(policy=policy['id'],categoryId=self.cid,effectiveFrom='2026-01-01')
        self.assertEqual(self.preview(numberDate='2026-10-18')['profile']['id'],default)
        # Numbering date and depreciation rule date are deliberately independent.
        result=self.preview(numberDate='2026-10-18',acquisitionDate='2019-01-01')
        self.assertIsNone(result['policy'])
        self.assertEqual(result['depreciationRuleDate'],'2019-01-01')

    def test_changed_selection_since_preview_returns_conflict_without_allocating(self):
        self.bind(self.profile())
        shown=self.preview()
        row=self.post('catalog',accountId=self.aid,categoryId=self.cid,name='ชนิด',code='001',values={'group':'7110','type':'2'},source='เดิม')
        shown=self.preview(catalogId=row['id'])
        self.call('/api/governance/catalog',{'id':row['id'],'revision':1,'accountId':self.aid,'categoryId':self.cid,'name':'ชนิด','code':'001','values':{'group':'7110','type':'2'},'source':'เงื่อนไขเปลี่ยนแล้ว','actor':OFFICER},method='POST')
        count=self.call('/api/health')['assets']
        self.call('/api/assets',{'name':'ไม่ควรบันทึก','expectedSelection':shown['selectionVersion'],**self.context(catalogId=row['id'])},method='POST',expected=409)
        self.assertEqual(self.call('/api/health')['assets'],count)
        latest=self.preview(catalogId=row['id'],acquisitionDate='2025-01-01');self.assertEqual(latest['code'],shown['code'])
        saved=self.register(catalogId=row['id'],expectedSelection=latest['selectionVersion'])
        self.assertEqual(saved['code'],latest['code'])

    def test_pdf_reference_preserves_four_digit_type_and_separates_owner(self):
        data=self.call('/api/governance')
        center=next(a['id'] for a in data['accounts'] if a['code']=='MEDCENTER')
        source=self.call('/api/governance/references?'+urlencode({'accountId':center,'q':'0204'}))
        cabinet=next(r for r in source['items'] if '4 ลิ้นชัก' in r['name'])
        self.assertEqual(cabinet['group_code'],'7110');self.assertEqual(cabinet['type_code'],'0204');self.assertEqual(cabinet['page'],53)
        self.assertEqual(self.call('/api/governance/references?'+urlencode({'accountId':self.aid}))['total'],907)
        self.assertTrue(all(r['shared_catalog_id'] for r in self.call('/api/governance/catalog?'+urlencode({'accountId':center,'categoryId':self.cid}))['items']))

    def test_edits_keep_account_and_catalog_history_and_detect_stale_revision(self):
        original=self.call('/api/governance')['accounts']
        account=next(a for a in original if a['id']==self.aid)
        update={'actor':OFFICER,'id':self.aid,'revision':account['revision'],'name':'ชื่อหน่วยงานฉบับใหม่','code':account['code'],'notes':'แก้ชื่อ'}
        self.call('/api/governance/accounts',update,method='POST')
        self.call('/api/governance/accounts',update,method='POST',expected=409)
        entry=self.post('catalog',accountId=self.aid,categoryId=self.cid,name='ชนิดเดิม',code='001',values={'category':'001'},source='ข้อความเดิม')
        edit={'actor':OFFICER,'id':entry['id'],'revision':1,'accountId':self.aid,'categoryId':self.cid,'name':'ชนิดแก้ไข','code':'001','values':{'category':'001'},'source':'เงื่อนไขปรับใหม่'}
        self.call('/api/governance/catalog',edit,method='POST')
        self.call('/api/governance/catalog',edit,method='POST',expected=409)
        with sqlite3.connect(self.db) as db:
            saved=db.execute("SELECT before_json,after_json FROM account_events WHERE kind='catalog' AND entity_id=? AND before_json<>'null' ORDER BY id DESC",(entry['id'],)).fetchone()
            self.assertEqual(json.loads(saved[0])['source'],'ข้อความเดิม')
            self.assertEqual(json.loads(saved[1])['source'],'เงื่อนไขปรับใหม่')

    def test_backup_original_bytes_checksums_restore_and_refuse_corruption(self):
        content=b'%PDF-1.7\noriginal bytes: do not normalize\n'
        self.call('/api/backups/sources',{'actor':OFFICER,'accountId':self.aid,'filename':'ต้นฉบับ.pdf','purpose':'reference_catalog','data':base64.b64encode(content).decode()},method='POST',expected=201)
        raw=self.call('/api/backups/download?'+urlencode({'actor':OFFICER}))
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            manifest=json.loads(archive.read('manifest.json'))
            for entry in manifest['files']:self.assertEqual(hashlib.sha256(archive.read(entry['path'])).hexdigest(),entry['sha256'])
            self.assertIn(content,[archive.read(n) for n in archive.namelist() if n.startswith('sources/')])
        spec=importlib.util.spec_from_file_location('restore_backup',ROOT/'scripts/restore-backup.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as folder:
            backup=Path(folder)/'backup.zip';backup.write_bytes(raw);output=Path(folder)/'restored.sqlite3'
            counts=module.restore(backup,output)
            with sqlite3.connect(output) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM assets').fetchone()[0],counts['assets'])
            with self.assertRaises(ValueError):module.restore(backup,output)
            bad=Path(folder)/'bad.zip'
            with zipfile.ZipFile(io.BytesIO(raw)) as src,zipfile.ZipFile(bad,'w') as dst:
                for name in src.namelist():dst.writestr(name,src.read(name)+(b'X' if name=='database/smart-asset.sqlite3' else b''))
            with self.assertRaises(ValueError):module.restore(bad,Path(folder)/'bad.sqlite3')
            self.assertFalse((Path(folder)/'bad.sqlite3').exists())
        self.call('/api/backups/download?'+urlencode({'actor':'ผู้แจ้ง'}),expected=403)
        prepared=Path(str(self.db)+'.backups')/'prepared-test.zip';prepared.write_bytes(raw)
        listed=self.call('/api/backups?'+urlencode({'actor':OFFICER}))['prepared']
        self.assertIn('prepared-test.zip',[item['filename'] for item in listed])
        self.assertEqual(self.call('/api/backups/prepared/prepared-test.zip?'+urlencode({'actor':OFFICER})),raw)
        self.call('/api/backups/prepared/prepared-test.zip?'+urlencode({'actor':'ผู้แจ้ง'}),expected=403)
        self.call('/api/backups/prepared/not-found.zip?'+urlencode({'actor':OFFICER}),expected=404)

class ExistingDatabaseMigration(unittest.TestCase):
    def test_thai_windows_default_cp874_does_not_affect_reference_loading(self):
        original_read = Path.read_text
        def windows_read(path, *args, **kwargs):
            if not args and kwargs.get('encoding') is None:
                kwargs['encoding'] = 'cp874'
            return original_read(path, *args, **kwargs)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'windows.sqlite3'
            with sqlite3.connect(path) as db:
                db.executescript((ROOT/'schema.sql').read_text(encoding='utf-8'))
                db.execute("INSERT INTO assets(id,code,name) VALUES(1,'เดิม/001','ชื่อภาษาไทย')")
            with patch.object(Path, 'read_text', windows_read):
                initialize(path)
                initialize(path)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT code,name FROM assets WHERE id=1').fetchone(),('เดิม/001','ชื่อภาษาไทย'))
                self.assertEqual(db.execute("SELECT name FROM asset_accounts WHERE code='SURIN'").fetchone()[0],'โรงพยาบาลสุรินทร์')
                self.assertEqual(db.execute("SELECT name FROM asset_accounts WHERE code='MEDCENTER'").fetchone()[0],CENTER_NAME)
                self.assertEqual(db.execute("SELECT notes FROM asset_accounts WHERE code='MEDCENTER'").fetchone()[0],CENTER_NAME_EN)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM account_manual_references').fetchone()[0],907)
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_failed_reference_decode_rolls_back_and_next_start_recovers(self):
        original_read = Path.read_text
        def fail_reference(path, *args, **kwargs):
            if path.name == 'classification-v1.json':
                raise UnicodeDecodeError('cp874', b'\x84', 0, 1, 'undefined character')
            return original_read(path, *args, **kwargs)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'retry.sqlite3'
            with sqlite3.connect(path) as db:
                db.executescript((ROOT/'schema.sql').read_text(encoding='utf-8'))
                db.execute("INSERT INTO assets(id,code,name) VALUES(12,'OLD/001','ข้อมูลเดิม')")
            with patch.object(Path, 'read_text', fail_reference):
                with self.assertRaises(UnicodeDecodeError):initialize(path)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT id,code,name FROM assets').fetchall(),[(12,'OLD/001','ข้อมูลเดิม')])
                self.assertIsNone(db.execute("SELECT 1 FROM schema_migrations WHERE name='account-numbering-v1'").fetchone())
                self.assertIsNone(db.execute("SELECT 1 FROM sqlite_master WHERE name='asset_accounts'").fetchone())
            initialize(path)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM asset_accounts').fetchone()[0],2)
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_imported_duplicate_numbers_are_retained_without_rewriting(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'imported.sqlite3'
            source=json.loads((ROOT/'reference-data/classification-v1.json').read_text(encoding='utf-8'))['categories'][0]['source']
            with sqlite3.connect(path) as db:
                db.executescript((ROOT/'schema.sql').read_text(encoding='utf-8'))
                sid=db.execute("INSERT INTO source_documents(filename,source_kind) VALUES(?,'workbook')",(source,)).lastrowid
                for aid in [1,2]:db.execute("INSERT INTO assets(id,code,name,source_document_id) VALUES(?,'DUPLICATE','ต้นฉบับ',?)",(aid,sid))
            initialize(path)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT id,code,code_unique FROM assets ORDER BY id').fetchall(),[(1,'DUPLICATE',0),(2,'DUPLICATE',0)])
                self.assertEqual(db.execute('SELECT COUNT(*) FROM assets WHERE numbering_account_id IS NOT NULL').fetchone()[0],2)
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_global_unique_rebuild_preserves_ids_deleted_high_water_and_foreign_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'old.sqlite3'
            with sqlite3.connect(path) as db:
                db.executescript((ROOT/'schema.sql').read_text(encoding='utf-8'))
                # Match the original small prototype's global unique code constraint.
                db.execute('DROP TABLE assets')
                db.execute('CREATE TABLE assets(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,source_document_id INTEGER REFERENCES source_documents(id))')
                db.execute("INSERT INTO assets(id,code,name) VALUES(12,'OLD-0001','เดิม')")
                db.execute("INSERT INTO assets(id,code,name) VALUES(99,'DELETED','ลบแล้ว')");db.execute('DELETE FROM assets WHERE id=99')
                db.execute('CREATE TABLE test_links(asset_id INTEGER REFERENCES assets(id))');db.execute('INSERT INTO test_links VALUES(12)')
            initialize(path)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT id,code FROM assets').fetchall(),[(12,'OLD-0001')])
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
                db.execute("INSERT INTO assets(code,name) VALUES('NEW','ใหม่')")
                self.assertGreater(db.execute("SELECT id FROM assets WHERE code='NEW'").fetchone()[0],99)
            initialize(path)
            self.assertEqual(len(list(Path(str(path)+'.backups').glob('*.sqlite3'))),1)

    def test_split_workbook_import_moves_to_hospital_and_leaves_center_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'owners.sqlite3'
            initialize(path)
            with sqlite3.connect(path) as db:
                hid=db.execute("SELECT id FROM asset_accounts WHERE code='SURIN'").fetchone()[0]
                cid=db.execute("SELECT id FROM asset_accounts WHERE code='MEDCENTER'").fetchone()[0]
                db.execute("INSERT INTO organizations(name,code) VALUES('ศูนย์แพทย์โรงพยาบาลสุรินทร์','MEDCENTER')")
                org=db.execute("SELECT id FROM organizations WHERE code='MEDCENTER'").fetchone()[0]
                db.execute("INSERT INTO assets(name,code,created_by,numbering_account_id,organization_id) VALUES('ตู้โรงพยาบาล','7110-002-0001-0001','นำเข้าทะเบียน',?,?)",(cid,org))
                db.execute("DELETE FROM schema_migrations WHERE name='hospital-owns-split-register-v1'")
                db.commit()
            rehome_split_register_to_hospital(path)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute("SELECT numbering_account_id,code FROM assets WHERE created_by='นำเข้าทะเบียน'").fetchone()[0],hid)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM assets WHERE numbering_account_id=?",(cid,)).fetchone()[0],0)
                self.assertEqual(db.execute("SELECT name FROM organizations WHERE id=(SELECT organization_id FROM assets WHERE code='7110-002-0001-0001')").fetchone()[0],'โรงพยาบาลสุรินทร์')
                rehome_split_register_to_hospital(path)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM assets WHERE numbering_account_id=?",(hid,)).fetchone()[0],1)
