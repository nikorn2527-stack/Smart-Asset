import base64,io,json,sqlite3,uuid,zipfile
from test_smart_workflow import HTTPFixture,OFFICER
from openpyxl import Workbook

class WebImport(HTTPFixture):
    def setUp(self):
        self.aid=self.call('/api/governance/accounts',{'actor':OFFICER,'name':'องค์กรนำเข้า','code':uuid.uuid4().hex},expected=201)['id']
        self.cid=self.call('/api/catalog/categories')[0]['id']
    def upload(self,rows=None,headers=None):
        b=Workbook();s=b.active;s.title='ทะเบียนจริง';s.append(headers or ['เลขครุภัณฑ์','รายละเอียดครุภัณฑ์','กลุ่มครุภัณฑ์','ราคาทุน','มูลค่าเสื่อมสะสม','มูลค่าคงเหลือ','หมายเลขเครื่อง (Serial Number)','คอลัมน์เฉพาะหน่วยงาน'])
        for r in rows or [['7110-002-0001-0009','ตู้เดิม','หมวดเดิม',1000,200,800,'SN-009','เก็บทั้งหมด']]:s.append(r)
        data=io.BytesIO();b.save(data);archive=io.BytesIO()
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('folder/ทะเบียน.xlsx',data.getvalue())
        return self.call('/api/imports/preview',{'actor':OFFICER,'accountId':self.aid,'filename':'ทะเบียน.zip','content':base64.b64encode(archive.getvalue()).decode()})
    def test_preview_all_columns_confirm_original_values_idempotency(self):
        job=self.upload();self.assertEqual(job['assetRows'],1);self.assertIsNone(job['files'][0]['columns'][-1]['field'])
        with sqlite3.connect(self.db) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM assets WHERE numbering_account_id=?',(self.aid,)).fetchone()[0],0)
        payload={'actor':OFFICER,'id':job['id'],'confirm':True,'categories':{'0':self.cid}}
        result=self.call('/api/imports/commit',payload);self.assertEqual(result['importedAssets'],1)
        result=self.call('/api/imports/commit',payload);self.assertTrue(result['alreadyImported'])
        inv=self.call(f'/api/inventory?accountId={self.aid}')['items'][0];self.assertEqual(inv['code'],'7110-002-0001-0009');self.assertEqual(inv['netBookValue'],800);self.assertEqual(inv['serialNumber'],'SN-009')
        with sqlite3.connect(self.db) as db:
            raw=json.loads(db.execute('SELECT raw_data_json FROM source_row_records WHERE asset_id=?',(inv['id'],)).fetchone()[0]);self.assertEqual(raw['คอลัมน์เฉพาะหน่วยงาน'],'เก็บทั้งหมด')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM source_columns WHERE source_document_id=?',(inv['sourceDocumentId'],)).fetchone()[0],8)
        self.assertTrue(self.upload()['alreadyImported'])
    def test_duplicate_blank_and_nonstandard_numbers_remain_records(self):
        job=self.upload(rows=[['OLD/01','รายการ ก'],['OLD/01','รายการ ข'],['','ไม่มีเลขแต่มีชื่อ']])
        self.assertEqual(job['duplicateNumbers'],2);self.assertEqual(job['blankNumbers'],1)
        self.call('/api/imports/commit',{'actor':OFFICER,'id':job['id'],'confirm':True,'categories':{'0':self.cid}})
        with sqlite3.connect(self.db) as db:
            rows=db.execute('SELECT code,code_unique FROM assets WHERE numbering_account_id=? ORDER BY id',(self.aid,)).fetchall();self.assertEqual(rows,[('OLD/01',0),('OLD/01',0),('',0)])
            self.assertFalse(db.execute('PRAGMA foreign_key_check').fetchall())
    def test_zip_traversal_is_rejected_without_asset_changes(self):
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w') as z:z.writestr('../escape.xlsx',b'bad')
        self.call('/api/imports/preview',{'actor':OFFICER,'accountId':self.aid,'filename':'bad.zip','content':base64.b64encode(data.getvalue()).decode()},expected=400)

    def test_excel_time_cells_are_preserved_in_unknown_columns(self):
        from datetime import time
        job=self.upload(rows=[['7110-002-0001-0001','ของทดสอบ','หมวด',100,0,100,'SERIAL',time(8,30)]])
        self.assertEqual(job['files'][0]['samples'][0]['original']['คอลัมน์เฉพาะหน่วยงาน'],'08:30:00')

    def test_generic_depreciation_amount_does_not_invent_monthly_period(self):
        job=self.upload(rows=[['7110-002-0001-0001','เครื่อง',99.25,400,600]],headers=['เลขครุภัณฑ์','รายละเอียดครุภัณฑ์','มูลค่าเสื่อม','มูลค่าเสื่อมสะสม','มูลค่าคงเหลือ'])
        self.call('/api/imports/commit',{'actor':OFFICER,'id':job['id'],'confirm':True,'categories':{'0':self.cid}})
        asset=self.call(f'/api/inventory?accountId={self.aid}')['items'][0]
        self.assertEqual(asset['depreciationValue'],99.25);self.assertIsNone(asset['monthlyDepreciation']);self.assertEqual(asset['accumulatedDepreciation'],400);self.assertEqual(asset['netBookValue'],600)
