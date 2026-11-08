"""Read-only statistics derived from asset movement history."""
from datetime import date


def _day(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def usage_statistics(rows, state, today):
    stats = {
        "loanCount": 0, "issueCount": 0, "totalDays": 0,
        "completedCount": 0, "completedDays": 0, "currentDays": None,
        "incompleteCount": 0, "periods": [],
    }
    active = None

    def incomplete():
        stats["incompleteCount"] += 1

    def abandon(row):
        incomplete()
        stats["periods"].append({"kind": row["kind"], "startAt": row["created_at"],
                                 "endAt": None, "days": None, "current": False})

    for row in rows:
        kind = row["kind"]
        if kind in ("loan", "issue"):
            stats["loanCount" if kind == "loan" else "issueCount"] += 1
            if active:
                abandon(active)
            active = row
        elif kind == "return":
            if not active:
                incomplete()
                continue
            start, end = _day(active["created_at"]), _day(row["created_at"])
            days = (end - start).days + 1 if start and end and end >= start else None
            if days is None:
                incomplete()
            else:
                stats["totalDays"] += days
                stats["completedDays"] += days
                stats["completedCount"] += 1
            stats["periods"].append({"kind": active["kind"], "startAt": active["created_at"],
                                     "endAt": row["created_at"], "days": days, "current": False})
            active = None
        elif kind == "intake" and active:
            abandon(active)
            active = None

    if active:
        start = _day(active["created_at"])
        expected = "loaned" if active["kind"] == "loan" else "issued"
        days = (today - start).days + 1 if start and start <= today and state == expected else None
        if days is None:
            incomplete()
        else:
            stats["totalDays"] += days
            stats["currentDays"] = days
        stats["periods"].append({"kind": active["kind"], "startAt": active["created_at"],
                                 "endAt": None, "days": days, "current": days is not None})
    elif state in ("loaned", "issued"):
        incomplete()

    stats["averageDays"] = (round(stats["completedDays"] / stats["completedCount"], 1)
                            if stats["completedCount"] else None)
    stats["periods"].reverse()
    return stats
