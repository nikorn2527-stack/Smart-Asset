"""QR Smart: feature flags, location QR, guest safeguards, and asset lifecycle."""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

from governance import GovernanceError, ident, text
from smart_assets import base_url, branding

MIGRATION = "qr-smart-v1"
TZ = timezone(timedelta(hours=7), "Asia/Bangkok")
KINDS = ("building", "floor", "room", "service_point", "common_area")
PROBLEM_TYPES = ("ไฟฟ้า", "ประปา", "ความสะอาด", "ความปลอดภัย", "ครุภัณฑ์ชำรุด", "อื่นๆ")
MOVEMENT_KINDS = ("intake", "assign", "loan", "issue", "return", "relocate")
LOAN_BUSY = ("loaned", "issued")
DEFAULT_FLAGS = {
    "assetQr": True,
    "locationQr": False,
    "guestReporting": True,
    "assetIntake": True,
    "borrowIssueReturn": False,
    "repairManagement": True,
    "returnNotifications": False,
    "fullAssetRegistration": True,
    "assetNumberGeneration": True,
    "depreciation": True,
    "additionalQrServices": False,
}
FLAG_LABELS = {
    "assetQr": "Asset QR",
    "locationQr": "Location QR",
    "guestReporting": "Guest Reporting",
    "assetIntake": "Asset Intake",
    "borrowIssueReturn": "Borrow / Issue / Return",
    "repairManagement": "Repair Management",
    "returnNotifications": "Return Notifications",
    "fullAssetRegistration": "Full Asset Registration",
    "assetNumberGeneration": "Asset Number Generation / FSN",
    "depreciation": "Depreciation",
    "additionalQrServices": "Additional QR Services",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS app_feature_flags (
  id INTEGER PRIMARY KEY CHECK(id=1),
  flags_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS service_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER REFERENCES asset_accounts(id),
  branch_id INTEGER REFERENCES account_branches(id),
  kind TEXT NOT NULL CHECK(kind IN ('building','floor','room','service_point','common_area')),
  parent_id INTEGER REFERENCES service_locations(id) ON DELETE SET NULL,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  public_name TEXT NOT NULL,
  public_info TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  guest_can_report_place INTEGER NOT NULL DEFAULT 1 CHECK(guest_can_report_place IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS location_qr_links (
  location_id INTEGER PRIMARY KEY REFERENCES service_locations(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS location_guest_assets (
  location_id INTEGER NOT NULL REFERENCES service_locations(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY(location_id, asset_id)
);
CREATE TABLE IF NOT EXISTS guest_rate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guest_rate_key ON guest_rate_events(key, created_at);
CREATE TABLE IF NOT EXISTS qr_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL DEFAULT 'guest',
  action TEXT NOT NULL,
  token_kind TEXT NOT NULL DEFAULT '',
  entity_id INTEGER,
  ip_hash TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS asset_custody_state (
  asset_id INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  custodian TEXT NOT NULL DEFAULT '',
  location_id INTEGER REFERENCES service_locations(id) ON DELETE SET NULL,
  location_text TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  loan_status TEXT NOT NULL DEFAULT 'available',
  due_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS asset_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  from_custodian TEXT NOT NULL DEFAULT '',
  to_custodian TEXT NOT NULL DEFAULT '',
  from_location TEXT NOT NULL DEFAULT '',
  to_location TEXT NOT NULL DEFAULT '',
  due_at TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_asset_movements_asset ON asset_movements(asset_id,id);
CREATE INDEX IF NOT EXISTS idx_service_locations_account ON service_locations(account_id,is_active,id);
"""


def fail(message, status=400):
    raise GovernanceError(message, status)


def now_iso():
    return datetime.now(TZ).isoformat(timespec="seconds")


def token32():
    value = secrets.token_urlsafe(24)
    return value if len(value) == 32 else secrets.token_urlsafe(24)[:32]


def initialize(db):
    db.executescript(SCHEMA)
    for table, columns in {
        "tickets": {
            "source_channel": "TEXT NOT NULL DEFAULT 'staff'",
            "location_point_id": "INTEGER",
            "problem_type": "TEXT NOT NULL DEFAULT ''",
            "guest_screened": "INTEGER NOT NULL DEFAULT 1",
            "contact_verified": "INTEGER NOT NULL DEFAULT 0",
        }
    }.items():
        existing = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
        for column, declaration in columns.items():
            if column not in existing:
                db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
    if not db.execute("SELECT 1 FROM app_feature_flags WHERE id=1").fetchone():
        db.execute(
            "INSERT INTO app_feature_flags(id,flags_json,revision,updated_at,updated_by) VALUES(1,?,?,?,?)",
            (json.dumps(DEFAULT_FLAGS, ensure_ascii=False), 1, now_iso(), "ค่าเริ่มต้นระบบ"),
        )
    if not db.execute("SELECT 1 FROM schema_migrations WHERE name=?", (MIGRATION,)).fetchone():
        db.execute("INSERT INTO schema_migrations(name) VALUES(?)", (MIGRATION,))


def flags(db):
    row = db.execute("SELECT * FROM app_feature_flags WHERE id=1").fetchone()
    stored = json.loads(row["flags_json"]) if row else {}
    merged = {**DEFAULT_FLAGS, **{k: bool(stored[k]) for k in DEFAULT_FLAGS if k in stored}}
    return {
        "flags": merged,
        "labels": FLAG_LABELS,
        "revision": row["revision"] if row else 1,
        "updatedAt": row["updated_at"] if row else "",
        "updatedBy": row["updated_by"] if row else "",
    }


def require_flag(db, name, message=None):
    if not flags(db)["flags"].get(name, False):
        fail(message or "ฟังก์ชันนี้ยังไม่เปิดใช้งาน", 403)


def public_flags(db):
    data = flags(db)["flags"]
    return {k: data[k] for k in ("assetQr", "locationQr", "guestReporting", "borrowIssueReturn", "additionalQrServices", "repairManagement")}


def ip_hash(handler):
    return hashlib.sha256((handler.client_address[0] if handler else "unknown").encode()).hexdigest()[:32]


def audit(db, handler, action, token_kind="", entity_id=None, detail=None, actor="guest"):
    db.execute(
        "INSERT INTO qr_audit_log(actor,action,token_kind,entity_id,ip_hash,detail_json,created_at) VALUES(?,?,?,?,?,?,?)",
        (actor, action, token_kind, entity_id, ip_hash(handler), json.dumps(detail or {}, ensure_ascii=False), now_iso()),
    )


def honeypot(body):
    trap = body.get("website") or body.get("companyUrl") or body.get("hp")
    if isinstance(trap, str) and trap.strip():
        fail("ไม่สามารถรับคำแจ้งนี้ได้", 400)


def guard_guest_report(db, handler, scope_key, body, issue):
    honeypot(body)
    now = int(time.time())
    key = ip_hash(handler) + ":" + scope_key
    db.execute("DELETE FROM guest_rate_events WHERE created_at<?", (now - 86400,))
    recent = db.execute("SELECT COUNT(*) FROM guest_rate_events WHERE key=? AND created_at>=?", (key, now - 600)).fetchone()[0]
    if recent >= 5:
        fail("ส่งคำแจ้งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่", 429)
    digest = hashlib.sha256(re.sub(r"\s+", " ", issue.casefold()).encode()).hexdigest()
    duplicate = db.execute(
        """SELECT t.id FROM tickets t
           WHERE t.source_channel IN ('asset_qr','location_qr') AND t.status NOT IN ('ปิดงาน','ยกเลิก','ไม่อนุมัติ')
             AND t.created_at>=? AND lower(trim(t.issue))=lower(trim(?)) LIMIT 1""",
        ((datetime.now(TZ) - timedelta(hours=24)).isoformat(timespec="seconds"), issue),
    ).fetchone()
    if duplicate:
        fail("มีคำแจ้งอาการนี้อยู่แล้ว กรุณาติดตามใบรับแจ้งเดิมก่อนส่งซ้ำ", 409)
    db.execute("INSERT INTO guest_rate_events(key,created_at) VALUES(?,?)", (key, now))
    return digest


def location_token(db, location_id):
    db.execute("INSERT OR IGNORE INTO location_qr_links(location_id,token) VALUES(?,?)", (location_id, token32()))
    return db.execute("SELECT token FROM location_qr_links WHERE location_id=?", (location_id,)).fetchone()[0]


def location_url(db, location_id, origin=""):
    configured = db.execute("SELECT public_base_url FROM app_branding WHERE id=1").fetchone()
    origin = configured[0] or origin if configured else origin
    return f"{base_url(origin)}/l/{location_token(db, location_id)}"


def location_row(db, location_id):
    return db.execute("SELECT * FROM service_locations WHERE id=?", (location_id,)).fetchone()


def visible_location_sql(db, alias="s"):
    ctx = getattr(db, "access", None)
    if not ctx or ctx["accountId"] is None:
        return "1=1"
    expr = f"{alias}.account_id={int(ctx['accountId'])}"
    if ctx["branchId"] is not None:
        expr += f" AND ({alias}.branch_id IS NULL OR {alias}.branch_id={int(ctx['branchId'])})"
    return "(" + expr + ")"


def ticket_scope_sql(db):
    asset_scope = __import__("access_control").scope_sql(db, "a")
    loc_scope = visible_location_sql(db, "s")
    return (
        f"((a.id IS NOT NULL AND {asset_scope})"
        f" OR (t.asset_id IS NULL AND t.location_point_id IS NOT NULL AND EXISTS(SELECT 1 FROM service_locations s WHERE s.id=t.location_point_id AND {loc_scope}))"
        f" OR (t.asset_id IS NULL AND COALESCE(t.location_point_id,0)=0 AND {asset_scope}))"
    )


def public_location(db, row):
    token = location_token(db, row["id"])
    assets = []
    if row["is_active"]:
        assets = [
            {"id": a["id"], "name": a["name"], "code": a["code"]}
            for a in db.execute(
                """SELECT a.id,a.name,a.code FROM location_guest_assets g JOIN assets a ON a.id=g.asset_id
                   WHERE g.location_id=? ORDER BY a.name LIMIT 50""",
                (row["id"],),
            )
        ]
    return {
        "locationId": row["id"],
        "kind": row["kind"],
        "name": row["public_name"] or row["name"],
        "publicInfo": row["public_info"],
        "active": bool(row["is_active"]),
        "canReportPlace": bool(row["guest_can_report_place"] and row["is_active"]),
        "problemTypes": list(PROBLEM_TYPES),
        "guestAssets": assets,
        "notice": "การสแกน QR ไม่ใช่การยืนยันตัวตน และไม่ยืนยันว่าผู้ใช้กำลังอยู่ในสถานที่จริง",
        "token": token,
    }


def staff_location(db, row, origin=""):
    url = location_url(db, row["id"], origin)
    guest_ids = [r[0] for r in db.execute("SELECT asset_id FROM location_guest_assets WHERE location_id=?", (row["id"],))]
    return {
        **dict(row),
        "isActive": bool(row["is_active"]),
        "guestCanReportPlace": bool(row["guest_can_report_place"]),
        "qrUrl": url,
        "qrToken": location_token(db, row["id"]),
        "guestAssetIds": guest_ids,
    }


def custody(db, asset_id):
    row = db.execute("SELECT * FROM asset_custody_state WHERE asset_id=?", (asset_id,)).fetchone()
    if row:
        return dict(row)
    asset = db.execute("SELECT location FROM assets WHERE id=?", (asset_id,)).fetchone()
    profile = db.execute("SELECT custodian FROM asset_profiles WHERE asset_id=?", (asset_id,)).fetchone()
    return {
        "asset_id": asset_id,
        "custodian": profile["custodian"] if profile else "",
        "location_id": None,
        "location_text": asset["location"] if asset else "",
        "condition": "",
        "loan_status": "available",
        "due_at": "",
        "updated_at": "",
    }


def open_repair(db, asset_id):
    return db.execute(
        "SELECT 1 FROM tickets WHERE asset_id=? AND status NOT IN ('ปิดงาน','ยกเลิก','ไม่อนุมัติ') LIMIT 1",
        (asset_id,),
    ).fetchone()


def apply_movement(db, asset_id, kind, actor, body):
    if kind in ("loan", "issue", "return"):
        require_flag(db, "borrowIssueReturn")
    elif kind == "intake":
        require_flag(db, "assetIntake")
    if kind not in MOVEMENT_KINDS:
        fail("ประเภทการเคลื่อนไหวไม่ถูกต้อง")
    asset = db.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
    if not asset:
        fail("ไม่พบครุภัณฑ์", 404)
    state = custody(db, asset_id)
    if kind in ("loan", "issue") and state["loan_status"] in LOAN_BUSY:
        fail("ครุภัณฑ์นี้ถูกยืมหรือเบิกอยู่ กรุณาคืนก่อนทำรายการใหม่", 409)
    if kind == "return" and state["loan_status"] not in LOAN_BUSY:
        fail("ไม่มีรายการยืมหรือเบิกที่รอคืน", 409)
    if kind in ("loan", "issue", "relocate", "assign") and open_repair(db, asset_id) and kind == "loan":
        fail("ครุภัณฑ์มีงานซ่อมค้างอยู่ ไม่สามารถยืมได้จนกว่าจะปิดงาน", 409)
    to_custodian = text(body.get("custodian", state["custodian"]), "ผู้รับผิดชอบ", 160, required=False)
    to_location = text(body.get("location", state["location_text"]), "สถานที่", 300, required=False)
    due = text(body.get("dueAt", ""), "กำหนดคืน", 30, required=False)
    note = text(body.get("note", ""), "หมายเหตุ", 1000, required=False)
    condition = text(body.get("condition", state["condition"]), "สภาพ", 160, required=False)
    location_id = ident(body.get("locationId"), True)
    if kind == "loan":
        status, to_custodian = "loaned", text(body.get("borrower") or body.get("custodian"), "ผู้ยืม", 160)
        if not due:
            fail("กรุณาระบุกำหนดคืน")
    elif kind == "issue":
        status, to_custodian = "issued", text(body.get("recipient") or body.get("custodian"), "ผู้เบิก", 160)
    elif kind == "return":
        status, to_custodian = "available", text(body.get("custodian", state["custodian"]), "ผู้รับผิดชอบ", 160, required=False)
        due = ""
    elif kind == "intake":
        status = "available"
        to_custodian = text(body.get("custodian", ""), "ผู้รับผิดชอบ", 160, required=False)
        code = asset["code"]
        if not code:
            fail("รับเข้าดูแลต้องมีเลขครุภัณฑ์เดิมเป็นรหัสอ้างอิง")
    elif kind == "assign":
        status = state["loan_status"] if state["loan_status"] in LOAN_BUSY else "available"
        to_custodian = text(body.get("custodian"), "ผู้รับผิดชอบ", 160)
    else:
        status = state["loan_status"]
        to_location = text(body.get("location"), "สถานที่", 300)
    stamp = now_iso()
    db.execute(
        """INSERT INTO asset_custody_state(asset_id,custodian,location_id,location_text,condition,loan_status,due_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET
           custodian=excluded.custodian,location_id=excluded.location_id,location_text=excluded.location_text,
           condition=excluded.condition,loan_status=excluded.loan_status,due_at=excluded.due_at,updated_at=excluded.updated_at""",
        (asset_id, to_custodian, location_id, to_location, condition, status, due, stamp),
    )
    if to_location and to_location != asset["location"] and kind in ("intake", "relocate", "return", "issue"):
        db.execute("UPDATE assets SET location=?,updated_at=? WHERE id=?", (to_location, stamp, asset_id))
    db.execute(
        "INSERT INTO asset_profiles(asset_id,serial_number,custodian,warranty_end) VALUES(?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET custodian=excluded.custodian",
        (asset_id, asset["serial_number"] or "", to_custodian, ""),
    )
    db.execute(
        """INSERT INTO asset_movements(asset_id,kind,actor,from_custodian,to_custodian,from_location,to_location,due_at,note,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)""",
        (asset_id, kind, actor, state["custodian"], to_custodian, state["location_text"], to_location, due, note, stamp),
    )
    db.execute(
        "INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)",
        (asset_id, actor, kind, asset["status"], asset["status"], note or kind, stamp),
    )
    return lifecycle_view(db, asset_id)


def lifecycle_view(db, asset_id):
    state = custody(db, asset_id)
    overdue = bool(state["due_at"] and state["loan_status"] in LOAN_BUSY and state["due_at"] < now_iso()[:10])
    history = [dict(r) for r in db.execute("SELECT * FROM asset_movements WHERE asset_id=? ORDER BY id DESC LIMIT 50", (asset_id,))]
    return {"state": {**state, "overdue": overdue, "openRepair": bool(open_repair(db, asset_id))}, "history": history}


def overdue_items(db):
    rows = db.execute(
        """SELECT c.*,a.name,a.code FROM asset_custody_state c JOIN assets a ON a.id=c.asset_id
           WHERE c.loan_status IN ('loaned','issued') AND c.due_at<>'' AND c.due_at<? AND """
        + __import__("access_control").scope_sql(db)
        + " ORDER BY c.due_at,c.asset_id LIMIT 200",
        (now_iso()[:10],),
    ).fetchall()
    return [{"assetId": r["asset_id"], "name": r["name"], "code": r["code"], "custodian": r["custodian"], "dueAt": r["due_at"], "loanStatus": r["loan_status"]} for r in rows]


def create_place_ticket(handler, db, location, body):
    require_flag(db, "locationQr")
    require_flag(db, "guestReporting")
    if not location["is_active"]:
        fail("QR จุดนี้ถูกปิดใช้งานแล้ว สามารถติดตามใบเดิมได้แต่ไม่รับคำแจ้งใหม่", 403)
    issue = text(body.get("issue"), "รายละเอียดปัญหา", 3000)
    requester = text(body.get("requester"), "ชื่อผู้แจ้ง", 160)
    contact = text(body.get("contact"), "ช่องทางติดต่อ", 160)
    problem = text(body.get("problemType", "อื่นๆ"), "ประเภทปัญหา", 40)
    if problem not in PROBLEM_TYPES:
        fail("ประเภทปัญหาไม่ถูกต้อง")
    guard_guest_report(db, handler, "place:" + str(location["id"]), body, issue)
    asset = None
    raw_asset = body.get("assetId")
    if raw_asset not in (None, "", 0, "0"):
        aid = ident(raw_asset)
        allowed = db.execute(
            "SELECT a.id,a.code,a.name,a.location FROM location_guest_assets g JOIN assets a ON a.id=g.asset_id WHERE g.location_id=? AND a.id=?",
            (location["id"], aid),
        ).fetchone()
        if not allowed:
            fail("ไม่สามารถเลือกครุภัณฑ์นี้จาก QR พื้นที่ได้", 403)
        asset = allowed
    elif not location["guest_can_report_place"]:
        fail("จุดนี้ต้องเลือกอุปกรณ์จากรายการที่อนุญาต")
    urgency = text(body.get("urgency", "ปกติ"), "ความเร่งด่วน", 30)
    if urgency not in ("ปกติ", "เร่งด่วน", "เร่งด่วนมาก"):
        fail("ระดับความเร่งด่วนไม่ถูกต้อง")
    stamp = now_iso()
    local_year = datetime.now(TZ).year + 543
    db.execute("BEGIN IMMEDIATE")
    prefix = f"SR-{local_year}-"
    max_row = db.execute("SELECT MAX(CAST(substr(ticket_no, ?) AS INTEGER)) FROM tickets WHERE ticket_no LIKE ?", (len(prefix) + 1, prefix + "%")).fetchone()[0]
    ticket_no = f"{prefix}{int(max_row or 0) + 1:04d}"
    place_name = location["public_name"] or location["name"]
    cur = db.execute(
        """INSERT INTO tickets(ticket_no,asset_id,asset_code,asset_name,location,issue,urgency,requester,contact,status,created_at,updated_at,reporter_note,source_channel,location_point_id,problem_type,guest_screened)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)""",
        (
            ticket_no,
            asset["id"] if asset else None,
            asset["code"] if asset else "",
            asset["name"] if asset else place_name,
            place_name,
            issue,
            urgency,
            requester,
            contact,
            "รับแจ้งใหม่",
            stamp,
            stamp,
            text(body.get("reporterNote", ""), "หมายเหตุ", 2000, required=False),
            "location_qr",
            location["id"],
            problem,
        ),
    )
    db.execute(
        "INSERT INTO ticket_events(ticket_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)",
        (cur.lastrowid, requester, "สร้าง Ticket", "", "รับแจ้งใหม่", "คำแจ้งจาก Location QR · รอคัดกรองก่อนดำเนินงานซ่อม", stamp),
    )
    receipt = secrets.token_urlsafe(24)
    db.execute("INSERT INTO ticket_receipts(ticket_id,token) VALUES(?,?)", (cur.lastrowid, receipt))
    audit(db, handler, "guest-location-report", "location", location["id"], {"ticket": ticket_no, "problem": problem})
    return {"ticketNo": ticket_no, "receiptToken": receipt, "status": "รับแจ้งใหม่"}, 201


def mark_guest_ticket(db, ticket_id, channel, handler=None, extra=None):
    db.execute("UPDATE tickets SET source_channel=?,guest_screened=0 WHERE id=?", (channel, ticket_id))
    audit(db, handler, "guest-asset-report", "asset", ticket_id, extra or {})


def ensure_guest_screened(row, action):
    if action in ("assign", "approve", "wait_parts", "complete", "approve_final_cost") and row["source_channel"] in ("asset_qr", "location_qr") and not row["guest_screened"]:
        fail("คำแจ้งจากผู้ไม่มีบัญชีต้องคัดกรองก่อนมอบหมายช่างหรืออนุมัติค่าใช้จ่าย", 409)


def screen_guest_on_review(db, ticket_id):
    db.execute("UPDATE tickets SET guest_screened=1 WHERE id=?", (ticket_id,))


def handle(handler, db, method, path, query, body, origin=""):
    public = re.fullmatch(r"/api/places/([A-Za-z0-9_-]{32})(/reports)?", path)
    if path == "/api/qr/public-config" and method == "GET":
        ctx = getattr(db, "access", None)
        return {
            "flags": public_flags(db),
            "authenticated": bool(ctx),
            "actor": ctx["actor"] if ctx else "",
            "permissions": ctx["permissions"] if ctx else {},
            "services": _services(db, ctx),
        }
    if public:
        row = db.execute(
            "SELECT s.* FROM service_locations s JOIN location_qr_links q ON q.location_id=s.id WHERE q.token=?",
            (public[1],),
        ).fetchone()
        if row is None:
            fail("ไม่พบ QR พื้นที่นี้ กรุณาตรวจฉลากหรือติดต่อเจ้าหน้าที่", 404)
        require_flag(db, "locationQr", "ยังไม่ได้เปิด Location QR")
        if method == "GET" and not public[2]:
            return public_location(db, row)
        if method == "POST" and public[2]:
            return create_place_ticket(handler, db, row, body)
        fail("ไม่รองรับคำสั่งนี้", 405)
    if path == "/api/features":
        if method == "GET":
            return flags(db)
        if method != "PUT":
            fail("ไม่รองรับคำสั่งนี้", 405)
        ctx = getattr(db, "access", None)
        if ctx and not ctx.get("isAdmin") and not ctx["permissions"].get("manage"):
            fail("ต้องใช้สิทธิ์จัดการตั้งค่า", 403)
        current = flags(db)
        if type(body.get("revision")) is not int or body["revision"] != current["revision"]:
            fail("มีผู้แก้ไขการตั้งค่าแล้ว กรุณาโหลดค่าล่าสุดก่อนบันทึก", 409)
        incoming = body.get("flags") or {}
        merged = {k: bool(incoming[k]) if k in incoming else current["flags"][k] for k in DEFAULT_FLAGS}
        actor = (ctx["user"]["username"] if ctx and ctx.get("user") else body.get("actor") or "ผู้ดูแล")
        db.execute(
            "UPDATE app_feature_flags SET flags_json=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=1",
            (json.dumps(merged, ensure_ascii=False), now_iso(), actor),
        )
        audit(db, handler, "update-features", "flags", 1, merged, actor)
        return flags(db)
    if path == "/api/qr/locations" and method == "GET":
        require_flag(db, "locationQr")
        rows = db.execute(
            "SELECT * FROM service_locations s WHERE " + visible_location_sql(db) + " ORDER BY name,id LIMIT 300"
        ).fetchall()
        return {"items": [staff_location(db, r, origin) for r in rows], "kinds": KINDS}
    if path == "/api/qr/locations" and method == "POST":
        require_flag(db, "locationQr")
        return save_location(db, None, body, origin, handler)
    match = re.fullmatch(r"/api/qr/locations/(\d+)(/assets)?", path)
    if match:
        require_flag(db, "locationQr")
        lid = int(match[1])
        row = db.execute("SELECT * FROM service_locations s WHERE s.id=? AND " + visible_location_sql(db), (lid,)).fetchone()
        if not row:
            fail("ไม่พบจุดบริการในขอบเขตสิทธิ์", 404)
        if match[2] and method == "PUT":
            ids = body.get("assetIds") or []
            if not isinstance(ids, list):
                fail("รายการครุภัณฑ์ไม่ถูกต้อง")
            db.execute("DELETE FROM location_guest_assets WHERE location_id=?", (lid,))
            for aid in ids:
                asset = db.execute("SELECT id FROM assets a WHERE a.id=? AND " + __import__("access_control").scope_sql(db), (ident(aid),)).fetchone()
                if not asset:
                    fail("มีครุภัณฑ์ที่อยู่นอกขอบเขตสิทธิ์", 404)
                db.execute("INSERT OR IGNORE INTO location_guest_assets(location_id,asset_id) VALUES(?,?)", (lid, asset["id"]))
            return staff_location(db, location_row(db, lid), origin)
        if method == "GET":
            return staff_location(db, row, origin)
        if method == "PUT":
            return save_location(db, lid, body, origin, handler)
        fail("ไม่รองรับคำสั่งนี้", 405)
    life = re.fullmatch(r"/api/lifecycle/assets/(\d+)", path)
    if life:
        aid = int(life[1])
        __import__("access_control").can_asset(db, aid)
        if method == "GET":
            return lifecycle_view(db, aid)
        if method == "POST":
            actor = body.get("actor") or (getattr(db, "access", None) or {}).get("actor") or "เจ้าหน้าที่พัสดุ"
            return apply_movement(db, aid, text(body.get("kind"), "ประเภท", 20), actor, body)
        fail("ไม่รองรับคำสั่งนี้", 405)
    if path == "/api/lifecycle/overdue" and method == "GET":
        require_flag(db, "borrowIssueReturn")
        return {"items": overdue_items(db)}
    _enforce_existing_module_flags(db, method, path, body)
    return None


def _enforce_existing_module_flags(db, method, path, body):
    if method in ("GET", "HEAD"):
        return
    if path == "/api/tickets":
        require_flag(db, "repairManagement")
        return
    if path.startswith("/api/catalog/depreciation"):
        require_flag(db, "depreciation")
        return
    if path.startswith("/api/catalog/numbering"):
        require_flag(db, "assetNumberGeneration")
        return
    if path == "/api/assets" and method == "POST":
        has_code = bool(str(body.get("code") or "").strip())
        if not has_code:
            require_flag(db, "assetNumberGeneration")
            require_flag(db, "fullAssetRegistration")


def _services(db, ctx):
    data = flags(db)["flags"]
    guest = [
        {"id": "info", "label": "ดูข้อมูล", "enabled": True},
        {"id": "repair", "label": "แจ้งซ่อม", "enabled": data["guestReporting"] and data["repairManagement"]},
        {"id": "track", "label": "ติดตามคำแจ้งของฉัน", "enabled": data["guestReporting"]},
    ]
    staff = []
    if ctx:
        staff = [
            {"id": "history", "label": "ดูประวัติ", "enabled": True},
            {"id": "borrow", "label": "ยืม / เบิก / คืน", "enabled": data["borrowIssueReturn"]},
        ]
        if data["additionalQrServices"]:
            staff.append({"id": "more", "label": "บริการเพิ่มเติม", "enabled": True})
    return {"guest": guest, "staff": staff}


def save_location(db, location_id, body, origin, handler):
    kind = text(body.get("kind"), "ประเภทพื้นที่", 40)
    if kind not in KINDS:
        fail("ประเภทพื้นที่ไม่ถูกต้อง")
    name = text(body.get("name"), "ชื่อจุดภายในระบบ", 200)
    public_name = text(body.get("publicName", name), "ชื่อที่แสดงสาธารณะ", 200)
    public_info = text(body.get("publicInfo", ""), "ข้อมูลสาธารณะ", 2000, required=False)
    code = text(body.get("code", ""), "รหัสจุด", 80, required=False)
    parent_id = ident(body.get("parentId"), True)
    ctx = getattr(db, "access", None)
    account_id = ident(body.get("accountId"), True) or (ctx["accountId"] if ctx else None)
    branch_id = ident(body.get("branchId"), True) if body.get("branchId") not in (None, "") else (ctx["branchId"] if ctx else None)
    active = 1 if body.get("isActive", True) not in (False, 0, "0") else 0
    can_place = 1 if body.get("guestCanReportPlace", True) not in (False, 0, "0") else 0
    if parent_id:
        parent = db.execute("SELECT id FROM service_locations s WHERE s.id=? AND " + visible_location_sql(db), (parent_id,)).fetchone()
        if not parent:
            fail("ไม่พบพื้นที่แม่ในขอบเขตสิทธิ์")
    stamp = now_iso()
    if location_id:
        db.execute(
            """UPDATE service_locations SET kind=?,parent_id=?,code=?,name=?,public_name=?,public_info=?,is_active=?,guest_can_report_place=?,revision=revision+1,updated_at=?
               WHERE id=?""",
            (kind, parent_id, code, name, public_name, public_info, active, can_place, stamp, location_id),
        )
        lid = location_id
    else:
        lid = db.execute(
            """INSERT INTO service_locations(account_id,branch_id,kind,parent_id,code,name,public_name,public_info,is_active,guest_can_report_place,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (account_id, branch_id, kind, parent_id, code, name, public_name, public_info, active, can_place, stamp, stamp),
        ).lastrowid
        location_token(db, lid)
    actor = (ctx["user"]["username"] if ctx and ctx.get("user") else body.get("actor") or "เจ้าหน้าที่พัสดุ")
    audit(db, handler, "save-location", "location", lid, {"name": name, "active": active}, actor)
    return staff_location(db, location_row(db, lid), origin), (200 if location_id else 201)
