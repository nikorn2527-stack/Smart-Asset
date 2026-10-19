"""Real cookie sessions; role forgery and cross-organization/branch reads must fail."""
import json,uuid,sqlite3
from http.cookiejar import CookieJar
from urllib.request import build_opener,HTTPCookieProcessor,Request
from urllib.error import HTTPError
from test_smart_workflow import HTTPFixture,OFFICER

class Client:
    def __init__(self,base):self.base=base;self.opener=build_opener(HTTPCookieProcessor(CookieJar()));self.csrf=''
    def call(self,path,body=None,method=None,expected=200,csrf=True):
        headers={'Content-Type':'application/json'}
        if self.csrf and csrf:headers['X-CSRF-Token']=self.csrf
        request=Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
        try:r=self.opener.open(request,timeout=20)
        except HTTPError as e:r=e
        with r:
            result=json.loads(r.read())
            if r.status!=expected:raise AssertionError(f'{path}: {r.status} != {expected}: {result}')
        if isinstance(result,dict) and result.get('csrf'):self.csrf=result['csrf']
        return result

class AccessControl(HTTPFixture):
    auth_required='1'
    @classmethod
    def setUpClass(cls):
        super().setUpClass();cls.admin=Client(cls.base)
        response=cls.admin.call('/api/auth/setup',{'username':'test.admin','name':'ผู้ดูแลทดสอบ','password':'Test-only-pass-2026'})
        assert 'password_hash' not in json.dumps(response)
    def setUp(self):
        self.admin.call('/api/auth/scope',{'accountId':None,'branchId':None,'actor':OFFICER})
        self.aid=self.admin.call('/api/governance/accounts',{'name':'องค์กร ก','code':uuid.uuid4().hex},expected=201)['id']
        self.other=self.admin.call('/api/governance/accounts',{'name':'องค์กร ข','code':uuid.uuid4().hex},expected=201)['id']
        self.bid=self.admin.call('/api/governance/branches',{'accountId':self.aid,'name':'สาขาหนึ่ง','code':'ONE'},expected=201)['id']
        self.otherbid=self.admin.call('/api/governance/branches',{'accountId':self.aid,'name':'สาขาสอง','code':'TWO'},expected=201)['id']
        self.cid=self.admin.call('/api/catalog/categories')[0]['id']
        self.ids=[]
        with sqlite3.connect(self.db) as db:
            for aid,bid,name in [(self.aid,self.bid,'ของสาขาหนึ่ง'),(self.aid,self.otherbid,'ของสาขาสอง'),(self.other,None,'ของอีกองค์กร')]:
                self.ids.append(db.execute("INSERT INTO assets(name,code,group_name,location,category_id,created_at,numbering_account_id,branch_id,status) VALUES(?,?,'กลุ่ม','ที่ตั้ง',?,'2026-10-18',?,?,'ทะเบียนแล้ว')",(name,uuid.uuid4().hex,self.cid,aid,bid)).lastrowid)
    def user(self,branch=True,globalRole='user',**permissions):
        name='staff.'+uuid.uuid4().hex[:12]
        self.admin.call('/api/auth/users',{'username':name,'name':'เจ้าหน้าที่','password':'Test-only-pass-2026','globalRole':globalRole,'memberships':[] if globalRole!='user' else [{'accountId':self.aid,'branchId':self.bid if branch else None,'permissions':{'view':True,**permissions}}]},expected=201)
        c=Client(self.base);session=c.call('/api/auth/login',{'username':name,'password':'Test-only-pass-2026'});return c,session
    def test_login_required_health_minimal_and_session_no_hash(self):
        c=Client(self.base);c.call('/api/inventory',expected=401)
        self.assertNotIn('assets',c.call('/api/health'))
        c,s=self.user();self.assertNotIn('password_hash',json.dumps(s));self.assertEqual(s['accountId'],self.aid);self.assertEqual(s['branchId'],self.bid)
        c.call('/api/auth/logout',{},csrf=False,expected=403);c.call('/api/auth/logout',{})
        c.call('/api/assets',expected=401)
    def test_branch_and_organization_are_filtered_and_direct_ids_protected(self):
        c,s=self.user()
        inventory=c.call('/api/inventory');self.assertEqual(inventory['total'],1);self.assertEqual(inventory['items'][0]['id'],self.ids[0])
        self.assertEqual([a['id'] for a in c.call('/api/assets')],[self.ids[0]])
        self.assertEqual(c.call('/api/overview')['assets'],1)
        self.assertEqual([a['id'] for a in c.call('/api/governance')['accounts']],[self.aid])
        c.call('/api/assets/'+str(self.ids[1])+'/smart',expected=404);c.call('/api/assets/'+str(self.ids[2])+'/register',expected=404)
        c.call('/api/inventory?accountId='+str(self.other),expected=403)
        c.call('/api/auth/scope',{'accountId':self.aid,'branchId':None},expected=403)
        c.call('/api/auth/scope',{'accountId':self.other,'branchId':None},expected=403)
        c.call('/api/backups?actor='+__import__('urllib.parse',fromlist=['quote']).quote(OFFICER),expected=403)
    def test_role_forgery_csrf_and_shared_settings_are_blocked(self):
        c,s=self.user(create=True,edit=True)
        c.call('/api/assets/'+str(self.ids[0])+'/action',{'actor':'ผู้อนุมัติ','action':'approve'},expected=403)
        c.call('/api/auth/scope',{'accountId':self.aid,'branchId':self.bid,'actor':'ผู้อนุมัติ'},expected=403)
        c.call('/api/operational-master',{'name':'ผู้ขาย','kind':'supplier'},expected=403)
        c.call('/api/branding',{'actor':OFFICER},method='PUT',expected=403)
        c.call('/api/equipment/catalog',{'actor':OFFICER},expected=403)
        c.call('/api/supply/documents',{'kind':'receipt'},csrf=False,expected=403)
    def test_read_all_is_independent_from_edit_permissions(self):
        c,s=self.user(globalRole='auditor')
        self.assertTrue(s['canViewAll']);self.assertFalse(s['permissions']['edit']);self.assertFalse(s['permissions']['export'])
        self.assertIn(self.ids[2],[a['id'] for a in c.call('/api/assets')])
        c.call('/api/assets/'+str(self.ids[0])+'/smart',{'actor':OFFICER},method='PUT',expected=403)
        c.call('/api/auth/users',expected=403)
    def test_organization_manager_cannot_grant_other_organizations_or_global_roles(self):
        c,s=self.user(branch=False,create=True,edit=True,manage=True)
        c.call('/api/auth/users',{'username':'forged.'+uuid.uuid4().hex[:8],'name':'ปลอม','password':'Test-only-pass-2026','globalRole':'admin'},expected=403)
        c.call('/api/auth/users',{'username':'forged.'+uuid.uuid4().hex[:8],'name':'ปลอม','password':'Test-only-pass-2026','memberships':[{'accountId':self.other,'permissions':{'view':True}}]},expected=403)
        c.call('/api/auth/users',{'username':'forged.'+uuid.uuid4().hex[:8],'name':'ปลอม','password':'Test-only-pass-2026','memberships':[{'accountId':self.aid,'permissions':{'view':True,'approve':True}}]},expected=403)
        c.call('/api/auth/users',{'username':'valid.'+uuid.uuid4().hex[:8],'name':'เพิ่มในองค์กร','password':'Test-only-pass-2026','memberships':[{'accountId':self.aid,'permissions':{'view':True}}]},expected=201)

    def test_documents_files_and_import_jobs_cannot_cross_scope(self):
        c,s=self.user(create=True,edit=True)
        with sqlite3.connect(self.db) as db:
            records=[]
            for aid,bid in [(self.aid,self.bid),(self.other,None)]:
                did=db.execute("INSERT INTO supply_documents(kind,account_id,branch_id,number,status,rules_json,data_json,created_at,updated_at) VALUES('receipt',?,?,?,'draft','{}','{}','2026-10-18','2026-10-18')",(aid,bid,uuid.uuid4().hex)).lastrowid
                fid=db.execute("INSERT INTO supply_files(document_id,name,mime,content) VALUES(?,'evidence.pdf','application/pdf',?)",(did,b'%PDF-fixture')).lastrowid
                jid=uuid.uuid4().hex;db.execute("INSERT INTO asset_import_jobs VALUES(?,?,?,'register.zip',?,'preview','{}','2026-10-18','')",(jid,aid,bid,uuid.uuid4().hex));records.append((did,fid,jid))
        c.call('/api/supply/documents/'+str(records[0][0]));c.call('/api/supply/files/'+str(records[0][1]))
        c.call('/api/supply/documents/'+str(records[1][0]),expected=404);c.call('/api/supply/files/'+str(records[1][1]),expected=404)
        self.assertEqual([j['id'] for j in c.call('/api/imports')['items']],[records[0][2]])
        c.call('/api/imports/commit',{'id':records[1][2],'confirm':True},expected=404)

    def test_work_lists_are_scoped_and_read_markers_are_per_user(self):
        c,s=self.user(work=True);second,_=self.user(work=True)
        work=[];plans=[]
        with sqlite3.connect(self.db) as db:
            for asset in (self.ids[0],self.ids[2]):
                pid=db.execute("INSERT INTO work_plans(kind,name,schedule_mode,interval_days,next_due,assignment_mode,assignees_json,created_at,created_by) VALUES('pm','แผนตรวจ','manual',30,'2026-10-18','manual','[]','2026-10-18','ทดสอบ')").lastrowid
                db.execute('INSERT INTO work_plan_assets VALUES(?,?)',(pid,asset));wid=db.execute("INSERT INTO scheduled_work(plan_id,asset_id,due_on,assignee) VALUES(?,?,'2026-10-18','ช่าง')",(pid,asset)).lastrowid;plans.append(pid);work.append(wid)
        self.assertEqual([p['id'] for p in c.call('/api/work/plans')],[plans[0]])
        self.assertEqual([w['id'] for w in c.call('/api/work/items')['items']],[work[0]])
        c.call('/api/work/items/'+str(work[1]),expected=404)
        notices=c.call('/api/notifications?limit=100');self.assertEqual([n['entityId'] for n in notices['items']],[work[0]])
        c.call('/api/notifications/read',{'all':True});self.assertEqual(c.call('/api/notifications')['unreadCount'],0)
        self.assertEqual(second.call('/api/notifications')['unreadCount'],1)

    def test_ticket_detail_rejects_extra_path_segments_and_foreign_ids(self):
        c,_=self.user()
        tickets=[]
        with sqlite3.connect(self.db) as db:
            for aid in (self.ids[0],self.ids[2]):
                tickets.append(db.execute("INSERT INTO tickets(ticket_no,asset_id,asset_name,location,issue,requester,status) VALUES(?,?,'เครื่อง','ห้อง','เสีย','ผู้แจ้ง','รับแจ้ง')",(uuid.uuid4().hex,aid)).lastrowid)
        c.call('/api/tickets/'+str(tickets[0]))
        c.call('/api/tickets/'+str(tickets[1]),expected=404)
        c.call('/api/tickets/'+str(tickets[0])+'/'+str(tickets[1]),expected=404)
        self.assertEqual([t['id'] for t in c.call('/api/tickets')],tickets[:1])

    def test_repair_search_and_code_resolution_use_the_current_scope(self):
        c,_=self.user(create=True)
        code='REPAIR-'+uuid.uuid4().hex
        with sqlite3.connect(self.db) as db:
            db.execute('UPDATE assets SET code=? WHERE id IN (?,?)',(code,self.ids[0],self.ids[2]))
        from urllib.parse import urlencode
        found=c.call('/api/assets/search?'+urlencode({'q':code}))
        self.assertEqual([a['id'] for a in found['items']],[self.ids[0]])
        self.assertEqual(found['items'][0]['location'],'ที่ตั้ง')
        found=c.call('/api/assets/search?'+urlencode({'q':'ของสาขาหนึ่ง'}))
        self.assertEqual([a['id'] for a in found['items']],[self.ids[0]])
        self.assertEqual(c.call('/api/assets/search?'+urlencode({'q':'%'}))['items'],[])
        self.assertEqual(c.call('/api/assets/search?'+urlencode({'q':'ของอีกองค์กร'}))['items'],[])
        ticket=c.call('/api/tickets',{'assetName':'ชื่อจากผู้ส่ง','assetCode':code,'location':'สถานที่ปลอม','requester':'ผู้แจ้ง','issue':'เปิดไม่ติด'},expected=201)
        self.assertEqual(ticket['assetId'],self.ids[0]);self.assertEqual(ticket['assetName'],'ของสาขาหนึ่ง');self.assertEqual(ticket['location'],'ที่ตั้ง')

    def test_repair_location_is_registry_snapshot_and_reporter_note_is_separate(self):
        c,_=self.user(create=True)
        body={'assetId':self.ids[0],'assetName':'ชื่อที่ไม่ใช้','assetCode':'ไม่ใช้','location':'ห้องที่ไม่ใช้','requester':'ผู้แจ้ง','issue':'ใช้งานไม่ได้','locationMismatch':True}
        c.call('/api/tickets',body,expected=400)
        body['reporterNote']='ปัจจุบันอยู่ห้องตรวจ 2 ขอให้เจ้าหน้าที่ตรวจสอบทะเบียน'
        ticket=c.call('/api/tickets',body,expected=201)
        self.assertEqual(ticket['location'],'ที่ตั้ง');self.assertEqual(ticket['reporterNote'],body['reporterNote'])
        detail=c.call('/api/tickets/'+str(ticket['id']))
        self.assertEqual(detail['reporterNote'],body['reporterNote']);self.assertTrue(any(body['reporterNote'] in e['note'] for e in detail['events']))
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT location FROM assets WHERE id=?',(self.ids[0],)).fetchone()[0],'ที่ตั้ง')
            db.execute("UPDATE assets SET location='' WHERE id=?",(self.ids[0],))
        body.pop('reporterNote');body['locationMismatch']=False
        c.call('/api/tickets',body,expected=400)
        body['reporterNote']='ใช้งานที่ห้องเวชระเบียน ขอให้เพิ่มที่ตั้งในทะเบียน'
        self.assertEqual(c.call('/api/tickets',body,expected=201)['location'],'ยังไม่ระบุที่ตั้งในทะเบียน')
        c.call('/api/tickets',{'assetName':'ไม่มีในทะเบียน','location':'ห้อง','requester':'ผู้แจ้ง','issue':'เสีย'},expected=400)

    def test_public_qr_repair_keeps_registry_location_and_discrepancy_note(self):
        token=self.admin.call(f'/api/assets/{self.ids[0]}/smart')['qrUrl'].rsplit('/',1)[1]
        anonymous=Client(self.base)
        body={'issue':'เปิดไม่ติด','requester':'ผู้สแกน','contact':'123','location':'ที่ตั้งที่ไม่ใช้','assetId':self.ids[2],'locationMismatch':True}
        anonymous.call(f'/api/scan/{token}/repairs',body,expected=400)
        body['reporterNote']='ที่ตั้งจริงอยู่ห้องตรวจ 3 ขอให้ตรวจสอบทะเบียน'
        receipt=anonymous.call(f'/api/scan/{token}/repairs',body,expected=201)
        self.assertIn('receiptToken',receipt)
        with sqlite3.connect(self.db) as db:
            row=db.execute('SELECT t.asset_id,t.location,t.reporter_note FROM tickets t JOIN ticket_receipts r ON r.ticket_id=t.id WHERE r.token=?',(receipt['receiptToken'],)).fetchone()
            self.assertEqual(row,(self.ids[0],'ที่ตั้ง',body['reporterNote']))
            self.assertEqual(db.execute('SELECT location FROM assets WHERE id=?',(self.ids[0],)).fetchone()[0],'ที่ตั้ง')
