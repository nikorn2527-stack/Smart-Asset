"""Persistent PM / inventory planning, assignment, and restart-safe due generation."""
from datetime import date, datetime, timedelta, timezone
import json
import re
import calendar

TZ = timezone(timedelta(hours=7))
OFFICER = 'เจ้าหน้าที่พัสดุ'
TECH = 'ช่าง'

class WorkError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status

def today():
    return datetime.now(TZ).date()

def stamp():
    return datetime.now(TZ).isoformat(timespec='seconds')

def advance_due(plan, due):
    unit, count = plan['schedule_unit'], plan['interval_count']
    if unit != 'month':
        return due + timedelta(days=count * (7 if unit == 'week' else 1))
    ordinal = due.year * 12 + due.month - 1 + count
    year, month = ordinal // 12, ordinal % 12 + 1
    day = min(plan['anchor_day'] or due.day, calendar.monthrange(year,month)[1])
    return date(year,month,day)

def text(value, label, limit=300):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise WorkError(f'{label}ไม่ถูกต้อง หรือยาวเกิน {limit} ตัวอักษร')
    return value.strip()

def date_value(value):
    try:
        return date.fromisoformat(value).isoformat()
    except (ValueError, TypeError):
        raise WorkError('วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD')

def role(body, allowed=(OFFICER,)):
    if body.get('actor') not in allowed:
        raise WorkError('เลือกบทบาทเจ้าหน้าที่พัสดุ' + ('หรือช่าง' if TECH in allowed else '') + 'เพื่อดำเนินการในโหมดทดสอบ', 403)
    return body['actor']

def event(db, plan_id, actor, action, note='', work_id=None):
    db.execute('INSERT INTO work_events(work_id,plan_id,actor,action,note,created_at) VALUES(?,?,?,?,?,?)',
               (work_id, plan_id, actor, action, note, stamp()))

def generate_round(db, plan, due_on, actor):
    names = json.loads(plan['assignees_json'])
    workload = {name: db.execute("SELECT COUNT(*) FROM scheduled_work WHERE assignee=? AND status<>'completed'", (name,)).fetchone()[0] for name in names}
    count = 0
    for asset in db.execute('SELECT asset_id FROM work_plan_assets WHERE plan_id=? ORDER BY asset_id', (plan['id'],)).fetchall():
        assignee = min(names, key=lambda name: (workload[name], names.index(name))) if plan['assignment_mode'] == 'auto' else names[0]
        cur = db.execute('INSERT OR IGNORE INTO scheduled_work(plan_id,asset_id,due_on,assignee,checklist_json) VALUES(?,?,?,?,?)',
                         (plan['id'], asset[0], due_on, assignee, plan['checklist_json']))
        if cur.rowcount:
            workload[assignee] += 1
            count += 1
    if count:
        event(db, plan['id'], actor, 'สร้างรอบงาน', f'{due_on}: {count} รายการ')
    return count

def generate_due(db, current=None):
    """Caller owns transaction; uniqueness and atomic cursor movement make retries safe."""
    current = current or today()
    total = 0
    plans = db.execute("SELECT * FROM work_plans WHERE is_active=1 AND schedule_mode='auto' AND next_due<=? ORDER BY id", (current.isoformat(),)).fetchall()
    for plan in plans:
        due = date.fromisoformat(plan['next_due'])
        # Limit catch-up work per tick, preserving missed rounds for subsequent ticks.
        for _ in range(30):
            if due > current:
                break
            total += generate_round(db, plan, due.isoformat(), 'ระบบอัตโนมัติ')
            due = advance_due(plan,due)
        db.execute('UPDATE work_plans SET next_due=? WHERE id=?', (due.isoformat(), plan['id']))
    return total

def plan_dict(db, row):
    item = dict(row)
    item['assignees'] = json.loads(item.pop('assignees_json'))
    item['checklist'] = json.loads(item.pop('checklist_json'))
    item['assetIds'] = [r[0] for r in db.execute('SELECT asset_id FROM work_plan_assets WHERE plan_id=? ORDER BY asset_id', (row['id'],))]
    return item

def work_dict(row):
    item = dict(row)
    item['checklist'] = json.loads(item.pop('checklist_json'))
    item['checks'] = json.loads(item.pop('checks_json'))
    item['overdue'] = item['status'] != 'completed' and item['due_on'] < today().isoformat()
    return item

def handle(db, method, path, query, body):
    if not path.startswith('/api/work/'):
        return None
    if path == '/api/work/plans' and method == 'GET':
        return [plan_dict(db,p) for p in db.execute('SELECT * FROM work_plans ORDER BY id DESC')]
    if path == '/api/work/plans' and method == 'POST':
        actor = role(body)
        name = text(body.get('name'), 'ชื่อแผน')
        kind = body.get('kind')
        schedule = body.get('scheduleMode')
        assignment = body.get('assignmentMode')
        if kind not in ('pm','inventory') or schedule not in ('manual','auto') or assignment not in ('manual','auto'):
            raise WorkError('ประเภทแผนหรือรูปแบบการทำงานไม่ถูกต้อง')
        raw_names = body.get('assignees')
        if not isinstance(raw_names, list) or not 1 <= len(raw_names) <= 30:
            raise WorkError('ระบุผู้รับผิดชอบ 1–30 คน')
        names = list(dict.fromkeys(text(n,'ชื่อผู้รับผิดชอบ',160) for n in raw_names))
        if assignment == 'manual' and len(names) != 1:
            raise WorkError('มอบหมายเองต้องเลือกผู้รับผิดชอบ 1 คน')
        checks = body.get('checklist', [])
        if not isinstance(checks,list) or len(checks)>30:
            raise WorkError('รายการตรวจต้องมีไม่เกิน 30 ข้อ')
        checks = list(dict.fromkeys(text(c,'รายการตรวจ',200) for c in checks))
        if kind == 'pm' and not checks:
            raise WorkError('งาน PM ต้องมีรายการตรวจอย่างน้อย 1 ข้อ')
        unit = body.get('scheduleUnit','day')
        if unit not in ('day','week','month'):
            raise WorkError('ความถี่ต้องเป็นวัน สัปดาห์ หรือเดือน')
        try:
            count = int(body.get('intervalCount',body.get('intervalDays',30)))
        except (TypeError,ValueError):
            raise WorkError('จำนวนรอบไม่ถูกต้อง')
        if not 1 <= count <= {'day':3650,'week':520,'month':120}[unit]:
            raise WorkError('ระยะห่างรอบเกินช่วงที่รองรับ')
        interval = count * {'day':1,'week':7,'month':30}[unit]
        due = date_value(body.get('dueOn'))
        ids = body.get('assetIds')
        if not isinstance(ids,list) or not 1 <= len(ids) <= 500 or any(type(i) is not int or i <= 0 for i in ids):
            raise WorkError('เลือกครุภัณฑ์ 1–500 รายการ')
        ids = list(dict.fromkeys(ids))
        db.execute('BEGIN IMMEDIATE')
        if db.execute('SELECT COUNT(*) FROM assets WHERE id IN ('+','.join('?' for _ in ids)+')',ids).fetchone()[0] != len(ids):
            raise WorkError('มีครุภัณฑ์ที่ไม่พบในทะเบียน')
        cur = db.execute('INSERT INTO work_plans(kind,name,schedule_mode,interval_days,schedule_unit,interval_count,anchor_day,next_due,assignment_mode,assignees_json,checklist_json,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (kind,name,schedule,interval,unit,count,date.fromisoformat(due).day,due,assignment,json.dumps(names,ensure_ascii=False),json.dumps(checks,ensure_ascii=False),stamp(),actor))
        pid = cur.lastrowid
        db.executemany('INSERT INTO work_plan_assets(plan_id,asset_id) VALUES(?,?)', [(pid,i) for i in ids])
        event(db,pid,actor,'สร้างแผน',name)
        plan = db.execute('SELECT * FROM work_plans WHERE id=?',(pid,)).fetchone()
        if schedule == 'manual':
            generate_round(db,plan,due,actor)
        else:
            generate_due(db)
        return plan_dict(db,db.execute('SELECT * FROM work_plans WHERE id=?',(pid,)).fetchone()),201
    match = re.fullmatch(r'/api/work/plans/(\d+)/(generate|active)',path)
    if match and method == 'POST':
        actor = role(body)
        db.execute('BEGIN IMMEDIATE')
        plan = db.execute('SELECT * FROM work_plans WHERE id=?',(int(match[1]),)).fetchone()
        if plan is None:
            raise WorkError('ไม่พบแผน',404)
        if match[2] == 'active':
            if type(body.get('isActive')) is not bool:
                raise WorkError('สถานะแผนไม่ถูกต้อง')
            db.execute('UPDATE work_plans SET is_active=? WHERE id=?',(int(body['isActive']),plan['id']))
            event(db,plan['id'],actor,'เปิดแผน' if body['isActive'] else 'พักแผน')
            return {'ok':True}
        if not plan['is_active'] or plan['schedule_mode'] != 'manual':
            raise WorkError('สร้างรอบเองได้เฉพาะแผนมอบหมายตามรอบเองที่เปิดใช้งาน')
        due = date_value(body.get('dueOn'))
        return {'created':generate_round(db,plan,due,actor)}
    if path == '/api/work/items' and method == 'GET':
        where, args = [], []
        for key,column in [('kind','p.kind'),('assignee','w.assignee'),('status','w.status'),('planId','p.id'),('dueOn','w.due_on')]:
            value = query.get(key,[''])[0]
            if value:
                where.append(column+'=?');args.append(value)
        rows = db.execute('SELECT w.*,p.kind,p.name AS plan_name,a.code,a.name AS asset_name,a.location FROM scheduled_work w JOIN work_plans p ON p.id=w.plan_id JOIN assets a ON a.id=w.asset_id'+(' WHERE '+' AND '.join(where) if where else '')+' ORDER BY w.due_on,w.id',args).fetchall()
        items=[work_dict(r) for r in rows]
        summaries={}
        for w in items:
            s=summaries.setdefault(w['assignee'],{'assignee':w['assignee'],'total':0,'completed':0,'overdue':0,'found':0,'notFound':0,'needsRepair':0})
            s['total']+=1;s['completed']+=int(w['status']=='completed');s['overdue']+=int(w['overdue'])
            s['found']+=int(w['result'] in ('found','moved','damaged'));s['notFound']+=int(w['result']=='not_found');s['needsRepair']+=int(w['result'] in ('needs_repair','damaged'))
        return {'items':items,'summary':list(summaries.values()),'total':len(items)}
    match=re.fullmatch(r'/api/work/items/(\d+)/(start|assign|complete)',path)
    if match and method=='POST':
        actor=role(body,(OFFICER,TECH) if match[2]!='assign' else (OFFICER,))
        db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT w.*,p.kind FROM scheduled_work w JOIN work_plans p ON p.id=w.plan_id WHERE w.id=?',(int(match[1]),)).fetchone()
        if row is None:
            raise WorkError('ไม่พบงาน',404)
        if row['status']=='completed':
            raise WorkError('งานนี้บันทึกผลเสร็จแล้ว',409)
        if match[2]=='assign':
            assigned=text(body.get('assignee'),'ชื่อผู้รับผิดชอบ',160)
            db.execute('UPDATE scheduled_work SET assignee=? WHERE id=?',(assigned,row['id']))
            event(db,row['plan_id'],actor,'เปลี่ยนผู้รับผิดชอบ',f"{row['assignee']} → {assigned}",row['id'])
        elif match[2]=='start':
            if row['status']!='pending':
                raise WorkError('เริ่มงานนี้ไปแล้ว',409)
            db.execute("UPDATE scheduled_work SET status='in_progress' WHERE id=?",(row['id'],))
            event(db,row['plan_id'],actor,'เริ่มงาน',work_id=row['id'])
        else:
            result=body.get('result')
            allowed=('normal','needs_repair') if row['kind']=='pm' else ('found','not_found','moved','damaged')
            if result not in allowed:
                raise WorkError('ผลตรวจไม่ถูกต้อง')
            notes=body.get('note','')
            if not isinstance(notes,str) or len(notes)>3000:
                raise WorkError('หมายเหตุยาวเกิน 3000 ตัวอักษร')
            if result in ('needs_repair','not_found','moved','damaged') and not notes.strip():
                raise WorkError('กรุณาระบุรายละเอียดของผลตรวจ')
            observed=body.get('observedLocation','')
            if not isinstance(observed,str) or len(observed)>300 or (result=='moved' and not observed.strip()):
                raise WorkError('กรุณาระบุสถานที่ที่พบให้ถูกต้อง')
            expected=json.loads(row['checklist_json'])
            checks=body.get('checks',[])
            if row['kind']=='pm' and (not isinstance(checks,list) or len(checks)!=len(expected) or any(type(c) is not bool for c in checks) or not all(checks)):
                raise WorkError('กรุณาตรวจครบทุกหัวข้อก่อนบันทึกผล PM')
            if row['kind']!='pm':checks=[]
            db.execute("UPDATE scheduled_work SET status='completed',result=?,note=?,observed_location=?,checks_json=?,completed_at=?,completed_by=? WHERE id=?",(result,notes.strip(),observed.strip(),json.dumps(checks),stamp(),row['assignee'],row['id']))
            event(db,row['plan_id'],actor,'บันทึกผลตรวจ',result+': '+notes.strip(),row['id'])
        return {'ok':True}
    raise WorkError('ไม่พบคำสั่งงานตามรอบ',404)
