# ContextOS V1 Acceptance Matrix

This matrix maps the eight PRD success criteria to automated evidence. V1 out-of-scope capabilities are not RC blockers.

| ID | Success Criterion | Automated Evidence | UI/API Evidence |
|---|---|---|---|
| SC-1 | User can see what the Agent currently remembers | `studio/tests/context_panel.test.mjs`, `backend/tests/e2e/test_mvp_01_normal_chat.py` | Context panel projection and chat checkpoint/trace DTOs |
| SC-2 | User can Pin / Abstract / Evict / Restore | `backend/tests/unit/test_context_api.py`, `backend/tests/e2e/test_mvp_03_restore.py` | Context group operation APIs |
| SC-3 | Evicted Context can be restored | `M10-T03-TC01`, `M10-T03-TC02`, `M10-T03-TC03`, `backend/tests/e2e/test_mvp_03_restore.py` | Agent context search/restore result with revisions |
| SC-4 | Edited historical AI reply affects subsequent Agent context | `M10-T04-TC01`, `M10-T04-TC02`, `studio/e2e/mvp_04_edit_message.test.mjs` | Message revision and context-only timeline fork |
| SC-5 | Historical edits do not silently break ToolCall / ToolResult structure | `M10-T02-TC01`, `M10-T04-TC03`, `backend/tests/e2e/test_mvp_02_evict_tool_group.py` | Tool interaction atomic group and impact warning |
| SC-6 | Agent can actively find previously evicted Context | `M10-T03-TC01`, `backend/tests/e2e/test_mvp_03_restore.py` | AgentContextAPI search and restore trace events |
| SC-7 | Developer can understand Graph / State / Checkpoint / Trace / Context | `M09-T01-TC01`, `M09-T02-TC02`, `backend/tests/e2e/test_security_invariants.py` | Debug index, state inspector, trace/context DTOs |
| SC-8 | Web refresh/reconnect can recover Session, Timeline, Checkpoint, Message Revision, Context state from backend | `backend/tests/unit/test_runtime_snapshot.py`, `studio/tests/studio_skeleton.test.mjs`, `M10-T08-TC01` | Runtime snapshot and Studio API boundary rehydrate |

## RC Gates

- Backend unit tests
- Backend E2E MVP tests
- Backend performance tests
- Studio unit tests
- Studio E2E tests
- Implementation audit tests

## Non-Blocking V1 Out-of-Scope Items

Semantic restore ranking, marketplace, multi-tenant SaaS, desktop client, branch compare, and physical purge remain outside V1 RC scope.
