"""Overview page data: today's work, featured equipment, most borrowed, on loan, status mix, photos.

Every query starts from a small table (movements, custody, photos, tickets) and joins assets by id,
so the cost stays flat on a 66k-row register. Only the status mix and the category bubbles scan the
scoped assets once each.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone

import access_control as access
from asset_photos import primary_photo_sql

TZ = timezone(timedelta(hours=7), "Asia/Bangkok")
PATH = "/api/dashboard/showcase"
CENTER = {"name": "ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์", "shortName": "ศูนย์แพทย์", "pattern": "ศูนย์แพทย์%"}
READY = ("พร้อมใช้", "ทะเบียนแล้ว")
PENDING = ("รอตรวจสอบ", "รออนุมัติ", "สำรวจแล้ว")
LOAN_BUSY = ("loaned", "issued")
CLOSED_TICKET = ("ปิดงาน", "ยกเลิก", "ไม่อนุมัติ")
BUSY_SQL = "('loaned','issued')"
CLOSED_SQL = "('ปิดงาน','ยกเลิก','ไม่อนุมัติ')"
CACHE_SECONDS = 60
_CACHE: dict[tuple, tuple] = {}


def _int(query: dict, key: str, default: int, low: int, high: int) -> int:
    try:
        value = int((query.get(key) or [default])[0])
    except (TypeError, ValueError):
        value = default
    return max(low, min(high, value))


def _center_filter(db: sqlite3.Connection) -> tuple[str, list]:
    ids = [int(r[0]) for r in db.execute("SELECT id FROM org_units WHERE name LIKE ?", (CENTER["pattern"],))]
    parts = ["a.location LIKE ?"]
    if ids:
        joined = ",".join(map(str, ids))
        parts += [f"a.department_unit_id IN ({joined})", f"a.responsible_unit_id IN ({joined})"]
    return "(" + " OR ".join(parts) + ")", [CENTER["pattern"]]


def _photo(asset_id: int, photo_id) -> dict:
    if not photo_id:
        return {"photoUrl": "", "fullPhotoUrl": ""}
    base = f"/api/assets/{asset_id}/photos/{int(photo_id)}"
    return {"photoUrl": f"{base}/thumb", "fullPhotoUrl": f"{base}/full"}


def _days_left(due: str, today: date):
    try:
        return (date.fromisoformat(due[:10]) - today).days
    except ValueError:
        return None


def _state(row: sqlite3.Row) -> tuple[str, str]:
    loan = row["loan_status"] or "available"
    if loan == "loaned":
        return "loaned", "ถูกยืม"
    if loan == "issued":
        return "issued", "เบิกใช้"
    if row["in_repair"]:
        return "repair", "ซ่อม"
    if row["status"] in READY:
        return "ready", "ว่าง"
    if row["status"] in PENDING:
        return "pending", "รอตรวจ"
    return "other", row["status"] or "ไม่ระบุ"


def _base(row: sqlite3.Row, today: date) -> dict:
    state, label = _state(row)
    due = row["due_at"] or ""
    left = _days_left(due, today) if due and state in LOAN_BUSY else None
    return {"id": row["id"], "code": row["code"] or "", "name": row["name"] or "", "location": row["location"] or "",
            "category": row["category"] or "", "icon": row["icon"] or "", "assetStatus": row["status"] or "",
            "state": state, "stateLabel": label, "dueAt": due if state in LOAN_BUSY else "",
            "daysLeft": left, "overdue": left is not None and left < 0, **_photo(row["id"], row["photo_id"])}


ASSET_COLUMNS = (
    "a.id,a.code,a.name,a.location,a.status,a.icon,"
    "COALESCE(NULLIF(cat.category_name,''),NULLIF(a.group_name,''),'') AS category,"
    "cs.loan_status,cs.due_at,cs.custodian,"
    f"{primary_photo_sql('a')} AS photo_id,"
    f"EXISTS(SELECT 1 FROM tickets t WHERE t.asset_id=a.id AND t.status NOT IN {CLOSED_SQL}) AS in_repair"
)
ASSET_JOINS = ("LEFT JOIN asset_categories cat ON cat.id=a.category_id "
               "LEFT JOIN asset_custody_state cs ON cs.asset_id=a.id")


def _status_counts(db: sqlite3.Connection, where: str, params: list) -> dict:
    by_status = dict(db.execute(f"SELECT a.status,COUNT(*) FROM assets a WHERE {where} GROUP BY a.status", params).fetchall())
    loaned = db.execute(
        f"SELECT a.status,cs.loan_status,COUNT(*) FROM asset_custody_state cs JOIN assets a ON a.id=cs.asset_id "
        f"WHERE cs.loan_status IN {BUSY_SQL} AND {where} GROUP BY a.status,cs.loan_status", params).fetchall()
    repair = dict(db.execute(
        f"SELECT a.status,COUNT(*) FROM assets a WHERE a.id IN (SELECT t.asset_id FROM tickets t WHERE t.asset_id IS NOT NULL "
        f"AND t.status NOT IN {CLOSED_SQL}) AND a.id NOT IN (SELECT asset_id FROM asset_custody_state WHERE loan_status IN {BUSY_SQL}) "
        f"AND {where} GROUP BY a.status", params).fetchall())
    taken: dict[str, int] = {}
    counts = {"total": sum(by_status.values()), "ready": 0, "loaned": 0, "issued": 0, "repair": sum(repair.values()), "pending": 0, "other": 0}
    for status, kind, n in loaned:
        counts[kind] += n
        taken[status] = taken.get(status, 0) + n
    for status, n in repair.items():
        taken[status] = taken.get(status, 0) + n
    for status, n in by_status.items():
        rest = max(0, n - taken.get(status, 0))
        counts["ready" if status in READY else "pending" if status in PENDING else "other"] += rest
    return counts


def _top_borrowed(db, where, params, since, limit, today):
    rows = db.execute(
        f"SELECT {ASSET_COLUMNS},m.n,m.recent,m.last_at FROM (SELECT asset_id,COUNT(*) AS n,SUM(created_at>=?) AS recent,"
        "MAX(created_at) AS last_at FROM asset_movements WHERE kind IN ('loan','issue') GROUP BY asset_id) m "
        f"JOIN assets a ON a.id=m.asset_id {ASSET_JOINS} WHERE {where} ORDER BY m.n DESC,m.last_at DESC,a.id LIMIT ?",
        [since, *params, limit]).fetchall()
    return [{**_base(r, today), "borrowCount": r["n"], "recentCount": r["recent"] or 0, "lastBorrowedAt": r["last_at"] or ""} for r in rows]


def _on_loan(db, where, params, limit, today):
    iso_today = today.isoformat()
    total, overdue = db.execute(
        f"SELECT COUNT(*),COALESCE(SUM(cs.due_at<>'' AND cs.due_at<?),0) FROM asset_custody_state cs JOIN assets a ON a.id=cs.asset_id "
        f"WHERE cs.loan_status IN {BUSY_SQL} AND {where}", [iso_today, *params]).fetchone()
    rows = db.execute(
        f"SELECT {ASSET_COLUMNS},(SELECT MAX(m.created_at) FROM asset_movements m WHERE m.asset_id=a.id AND m.kind IN ('loan','issue')) AS since "
        f"FROM asset_custody_state busy JOIN assets a ON a.id=busy.asset_id {ASSET_JOINS} WHERE busy.loan_status IN {BUSY_SQL} AND {where} "
        "ORDER BY CASE WHEN busy.due_at='' THEN 1 ELSE 0 END,busy.due_at,a.id LIMIT ?", [*params, limit]).fetchall()
    items = [{**_base(r, today), "holder": r["custodian"] or "", "since": r["since"] or ""} for r in rows]
    return {"total": total, "overdue": overdue, "items": items}


def _recent_photos(db, where, params, limit, today):
    total = db.execute(
        f"SELECT COUNT(*) FROM (SELECT DISTINCT asset_id FROM asset_photos WHERE removed_at IS NULL) p JOIN assets a ON a.id=p.asset_id WHERE {where}",
        params).fetchone()[0]
    rows = db.execute(
        f"SELECT {ASSET_COLUMNS},p.last_id,p.n FROM (SELECT asset_id,MAX(id) AS last_id,COUNT(*) AS n FROM asset_photos "
        f"WHERE removed_at IS NULL GROUP BY asset_id) p JOIN assets a ON a.id=p.asset_id {ASSET_JOINS} WHERE {where} "
        "ORDER BY p.last_id DESC LIMIT ?", [*params, limit]).fetchall()
    items = []
    for r in rows:
        ids = db.execute("SELECT id FROM asset_photos WHERE asset_id=? AND removed_at IS NULL ORDER BY is_primary DESC,id DESC LIMIT 4",
                         (r["id"],)).fetchall()
        items.append({**_base(r, today), **_photo(r["id"], r["last_id"]), "photoCount": r["n"],
                      "gallery": [_photo(r["id"], pid[0]) for pid in ids]})
    return {"total": total, "items": items}


def _categories(db, where, params) -> list[dict]:
    rows = db.execute(
        "SELECT COALESCE(NULLIF(cat.category_name,''),NULLIF(a.group_name,''),'ไม่ระบุหมวด') AS label,COUNT(*) AS n "
        f"FROM assets a LEFT JOIN asset_categories cat ON cat.id=a.category_id WHERE {where} GROUP BY label ORDER BY n DESC,label",
        params).fetchall()
    return [{"name": r["label"], "count": r["n"]} for r in rows]


def _cached(db, key: tuple, build):
    """Register-wide scans are reused for a minute unless assets, loans or tickets were added."""
    stamp = db.execute("SELECT (SELECT MAX(id) FROM assets),(SELECT MAX(id) FROM asset_movements),(SELECT MAX(id) FROM tickets)").fetchone()
    full_key = (*key, *stamp)
    hit = _CACHE.get(key)
    if hit and hit[0] == full_key and time.monotonic() - hit[1] < CACHE_SECONDS:
        return hit[2]
    value = build()
    if len(_CACHE) > 64:
        _CACHE.clear()
    _CACHE[key] = (full_key, time.monotonic(), value)
    return value


def _borrow_enabled(db) -> bool:
    try:
        from qr_smart import flags
        return bool(flags(db)["flags"].get("borrowIssueReturn"))
    except (sqlite3.Error, KeyError, ValueError):
        return False


def showcase(db: sqlite3.Connection, query: dict) -> dict:
    now = datetime.now(TZ)
    today = now.date()
    days = _int(query, "days", 90, 1, 3650)
    since = (today - timedelta(days=days)).isoformat()
    focus = "center" if (query.get("focus") or [""])[0] == "center" else "all"
    scope = access.scope_sql(db)
    center_sql, center_params = _center_filter(db)
    center_where = f"{scope} AND {center_sql}"
    where, params = (center_where, center_params) if focus == "center" else (scope, [])
    db_file = db.execute("PRAGMA database_list").fetchone()[2]

    def register_scan():
        center_categories = _categories(db, center_where, center_params)
        bubbles = center_categories or _categories(db, scope, [])
        return {"statusCounts": _status_counts(db, where, params), "centerTotal": sum(c["count"] for c in center_categories),
                "bubbles": bubbles[:8], "centerMatched": bool(center_categories)}

    scan = _cached(db, (db_file, scope, focus), register_scan)
    center_total = scan["centerTotal"]
    return {
        "generatedAt": now.isoformat(timespec="seconds"),
        "today": today.isoformat(),
        "windowDays": days,
        "focus": focus,
        "borrowEnabled": _borrow_enabled(db),
        "statusCounts": scan["statusCounts"],
        "topBorrowed": _top_borrowed(db, where, params, since, _int(query, "limit", 8, 1, 24), today),
        "onLoan": _on_loan(db, where, params, 12, today),
        "recentPhotos": _recent_photos(db, where, params, _int(query, "photos", 12, 1, 30), today),
        "center": {"name": CENTER["name"], "shortName": CENTER["shortName"], "total": center_total,
                   "categoriesScope": "center" if scan["centerMatched"] else "all", "categories": scan["bubbles"]},
        "todayWork": _today_work(db, today),
        "featured": _featured(db, today),
        "featuredMax": FEATURED_MAX,
    }


def _days_since(stamp: str, today: date):
    try:
        return (today - date.fromisoformat(str(stamp)[:10])).days
    except ValueError:
        return None


def _today_work(db: sqlite3.Connection, today: date) -> dict:
    """Work waiting on someone today; every query is bounded by a status index or a small table."""
    from qr_smart import ticket_scope_sql
    scope = access.scope_sql(db)
    tickets_scope = ticket_scope_sql(db)
    iso = today.isoformat()
    ticket_cols = "t.id,t.ticket_no,t.asset_id,t.asset_name,t.status,t.urgency,t.assigned_to,t.created_at,t.estimate_cost,t.actual_cost"
    ticket_from = f"FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id WHERE {tickets_scope}"

    def ticket(row):
        return {"kind": "ticket", "id": row["id"], "ticketNo": row["ticket_no"], "assetId": row["asset_id"],
                "title": row["asset_name"], "status": row["status"], "urgency": row["urgency"],
                "assignedTo": row["assigned_to"], "createdAt": row["created_at"], "ageDays": _days_since(row["created_at"], today),
                "amount": row["actual_cost"] if row["status"] == "รออนุมัติค่าใช้จ่ายจริง" else row["estimate_cost"]}

    approval_sql = "t.status IN ('รออนุมัติ','รออนุมัติค่าใช้จ่ายจริง')"
    approval_tickets = db.execute(f"SELECT COUNT(*) {ticket_from} AND {approval_sql}").fetchone()[0]
    approval_assets = db.execute(f"SELECT COUNT(*) FROM assets a WHERE a.status='รออนุมัติ' AND {scope}").fetchone()[0]
    approvals = [ticket(r) for r in db.execute(f"SELECT {ticket_cols} {ticket_from} AND {approval_sql} ORDER BY t.created_at,t.id LIMIT 6")]
    approvals += [{"kind": "asset", "id": r["id"], "assetId": r["id"], "code": r["code"] or "", "title": r["name"] or "",
                   "status": "รออนุมัติ", "createdAt": r["created_at"] or "", "createdBy": r["created_by"] or "",
                   "ageDays": _days_since(r["created_at"] or "", today)}
                  for r in db.execute(f"SELECT a.id,a.code,a.name,a.created_at,a.created_by FROM assets a WHERE a.status='รออนุมัติ' AND {scope} ORDER BY a.id LIMIT 6")]
    approvals.sort(key=lambda item: (str(item["createdAt"]), item["id"]))

    open_sql = f"t.status NOT IN {CLOSED_SQL}"
    by_status = dict(db.execute(f"SELECT t.status,COUNT(*) {ticket_from} AND {open_sql} GROUP BY t.status").fetchall())
    repairs = [ticket(r) for r in db.execute(
        f"SELECT {ticket_cols} {ticket_from} AND {open_sql} ORDER BY CASE WHEN t.status='รับแจ้งใหม่' THEN 0 ELSE 1 END,t.created_at,t.id LIMIT 12")]

    work_from = ("FROM scheduled_work w JOIN work_plans p ON p.id=w.plan_id JOIN assets a ON a.id=w.asset_id "
                 f"WHERE w.status<>'completed' AND w.due_on<=? AND {scope}")
    work_total, work_overdue = db.execute(f"SELECT COUNT(*),COALESCE(SUM(w.due_on<?),0) {work_from}", (iso, iso)).fetchone()
    work = [{"id": r["id"], "assetId": r["asset_id"], "title": r["name"] or "", "code": r["code"] or "", "kind": r["kind"],
             "planName": r["plan_name"], "dueOn": r["due_on"], "assignee": r["assignee"], "status": r["status"],
             "daysLate": max(0, _days_since(r["due_on"], today) or 0)}
            for r in db.execute(f"SELECT w.id,w.asset_id,w.due_on,w.assignee,w.status,p.kind,p.name AS plan_name,a.name,a.code {work_from} "
                                "ORDER BY w.due_on,w.id LIMIT 6", (iso,))]

    loan_from = (f"FROM asset_custody_state cs JOIN assets a ON a.id=cs.asset_id WHERE cs.loan_status IN {BUSY_SQL} "
                 f"AND cs.due_at<>'' AND cs.due_at<? AND {scope}")
    loan_total = db.execute(f"SELECT COUNT(*) {loan_from}", (iso,)).fetchone()[0]
    loans = [{"id": r["id"], "assetId": r["id"], "title": r["name"] or "", "code": r["code"] or "", "holder": r["custodian"] or "",
              "dueAt": r["due_at"], "state": r["loan_status"], "daysLate": max(0, _days_since(r["due_at"], today) or 0),
              **_photo(r["id"], r["photo_id"])}
             for r in db.execute(f"SELECT a.id,a.name,a.code,cs.custodian,cs.due_at,cs.loan_status,{primary_photo_sql('a')} AS photo_id "
                                 f"{loan_from} ORDER BY cs.due_at,a.id LIMIT 6", (iso,))]
    return {
        "approvals": {"total": approval_tickets + approval_assets, "tickets": approval_tickets, "assets": approval_assets, "items": approvals[:6]},
        "repairs": {"total": sum(by_status.values()), "byStatus": by_status, "items": repairs},
        "maintenance": {"total": work_total, "overdue": work_overdue, "dueToday": work_total - work_overdue, "items": work},
        "overdueLoans": {"total": loan_total, "items": loans},
    }


# ---------- featured equipment ----------
FEATURED_MAX = 12
NOTE_MAX = 200
BLOCKED_ROLES = {"ผู้แจ้ง"}
FEATURED_PATH = re.compile(r"/api/assets/(\d+)/featured(?:/(remove))?")
ORDER_PATH = "/api/assets/featured/order"


def ensure_schema(db: sqlite3.Connection) -> None:
    db.execute("""CREATE TABLE IF NOT EXISTS dashboard_featured(
        asset_id INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        sort INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        pinned_by TEXT NOT NULL DEFAULT '',
        pinned_at TEXT NOT NULL
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_dashboard_featured_sort ON dashboard_featured(sort,asset_id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_scheduled_work_open_due ON scheduled_work(status,due_on)")


def _featured(db: sqlite3.Connection, today: date) -> list[dict]:
    rows = db.execute(
        f"SELECT {ASSET_COLUMNS},f.sort,f.note,f.pinned_by,f.pinned_at,"
        "(SELECT COUNT(*) FROM asset_movements m WHERE m.asset_id=a.id AND m.kind IN ('loan','issue')) AS borrow_count,"
        "(SELECT COUNT(*) FROM asset_photos p WHERE p.asset_id=a.id AND p.removed_at IS NULL) AS photo_count "
        f"FROM dashboard_featured f JOIN assets a ON a.id=f.asset_id {ASSET_JOINS} WHERE {access.scope_sql(db)} "
        "ORDER BY f.sort,f.pinned_at,a.id LIMIT ?", (FEATURED_MAX,)).fetchall()
    return [{**_base(r, today), "note": r["note"], "pinnedBy": r["pinned_by"], "pinnedAt": r["pinned_at"],
             "borrowCount": r["borrow_count"], "photoCount": r["photo_count"],
             "holder": (r["custodian"] or "") if r["loan_status"] in LOAN_BUSY else ""} for r in rows]


def _featured_payload(db: sqlite3.Connection) -> dict:
    return {"items": _featured(db, datetime.now(TZ).date()), "max": FEATURED_MAX}


def _actor(body: dict) -> str:
    actor = str(body.get("actor") or "").strip()[:160]
    if not actor:
        raise DashboardError("ไม่ทราบผู้ดำเนินการ", 403)
    if actor in BLOCKED_ROLES:
        raise DashboardError("ปักหมุดอุปกรณ์เด่นได้เฉพาะเจ้าหน้าที่", 403)
    return actor


def _event(db, asset: sqlite3.Row, actor: str, action: str, note: dict) -> None:
    db.execute("INSERT INTO asset_events(asset_id,actor,action,from_status,to_status,note,created_at) VALUES(?,?,?,?,?,?,?)",
               (asset["id"], actor, action, asset["status"], asset["status"], json.dumps(note, ensure_ascii=False),
                datetime.now(TZ).isoformat(timespec="seconds")))


def _visible_asset(db, asset_id: int) -> sqlite3.Row:
    asset = db.execute(f"SELECT a.id,a.code,a.name,a.status FROM assets a WHERE a.id=? AND {access.scope_sql(db)}", (asset_id,)).fetchone()
    if asset is None:
        raise DashboardError("ไม่พบครุภัณฑ์", 404)
    return asset


def _pin_state(db, asset: sqlite3.Row) -> dict:
    row = db.execute("SELECT sort,note,pinned_by,pinned_at FROM dashboard_featured WHERE asset_id=?", (asset["id"],)).fetchone()
    photo = db.execute(f"SELECT {primary_photo_sql('a')} FROM assets a WHERE a.id=?", (asset["id"],)).fetchone()[0]
    total = db.execute("SELECT COUNT(*) FROM dashboard_featured").fetchone()[0]
    return {"assetId": asset["id"], "pinned": row is not None, "note": row["note"] if row else "",
            "pinnedBy": row["pinned_by"] if row else "", "pinnedAt": row["pinned_at"] if row else "",
            "total": total, "max": FEATURED_MAX,
            "asset": {"id": asset["id"], "code": asset["code"] or "", "name": asset["name"] or "", **_photo(asset["id"], photo)}}


def _pin(db, asset_id: int, body: dict, remove: bool):
    actor = _actor(body)
    asset = _visible_asset(db, asset_id)
    db.execute("BEGIN IMMEDIATE")
    current = db.execute("SELECT note FROM dashboard_featured WHERE asset_id=?", (asset_id,)).fetchone()
    if remove:
        if current is None:
            raise DashboardError("รายการนี้ไม่ได้ปักหมุดไว้", 404)
        db.execute("DELETE FROM dashboard_featured WHERE asset_id=?", (asset_id,))
        _event(db, asset, actor, "เลิกปักหมุดอุปกรณ์เด่น", {"note": current["note"]})
        return {**_featured_payload(db), "state": _pin_state(db, asset)}
    note = str(body.get("note") or "").strip()
    if len(note) > NOTE_MAX:
        raise DashboardError(f"บันทึกย่อยาวได้ไม่เกิน {NOTE_MAX} ตัวอักษร")
    if current is None:
        if db.execute("SELECT COUNT(*) FROM dashboard_featured").fetchone()[0] >= FEATURED_MAX:
            raise DashboardError(f"ปักหมุดได้สูงสุด {FEATURED_MAX} รายการ เลิกปักหมุดรายการเดิมก่อน", 409)
        sort = db.execute("SELECT COALESCE(MAX(sort),0)+1 FROM dashboard_featured").fetchone()[0]
        db.execute("INSERT INTO dashboard_featured(asset_id,sort,note,pinned_by,pinned_at) VALUES(?,?,?,?,?)",
                   (asset_id, sort, note, actor, datetime.now(TZ).isoformat(timespec="seconds")))
        _event(db, asset, actor, "ปักหมุดอุปกรณ์เด่น", {"note": note})
        status = 201
    else:
        db.execute("UPDATE dashboard_featured SET note=? WHERE asset_id=?", (note, asset_id))
        _event(db, asset, actor, "แก้บันทึกอุปกรณ์เด่น", {"note": note})
        status = 200
    return {**_featured_payload(db), "state": _pin_state(db, asset)}, status


def _reorder(db, body: dict) -> dict:
    _actor(body)
    ids = body.get("assetIds")
    if not isinstance(ids, list) or not ids or any(type(i) is not int for i in ids) or len(set(ids)) != len(ids):
        raise DashboardError("ลำดับอุปกรณ์เด่นไม่ถูกต้อง")
    db.execute("BEGIN IMMEDIATE")
    marks = ",".join("?" * len(ids))
    rows = db.execute(f"SELECT f.asset_id,f.sort FROM dashboard_featured f JOIN assets a ON a.id=f.asset_id "
                      f"WHERE f.asset_id IN ({marks}) AND {access.scope_sql(db)}", ids).fetchall()
    if len(rows) != len(ids):
        raise DashboardError("มีรายการที่ไม่ได้ปักหมุดหรืออยู่นอกขอบเขตสิทธิ์", 404)
    # Only the listed pins trade places; pins outside the caller's scope keep their slots.
    slots = sorted(r["sort"] for r in rows)
    if len(set(slots)) != len(slots):
        base = db.execute("SELECT COALESCE(MAX(sort),0) FROM dashboard_featured").fetchone()[0]
        slots = [base + i + 1 for i in range(len(ids))]
    for asset_id, sort in zip(ids, slots):
        db.execute("UPDATE dashboard_featured SET sort=? WHERE asset_id=?", (sort, asset_id))
    return _featured_payload(db)


class DashboardError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def handle(db: sqlite3.Connection, method: str, path: str, query: dict, body: dict | None = None):
    body = body or {}
    if path == PATH:
        if method not in ("GET", "HEAD"):
            raise DashboardError("ไม่รองรับคำสั่งนี้", 405)
        return showcase(db, query)
    if path == ORDER_PATH:
        if method != "POST":
            raise DashboardError("ไม่รองรับคำสั่งนี้", 405)
        return _reorder(db, body)
    match = FEATURED_PATH.fullmatch(path)
    if not match:
        return None
    if method in ("GET", "HEAD") and not match[2]:
        return _pin_state(db, _visible_asset(db, int(match[1])))
    if method != "POST":
        raise DashboardError("ไม่รองรับคำสั่งนี้", 405)
    return _pin(db, int(match[1]), body, remove=bool(match[2]))
