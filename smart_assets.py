"""Stable QR identities and intentionally limited scan/receipt projections."""
from __future__ import annotations

import os
import secrets
from urllib.parse import urlsplit


def token_for(db, asset_id):
    db.execute("INSERT OR IGNORE INTO asset_qr_links(asset_id,token) VALUES(?,?)", (asset_id, secrets.token_urlsafe(24)))
    return db.execute("SELECT token FROM asset_qr_links WHERE asset_id=?", (asset_id,)).fetchone()[0]


def base_url(value=""):
    value = os.environ.get("PUBLIC_BASE_URL") or value or "http://localhost:8000"
    parsed = urlsplit(value)
    # Accessing .port also checks malformed and out-of-range port numbers.
    parsed.port
    if (parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/")
            or any(c.isspace() for c in value)):
        raise ValueError("ที่อยู่ระบบต้องเป็น http:// หรือ https:// ตามด้วยโดเมนและพอร์ต โดยไม่มี path")
    return value.rstrip("/")


def qr_url(db, asset_id, origin=""):
    configured = db.execute("SELECT public_base_url FROM app_branding WHERE id=1").fetchone()
    origin = configured[0] or origin if configured else origin
    return f"{base_url(origin)}/q/{token_for(db, asset_id)}"


def branding(db):
    row = db.execute("SELECT * FROM app_branding WHERE id=1").fetchone()
    return {"appName": row["app_name"], "organization": row["organization"],
            "logo": row["logo"], "publicBaseUrl": row["public_base_url"], "revision": row["revision"],
            "developer": "POWER BY PNG TEAM", "developerColor": "#f97316"}


# Column order of the imported register workbooks (DurableGoodList and the 19 hospital files).
# "ลำดับ" and "วันที่ปัจจุบัน" are spreadsheet bookkeeping, not facts about the asset.
SOURCE_FIELD_ORDER = [
    "สถานะครุภัณฑ์", "บำรุงรักษา", "เลขครุภัณฑ์", "เลขครุภัณฑ์เดิม", "กลุ่มครุภัณฑ์", "ประเภทครุภัณฑ์",
    "ชนิดครุภัณฑ์", "รายละเอียดครุภัณฑ์", "ปีงบที่ได้มา", "เลขที่ GFMIS", "เลขที่ PO", "เลขใบส่งของ", "รุ่น",
    "หมายเลขเครื่อง (Serial Number)", "แบบ/ลักษณะ", "ฝ่าย/สาย รับผิดชอบ", "หน่วยงาน/กอง", "สถานที่ตั้ง",
    "วันที่ส่งมอบ", "วันที่ได้มา", "วิธีการได้มา", "อายุการใช้งาน", "ราคาทุน", "มูลค่าเสื่อม",
    "มูลค่าเสื่อมสะสม", "มูลค่าคงเหลือ", "วันคงเหลือ", "ครุภัณฑ์เช่ายืม", "ราคาเช่า-ยืม", "วันที่แก้ไขล่าสุด",
]
SOURCE_FIELD_SKIP = {"ลำดับ", "วันที่ปัจจุบัน"}
DATE_FIELDS = {"วันที่ส่งมอบ", "วันที่ได้มา", "วันที่แก้ไขล่าสุด", "สิ้นสุดประกัน"}
MONEY_FIELDS = {"ราคาทุน", "มูลค่าเสื่อม", "มูลค่าเสื่อมสะสม", "มูลค่าคงเหลือ", "ราคาเช่า-ยืม", "มูลค่าสุทธิ"}


def _field(label, value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    kind = "date" if label in DATE_FIELDS else "money" if label in MONEY_FIELDS else "text"
    return {"label": label, "value": value if kind == "money" else text, "kind": kind}


def public_fields(db, asset_id):
    """Every filled field of the asset as it appears in the imported register.

    Assets typed into the app (no source row) fall back to the register columns kept in the app.
    """
    import json
    source = db.execute("SELECT raw_data_json FROM source_row_records WHERE asset_id=? AND record_kind='asset' ORDER BY id DESC LIMIT 1", (asset_id,)).fetchone()
    raw = {}
    if source:
        try:
            raw = json.loads(source[0] or "{}")
        except ValueError:
            raw = {}
    if raw:
        ordered = [key for key in SOURCE_FIELD_ORDER if key in raw]
        ordered += [key for key in raw if key not in SOURCE_FIELD_ORDER and key not in SOURCE_FIELD_SKIP]
        return [f for f in (_field(key, raw[key]) for key in ordered) if f]
    from asset_api import asset_detail
    item = asset_detail(db, asset_id) or {}
    pairs = [("เลขครุภัณฑ์", item.get("code")), ("รหัส FSN", item.get("fsnCode")), ("กลุ่มครุภัณฑ์", item.get("group")),
             ("ชนิดครุภัณฑ์", item.get("assetType")), ("รุ่น", item.get("model")),
             ("หมายเลขเครื่อง (Serial Number)", item.get("serialNumber")), ("แบบ/ลักษณะ", item.get("detail")),
             ("ฝ่าย/สาย รับผิดชอบ", item.get("responsibleUnit")), ("หน่วยงาน/กอง", item.get("department")),
             ("ปีงบที่ได้มา", item.get("fiscalYear")), ("วันที่ได้มา", item.get("acquiredOn")),
             ("วิธีการได้มา", item.get("acquisitionMethod")), ("ประเภทเงิน", item.get("fundType")),
             ("เลขที่ GFMIS", item.get("gfmisNo")), ("เลขที่ PO", item.get("poNo")), ("ผู้ขาย", item.get("vendor")),
             ("สิ้นสุดประกัน", item.get("warrantyEnd")), ("อายุการใช้งาน", item.get("usefulLifeYears")),
             ("ราคาทุน", item.get("purchasePrice")), ("มูลค่าเสื่อมสะสม", item.get("accumulatedDepreciation")),
             ("มูลค่าสุทธิ", item.get("netBookValue"))]
    return [f for f in (_field(label, value) for label, value in pairs) if f]


def public_asset(db, row):
    profile = db.execute("SELECT * FROM asset_profiles WHERE asset_id=?", (row["id"],)).fetchone()
    active = db.execute("SELECT COUNT(*) FROM tickets WHERE asset_id=? AND status NOT IN ('ปิดงาน','ยกเลิก','ไม่อนุมัติ')", (row["id"],)).fetchone()[0]
    return {"name": row["name"], "code": row["code"], "detail": row["detail"],
            "location": row["location"], "group": row["group_name"], "status": row["status"],
            "serialNumber": profile["serial_number"] if profile else row["serial_number"],
            "updatedAt": row["updated_at"], "activeRepairs": active,
            "fields": public_fields(db, row["id"])}


def public_receipt(db, row):
    # Names, contact details, internal notes and approval records stay off this view.
    events = [dict(event) for event in db.execute(
        "SELECT to_status AS status,created_at AS createdAt FROM ticket_events WHERE ticket_id=? ORDER BY id", (row["id"],))]
    return {"ticketNo": row["ticket_no"], "assetName": row["asset_name"], "assetCode": row["asset_code"],
            "status": row["status"], "urgency": row["urgency"], "createdAt": row["created_at"],
            "updatedAt": row["updated_at"], "closedAt": row["closed_at"], "events": events,
            "canConfirm": row["status"] == "รอผู้แจ้งยืนยัน"}
