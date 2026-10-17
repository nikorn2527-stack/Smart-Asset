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
            "logo": row["logo"], "publicBaseUrl": row["public_base_url"],
            "developer": "POWER BY PNG TEAM", "developerColor": "#f97316"}


def public_asset(db, row):
    profile = db.execute("SELECT * FROM asset_profiles WHERE asset_id=?", (row["id"],)).fetchone()
    active = db.execute("SELECT COUNT(*) FROM tickets WHERE asset_id=? AND status NOT IN ('ปิดงาน','ยกเลิก','ไม่อนุมัติ')", (row["id"],)).fetchone()[0]
    return {"name": row["name"], "code": row["code"], "detail": row["detail"],
            "location": row["location"], "group": row["group_name"], "status": row["status"],
            "serialNumber": profile["serial_number"] if profile else row["serial_number"],
            "updatedAt": row["updated_at"], "activeRepairs": active}


def public_receipt(db, row):
    # Names, contact details, internal notes and approval records stay off this view.
    events = [dict(event) for event in db.execute(
        "SELECT to_status AS status,created_at AS createdAt FROM ticket_events WHERE ticket_id=? ORDER BY id", (row["id"],))]
    return {"ticketNo": row["ticket_no"], "assetName": row["asset_name"], "assetCode": row["asset_code"],
            "status": row["status"], "urgency": row["urgency"], "createdAt": row["created_at"],
            "updatedAt": row["updated_at"], "closedAt": row["closed_at"], "events": events,
            "canConfirm": row["status"] == "รอผู้แจ้งยืนยัน"}
