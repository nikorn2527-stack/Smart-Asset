"""Read-only showcase data for the overview page: most borrowed, on loan, status mix, photos.

Every query starts from a small table (movements, custody, photos, tickets) and joins assets by id,
so the cost stays flat on a 66k-row register. Only the status mix and the category bubbles scan the
scoped assets once each.
"""
from __future__ import annotations

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
    }


class DashboardError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def handle(db: sqlite3.Connection, method: str, path: str, query: dict):
    if path != PATH:
        return None
    if method not in ("GET", "HEAD"):
        raise DashboardError("ไม่รองรับคำสั่งนี้", 405)
    return showcase(db, query)
