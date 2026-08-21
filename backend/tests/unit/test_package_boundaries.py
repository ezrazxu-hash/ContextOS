from pathlib import Path
import os
import subprocess
import sys
import textwrap
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = BACKEND_ROOT / "src"


def run_backend_python(script: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    existing_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(SRC_ROOT) if not existing_pythonpath else f"{SRC_ROOT}{os.pathsep}{existing_pythonpath}"
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(script)],
        cwd=BACKEND_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


class BackendPackageBoundaryTests(unittest.TestCase):
    def test_import_contextos_exposes_backend_packages(self) -> None:
        result = run_backend_python(
            """
            import contextos

            expected = {"runtime", "context", "provider", "tool", "template", "api"}
            exported = set(contextos.__all__)
            missing = expected - exported
            if missing:
                raise AssertionError(f"missing exports: {sorted(missing)}")
            """
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_core_packages_import_without_cycles(self) -> None:
        result = run_backend_python(
            """
            import importlib

            orders = [
                ["contextos.runtime", "contextos.context", "contextos.provider", "contextos.tool", "contextos.template", "contextos.api"],
                ["contextos.context", "contextos.runtime", "contextos.api", "contextos.template", "contextos.tool", "contextos.provider"],
            ]
            for order in orders:
                for module_name in order:
                    importlib.import_module(module_name)
            """
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_runtime_and_context_do_not_load_web_server_or_provider_sdks(self) -> None:
        result = run_backend_python(
            """
            import importlib
            import sys

            importlib.import_module("contextos.runtime")
            importlib.import_module("contextos.context")

            forbidden_prefixes = (
                "fastapi",
                "flask",
                "starlette",
                "uvicorn",
                "django",
                "openai",
                "anthropic",
            )
            loaded = sorted(
                name for name in sys.modules
                if name in forbidden_prefixes or name.startswith(tuple(prefix + "." for prefix in forbidden_prefixes))
            )
            if loaded:
                raise AssertionError(f"forbidden modules loaded: {loaded}")
            """
        )

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
