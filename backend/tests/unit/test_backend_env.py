import os
from pathlib import Path
import sys
import tempfile
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class BackendEnvTests(unittest.TestCase):
    def test_default_env_path_points_to_backend_env_file(self) -> None:
        from contextos.api.env import _default_env_path

        self.assertEqual(_default_env_path(), BACKEND_ROOT / ".env")

    def test_load_backend_env_preserves_existing_process_values(self) -> None:
        from contextos.api.env import load_backend_env

        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text("ANTHROPIC_MODEL=file-model\nANTHROPIC_BASE_URL=https://example.test\n", encoding="utf-8")
            original = os.environ.get("ANTHROPIC_MODEL")
            os.environ["ANTHROPIC_MODEL"] = "process-model"
            try:
                load_backend_env(env_path)
                self.assertEqual(os.environ["ANTHROPIC_MODEL"], "process-model")
                self.assertEqual(os.environ["ANTHROPIC_BASE_URL"], "https://example.test")
            finally:
                if original is None:
                    os.environ.pop("ANTHROPIC_MODEL", None)
                else:
                    os.environ["ANTHROPIC_MODEL"] = original
                os.environ.pop("ANTHROPIC_BASE_URL", None)

    def test_disable_llm_env_prevents_real_client_creation(self) -> None:
        from contextos.provider.deepseek_anthropic import create_deepseek_client_from_env

        original = os.environ.get("CONTEXTOS_DISABLE_LLM")
        os.environ["CONTEXTOS_DISABLE_LLM"] = "1"
        try:
            self.assertIsNone(create_deepseek_client_from_env())
        finally:
            if original is None:
                os.environ.pop("CONTEXTOS_DISABLE_LLM", None)
            else:
                os.environ["CONTEXTOS_DISABLE_LLM"] = original


if __name__ == "__main__":
    unittest.main()
