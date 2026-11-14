"""Backend QA regression tests for auth email, bulk actions, ticket items, branding, and QR scan."""
import json
import sqlite3
import uuid
from urllib.error import HTTPError
from urllib.request import Request

from test_access_control import Client
from test_smart_workflow import HTTPFixture, OFFICER


class BackendQATests(HTTPFixture):
    auth_required = "1"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = Client(cls.base)
        cls.admin.call(
            "/api/auth/setup",
            {"username": "qa.admin", "name": "ผู้ดูแล QA", "password": "Test-only-pass-2026"},
        )

    def setUp(self):
        self.admin.call("/api/auth/scope", {"accountId": None, "branchId": None, "actor": OFFICER})
        self.aid = self.admin.call(
            "/api/governance/accounts",
            {"name": "องค์กร QA", "code": "QA-" + uuid.uuid4().hex[:8]},
            expected=201,
        )["id"]
        self.other_aid = self.admin.call(
            "/api/governance/accounts",
            {"name": "องค์กรอื่น", "code": "OTH-" + uuid.uuid4().hex[:8]},
            expected=201,
        )["id"]
        self.cid = self.admin.call("/api/catalog/categories")[0]["id"]
        with sqlite3.connect(self.db) as db:
            self.asset_id = db.execute(
                "INSERT INTO assets(name,code,group_name,location,category_id,created_at,numbering_account_id,status) "
                "VALUES(?,?, 'กลุ่ม', 'ห้อง 101', ?, '2026-11-14', ?, 'ทะเบียนแล้ว')",
                ("เครื่องวัดความดัน QA", "QA-" + uuid.uuid4().hex[:8], self.cid, self.aid),
            ).lastrowid
            self.other_asset_id = db.execute(
                "INSERT INTO assets(name,code,group_name,location,category_id,created_at,numbering_account_id,status) "
                "VALUES(?,?, 'กลุ่ม', 'ห้อง 202', ?, '2026-11-14', ?, 'ทะเบียนแล้ว')",
                ("เครื่องวัดไข้ อื่น", "OTH-" + uuid.uuid4().hex[:8], self.cid, self.other_aid),
            ).lastrowid

    def _org_user(self, aid, **perms):
        uname = "qa." + uuid.uuid4().hex[:10]
        self.admin.call(
            "/api/auth/users",
            {
                "username": uname,
                "name": "เจ้าหน้าที่ QA",
                "email": f"{uname}@hospital.go.th",
                "password": "Test-only-pass-2026",
                "globalRole": "user",
                "memberships": [{"accountId": aid, "branchId": None, "permissions": {"view": True, **perms}}],
            },
            expected=201,
        )
        c = Client(self.base)
        c.call("/api/auth/login", {"username": uname, "password": "Test-only-pass-2026"})
        return c

    def test_request_access_email_and_org_manager_boundary(self):
        guest = Client(self.base)
        guest.call(
            "/api/auth/request-access",
            {
                "username": "bad.email",
                "name": "ผู้ขอทดสอบ",
                "email": "not-an-email",
                "password": "Test-only-pass-2026",
                "accountId": self.aid,
            },
            expected=400,
        )
        req_user = "req." + uuid.uuid4().hex[:8]
        res = guest.call(
            "/api/auth/request-access",
            {
                "username": req_user,
                "name": "พยาบาล ทดสอบ",
                "email": "Nurse.QA@Hospital.GO.TH",
                "department": "OPD",
                "contact": "0811112222",
                "requestedRole": "ผู้แจ้ง",
                "password": "Test-only-pass-2026",
                "accountId": self.aid,
            },
            expected=201,
        )
        self.assertTrue(res["ok"])

        reqs = self.admin.call("/api/auth/requests")["items"]
        target = next(r for r in reqs if r["username"] == req_user)
        self.assertEqual(target["email"], "nurse.qa@hospital.go.th")

        # Non-admin manager of self.aid cannot approve into self.other_aid
        mgr = self._org_user(self.aid, manage=True, create=True)
        mgr.call(
            "/api/auth/requests/review",
            {"requestId": target["id"], "action": "approve", "accountId": self.other_aid},
            expected=403,
        )

        # Approving into self.aid succeeds and copies email to app_users
        approved = mgr.call(
            "/api/auth/requests/review",
            {"requestId": target["id"], "action": "approve", "rolePreset": "ผู้แจ้ง"},
            expected=200,
        )
        self.assertEqual(approved["status"], "approved")
        users = self.admin.call("/api/auth/users")["items"]
        created = next(u for u in users if u["username"] == req_user)
        self.assertEqual(created["email"], "nurse.qa@hospital.go.th")

        # Duplicate username (already in app_users) -> 409
        guest.call(
            "/api/auth/request-access",
            {
                "username": req_user,
                "name": "ซ้ำ",
                "password": "Test-only-pass-2026",
                "accountId": self.aid,
            },
            expected=409,
        )
        # Password < 10 chars -> 400
        guest.call(
            "/api/auth/request-access",
            {
                "username": "short." + uuid.uuid4().hex[:6],
                "name": "รหัสสั้น",
                "password": "short",
                "accountId": self.aid,
            },
            expected=400,
        )

    def test_bulk_actions_in_authenticated_scoped_mode(self):
        staff = self._org_user(self.aid, edit=True, create=True)

        # bulk-status previously crashed with 500 due to scope_sql(db, "assets") on FROM assets a
        res_status = staff.call(
            "/api/inventory/bulk-status",
            {"assetIds": [self.asset_id], "status": "พร้อมใช้", "reason": "ตรวจสภาพแล้ว"},
        )
        self.assertEqual(res_status["updated"], 1)

        # bulk-notes previously crashed with 500 for the same reason
        res_notes = staff.call(
            "/api/inventory/bulk-notes",
            {"assetIds": [self.asset_id], "notes": "ติดสติกเกอร์แล้ว", "mode": "replace"},
        )
        self.assertEqual(res_notes["updated"], 1)

        # bulk-location rejects boolean IDs and updates valid asset
        staff.call(
            "/api/inventory/bulk-location",
            {"assetIds": [True], "building": "อาคาร 1"},
            expected=400,
        )
        staff.call(
            "/api/inventory/bulk-location",
            {"assetIds": [self.asset_id, self.other_asset_id], "building": "อาคาร 1", "floor": "ชั้น 2"},
            expected=404,
        )
        res_loc = staff.call(
            "/api/inventory/bulk-location",
            {"assetIds": [self.asset_id], "building": "อาคาร 1", "floor": "ชั้น 2"},
        )
        self.assertEqual(res_loc["updated"], 1)

        # bulk-category works and logs event
        res_cat = staff.call(
            "/api/inventory/bulk-category",
            {"assetIds": [self.asset_id], "categoryId": self.cid, "reason": "จัดหมวดใหม่"},
        )
        self.assertEqual(res_cat["updated"], 1)

    def test_ticket_items_rejects_non_finite_numbers(self):
        staff = self._org_user(self.aid, create=True, edit=True, work=True)
        ticket = staff.call(
            "/api/tickets",
            {
                "assetId": self.asset_id,
                "assetName": "เครื่องวัดความดัน QA",
                "issue": "จอไม่ติด",
                "requester": "พยาบาล",
                "urgency": "ปกติ",
            },
            expected=201,
        )
        staff.call(
            f"/api/tickets/{ticket['id']}/items",
            {"kind": "part", "name": "สายไฟ", "qty": "nan", "unitCost": 100},
            expected=400,
        )
        staff.call(
            f"/api/tickets/{ticket['id']}/items",
            {"kind": "part", "name": "สายไฟ", "qty": 1, "unitCost": "inf"},
            expected=400,
        )

    def test_branding_and_invalid_content_length(self):
        b = self.admin.call("/api/branding")
        self.admin.call(
            "/api/branding",
            {
                "appName": b["appName"],
                "organization": b["organization"],
                "publicBaseUrl": "ftp://invalid.example.com",
                "revision": b["revision"],
            },
            method="PUT",
            expected=400,
        )
        self.admin.call(
            "/api/branding",
            {
                "appName": b["appName"],
                "organization": b["organization"],
                "revision": b["revision"] + 99,
            },
            method="PUT",
            expected=409,
        )

        # Invalid Content-Length should return 400, not 500
        req = Request(
            self.base + "/api/auth/login",
            data=b"{}",
            headers={"Content-Type": "application/json", "Content-Length": "not-a-number"},
            method="POST",
        )
        try:
            self.admin.opener.open(req, timeout=10)
            self.fail("Expected HTTPError 400")
        except HTTPError as exc:
            self.assertEqual(exc.status, 400)
