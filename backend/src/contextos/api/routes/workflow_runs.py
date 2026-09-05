from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionNotFound, WorkflowV2PublishedVersionNotFound
from contextos.workflow_v2.runtime.runs import WorkflowV2RunNotFound, WorkflowV2RunService


def post_workflow_run(workflow_id: str, payload: dict[str, object], service: WorkflowV2RunService) -> dict[str, object]:
    if "version" not in payload:
        return {"status": 400, "body": {"error": {"code": "workflow.version_required", "message": "Workflow run requires an explicit published version"}}}
    try:
        input_payload = payload.get("input", {})
        if not isinstance(input_payload, dict):
            input_payload = {"message": str(input_payload)}
        return {
            "status": 201,
            "body": service.start(workflow_id=workflow_id, version=int(payload["version"]), input_payload=input_payload),
        }
    except (WorkflowV2DefinitionNotFound, WorkflowV2PublishedVersionNotFound):
        return {"status": 404, "body": {"error": {"code": "workflow.version_not_found", "message": f"Workflow version not found: {workflow_id}@{payload.get('version')}"}}}


def get_workflow_run(run_id: str, service: WorkflowV2RunService) -> dict[str, object]:
    try:
        return {"status": 200, "body": service.get(run_id)}
    except WorkflowV2RunNotFound:
        return {"status": 404, "body": {"error": {"code": "workflow_run.not_found", "message": f"Workflow run not found: {run_id}"}}}
