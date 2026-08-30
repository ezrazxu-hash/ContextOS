# ContextOS Agent / Workflow / Session 绑定实施计划（可测试增强版）

> **目标**：在不破坏现有 Chat 主链路的前提下，实现一套真正可运行、可保存、可加载、可校验、可发布、可测试、可调试的可视化 Agent 编排系统，并支持新建 Session 选择已发布 Agent、已有 Session 安全切换 Agent。
>
> **核心闭环**：
>
> ```text
> Workflow Builder
>   → Node / Edge / Config
>   → Draft Manifest
>   → Validate
>   → Publish AgentVersion
>   → Python Runtime 动态组装 LangGraph
>   → graph.compile()
>   → Test Run
>   → Session 绑定 AgentVersion
>   → Chat Runtime 执行
> ```
>
> **关键约束**：
>
> 1. 每个 Task 都必须可独立开发、独立测试、独立验收、独立提交。
> 2. 不允许出现“需要再完成后面 3~5 个任务才能验证当前任务”的大任务。
> 3. Agent 动态组装链路必须拆开逐段验证，尤其是 Manifest → NodeExecutor → StateGraph → Edge → compile → invoke/stream。
> 4. 必须包含独立 **LLM Node**；`LLM Node` 与 `Agent Node` 语义分离。
> 5. 每种正式支持的 Node 必须同时拥有：Schema、Validator、Executor、Frontend Node、Config UI、Serialization、Deserialization、Unit Test、Integration Test。
> 6. Workflow Builder 必须是完整编辑器，不能只显示几个方框。
> 7. Session 只能绑定 **PUBLISHED、immutable AgentVersion**，不能直接运行 Draft。
> 8. 前端只编辑 Manifest；Validate / Compile / Publish / Runtime Load 必须由后端完成。
> 9. 现有 `ChatOrchestrator` 不直接删除，先包装成 `LegacyChatRuntime`。
> 10. 任何任务只有在对应测试通过并有验证证据后，状态才能改为 `Completed`。

---

## 0. 任务状态约定

| 状态 | 含义 |
|---|---|
| Pending | 尚未进入实现 |
| In Progress | 正在实现或部分完成 |
| In Progress | 实现完成但验证尚未完整，不提前标记完成 |
| Completed | 实现、关键测试、必要集成/回归验证均已满足 |
| Blocked | 因依赖、环境、技术问题或待决策无法继续 |

> **状态更新规则**：禁止仅因为“代码已经写完”把 Task 标记为 ✅；必须运行该 Task 定义的验证命令/测试并确认通过。

---

## 1. 当前项目基线

根据当前代码分析：

- Chat 主链路：`ChatOrchestrator`。
- Workflow / Template：已有 LangGraph `StateGraph` + Manifest 编译基础。
- 当前 Workflow Node 主要是通用状态流转，不是完整 LLM / Tool Agent。
- 当前不存在完整的 `LLM → ToolCall → Tool Executor → ToolResult → LLM` 真实闭环。
- 当前 `ToolRegistry` 主要承担 Metadata 注册，默认 Runtime 中没有完整可执行 Tool 注册。
- Session 已存在 `agent_template_id`。
- 当前 Checkpoint 为 ContextOS 自研持久化快照，并非 LangGraph 原生 thread/checkpointer。

本计划采用：

```text
AgentRuntime
├── LegacyChatRuntime
└── WorkflowAgentRuntime
```

并通过：

```text
AgentRuntimeResolver
```

按 Session 的 `agent_version_id` 选择执行方式。

---

## 2. V1 正式支持的 Node

V1 必须真正完成以下 Node：

| Node | 语义 | V1 必须可执行 |
|---|---|---|
| START | Graph 入口 | ✅ |
| END | Graph 结束 | ✅ |
| LLM | 单次模型调用，不承担 Tool Loop | ✅ |
| Agent | Agent 语义节点；V1 可先完成单轮 Agent，后续增强 Tool Loop | ✅ |
| Tool | 显式执行注册 Tool | ✅ |
| Condition | 二分条件 | ✅ |
| Router | 多分支路由 | ✅ |
| Output | 把 State 中指定值作为最终输出 | ✅ |

V1 不允许仅在 UI 中展示但后端不可执行的“假 Node”。

---

## 3. LLM Node 与 Agent Node 的区别

### 3.1 LLM Node

```text
Input Mapping
  ↓
System Prompt / Prompt
  ↓
Model + Parameters
  ↓
Single LLM Call
  ↓
Output Mapping
```

建议配置：

```json
{
  "model": "default",
  "system_prompt": "你是一个研究助手",
  "prompt_template": "{{input}}",
  "temperature": 0.2,
  "input_mapping": {"input": "$state.input"},
  "output_key": "planner_result"
}
```

### 3.2 Agent Node

Agent Node 是更高层语义：

```text
Context
  ↓
LLM
  ↓
可绑定 Tools
  ↓
Agent Policy
  ↓
Agent Result
```

V1 第一阶段允许 Agent Node 先以“单轮模型调用 + Agent Context Policy”实现；自动 Tool Calling Loop 单独作为后续 Task，不能阻塞 LLM Node 和 Workflow 主闭环。

---

## 4. 前后端核心 Contract

### 4.1 WorkflowManifest

```json
{
  "schema_version": "1.0",
  "runtime": {
    "nodes": [],
    "edges": []
  },
  "ui": {
    "nodes": {},
    "viewport": {}
  }
}
```

**必须分离 Runtime 与 UI 信息**。

Runtime 中不能包含：

```text
x
y
width
height
selected
collapsed
viewport
```

### 4.2 NodeDefinition

```json
{
  "id": "planner",
  "type": "llm",
  "name": "Planner LLM",
  "config": {}
}
```

### 4.3 EdgeDefinition

```json
{
  "id": "edge_planner_search",
  "source": "planner",
  "target": "search",
  "source_handle": null,
  "target_handle": null,
  "route": null
}
```

### 4.4 ValidationResult

```json
{
  "valid": false,
  "errors": [
    {
      "code": "TOOL_NOT_FOUND",
      "node_id": "search",
      "edge_id": null,
      "field": "config.tool_name",
      "message": "Tool 'web_search' is not registered"
    }
  ],
  "warnings": []
}
```

### 4.5 RuntimeEvent

统一：

```text
graph_started
node_started
token
tool_call
tool_result
condition_route
router_route
node_finished
checkpoint
graph_finished
graph_failed
```

---

## 5. API 设计基线

```text
GET    /api/agents
POST   /api/agents
GET    /api/agents/{agentId}

GET    /api/agents/{agentId}/draft
PUT    /api/agents/{agentId}/draft

POST   /api/agents/{agentId}/validate
POST   /api/agents/{agentId}/publish

GET    /api/agents/{agentId}/versions
GET    /api/agent-versions/{versionId}

POST   /api/agent-versions/{versionId}/test-runs
GET    /api/agent-test-runs/{runId}
GET    /sse/agent-test-runs/{runId}

GET    /api/workflow/node-catalog
GET    /api/tools

POST   /api/sessions
PATCH  /api/sessions/{sessionId}/agent
```

---


## 6. 总体任务状态看板

| Phase | Task | 名称 | 状态 |
|---|---|---|---|
| Phase 0 | T00 | 固定现有 Chat Runtime 回归基线 | Completed |
| Phase 0 | T01 | 冻结 RuntimeEvent Contract | Completed |
| Phase 0 | T02 | 冻结 WorkflowManifest JSON Contract | Completed |
| Phase 0 | T03 | Node Catalog Contract | Completed |
| Phase 1 | T10 | AgentRuntime Protocol | Completed |
| Phase 1 | T11 | LegacyChatRuntime Adapter | Completed |
| Phase 1 | T12 | AgentRuntimeResolver | Completed |
| Phase 1 | T13 | Chat SSE 接入 Resolver | Completed |
| Phase 2 | T20 | Agent Draft Repository | Completed |
| Phase 2 | T21 | Manifest Validator 基础结构 | Completed |
| Phase 2 | T22 | AgentVersion Repository | Completed |
| Phase 2 | T23 | Validate API | Completed |
| Phase 2 | T24 | Publish Service | Completed |
| Phase 3 | T30 | AgentGraphState | Completed |
| Phase 3 | T31 | NodeExecutor Protocol | Completed |
| Phase 3 | T32 | NodeExecutorRegistry | Completed |
| Phase 3 | T33 | START/END 动态组装测试 | Completed |
| Phase 3 | T34 | 普通 Edge 动态 add_edge | Completed |
| Phase 3 | T35 | Conditional Edge 动态组装 | Completed |
| Phase 3 | T36 | Router 多分支动态组装 | Completed |
| Phase 3 | T37 | Graph Compile Service | Completed |
| Phase 3 | T38 | Compile Dry Run | Completed |
| Phase 3 | T39 | 动态发布无需重启测试 | Completed |
| Phase 4 | T40 | LLM Node Schema + Validator | Completed |
| Phase 4 | T41 | LLMNodeExecutor + Fake Provider | Completed |
| Phase 4 | T42 | Output Node 完整实现 | Completed |
| Phase 4 | T43 | Vertical Slice 1：START→LLM→OUTPUT→END | Completed |
| Phase 4 | T44 | Tool Node Schema + 可执行 Tool Registry | Completed |
| Phase 4 | T45 | ToolNodeExecutor | Completed |
| Phase 4 | T46 | Vertical Slice 2：LLM→Tool→Output | Completed |
| Phase 4 | T47 | Condition Node Schema + Executor | Completed |
| Phase 4 | T48 | Router Node Schema + Executor | Completed |
| Phase 4 | T49 | Vertical Slice 3：Condition 双分支 | Completed |
| Phase 4 | T4A | Agent Node Schema + 单轮 Agent Executor | Completed |
| Phase 5 | T50 | WorkflowAgentRuntime 最小实现 | Completed |
| Phase 5 | T51 | CompiledGraph Cache | Completed |
| Phase 5 | T52 | Agent Test Run Service | Completed |
| Phase 5 | T53 | Test Run API + SSE | Completed |
| Phase 5 | T54 | 完整 Runtime Trace | Completed |
| Phase 6 | T60 | Session agent_version_id Migration | Completed |
| Phase 6 | T61 | 新建 Session 选择 Agent API | Completed |
| Phase 6 | T62 | Resolver 接入 WorkflowAgentRuntime | Completed |
| Phase 6 | T63 | Vertical Slice 4：新 Session → 选择 Agent → Chat | Completed |
| Phase 6 | T64 | Session Switch Agent API | Completed |
| Phase 6 | T65 | 运行中切换保护 | Completed |
| Phase 6 | T66 | Checkpoint/Trace 绑定 AgentVersion | Completed |
| Phase 6 | T67 | Replay 使用历史 AgentVersion | Completed |
| Phase 7 | T70 | Workflow API Client | Completed |
| Phase 7 | T71 | Frontend Manifest Model + Round Trip | Completed |
| Phase 7 | T72 | Node Type Frontend Registry | Completed |
| Phase 8 | T80 | Canvas 基础与开源库适配 | Completed |
| Phase 8 | T81 | Node Library 拖拽创建 | Completed |
| Phase 8 | T82 | Node 移动/选择/删除/复制 | Completed |
| Phase 8 | T83 | Edge 创建/删除/重连 | Completed |
| Phase 8 | T84 | LLM Node UI + Config Panel | Completed |
| Phase 8 | T85 | Agent Node UI + Config Panel | Completed |
| Phase 8 | T86 | Tool Node UI + Config Panel | Completed |
| Phase 8 | T87 | Condition Node UI + Config Panel | Completed |
| Phase 8 | T88 | Router Node UI + Config Panel | Completed |
| Phase 8 | T89 | Output / START / END UI | Completed |
| Phase 8 | T8A | Save Draft 完整闭环 | Completed |
| Phase 8 | T8B | Load Draft + 完整 Round Trip | Completed |
| Phase 8 | T8C | Dirty State / Unsaved Protection | Completed |
| Phase 8 | T8D | Validate UI + Node/Edge 错误高亮 | Completed |
| Phase 8 | T8E | Publish UI + Version 展示 | Completed |
| Phase 9 | T90 | Test Run 输入与启动 UI | Completed |
| Phase 9 | T91 | 运行节点高亮 | Completed |
| Phase 9 | T92 | Node Debug Inspector | Completed |
| Phase 9 | T93 | Vertical Slice 5：完整 Builder→Publish→TestRun | Completed |
| Phase 10 | TA0 | Published Agent Selector 数据源 | Completed |
| Phase 10 | TA1 | 新建 Session Agent Selector UI | Completed |
| Phase 10 | TA2 | Chat 当前 Agent 展示 | Completed |
| Phase 10 | TA3 | 已有 Session Agent Switcher | Completed |
| Phase 10 | TA4 | Vertical Slice 6：Session Switch E2E | Completed |
| Phase 11 | TB0 | Legacy 全量回归 | Completed |
| Phase 11 | TB1 | Workflow Builder 前端 E2E 全量 | In Progress |
| Phase 11 | TB2 | Graph 规模与性能测试 | Completed |
| Phase 11 | TB3 | Feature Flag 与灰度发布 | Completed |

---

### 当前状态维护证据（2026-08-30）

本次状态维护逐项核对了当前实现文件和测试命名，并重新执行以下验证命令：

- `python -m unittest discover backend/tests`：376 tests passed
- `npm --prefix studio run lint`：passed
- `npm --prefix studio test`：254 tests passed
- `npm --prefix studio run test:e2e`：3 passed
- `npm --prefix studio run test:web-acceptance`：8 passed, 1 skipped（real Runtime integration smoke）
- `npm --prefix studio run test:visual`：5 passed
- `playwright.cmd test e2e/cross-browser-smoke.spec.mjs --config=playwright.cross-browser.config.mjs --project=chromium`：3 passed

状态口径：有实现并通过对应单元/集成/页面级验证的任务标为 `Completed`；尚缺完整浏览器 E2E 矩阵验证的任务保守标为 `In Progress`。

---

## 7. 详细任务


# Phase 0：回归基线与接口冻结

## T00：固定现有 Chat Runtime 回归基线

**状态：Completed**

**目标**：在任何 Agent Runtime 改造之前，用自动化测试固定当前 Chat/SSE/Message/Checkpoint/Trace 行为。

**前置依赖**：无

**建议涉及文件/模块**：`backend/tests/integration/chat/`；现有 Chat route / orchestrator 测试

### 实现范围

补齐当前 `POST message → SSE chat → token/checkpoint/done → Assistant 保存 → Trace 保存` 的集成测试；测试只描述当前行为，不改业务代码。

### 测试用例

- [x] 普通文本 Chat 能完成
- [x] 指定 timelineId 能完成
- [x] Assistant Message 被持久化
- [x] checkpoint 被保存
- [x] trace 被保存
- [x] provider fallback 路径保持现状

### 验收标准

不修改业务代码即可得到稳定通过的 Legacy Chat 回归套件。

### 回归范围

现有 Session / Timeline / Message / Context / Checkpoint / Trace。

### Codex Prompt

```text
阅读当前 ChatOrchestrator、chat SSE route、ConversationContextBuilder、MessageService 和 TraceCollector。不要修改业务逻辑，先建立 Legacy Chat 集成测试基线，覆盖 token/checkpoint/done、Assistant 持久化与 Trace。
```

---

## T01：冻结 RuntimeEvent Contract

**状态：Completed**

**目标**：建立 Legacy Runtime 和 Workflow Runtime 共用的事件模型，避免新 Runtime 迫使前端改两套事件协议。

**前置依赖**：T00

**建议涉及文件/模块**：`runtime/agent/events.py`、事件序列化测试

### 实现范围

定义 RuntimeEvent 类型和 payload 约束；把现有 SSE 事件映射成统一协议，但此任务不切换实际执行入口。

### 测试用例

- [x] 所有现有事件可无损映射
- [x] 未知 event type 明确失败
- [x] 事件 JSON round-trip

### 验收标准

事件 Contract 有单测，且能表达 token/tool/checkpoint/done/error。

### 回归范围

现有 SSE payload 不允许破坏性变更。

### Codex Prompt

```text
抽取统一 RuntimeEvent Contract，覆盖 graph/node/token/tool/checkpoint/done/error。只增加模型和映射测试，不切换 Chat 执行路径。
```

---

## T02：冻结 WorkflowManifest JSON Contract

**状态：Completed**

**目标**：确定前端与后端共同遵守的 Manifest 结构，并强制 runtime/ui 分离。

**前置依赖**：无

**建议涉及文件/模块**：`template/manifest/`、Pydantic model、contract tests

### 实现范围

定义 WorkflowManifest、NodeDefinition、EdgeDefinition、UI metadata；增加 schema_version；禁止 Runtime 依赖坐标。

### 测试用例

- [x] JSON → model → JSON round-trip
- [x] runtime/ui 信息不互相污染
- [x] 未知 schema_version 拒绝
- [x] 重复 node id 拒绝

### 验收标准

同一 Manifest 经过 round-trip 后 Runtime 语义完全一致。

### 回归范围

现有 Template manifest 需要兼容读取或提供明确 migration。

### Codex Prompt

```text
定义 V1 WorkflowManifest Pydantic 模型和 contract tests。runtime 与 ui 必须分离，加入 schema_version，并为旧 manifest 提供兼容读取策略。
```

---

## T03：Node Catalog Contract

**状态：Completed**

**目标**：让前端能够知道后端真正支持哪些 Node，避免 UI 出现后端无法执行的假节点。

**前置依赖**：T02

**建议涉及文件/模块**：`template/node_catalog.py`、`GET /api/workflow/node-catalog`

### 实现范围

返回 START/END/LLM/Agent/Tool/Condition/Router/Output 的类型、显示名、端口、必填字段、可连接规则。

### 测试用例

- [x] catalog 返回全部 V1 node
- [x] 每个 node type 唯一
- [x] 前端不可见但 runtime 不支持的 node 不进入 catalog

### 验收标准

Node Library 可以完全由 catalog 驱动或至少用 catalog 校验。

### 回归范围

不影响现有 Workflow API。

### Codex Prompt

```text
实现 Node Catalog 和 API；V1 只暴露真正计划完成的 START/END/LLM/Agent/Tool/Condition/Router/Output。
```

---


# Phase 1：Runtime 隔离层

## T10：AgentRuntime Protocol

**状态：Completed**

**目标**：建立可替换 Runtime 接口，不改现有 Chat 行为。

**前置依赖**：T01

**建议涉及文件/模块**：`runtime/agent/protocol.py`、`run_context.py`

### 实现范围

定义 `AgentRuntime.stream_runtime_events(run_context)` 与 AgentRunContext。

### 测试用例

- [x] FakeRuntime 符合 protocol
- [x] run_context 必填字段校验

### 验收标准

Protocol 可被 Legacy/Workflow 两种实现使用。

### 回归范围

无业务路径变更。

### Codex Prompt

```text
新增 AgentRuntime Protocol 和 AgentRunContext；不要修改 ChatOrchestrator。
```

---

## T11：LegacyChatRuntime Adapter

**状态：Completed**

**目标**：把现有 ChatOrchestrator 包装成统一 Runtime。

**前置依赖**：T10

**建议涉及文件/模块**：`runtime/agent/legacy_runtime.py`

### 实现范围

只做委托和事件适配，不复制 Context/Provider/Checkpoint 业务。

### 测试用例

- [x] 与直接调用 ChatOrchestrator 的事件序列一致
- [x] 异常传播一致

### 验收标准

T00 全部回归测试仍通过。

### 回归范围

ChatOrchestrator 原逻辑不得改变。

### Codex Prompt

```text
实现 LegacyChatRuntime，仅委托 ChatOrchestrator，写 parity test 证明事件与原调用一致。
```

---

## T12：AgentRuntimeResolver

**状态：Completed**

**目标**：按 Session binding 和 Feature Flag 决定 Legacy / Workflow Runtime。

**前置依赖**：T11

**建议涉及文件/模块**：`runtime/agent/resolver.py`

### 实现范围

`agent_version_id is None → legacy`；flag off → legacy；published version + flag on → workflow。

### 测试用例

- [x] 历史 Session 返回 Legacy
- [x] flag off 强制 Legacy
- [x] 非法 AgentVersion 返回结构化错误

### 验收标准

Resolver 可独立单测，不需要真实 WorkflowRuntime。

### 回归范围

历史 Session 默认路径不变。

### Codex Prompt

```text
实现 AgentRuntimeResolver；WorkflowRuntime 可先用 fake/stub 注入，禁止直接写死全局对象。
```

---

## T13：Chat SSE 接入 Resolver

**状态：Completed**

**目标**：把 Chat 执行入口切到 AgentRuntimeResolver，但默认仍走 Legacy。

**前置依赖**：T12

**建议涉及文件/模块**：`api/routes/chat.py`

### 实现范围

route 只负责解析 session/timeline、resolve runtime、转发 RuntimeEvent；保留消息持久化和 trace 现状。

### 测试用例

- [x] T00 全量通过
- [x] resolver 被调用一次
- [x] legacy session 行为无差异

### 验收标准

现有 Chat 主体功能无变化。

### 回归范围

Chat / Timeline / Message / Trace / Checkpoint。

### Codex Prompt

```text
将 chat SSE route 改为通过 AgentRuntimeResolver 获取 runtime；默认历史 Session 仍走 Legacy，并运行完整回归。
```

---


# Phase 2：Agent Definition 与版本化

## T20：Agent Draft Repository

**状态：Completed**

**目标**：Workflow Save 保存 Draft，不影响任何正在运行的 Session。

**前置依赖**：T02

**建议涉及文件/模块**：`template/repository.py`、Draft API

### 实现范围

优先扩展现有 Template 模型，保存 `draft_manifest` 和更新时间。

### 测试用例

- [x] 保存后可读取
- [x] 重复保存覆盖 Draft
- [x] 保存 Draft 不修改 active version

### 验收标准

Draft CRUD 可独立验收。

### 回归范围

Template 现有读取行为。

### Codex Prompt

```text
基于现有 Template 模型实现 draft_manifest repository/service/API。Draft 不得影响已发布版本。
```

---

## T21：Manifest Validator 基础结构

**状态：Completed**

**目标**：建立结构化 ValidationResult 和可组合 Validator。

**前置依赖**：T02

**建议涉及文件/模块**：`template/validator/`

### 实现范围

检查 node id、edge target、START/END、孤立节点、Output 可达性等基础规则。

### 测试用例

- [x] 每条校验规则独立测试
- [x] 一次返回多个错误
- [x] 错误包含 node_id/edge_id/field/code

### 验收标准

非法 Manifest 不进入 compile。

### 回归范围

无。

### Codex Prompt

```text
实现结构化 Manifest Validator。错误必须可定位到 node/edge/field，禁止只返回一段字符串。
```

---

## T22：AgentVersion Repository

**状态：Completed**

**目标**：发布后的 Agent 使用 immutable version。

**前置依赖**：T20

**建议涉及文件/模块**：`template/version/`、migration

### 实现范围

AgentVersion 存储 agent_template_id/version/manifest/checksum/status/published_at。

### 测试用例

- [x] 版本单调增加
- [x] published version 不可 update
- [x] draft 修改不影响旧 version
- [x] checksum 稳定

### 验收标准

Session 可安全绑定指定版本。

### 回归范围

现有 Template 兼容。

### Codex Prompt

```text
新增 immutable AgentVersion 模型、repository/service 和测试。已发布版本禁止修改。
```

---

## T23：Validate API

**状态：Completed**

**目标**：前端可显式校验 Draft，并获得节点级错误。

**前置依赖**：T21

**建议涉及文件/模块**：`POST /api/agents/{id}/validate`

### 实现范围

读取请求 Manifest 或当前 Draft，返回 ValidationResult，不产生版本。

### 测试用例

- [x] 合法 graph valid=true
- [x] 非法 node/edge 定位正确
- [x] 验证不修改数据库

### 验收标准

前端可以直接拿结果高亮错误。

### 回归范围

Draft 保存逻辑。

### Codex Prompt

```text
实现 Validate API 和 API contract tests，确保结果可以精确定位 node/edge/field。
```

---

## T24：Publish Service

**状态：Completed**

**目标**：Draft 只有在 Validate + Compile Dry Run 都通过后才能发布。

**前置依赖**：T22、T23、T38

**建议涉及文件/模块**：`template/publish_service.py`

### 实现范围

事务：加载 Draft → validate → compile dry-run → 创建 immutable AgentVersion → 更新 active_version_id。

### 测试用例

- [x] validate 失败不创建版本
- [x] compile 失败不创建版本
- [x] 成功发布生成新版本
- [x] 失败保留旧 active version

### 验收标准

Publish 原子、可回滚。

### 回归范围

旧 active version 不受失败发布影响。

### Codex Prompt

```text
实现 Publish Service，必须在事务内完成 validate + compile dry-run + create AgentVersion + activate。
```

---


# Phase 3：动态 Graph 组装核心

## T30：AgentGraphState

**状态：Completed**

**目标**：把当前裸 dict 收敛成可测试、可扩展的 TypedDict state。

**前置依赖**：T02

**建议涉及文件/模块**：`runtime/graph/state.py`

### 实现范围

定义 session_id/timeline_id/run_id/input/messages/variables/node_outputs/tool_results/output/visited_nodes。

### 测试用例

- [x] 最小 state 可运行
- [x] 额外字段兼容
- [x] 缺失必需输入在入口校验

### 验收标准

各 Node 共享统一 State Contract。

### 回归范围

旧 state 测试兼容。

### Codex Prompt

```text
定义 AgentGraphState TypedDict(total=False)，保持简单，不引入复杂 DSL。
```

---

## T31：NodeExecutor Protocol

**状态：Completed**

**目标**：把执行逻辑从 Compiler 分离。

**前置依赖**：T30

**建议涉及文件/模块**：`runtime/graph/nodes/protocol.py`

### 实现范围

统一 `build(node, runtime_context) -> async callable` 或等价接口。

### 测试用例

- [x] fake executor 可 build 并执行
- [x] 未知 node type 不由 compiler 猜测

### 验收标准

Compiler 不再承载具体业务逻辑。

### 回归范围

现有 compiler tests。

### Codex Prompt

```text
新增 NodeExecutor Protocol；Compiler 只负责图结构，不直接实现 LLM/Tool/Condition 业务。
```

---

## T32：NodeExecutorRegistry

**状态：Completed**

**目标**：按 node.type 映射到 Executor。

**前置依赖**：T31

**建议涉及文件/模块**：`runtime/graph/nodes/registry.py`

### 实现范围

register/get/has；重复注册、未知类型有明确错误。

### 测试用例

- [x] 注册/查询
- [x] 重复注册
- [x] 未知类型
- [x] 全部 V1 node 可枚举

### 验收标准

Manifest node.type 可以确定性映射到 Executor。

### 回归范围

无。

### Codex Prompt

```text
实现 NodeExecutorRegistry 和完整单测；禁止 compiler 使用 if/elif 堆叠业务实现。
```

---

## T33：START/END 动态组装测试

**状态：Completed**

**目标**：单独验证 Manifest 的 START/END 能正确映射 LangGraph 入口/出口。

**前置依赖**：T30、T31、T32

**建议涉及文件/模块**：`template/compiler/langgraph_compiler.py` + unit test

### 实现范围

只实现最小 START/END endpoint mapping 和结构校验。

### 测试用例

- [x] START 唯一
- [x] END 可达
- [x] 无 START/END 编译失败
- [x] START/END 不作为普通业务 executor

### 验收标准

最小空业务图的结构行为明确。

### 回归范围

现有 compiler endpoint 行为。

### Codex Prompt

```text
先只验证 START/END endpoint mapping，不加入 LLM/Tool。让该 Task 的测试独立通过。
```

---

## T34：普通 Edge 动态 add_edge

**状态：Completed**

**目标**：独立验证 Manifest Edge → LangGraph add_edge。

**前置依赖**：T33

**建议涉及文件/模块**：`langgraph_compiler.py`

### 实现范围

用 FakeNodeExecutor 构造 A→B 图。

### 测试用例

- [x] A→B 执行顺序
- [x] 不存在 source/target 拒绝
- [x] 重复非法 edge 处理明确

### 验收标准

从 JSON Manifest 可动态产生真实顺序执行 Graph。

### 回归范围

START/END mapping。

### Codex Prompt

```text
用 FakeNodeExecutor 实现并测试 Manifest 普通 edge → graph.add_edge()。此任务不要接 LLM。
```

---

## T35：Conditional Edge 动态组装

**状态：Completed**

**目标**：独立验证 Condition route → add_conditional_edges。

**前置依赖**：T34

**建议涉及文件/模块**：`langgraph_compiler.py` + router tests

### 实现范围

用 FakeConditionExecutor 返回 true/false route，分别进入不同 Fake Node。

### 测试用例

- [x] true 路径
- [x] false 路径
- [x] 未知 route 失败
- [x] 非法 route target 验证失败

### 验收标准

条件图可以独立编译和运行。

### 回归范围

普通 edge。

### Codex Prompt

```text
实现并测试 manifest conditional edge → LangGraph add_conditional_edges，使用 fake condition，不接真实 LLM。
```

---

## T36：Router 多分支动态组装

**状态：Completed**

**目标**：支持显式 Router 节点的多 route。

**前置依赖**：T35

**建议涉及文件/模块**：`langgraph_compiler.py`、router contract

### 实现范围

Router 返回字符串 route key，manifest route map 指向目标。

### 测试用例

- [x] 3 分支分别可达
- [x] 未声明 route 拒绝
- [x] 重复 route 拒绝

### 验收标准

多路由 Graph 可独立运行。

### 回归范围

Condition 双分支。

### Codex Prompt

```text
实现 Router 多分支组装和测试，确保 route key 与 edge map 一一对应。
```

---

## T37：Graph Compile Service

**状态：Completed**

**目标**：建立明确的 `manifest → StateGraph → compile()` 服务边界。

**前置依赖**：T32-T36

**建议涉及文件/模块**：`template/compiler/compile_service.py`

### 实现范围

输入 WorkflowManifest；输出 CompiledManifestGraph；统一包装 compile error。

### 测试用例

- [x] 合法 Manifest compile 成功
- [x] 非法 Manifest compile 失败
- [x] compile 不修改 Manifest
- [x] 同一版本重复 compile 语义一致

### 验收标准

可以在 Python 进程运行时动态 compile，无需重新编译项目或重启服务。

### 回归范围

现有 LangGraph compiler。

### Codex Prompt

```text
抽离 GraphCompileService，明确验证 Python 运行时根据 Manifest 动态 StateGraph/add_node/add_edge/compile 的完整流程。
```

---

## T38：Compile Dry Run

**状态：Completed**

**目标**：为 Publish 提供不调用真实 LLM/Tool 的可执行结构验证。

**前置依赖**：T37

**建议涉及文件/模块**：`template/compiler/dry_run.py`

### 实现范围

所有 executor 替换成 schema-compatible fake executor，验证图可 compile、可走至少一条结构路径。

### 测试用例

- [x] 合法 graph dry-run 通过
- [x] 结构错误失败
- [x] dry-run 不调用真实 provider/tool

### 验收标准

Publish 可以在无外部依赖情况下验证结构。

### 回归范围

无外部调用。

### Codex Prompt

```text
实现 compile dry-run，必须不调用真实 LLM/Tool，仅验证图结构与 executor 构建能力。
```

---

## T39：动态发布无需重启测试

**状态：Completed**

**目标**：证明发布新 AgentVersion 后同一 Python 进程可动态 compile 并执行。

**前置依赖**：T24、T37

**建议涉及文件/模块**：`backend/tests/integration/agent_dynamic_publish_test.py`

### 实现范围

同一测试进程发布 V1、运行；修改 Draft 发布 V2、运行；不重启应用。

### 测试用例

- [x] V1/V2 都能运行
- [x] V1 仍可再次运行
- [x] V2 不污染 V1
- [x] 进程未重启

### 验收标准

核心技术关键点获得自动化证据。

### 回归范围

版本隔离。

### Codex Prompt

```text
编写动态发布集成测试：同一 Python 进程中依次发布/compile/执行 V1、V2，证明不需要重新编译项目或重启服务。
```

---


# Phase 4：Node Executor 完整实现

## T40：LLM Node Schema + Validator

**状态：Completed**

**目标**：正式定义独立 LLM Node 配置。

**前置依赖**：T02、T21

**建议涉及文件/模块**：`template/nodes/llm_schema.py`

### 实现范围

字段：model/system_prompt/prompt_template/temperature/input_mapping/output_key。

### 测试用例

- [x] 必填字段
- [x] temperature 范围
- [x] output_key 合法
- [x] input_mapping path 校验

### 验收标准

LLM Node 配置可被前后端稳定使用。

### 回归范围

无。

### Codex Prompt

```text
实现 LLM Node Schema 与 Validator，LLM Node 是单次模型调用，不包含 Tool Loop。
```

---

## T41：LLMNodeExecutor + Fake Provider

**状态：Completed**

**目标**：让最小 Graph 真正执行一次 LLM Node。

**前置依赖**：T30、T32、T40

**建议涉及文件/模块**：`runtime/graph/nodes/llm.py`

### 实现范围

复用现有 Provider 抽象；测试使用 FakeProvider；将结果写入 output_key；发 node/token event。

### 测试用例

- [x] prompt mapping 正确
- [x] fake LLM 返回写入 state
- [x] token event 顺序
- [x] provider error 转结构化错误

### 验收标准

`START → LLM → OUTPUT → END` 的核心节点已具备。

### 回归范围

Provider 现有行为。

### Codex Prompt

```text
实现 LLMNodeExecutor，测试必须使用 FakeProvider，不依赖真实网络和 Token。
```

---

## T42：Output Node 完整实现

**状态：Completed**

**目标**：把 state path 指定值转成最终 Workflow 输出。

**前置依赖**：T30、T32

**建议涉及文件/模块**：`runtime/graph/nodes/output.py`

### 实现范围

配置 source；读取 state path；设置 state.output。

### 测试用例

- [x] source 存在
- [x] source 不存在结构化失败
- [x] 非字符串结果序列化规则

### 验收标准

Output 行为确定且可单测。

### 回归范围

无。

### Codex Prompt

```text
实现 OutputNodeExecutor 和 state path 读取测试，禁止 source 不存在时静默输出空字符串。
```

---

## T43：Vertical Slice 1：START→LLM→OUTPUT→END

**状态：Completed**

**目标**：首次端到端证明 JSON Manifest 可动态生成可执行 LLM Graph。

**前置依赖**：T37、T41、T42

**建议涉及文件/模块**：`backend/tests/integration/workflow_slice_llm.py`

### 实现范围

从 JSON 构造 manifest → validate → compile → invoke/stream。

### 测试用例

- [x] Node 顺序 START/LLM/OUTPUT/END
- [x] Fake LLM 被调用一次
- [x] 最终 output 正确
- [x] RuntimeEvent 顺序正确

### 验收标准

这是 Agent 组装第一道强制里程碑，未通过不得继续宣布 Runtime 可用。

### 回归范围

Legacy Chat 不受影响。

### Codex Prompt

```text
编写 Vertical Slice 1 集成测试，从 JSON Manifest 开始真实走 validate→StateGraph→compile→Fake LLM→Output。
```

---

## T44：Tool Node Schema + 可执行 Tool Registry

**状态：Completed**

**目标**：把 Metadata Registry 与 Callable Registry 分离。

**前置依赖**：T21

**建议涉及文件/模块**：`tool/executor_registry.py`、`tool/executor.py`

### 实现范围

ToolDefinition 保留 metadata；ToolExecutorRegistry 存 async callable；Tool Node 配 tool_name/args/output_key。

### 测试用例

- [x] register/get
- [x] 未知 tool
- [x] 输入参数校验
- [x] fake read-only tool

### 验收标准

至少一个 FakeTool 能被真实执行。

### 回归范围

现有 Tool Metadata 行为。

### Codex Prompt

```text
保留现有 ToolMetadata Registry，新增 ToolExecutorRegistry 和 FakeTool，禁止把 Python callable 持久化到数据库。
```

---

## T45：ToolNodeExecutor

**状态：Completed**

**目标**：Workflow 显式 Tool Node 真正执行 Tool。

**前置依赖**：T32、T44

**建议涉及文件/模块**：`runtime/graph/nodes/tool.py`

### 实现范围

解析 state/constant 参数；emit tool_call；执行；emit tool_result；写 output_key。

### 测试用例

- [x] 参数映射
- [x] tool_call/result 事件
- [x] 成功结果写 state
- [x] tool error

### 验收标准

显式 Tool Node 可独立测试。

### 回归范围

Trace / tool metadata。

### Codex Prompt

```text
实现 ToolNodeExecutor，使用 FakeTool 测试 tool_call/tool_result/state write-back。
```

---

## T46：Vertical Slice 2：LLM→Tool→Output

**状态：Completed**

**目标**：证明多节点 state 传递、Tool 执行与事件闭环。

**前置依赖**：T43、T45

**建议涉及文件/模块**：`workflow_slice_tool.py`

### 实现范围

START→LLM→Tool→Output→END。

### 测试用例

- [x] LLM 输出作为 Tool 输入
- [x] Tool 被调用一次
- [x] 最终 Output 正确
- [x] 事件顺序正确

### 验收标准

Tool 参与真实 Graph 执行。

### 回归范围

Legacy Chat。

### Codex Prompt

```text
实现 START→LLM→Tool→Output→END 集成测试，FakeProvider + FakeTool，不访问外部资源。
```

---

## T47：Condition Node Schema + Executor

**状态：Completed**

**目标**：实现受控二分条件，不允许 eval/exec。

**前置依赖**：T21、T32

**建议涉及文件/模块**：`runtime/graph/nodes/condition.py`

### 实现范围

支持 eq/ne/gt/gte/lt/lte/exists/contains/is_true/is_false。

### 测试用例

- [x] 每个 operator
- [x] source 不存在
- [x] 类型不兼容
- [x] true/false route

### 验收标准

Condition 可独立单测。

### 回归范围

无。

### Codex Prompt

```text
实现安全 Condition evaluator 和 ConditionNodeExecutor，禁止 eval/exec。
```

---

## T48：Router Node Schema + Executor

**状态：Completed**

**目标**：实现多分支 Router。

**前置依赖**：T21、T32

**建议涉及文件/模块**：`runtime/graph/nodes/router.py`

### 实现范围

支持基于 state path 的 explicit route mapping；不执行任意代码。

### 测试用例

- [x] 多 route
- [x] default route
- [x] 未知 route
- [x] 缺失 source

### 验收标准

Router 可独立单测。

### 回归范围

无。

### Codex Prompt

```text
实现 RouterNodeExecutor，多分支使用显式 route map，不允许用户提交任意 Python 表达式。
```

---

## T49：Vertical Slice 3：Condition 双分支

**状态：Completed**

**目标**：证明 conditional edges 真实按运行结果选择路径。

**前置依赖**：T43、T47

**建议涉及文件/模块**：`workflow_slice_condition.py`

### 实现范围

START→LLM→Condition→(LLM-A/LLM-B)→Output→END。

### 测试用例

- [x] true 只执行 A
- [x] false 只执行 B
- [x] 未走分支不产生 node_started
- [x] 最终 output 正确

### 验收标准

条件路由完整可验证。

### 回归范围

无。

### Codex Prompt

```text
实现 Condition 双分支 Vertical Slice，分别覆盖 true/false 两次运行。
```

---

## T4A：Agent Node Schema + 单轮 Agent Executor

**状态：Completed**

**目标**：完成与 LLM Node 分离的 Agent Node V1。

**前置依赖**：T41

**建议涉及文件/模块**：`runtime/graph/nodes/agent.py`

### 实现范围

Agent Node 增加 context_policy、tools、max_steps 等字段；V1 先实现单轮模型调用，tools 可保存但自动 tool loop 由后续增强任务开启。

### 测试用例

- [x] Agent 与 LLM schema 不混淆
- [x] context 构造
- [x] single turn 输出
- [x] 不支持的 tool loop 配置明确拒绝/警告

### 验收标准

Agent Node V1 可执行且边界明确。

### 回归范围

ConversationContextBuilder。

### Codex Prompt

```text
实现 AgentNode V1，语义与 LLMNode 分离；先完成单轮 Agent 执行并明确 tool-loop 能力边界。
```

---


# Phase 5：WorkflowAgentRuntime

## T50：WorkflowAgentRuntime 最小实现

**状态：Completed**

**目标**：根据 AgentVersion 加载 Manifest、compile 并执行。

**前置依赖**：T37、T43、T22

**建议涉及文件/模块**：`runtime/agent/workflow_runtime.py`

### 实现范围

输入 AgentRunContext；加载 immutable version；执行 graph；输出统一 RuntimeEvent。

### 测试用例

- [x] 加载正确版本
- [x] stream event
- [x] graph error
- [x] 不存在版本

### 验收标准

可绕开正式 Session 独立调用 Runtime。

### 回归范围

Legacy runtime。

### Codex Prompt

```text
实现 WorkflowAgentRuntime，先以 Vertical Slice 1 的 LLM Graph 作为可执行目标。
```

---

## T51：CompiledGraph Cache

**状态：Completed**

**目标**：避免每次聊天重复 compile。

**前置依赖**：T50

**建议涉及文件/模块**：`runtime/graph/cache.py`

### 实现范围

以 immutable `agent_version_id` 为 key；Draft 不缓存。

### 测试用例

- [x] 首次 miss compile
- [x] 二次 hit
- [x] V1/V2 隔离
- [x] cache clear

### 验收标准

缓存不改变运行语义。

### 回归范围

无。

### Codex Prompt

```text
实现 CompiledGraphCache，只缓存 immutable AgentVersion，不缓存 Draft。
```

---

## T52：Agent Test Run Service

**状态：Completed**

**目标**：不创建正式 Session 就可调试 AgentVersion。

**前置依赖**：T50

**建议涉及文件/模块**：`runtime/agent/test_run_service.py`

### 实现范围

创建 ephemeral run_id；不写正式 Message/Timeline；保留独立 trace。

### 测试用例

- [x] test run 不产生正式 session message
- [x] run 状态可查询
- [x] 失败状态可查询

### 验收标准

Workflow 可独立调试。

### 回归范围

正式 Session 数据。

### Codex Prompt

```text
实现 Agent Test Run Service，测试运行不得污染正式 Session/Timeline/Message。
```

---

## T53：Test Run API + SSE

**状态：Completed**

**目标**：前端可以启动 Test Run 并实时看到 node/token/tool/route。

**前置依赖**：T52、T01

**建议涉及文件/模块**：`POST /api/agent-versions/{id}/test-runs`、`GET /sse/agent-test-runs/{runId}`

### 实现范围

POST 返回 run_id；SSE 复用 RuntimeEvent。

### 测试用例

- [x] 创建 run
- [x] SSE 事件顺序
- [x] run 完成可查询
- [x] 取消/断开语义明确

### 验收标准

前端无需正式 Session 即可调试。

### 回归范围

Chat SSE 不受影响。

### Codex Prompt

```text
实现 Test Run REST+SSE API，事件 Contract 与 Chat RuntimeEvent 一致。
```

---

## T54：完整 Runtime Trace

**状态：Completed**

**目标**：让每个 Node 都有可调试轨迹。

**前置依赖**：T50

**建议涉及文件/模块**：`runtime/trace/`

### 实现范围

记录 run_id/agent_version_id/node_id/node_type/input_summary/output_summary/duration/status/route。

### 测试用例

- [x] LLM trace
- [x] Tool trace
- [x] Condition/Router route
- [x] error trace

### 验收标准

Debug UI 有可靠数据源。

### 回归范围

现有 Trace 兼容。

### Codex Prompt

```text
扩展 TraceCollector 记录 agent_version_id、node_id、node_type 和 route，保持现有 trace 读取兼容。
```

---


# Phase 6：Session 绑定 AgentVersion

## T60：Session agent_version_id Migration

**状态：Completed**

**目标**：让历史 Session 默认 Legacy，新 Session 可绑定发布版本。

**前置依赖**：T22

**建议涉及文件/模块**：Session model/store/migration

### 实现范围

`agent_version_id nullable`；历史记录保持 NULL。

### 测试用例

- [x] migration 前后历史 session 数量一致
- [x] NULL session 仍可 Chat
- [x] 非法外键处理

### 验收标准

无强制迁移风险。

### 回归范围

现有 Session CRUD。

### Codex Prompt

```text
为 Session 增加 nullable agent_version_id，禁止自动给历史 Session 绑定最新 Agent。
```

---

## T61：新建 Session 选择 Agent API

**状态：Completed**

**目标**：创建 Session 时可绑定 Published AgentVersion。

**前置依赖**：T60

**建议涉及文件/模块**：`POST /api/sessions`

### 实现范围

校验 version=PUBLISHED 且属于 agent_template_id；空值为 Legacy。

### 测试用例

- [x] 创建 Legacy session
- [x] 创建 Workflow session
- [x] draft version 被拒绝
- [x] template/version 不匹配被拒绝

### 验收标准

API Contract 完整。

### 回归范围

现有 Session create。

### Codex Prompt

```text
扩展创建 Session API 支持 agent_template_id + agent_version_id，只允许 PUBLISHED version。
```

---

## T62：Resolver 接入 WorkflowAgentRuntime

**状态：Completed**

**目标**：第一次让真实 Session 使用页面发布的 Agent。

**前置依赖**：T13、T50、T60

**建议涉及文件/模块**：`runtime/agent/resolver.py`

### 实现范围

flag on + published version → Workflow；否则 Legacy；Workflow 失败不得静默 fallback 到 Legacy。

### 测试用例

- [x] 历史 session legacy
- [x] workflow session workflow
- [x] workflow error 不重复执行 legacy

### 验收标准

Session Runtime 选择明确。

### 回归范围

Legacy 全量。

### Codex Prompt

```text
将 WorkflowAgentRuntime 注入 Resolver。禁止 Workflow 失败后静默 fallback，避免 Tool 副作用重复执行。
```

---

## T63：Vertical Slice 4：新 Session → 选择 Agent → Chat

**状态：Completed**

**目标**：完成用户核心需求 2。

**前置依赖**：T61、T62

**建议涉及文件/模块**：`backend/tests/e2e/session_agent_selection.py`

### 实现范围

发布 AgentVersion → 创建绑定 Session → POST message → SSE → WorkflowRuntime。

### 测试用例

- [x] 使用正确 version
- [x] 返回 LLM Output
- [x] trace 带 version id
- [x] Legacy session 同时可用

### 验收标准

新建 Session 选择 Agent 的全链路可运行。

### 回归范围

Legacy Chat。

### Codex Prompt

```text
实现端到端测试：发布一个 START→LLM→OUTPUT Agent，创建绑定 Session 并真实通过 Chat SSE 执行。
```

---

## T64：Session Switch Agent API

**状态：Completed**

**目标**：已有 Session 可以切换 Published AgentVersion，只影响下一次 Run。

**前置依赖**：T60、T61

**建议涉及文件/模块**：`PATCH /api/sessions/{id}/agent`

### 实现范围

保留历史 Message/Context/Timeline/Trace/Checkpoint；更新后续 binding。

### 测试用例

- [x] V1→V2
- [x] V2→Legacy
- [x] draft 拒绝
- [x] 历史消息不变

### 验收标准

完成核心需求 3 的后端基础。

### 回归范围

Message/Timeline/Context。

### Codex Prompt

```text
实现 Session Agent Switch API，只修改后续执行 binding，不重写历史内容。
```

---

## T65：运行中切换保护

**状态：Completed**

**目标**：避免生成中/Tool 执行中热切换。

**前置依赖**：T64

**建议涉及文件/模块**：Session run status service

### 实现范围

generating、unfinished tool、interrupt、replay 时返回 409 + reason code。

### 测试用例

- [x] 各阻塞状态
- [x] 空闲时可切换

### 验收标准

第一版不做复杂热切换。

### 回归范围

现有运行状态。

### Codex Prompt

```text
为 Agent Switch 加运行状态保护，忙碌状态返回结构化 409 reason。
```

---

## T66：Checkpoint/Trace 绑定 AgentVersion

**状态：Completed**

**目标**：保证 Replay 能知道历史运行使用哪个 Agent。

**前置依赖**：T60、T54

**建议涉及文件/模块**：Checkpoint model/service、Trace metadata

### 实现范围

新增 agent_template_id/agent_version_id；历史 NULL 视为 legacy。

### 测试用例

- [x] 新 checkpoint 写入 version
- [x] legacy checkpoint 为空
- [x] trace 一致

### 验收标准

版本追溯完整。

### 回归范围

历史 checkpoint 可读。

### Codex Prompt

```text
扩展 Checkpoint 和 Trace 写入 agent_version_id；旧记录保持可读。
```

---

## T67：Replay 使用历史 AgentVersion

**状态：Completed**

**目标**：Session 切到 V2 后，从 V1 Checkpoint Replay 必须仍用 V1。

**前置依赖**：T66

**建议涉及文件/模块**：Replay/Continue service

### 实现范围

checkpoint 有 version → 使用该 version；NULL → legacy compatibility。

### 测试用例

- [x] V1 checkpoint + session V2 → replay V1
- [x] legacy checkpoint → legacy
- [x] 版本不存在明确失败

### 验收标准

Replay 不受当前 Session Agent 切换影响。

### 回归范围

Replay 现有测试。

### Codex Prompt

```text
修改 Replay/Continue Agent 解析逻辑，并加入 V1 checkpoint / V2 current session 的版本一致性测试。
```

---


# Phase 7：Frontend 数据层与接口

## T70：Workflow API Client

**状态：Completed**

**目标**：把 Agent/Draft/Validate/Publish/Version/TestRun API 从页面逻辑中抽离。

**前置依赖**：T20-T24、T53

**建议涉及文件/模块**：`studio/src/api/agents.*` 或项目现有 API 模式

### 实现范围

实现 typed/validated client；统一错误模型和取消请求。

### 测试用例

- [x] mock API 单测
- [x] validation error 保真
- [x] network error

### 验收标准

页面不直接散落 fetch。

### 回归范围

现有 Chat API。

### Codex Prompt

```text
抽离 Workflow API client，覆盖 agents/draft/validate/publish/version/test-run，遵循当前前端工程现有模块风格。
```

---

## T71：Frontend Manifest Model + Round Trip

**状态：Completed**

**目标**：建立 UI Graph ↔ WorkflowManifest 的纯函数边界。

**前置依赖**：T02

**建议涉及文件/模块**：`studio/src/workflow/manifest/`

### 实现范围

`serializeGraph()` / `deserializeGraph()`；Runtime 与 UI metadata 分离。

### 测试用例

- [x] nodes round-trip
- [x] edges round-trip
- [x] position round-trip
- [x] config round-trip
- [x] viewport round-trip

### 验收标准

Save/Load 不丢任何用户编辑信息。

### 回归范围

无。

### Codex Prompt

```text
实现 serializeGraph/deserializeGraph 纯函数及测试，确保 runtime config 与 UI position/viewport 分离。
```

---

## T72：Node Type Frontend Registry

**状态：Completed**

**目标**：每种 Node 都有明确的 UI renderer 和 config renderer。

**前置依赖**：T03、T71

**建议涉及文件/模块**：`studio/src/workflow/nodes/registry.*`

### 实现范围

注册 LLM/Agent/Tool/Condition/Router/Output/START/END。

### 测试用例

- [x] catalog 与 frontend registry 对齐
- [x] 缺 renderer 时明确报错
- [x] 禁止静默显示 generic box

### 验收标准

后端正式支持的 Node 前端都能完整编辑。

### 回归范围

无。

### Codex Prompt

```text
实现 Frontend Node Registry，对齐后端 Node Catalog；正式支持的 Node 不允许 fallback 成不可配置的 generic box。
```

---


# Phase 8：完整 Workflow Builder

## T80：Canvas 基础与开源库适配

**状态：Completed**

**目标**：建立稳定画布底座，支持 pan/zoom/fit/minimap。

**前置依赖**：T72

**建议涉及文件/模块**：Workflow Builder 独立模块

### 实现范围

优先复用成熟 graph/canvas 开源实现；封装 GraphCanvasAdapter，避免业务页面绑死第三方 API。

### 测试用例

- [x] pan
- [x] zoom
- [x] fit view
- [x] minimap
- [x] 100+ node 基础性能 smoke test

### 验收标准

画布不是静态 div 方框。

### 回归范围

Chat 页面不受影响。

### Codex Prompt

```text
使用成熟开源 Graph Canvas 实现并封装适配层；完成 pan/zoom/fit/minimap 和基本性能测试。
```

---

## T81：Node Library 拖拽创建

**状态：Completed**

**目标**：从 Node Library 真正拖入 Canvas。

**前置依赖**：T80、T03

**建议涉及文件/模块**：NodeLibrary、Canvas drop handler

### 实现范围

START/END 限制数量；普通 Node 自动生成稳定 id。

### 测试用例

- [x] 拖入 LLM/Tool/Condition 等
- [x] START 重复拒绝
- [x] drop 坐标正确

### 验收标准

所有 V1 Node 可从左侧创建。

### 回归范围

无。

### Codex Prompt

```text
实现 Node Library + drag/drop create，数据源对齐 Node Catalog，并测试坐标与唯一 ID。
```

---

## T82：Node 移动/选择/删除/复制

**状态：Completed**

**目标**：完成基本编辑能力。

**前置依赖**：T81

**建议涉及文件/模块**：Canvas interactions

### 实现范围

支持单选、移动、Delete、Duplicate；删除 Node 时同步处理 Edge。

### 测试用例

- [x] move 保存坐标
- [x] delete 清 edge
- [x] duplicate config 独立
- [x] START/END 不允许 duplicate

### 验收标准

编辑器达到正常使用基础。

### 回归范围

无。

### Codex Prompt

```text
实现 node move/select/delete/duplicate，并写交互测试；复制后 config 不共享引用。
```

---

## T83：Edge 创建/删除/重连

**状态：Completed**

**目标**：实现完整边编辑。

**前置依赖**：T80、T82

**建议涉及文件/模块**：Edge interactions

### 实现范围

连接 handle；类型校验；delete；reconnect。

### 测试用例

- [x] create
- [x] delete
- [x] reconnect
- [x] 非法连接拒绝
- [x] 重复 edge 规则

### 验收标准

用户无需直接改 JSON 即可完成拓扑。

### 回归范围

无。

### Codex Prompt

```text
实现 edge create/delete/reconnect，连接规则使用 Node Catalog / Manifest Validator 约束。
```

---

## T84：LLM Node UI + Config Panel

**状态：Completed**

**目标**：LLM Node 前端必须完整可配置。

**前置依赖**：T40、T72

**建议涉及文件/模块**：LLMNodeView、LLMNodeConfig

### 实现范围

编辑 model/system prompt/prompt template/temperature/input mapping/output key。

### 测试用例

- [x] 表单加载已有值
- [x] 编辑写回 graph state
- [x] 非法值前端提示
- [x] save/load round-trip

### 验收标准

LLM Node 不只是一个方框。

### 回归范围

无。

### Codex Prompt

```text
实现完整 LLM Node UI 和配置面板，字段必须与后端 LLM Schema 一一对应，并加入 round-trip 测试。
```

---

## T85：Agent Node UI + Config Panel

**状态：Completed**

**目标**：Agent Node 前端完整配置，且与 LLM Node 明确区分。

**前置依赖**：T4A、T72

**建议涉及文件/模块**：AgentNodeView、AgentNodeConfig

### 实现范围

prompt/model/context policy/tools/max steps/output key；V1 暂不支持的 tool-loop 设置明确禁用说明。

### 测试用例

- [x] 字段 round-trip
- [x] tool list 加载
- [x] 不支持配置不可伪装已生效

### 验收标准

Agent Node 是真实可执行配置。

### 回归范围

无。

### Codex Prompt

```text
实现 Agent Node UI/Config，和 LLM Node 使用不同配置组件，明确 V1 tool-loop 边界。
```

---

## T86：Tool Node UI + Config Panel

**状态：Completed**

**目标**：Tool Node 可从后端 Tool Catalog 选择真实 Tool。

**前置依赖**：T44、T72

**建议涉及文件/模块**：ToolNodeView、ToolNodeConfig

### 实现范围

选择 tool_name；根据 metadata 配 arguments/input mapping/output key。

### 测试用例

- [x] tool catalog 加载
- [x] 未知 tool 高亮
- [x] args round-trip

### 验收标准

页面选择的 Tool 后端可真实执行。

### 回归范围

无。

### Codex Prompt

```text
实现 Tool Node UI，tool_name 必须来自后端 Tool Catalog，不能允许前端凭空填写不存在的 Tool 而不提示。
```

---

## T87：Condition Node UI + Config Panel

**状态：Completed**

**目标**：Condition 可视化配置并展示 true/false handles。

**前置依赖**：T47、T72

**建议涉及文件/模块**：ConditionNodeView、Config

### 实现范围

source/operator/value；输出 true/false handle。

### 测试用例

- [x] true/false edge
- [x] operator config
- [x] round-trip
- [x] invalid config highlight

### 验收标准

用户可完整构建二分支。

### 回归范围

无。

### Codex Prompt

```text
实现 Condition Node UI，提供 true/false 独立输出 handle，并与后端 Condition Schema 对齐。
```

---

## T88：Router Node UI + Config Panel

**状态：Completed**

**目标**：Router 可配置多 route 并动态显示 handles。

**前置依赖**：T48、T72

**建议涉及文件/模块**：RouterNodeView、Config

### 实现范围

routes 列表；每个 route 独立 handle。

### 测试用例

- [x] 增加/删除 route
- [x] edge 关联
- [x] 删除有 edge 的 route 二次确认
- [x] round-trip

### 验收标准

多分支可完整编辑。

### 回归范围

无。

### Codex Prompt

```text
实现 Router Node UI，多 route 动态 handle，删除已连接 route 时必须保护。
```

---

## T89：Output / START / END UI

**状态：Completed**

**目标**：完成剩余基础 Node 的完整视觉和规则。

**前置依赖**：T42、T72

**建议涉及文件/模块**：OutputNodeView、StartNodeView、EndNodeView

### 实现范围

START 无入边；END 无出边；Output 配 source。

### 测试用例

- [x] 连接限制
- [x] output source round-trip

### 验收标准

V1 所有 Node 都有正式 UI。

### 回归范围

无。

### Codex Prompt

```text
实现 Output/START/END Node UI 与连接限制，不允许使用 generic placeholder node。
```

---

## T8A：Save Draft 完整闭环

**状态：Completed**

**目标**：Canvas → Manifest → API → DB。

**前置依赖**：T20、T70、T71、T81-T89

**建议涉及文件/模块**：Workflow toolbar Save

### 实现范围

dirty state；save pending/success/error；保存成功更新 revision/updated_at。

### 测试用例

- [x] 完整图保存
- [x] 失败保留 dirty
- [x] 重复保存幂等
- [x] 请求体 contract

### 验收标准

可可靠保存完整图。

### 回归范围

无。

### Codex Prompt

```text
实现 Save Draft 闭环，保存全部 node/edge/config/ui metadata，并加入 mock API 和集成测试。
```

---

## T8B：Load Draft + 完整 Round Trip

**状态：Completed**

**目标**：DB → API → Manifest → Canvas。

**前置依赖**：T8A

**建议涉及文件/模块**：Workflow load/init

### 实现范围

恢复 nodes/edges/positions/config/viewport。

### 测试用例

- [x] Save→reload→same runtime manifest
- [x] positions 保持
- [x] config 保持
- [x] edge handles 保持

### 验收标准

禁止出现只 Save 不 Load 的半成品。

### 回归范围

无。

### Codex Prompt

```text
实现 Load Draft，并做 Save→Load→Serialize 等价的完整 Round Trip 集成测试。
```

---

## T8C：Dirty State / Unsaved Protection

**状态：Completed**

**目标**：避免复杂 Workflow 编辑丢失。

**前置依赖**：T8A、T8B

**建议涉及文件/模块**：Workflow editor state

### 实现范围

任意 node/edge/config 改动标 dirty；离开/切换 agent 提示；保存成功清 dirty。

### 测试用例

- [x] move node dirty
- [x] config dirty
- [x] edge dirty
- [x] save clear
- [x] cancel navigation

### 验收标准

编辑体验完整。

### 回归范围

无。

### Codex Prompt

```text
实现 Workflow dirty state 和未保存离开保护，覆盖 node/edge/config 三类变化。
```

---

## T8D：Validate UI + Node/Edge 错误高亮

**状态：Completed**

**目标**：把后端结构化 ValidationResult 精确映射到画布。

**前置依赖**：T23、T8B

**建议涉及文件/模块**：Validation panel / node decorations

### 实现范围

node error、edge error、field error；点击错误定位并选中对象。

### 测试用例

- [x] node highlight
- [x] edge highlight
- [x] config field error
- [x] click focus

### 验收标准

用户能定位错误，而不是只看到“invalid graph”。

### 回归范围

无。

### Codex Prompt

```text
实现 Validate UI，把后端 node_id/edge_id/field 精确映射到 Canvas 和 Config Panel。
```

---

## T8E：Publish UI + Version 展示

**状态：Completed**

**目标**：让用户从 Draft 明确发布 immutable AgentVersion。

**前置依赖**：T24、T8D

**建议涉及文件/模块**：Publish dialog / version badge

### 实现范围

未 validate 或有 error 时禁止发布；成功显示 version/checksum/time。

### 测试用例

- [x] publish success
- [x] publish fail
- [x] 旧版本仍可选
- [x] draft 后续修改不改变版本

### 验收标准

前端不会把 Save 等同 Publish。

### 回归范围

无。

### Codex Prompt

```text
实现 Publish UI 和 AgentVersion 展示，明确 Draft 与 Published Version 的不同状态。
```

---


# Phase 9：Workflow Test Run 与可视化调试

## T90：Test Run 输入与启动 UI

**状态：Completed**

**目标**：从 Workflow 页面直接测试 Published AgentVersion。

**前置依赖**：T53、T8E

**建议涉及文件/模块**：TestRunPanel

### 实现范围

输入用户文本/variables；创建 test run；连接 SSE。

### 测试用例

- [x] 启动
- [x] loading
- [x] 失败
- [x] 断线

### 验收标准

无需正式 Session 即可运行 Agent。

### 回归范围

正式 Session 不受影响。

### Codex Prompt

```text
实现 Test Run UI，启动后订阅独立 test-run SSE，不创建正式 Session Message。
```

---

## T91：运行节点高亮

**状态：Completed**

**目标**：根据 node_started/node_finished/graph_failed 实时高亮画布。

**前置依赖**：T90、T54

**建议涉及文件/模块**：Canvas runtime overlay

### 实现范围

running/success/error 状态是运行时 overlay，不写回 Draft。

### 测试用例

- [x] node running
- [x] success
- [x] error
- [x] 第二次 run 清旧状态

### 验收标准

可直观看到执行路径。

### 回归范围

Manifest 不被调试状态污染。

### Codex Prompt

```text
实现 runtime node overlay，高亮只能存在于运行态，禁止序列化进 Manifest。
```

---

## T92：Node Debug Inspector

**状态：Completed**

**目标**：点击运行节点可看 Input/Output/State/Tool/Route/Duration。

**前置依赖**：T91、T54

**建议涉及文件/模块**：RuntimeInspector

### 实现范围

展示 trace 数据；大结果折叠/懒加载。

### 测试用例

- [x] LLM input/output
- [x] tool args/result
- [x] condition route
- [x] duration/error

### 验收标准

调试信息足以定位 Graph 错误。

### 回归范围

无。

### Codex Prompt

```text
实现 Node Debug Inspector，按 node_id/run_id 展示输入输出和 trace。
```

---

## T93：Vertical Slice 5：完整 Builder→Publish→TestRun

**状态：Completed**

**目标**：证明前端编辑器不是半成品。

**前置依赖**：T80-T92

**建议涉及文件/模块**：frontend E2E + backend test env

### 实现范围

页面创建 START→LLM→OUTPUT→END，Save、Reload、Validate、Publish、TestRun。

### 测试用例

- [x] 拖拽创建
- [x] 连边
- [x] 配置 LLM
- [x] reload 不丢数据
- [x] publish
- [x] test run 输出
- [x] node 高亮

### 验收标准

Workflow Builder 第一条完整产品闭环。

### 回归范围

Chat 不受影响。

### Codex Prompt

```text
编写 E2E：从空白 Workflow 页面开始完成建图、Save、Reload、Validate、Publish、Test Run，并断言运行节点高亮和输出。
```

---


# Phase 10：Session 前端集成

## TA0：Published Agent Selector 数据源

**状态：Completed**

**目标**：前端只展示真正可绑定的 Published AgentVersion。

**前置依赖**：T22、T70

**建议涉及文件/模块**：Agent selector data hook/client

### 实现范围

列表显示 Agent name + active version；支持 Legacy/Default。

### 测试用例

- [x] published visible
- [x] draft invisible
- [x] disabled invisible/标记

### 验收标准

选择数据可信。

### 回归范围

无。

### Codex Prompt

```text
实现 Published Agent 列表数据源，禁止把 Draft 暴露给 Session Selector。
```

---

## TA1：新建 Session Agent Selector UI

**状态：Completed**

**目标**：用户新建 Session 时可选择 Agent。

**前置依赖**：T61、TA0

**建议涉及文件/模块**：NewSession dialog/page

### 实现范围

Default/Legacy + published agent；创建以后以服务端返回 binding 为准。

### 测试用例

- [x] create legacy
- [x] create workflow agent
- [x] API error
- [x] selection persisted

### 验收标准

完成需求 2 的前端闭环。

### 回归范围

现有新建 Session。

### Codex Prompt

```text
在新建 Session UI 增加 Agent Selector，提交 agent_template_id/agent_version_id，并以后端返回为唯一事实来源。
```

---

## TA2：Chat 当前 Agent 展示

**状态：Completed**

**目标**：用户能看到当前 Session 使用哪个 AgentVersion。

**前置依赖**：T61

**建议涉及文件/模块**：Chat header

### 实现范围

显示 Legacy/Agent Name/version。

### 测试用例

- [x] reload 后正确
- [x] switch 后更新

### 验收标准

状态可见。

### 回归范围

Chat layout。

### Codex Prompt

```text
在 Chat Header 显示当前 Agent 和版本，刷新页面从后端恢复。
```

---

## TA3：已有 Session Agent Switcher

**状态：Completed**

**目标**：提供安全切换入口。

**前置依赖**：T64、T65、TA2

**建议涉及文件/模块**：Chat Agent Switcher

### 实现范围

提示“只影响后续运行”；409 显示 reason；禁止本地乐观修改。

### 测试用例

- [x] V1→V2
- [x] V2→Legacy
- [x] 409
- [x] cancel

### 验收标准

完成需求 3 的前端闭环。

### 回归范围

历史消息。

### Codex Prompt

```text
实现 Session Agent Switcher，切换成功后重新读取 Session binding；运行中 409 显示明确原因。
```

---

## TA4：Vertical Slice 6：Session Switch E2E

**状态：Completed**

**目标**：证明已有 Session 切 Agent 后历史不变、后续使用新版本。

**前置依赖**：T67、TA3

**建议涉及文件/模块**：full E2E

### 实现范围

Session V1 对话 → switch V2 → 继续对话 → replay V1 checkpoint。

### 测试用例

- [x] 旧消息不变
- [x] 新 run V2
- [x] trace version V2
- [x] 旧 checkpoint replay V1

### 验收标准

Session 生命周期版本一致性获得端到端证据。

### 回归范围

Legacy / Replay。

### Codex Prompt

```text
实现 Session Switch E2E，必须验证旧 Checkpoint Replay 仍使用历史 AgentVersion。
```

---


# Phase 11：回归、性能与灰度

## TB0：Legacy 全量回归

**状态：Completed**

**目标**：证明新架构未破坏主体功能。

**前置依赖**：T62、TA4

**建议涉及文件/模块**：existing full test suite

### 实现范围

feature flag off + historical NULL binding 两种模式运行。

### 测试用例

- [x] Chat
- [x] SSE
- [x] Timeline
- [x] Context
- [x] Message Edit
- [x] Checkpoint
- [x] Trace
- [x] Replay

### 验收标准

所有 Legacy 测试通过。

### 回归范围

全主体功能。

### Codex Prompt

```text
运行 Legacy 全量回归；不允许通过修改旧测试期望值隐藏行为回归。
```

---

## TB1：Workflow Builder 前端 E2E 全量

**状态：In Progress**

**目标**：验证完整绘图能力，不允许半成品。

**前置依赖**：T93

**建议涉及文件/模块**：frontend e2e

### 实现范围

覆盖 create/move/delete/duplicate node、create/delete/reconnect edge、全部 config、save/load/validate/publish/test-run。

### 测试用例

- [ ] 全交互矩阵
- [ ] 刷新恢复
- [ ] 错误定位
- [ ] unsaved protection

### 验收标准

Workflow Builder 达到完整可用。

### 实施备注

当前已有 `studio/tests/workflow_workbench.test.mjs`、`studio/tests/workflow_builder.test.mjs`、`npm --prefix studio run test:web-acceptance` 和 Chromium smoke 覆盖 Workflow Builder 关键交互；但 `TB1` 要求的是 Workflow Builder 前端 E2E 全量矩阵，尚未以浏览器 E2E 形式完整覆盖 create/move/delete/duplicate/reconnect/config/save/load/validate/publish/test-run，因此保守保持 `In Progress`。

### 回归范围

无。

### Codex Prompt

```text
建立 Workflow Builder E2E 矩阵，覆盖所有正式交互，不允许只测静态渲染。
```

---

## TB2：Graph 规模与性能测试

**状态：Completed**

**目标**：避免画布和 compile 在中等规模图上退化。

**前置依赖**：T37、T80

**建议涉及文件/模块**：performance tests

### 实现范围

建议基线：100 nodes/150 edges；compile、load、canvas interaction 记录指标。

### 测试用例

- [x] 100 node compile
- [x] 100 node load
- [x] pan/zoom smoke
- [x] serialization

### 验收标准

给出明确基线，不要求过早极限优化。

### 回归范围

无。

### Codex Prompt

```text
增加中等规模 Graph 性能测试，记录 compile/load/serialize/canvas 交互基线。
```

---

## TB3：Feature Flag 与灰度发布

**状态：Completed**

**目标**：新 Workflow Runtime 可随时关闭。

**前置依赖**：T62、TB0

**建议涉及文件/模块**：settings/deployment docs

### 实现范围

`WORKFLOW_AGENT_RUNTIME_ENABLED=false` 默认兼容；开发/测试环境逐步开启。

### 测试用例

- [x] flag off 全 legacy
- [x] flag on 仅有 binding 使用 workflow

### 验收标准

可安全回滚。

### 回归范围

无。

### Codex Prompt

```text
实现并验证 Workflow Runtime Feature Flag，默认保证历史 Session 行为。
```

---


# 8. 强制 Vertical Slice 门禁

以下 Slice 不是“可选测试”，而是进入下一阶段前的强制门禁。

## Slice A：动态 LLM Graph

```text
JSON Manifest
  ↓
Validate
  ↓
NodeExecutor Registry
  ↓
StateGraph
  ↓
add_node / add_edge
  ↓
compile()
  ↓
Fake LLM
  ↓
Output
```

对应：`T43`

未通过时，禁止把“动态 Agent 已可执行”标记完成。

## Slice B：Tool Graph

```text
START → LLM → Tool → Output → END
```

对应：`T46`

## Slice C：Condition Graph

```text
START
 ↓
LLM
 ↓
Condition
 ├─ true  → LLM-A
 └─ false → LLM-B
 ↓
Output
 ↓
END
```

对应：`T49`

## Slice D：完整 Workflow Builder

```text
Create Graph
 → Configure
 → Save
 → Reload
 → Validate
 → Publish
 → Test Run
 → Runtime Node Highlight
```

对应：`T93`

## Slice E：Session 选择 Agent

```text
Publish AgentVersion
 → New Session
 → Select AgentVersion
 → Chat
 → WorkflowAgentRuntime
 → SSE Response
```

对应：`T63`

## Slice F：Session 切换 Agent

```text
Session V1
 → Chat
 → Switch V2
 → Chat
 → Replay old V1 Checkpoint
```

对应：`TA4`

---

# 9. 推荐实际实施顺序

严格按下面顺序推进，不建议前后端大面积并行失控：

```text
T00 → T01 → T02 → T03

T10 → T11 → T12 → T13

T20 → T21 → T22 → T23
T30 → T31 → T32 → T33 → T34 → T35 → T36 → T37 → T38 → T39

T40 → T41 → T42 → T43
T44 → T45 → T46
T47 → T49
T48
T4A

T50 → T51 → T52 → T53 → T54

T60 → T61 → T62 → T63
T64 → T65 → T66 → T67

T70 → T71 → T72
T80 → T81 → T82 → T83
T84 → T85 → T86 → T87 → T88 → T89
T8A → T8B → T8C → T8D → T8E

T90 → T91 → T92 → T93

TA0 → TA1 → TA2 → TA3 → TA4

TB0 → TB1 → TB2 → TB3
```

---

# 10. 第一轮最小实施建议

如果希望尽快验证方案正确性，而不是先做大量 UI：

```text
T00-T03
T10-T13
T20-T23
T30-T39
T40-T43
T50
```

目标只做：

```text
START → LLM → OUTPUT → END
```

完成后必须能够证明：

1. 页面/测试产生的 JSON Manifest 可以被 Python 动态加载；
2. 不生成 `.py` 文件；
3. 不需要重新编译 Python 工程；
4. 不需要重启后端；
5. `StateGraph` 可在运行时 `add_node/add_edge/compile()`；
6. 同一进程可以同时运行 AgentVersion V1 和 V2；
7. Fake LLM 输出能够经过 RuntimeEvent 返回最终 Output。

只有这条链路通过，才继续 Tool / Condition / 完整前端。

---

# 11. 完成定义（Definition of Done）

任一 Task 标记 `Completed` 前必须满足：

- [ ] Task 的 Unit Test 通过；
- [ ] Task 定义的 Integration Test 通过；
- [ ] 涉及前端交互时，至少有组件测试或 E2E；
- [ ] 涉及 API 时，Request/Response Contract Test 通过；
- [ ] 涉及 Manifest 时，Round Trip Test 通过；
- [ ] 涉及 Node 时，Schema + Validator + Executor + Frontend Config 完整；
- [ ] 涉及 Graph Assembly 时，必须实际调用 LangGraph `compile()`；
- [ ] Legacy 回归范围无新增失败；
- [ ] 状态从 `Pending/In Progress/Blocked` 更新为 `Completed` 前保留测试证据；
- [ ] 不允许用“后续任务会补齐”作为当前 Task 的验收理由。

---

# 12. 明确禁止的半成品实现

以下情况不能标记为完成：

1. Canvas 能显示 Node，但不能编辑 Node Config。
2. 能创建 Edge，但不能删除或 reconnect。
3. 能 Save，但 Refresh 后不能 Load 回原图。
4. 后端支持 Node，但前端 Node Library 没有。
5. 前端有 Node，但 NodeExecutor 不存在。
6. LLM Node 只是一个展示方框，没有真实 Fake/Real Provider 执行链。
7. Validate 只返回 `"invalid graph"`。
8. Publish 实际只是 Save Draft。
9. Test Run 通过创建正式 Session 偷跑。
10. Session 绑定正在变化的 Draft。
11. Session 切换 Agent 后重写历史 Message。
12. Replay 使用 Session 当前 AgentVersion 而忽略 Checkpoint 历史版本。
13. WorkflowRuntime 失败后静默切 Legacy 并重复执行有副作用 Tool。
14. 为了实现自定义 Node 直接使用 `eval()` / `exec()`。
15. 页面直接生成 Python 源码作为 Agent 实现。

---

# 13. 最终验收场景

最终发布前至少通过以下完整场景：

### 场景 1：LLM Agent
```text
Builder 创建 START→LLM→OUTPUT→END
→ Save
→ Reload
→ Validate
→ Publish V1
→ Test Run
→ 返回 Fake/Real LLM 输出
```

### 场景 2：Tool Agent
```text
LLM → Tool → Output
```
ToolCall、ToolResult、Trace 均完整。

### 场景 3：Condition
true/false 两条分支均可测试并高亮真实执行路径。

### 场景 4：Router
至少 3 route 可配置、保存、恢复、执行。

### 场景 5：新 Session 选择 Agent
Published AgentVersion 可选，Draft 不可选。

### 场景 6：已有 Session 切换 Agent
切换只影响后续 Run，历史完全保留。

### 场景 7：Replay 版本一致性
V1 Checkpoint 在 Session 已切 V2 后仍使用 V1 Replay。

### 场景 8：Legacy 回归
历史 Session 无 `agent_version_id` 时仍完整使用原 ChatOrchestrator 行为。

---

# 14. 计划维护规则

- 实施时只允许更新 Task 的 **状态、测试证据、必要的实施备注**；
- 若技术实现发生变化，应先更新对应 Task 的 Contract/测试，再改代码；
- 新增 Node 类型必须复制完整闭环：
  `Schema → Validator → Executor → Frontend Node → Config → Round Trip → Integration Test`；
- 禁止为了追进度把一个失败的 Vertical Slice 拆成“以后再修”。
