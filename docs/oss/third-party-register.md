# ContextOS Studio Third-Party Register

Scope: UI00-T00 evaluates UI primitives only. These packages must not become the source of truth for Session, Timeline, Checkpoint, Context, Revision, Replay, Compiler, or Provider state.

| Package | Status | Locked Version | License | Purpose | ContextOS Wrapper | Alternative | Package / Runtime Risk |
|---|---|---:|---|---|---|---|---|
| shadcn/ui | Adopt | 4.19.0 | MIT | Base visual recipes for buttons, dialogs, drawers, tabs, forms, and tokens | `design-system/components/*`; copy-owned primitives only, no domain state | In-house CSS primitives | CLI/registry workflow can add many peer primitives; every copied component needs local review |
| @assistant-ui/react | Optional | 0.15.16 | MIT | Chat message/composer primitives after adapter spike | `features/conversation/assistantUiAdapter`; ContextOS owns messages, sessions, timelines, replay | Existing message cards and composer primitives | Includes chat runtime concepts and optional cloud features; do not allow thread persistence ownership |
| @xyflow/react | Adopt | 12.11.3 | MIT | Workflow canvas, custom nodes, edges, selection, minimap | `features/workflow-builder/xyflowAdapter`; Manifest remains ContextOS-owned | Lightweight custom canvas for P0 | Brings canvas state and internal store; persist only Manifest DTO, not library graph internals |
| react-resizable-panels | Adopt | 4.12.3 | MIT | Resizable Chat/Debug/Workflow workbench columns | `design-system/layout/resizableWorkbench`; persist sizes through PlatformAdapter UI storage | CSS grid with fixed panels | UI-only persistence must not call Runtime API |
| @tanstack/react-query | Adopt | 5.102.2 | MIT | Server projection cache, request cancellation, mutation coordination | `client/queries` and `client/mutations`; query keys encode API DTOs | Small fetch repository with manual cache | Cache cannot become backend fact source; invalidate/refetch after failed mutations |
| msw | Adopt | 2.15.0 | MIT | Mock Runtime API for demo and frontend E2E | `test/msw` handlers generated from API client contracts | Hand-written fake API client fixtures | Mock drift risk; handlers must share DTO fixtures with client tests |
| monaco-editor | Optional | 0.56.0 | MIT | Manifest, prompt, raw JSON, and debug payload editor | Lazy `design-system/components/codeEditor`; plain inputs remain default | Textarea plus JSON formatting | Large bundle and worker setup; lazy-load with fallback |

## Spike Conclusions

- Chat primitive: `@assistant-ui/react` is optional. The spike proves a wrapper can render ContextOS messages, tool placeholders, and custom action slots without owning Session, Timeline, or Replay state.
- Workflow canvas: `@xyflow/react` is adopted for UI canvas primitives. The spike proves custom Agent, Tool, and Condition node types plus edges, MiniMap, and SubGraph visual capabilities can map to ContextOS Manifest DTOs.
- Resizable layout: `react-resizable-panels` is adopted for workbench columns. The spike proves panel widths are UI-only state persisted through PlatformAdapter storage and never written to Runtime APIs.

## Governance

- Third-party packages may provide UI primitives, caches, or local interaction state only.
- Backend Runtime APIs and ContextOS domain contracts remain owned by `backend/src/contextos`.
- New production dependencies require a package lock update, license review, and wrapper module before use.
