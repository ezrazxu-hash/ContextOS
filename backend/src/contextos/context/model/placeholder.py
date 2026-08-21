from dataclasses import dataclass
from html import escape


@dataclass(frozen=True)
class Placeholder:
    id: str
    group_id: str
    type: str
    summary: str
    source_count: int
    original_tokens: int
    current_tokens: int
    restorable: bool
    reason: str

    def render_for_compiler(self) -> str:
        restorable = "true" if self.restorable else "false"
        return (
            f'<context-placeholder id="{escape(self.id)}" '
            f'group-id="{escape(self.group_id)}" '
            f'type="{escape(self.type)}" '
            f'source-count="{self.source_count}" '
            f'original-tokens="{self.original_tokens}" '
            f'current-tokens="{self.current_tokens}" '
            f'restorable="{restorable}">\n'
            f"{escape(self.summary)}\n"
            f"{escape(self.reason)}\n"
            "</context-placeholder>"
        )

