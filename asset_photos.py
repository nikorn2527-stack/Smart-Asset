"""Photos attached to an asset register entry.

Images are resized in the browser and stored in SQLite next to the register, so they travel
with the existing database backups. Removing a photo only hides it (removed_at) so the record
of who added or removed it stays in place.
"""
from __future__ import annotations

import base64
import binascii
import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone

# Fixed offset like server.py; Windows Python has no tz database without the tzdata package.
TZ = timezone(timedelta(hours=7), "Asia/Bangkok")
MAX_PHOTOS_PER_ASSET = 12
MAX_FULL_BYTES = 2_500_000
MAX_THUMB_BYTES = 300_000
UPLOAD_BODY_LIMIT = 4_500_000
UPLOAD_PATH = re.compile(r"/api/assets/\d+/photos")
IMAGE_PATH = re.compile(r"/api/assets/(\d+)/photos/(\d+)/(thumb|full)")
BLOCKED_ROLES = {"ผู้แจ้ง"}


class PhotoError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def ensure_schema(db: sqlite3.Connection) -> None:
    db.execute("""CREATE TABLE IF NOT EXISTS asset_photos(
        id INTEGER PRIMARY KEY,
        asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        mime TEXT NOT NULL,
        image BLOB NOT NULL,
        thumb BLOB NOT NULL,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        caption TEXT NOT NULL DEFAULT '',
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        removed_at TEXT,
        removed_by TEXT NOT NULL DEFAULT ''
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_asset_photos_asset ON asset_photos(asset_id, removed_at, is_primary)")


def primary_photo_sql(alias: str = "a") -> str:
    """Sub-select for the photo shown in lists: the primary one, else the newest."""
    return (f"(SELECT p.id FROM asset_photos p WHERE p.asset_id={alias}.id AND p.removed_at IS NULL "
            "ORDER BY p.is_primary DESC, p.id DESC LIMIT 1)")


def _now() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def _decode(data_url: object, label: str, limit: int) -> tuple[str, bytes]:
    if not isinstance(data_url, str):
        raise PhotoError(f"ไม่พบ{label}")
    match = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)", data_url.strip())
    if not match:
        raise PhotoError(f"{label}ต้องเป็นไฟล์ JPG, PNG หรือ WebP")
    try:
        raw = base64.b64decode(match[2], validate=False)
    except (binascii.Error, ValueError):
        raise PhotoError(f"{label}เสียหาย")
    if not raw:
        raise PhotoError(f"{label}ว่างเปล่า")
    if len(raw) > limit:
        raise PhotoError(f"{label}มีขนาดใหญ่เกินไป")
    mime = match[1]
    signatures = {"image/jpeg": raw[:3] == b"\xff\xd8\xff", "image/png": raw[:8] == b"\x89PNG\r\n\x1a\n",
                  "image/webp": raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"}
    if not signatures[mime]:
        raise PhotoError(f"{label}ไม่ใช่ไฟล์รูปที่ถูกต้อง")
    return mime, raw


def _item(row: sqlite3.Row) -> dict:
    base = f"/api/assets/{row['asset_id']}/photos/{row['id']}"
    return {"id": row["id"], "assetId": row["asset_id"], "isPrimary": bool(row["is_primary"]),
            "caption": row["caption"], "width": row["width"], "height": row["height"], "bytes": row["bytes"],
            "createdBy": row["created_by"], "createdAt": row["created_at"],
            "thumbUrl": f"{base}/thumb", "url": f"{base}/full"}


def _list(db: sqlite3.Connection, asset_id: int) -> list[dict]:
    rows = db.execute("SELECT id,asset_id,is_primary,caption,width,height,bytes,created_by,created_at FROM asset_photos "
                      "WHERE asset_id=? AND removed_at IS NULL ORDER BY is_primary DESC, id DESC", (asset_id,)).fetchall()
    return [_item(row) for row in rows]


def _event(db: sqlite3.Connection, asset: sqlite3.Row, actor: str, action: str, note: dict) -> None:
    db.execute("INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)",
               (asset["id"], actor, action, asset["status"], asset["status"], json.dumps(note, ensure_ascii=False), _now()))


def _actor(body: dict) -> str:
    actor = str(body.get("actor") or "").strip()[:160]
    if not actor:
        raise PhotoError("ไม่ทราบผู้ดำเนินการ", 403)
    if actor in BLOCKED_ROLES:
        raise PhotoError("เพิ่มหรือแก้รูปได้เฉพาะเจ้าหน้าที่", 403)
    return actor


def handle(db: sqlite3.Connection, method: str, path: str, body: dict):
    match = re.fullmatch(r"/api/assets/(\d+)/photos(?:/(\d+)/(primary|remove))?", path)
    if not match:
        return None
    asset_id = int(match[1])
    asset = db.execute("SELECT id,status FROM assets WHERE id=?", (asset_id,)).fetchone()
    if asset is None:
        raise PhotoError("ไม่พบครุภัณฑ์", 404)
    if method == "GET" and not match[2]:
        return {"items": _list(db, asset_id), "max": MAX_PHOTOS_PER_ASSET}
    if method != "POST":
        raise PhotoError("ไม่รองรับคำสั่งนี้", 405)
    actor = _actor(body)
    db.execute("BEGIN IMMEDIATE")
    if not match[2]:
        count = db.execute("SELECT COUNT(*) FROM asset_photos WHERE asset_id=? AND removed_at IS NULL", (asset_id,)).fetchone()[0]
        if count >= MAX_PHOTOS_PER_ASSET:
            raise PhotoError(f"เก็บรูปได้สูงสุด {MAX_PHOTOS_PER_ASSET} รูปต่อครุภัณฑ์ ลบรูปเดิมก่อนเพิ่มใหม่")
        mime, image = _decode(body.get("image"), "รูป", MAX_FULL_BYTES)
        _, thumb = _decode(body.get("thumb") or body.get("image"), "รูปย่อ", MAX_THUMB_BYTES if body.get("thumb") else MAX_FULL_BYTES)
        try:
            width, height = max(0, int(body.get("width") or 0)), max(0, int(body.get("height") or 0))
        except (TypeError, ValueError):
            width = height = 0
        caption = str(body.get("caption") or "").strip()[:200]
        primary = 1 if count == 0 else 0
        cur = db.execute("INSERT INTO asset_photos(asset_id,mime,image,thumb,width,height,bytes,caption,is_primary,created_by,created_at) "
                         "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                         (asset_id, mime, image, thumb, width, height, len(image), caption, primary, actor, _now()))
        _event(db, asset, actor, "เพิ่มรูปครุภัณฑ์", {"photoId": cur.lastrowid, "bytes": len(image)})
        row = db.execute("SELECT * FROM asset_photos WHERE id=?", (cur.lastrowid,)).fetchone()
        return _item(row), 201
    photo_id = int(match[2])
    photo = db.execute("SELECT * FROM asset_photos WHERE id=? AND asset_id=? AND removed_at IS NULL", (photo_id, asset_id)).fetchone()
    if photo is None:
        raise PhotoError("ไม่พบรูปนี้", 404)
    if match[3] == "primary":
        db.execute("UPDATE asset_photos SET is_primary=CASE WHEN id=? THEN 1 ELSE 0 END WHERE asset_id=? AND removed_at IS NULL", (photo_id, asset_id))
        _event(db, asset, actor, "ตั้งรูปหลักครุภัณฑ์", {"photoId": photo_id})
    else:
        db.execute("UPDATE asset_photos SET removed_at=?,removed_by=?,is_primary=0 WHERE id=?", (_now(), actor, photo_id))
        if photo["is_primary"]:
            db.execute("UPDATE asset_photos SET is_primary=1 WHERE id=(SELECT id FROM asset_photos WHERE asset_id=? AND removed_at IS NULL ORDER BY id DESC LIMIT 1)", (asset_id,))
        _event(db, asset, actor, "ลบรูปครุภัณฑ์", {"photoId": photo_id})
    return {"items": _list(db, asset_id), "max": MAX_PHOTOS_PER_ASSET}


def image_bytes(db: sqlite3.Connection, asset_id: int, photo_id: int, size: str) -> tuple[str, bytes] | None:
    column = "thumb" if size == "thumb" else "image"
    row = db.execute(f"SELECT mime,{column} AS data FROM asset_photos WHERE id=? AND asset_id=? AND removed_at IS NULL", (photo_id, asset_id)).fetchone()
    if row is None:
        return None
    data = bytes(row["data"])
    if data[:3] == b"\xff\xd8\xff":
        mime = "image/jpeg"
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        mime = row["mime"]
    return mime, data
