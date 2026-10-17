"""LINE Messaging API delivery with durable retries; credentials stay in env."""
from datetime import datetime, timedelta
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from uuid import uuid4

from notifications import FEED, ROLES, OFFICER, NotificationError, parameters, stamp, TZ

PUSH_URL = 'https://api.line.me/v2/bot/message/push'
TARGET = re.compile(r'[UCR][0-9a-fA-F]{32}')
WORKER = {'running': False, 'lastRun': None, 'lastError': None}


def token():
    return os.environ.get('LINE_CHANNEL_ACCESS_TOKEN', '').strip()


def secret():
    return os.environ.get('LINE_CHANNEL_SECRET', '').strip()


def origin(value):
    value = str(value or '').strip()
    if not value:
        return ''
    try:
        url = urlsplit(value)
        url.port
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/') or any(c.isspace() for c in value):
            raise ValueError()
        if url.hostname == 'localhost' or url.hostname.endswith('.localhost'):
            raise ValueError()
        try:
            address = ipaddress.ip_address(url.hostname)
        except ValueError:
            address = None
        if address and (address.is_loopback or address.is_unspecified):
            raise ValueError()
    except ValueError:
        raise NotificationError('ที่อยู่สำหรับ LINE ต้องเป็น HTTPS ที่โทรศัพท์เข้าถึงได้ ไม่มี path/query และไม่ใช่ localhost')
    return value.rstrip('/')


def config(db):
    row = db.execute('SELECT * FROM line_settings WHERE id=1').fetchone()
    return {'enabled': bool(row['enabled']), 'baseUrl': row['base_url'], 'revision': row['revision'],
            'recipients': [dict(r) for r in db.execute('SELECT recipient_role AS role,target_id AS targetId,label FROM line_recipients ORDER BY id')]}


def messages(db, notice, base):
    name = db.execute('SELECT app_name FROM app_branding WHERE id=1').fetchone()[0]
    parts = [name, notice['title'], 'เลขที่: '+(notice['reference'] or 'ไม่ระบุรหัส')]
    if notice['dueOn']:
        parts.append('กำหนด: '+notice['dueOn'])
    parts.append('เปิดรายการ: '+base+'/#task='+notice['entity']+':'+str(notice['entityId']))
    return [{'type': 'text', 'text': '\n'.join(parts)[:4500]}]


def current_for_routes(db):
    for recipient_role in ROLES:
        params = parameters(db, recipient_role)
        for row in db.execute(FEED+'''SELECT f.*,r.target_id FROM feed f JOIN line_recipients r
            ON r.recipient_role=:role ORDER BY f.priority DESC,f.updatedAt DESC,f.key''',params):
            yield recipient_role, row


def baseline(db):
    # Existing tasks stay in-app; activating LINE never broadcasts the backlog.
    for _, notice in current_for_routes(db):
        db.execute('INSERT OR IGNORE INTO line_seen(notification_key,target_id) VALUES(?,?)', (notice['key'],notice['target_id']))


def collect(db):
    cfg = config(db)
    if not cfg['enabled']:
        return
    for recipient_role, notice in current_for_routes(db):
        db.execute('INSERT OR IGNORE INTO line_seen(notification_key,target_id) VALUES(?,?)', (notice['key'],notice['target_id']))
        if not db.execute('SELECT changes()').fetchone()[0]:
            continue
        now = stamp()
        db.execute('''INSERT OR IGNORE INTO line_outbox(notification_key,target_id,recipient_role,payload_json,base_url,config_revision,retry_key,available_at,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)''', (notice['key'],notice['target_id'],recipient_role,json.dumps(messages(db,notice,cfg['baseUrl']),ensure_ascii=False),cfg['baseUrl'],cfg['revision'],str(uuid4()),now,now))


def verify_webhook(db, raw, signature):
    if not secret():
        raise NotificationError('ยังไม่ได้กำหนด LINE_CHANNEL_SECRET ที่เซิร์ฟเวอร์',503)
    expected = base64.b64encode(hmac.new(secret().encode(),raw,hashlib.sha256).digest()).decode()
    if not isinstance(signature,str) or not re.fullmatch(r'[A-Za-z0-9+/]{43}=',signature) or not hmac.compare_digest(expected,signature):
        raise NotificationError('ลายเซ็น LINE ไม่ถูกต้อง',403)
    try:
        payload = json.loads(raw)
        events = payload['events']
        if not isinstance(events,list) or len(events)>1000:
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise NotificationError('ข้อมูล webhook ไม่ถูกต้อง')
    db.execute('BEGIN IMMEDIATE')
    for event in events:
        if not isinstance(event,dict):
            continue
        source = event.get('source')
        if not isinstance(source,dict):
            continue
        kind = source.get('type')
        if kind not in ('user','group','room'):
            continue
        target = source.get({'user':'userId','group':'groupId','room':'roomId'}.get(kind,''))
        prefix = {'user':'U','group':'C','room':'R'}.get(kind)
        if isinstance(target,str) and TARGET.fullmatch(target) and target.startswith(prefix or '!'):
            db.execute('INSERT INTO line_candidates(target_id,source_type,last_seen_at) VALUES(?,?,?) ON CONFLICT(target_id) DO UPDATE SET last_seen_at=excluded.last_seen_at', (target,kind,stamp()))
    # Do not save message bodies, issue replies, or execute approval postbacks.
    return {'ok':True}


class DeliveryError(Exception):
    def __init__(self, message, retryable=False, delay=None):
        super().__init__(message)
        self.retryable, self.delay = retryable, delay


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def push(target, payload, retry_key):
    request = Request(PUSH_URL,data=json.dumps({'to':target,'messages':payload},ensure_ascii=False).encode(),method='POST',headers={
        'Authorization':'Bearer '+token(),'Content-Type':'application/json','X-Line-Retry-Key':retry_key})
    try:
        with build_opener(NoRedirect()).open(request,timeout=10) as response:
            if response.status != 200:
                raise DeliveryError('LINE ตอบสถานะที่ไม่รองรับ',True)
    except HTTPError as exc:
        if exc.code == 409 and exc.headers.get('X-Line-Accepted-Request-Id'):
            return
        delay = exc.headers.get('Retry-After','')
        retry_after = min(3600,max(1,int(delay))) if len(delay)<=6 and delay.isdigit() else None
        raise DeliveryError('LINE HTTP '+str(exc.code),exc.code==429 or exc.code>=500,retry_after) from None
    except (URLError, TimeoutError, OSError):
        raise DeliveryError('เชื่อมต่อ LINE ไม่สำเร็จ',True) from None


def eligible(db, job, cfg):
    if job['config_revision']!=cfg['revision'] or job['base_url']!=cfg['baseUrl']:
        return False
    if not db.execute('SELECT 1 FROM line_recipients WHERE target_id=? AND recipient_role=?',(job['target_id'],job['recipient_role'])).fetchone():
        return False
    if job['kind']=='test':
        return True
    if not cfg['enabled']:
        return False
    params=parameters(db,job['recipient_role']);params['key']=job['notification_key']
    return db.execute(FEED+'SELECT 1 FROM feed WHERE key=:key',params).fetchone() is not None


def dispatch(connect, transport=None, batch=5):
    transport = transport or push
    if not token():
        return
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        collect(db)
    for _ in range(batch):
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            now=stamp()
            job=db.execute("SELECT * FROM line_outbox WHERE (status IN ('pending','retry') AND available_at<=?) OR (status='sending' AND lease_until<=?) ORDER BY id LIMIT 1",(now,now)).fetchone()
            if job is None:
                return
            cfg=config(db)
            if not eligible(db,job,cfg):
                db.execute("UPDATE line_outbox SET status='skipped',last_error='สถานะงานหรือการตั้งค่าเปลี่ยนแล้ว' WHERE id=?",(job['id'],))
                continue
            if job['first_attempt_at'] and datetime.now(TZ)-datetime.fromisoformat(job['first_attempt_at'])>timedelta(hours=23):
                db.execute("UPDATE line_outbox SET status='failed',last_error='เกินช่วงส่งซ้ำที่ปลอดภัย ต้องตรวจสอบการรับข้อความก่อน' WHERE id=?",(job['id'],))
                continue
            lease=str(uuid4());attempt=job['attempts']+1
            db.execute("UPDATE line_outbox SET status='sending',attempts=?,lease_token=?,first_attempt_at=CASE WHEN first_attempt_at='' THEN ? ELSE first_attempt_at END,lease_until=? WHERE id=?",(attempt,lease,now,(datetime.now(TZ)+timedelta(seconds=60)).isoformat(timespec='seconds'),job['id']))
        error=None
        try:
            transport(job['target_id'],json.loads(job['payload_json']),job['retry_key'])
        except DeliveryError as exc:
            error=exc
        except Exception:
            error=DeliveryError('ระบบส่งข้อความขัดข้อง',True)
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if error is None:
                db.execute("UPDATE line_outbox SET status='sent',accepted_at=?,last_error='' WHERE id=? AND lease_token=? AND status='sending'",(stamp(),job['id'],lease))
            else:
                retry=error.retryable and attempt<5
                delay=error.delay or min(3600,15*(2**min(attempt,7)))
                db.execute("UPDATE line_outbox SET status=?,available_at=?,last_error=? WHERE id=? AND lease_token=? AND status='sending'",('retry' if retry else 'failed',(datetime.now(TZ)+timedelta(seconds=delay)).isoformat(timespec='seconds'),str(error),job['id'],lease))


def require_officer(value):
    if value!=OFFICER:
        raise NotificationError('การตั้งค่า LINE ใช้บทบาทเจ้าหน้าที่พัสดุในโหมดทดสอบ',403)


def handle(db, method, path, query, body):
    if not path.startswith('/api/line/'):
        return None
    require_officer((query.get('actor') or [''])[0] if method=='GET' else body.get('actor'))
    if path=='/api/line/settings' and method=='GET':
        cfg=config(db)
        cfg.update(tokenConfigured=bool(token()),secretConfigured=bool(secret()),worker=dict(WORKER),
            candidates=[dict(r) for r in db.execute('SELECT * FROM line_candidates ORDER BY last_seen_at DESC LIMIT 50')],
            deliveries=[dict(r) for r in db.execute('SELECT id,recipient_role AS role,target_id AS targetId,status,attempts,last_error AS lastError,created_at AS createdAt,accepted_at AS acceptedAt,kind FROM line_outbox ORDER BY id DESC LIMIT 30')])
        return cfg
    if path=='/api/line/settings' and method=='PUT':
        enabled=body.get('enabled');routes=body.get('recipients');base=origin(body.get('baseUrl'))
        if type(enabled) is not bool or not isinstance(routes,list) or len(routes)>20:
            raise NotificationError('เปิด/ปิด LINE และระบุผู้รับไม่เกิน 20 บทบาท/ปลายทาง')
        normalized=[];seen=set()
        for route in routes:
            if not isinstance(route,dict):
                raise NotificationError('ข้อมูลผู้รับไม่ถูกต้อง')
            recipient_role,target,label=route.get('role'),route.get('targetId'),route.get('label')
            if recipient_role not in ROLES or not isinstance(target,str) or not TARGET.fullmatch(target) or not isinstance(label,str) or not 1<=len(label.strip())<=80:
                raise NotificationError('ระบุบทบาท ชื่อผู้รับ และ LINE user/group/room ID ให้ถูกต้อง')
            if (recipient_role,target) not in seen:
                normalized.append({'role':recipient_role,'targetId':target,'label':label.strip()});seen.add((recipient_role,target))
        if enabled and (not token() or not base or not normalized):
            raise NotificationError('ก่อนเปิด LINE ต้องกำหนด LINE_CHANNEL_ACCESS_TOKEN ในเซิร์ฟเวอร์ ที่อยู่ HTTPS และผู้รับ')
        db.execute('BEGIN IMMEDIATE');before=config(db)
        if type(body.get('revision')) is not int or body['revision']!=before['revision']:
            raise NotificationError('มีผู้แก้ไข LINE แล้ว กรุณาโหลดค่าล่าสุด',409)
        if before['enabled']==enabled and before['baseUrl']==base and before['recipients']==normalized:
            return {'ok':True,'revision':before['revision']}
        db.execute('UPDATE line_settings SET enabled=?,base_url=?,revision=revision+1,updated_at=? WHERE id=1',(int(enabled),base,stamp()))
        db.execute('DELETE FROM line_recipients')
        db.executemany('INSERT INTO line_recipients(recipient_role,target_id,label) VALUES(?,?,?)',[(r['role'],r['targetId'],r['label']) for r in normalized])
        db.execute("UPDATE line_outbox SET status='skipped',last_error='เปลี่ยนการตั้งค่า LINE' WHERE status IN ('pending','retry')")
        if enabled:
            baseline(db)
        after=config(db)
        db.execute('INSERT INTO line_settings_events(actor,before_json,after_json,created_at) VALUES(?,?,?,?)',(OFFICER,json.dumps(before,ensure_ascii=False),json.dumps(after,ensure_ascii=False),stamp()))
        return {'ok':True,'revision':after['revision']}
    if path=='/api/line/test' and method=='POST':
        cfg=config(db)
        if not token() or not cfg['baseUrl']:
            raise NotificationError('ต้องกำหนด LINE_CHANNEL_ACCESS_TOKEN ในเซิร์ฟเวอร์และบันทึกที่อยู่ HTTPS ก่อน')
        recipient=next((r for r in cfg['recipients'] if r['targetId']==body.get('targetId') and r['role']==body.get('role')),None)
        if recipient is None or body.get('revision')!=cfg['revision']:
            raise NotificationError('กรุณาเลือกผู้รับจากการตั้งค่าล่าสุด')
        db.execute('BEGIN IMMEDIATE')
        active=db.execute("SELECT id FROM line_outbox WHERE kind='test' AND target_id=? AND status IN ('pending','retry','sending')",(recipient['targetId'],)).fetchone()
        if active:
            return {'queued':True,'id':active['id']}
        now=stamp();key='test:'+str(uuid4())
        cur=db.execute('''INSERT INTO line_outbox(notification_key,target_id,recipient_role,kind,payload_json,base_url,config_revision,retry_key,available_at,created_at)
            VALUES(?,?,?,'test',?,?,?,?,?,?)''',(key,recipient['targetId'],recipient['role'],json.dumps([{'type':'text','text':'ทดสอบการแจ้งเตือน Smart-Asset\nเปิดแอป: '+cfg['baseUrl']+'\nข้อความนี้ไม่มีผลอนุมัติหรือเปลี่ยนสถานะงาน'}],ensure_ascii=False),cfg['baseUrl'],cfg['revision'],str(uuid4()),now,now))
        return {'queued':True,'id':cur.lastrowid}
    retry_match=re.fullmatch(r'/api/line/deliveries/(\d+)/retry',path)
    if retry_match and method=='POST':
        if not token():
            raise NotificationError('ยังไม่ได้กำหนด LINE_CHANNEL_ACCESS_TOKEN')
        db.execute('BEGIN IMMEDIATE');cfg=config(db)
        row=db.execute('SELECT * FROM line_outbox WHERE id=?',(int(retry_match[1]),)).fetchone()
        if row is None:
            raise NotificationError('ไม่พบรายการส่ง',404)
        job=dict(row);job['config_revision']=cfg['revision']
        if job['status'] not in ('failed','skipped') or not eligible(db,job,cfg):
            raise NotificationError('ส่งซ้ำไม่ได้ งานหรือผู้รับเปลี่ยนแล้ว หรือข้อความยังอยู่ในคิว')
        if job['first_attempt_at'] and datetime.now(TZ)-datetime.fromisoformat(job['first_attempt_at'])>timedelta(hours=23):
            raise NotificationError('เกินช่วงส่งซ้ำที่ปลอดภัย กรุณาตรวจสอบข้อความที่ผู้รับก่อน')
        db.execute("UPDATE line_outbox SET status='pending',config_revision=?,available_at=?,last_error='' WHERE id=?",(cfg['revision'],stamp(),job['id']))
        return {'queued':True,'id':job['id']}
    return {'error':'ไม่พบคำสั่ง LINE'},404
