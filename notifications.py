"""Current workflow inbox, role-scoped read markers, and approval settings.

Roles are simulated by the existing prototype. This module does not authenticate
users or deliver messages to external services.
"""
from datetime import datetime, timedelta, timezone
import json
import math
import re

TZ = timezone(timedelta(hours=7))
OFFICER, APPROVER, TECH, REQUESTER = 'เจ้าหน้าที่พัสดุ', 'ผู้อนุมัติ', 'ช่าง', 'ผู้แจ้ง'
ROLES = (OFFICER, APPROVER, TECH, REQUESTER)


class NotificationError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def stamp():
    return datetime.now(TZ).isoformat(timespec='seconds')


def settings(db):
    row = db.execute('SELECT * FROM workflow_settings WHERE id=1').fetchone()
    return {'approvalThreshold': row['approval_threshold'], 'reminderDays': row['reminder_days'],
            'revision': row['revision'], 'updatedAt': row['updated_at'], 'updatedBy': row['updated_by']}


def approval_threshold(db):
    return settings(db)['approvalThreshold']


def one(query, key, default=''):
    value = query.get(key, [default])
    return value[0] if isinstance(value, list) else value


def role(value):
    if value not in ROLES:
        raise NotificationError('กรุณาเลือกบทบาททดสอบที่ระบบรองรับ', 403)
    return value


# Keys include the latest audit event, so reading a task never suppresses a new
# approval stage or reassignment. Date buckets produce one new due/overdue alert.
FEED = """WITH feed AS (
 SELECT 'ticket:'||t.id||':'||COALESCE(e.id,0) AS key,'ticket' AS entity,t.id AS entityId,
 t.ticket_no AS reference,t.asset_name AS subject,t.status AS status,t.updated_at AS updatedAt,
 CASE WHEN :role='ผู้อนุมัติ' THEN 'approval' ELSE 'repair' END AS category,
 CASE WHEN :role='ผู้อนุมัติ' THEN 90 WHEN t.status='รอผู้แจ้งยืนยัน' THEN 80
      WHEN t.urgency='เร่งด่วนมาก' THEN 85 WHEN t.urgency='เร่งด่วน' THEN 70 ELSE 50 END AS priority,
 CASE WHEN :role='ผู้อนุมัติ' AND t.status='รออนุมัติค่าใช้จ่ายจริง' THEN 'พิจารณาค่าใช้จ่ายจริง'
      WHEN :role='ผู้อนุมัติ' THEN 'พิจารณาอนุมัติงานซ่อม'
      WHEN :role='เจ้าหน้าที่พัสดุ' AND t.status='รับแจ้งใหม่' THEN 'คัดกรองคำขอแจ้งซ่อม'
      WHEN :role='เจ้าหน้าที่พัสดุ' AND t.status='รอมอบหมาย' THEN 'มอบหมายช่างดำเนินการ'
      WHEN t.status='รอแก้ไขค่าใช้จ่าย' THEN 'แก้ไขและเสนอค่าใช้จ่ายใหม่'
      WHEN :role='ผู้แจ้ง' AND t.status='รอผู้แจ้งยืนยัน' THEN 'ตรวจรับผลซ่อม / ส่งกลับแก้ไข'
      WHEN e.action='send_back' THEN 'ผู้แจ้งส่งกลับให้แก้ไขงานซ่อม'
      WHEN :role='ช่าง' AND t.status='กำลังซ่อม' THEN 'ดำเนินงานซ่อมที่ได้รับมอบหมาย'
      WHEN t.status='รออะไหล่' THEN 'ติดตามอะไหล่ / อุปกรณ์'
      ELSE 'อัปเดตคำขอแจ้งซ่อม' END AS title,
 CASE WHEN :role='ผู้อนุมัติ' AND t.status='รออนุมัติค่าใช้จ่ายจริง' THEN 'ยอดจริง '||printf('%.2f',t.actual_cost)||' บาท'
      WHEN :role='ผู้อนุมัติ' THEN 'ประมาณการ '||printf('%.2f',t.estimate_cost)||' บาท'
      WHEN :role='ช่าง' THEN 'ผู้รับผิดชอบ: '||t.assigned_to
      ELSE t.status END AS detail,
 '' AS dueOn, t.assigned_to AS assignee
 FROM tickets t LEFT JOIN ticket_events e ON e.id=(SELECT MAX(id) FROM ticket_events WHERE ticket_id=t.id)
 WHERE (:role='ผู้อนุมัติ' AND t.status IN ('รออนุมัติ','รออนุมัติค่าใช้จ่ายจริง'))
    OR (:role='เจ้าหน้าที่พัสดุ' AND t.status IN ('รับแจ้งใหม่','รอมอบหมาย','รอแก้ไขค่าใช้จ่าย','รออะไหล่'))
    OR (:role='ช่าง' AND t.status IN ('กำลังซ่อม','รออะไหล่'))
    OR (:role='ผู้แจ้ง' AND (t.status NOT IN ('ปิดงาน','ยกเลิก','ไม่อนุมัติ') OR datetime(t.updated_at)>=datetime(:cutoff)))
 UNION ALL
 SELECT 'asset:'||a.id||':'||COALESCE(e.id,0),'asset',a.id,a.code,a.name,a.status,a.updated_at,
 CASE WHEN a.status='รออนุมัติ' THEN 'approval' ELSE 'asset' END,
 CASE WHEN a.status='รออนุมัติ' THEN 90 ELSE 40 END,
 CASE WHEN a.status='รออนุมัติ' THEN 'พิจารณาขึ้นทะเบียนครุภัณฑ์' ELSE 'ผลพิจารณาขึ้นทะเบียนครุภัณฑ์' END,
 a.status,'',''
 FROM assets a LEFT JOIN asset_events e ON e.id=(SELECT MAX(id) FROM asset_events WHERE asset_id=a.id)
 WHERE (:role='ผู้อนุมัติ' AND a.status='รออนุมัติ')
    OR (a.created_by=:role AND a.status IN ('ทะเบียนแล้ว','ไม่อนุมัติ') AND e.id IS NOT NULL AND datetime(a.updated_at)>=datetime(:cutoff))
 UNION ALL
 SELECT 'work:'||w.id||':'||COALESCE(e.id,0)||':'||
 CASE WHEN w.status='completed' THEN 'followup' WHEN w.due_on<:today THEN 'overdue'
      WHEN w.due_on<=:upcoming THEN 'due' ELSE 'assigned' END,
 'work',w.id,a.code,a.name,w.status,COALESCE(e.created_at,p.created_at),'work',
 CASE WHEN w.status='completed' THEN 80 WHEN w.due_on<:today THEN 85 WHEN w.due_on<=:upcoming THEN 65 ELSE 30 END,
 CASE WHEN w.status='completed' AND w.result='not_found' THEN 'ผลตรวจนับไม่พบครุภัณฑ์'
      WHEN w.status='completed' THEN 'ผลตรวจต้องติดตาม / แจ้งซ่อม'
      WHEN w.due_on<:today THEN 'งานเกินกำหนด'
      WHEN w.due_on<=:upcoming THEN 'งานใกล้ครบกำหนด' ELSE 'งานที่ได้รับมอบหมาย' END,
 CASE WHEN p.kind='pm' THEN 'PM · ' ELSE 'ตรวจนับ · ' END||p.name,w.due_on,w.assignee
 FROM scheduled_work w JOIN work_plans p ON p.id=w.plan_id JOIN assets a ON a.id=w.asset_id
 LEFT JOIN work_events e ON e.id=(SELECT MAX(id) FROM work_events WHERE work_id=w.id)
 WHERE (:role IN ('เจ้าหน้าที่พัสดุ','ช่าง') AND w.status!='completed')
    OR (:role='เจ้าหน้าที่พัสดุ' AND w.status='completed' AND
       ((w.result IN ('needs_repair','damaged') AND w.repair_ticket_id IS NULL) OR (w.result='not_found' AND datetime(w.completed_at)>=datetime(:cutoff))))
 UNION ALL
 SELECT 'supply:'||s.id||':'||s.revision,'supply',s.id,s.number,
 COALESCE(json_extract(s.data_json,'$.supplier'),json_extract(s.data_json,'$.department')),
 s.status,s.updated_at,CASE WHEN s.status='pending' THEN 'approval' ELSE 'supply' END,
 CASE WHEN s.status='pending' THEN 90 ELSE 60 END,
 CASE s.status WHEN 'received' THEN 'ตรวจรับพัสดุที่รับเข้า' WHEN 'inspected' THEN 'ขึ้นทะเบียนรายการผ่านตรวจรับ'
 WHEN 'pending' THEN 'พิจารณาอนุมัติเบิก / จัดสรร' WHEN 'approved' THEN 'จ่ายครุภัณฑ์ตามใบเบิก'
 ELSE 'ยืนยันรับมอบครุภัณฑ์' END,
 CASE s.kind WHEN 'receipt' THEN 'รับเข้า' ELSE 'เบิก / จัดสรร' END,'',''
 FROM supply_documents s
 WHERE (s.status='received' AND :role=json_extract(s.rules_json,'$.inspectionRole'))
 OR (s.status='inspected' AND :role='เจ้าหน้าที่พัสดุ')
 OR (s.status='pending' AND :role=json_extract(s.rules_json,'$.approvalRole'))
 OR (s.status='approved' AND :role=json_extract(s.rules_json,'$.issueRole'))
 OR (s.status='issued' AND :role IN ('ผู้แจ้ง','เจ้าหน้าที่พัสดุ'))
), scoped_feed AS (
 SELECT * FROM feed f WHERE :scopeAccount IS NULL
 OR (f.entity='asset' AND EXISTS(SELECT 1 FROM assets a WHERE a.id=f.entityId AND a.numbering_account_id=:scopeAccount AND (:scopeBranch IS NULL OR a.branch_id=:scopeBranch)))
 OR (f.entity='ticket' AND EXISTS(SELECT 1 FROM tickets t JOIN assets a ON a.id=t.asset_id WHERE t.id=f.entityId AND a.numbering_account_id=:scopeAccount AND (:scopeBranch IS NULL OR a.branch_id=:scopeBranch)))
 OR (f.entity='work' AND EXISTS(SELECT 1 FROM scheduled_work w JOIN assets a ON a.id=w.asset_id WHERE w.id=f.entityId AND a.numbering_account_id=:scopeAccount AND (:scopeBranch IS NULL OR a.branch_id=:scopeBranch)))
 OR (f.entity='supply' AND EXISTS(SELECT 1 FROM supply_documents s WHERE s.id=f.entityId AND s.account_id=:scopeAccount AND (:scopeBranch IS NULL OR s.branch_id=:scopeBranch)))
), inbox AS (
 SELECT feed.*,r.read_at AS readAt FROM scoped_feed feed LEFT JOIN notification_reads r
 ON r.recipient_role=:recipient AND r.notification_key=feed.key
)
"""


def parameters(db, recipient):
    now = datetime.now(TZ)
    ctx=getattr(db,'access',None)
    identity=(str(ctx['user']['id'])+':'+str(ctx['accountId'])+':'+str(ctx['branchId'])+':'+recipient) if ctx else recipient
    return {'scopeAccount':ctx['accountId'] if ctx else None,'scopeBranch':ctx['branchId'] if ctx else None,'recipient':identity,'role': recipient, 'today': now.date().isoformat(),
            'upcoming': (now.date()+timedelta(days=settings(db)['reminderDays'])).isoformat(),
            'cutoff': (now-timedelta(days=30)).isoformat()}


def inbox(db, query):
    recipient = role(one(query, 'role'))
    try:
        limit = max(1, min(100, int(one(query, 'limit', '25'))))
        offset = min(1_000_000_000, max(0, int(one(query, 'offset', '0'))))
    except (TypeError, ValueError):
        raise NotificationError('จำนวนรายการหรือหน้าไม่ถูกต้อง')
    category = one(query, 'category')
    if category not in ('', 'approval', 'repair', 'work', 'asset', 'supply'):
        raise NotificationError('ประเภทแจ้งเตือนไม่ถูกต้อง')
    params = parameters(db, recipient)
    params.update(limit=limit, offset=offset, category=category)
    where = ' WHERE (:category=\'\' OR category=:category)'
    if one(query, 'onlyUnread') == '1':
        where += ' AND readAt IS NULL'
    # Keep total, unread badge, and page items in the same SQLite snapshot.
    db.execute('BEGIN')
    try:
        summary = db.execute(FEED+'SELECT COUNT(*) AS total,COALESCE(SUM(readAt IS NULL),0) AS unread FROM inbox', params).fetchone()
        total = db.execute(FEED+'SELECT COUNT(*) FROM inbox'+where, params).fetchone()[0]
        rows = db.execute(FEED+'SELECT * FROM inbox'+where+' ORDER BY priority DESC,datetime(updatedAt) DESC,key LIMIT :limit OFFSET :offset', params).fetchall()
    finally:
        db.commit()
    return {'items': [dict(row) for row in rows], 'total': total, 'allTotal': summary['total'],
            'unreadCount': summary['unread'], 'offset': offset, 'limit': limit,
            'recipientRole': recipient, 'serverTime': stamp(), 'scope': 'authenticated-user' if getattr(db,'access',None) else 'simulated-role'}


def handle(db, method, path, query, body):
    if path == '/api/notifications' and method == 'GET':
        return inbox(db, query)
    if path == '/api/notifications/read' and method == 'POST':
        recipient = role(body.get('actor'))
        keys = body.get('keys', [])
        all_items = body.get('all') is True
        if not isinstance(keys, list) or len(keys)>100 or any(not isinstance(k,str) or not re.fullmatch(r'(ticket|asset|work):[0-9]+:[0-9]+(?::(?:assigned|due|overdue|followup))?',k) for k in keys):
            raise NotificationError('รายการแจ้งเตือนไม่ถูกต้อง')
        if not all_items and not keys:
            raise NotificationError('กรุณาเลือกแจ้งเตือนที่จะทำเครื่องหมายว่าอ่านแล้ว')
        db.execute('BEGIN IMMEDIATE')
        params = parameters(db, recipient)
        params['readAt'] = stamp()
        where = '' if all_items else ' WHERE key IN ('+','.join(':key'+str(i) for i in range(len(keys)))+')'
        params.update({'key'+str(i): k for i,k in enumerate(keys)})
        db.execute(FEED+'INSERT OR IGNORE INTO notification_reads(recipient_role,notification_key,read_at) SELECT :recipient,key,:readAt FROM inbox'+where,params)
        return {'ok': True, 'marked': db.execute('SELECT changes()').fetchone()[0]}
    if path == '/api/workflow/settings':
        if method == 'GET':
            return settings(db)
        if method == 'PUT':
            if role(body.get('actor')) != OFFICER:
                raise NotificationError('การตั้งค่าใช้บทบาทเจ้าหน้าที่พัสดุในโหมดทดสอบ',403)
            if isinstance(body.get('approvalThreshold'),bool):
                raise NotificationError('วงเงินส่งอนุมัติต้องเป็นจำนวนเงิน')
            try:
                threshold = float(body.get('approvalThreshold'))
            except (ValueError, TypeError):
                raise NotificationError('วงเงินส่งอนุมัติไม่ถูกต้อง')
            days = body.get('reminderDays')
            if not math.isfinite(threshold) or not 0<=threshold<=1_000_000_000 or type(days) is not int or not 0<=days<=30:
                raise NotificationError('วงเงินต้องอยู่ระหว่าง 0–1,000,000,000 บาท และวันแจ้งเตือน 0–30 วัน')
            db.execute('BEGIN IMMEDIATE')
            before = settings(db)
            if type(body.get('revision')) is not int or body['revision'] != before['revision']:
                raise NotificationError('มีผู้แก้ไขการตั้งค่าแล้ว กรุณาโหลดค่าล่าสุดก่อนบันทึก',409)
            db.execute('UPDATE workflow_settings SET approval_threshold=?,reminder_days=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=1',
                       (round(threshold,2),days,stamp(),OFFICER))
            after = settings(db)
            db.execute('INSERT INTO workflow_settings_events(actor,before_json,after_json,created_at) VALUES(?,?,?,?)',
                       (OFFICER,json.dumps(before,ensure_ascii=False),json.dumps(after,ensure_ascii=False),stamp()))
            return after
    return None
