from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
MATRIX = REPO_ROOT / "docs" / "implementation" / "v1-acceptance-matrix.md"
VERIFY_SCRIPT = REPO_ROOT / "scripts" / "verify-v1.sh"


class V1ReleaseCandidateGateTests(unittest.TestCase):
    def test_verify_v1_script_runs_core_backend_frontend_e2e_and_performance_gates(self) -> None:
        self.assertTrue(VERIFY_SCRIPT.exists(), f"missing RC script: {VERIFY_SCRIPT}")
        source = VERIFY_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("set -euo pipefail", source)
        self.assertIn("backend/tests/e2e", source)
        self.assertIn("backend/tests/performance", source)
        self.assertIn("npm --prefix studio run test:e2e", source)
        self.assertIn("tests/implementation", source)
        self.assertIn("V1_OUT_OF_SCOPE_NON_BLOCKING", source)

    def test_verify_v1_script_resolves_python_command_before_running_tests(self) -> None:
        self.assertTrue(VERIFY_SCRIPT.exists(), f"missing RC script: {VERIFY_SCRIPT}")
        source = VERIFY_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("PYTHON_BIN", source)
        self.assertIn("PYTHON_BIN=(", source)
        self.assertIn('"${PYTHON_BIN[@]}" -m unittest', source)
        self.assertIn("command -v py.exe", source)
        self.assertIn("command -v python.exe", source)
        self.assertLess(source.index("command -v py.exe"), source.index("command -v python3"))
        self.assertLess(source.index("command -v python.exe"), source.index("command -v python3"))
        self.assertNotIn("PYTHONPATH=\"backend/src\" python -m unittest", source)

    def test_acceptance_matrix_maps_each_success_criterion_to_test_ids_and_evidence(self) -> None:
        self.assertTrue(MATRIX.exists(), f"missing acceptance matrix: {MATRIX}")
        matrix = MATRIX.read_text(encoding="utf-8")

        for index in range(1, 9):
            self.assertRegex(matrix, rf"\|\s*SC-{index}\s*\|")

        rows = [line for line in matrix.splitlines() if re.match(r"\|\s*SC-[1-8]\s*\|", line)]
        self.assertEqual(len(rows), 8)
        for row in rows:
            self.assertRegex(row, r"M\d{2}-T\d{2}-TC\d{2}|test_[a-z0-9_]+|studio/e2e")
            self.assertNotIn("TBD", row)
            self.assertNotIn("TODO", row)


if __name__ == "__main__":
    unittest.main()
