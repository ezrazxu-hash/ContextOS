# Chat Session Timeline Group Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ContextOS Chat persist and reload conversations as `Session -> Timeline -> Ordered Groups -> Messages`, and build LLM context from that persisted structure.

**Architecture:** Keep API handlers thin. Add a conversation layer with a group repository, context builder, and chat orchestrator. Use repository-backed storage so the HTTP host can persist state across process restarts without binding domain logic to a database/ORM.

**Tech Stack:** Python dataclasses/services/repositories, JSON file persistence for the local HTTP host, existing browser Studio fetch/SSE client.

**Spec:** User request in this conversation.

## Global Constraints

- Do not mock or hard-code AI replies for real verification.
- Do not expose API keys in code, logs, or test output.
- Keep `Session`, `Timeline`, `Group`, context building, LLM provider, and API responsibilities separated.
- V1 can use one active timeline per session, but the model must allow `Session 1:N Timeline`.
- `Group` is the minimum future unit for compression, exclusion, deletion, restore, and fork safety.

---

### Task 1: Diagnose Current Runtime Model

**Files:**
- Read: `backend/src/contextos/runtime/session/model.py`
- Read: `backend/src/contextos/runtime/timeline/model.py`
- Read: `backend/src/contextos/runtime/session/message_service.py`
- Read: `backend/src/contextos/api/server.py`
- Read: `studio/src/main.js`

**Interfaces:**
- Produces: root-cause notes used by later tasks.

- [x] **Step 1: Confirm Session semantics**

`Session` is a long-lived runtime conversation shell with `current_timeline_id`.

- [x] **Step 2: Confirm Timeline semantics**

`Timeline` belongs to one session and already supports parent/fork metadata, so the intended relation is `Session 1:N Timeline`.

- [x] **Step 3: Confirm current breakage**

Messages are in `MessageService` memory only, not grouped, not reliably timeline-scoped, and LLM calls use only the latest user message.

### Task 2: Add Regression Tests

**Files:**
- Modify: `backend/tests/integration/test_http_runtime_host.py`
- Create: `backend/tests/unit/test_conversation_context_builder.py`
- Create: `backend/tests/unit/test_conversation_groups.py`

**Interfaces:**
- Produces: failing tests for persistence, grouping, reload, retry, and context ordering.

- [ ] **Step 1: Add group ordering test**

Assert a user/assistant pair is assigned to one active group and listed in stable group order.

- [ ] **Step 2: Add context builder test**

Assert active groups produce ordered LLM messages and excluded/deleted groups are not included.

- [ ] **Step 3: Add HTTP restart test**

Create a temp storage file, post two rounds, recreate the HTTP host from the same file, and assert the third LLM call receives prior messages.

### Task 3: Implement Conversation Domain

**Files:**
- Create: `backend/src/contextos/runtime/conversation/model.py`
- Create: `backend/src/contextos/runtime/conversation/repository.py`
- Create: `backend/src/contextos/runtime/conversation/service.py`
- Create: `backend/src/contextos/runtime/conversation/context_builder.py`
- Create: `backend/src/contextos/runtime/conversation/orchestrator.py`
- Modify: `backend/src/contextos/runtime/session/message.py`
- Modify: `backend/src/contextos/runtime/session/message_service.py`

**Interfaces:**
- Produces: `ConversationGroupService`, `ConversationContextBuilder`, `ChatOrchestrator`.

- [ ] **Step 1: Add `timeline_id` and `group_id` to `SessionMessage`**

Keep fields optional for backward compatibility with existing tests and demo fixtures.

- [ ] **Step 2: Add `ConversationGroup`**

Fields: `id`, `session_id`, `timeline_id`, `cursor`, `state`, `message_ids`, timestamps.

- [ ] **Step 3: Add repository/service**

Support active group creation, assistant finalization, list by timeline, and no partial assistant persistence on stream error.

- [ ] **Step 4: Add context builder**

Convert active ordered groups to provider messages.

### Task 4: Add Local Persistence

**Files:**
- Create: `backend/src/contextos/runtime/persistence/json_store.py`
- Modify: session/timeline/message/checkpoint repositories to optionally use the JSON store.
- Modify: `backend/src/contextos/api/server.py`

**Interfaces:**
- Produces: `create_runtime_services(storage_path=...)`.

- [ ] **Step 1: Persist sessions, timelines, groups, messages, checkpoints**

Use local JSON file storage with atomic replacement.

- [ ] **Step 2: Load persisted state on host startup**

Do not reseed `demo-session` if it already exists in storage.

### Task 5: Wire API And Frontend

**Files:**
- Modify: `backend/src/contextos/api/server.py`
- Modify: `backend/src/contextos/api/routes/sessions.py`
- Modify: `backend/src/contextos/api/routes/chat.py`
- Modify: `studio/src/main.js`

**Interfaces:**
- Consumes: `ChatOrchestrator.stream_reply(session_id, timeline_id)`.

- [ ] **Step 1: API POST keeps message/group timeline metadata**

Frontend sends `timeline_id`; backend stores user message into a new group.

- [ ] **Step 2: SSE uses `ChatOrchestrator`**

Orchestrator builds context from persisted groups and streams provider output.

- [ ] **Step 3: GET messages filters by active timeline**

Reloaded page shows the same persisted history the LLM will receive.

### Task 6: Verify Real Flow

**Files:**
- Modify: `studio/e2e/real-deepseek-chat.spec.mjs`

**Interfaces:**
- Produces: repeatable evidence for the acceptance flow.

- [ ] **Step 1: Run backend tests**

Run unit and integration tests for groups/context/persistence.

- [ ] **Step 2: Run frontend tests**

Run Studio node tests and lint.

- [ ] **Step 3: Run real DeepSeek flow**

Use `Session A`: say name, ask name, reload, summarize prior conversation.
