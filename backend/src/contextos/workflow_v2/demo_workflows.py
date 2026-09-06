from __future__ import annotations

from copy import deepcopy
from typing import Any


def technical_research_workflow_definition() -> dict[str, Any]:
    return deepcopy(
        {
            "id": "technical-research-flow",
            "name": "Technical Research Workflow",
            "schemaVersion": 2,
            "inputSchema": {
                "type": "object",
                "required": ["topic"],
                "properties": {"topic": {"type": "string"}},
            },
            "outputSchema": {
                "type": "object",
                "required": ["summary", "category"],
                "properties": {"summary": {"type": "string"}, "category": {"type": "string"}},
            },
            "tools": ["web.search", "file.generate"],
            "nodes": [
                {
                    "id": "research-agent",
                    "type": "agent",
                    "config": {
                        "name": "Research Agent",
                        "instruction": "Research the technical topic with the web search tool.",
                        "visibility": "visible",
                        "toolPolicy": {"mode": "auto", "allowedTools": ["web.search"]},
                        "outputSchema": {
                            "type": "object",
                            "required": ["researchSummary"],
                            "properties": {"researchSummary": {"type": "string"}},
                        },
                    },
                },
                {
                    "id": "generate-report",
                    "type": "agent",
                    "config": {
                        "name": "Generate Report Agent",
                        "instruction": "Generate a report artifact for the technical research.",
                        "visibility": "visible",
                        "toolPolicy": {"mode": "auto", "allowedTools": ["file.generate"]},
                        "outputSchema": {
                            "type": "object",
                            "required": ["summary", "category"],
                            "properties": {"summary": {"type": "string"}, "category": {"type": "string"}},
                        },
                    },
                },
                {"id": "end-1", "type": "end"},
            ],
            "edges": [
                {"source": "START", "target": "research-agent"},
                {"source": "research-agent", "target": "generate-report"},
                {"source": "generate-report", "target": "end-1"},
            ],
        }
    )


def release_gate_workflow_definition(*, technical_workflow_id: str = "technical-research-flow", technical_workflow_version: int = 1) -> dict[str, Any]:
    return deepcopy(
        {
            "id": "release-gate-flow",
            "name": "Release Gate Workflow",
            "schemaVersion": 2,
            "inputSchema": {
                "type": "object",
                "required": ["message"],
                "properties": {"message": {"type": "string"}},
            },
            "outputSchema": {
                "type": "object",
                "required": ["summary", "category"],
                "properties": {"summary": {"type": "string"}, "category": {"type": "string"}},
            },
            "tools": [],
            "nodes": [
                {
                    "id": "analyze-request",
                    "type": "agent",
                    "config": {
                        "name": "Analyze Request",
                        "instruction": "Classify the incoming request and extract the research topic.",
                        "visibility": "visible",
                        "toolPolicy": {"mode": "disabled"},
                        "outputSchema": {
                            "type": "object",
                            "required": ["category", "topic", "confidence", "summary"],
                            "properties": {
                                "category": {"type": "string", "enum": ["technical", "business", "general"]},
                                "topic": {"type": "string"},
                                "confidence": {"type": "number"},
                                "summary": {"type": "string"},
                            },
                        },
                    },
                },
                {
                    "id": "route-category",
                    "type": "condition",
                    "config": {
                        "branches": [
                            {"handle": "technical", "source": {"nodeId": "analyze-request", "path": ["category"]}, "operator": "equals", "value": "technical", "target": "technical-research"},
                            {"handle": "business", "source": {"nodeId": "analyze-request", "path": ["category"]}, "operator": "equals", "value": "business", "target": "business-analysis"},
                        ],
                        "defaultTarget": "general-agent",
                    },
                },
                {
                    "id": "technical-research",
                    "type": "workflow",
                    "config": {
                        "workflowId": technical_workflow_id,
                        "version": technical_workflow_version,
                        "messageContextMode": "inherit",
                        "inputBindings": {"topic": {"kind": "nodeOutput", "nodeId": "analyze-request", "path": ["topic"]}},
                    },
                },
                {
                    "id": "business-analysis",
                    "type": "agent",
                    "config": {
                        "name": "Business Analysis Agent",
                        "instruction": "Produce a business analysis summary.",
                        "visibility": "visible",
                        "toolPolicy": {"mode": "disabled"},
                        "outputSchema": {"type": "object", "required": ["summary", "category"], "properties": {"summary": {"type": "string"}, "category": {"type": "string"}}},
                    },
                },
                {
                    "id": "general-agent",
                    "type": "agent",
                    "config": {
                        "name": "General Agent",
                        "instruction": "Produce a general summary.",
                        "visibility": "visible",
                        "toolPolicy": {"mode": "disabled"},
                        "outputSchema": {"type": "object", "required": ["summary", "category"], "properties": {"summary": {"type": "string"}, "category": {"type": "string"}}},
                    },
                },
                {
                    "id": "generate-final",
                    "type": "agent",
                    "config": {
                        "name": "Generate Final",
                        "instruction": "Generate the final handoff summary.",
                        "visibility": "visible",
                        "toolPolicy": {"mode": "disabled"},
                        "outputSchema": {"type": "object", "required": ["summary", "category"], "properties": {"summary": {"type": "string"}, "category": {"type": "string"}}},
                    },
                },
                {
                    "id": "end-1",
                    "type": "end",
                    "config": {
                        "finalResult": {
                            "message": {"mode": "lastVisibleAssistant"},
                            "artifacts": {"mode": "allVisible"},
                            "data": {"kind": "nodeOutput", "nodeId": "generate-final", "path": ["summary"]},
                        }
                    },
                },
            ],
            "edges": [
                {"source": "START", "target": "analyze-request"},
                {"source": "analyze-request", "target": "route-category"},
                {"source": "route-category", "target": "technical-research", "sourceHandle": "technical"},
                {"source": "route-category", "target": "business-analysis", "sourceHandle": "business"},
                {"source": "route-category", "target": "general-agent", "sourceHandle": "default"},
                {"source": "technical-research", "target": "generate-final"},
                {"source": "business-analysis", "target": "generate-final"},
                {"source": "general-agent", "target": "generate-final"},
                {"source": "generate-final", "target": "end-1"},
            ],
        }
    )
