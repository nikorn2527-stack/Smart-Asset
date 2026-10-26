import unittest
import sqlite3
from pathlib import Path
import master_data_api
import governance
import server

import tempfile
import os

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema.sql"

class MasterDataPhase2Tests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp_dir.name) / "test.db")
        self.db = sqlite3.connect(self.db_path)
        self.db.row_factory = sqlite3.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            self.db.executescript(f.read())
        governance.initialize(self.db_path)
        server.seed_master_data(self.db)

    def tearDown(self):
        self.db.close()
        import gc
        gc.collect()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_category_duplicate_name_returns_409(self):
        res, code = master_data_api._save_category(self.db, {"name": "หมวดสร้างใหม่"})
        self.assertEqual(code, 201)
        res2 = master_data_api._save_category(self.db, {"name": "หมวดสร้างใหม่"})
        self.assertEqual(res2[1], 409)
        self.assertIn("มีอยู่ในระบบแล้ว", res2[0]["error"])

    def test_category_cycle_detection(self):
        catA, _ = master_data_api._save_category(self.db, {"name": "หมวด A"})
        catB, _ = master_data_api._save_category(self.db, {"name": "หมวด B", "parentCategoryId": catA["id"]})
        with self.assertRaises(ValueError) as ctx:
            master_data_api._save_category(self.db, {"name": "หมวด A", "parentCategoryId": catB["id"]}, catA["id"])
        self.assertIn("วนลูป", str(ctx.exception))

    def test_category_deactivate_child_guard(self):
        catA, _ = master_data_api._save_category(self.db, {"name": "หมวดหลัก"})
        catB, _ = master_data_api._save_category(self.db, {"name": "หมวดย่อย", "parentCategoryId": catA["id"]})
        res = master_data_api._deactivate_category(self.db, catA["id"], {})
        self.assertEqual(res[1], 400)
        self.assertIn("ยังมีหมวดย่อยที่เปิดใช้งานอยู่", res[0]["error"])

    def test_policy_deactivate_binding_guard(self):
        # Create an account, branch, category, and bind a policy to it
        self.db.execute("INSERT INTO asset_accounts(name,code,is_active) VALUES('หน่วยงานทดสอบ','TEST',1)")
        aid = self.db.execute("SELECT last_insert_rowid()").fetchone()[0]
        pol = self.db.execute("SELECT id FROM depreciation_policies WHERE is_active=1 LIMIT 1").fetchone()[0]
        self.db.execute("INSERT INTO account_bindings(account_id,policy_id,effective_from,is_active) VALUES(?,?,'2026-01-01',1)", (aid, pol))
        res = master_data_api._deactivate_policy(self.db, pol, {})
        self.assertEqual(res[1], 400)
        self.assertIn("ยังผูกกับเงื่อนไขการใช้งาน", res[0]["error"])

    def test_calculate_useful_life_zero_safe(self):
        res = governance.calculate({'calculation_method': 'useful_life', 'useful_life_years': 0}, 10000, '2026-01-01')
        self.assertEqual(res['status'], 'review')
        self.assertIn('ระบุอายุการใช้งานที่ถูกต้อง', res['message'])

        res_none = governance.calculate({'calculation_method': 'useful_life', 'useful_life_years': None}, 10000, '2026-01-01')
        self.assertEqual(res_none['status'], 'review')

    def test_category_rename_syncs_assets(self):
        cat, _ = master_data_api._save_category(self.db, {"name": "คอมพิวเตอร์พกพา"})
        self.db.execute("INSERT INTO assets(code,name,category_id,group_name) VALUES(?,?,?,?)", ("NB-001", "Notebook", cat["id"], "คอมพิวเตอร์พกพา"))
        master_data_api._save_category(self.db, {"name": "คอมพิวเตอร์โน้ตบุ๊ก"}, cat["id"])
        row = self.db.execute("SELECT group_name FROM assets WHERE category_id=?", (cat["id"],)).fetchone()
        self.assertEqual(row[0], "คอมพิวเตอร์โน้ตบุ๊ก")

if __name__ == '__main__':
    unittest.main()
