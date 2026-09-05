from pathlib import Path
import json
import sys
import tempfile
import unittest
from urllib.request import Request, urlopen


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class HttpRuntimeHostTests(unittest.TestCase):
    def test_host_serves_demo_session_contracts_over_http(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            health = get_json(f"{host.url}/health")
            session = get_json(f"{host.url}/api/sessions/demo-session")
            messages = get_json(f"{host.url}/api/sessions/demo-session/messages")
            debug = get_json(f"{host.url}/api/debug/sessions/demo-session?traceId=trace-send-report-email")
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat")
        finally:
            host.stop()

        self.assertEqual(health["status"], "ok")
        self.assertEqual(session["id"], "demo-session")
        self.assertEqual(session["current_timeline_id"], "demo-timeline")
        self.assertGreaterEqual(len(messages["messages"]), 2)
        self.assertIsNone(messages["next_cursor"])
        self.assertEqual(debug["session"]["id"], "demo-session")
        self.assertEqual(debug["traces"]["items"][0]["trace_id"], "trace-send-report-email")
        self.assertIn("event: token", sse)
        self.assertIn("event: done", sse)

    def test_host_accepts_session_message_post_over_http(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            created = post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "Run the Studio interaction smoke.", "token_count": 6},
            )
            messages = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertEqual(created["role"], "user")
        self.assertEqual(created["content"], "Run the Studio interaction smoke.")
        self.assertIn("Run the Studio interaction smoke.", [message["content"] for message in messages["messages"]])

    def test_host_runs_agent_version_test_run_over_http_without_formal_messages(self) -> None:
        from contextos.api.server import HttpRuntimeHost, create_demo_services

        services = create_demo_services(llm_client=RecordingLlmClient("test run ok"))
        version = services.agent_version_service.create_published_version("research-agent", agent_test_run_manifest_payload())
        host = HttpRuntimeHost(host="127.0.0.1", port=0, services=services)
        host.start()
        try:
            before = get_json(f"{host.url}/api/sessions/demo-session/messages")
            created = post_json(f"{host.url}/api/agent-versions/{version.id}/test-runs", {"input": "hello"})
            sse = get_text(f"{host.url}/sse/agent-test-runs/{created['run_id']}")
            status = get_json(f"{host.url}/api/agent-test-runs/{created['run_id']}")
            after = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertEqual(created["status"], "completed")
        self.assertEqual(status["status"], "completed")
        self.assertIn("event: token", sse)
        self.assertEqual([message["id"] for message in after["messages"]], [message["id"] for message in before["messages"]])

    def test_host_publishes_agent_draft_and_serves_versions_over_http(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=RecordingLlmClient("publish ok"))
        host.start()
        try:
            draft = agent_test_run_manifest_payload()
            draft["template"] = {"id": "research-agent", "name": "Research Agent", "version": "draft"}
            post_json(f"{host.url}/api/templates", draft)
            put_json(f"{host.url}/api/agents/research-agent/draft", draft)
            published = post_json(f"{host.url}/api/agents/research-agent/publish", {})
            versions = get_json(f"{host.url}/api/agents/research-agent/versions")
            loaded = get_json(f"{host.url}/api/agent-versions/{published['id']}")
        finally:
            host.stop()

        self.assertEqual(published["agent_template_id"], "research-agent")
        self.assertEqual(published["status"], "published")
        self.assertEqual(versions["versions"][0]["id"], published["id"])
        self.assertEqual(loaded["id"], published["id"])
        self.assertEqual(loaded["manifest"]["schema_version"], "1.0")

    def test_host_creates_workflow_v2_definition_by_default(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            created = post_json(f"{host.url}/api/workflows", {"id": "support-flow", "name": "Support Flow"})
        finally:
            host.stop()

        self.assertEqual(created["id"], "support-flow")
        self.assertEqual(created["schemaVersion"], 2)
        self.assertEqual(created["nodes"], [])
        self.assertEqual(created["edges"], [])

    def test_host_round_trips_workflow_v2_draft_with_revision_conflict(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            created = post_json(f"{host.url}/api/workflows", {"id": "support-flow", "name": "Support Flow"})
            loaded = get_json(f"{host.url}/api/workflows/support-flow")
            saved = put_json(
                f"{host.url}/api/workflows/support-flow/draft",
                {**loaded, "nodes": [{"id": "agent-1", "type": "agent"}]},
            )
            conflict = put_json_error(f"{host.url}/api/workflows/support-flow/draft", {**loaded, "nodes": []})
            reloaded = get_json(f"{host.url}/api/workflows/support-flow")
        finally:
            host.stop()

        self.assertEqual(created["revision"], 1)
        self.assertEqual(loaded, created)
        self.assertEqual(saved["revision"], 2)
        self.assertEqual(reloaded["nodes"], [{"id": "agent-1", "type": "agent"}])
        self.assertEqual(conflict["status"], 409)
        self.assertEqual(conflict["body"]["error"]["code"], "workflow.revision_conflict")

    def test_host_validates_workflow_v2_topology(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            created = post_json(
                f"{host.url}/api/workflows",
                {
                    "id": "support-flow",
                    "name": "Support Flow",
                    "nodes": [{"id": "agent-1", "type": "agent", "config": {"instruction": "Analyze the request."}}],
                    "edges": [{"source": "START", "target": "missing"}],
                },
            )
            validation = post_json(f"{host.url}/api/workflows/support-flow/validate", {})
        finally:
            host.stop()

        self.assertEqual(created["schemaVersion"], 2)
        self.assertFalse(validation["valid"])
        self.assertEqual(validation["errors"][0]["code"], "missing_end_node")
        self.assertEqual(validation["errors"][1]["code"], "unknown_node")

    def test_host_lists_workflow_tools_over_v2_catalog_api(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            catalog = get_json(f"{host.url}/api/workflow-tools")
        finally:
            host.stop()

        self.assertEqual(catalog["tools"][0]["id"], "context.echo")
        self.assertEqual(catalog["tools"][0]["name"], "Context Echo")
        self.assertIn("inputSchema", catalog["tools"][0])
        self.assertNotIn("tool_node", json.dumps(catalog))

    def test_host_publishes_workflow_v2_versions_as_immutable_snapshots(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            post_json(f"{host.url}/api/workflows", {"id": "invalid-flow", "name": "Invalid Flow", "nodes": [{"id": "agent-1", "type": "agent"}]})
            invalid_publish = post_json_error(f"{host.url}/api/workflows/invalid-flow/publish", {})
            created = post_json(f"{host.url}/api/workflows", valid_workflow_v2_definition("First instruction"))
            v1 = post_json(f"{host.url}/api/workflows/support-flow/publish", {})
            saved = put_json(
                f"{host.url}/api/workflows/support-flow/draft",
                {**created, **valid_workflow_v2_definition("Second instruction")},
            )
            v2 = post_json(f"{host.url}/api/workflows/support-flow/publish", {})
            versions = get_json(f"{host.url}/api/workflows/support-flow/versions")
            version_one = get_json(f"{host.url}/api/workflows/support-flow/versions/1")
        finally:
            host.stop()

        self.assertEqual(invalid_publish["status"], 422)
        self.assertEqual(invalid_publish["body"]["error"]["code"], "workflow.validation_failed")
        self.assertEqual(v1["version"], 1)
        self.assertEqual(saved["revision"], 2)
        self.assertEqual(v2["version"], 2)
        self.assertEqual([item["version"] for item in versions["versions"]], [1, 2])
        self.assertEqual(version_one["definition"]["nodes"][0]["config"]["instruction"], "First instruction")
        self.assertEqual(v2["definition"]["nodes"][0]["config"]["instruction"], "Second instruction")

    def test_host_runs_workflow_v2_single_agent_published_version_without_persisting_instruction(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=RecordingLlmClient('{"summary": "Need API work"}'))
        host.start()
        try:
            before = get_json(f"{host.url}/api/sessions/demo-session/messages")
            post_json(f"{host.url}/api/workflows", valid_workflow_v2_definition("Transient node instruction"))
            published = post_json(f"{host.url}/api/workflows/support-flow/publish", {})
            started = post_json(
                f"{host.url}/api/workflows/support-flow/runs",
                {"version": published["version"], "input": {"message": "Please classify this request"}},
            )
            loaded = get_json(f"{host.url}/api/workflow-runs/{started['id']}")
            after = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertEqual(started["status"], "succeeded")
        self.assertEqual(loaded["output"], {"summary": "Need API work"})
        self.assertEqual(loaded["workflowVersion"], 1)
        self.assertEqual([message["id"] for message in after["messages"]], [message["id"] for message in before["messages"]])
        self.assertNotIn("Transient node instruction", json.dumps(after))

    def test_host_runs_workflow_v2_agent_tool_loop_with_execution_details(self) -> None:
        from contextos.api.server import create_http_runtime_host

        definition = valid_workflow_v2_definition("Use context echo before answering")
        definition["tools"] = ["context.echo"]
        definition["nodes"][0]["config"]["toolPolicy"] = {"mode": "auto", "allowedTools": ["context.echo"]}
        host = create_http_runtime_host(
            host="127.0.0.1",
            port=0,
            llm_client=SequentialRecordingLlmClient([
                '{"toolCalls":[{"id":"call-1","name":"context.echo","arguments":{"query":"mars"}}]}',
                '{"summary": "Echoed mars"}',
            ]),
        )
        host.start()
        try:
            post_json(f"{host.url}/api/workflows", definition)
            published = post_json(f"{host.url}/api/workflows/support-flow/publish", {})
            started = post_json(
                f"{host.url}/api/workflows/support-flow/runs",
                {"version": published["version"], "input": {"message": "research mars"}},
            )
        finally:
            host.stop()

        self.assertEqual(started["status"], "succeeded")
        self.assertEqual(started["output"], {"summary": "Echoed mars"})
        self.assertEqual(
            [(message["role"], message.get("toolCallId")) for message in started["messages"]],
            [("user", None), ("assistant", None), ("tool", "call-1"), ("assistant", None)],
        )
        self.assertEqual(
            [step["type"] for step in started["executionDetails"]["nodes"][0]["steps"]],
            ["llm_call", "tool_call", "tool_result", "llm_call", "schema_validation", "node_result"],
        )

    def test_host_runs_workflow_v2_condition_branch_from_agent_output_data(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(
            host="127.0.0.1",
            port=0,
            llm_client=SequentialRecordingLlmClient([
                '{"category":"technical","summary":"API issue"}',
                '{"summary":"Technical branch"}',
            ]),
        )
        host.start()
        try:
            post_json(f"{host.url}/api/workflows", valid_condition_workflow_v2_definition())
            published = post_json(f"{host.url}/api/workflows/condition-flow/publish", {})
            started = post_json(
                f"{host.url}/api/workflows/condition-flow/runs",
                {"version": published["version"], "input": {"message": "API request"}},
            )
        finally:
            host.stop()

        self.assertEqual(started["status"], "succeeded")
        self.assertEqual([result["nodeId"] for result in started["nodeResults"]], ["classify", "route", "technical-agent"])
        self.assertEqual(started["nodeResults"][1]["data"], {"branch": "technical", "target": "technical-agent"})
        self.assertEqual(started["output"], {"summary": "Technical branch"})

    def test_host_runs_workflow_v2_end_final_result_binding(self) -> None:
        from contextos.api.server import create_http_runtime_host

        definition = valid_workflow_v2_definition("Return a summary")
        definition["nodes"][1]["config"] = {
            "finalResult": {
                "message": {"mode": "lastVisibleAssistant"},
                "artifacts": {"mode": "allVisible"},
                "data": {"kind": "nodeOutput", "nodeId": "agent-1", "path": ["summary"]},
            }
        }
        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=RecordingLlmClient('{"summary":"Bound data"}'))
        host.start()
        try:
            post_json(f"{host.url}/api/workflows", definition)
            published = post_json(f"{host.url}/api/workflows/support-flow/publish", {})
            started = post_json(
                f"{host.url}/api/workflows/support-flow/runs",
                {"version": published["version"], "input": {"message": "hello"}},
            )
        finally:
            host.stop()

        self.assertEqual(started["status"], "succeeded")
        self.assertEqual(started["finalResult"], {"message": '{"summary":"Bound data"}', "data": "Bound data", "artifacts": []})

    def test_host_lists_workflow_v2_artifact_refs_and_downloads_content_by_artifact_id(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(
            host="127.0.0.1",
            port=0,
            llm_client=RecordingLlmClient('{"summary":"Report ready","artifacts":[{"name":"report.txt","mimeType":"text/plain","content":"hello artifact"}]}'),
        )
        host.start()
        try:
            post_json(f"{host.url}/api/workflows", valid_workflow_v2_definition("Create report"))
            published = post_json(f"{host.url}/api/workflows/support-flow/publish", {})
            started = post_json(
                f"{host.url}/api/workflows/support-flow/runs",
                {"version": published["version"], "input": {"message": "make report"}},
            )
            artifacts = get_json(f"{host.url}/api/workflow-runs/{started['id']}/artifacts")
            content = get_response(f"{host.url}/api/workflow-artifacts/{started['artifacts'][0]['id']}/content")
        finally:
            host.stop()

        artifact_ref = started["artifacts"][0]
        self.assertEqual(artifacts["artifacts"], [artifact_ref])
        self.assertEqual(started["finalResult"]["artifacts"], [artifact_ref])
        self.assertNotIn("content", artifact_ref)
        self.assertNotIn("storageKey", json.dumps(started))
        self.assertEqual(content["contentType"], "text/plain")
        self.assertEqual(content["body"], b"hello artifact")

    def test_host_runs_workflow_v2_workflow_ref_child_workflow(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(
            host="127.0.0.1",
            port=0,
            llm_client=SequentialRecordingLlmClient([
                '{"topic":"mars"}',
                '{"summary":"Child research complete"}',
            ]),
        )
        host.start()
        try:
            post_json(f"{host.url}/api/workflows", workflow_ref_child_definition())
            child_published = post_json(f"{host.url}/api/workflows/research-flow/publish", {})
            parent = workflow_ref_parent_definition(child_published["version"])
            post_json(f"{host.url}/api/workflows", parent)
            parent_published = post_json(f"{host.url}/api/workflows/parent-flow/publish", {})
            started = post_json(
                f"{host.url}/api/workflows/parent-flow/runs",
                {"version": parent_published["version"], "input": {"message": "Research Mars"}},
            )
        finally:
            host.stop()

        self.assertEqual(started["status"], "succeeded")
        self.assertEqual(started["nodeResults"][1]["nodeId"], "research")
        self.assertEqual(started["nodeResults"][1]["data"], {"summary": "Child research complete"})
        self.assertEqual(started["nodeResults"][1]["metadata"]["workflowId"], "research-flow")

    def test_host_blocks_workflow_ref_publish_when_input_mapping_type_is_incompatible(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=RecordingLlmClient('{"summary":"ok"}'))
        host.start()
        try:
            child = workflow_ref_child_definition()
            child["inputSchema"] = {"type": "object", "required": ["confidence"], "properties": {"confidence": {"type": "number"}}}
            post_json(f"{host.url}/api/workflows", child)
            published = post_json(f"{host.url}/api/workflows/research-flow/publish", {})
            parent = workflow_ref_parent_definition(published["version"])
            parent["nodes"][1]["config"]["inputBindings"] = {
                "confidence": {"kind": "nodeOutput", "nodeId": "analyze", "path": ["topic"]},
            }
            post_json(f"{host.url}/api/workflows", parent)
            invalid = post_json_error(f"{host.url}/api/workflows/parent-flow/publish", {})
        finally:
            host.stop()

        self.assertEqual(invalid["status"], 422)
        codes = [error["code"] for error in invalid["body"]["validation"]["errors"]]
        self.assertIn("workflow_ref_input_type_mismatch", codes)

    def test_host_round_trips_and_validates_workflow_v2_agent_node_config(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            created = post_json(f"{host.url}/api/workflows", {"id": "support-flow", "name": "Support Flow"})
            agent_config = {
                "name": "Analyze Requirement",
                "description": "Classify the incoming request",
                "instruction": "Analyze the user request.",
                "visibility": "auto",
                "contextPolicy": {"conversationHistory": True, "userInput": True, "uploadedFiles": False},
                "outputSchema": None,
                "toolPolicy": {"mode": "disabled"},
                "retryPolicy": {"schemaRetryCount": 2, "nodeRetryCount": 1, "timeoutMs": 30000},
            }
            saved = put_json(
                f"{host.url}/api/workflows/support-flow/draft",
                {
                    **created,
                    "nodes": [{"id": "agent-1", "type": "agent", "config": agent_config}, {"id": "end-1", "type": "end"}],
                    "edges": [{"source": "START", "target": "agent-1"}, {"source": "agent-1", "target": "end-1"}],
                },
            )
            loaded = get_json(f"{host.url}/api/workflows/support-flow")
            valid = post_json(f"{host.url}/api/workflows/support-flow/validate", {})
            invalid = post_json(
                f"{host.url}/api/workflows/support-flow/validate",
                {
                    **loaded,
                    "nodes": [
                        {"id": "agent-1", "type": "agent", "config": {**agent_config, "instruction": ""}},
                        {"id": "end-1", "type": "end"},
                    ],
                },
            )
        finally:
            host.stop()

        self.assertEqual(saved["revision"], 2)
        self.assertEqual(loaded["nodes"][0]["config"], agent_config)
        self.assertTrue(valid["valid"], valid["errors"])
        self.assertFalse(invalid["valid"])
        self.assertIn("agent_instruction_required", [error["code"] for error in invalid["errors"]])

    def test_host_lists_only_published_agents_for_session_selector(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=RecordingLlmClient("selector ok"))
        host.start()
        try:
            draft = agent_test_run_manifest_payload()
            draft["template"] = {"id": "research-agent", "name": "Research Agent", "version": "draft"}
            post_json(f"{host.url}/api/templates", draft)
            put_json(f"{host.url}/api/agents/research-agent/draft", draft)
            published = post_json(f"{host.url}/api/agents/research-agent/publish", {})
            agents = get_json(f"{host.url}/api/agents")
        finally:
            host.stop()

        agents_by_id = {agent["id"]: agent for agent in agents["agents"]}
        self.assertEqual(agents_by_id["research-agent"]["name"], "Research Agent")
        self.assertEqual(agents_by_id["research-agent"]["active_version"]["id"], published["id"])
        self.assertEqual(agents_by_id["demo-workflow"]["active_version"]["id"], "demo-workflow_v1")

    def test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works(self) -> None:
        from contextos.api.server import HttpRuntimeHost, create_demo_services

        llm_client = RecordingLlmClient("workflow chat ok")
        services = create_demo_services(llm_client=llm_client)
        version = services.agent_version_service.create_published_version("research-agent", agent_test_run_manifest_payload())
        host = HttpRuntimeHost(host="127.0.0.1", port=0, services=services)
        host.start()
        try:
            workflow_session = post_json(
                f"{host.url}/api/sessions",
                {"agent_template_id": "research-agent", "agent_version_id": version.id},
            )
            post_json(
                f"{host.url}/api/sessions/{workflow_session['id']}/messages",
                {"role": "user", "content": "Hello workflow", "token_count": 2, "timeline_id": workflow_session["current_timeline_id"]},
            )
            workflow_sse = get_text(f"{host.url}/sse/sessions/{workflow_session['id']}/chat?timelineId={workflow_session['current_timeline_id']}")
            workflow_messages = get_json(f"{host.url}/api/sessions/{workflow_session['id']}/messages?timelineId={workflow_session['current_timeline_id']}")
            legacy_sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
        finally:
            host.stop()

        self.assertEqual(sse_token_text(workflow_sse), "workflow chat ok")
        self.assertEqual(workflow_messages["messages"][-1]["role"], "assistant")
        self.assertEqual(workflow_messages["messages"][-1]["content"], "workflow chat ok")
        self.assertEqual(llm_client.calls[0][-1]["content"], "Hello workflow")
        self.assertIn("event: done", legacy_sse)

    def test_session_switch_agent_uses_new_version_for_future_chat_and_preserves_history(self) -> None:
        from contextos.api.server import HttpRuntimeHost, create_demo_services

        llm_client = PromptEchoLlmClient()
        services = create_demo_services(llm_client=llm_client)
        v1_payload = agent_test_run_manifest_payload()
        v1_payload["runtime"]["nodes"][0]["config"]["prompt_template"] = "v1 {{input}}"
        v2_payload = agent_test_run_manifest_payload()
        v2_payload["runtime"]["nodes"][0]["config"]["prompt_template"] = "v2 {{input}}"
        v1 = services.agent_version_service.create_published_version("research-agent", v1_payload)
        v2 = services.agent_version_service.create_published_version("research-agent", v2_payload)
        host = HttpRuntimeHost(host="127.0.0.1", port=0, services=services)
        host.start()
        try:
            session = post_json(
                f"{host.url}/api/sessions",
                {"agent_template_id": "research-agent", "agent_version_id": v1.id},
            )
            timeline_id = session["current_timeline_id"]
            post_json(
                f"{host.url}/api/sessions/{session['id']}/messages",
                {"role": "user", "content": "first", "token_count": 1, "timeline_id": timeline_id},
            )
            get_text(f"{host.url}/sse/sessions/{session['id']}/chat?timelineId={timeline_id}")
            switched = patch_json(f"{host.url}/api/sessions/{session['id']}/agent", {"agent_version_id": v2.id})
            post_json(
                f"{host.url}/api/sessions/{session['id']}/messages",
                {"role": "user", "content": "second", "token_count": 1, "timeline_id": timeline_id},
            )
            get_text(f"{host.url}/sse/sessions/{session['id']}/chat?timelineId={timeline_id}")
            messages = get_json(f"{host.url}/api/sessions/{session['id']}/messages?timelineId={timeline_id}")["messages"]
            debug = get_json(f"{host.url}/api/debug/sessions/{session['id']}")
        finally:
            host.stop()

        self.assertEqual(switched["agent_version_id"], v2.id)
        self.assertEqual([message["content"] for message in messages], ["first", "v1 first", "second", "v2 second"])
        self.assertEqual(messages[1]["group_id"], messages[0]["group_id"])
        self.assertEqual(messages[3]["group_id"], messages[2]["group_id"])
        workflow_checkpoints = [
            checkpoint for checkpoint in debug["checkpoints"]
            if checkpoint["timeline_id"] == timeline_id and checkpoint["agent_version_id"] in {v1.id, v2.id}
        ]
        self.assertEqual([checkpoint["agent_version_id"] for checkpoint in workflow_checkpoints], [v1.id, v2.id])

    def test_host_persists_message_edit_and_soft_delete_across_restart(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            host.start()
            try:
                session = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                timeline_id = session["current_timeline_id"]
                editable = post_json(
                    f"{host.url}/api/sessions/{session['id']}/messages",
                    {"role": "assistant", "content": "before edit", "token_count": 2, "timeline_id": timeline_id},
                )
                doomed = post_json(
                    f"{host.url}/api/sessions/{session['id']}/messages",
                    {"role": "user", "content": "hide me later", "token_count": 3, "timeline_id": timeline_id},
                )
                patched = patch_json(f"{host.url}/api/messages/{editable['id']}", {"new_content": "after edit"})
                deleted = delete_json(f"{host.url}/api/messages/{doomed['id']}")
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                messages = get_json(f"{restarted.url}/api/sessions/{session['id']}/messages?timelineId={timeline_id}")
            finally:
                restarted.stop()

            self.assertEqual(patched["message"]["content"], "after edit")
            self.assertEqual(deleted["message_ids"], [doomed["id"]])
            self.assertIn("after edit", [message["content"] for message in messages["messages"]])
            self.assertNotIn("hide me later", [message["content"] for message in messages["messages"]])

            persisted = json.loads(storage_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["messages"][editable["id"]]["content"], "after edit")
            self.assertEqual(persisted["messages"][doomed["id"]]["content"], "hide me later")
            self.assertEqual(persisted["messages"][doomed["id"]]["is_deleted"], True)
            self.assertIsNotNone(persisted["messages"][doomed["id"]]["deleted_at"])

    def test_host_accepts_utf8_bom_json_message_post_over_http(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            created = post_raw_json(
                f"{host.url}/api/sessions/demo-session/messages",
                b"\xef\xbb\xbf" + json.dumps(
                    {"role": "user", "content": "Windows JSON body", "token_count": 3},
                ).encode("utf-8"),
            )
        finally:
            host.stop()

        self.assertEqual(created["role"], "user")
        self.assertEqual(created["content"], "Windows JSON body")

    def test_host_rejects_message_for_timeline_outside_session(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            first = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            second = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            response = post_json_error(
                f"{host.url}/api/sessions/{first['id']}/messages",
                {"role": "user", "content": "wrong timeline", "token_count": 2, "timeline_id": second["current_timeline_id"]},
            )
        finally:
            host.stop()

        self.assertEqual(response["status"], 400)
        self.assertEqual(response["body"]["error"]["code"], "timeline.invalid")

    def test_host_lists_created_sessions_for_workspace_navigation(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            first = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            second = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            sessions = get_json(f"{host.url}/api/sessions")
        finally:
            host.stop()

        session_ids = [session["id"] for session in sessions["sessions"]]
        self.assertIn("demo-session", session_ids)
        self.assertIn(first["id"], session_ids)
        self.assertIn(second["id"], session_ids)
        self.assertEqual(len(session_ids), len(set(session_ids)))

    def test_host_updates_session_title_without_creating_timeline(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            session = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            before = get_json(f"{host.url}/api/sessions/{session['id']}/timelines")
            patched = patch_json(f"{host.url}/api/sessions/{session['id']}", {"title": "Renamed session"})
            after = get_json(f"{host.url}/api/sessions/{session['id']}/timelines")
        finally:
            host.stop()

        self.assertEqual(patched["title"], "Renamed session")
        self.assertEqual(len(after), len(before))

    def test_host_renames_timeline_and_preserves_identity_after_restart(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            host.start()
            try:
                session = get_json(f"{host.url}/api/sessions/demo-session")
                parent_timeline_id = str(session["current_timeline_id"])
                semantic_edit = patch_json(
                    f"{host.url}/api/messages/demo-user-message",
                    {"new_content": "Rename child timeline", "semantic": True},
                )
                child = semantic_edit["timeline"]
                patched = patch_json(f"{host.url}/api/timelines/{child['id']}", {"title": "  Before Edit  "})
                session_after = get_json(f"{host.url}/api/sessions/demo-session")
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                timelines = get_json(f"{restarted.url}/api/sessions/demo-session/timelines")
            finally:
                restarted.stop()

        renamed = next(timeline for timeline in timelines if timeline["id"] == child["id"])
        self.assertEqual(patched["id"], child["id"])
        self.assertEqual(patched["title"], "Before Edit")
        self.assertEqual(patched["parent_timeline_id"], parent_timeline_id)
        self.assertEqual(patched["fork_message_id"], "demo-user-message")
        self.assertEqual(session_after["current_timeline_id"], child["id"])
        self.assertEqual(renamed["title"], "Before Edit")
        self.assertEqual(renamed["parent_timeline_id"], parent_timeline_id)

    def test_host_restores_all_empty_sessions_from_runtime_state(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            host.start()
            try:
                first = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                second = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                third = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                sessions = get_json(f"{restarted.url}/api/sessions")
            finally:
                restarted.stop()

        session_ids = [session["id"] for session in sessions["sessions"]]
        self.assertIn(first["id"], session_ids)
        self.assertIn(second["id"], session_ids)
        self.assertIn(third["id"], session_ids)

    def test_host_deletes_session_and_related_runtime_records(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=RecordingStreamingLlmClient(["ok"]), storage_path=storage_path)
            host.start()
            try:
                keep = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                doomed = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                post_json(
                    f"{host.url}/api/sessions/{doomed['id']}/messages",
                    {"role": "user", "content": "Delete this session", "token_count": 3, "timeline_id": doomed["current_timeline_id"]},
                )
                get_text(f"{host.url}/sse/sessions/{doomed['id']}/chat?timelineId={doomed['current_timeline_id']}")

                deleted = delete_json(f"{host.url}/api/sessions/{doomed['id']}")
                sessions = get_json(f"{host.url}/api/sessions")
                missing = get_json_error(f"{host.url}/api/sessions/{doomed['id']}")
                kept_messages = get_json(f"{host.url}/api/sessions/{keep['id']}/messages?timelineId={keep['current_timeline_id']}")
            finally:
                host.stop()

            self.assertEqual(deleted["id"], doomed["id"])
            session_ids = [session["id"] for session in sessions["sessions"]]
            self.assertIn(keep["id"], session_ids)
            self.assertNotIn(doomed["id"], session_ids)
            self.assertEqual(missing["status"], 404)
            self.assertEqual(kept_messages["messages"], [])

            persisted = json.loads(storage_path.read_text(encoding="utf-8"))
            self.assertNotIn(doomed["id"], persisted["sessions"])
            self.assertFalse(any(record.get("session_id") == doomed["id"] for record in persisted["timelines"].values()))
            self.assertFalse(any(record.get("session_id") == doomed["id"] for record in persisted["messages"].values()))
            self.assertFalse(any(record.get("session_id") == doomed["id"] for record in persisted["conversation_groups"].values()))
            self.assertFalse(any(record.get("session_id") == doomed["id"] for record in persisted["checkpoints"].values()))

    def test_host_semantic_message_delete_forks_and_preserves_original_timeline(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=RecordingStreamingLlmClient(["A1", "A2"]))
        host.start()
        try:
            session = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            session_id = str(session["id"])
            parent_timeline_id = str(session["current_timeline_id"])
            first = post_json(
                f"{host.url}/api/sessions/{session_id}/messages",
                {"role": "user", "content": "keep turn", "token_count": 2, "timeline_id": parent_timeline_id},
            )
            get_text(f"{host.url}/sse/sessions/{session_id}/chat?timelineId={parent_timeline_id}")
            second = post_json(
                f"{host.url}/api/sessions/{session_id}/messages",
                {"role": "user", "content": "remove turn", "token_count": 2, "timeline_id": parent_timeline_id},
            )
            get_text(f"{host.url}/sse/sessions/{session_id}/chat?timelineId={parent_timeline_id}")

            deleted = delete_json(f"{host.url}/api/messages/{second['id']}?mode=semantic")
            child_timeline_id = deleted["timeline"]["id"]
            parent_messages = get_json(f"{host.url}/api/sessions/{session_id}/messages?timelineId={parent_timeline_id}")
            child_messages = get_json(f"{host.url}/api/sessions/{session_id}/messages?timelineId={child_timeline_id}")
            active_session = get_json(f"{host.url}/api/sessions/{session_id}")
        finally:
            host.stop()

        self.assertNotEqual(child_timeline_id, parent_timeline_id)
        self.assertEqual(active_session["current_timeline_id"], child_timeline_id)
        self.assertIn("keep turn", [message["content"] for message in deleted["working_context_messages"]])
        self.assertIn("remove turn", [message["content"] for message in parent_messages["messages"]])
        self.assertIn("A2", [message["content"] for message in parent_messages["messages"]])
        self.assertEqual([message["content"] for message in child_messages["messages"]], ["keep turn", "A1"])

    def test_host_activate_timeline_updates_session_current_pointer(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            session = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            session_id = str(session["id"])
            parent_timeline_id = str(session["current_timeline_id"])
            message = post_json(
                f"{host.url}/api/sessions/{session_id}/messages",
                {"role": "user", "content": "fork me", "token_count": 2, "timeline_id": parent_timeline_id},
            )
            semantic_edit = patch_json(f"{host.url}/api/messages/{message['id']}", {"new_content": "forked content", "semantic": True})
            child_timeline_id = str(semantic_edit["timeline"]["id"])

            activated = post_json(f"{host.url}/api/timelines/{parent_timeline_id}/activate", {})
            session_after = get_json(f"{host.url}/api/sessions/{session_id}")
            timelines = get_json(f"{host.url}/api/sessions/{session_id}/timelines")
        finally:
            host.stop()

        self.assertEqual(activated["id"], parent_timeline_id)
        self.assertEqual(session_after["current_timeline_id"], parent_timeline_id)
        self.assertEqual([timeline["id"] for timeline in timelines], [parent_timeline_id, child_timeline_id])

    def test_host_delete_timeline_hides_it_keeps_child_and_preserves_own_records(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            session = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            session_id = str(session["id"])
            parent_timeline_id = str(session["current_timeline_id"])
            message = post_json(
                f"{host.url}/api/sessions/{session_id}/messages",
                {"role": "user", "content": "parent message", "token_count": 2, "timeline_id": parent_timeline_id},
            )
            semantic_edit = patch_json(f"{host.url}/api/messages/{message['id']}", {"new_content": "child message", "semantic": True})
            child_timeline_id = str(semantic_edit["timeline"]["id"])

            deleted = delete_json(f"{host.url}/api/timelines/{parent_timeline_id}")
            timelines = get_json(f"{host.url}/api/sessions/{session_id}/timelines")
            session_after = get_json(f"{host.url}/api/sessions/{session_id}")
            child_messages = get_json(f"{host.url}/api/sessions/{session_id}/messages?timelineId={child_timeline_id}")
            parent_messages = get_json(f"{host.url}/api/sessions/{session_id}/messages?timelineId={parent_timeline_id}")
        finally:
            host.stop()

        self.assertEqual(deleted["timeline"]["id"], parent_timeline_id)
        self.assertEqual(deleted["timeline"]["status"], "deleted")
        self.assertEqual(deleted["current_timeline_id"], child_timeline_id)
        self.assertEqual(session_after["current_timeline_id"], child_timeline_id)
        self.assertEqual([timeline["id"] for timeline in timelines], [child_timeline_id])
        self.assertEqual([message["content"] for message in child_messages["messages"]], ["child message"])
        self.assertEqual([message["content"] for message in parent_messages["messages"]], ["parent message"])

    def test_host_delete_only_timeline_clears_active_timeline(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            session = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
            session_id = str(session["id"])
            timeline_id = str(session["current_timeline_id"])

            deleted = delete_json(f"{host.url}/api/timelines/{timeline_id}")
            session_after = get_json(f"{host.url}/api/sessions/{session_id}")
            timelines = get_json(f"{host.url}/api/sessions/{session_id}/timelines")
        finally:
            host.stop()

        self.assertEqual(deleted["current_timeline_id"], None)
        self.assertEqual(session_after["current_timeline_id"], None)
        self.assertEqual(timelines, [])

    def test_host_delete_missing_session_returns_not_found(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            response = delete_json_error(f"{host.url}/api/sessions/missing-session")
        finally:
            host.stop()

        self.assertEqual(response["status"], 404)
        self.assertEqual(response["body"]["error"]["code"], "session.not_found")

    def test_host_persists_lists_and_runs_workflow_templates(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            payload = workflow_payload(
                template_id="workflow-http",
                name="HTTP Workflow",
                output="hello workflow",
                position={"x": 240, "y": 180},
            )
            host = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            host.start()
            try:
                created = post_json(f"{host.url}/api/templates", payload)
                listed = get_json(f"{host.url}/api/templates")
                loaded = get_json(f"{host.url}/api/templates/workflow-http")
                run = post_json(
                    f"{host.url}/api/templates/workflow-http/run",
                    {"graph_state": {}, "session_id": "session-1", "timeline_id": "timeline-1", "trace_id": "trace-1"},
                )
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                reloaded_list = get_json(f"{restarted.url}/api/templates")
            finally:
                restarted.stop()

        self.assertEqual(created["id"], "workflow-http")
        self.assertIn("workflow-http", [item["id"] for item in listed["templates"]])
        self.assertEqual(loaded["manifest"]["graph"]["nodes"][0]["position"], {"x": 240, "y": 180})
        self.assertEqual(run["graph_state"]["answer"], "hello workflow")
        self.assertEqual(run["graph_state"]["visited_nodes"], ["writer"])
        self.assertIn("workflow-http", [item["id"] for item in reloaded_list["templates"]])

    def test_host_serves_workflow_node_catalog(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            catalog = get_json(f"{host.url}/api/workflow/node-catalog")
        finally:
            host.stop()

        self.assertEqual(
            [node["type"] for node in catalog["nodes"]],
            ["prompt", "llm", "tool", "condition", "output"],
        )
        self.assertFalse({"START", "END", "agent", "router", "subgraph", "memory", "custom"} & {node["type"] for node in catalog["nodes"]})

    def test_host_saves_and_loads_agent_draft_without_modifying_template_manifest(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            active_manifest = workflow_payload("draft-http", "Draft HTTP", "active", {"x": 120, "y": 90})
            draft_manifest = workflow_payload("draft-http", "Draft HTTP", "draft", {"x": 220, "y": 190})
            post_json(f"{host.url}/api/templates", active_manifest)
            saved = put_json(f"{host.url}/api/agents/draft-http/draft", draft_manifest)
            loaded_draft = get_json(f"{host.url}/api/agents/draft-http/draft")
            loaded_template = get_json(f"{host.url}/api/templates/draft-http")
        finally:
            host.stop()

        self.assertEqual(saved["draft_manifest"], draft_manifest)
        self.assertEqual(loaded_draft["draft_manifest"], draft_manifest)
        self.assertEqual(loaded_template["manifest"], active_manifest)

    def test_host_validates_agent_manifest_with_structured_errors(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            active_manifest = workflow_payload("validate-http", "Validate HTTP", "active", {"x": 120, "y": 90})
            invalid_manifest = workflow_payload("validate-http", "Validate HTTP", "invalid", {"x": 220, "y": 190})
            invalid_manifest["graph"]["edges"] = [{"from": "START", "to": "missing"}]
            post_json(f"{host.url}/api/templates", active_manifest)
            response = post_json(f"{host.url}/api/agents/validate-http/validate", invalid_manifest)
        finally:
            host.stop()

        self.assertFalse(response["valid"])
        self.assertEqual(response["errors"][0]["code"], "unknown_node")
        self.assertEqual(response["errors"][0]["field"], "graph.edges[0].to")

    def test_host_previews_agent_graph_using_runtime_compiler(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            manifest = workflow_payload("preview-http", "Preview HTTP", "preview", {"x": 120, "y": 90})
            response = post_json(f"{host.url}/api/agents/preview-http/graph-preview", manifest)
        finally:
            host.stop()

        self.assertTrue(response["valid"])
        self.assertEqual(response["start"], "START")
        self.assertEqual(response["end"], "END")
        self.assertEqual(response["edges"], [{"source": "START", "target": "writer"}, {"source": "writer", "target": "END"}])
        self.assertEqual(response["execution_order"], ["writer"])

    def test_host_seeds_demo_workflow_as_published_runnable_template(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=PromptEchoLlmClient())
        host.start()
        try:
            templates = get_json(f"{host.url}/api/templates")
            template = get_json(f"{host.url}/api/templates/demo-workflow")
            preview = post_json(f"{host.url}/api/agents/demo-workflow/graph-preview", template["manifest"])
            run = post_json(f"{host.url}/api/agent-versions/{template['active_version_id']}/test-runs", {"input": "Hello demo"})
        finally:
            host.stop()

        summaries = {item["id"]: item for item in templates["templates"]}
        self.assertEqual(summaries["demo-workflow"]["name"], "Demo Workflow")
        self.assertEqual(summaries["demo-workflow"]["active_version_id"], "demo-workflow_v1")
        self.assertEqual(template["active_version_id"], "demo-workflow_v1")
        self.assertEqual([node["id"] for node in template["manifest"]["runtime"]["nodes"]], ["capture_input", "echo_tool", "final_output"])
        self.assertEqual(
            template["manifest"]["runtime"]["edges"],
            [
                {"id": "start-capture", "source": "START", "target": "capture_input"},
                {"id": "capture-echo", "source": "capture_input", "target": "echo_tool"},
                {"id": "echo-final", "source": "echo_tool", "target": "final_output"},
                {"id": "final-end", "source": "final_output", "target": "END"},
            ],
        )
        self.assertTrue(preview["valid"])
        self.assertEqual(preview["start"], "START")
        self.assertEqual(preview["end"], "END")
        self.assertEqual(preview["execution_order"], ["capture_input", "echo_tool", "final_output"])
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["output"], "Workflow input: Hello demo")
        self.assertEqual(
            [event["type"] for event in run["events"]],
            ["graph_started", "node_started", "node_finished", "tool_call", "tool_result", "node_started", "node_finished", "checkpoint", "graph_finished"],
        )

    def test_demo_workflow_bound_session_executes_workflow_and_persists_after_restart(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=RecordingLlmClient("demo workflow session ok"), storage_path=storage_path)
            host.start()
            try:
                session = get_json(f"{host.url}/api/sessions/demo-workflow-session")
                post_json(
                    f"{host.url}/api/sessions/demo-workflow-session/messages",
                    {
                        "role": "user",
                        "content": "Run the seeded workflow",
                        "token_count": 4,
                        "timeline_id": session["current_timeline_id"],
                    },
                )
                sse = get_text(f"{host.url}/sse/sessions/demo-workflow-session/chat?timelineId={session['current_timeline_id']}")
                messages = get_json(f"{host.url}/api/sessions/demo-workflow-session/messages?timelineId={session['current_timeline_id']}")
                debug = get_json(f"{host.url}/api/debug/sessions/demo-workflow-session?traceId=trace-chat-response")
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                reloaded_templates = get_json(f"{restarted.url}/api/templates")
                reloaded_session = get_json(f"{restarted.url}/api/sessions/demo-workflow-session")
            finally:
                restarted.stop()

        self.assertEqual(session["agent_template_id"], "demo-workflow")
        self.assertEqual(session["agent_version_id"], "demo-workflow_v1")
        self.assertEqual(sse_token_text(sse), "Workflow input: Run the seeded workflow")
        self.assertEqual(messages["messages"][-1]["role"], "assistant")
        self.assertEqual(messages["messages"][-1]["content"], "Workflow input: Run the seeded workflow")
        self.assertEqual(debug["checkpoints"][-1]["agent_version_id"], "demo-workflow_v1")
        self.assertEqual(
            debug["checkpoints"][-1]["graph_state"]["visited_nodes"],
            ["capture_input", "echo_tool", "final_output"],
        )
        reloaded_summaries = {item["id"]: item for item in reloaded_templates["templates"]}
        self.assertEqual(reloaded_summaries["demo-workflow"]["active_version_id"], "demo-workflow_v1")
        self.assertEqual(reloaded_session["agent_version_id"], "demo-workflow_v1")

    def test_deleted_demo_session_is_not_reseeded_after_restart(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            host.start()
            try:
                delete_json(f"{host.url}/api/sessions/demo-session")
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                sessions = get_json(f"{restarted.url}/api/sessions")
            finally:
                restarted.stop()

        self.assertNotIn("demo-session", [session["id"] for session in sessions["sessions"]])

    def test_chat_stream_uses_latest_user_message_and_persists_assistant_response(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "Hello, please reply with OK", "token_count": 5},
            )
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            messages = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertIn("event: token", sse)
        self.assertIn('"content": "OK"', sse)
        assistant_messages = [message for message in messages["messages"] if message["role"] == "assistant"]
        self.assertEqual(assistant_messages[-1]["content"], "OK")
        self.assertEqual(assistant_messages[-1]["trace_id"], "trace-chat-response")

    def test_chat_stream_persists_checkpoint_and_trace_for_assistant_response(self) -> None:
        from contextos.api.server import create_http_runtime_host

        host = create_http_runtime_host(host="127.0.0.1", port=0)
        host.start()
        try:
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "Please persist debug state", "token_count": 4},
            )
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            debug = get_json(f"{host.url}/api/debug/sessions/demo-session?traceId=trace-chat-response")
        finally:
            host.stop()

        self.assertIn("event: checkpoint", sse)
        self.assertIn("event: done", sse)
        checkpoints = [
            checkpoint
            for checkpoint in debug["checkpoints"]
            if checkpoint["timeline_id"] == "demo-timeline" and checkpoint["graph_state"].get("node") == "chat"
        ]
        self.assertEqual(len(checkpoints), 1)
        assistant_messages = [
            message
            for message in debug["messages"]
            if message["role"] == "assistant" and message["trace_id"] == "trace-chat-response"
        ]
        self.assertEqual(len(assistant_messages), 1)
        self.assertEqual(assistant_messages[0]["checkpoint_id"], checkpoints[0]["id"])
        self.assertEqual(debug["traces"]["total"], 1)
        self.assertEqual(debug["traces"]["items"][0]["message_id"], assistant_messages[0]["id"])
        self.assertEqual(debug["traces"]["items"][0]["checkpoint_id"], checkpoints[0]["id"])

    def test_chat_stream_calls_configured_llm_client_with_persisted_context_and_persists_response(self) -> None:
        from contextos.api.server import create_http_runtime_host

        llm_client = RecordingLlmClient("ContextOS Chat OK")
        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=llm_client)
        host.start()
        try:
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "Please reply with ContextOS Chat OK", "token_count": 5},
            )
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            messages = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertEqual(
            llm_client.user_messages,
            ["Summarize the incident report and email the team.", "Please reply with ContextOS Chat OK"],
        )
        self.assertEqual(sse_token_text(sse), "ContextOS Chat OK")
        assistant_messages = [message for message in messages["messages"] if message["role"] == "assistant"]
        self.assertEqual(assistant_messages[-1]["content"], "ContextOS Chat OK")

    def test_chat_stream_uses_streaming_llm_client_and_persists_final_text(self) -> None:
        from contextos.api.server import create_http_runtime_host

        llm_client = StreamingLlmClient(["ContextOS ", "stream OK"])
        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=llm_client)
        host.start()
        try:
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "stream please", "token_count": 2},
            )
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            messages = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertEqual(llm_client.user_messages, ["Summarize the incident report and email the team.", "stream please"])
        self.assertEqual(sse_token_text(sse), "ContextOS stream OK")
        assistant_messages = [message for message in messages["messages"] if message["role"] == "assistant"]
        self.assertEqual(assistant_messages[-1]["content"], "ContextOS stream OK")

    def test_chat_stream_reports_midstream_llm_error_without_persisting_partial_assistant(self) -> None:
        from contextos.api.server import create_http_runtime_host

        llm_client = FailingStreamingLlmClient("DeepSeek stream error overloaded_error: busy")
        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=llm_client)
        host.start()
        try:
            before = get_json(f"{host.url}/api/sessions/demo-session/messages")
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "stream fail", "token_count": 2},
            )
            sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            after = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertEqual(sse_token_text(sse), "partial")
        self.assertIn("event: error", sse)
        self.assertIn("overloaded_error", sse)
        before_assistants = [message for message in before["messages"] if message["role"] == "assistant"]
        after_assistants = [message for message in after["messages"] if message["role"] == "assistant"]
        self.assertEqual(len(after_assistants), len(before_assistants))

    def test_chat_stream_can_retry_after_midstream_llm_error(self) -> None:
        from contextos.api.server import create_http_runtime_host

        llm_client = FlakyStreamingLlmClient()
        host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=llm_client)
        host.start()
        try:
            before = get_json(f"{host.url}/api/sessions/demo-session/messages")
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "first try", "token_count": 2},
            )
            failed_sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            post_json(
                f"{host.url}/api/sessions/demo-session/messages",
                {"role": "user", "content": "retry try", "token_count": 2},
            )
            retry_sse = get_text(f"{host.url}/sse/sessions/demo-session/chat?timelineId=demo-timeline")
            after = get_json(f"{host.url}/api/sessions/demo-session/messages")
        finally:
            host.stop()

        self.assertIn("event: error", failed_sse)
        self.assertEqual(sse_token_text(retry_sse), "retry ok")
        before_assistants = [message for message in before["messages"] if message["role"] == "assistant"]
        after_assistants = [message for message in after["messages"] if message["role"] == "assistant"]
        self.assertEqual(len(after_assistants), len(before_assistants) + 1)
        self.assertEqual(after_assistants[-1]["content"], "retry ok")

    def test_session_timeline_groups_reload_and_continue_with_persisted_llm_context(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            first_llm = RecordingStreamingLlmClient(["Hello Tom.", "Your name is Tom."])
            host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=first_llm, storage_path=storage_path)
            host.start()
            try:
                session = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                session_id = str(session["id"])
                timeline_id = str(session["current_timeline_id"])
                post_json(
                    f"{host.url}/api/sessions/{session_id}/messages",
                    {"role": "user", "content": "My name is Tom", "token_count": 4, "timeline_id": timeline_id},
                )
                get_text(f"{host.url}/sse/sessions/{session_id}/chat?timelineId={timeline_id}")
                post_json(
                    f"{host.url}/api/sessions/{session_id}/messages",
                    {"role": "user", "content": "What is my name?", "token_count": 4, "timeline_id": timeline_id},
                )
                get_text(f"{host.url}/sse/sessions/{session_id}/chat?timelineId={timeline_id}")
            finally:
                host.stop()

            second_llm = RecordingStreamingLlmClient(["We discussed that your name is Tom."])
            restarted = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=second_llm, storage_path=storage_path)
            restarted.start()
            try:
                reloaded = get_json(f"{restarted.url}/api/sessions/{session_id}/messages?timelineId={timeline_id}")
                post_json(
                    f"{restarted.url}/api/sessions/{session_id}/messages",
                    {"role": "user", "content": "Summarize what we discussed.", "token_count": 5, "timeline_id": timeline_id},
                )
                get_text(f"{restarted.url}/sse/sessions/{session_id}/chat?timelineId={timeline_id}")
            finally:
                restarted.stop()

        self.assertEqual(
            [message["content"] for message in reloaded["messages"]],
            ["My name is Tom", "Hello Tom.", "What is my name?", "Your name is Tom."],
        )
        self.assertEqual(
            second_llm.calls[-1],
            [
                {"role": "user", "content": "My name is Tom"},
                {"role": "assistant", "content": "Hello Tom."},
                {"role": "user", "content": "What is my name?"},
                {"role": "assistant", "content": "Your name is Tom."},
                {"role": "user", "content": "Summarize what we discussed."},
            ],
        )

    def test_session_context_projects_persisted_groups_and_excludes_deleted_group_after_restart(self) -> None:
        from contextos.api.server import create_http_runtime_host

        with tempfile.TemporaryDirectory() as temp_dir:
            storage_path = Path(temp_dir) / "runtime-state.json"
            host = create_http_runtime_host(host="127.0.0.1", port=0, llm_client=RecordingStreamingLlmClient(["A1", "A2"]), storage_path=storage_path)
            host.start()
            try:
                session = post_json(f"{host.url}/api/sessions", {"agent_template_id": "research-agent"})
                session_id = str(session["id"])
                timeline_id = str(session["current_timeline_id"])
                first = post_json(
                    f"{host.url}/api/sessions/{session_id}/messages",
                    {"role": "user", "content": "first turn", "token_count": 2, "timeline_id": timeline_id},
                )
                get_text(f"{host.url}/sse/sessions/{session_id}/chat?timelineId={timeline_id}")
                second = post_json(
                    f"{host.url}/api/sessions/{session_id}/messages",
                    {"role": "user", "content": "second turn", "token_count": 2, "timeline_id": timeline_id},
                )
                get_text(f"{host.url}/sse/sessions/{session_id}/chat?timelineId={timeline_id}")
                delete_json(f"{host.url}/api/messages/{first['id']}")
            finally:
                host.stop()

            restarted = create_http_runtime_host(host="127.0.0.1", port=0, storage_path=storage_path)
            restarted.start()
            try:
                context = get_json(f"{restarted.url}/api/sessions/{session_id}/context?timelineId={timeline_id}")
                messages = get_json(f"{restarted.url}/api/sessions/{session_id}/messages?timelineId={timeline_id}")
            finally:
                restarted.stop()

        self.assertEqual([item["group_id"] for item in context["items"]], [second["group_id"]])
        self.assertEqual(context["items"][0]["source_ids"], [second["id"], messages["messages"][-1]["id"]])
        self.assertIn("second turn", context["items"][0]["effective_content"])
        self.assertNotIn("first turn", context["items"][0]["effective_content"])


def get_json(url: str) -> dict[str, object]:
    with urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def get_text(url: str) -> str:
    request = Request(url, headers={"Accept": "text/event-stream"})
    with urlopen(request, timeout=5) as response:
        return response.read().decode("utf-8")


def get_response(url: str) -> dict[str, object]:
    with urlopen(url, timeout=5) as response:
        return {
            "status": response.status,
            "contentType": response.headers.get_content_type(),
            "body": response.read(),
        }


def post_json(url: str, payload: dict[str, object]) -> dict[str, object]:
    return post_raw_json(url, json.dumps(payload).encode("utf-8"))


def put_json(url: str, payload: dict[str, object]) -> dict[str, object]:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def put_json_error(url: str, payload: dict[str, object]) -> dict[str, object]:
    from urllib.error import HTTPError

    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return {"status": response.status, "body": json.loads(response.read().decode("utf-8"))}
    except HTTPError as error:
        return {"status": error.code, "body": json.loads(error.read().decode("utf-8"))}


def patch_json(url: str, payload: dict[str, object]) -> dict[str, object]:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def post_raw_json(url: str, payload: bytes) -> dict[str, object]:
    request = Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json_error(url: str, payload: dict[str, object]) -> dict[str, object]:
    from urllib.error import HTTPError

    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return {"status": response.status, "body": json.loads(response.read().decode("utf-8"))}
    except HTTPError as error:
        return {"status": error.code, "body": json.loads(error.read().decode("utf-8"))}


def delete_json(url: str) -> dict[str, object]:
    request = Request(url, method="DELETE")
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def delete_json_error(url: str) -> dict[str, object]:
    from urllib.error import HTTPError

    request = Request(url, method="DELETE")
    try:
        with urlopen(request, timeout=5) as response:
            return {"status": response.status, "body": json.loads(response.read().decode("utf-8"))}
    except HTTPError as error:
        return {"status": error.code, "body": json.loads(error.read().decode("utf-8"))}


def get_json_error(url: str) -> dict[str, object]:
    from urllib.error import HTTPError

    try:
        with urlopen(url, timeout=5) as response:
            return {"status": response.status, "body": json.loads(response.read().decode("utf-8"))}
    except HTTPError as error:
        return {"status": error.code, "body": json.loads(error.read().decode("utf-8"))}


def sse_token_text(sse: str) -> str:
    parts: list[str] = []
    for frame in sse.split("\n\n"):
        event_type = None
        data = None
        for line in frame.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            if line.startswith("data: "):
                data = json.loads(line.removeprefix("data: "))
        if event_type == "token" and data is not None:
            parts.append(str(data["content"]))
    return "".join(parts)


def workflow_payload(template_id: str, name: str, output: str, position: dict[str, int]) -> dict[str, object]:
    return {
        "template": {"id": template_id, "name": name, "version": "1.0.0"},
        "graph": {
            "state_schema": "default_chat_state",
            "nodes": [
                {
                    "id": "writer",
                    "type": "output",
                    "config": {
                        "source": output,
                        "output_key": "answer",
                        "output": output,
                    },
                    "position": position,
                }
            ],
            "edges": [{"from": "START", "to": "writer"}, {"from": "writer", "to": "END"}],
        },
        "context": {
            "policy": "balanced",
            "budget": {"high_watermark": 0.8, "target_watermark": 0.65},
            "restore": {"mode": "auto", "max_tokens_per_restore": 12000, "max_restore_per_turn": 3},
        },
        "checkpoint": {"enabled": True},
        "ui": {"editable_messages": True, "expose_context_panel": True},
    }


def valid_workflow_v2_definition(instruction: str) -> dict[str, object]:
    return {
        "id": "support-flow",
        "name": "Support Flow",
        "schemaVersion": 2,
        "tools": [],
        "nodes": [
            {
                "id": "agent-1",
                "type": "agent",
                "config": {
                    "instruction": instruction,
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [{"source": "START", "target": "agent-1"}, {"source": "agent-1", "target": "end-1"}],
    }


def valid_condition_workflow_v2_definition() -> dict[str, object]:
    return {
        "id": "condition-flow",
        "name": "Condition Flow",
        "schemaVersion": 2,
        "tools": [],
        "nodes": [
            {
                "id": "classify",
                "type": "agent",
                "config": {
                    "instruction": "Classify the request.",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {
                        "type": "object",
                        "required": ["category", "summary"],
                        "properties": {
                            "category": {"type": "string", "enum": ["technical", "business", "other"]},
                            "summary": {"type": "string"},
                        },
                    },
                },
            },
            {
                "id": "route",
                "type": "condition",
                "config": {
                    "branches": [
                        {"handle": "technical", "source": {"nodeId": "classify", "path": ["category"]}, "operator": "equals", "value": "technical"}
                    ],
                    "defaultTarget": "business-agent",
                },
            },
            {
                "id": "technical-agent",
                "type": "agent",
                "config": {
                    "instruction": "Handle technical request.",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {
                "id": "business-agent",
                "type": "agent",
                "config": {
                    "instruction": "Handle business request.",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [
            {"source": "START", "target": "classify"},
            {"source": "classify", "target": "route"},
            {"source": "route", "target": "technical-agent", "sourceHandle": "technical"},
            {"source": "route", "target": "business-agent", "sourceHandle": "default"},
            {"source": "technical-agent", "target": "end-1"},
            {"source": "business-agent", "target": "end-1"},
        ],
    }


def workflow_ref_child_definition() -> dict[str, object]:
    return {
        "id": "research-flow",
        "name": "Research Flow",
        "schemaVersion": 2,
        "inputSchema": {
            "type": "object",
            "required": ["topic", "priority"],
            "properties": {"topic": {"type": "string"}, "priority": {"type": "string"}},
        },
        "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
        "tools": [],
        "nodes": [
            {
                "id": "research-agent",
                "type": "agent",
                "config": {
                    "instruction": "Research the topic.",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [{"source": "START", "target": "research-agent"}, {"source": "research-agent", "target": "end-1"}],
    }


def workflow_ref_parent_definition(child_version: int) -> dict[str, object]:
    return {
        "id": "parent-flow",
        "name": "Parent Flow",
        "schemaVersion": 2,
        "tools": [],
        "nodes": [
            {
                "id": "analyze",
                "type": "agent",
                "config": {
                    "instruction": "Extract the research topic.",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["topic"], "properties": {"topic": {"type": "string"}}},
                },
            },
            {
                "id": "research",
                "type": "workflow",
                "config": {
                    "workflowId": "research-flow",
                    "version": child_version,
                    "messageContextMode": "inherit",
                    "inputBindings": {
                        "topic": {"kind": "nodeOutput", "nodeId": "analyze", "path": ["topic"]},
                        "priority": {"kind": "constant", "value": "high"},
                    },
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [
            {"source": "START", "target": "analyze"},
            {"source": "analyze", "target": "research"},
            {"source": "research", "target": "end-1"},
        ],
    }


def agent_test_run_manifest_payload() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "runtime": {
            "nodes": [
                {
                    "id": "planner",
                    "type": "llm",
                    "config": {
                        "model": "default",
                        "prompt_template": "{{input}}",
                        "input_mapping": {"input": "$state.input"},
                        "output_key": "answer",
                    },
                },
                {"id": "final", "type": "output", "config": {"source": "$state.answer"}},
            ],
            "edges": [
                {"id": "start-planner", "source": "START", "target": "planner"},
                {"id": "planner-final", "source": "planner", "target": "final"},
                {"id": "final-end", "source": "final", "target": "END"},
            ],
        },
        "ui": {"nodes": {}, "viewport": {}},
    }


class RecordingLlmClient:
    def __init__(self, response: str) -> None:
        self.response = response
        self.user_messages: list[str] = []
        self.calls: list[list[dict[str, str]]] = []

    def complete(self, messages: list[dict[str, str]]) -> str:
        self.calls.append(messages)
        self.user_messages = [message["content"] for message in messages if message["role"] == "user"]
        return self.response


class SequentialRecordingLlmClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.calls: list[list[dict[str, object]]] = []

    def complete(self, messages: list[dict[str, object]]) -> str:
        self.calls.append(messages)
        if not self.responses:
            raise AssertionError("No LLM response fixture left")
        return self.responses.pop(0)


class PromptEchoLlmClient:
    def complete(self, messages: list[dict[str, str]]) -> str:
        return messages[-1]["content"]


class StreamingLlmClient:
    def __init__(self, chunks: list[str]) -> None:
        self.chunks = chunks
        self.user_messages: list[str] = []

    def stream_complete(self, messages: list[dict[str, str]]):
        self.user_messages = [message["content"] for message in messages if message["role"] == "user"]
        yield from self.chunks


class FailingStreamingLlmClient:
    def __init__(self, message: str) -> None:
        self.message = message

    def stream_complete(self, messages: list[dict[str, str]]):
        from contextos.provider.deepseek_anthropic import LlmStreamError

        yield "partial"
        raise LlmStreamError(self.message)


class FlakyStreamingLlmClient:
    def __init__(self) -> None:
        self.calls = 0

    def stream_complete(self, messages: list[dict[str, str]]):
        from contextos.provider.deepseek_anthropic import LlmStreamError

        self.calls += 1
        if self.calls == 1:
            yield "partial"
            raise LlmStreamError("DeepSeek stream error overloaded_error: busy")
        yield "retry ok"


class RecordingStreamingLlmClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[list[dict[str, str]]] = []

    def stream_complete(self, messages: list[dict[str, str]]):
        self.calls.append(messages)
        response = self.responses.pop(0)
        yield response


if __name__ == "__main__":
    unittest.main()
