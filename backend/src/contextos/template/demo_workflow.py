from __future__ import annotations

from copy import deepcopy
from typing import Any


DEMO_WORKFLOW_TEMPLATE_ID = "demo-workflow"
DEMO_WORKFLOW_SESSION_ID = "demo-workflow-session"
DEMO_WORKFLOW_TIMELINE_ID = "demo-workflow-timeline"


def demo_workflow_manifest() -> dict[str, Any]:
    return deepcopy(
        {
            "schema_version": "1.0",
            "template": {
                "id": DEMO_WORKFLOW_TEMPLATE_ID,
                "name": "Demo Workflow",
                "version": "1.0.0",
            },
            "runtime": {
                "nodes": [
                    {
                        "id": "capture_input",
                        "type": "prompt",
                        "name": "Capture Input",
                        "config": {
                            "template": "Workflow input: {{input}}",
                            "input_mapping": {"input": {"type": "workflow_input", "name": "input"}},
                            "output_key": "captured_input",
                        },
                    },
                    {
                        "id": "echo_tool",
                        "type": "tool",
                        "name": "Context Echo",
                        "config": {
                            "tool_name": "context.echo",
                            "args": {"query": {"type": "node_output", "node_id": "capture_input", "port": "out"}},
                            "output_key": "echo_result",
                        },
                    },
                    {
                        "id": "final_output",
                        "type": "output",
                        "name": "Final Output",
                        "config": {"source": {"type": "node_output", "node_id": "echo_tool", "port": "echo"}},
                    },
                ],
                "edges": [
                    {"id": "start-capture", "source": "START", "target": "capture_input"},
                    {"id": "capture-echo", "source": "capture_input", "target": "echo_tool"},
                    {"id": "echo-final", "source": "echo_tool", "target": "final_output"},
                    {"id": "final-end", "source": "final_output", "target": "END"},
                ],
            },
            "ui": {
                "nodes": {
                    "capture_input": {"position": {"x": 140, "y": 110}},
                    "echo_tool": {"position": {"x": 360, "y": 110}},
                    "final_output": {"position": {"x": 580, "y": 110}},
                },
                "viewport": {"zoom": 0.95},
            },
        }
    )
