import csv
import io
import sqlite3
import unittest

import reports
from governance import GovernanceError


class Reports(unittest.TestCase):
    def test_asset_preview_and_export_include_all_rows(self):
        db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        db.execute(
            "CREATE TABLE asset_accounts (id INTEGER PRIMARY KEY, name TEXT, code TEXT, is_active INTEGER)"
        )
        db.executemany(
            "INSERT INTO asset_accounts VALUES(?,?,?,1)",
            [(1, "บัญชีใหญ่", "LARGE"), (2, "บัญชีเล็ก", "SMALL")],
        )
        db.execute(
            """CREATE TABLE assets (
                id INTEGER PRIMARY KEY,
                code TEXT,
                name TEXT,
                group_name TEXT,
                location TEXT,
                status TEXT,
                fiscal_year_th TEXT,
                acquisition_date TEXT,
                purchase_price REAL,
                numbering_account_id INTEGER,
                department_unit_id INTEGER
            )"""
        )
        db.execute(
            "CREATE TABLE org_units (id INTEGER PRIMARY KEY, name TEXT)"
        )
        db.executemany(
            "INSERT INTO org_units VALUES(?,?)",
            [(1, "หน่วยงานใหญ่"), (2, "หน่วยงานเล็ก")],
        )
        db.executemany(
            "INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                (i, f"A-{i:05}", "รายการ", "หมวด", "ที่ตั้ง", "พร้อมใช้", "2569", "", 0, 1, 1)
                for i in range(1, 20_002)
            ),
        )
        db.executemany(
            "INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            [
                (20_002 + i, f"B-{i}", "ชุดเล็ก", "หมวด", "ที่ตั้ง", "พร้อมใช้", "2569", "", 0, 2, 2)
                for i in range(3)
            ],
        )
        db.execute(
            "INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL)",
            (20_005, "U-1", "ไม่ระบุบัญชี", "หมวด", "ที่ตั้ง", "พร้อมใช้", "2569", "", 0),
        )

        preview = reports.run_report(db, "assets", {})
        self.assertEqual(preview["total"], 20_001)
        self.assertEqual(len(preview["rows"]), reports.PREVIEW_ROWS)
        self.assertTrue(preview["truncated"])

        print_data = reports.handle(db, "GET", "/api/reports/assets/print-data", {})
        self.assertEqual(print_data["total"], 20_001)
        self.assertEqual(len(print_data["rows"]), reports.PRINT_ROWS)
        self.assertTrue(print_data["truncated"])

        payload, content_type, _ = reports.build_export(db, "assets", "csv", {})
        exported = list(csv.reader(io.StringIO(payload.decode("utf-8-sig"))))
        self.assertEqual(content_type, "text/csv; charset=utf-8")
        self.assertEqual(len(exported) - 1, 20_001)

        catalog = reports.handle(db, "GET", "/api/reports", {})
        self.assertEqual([account["count"] for account in catalog["accounts"]], [20_001, 3])
        self.assertEqual(catalog["accounts"][1]["label"], "บัญชีเล็ก")
        asset_report = next(item for item in catalog["items"] if item["id"] == "assets")
        self.assertIn("departmentUnitId", asset_report["filters"])
        selected = reports.run_report(db, "assets", {"accountId": "2"})
        self.assertEqual(selected["total"], 3)
        self.assertTrue(all(row[0].startswith("B-") for row in selected["rows"]))
        self.assertIn("หน่วยงาน", selected["columns"])
        self.assertEqual(selected["rows"][0][3], "หน่วยงานเล็ก")
        filtered = reports.run_report(db, "assets", {"accountId": "1", "departmentUnitId": "1"})
        self.assertEqual(filtered["total"], 20_001)
        self.assertTrue(all(row[3] == "หน่วยงานใหญ่" for row in filtered["rows"]))
        departments = reports.handle(db, "GET", "/api/reports/filters/departments", {"accountId": ["2"]})
        self.assertEqual(departments["items"], [{"id": 2, "name": "หน่วยงานเล็ก"}])
        filtered_print = reports.build_print_data(
            db, "assets", {"accountId": "2", "departmentUnitId": "2"}
        )
        self.assertEqual(filtered_print["total"], 3)
        self.assertTrue(all(row[3] == "หน่วยงานเล็ก" for row in filtered_print["rows"]))
        filtered_csv, _, _ = reports.build_export(
            db, "assets", "csv", {"accountId": "2", "departmentUnitId": "2"}
        )
        filtered_rows = list(csv.reader(io.StringIO(filtered_csv.decode("utf-8-sig"))))
        self.assertEqual(filtered_rows[0][3], "หน่วยงาน")
        self.assertEqual(len(filtered_rows) - 1, 3)
        self.assertTrue(all(row[3] == "หน่วยงานเล็ก" for row in filtered_rows[1:]))
        db.close()

    def test_print_data_requires_export_permission(self):
        class RestrictedDatabase:
            access = {"isAdmin": False, "permissions": {"export": False}}

        with self.assertRaises(GovernanceError):
            reports.build_print_data(RestrictedDatabase(), "assets", {})


if __name__ == "__main__":
    unittest.main()
