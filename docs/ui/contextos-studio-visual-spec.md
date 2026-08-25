# ContextOS Studio Visual Spec

Scope: UI00-T01 turns the four reference images into implementation-facing rules. This document does not add backend behavior. Runtime facts still come from the backend API, and UI state is limited to selection, layout, draft input, and local interaction state.

## Reference Image Map

| Image | Page Mapping | Primary Use |
|---|---|---|
| `01-contextos-product-architecture.png` | App Shell, Chat, Workflow, Template, Debug | Product layers, Studio vs Runtime ownership, three edit behaviors |
| `02-contextos-chat-workbench.png` | Chat | Top app bar, left navigation, conversation, composer, context and impact panel |
| `03-contextos-workflow-builder.png` | Workflow, Template | Node library, canvas, node config, save/preview/publish controls |
| `04-contextos-debug-view.png` | Debug | Timeline tree, conversation/trace split, inspector stack, replay confirmation |

## App Shell

App Shell provides the persistent frame: product identity, current template/session, developer mode, global navigation, error feedback, and URL-addressable selections. The shell must not store Session, Timeline, Checkpoint, Context, Revision, or Replay as local facts.

| P0 ID | Region | Classification | Size / Relationship | Main Actions | Dangerous Actions | States | Trace |
|---|---|---|---|---|---|---|---|
| P0-SHELL-01 | Top product bar | P0 function | Full-width 48-64px bar above all pages | Switch template/session, toggle developer mode | None | Loading, Error | M00-T03, M04-T06, UI01-T01 |
| P0-SHELL-02 | Left global navigation | P0 function | 220-320px column on wide screens, collapsible on narrow screens | Navigate Chat, Workflow, Template, Debug, recent resources | None | Empty, Refresh / Rehydrate | M00-T03, UI01-T02 |
| P0-SHELL-03 | URL selection contract | P0 function | Encoded in route/search params, not visible-only state | Select session, timeline, message, trace, template | None | Refresh / Rehydrate, Error | M01-T06, UI01-T03 |

## Chat

Chat follows the three-column workbench in `02-contextos-chat-workbench.png`: left sessions/templates/timelines, center conversation and composer, right context/timeline/impact. The center conversation owns only view state; persisted messages and context projections come from backend API responses.

| P0 ID | Region | Classification | Size / Relationship | Main Actions | Dangerous Actions | States | Trace |
|---|---|---|---|---|---|---|---|
| P0-CHAT-01 | Session and template rail | P0 function | Left column, scrollable lists with search/filter | Create/select session, switch template | Unsaved switch requires confirm | Loading, Empty, Error, Refresh / Rehydrate | M04-T01, UI03-T05 |
| P0-CHAT-02 | Conversation stream | P0 function | Center column, virtualized vertical history | Read messages, select message, view raw, jump trace | None | Loading, Empty, Error, Refresh / Rehydrate | M04-T03, UI03-T01, UI03-T02 |
| P0-CHAT-03 | Message card hierarchy | P0 function | Message body with metadata/action layer | Inspect role/status/token/group/tool relation | None | Loading, Error | M04-T03, M04-T04, UI03-T03 |
| P0-CHAT-04 | Inline AI message edit | P0 function | Inline editor attached to selected assistant message | Edit, compare original, cancel | Save revision affects future context | Error, Refresh / Rehydrate | M05-T05, UI04-T04 |
| P0-CHAT-05 | Three edit actions | P0 function | Action bar directly below edited message | Context-only, continue from here, replay follow-up | Replay requires risk confirmation | Loading, Error | M05-T03, M05-T04, M06-T05, UI04-T05 |
| P0-CHAT-06 | Composer | P0 function | Bottom center input with command affordances | Send message, attach, choose model | None | Empty, Loading, Error | M04-T02, UI03-T04 |
| P0-CHAT-07 | Context and impact side panel | P0 function | Right column with active/abstract/evicted/timeline/impact sections | Pin, evict, abstract, restore, inspect impact | High-risk replay not default | Loading, Empty, Error, Refresh / Rehydrate | M04-T05, M06-T06, M07-T07, UI04-T01 |

Pure visual elements: avatar styling, subtle timestamps, divider rhythm, and icon treatment are visual polish. They must not introduce new domain state.

## Workflow

Workflow maps `03-contextos-workflow-builder.png` to a page-level editor. Canvas state is local while editing, but saved output is always a ContextOS Manifest validated by backend template APIs.

| P0 ID | Region | Classification | Size / Relationship | Main Actions | Dangerous Actions | States | Trace |
|---|---|---|---|---|---|---|---|
| P0-WORKFLOW-01 | Node library | P0 function | Left searchable rail | Search, filter, drag node types | None | Empty, Error | M08-T06, UI05-T02 |
| P0-WORKFLOW-02 | Canvas and toolbar | P0 function | Center full-height graph area | Select, pan, zoom, connect, fit view | Delete node/edge asks when dirty | Loading, Empty, Error | M08-T06, UI05-T01, UI05-T03 |
| P0-WORKFLOW-03 | Node config panel | P0 function | Right column form bound to selected node | Edit prompt/model/tool/context/retry/checkpoint | Invalid config blocks save | Loading, Error | M08-T07, UI05-T05 |
| P0-WORKFLOW-04 | Save validate preview publish bar | P0 function | Top-right command group | Save, validate, preview, publish | Publish requires valid manifest | Loading, Error | M08-T05, UI05-T07 |

Visual-only elements: dotted canvas background, icon style, and capability cards are decorative unless later tasks bind them to real validation or help content.

## Template

Template shares Workflow primitives but focuses on structured Manifest, model, prompt, tools, context policy, workflow, and UI config. It must call template APIs rather than storing templates in browser-only state.

| P0 ID | Region | Classification | Size / Relationship | Main Actions | Dangerous Actions | States | Trace |
|---|---|---|---|---|---|---|---|
| P0-TEMPLATE-01 | Template list and details | P0 function | List/detail workbench | Open, edit metadata, save | Unsaved switch requires confirm | Loading, Empty, Error, Refresh / Rehydrate | M08-T05, M08-T07, UI06-T01 |
| P0-TEMPLATE-02 | Structured configuration sections | P0 function | Tabs or stacked sections for model/prompt/tools/policies/workflow/UI config | Validate fields, edit config | Invalid schema blocks run | Loading, Error | M08-T01, M08-T02, UI06-T02, UI06-T03 |
| P0-TEMPLATE-03 | Test run and validation result | P0 function | Inline result panel close to editor | Validate, compile, run test | No provider call during validate | Loading, Empty, Error | M08-T05, UI06-T04 |

## Debug

Debug maps `04-contextos-debug-view.png` to a resizable three-column diagnostic workbench. It is a projection over backend facts and must not persist a second business state.

| P0 ID | Region | Classification | Size / Relationship | Main Actions | Dangerous Actions | States | Trace |
|---|---|---|---|---|---|---|---|
| P0-DEBUG-01 | Timeline and checkpoint tree | P0 function | Left resizable column with tree and minimap | Select checkpoint, message, branch view | None | Loading, Empty, Error, Refresh / Rehydrate | M09-T02, UI07-T02 |
| P0-DEBUG-02 | Conversation and trace selection | P0 function | Center split between conversation and execution trace | Link message to trace, filter rows | None | Loading, Empty, Error | M09-T02, M09-T03, UI07-T03 |
| P0-DEBUG-03 | Trace table | P0 function | Center/bottom table with grouping/filtering | Filter model/tool/state/context events | None | Loading, Empty, Error | M09-T03, UI07-T04 |
| P0-DEBUG-04 | Inspector stack | P0 function | Right column cards for state/tool/context/prompt | Inspect raw JSON, copy IDs, expand panels | None | Loading, Empty, Error | M09-T03, UI07-T05 |
| P0-DEBUG-05 | Replay confirmation modal | P0 function | Modal over trace when replay is requested | Use history, reinvoke, skip, cancel | Reinvoke side-effect tool requires explicit confirm | Error | M06-T04, M06-T05, UI07-T06 |

## State Checklist

| State | Required Behavior | Applies To |
|---|---|---|
| Loading | Show stable skeleton or disabled command state without layout jump | App Shell, Chat, Workflow, Template, Debug |
| Empty | Explain that no server projection exists yet and offer the primary creation action | Session list, conversation, context panel, node library, trace table |
| Error | Show backend error code/message/request id when available; failed mutation must not pretend success | API-backed panels and commands |
| Refresh / Rehydrate | Rebuild Session, Timeline, Checkpoint, Context, Trace, and Template projections from backend API | URL-addressable pages and selections |

## V1 Exclusions

| Item | Classification | Handling |
|---|---|---|
| Desktop Client | Deferred | Keep client boundaries ready through PlatformAdapter; do not implement a desktop host in V1 |
| Marketplace | Excluded | Do not implement template marketplace, ratings, billing, or external distribution |
| Branch Merge | Excluded | Do not implement merge, compare, cherry-pick, or branch conflict resolution |
| Multi-user collaboration | Excluded | Do not implement realtime collaborative editing or presence |

## Acceptance Checklist

- Every P0 row traces to an existing original-plan task, a supplement task, or a current `studio/src` component.
- UI-only state includes selected IDs, panel widths, collapsed panels, draft text, sort/filter, and viewport.
- Backend-owned facts include Session, Timeline, Checkpoint, Message, Context, Revision, Replay, Template validation, and Debug projections.
- Dangerous actions are visually separated from ordinary navigation and must require confirmation before side-effect replay.
