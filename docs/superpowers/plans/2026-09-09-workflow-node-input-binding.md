# Workflow Node Input Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing V2 `ValueRef` flow so Agent Nodes can receive schema-driven inputs from Workflow Input, reachable upstream Node outputs, or constants without exposing `$state`.

**Architecture:** Keep Edge as execution topology and `ValueRef` as data binding. Add optional `inputSchema`/`inputBindings` to Agent config, reuse existing schema helpers and resolver aliases, and preserve the current message-history behavior when no Agent input schema is declared.

**Tech Stack:** Python 3, unittest, vanilla JavaScript, Node test runner, existing Workflow V2 Workbench and HTTP Runtime.

**Spec:** `docs/superpowers/specs/2026-09-09-workflow-node-input-binding-design.md`

## Global Constraints

- Do not introduce new Graph node types, providers, state-path UI, or a second binding model.
- Edge represents execution topology; bindings represent explicit data transfer.
- Existing Agent nodes without `inputSchema` and existing Workflow Ref/End bindings must remain compatible.
- Use TDD: each production change follows a failing test and a passing focused test.

---

### Task 1: Agent Input Contract and Binding Validation

**Files:**
- Modify: `backend/src/contextos/workflow_v2/application/validation.py`
- Modify: `backend/src/contextos/workflow_v2/domain/agent_node.py`
- Test: `backend/tests/unit/test_workflow_v2_validator.py`

**Interfaces:**
- Consumes: Agent `config.inputSchema` and `config.inputBindings`, existing definition nodes and edges.
- Produces: Validation for Agent input schema, binding shape, source reachability, and schema compatibility.

- [x] **Step 1: Write failing tests**

Add tests that assert:

```python
agent_b = {
    "id": "b", "type": "agent", "config": {
        "instruction": "use inputs",
        "inputSchema": {"type": "object", "required": ["content"], "properties": {"content": {"type": "string"}}},
        "inputBindings": {"content": {"kind": "nodeOutput", "nodeId": "a", "path": ["response"]}},
        "outputSchema": {"type": "object", "properties": {"response": {"type": "string"}}},
    },
}
```

Cover valid reachable binding, incompatible output type, downstream/unreachable source, required input missing, and invalid schema. Run the focused validator tests and confirm they fail because Agent input bindings are not validated.

- [x] **Step 2: Implement the smallest validator extension**

Validate optional Agent `inputSchema` with the existing JSON Schema service. Validate each binding using the existing ValueRef shape and schema helpers, require bindings for required fields, and accept only sources reachable through existing graph edges. Reuse integer-to-number compatibility. Keep legacy Agent configs unchanged.

- [x] **Step 3: Run focused validator tests**

Run:

```powershell
python -m unittest tests.unit.test_workflow_v2_validator
```

Expected: all validator tests pass.

---

### Task 2: Resolve Bound Agent Inputs at Runtime

**Files:**
- Modify: `backend/src/contextos/workflow_v2/runtime/runs.py`
- Test: `backend/tests/unit/test_workflow_v2_runtime.py`

**Interfaces:**
- Consumes: validated Agent `inputSchema`/`inputBindings`, workflow input, and already executed `node_outputs`.
- Produces: resolved Agent input in provider context and NodeResult/execution detail, with missing or invalid bindings reported as node failure.

- [x] **Step 1: Write failing runtime tests**

Add a two-Agent definition where the first returns `response: "A"` and the second binds `content` to that output. Assert the second LLM receives a structured input containing `content: "A"`, its NodeResult input contains the same value, and a missing binding produces a failed run. Add a constant and workflow-input case.

- [x] **Step 2: Run the new tests and verify RED**

Run:

```powershell
python -m unittest tests.unit.test_workflow_v2_runtime.WorkflowV2RuntimeTests.test_agent_input_binding_resolves_upstream_output
```

Expected: failure because `_run_agent_node` currently only builds message history and does not resolve Agent bindings.

- [x] **Step 3: Implement minimal resolution**

Pass workflow input and `node_outputs` into `_run_agent_node`. Before building provider messages, resolve each declared binding with the existing `_resolve_value_ref`, validate the resulting object against `inputSchema`, and add only the resolved `inputs` object to the Agent context. Preserve the current message history and no-schema path. Include resolved inputs in execution details and NodeResult; return a normal structured node failure for missing/type-invalid values.

- [x] **Step 4: Run runtime and integration tests**

Run:

```powershell
python -m unittest tests.unit.test_workflow_v2_runtime
python -m unittest tests.integration.test_http_runtime_host
```

Expected: new binding tests and existing runtime/HTTP tests pass.

---

### Task 3: Schema-Driven Agent Input Binding UI

**Files:**
- Modify: `studio/src/pages/Workflow/WorkflowV2Workbench.js`
- Modify: `studio/src/main.js`
- Test: `studio/tests/workflow_v2_workbench.test.mjs`

**Interfaces:**
- Consumes: Agent `inputSchema`, existing output schema field helpers, edges, and canonical `ValueRef` objects.
- Produces: Agent Inspector input mapping view and update methods that persist canonical bindings without `$state`.

- [x] **Step 1: Write failing Workbench tests**

Assert that an Agent with two input fields exposes those fields, only reachable upstream outputs appear as choices, exact name/type matching creates a default binding after an edge exists, and changing the source updates `config.inputBindings` with `{ kind, nodeId, path }`. Assert incompatible outputs are absent and Workflow Input/Constant choices are present.

- [x] **Step 2: Run focused frontend tests and verify RED**

Run:

```powershell
node --test tests/workflow_v2_workbench.test.mjs
```

Expected: failure because Agent Inspector currently exposes Goal/Output/Tools/Edge summary but no input mapping view.

- [x] **Step 3: Implement the minimal Workbench model**

Add Agent input mapping metadata generated from `inputSchema`, derive source candidates from graph ancestors, and add deterministic auto-match only for missing fields: exact output name first, then one compatible output. Reuse existing `valueRefSchema`, `schemaTypesCompatible`, `outputSchemaFields`, and binding update patterns. Do not rewrite existing Workflow Ref binding code.

- [x] **Step 4: Implement the minimal renderer and event wiring**

Render the Agent input mapping using the existing binding control style. The UI shows field/type/source/Node/output or Constant, writes canonical camel-case ValueRefs, and never renders `$state` or raw internal state paths. Add change handling only for the new Agent input controls.

- [x] **Step 5: Run focused frontend tests**

Run:

```powershell
node --test tests/workflow_v2_workbench.test.mjs
```

Expected: all Workbench tests pass, including save/reload assertions.

---

### Task 4: Persistence, Invalid Reference Feedback, and Regression Verification

**Files:**
- Modify: `backend/tests/integration/test_http_runtime_host.py` only if an HTTP round-trip assertion is needed.
- Modify: `studio/tests/workflow_v2_edge_browser.test.mjs` only if browser coverage is needed.
- Modify: `RequirementsAndTasks/workflow-design/AgentWorkflow-Requirements-v1.0.md` only if the existing task status has a matching unfinished item for this capability.

**Interfaces:**
- Consumes: Tasks 1-3 Agent binding model and UI.
- Produces: verified draft round-trip, invalid binding diagnostics after graph edits, and regression evidence.

- [x] **Step 1: Add failing persistence/invalid-reference tests**

Cover save then reload preserving `inputSchema` and `inputBindings`, removing the source Node or its connecting Edge producing a validation issue, and ensuring existing Condition/Workflow Ref/End bindings remain unchanged.

- [x] **Step 2: Implement only missing persistence or diagnostics wiring**

Use the existing definition deep-copy/save path. Add no migration unless tests show the current serializer drops Agent input fields. Surface the existing validation issues in the Agent Inspector if the Workbench does not already expose them.

- [x] **Step 3: Run the complete verification set**

Run:

```powershell
python -m unittest discover -s backend/tests/unit -p 'test*.py'
python -m unittest discover -s backend/tests/integration -p 'test*.py'
Push-Location studio
npm test
npm run test:e2e
npm run lint
npm run build
Pop-Location
git diff --check
```

Expected: all existing and new tests pass, build/lint succeed, and no whitespace errors are reported.

- [x] **Step 4: Update task status only after acceptance**

Mark the matching requirement item `Completed` only after implementation, backend/frontend tests, persistence/runtime regression, and acceptance checks all pass. Otherwise leave it `In Progress` and record the exact gap.
