"""Photo attachments for repair tickets."""
from __future__ import annotations

import re
import sqlite3

import asset_photos

MAX_PHOTOS_PER_TICKET = 5
MAX_FULL_BYTES = 2_500_000
MAX_THUMB_BYTES = 300_000
UPLOAD_BODY_LIMIT = 12_000_000
UPLOAD_PATH = re.compile(r"/api/tickets")
IMAGE_PATH = re.compile(r"/api/tickets/(\d+)/photos/(\d+)/(thumb|full)")


class TicketPhotoError(Exception):
    pass


def ensure_schema(db: sqlite3.Connection) -> None:
    db.execute("""CREATE TABLE IF NOT EXISTS ticket_photos(
        id INTEGER PRIMARY KEY,
        ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        mime TEXT NOT NULL,
        image BLOB NOT NULL,
        thumb BLOB NOT NULL,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_ticket_photos_ticket ON ticket_photos(ticket_id,id)")


def validate_batch(photos: object) -> list[tuple[str, bytes, bytes, int, int]]:
    if photos is None:
        return []
    if not isinstance(photos, list):
        raise TicketPhotoError("รายการรูปภาพไม่ถูกต้อง")
    if len(photos) > MAX_PHOTOS_PER_TICKET:
        raise TicketPhotoError(f"แนบรูปได้สูงสุด {MAX_PHOTOS_PER_TICKET} รูปต่อใบแจ้งซ่อม")
    prepared = []
    for photo in photos:
        if not isinstance(photo, dict):
            raise TicketPhotoError("ข้อมูลรูปภาพไม่ถูกต้อง")
        try:
            mime, image = asset_photos.decode_image(photo.get("image"), "รูป", MAX_FULL_BYTES)
            _, thumb = asset_photos.decode_image(photo.get("thumb"), "รูปย่อ", MAX_THUMB_BYTES)
            width, height = int(photo.get("width") or 0), int(photo.get("height") or 0)
        except (asset_photos.PhotoError, TypeError, ValueError) as exc:
            raise TicketPhotoError(str(exc) or "ข้อมูลรูปภาพไม่ถูกต้อง") from exc
        if width < 0 or height < 0 or width > 20_000 or height > 20_000:
            raise TicketPhotoError("ขนาดรูปภาพไม่ถูกต้อง")
        prepared.append((mime, image, thumb, width, height))
    return prepared


def save_batch(
    db: sqlite3.Connection,
    ticket_id: int,
    photos: list[tuple[str, bytes, bytes, int, int]],
    actor: str,
    created_at: str,
) -> None:
    db.executemany(
        "INSERT INTO ticket_photos(ticket_id,mime,image,thumb,width,height,bytes,created_by,created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        [(ticket_id, mime, image, thumb, width, height, len(image), actor, created_at)
         for mime, image, thumb, width, height in photos],
    )


def list_photos(db: sqlite3.Connection, ticket_id: int) -> list[dict]:
    rows = db.execute(
        "SELECT id,ticket_id,width,height,bytes,created_by,created_at FROM ticket_photos "
        "WHERE ticket_id=? ORDER BY id",
        (ticket_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "width": row["width"],
            "height": row["height"],
            "bytes": row["bytes"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "thumbUrl": f"/api/tickets/{ticket_id}/photos/{row['id']}/thumb",
            "url": f"/api/tickets/{ticket_id}/photos/{row['id']}/full",
        }
        for row in rows
    ]


def image_bytes(db: sqlite3.Connection, ticket_id: int, photo_id: int, size: str) -> tuple[str, bytes] | None:
    column = "thumb" if size == "thumb" else "image"
    row = db.execute(
        f"SELECT mime,{column} AS data FROM ticket_photos WHERE id=? AND ticket_id=?",
        (photo_id, ticket_id),
    ).fetchone()
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
