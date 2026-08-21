from dataclasses import dataclass


@dataclass(frozen=True)
class MessageEditRequest:
    new_content: str
    operator: str
    reason: str


@dataclass(frozen=True)
class ImpactSummary:
    message_id: str
    revision_id: str
    triggered: bool
    requires_replay: bool
    checks: list[str]
    issues: list[dict[str, object]] | None = None

    def to_dict(self) -> dict[str, object]:
        payload = {
            "message_id": self.message_id,
            "revision_id": self.revision_id,
            "triggered": self.triggered,
            "requires_replay": self.requires_replay,
            "checks": list(self.checks),
        }
        if self.issues is not None:
            payload["issues"] = list(self.issues)
        return payload


def parse_message_edit_request(payload: dict[str, object]) -> MessageEditRequest:
    return MessageEditRequest(
        new_content=str(payload["new_content"]),
        operator=str(payload.get("operator", "user")),
        reason=str(payload.get("reason", "edit")),
    )
