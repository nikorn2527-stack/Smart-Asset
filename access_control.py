"""Password sessions and organization/branch access. Default-on; legacy mode is explicit."""
import hashlib,hmac,json,os,re,secrets,sqlite3,time
from http.cookies import SimpleCookie
from urllib.parse import urlparse
from governance import GovernanceError,ident,text,dump
PERMISSIONS=('view','create','edit','approve','export','manage','work')
ACTORS=('ผู้แจ้ง','เจ้าหน้าที่พัสดุ','ผู้อนุมัติ','ช่าง')
SCHEMA='''
CREATE TABLE IF NOT EXISTS app_users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,global_role TEXT NOT NULL DEFAULT 'user',is_active INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS user_memberships(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES app_users(id),account_id INTEGER NOT NULL REFERENCES asset_accounts(id),branch_id INTEGER REFERENCES account_branches(id),permissions_json TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_scope ON user_memberships(user_id,account_id,COALESCE(branch_id,0));
CREATE TABLE IF NOT EXISTS app_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES app_users(id),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL,account_id INTEGER REFERENCES asset_accounts(id),branch_id INTEGER REFERENCES account_branches(id),actor TEXT NOT NULL DEFAULT 'ผู้แจ้ง');
CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,failures INTEGER NOT NULL,blocked_until INTEGER NOT NULL);
'''
class Connection(sqlite3.Connection):pass

def required():return os.environ.get('ASSET_AUTH_REQUIRED','1')!='0'
def initialize(path):
    with sqlite3.connect(path) as db:db.executescript(SCHEMA)
def fail(message,status=403):raise GovernanceError(message,status)
def password_hash(password):
    if not isinstance(password,str) or not 10<=len(password)<=128:fail('รหัสผ่านต้องยาว 10–128 ตัวอักษร',400)
    salt=secrets.token_hex(16);count=600000;value=hashlib.pbkdf2_hmac('sha256',password.encode(),salt.encode(),count).hex()
    return f'pbkdf2_sha256${count}${salt}${value}'
def check_password(password,stored):
    try:
        scheme,count,salt,value=stored.split('$');candidate=hashlib.pbkdf2_hmac('sha256',str(password).encode(),salt.encode(),int(count)).hex()
        return scheme=='pbkdf2_sha256' and hmac.compare_digest(value,candidate)
    except (ValueError,TypeError):return False

def scope_sql(db,alias='a'):
    ctx=getattr(db,'access',None)
    if not ctx or ctx['accountId'] is None:return '1=1'
    expr=f'{alias}.numbering_account_id={int(ctx["accountId"])}'
    if ctx['branchId'] is not None:expr+=f' AND {alias}.branch_id={int(ctx["branchId"])}'
    return '('+expr+')'
def document_scope_sql(db,alias='s'):
    ctx=getattr(db,'access',None)
    if not ctx or ctx['accountId'] is None:return '1=1'
    expr=f'{alias}.account_id={int(ctx["accountId"])}'
    if ctx['branchId'] is not None:expr+=f' AND {alias}.branch_id={int(ctx["branchId"])}'
    return '('+expr+')'
def can_asset(db,aid):
    if not db.execute('SELECT 1 FROM assets a WHERE a.id=? AND '+scope_sql(db),(ident(aid),)).fetchone():fail('ไม่มีสิทธิ์เข้าถึงครุภัณฑ์นี้',404)
def visible_plan(db,pid):
    return not db.execute('SELECT 1 FROM work_plan_assets p JOIN assets a ON a.id=p.asset_id WHERE p.plan_id=? AND NOT ('+scope_sql(db)+')',(pid,)).fetchone() and bool(db.execute('SELECT 1 FROM work_plan_assets WHERE plan_id=?',(pid,)).fetchone())

def memberships(db,uid):return [{**dict(r),'permissions':json.loads(r['permissions_json'])} for r in db.execute('SELECT m.*,a.name AS accountName,b.name AS branchName FROM user_memberships m JOIN asset_accounts a ON a.id=m.account_id LEFT JOIN account_branches b ON b.id=m.branch_id WHERE m.user_id=? AND a.is_active=1 AND (b.id IS NULL OR b.is_active=1)',(uid,))]
def context(db,user,session):
    grants=memberships(db,user['id']);global_view=user['global_role'] in ('admin','auditor');admin=user['global_role']=='admin'
    aid=session['account_id'];bid=session['branch_id'];perms={p:admin for p in PERMISSIONS}
    if global_view:perms['view']=True
    matched=[m for m in grants if m['account_id']==aid and (m['branch_id'] is None or m['branch_id']==bid)]
    if not global_view and (aid is None or not matched):fail('บัญชีนี้ยังไม่ได้รับสิทธิ์ในองค์กรที่เลือก กรุณาติดต่อผู้ดูแล')
    for grant in matched:
        for p in PERMISSIONS:perms[p]|=bool(grant['permissions'].get(p))
    if not perms['view']:fail('ยังไม่ได้รับสิทธิ์ดูข้อมูลในองค์กร')
    roles=['ผู้แจ้ง']
    if perms['create'] or perms['edit'] or perms['manage']:roles.append('เจ้าหน้าที่พัสดุ')
    if perms['approve']:roles.append('ผู้อนุมัติ')
    if perms['work']:roles.append('ช่าง')
    actor=session['actor'] if session['actor'] in roles else roles[0]
    return {'user':{k:user[k] for k in ('id','username','name','global_role','revision')},'accountId':aid,'branchId':bid,'permissions':perms,'roles':roles,'actor':actor,'canViewAll':global_view,'isAdmin':admin,'memberships':grants,'csrf':session['csrf']}

def origin_check(handler):
    origin=handler.headers.get('Origin')
    if origin:
        allowed={handler.headers.get('Host','')}
        public=os.environ.get('PUBLIC_BASE_URL','')
        if public:allowed.add(urlparse(public).netloc)
        if urlparse(origin).netloc not in allowed:fail('ต้นทางคำขอไม่ตรงกับระบบ')
    if handler.headers.get('Sec-Fetch-Site')=='cross-site':fail('ไม่รับคำขอแก้ข้อมูลข้ามเว็บไซต์')
def token(handler):
    cookie=SimpleCookie()
    try:cookie.load(handler.headers.get('Cookie',''));raw=cookie.get('smart_asset_session');return raw.value if raw else ''
    except Exception:return ''
def session_user(db,handler):
    raw=token(handler)
    row=db.execute('SELECT * FROM app_sessions WHERE token_hash=? AND expires_at>?',(hashlib.sha256(raw.encode()).hexdigest(),int(time.time()))).fetchone() if raw else None
    if not row:fail('กรุณาเข้าสู่ระบบ',401)
    user=db.execute('SELECT * FROM app_users WHERE id=? AND is_active=1',(row['user_id'],)).fetchone()
    if not user:fail('บัญชีถูกปิดใช้งาน กรุณาติดต่อผู้ดูแล',401)
    return user,row

def new_session(db,handler,user):
    raw=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(24);grants=memberships(db,user['id']);aid=bid=None
    if user['global_role']=='user' and grants:aid=grants[0]['account_id'];bid=grants[0]['branch_id']
    db.execute('DELETE FROM app_sessions WHERE expires_at<=?',(int(time.time()),))
    permissions={p:False for p in PERMISSIONS}
    for g in grants:
        if g['account_id']==aid and (g['branch_id'] is None or g['branch_id']==bid):
            for p in PERMISSIONS:permissions[p]|=bool(g['permissions'].get(p))
    actor='เจ้าหน้าที่พัสดุ' if user['global_role']=='admin' or any(permissions[p] for p in ('create','edit','manage')) else 'ผู้อนุมัติ' if permissions['approve'] else 'ช่าง' if permissions['work'] else 'ผู้แจ้ง'
    db.execute('INSERT INTO app_sessions VALUES(?,?,?,?,?,?,?)',(hashlib.sha256(raw.encode()).hexdigest(),user['id'],csrf,int(time.time())+8*3600,aid,bid,actor))
    secure='; Secure' if os.environ.get('PUBLIC_BASE_URL','').startswith('https://') else ''
    handler.session_cookie='smart_asset_session='+raw+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800'+secure
    row=db.execute('SELECT * FROM app_sessions WHERE token_hash=?',(hashlib.sha256(raw.encode()).hexdigest(),)).fetchone()
    return context(db,user,row) if user['global_role']!='user' or grants else {'user':{k:user[k] for k in ('id','username','name','global_role')},'memberships':[],'needsAccess':True,'csrf':csrf,'roles':['ผู้แจ้ง'],'actor':'ผู้แจ้ง'}

def authenticate(db,handler,method,path,body):
    if not required():db.access=None;return None
    if path=='/api/health' or re.fullmatch(r'/api/(scan|receipts)/[A-Za-z0-9_-]{32}(?:/repairs|/action)?',path):return None
    user,session=session_user(db,handler)
    if method not in ('GET','HEAD'):
        origin_check(handler)
        if not hmac.compare_digest(handler.headers.get('X-CSRF-Token',''),session['csrf']):fail('ข้อมูลยืนยันคำขอหมดอายุ กรุณาโหลดหน้าใหม่')
    db.access=context(db,user,session);return db.access

def auth_api(db,handler,method,path,body):
    if not path.startswith('/api/auth/'):return None
    if path=='/api/auth/session' and method=='GET':
        if not required():return {'required':False}
        needs=not db.execute('SELECT 1 FROM app_users LIMIT 1').fetchone()
        if needs:return {'required':True,'authenticated':False,'setupRequired':True}
        try:
            user,s=session_user(db,handler)
            try:ctx=context(db,user,s)
            except GovernanceError:ctx={'user':{k:user[k] for k in ('id','username','name','global_role')},'needsAccess':True,'memberships':memberships(db,user['id']),'csrf':s['csrf'],'roles':['ผู้แจ้ง'],'actor':'ผู้แจ้ง'}
            return {'required':True,'authenticated':True,**ctx}
        except GovernanceError:return {'required':True,'authenticated':False,'setupRequired':False}
    if method=='POST' and path in ('/api/auth/setup','/api/auth/login'):
        origin_check(handler);username=text(body.get('username'),'ชื่อผู้ใช้',80).casefold()
        if not re.fullmatch(r'[a-z0-9ก-๙._@-]{3,80}',username):fail('ชื่อผู้ใช้ใช้ตัวอักษร ตัวเลข . _ @ - อย่างน้อย 3 ตัว',400)
        if path.endswith('setup'):
            if handler.client_address[0] not in ('127.0.0.1','::1'):fail('ตั้งผู้ดูแลครั้งแรกจากเครื่องที่รันระบบเท่านั้น')
            hashed=password_hash(body.get('password'));db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM app_users LIMIT 1').fetchone():fail('มีผู้ดูแลแล้ว กรุณาเข้าสู่ระบบ',409)
            uid=db.execute("INSERT INTO app_users(username,name,password_hash,global_role) VALUES(?,?,?,'admin')",(username,text(body.get('name'),'ชื่อผู้ดูแล',160),hashed)).lastrowid
            return {'authenticated':True,'required':True,**new_session(db,handler,db.execute('SELECT * FROM app_users WHERE id=?',(uid,)).fetchone())}
        key=hashlib.sha256((handler.client_address[0]+':'+username).encode()).hexdigest();attempt=db.execute('SELECT * FROM login_attempts WHERE key=?',(key,)).fetchone();now=int(time.time())
        if attempt and attempt['blocked_until']>now:fail('เข้าสู่ระบบผิดหลายครั้ง กรุณารอ 5 นาที',429)
        user=db.execute('SELECT * FROM app_users WHERE username=? AND is_active=1',(username,)).fetchone()
        dummy='pbkdf2_sha256$600000$invalidsalt$'+'0'*64
        if not check_password(body.get('password',''),user['password_hash'] if user else dummy):
            failures=(attempt['failures'] if attempt and attempt['blocked_until']>now-300 else 0)+1
            db.execute('INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until',(key,failures,now+300 if failures>=5 else now));fail('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',401)
        db.execute('DELETE FROM login_attempts WHERE key=?',(key,));return {'authenticated':True,'required':True,**new_session(db,handler,user)}
    user,s=session_user(db,handler)
    if method!='GET':
        origin_check(handler)
        if not hmac.compare_digest(handler.headers.get('X-CSRF-Token',''),s['csrf']):fail('ข้อมูลยืนยันคำขอไม่ถูกต้อง')
    if path=='/api/auth/logout' and method=='POST':
        db.execute('DELETE FROM app_sessions WHERE token_hash=?',(s['token_hash'],));handler.session_cookie='smart_asset_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';return {'ok':True}
    if path=='/api/auth/scope' and method=='POST':
        aid=ident(body.get('accountId'),True);bid=ident(body.get('branchId'),True)
        if aid is not None and not db.execute('SELECT 1 FROM asset_accounts WHERE id=? AND is_active=1',(aid,)).fetchone():fail('ไม่พบองค์กร')
        if bid and not db.execute('SELECT 1 FROM account_branches WHERE id=? AND account_id=? AND is_active=1',(bid,aid)).fetchone():fail('สาขาไม่ตรงกับองค์กร')
        changed={**dict(s),'account_id':aid,'branch_id':bid,'actor':body.get('actor',s['actor'])};new=context(db,user,changed)
        if changed['actor'] not in new['roles']:fail('ไม่ได้รับสิทธิ์บทบาทที่เลือก')
        db.execute('UPDATE app_sessions SET account_id=?,branch_id=?,actor=? WHERE token_hash=?',(aid,bid,changed['actor'],s['token_hash']));return new
    if path=='/api/auth/password' and method=='POST':
        if not check_password(body.get('currentPassword',''),user['password_hash']):fail('รหัสผ่านปัจจุบันไม่ถูกต้อง',400)
        hashed=password_hash(body.get('password'));db.execute('BEGIN IMMEDIATE');db.execute('UPDATE app_users SET password_hash=?,revision=revision+1 WHERE id=?',(hashed,user['id']));db.execute('DELETE FROM app_sessions WHERE user_id=?',(user['id'],));return {'ok':True,'loginRequired':True}
    ctx=context(db,user,s);db.access=ctx
    if path=='/api/auth/options' and method=='GET':
        aids={g['account_id'] for g in ctx['memberships']}
        accounts=[dict(r) for r in db.execute('SELECT id,name,code FROM asset_accounts WHERE is_active=1') if ctx['canViewAll'] or r['id'] in aids]
        branches=[dict(r) for r in db.execute('SELECT id,account_id,name,code FROM account_branches WHERE is_active=1') if ctx['canViewAll'] or any(g['account_id']==r['account_id'] and g['branch_id'] in (None,r['id']) for g in ctx['memberships'])]
        return {'accounts':accounts,'branches':branches}
    if path=='/api/auth/users':return users_api(db,ctx,method,body)
    fail('ไม่พบเส้นทางผู้ใช้งาน',404)

def users_api(db,ctx,method,body):
    if not ctx['permissions']['manage']:fail('ต้องได้รับสิทธิ์จัดการผู้ใช้งาน')
    if method=='GET':
        where='1=1' if ctx['isAdmin'] else "u.global_role='user' AND EXISTS(SELECT 1 FROM user_memberships m WHERE m.user_id=u.id AND m.account_id="+str(int(ctx['accountId']))+')'
        return {'items':[{**dict(u),'memberships':memberships(db,u['id']) if ctx['isAdmin'] else [m for m in memberships(db,u['id']) if m['account_id']==ctx['accountId']]} for u in db.execute('SELECT u.id,u.username,u.name,u.global_role,u.is_active,u.revision FROM app_users u WHERE '+where+' ORDER BY u.id')]}
    if method not in ('POST','PUT'):fail('ไม่รองรับคำสั่ง',405)
    uid=ident(body.get('id'),True);old=db.execute('SELECT * FROM app_users WHERE id=?',(uid,)).fetchone() if uid else None
    if uid and not old:fail('ไม่พบผู้ใช้',404)
    if old and (body.get('revision')!=old['revision']):fail('ผู้ใช้ถูกแก้ไขแล้ว กรุณาโหลดใหม่',409)
    global_role=body.get('globalRole','user')
    if global_role not in ('user','admin','auditor'):fail('สิทธิ์ส่วนกลางไม่ถูกต้อง',400)
    if not ctx['isAdmin']:
        if global_role!='user' or old and old['global_role']!='user':fail('ผู้ดูแลองค์กรกำหนดสิทธิ์ส่วนกลางไม่ได้')
        if old and not any(m['account_id']==ctx['accountId'] for m in memberships(db,uid)):fail('ไม่พบผู้ใช้ในองค์กร',404)
        if old and body.get('password'):fail('ให้ผู้ใช้เปลี่ยนรหัสผ่านเอง หรือให้ผู้ดูแลระบบรีเซ็ต')
    active=body.get('isActive',bool(old['is_active']) if old else True)
    if type(active) is not bool:fail('สถานะผู้ใช้ไม่ถูกต้อง',400)
    if uid==ctx['user']['id'] and (not active or global_role!='admin' and ctx['isAdmin']):fail('ไม่ปิดบัญชีหรือลดสิทธิ์ผู้ดูแลที่กำลังใช้งาน')
    grants=body.get('memberships',[])
    if not isinstance(grants,list) or len(grants)>100:fail('รายการสิทธิ์ไม่ถูกต้อง',400)
    checked=[];seen=set()
    for g in grants:
        if not isinstance(g,dict):fail('รายการสิทธิ์ไม่ถูกต้อง',400)
        aid=ident(g.get('accountId'));bid=ident(g.get('branchId'),True)
        if not db.execute('SELECT 1 FROM asset_accounts WHERE id=? AND is_active=1',(aid,)).fetchone():fail('ไม่พบองค์กร',400)
        if bid and not db.execute('SELECT 1 FROM account_branches WHERE id=? AND account_id=? AND is_active=1',(bid,aid)).fetchone():fail('สาขาไม่ตรงองค์กร',400)
        if not ctx['isAdmin'] and (aid!=ctx['accountId'] or ctx['branchId'] is not None and bid!=ctx['branchId']):fail('ให้สิทธิ์ได้เฉพาะขอบเขตที่รับผิดชอบ')
        perms=g.get('permissions',{})
        if not isinstance(perms,dict) or set(perms)-set(PERMISSIONS) or any(type(v) is not bool for v in perms.values()):fail('สิทธิ์ต้องเป็นค่าเลือกใช่/ไม่',400)
        perms={p:perms.get(p,False) for p in PERMISSIONS}
        if not ctx['isAdmin'] and any(perms[p] and not ctx['permissions'][p] for p in PERMISSIONS):fail('ให้สิทธิ์เกินกว่าที่ตนเองมีไม่ได้')
        if (aid,bid) in seen:fail('สิทธิ์องค์กรและสาขาซ้ำ',400)
        seen.add((aid,bid));checked.append((aid,bid,dump(perms)))
    username=text(body.get('username',old['username'] if old else None),'ชื่อผู้ใช้',80).casefold();name=text(body.get('name'),'ชื่อ',160)
    if not re.fullmatch(r'[a-z0-9ก-๙._@-]{3,80}',username):fail('ชื่อผู้ใช้ไม่ถูกต้อง',400)
    if old and not ctx['isAdmin'] and (username!=old['username'] or name!=old['name']):fail('ผู้ดูแลองค์กรแก้ได้เฉพาะสิทธิ์ในองค์กร ชื่อบัญชีให้ผู้ดูแลระบบแก้ไข')
    hashed=password_hash(body.get('password')) if body.get('password') or not old else old['password_hash']
    db.execute('BEGIN IMMEDIATE')
    if old:
        if not ctx['isAdmin'] and active!=bool(old['is_active']):fail('ผู้ดูแลองค์กรแก้ได้เฉพาะสิทธิ์องค์กร การเปิด/ปิดบัญชีให้ผู้ดูแลระบบจัดการ')
        db.execute('UPDATE app_users SET username=?,name=?,password_hash=?,global_role=?,is_active=?,revision=revision+1 WHERE id=?',(username,name,hashed,global_role,int(active),uid))
        if ctx['isAdmin']:db.execute('DELETE FROM user_memberships WHERE user_id=?',(uid,))
        else:db.execute('DELETE FROM user_memberships WHERE user_id=? AND account_id=?'+(' AND branch_id=?' if ctx['branchId'] else ''),[uid,ctx['accountId']]+([ctx['branchId']] if ctx['branchId'] else []))
        db.execute('DELETE FROM app_sessions WHERE user_id=?',(uid,))
    else:uid=db.execute('INSERT INTO app_users(username,name,password_hash,global_role,is_active) VALUES(?,?,?,?,?)',(username,name,hashed,global_role,int(active))).lastrowid
    db.executemany('INSERT INTO user_memberships(user_id,account_id,branch_id,permissions_json) VALUES(?,?,?,?)',[(uid,*g) for g in checked])
    db.execute('INSERT INTO account_events(actor,kind,entity_id,before_json,after_json) VALUES(?,?,?,?,?)',(ctx['user']['username'],'user-access',uid,dump({'revision':old['revision']} if old else {}),dump({'name':name,'globalRole':global_role,'isActive':active,'memberships':grants})))
    return {'id':uid},200 if old else 201

def authorize(db,ctx,method,path,query,body):
    if not ctx:return
    # Explicitly check every organization selector, including file downloads and preview jobs.
    aid,bid=ctx['accountId'],ctx['branchId'];perms=ctx['permissions']
    if not perms['view']:fail('ยังไม่ได้รับสิทธิ์ดูข้อมูล')
    if aid is not None:
        for source in (body,{k:v[0] for k,v in query.items()}):
            if source.get('accountId') not in (None,'') and str(source['accountId'])!=str(aid):fail('ไม่มีสิทธิ์เข้าถึงองค์กรที่ระบุ')
            if bid is not None and source.get('branchId') not in (None,'') and str(source['branchId'])!=str(bid):fail('ไม่มีสิทธิ์เข้าถึงสาขาที่ระบุ')
        query['accountId']=[str(aid)]
        if bid is not None:query['branchId']=[str(bid)];query['allBranches']=['0']
        if method not in ('GET','HEAD'):
            body['accountId']=aid
            if bid is not None:body['branchId']=bid
    body['actor']=ctx['actor'];query['actor']=[ctx['actor']];query['role']=[ctx['actor']]
    whole_system=path.startswith(('/api/backups','/api/line/'))
    shared_write=path.startswith(('/api/equipment/','/api/catalog/','/api/sticker/settings','/api/sticker/templates')) or path in ('/api/branding','/api/workflow/settings')
    if whole_system and not ctx['isAdmin']:fail('ส่วนนี้ต้องใช้สิทธิ์ผู้ดูแลระบบส่วนกลาง')
    if shared_write and method not in ('GET','HEAD') and not ctx['isAdmin']:fail('การแก้หลักเกณฑ์หรือข้อมูลกลางต้องใช้ผู้ดูแลระบบส่วนกลาง')
    if path=='/api/governance/accounts' and method!='GET' and not ctx['isAdmin']:fail('การเพิ่มองค์กรต้องใช้ผู้ดูแลระบบ')
    if path.startswith('/api/survey') and not ctx['isAdmin']:
        if method=='GET':return
        fail('ใช้ทะเบียนที่ระบุองค์กรและสาขาเพื่อเพิ่มอุปกรณ์')
    asset=re.match(r'/api/(?:assets|workspace/assets|governance/assets)/(\d+)(?:/|$)',path)
    if asset:can_asset(db,int(asset[1]))
    ticket=re.match(r'/api/tickets/(\d+)(?:/|$)',path)
    if ticket:
        r=db.execute('SELECT asset_id FROM tickets WHERE id=?',(int(ticket[1]),)).fetchone()
        if not r:fail('ไม่พบคำขอ',404)
        if r[0] is not None:can_asset(db,r[0])
        elif aid is not None:fail('คำขอยังไม่เชื่อมครุภัณฑ์ในองค์กรที่ได้รับสิทธิ์',404)
    supply=re.match(r'/api/supply/(documents|files)/(\d+)',path)
    if supply:
        sql='SELECT s.* FROM supply_documents s '+('JOIN supply_files f ON f.document_id=s.id WHERE f.id=?' if supply[1]=='files' else 'WHERE s.id=?')+' AND '+document_scope_sql(db)
        if not db.execute(sql,(int(supply[2]),)).fetchone():fail('ไม่พบใบงานหรือเอกสารในขอบเขตสิทธิ์',404)
    if path=='/api/imports/commit':
        if not db.execute('SELECT 1 FROM asset_import_jobs s WHERE id=? AND '+document_scope_sql(db),(body.get('id'),)).fetchone():fail('ไม่พบชุดนำเข้าในขอบเขตสิทธิ์',404)
    work=re.match(r'/api/work/items/(\d+)',path)
    if work:
        r=db.execute('SELECT asset_id FROM scheduled_work WHERE id=?',(int(work[1]),)).fetchone()
        if not r:fail('ไม่พบงาน',404)
        can_asset(db,r[0])
    plan=re.match(r'/api/work/plans/(\d+)',path)
    if plan and not visible_plan(db,int(plan[1])):fail('แผนนี้มีข้อมูลนอกขอบเขตสิทธิ์',404)
    if body.get('assetId') not in (None,''):can_asset(db,body['assetId'])
    for key in ('assetIds','asset_ids','ids'):
        if key in body:
            if not isinstance(body[key],list):fail('รายการครุภัณฑ์ไม่ถูกต้อง',400)
            for i in body[key]:can_asset(db,i)
    if path=='/api/assets' and method=='POST' and not (ctx['isAdmin'] or perms['manage']):
        if not body.get('catalogId') or body.get('code'):fail('เลือกชนิดอุปกรณ์จากบัญชีที่กำหนดไว้ การเพิ่มเลขเดิมใช้หน้านำเข้าหรือให้ผู้ดูแลทะเบียนดำเนินการ')
    if path=='/api/workspace/assets' and method!='GET':fail('ไม่พบเส้นทาง',404)
    if path=='/api/governance/catalog' and method!='GET' and body.get('id'):
        row=db.execute('SELECT shared_catalog_id FROM account_catalog WHERE id=?',(body['id'],)).fetchone()
        if row and row[0]:fail('รายการนี้ใช้บัญชีกลางร่วมกัน กรุณาแก้ที่บัญชีอุปกรณ์กลาง')
    if bid is not None and method not in ('GET','HEAD') and path in ('/api/supply/settings','/api/workspace/categories'):fail('การตั้งค่าระดับองค์กรต้องใช้สิทธิ์ครอบคลุมทั้งองค์กร')
    if path=='/api/catalog/numbering' and aid is not None:fail('ใช้บัญชีอุปกรณ์และการออกเลขภายในองค์กรที่เลือก')
    if method in ('GET','HEAD'):return
    if path=='/api/governance/preview':return
    if path=='/api/notifications/read':return
    if path.startswith('/api/sticker/'):
        if not perms['export']:fail('ไม่ได้รับสิทธิ์ส่งออกหรือพิมพ์')
        return
    if path.startswith(('/api/operational-master','/api/supply/settings','/api/governance/branches','/api/governance/profiles','/api/governance/catalog','/api/governance/bindings','/api/workspace/categories')):
        needed='manage'
    elif body.get('action') in ('approve','reject','approve_final_cost','reject_final_cost') or path.endswith('/action') and body.get('action') in ('approve','reject'):
        needed='approve'
    elif path.startswith('/api/work/items/') or path.endswith('/action') and body.get('action') in ('complete','resume','wait_parts'):
        if not (perms['work'] or perms['edit']):fail('ไม่ได้รับสิทธิ์ดำเนินงาน')
        return
    elif path in ('/api/assets','/api/tickets','/api/supply/documents','/api/work/plans','/api/imports/preview','/api/imports/commit'):needed='create'
    else:needed='edit'
    if not perms[needed]:fail('ไม่ได้รับสิทธิ์'+{'manage':'จัดการตั้งค่า','approve':'อนุมัติ','create':'เพิ่มข้อมูล','edit':'แก้ไขข้อมูล'}[needed])
    # Mutations in unknown modules fail closed for ordinary users.
    known=('/api/assets','/api/tickets','/api/supply/','/api/work/','/api/workspace/','/api/governance/','/api/operational-master','/api/imports/','/api/equipment/','/api/catalog/','/api/backups','/api/line/','/api/branding','/api/workflow/settings','/api/survey')
    if not path.startswith(known):fail('เส้นทางนี้ยังไม่เปิดให้สิทธิ์ระดับองค์กร')

def filter_result(db,path,value):
    ctx=getattr(db,'access',None)
    if not ctx:return value
    wrapped=isinstance(value,tuple);result=value[0] if wrapped else value
    if path=='/api/config':result={**result,'roles':ctx['roles'],'demoOnly':False,'authenticated':True}
    if path=='/api/survey' and not ctx['isAdmin']:result=[]
    if path=='/api/governance' and ctx['accountId'] is not None:
        aid=ctx['accountId'];bid=ctx['branchId']
        result={**result,'accounts':[a for a in result['accounts'] if a['id']==aid],'branches':[b for b in result['branches'] if b['account_id']==aid and (bid is None or b['id']==bid)],'profiles':[p for p in result['profiles'] if p['account_id']==aid],'bindings':[b for b in result['bindings'] if b['account_id']==aid and (b['branch_id'] is None or bid is None or b['branch_id']==bid)],'categoryLabels':[c for c in result['categoryLabels'] if c['account_id']==aid]}
    if path=='/api/register/featured' and result:
        # A featured register is picked by the route from scoped inventory, not from another organization.
        pass
    return (result,value[1]) if wrapped else result
