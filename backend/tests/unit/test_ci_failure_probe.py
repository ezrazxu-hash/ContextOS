import os
import unittest


class CiFailureProbeTests(unittest.TestCase):
    def test_ci_failure_probe_is_controlled_by_environment(self) -> None:
        if os.environ.get("CONTEXTOS_FORCE_CI_FAILURE") == "1":
            self.fail("intentional CI failure probe")


if __name__ == "__main__":
    unittest.main()
