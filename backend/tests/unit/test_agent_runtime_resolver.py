from datetime import datetime, timezone
import unittest
from unittest.mock import patch


class AgentRuntimeResolverTests(unittest.TestCase):
    def test_historical_session_without_agent_version_uses_legacy_runtime(self) -> None:
        from contextos.runtime.agent.resolver import AgentRuntimeResolver

        legacy = object()
        workflow = object()
        resolver = AgentRuntimeResolver(legacy_runtime=legacy, workflow_runtime=workflow, workflow_enabled=True)

        self.assertIs(resolver.resolve(session_with()), legacy)

    def test_feature_flag_off_forces_legacy_runtime(self) -> None:
        from contextos.runtime.agent.resolver import AgentRuntimeResolver

        legacy = object()
        workflow = object()
        resolver = AgentRuntimeResolver(
            legacy_runtime=legacy,
            workflow_runtime=workflow,
            workflow_enabled=False,
            agent_version_loader=lambda version_id: {"id": version_id, "status": "published"},
        )

        self.assertIs(resolver.resolve(session_with(agent_version_id="version-1")), legacy)

    def test_published_agent_version_with_flag_on_uses_workflow_runtime(self) -> None:
        from contextos.runtime.agent.resolver import AgentRuntimeResolver

        legacy = object()
        workflow = object()
        resolver = AgentRuntimeResolver(
            legacy_runtime=legacy,
            workflow_runtime=workflow,
            workflow_enabled=True,
            agent_version_loader=lambda version_id: {"id": version_id, "status": "published"},
        )

        self.assertIs(resolver.resolve(session_with(agent_version_id="version-1")), workflow)

    def test_runtime_services_resolver_uses_workflow_runtime_for_bound_session(self) -> None:
        from contextos.api.server import create_demo_services

        services = create_demo_services()
        session = session_with(agent_version_id="version-1")
        services.agent_version_repository.save_new(fake_published_version("version-1"))

        runtime = services.agent_runtime_resolver.resolve(session)

        self.assertIs(runtime, services.workflow_agent_runtime)

    def test_runtime_services_feature_flag_off_forces_legacy_runtime(self) -> None:
        from contextos.api.server import create_demo_services
        from contextos.runtime.agent.legacy_runtime import LegacyChatRuntime

        services = create_demo_services(workflow_agent_runtime_enabled=False)
        session = session_with(agent_version_id="version-1")
        services.agent_version_repository.save_new(fake_published_version("version-1"))

        runtime = services.agent_runtime_resolver.resolve(session)

        self.assertIsInstance(runtime, LegacyChatRuntime)

    def test_runtime_services_reads_feature_flag_from_environment(self) -> None:
        from contextos.api.server import create_demo_services
        from contextos.runtime.agent.legacy_runtime import LegacyChatRuntime

        with patch.dict("os.environ", {"WORKFLOW_AGENT_RUNTIME_ENABLED": "false"}):
            services = create_demo_services()
        session = session_with(agent_version_id="version-1")
        services.agent_version_repository.save_new(fake_published_version("version-1"))

        runtime = services.agent_runtime_resolver.resolve(session)

        self.assertIsInstance(runtime, LegacyChatRuntime)

    def test_invalid_agent_version_returns_structured_error(self) -> None:
        from contextos.runtime.agent.resolver import AgentRuntimeResolutionError, AgentRuntimeResolver

        resolver = AgentRuntimeResolver(
            legacy_runtime=object(),
            workflow_runtime=object(),
            workflow_enabled=True,
            agent_version_loader=lambda version_id: None,
        )

        with self.assertRaises(AgentRuntimeResolutionError) as error:
            resolver.resolve(session_with(agent_version_id="missing-version"))

        self.assertEqual(error.exception.code, "agent_version.not_found")
        self.assertEqual(error.exception.agent_version_id, "missing-version")


def session_with(agent_version_id: str | None = None):
    from contextos.runtime.session.model import Session, SessionStatus

    metadata = {}
    if agent_version_id is not None:
        metadata["agent_version_id"] = agent_version_id
    return Session(
        id="session-1",
        workspace_id="workspace-1",
        agent_template_id="research-agent",
        current_timeline_id="timeline-1",
        created_at=datetime(2026, 8, 30, tzinfo=timezone.utc),
        status=SessionStatus.ACTIVE,
        metadata=metadata,
    )


def fake_published_version(version_id: str):
    from datetime import datetime, timezone

    from contextos.template.version.model import AgentVersion, AgentVersionStatus

    return AgentVersion(
        id=version_id,
        agent_template_id="research-agent",
        version=1,
        manifest_payload={"schema_version": "1.0"},
        checksum="checksum",
        status=AgentVersionStatus.PUBLISHED,
        published_at=datetime(2026, 8, 30, tzinfo=timezone.utc),
    )


if __name__ == "__main__":
    unittest.main()
