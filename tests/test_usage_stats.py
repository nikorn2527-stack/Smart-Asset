import unittest
from datetime import date

from usage_stats import usage_statistics


def movement(kind, stamp):
    return {"kind": kind, "created_at": stamp}


class UsageStatisticsTests(unittest.TestCase):
    def test_completed_and_current_periods_are_inclusive(self):
        rows = [
            movement("loan", "2026-01-01T10:00:00+07:00"),
            movement("return", "2026-01-01T11:00:00+07:00"),
            movement("issue", "2026-01-03T10:00:00+07:00"),
            movement("relocate", "2026-01-04T10:00:00+07:00"),
        ]
        result = usage_statistics(rows, "issued", date(2026, 1, 5))
        self.assertEqual((result["loanCount"], result["issueCount"]), (1, 1))
        self.assertEqual((result["totalDays"], result["currentDays"], result["averageDays"]), (4, 3, 1))
        self.assertEqual(result["periods"][0]["kind"], "issue")
        self.assertEqual(result["periods"][1]["days"], 1)
        self.assertEqual(result["incompleteCount"], 0)

    def test_incomplete_or_invalid_history_is_not_counted_as_zero(self):
        rows = [
            movement("return", "2026-01-01"),
            movement("loan", "2026-01-05"),
            movement("return", "2026-01-03"),
            movement("issue", "invalid"),
        ]
        result = usage_statistics(rows, "issued", date(2026, 1, 5))
        self.assertEqual(result["totalDays"], 0)
        self.assertIsNone(result["averageDays"])
        self.assertIsNone(result["currentDays"])
        self.assertEqual(result["incompleteCount"], 3)
        self.assertTrue(all(period["days"] is None for period in result["periods"]))

    def test_missing_start_and_unexpected_intake_are_flagged(self):
        self.assertEqual(usage_statistics([], "loaned", date(2026, 1, 5))["incompleteCount"], 1)
        rows = [movement("loan", "2026-01-01"), movement("intake", "2026-01-02")]
        result = usage_statistics(rows, "available", date(2026, 1, 5))
        self.assertEqual(result["incompleteCount"], 1)
        self.assertIsNone(result["periods"][0]["days"])

    def test_returned_issue_and_mismatched_open_status(self):
        rows = [movement("issue", "2026-01-01"), movement("return", "2026-01-03"),
                movement("loan", "2026-01-04")]
        result = usage_statistics(rows, "available", date(2026, 1, 5))
        self.assertEqual(result["totalDays"], 3)
        self.assertEqual(result["averageDays"], 3)
        self.assertIsNone(result["currentDays"])
        self.assertEqual(result["incompleteCount"], 1)


if __name__ == "__main__":
    unittest.main()
