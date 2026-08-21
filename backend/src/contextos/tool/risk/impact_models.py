from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ImpactIssue:
    issue_type: str
    severity: str
    evidence: dict[str, Any]
    related_ids: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "issue_type": self.issue_type,
            "severity": self.severity,
            "evidence": dict(self.evidence),
            "related_ids": list(self.related_ids),
        }

