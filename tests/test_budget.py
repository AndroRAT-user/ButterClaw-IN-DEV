from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from butterclaw.budget import BudgetLimitExceeded, BudgetTracker


class BudgetTests(unittest.TestCase):
    def test_budget_blocks_projected_spend(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tracker = BudgetTracker(
                usage_path=Path(tmp) / "usage.json",
                daily_budget_usd=0.000001,
                prompt_usd_per_million=100.0,
                completion_usd_per_million=100.0,
            )
            with self.assertRaises(BudgetLimitExceeded):
                tracker.ensure_request_allowed([{"role": "user", "content": "hello " * 100}])


if __name__ == "__main__":
    unittest.main()

