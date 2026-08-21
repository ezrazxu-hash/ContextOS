from dataclasses import dataclass

from contextos.tool.registry.metadata import ReplayPolicy, ToolMetadata


@dataclass(frozen=True)
class ReplayDecision:
    replay_policy: ReplayPolicy
    requires_confirmation: bool


class ReplaySafetyPolicy:
    def decision_for(self, metadata: ToolMetadata) -> ReplayDecision:
        replay_policy = metadata.replay_policy or ReplayPolicy.ASK
        return ReplayDecision(
            replay_policy=replay_policy,
            requires_confirmation=replay_policy == ReplayPolicy.ASK,
        )
