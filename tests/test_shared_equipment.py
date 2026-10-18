import json,re,uuid
from urllib.parse import urlencode
from test_smart_workflow import HTTPFixture,OFFICER

class SharedEquipment(HTTPFixture):
    def account(self):return self.call('/api/governance/accounts',{'actor':OFFICER,'name':'องค์กร','code':uuid.uuid4().hex,'useSharedStandard':True},expected=201)['id']
    def test_common_definition_separate_owner_sequence_and_immutable_snapshots(self):
        a=self.account();b=self.account();cid=self.call('/api/catalog/categories')[0]['id']
        query=lambda aid:self.call('/api/governance/catalog?'+urlencode({'accountId':aid,'categoryId':cid}))['items']
        ca=next(i for i in query(a) if re.fullmatch(r'\d{4}-\d{3}-\d{4}',i['code']));cb=next(i for i in query(b) if i['shared_catalog_id']==ca['shared_catalog_id'])
        self.assertNotEqual(ca['id'],cb['id']);self.assertEqual(ca['values'],cb['values'])
        def create(aid,c):return self.call('/api/assets',{'actor':OFFICER,'accountId':aid,'categoryId':cid,'catalogId':c['id'],'name':'ชิ้นทดสอบ'},expected=201)
        x=create(a,ca);y=create(b,cb);self.assertEqual(x['code'],y['code']);self.assertTrue(x['code'].endswith('-0001'));self.assertNotEqual(x['id'],y['id'])
        before=self.call(f'/api/governance/assets/{x["id"]}');qr=self.call(f'/api/assets/{x["id"]}/smart')['qrUrl']
        master=self.call('/api/equipment/catalog?id='+str(ca['shared_catalog_id']))['items'][0]
        self.call('/api/equipment/catalog',{'actor':OFFICER,'id':master['id'],'revision':master['revision'],'categoryId':cid,'name':master['name']+' ปรับคำอธิบาย','code':master['code'],'conditions':'เงื่อนไขฉบับปรับปรุง'},method='PUT')
        self.assertIn('ปรับคำอธิบาย',next(i for i in query(b) if i['id']==cb['id'])['name'])
        self.assertEqual(self.call(f'/api/governance/assets/{x["id"]}'),before);self.assertEqual(self.call(f'/api/assets/{x["id"]}/smart')['qrUrl'],qr)
    def test_pdf_source_keeps_printed_digits_and_rule_edit_retains_original_quotes(self):
        a=self.account();source=self.call('/api/equipment/references?q=0204')
        self.assertTrue(any(r['group_code']=='7110' and r['type_code']=='0204' and r['page']==53 for r in source['items']))
        original=self.call('/api/equipment/standard');self.assertEqual(original['references'],907)
        self.call('/api/equipment/standard',{'actor':OFFICER,'revision':original['revision'],'operationalText':'ข้อความที่เจ้าหน้าที่ปรับใช้ตามระเบียบ'},method='PUT')
        current=self.call('/api/equipment/standard');self.assertEqual(current['rules']['pages'],original['rules']['pages']);self.assertEqual(current['sha256'],original['sha256'])
        self.assertEqual(self.call('/api/governance/references?accountId='+str(a))['total'],907)
