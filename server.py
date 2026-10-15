#!/usr/bin/env python3
"""Standalone SQLite-backed prototype for government asset and repair workflows.

This demo intentionally has no authentication. UI roles are workflow-test actors, not access control.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from asset_api import handle as handle_asset_api

ROOT = Path(__file__).resolve().parent
SCHEMA_PATH = ROOT / "schema.sql"
DB_PATH = Path(os.environ.get("ASSET_DB_PATH", str(ROOT / "data" / "prototype.sqlite3"))).expanduser()
if not DB_PATH.is_absolute():
    DB_PATH = (ROOT / DB_PATH).resolve()
APPROVAL_THRESHOLD = max(0, float(os.environ.get("REPAIR_APPROVAL_THRESHOLD", "5000")))
PORT = int(os.environ.get("PORT", "8000"))
HOST = os.environ.get("HOST", "0.0.0.0")
TZ = timezone(timedelta(hours=7), "Asia/Bangkok")
ROLE_OFFICER = "เจ้าหน้าที่พัสดุ"
ROLE_APPROVER = "ผู้อนุมัติ"
ROLE_TECHNICIAN = "ช่าง"
ROLE_REQUESTER = "ผู้แจ้ง"

SAMPLE_ASSETS = [
    ("ตู้เหล็กเก็บเอกสาร 4 ลิ้นชัก", "ขนาดมาตรฐาน · เหล็กพ่นสี", "7110-002-0001", "เครื่องตกแต่งสำนักงาน", "งานสารบรรณ · ชั้น 2", "พร้อมใช้", "▤"),
    ("ตู้เหล็กเก็บเอกสาร 2 ลิ้นชัก", "ขนาดมาตรฐาน · เหล็กพ่นสี", "7110-002-0002", "เครื่องตกแต่งสำนักงาน", "กองคลัง · ชั้น 1", "สำรวจแล้ว", "▤"),
    ("โต๊ะทำงานเหล็ก", "ขนาด 120 × 60 ซม.", "7110-721-0001", "เครื่องตกแต่งสำนักงาน", "งานพัสดุ · ชั้น 3", "รอตรวจสอบ", "▱"),
    ("เก้าอี้ทำงานมีพนักพิง", "ปรับระดับได้ · มีล้อเลื่อน", "7110-627-0001", "เครื่องตกแต่งสำนักงาน", "กองแผนงาน · ชั้น 2", "พร้อมใช้", "♧"),
    ("เครื่องถ่ายเอกสารระบบหมึกผง", "ความเร็ว 10 แผ่นต่อนาที", "7430-003-0001", "เครื่องจักรสำนักงาน", "ศูนย์บริการ · ชั้น 1", "รอตรวจสอบ", "▣"),
]
SAMPLE_SHEET = [
    ("ตู้เก็บเอกสาร 4 ลิ้นชัก", "ตัวอย่างตามคู่มือ · เครื่องตกแต่งสำนักงาน", "7110-002-0001"),
    ("โต๊ะพิมพ์ดีดทำด้วยเหล็ก", "ตัวอย่างรายการจากแบบใบสำรวจพัสดุ", "7110-712-0001"),
    ("เครื่องพิมพ์ดีดไฟฟ้า 2 ภาษา", "ตัวอย่างใน Working Sheet · หมวดเครื่องจักรสำนักงาน", "7430-001-0001"),
]
SAMPLE_CATEGORIES = [
    "ครุภัณฑ์งานบ้านงานครัว", "ครุภัณฑ์ดนตรีนาฏศิลป์",
    "ครุภัณฑ์ไฟฟ้าและวิทยุ (เครื่องกำเนิดไฟฟ้า)", "ครุภัณฑ์ไฟฟ้าและวิทยุ",
    "ครุภัณฑ์ยานพาหนะและขนส่ง", "ครุภัณฑ์โรงงาน", "ครุภัณฑ์วิทยาศาสตร์และการแพทย์",
    "ครุภัณฑ์สำนักงาน (ลิฟต์)", "ครุภัณฑ์สำนักงาน", "สินทรัพย์ software",
    "อาคารถาวร", "อาคารประโยชน์อื่นๆ", "อาคารพักอาศัย", "อาคารสำนักงาน",
    "ครุภัณฑ์ก่อสร้าง", "ครุภัณฑ์การศึกษา", "ครุภัณฑ์กีฬาและกายภาพ",
    "ครุภัณฑ์คอมพิวเตอร์", "ครุภัณฑ์โฆษณาและเผยแพร่",
]
SAMPLE_DEPRECIATION = [
    ("DEMO-01", "ครุภัณฑ์สำนักงาน", 3, 33.0),
    ("DEMO-02", "ครุภัณฑ์คอมพิวเตอร์", 3, 33.0),
    ("DEMO-03", "อาคารถาวร", 25, 4.0),
]


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def seed_master_data(db: sqlite3.Connection) -> None:
    """Seed editable reference examples only for an empty, non-imported demo database."""
    if db.execute("SELECT 1 FROM source_documents LIMIT 1").fetchone():
        return
    if db.execute("SELECT COUNT(*) FROM asset_categories").fetchone()[0] == 0:
        db.executemany(
            "INSERT INTO asset_categories(category_name,source_workbook,notes,is_active,updated_at) VALUES(?,?,?,?,?)",
            [(name, "ข้อมูลสาธิต", "ตัวอย่างหมวดสำหรับทดสอบการจัดการข้อมูล", 1, now_iso()) for name in SAMPLE_CATEGORIES],
        )
    if db.execute("SELECT COUNT(*) FROM depreciation_policies").fetchone()[0] == 0:
        for rule_no, category_name, years, rate in SAMPLE_DEPRECIATION:
            cur = db.execute(
                "INSERT INTO depreciation_policies(rule_no,category_name,useful_life_years,annual_rate_percent,scope,note,calculation_method,residual_value_percent,is_active,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (rule_no, category_name, years, rate, "ข้อมูลสาธิตเท่านั้น", "ค่าเริ่มต้นเพื่อทดลองแก้ไข ไม่ใช่การรับรองหลักเกณฑ์ของหน่วยงาน", "annual_rate", 0, 1, now_iso()),
            )
            category = db.execute("SELECT id FROM asset_categories WHERE category_name=? AND is_active=1 ORDER BY id LIMIT 1", (category_name,)).fetchone()
            if category:
                db.execute("INSERT OR IGNORE INTO asset_category_policy_links(category_id,policy_id,match_note) VALUES(?,?,?)", (category["id"], cur.lastrowid, "ตัวอย่างการเชื่อมหมวดกับหลักเกณฑ์"))


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def initialize() -> None:
    with connect() as db:
        # Upgrade the original lightweight demo table before applying indexes
        # from schema.sql. Existing ids and repair foreign keys remain intact.
        old_assets = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='assets'").fetchone()
        if old_assets:
            columns = {row["name"] for row in db.execute("PRAGMA table_info(assets)")}
            extension_columns = {
                "source_document_id": "INTEGER REFERENCES source_documents(id) ON DELETE SET NULL",
                "source_row_no": "INTEGER",
                "organization_id": "INTEGER REFERENCES organizations(id) ON DELETE SET NULL",
                "department_unit_id": "INTEGER REFERENCES org_units(id) ON DELETE SET NULL",
                "responsible_unit_id": "INTEGER REFERENCES org_units(id) ON DELETE SET NULL",
                "category_id": "INTEGER REFERENCES asset_categories(id) ON DELETE SET NULL",
                "fsn_catalog_item_id": "INTEGER REFERENCES fsn_catalog_items(id) ON DELETE SET NULL",
                "old_asset_code": "TEXT NOT NULL DEFAULT ''",
                "maintenance_status": "TEXT NOT NULL DEFAULT ''",
                "asset_status_source": "TEXT NOT NULL DEFAULT ''",
                "asset_type": "TEXT NOT NULL DEFAULT ''",
                "fiscal_year_th": "TEXT NOT NULL DEFAULT ''",
                "acquisition_date": "TEXT NOT NULL DEFAULT ''",
                "delivery_date": "TEXT NOT NULL DEFAULT ''",
                "acquisition_method": "TEXT NOT NULL DEFAULT ''",
                "purchase_price": "REAL",
                "gfmis_no": "TEXT NOT NULL DEFAULT ''",
                "po_no": "TEXT NOT NULL DEFAULT ''",
                "model": "TEXT NOT NULL DEFAULT ''",
                "serial_number": "TEXT NOT NULL DEFAULT ''",
                "useful_life_years": "REAL",
                "depreciation_policy_id": "INTEGER REFERENCES depreciation_policies(id) ON DELETE SET NULL",
                "depreciation_value": "REAL",
                "accumulated_depreciation": "REAL",
                "net_book_value": "REAL",
                "valuation_date": "TEXT NOT NULL DEFAULT ''",
                "remaining_days": "INTEGER",
                "is_loaned": "TEXT NOT NULL DEFAULT ''",
                "loan_price": "REAL",
                "latest_update": "TEXT NOT NULL DEFAULT ''",
                "delivery_note_no": "TEXT NOT NULL DEFAULT ''",
                "raw_data_json": "TEXT NOT NULL DEFAULT '{}'",
            }
            for column, declaration in extension_columns.items():
                if column not in columns:
                    db.execute(f"ALTER TABLE assets ADD COLUMN {column} {declaration}")
        db.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        master_data_extensions = {
            "asset_categories": {
                "is_active": "INTEGER NOT NULL DEFAULT 1",
                "updated_at": "TEXT NOT NULL DEFAULT ''",
            },
            "depreciation_policies": {
                "calculation_method": "TEXT NOT NULL DEFAULT 'annual_rate'",
                "residual_value_percent": "REAL NOT NULL DEFAULT 0",
                "is_active": "INTEGER NOT NULL DEFAULT 1",
                "updated_at": "TEXT NOT NULL DEFAULT ''",
            },
        }
        for table, extensions in master_data_extensions.items():
            columns = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
            for column, declaration in extensions.items():
                if column not in columns:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
            db.execute(f"UPDATE {table} SET updated_at=CURRENT_TIMESTAMP WHERE updated_at='' OR updated_at IS NULL")
        db.execute("CREATE INDEX IF NOT EXISTS idx_asset_categories_active ON asset_categories(is_active,category_name)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_depreciation_policies_active ON depreciation_policies(is_active,rule_no,category_name)")
        if not db.execute("SELECT 1 FROM schema_migrations WHERE name='source-row-trigram-fts-v1'").fetchone():
            db.execute("INSERT INTO source_row_search(source_row_search) VALUES('rebuild')")
            db.execute("INSERT INTO schema_migrations(name) VALUES('source-row-trigram-fts-v1')")
        seed_master_data(db)
        db.executescript("""
        CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            code TEXT NOT NULL UNIQUE,
            group_name TEXT NOT NULL DEFAULT '',
            location TEXT NOT NULL DEFAULT '',
            acquired_year TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'รออนุมัติ',
            icon TEXT NOT NULL DEFAULT '▤',
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL DEFAULT 'เจ้าหน้าที่พัสดุ',
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS survey_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            code TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_no TEXT NOT NULL UNIQUE,
            asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
            asset_code TEXT NOT NULL DEFAULT '',
            asset_name TEXT NOT NULL,
            location TEXT NOT NULL,
            issue TEXT NOT NULL,
            urgency TEXT NOT NULL DEFAULT 'ปกติ',
            requester TEXT NOT NULL,
            contact TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            approval_required INTEGER NOT NULL DEFAULT 0,
            approval_reason TEXT NOT NULL DEFAULT '',
            requires_purchase INTEGER NOT NULL DEFAULT 0,
            requires_external INTEGER NOT NULL DEFAULT 0,
            requires_replacement INTEGER NOT NULL DEFAULT 0,
            estimate_cost REAL NOT NULL DEFAULT 0,
            approved_by TEXT NOT NULL DEFAULT '',
            final_cost_approval_required INTEGER NOT NULL DEFAULT 0,
            final_cost_status TEXT NOT NULL DEFAULT '',
            final_cost_approved_by TEXT NOT NULL DEFAULT '',
            assigned_to TEXT NOT NULL DEFAULT '',
            work_notes TEXT NOT NULL DEFAULT '',
            actual_cost REAL NOT NULL DEFAULT 0,
            close_note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            closed_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
        CREATE INDEX IF NOT EXISTS idx_tickets_no ON tickets(ticket_no);
        CREATE TABLE IF NOT EXISTS ticket_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            from_status TEXT NOT NULL DEFAULT '',
            to_status TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS asset_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            from_status TEXT NOT NULL DEFAULT '',
            to_status TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        """)
        ticket_columns = {row["name"] for row in db.execute("PRAGMA table_info(tickets)")}
        for column, declaration in (
            ("final_cost_approval_required", "INTEGER NOT NULL DEFAULT 0"),
            ("final_cost_status", "TEXT NOT NULL DEFAULT ''"),
            ("final_cost_approved_by", "TEXT NOT NULL DEFAULT ''"),
            ("data_origin", "TEXT NOT NULL DEFAULT 'prototype'"),
        ):
            if column not in ticket_columns:
                db.execute(f"ALTER TABLE tickets ADD COLUMN {column} {declaration}")
        if db.execute("SELECT COUNT(*) FROM assets").fetchone()[0] == 0:
            stamp = now_iso()
            db.executemany(
                "INSERT INTO assets(name,detail,code,group_name,location,status,icon,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                [(name, detail, code, group, location, status, icon, stamp, stamp) for name, detail, code, group, location, status, icon in SAMPLE_ASSETS],
            )
        if db.execute("SELECT COUNT(*) FROM survey_items").fetchone()[0] == 0:
            stamp = now_iso()
            db.executemany("INSERT INTO survey_items(name,detail,code,created_at) VALUES(?,?,?,?)", [(*row, stamp) for row in SAMPLE_SHEET])
        if db.execute("SELECT COUNT(*) FROM tickets").fetchone()[0] == 0:
            stamp = datetime.now(TZ)
            imported_inventory = db.execute("SELECT 1 FROM source_documents WHERE source_kind='workbook' LIMIT 1").fetchone()
            if imported_inventory:
                samples = [
                    ("SR-2569-9001", "", "ครุภัณฑ์ทดสอบ 1 (ข้อมูลจำลอง)", "พื้นที่ทดสอบ", "อาการจำลอง: ตรวจระบบก่อนเปิดใช้งาน", "เร่งด่วน", "ผู้แจ้งทดสอบ", "กำลังซ่อม", 0, "", 0, 0, 0, 0, "", "ช่างทดสอบ", "รายการจำลอง ไม่ผูกกับทะเบียนจริง", 0),
                    ("SR-2569-9002", "", "ครุภัณฑ์ทดสอบ 2 (ข้อมูลจำลอง)", "พื้นที่ทดสอบ", "อาการจำลอง: ต้องเสนอค่าใช้จ่ายทดสอบ", "เร่งด่วนมาก", "ผู้แจ้งทดสอบ", "รออนุมัติ", 1, "Ticket จำลองเพื่อทดสอบคิวอนุมัติ", 1, 0, 0, 8500, "", "", "รายการจำลอง ไม่ผูกกับทะเบียนจริง", 0),
                    ("SR-2569-9003", "", "ครุภัณฑ์ทดสอบ 3 (ข้อมูลจำลอง)", "พื้นที่ทดสอบ", "อาการจำลอง: ตรวจการปิดงาน", "ปกติ", "ผู้แจ้งทดสอบ", "ปิดงาน", 0, "", 0, 0, 0, 0, "", "ช่างทดสอบ", "รายการจำลอง ไม่ผูกกับทะเบียนจริง", 0),
                ]
            else:
                samples = [
                    ("SR-2569-0001", "7430-003-0001", "เครื่องถ่ายเอกสารระบบหมึกผง", "ศูนย์บริการ · ชั้น 1", "กระดาษติดภายในเครื่องบ่อย", "เร่งด่วน", "เจ้าหน้าที่ศูนย์บริการ", "กำลังซ่อม", 0, "", 0, 0, 0, 0, "", "ช่างตัวอย่าง", "กำลังตรวจชุดป้อนกระดาษ", 0),
                    ("SR-2569-0002", "", "เครื่องปรับอากาศ ห้องประชุม 2", "อาคารสำนักงาน · ชั้น 2", "เครื่องไม่เย็นและมีน้ำหยด", "เร่งด่วนมาก", "งานอาคารสถานที่", "รออนุมัติ", 1, "ต้องจัดซื้ออะไหล่และเสนอค่าใช้จ่าย", 1, 0, 0, 8500, "", "", "", 0),
                    ("SR-2569-0003", "7110-002-0001", "ตู้เหล็กเก็บเอกสาร 4 ลิ้นชัก", "งานสารบรรณ · ชั้น 2", "รางลิ้นชักติดขัด เปิด-ปิดไม่สะดวก", "ปกติ", "งานสารบรรณ", "ปิดงาน", 0, "", 0, 0, 0, 0, "", "ช่างตัวอย่าง", "ปรับตั้งรางลิ้นชักเรียบร้อย", 0),
                ]
            for idx, row in enumerate(samples):
                created = (stamp - timedelta(days=idx)).isoformat(timespec="seconds")
                (ticket_no, asset_code, asset_name, location, issue, urgency, requester, status, approval_required, approval_reason, requires_purchase, requires_external, requires_replacement, estimate_cost, approved_by, assigned_to, work_notes, actual_cost) = row
                cur = db.execute("""INSERT INTO tickets(ticket_no,asset_code,asset_name,location,issue,urgency,requester,status,approval_required,approval_reason,requires_purchase,requires_external,requires_replacement,estimate_cost,approved_by,assigned_to,work_notes,actual_cost,data_origin,created_at,updated_at,closed_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (ticket_no, asset_code, asset_name, location, issue, urgency, requester, status, approval_required, approval_reason, requires_purchase, requires_external, requires_replacement, estimate_cost, approved_by, assigned_to, work_notes, actual_cost, "sample", created, created, created if status == "ปิดงาน" else ""))
                db.execute("INSERT INTO ticket_events(ticket_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)", (cur.lastrowid, requester, "สร้าง Ticket", "", "รับแจ้งใหม่", "เปิด Ticket ตัวอย่างสำหรับทดสอบ", created))
                if status != "รับแจ้งใหม่":
                    db.execute("INSERT INTO ticket_events(ticket_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)", (cur.lastrowid, ROLE_OFFICER, "อัปเดตตัวอย่าง", "รับแจ้งใหม่", status, "สถานะเริ่มต้นในชุดข้อมูลสาธิต", created))


def asset_dict(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"], "detail": row["detail"], "code": row["code"], "group": row["group_name"], "categoryId": row["category_id"], "location": row["location"], "date": row["created_at"], "status": row["status"], "icon": row["icon"], "createdBy": row["created_by"]}


def survey_dict(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"], "detail": row["detail"], "code": row["code"]}


def ticket_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "ticketNo": row["ticket_no"], "assetId": row["asset_id"], "assetCode": row["asset_code"],
        "assetName": row["asset_name"], "location": row["location"], "issue": row["issue"], "urgency": row["urgency"],
        "requester": row["requester"], "contact": row["contact"], "status": row["status"],
        "approvalRequired": bool(row["approval_required"]), "approvalReason": row["approval_reason"],
        "requiresPurchase": bool(row["requires_purchase"]), "requiresExternal": bool(row["requires_external"]),
        "requiresReplacement": bool(row["requires_replacement"]), "estimateCost": row["estimate_cost"], "approvedBy": row["approved_by"],
        "finalCostApprovalRequired": bool(row["final_cost_approval_required"]), "finalCostStatus": row["final_cost_status"], "finalCostApprovedBy": row["final_cost_approved_by"],
        "assignedTo": row["assigned_to"], "workNotes": row["work_notes"], "actualCost": row["actual_cost"],
        "closeNote": row["close_note"], "createdAt": row["created_at"], "updatedAt": row["updated_at"], "closedAt": row["closed_at"],
    }


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class Handler(BaseHTTPRequestHandler):
    server_version = "AssetPrototype/0.2"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def send_json(self, value, status: int = 200) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 100_000:
                raise ApiError("ข้อมูลที่ส่งมายาวเกินกำหนด", 413)
            data = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(data, dict):
                raise ApiError("รูปแบบข้อมูลไม่ถูกต้อง")
            return data
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ApiError("JSON ไม่ถูกต้อง")

    def handle_api(self, method: str, path: str, query: dict, body: dict):
        with connect() as db:
            if method == "GET" and path == "/api/health":
                return {"ok": True, "database": "sqlite", "approvalThreshold": APPROVAL_THRESHOLD, "assets": db.execute("SELECT COUNT(*) FROM assets").fetchone()[0]}
            if method == "GET" and path == "/api/config":
                imported = bool(db.execute("SELECT 1 FROM source_documents WHERE source_kind='workbook' LIMIT 1").fetchone())
                return {"approvalThreshold": APPROVAL_THRESHOLD, "roles": [ROLE_REQUESTER, ROLE_OFFICER, ROLE_APPROVER, ROLE_TECHNICIAN], "demoOnly": True, "dataMode": "imported-test" if imported else "demo"}
            extended = handle_asset_api(db, method, path, query, body)
            if extended is not None:
                return extended
            if method == "GET" and path == "/api/assets":
                return [asset_dict(row) for row in db.execute("SELECT * FROM assets ORDER BY id DESC LIMIT 150")]
            if method == "GET" and path == "/api/survey":
                return [survey_dict(row) for row in db.execute("SELECT * FROM survey_items ORDER BY id")]
            if method == "GET" and path == "/api/tickets":
                return [ticket_dict(row) for row in db.execute("SELECT * FROM tickets ORDER BY id DESC")]
            if method == "GET" and path.startswith("/api/tickets/"):
                try:
                    ticket_id = int(path.rsplit("/", 1)[1])
                except ValueError:
                    raise ApiError("Ticket ID ไม่ถูกต้อง", 404)
                row = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
                if row is None:
                    raise ApiError("ไม่พบ Ticket นี้", 404)
                events = [dict(item) for item in db.execute("SELECT id,actor,action,from_status,to_status,note,created_at AS createdAt FROM ticket_events WHERE ticket_id=? ORDER BY id", (ticket_id,))]
                return {**ticket_dict(row), "events": events}
            if method == "POST" and path == "/api/tickets":
                return self.create_ticket(db, body)
            if method == "POST" and path == "/api/assets":
                return self.create_asset(db, body)
            if method == "POST" and path == "/api/survey":
                name = clean_text(body.get("name"), 300, "ชื่อรายการ")
                stamp = now_iso()
                cur = db.execute("INSERT INTO survey_items(name,detail,code,created_at) VALUES(?,?,?,?)", (name, clean_text(body.get("detail", ""), 800, "รายละเอียด", required=False), clean_text(body.get("code", ""), 80, "รหัส", required=False), stamp))
                return survey_dict(db.execute("SELECT * FROM survey_items WHERE id=?", (cur.lastrowid,)).fetchone()), 201
            match = re.fullmatch(r"/api/tickets/(\d+)/action", path)
            if method == "POST" and match:
                return self.ticket_action(db, int(match.group(1)), body)
            match = re.fullmatch(r"/api/assets/(\d+)/action", path)
            if method == "POST" and match:
                return self.asset_action(db, int(match.group(1)), body)
            raise ApiError("ไม่พบ endpoint นี้", 404)

    def create_ticket(self, db: sqlite3.Connection, body: dict):
        asset_name = clean_text(body.get("assetName"), 300, "ครุภัณฑ์")
        issue = clean_text(body.get("issue"), 3000, "อาการ")
        location = clean_text(body.get("location"), 300, "สถานที่")
        requester = clean_text(body.get("requester"), 160, "ชื่อผู้แจ้ง")
        contact = clean_text(body.get("contact", ""), 160, "ช่องทางติดต่อ", required=False)
        urgency = clean_text(body.get("urgency", "ปกติ"), 30, "ความเร่งด่วน")
        if urgency not in ("ปกติ", "เร่งด่วน", "เร่งด่วนมาก"):
            raise ApiError("ระดับความเร่งด่วนไม่ถูกต้อง")
        asset_code = clean_text(body.get("assetCode", ""), 80, "รหัสทรัพย์สิน", required=False)
        stamp = now_iso()
        local_year = datetime.now(TZ).year + 543
        db.execute("BEGIN IMMEDIATE")
        prefix = f"SR-{local_year}-"
        max_row = db.execute("SELECT MAX(CAST(substr(ticket_no, ?) AS INTEGER)) FROM tickets WHERE ticket_no LIKE ?", (len(prefix) + 1, prefix + "%")).fetchone()[0]
        ticket_no = f"{prefix}{int(max_row or 0) + 1:04d}"
        asset = db.execute("SELECT id,code FROM assets WHERE code=? OR name=? ORDER BY CASE WHEN code=? THEN 0 ELSE 1 END LIMIT 1", (asset_code, asset_name, asset_code)).fetchone() if (asset_code or asset_name) else None
        cur = db.execute("""INSERT INTO tickets(ticket_no,asset_id,asset_code,asset_name,location,issue,urgency,requester,contact,status,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""", (ticket_no, asset["id"] if asset else None, asset["code"] if asset else asset_code, asset_name, location, issue, urgency, requester, contact, "รับแจ้งใหม่", stamp, stamp))
        db.execute("INSERT INTO ticket_events(ticket_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)", (cur.lastrowid, requester, "สร้าง Ticket", "", "รับแจ้งใหม่", "รับคำขอและออกเลข Ticket อัตโนมัติ", stamp))
        row = db.execute("SELECT * FROM tickets WHERE id=?", (cur.lastrowid,)).fetchone()
        return ticket_dict(row), 201

    def create_asset(self, db: sqlite3.Connection, body: dict):
        name = clean_text(body.get("name"), 300, "ชื่อครุภัณฑ์")
        detail = clean_text(body.get("detail", ""), 1000, "รายละเอียด", required=False)
        code = clean_text(body.get("code"), 80, "รหัส FSN")
        location = clean_text(body.get("location", ""), 300, "สถานที่", required=False)
        actor = clean_text(body.get("actor", ROLE_OFFICER), 80, "ผู้บันทึก")
        raw_category_id = body.get("categoryId", body.get("category_id"))
        try:
            category_id = int(str(raw_category_id).strip())
        except (TypeError, ValueError):
            raise ApiError("กรุณาเลือกหมวดครุภัณฑ์จากรายการ")
        stamp = now_iso()
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM assets WHERE code=?", (code,)).fetchone():
            raise ApiError("รหัสนี้มีในทะเบียนแล้ว กรุณาตรวจสอบรายการซ้ำ")
        category = db.execute("SELECT category_name FROM asset_categories WHERE id=? AND is_active=1", (category_id,)).fetchone()
        if not category:
            raise ApiError("ไม่พบหมวดที่เลือกหรือหมวดถูกปิดใช้งานแล้ว")
        group = category["category_name"]
        cur = db.execute("INSERT INTO assets(name,detail,code,group_name,location,category_id,status,created_at,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", (name, detail, code, group, location, category_id, "รออนุมัติ", stamp, actor, stamp))
        db.execute("INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)", (cur.lastrowid, actor, "ส่งขออนุมัติลงทะเบียน", "", "รออนุมัติ", f"เลือกหมวด {group}; รายการใหม่ต้องผ่านการตรวจสอบก่อนเข้าทะเบียนตัวอย่าง", stamp))
        db.execute("INSERT INTO survey_items(name,detail,code,created_at) VALUES(?,?,?,?)", (name, detail, code, stamp))
        return asset_dict(db.execute("SELECT * FROM assets WHERE id=?", (cur.lastrowid,)).fetchone()), 201

    def asset_action(self, db: sqlite3.Connection, asset_id: int, body: dict):
        actor = clean_text(body.get("actor", ""), 80, "บทบาทผู้ดำเนินการ")
        action = clean_text(body.get("action", ""), 30, "คำสั่ง")
        note = clean_text(body.get("note", ""), 1000, "เหตุผล", required=False)
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
        if row is None:
            raise ApiError("ไม่พบรายการครุภัณฑ์", 404)
        if actor != ROLE_APPROVER:
            raise ApiError("ขั้นตอนอนุมัติต้องใช้บทบาทผู้อนุมัติในโหมดทดสอบ", 403)
        if row["status"] != "รออนุมัติ" or action not in ("approve", "reject"):
            raise ApiError("สถานะรายการไม่รองรับคำสั่งนี้")
        if action == "reject" and not note:
            raise ApiError("กรุณาระบุเหตุผลที่ไม่อนุมัติ")
        status = "ทะเบียนแล้ว" if action == "approve" else "ไม่อนุมัติ"
        stamp = now_iso()
        db.execute("UPDATE assets SET status=?,updated_at=? WHERE id=?", (status, stamp, asset_id))
        db.execute("INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)", (asset_id, actor, "อนุมัติลงทะเบียน" if action == "approve" else "ไม่อนุมัติลงทะเบียน", row["status"], status, note, stamp))
        return asset_dict(db.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone())

    def ticket_action(self, db: sqlite3.Connection, ticket_id: int, body: dict):
        actor = clean_text(body.get("actor", ""), 80, "บทบาทผู้ดำเนินการ")
        action = clean_text(body.get("action", ""), 32, "คำสั่ง")
        note = clean_text(body.get("note", ""), 1200, "บันทึก/เหตุผล", required=False)
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if row is None:
            raise ApiError("ไม่พบ Ticket นี้", 404)
        old = row["status"]
        stamp = now_iso()
        fields = {}

        if action == "review":
            require_role(actor, ROLE_OFFICER)
            if old != "รับแจ้งใหม่":
                raise ApiError("ตรวจรับได้เฉพาะ Ticket ใหม่")
            estimate = safe_money(body.get("estimateCost", 0))
            flags = [bool(body.get("requiresPurchase")), bool(body.get("requiresExternal")), bool(body.get("requiresReplacement"))]
            mandatory = estimate >= APPROVAL_THRESHOLD and estimate > 0 or any(flags)
            approval = bool(body.get("approvalRequired")) or mandatory
            reason = note or ("เข้าเงื่อนไขค่าใช้จ่าย/อะไหล่/จ้างภายนอก/ทดแทน" if mandatory else "ซ่อมทั่วไปตามวงเงินทดลอง")
            new = "รออนุมัติ" if approval else "รอมอบหมาย"
            fields = {"approval_required": int(approval), "approval_reason": reason, "requires_purchase": int(flags[0]), "requires_external": int(flags[1]), "requires_replacement": int(flags[2]), "estimate_cost": estimate}
            note = reason
        elif action in ("approve", "reject"):
            require_role(actor, ROLE_APPROVER)
            if old != "รออนุมัติ":
                raise ApiError("Ticket นี้ไม่ได้รออนุมัติ")
            if action == "reject" and not note:
                raise ApiError("กรุณาระบุเหตุผลที่ไม่อนุมัติ")
            new = "รอมอบหมาย" if action == "approve" else "ไม่อนุมัติ"
            fields["approved_by"] = actor if action == "approve" else ""
        elif action == "assign":
            require_role(actor, ROLE_OFFICER)
            if old != "รอมอบหมาย":
                raise ApiError("ต้องได้รับอนุมัติ/ตรวจรับก่อนมอบหมาย")
            assigned = clean_text(body.get("assignedTo"), 160, "ชื่อช่าง")
            new = "กำลังซ่อม"
            fields["assigned_to"] = assigned
            note = note or f"มอบหมายงานให้ {assigned}"
        elif action == "wait_parts":
            require_role(actor, ROLE_TECHNICIAN)
            require_status(old, "กำลังซ่อม")
            new = "รออะไหล่"
            note = note or "บันทึกรออะไหล่/อุปกรณ์"
        elif action == "resume":
            require_role(actor, ROLE_TECHNICIAN)
            require_status(old, "รออะไหล่")
            new = "กำลังซ่อม"
            note = note or "ได้รับอะไหล่และดำเนินการต่อ"
        elif action == "complete":
            require_role(actor, ROLE_TECHNICIAN)
            require_status(old, "กำลังซ่อม")
            work = clean_text(body.get("workNotes"), 3000, "ผลการซ่อม")
            cost = safe_money(body.get("actualCost", 0))
            additional_approval = (cost >= APPROVAL_THRESHOLD and cost > 0 and not row["approval_required"]) or (bool(row["approval_required"]) and cost > float(row["estimate_cost"]))
            new = "รออนุมัติค่าใช้จ่ายจริง" if additional_approval else "รอผู้แจ้งยืนยัน"
            fields["work_notes"] = work
            fields["actual_cost"] = cost
            if additional_approval:
                fields["final_cost_approval_required"] = 1
                fields["final_cost_status"] = "pending"
            note = f"ผลการซ่อม: {work} · ค่าใช้จ่ายจริง {cost:,.2f} บาท" + (" · เกินวงเงิน/ประมาณการที่อนุมัติ ต้องตรวจเพิ่มก่อนปิดงาน" if additional_approval else "")
        elif action in ("approve_final_cost", "reject_final_cost"):
            require_role(actor, ROLE_APPROVER)
            require_status(old, "รออนุมัติค่าใช้จ่ายจริง")
            if action == "reject_final_cost" and not note:
                raise ApiError("กรุณาระบุเหตุผลที่ขอให้แก้ไขค่าใช้จ่าย")
            new = "รอผู้แจ้งยืนยัน" if action == "approve_final_cost" else "รอแก้ไขค่าใช้จ่าย"
            fields["final_cost_status"] = "approved" if action == "approve_final_cost" else "revision_requested"
            fields["final_cost_approved_by"] = actor if action == "approve_final_cost" else ""
            if action == "approve_final_cost":
                note = note or "อนุมัติยอดค่าใช้จ่ายจริงเพื่อส่งตรวจรับ/ปิดงาน"
        elif action == "resubmit_cost":
            require_role(actor, ROLE_OFFICER)
            require_status(old, "รอแก้ไขค่าใช้จ่าย")
            cost = safe_money(body.get("actualCost"))
            revised_note = clean_text(body.get("note"), 1000, "คำชี้แจงการแก้ไข")
            new = "รออนุมัติค่าใช้จ่ายจริง"
            fields["actual_cost"] = cost
            fields["final_cost_status"] = "pending"
            note = revised_note + f" · ยอดเสนอใหม่ {cost:,.2f} บาท"
        elif action in ("confirm", "send_back"):
            require_role(actor, ROLE_REQUESTER)
            require_status(old, "รอผู้แจ้งยืนยัน")
            if action == "send_back" and not note:
                raise ApiError("กรุณาระบุสาเหตุที่ส่งกลับให้แก้ไข")
            new = "ปิดงาน" if action == "confirm" else "กำลังซ่อม"
            fields["close_note"] = note or ("ผู้แจ้งยืนยันรับงานแล้ว" if action == "confirm" else "")
            if action == "confirm":
                fields["closed_at"] = stamp
                note = note or "ผู้แจ้งยืนยันรับมอบงานแล้ว"
        elif action == "cancel":
            if actor not in (ROLE_REQUESTER, ROLE_OFFICER):
                raise ApiError("ยกเลิกได้โดยผู้แจ้งหรือเจ้าหน้าที่พัสดุเท่านั้น", 403)
            if old not in ("รับแจ้งใหม่", "รออนุมัติ", "รอมอบหมาย", "ไม่อนุมัติ"):
                raise ApiError("Ticket ที่เริ่มซ่อมแล้วต้องใช้ขั้นตอนปิด/ส่งกลับ ไม่ใช่ยกเลิก")
            if not note:
                raise ApiError("กรุณาระบุเหตุผลที่ยกเลิก")
            new = "ยกเลิก"
        else:
            raise ApiError("คำสั่ง Ticket ไม่รองรับ")

        fields["status"] = new
        fields["updated_at"] = stamp
        assignments = ",".join(f"{key}=?" for key in fields)
        db.execute(f"UPDATE tickets SET {assignments} WHERE id=?", (*fields.values(), ticket_id))
        db.execute("INSERT INTO ticket_events(ticket_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)", (ticket_id, actor, action, old, new, note, stamp))
        return {**ticket_dict(db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()), "events": [dict(item) for item in db.execute("SELECT id,actor,action,from_status,to_status,note,created_at AS createdAt FROM ticket_events WHERE ticket_id=? ORDER BY id", (ticket_id,))]}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api/"):
            try:
                result = self.handle_api("GET", path, parse_qs(parsed.query), {})
                self.send_json(result)
            except ApiError as exc:
                self.send_json({"error": str(exc)}, exc.status)
            except Exception as exc:
                print(f"API error: {exc!r}")
                self.send_json({"error": "ระบบต้นแบบเกิดข้อผิดพลาด กรุณาตรวจ log ของ server"}, 500)
            return
        target = (ROOT / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_error(403)
            return
        if not target.is_file():
            self.send_error(404)
            return
        data = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or target.suffix in (".js", ".json", ".svg"):
            content_type += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_HEAD(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api/"):
            try:
                result = self.handle_api("GET", path, parse_qs(parsed.query), {})
                data = json.dumps(result, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
            except ApiError as exc:
                self.send_error(exc.status, str(exc))
            return
        target = (ROOT / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_error(403)
            return
        if not target.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or target.suffix in (".js", ".json", ".svg"):
            content_type += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(target.stat().st_size))
        self.end_headers()

    def _handle_write(self, method: str):
        parsed = urlparse(self.path)
        try:
            body = self.read_json()
            result = self.handle_api(method, unquote(parsed.path), parse_qs(parsed.query), body)
            status = 200
            if isinstance(result, tuple):
                result, status = result
            self.send_json(result, status)
        except ApiError as exc:
            self.send_json({"error": str(exc)}, exc.status)
        except sqlite3.IntegrityError as exc:
            self.send_json({"error": "ข้อมูลซ้ำหรือไม่ผ่านข้อกำหนด: " + str(exc)}, 409)
        except Exception as exc:
            print(f"API error: {exc!r}")
            self.send_json({"error": "ระบบต้นแบบเกิดข้อผิดพลาด กรุณาตรวจ log ของ server"}, 500)

    def do_POST(self):
        self._handle_write("POST")

    def do_PUT(self):
        self._handle_write("PUT")

    def do_DELETE(self):
        self._handle_write("DELETE")


def clean_text(value, limit: int, label: str, required: bool = True) -> str:
    if value is None:
        value = ""
    text = " ".join(str(value).strip().split())
    if required and not text:
        raise ApiError(f"กรุณาระบุ{label}")
    if len(text) > limit:
        raise ApiError(f"{label}ยาวเกิน {limit} ตัวอักษร")
    return text


def safe_money(value) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        raise ApiError("จำนวนเงินไม่ถูกต้อง")
    if number < 0 or number > 1_000_000_000:
        raise ApiError("จำนวนเงินอยู่นอกช่วงที่รองรับ")
    return round(number, 2)


def require_role(actual: str, expected: str) -> None:
    if actual != expected:
        raise ApiError(f"ขั้นตอนนี้ต้องใช้บทบาท{expected}ในโหมดทดสอบ", 403)


def require_status(actual: str, expected: str) -> None:
    if actual != expected:
        raise ApiError(f"สถานะปัจจุบัน ({actual}) ไม่ใช่ {expected}")


def main() -> None:
    initialize()
    print(f"SQLite prototype listening on http://{HOST}:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    print(f"Repair approval threshold (demo only): {APPROVAL_THRESHOLD:,.2f} THB")
    ThreadingHTTPServer.allow_reuse_address = True
    with ThreadingHTTPServer((HOST, PORT), Handler) as server:
        server.daemon_threads = True
        server.serve_forever()


if __name__ == "__main__":
    main()
