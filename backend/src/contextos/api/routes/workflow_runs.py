from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionNotFound, WorkflowV2PublishedVersionNotFound
from contextos.workflow_v2.runtime.artifacts import InMemoryWorkflowV2ArtifactStore, WorkflowV2ArtifactNotFound
from contextos.workflow_v2.runtime.runs import WorkflowV2RunNotFound, WorkflowV2RunService
import json


def post_workflow_run(workflow_id: str, payload: dict[str, object], service: WorkflowV2RunService) -> dict[str, object]:
    if "version" not in payload:
        return {"status": 400, "body": {"error": {"code": "workflow.version_required", "message": "Workflow run requires an explicit published version"}}}
    try:
        input_payload = payload.get("input", {})
        if not isinstance(input_payload, dict):
            input_payload = {"message": str(input_payload)}
        starter = service.start_async if payload.get("async") is True else service.start
        return {
            "status": 201,
            "body": starter(workflow_id=workflow_id, version=int(payload["version"]), input_payload=input_payload),
        }
    except (WorkflowV2DefinitionNotFound, WorkflowV2PublishedVersionNotFound):
        return {"status": 404, "body": {"error": {"code": "workflow.version_not_found", "message": f"Workflow version not found: {workflow_id}@{payload.get('version')}"}}}


def get_workflow_run(run_id: str, service: WorkflowV2RunService) -> dict[str, object]:
    try:
        return {"status": 200, "body": service.get(run_id)}
    except WorkflowV2RunNotFound:
        return {"status": 404, "body": {"error": {"code": "workflow_run.not_found", "message": f"Workflow run not found: {run_id}"}}}


def get_workflow_run_nodes(run_id: str, service: WorkflowV2RunService) -> dict[str, object]:
    try:
        run = service.get(run_id)
        return {"status": 200, "body": {"nodes": _run_node_details(run)}}
    except WorkflowV2RunNotFound:
        return {"status": 404, "body": {"error": {"code": "workflow_run.not_found", "message": f"Workflow run not found: {run_id}"}}}


def get_workflow_run_messages(run_id: str, service: WorkflowV2RunService) -> dict[str, object]:
    try:
        run = service.get(run_id)
        return {"status": 200, "body": {"messages": run.get("messages", [])}}
    except WorkflowV2RunNotFound:
        return {"status": 404, "body": {"error": {"code": "workflow_run.not_found", "message": f"Workflow run not found: {run_id}"}}}


def post_workflow_run_cancel(run_id: str, service: WorkflowV2RunService) -> dict[str, object]:
    try:
        return {"status": 200, "body": service.cancel(run_id)}
    except WorkflowV2RunNotFound:
        return {"status": 404, "body": {"error": {"code": "workflow_run.not_found", "message": f"Workflow run not found: {run_id}"}}}


def get_workflow_run_artifacts(run_id: str, run_service: WorkflowV2RunService, artifact_store: InMemoryWorkflowV2ArtifactStore) -> dict[str, object]:
    try:
        run_service.get(run_id)
        return {"status": 200, "body": {"artifacts": artifact_store.list_by_run(run_id)}}
    except WorkflowV2RunNotFound:
        return {"status": 404, "body": {"error": {"code": "workflow_run.not_found", "message": f"Workflow run not found: {run_id}"}}}


def iter_workflow_run_event_frames(run_id: str, run_service: WorkflowV2RunService):
    try:
        run = run_service.get(run_id)
    except WorkflowV2RunNotFound:
        event = {
            "runId": run_id,
            "nodeId": None,
            "sequence": 1,
            "eventType": "WorkflowFailed",
            "payload": {"status": "failed", "error": {"code": "workflow_run.not_found", "message": f"Workflow run not found: {run_id}"}},
        }
        yield _sse_frame("WorkflowFailed", event)
        return
    for event in run.get("events", []):
        if isinstance(event, dict):
            yield _sse_frame(str(event.get("eventType", "message")), event)


def get_workflow_artifact_content(artifact_id: str, artifact_store: InMemoryWorkflowV2ArtifactStore) -> dict[str, object]:
    try:
        content = artifact_store.get_content(artifact_id)
        return {
            "status": 200,
            "body": content["content"],
            "contentType": content["mimeType"],
            "name": content["name"],
        }
    except WorkflowV2ArtifactNotFound:
        return {"status": 404, "body": {"error": {"code": "workflow_artifact.not_found", "message": f"Workflow artifact not found: {artifact_id}"}}}


def _sse_frame(event_type: str, payload: dict[str, object]) -> str:
    data = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return f"event: {event_type}\ndata: {data}\n\n"


def _run_node_details(run: dict[str, object]) -> list[dict[str, object]]:
    node_results = run.get("nodeResults", [])
    result_by_node_id = {
        str(result.get("nodeId")): result
        for result in node_results
        if isinstance(result, dict) and result.get("nodeId") is not None
    } if isinstance(node_results, list) else {}
    execution_details = run.get("executionDetails", {})
    execution_nodes = execution_details.get("nodes", []) if isinstance(execution_details, dict) else []
    details: list[dict[str, object]] = []
    seen: set[str] = set()
    if isinstance(execution_nodes, list):
        for node in execution_nodes:
            if not isinstance(node, dict):
                continue
            node_id = str(node.get("nodeId", ""))
            if not node_id:
                continue
            result = result_by_node_id.get(node_id, {})
            details.append({
                "nodeId": node_id,
                "status": result.get("status") if isinstance(result, dict) else None,
                "steps": node.get("steps", []) if isinstance(node.get("steps"), list) else [],
                "nodeResult": result,
            })
            seen.add(node_id)
    for node_id, result in result_by_node_id.items():
        if node_id not in seen:
            details.append({"nodeId": node_id, "status": result.get("status"), "steps": [], "nodeResult": result})
    return details
