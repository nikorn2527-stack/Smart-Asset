"""Workflow notifications must follow authoritative state and survive reads."""
from datetime import timedelta
from urllib.parse import urlencode
import sqlite3

from test_smart_workflow import HTTPFixture, OFFICER, APPROVER, TECH
from work_api import today


class Notifications(HTTPFixture):
    def setUp(self):
        self.before = self.call('/api/workflow/settings')

    def tearDown(self):
        current = self.call('/api/workflow/settings')
        if any(current[k] != self.before[k] for k in ('approvalThreshold','reminderDays')):
            self.call('/api/workflow/settings',{**self.before,'revision':current['revision'],'actor':OFFICER},method='PUT')

    def inbox(self, role, **filters):
        return self.call('/api/notifications?'+urlencode({'role':role,**filters}))

    def entry(self, role, entity, identifier):
        return next((n for n in self.inbox(role,limit=100)['items'] if n['entity']==entity and n['entityId']==identifier),None)

    def ticket(self, code):
        aid=self.asset(code)
        return self.call('/api/tickets',{'assetId':aid,'assetName':'ทดสอบ','location':'ห้องทดสอบ','issue':'เปิดไม่ติด','requester':'ผู้ทดสอบ','contact':'private-contact'},expected=201)

    def test_approval_read_does_not_approve_and_new_stage_is_unread(self):
        ticket=self.ticket('NOTIFY-APPROVAL');tid=ticket['id']
        self.assertIsNotNone(self.entry(OFFICER,'ticket',tid))
        self.action(tid,'review',OFFICER,estimateCost=6000)
        self.assertIsNone(self.entry(OFFICER,'ticket',tid))
        first=self.entry(APPROVER,'ticket',tid)
        self.assertEqual(first['category'],'approval')
        self.call('/api/notifications/read',{'actor':APPROVER,'keys':[first['key']]})
        self.assertIsNotNone(self.entry(APPROVER,'ticket',tid)['readAt'])
        self.assertEqual(self.call(f'/api/tickets/{tid}')['status'],'รออนุมัติ')
        self.assertEqual(self.call('/api/notifications/read',{'actor':OFFICER,'keys':[first['key']]})['marked'],0)
        self.action(tid,'approve',APPROVER)
        self.assertIsNone(self.entry(APPROVER,'ticket',tid))
        self.action(tid,'assign',OFFICER,assignedTo='ช่าง ก')
        self.assertEqual(self.entry(TECH,'ticket',tid)['assignee'],'ช่าง ก')
        self.action(tid,'complete',TECH,workNotes='ซ่อมแล้ว',actualCost=7000)
        second=self.entry(APPROVER,'ticket',tid)
        self.assertNotEqual(first['key'],second['key'])
        self.assertIsNone(second['readAt'])
        self.action(tid,'approve_final_cost',APPROVER)
        self.assertIsNone(self.entry(APPROVER,'ticket',tid))
        self.assertIn('ตรวจรับ',self.entry('ผู้แจ้ง','ticket',tid)['title'])
        self.action(tid,'send_back','ผู้แจ้ง',note='ยังมีอาการ')
        self.assertIn('ส่งกลับ',self.entry(TECH,'ticket',tid)['title'])

    def test_asset_approval_and_read_markers_survive_new_connections(self):
        aid=self.asset('NOTIFY-ASSET')
        entry=self.entry(APPROVER,'asset',aid)
        self.assertIsNotNone(entry)
        self.call('/api/notifications/read',{'actor':APPROVER,'keys':[entry['key']]})
        self.assertIsNotNone(self.entry(APPROVER,'asset',aid)['readAt'])
        self.call(f'/api/assets/{aid}/action',{'actor':APPROVER,'action':'approve'})
        self.assertIsNone(self.entry(APPROVER,'asset',aid))
        self.assertIsNotNone(self.entry(OFFICER,'asset',aid))

    def test_overdue_work_and_completion_handoff(self):
        plan=self.call('/api/work/plans',{'actor':OFFICER,'name':'ตรวจนับทดสอบแจ้งเตือน','kind':'inventory','scheduleMode':'manual','intervalDays':30,'dueOn':(today()-timedelta(days=1)).isoformat(),'assignmentMode':'manual','assignees':['ผู้ตรวจ ก'],'checklist':[],'assetIds':[1]},expected=201)
        work=self.call('/api/work/items?planId='+str(plan['id']))['items'][0]
        entry=self.entry(TECH,'work',work['id'])
        self.assertIn('เกินกำหนด',entry['title'])
        self.call('/api/notifications/read',{'actor':TECH,'keys':[entry['key']]})
        self.call(f'/api/work/items/{work["id"]}/assign',{'actor':OFFICER,'assignee':'ผู้ตรวจ ข'})
        self.assertIsNone(self.entry(TECH,'work',work['id'])['readAt'])
        self.assertEqual(self.call(f'/api/work/items/{work["id"]}')['assignee'],'ผู้ตรวจ ข')
        self.call(f'/api/work/items/{work["id"]}/complete',{'actor':OFFICER,'result':'damaged','checks':[],'note':'พบชำรุด'})
        self.assertIsNone(self.entry(TECH,'work',work['id']))
        self.assertIn('ติดตาม',self.entry(OFFICER,'work',work['id'])['title'])

    def test_configuration_revision_and_threshold_snapshot(self):
        before=self.call('/api/workflow/settings')
        self.call('/api/workflow/settings',{**before,'actor':TECH},method='PUT',expected=403)
        self.call('/api/workflow/settings',{**before,'reminderDays':31,'actor':OFFICER},method='PUT',expected=400)
        saved=self.call('/api/workflow/settings',{**before,'approvalThreshold':5000,'reminderDays':5,'actor':OFFICER},method='PUT')
        self.call('/api/workflow/settings',{**before,'actor':OFFICER},method='PUT',expected=409)
        ticket=self.ticket('NOTIFY-SNAPSHOT');tid=ticket['id']
        self.action(tid,'review',OFFICER,estimateCost=4000)
        self.assertEqual(self.call(f'/api/tickets/{tid}')['approvalThreshold'],5000)
        self.call('/api/workflow/settings',{**saved,'approvalThreshold':10000,'actor':OFFICER},method='PUT')
        self.action(tid,'assign',OFFICER,assignedTo='ช่าง ก')
        result=self.action(tid,'complete',TECH,workNotes='ซ่อมแล้ว',actualCost=6000)
        self.assertEqual(result['status'],'รออนุมัติค่าใช้จ่ายจริง')
        self.assertEqual(self.call('/api/config')['approvalThreshold'],10000)
        with sqlite3.connect(self.db) as db:
            self.assertGreater(db.execute('SELECT COUNT(*) FROM workflow_settings_events').fetchone()[0],0)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_validation_pagination_and_mark_all_are_role_scoped(self):
        self.call('/api/notifications?role=unknown',expected=403)
        self.call('/api/notifications/read',{'actor':TECH,'keys':['invalid-key']},expected=400)
        self.call('/api/notifications/read',{'actor':APPROVER,'all':True})
        self.assertEqual(self.inbox(APPROVER,onlyUnread=1)['total'],0)
        fresh=self.asset('NOTIFY-AFTER-READ-ALL')
        self.assertIsNone(self.entry(APPROVER,'asset',fresh)['readAt'])
        page=self.inbox(APPROVER,limit=1)
        self.assertEqual(len(page['items']),1)
        self.assertGreaterEqual(page['total'],1)
        self.assertEqual(self.inbox(APPROVER,category='work')['total'],0)
        self.assertNotIn('private-contact',str(self.inbox('ผู้แจ้ง')))

    def test_pending_acceptance_never_expires_from_requester_inbox(self):
        ticket=self.ticket('NOTIFY-OLD-ACCEPTANCE');tid=ticket['id']
        self.action(tid,'review',OFFICER,estimateCost=0)
        self.action(tid,'assign',OFFICER,assignedTo='ช่าง ก')
        self.action(tid,'complete',TECH,workNotes='ซ่อมแล้ว',actualCost=0)
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE tickets SET updated_at='2020-01-01T00:00:00+07:00' WHERE id=?",(tid,))
        self.assertIn('ตรวจรับ',self.entry('ผู้แจ้ง','ticket',tid)['title'])
