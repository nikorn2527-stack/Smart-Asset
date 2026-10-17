"""No real LINE requests: exercise durable delivery with an injected transport."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta
import base64
import hashlib
import hmac
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from email.message import Message

import server
import line_notifications as line
from notifications import OFFICER, APPROVER, REQUESTER, NotificationError, TZ

GROUP='C'+'1'*32
OTHER='C'+'2'*32
TOKEN='test-access-token-never-sent'
SECRET='test-signature-secret'


class LineNotifications(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'test.sqlite3'
        with patch.object(server,'DB_PATH',self.path):server.initialize()
        self.env=patch.dict('os.environ',{'LINE_CHANNEL_ACCESS_TOKEN':TOKEN,'LINE_CHANNEL_SECRET':SECRET})
        self.env.start();self.handler=object.__new__(server.Handler)

    def tearDown(self):
        self.env.stop();self.temp.cleanup()

    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path,timeout=15,isolation_level=None);db.row_factory=sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback();raise
        finally:db.close()

    def call(self,method,path,body=None):
        with self.connect() as db:
            return line.handle(db,method,path,{'actor':[OFFICER]},body or {})

    def enable(self, roles=(OFFICER,REQUESTER)):
        cfg=self.call('GET','/api/line/settings')
        self.call('PUT','/api/line/settings',{'actor':OFFICER,'enabled':True,'baseUrl':'https://assets.example.go.th','revision':cfg['revision'],'recipients':[{'role':r,'targetId':GROUP,'label':'กลุ่มทดสอบ'} for r in roles]})

    def ticket(self):
        with self.connect() as db:
            result,_=self.handler.create_ticket(db,{'assetId':1,'assetName':'เครื่องทดสอบ','location':'ห้องทดสอบ','requester':'ชื่อส่วนตัว','contact':'private-contact','issue':'รายละเอียดส่วนตัว'})
        return result

    def action(self,tid,action,actor,**fields):
        with self.connect() as db:return self.handler.ticket_action(db,tid,{'actor':actor,'action':action,**fields})

    def test_baseline_deduplication_and_minimal_message(self):
        self.enable();sent=[]
        line.dispatch(self.connect,lambda *args:sent.append(args))
        self.assertEqual(sent,[])
        ticket=self.ticket()
        line.dispatch(self.connect,lambda *args:sent.append(args));line.dispatch(self.connect,lambda *args:sent.append(args))
        self.assertEqual(len(sent),1) # Shared group, two matching roles: one message.
        payload=json.dumps(sent[0][1],ensure_ascii=False)
        self.assertIn('/#task=ticket:'+str(ticket['id']),payload)
        for private in ('private-contact','ชื่อส่วนตัว','รายละเอียดส่วนตัว'):
            self.assertNotIn(private,payload)
        with self.connect() as db:self.assertEqual(db.execute("SELECT COUNT(*) FROM line_outbox WHERE status='sent'").fetchone()[0],1)

    def test_stale_approval_is_skipped_and_next_stage_is_sent(self):
        self.enable((OFFICER,APPROVER))
        ticket=self.ticket()
        with self.connect() as db:db.execute('BEGIN IMMEDIATE');line.collect(db)
        self.action(ticket['id'],'review',OFFICER,estimateCost=6000)
        sent=[];line.dispatch(self.connect,lambda *args:sent.append(args))
        self.assertEqual(len(sent),1)
        self.assertIn('พิจารณาอนุมัติ',sent[0][1][0]['text'])
        with self.connect() as db:self.assertEqual(db.execute("SELECT COUNT(*) FROM line_outbox WHERE status='skipped'").fetchone()[0],1)

    def test_transient_retry_reuses_provider_uuid(self):
        self.enable();self.ticket();attempts=[]
        def broken(*args):attempts.append(args);raise line.DeliveryError('จำลองเครือข่าย',True)
        line.dispatch(self.connect,broken)
        with self.connect() as db:
            self.assertEqual(db.execute('SELECT status FROM line_outbox').fetchone()[0],'retry')
            db.execute("UPDATE line_outbox SET available_at='2000-01-01T00:00:00+07:00'")
        line.dispatch(self.connect,lambda *args:attempts.append(args))
        self.assertEqual(len(attempts),2);self.assertEqual(attempts[0][2],attempts[1][2])
        with self.connect() as db:self.assertEqual(tuple(db.execute('SELECT status,attempts FROM line_outbox').fetchone()),('sent',2))

    def test_concurrent_workers_claim_once_and_expired_lease_recovers(self):
        self.enable();self.ticket();sent=[]
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _:line.dispatch(self.connect,lambda *args:sent.append(args)),range(2)))
        self.assertEqual(len(sent),1)
        self.ticket()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE');line.collect(db)
            db.execute("UPDATE line_outbox SET status='sending',attempts=1,lease_until='2000-01-01',first_attempt_at=? WHERE status='pending'",(line.stamp(),))
        line.dispatch(self.connect,lambda *args:sent.append(args))
        self.assertEqual(len(sent),2)

    def test_unsafe_retry_window_and_disable_stop_delivery(self):
        self.enable();self.ticket()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE');line.collect(db)
            db.execute("UPDATE line_outbox SET status='sending',attempts=1,lease_until='2000-01-01',first_attempt_at=?",((datetime.now(TZ)-timedelta(days=2)).isoformat(),))
        sent=[];line.dispatch(self.connect,lambda *args:sent.append(args));self.assertEqual(sent,[])
        with self.connect() as db:self.assertEqual(db.execute('SELECT status FROM line_outbox').fetchone()[0],'failed')
        cfg=self.call('GET','/api/line/settings');self.call('PUT','/api/line/settings',{**cfg,'enabled':False,'actor':OFFICER})
        self.ticket();line.dispatch(self.connect,lambda *args:sent.append(args));self.assertEqual(sent,[])

    def test_webhook_signature_discovers_group_without_message_or_user_storage(self):
        raw=json.dumps({'events':[{'type':'postback','postback':{'data':'approve=1'},'source':{'type':'group','groupId':GROUP,'userId':'U'+'3'*32},'message':{'text':'private-webhook-message'}}]}).encode()
        signature=base64.b64encode(hmac.new(SECRET.encode(),raw,hashlib.sha256).digest()).decode()
        with self.assertRaises(NotificationError):
            with self.connect() as db:line.verify_webhook(db,raw,'not-a-signature')
        with self.connect() as db:line.verify_webhook(db,raw,signature)
        with self.connect() as db:line.verify_webhook(db,raw,signature)
        cfg=self.call('GET','/api/line/settings')
        self.assertEqual(len(cfg['candidates']),1);self.assertEqual(cfg['candidates'][0]['target_id'],GROUP)
        for private in (TOKEN,SECRET,'private-webhook-message','U'+'3'*32):self.assertNotIn(private,json.dumps(cfg))

    def test_configuration_requires_credentials_and_revision_and_test_is_explicit(self):
        cfg=self.call('GET','/api/line/settings')
        data={**cfg,'actor':OFFICER,'enabled':True,'baseUrl':'https://assets.example.go.th','recipients':[{'role':OFFICER,'targetId':GROUP,'label':'กลุ่มทดสอบ'}]}
        with patch.dict('os.environ',{'LINE_CHANNEL_ACCESS_TOKEN':''}):
            with self.assertRaises(NotificationError):self.call('PUT','/api/line/settings',data)
        self.call('PUT','/api/line/settings',data)
        with self.assertRaises(NotificationError):self.call('PUT','/api/line/settings',data)
        latest=self.call('GET','/api/line/settings');latest['enabled']=False
        self.call('PUT','/api/line/settings',{**latest,'actor':OFFICER})
        latest=self.call('GET','/api/line/settings')
        test={'actor':OFFICER,'role':OFFICER,'targetId':GROUP,'revision':latest['revision']}
        one=self.call('POST','/api/line/test',test);two=self.call('POST','/api/line/test',test)
        self.assertEqual(one['id'],two['id'])
        sent=[];line.dispatch(self.connect,lambda *args:sent.append(args));self.assertEqual(len(sent),1)

    def test_http_headers_redirect_guard_and_provider_idempotency_response(self):
        headers=Message();headers['X-Line-Accepted-Request-Id']='provider-accepted-id'
        error=HTTPError(line.PUSH_URL,409,'Conflict',headers,None)
        with patch.object(line,'build_opener') as factory:
            factory.return_value.open.side_effect=error
            line.push(GROUP,[{'type':'text','text':'test'}],'retry-uuid')
            request=factory.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url,line.PUSH_URL)
            self.assertEqual(request.get_header('Authorization'),'Bearer '+TOKEN)
            self.assertEqual(request.get_header('X-line-retry-key'),'retry-uuid')
        self.assertIsNone(line.NoRedirect().redirect_request(None,None,302,'',{},'https://other.example'))

    def test_manual_retry_preserves_message_and_deduplication_key(self):
        self.enable();self.ticket();sent=[]
        def rejected(*args):sent.append(args);raise line.DeliveryError('LINE HTTP 401')
        line.dispatch(self.connect,rejected)
        with self.connect() as db:job=db.execute('SELECT id FROM line_outbox').fetchone()[0]
        self.call('POST',f'/api/line/deliveries/{job}/retry',{'actor':OFFICER})
        line.dispatch(self.connect,lambda *args:sent.append(args))
        self.assertEqual(len(sent),2);self.assertEqual(sent[0][1:],sent[1][1:])
        with self.connect() as db:self.assertEqual(db.execute('SELECT status FROM line_outbox').fetchone()[0],'sent')

    def test_saving_unchanged_config_does_not_discard_queued_notifications(self):
        self.enable();self.ticket()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE');line.collect(db)
        cfg=self.call('GET','/api/line/settings')
        saved=self.call('PUT','/api/line/settings',{**cfg,'actor':OFFICER})
        self.assertEqual(saved['revision'],cfg['revision'])
        sent=[]
        line.dispatch(self.connect,lambda *args:sent.append(args))
        self.assertEqual(len(sent),1)


from test_smart_workflow import HTTPFixture
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError as HttpResponseError


class LineHTTP(HTTPFixture):
    @classmethod
    def setUpClass(cls):
        with patch.dict('os.environ',{'LINE_CHANNEL_SECRET':SECRET,'LINE_CHANNEL_ACCESS_TOKEN':''}):
            super().setUpClass()

    def test_raw_signed_webhook_and_configuration_do_not_expose_secrets(self):
        body=json.dumps({'events':[{'source':{'type':'group','groupId':OTHER,'userId':'U'+'4'*32},'message':{'text':'ข้อมูลส่วนตัว'}}]},ensure_ascii=False).encode()
        signature=base64.b64encode(hmac.new(SECRET.encode(),body,hashlib.sha256).digest()).decode()
        request=Request(self.base+'/api/line/webhook',data=body,headers={'Content-Type':'application/json','X-Line-Signature':signature})
        with urlopen(request,timeout=5) as response:self.assertEqual(response.status,200)
        self.call('/api/line/webhook',{'events':[]},expected=403)
        cfg=self.call('/api/line/settings?'+urlencode({'actor':OFFICER}))
        self.assertFalse(cfg['tokenConfigured']);self.assertTrue(cfg['secretConfigured'])
        self.assertIn(OTHER,str(cfg['candidates']));self.assertNotIn('U'+'4'*32,str(cfg))
        self.assertNotIn(SECRET,str(cfg));self.assertEqual(cfg['deliveries'],[])
        self.call('/api/line/settings?'+urlencode({'actor':REQUESTER}),expected=403)
        self.call('/api/line/settings',{**cfg,'actor':OFFICER,'enabled':True,'baseUrl':'https://assets.example.go.th','recipients':[{'role':OFFICER,'targetId':OTHER,'label':'กลุ่มทดสอบ'}]},method='PUT',expected=400)
        self.assertFalse(self.call('/api/line/settings?'+urlencode({'actor':OFFICER}))['enabled'])
