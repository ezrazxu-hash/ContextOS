import unittest


class ToolRiskRegistryTests(unittest.TestCase):
    def test_unknown_tool_defaults_to_write_and_ask(self) -> None:
        from contextos.tool.registry.metadata import ReplayPolicy, SideEffect
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.tool.risk.policy import ReplaySafetyPolicy

        metadata = ToolRegistry().get("custom.unregistered_tool")
        decision = ReplaySafetyPolicy().decision_for(metadata)

        self.assertEqual(metadata.tool_id, "custom.unregistered_tool")
        self.assertEqual(metadata.name, "custom.unregistered_tool")
        self.assertEqual(metadata.side_effect, SideEffect.WRITE)
        self.assertFalse(metadata.idempotent)
        self.assertEqual(metadata.replay_policy, ReplayPolicy.ASK)
        self.assertEqual(decision.replay_policy, ReplayPolicy.ASK)
        self.assertEqual(decision.requires_confirmation, True)

    def test_read_tool_can_replay_automatically(self) -> None:
        from contextos.tool.registry.metadata import ReplayPolicy, SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.tool.risk.policy import ReplaySafetyPolicy

        registry = ToolRegistry()
        registry.register(
            ToolMetadata(
                tool_id="orders.lookup",
                name="Lookup order",
                side_effect=SideEffect.READ,
                idempotent=True,
            )
        )

        decision = ReplaySafetyPolicy().decision_for(registry.get("orders.lookup"))

        self.assertEqual(decision.replay_policy, ReplayPolicy.AUTO)
        self.assertEqual(decision.requires_confirmation, False)

    def test_financial_tool_requires_confirmation(self) -> None:
        from contextos.tool.registry.metadata import ReplayPolicy, SideEffect, ToolMetadata
        from contextos.tool.risk.policy import ReplaySafetyPolicy

        metadata = ToolMetadata(
            tool_id="payments.charge",
            name="Charge payment",
            side_effect=SideEffect.FINANCIAL,
            idempotent=False,
        )

        decision = ReplaySafetyPolicy().decision_for(metadata)

        self.assertEqual(decision.replay_policy, ReplayPolicy.ASK)
        self.assertEqual(decision.requires_confirmation, True)

    def test_side_effect_values_cover_v1_risk_categories(self) -> None:
        from contextos.tool.registry.metadata import SideEffect

        self.assertEqual(
            {effect.value for effect in SideEffect},
            {
                "NONE",
                "READ",
                "WRITE",
                "EXTERNAL_WRITE",
                "DESTRUCTIVE",
                "FINANCIAL",
            },
        )


if __name__ == "__main__":
    unittest.main()
