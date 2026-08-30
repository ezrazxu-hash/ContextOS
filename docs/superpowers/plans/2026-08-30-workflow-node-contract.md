# Workflow Node Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Workflow Builder, manifest validation, LangGraph runtime compilation, and tests agree on PROMPT, LLM, TOOL, CONDITION, OUTPUT with system START/END and reserved AGENT/ROUTER.

**Architecture:** Keep the current manifest-driven graph architecture and the existing runtime/ui manifest split. Add a prompt executor and tighten validation/catalog/builder rules rather than introducing a migration framework or an agent loop.

**Tech Stack:** Python dataclass manifest/parser/validator/runtime executors, LangGraph `StateGraph(dict)`, Node.js model tests for Studio.

**Spec:** User request in this conversation, plus existing requirements in `RequirementsAndTasks/ContextOS-Agent-Workflow-Session-Binding-Implementation-Plan.md`.

## Global Constraints

- Node Library exposes only `prompt`, `llm`, `tool`, `condition`, `output`.
- START and END are system nodes, auto-present on canvas, not ordinary manifest nodes, and not deletable/copyable/creatable.
- AGENT and ROUTER are legacy/reserved and cannot be published until runtime support exists.
- Runtime data flow uses `$state.xxx`; edges are control flow.
- No `eval()` or `exec()` for condition logic.
- Keep changes simple, testable, and reversible.

---

### Task 1: Backend Manifest and Validation Contract

**Files:**
- Modify: `backend/src/contextos/template/node_catalog.py`
- Modify: `backend/src/contextos/template/validator/validator.py`
- Test: `backend/tests/unit/test_node_catalog.py`
- Test: `backend/tests/unit/test_manifest_validator.py`
- Test: `backend/tests/unit/test_manifest_parser.py`

**Interfaces:**
- Consumes: `TemplateManifest`, `NodeSpec`, `EdgeSpec`
- Produces: validation issues for unsupported node types, START/END misuse, and condition route shape

- [x] Write failing tests for catalog exposure and unsupported publish validation.
- [x] Implement catalog with visible runtime-supported nodes only.
- [x] Add validator checks for allowed node types, reserved node types, START/END uniqueness, and true/false condition routes.
- [x] Run focused backend tests.

### Task 2: Backend Executors and LangGraph Slices

**Files:**
- Create: `backend/src/contextos/runtime/graph/nodes/prompt.py`
- Modify: `backend/src/contextos/runtime/graph/nodes/condition.py`
- Modify: `backend/src/contextos/runtime/graph/nodes/llm.py`
- Modify: `backend/src/contextos/runtime/graph/nodes/__init__.py`
- Test: `backend/tests/unit/test_prompt_node_executor.py`
- Test: `backend/tests/unit/test_condition_node_executor.py`
- Test: `backend/tests/unit/test_llm_node_executor.py`
- Test: `backend/tests/integration/test_workflow_slice_llm.py`
- Test: `backend/tests/integration/test_workflow_slice_condition.py`

**Interfaces:**
- Consumes: `NodeSpec.config.template`, `input_mapping`, `output_key`, `$state` references
- Produces: prompt text in state, single LLM calls, registry tool calls, condition `route`

- [x] Write failing tests for PROMPT executor and condition `is_empty`.
- [x] Implement PROMPT executor by sharing simple template/state-path behavior.
- [x] Let LLM accept `prompt` as the new field while keeping `prompt_template` compatibility.
- [x] Update integration slices to run START -> PROMPT -> LLM -> OUTPUT -> END and the branch graph.

### Task 3: Frontend Builder and Manifest Round Trip

**Files:**
- Modify: `studio/src/features/workflow-builder/WorkflowBuilder.js`
- Modify: `studio/src/pages/Workflow/WorkflowWorkbench.js`
- Modify: `studio/src/workflow/nodes/registry.js`
- Modify: `studio/src/workflow/manifest/model.js`
- Modify: `studio/src/test/fixtures/demoRuntime.js`
- Test: `studio/tests/workflow_builder.test.mjs`
- Test: `studio/tests/workflow_workbench.test.mjs`
- Test: `studio/tests/workflow_node_registry.test.mjs`
- Test: `studio/tests/workflow_manifest_model.test.mjs`
- Test: `studio/tests/demo_seed.test.mjs`

**Interfaces:**
- Consumes: lower-case runtime manifest types and legacy `agent/router` data
- Produces: upper-case labels, START/END boundary nodes, condition handles, save/load round trip

- [x] Write failing tests for visible library types, boundary protections, each config panel, handles, and round trip.
- [x] Update builder supported type list and boundary protection.
- [x] Update workbench config schemas, branch labels, node handles, and local edge validation.
- [x] Update demo seed away from agent/router.

### Task 4: Verification

**Files:**
- No production files.

**Interfaces:**
- Consumes: changed backend and frontend tests
- Produces: passing focused test evidence

- [x] Run focused backend unit/integration tests.
- [x] Run focused Studio node/workflow tests.
- [x] Run syntax checks or lint for touched JS files.
- [x] Summarize changed files, test commands, and any remaining risk.
