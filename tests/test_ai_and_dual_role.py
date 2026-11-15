"""Dual-role, cross-org/branch isolation, AI assistant, LIKE-escaping, and edge-case tests."""
import json
import sqlite3
import uuid
from urllib.error import HTTPError
from urllib.request import Request

from test_access_control import Client
from test_smart_workflow import HTTPFixture, OFFICER


class AiAndDualRoleTests(HTTPFixture):
    auth_required = "1"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = Client(cls.base)
        cls.admin.call(
            "/api/auth/setup",
            {"username": "dual.admin", "name": "ผู้ดูแลทดสอบ", "password": "Test-only-pass-2026"},
        )

    def setUp(self):
        self.admin.call("/api/auth/scope", {"accountId": None, "branchId": None, "actor": OFFICER})
        self.aid_a = self.admin.call(
            "/api/governance/accounts", {"name": "องค์กร เอ", "code": uuid.uuid4().hex}, expected=201
        )["id"]
        self.aid_b = self.admin.call(
            "/api/governance/accounts", {"name": "องค์กร บี", "code": uuid.uuid4().hex}, expected=201
        )["id"]
        self.bid_1 = self.admin.call(
            "/api/governance/branches", {"accountId": self.aid_a, "name": "สาขา 1", "code": "B1"}, expected=201
        )["id"]
        self.bid_2 = self.admin.call(
            "/api/governance/branches", {"accountId": self.aid_a, "name": "สาขา 2", "code": "B2"}, expected=201
        )["id"]
        self.cid = self.admin.call("/api/catalog/categories")[0]["id"]

        with sqlite3.connect(self.db) as db:
            self.asset_a1 = db.execute(
                "INSERT INTO assets(name,code,group_name,location,category_id,created_at,numbering_account_id,branch_id,status,purchase_price) "
                "VALUES(?,?,'กลุ่ม','ห้อง 101',?,'2026-10-18',?,?,'พร้อมใช้',10000)",
                ("เครื่องวัด 100% รุ่น A_1", uuid.uuid4().hex, self.cid, self.aid_a, self.bid_1),
            ).lastrowid
            self.asset_a1_plain = db.execute(
                "INSERT INTO assets(name,code,group_name,location,category_id,created_at,numbering_account_id,branch_id,status,purchase_price) "
                "VALUES(?,?,'กลุ่ม','ห้อง 102',?,'2026-10-18',?,?,'พร้อมใช้',5000)",
                ("เครื่องวัด 200 รุ่น B1", uuid.uuid4().hex, self.cid, self.aid_a, self.bid_1),
            ).lastrowid
            self.asset_a2 = db.execute(
                "INSERT INTO assets(name,code,group_name,location,category_id,created_at,numbering_account_id,branch_id,status,purchase_price) "
                "VALUES(?,?,'กลุ่ม','ห้อง 201',?,'2026-10-18',?,?,'พร้อมใช้',20000)",
                ("ของสาขาสอง", uuid.uuid4().hex, self.cid, self.aid_a, self.bid_2),
            ).lastrowid
            self.asset_b = db.execute(
                "INSERT INTO assets(name,code,group_name,location,category_id,created_at,numbering_account_id,branch_id,status,purchase_price) "
                "VALUES(?,?,'กลุ่ม','ห้อง 301',?,'2026-10-18',?,?,'พร้อมใช้',30000)",
                ("ขององค์กรบี", uuid.uuid4().hex, self.cid, self.aid_b, None),
            ).lastrowid

            # Scheduled work: one in A1, one in B, one with asset_id IS NULL (must NOT leak to org-scoped user)
            plan_id = db.execute(
                "INSERT INTO work_plans(kind,name,schedule_mode,interval_days,schedule_unit,interval_count,anchor_day,next_due,assignment_mode,assignees_json,checklist_json,created_at,created_by) "
                "VALUES('pm','แผนทดสอบ','manual',30,'day',30,1,'2026-10-01','manual','[]','[]','2026-10-01','test')"
            ).lastrowid
            db.execute(
                "INSERT INTO scheduled_work(plan_id,asset_id,due_on,status,assignee) VALUES(?,?,'2026-10-05','pending','ช่างเอ')",
                (plan_id, self.asset_a1),
            )
            db.execute(
                "INSERT INTO scheduled_work(plan_id,asset_id,due_on,status,assignee) VALUES(?,?,'2026-10-05','pending','ช่างบี')",
                (plan_id, self.asset_b),
            )
            db.execute(
                "INSERT INTO scheduled_work(plan_id,asset_id,due_on,status,assignee) VALUES(?,?,'2026-10-05','pending','ช่างสาขาสอง')",
                (plan_id, self.asset_a2),
            )

            # Supply documents: one in A/B1, one in A/B2, one in B
            tag = uuid.uuid4().hex[:6]
            self.rc_a1 = f"RC-A1-{tag}"
            db.execute(
                "INSERT INTO supply_documents(account_id,branch_id,kind,number,status,data_json,rules_json,created_at,updated_at) VALUES(?,?,'receipt',?,'draft','{}','{}','2026-10-18','2026-10-18')",
                (self.aid_a, self.bid_1, self.rc_a1),
            )
            db.execute(
                "INSERT INTO supply_documents(account_id,branch_id,kind,number,status,data_json,rules_json,created_at,updated_at) VALUES(?,?,'receipt',?,'draft','{}','{}','2026-10-18','2026-10-18')",
                (self.aid_a, self.bid_2, f"RC-A2-{tag}"),
            )
            db.execute(
                "INSERT INTO supply_documents(account_id,branch_id,kind,number,status,data_json,rules_json,created_at,updated_at) VALUES(?,NULL,'receipt',?,'draft','{}','{}','2026-10-18','2026-10-18')",
                (self.aid_b, f"RC-B1-{tag}"),
            )

            # Tickets: one in A1, one in B
            t_a1 = db.execute(
                "INSERT INTO tickets(ticket_no,asset_id,asset_code,asset_name,location,issue,urgency,status,requester,created_at) VALUES(?,?,?,?,'ห้อง 101',?,'ปกติ','รอตรวจสอบ/ประเมิน','ผู้แจ้ง','2026-10-18')",
                ("TK-" + uuid.uuid4().hex[:6], self.asset_a1, "C-A1", "เครื่องวัด 100%", "เปิดไม่ติด",),
            ).lastrowid
            t_b = db.execute(
                "INSERT INTO tickets(ticket_no,asset_id,asset_code,asset_name,location,issue,urgency,status,requester,created_at) VALUES(?,?,?,?,'ห้อง 301',?,'ปกติ','รอตรวจสอบ/ประเมิน','ผู้แจ้ง','2026-10-18')",
                ("TK-" + uuid.uuid4().hex[:6], self.asset_b, "C-B1", "ขององค์กรบี", "เสีย",),
            ).lastrowid
            db.execute(
                "INSERT INTO ticket_work_items(ticket_id,kind,name,qty,unit,unit_cost,source,status,created_at,updated_at) VALUES(?,'part','อะไหล่เอ',1,'ชิ้น',100,'stock','requested','2026-10-18','2026-10-18')",
                (t_a1,),
            )
            db.execute(
                "INSERT INTO ticket_work_items(ticket_id,kind,name,qty,unit,unit_cost,source,status,created_at,updated_at) VALUES(?,'part','อะไหล่บี',1,'ชิ้น',200,'stock','requested','2026-10-18','2026-10-18')",
                (t_b,),
            )

    def _make_user(self, account_id, branch_id=None, **perms):
        username = "u." + uuid.uuid4().hex[:10]
        self.admin.call(
            "/api/auth/users",
            {
                "username": username,
                "name": "ผู้ใช้ทดสอบ",
                "password": "Test-only-pass-2026",
                "globalRole": "user",
                "memberships": [
                    {
                        "accountId": account_id,
                        "branchId": branch_id,
                        "permissions": {"view": True, **perms},
                    }
                ],
            },
            expected=201,
        )
        c = Client(self.base)
        c.call("/api/auth/login", {"username": username, "password": "Test-only-pass-2026"})
        return c

    def test_unauthenticated_blocked(self):
        anon = Client(self.base)
        anon.call("/api/assistant/capabilities", expected=401)
        anon.call("/api/assistant/query", {"prompt": "สรุปยอดครุภัณฑ์ทั้งหมด"}, expected=401)
        anon.call("/api/reports", expected=401)

    def test_viewer_only_isolated_and_cannot_export_or_mutate(self):
        viewer = self._make_user(self.aid_a, self.bid_1)
        # Summary only counts A/B1 assets (2 items, 15,000 THB)
        res = viewer.call("/api/assistant/query", {"prompt": "สรุปยอดครุภัณฑ์ทั้งหมด"})
        self.assertIn("2 รายการ", res["reply"])
        self.assertIn("15,000.00 บาท", res["reply"])

        # Scheduled work with asset_id IS NULL or org B must NOT leak
        work = viewer.call("/api/assistant/query", {"prompt": "งานตรวจนับและ PM"})
        self.assertIn("ทั้งหมด **1 รายการ**", work["reply"])
        self.assertEqual(len(work["items"]), 1)

        # Supply documents must be scoped to A/B1 only
        supply = viewer.call("/api/assistant/query", {"prompt": "เอกสารรับเข้าและเบิก"})
        self.assertIn("ทั้งหมด **1 ฉบับ**", supply["reply"])
        self.assertEqual([i["code"] for i in supply["items"]], [self.rc_a1])

        # Repairs query "งานซ่อมค้างอยู่กี่งาน" must find the 1 ticket in A/B1 (not 0 and not B's ticket!)
        repairs = viewer.call("/api/assistant/query", {"prompt": "งานซ่อมค้างอยู่กี่งาน"})
        self.assertIn("ทั้งหมด **1 งาน**", repairs["reply"])
        self.assertEqual(len(repairs["items"]), 1)

        # Report query for viewer without export permission must NOT include download links
        rep = viewer.call("/api/assistant/query", {"prompt": "ขอรายงานทะเบียนครุภัณฑ์"})
        self.assertEqual(rep["downloads"], [])
        self.assertIn("2 รายการ", rep["reply"])

        # Direct export & mutation must return 403
        viewer.call("/api/reports/assets/print-data", expected=403)
        viewer.call("/api/assets", {"name": "x"}, expected=403)

    def test_org_manager_can_export_but_blocked_from_global_admin_routes(self):
        mgr = self._make_user(self.aid_a, None, create=True, edit=True, export=True, manage=True)
        rep = mgr.call("/api/assistant/query", {"prompt": "ขอรายงานทะเบียนครุภัณฑ์"})
        self.assertEqual(len(rep["downloads"]), 2)
        # Org manager cannot access global admin routes
        mgr.call("/api/governance/accounts", {"name": "ใหม่", "code": "NEW"}, expected=403)
        mgr.call("/api/backups", expected=403)

    def test_admin_repair_items_report_respects_account_filter(self):
        rep_a = self.admin.call(f"/api/reports/repair-items?accountId={self.aid_a}")
        self.assertEqual(rep_a["total"], 1)
        self.assertEqual(rep_a["rows"][0][4], "อะไหล่เอ")
        rep_b = self.admin.call(f"/api/reports/repair-items?accountId={self.aid_b}")
        self.assertEqual(rep_b["total"], 1)
        self.assertEqual(rep_b["rows"][0][4], "อะไหล่บี")

    def test_like_escaping_and_edge_case_inputs(self):
        viewer = self._make_user(self.aid_a, self.bid_1)
        # Search for literal "100%" must match only asset_a1, not asset_a1_plain
        inv = viewer.call("/api/inventory?q=100%25")
        self.assertEqual(inv["total"], 1)
        self.assertEqual(inv["items"][0]["id"], self.asset_a1)

        ai_like = viewer.call("/api/assistant/query", {"prompt": "100%"})
        self.assertIn("พบ **1 รายการ**", ai_like["reply"])
        self.assertEqual(len(ai_like["items"]), 1)
        self.assertFalse(ai_like["uiAction"]["autoApply"])

        # "equipment" must NOT trigger PM/work (substring "pm")
        eq = viewer.call("/api/assistant/query", {"prompt": "equipment"})
        self.assertEqual(eq["uiAction"]["type"], "filter_assets")

        # Thai question "มีเครื่องวัดกี่เครื่อง" and "หาของ เครื่องวัด" must extract "เครื่องวัด"
        thai_q = viewer.call("/api/assistant/query", {"prompt": "มีเครื่องวัดกี่เครื่อง"})
        self.assertIn("พบ **2 รายการ**", thai_q["reply"])
        find_q = viewer.call("/api/assistant/query", {"prompt": "หาของ เครื่องวัด"})
        self.assertIn("พบ **2 รายการ**", find_q["reply"])

        # Viewer cannot navigate to settings or approvals via AI assistant
        nav_set = viewer.call("/api/assistant/query", {"prompt": "เปิดหน้าตั้งค่า"})
        self.assertIsNone(nav_set["uiAction"])
        nav_app = viewer.call("/api/assistant/query", {"prompt": "เปิดหน้าศูนย์รออนุมัติ"})
        self.assertIsNone(nav_app["uiAction"])

        # Invalid assistant prompts -> 400
        viewer.call("/api/assistant/query", {"prompt": "   "}, expected=400)
        viewer.call("/api/assistant/query", {"prompt": "ก" * 501}, expected=400)
        viewer.call("/api/assistant/query", {"prompt": ["bad", "type"]}, expected=400)
        viewer.call("/api/assistant/query", {"prompt": 123}, expected=400)

        # Non-ASCII digit like superscript "²" in reports must return 400, not 500
        self.admin.call("/api/reports/assets?accountId=%C2%B2", expected=400)
        self.admin.call("/api/reports/assets?departmentUnitId=%C2%B2", expected=400)

    def test_smart_assistant_synonyms_prefills_and_scoping(self):
        with sqlite3.connect(self.db) as db:
            db.execute(
                "INSERT INTO assets(name,code,group_name,location,building,floor,room,fiscal_year_th,created_at,numbering_account_id,branch_id,status,purchase_price) "
                "VALUES('เครื่องปรับอากาศ ขนาด 18000 BTU','AC-A-01','ครุภัณฑ์สำนักงาน','อาคาร 1 ชั้น 2 ห้อง 301','อาคาร 1','ชั้น 2','301','2568','2026-01-01',?,?,'พร้อมใช้',28000)",
                (self.aid_a, self.bid_1),
            )
            db.execute(
                "INSERT INTO assets(name,code,group_name,location,building,floor,room,fiscal_year_th,created_at,numbering_account_id,branch_id,status,purchase_price) "
                "VALUES('โต๊ะไม่มีห้อง','NL-A-01','ครุภัณฑ์สำนักงาน','','','','','2568','2026-01-01',?,?,'พร้อมใช้',1500)",
                (self.aid_a, self.bid_1),
            )
            db.execute(
                "INSERT INTO assets(name,code,group_name,location,building,floor,room,fiscal_year_th,created_at,numbering_account_id,branch_id,status,purchase_price) "
                "VALUES('เครื่องปรับอากาศ ต่างบัญชี','AC-B-01','ครุภัณฑ์สำนักงาน','อาคาร B','อาคาร B','ชั้น 1','101','2568','2026-01-01',?,NULL,'พร้อมใช้',32000)",
                (self.aid_b,),
            )
            db.commit()

        viewer_a = self._make_user(self.aid_a, self.bid_1)
        # Synonym "แอร์" must match "เครื่องปรับอากาศ" both in assistant and /api/inventory
        inv_air = viewer_a.call("/api/inventory?q=%E0%B9%81%E0%B8%AD%E0%B8%A3%E0%B9%8C")
        self.assertEqual(inv_air["total"], 1)
        self.assertEqual(inv_air["items"][0]["code"], "AC-A-01")

        ai_air = viewer_a.call("/api/assistant/query", {"prompt": "หาแอร์", "accountId": self.aid_a})
        self.assertEqual(ai_air["uiAction"]["type"], "filter_assets")
        self.assertEqual(ai_air["uiAction"]["q"], "เครื่องปรับอากาศ")
        self.assertTrue(ai_air["uiAction"]["autoApply"])
        self.assertEqual(len(ai_air["items"]), 1)
        self.assertEqual(ai_air["items"][0]["code"], "AC-A-01")

        # Multi-criteria structured extraction
        ai_multi = viewer_a.call("/api/assistant/query", {"prompt": "ดูครุภัณฑ์ ชั้น 2 ปีงบ 2568 พร้อมใช้"})
        self.assertEqual(ai_multi["uiAction"]["type"], "filter_assets")
        self.assertEqual(ai_multi["uiAction"]["floor"], "ชั้น 2")
        self.assertEqual(ai_multi["uiAction"]["fiscalYear"], "2568")
        self.assertEqual(ai_multi["uiAction"]["status"], "พร้อมใช้")
        self.assertTrue(ai_multi["uiAction"]["autoApply"])

        # Missing room maps to __unassigned__
        ai_missing = viewer_a.call("/api/assistant/query", {"prompt": "ครุภัณฑ์ที่ยังไม่ระบุห้อง"})
        self.assertEqual(ai_missing["uiAction"]["type"], "filter_assets")
        self.assertEqual(ai_missing["uiAction"]["room"], "__unassigned__")

        # Open report with pre-filled filters
        ai_rep = self.admin.call("/api/assistant/query", {"prompt": "เปิดรายงานงานซ่อม กำลังซ่อม เดือนนี้", "accountId": self.aid_a})
        self.assertEqual(ai_rep["uiAction"]["type"], "open_report")
        self.assertEqual(ai_rep["uiAction"]["reportId"], "repairs")
        self.assertEqual(ai_rep["uiAction"]["filters"]["status"], "กำลังซ่อม")
        self.assertIn("from", ai_rep["uiAction"]["filters"])
        self.assertIn("to", ai_rep["uiAction"]["filters"])
        self.assertTrue(ai_rep["uiAction"]["autoApply"])

        # Prefill repair dialog with matched asset, issue, and urgency
        ai_prefill = viewer_a.call("/api/assistant/query", {"prompt": "แจ้งซ่อม แอร์ อาการ ไม่เย็น ด่วน"})
        self.assertEqual(ai_prefill["uiAction"]["type"], "prefill_repair")
        self.assertEqual(ai_prefill["uiAction"]["issue"], "ไม่เย็น")
        self.assertEqual(ai_prefill["uiAction"]["urgency"], "เร่งด่วน")
        self.assertEqual(ai_prefill["uiAction"]["assetCode"], "AC-A-01")
        self.assertTrue(ai_prefill["uiAction"]["autoApply"])

        # Deep link into settings tab for admin
        ai_set = self.admin.call("/api/assistant/query", {"prompt": "เปิดหน้าตั้งค่า ผู้ใช้งาน"})
        self.assertEqual(ai_set["uiAction"]["type"], "switch_view")
        self.assertEqual(ai_set["uiAction"]["view"], "settings")
        self.assertEqual(ai_set["uiAction"]["settingsTab"], "access")
        self.assertTrue(ai_set["uiAction"]["autoApply"])

        # Account spoofing in body must be rejected with 403 by access control
        viewer_a.call("/api/assistant/query", {"prompt": "หาแอร์", "accountId": self.aid_b}, expected=403)
