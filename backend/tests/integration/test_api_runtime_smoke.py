import unittest
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class ApiRuntimeIntegrationTests(unittest.TestCase):
    def test_api_contracts_import_without_runtime_web_dependency(self) -> None:
        from contextos.api.contracts.common import OperationKind, Transport, transport_for_operation
        import contextos.runtime

        self.assertEqual(transport_for_operation(OperationKind.CRUD), Transport.REST)
        self.assertEqual(contextos.runtime.PACKAGE_ROLE, "runtime")


if __name__ == "__main__":
    unittest.main()
