"""Document wording can change without rewriting source classifications or assets."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
import sqlite3
import subprocess
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request,urlopen

from test_smart_workflow import HTTPFixture,OFFICER,ROOT


class CatalogGuidance(HTTPFixture):
    def context(self):
        office=next(row['id'] for row in self.call('/api/catalog/categories') if row['name']=='ครุภัณฑ์สำนักงาน')
        code=self.call('/api/catalog/numbering?'+urlencode({'categoryId':office}))['items'][0]['code']
        return {'scope':'code','categoryId':office,'code':code}

    def wording(self,context):
        return self.call('/api/catalog/guidance?'+urlencode(context))

    def save(self,current,**changes):
        return self.call('/api/catalog/guidance',{**current,'actor':OFFICER,'reason':'แก้ตามหนังสือฉบับใหม่',**changes},method='PUT')

    def history(self,context):
        return self.call('/api/catalog/guidance/history?'+urlencode({**context,'actor':OFFICER}))

    def test_literal_document_text_and_immutable_source_snapshot(self):
        context={'scope':'numbering'};before=self.wording(context)
        self.assertIn('ชุดที่หนึ่ง มีตัวเลข 4',before['originalText'])
        self.assertIn('คู่มือ การออกเลขครุภัณฑ์.pdf',before['originalCitation'])
        after=self.save(before,text='ข้อกำหนดที่ใช้งาน\r\n\r\nคงรูปแบบย่อหน้า',conditions='ใช้กับรายการที่ระบุ\nไม่รวมรายการอื่น',citation='หนังสือหน่วยงาน ฉบับ 2 ข้อ 3')
        self.assertEqual(after['text'],'ข้อกำหนดที่ใช้งาน\n\nคงรูปแบบย่อหน้า')
        self.assertEqual(after['originalText'],before['originalText'])
        self.assertEqual(after['originalCitation'],before['originalCitation'])
        self.assertEqual(self.wording(context),after)
        history=self.history(context)
        self.assertEqual(history['items'][0]['before']['text'],before['text'])
        self.assertEqual(history['items'][0]['after']['conditions'],after['conditions'])
        again=self.save(after)
        self.assertEqual(again['revision'],after['revision'])
        self.assertEqual(self.history(context)['total'],history['total'])

    def test_edit_code_wording_does_not_reclassify_or_renumber_any_assets(self):
        context=self.context();before=self.wording(context)
        with sqlite3.connect(self.db) as db:
            assets=db.execute('SELECT id,code,name,asset_type FROM assets ORDER BY id').fetchall()
            source=db.execute('SELECT * FROM starter_catalog_rows ORDER BY category_id,type_name,fsn_code').fetchall()
        after=self.save(before,text='<b>ชื่อที่ใช้แสดง</b>\nขอบเขตตามหนังสือ',conditions='เงื่อนไขที่หน่วยงานกำหนด')
        data=self.call('/api/catalog/numbering?'+urlencode({k:v for k,v in context.items() if k!='scope'}))
        self.assertEqual(data['guidance']['text'],after['text'])
        self.assertEqual(data['selected']['description'],after['text'])
        self.assertEqual(data['selected']['conditions'],after['conditions'])
        self.assertEqual(after['originalText'],before['originalText'])
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT id,code,name,asset_type FROM assets ORDER BY id').fetchall(),assets)
            self.assertEqual(db.execute('SELECT * FROM starter_catalog_rows ORDER BY category_id,type_name,fsn_code').fetchall(),source)

    def test_role_validation_and_stale_revision_leave_no_partial_events(self):
        context={'scope':'category','categoryId':self.context()['categoryId']};before=self.wording(context)
        body={**before,'text':'ขอบเขตหมวดฉบับใหม่','reason':'เปลี่ยนตามหนังสือ','actor':OFFICER}
        self.call('/api/catalog/guidance',{**body,'actor':'ผู้แจ้ง'},method='PUT',expected=403)
        for invalid in ({'text':[]},{'conditions':'ก'*10001},{'reason':''},{'scope':'bad'},{'categoryId':10**40}):
            self.call('/api/catalog/guidance',{**body,**invalid},method='PUT',expected=400)
        for revision in (True,'0',99):
            self.call('/api/catalog/guidance',{**body,'revision':revision},method='PUT',expected=409)
        self.assertEqual(self.history(context)['total'],0)
        self.call('/api/catalog/guidance/history?'+urlencode(context),expected=403)
        saved=self.save(before,text=body['text'])
        self.call('/api/catalog/guidance',body,method='PUT',expected=409)
        self.assertEqual(self.wording(context)['text'],saved['text'])
        self.call('/api/catalog/guidance?scope=category&categoryId=invalid',expected=400)
        self.call('/api/catalog/guidance?scope=code&categoryId=1&code=9876-123-9999',expected=400)

    def test_concurrent_writers_produce_one_new_revision(self):
        before=self.wording({'scope':'numbering'});prior=self.history({'scope':'numbering'})['total']
        def writer(text):
            request=Request(self.base+'/api/catalog/guidance',method='PUT',data=json.dumps({**before,'actor':OFFICER,'text':text,'reason':'ทดสอบแก้ไขพร้อมกัน'}).encode(),headers={'Content-Type':'application/json'})
            try:response=urlopen(request,timeout=10)
            except HTTPError as exc:response=exc
            with response:return response.status,json.loads(response.read())
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(writer,['ข้อความจากหน้าที่หนึ่ง','ข้อความจากหน้าที่สอง']))
        self.assertEqual(sorted(status for status,_ in results),[200,409])
        self.assertEqual(self.history({'scope':'numbering'})['total'],prior+1)

    def test_source_snapshot_fields_cannot_be_overwritten(self):
        before=self.wording(self.context())
        saved=self.save(before,text='คำอธิบายฉบับที่ใช้',originalText='พยายามทับต้นฉบับ',originalCitation='อ้างต้นฉบับอื่น')
        self.assertEqual(saved['originalText'],before['originalText'])
        self.assertEqual(saved['originalCitation'],before['originalCitation'])
        source=self.wording({'scope':'numbering'})
        self.assertIn('ชุดที่หนึ่ง',source['originalText'])

    def test_z_wording_and_history_survive_server_restart(self):
        context={'scope':'numbering'};current=self.wording(context);saved=self.save(current,text='ข้อความสำหรับตรวจหลังเริ่มเซิร์ฟเวอร์ใหม่')
        self.proc.terminate();self.proc.wait(timeout=10)
        self.__class__.proc=subprocess.Popen(self.proc.args,cwd=ROOT,env={**os.environ,'ASSET_DB_PATH':str(self.db),'PORT':str(self.port),'HOST':'127.0.0.1'},stdout=self.log,stderr=self.log)
        for _ in range(100):
            try:self.call('/api/health');break
            except OSError:time.sleep(.05)
        else:self.fail('server did not restart')
        self.assertEqual(self.wording(context)['revision'],saved['revision'])
        self.assertEqual(self.wording(context)['originalText'],saved['originalText'])
        self.assertEqual(self.history(context)['items'][0]['after']['text'],saved['text'])
