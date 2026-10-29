#!/usr/bin/env python3
"""Standalone SQLite-backed prototype for government asset and repair workflows.

This demo intentionally has no authentication. UI roles are workflow-test actors, not access control.
"""
from __future__ import annotations

import json
import hashlib
import secrets
import shutil
import base64
import math
import threading
import mimetypes
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from asset_api import handle as handle_asset_api
from smart_assets import base_url, branding, public_asset, public_receipt, qr_url, token_for
from qr_smart import (
    initialize as initialize_qr_smart,
    handle as handle_qr_smart,
    require_flag as require_qr_flag,
    guard_guest_report,
    mark_guest_ticket,
    ensure_guest_screened,
    screen_guest_on_review,
    ticket_scope_sql,
    flags as qr_flags,
)
from work_api import handle as handle_work_api, WorkError, generate_due
from register_forms import handle as handle_register_form
from notifications import handle as handle_notifications, NotificationError, approval_threshold
from settings_guard import settings_editor
from numbering import valid_for_category, next_code, classification_type_exists
from starter_catalog import seed as seed_starter_catalog
from governance import GovernanceError, handle as handle_governance, initialize as initialize_governance, create_asset as create_account_asset
from backup_store import handle as handle_backups, create_bundle, prepared_file
from workspace_api import handle as handle_workspace, initialize as initialize_workspace
from supply_api import handle as handle_supply
from operational_master import handle as handle_operational_master
from shared_catalog import initialize as initialize_shared_catalog, handle as handle_shared_catalog
from asset_import import initialize as initialize_asset_import, handle as handle_asset_import
import access_control as access
from catalog_guidance import GuidanceError
from line_notifications import handle as handle_line, verify_webhook, dispatch as dispatch_line, WORKER as LINE_WORKER

WORK_SCHEDULER = {"running": False, "lastRun": None, "lastError": None}

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
    conn = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None, factory=access.Connection)
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
                "fsn_code": "TEXT NOT NULL DEFAULT ''",
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
        if "revision" not in {r["name"] for r in db.execute("PRAGMA table_info(app_branding)")} and db.execute("SELECT 1 FROM sqlite_master WHERE name='app_branding'").fetchone():
            db.execute("ALTER TABLE app_branding ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
        db.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        db.execute("INSERT OR IGNORE INTO workflow_settings(id,approval_threshold,reminder_days,updated_at,updated_by) VALUES(1,?,3,?,?)", (APPROVAL_THRESHOLD,now_iso(),"ค่าเริ่มต้นระบบ"))
        public = os.environ.get("PUBLIC_BASE_URL", "").strip()
        if public:
            try:
                public = base_url(public)
                row = db.execute("SELECT public_base_url FROM app_branding WHERE id=1").fetchone()
                if row is not None and not (row["public_base_url"] or "").strip():
                    db.execute("UPDATE app_branding SET public_base_url=? WHERE id=1", (public,))
            except ValueError:
                pass
        plan_columns = {r["name"] for r in db.execute("PRAGMA table_info(work_plans)")}
        for column, definition in {"schedule_unit": "TEXT NOT NULL DEFAULT 'day'", "interval_count": "INTEGER NOT NULL DEFAULT 30", "anchor_day": "INTEGER NOT NULL DEFAULT 0"}.items():
            if column not in plan_columns:
                db.execute(f"ALTER TABLE work_plans ADD COLUMN {column} {definition}")
                if column == "interval_count":
                    db.execute("UPDATE work_plans SET interval_count=interval_days")
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
            ("approval_threshold_snapshot", "REAL"),
            ("reporter_note", "TEXT NOT NULL DEFAULT ''"),
        ):
            if column not in ticket_columns:
                db.execute(f"ALTER TABLE tickets ADD COLUMN {column} {declaration}")
        imported_inventory = bool(db.execute("SELECT 1 FROM source_documents WHERE source_kind='workbook' LIMIT 1").fetchone())
        if not imported_inventory and db.execute("SELECT COUNT(*) FROM assets").fetchone()[0] == 0:
            stamp = now_iso()
            db.executemany(
                "INSERT INTO assets(name,detail,code,group_name,location,status,icon,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                [(name, detail, code, group, location, status, icon, stamp, stamp) for name, detail, code, group, location, status, icon in SAMPLE_ASSETS],
            )
        if not imported_inventory and db.execute("SELECT COUNT(*) FROM survey_items").fetchone()[0] == 0:
            stamp = now_iso()
            db.executemany("INSERT INTO survey_items(name,detail,code,created_at) VALUES(?,?,?,?)", [(*row, stamp) for row in SAMPLE_SHEET])
        if not imported_inventory and db.execute("SELECT COUNT(*) FROM tickets").fetchone()[0] == 0:
            stamp = datetime.now(TZ)
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

        seed_starter_catalog(db)
        initialize_qr_smart(db)


def asset_dict(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"], "detail": row["detail"], "code": row["code"], "group": row["group_name"], "accountId": row["numbering_account_id"], "branchId": row["branch_id"], "categoryId": row["category_id"], "fsnCode": row["fsn_code"], "assetType": row["asset_type"], "location": row["location"], "date": row["created_at"], "status": row["status"], "icon": row["icon"], "createdBy": row["created_by"]}


def survey_dict(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"], "detail": row["detail"], "code": row["code"]}


def ticket_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "ticketNo": row["ticket_no"], "assetId": row["asset_id"], "assetCode": row["asset_code"],
        "assetName": row["asset_name"], "location": row["location"], "reporterNote": row["reporter_note"], "issue": row["issue"], "urgency": row["urgency"],
        "requester": row["requester"], "contact": row["contact"], "status": row["status"],
        "approvalThreshold": row["approval_threshold_snapshot"],
        "approvalRequired": bool(row["approval_required"]), "approvalReason": row["approval_reason"],
        "requiresPurchase": bool(row["requires_purchase"]), "requiresExternal": bool(row["requires_external"]),
        "requiresReplacement": bool(row["requires_replacement"]), "estimateCost": row["estimate_cost"], "approvedBy": row["approved_by"],
        "finalCostApprovalRequired": bool(row["final_cost_approval_required"]), "finalCostStatus": row["final_cost_status"], "finalCostApprovedBy": row["final_cost_approved_by"],
        "assignedTo": row["assigned_to"], "workNotes": row["work_notes"], "actualCost": row["actual_cost"],
        "closeNote": row["close_note"], "createdAt": row["created_at"], "updatedAt": row["updated_at"], "closedAt": row["closed_at"],
        "sourceChannel": row["source_channel"] if "source_channel" in row.keys() else "staff",
        "locationPointId": row["location_point_id"] if "location_point_id" in row.keys() else None,
        "problemType": row["problem_type"] if "problem_type" in row.keys() else "",
        "guestScreened": bool(row["guest_screened"]) if "guest_screened" in row.keys() else True,
        "contactVerified": bool(row["contact_verified"]) if "contact_verified" in row.keys() else False,
        "provisional": (row["source_channel"] in ("asset_qr", "location_qr") if "source_channel" in row.keys() else False)
        and not (bool(row["guest_screened"]) if "guest_screened" in row.keys() else True),
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
        if getattr(self,"session_cookie",None):
            self.send_header("Set-Cookie",self.session_cookie);self.session_cookie=None
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > (35_000_000 if self.path.startswith("/api/imports/") else 9_000_000 if self.path.startswith("/api/supply/") else 35_000_000 if self.path == "/api/backups/sources" else 750_000 if self.path == "/api/branding" else 100_000):
                raise ApiError("ข้อมูลที่ส่งมายาวเกินกำหนด", 413)
            data = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(data, dict):
                raise ApiError("รูปแบบข้อมูลไม่ถูกต้อง")
            return data
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ApiError("JSON ไม่ถูกต้อง")

    def handle_api(self, method: str, path: str, query: dict, body: dict):
        with connect() as db:
            authenticated = access.auth_api(db,self,method,path,body)
            if authenticated is not None: return authenticated
            ctx = access.authenticate(db,self,method,path,body)
            if path == '/api/health' and access.required(): return {'ok':True,'database':'sqlite'}
            access.authorize(db,ctx,method,path,query,body)
            qr = handle_qr_smart(self, db, method, path, query, body, self.qr_origin())
            if qr is not None:
                return qr
            result = self.route_api(db,method,path,query,body)
            if ctx and method not in ('GET','HEAD'):
                db.execute('INSERT INTO account_events(actor,kind,before_json,after_json) VALUES(?,?,?,?)',(ctx['user']['username'],'request','{}',json.dumps({'method':method,'path':path,'accountId':ctx['accountId'],'branchId':ctx['branchId'],'action':body.get('action')},ensure_ascii=False)))
            return access.filter_result(db,path,result)

    def route_api(self, db, method, path, query, body):
        if True:
            imported = handle_asset_import(db, DB_PATH, method, path, query, body)
            if imported is not None: return imported
            shared = handle_shared_catalog(db, method, path, query, body)
            if shared is not None: return shared
            master = handle_operational_master(db, method, path, query, body)
            if master is not None: return master
            supply = handle_supply(db, method, path, query, body)
            if supply is not None: return supply
            workspace = handle_workspace(db, method, path, query, body)
            if workspace is not None: return workspace
            governed = handle_governance(db, method, path, query, body)
            if governed is not None: return governed
            backups = handle_backups(db, DB_PATH, method, path, query, body)
            if backups is not None: return backups
            if method == "GET" and path == "/api/work/status":
                return {**WORK_SCHEDULER, "timezone": "Asia/Bangkok"}
            try:
                line_result = handle_line(db, method, path, query, body)
                if line_result is not None:
                    return line_result
                notification_result = handle_notifications(db, method, path, query, body)
                if notification_result is not None:
                    return notification_result
                form = handle_register_form(db, method, path, body)
                if form is not None:
                    return form
                work = handle_work_api(db, method, path, query, body)
            except (WorkError, NotificationError) as exc:
                raise ApiError(str(exc), exc.status)
            if work is not None:
                return work
            smart = self.smart_api(db, method, path, query, body)
            if smart is not None:
                return smart
            if method == "GET" and path == "/api/health":
                return {"ok": True, "database": "sqlite", "approvalThreshold": approval_threshold(db), "assets": db.execute("SELECT COUNT(*) FROM assets").fetchone()[0]}
            if method == "GET" and path == "/api/config":
                imported = bool(db.execute("SELECT 1 FROM source_documents WHERE source_kind='workbook' LIMIT 1").fetchone())
                return {"approvalThreshold": approval_threshold(db), "roles": [ROLE_REQUESTER, ROLE_OFFICER, ROLE_APPROVER, ROLE_TECHNICIAN], "demoOnly": True, "dataMode": "imported-test" if imported else "demo", "featureFlags": qr_flags(db)["flags"]}
            if method == "POST" and path in {"/api/sticker/render", "/api/sticker/bulk-render", "/api/sticker/print"}:
                body = {**body, "baseUrl": self.qr_origin()}
            extended = handle_asset_api(db, method, path, query, body)
            if extended is not None:
                return extended
            if method == "GET" and path == "/api/assets/search":
                text = clean_text(query.get("q", [""])[0], 200, "คำค้น", required=False)
                if not text:
                    return {"items": [], "hasMore": False}
                like = "%" + text.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
                rows = db.execute("SELECT a.id,a.name,a.code,a.location,a.status,account.name AS accountName,branch.name AS branchName FROM assets a LEFT JOIN asset_accounts account ON account.id=a.numbering_account_id LEFT JOIN account_branches branch ON branch.id=a.branch_id WHERE "+access.scope_sql(db)+" AND (a.name LIKE ? ESCAPE '!' OR a.code LIKE ? ESCAPE '!' OR a.old_asset_code LIKE ? ESCAPE '!') ORDER BY CASE WHEN a.code=? THEN 0 ELSE 1 END,a.code,a.id LIMIT 13", (like,like,like,text)).fetchall()
                return {"items": [dict(r) for r in rows[:12]], "hasMore": len(rows)>12}
            if method == "GET" and path == "/api/assets/pending":
                return [asset_dict(row) for row in db.execute("SELECT * FROM assets a WHERE status='รออนุมัติ' AND "+access.scope_sql(db)+" ORDER BY id DESC")]
            if method == "GET" and path == "/api/assets":
                return [asset_dict(row) for row in db.execute("SELECT * FROM assets a WHERE "+access.scope_sql(db)+" ORDER BY id DESC LIMIT 150")]
            if method == "GET" and path == "/api/survey":
                return [survey_dict(row) for row in db.execute("SELECT * FROM survey_items ORDER BY id")]
            if method == "GET" and path == "/api/tickets":
                return [ticket_dict(row) for row in db.execute("SELECT t.* FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id WHERE "+ticket_scope_sql(db)+" ORDER BY t.id DESC")]
            if method == "GET" and re.fullmatch(r"/api/tickets/[0-9]+", path):
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

    def qr_origin(self):
        try:
            proto = (self.headers.get("X-Forwarded-Proto") or "http").split(",")[0].strip().lower()
            if proto not in ("http", "https"):
                proto = "http"
            return base_url(f"{proto}://{self.headers.get('Host', f'localhost:{PORT}')}")
        except ValueError as exc:
            raise ApiError(str(exc))

    def smart_api(self, db, method, path, query, body):
        if method == "GET" and path == "/api/overview":
            assets = db.execute("SELECT COUNT(*),COALESCE(SUM(status IN ('รออนุมัติ','รอตรวจสอบ')),0) FROM assets a WHERE "+access.scope_sql(db)).fetchone()
            repairs = db.execute("SELECT COUNT(*),COALESCE(SUM(t.status NOT IN ('ปิดงาน','ยกเลิก','ไม่อนุมัติ')),0),COALESCE(SUM(CASE WHEN t.status NOT IN ('ยกเลิก','ไม่อนุมัติ') THEN actual_cost ELSE 0 END),0) FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id WHERE "+ticket_scope_sql(db)).fetchone()
            return {"assets": assets[0], "pendingAssets": assets[1], "tickets": repairs[0], "activeRepairs": repairs[1], "actualRepairCost": repairs[2], "activeCategories": db.execute("SELECT COUNT(*) FROM asset_categories WHERE is_active=1").fetchone()[0]}
        if path == "/api/branding":
            if method == "GET":
                return branding(db)
            if method != "PUT":
                raise ApiError("ไม่รองรับคำสั่งนี้", 405)
            def deny(message):
                raise ApiError(message, 403)
            editor = settings_editor(db, body.get("actor"), deny)
            app_name = clean_text(body.get("appName"), 80, "ชื่อแอป")
            organization = clean_text(body.get("organization"), 160, "ชื่อหน่วยงาน")
            public_url = clean_text(body.get("publicBaseUrl", ""), 300, "โดเมนระบบ", required=False)
            if public_url:
                try:
                    public_url = base_url(public_url)
                except ValueError as exc:
                    raise ApiError(str(exc))
            # Omitting "logo" keeps the stored logo; sending "" restores the default one.
            logo = body["logo"] if "logo" in body else branding(db)["logo"]
            if not isinstance(logo, str):
                raise ApiError("ไฟล์โลโก้ไม่ถูกต้อง")
            if logo:
                match_logo = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)", logo)
                if not match_logo:
                    raise ApiError("โลโก้ต้องเป็น PNG, JPEG หรือ WebP")
                try:
                    raw = base64.b64decode(match_logo[2], validate=True)
                except ValueError:
                    raise ApiError("ข้อมูลไฟล์โลโก้ไม่ถูกต้อง")
                valid = {"png": raw.startswith(b'\x89PNG\r\n\x1a\n'), "jpeg": raw.startswith(b'\xff\xd8\xff'), "webp": raw.startswith(b'RIFF') and raw[8:12] == b'WEBP'}
                if len(raw) > 500_000 or not valid[match_logo[1]]:
                    raise ApiError("โลโก้ต้องเป็นภาพที่ถูกต้องและมีขนาดไม่เกิน 500 KB")
            db.execute("BEGIN IMMEDIATE")
            before = branding(db)
            if type(body.get("revision")) is not int or body["revision"] != before["revision"]:
                raise ApiError("มีผู้แก้ไขการตั้งค่าแล้ว กรุณาโหลดค่าล่าสุดก่อนบันทึก", 409)
            db.execute("UPDATE app_branding SET app_name=?,organization=?,logo=?,public_base_url=?,revision=revision+1 WHERE id=1", (app_name, organization, logo, public_url))
            # Labels follow the organization name until someone gives Sticker Studio its own
            # name. A stored value equal to the old name (or none) means "still following":
            # drop it so sticker_settings() falls back to branding. A custom name is kept.
            stored = db.execute("SELECT value FROM sticker_settings WHERE key='orgName'").fetchone()
            if stored is not None and stored[0] == before["organization"]:
                db.execute("DELETE FROM sticker_settings WHERE key='orgName'")
            after = branding(db)
            def audit_view(item):
                logo_value = item["logo"]
                return {**item, "logo": hashlib.sha256(logo_value.encode()).hexdigest()[:12] if logo_value else ""}
            db.execute("INSERT INTO app_branding_events(actor,before_json,after_json,created_at) VALUES(?,?,?,?)",
                       (editor, json.dumps(audit_view(before), ensure_ascii=False), json.dumps(audit_view(after), ensure_ascii=False), now_iso()))
            return after
        match = re.fullmatch(r"/api/scan/([A-Za-z0-9_-]{32})(/repairs)?", path)
        if match:
            require_qr_flag(db, "assetQr", "ยังไม่ได้เปิด Asset QR")
            row = db.execute("SELECT a.* FROM assets a JOIN asset_qr_links q ON q.asset_id=a.id WHERE q.token=?", (match[1],)).fetchone()
            if row is None:
                raise ApiError("ไม่พบ QR นี้ กรุณาตรวจฉลากหรือติดต่อเจ้าหน้าที่พัสดุ", 404)
            if method == "GET" and not match[2]:
                view = public_asset(db, row)
                view.pop("custodian", None)
                return view
            if method == "POST" and match[2]:
                require_qr_flag(db, "guestReporting")
                require_qr_flag(db, "repairManagement")
                clean_text(body.get("contact"), 160, "ช่องทางติดต่อ")
                issue = clean_text(body.get("issue"), 3000, "อาการ")
                guard_guest_report(db, self, "asset:" + str(row["id"]), body, issue)
                ticket, status = self.create_ticket(db, {**{k: body[k] for k in ("issue", "requester", "contact", "urgency", "reporterNote", "locationMismatch") if k in body}, "assetId": row["id"], "assetName": row["name"], "assetCode": row["code"], "location": row["location"] or body.get("location", "")})
                receipt = secrets.token_urlsafe(24)
                db.execute("INSERT INTO ticket_receipts(ticket_id,token) VALUES(?,?)", (ticket["id"], receipt))
                mark_guest_ticket(db, ticket["id"], "asset_qr", self, {"ticket": ticket["ticketNo"]})
                return {"ticketNo": ticket["ticketNo"], "receiptToken": receipt, "status": ticket["status"]}, status
            raise ApiError("ไม่รองรับคำสั่งนี้", 405)
        match = re.fullmatch(r"/api/receipts/([A-Za-z0-9_-]{32})(/action)?", path)
        if match:
            row = db.execute("SELECT t.* FROM tickets t JOIN ticket_receipts r ON r.ticket_id=t.id WHERE r.token=?", (match[1],)).fetchone()
            if row is None:
                raise ApiError("ไม่พบใบรับแจ้งนี้", 404)
            if method == "GET" and not match[2]:
                return public_receipt(db, row)
            if method == "POST" and match[2] and body.get("action") in ("confirm", "send_back"):
                self.ticket_action(db, row["id"], {"actor": ROLE_REQUESTER, "action": body["action"], "note": body.get("note", "")})
                return public_receipt(db, db.execute("SELECT * FROM tickets WHERE id=?", (row["id"],)).fetchone())
            raise ApiError("ไม่รองรับคำสั่งนี้", 405)
        match = re.fullmatch(r"/api/assets/(\d+)/smart", path)
        if not match:
            return None
        asset_id = int(match[1])
        if method == "PUT":
            if body.get("actor") != ROLE_OFFICER:
                raise ApiError("เลือกบทบาทเจ้าหน้าที่พัสดุเพื่อแก้ไขทะเบียนในโหมดทดสอบ", 403)
            db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
        if row is None:
            raise ApiError("ไม่พบครุภัณฑ์", 404)
        profile = db.execute("SELECT * FROM asset_profiles WHERE asset_id=?", (asset_id,)).fetchone()
        item = {**asset_dict(row), "serialNumber": profile["serial_number"] if profile else row["serial_number"], "custodian": profile["custodian"] if profile else "", "warrantyEnd": profile["warranty_end"] if profile else ""}
        version = hashlib.sha256(json.dumps(item, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if method == "PUT":
            if body.get("version") != version:
                raise ApiError("ข้อมูลถูกแก้ไขแล้ว กรุณาปิดและเปิดรายละเอียดใหม่ก่อนบันทึก", 409)
            name = clean_text(body.get("name"), 300, "ชื่อครุภัณฑ์")
            code = clean_text(body.get("code"), 80, "รหัสครุภัณฑ์")
            location = clean_text(body.get("location"), 300, "ที่ตั้ง")
            detail = clean_text(body.get("detail", ""), 1000, "รายละเอียด", required=False)
            serial = clean_text(body.get("serialNumber", ""), 160, "หมายเลขเครื่อง", required=False)
            custodian = clean_text(body.get("custodian", ""), 160, "ผู้ดูแล", required=False)
            warranty = clean_text(body.get("warrantyEnd", ""), 10, "วันสิ้นสุดประกัน", required=False)
            if warranty:
                try:
                    datetime.strptime(warranty, "%Y-%m-%d")
                except ValueError:
                    raise ApiError("วันสิ้นสุดประกันไม่ถูกต้อง")
            try:
                category_id = int(body.get("categoryId"))
            except (ValueError, TypeError):
                raise ApiError("กรุณาเลือกหมวดครุภัณฑ์")
            category = db.execute("SELECT category_name FROM asset_categories WHERE id=? AND is_active=1", (category_id,)).fetchone()
            if category is None:
                raise ApiError("ไม่พบหมวดที่ใช้งาน")
            if row["numbering_account_id"] and (code != row["code"] or category_id != row["category_id"]):
                raise ApiError("รายการที่ผูกบัญชีเลขแล้วต้องคงเลขและหมวดเดิม เพื่อรักษาหลักเกณฑ์ที่บันทึกไว้ แก้ข้อมูลทั่วไปได้")
            if row["code_unique"] and db.execute("SELECT 1 FROM assets WHERE COALESCE(numbering_account_id,0)=? AND code=? AND id<>?", (row["numbering_account_id"] or 0, code, asset_id)).fetchone():
                raise ApiError("รหัสครุภัณฑ์ซ้ำกับรายการอื่น", 409)
            db.execute("UPDATE assets SET name=?,code=?,location=?,detail=?,category_id=?,group_name=?,updated_at=? WHERE id=?", (name, code, location, detail, category_id, category[0], now_iso(), asset_id))
            db.execute("INSERT INTO asset_profiles(asset_id,serial_number,custodian,warranty_end) VALUES(?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET serial_number=excluded.serial_number,custodian=excluded.custodian,warranty_end=excluded.warranty_end", (asset_id, serial, custodian, warranty))
            db.execute("INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)", (asset_id, ROLE_OFFICER, "แก้ไขทะเบียน", row["status"], row["status"], json.dumps({"before": item, "after": {"name": name, "code": code, "location": location, "detail": detail, "categoryId": category_id, "serialNumber": serial, "custodian": custodian, "warrantyEnd": warranty}}, ensure_ascii=False), now_iso()))
            return {"ok": True}
        if method != "GET":
            raise ApiError("ไม่รองรับคำสั่งนี้", 405)
        url = qr_url(db, asset_id, self.qr_origin())
        from asset_api import _qr_data_uri
        qr_image = ""
        try:
            qr_image = _qr_data_uri(url)
        except Exception:
            qr_image = ""
        tickets = [ticket_dict(t) for t in db.execute("SELECT * FROM tickets WHERE asset_id=? ORDER BY id DESC", (asset_id,))]
        return {"asset": item, "version": version, "qrUrl": url, "qrImage": qr_image, "tickets": tickets,
                "events": [dict(e) for e in db.execute("SELECT action,actor,created_at AS createdAt FROM asset_events WHERE asset_id=? ORDER BY id DESC LIMIT 50", (asset_id,))]}

    def create_ticket(self, db: sqlite3.Connection, body: dict):
        asset_name = clean_text(body.get("assetName"), 300, "ครุภัณฑ์")
        issue = clean_text(body.get("issue"), 3000, "อาการ")
        location = clean_text(body.get("location", ""), 300, "สถานที่", required=False)
        reporter_note = clean_text(body.get("reporterNote", ""), 2000, "หมายเหตุผู้แจ้ง", required=False)
        mismatch = body.get("locationMismatch") in (True,"on","true")
        if mismatch and not reporter_note:
            raise ApiError("กรุณาระบุที่ตั้งจริงหรือรายละเอียดที่คลาดเคลื่อนในหมายเหตุเพิ่มเติม")
        requester = clean_text(body.get("requester"), 160, "ชื่อผู้แจ้ง")
        contact = clean_text(body.get("contact", ""), 160, "ช่องทางติดต่อ", required=False)
        urgency = clean_text(body.get("urgency", "ปกติ"), 30, "ความเร่งด่วน")
        if urgency not in ("ปกติ", "เร่งด่วน", "เร่งด่วนมาก"):
            raise ApiError("ระดับความเร่งด่วนไม่ถูกต้อง")
        asset_code = clean_text(body.get("assetCode", ""), 80, "รหัสทรัพย์สิน", required=False)
        stamp = now_iso()
        local_year = datetime.now(TZ).year + 543
        db.execute("BEGIN IMMEDIATE")
        work_id = body.get("scheduledWorkId")
        if work_id is not None:
            if type(work_id) is not int:
                raise ApiError("รหัสงาน PM/ตรวจนับไม่ถูกต้อง")
            work = db.execute("SELECT * FROM scheduled_work WHERE id=?", (work_id,)).fetchone()
            if not work or work["status"] != "completed" or work["result"] not in ("needs_repair", "damaged") or work["asset_id"] != body.get("assetId"):
                raise ApiError("ไม่พบผลตรวจที่ต้องแจ้งซ่อมสำหรับครุภัณฑ์นี้")
            if work["repair_ticket_id"]:
                return ticket_dict(db.execute("SELECT * FROM tickets WHERE id=?", (work["repair_ticket_id"],)).fetchone())
        prefix = f"SR-{local_year}-"
        max_row = db.execute("SELECT MAX(CAST(substr(ticket_no, ?) AS INTEGER)) FROM tickets WHERE ticket_no LIKE ?", (len(prefix) + 1, prefix + "%")).fetchone()[0]
        ticket_no = f"{prefix}{int(max_row or 0) + 1:04d}"
        if body.get("assetId") is not None:
            raw_id = body["assetId"]
            if isinstance(raw_id, bool) or not re.fullmatch(r"[1-9][0-9]*", str(raw_id)):
                raise ApiError("รหัสอ้างอิงครุภัณฑ์ไม่ถูกต้อง")
            if len(str(raw_id)) > 19 or int(raw_id) > 9223372036854775807:
                raise ApiError("รหัสอ้างอิงครุภัณฑ์ไม่ถูกต้อง")
            asset = db.execute("SELECT a.id,a.code,a.name,a.location FROM assets a WHERE "+access.scope_sql(db)+" AND a.id=?", (int(raw_id),)).fetchone()
            if asset is None:
                raise ApiError("ไม่พบครุภัณฑ์ที่แจ้งซ่อม", 404)
            asset_name, asset_code = asset["name"], asset["code"]
        elif asset_code:
            matches = db.execute("SELECT a.id,a.code,a.name,a.location FROM assets a WHERE "+access.scope_sql(db)+" AND a.code=? ORDER BY a.id LIMIT 2", (asset_code,)).fetchall()
            if not matches:
                raise ApiError("ไม่พบรหัสครุภัณฑ์ กรุณาเลือกจากทะเบียน", 404)
            if len(matches) > 1:
                raise ApiError("พบรหัสครุภัณฑ์ซ้ำ กรุณาเปิดรายละเอียดรายการที่ต้องการแล้วกดแจ้งซ่อม")
            asset = matches[0]
        else:
            matches = db.execute("SELECT a.id,a.code,a.name,a.location FROM assets a WHERE "+access.scope_sql(db)+" AND a.name=? ORDER BY a.id LIMIT 2", (asset_name,)).fetchall()
            if len(matches) > 1:
                raise ApiError("มีครุภัณฑ์ชื่อซ้ำ กรุณาระบุรหัสครุภัณฑ์")
            asset = matches[0] if matches else None
        if asset:
            asset_name, asset_code = asset["name"], asset["code"]
            location = asset["location"] or "ยังไม่ระบุที่ตั้งในทะเบียน"
            if access.required() and not asset["location"] and not reporter_note:
                raise ApiError("ทะเบียนยังไม่มีที่ตั้ง กรุณาระบุที่ตั้งจริงในหมายเหตุเพิ่มเติม")
        elif access.required():
            raise ApiError("กรุณาเลือกครุภัณฑ์จากทะเบียนเพื่อผูกคำขอกับรายการจริง")
        elif not location:
            raise ApiError("กรุณาระบุสถานที่")
        cur = db.execute("""INSERT INTO tickets(ticket_no,asset_id,asset_code,asset_name,location,issue,urgency,requester,contact,status,created_at,updated_at,reporter_note)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""", (ticket_no, asset["id"] if asset else None, asset["code"] if asset else asset_code, asset_name, location, issue, urgency, requester, contact, "รับแจ้งใหม่", stamp, stamp, reporter_note))
        db.execute("INSERT INTO ticket_events(ticket_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)", (cur.lastrowid, requester, "สร้าง Ticket", "", "รับแจ้งใหม่", "รับคำขอและออกเลข Ticket อัตโนมัติ" + ("\nหมายเหตุผู้แจ้ง: " + reporter_note if reporter_note else ""), stamp))
        if work_id is not None:
            db.execute("UPDATE scheduled_work SET repair_ticket_id=? WHERE id=?", (cur.lastrowid, work_id))
        row = db.execute("SELECT * FROM tickets WHERE id=?", (cur.lastrowid,)).fetchone()
        return ticket_dict(row), 201

    def create_asset(self, db: sqlite3.Connection, body: dict):
        if body.get("accountId"):
            return asset_dict(create_account_asset(db, body, now_iso())), 201
        name = clean_text(body.get("name"), 300, "ชื่อครุภัณฑ์")
        detail = clean_text(body.get("detail", ""), 1000, "รายละเอียด", required=False)
        code = clean_text(body.get("code", ""), 80, "เลขประจำครุภัณฑ์", required=False)
        auto_code = not code
        asset_type = clean_text(body.get("assetType", ""), 300, "ชนิดครุภัณฑ์", required=False)
        fsn_code = clean_text(body.get("fsnCode", ""), 13, "รหัสจำแนก FSN", required=False)
        if fsn_code and not re.fullmatch(r"[0-9]{4}-[0-9]{3}-[0-9]{4}", fsn_code):
            raise ApiError("รหัส FSN ต้องเป็น 4-3-4 หลัก ชุดสุดท้ายคือรายละเอียด ไม่ใช่ลำดับทรัพย์สิน")
        if auto_code and not fsn_code:
            raise ApiError("กรุณาเลือกรหัส FSN เต็มจากบัญชีรหัส หรือระบุเลขประจำครุภัณฑ์เดิมด้วยตนเอง")
        location = clean_text(body.get("location", ""), 300, "สถานที่", required=False)
        actor = clean_text(body.get("actor", ROLE_OFFICER), 80, "ผู้บันทึก")
        raw_category_id = body.get("categoryId", body.get("category_id"))
        try:
            category_id = int(str(raw_category_id).strip())
        except (TypeError, ValueError):
            raise ApiError("กรุณาเลือกหมวดครุภัณฑ์จากรายการ")
        stamp = now_iso()
        db.execute("BEGIN IMMEDIATE")
        if fsn_code and not valid_for_category(db, category_id, fsn_code):
            raise ApiError("รหัสนี้ยังไม่ผูกกับหมวดที่เลือก เลือกจากทะเบียนของหมวด หรือกำหนดรหัสพร้อมหลักฐานในตั้งค่าก่อน")
        if asset_type and not classification_type_exists(db, category_id, fsn_code, asset_type):
            raise ApiError("ชนิดครุภัณฑ์ไม่ตรงกับหมวดหรือรหัสที่เลือก กรุณาเลือกจากบัญชีเดิม")
        if auto_code:
            # Hold the write lock while choosing and inserting the next code.
            # Use all existing rows, including pending and imported records.
            code = next_code(db, fsn_code)
            if len(code) > 80:
                raise ApiError("เลขลำดับครุภัณฑ์เกินช่วงที่รองรับ")
        if db.execute("SELECT 1 FROM assets WHERE numbering_account_id IS NULL AND code=?", (code,)).fetchone():
            raise ApiError("รหัสนี้มีในทะเบียนแล้ว กรุณาตรวจสอบรายการซ้ำ", 409)
        category = db.execute("SELECT category_name FROM asset_categories WHERE id=? AND is_active=1", (category_id,)).fetchone()
        if not category:
            raise ApiError("ไม่พบหมวดที่เลือกหรือหมวดถูกปิดใช้งานแล้ว")
        group = category["category_name"]
        cur = db.execute("INSERT INTO assets(name,detail,code,group_name,location,category_id,status,created_at,created_by,updated_at,fsn_code,asset_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (name, detail, code, group, location, category_id, "รออนุมัติ", stamp, actor, stamp, fsn_code, asset_type))
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

        if action not in ("review", "dismiss"):
            ensure_guest_screened(row, action)
        if action == "review":
            require_role(actor, ROLE_OFFICER)
            if old != "รับแจ้งใหม่":
                raise ApiError("ตรวจรับได้เฉพาะ Ticket ใหม่")
            screen_guest_on_review(db, ticket_id)
            estimate = safe_money(body.get("estimateCost", 0))
            flags = [bool(body.get("requiresPurchase")), bool(body.get("requiresExternal")), bool(body.get("requiresReplacement"))]
            threshold = approval_threshold(db)
            mandatory = estimate >= threshold and estimate > 0 or any(flags)
            approval = bool(body.get("approvalRequired")) or mandatory
            reason = note or ("เข้าเงื่อนไขค่าใช้จ่าย/อะไหล่/จ้างภายนอก/ทดแทน" if mandatory else "ซ่อมทั่วไปตามวงเงินทดลอง")
            new = "รออนุมัติ" if approval else "รอมอบหมาย"
            fields = {"approval_threshold_snapshot": threshold, "approval_required": int(approval), "approval_reason": reason, "requires_purchase": int(flags[0]), "requires_external": int(flags[1]), "requires_replacement": int(flags[2]), "estimate_cost": estimate}
            note = reason + f" · เกณฑ์ส่งอนุมัติ ณ วันคัดกรอง {threshold:,.2f} บาท"
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
            threshold = row["approval_threshold_snapshot"] if row["approval_threshold_snapshot"] is not None else approval_threshold(db)
            additional_approval = (cost >= threshold and cost > 0 and not row["approval_required"]) or (bool(row["approval_required"]) and cost > float(row["estimate_cost"]))
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
        elif action == "dismiss":
            require_role(actor, ROLE_OFFICER)
            if old != "รับแจ้งใหม่":
                raise ApiError("ปิดว่าแจ้งไม่จริงได้เฉพาะคำแจ้งใหม่")
            screen_guest_on_review(db, ticket_id)
            new = "ยกเลิก"
            fields["guest_screened"] = 1
            fields["close_note"] = note or "ตรวจแล้วไม่ใช่การแจ้งจริง"
            note = fields["close_note"]
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
        if re.fullmatch(r"/(q|t|l)/[A-Za-z0-9_-]{32}", path):
            path = "/scan.html"
        if path == "/api/backups/download" or path.startswith("/api/backups/prepared/"):
            folder = None
            try:
                with connect() as db:
                    query=parse_qs(parsed.query);ctx=access.authenticate(db,self,'GET',path,{})
                    access.authorize(db,ctx,'GET',path,query,{})
                    actor=query.get('actor',[''])[0]
                if path == "/api/backups/download":
                    folder, output = create_bundle(DB_PATH, actor)
                else:
                    output = prepared_file(DB_PATH, path.removeprefix("/api/backups/prepared/"), actor)
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Length", str(output.stat().st_size))
                self.send_header("Content-Disposition", 'attachment; filename="' + output.name + '"')
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                with output.open("rb") as stream: shutil.copyfileobj(stream, self.wfile)
            except GovernanceError as exc:
                self.send_json({"error": str(exc)}, exc.status)
            finally:
                if folder: shutil.rmtree(folder)
            return
        if path.startswith("/api/"):
            try:
                result = self.handle_api("GET", path, parse_qs(parsed.query), {})
                status = 200
                if isinstance(result, tuple):
                    result, status = result
                self.send_json(result, status)
            except (ApiError, GuidanceError, GovernanceError) as exc:
                self.send_json({"error": str(exc)}, exc.status)
            except Exception as exc:
                print(f"API error: {exc!r}", flush=True)
                self.send_json({"error": "ระบบต้นแบบเกิดข้อผิดพลาด กรุณาตรวจ log ของ server"}, 500)
            return
        allowed = {"/", "/index.html", "/scan.html", "/upload-db.html", "/styles.css", "/stickers.css", "/master-data.css", "/smart.css", "/app.js", "/action-buttons.js", "/action-buttons.css", "/asset-tools.js", "/master-data.js", "/smart.js", "/scan.js", "/work.js", "/work.css", "/register-form.css", "/register-form.js", "/MANUAL.md", "/notifications.js", "/notifications.css", "/line-settings.js", "/asset-numbering.js", "/catalog-guidance.js", "/page-layout.js", "/page-layout.css", "/governance.js", "/governance.css", "/account-registration.js", "/simple-workspace.js", "/inventory-workspace.js", "/simple-workspace.css", "/supply.js", "/supply.css", "/operational-master.js", "/access.js", "/access.css", "/equipment-workspace.js", "/equipment.css", "/asset-register.css", "/layout-zones.css", "/qr-smart.js"}
        if path not in allowed and not re.fullmatch(r"/assets/(?:[A-Za-z0-9_-]+\.(?:png|svg|webp|jpg|ico)|fonts/(?:Sarabun-Regular.ttf|Sarabun-Bold.ttf|OFL.txt))", path):
            self.send_error(404)
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
        if re.fullmatch(r"/(q|t|l)/[A-Za-z0-9_-]{32}", path):
            path = "/scan.html"
        if path == "/api/backups/download" or path.startswith("/api/backups/prepared/"):
            folder = None
            try:
                with connect() as db:
                    query=parse_qs(parsed.query);ctx=access.authenticate(db,self,'GET',path,{})
                    access.authorize(db,ctx,'GET',path,query,{})
                    actor=query.get('actor',[''])[0]
                if path == "/api/backups/download":
                    folder, output = create_bundle(DB_PATH, actor)
                else:
                    output = prepared_file(DB_PATH, path.removeprefix("/api/backups/prepared/"), actor)
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Length", str(output.stat().st_size))
                self.send_header("Content-Disposition", 'attachment; filename="' + output.name + '"')
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                with output.open("rb") as stream: shutil.copyfileobj(stream, self.wfile)
            except GovernanceError as exc:
                self.send_json({"error": str(exc)}, exc.status)
            finally:
                if folder: shutil.rmtree(folder)
            return
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
        allowed = {"/", "/index.html", "/scan.html", "/upload-db.html", "/styles.css", "/stickers.css", "/master-data.css", "/smart.css", "/app.js", "/action-buttons.js", "/action-buttons.css", "/asset-tools.js", "/master-data.js", "/smart.js", "/scan.js", "/work.js", "/work.css", "/register-form.css", "/register-form.js", "/MANUAL.md", "/notifications.js", "/notifications.css", "/line-settings.js", "/asset-numbering.js", "/catalog-guidance.js", "/page-layout.js", "/page-layout.css", "/governance.js", "/governance.css", "/account-registration.js", "/simple-workspace.js", "/inventory-workspace.js", "/simple-workspace.css", "/supply.js", "/supply.css", "/operational-master.js", "/access.js", "/access.css", "/equipment-workspace.js", "/equipment.css", "/asset-register.css", "/layout-zones.css", "/qr-smart.js"}
        if path not in allowed and not re.fullmatch(r"/assets/(?:[A-Za-z0-9_-]+\.(?:png|svg|webp|jpg|ico)|fonts/(?:Sarabun-Regular.ttf|Sarabun-Bold.ttf|OFL.txt))", path):
            self.send_error(404)
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
            if method == "POST" and unquote(parsed.path) == "/api/line/webhook":
                try:
                    length=int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    raise ApiError("ขนาด webhook ไม่ถูกต้อง")
                if not 0<length<=1_000_000:
                    raise ApiError("ขนาด webhook ไม่ถูกต้อง",413)
                raw=self.rfile.read(length)
            if method == "POST" and unquote(parsed.path) == "/api/admin/upload-database":
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    raise ApiError("ขนาดไฟล์ไม่ถูกต้อง")
                if not 0 < length <= 2_000_000_000:
                    raise ApiError("ขนาดไฟล์ต้องไม่เกิน 2 GB", 413)
                DB_PATH.parent.mkdir(parents=True, exist_ok=True)
                temp_upload = DB_PATH.parent / f"upload-{secrets.token_hex(6)}.tmp"
                try:
                    remaining = length
                    with temp_upload.open("wb") as out:
                        while remaining > 0:
                            chunk = self.rfile.read(min(remaining, 1024 * 1024))
                            if not chunk:
                                break
                            out.write(chunk)
                            remaining -= len(chunk)
                    if remaining > 0:
                        raise ApiError("การอัปโหลดไฟล์ไม่สมบูรณ์ ข้อมูลขาดหาย")
                    with sqlite3.connect(f"file:{temp_upload.resolve()}?mode=ro", uri=True) as test_conn:
                        check = test_conn.execute("PRAGMA integrity_check").fetchone()
                        if not check or check[0] != "ok":
                            raise ApiError("ไฟล์ที่ส่งมาไม่ใช่ฐานข้อมูล SQLite หรือไฟล์เสียหาย")
                        tables = [r[0] for r in test_conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
                        if "assets" not in tables:
                            raise ApiError("ฐานข้อมูลไม่มีตาราง assets ของระบบ GovAsset")
                        asset_count = test_conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0]

                    shm = Path(str(DB_PATH) + "-shm")
                    wal = Path(str(DB_PATH) + "-wal")
                    shm.unlink(missing_ok=True)
                    wal.unlink(missing_ok=True)
                    shutil.move(str(temp_upload), str(DB_PATH))
                    initialize()
                    self.send_json({"ok": True, "assets": asset_count, "message": f"นำเข้าฐานข้อมูลสำเร็จ ({asset_count:,} ครุภัณฑ์)"})
                    return
                finally:
                    temp_upload.unlink(missing_ok=True)
            body = self.read_json()
            result = self.handle_api(method, unquote(parsed.path), parse_qs(parsed.query), body)
            status = 200
            if isinstance(result, tuple):
                result, status = result
            self.send_json(result, status)
        except (ApiError, NotificationError, GuidanceError, GovernanceError) as exc:
            self.send_json({"error": str(exc)}, exc.status)
        except sqlite3.IntegrityError as exc:
            self.send_json({"error": "ข้อมูลซ้ำหรือไม่ผ่านข้อกำหนด: " + str(exc)}, 409)
        except Exception as exc:
            print(f"API error: {exc!r}", flush=True)
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
    if not math.isfinite(number) or number < 0 or number > 1_000_000_000:
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
    initialize_governance(DB_PATH)
    initialize_workspace(DB_PATH)
    initialize_shared_catalog(DB_PATH)
    initialize_asset_import(DB_PATH)
    access.initialize(DB_PATH)
    stop_scheduler = threading.Event()
    def run_scheduler():
        WORK_SCHEDULER["running"] = True
        interval = max(1, int(os.environ.get("WORK_SCHEDULER_INTERVAL_SECONDS", "60")))
        while not stop_scheduler.is_set():
            try:
                with connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    generate_due(db)
                WORK_SCHEDULER.update(lastRun=now_iso(), lastError=None)
            except Exception as exc:
                WORK_SCHEDULER["lastError"] = type(exc).__name__
                print(f"Work scheduler error: {exc!r}")
            stop_scheduler.wait(interval)
        WORK_SCHEDULER["running"] = False
    threading.Thread(target=run_scheduler, name="scheduled-work", daemon=True).start()
    def run_line():
        LINE_WORKER["running"] = True
        while not stop_scheduler.is_set():
            try:
                dispatch_line(connect)
                LINE_WORKER.update(lastRun=now_iso(),lastError=None)
            except Exception as exc:
                LINE_WORKER["lastError"] = type(exc).__name__
                print("LINE worker error: "+type(exc).__name__)
            stop_scheduler.wait(5)
        LINE_WORKER["running"] = False
    threading.Thread(target=run_line,name="line-notifications",daemon=True).start()
    print(f"SQLite prototype listening on http://{HOST}:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    with connect() as db:
        print(f"Repair approval threshold (demo only): {approval_threshold(db):,.2f} THB")
    ThreadingHTTPServer.allow_reuse_address = True
    with ThreadingHTTPServer((HOST, PORT), Handler) as server:
        server.daemon_threads = True
        try:
            server.serve_forever()
        finally:
            stop_scheduler.set()


if __name__ == "__main__":
    main()
