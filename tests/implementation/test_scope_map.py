from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
SCOPE_MAP = REPO_ROOT / "docs" / "implementation" / "contextos-v1-scope-map.md"
ARCH_DECISIONS = REPO_ROOT / "docs" / "implementation" / "architecture-decisions.md"


def _markdown_table_rows(markdown: str, heading: str) -> list[list[str]]:
    section = re.search(
        rf"^## {re.escape(heading)}\s*\n(?P<body>.*?)(?=^## |\Z)",
        markdown,
        flags=re.MULTILINE | re.DOTALL,
    )
    if not section:
        return []

    rows: list[list[str]] = []
    for line in section.group("body").splitlines():
        stripped = line.strip()
        if not stripped.startswith("|") or re.fullmatch(r"\|[\s:\-|]+\|", stripped):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if cells and cells[0] not in {"PRD Item", "Scenario", "Success Criterion", "Excluded Capability"}:
            rows.append(cells)
    return rows


def _rows_by_first_cell(rows: list[list[str]]) -> dict[str, list[str]]:
    return {row[0]: row for row in rows}


def _assert_rows_have_task_mappings(testcase: unittest.TestCase, rows: dict[str, list[str]], expected_ids: list[str]) -> None:
    missing = [item_id for item_id in expected_ids if item_id not in rows]
    testcase.assertEqual([], missing)

    for item_id in expected_ids:
        testcase.assertRegex("|".join(rows[item_id][1:]), r"M\d{2}-T\d{2}")


class ScopeMapTests(unittest.TestCase):
    def test_prd_p0_mvp_and_success_criteria_have_task_mappings(self) -> None:
        self.assertTrue(SCOPE_MAP.exists(), f"missing scope map document: {SCOPE_MAP}")
        markdown = SCOPE_MAP.read_text(encoding="utf-8")

        _assert_rows_have_task_mappings(
            self,
            _rows_by_first_cell(_markdown_table_rows(markdown, "P0 Coverage Map")),
            [f"P0-{index}" for index in range(1, 10)],
        )
        _assert_rows_have_task_mappings(
            self,
            _rows_by_first_cell(_markdown_table_rows(markdown, "MVP Scenario Map")),
            [f"MVP-{index}" for index in range(1, 8)],
        )
        _assert_rows_have_task_mappings(
            self,
            _rows_by_first_cell(_markdown_table_rows(markdown, "V1 Success Criteria Map")),
            [f"SC-{index}" for index in range(1, 9)],
        )

    def test_v1_exclusions_are_recorded_without_implementation_tasks(self) -> None:
        self.assertTrue(SCOPE_MAP.exists(), f"missing scope map document: {SCOPE_MAP}")
        self.assertTrue(ARCH_DECISIONS.exists(), f"missing architecture decisions document: {ARCH_DECISIONS}")
        markdown = SCOPE_MAP.read_text(encoding="utf-8")
        decisions = ARCH_DECISIONS.read_text(encoding="utf-8")

        exclusions = _rows_by_first_cell(_markdown_table_rows(markdown, "V1 Exclusion Map"))
        for capability in [
            "多租户 SaaS",
            "Branch Merge",
            "Desktop Client",
            "Marketplace",
            "真正物理删除历史数据",
        ]:
            self.assertIn(capability, exclusions)
            self.assertEqual("无", exclusions[capability][2])

        self.assertIn("实施默认技术栈", decisions)
        self.assertIn("真实仓库已有约定时优先沿用", decisions)


if __name__ == "__main__":
    unittest.main()
