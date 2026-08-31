# Workflow Agent Graph Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the runnable Workflow Builder loop from configured nodes to validated, published, testable Agent Graph sessions.

**Architecture:** Reuse the existing manifest, LangGraph compiler, AgentVersion, Session, and WorkflowWorkbench abstractions. Fill the narrow gaps where node config fields, LLM invocation options, tool metadata discovery, workflow test traces, and session creation are not exposed consistently.

**Tech Stack:** Python stdlib HTTP API and unittest backend; browser JavaScript modules and node:test frontend; existing LangGraph compiler.

**Spec:** User pasted Workflow Builder business-semantic node and Agent Graph closure requirements.

## Global Constraints

- Preserve existing workflow node dragging, edge editing, zoom, save, load, rename, and delete behavior.
- Use existing Session and Workflow APIs where possible.
- Keep changes minimal and avoid unrelated refactors.
- Follow TDD: write failing tests before production code.
- Do not introduce a custom graph scheduler; use existing LangGraph compiler.

---

### Task 1: Backend Node Semantics And Runtime Parameters

**Files:**
- Modify: `backend/src/contextos/provider/base/chat_client.py`
- Modify: `backend/src/contextos/provider/deepseek_anthropic.py`
- Modify: `backend/src/contextos/runtime/graph/nodes/llm.py`
- Modify: `backend/src/contextos/runtime/agent/test_run_service.py`
- Test: `backend/tests/unit/test_llm_node_executor.py`
- Test: `backend/tests/unit/test_agent_test_run_service.py`

**Interfaces:**
- Produces: `ChatCompletionClient.complete(messages, options=None)` accepts node-level call options.
- Produces: workflow test run body can expose final output from `graph_finished`.

- [ ] Write failing tests proving LLM node passes `provider`, `model`, `temperature`, and `max_tokens` to the provider.
- [ ] Write failing tests proving Agent test run stores final output and keeps node runtime events.
- [ ] Run target tests and verify expected failures.
- [ ] Implement optional provider call options with backward-compatible fallbacks.
- [ ] Run target tests and verify pass.

### Task 2: Tool Catalog API And Metadata

**Files:**
- Modify: `backend/src/contextos/tool/registry/metadata.py`
- Modify: `backend/src/contextos/tool/registry/registry.py`
- Create or modify: `backend/src/contextos/api/routes/tools.py`
- Modify: `backend/src/contextos/api/server.py`
- Test: `backend/tests/unit/test_tool_registry_api.py`

**Interfaces:**
- Produces: `GET /api/tools` returns `{ "tools": [{ id, name, description, input_schema, output_schema, configurable }] }`.
- Produces: `ToolMetadata` accepts optional `description`, `input_schema`, `output_schema`, `config_schema`, and `configurable`.

- [ ] Write failing tests for tool metadata serialization and API route.
- [ ] Run target tests and verify expected failures.
- [ ] Implement metadata fields and tools route.
- [ ] Run target tests and verify pass.

### Task 3: Frontend Workflow Configuration And Execution Loop

**Files:**
- Modify: `studio/src/api/agents.js`
- Modify: `studio/src/pages/Workflow/WorkflowWorkbench.js`
- Modify: `studio/src/main.js`
- Test: `studio/tests/workflow_api_client.test.mjs`
- Test: `studio/tests/workflow_workbench.test.mjs`
- Test: `studio/e2e/studio-app-interactions.spec.mjs`

**Interfaces:**
- Produces: workflow node schemas include LLM provider/max_tokens, prompt role/variables, condition state key, tool metadata.
- Produces: API client can list tools and create sessions for a published workflow version.
- Produces: Workflow page exposes Validate, Publish, Test, Trace, and Use Agent actions using existing routes.

- [ ] Write failing tests for node config schema additions, tool catalog loading, test run trace output, and Use Agent session creation.
- [ ] Run target tests and verify expected failures.
- [ ] Implement schema additions and UI state/actions with existing API client patterns.
- [ ] Run target tests and verify pass.

### Task 4: Regression Verification

**Files:**
- Test-only command execution.

**Interfaces:**
- Consumes all previous tasks.

- [ ] Run backend unit test suite.
- [ ] Run frontend lint.
- [ ] Run frontend unit suite.
- [ ] Run focused workflow E2E tests.
- [ ] Report files, APIs, reused Session implementations, tests, and results.
