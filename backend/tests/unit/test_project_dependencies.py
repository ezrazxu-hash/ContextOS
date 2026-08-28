import tomllib
import unittest
from pathlib import Path


class ProjectDependencyTests(unittest.TestCase):
    def test_backend_declares_langgraph_runtime_dependency(self) -> None:
        pyproject = Path(__file__).parents[2] / "pyproject.toml"
        metadata = tomllib.loads(pyproject.read_text(encoding="utf-8"))
        dependencies = metadata["project"]["dependencies"]

        self.assertTrue(
            any(dependency.split("[", 1)[0].split("=", 1)[0].split("<", 1)[0].split(">", 1)[0].strip() == "langgraph" for dependency in dependencies),
            "backend imports langgraph at startup, so pyproject.toml must declare langgraph",
        )


if __name__ == "__main__":
    unittest.main()
