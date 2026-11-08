"""Parts, materials, and outside-contractor lines attached to a repair ticket."""
from __future__ import annotations

import re

from governance import ident, text
from qr_smart import fail, now_iso, ticket_scope_sql

KINDS = {"part": "อะไหล่", "material": "วัสดุ", "external_labor": "ช่างนอก/จ้างภายนอก"}
SOURCES = {"stock": "เบิกจากคลัง", "purchase": "จัดซื้อ", "vendor": "ผู้รับจ้างจัดหาให้", "other": "อื่นๆ"}
STATUSES = ("requested", "approved", "received", "cancelled")
CLOSED = ("ปิดงาน", "ยกเลิก", "ไม่อนุมัติ")
ACTIONS = {"approve": "approved", "receive": "received", "cancel": "cancelled", "reopen": "requested"}
ACTION_LABELS = {"approved": "อนุมัติรายการ", "received": "บันทึกรับของ/ดำเนินการแล้ว", "cancelled": "ยกเลิกรายการ", "requested": "ขอรายการอีกครั้ง"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS ticket_work_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('part','material','external_labor')),
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1 CHECK(qty>0),
  unit TEXT NOT NULL DEFAULT '',
  unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost>=0),
  source TEXT NOT NULL DEFAULT 'stock',
  vendor TEXT NOT NULL DEFAULT '',
  vendor_contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','received','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_work_items_ticket ON ticket_work_items(ticket_id,status);
"""


def ensure_schema(db):
    db.executescript(SCHEMA)


def _money(value, label):
    try:
        number = float(value if value not in (None, "") else 0)
    except (TypeError, ValueError):
        fail(label + "ต้องเป็นตัวเลข")
    if number < 0 or number > 100_000_000:
        fail(label + "ไม่ถูกต้อง")
    return round(number, 2)


def _view(row):
    total = round(row["qty"] * row["unit_cost"], 2)
    return {
        "id": row["id"], "ticketId": row["ticket_id"], "kind": row["kind"], "kindLabel": KINDS[row["kind"]],
        "name": row["name"], "qty": row["qty"], "unit": row["unit"], "unitCost": row["unit_cost"], "total": total,
        "source": row["source"], "sourceLabel": SOURCES.get(row["source"], row["source"]),
        "vendor": row["vendor"], "vendorContact": row["vendor_contact"], "status": row["status"],
        "note": row["note"], "createdBy": row["created_by"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }


def _ticket(db, ticket_id):
    row = db.execute(
        "SELECT t.* FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id WHERE t.id=? AND " + ticket_scope_sql(db), (ticket_id,)
    ).fetchone()
    if not row:
        fail("ไม่พบใบแจ้งซ่อมในขอบเขตสิทธิ์", 404)
    return row


def list_items(db, ticket_id):
    _ticket(db, ticket_id)
    rows = db.execute("SELECT * FROM ticket_work_items WHERE ticket_id=? ORDER BY id", (ticket_id,)).fetchall()
    items = [_view(r) for r in rows]
    live = [i for i in items if i["status"] != "cancelled"]
    return {
        "items": items,
        "total": round(sum(i["total"] for i in live), 2),
        "externalVendors": sorted({i["vendor"] for i in live if i["kind"] == "external_labor" and i["vendor"]}),
        "kinds": KINDS, "sources": SOURCES,
    }


def _log(db, ticket, actor, action, note, stamp):
    db.execute(
        "INSERT INTO ticket_events(ticket_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)",
        (ticket["id"], actor, action, ticket["status"], ticket["status"], note, stamp),
    )


def add_item(db, ticket_id, body, actor):
    ticket = _ticket(db, ticket_id)
    if ticket["status"] in CLOSED:
        fail("ใบแจ้งซ่อมปิดแล้ว ไม่สามารถเพิ่มรายการได้", 409)
    kind = text(body.get("kind"), "ประเภทรายการ", 20)
    if kind not in KINDS:
        fail("ประเภทรายการไม่ถูกต้อง")
    name = text(body.get("name"), "ชื่อรายการ", 200)
    qty = _money(body.get("qty", 1), "จำนวน")
    if qty <= 0:
        fail("จำนวนต้องมากกว่า 0")
    source = text(body.get("source") or ("vendor" if kind == "external_labor" else "stock"), "แหล่งที่มา", 20)
    if source not in SOURCES:
        fail("แหล่งที่มาไม่ถูกต้อง")
    vendor = text(body.get("vendor", ""), "ชื่อช่าง/ร้าน/บริษัท", 200, required=kind == "external_labor")
    stamp = now_iso()
    cur = db.execute(
        """INSERT INTO ticket_work_items(ticket_id,kind,name,qty,unit,unit_cost,source,vendor,vendor_contact,note,created_by,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (ticket_id, kind, name, qty, text(body.get("unit", ""), "หน่วย", 40, required=False), _money(body.get("unitCost", 0), "ราคาต่อหน่วย"),
         source, vendor, text(body.get("vendorContact", ""), "ช่องทางติดต่อช่าง/ร้าน", 160, required=False),
         text(body.get("note", ""), "หมายเหตุ", 1000, required=False), actor, stamp, stamp),
    )
    flag = "requires_external" if kind == "external_labor" else "requires_purchase" if source == "purchase" else None
    if flag:
        db.execute(f"UPDATE tickets SET {flag}=1,updated_at=? WHERE id=?", (stamp, ticket_id))
    _log(db, ticket, actor, "เพิ่มรายการ" + KINDS[kind], f"{name}" + (f" · {vendor}" if vendor else ""), stamp)
    return _view(db.execute("SELECT * FROM ticket_work_items WHERE id=?", (cur.lastrowid,)).fetchone())


def change_item(db, ticket_id, item_id, body, actor):
    ticket = _ticket(db, ticket_id)
    row = db.execute("SELECT * FROM ticket_work_items WHERE id=? AND ticket_id=?", (item_id, ticket_id)).fetchone()
    if not row:
        fail("ไม่พบรายการนี้", 404)
    action = text(body.get("action"), "คำสั่ง", 20)
    if action not in ACTIONS:
        fail("คำสั่งไม่ถูกต้อง")
    target = ACTIONS[action]
    flow = {"approved": ("requested",), "received": ("approved",), "cancelled": ("requested", "approved"), "requested": ("cancelled",)}
    if row["status"] not in flow[target]:
        fail("สถานะปัจจุบันไม่รองรับคำสั่งนี้", 409)
    if ticket["status"] in CLOSED and target != "cancelled":
        fail("ใบแจ้งซ่อมปิดแล้ว", 409)
    stamp = now_iso()
    db.execute("UPDATE ticket_work_items SET status=?,updated_at=? WHERE id=?", (target, stamp, item_id))
    _log(db, ticket, actor, ACTION_LABELS[target], f"{KINDS[row['kind']]}: {row['name']}", stamp)
    return _view(db.execute("SELECT * FROM ticket_work_items WHERE id=?", (item_id,)).fetchone())


def handle(db, method, path, query, body):
    match = re.fullmatch(r"/api/tickets/(\d+)/items(?:/(\d+))?", path)
    if not match:
        return None
    ticket_id = ident(int(match[1]))
    ctx = getattr(db, "access", None) or {}
    actor = body.get("actor") or ctx.get("actor") or "เจ้าหน้าที่"
    if method == "GET" and not match[2]:
        return list_items(db, ticket_id)
    if method == "POST" and not match[2]:
        return add_item(db, ticket_id, body, actor), 201
    if method == "PUT" and match[2]:
        return change_item(db, ticket_id, int(match[2]), body, actor)
    fail("ไม่รองรับคำสั่งนี้", 405)
