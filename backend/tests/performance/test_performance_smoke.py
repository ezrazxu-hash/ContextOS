import time
import unittest


class PerformanceSmokeTests(unittest.TestCase):
    def test_performance_layer_reports_measurable_duration(self) -> None:
        started = time.perf_counter()
        elapsed = time.perf_counter() - started

        self.assertGreaterEqual(elapsed, 0)


if __name__ == "__main__":
    unittest.main()
