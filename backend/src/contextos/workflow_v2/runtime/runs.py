from __future__ import annotations

import json
import asyncio
import threading
import time
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from contextos.runtime.persistence.json_store import JsonRuntimeStore
from contextos.tool.executor_registry import ToolExecutorError, ToolExecutorRegistry, ToolInputValidationError
from contextos.tool.registry.registry import ToolRegistry
from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionNotFound, WorkflowV2DefinitionService, WorkflowV2PublishedVersionNotFound
from contextos.workflow_v2.application.json_schema import WorkflowV2JsonSchemaService
from contextos.workflow_v2.runtime.artifacts import InMemoryWorkflowV2ArtifactStore

COLLECTION = "workflow_v2_runs"


class WorkflowV2RunNotFound(Exception):
    pass


class WorkflowV2CancellationToken:
    def __init__(self) -> None:
        self._cancelled = threading.Event()

    @property
    def cancelled_event(self) -> threading.Event:
        return self._cancelled

    def cancel(self) -> None:
        self._cancelled.set()

    def is_cancelled(self) -> bool:
        return self._cancelled.is_set()


@dataclass(frozen=True)
class WorkflowV2RunRecord:
    id: str
    workflow_id: str
    workflow_version: int
    status: str
    input: dict[str, Any]
    output: dict[str, Any] | None
    final_result: dict[str, Any] | None
    node_results: list[dict[str, Any]]
    messages: list[dict[str, Any]]
    artifacts: list[dict[str, Any]]
    execution_details: dict[str, Any]
    events: list[dict[str, Any]]
    error: dict[str, Any] | None
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "workflowId": self.workflow_id,
            "workflowVersion": self.workflow_version,
            "status": self.status,
            "input": deepcopy(self.input),
            "output": deepcopy(self.output),
            "finalResult": deepcopy(self.final_result),
            "nodeResults": deepcopy(self.node_results),
            "messages": _messages_with_sequence(self.messages),
            "artifacts": deepcopy(self.artifacts),
            "executionDetails": deepcopy(self.execution_details),
            "events": deepcopy(self.events),
            "error": deepcopy(self.error),
            "createdAt": self.created_at,
        }


class InMemoryWorkflowV2RunStore:
    def __init__(self, store: JsonRuntimeStore | None = None) -> None:
        self._store = store
        self._runs: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()
        if self._store is not None:
            self._runs = {str(record["id"]): deepcopy(record) for record in self._store.list_records(COLLECTION)}

    def save(self, run: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._runs[str(run["id"])] = deepcopy(run)
            if self._store is not None:
                self._store.save_record(COLLECTION, str(run["id"]), run)
        return self.get(str(run["id"]))

    def get(self, run_id: str) -> dict[str, Any]:
        with self._lock:
            if run_id not in self._runs:
                if self._store is not None:
                    persisted = self._store.get_record(COLLECTION, run_id)
                    if persisted is not None:
                        self._runs[run_id] = persisted
                        return deepcopy(persisted)
                raise WorkflowV2RunNotFound(run_id)
            return deepcopy(self._runs[run_id])


class WorkflowV2RunService:
    _cancellations: dict[str, WorkflowV2CancellationToken] = {}
    _cancellations_lock = threading.RLock()

    def __init__(
        self,
        definition_service: WorkflowV2DefinitionService,
        store: InMemoryWorkflowV2RunStore,
        *,
        llm_client,
        tool_registry: ToolRegistry | None = None,
        tool_executor_registry: ToolExecutorRegistry | None = None,
        artifact_store: InMemoryWorkflowV2ArtifactStore | None = None,
    ) -> None:
        self._definition_service = definition_service
        self._store = store
        self._llm_client = llm_client
        self._tool_registry = tool_registry
        self._tool_executor_registry = tool_executor_registry
        self._artifact_store = artifact_store or InMemoryWorkflowV2ArtifactStore()

    def start(self, *, workflow_id: str, version: int, input_payload: dict[str, Any]) -> dict[str, Any]:
        published = self._definition_service.get_version(workflow_id, version)
        definition = published["definition"]
        run_id = f"workflow_run_{uuid4().hex}"
        run = _execute_single_agent_run(
            run_id=run_id,
            workflow_id=workflow_id,
            workflow_version=version,
            definition=definition,
            input_payload=deepcopy(input_payload),
            definition_service=self._definition_service,
            llm_client=self._llm_client,
            tool_registry=self._tool_registry,
            tool_executor_registry=self._tool_executor_registry,
            artifact_store=self._artifact_store,
        )
        return self._store.save(run)

    def start_async(self, *, workflow_id: str, version: int, input_payload: dict[str, Any]) -> dict[str, Any]:
        published = self._definition_service.get_version(workflow_id, version)
        definition = published["definition"]
        run_id = f"workflow_run_{uuid4().hex}"
        token = WorkflowV2CancellationToken()
        with self._cancellations_lock:
            self._cancellations[run_id] = token
        running = _running_run(run_id, workflow_id, version, input_payload)
        self._store.save(running)

        def worker() -> None:
            try:
                run = _execute_single_agent_run(
                    run_id=run_id,
                    workflow_id=workflow_id,
                    workflow_version=version,
                    definition=definition,
                    input_payload=deepcopy(input_payload),
                    definition_service=self._definition_service,
                    llm_client=self._llm_client,
                    tool_registry=self._tool_registry,
                    tool_executor_registry=self._tool_executor_registry,
                    artifact_store=self._artifact_store,
                    cancellation_token=token,
                )
                self._store.save(run)
            finally:
                with self._cancellations_lock:
                    self._cancellations.pop(run_id, None)

        threading.Thread(target=worker, daemon=True).start()
        return self._store.get(run_id)

    def cancel(self, run_id: str) -> dict[str, Any]:
        with self._cancellations_lock:
            token = self._cancellations.get(run_id)
        if token is not None:
            token.cancel()
        run = self._store.get(run_id)
        if run.get("status") in {"succeeded", "failed", "cancelled"}:
            return run
        error = {"code": "WORKFLOW_CANCELLED", "message": "Workflow run cancelled"}
        events = run.get("events", [])
        if isinstance(events, list):
            _emit_event(events, run_id, None, "WorkflowFailed", {"status": "cancelled", "error": deepcopy(error)})
        run.update({"status": "cancelled", "error": error})
        return self._store.save(run)

    def get(self, run_id: str) -> dict[str, Any]:
        return self._store.get(run_id)


def _running_run(run_id: str, workflow_id: str, workflow_version: int, input_payload: dict[str, Any]) -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    _emit_event(events, run_id, None, "WorkflowStarted", {"status": "running"})
    return WorkflowV2RunRecord(
        id=run_id,
        workflow_id=workflow_id,
        workflow_version=workflow_version,
        status="running",
        input=deepcopy(input_payload),
        output=None,
        final_result=None,
        node_results=[],
        messages=[_user_message(input_payload)],
        artifacts=[],
        execution_details={"nodes": []},
        events=events,
        error=None,
        created_at=_now(),
    ).to_dict()


def _execute_single_agent_run(
    *,
    run_id: str,
    workflow_id: str,
    workflow_version: int,
    definition: dict[str, Any],
    input_payload: dict[str, Any],
    llm_client,
    definition_service: WorkflowV2DefinitionService | None = None,
    tool_registry: ToolRegistry | None = None,
    tool_executor_registry: ToolExecutorRegistry | None = None,
    artifact_store: InMemoryWorkflowV2ArtifactStore | None = None,
    workflow_depth: int = 0,
    initial_messages: list[dict[str, Any]] | None = None,
    cancellation_token: WorkflowV2CancellationToken | None = None,
) -> dict[str, Any]:
    artifact_store = artifact_store or InMemoryWorkflowV2ArtifactStore()
    limits = _runtime_limits(definition)
    started_at = time.monotonic()
    message_history = [*deepcopy(initial_messages or []), _user_message(input_payload)]
    execution_details = {"nodes": []}
    events: list[dict[str, Any]] = []
    _emit_event(events, run_id, None, "WorkflowStarted", {"status": "running"})
    node_results: list[dict[str, Any]] = []
    node_outputs: dict[str, Any] = {}
    node_by_id = _node_by_id(definition)
    current = _edge_target(definition, "START", "")
    last_output: dict[str, Any] | None = None
    end_node: dict[str, Any] | None = None
    steps_remaining = max(len(node_by_id) * 4, 1)
    node_executions = 0

    while current and current != "END":
        limit_error = _run_limit_error(limits, started_at)
        if limit_error is not None:
            return _failed_run(run_id, workflow_id, workflow_version, input_payload, node_results, message_history, execution_details, events, **limit_error)
        if _is_cancelled(cancellation_token):
            return _failed_run(run_id, workflow_id, workflow_version, input_payload, node_results, message_history, execution_details, events, "WORKFLOW_CANCELLED", "Workflow run cancelled")
        steps_remaining -= 1
        if steps_remaining < 0:
            return _failed_run(run_id, workflow_id, workflow_version, input_payload, node_results, message_history, execution_details, events, "workflow.graph_cycle", "Workflow graph did not terminate")
        node = node_by_id.get(current)
        if node is None:
            return _failed_run(run_id, workflow_id, workflow_version, input_payload, node_results, message_history, execution_details, events, "workflow.unknown_node", f"Workflow node not found: {current}")
        if node.get("type") == "end":
            end_node = node
            break
        node_id = str(node["id"])
        node_executions += 1
        if node_executions > limits["maxNodeExecutions"]:
            return _failed_run(run_id, workflow_id, workflow_version, input_payload, node_results, message_history, execution_details, events, "WORKFLOW_LIMIT_EXCEEDED", "Runtime limit exceeded: maxNodeExecutions", limit="maxNodeExecutions")
        _emit_event(events, run_id, node_id, "NodeStarted", {"status": "running", "nodeType": node.get("type")})
        if node.get("type") == "agent":
            result = _run_agent_node(node, definition, input_payload, node_outputs, message_history, execution_details, llm_client, tool_registry, tool_executor_registry, run_id, artifact_store, events, limits, started_at, cancellation_token)
            node_results.append(result["nodeResult"])
            if not result["ok"]:
                _emit_event(events, run_id, node_id, "NodeFailed", {"status": "failed", "error": deepcopy(result["error"])})
                return _failed_run(run_id, workflow_id, workflow_version, input_payload, node_results, message_history, execution_details, events, **result["error"])
            _emit_event(events, run_id, node_id, "NodeCompleted", {"status": "succeeded", "data": deepcopy(result["output"])})
            last_output = result["output"]
            node_outputs[node_id] = deepcopy(last_output)
            current = _edge_target(definition, node_id, "")
            continue
        if node.get("type") == "condition":
            result = _run_condition_node(node, definition, node_outputs)
            node_results.append(result["nodeResult"])
            execution_details["nodes"].append({"nodeId": node_id, "input": result.get("input"), "steps": result["steps"]})
            if not result["ok"]:
                _emit_event(events, run_id, node_id, "NodeFailed", {"status": "failed", "error": deepcopy(result["error"])})
                return _failed_run(run_id, workflow_id, workflow_version, input_payload, node_results, message_history, execution_details, events, **result["error"])
            _emit_event(events, run_id, node_id, "NodeCompleted", {"status": "succeeded", "data": deepcopy(result["nodeResult"].get("data"))})
            current = str(result["target"])
            continue
        if node.get("type") == "workflow":
            result = _run_workflow_ref_node(
                node,
                input_payload,
                node_outputs,
                message_history,
                definition_service,
                llm_client,
                tool_registry,
                tool_executor_registry,
                artifact_store,
                workflow_depth,
                limits,
                cancellation_token,
            )
            node_results.append(result["nodeResult"])
            execution_details["nodes"].append({"nodeId": node_id, "input": result.get("input"), "steps": result["steps"]})
            _append_child_events(events, run_id, result.get("events", []))
            if not result["ok"]:
                _emit_event(events, run_id, node_id, "NodeFailed", {"status": "failed", "error": deepcopy(result["error"])})
                return _failed_run(run_id, workflow_id, workflow_version, input_payload, node_results, message_history, execution_details, events, **result["error"])
            _emit_event(events, run_id, node_id, "NodeCompleted", {"status": "succeeded", "data": deepcopy(result["output"])})
            last_output = result["output"]
            node_outputs[node_id] = deepcopy(last_output)
            current = _edge_target(definition, node_id, "")
            continue
        _emit_event(events, run_id, node_id, "NodeFailed", {"status": "failed", "error": {"code": "workflow.unsupported_node"}})
        return _failed_run(run_id, workflow_id, workflow_version, input_payload, node_results, message_history, execution_details, events, "workflow.unsupported_node", f"Unsupported runtime node type: {node.get('type')}")

    artifacts = _run_artifact_refs(artifact_store.list_by_run(run_id), node_results)
    final_result = _build_final_result(end_node, message_history, node_outputs, artifacts)
    _emit_event(events, run_id, None, "WorkflowCompleted", {"status": "succeeded", "finalResult": deepcopy(final_result)})
    return WorkflowV2RunRecord(
        id=run_id,
        workflow_id=workflow_id,
        workflow_version=workflow_version,
        status="succeeded",
        input=input_payload,
        output=last_output,
        final_result=final_result,
        node_results=node_results,
        messages=message_history,
        artifacts=artifacts,
        execution_details=execution_details,
        events=events,
        error=None,
        created_at=_now(),
    ).to_dict()


def _run_agent_node(
    agent_node: dict[str, Any],
    definition: dict[str, Any],
    workflow_input: dict[str, Any],
    node_outputs: dict[str, Any],
    message_history: list[dict[str, Any]],
    execution_details: dict[str, Any],
    llm_client,
    tool_registry: ToolRegistry | None,
    tool_executor_registry: ToolExecutorRegistry | None,
    run_id: str,
    artifact_store: InMemoryWorkflowV2ArtifactStore,
    events: list[dict[str, Any]],
    limits: dict[str, Any],
    started_at: float,
    cancellation_token: WorkflowV2CancellationToken | None,
) -> dict[str, Any]:
    tool_policy = agent_node.get("config", {}).get("toolPolicy", {"mode": "disabled"})
    try:
        config = agent_node.get("config", {}) if isinstance(agent_node.get("config", {}), dict) else {}
        output_schema = config.get("outputSchema") or {"type": "object", "properties": {}}
        resolved_inputs = _resolve_agent_inputs(config, workflow_input, node_outputs)
        if not resolved_inputs["ok"]:
            return _agent_failure(agent_node, **resolved_inputs["error"])
        inputs = resolved_inputs["value"]
        node_input = {"messages": _provider_messages(agent_node, output_schema, message_history, tool_registry, definition, inputs), "inputs": deepcopy(inputs)}
        execution_details["nodes"].append({"nodeId": agent_node["id"], "input": deepcopy(node_input), "steps": []})
        called_tools: set[str] = set()
        node_artifacts: list[dict[str, Any]] = []
        raw_output = ""
        max_tool_calls = limits["maxToolCallsPerNode"]
        llm_turns = 0
        tool_call_count = 0
        schema_retry_count = 0
        while True:
            if _is_cancelled(cancellation_token):
                return _agent_failure(agent_node, "WORKFLOW_CANCELLED", "Workflow run cancelled")
            limit_error = _run_limit_error(limits, started_at)
            if limit_error is not None:
                return _agent_failure(agent_node, **limit_error)
            if llm_turns >= limits["maxLlmTurnsPerNode"]:
                return _agent_failure(agent_node, "WORKFLOW_LIMIT_EXCEEDED", "Runtime limit exceeded: maxLlmTurnsPerNode", limit="maxLlmTurnsPerNode")
            llm_index = _next_llm_index(execution_details)
            _emit_event(events, run_id, str(agent_node["id"]), "LlmCallStarted", {"index": llm_index})
            raw_output = _complete_llm(llm_client, _provider_messages(agent_node, output_schema, message_history, tool_registry, definition, inputs), cancellation_token)
            llm_turns += 1
            _steps(execution_details).append({"type": "llm_call", "index": llm_index})
            _emit_event(events, run_id, str(agent_node["id"]), "LlmCallCompleted", {"index": llm_index})
            if _is_cancelled(cancellation_token):
                return _agent_failure(agent_node, "WORKFLOW_CANCELLED", "Workflow run cancelled")
            limit_error = _run_limit_error(limits, started_at)
            if limit_error is not None:
                return _agent_failure(agent_node, **limit_error)
            parsed = json.loads(raw_output)
            tool_calls = _tool_calls_from(parsed)
            if not tool_calls:
                parsed_data = _payload_data_without_artifacts(parsed)
                missing_required = _missing_required_tools(tool_policy, called_tools)
                if missing_required:
                    return _agent_failure(agent_node, "REQUIRED_TOOL_NOT_CALLED", f"Required tool was not called: {missing_required[0]}")
                validation = WorkflowV2JsonSchemaService().validate_value(output_schema, parsed_data)
                _steps(execution_details).append({"type": "schema_validation", "status": "succeeded" if validation["valid"] else "failed"})
                if not validation["valid"]:
                    first_error = validation["errors"][0]
                    _emit_event(events, run_id, str(agent_node["id"]), "SchemaValidationFailed", {"status": "failed", "error": {"message": str(first_error["message"]), "field": str(first_error["path"])}})
                    if schema_retry_count >= limits["maxSchemaRetries"]:
                        return _agent_failure(agent_node, "workflow.output_schema_invalid", str(first_error["message"]), field=str(first_error["path"]))
                    schema_retry_count += 1
                    continue
                _emit_event(events, run_id, str(agent_node["id"]), "SchemaValidationSucceeded", {"status": "succeeded"})
                agent_artifacts = _save_artifacts_from_payload(parsed, run_id, str(agent_node["id"]), artifact_store)
                node_artifacts.extend(agent_artifacts)
                assistant_message = {"role": "assistant", "content": _assistant_content(raw_output, parsed_data, agent_artifacts), "visible": _agent_message_visible(agent_node)}
                if agent_artifacts:
                    assistant_message["artifacts"] = deepcopy(agent_artifacts)
                message_history.append(assistant_message)
                node_result = {"nodeId": agent_node["id"], "status": "succeeded", "input": deepcopy(node_input), "data": parsed_data, "artifacts": deepcopy(node_artifacts)}
                _steps(execution_details).append({"type": "node_result", "status": "succeeded", "data": deepcopy(parsed_data), "artifacts": deepcopy(node_artifacts)})
                return {"ok": True, "nodeResult": node_result, "output": parsed_data}
            message_history.append({"role": "assistant", "content": str(parsed.get("message", "")) if isinstance(parsed, dict) else "", "toolCalls": deepcopy(tool_calls)})
            for tool_call in tool_calls:
                if tool_call_count >= max_tool_calls:
                    return _agent_failure(agent_node, "WORKFLOW_LIMIT_EXCEEDED", "Runtime limit exceeded: maxToolCallsPerNode", limit="maxToolCallsPerNode")
                tool_error = _validate_tool_call(tool_call, tool_policy, tool_registry)
                _steps(execution_details).append({"type": "tool_call", "toolCallId": tool_call["id"], "name": tool_call["name"], "arguments": deepcopy(tool_call["arguments"])})
                _emit_event(events, run_id, str(agent_node["id"]), "ToolCallStarted", {"toolCallId": tool_call["id"], "name": tool_call["name"]})
                if tool_error is not None:
                    _emit_event(events, run_id, str(agent_node["id"]), "ToolCallCompleted", {"toolCallId": tool_call["id"], "name": tool_call["name"], "status": "failed", "error": deepcopy(tool_error)})
                    return _agent_failure(agent_node, **tool_error)
                try:
                    result = _execute_tool(tool_call, tool_executor_registry, _tool_timeout(agent_node, tool_policy))
                except asyncio.TimeoutError:
                    _append_failed_tool_result(message_history, execution_details, tool_call, "TOOL_TIMEOUT", "Tool execution timed out")
                    _emit_event(events, run_id, str(agent_node["id"]), "ToolCallCompleted", {"toolCallId": tool_call["id"], "name": tool_call["name"], "status": "failed", "error": {"code": "TOOL_TIMEOUT", "message": "Tool execution timed out"}})
                    return _agent_failure(agent_node, "TOOL_TIMEOUT", "Tool execution timed out")
                except ToolExecutorError as error:
                    field = error.field if isinstance(error, ToolInputValidationError) else None
                    code = "TOOL_ARGUMENT_INVALID" if field else "TOOL_EXECUTION_FAILED"
                    _append_failed_tool_result(message_history, execution_details, tool_call, code, str(error), field=field)
                    event_error: dict[str, Any] = {"code": code, "message": str(error)}
                    if field is not None:
                        event_error["field"] = field
                    _emit_event(events, run_id, str(agent_node["id"]), "ToolCallCompleted", {"toolCallId": tool_call["id"], "name": tool_call["name"], "status": "failed", "error": event_error})
                    return _agent_failure(agent_node, code, str(error), field=field)
                except Exception as error:
                    _append_failed_tool_result(message_history, execution_details, tool_call, "TOOL_EXECUTION_FAILED", str(error))
                    _emit_event(events, run_id, str(agent_node["id"]), "ToolCallCompleted", {"toolCallId": tool_call["id"], "name": tool_call["name"], "status": "failed", "error": {"code": "TOOL_EXECUTION_FAILED", "message": str(error)}})
                    return _agent_failure(agent_node, "TOOL_EXECUTION_FAILED", str(error))
                called_tools.add(tool_call["name"])
                tool_call_count += 1
                tool_artifacts = _save_artifacts_from_tool_result(result, run_id, str(agent_node["id"]), artifact_store)
                node_artifacts.extend(tool_artifacts)
                tool_data = _tool_result_data(result)
                tool_message = {"role": "tool", "toolCallId": tool_call["id"], "name": tool_call["name"], "status": "succeeded", "data": deepcopy(tool_data)}
                if tool_artifacts:
                    tool_message["artifacts"] = deepcopy(tool_artifacts)
                message_history.append(tool_message)
                tool_result_step = {"type": "tool_result", "toolCallId": tool_call["id"], "name": tool_call["name"], "status": "succeeded", "data": deepcopy(tool_data)}
                if tool_artifacts:
                    tool_result_step["artifacts"] = deepcopy(tool_artifacts)
                _steps(execution_details).append(tool_result_step)
                _emit_event(events, run_id, str(agent_node["id"]), "ToolCallCompleted", {"toolCallId": tool_call["id"], "name": tool_call["name"], "status": "succeeded"})
    except json.JSONDecodeError as error:
        return _agent_failure(agent_node, "workflow.output_parse_failed", str(error), field="$")
    except Exception as error:
        return _agent_failure(agent_node, "workflow.run_failed", str(error))


def _single_agent_node(definition: dict[str, Any]) -> dict[str, Any] | None:
    nodes = [node for node in definition.get("nodes", []) if isinstance(node, dict)]
    agent_nodes = [node for node in nodes if node.get("type") == "agent"]
    end_ids = {str(node["id"]) for node in nodes if node.get("type") == "end" and node.get("id")}
    edges = definition.get("edges", [])
    if len(agent_nodes) != 1:
        return None
    agent_id = str(agent_nodes[0].get("id"))
    has_start = any(edge.get("source") == "START" and edge.get("target") == agent_id for edge in edges if isinstance(edge, dict))
    has_end = any(edge.get("source") == agent_id and str(edge.get("target")) in end_ids | {"END"} for edge in edges if isinstance(edge, dict))
    return agent_nodes[0] if has_start and has_end else None


def _run_condition_node(node: dict[str, Any], definition: dict[str, Any], node_outputs: dict[str, Any]) -> dict[str, Any]:
    config = node.get("config", {}) if isinstance(node.get("config", {}), dict) else {}
    branches = config.get("branches", [])
    if not isinstance(branches, list):
        branches = []
    steps: list[dict[str, Any]] = []
    evaluations: list[dict[str, Any]] = []
    for branch in branches:
        if not isinstance(branch, dict):
            continue
        source = branch.get("source", {})
        if not isinstance(source, dict):
            source = {}
        source_node_id = str(source.get("nodeId", source.get("node_id", "")))
        path = [str(item) for item in source.get("path", [])] if isinstance(source.get("path", []), list) else []
        resolved = _resolve_node_output_value(node_outputs, source_node_id, path)
        handle = str(branch.get("handle", branch.get("id", "")))
        evaluation = {
            "branch": handle,
            "source": {"nodeId": source_node_id, "path": path},
            "operator": branch.get("operator"),
            "expectedValue": deepcopy(branch.get("value")),
            "actualValue": deepcopy(resolved["value"]) if resolved["found"] else None,
            "matched": False,
        }
        evaluations.append(evaluation)
        steps.append({"type": "condition_evaluation", "branch": handle, "source": {"nodeId": source_node_id, "path": path}, "operator": branch.get("operator"), "value": branch.get("value"), "actualValue": evaluation["actualValue"]})
        if not resolved["found"]:
            field = f"{source_node_id}.{'.'.join(path)}" if path else source_node_id
            return _condition_failure(node, steps, "CONDITION_FIELD_NOT_FOUND", f"Condition source field not found: {field}", field=field, input_payload={"evaluations": evaluations})
        if _condition_matches(resolved["value"], str(branch.get("operator", "equals")), branch.get("value")):
            evaluation["matched"] = True
            target = str(_edge_target(definition, str(node["id"]), handle) or branch.get("target") or "")
            data = {"branch": handle, "target": target}
            input_payload = {"evaluations": evaluations}
            return {"ok": True, "target": target, "input": input_payload, "nodeResult": {"nodeId": node["id"], "status": "succeeded", "input": deepcopy(input_payload), "data": data}, "steps": [*steps, {"type": "condition_result", "branch": handle, "target": target}]}
    target = str(_edge_target(definition, str(node["id"]), "default") or config.get("defaultTarget") or config.get("default_target") or "")
    data = {"branch": "default", "target": target}
    input_payload = {"evaluations": evaluations}
    return {"ok": True, "target": target, "input": input_payload, "nodeResult": {"nodeId": node["id"], "status": "succeeded", "input": deepcopy(input_payload), "data": data}, "steps": [*steps, {"type": "condition_result", "branch": "default", "target": target}]}


def _run_workflow_ref_node(
    node: dict[str, Any],
    workflow_input: dict[str, Any],
    node_outputs: dict[str, Any],
    message_history: list[dict[str, Any]],
    definition_service: WorkflowV2DefinitionService | None,
    llm_client,
    tool_registry: ToolRegistry | None,
    tool_executor_registry: ToolExecutorRegistry | None,
    artifact_store: InMemoryWorkflowV2ArtifactStore,
    workflow_depth: int,
    limits: dict[str, Any] | None = None,
    cancellation_token: WorkflowV2CancellationToken | None = None,
) -> dict[str, Any]:
    config = node.get("config", {}) if isinstance(node.get("config", {}), dict) else {}
    workflow_id = str(config.get("workflowId", config.get("workflow_id", "")))
    version = config.get("version")
    message_context_mode = str(config.get("messageContextMode", config.get("message_context_mode", "inherit"))).lower()
    steps = [{"type": "workflow_ref_start", "workflowId": workflow_id, "workflowVersion": version}]
    if definition_service is None:
        return _workflow_ref_failure(node, steps, "workflow_ref.definition_service_missing", "Workflow definition service is not available")
    depth_limit = limits["maxWorkflowDepth"] if isinstance(limits, dict) else 8
    if workflow_depth >= depth_limit:
        return _workflow_ref_failure(node, steps, "workflow_ref.depth_limit_exceeded", "Workflow depth limit exceeded")
    if not workflow_id or not isinstance(version, int):
        return _workflow_ref_failure(node, steps, "workflow_ref.version_required", "Workflow Ref node requires an explicit published version")
    try:
        published = definition_service.get_version(workflow_id, version)
    except (WorkflowV2DefinitionNotFound, WorkflowV2PublishedVersionNotFound):
        return _workflow_ref_failure(node, steps, "workflow_ref.version_not_found", f"Workflow version not found: {workflow_id}@{version}")
    child_definition = published["definition"]
    child_input = _resolve_workflow_ref_input(config.get("inputBindings", config.get("input_bindings", {})), workflow_input, node_outputs)
    if not child_input["ok"]:
        return _workflow_ref_failure(node, steps, **child_input["error"])
    input_payload = dict(child_input["value"])
    input_payload.setdefault("message", json.dumps(child_input["value"], ensure_ascii=False, sort_keys=True))
    input_validation = _validate_contract(child_definition.get("inputSchema", child_definition.get("input_schema")), input_payload)
    steps.append({"type": "workflow_ref_input", "status": "succeeded" if input_validation["valid"] else "failed", "data": deepcopy(child_input["value"])})
    if not input_validation["valid"]:
        first_error = input_validation["errors"][0]
        return _workflow_ref_failure(node, steps, "workflow_ref.input_schema_invalid", str(first_error["message"]), field=str(first_error["path"]))
    if _is_cancelled(cancellation_token):
        return _workflow_ref_failure(node, steps, "WORKFLOW_CANCELLED", "Workflow run cancelled")
    inherited_messages = message_history if message_context_mode == "inherit" else None
    child_run = _execute_single_agent_run(
        run_id=f"workflow_run_{uuid4().hex}",
        workflow_id=workflow_id,
        workflow_version=version,
        definition=child_definition,
        input_payload=input_payload,
        definition_service=definition_service,
        llm_client=llm_client,
        tool_registry=tool_registry,
        tool_executor_registry=tool_executor_registry,
        artifact_store=artifact_store,
        workflow_depth=workflow_depth + 1,
        initial_messages=inherited_messages,
        cancellation_token=cancellation_token,
    )
    if message_context_mode == "inherit":
        message_history.extend(child_run["messages"][len(inherited_messages or []):])
    if child_run["status"] != "succeeded":
        child_error = child_run.get("error") if isinstance(child_run.get("error"), dict) else {}
        if child_error.get("code") == "WORKFLOW_CANCELLED":
            return _workflow_ref_failure(node, [*steps, {"type": "workflow_ref_result", "status": "cancelled", "error": child_error}], "WORKFLOW_CANCELLED", str(child_error.get("message", "Workflow run cancelled")))
        if child_error.get("code") == "workflow_ref.depth_limit_exceeded":
            return _workflow_ref_failure(node, [*steps, {"type": "workflow_ref_result", "status": "failed", "error": child_error}], str(child_error["code"]), str(child_error.get("message", "Workflow depth limit exceeded")))
        return _workflow_ref_failure(node, [*steps, {"type": "workflow_ref_result", "status": "failed", "error": child_run.get("error")}], "workflow_ref.child_failed", "Child workflow failed", field=workflow_id)
    output_validation = _validate_contract(child_definition.get("outputSchema", child_definition.get("output_schema")), child_run.get("output"))
    steps.append({"type": "workflow_ref_output", "status": "succeeded" if output_validation["valid"] else "failed", "data": deepcopy(child_run.get("output"))})
    if not output_validation["valid"]:
        first_error = output_validation["errors"][0]
        return _workflow_ref_failure(node, steps, "workflow_ref.output_schema_invalid", str(first_error["message"]), field=str(first_error["path"]))
    data = deepcopy(child_run.get("output"))
    node_result = {
        "nodeId": node["id"],
        "status": "succeeded",
        "input": deepcopy(input_payload),
        "data": data,
        "artifacts": deepcopy(child_run.get("finalResult", {}).get("artifacts", [])),
        "metadata": {
            "workflowId": workflow_id,
            "workflowVersion": version,
            "messageContextMode": message_context_mode,
            "childRunId": child_run["id"],
        },
    }
    return {"ok": True, "output": data, "nodeResult": node_result, "steps": [*steps, {"type": "workflow_ref_result", "status": "succeeded", "data": data}], "events": child_run.get("events", [])}


def _resolve_workflow_ref_input(bindings: Any, workflow_input: dict[str, Any], node_outputs: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(bindings, dict):
        bindings = {}
    result: dict[str, Any] = {}
    for name, value_ref in bindings.items():
        resolved = _resolve_value_ref(value_ref, workflow_input, node_outputs)
        if not resolved["found"]:
            return {"ok": False, "error": {"code": "workflow_ref.value_ref_not_found", "message": f"Workflow Ref input binding not found: {name}", "field": str(name)}}
        result[str(name)] = deepcopy(resolved["value"])
    return {"ok": True, "value": result}


def _resolve_agent_inputs(config: dict[str, Any], workflow_input: dict[str, Any], node_outputs: dict[str, Any]) -> dict[str, Any]:
    input_schema = config.get("inputSchema", config.get("input_schema"))
    if input_schema is None:
        return {"ok": True, "value": {}}
    bindings = config.get("inputBindings", config.get("input_bindings", {}))
    if not isinstance(bindings, dict):
        return {"ok": False, "error": {"code": "workflow.agent_input_bindings_invalid", "message": "Agent inputBindings must be an object"}}
    result: dict[str, Any] = {}
    for name, value_ref in bindings.items():
        resolved = _resolve_value_ref(value_ref, workflow_input, node_outputs)
        if not resolved["found"]:
            return {"ok": False, "error": {"code": "workflow.agent_input_value_not_found", "message": f"Agent input binding not found: {name}", "field": str(name)}}
        result[str(name)] = deepcopy(resolved["value"])
    validation = _validate_contract(input_schema, result)
    if not validation["valid"]:
        first_error = validation["errors"][0]
        return {"ok": False, "error": {"code": "workflow.agent_input_schema_invalid", "message": str(first_error["message"]), "field": str(first_error["path"])}}
    return {"ok": True, "value": result}


def _resolve_value_ref(value_ref: Any, workflow_input: dict[str, Any], node_outputs: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value_ref, dict):
        return {"found": False, "value": None}
    kind = str(value_ref.get("kind", value_ref.get("type", "")))
    if kind in {"constant", "ConstantValueRef"}:
        return {"found": True, "value": deepcopy(value_ref.get("value"))}
    if kind in {"nodeOutput", "node_output", "NodeOutputValueRef"}:
        node_id = str(value_ref.get("nodeId", value_ref.get("node_id", "")))
        path = [str(item) for item in value_ref.get("path", [])] if isinstance(value_ref.get("path", []), list) else []
        return _resolve_node_output_value(node_outputs, node_id, path)
    if kind in {"workflowInput", "workflow_input", "WorkflowInputValueRef", "userInput"}:
        path = [str(item) for item in value_ref.get("path", [])] if isinstance(value_ref.get("path", []), list) else []
        value: Any = workflow_input
        for segment in path:
            if not isinstance(value, dict) or segment not in value:
                return {"found": False, "value": None}
            value = value[segment]
        return {"found": True, "value": value}
    return {"found": False, "value": None}


def _validate_contract(schema: Any, value: Any) -> dict[str, Any]:
    if not isinstance(schema, dict):
        return {"valid": True, "errors": []}
    return WorkflowV2JsonSchemaService().validate_value(schema, value)


def _workflow_ref_failure(node: dict[str, Any], steps: list[dict[str, Any]], code: str, message: str, *, field: str | None = None, limit: str | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if field is not None:
        error["field"] = field
    if limit is not None:
        error["limit"] = limit
    return {"ok": False, "nodeResult": {"nodeId": node["id"], "status": "failed", "data": None, "error": error, "artifacts": [], "metadata": {}}, "error": error, "steps": [*steps, {"type": "workflow_ref_result", "status": "failed", "error": error}]}


def _append_child_events(events: list[dict[str, Any]], run_id: str, child_events: Any) -> None:
    if not isinstance(child_events, list):
        return
    for event in child_events:
        if not isinstance(event, dict):
            continue
        payload = deepcopy(event.get("payload", {})) if isinstance(event.get("payload", {}), dict) else {}
        payload.setdefault("childRunId", event.get("runId"))
        _emit_event(events, run_id, event.get("nodeId"), str(event.get("eventType", "message")), payload)


def _run_artifact_refs(run_artifacts: list[dict[str, Any]], node_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for artifact in [
        *run_artifacts,
        *[
            artifact
            for result in node_results
            if isinstance(result.get("artifacts"), list)
            for artifact in result["artifacts"]
        ],
    ]:
        if not isinstance(artifact, dict):
            continue
        artifact_id = str(artifact.get("id", ""))
        if not artifact_id or artifact_id in seen:
            continue
        seen.add(artifact_id)
        refs.append(deepcopy(artifact))
    return refs


def _build_final_result(
    end_node: dict[str, Any] | None,
    message_history: list[dict[str, Any]],
    node_outputs: dict[str, Any],
    artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    config = end_node.get("config", {}) if isinstance(end_node, dict) and isinstance(end_node.get("config", {}), dict) else {}
    final_config = config.get("finalResult", config.get("final_result", {}))
    if not isinstance(final_config, dict):
        final_config = {}
    return {
        "message": _last_visible_assistant_message(message_history),
        "data": _final_result_data(final_config.get("data"), node_outputs),
        "artifacts": [deepcopy(artifact) for artifact in artifacts if artifact.get("visible") is not False],
    }


def _save_artifacts_from_tool_result(
    result: Any,
    run_id: str,
    node_id: str,
    artifact_store: InMemoryWorkflowV2ArtifactStore,
) -> list[dict[str, Any]]:
    return _save_artifacts_from_payload(result, run_id, node_id, artifact_store)


def _save_artifacts_from_payload(
    payload: Any,
    run_id: str,
    node_id: str,
    artifact_store: InMemoryWorkflowV2ArtifactStore,
) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("artifacts"), list):
        return []
    refs: list[dict[str, Any]] = []
    for artifact in payload["artifacts"]:
        if isinstance(artifact, dict):
            refs.append(artifact_store.save(run_id=run_id, created_by_node_id=node_id, artifact=artifact))
    return refs


def _tool_result_data(result: Any) -> Any:
    if not isinstance(result, dict) or "artifacts" not in result:
        return deepcopy(result)
    if "data" in result:
        return deepcopy(result["data"])
    return {key: deepcopy(value) for key, value in result.items() if key != "artifacts"}


def _payload_data_without_artifacts(payload: Any) -> Any:
    if not isinstance(payload, dict) or "artifacts" not in payload:
        return deepcopy(payload)
    return {key: deepcopy(value) for key, value in payload.items() if key != "artifacts"}


def _assistant_content(raw_output: str, data: Any, artifacts: list[dict[str, Any]]) -> str:
    if not artifacts:
        return raw_output
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def _last_visible_assistant_message(message_history: list[dict[str, Any]]) -> str | None:
    for message in reversed(message_history):
        if message.get("role") == "assistant" and message.get("visible", True) is not False and message.get("content"):
            return str(message["content"])
    return None


def _final_result_data(binding: Any, node_outputs: dict[str, Any]) -> Any:
    if not isinstance(binding, dict):
        return None
    if binding.get("kind") not in {"nodeOutput", "node_output"}:
        return None
    source_node_id = str(binding.get("nodeId", binding.get("node_id", "")))
    path = [str(item) for item in binding.get("path", [])] if isinstance(binding.get("path", []), list) else []
    resolved = _resolve_node_output_value(node_outputs, source_node_id, path)
    return deepcopy(resolved["value"]) if resolved["found"] else None


def _condition_failure(node: dict[str, Any], steps: list[dict[str, Any]], code: str, message: str, *, field: str | None = None, input_payload: dict[str, Any] | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if field is not None:
        error["field"] = field
    return {"ok": False, "input": deepcopy(input_payload), "nodeResult": {"nodeId": node["id"], "status": "failed", "input": deepcopy(input_payload), "data": None, "error": error}, "error": error, "steps": [*steps, {"type": "condition_result", "status": "failed", "error": error}]}


def _resolve_node_output_value(node_outputs: dict[str, Any], node_id: str, path: list[str]) -> dict[str, Any]:
    if node_id not in node_outputs:
        return {"found": False, "value": None}
    value = node_outputs[node_id]
    for segment in path:
        if not isinstance(value, dict) or segment not in value:
            return {"found": False, "value": None}
        value = value[segment]
    return {"found": True, "value": value}


def _condition_matches(left: Any, operator: str, right: Any) -> bool:
    normalized = _normalize_operator(operator)
    if normalized == "equals":
        return left == right
    if normalized == "not_equals":
        return left != right
    if normalized == "greater_than":
        return _is_comparable_number(left, right) and left > right
    if normalized == "greater_than_or_equal":
        return _is_comparable_number(left, right) and left >= right
    if normalized == "less_than":
        return _is_comparable_number(left, right) and left < right
    if normalized == "less_than_or_equal":
        return _is_comparable_number(left, right) and left <= right
    if normalized == "contains":
        return isinstance(left, (str, list)) and right in left
    if normalized == "starts_with":
        return isinstance(left, str) and isinstance(right, str) and left.startswith(right)
    if normalized == "ends_with":
        return isinstance(left, str) and isinstance(right, str) and left.endswith(right)
    if normalized == "exists":
        return left is not None
    if normalized == "not_exists":
        return left is None
    if normalized == "in":
        return isinstance(right, list) and left in right
    if normalized == "not_in":
        return isinstance(right, list) and left not in right
    if normalized == "is_empty":
        return left in ("", None, []) or left == {}
    if normalized == "is_not_empty":
        return left not in ("", None, []) and left != {}
    return False


def _normalize_operator(operator: str) -> str:
    value = operator.replace("-", "_")
    result = []
    for char in value:
        if char.isupper():
            result.append("_")
            result.append(char.lower())
        else:
            result.append(char)
    return "".join(result).strip("_").lower()


def _is_comparable_number(left: Any, right: Any) -> bool:
    return isinstance(left, (int, float)) and not isinstance(left, bool) and isinstance(right, (int, float)) and not isinstance(right, bool)


def _node_by_id(definition: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(node["id"]): node for node in definition.get("nodes", []) if isinstance(node, dict) and node.get("id")}


def _edge_target(definition: dict[str, Any], source: str, handle: str) -> str:
    for edge in definition.get("edges", []):
        if not isinstance(edge, dict) or str(edge.get("source", edge.get("from", ""))) != source:
            continue
        edge_handle = str(edge.get("sourceHandle", edge.get("source_handle", edge.get("route", edge.get("condition", "")))))
        if edge_handle == handle:
            return str(edge.get("target", edge.get("to", "")))
    return ""


def _agent_failure(agent_node: dict[str, Any], code: str, message: str, *, field: str | None = None, limit: str | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if field is not None:
        error["field"] = field
    if limit is not None:
        error["limit"] = limit
    return {"ok": False, "nodeResult": {"nodeId": agent_node["id"], "status": "failed", "data": None, "error": error}, "error": error}


def _agent_message_visible(agent_node: dict[str, Any]) -> bool:
    visibility = str(agent_node.get("config", {}).get("visibility", "visible")).lower()
    return visibility != "hidden"


def _provider_messages(
    agent_node: dict[str, Any],
    output_schema: dict[str, Any],
    message_history: list[dict[str, Any]],
    tool_registry: ToolRegistry | None,
    definition: dict[str, Any],
    inputs: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    instruction = str(agent_node.get("config", {}).get("instruction", ""))
    messages = [
        {"role": "system", "content": f"Current Agent Node Instruction:\n{instruction}"},
        {"role": "system", "content": f"Return a JSON object matching this Output Schema:\n{json.dumps(output_schema, ensure_ascii=False, sort_keys=True)}"},
        {"role": "system", "content": f"Available Tools:\n{json.dumps(_available_tools(agent_node, tool_registry, definition), ensure_ascii=False, sort_keys=True)}"},
    ]
    if inputs:
        messages.append({"role": "system", "content": f"Resolved Agent Inputs:\n{json.dumps(inputs, ensure_ascii=False, sort_keys=True)}"})
    messages.extend(deepcopy(message_history))
    return messages


def _user_message(input_payload: dict[str, Any]) -> dict[str, Any]:
    message = input_payload.get("message", input_payload.get("input", ""))
    return {"role": "user", "content": str(message)}


def _tool_calls_from(parsed: Any) -> list[dict[str, Any]]:
    if not isinstance(parsed, dict):
        return []
    raw_calls = parsed.get("toolCalls", parsed.get("tool_calls", []))
    if not isinstance(raw_calls, list):
        return []
    calls: list[dict[str, Any]] = []
    for index, raw_call in enumerate(raw_calls):
        if not isinstance(raw_call, dict):
            continue
        call_id = str(raw_call.get("id", raw_call.get("call_id", f"tool_call_{index + 1}")))
        name = str(raw_call.get("name", raw_call.get("toolName", raw_call.get("tool_name", ""))))
        arguments = raw_call.get("arguments", raw_call.get("args", {}))
        calls.append({"id": call_id, "name": name, "arguments": deepcopy(arguments) if isinstance(arguments, dict) else {}})
    return calls


def _validate_tool_call(
    tool_call: dict[str, Any],
    tool_policy: Any,
    tool_registry: ToolRegistry | None,
) -> dict[str, Any] | None:
    tool_name = tool_call["name"]
    if tool_name not in _allowed_tool_names(tool_policy):
        return {"code": "TOOL_NOT_ALLOWED", "message": f"Tool is not allowed for this Agent node: {tool_name}"}
    if tool_registry is None or not tool_registry.has(tool_name):
        return {"code": "TOOL_NOT_ALLOWED", "message": f"Tool is not registered for this workflow: {tool_name}"}
    schema = tool_registry.get(tool_name).input_schema
    if schema:
        validation = WorkflowV2JsonSchemaService().validate_value(schema, tool_call["arguments"])
        if not validation["valid"]:
            first_error = validation["errors"][0]
            return {"code": "TOOL_ARGUMENT_INVALID", "message": str(first_error["message"]), "field": str(first_error["path"])}
    return None


def _execute_tool(tool_call: dict[str, Any], tool_executor_registry: ToolExecutorRegistry | None, timeout: float | None) -> Any:
    if tool_executor_registry is None:
        raise ToolExecutorError("tool.executor_missing", tool_call["name"], f"Tool executor registry is not available: {tool_call['name']}")
    coroutine = tool_executor_registry.execute(tool_call["name"], deepcopy(tool_call["arguments"]))
    if timeout is not None:
        coroutine = asyncio.wait_for(coroutine, timeout=timeout)
    return asyncio.run(coroutine)


def _append_failed_tool_result(
    message_history: list[dict[str, Any]],
    execution_details: dict[str, Any],
    tool_call: dict[str, Any],
    code: str,
    message: str,
    *,
    field: str | None = None,
) -> None:
    error: dict[str, Any] = {"code": code, "message": message}
    if field is not None:
        error["field"] = field
    tool_message = {"role": "tool", "toolCallId": tool_call["id"], "name": tool_call["name"], "status": "failed", "error": error}
    message_history.append(tool_message)
    _steps(execution_details).append({"type": "tool_result", "toolCallId": tool_call["id"], "name": tool_call["name"], "arguments": deepcopy(tool_call["arguments"]), "status": "failed", "error": error})


def _allowed_tool_names(tool_policy: Any) -> set[str]:
    if not isinstance(tool_policy, dict):
        return set()
    mode = str(tool_policy.get("mode", "disabled")).lower()
    if mode == "disabled":
        return set()
    return {str(tool) for tool in tool_policy.get("allowedTools", tool_policy.get("allowed_tools", [])) if tool}


def _missing_required_tools(tool_policy: Any, called_tools: set[str]) -> list[str]:
    if not isinstance(tool_policy, dict) or str(tool_policy.get("mode", "disabled")).lower() != "required":
        return []
    required = [str(tool) for tool in tool_policy.get("requiredTools", tool_policy.get("required_tools", [])) if tool]
    return [tool for tool in required if tool not in called_tools]


def _available_tools(agent_node: dict[str, Any], tool_registry: ToolRegistry | None, definition: dict[str, Any]) -> list[dict[str, Any]]:
    if tool_registry is None:
        return []
    workflow_tools = {str(tool) if isinstance(tool, str) else str(tool.get("id", "")) for tool in definition.get("tools", [])}
    allowed = _allowed_tool_names(agent_node.get("config", {}).get("toolPolicy", {}))
    return [
        {"id": tool.tool_id, "name": tool.name, "description": tool.description, "inputSchema": dict(tool.input_schema or {})}
        for tool in tool_registry.list()
        if tool.tool_id in workflow_tools and tool.tool_id in allowed
    ]


def _steps(execution_details: dict[str, Any]) -> list[dict[str, Any]]:
    return execution_details["nodes"][-1]["steps"]


def _next_llm_index(execution_details: dict[str, Any]) -> int:
    return 1 + len([step for step in _steps(execution_details) if step["type"] == "llm_call"])


def _tool_timeout(agent_node: dict[str, Any], tool_policy: Any) -> float | None:
    value = None
    if isinstance(tool_policy, dict):
        value = tool_policy.get("timeoutSeconds")
    value = value if value is not None else agent_node.get("config", {}).get("timeoutSeconds")
    if isinstance(value, (int, float)) and value > 0:
        return float(value)
    return None


def _positive_int(value: Any, default: int) -> int:
    return value if isinstance(value, int) and value > 0 else default


def _runtime_limits(definition: dict[str, Any]) -> dict[str, Any]:
    configured = definition.get("runtimeLimits", definition.get("runtime_limits", {}))
    if not isinstance(configured, dict):
        configured = {}
    return {
        "maxLlmTurnsPerNode": _positive_int(configured.get("maxLlmTurnsPerNode", configured.get("max_llm_turns_per_node")), 12),
        "maxToolCallsPerNode": _positive_int(configured.get("maxToolCallsPerNode", configured.get("max_tool_calls_per_node")), 32),
        "maxNodeExecutions": _positive_int(configured.get("maxNodeExecutions", configured.get("max_node_executions")), 128),
        "maxWorkflowDepth": _positive_int(configured.get("maxWorkflowDepth", configured.get("max_workflow_depth")), 8),
        "maxSchemaRetries": _positive_int(configured.get("maxSchemaRetries", configured.get("max_schema_retries")), 0),
        "workflowTimeoutMs": configured.get("workflowTimeoutMs", configured.get("workflow_timeout_ms")),
    }


def _run_limit_error(limits: dict[str, Any], started_at: float) -> dict[str, Any] | None:
    timeout_ms = limits.get("workflowTimeoutMs")
    if isinstance(timeout_ms, (int, float)) and timeout_ms > 0:
        elapsed_ms = (time.monotonic() - started_at) * 1000
        if elapsed_ms > timeout_ms:
            return {
                "code": "WORKFLOW_LIMIT_EXCEEDED",
                "message": "Runtime limit exceeded: workflowTimeoutMs",
                "limit": "workflowTimeoutMs",
            }
    return None


def _is_cancelled(cancellation_token: WorkflowV2CancellationToken | None) -> bool:
    return cancellation_token is not None and cancellation_token.is_cancelled()


def _complete_llm(llm_client, messages: list[dict[str, Any]], cancellation_token: WorkflowV2CancellationToken | None) -> str:
    try:
        return llm_client.complete(messages, {"cancellationToken": cancellation_token})
    except TypeError:
        return llm_client.complete(messages)


def _messages_with_sequence(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sequenced: list[dict[str, Any]] = []
    for index, message in enumerate(messages):
        item = deepcopy(message)
        item.setdefault("sequence", index + 1)
        sequenced.append(item)
    return sequenced


def _empty_execution_details() -> dict[str, Any]:
    return {"nodes": []}


def _failed_run(
    run_id: str,
    workflow_id: str,
    workflow_version: int,
    input_payload: dict[str, Any],
    node_results: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    execution_details: dict[str, Any],
    events: list[dict[str, Any]],
    code: str,
    message: str,
    *,
    field: str | None = None,
    limit: str | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if field is not None:
        error["field"] = field
    if limit is not None:
        error["limit"] = limit
    status = "cancelled" if code == "WORKFLOW_CANCELLED" else "failed"
    _emit_event(events, run_id, None, "WorkflowFailed", {"status": status, "error": deepcopy(error)})
    return WorkflowV2RunRecord(
        id=run_id,
        workflow_id=workflow_id,
        workflow_version=workflow_version,
        status=status,
        input=input_payload,
        output=None,
        final_result=None,
        node_results=node_results,
        messages=messages,
        artifacts=[],
        execution_details=execution_details,
        events=events,
        error=error,
        created_at=_now(),
    ).to_dict()


def _emit_event(
    events: list[dict[str, Any]],
    run_id: str,
    node_id: str | None,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event = {
        "runId": run_id,
        "nodeId": node_id,
        "timestamp": _now(),
        "sequence": len(events) + 1,
        "eventType": event_type,
        "payload": deepcopy(payload or {}),
    }
    events.append(event)
    return event


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
