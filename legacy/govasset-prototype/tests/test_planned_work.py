import json
import sqlite3
import time
from datetime import date, timedelta
import test_smart_workflow as fixture
from work_api import today, advance_due


class PlannedWork(fixture.HTTPFixture):
    def create_plan(self, **overrides):
        data={'name':'แผนทดสอบ','kind':'pm','scheduleMode':'manual','intervalDays':30,'dueOn':today().isoformat(),'assignmentMode':'manual','assignees':['ช่างทดสอบ'],'checklist':['ตรวจสภาพ','ทดสอบการทำงาน'],'assetIds':[1,2,3,4],'actor':fixture.OFFICER}
        data.update(overrides)
        return self.call('/api/work/plans',data,expected=201)

    def items(self,plan):
        return self.call('/api/work/items?planId='+str(plan['id']))

    def work_action(self,w,action,**values):
        return self.call(f'/api/work/items/{w["id"]}/{action}',{'actor':fixture.OFFICER,**values})

    def test_manual_round_is_idempotent_and_reassignable(self):
        p=self.create_plan()
        self.assertEqual(self.items(p)['total'],4)
        r=self.call(f'/api/work/plans/{p["id"]}/generate',{'actor':fixture.OFFICER,'dueOn':p['next_due']})
        self.assertEqual(r['created'],0)
        w=self.items(p)['items'][0]
        self.work_action(w,'assign',assignee='ช่างที่ได้รับมอบหมายใหม่')
        filtered=self.call('/api/work/items?planId='+str(p['id'])+'&assignee='+__import__('urllib.parse',fromlist=['quote']).quote('ช่างที่ได้รับมอบหมายใหม่'))
        self.assertEqual(filtered['total'],1)
        self.work_action(w,'start')
        self.assertEqual(self.items(p)['items'][0]['status'],'in_progress')
        self.call(f'/api/work/plans/{p["id"]}/active',{'actor':fixture.OFFICER,'isActive':False})
        self.call(f'/api/work/plans/{p["id"]}/generate',{'actor':fixture.OFFICER,'dueOn':today().isoformat()},expected=400)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM work_events WHERE work_id=? AND action='เปลี่ยนผู้รับผิดชอบ'",(w['id'],)).fetchone()[0],1)

    def test_inventory_results_count_by_assignee(self):
        p=self.create_plan(kind='inventory',checklist=[],assignees=['ผู้ตรวจนับ'])
        rows=self.items(p)['items']
        self.work_action(rows[0],'complete',result='found',note='',checks=[])
        self.call(f'/api/work/items/{rows[1]["id"]}/complete',{'actor':fixture.OFFICER,'result':'not_found'},expected=400)
        self.work_action(rows[1],'complete',result='not_found',note='ตรวจทุกห้องแล้วไม่พบ')
        self.work_action(rows[2],'complete',result='moved',note='ย้ายไปห้อง B',observedLocation='ห้อง B')
        summary=self.items(p)['summary'][0]
        self.assertEqual((summary['total'],summary['completed'],summary['found'],summary['notFound']),(4,3,2,1))
        self.call(f'/api/work/items/{rows[0]["id"]}/complete',{'actor':fixture.OFFICER,'result':'found'},expected=409)
        self.assertEqual(self.items(p)['items'][2]['observed_location'],'ห้อง B')

    def test_pm_checklist_and_repair_handoff(self):
        p=self.create_plan(assetIds=[1])
        w=self.items(p)['items'][0]
        self.call(f'/api/work/items/{w["id"]}/complete',{'actor':fixture.TECH,'result':'normal','checks':[True,False]},expected=400)
        self.work_action(w,'complete',result='needs_repair',checks=[True,True],note='พบสายไฟชำรุด')
        body={'scheduledWorkId':w['id'],'assetId':1,'assetName':w['asset_name'],'assetCode':w['code'],'location':'ห้องทดสอบ','issue':'พบสายไฟชำรุด','requester':w['assignee']}
        t=self.call('/api/tickets',body,expected=201)
        retry=self.call('/api/tickets',body)
        self.assertEqual(t['id'],retry['id'])
        self.assertEqual(self.items(p)['items'][0]['repair_ticket_id'],t['id'])
        self.assertEqual(self.items(p)['summary'][0]['needsRepair'],1)

    def test_auto_scheduler_runs_without_browser_and_balances_work(self):
        p=self.create_plan(scheduleMode='auto',assignmentMode='auto',assignees=['AUTO-A','AUTO-B'],dueOn=(today()+timedelta(days=1)).isoformat(),intervalDays=7)
        self.assertEqual(self.items(p)['total'],0)
        with sqlite3.connect(self.db) as db:
            db.execute('UPDATE work_plans SET next_due=? WHERE id=?',((today()-timedelta(days=1)).isoformat(),p['id']))
        # No requests are needed for generation: the server's scheduler polls the DB.
        time.sleep(2.2)
        data=self.items(p)
        self.assertEqual(data['total'],4)
        self.assertEqual(sorted(s['total'] for s in data['summary']),[2,2])
        self.assertTrue(all(w['overdue'] for w in data['items']))
        time.sleep(1.2)
        self.assertEqual(self.items(p)['total'],4)
        scheduler=self.call('/api/work/status')
        self.assertTrue(scheduler['running'])
        self.assertIsNone(scheduler['lastError'])

    def test_invalid_plans_and_roles(self):
        bad={'kind':'pm','name':'แผน','assetIds':[1],'scheduleMode':'manual','assignmentMode':'manual','dueOn':today().isoformat(),'assignees':['A'],'checklist':[],'actor':fixture.OFFICER}
        self.call('/api/work/plans',bad,expected=400)
        self.call('/api/work/plans',{**bad,'checklist':['ตรวจ'],'actor':fixture.TECH},expected=403)
        self.call('/api/work/plans',{**bad,'checklist':['ตรวจ'],'assetIds':[999999]},expected=400)

    def test_calendar_daily_weekly_monthly_and_custom_frequency(self):
        monthly={'schedule_unit':'month','interval_count':1,'anchor_day':31}
        self.assertEqual(advance_due(monthly,date(2027,1,31)),date(2027,2,28))
        self.assertEqual(advance_due(monthly,date(2027,2,28)),date(2027,3,31))
        self.assertEqual(advance_due(monthly,date(2028,1,31)),date(2028,2,29))
        self.assertEqual(advance_due({**monthly,'interval_count':3},date(2027,1,31)),date(2027,4,30))
        self.assertEqual(advance_due({'schedule_unit':'week','interval_count':2},date(2026,12,25)),date(2027,1,8))
        self.assertEqual(advance_due({'schedule_unit':'day','interval_count':1},date(2026,12,31)),date(2027,1,1))
        plan=self.create_plan(scheduleMode='auto',scheduleUnit='month',intervalCount=2,dueOn='2027-01-31',assetIds=[1])
        self.assertEqual((plan['schedule_unit'],plan['interval_count'],plan['anchor_day']),('month',2,31))

    def test_register_form_versioned_and_separate_from_asset(self):
        aid=self.asset('FORM-001')
        url=f'/api/assets/{aid}/register-form'
        self.assertEqual(self.call(url),{'form':None,'revision':0})
        form={'fields':{'organization':'หน่วยงานทดสอบ','code':'เอกสาร-001'},'rows':[{'quantity':'1','unitPrice':'100.00','total':'100.00','description':'รายการทดสอบ'}]}
        saved=self.call(url,{'form':form,'revision':0,'actor':fixture.OFFICER},method='PUT')
        self.assertEqual(saved['revision'],1)
        self.assertEqual(self.call(url)['form']['fields']['code'],'เอกสาร-001')
        self.assertEqual(self.smart(aid)['asset']['code'],'FORM-001')
        self.call(url,{'form':form,'revision':0,'actor':fixture.OFFICER},method='PUT',expected=409)
        self.call(url,{'form':form,'revision':1,'actor':fixture.TECH},method='PUT',expected=403)
        form['rows'][0]['total']='NaN'
        self.call(url,{'form':form,'revision':1,'actor':fixture.OFFICER},method='PUT',expected=400)
        self.assertEqual(self.call(url)['revision'],1)
        form['rows'][0].update(total='100.00',annual='50',accumulated='100',net='900')
        form['rows'].append({'annual':'50','accumulated':'150','net':'850'})
        self.call(url,{'form':form,'revision':1,'actor':fixture.OFFICER},method='PUT')
        # Cumulative depreciation and closing net value must never be summed across years.
        self.assertEqual(self.call(url)['form']['summary'],{'annual':'50','accumulated':'150','net':'850'})
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
