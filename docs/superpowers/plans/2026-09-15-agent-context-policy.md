# Agent Context Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal, backward-compatible context policy to Workflow V2 Agent nodes without changing the Agent Loop or making non-Agent nodes inherit message history.

**Architecture:** Keep the existing run-local `message_history` and Agent Loop writes. Select the history view only when building Agent provider messages. Default missing policy to `Full History`; support `Current Turn`, `Current Group`, and `Explicit Inputs Only`, with group mode falling back to current turn when no group metadata exists.

**Tech Stack:** Python, unittest, JavaScript, Node test runner, Workflow V2 runtime.

**Spec:** `docs/superpowers/specs/2026-09-09-workflow-node-input-binding-design.md` and the preceding context-policy analysis.

## Global Constraints

- Do not add standalone V2 Prompt, LLM, Tool, or Transform nodes.
- Preserve ToolCall / ToolResult pairing and the existing Agent Loop.
- Preserve existing behavior when an Agent has no context policy.
- Do not modify Legacy Runtime behavior in this change.

---

### Task 1: Add failing runtime tests for Agent context policies

**Files:**
- Modify: `backend/tests/unit/test_workflow_v2_runtime.py`

**Interfaces:**
- Exercise the existing private run entry point with `initial_messages`.
- Assert provider messages, not implementation helpers.

- [x] Add tests for default full history, current turn, current group, and explicit inputs only.
- [x] Run the focused tests and confirm they fail because policy selection is not implemented.

### Task 2: Implement minimal policy selection

**Files:**
- Modify: `backend/src/contextos/workflow_v2/runtime/runs.py`

**Interfaces:**
- Add a small history projection helper used by `_provider_messages()`.
- Accept camelCase and snake_case policy names and a `{ "mode": ... }` object.

- [x] Implement policy normalization and history projection.
- [x] Keep default behavior as full history.
- [x] Use the projected history in both recorded Agent input and every Agent Loop LLM call.
- [x] Run the focused tests and confirm they pass.

### Task 3: Regression verification

**Files:**
- No additional files.

- [x] Run all Workflow V2 runtime, Workflow Ref, End Result, and Agent runtime unit tests.
- [x] Run the relevant integration workflow slice tests.
- [x] Inspect the final diff and confirm no unrelated changes were made.

### Task 4: Expose context policies in the Workflow V2 editor

**Files:**
- Modify: `studio/src/pages/Workflow/WorkflowV2Workbench.js`
- Modify: `studio/src/main.js`
- Modify: `studio/tests/workflow_v2_workbench.test.mjs`
- Modify: `studio/tests/main_entry_workflow_contract.test.mjs`

**Interfaces:**
- Agent `Context Policy`: `fullHistory`, `currentTurn`, `currentGroup`, `explicitInputsOnly`.
- Workflow Ref `Message Context Mode`: `inherit`, `isolated`.

- [x] Add failing tests for policy view models and rendered controls.
- [x] Bind both controls to existing Workbench config update methods.
- [x] Keep legacy object-shaped Agent policies readable as Full History until explicitly changed.
- [x] Run frontend tests, lint, and build.

---
