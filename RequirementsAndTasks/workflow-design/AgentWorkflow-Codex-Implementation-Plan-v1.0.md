# Agent Workflow V2 — Codex 实施执行文档

> 版本：v1.0  
> 输入设计：`AgentWorkflow-Frontend-Technical-Design-v1.0.md` + `AgentWorkflow-Backend-Technical-Design-v1.0.md`  
> 目标：以**纵向功能切片**的方式完成 Agent Workflow V2。每个任务应尽量独立，完成后必须具备可运行、可测试、可验证的前后端闭环。  
> 执行对象：Codex / 编码 Agent  
> 实施原则：V2 独立实现，Legacy 仅冻结与兼容，不在 V2 Runtime 中混入旧 `PromptNode / LlmNode / ToolNode` 分支。

--- 

# 1. 文档使用方式

## 1.1 任务状态约定

每个任务使用以下状态之一：

```text
[ ] TODO       未开始
[-] DOING      进行中
[x] DONE       已完成
[!] BLOCKED    阻塞
```

Codex 每完成一个任务后，必须：

1. 运行该任务要求的自动化测试。
2. 完成该任务的手工/接口验收。
3. 将本文件中对应任务状态由 `[ ]` 更新为 `[x]`。
4. 在任务下的“实施记录”中填写：
   - 主要修改文件；
   - 实际实现说明；
   - 测试结果；
   - 未完成项/风险。
5. 不得提前将未验收任务标记为完成。

---

## 1.2 Codex 总体执行规则

所有任务均遵守以下规则：

1. **一次只执行当前任务。**除非当前任务明确要求，不要提前实现后续任务。
2. **优先最小实现。**不要为了“未来可能需要”引入复杂框架、通用 DSL 或 DAG Scheduler。
3. **保持 V1/V2 边界。**V2 Runner 不得出现针对旧 `PromptNode / LlmNode / ToolNode` 的执行分支。
4. **Graph 只负责控制流。**LLM 与 ToolCall 属于 Agent Node 内部隐式 Runtime。
5. **Tool 不参与画布连线。**前端画布不得重新引入 Tool Node。
6. **Condition 不调用 LLM。**Condition 必须基于结构化 NodeResult 确定性判断。
7. **不向普通用户暴露 `$state.xxx`。**数据引用统一通过结构化 `ValueRef / NodeOutputRef`。
8. **Node Instruction 是 transient context。**默认不得永久写入 MessageHistory。
9. **ToolCall / ToolResult 必须成对写入 MessageHistory。**二者通过 `ToolCallId` 关联。
10. **Message / NodeResult / Artifact 分离。**Condition 只读取 NodeResult.Data。
11. **先测试后收口。**修改核心 Runtime 时优先添加/调整测试，再完成实现。
12. **保持现有业务不受影响。**在 V2 尚未接管旧 Workflow 前，不破坏 Legacy Workflow 的读取和执行。
13. **避免无关重构。**禁止在某个任务中顺手大规模格式化、重命名或删除无关旧代码。
14. 所有后端异步调用必须透传 `CancellationToken`。
15. 所有运行日志至少包含可获取的：`WorkflowId / WorkflowVersion / RunId / NodeId`。

---

# 2. V2 目标架构

```text
Workflow Graph
    │
    ├── Agent Node
    ├── Condition Node
    ├── Workflow Ref Node
    └── End Node
         │
         ▼
WorkflowRunner
    │
    ├── AgentNodeExecutor
    │      └── LLM → Tool → LLM → ... → NodeResult
    │
    ├── ConditionNodeExecutor
    ├── WorkflowRefNodeExecutor
    └── EndNodeExecutor

Runtime State
    ├── Messages
    ├── NodeResults
    ├── Artifacts
    └── ExecutionEvents
```

V2 前端只暴露：

```text
Agent
Condition
Workflow
End
```

不得将下面内容作为普通画布节点：

```text
Prompt
LLM
Tool
Output Parser
Tool Result
```

---

# 3. 实施阶段与任务总览

| ID | 状态 | 任务 | 前后端闭环 | 依赖 |
|---|---|---|---|---|
| T00 | [x] | V2 隔离骨架与版本入口 | 是 | 无 |
| T01 | [x] | Workflow V2 Definition、Draft 读取与保存 | 是 | T00 |
| T02 | [x] | V2 Graph Canvas 与基础拓扑校验 | 是 | T01 |
| T03 | [x] | Agent Node 基础配置闭环 | 是 | T02 |
| T04 | [x] | Output Schema Builder 与后端 Schema 校验 | 是 | T03 |
| T05 | [x] | Tool Registry、Tool Selector 与 Tool Policy | 是 | T03 |
| T06 | [x] | Publish / Version 冻结闭环 | 是 | T01、T04、T05 |
| T07 | [x] | 最小 Workflow Run：单 Agent Node 无 Tool | 是 | T06 |
| T08 | [x] | 隐式 Agent Tool Loop 与运行详情 | 是 | T05、T07 |
| T09 | [x] | Condition Node 与 Schema Driven 分支 | 是 | T04、T07 |
| T10 | [-] | End Node 与 FinalResult 绑定 | 是 | T07、T09 |
| T11 | [ ] | Artifact 全链路与附件结果展示 | 是 | T08、T10 |
| T12 | [ ] | Workflow Ref Node / 子 Workflow | 是 | T06、T10 |
| T13 | [ ] | Schema Registry、ValueRef 与失效引用校验 | 是 | T09、T12 |
| T14 | [ ] | Runtime Event + SSE 实时执行轨迹 | 是 | T07、T08 |
| T15 | [ ] | Cancel、Runtime Limits 与失败态闭环 | 是 | T14 |
| T16 | [ ] | Run 持久化、历史详情与调试页面 | 是 | T14、T15 |
| T17 | [ ] | 编辑器 Simple / Advanced 模式与最终 UX 收口 | 是 | T13、T16 |
| T18 | [ ] | V2 端到端样例 Workflow 与回归测试 | 是 | T10～T17 |
| T19 | [ ] | Legacy 迁移入口与废弃代码清理准备 | 是 | T18 |
| T20 | [ ] | Legacy 清理与 V2 默认化 | 是 | T19，且满足清理前置条件 |

> 说明：T20 不应在 V2 稳定之前执行。若当前系统仍存在必须运行的 V1 Workflow，则 T20 保持 TODO。

---

# 4. 详细任务

## T00 — V2 隔离骨架与版本入口

**状态：** [x] DONE  
**优先级：** P0  
**依赖：** 无

### 目标

为 Agent Workflow V2 建立与 Legacy 隔离的最小目录、模型入口和路由机制，不改变现有 V1 行为。

### 用户可见结果

- 新建 Workflow 时可明确创建 V2 Workflow。
- 打开已有 Legacy Workflow 时仍按旧编辑器/旧执行方式工作。
- V2 页面暂时可为空壳，但不能误用 Legacy Node。

### 后端实施

1. 为 Workflow Definition 增加明确的版本/模型标识，推荐：

```json
{
  "schemaVersion": 2
}
```

2. 建立 V2 独立目录，例如：

```text
/WorkflowV2
  /Domain
  /Runtime
  /Application
  /Infrastructure
  /Api
```

或在现有 Workflow 模块内建立明确的 `V2` 子目录。
3. 引入 `IWorkflowRunner` V2 接口或 V2 实现入口。
4. 保留 Legacy Runner，不把旧 Node 执行逻辑复制进 V2 Runner。
5. API 读取 Workflow 时返回 `schemaVersion`。
6. 新建 V2 Workflow 时默认写入 `schemaVersion = 2`。

### 前端实施

1. Workflow 路由根据 `schemaVersion` 选择编辑器：
   - V1 → Legacy Editor；
   - V2 → Agent Workflow Editor。
2. 新建 Workflow 默认创建 V2。
3. V2 Node 面板只注册：Agent / Condition / Workflow / End。
4. Legacy 页面可显示只读提示“Legacy Workflow”，但不得强制迁移。

### 测试用例

#### 后端

- 创建新 Workflow，返回 `schemaVersion = 2`。
- 读取旧 Workflow，若无字段，按 V1 兼容处理。
- V1 调用仍进入 Legacy Runner。
- V2 调用进入 V2 Runner 入口。

#### 前端

- 打开 V1 Workflow 使用旧编辑器。
- 打开 V2 Workflow 使用新编辑器。
- V2 NodeList 中不存在 Prompt / LLM / Tool 节点。

### 验收标准

- V1 功能无回归。
- V2 与 V1 代码边界清晰。
- 不存在 `if (node.Type == Prompt/Llm/Tool)` 之类的 V2 Runtime 兼容分支。

### Codex 执行 Prompt

```text
实现 Agent Workflow V2 的隔离骨架和 schemaVersion 入口。
要求：
1. 不删除、不重写现有 Legacy Workflow 行为。
2. 新建 Workflow 默认 schemaVersion=2。
3. V1/V2 分别进入 Legacy Editor/Runner 与 V2 Editor/Runner。
4. V2 前端只暴露 Agent、Condition、Workflow、End 四类节点。
5. 添加前后端测试验证版本路由。
6. 只完成 T00，不提前实现 Agent Loop、Tool、Condition 等后续能力。
7. 完成并验证后，将 T00 状态更新为 DONE，并填写实施记录。
```

### 实施记录

- 主要修改文件：
  - `backend/src/contextos/api/routes/workflows.py`
  - `backend/src/contextos/api/server.py`
  - `backend/src/contextos/workflow_v2/domain/definitions.py`
  - `backend/src/contextos/workflow_v2/runtime/router.py`
  - `backend/src/contextos/workflow_v2/runtime/runner.py`
  - `backend/tests/unit/test_workflow_v2_entry.py`
  - `backend/tests/integration/test_http_runtime_host.py`
  - `studio/src/api/agents.js`
  - `studio/src/features/workflow-v2/WorkflowV2Builder.js`
  - `studio/src/pages/Workflow/index.js`
  - `studio/src/pages/Workflow/WorkflowV2Workbench.js`
  - `studio/tests/workflow_api_client.test.mjs`
  - `studio/tests/workflow_v2_entry.test.mjs`
- 实现说明：
  - 新增独立 `contextos.workflow_v2` 后端包，包含 V2 definition 默认 `schemaVersion=2`、V1 缺省兼容识别、V1/V2 runtime router 和 V2 runner 入口类型门禁。
  - 新增 `POST /api/workflows` 最小 HTTP 入口，新建 Workflow 默认返回 V2 空 definition；未实现 Draft 保存、发布或运行逻辑，保留给 T01+。
  - 新增前端 V2 builder / V2 workbench 空壳，V2 node library 仅暴露 `agent`、`condition`、`workflow`、`end`；`schemaVersion=2` 路由到 V2 editor，缺省仍走 Legacy editor。
  - 新增 API client `createWorkflow()` 映射 `/workflows`，旧 `/templates`、`/agents` 能力保持不变。
- 测试结果：
  - RED：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry` 因缺少 V2 模块失败；`node --test tests/workflow_v2_entry.test.mjs` 因缺少 V2 前端入口失败；HTTP 单测因 `/api/workflows` 404 失败；API client 单测因 `createWorkflow` 缺失失败。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry` 通过，4 tests。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_creates_workflow_v2_definition_by_default` 通过，1 test。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works` 通过，1 test。
  - GREEN：`node --test tests/workflow_api_client.test.mjs tests/workflow_builder.test.mjs tests/workflow_node_registry.test.mjs tests/workflow_v2_entry.test.mjs` 通过，13 tests。
  - GREEN：`npm run lint` 通过；`node --check src/features/workflow-v2/WorkflowV2Builder.js` 和 `node --check src/pages/Workflow/WorkflowV2Workbench.js` 通过。
  - GREEN：`npm run build` 初次在沙箱内因 `studio/dist/index.html` EPERM 失败；经用户授权的非沙箱重跑通过，成功生成 `studio/dist`。
- 风险/遗留：
  - 用户请求中提到 `svgAgentWorkflow-Requirements-v1.0.md`，目录中不存在该文件；Txx 任务清单位于本实施执行文档，`AgentWorkflow-Requirements-v1.0.md` 仅为需求设计正文。
  - T00 只完成隔离骨架与版本入口；Draft 持久化、revision、完整 `GET/PUT /api/workflows/{id}` 留给 T01。

---

## T01 — Workflow V2 Definition、Draft 读取与保存

**状态：** [x] DONE  
**优先级：** P0  
**依赖：** T00

### 目标

建立 V2 Workflow Definition 的前后端统一 Contract，并实现 Draft 的创建、读取、编辑、保存。

### 后端实施

实现/补齐：

```csharp
WorkflowDefinition
WorkflowNode
WorkflowEdge
WorkflowRuntimeLimits
ToolRef
```

其中 Node 类型限定：

```csharp
Agent
Condition
Workflow
End
```

提供：

```text
POST /api/workflows
GET  /api/workflows/{id}
PUT  /api/workflows/{id}/draft
```

Draft 可先整体 JSON 存储，避免一开始过度拆表。

必须支持 revision 或等价并发字段，避免两个编辑器静默覆盖。

### 前端实施

1. 建立与后端一致的 `WorkflowDefinitionDto` 联合类型。
2. 建立 Zustand 编辑状态：

```ts
workflowId
nodes
edges
selectedNodeId
dirty
validationErrors
revision
```

3. 实现：
   - 打开 Draft；
   - 本地修改；
   - 500～1000ms debounce 自动保存；
   - revision 冲突提示。
4. 前端不得自行维护另一套不兼容 DTO。

### 测试用例

- 新建 V2 Definition 后可重新读取。
- 修改 nodes/edges 后保存并重新打开，内容一致。
- revision 不匹配时后端拒绝覆盖。
- 前端 dirty → 自动保存 → dirty=false。
- DTO round-trip 不丢未知必要字段。

### 验收标准

能够完成：

```text
Create V2 Workflow
→ Open Editor
→ 修改 Draft
→ 自动保存
→ 刷新页面
→ 内容完整恢复
```

### Codex 执行 Prompt

```text
实现 T01：Agent Workflow V2 Definition 和 Draft 前后端闭环。
重点：统一 WorkflowDefinitionDto、Node/Edge 联合类型、Draft 保存读取、revision 并发控制、前端 Zustand 编辑状态和 debounce 自动保存。
保持实现简单，Definition MVP 可整体 JSON 持久化。
不得加入旧 Prompt/Llm/Tool Node。
添加后端 API 测试和前端 store/API 测试。
完成后更新 T01 状态和实施记录。
```

### 实施记录

- 主要修改文件：
  - `backend/src/contextos/workflow_v2/application/definitions.py`
  - `backend/src/contextos/workflow_v2/application/__init__.py`
  - `backend/src/contextos/workflow_v2/domain/definitions.py`
  - `backend/src/contextos/api/routes/workflows.py`
  - `backend/src/contextos/api/server.py`
  - `backend/src/contextos/runtime/persistence/json_store.py`
  - `backend/tests/unit/test_workflow_v2_definition_service.py`
  - `backend/tests/integration/test_http_runtime_host.py`
  - `studio/src/api/agents.js`
  - `studio/src/features/workflow-v2/WorkflowV2DraftStore.js`
  - `studio/tests/workflow_api_client.test.mjs`
  - `studio/tests/workflow_v2_draft_store.test.mjs`
- 实现说明：
  - 新增 `WorkflowV2DefinitionService`，以整体 JSON draft 保存 V2 Definition，支持 `revision` 整数递增和 stale revision 冲突保护。
  - `JsonRuntimeStore` 新增 `workflow_v2_definitions` collection，支持 V2 draft 跨进程/重启恢复。
  - `POST /api/workflows` 改为写入 V2 definition service；新增 `GET /api/workflows/{id}` 与 `PUT /api/workflows/{id}/draft`，冲突返回 409 `workflow.revision_conflict`。
  - 前端 API client 新增 `fetchWorkflow()` / `saveWorkflowDraft()`。
  - 新增轻量 `WorkflowV2DraftStore`，覆盖打开 Draft、本地修改、dirty 状态、debounced autosave、手动 flush、保存后 revision 刷新。当前项目未使用 Zustand，故沿用现有前端模块的闭包式 store 模式，避免引入新依赖。
- 测试结果：
  - RED：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_definition_service ...test_host_round_trips_workflow_v2_draft_with_revision_conflict` 因缺少 service/API 与 GET 路由失败。
  - RED：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_draft_store.test.mjs` 因缺少 `fetchWorkflow` / `WorkflowV2DraftStore` 失败。
  - RED：新增跨重启持久化测试后，临时撤掉 `workflow_v2_definitions` collection，测试因 reload 后找不到 workflow 失败。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_definition_service tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_workflow_v2_draft_with_revision_conflict` 通过，4 tests。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry tests.unit.test_workflow_v2_definition_service tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_creates_workflow_v2_definition_by_default tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_workflow_v2_draft_with_revision_conflict tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works` 通过，10 tests。
  - GREEN：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_entry.test.mjs tests/workflow_v2_draft_store.test.mjs tests/workflow_builder.test.mjs` 通过，11 tests。
  - GREEN：`node --check src/features/workflow-v2/WorkflowV2Builder.js`、`node --check src/features/workflow-v2/WorkflowV2DraftStore.js`、`node --check src/pages/Workflow/WorkflowV2Workbench.js` 均通过。
  - GREEN：`npm run lint` 通过；`npm run build` 经授权非沙箱执行通过并生成 `studio/dist`。
- 风险/遗留：
  - T01 未实现完整 Canvas 编辑和拓扑校验，留给 T02。
  - `WorkflowV2DraftStore` 暂未接入浏览器主入口的完整新建按钮流程；已有 API client 与 store/API 测试覆盖前端调用边界，T02/T03 会继续补 UI 闭环。

---

## T02 — V2 Graph Canvas 与基础拓扑校验

**状态：** [x] DONE  
**优先级：** P0  
**依赖：** T01

### 目标

实现 V2 可编辑 Graph Canvas，并让前后端都能识别基础非法拓扑。

### 后端实施

实现 `IWorkflowDefinitionValidator` 第一阶段能力：

- Node ID 唯一；
- Edge Source/Target 存在；
- Start 合法；
- 至少存在一个 End；
- End 无出边；
- Start 无入边；
- 禁止自连接；
- Agent / Workflow 默认 success 出边数量规则；
- Condition branch 目标唯一性基础检查；
- 循环暂时只告警或按配置处理，不实现复杂 DAG Scheduler。

提供：

```text
POST /api/workflows/{id}/validate
```

### 前端实施

1. 使用 React Flow / XYFlow 建立 Canvas。
2. Node Palette 只包含四类 V2 Node。
3. 支持：
   - 添加；
   - 删除；
   - 拖动；
   - 连线；
   - 选中；
   - 基础 Inspector。
4. 在连线时即时阻止明显非法连接。
5. Validation Panel 显示前端快速校验和后端校验结果。

### 测试用例

- End 无法创建出边。
- Start 无法创建入边。
- 自连接被禁止。
- 引用不存在 Node 的 Edge 后端校验失败。
- 删除 Node 后关联 Edge 同步删除或标记失效。
- 保存后重新打开布局和连线不丢失。

### 验收标准

用户可通过 UI 构建最小图：

```text
Start → Agent → End
```

并完成保存与校验。

### Codex 执行 Prompt

```text
实现 T02：V2 Graph Canvas 与基础拓扑校验。
前端使用现有 React Flow/XYFlow 技术栈，后端扩展 WorkflowDefinitionValidator。
只实现基础图编辑和拓扑约束，不实现 Node 的高级配置和运行逻辑。
前后端都必须校验，最终以后端结果为准。
添加对应测试并更新 T02 状态。
```

### 实施记录

- 主要修改文件：
  - `backend/src/contextos/workflow_v2/application/validation.py`
  - `backend/src/contextos/workflow_v2/application/__init__.py`
  - `backend/src/contextos/api/routes/workflows.py`
  - `backend/src/contextos/api/server.py`
  - `backend/tests/unit/test_workflow_v2_validator.py`
  - `backend/tests/integration/test_http_runtime_host.py`
  - `studio/src/api/agents.js`
  - `studio/src/features/workflow-v2/WorkflowV2Builder.js`
  - `studio/src/pages/Workflow/WorkflowV2Workbench.js`
  - `studio/tests/workflow_api_client.test.mjs`
  - `studio/tests/workflow_v2_builder.test.mjs`
  - `studio/tests/workflow_v2_workbench.test.mjs`
- 实现说明：
  - 新增 `WorkflowV2DefinitionValidator`，覆盖 V2 基础拓扑校验：Node ID 唯一、V2 节点类型、Edge source/target 存在、至少一个 End、End 无出边、START 无入边、自连接禁止、Agent/Workflow 单 success 出边、Condition branch handle 唯一。
  - 新增 `POST /api/workflows/{id}/validate`，默认验证当前 draft；请求 body 非空时验证请求定义但不保存。
  - 扩展 `WorkflowV2Builder`，支持节点添加、位置更新、连线、删除节点同步删除关联边、本地基础连接校验和 view-model 序列化。
  - 扩展 `WorkflowV2Workbench`，提供 V2 node palette、canvas nodes/edges、选中态、基础 inspector、前端快速校验和后端 validation panel。
  - 扩展前端 API client `validateWorkflow()` 映射 `/workflows/{id}/validate`。
- 测试结果：
  - RED：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_validator` 因缺少 validator 失败；`node --test tests/workflow_v2_builder.test.mjs` 因缺少位置/连线能力失败。
  - RED：`$env:PYTHONPATH='src'; python -m unittest tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_validates_workflow_v2_topology` 因 `/api/workflows/{id}/validate` 404 失败。
  - RED：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_workbench.test.mjs` 因缺少 `validateWorkflow()` 和 V2 workbench 编辑/校验方法失败。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_validator` 通过，3 tests。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_validates_workflow_v2_topology` 通过，1 test。
  - GREEN：`node --test tests/workflow_v2_builder.test.mjs` 通过，2 tests。
  - GREEN：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_workbench.test.mjs` 通过，5 tests。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry tests.unit.test_workflow_v2_definition_service tests.unit.test_workflow_v2_validator tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_creates_workflow_v2_definition_by_default tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_workflow_v2_draft_with_revision_conflict tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_validates_workflow_v2_topology tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works` 通过，14 tests。
  - GREEN：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_entry.test.mjs tests/workflow_v2_draft_store.test.mjs tests/workflow_v2_builder.test.mjs tests/workflow_v2_workbench.test.mjs tests/workflow_builder.test.mjs tests/workflow_node_registry.test.mjs` 通过，18 tests。
  - GREEN：`python -m compileall -q src/contextos/workflow_v2 src/contextos/api/routes/workflows.py` 初次因沙箱写 `__pycache__` 权限失败；经授权非沙箱重跑通过。
  - GREEN：`node --check src/features/workflow-v2/WorkflowV2Builder.js`、`node --check src/features/workflow-v2/WorkflowV2DraftStore.js`、`node --check src/pages/Workflow/WorkflowV2Workbench.js` 均通过。
  - GREEN：`npm run lint` 通过；`npm run build` 经授权非沙箱执行通过并生成 `studio/dist`。
- 风险/遗留：
  - 文档建议“使用 React Flow / XYFlow”，但当前 Studio 实际没有 React/XYFlow 依赖，现有 Workflow 也是纯 JS view-model/canvas 模式。为避免引入新框架并保持最小改动，本任务按现有架构实现同等基础画布能力；若后续决定迁移到 React/XYFlow，应单独立项。
  - T02 仅实现基础拓扑和 V2 canvas view-model；Agent Node 高级配置、Schema Builder、Tool Policy、运行时执行留给后续 T03+。

---

## T03 — Agent Node 基础配置闭环

**状态：** [x] DONE  
**优先级：** P0  
**依赖：** T02

### 目标

让 Agent Node 成为“一个阶段的 Agent Execution Policy”，而不是一次 LLM 调用。

### 后端实施

实现 `AgentNode`：

```csharp
Instruction
OutputSchema
ContextPolicy
ToolPolicy
RetryPolicy
Visibility
```

本任务中 OutputSchema / ToolPolicy 可先以基础结构存在，详细 UI 分别由 T04/T05 完成。

校验：

- Instruction 不能为空；
- Node Type 必须为 Agent；
- Visibility 合法；
- Retry 数值非负；
- 不存在 PromptTemplate/MessageRole 等旧节点字段依赖。

### 前端实施

Inspector 分组：

```text
Basic
Goal / Instruction
Context
Output
Tools
Retry
```

本任务至少完成：

- Name；
- Description；
- Visibility；
- Goal / Instruction；
- Context Sources 的基础开关；
- Retry / Timeout 高级区基础表单。

Node Card 只显示高层摘要，不展示完整 Instruction。

### 测试用例

- 新建 Agent Node 可编辑 Instruction。
- 保存刷新后配置完整恢复。
- 空 Instruction 发布/校验失败。
- Visibility、Retry、Timeout 前后端 round-trip。

### 验收标准

Agent Node 已可作为独立阶段被完整编辑和保存，且 UI 不暴露“Prompt Node / LLM Node”概念。

### Codex 执行 Prompt

```text
实现 T03：Agent Node 基础配置前后端闭环。
Agent Node 表示阶段目标/规则，不表示一次 LLM 调用。
完成 Domain/DTO/Validator/Inspector/NodeCard/保存读取和测试。
Output Schema 与 Tool Selector 只保留扩展位置，不提前完成 T04/T05。
不得引入 $state.xxx 或旧 Prompt/Llm Node 兼容字段。
完成后更新 T03 状态。
```

### 实施记录

- 主要修改文件：
  - `backend/src/contextos/workflow_v2/domain/agent_node.py`
  - `backend/src/contextos/workflow_v2/application/validation.py`
  - `backend/tests/unit/test_workflow_v2_validator.py`
  - `backend/tests/integration/test_http_runtime_host.py`
  - `studio/src/features/workflow-v2/WorkflowV2Builder.js`
  - `studio/src/pages/Workflow/WorkflowV2Workbench.js`
  - `studio/tests/workflow_v2_builder.test.mjs`
  - `studio/tests/workflow_v2_workbench.test.mjs`
- 实现说明：
  - 新增 Agent Node domain 边界常量，定义合法 `visibility` 为 `hidden` / `visible` / `auto`，并集中列出禁止进入 V2 Agent Node 的旧 Prompt/LLM 字段。
  - 扩展后端 `WorkflowV2DefinitionValidator`，校验 Agent Node `instruction` 非空、`visibility` 合法、`retryPolicy.schemaRetryCount` / `nodeRetryCount` / `timeoutMs` 非负，并拒绝 `promptTemplate` / `messageRole` 等旧节点字段。
  - 扩展前端 `WorkflowV2Builder`，支持 `updateAgentNodeConfig`，并对嵌套 config 做深拷贝，保证保存/刷新恢复时配置不被外部 view 修改污染。
  - 扩展前端 `WorkflowV2Workbench`，提供 Agent Inspector 分组 `Basic` / `Goal / Instruction` / `Context` / `Output` / `Tools` / `Retry`，支持编辑选中 Agent Node 配置、通过 Draft API 保存，并在 Node Card 仅展示 title、Agent 类型、Output 字段与 Tools 数量等高层摘要，不展示完整 Instruction。
  - Output Schema 与 ToolPolicy 仅保留 `outputSchema` / `toolPolicy` 扩展位置，未提前实现 T04/T05 的 Schema Builder 或 Tool Selector。
- 测试结果：
  - RED：新增后端测试曾失败于空 Instruction 仍 valid；新增前端测试曾失败于 `updateAgentNodeConfig` / `updateSelectedAgentConfig` 缺失。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_validator tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_and_validates_workflow_v2_agent_node_config` 通过，6 tests OK。
  - 回归：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry tests.unit.test_workflow_v2_definition_service tests.unit.test_workflow_v2_validator tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_creates_workflow_v2_definition_by_default tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_workflow_v2_draft_with_revision_conflict tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_validates_workflow_v2_topology tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_and_validates_workflow_v2_agent_node_config tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works` 通过，17 tests OK。
  - 前端：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_entry.test.mjs tests/workflow_v2_draft_store.test.mjs tests/workflow_v2_builder.test.mjs tests/workflow_v2_workbench.test.mjs tests/workflow_builder.test.mjs tests/workflow_node_registry.test.mjs` 通过，21 tests OK。
  - 语法/构建：`python -m compileall -q src/contextos/workflow_v2 src/contextos/api/routes/workflows.py` 通过；`node --check src/features/workflow-v2/WorkflowV2Builder.js`、`node --check src/pages/Workflow/WorkflowV2Workbench.js` 通过；`npm run lint` 通过；`npm run build` 通过。
- 风险/遗留：
  - 当前 Inspector 仍是纯 JS view-model，不引入 React/XYFlow；延续 T02 的最小改动策略。
  - `OutputSchema` 与 `ToolPolicy` 仅作为配置结构保留，详细编辑和策略校验留给 T04/T05。
  - 旧拓扑集成测试的 Agent fixture 已补充 instruction，使其继续只验证拓扑错误顺序。

---

## T04 — Output Schema Builder 与后端 Schema 校验

**状态：** [x] DONE  
**优先级：** P0  
**依赖：** T03

### 目标

为 Agent Node 提供结构化 Output Schema，使后续 Condition / Workflow Mapping 可以基于字段而非自然语言或 `$state` 工作。

### 后端实施

1. 统一 JSON Schema 表示。
2. Definition Validator 校验 AgentNode.OutputSchema 合法性。
3. 提供 Schema 解析/校验服务供 Runtime 后续复用。
4. 限制 MVP 支持类型：
   - string；
   - number；
   - integer；
   - boolean；
   - enum；
   - object；
   - array（可仅基础支持）。
5. 返回明确错误路径。

### 前端实施

实现可视化 Schema Builder：

```text
Field | Type | Required | Description
```

支持：

- 添加/删除字段；
- required；
- enum options；
- object 子字段；
- 基础 array item；
- 与 JSON Schema 双向转换。

高级模式可提供 JSON 编辑器；若项目未集成 Monaco，可先用普通 JSON textarea，不强制引入重依赖。

### 测试用例

- string/number/boolean/enum schema 正确生成。
- required 字段正确生成。
- 非法 schema 后端返回精确错误。
- Builder → JSON → Builder round-trip。
- 修改 schema 后 Draft 保存成功。

### 验收标准

用户无需手写 `$state`，即可定义：

```json
{
  "category": "technical | business | other",
  "summary": "string",
  "confidence": "number"
}
```

### Codex 执行 Prompt

```text
实现 T04：Agent Node Output Schema Builder 与后端 JSON Schema 校验。
优先支持 MVP 常用类型，保证前后端 schema round-trip。
错误必须能够定位到字段。
不要实现 Condition；只提供 Condition 后续可消费的稳定 Schema Contract。
添加 Schema Builder 单测、DTO round-trip 测试、后端 Schema Validator 测试。
完成后更新 T04。
```

### 实施记录

- 主要修改文件：
  - `backend/src/contextos/workflow_v2/application/json_schema.py`
  - `backend/src/contextos/workflow_v2/application/validation.py`
  - `backend/tests/unit/test_workflow_v2_json_schema.py`
  - `backend/tests/unit/test_workflow_v2_validator.py`
  - `studio/src/features/workflow-v2/WorkflowV2SchemaBuilder.js`
  - `studio/src/pages/Workflow/WorkflowV2Workbench.js`
  - `studio/tests/workflow_v2_schema_builder.test.mjs`
  - `studio/tests/workflow_v2_workbench.test.mjs`
- 实现说明：
  - 新增 `WorkflowV2JsonSchemaService`，支持 MVP JSON Schema 子集：`string`、`number`、`integer`、`boolean`、`object`、`array`，并通过 `enum` keyword 表示枚举字段。
  - 后端 schema 校验覆盖 object `properties` / `required`、enum 非空、array `items`、递归子字段，并返回 `$` 开头的精确错误路径。
  - 后端 `WorkflowV2DefinitionValidator` 已校验 Agent Node `config.outputSchema`，并把 schema 错误映射到 `nodes[index].config.outputSchema...` 字段路径。
  - `WorkflowV2JsonSchemaService.validate_value` 提供后续 Runtime 可复用的基础值校验入口，覆盖 required、类型和 enum 值约束。
  - 新增前端 `WorkflowV2SchemaBuilder`，支持字段添加/删除、required、enum options、object 子字段、array item、JSON Schema 生成，以及 JSON Schema → Builder view 的 round-trip。
  - `WorkflowV2Workbench` 选中 Agent Node 时暴露 `schemaBuilder` view，支持向 Output Schema 添加字段并随 Draft 保存；Node Card 输出摘要会显示 schema 字段名。
- 测试结果：
  - RED：后端新增测试曾失败于缺少 `contextos.workflow_v2.application.json_schema` 模块、validator 未校验 `outputSchema`；前端新增测试曾失败于缺少 `WorkflowV2SchemaBuilder.js` 和 `workbench.addOutputSchemaField`。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_json_schema tests.unit.test_workflow_v2_validator` 通过，9 tests OK。
  - 前端 T04：`node --test tests/workflow_v2_schema_builder.test.mjs tests/workflow_v2_workbench.test.mjs` 通过，8 tests passed。
  - 回归：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry tests.unit.test_workflow_v2_definition_service tests.unit.test_workflow_v2_json_schema tests.unit.test_workflow_v2_validator tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_creates_workflow_v2_definition_by_default tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_workflow_v2_draft_with_revision_conflict tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_validates_workflow_v2_topology tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_and_validates_workflow_v2_agent_node_config tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works` 通过，21 tests OK。
  - 前端回归：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_entry.test.mjs tests/workflow_v2_draft_store.test.mjs tests/workflow_v2_builder.test.mjs tests/workflow_v2_schema_builder.test.mjs tests/workflow_v2_workbench.test.mjs tests/workflow_builder.test.mjs tests/workflow_node_registry.test.mjs` 通过，25 tests passed。
  - 语法/构建：`python -m compileall -q src/contextos/workflow_v2 src/contextos/api/routes/workflows.py` 通过；`node --check src/features/workflow-v2/WorkflowV2Builder.js`、`node --check src/features/workflow-v2/WorkflowV2SchemaBuilder.js`、`node --check src/pages/Workflow/WorkflowV2Workbench.js` 通过；`npm run lint` 通过；`npm run build` 通过。
- 风险/遗留：
  - 未引入 Monaco；高级 JSON 编辑器仍以 Schema Builder 的 JSON Schema 双向转换能力作为基础，后续如需要 DOM textarea 可在真实 UI 层补。
  - 未实现 Condition；本任务仅提供后续 Condition 可消费的稳定 `outputSchema.properties` contract。
  - Schema 校验是 MVP 子集，不实现完整 JSON Schema 标准。

---

## T05 — Tool Registry、Tool Selector 与 Tool Policy

**状态：** [x] DONE  
**优先级：** P0  
**依赖：** T03

### 目标

把 Tool 定义为 Workflow/Agent Capability，而不是 Graph Node，并完成工具选择与权限模型。

### 后端实施

实现：

```csharp
IToolRegistry
ToolDefinition
ToolRef
NodeToolPolicy
ToolPolicyMode: Auto / Required / Disabled
```

ToolDefinition 包含：

```text
Name
Description
InputSchema
OutputSchema(optional)
```

提供工具列表 API，例如：

```text
GET /api/workflow-tools
```

Definition Validator 检查：

- Allowed Tool 必须存在；
- Required Tool 必须属于 Allowed Tool；
- Disabled 不允许配置 Allowed/Required；
- Node Tool 必须属于 Workflow Tool Registry。

### 前端实施

Agent Node Inspector：

```text
Tool Policy: Auto / Required / Disabled
Allowed Tools: multi-select
Required Tools: multi-select/selector
```

Workflow 级别增加 Tool Registry 配置入口。

**画布中不得出现 Tool Node。**

### 测试用例

- Tool 列表正确加载。
- Auto 可选多个工具。
- Disabled 清空并禁止工具选择。
- Required Tool 不在 Allowed 时前后端均提示。
- 删除 Workflow Tool 后引用它的 Agent Node 标记 Validation Error。

### 验收标准

用户能够表达：

```text
这个阶段可使用 Search + KnowledgeBase，且必须调用 Search 至少一次。
```

但无需把 Tool 拖到画布。

### Codex 执行 Prompt

```text
实现 T05：Tool Registry、Workflow Tool Registry、Agent Node Tool Selector 和 ToolPolicy。
Tool 是 Agent Capability，不允许加入 Graph Node 类型或连线。
完成前后端 Contract、API、校验、UI 和测试。
本任务不执行 Tool，只完成定义与配置；实际 Tool Loop 在 T08。
完成后更新 T05。
```

### 实施记录

- 主要修改文件：
  - `backend/src/contextos/api/routes/workflow_tools.py`
  - `backend/src/contextos/api/routes/workflows.py`
  - `backend/src/contextos/api/server.py`
  - `backend/src/contextos/workflow_v2/application/validation.py`
  - `backend/tests/unit/test_workflow_v2_tool_policy.py`
  - `backend/tests/integration/test_http_runtime_host.py`
  - `studio/src/api/agents.js`
  - `studio/src/features/workflow-v2/WorkflowV2ToolPolicyEditor.js`
  - `studio/src/pages/Workflow/WorkflowV2Workbench.js`
  - `studio/tests/workflow_api_client.test.mjs`
  - `studio/tests/workflow_v2_tool_policy_editor.test.mjs`
  - `studio/tests/workflow_v2_workbench.test.mjs`
- 实现说明：
  - 新增 `GET /api/workflow-tools`，复用现有 `ToolRegistry`，返回 V2 Workflow Builder 需要的 `id`、`name`、`description`、`inputSchema`、`outputSchema`。
  - `WorkflowV2DefinitionValidator` 支持注入现有 `ToolRegistry`，并校验 workflow-level `tools` 与 Agent Node `toolPolicy.mode` / `allowedTools` / `requiredTools`。
  - 后端覆盖 `auto` / `required` / `disabled` 策略约束：Allowed/Required Tool 必须存在且属于 Workflow Tool Registry，Required 必须属于 Allowed，Disabled 不允许保留工具选择。
  - 新增前端 `WorkflowV2ToolPolicyEditor`，支持加载 catalog、设置 Workflow Tool Registry、Auto 多选、Required 选择、Disabled 清空并阻止选择，以及删除 workflow tool 后产生字段级错误。
  - `WorkflowV2Workbench` 暴露 workflow-level tool registry view，选中 Agent Node 时暴露 tool selector view，并将配置保存到 Draft；`nodeLibrary` 仍只包含 `agent`、`condition`、`workflow`、`end`，不引入 Tool Node。
- 测试结果：
  - RED：后端新增测试曾失败于缺少 `workflow_tools` route、`WorkflowV2DefinitionValidator(tool_registry=...)` 不支持、HTTP `/api/workflow-tools` 404；前端新增测试曾失败于缺少 `api.listWorkflowTools`、`WorkflowV2ToolPolicyEditor.js`、`workbench.loadWorkflowTools`。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_tool_policy tests.unit.test_workflow_v2_validator tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_lists_workflow_tools_over_v2_catalog_api` 通过，11 tests OK。
  - 前端 T05：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_tool_policy_editor.test.mjs tests/workflow_v2_workbench.test.mjs` 通过，13 tests passed。
  - 回归：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry tests.unit.test_workflow_v2_definition_service tests.unit.test_workflow_v2_json_schema tests.unit.test_workflow_v2_validator tests.unit.test_workflow_v2_tool_policy tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_creates_workflow_v2_definition_by_default tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_workflow_v2_draft_with_revision_conflict tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_validates_workflow_v2_topology tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_and_validates_workflow_v2_agent_node_config tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_lists_workflow_tools_over_v2_catalog_api tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works` 通过，26 tests OK。
  - 前端回归：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_entry.test.mjs tests/workflow_v2_draft_store.test.mjs tests/workflow_v2_builder.test.mjs tests/workflow_v2_schema_builder.test.mjs tests/workflow_v2_tool_policy_editor.test.mjs tests/workflow_v2_workbench.test.mjs tests/workflow_builder.test.mjs tests/workflow_node_registry.test.mjs` 通过，30 tests passed。
  - 语法/构建：`python -m compileall -q src/contextos/workflow_v2 src/contextos/api/routes/workflows.py src/contextos/api/routes/workflow_tools.py` 通过；`node --check src/features/workflow-v2/WorkflowV2ToolPolicyEditor.js`、`node --check src/pages/Workflow/WorkflowV2Workbench.js`、`node --check src/api/agents.js` 通过；`npm run lint` 通过；`npm run build` 通过。
- 风险/遗留：
  - 本任务只完成 Tool 定义、选择和权限模型，不执行 Tool；Agent 内部 Tool Loop 留给 T08。
  - Workflow Tool Registry 当前以顶层 `tools: string[]` 保存工具 ID；validator 同时兼容对象形 ToolRef 的 `id/toolId/tool_id` 读取。
  - 前端仍为 view-model 接入，没有引入额外 UI 框架或真正的 DOM multi-select 控件。

---

## T06 — Publish / Version 冻结闭环

**状态：** [x] DONE  
**优先级：** P0  
**依赖：** T01、T04、T05

### 目标

建立 Draft → Validate → Publish → Immutable Version 的稳定发布流程，运行时只能绑定明确版本。

### 后端实施

实现：

```text
POST /api/workflows/{id}/validate
POST /api/workflows/{id}/publish
GET  /api/workflows/{id}/versions
```

规则：

- Publish 前必须通过后端完整校验。
- Published Version 不可原地修改。
- 每次 Publish 生成新 version。
- Runtime 不读取可变 Draft。

### 前端实施

Toolbar 增加：

- Save 状态；
- Validate；
- Publish；
- 当前 Draft revision；
- Published version 列表。

Publish 失败时 Validation Panel 直接定位 Node / 字段。

### 测试用例

- 非法 Definition 无法 Publish。
- 第一次 Publish 得到 v1，第二次得到 v2。
- 修改 Draft 不影响 v1。
- 打开版本详情内容稳定。
- 前端 Publish 成功后刷新版本列表。

### 验收标准

能够稳定完成：

```text
编辑 Draft → Validate → Publish v1 → 继续编辑 Draft → Publish v2
```

### Codex 执行 Prompt

```text
实现 T06：V2 Workflow Draft/Published Version 闭环。
Published Version 必须冻结，运行只能绑定明确版本。
完成 API、持久化、前端 Publish/Version UI 和测试。
不要实现运行时执行逻辑。
完成后更新 T06。
```

### 实施记录

- 主要修改文件：
  - `backend/src/contextos/workflow_v2/application/definitions.py`
  - `backend/src/contextos/api/routes/workflows.py`
  - `backend/src/contextos/api/server.py`
  - `backend/tests/unit/test_workflow_v2_definition_service.py`
  - `backend/tests/integration/test_http_runtime_host.py`
  - `studio/src/api/agents.js`
  - `studio/src/pages/Workflow/WorkflowV2Workbench.js`
  - `studio/tests/workflow_api_client.test.mjs`
  - `studio/tests/workflow_v2_workbench.test.mjs`
- 实现说明：
  - `WorkflowV2DefinitionService` 在 draft record 中追加保存 immutable published versions；draft 可继续编辑，published version 只能通过再次 publish 生成新版本。
  - 新增 `WorkflowV2PublishValidationError` 和 version not found 错误，publish 前强制执行后端完整 validator。
  - 新增后端 API：`POST /api/workflows/{id}/publish`、`GET /api/workflows/{id}/versions`、`GET /api/workflows/{id}/versions/{version}`，后者为 T07 运行时明确绑定版本提供读取入口。
  - 前端 API client 增加 `publishWorkflow`、`listWorkflowVersions`、`fetchWorkflowVersion`。
  - `WorkflowV2Workbench` 增加 toolbar view-model：save status、Validate/Publish actions、Draft revision、published versions；Publish 成功后刷新版本列表，Publish validation failure 写入 Validation Panel。
- 测试结果：
  - RED：后端新增测试曾失败于 `WorkflowV2DefinitionService.publish/get_version/list_versions` 缺失、publish API 404；前端新增测试曾失败于 `api.publishWorkflow` 和 `workbench.publishWorkflow` 缺失。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_definition_service tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_publishes_workflow_v2_versions_as_immutable_snapshots` 通过，7 tests OK。
  - 前端 T06：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_workbench.test.mjs` 通过，11 tests passed。
  - 回归：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry tests.unit.test_workflow_v2_definition_service tests.unit.test_workflow_v2_json_schema tests.unit.test_workflow_v2_validator tests.unit.test_workflow_v2_tool_policy tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_creates_workflow_v2_definition_by_default tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_workflow_v2_draft_with_revision_conflict tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_validates_workflow_v2_topology tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_and_validates_workflow_v2_agent_node_config tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_lists_workflow_tools_over_v2_catalog_api tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_publishes_workflow_v2_versions_as_immutable_snapshots tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works` 通过，30 tests OK。
  - 前端回归：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_entry.test.mjs tests/workflow_v2_draft_store.test.mjs tests/workflow_v2_builder.test.mjs tests/workflow_v2_schema_builder.test.mjs tests/workflow_v2_tool_policy_editor.test.mjs tests/workflow_v2_workbench.test.mjs tests/workflow_builder.test.mjs tests/workflow_node_registry.test.mjs` 通过，32 tests passed。
  - 语法/构建：`python -m compileall -q src/contextos/workflow_v2 src/contextos/api/routes/workflows.py src/contextos/api/routes/workflow_tools.py` 通过；`node --check src/pages/Workflow/WorkflowV2Workbench.js`、`node --check src/api/agents.js` 通过；`npm run lint` 通过；`npm run build` 通过。
- 风险/遗留：
  - Published version 暂与 draft record 同集合保存，满足当前 JSON store 最小持久化；后续如需独立索引可单独演进。
  - Runtime 执行逻辑尚未实现；T06 只保证运行时后续可以通过明确 workflow/version 获取 frozen definition。

---

## T07 — 最小 Workflow Run：单 Agent Node 无 Tool

**状态：** [x] DONE  
**优先级：** P0  
**依赖：** T06

### 目标

跑通第一个真正的 V2 Workflow：`Start → Agent → End`，Agent Node 内只调用一次 LLM，不允许 Tool。

### 后端实施

实现最小运行时：

```text
WorkflowRunner
WorkflowRunState
INodeExecutor
AgentNodeExecutor
ContextBuilder
OutputParser
NodeResult
EndNodeExecutor(先默认输出)
```

AgentNode 执行规则：

1. Build Context；
2. Persistent MessageHistory + transient Node Instruction + Output Schema；
3. 调用 LLM；
4. 无 ToolCall；
5. 解析 Structured Output；
6. Schema Validate；
7. 保存 NodeResult；
8. 进入 End。

Node Instruction 不写入 Persistent Messages。

API：

```text
POST /api/workflows/{id}/runs
GET  /api/workflow-runs/{runId}
```

### 前端实施

1. Toolbar 增加 Run。
2. Run 前确保 Draft 已发布或选择明确 Version。
3. 支持输入基础 user message/data。
4. 显示 Run 状态：Running / Succeeded / Failed。
5. Canvas 显示 Node Pending / Running / Succeeded / Failed 的最终状态即可；实时 SSE 在 T14。
6. 展示最终 assistant message / structured data 基础结果。

### 测试用例

#### 后端

- 单 Agent Node 无 Tool 成功。
- Node Instruction 未被持久化到 Messages。
- LLM 输出满足 schema → NodeResult.Data 正确。
- LLM 输出不满足 schema → 当前任务可先失败或使用已有 MaxSchemaRetry 基础实现，但行为必须明确测试。
- Run 绑定 Published Version。

#### 前端

- 可发起 Run。
- 成功状态及结果展示。
- 失败状态及错误展示。

### 验收标准

真实完成一次：

```text
User Input
→ Agent Node
→ LLM
→ Structured NodeResult
→ End
→ Final Result
```

### Codex 执行 Prompt

```text
实现 T07：最小 Agent Workflow Runtime，先只支持 Start→Agent→End 且 ToolPolicy=Disabled。
实现 WorkflowRunner、RunState、AgentNodeExecutor、ContextBuilder、OutputParser、NodeResult、Run API 和最小前端 Run UI。
必须确保 Node Instruction 是 transient，不写入 Persistent MessageHistory。
优先 TDD：覆盖单节点成功、schema 解析失败、版本绑定。
不要提前实现 Tool Loop、Condition、SSE。
完成后更新 T07。
```

### 实施记录

- 主要修改文件：
  - `backend/src/contextos/workflow_v2/runtime/runs.py`
  - `backend/src/contextos/api/routes/workflow_runs.py`
  - `backend/src/contextos/api/server.py`
  - `backend/tests/unit/test_workflow_v2_runtime.py`
  - `backend/tests/integration/test_http_runtime_host.py`
  - `studio/src/api/agents.js`
  - `studio/src/pages/Workflow/WorkflowV2Workbench.js`
  - `studio/tests/workflow_api_client.test.mjs`
  - `studio/tests/workflow_v2_workbench.test.mjs`
- 实现说明：
  - 新增 `WorkflowV2RunService` 与内存 `InMemoryWorkflowV2RunStore`，最小支持按 Published Version 执行 `Start -> Agent -> End` 的单 Agent Workflow。
  - Agent Node 当前仅支持 `toolPolicy.mode = disabled`；如配置 Tool Policy，会得到明确 failed run，避免提前实现 T08 Tool Loop。
  - Context 构建将 Node Instruction、Output Schema 作为 provider messages 的 transient context 传入 LLM；未写入持久 MessageHistory。
  - LLM 输出按 JSON structured output 解析，并复用 `WorkflowV2JsonSchemaService.validate_value` 校验后写入 `NodeResult.Data` 和最终 `output`。
  - 新增 Run API：`POST /api/workflows/{id}/runs` 与 `GET /api/workflow-runs/{runId}`，运行时强制绑定明确 `version`。
  - 前端 API client 增加 `startWorkflowRun` / `fetchWorkflowRun`；`WorkflowV2Workbench` Toolbar 增加 `run` action，并展示 `runPanel` 与 Canvas 节点最终运行状态。
- 测试结果：
  - RED：新增后端测试最初失败于缺少 `contextos.workflow_v2.runtime.runs`、Run API 404；新增前端测试最初失败于缺少 `api.startWorkflowRun` / `api.fetchWorkflowRun` / `workbench.startRun`。
  - T07 定向后端：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_runtime tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_runs_workflow_v2_single_agent_published_version_without_persisting_instruction` 通过，4 tests OK。
  - T07 定向前端：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_workbench.test.mjs` 通过，13 tests passed。
  - T00-T07 后端回归：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry tests.unit.test_workflow_v2_definition_service tests.unit.test_workflow_v2_json_schema tests.unit.test_workflow_v2_validator tests.unit.test_workflow_v2_tool_policy tests.unit.test_workflow_v2_runtime tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_creates_workflow_v2_definition_by_default tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_workflow_v2_draft_with_revision_conflict tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_validates_workflow_v2_topology tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_and_validates_workflow_v2_agent_node_config tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_lists_workflow_tools_over_v2_catalog_api tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_publishes_workflow_v2_versions_as_immutable_snapshots tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_runs_workflow_v2_single_agent_published_version_without_persisting_instruction tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works` 通过，34 tests OK。
  - T00-T07 前端回归：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_entry.test.mjs tests/workflow_v2_draft_store.test.mjs tests/workflow_v2_builder.test.mjs tests/workflow_v2_schema_builder.test.mjs tests/workflow_v2_tool_policy_editor.test.mjs tests/workflow_v2_workbench.test.mjs tests/workflow_builder.test.mjs tests/workflow_node_registry.test.mjs` 通过，34 tests passed。
  - 语法/构建：`python -m compileall -q src/contextos/workflow_v2 src/contextos/api/routes/workflows.py src/contextos/api/routes/workflow_tools.py src/contextos/api/routes/workflow_runs.py` 通过；`node --check src/api/agents.js`、`node --check src/features/workflow-v2/WorkflowV2ToolPolicyEditor.js`、`node --check src/features/workflow-v2/WorkflowV2SchemaBuilder.js`、`node --check src/pages/Workflow/WorkflowV2Workbench.js` 通过；`npm run lint` 通过；`npm run build` 通过。
- 风险/遗留：
  - Run Store 当前为内存实现；历史详情与持久化留给 T16。
  - 当前只支持单 Agent、无 Tool、无 Condition、无 SSE 的最小运行路径；Tool Loop、Condition 分支、实时轨迹分别留给 T08、T09、T14。
  - T07 约束 LLM 输出为 JSON object；更复杂的重试、修复和多格式输出策略后续按对应任务扩展。

---

## T08 — 隐式 Agent Tool Loop 与运行详情

**状态：** [x] DONE  
**优先级：** P0  
**依赖：** T05、T07

### 目标

完成 Agent Node 内部隐式 `LLM → Tool → LLM` Loop，同时保持 Tool 不出现在 Graph 上。

### 后端实施

实现：

```csharp
IToolExecutor
ToolCall
ToolResult
ToolExecutionContext
```

AgentNodeExecutor 循环：

```text
LLM
├─ ToolCall → 权限校验 → 参数校验 → Tool → ToolResult → LLM
└─ Final Output → Schema Validate → NodeResult
```

要求：

- ToolCall / ToolResult 按顺序写入 Messages；
- 必须通过 ToolCallId 配对；
- Tool Permission、Arguments Schema、Timeout、Cancellation 生效；
- Required Tool 未调用时不能完成 Node；
- Tool Error 转换为统一 WorkflowError；
- 多次 ToolCall 可串行实现，MVP 不要求复杂并行。

### 前端实施

Agent Node Execution Detail 展示：

```text
LLM Call #1
Tool Call: Search
Tool Result
LLM Call #2
Schema Validation
Node Result
```

不得将 ToolCall 转成 Canvas Node。

### 测试用例

- 无 ToolCall 直接成功。
- 一次 ToolCall 后成功。
- 多次 ToolCall 后成功。
- Tool 不允许 → `TOOL_NOT_ALLOWED`。
- Tool 参数非法 → `TOOL_ARGUMENT_INVALID`。
- Required Tool 未调用 → 自动纠正后成功或达到限制失败。
- ToolCall/ToolResult Message 严格配对。

### 验收标准

一个 Agent Node 可以自主完成多轮工具调用，但 Workflow Graph 仍只看到一个 Agent Node。

### Codex 执行 Prompt

```text
实现 T08：Agent Node 内隐式 Tool Loop。
Tool 不参与 Graph 连线。AgentNodeExecutor 内处理 LLM→Tool→LLM 循环。
ToolCall/ToolResult 必须通过 ToolCallId 严格配对并写入 MessageHistory。
实现 Auto/Required/Disabled 权限检查、参数校验、错误模型和前端 Node Execution Detail。
优先补齐 AgentNodeExecutor TDD 测试。
完成后更新 T08。
```

### 实施记录

- 主要修改文件：
  - `backend/src/contextos/workflow_v2/runtime/runs.py`
  - `backend/src/contextos/api/server.py`
  - `backend/tests/unit/test_workflow_v2_runtime.py`
  - `backend/tests/integration/test_http_runtime_host.py`
  - `studio/src/pages/Workflow/WorkflowV2Workbench.js`
  - `studio/tests/workflow_v2_workbench.test.mjs`
- 实现说明：
  - 在 T07 `WorkflowV2RunService` 上最小扩展隐式 Agent Tool Loop，支持 LLM 返回 `toolCalls` 后串行执行 Tool，再把 ToolResult 回填 MessageHistory 并继续调用 LLM。
  - `ToolRegistry` 用于权限与参数 schema 校验，`ToolExecutorRegistry` 用于真实工具执行；HTTP demo services 已将现有 `context.echo` registry/executor 注入 V2 RunService。
  - 支持 `disabled` / `auto` / `required` Tool Policy：Disabled 禁止工具调用；Auto 仅允许 `allowedTools`；Required 在最终输出前检查 `requiredTools` 已调用，否则失败。
  - Tool 参数复用 `WorkflowV2JsonSchemaService.validate_value` 校验；非法参数返回 `TOOL_ARGUMENT_INVALID`，未授权工具返回 `TOOL_NOT_ALLOWED`。
  - ToolCall / ToolResult 作为 run `messages` 成对返回，通过 `toolCallId` 关联；工具执行失败也会写入 failed ToolResult 并转换为统一错误码。
  - Run 返回 `executionDetails.nodes[].steps`，前端 `runPanel` 展示 LLM Call、Tool Call、Tool Result、Schema Validation、Node Result；Canvas 仍只显示业务 Node，不新增 Tool Node。
  - 支持 tool timeout 的最小运行时钩子（`toolPolicy.timeoutSeconds` 或 node `config.timeoutSeconds`）；正式取消 API 和运行限制闭环仍按 T15 扩展。
- 测试结果：
  - RED：后端新增 T08 测试最初失败于 `WorkflowV2RunService.__init__()` 不接受 `tool_registry`，HTTP 集成测试返回 failed，前端测试失败于 `runPanel.executionDetails` 缺失。
  - GREEN：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_runtime` 通过，8 tests OK。
  - HTTP T08：`$env:PYTHONPATH='src'; python -m unittest tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_runs_workflow_v2_agent_tool_loop_with_execution_details` 通过，1 test OK。
  - 前端 T08/API：`node --test tests/workflow_v2_workbench.test.mjs tests/workflow_api_client.test.mjs` 通过，14 tests passed。
  - T00-T08 后端回归：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry tests.unit.test_workflow_v2_definition_service tests.unit.test_workflow_v2_json_schema tests.unit.test_workflow_v2_validator tests.unit.test_workflow_v2_tool_policy tests.unit.test_workflow_v2_runtime tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_creates_workflow_v2_definition_by_default tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_workflow_v2_draft_with_revision_conflict tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_validates_workflow_v2_topology tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_and_validates_workflow_v2_agent_node_config tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_lists_workflow_tools_over_v2_catalog_api tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_publishes_workflow_v2_versions_as_immutable_snapshots tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_runs_workflow_v2_single_agent_published_version_without_persisting_instruction tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_runs_workflow_v2_agent_tool_loop_with_execution_details tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works` 通过，40 tests OK。
  - T00-T08 前端回归：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_entry.test.mjs tests/workflow_v2_draft_store.test.mjs tests/workflow_v2_builder.test.mjs tests/workflow_v2_schema_builder.test.mjs tests/workflow_v2_tool_policy_editor.test.mjs tests/workflow_v2_workbench.test.mjs tests/workflow_builder.test.mjs tests/workflow_node_registry.test.mjs` 通过，35 tests passed。
  - 语法/构建：`python -m compileall -q src/contextos/workflow_v2 src/contextos/api/routes/workflows.py src/contextos/api/routes/workflow_tools.py src/contextos/api/routes/workflow_runs.py src/contextos/api/server.py` 通过；`node --check src/api/agents.js`、`node --check src/features/workflow-v2/WorkflowV2ToolPolicyEditor.js`、`node --check src/pages/Workflow/WorkflowV2Workbench.js` 通过；`npm run lint` 通过；`npm run build` 通过。
- 风险/遗留：
  - 当前 Tool Loop 的 LLM tool call 输入使用 V2 内部 JSON contract（`toolCalls` / `tool_calls`），尚未接入 provider 原生 tool-calling adapter。
  - 多工具调用按串行执行；未实现并行调度，符合 MVP 边界。
  - 正式 Run 取消、全局 Runtime Limits、持久化历史和实时 SSE 仍留给 T15/T16/T14。

---

## T09 — Condition Node 与 Schema Driven 分支

**状态：** [x] DONE  
**优先级：** P0  
**依赖：** T04、T07

### 目标

Condition 使用上游 Agent Node 的结构化 Output Schema 进行确定性路由，不调用 LLM、不解析自然语言 Message。

### 后端实施

实现：

```csharp
ConditionNode
ConditionBranch
ConditionExpression
ConditionOperator
NodeOutputValueRef
IValueResolver
ConditionNodeExecutor
```

MVP Operator：

```text
Equals
NotEquals
GreaterThan
GreaterThanOrEqual
LessThan
LessThanOrEqual
Contains
StartsWith
EndsWith
Exists
NotExists
In
NotIn
IsEmpty
IsNotEmpty
```

规则：

- Source 必须是 NodeResult.Data；
- 找不到字段时给明确错误或走显式 default 策略；
- 多 Branch 按定义顺序评估，命中后停止；
- 无命中走 Default。

### 前端实施

Condition Inspector：

```text
Source Node
Field
Operator
Value
Target Node
Default Target
```

Field 由 Source Node Output Schema 自动生成。
Operator 根据字段类型动态过滤。
每个 Branch 使用独立 Handle。

### 测试用例

- Enum Equals。
- Number >=。
- String Contains。
- Missing Field。
- 多分支首个命中。
- Default Branch。
- Condition 全程不调用 LLM。

### 验收标准

可构建并运行：

```text
Agent(category)
  ↓
Condition
  ├─ technical → Agent A
  ├─ business  → Agent B
  └─ default   → Agent C
```

### Codex 执行 Prompt

```text
实现 T09：Schema Driven Condition Node 前后端闭环。
Condition 只能读取 NodeResult.Data，不能调用 LLM、不能解析 assistant message。
实现 ValueRef、ConditionOperator、ConditionExecutor、分支 UI、类型约束和测试。
普通模式禁止手写 $state.xxx。
完成后更新 T09。
```

### 实施记录

- 主要修改文件：
  - `backend/src/contextos/workflow_v2/runtime/runs.py`
  - `backend/src/contextos/workflow_v2/application/validation.py`
  - `backend/tests/unit/test_workflow_v2_condition_runtime.py`
  - `backend/tests/unit/test_workflow_v2_validator.py`
  - `backend/tests/integration/test_http_runtime_host.py`
  - `studio/src/features/workflow-v2/WorkflowV2Builder.js`
  - `studio/src/pages/Workflow/WorkflowV2Workbench.js`
  - `studio/tests/workflow_v2_workbench.test.mjs`
- 实现说明：
  - 将 V2 Run 从单 Agent 专用路径扩展为最小图游标：从 `START` 沿 edge 执行 `agent` / `condition` / `end`，仍不引入通用 DAG Scheduler。
  - Agent 执行逻辑复用 T07/T08 的 LLM、Tool Loop、Output Schema 校验能力；Condition 本身不调用 LLM，只读取已完成 Node 的 `NodeResult.Data`。
  - 新增 Condition 分支求值，支持 MVP operator：`equals`、`notEquals`、`greaterThan`、`greaterThanOrEqual`、`lessThan`、`lessThanOrEqual`、`contains`、`startsWith`、`endsWith`、`exists`、`notExists`、`in`、`notIn`、`isEmpty`、`isNotEmpty`。
  - 多 branch 按定义顺序评估，首个命中后通过对应 `sourceHandle` edge 路由；无命中走 `defaultTarget` 或 `default` handle。
  - 缺失运行时字段返回 `CONDITION_FIELD_NOT_FOUND`，并保留 condition node failed result。
  - Definition Validator 增加 Condition branch source 校验：source 必须是 Agent node，path 必须存在于该 Agent `outputSchema.properties`。
  - 前端 `WorkflowV2Builder` 增加 `updateConditionNodeConfig`；`WorkflowV2Workbench` 选中 Condition 时提供 `conditionInspector`，从上游 Agent outputSchema 派生 field 选项并按字段类型提供 operator 选项。
- 测试结果：
  - RED：新增后端 condition runtime 测试最初失败于 `workflow.unsupported_graph`；新增 validator 测试最初返回 valid；新增前端工作台测试最初失败于缺少 `conditionInspector`。
  - T09 后端运行：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_condition_runtime` 通过，4 tests OK。
  - T09 validator：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_validator` 通过，7 tests OK。
  - T09 HTTP：`$env:PYTHONPATH='src'; python -m unittest tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_runs_workflow_v2_condition_branch_from_agent_output_data` 通过，1 test OK。
  - T09 前端：`node --test tests/workflow_v2_workbench.test.mjs` 通过，12 tests passed。
  - T00-T09 后端回归：`$env:PYTHONPATH='src'; python -m unittest tests.unit.test_workflow_v2_entry tests.unit.test_workflow_v2_definition_service tests.unit.test_workflow_v2_json_schema tests.unit.test_workflow_v2_validator tests.unit.test_workflow_v2_tool_policy tests.unit.test_workflow_v2_runtime tests.unit.test_workflow_v2_condition_runtime tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_creates_workflow_v2_definition_by_default tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_workflow_v2_draft_with_revision_conflict tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_validates_workflow_v2_topology tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_round_trips_and_validates_workflow_v2_agent_node_config tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_lists_workflow_tools_over_v2_catalog_api tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_publishes_workflow_v2_versions_as_immutable_snapshots tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_runs_workflow_v2_single_agent_published_version_without_persisting_instruction tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_runs_workflow_v2_agent_tool_loop_with_execution_details tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_host_runs_workflow_v2_condition_branch_from_agent_output_data tests.integration.test_http_runtime_host.HttpRuntimeHostTests.test_bound_session_chat_uses_workflow_runtime_and_legacy_still_works` 通过，46 tests OK。
  - T00-T09 前端回归：`node --test tests/workflow_api_client.test.mjs tests/workflow_v2_entry.test.mjs tests/workflow_v2_draft_store.test.mjs tests/workflow_v2_builder.test.mjs tests/workflow_v2_schema_builder.test.mjs tests/workflow_v2_tool_policy_editor.test.mjs tests/workflow_v2_workbench.test.mjs tests/workflow_builder.test.mjs tests/workflow_node_registry.test.mjs` 通过，36 tests passed。
  - 语法/构建：`python -m compileall -q src/contextos/workflow_v2 src/contextos/api/routes/workflows.py src/contextos/api/routes/workflow_tools.py src/contextos/api/routes/workflow_runs.py src/contextos/api/server.py` 通过；`node --check src/features/workflow-v2/WorkflowV2Builder.js`、`node --check src/pages/Workflow/WorkflowV2Workbench.js` 通过；`npm run lint` 通过；`npm run build` 通过。
- 风险/遗留：
  - Condition 当前按 edge `sourceHandle` 与 `defaultTarget` 做最小路由，不实现复杂表达式组合或脚本执行。
  - 前端仍是 view-model 级 Inspector，真实 DOM 控件和更完整的 Simple/Advanced UX 收口留给 T17。
  - Workflow 最终输出仍沿用最后一个业务节点输出；明确 End Node FinalResult 绑定留给 T10。

---

## T10 — End Node 与 FinalResult 绑定

**状态：** [-] DOING  
**优先级：** P0  
**依赖：** T07、T09

### 目标

明确 Workflow 的最终输出，不依赖 `message_history[-1]`，同时提供简单默认行为。

### 后端实施

实现：

```csharp
EndNode
FinalOutputBinding
IFinalResultBuilder
WorkflowRunResult
```

默认规则：

```text
message   = last visible assistant message
artifacts = all visible artifacts
data      = null
```

支持高级绑定：

- 指定 Node Message；
- 指定 NodeResult.Data；
- Artifact binding 在 T11 完整实现。

### 前端实施

End Node Inspector：

```text
Final Message
Artifacts
Structured Data
```

默认值使用：

```text
Last visible assistant message
All visible artifacts
None
```

高级模式可以从上游 NodeResult 选择 Data 来源。

### 测试用例

- 默认最后 visible assistant message。
- Hidden message 不作为默认最终消息。
- 指定 NodeResult.Data 正确输出。
- End 无出边。
- 不使用 `message_history[-1]` 作为唯一实现逻辑。

### 验收标准

不同分支最终都能稳定形成统一 `WorkflowRunResult`。

### Codex 执行 Prompt

```text
实现 T10：End Node 和 FinalResultBuilder。
默认输出 last visible assistant message + all visible artifacts + data=null；高级配置允许绑定结构化 NodeResult.Data。
最终结果不能简单等同 message_history[-1]。
完成前后端 Inspector、Runtime、API DTO 和测试。
完成后更新 T10。
```

### 实施记录

- 主要修改文件：
- 实现说明：
- 测试结果：
- 风险/遗留：

---

## T11 — Artifact 全链路与附件结果展示

**状态：** [ ] TODO  
**优先级：** P1  
**依赖：** T08、T10

### 目标

让 Tool/Agent 生成的文件、图片等 Artifact 具有独立生命周期，并通过 Ref 与 Message / NodeResult / FinalResult 关联。

### 后端实施

实现：

```csharp
IArtifactStore
ArtifactRef
```

ArtifactRef 至少包含：

```text
Id
Name
MimeType
CreatedByNodeId
Visible
```

规则：

- Message 只存 ArtifactRef，不存二进制；
- NodeResult.Artifacts 保存引用；
- WorkflowRunState.Artifacts 聚合；
- ToolResult 可返回 Artifacts；
- FinalResult 默认聚合全部 Visible Artifact；
- 下载必须通过 ArtifactId，不向前端暴露真实物理路径。

增加 API：

```text
GET /api/workflow-runs/{runId}/artifacts
GET /api/workflow-artifacts/{artifactId}/content
```

### 前端实施

1. Final Result 展示附件列表并支持下载。
2. Node Execution Detail 展示该 Node 产生的 Artifact。
3. Mapping UI 中 Artifact 显示为特殊数据类型，不显示服务器 URI。

### 测试用例

- Tool 创建 Artifact。
- ArtifactRef 写入 NodeResult。
- Assistant Message 引用 Artifact。
- 中间 Node 生成附件后，即使最终消息来自后续 Node，附件仍能进入默认 FinalResult。
- Invisible Artifact 不进入默认 FinalResult。
- 下载 API 正确授权/读取。

### 验收标准

解决“只取最后一条 Message 导致中间附件丢失”的问题。

### Codex 执行 Prompt

```text
实现 T11：Artifact Store、ArtifactRef、Tool/Node/Message/FinalResult 关联与前端附件展示下载。
Artifact 必须独立存储，Message 只保留引用。
重点测试中间节点附件不会因最终 message 来自后续节点而丢失。
不暴露服务器物理路径。
完成后更新 T11。
```

### 实施记录

- 主要修改文件：
- 实现说明：
- 测试结果：
- 风险/遗留：

---

## T12 — Workflow Ref Node / 子 Workflow

**状态：** [ ] TODO  
**优先级：** P1  
**依赖：** T06、T10

### 目标

让一个 Workflow 能作为另一个 Workflow 的 Node 被引用，并通过明确 Input/Output Contract 组合。

### 后端实施

实现：

```csharp
WorkflowRefNode
WorkflowRefNodeExecutor
ValueRef
WorkflowInputValueRef
ConstantValueRef
NodeOutputValueRef
MessageContextMode: Inherit / Isolated
```

执行步骤：

1. Resolve InputBindings；
2. 校验子 Workflow InputSchema；
3. 选择明确 Published Version；
4. 检查 workflow depth；
5. 构造 Inherit / Isolated MessageContext；
6. 执行子 Workflow；
7. 校验 OutputSchema；
8. 将子 Workflow FinalResult 转换为当前 NodeResult。

MVP 默认 `Inherit`。

### 前端实施

Workflow Node Inspector：

- Workflow selector；
- Version selector（默认 Latest Published，可保存时解析为明确策略）；
- Input Mapping；
- Message Context：Inherit / Isolated。

Input Mapping 来源：

```text
User Input
Upstream Node Field
Constant
Artifact
```

普通模式不允许手写 state path。

### 测试用例

- NodeOutput → 子 Workflow Input。
- Constant → 子 Workflow Input。
- Input Schema Failure。
- Output Schema Failure。
- Inherit Message。
- Isolated Message。
- Depth Limit。
- 子 Workflow Failure 被父 Workflow 正确包装。

### 验收标准

父图可只看到：

```text
Analyze → Research Workflow → End
```

而 Research Workflow 内部拥有自己的完整 Agent Graph。

### Codex 执行 Prompt

```text
实现 T12：WorkflowRefNode 子 Workflow 前后端闭环。
通过 Input/Output Contract 和结构化 ValueRef 映射，不允许普通用户手写 $state。
支持 Published Version、Inherit/Isolated MessageContext、Depth Limit 和错误传播。
完成 UI、Runtime、Contract、测试并更新 T12。
```

### 实施记录

- 主要修改文件：
- 实现说明：
- 测试结果：
- 风险/遗留：

---

## T13 — Schema Registry、ValueRef 与失效引用校验

**状态：** [ ] TODO  
**优先级：** P1  
**依赖：** T09、T12

### 目标

消除字符串 State Path，让前端和后端都能检测由于上游 Schema 修改导致的 Condition / Workflow Mapping 失效。

### 后端实施

统一结构化 Ref：

```csharp
ValueRef
NodeOutputValueRef
WorkflowInputValueRef
ConstantValueRef
ArtifactValueRef(optional)
```

Definition Validator 增强：

- 引用 Node 是否存在；
- path 是否存在；
- path 类型与目标参数是否兼容；
- 引用上游可达性基础检查；
- Condition 字段类型和 Operator 兼容；
- SubWorkflow 必填 Input 是否完成绑定。

### 前端实施

建立 `NodeSchemaRegistry`：

```ts
[nodeId]: JsonSchema
```

当 Output Schema 改变：

1. 找出 Condition 引用；
2. 找出 Workflow Input Mapping；
3. 标记失效；
4. Validation Panel 提示；
5. 对应 Inspector 字段显示错误。

所有选择器显示友好名称，例如：

```text
Analyze Requirement / category
```

内部保存结构化 Ref。

### 测试用例

- 重命名/删除字段后引用立即失效。
- 修改 number → string 后不兼容比较条件失效。
- SubWorkflow input mapping 类型不兼容被阻止 Publish。
- Definition JSON 中不存在 `$state.` 字符串依赖。

### 验收标准

用户只通过选择器建立依赖，修改 Schema 后系统能够明确指出所有受影响的位置。

### Codex 执行 Prompt

```text
实现 T13：Schema Registry、统一 ValueRef、失效引用检测。
彻底避免普通 Workflow 配置使用 $state.xxx 字符串。
前端 schema 变更后主动定位 Condition 和 Workflow Mapping 的受影响引用；后端发布前再次严格校验。
完成测试并更新 T13。
```

### 实施记录

- 主要修改文件：
- 实现说明：
- 测试结果：
- 风险/遗留：

---

## T14 — Runtime Event + SSE 实时执行轨迹

**状态：** [ ] TODO  
**优先级：** P1  
**依赖：** T07、T08

### 目标

前端实时看到 Workflow 执行状态以及 Agent Node 内隐式 LLM/Tool Loop，但不污染 Graph。

### 后端实施

定义事件：

```text
WorkflowStarted
NodeStarted
LlmCallStarted
LlmCallCompleted
ToolCallStarted
ToolCallCompleted
SchemaValidationFailed
SchemaValidationSucceeded
NodeCompleted
NodeFailed
WorkflowCompleted
WorkflowFailed
```

事件字段至少：

```text
runId
nodeId
timestamp
sequence
eventType
payload
```

实现：

```text
GET /api/workflow-runs/{runId}/events
Content-Type: text/event-stream
```

同一 Run 的 Event sequence 必须单调递增。

### 前端实施

1. Run 后订阅 SSE。
2. Canvas 实时显示：Pending / Running / Succeeded / Failed / Skipped。
3. Execution Timeline 显示事件。
4. 点击 Agent Node 展开内部：LLM Call / Tool Call / Tool Result / Schema Validation / Node Result。
5. 网络断开时允许基于 last sequence 简单恢复或重新拉取当前状态；MVP 不需要复杂消息总线。

### 测试用例

- SSE 收到 WorkflowStarted → NodeStarted → NodeCompleted → WorkflowCompleted。
- Tool Loop 中事件顺序正确。
- sequence 不重复、不倒退。
- 前端 reducer 能从事件恢复节点状态。
- SSE 断开后 UI 不把 Run 错误标记为成功。

### 验收标准

用户能够实时理解“当前执行到哪个业务 Node，以及该 Agent Node 内部调用了哪些 Tool”。

### Codex 执行 Prompt

```text
实现 T14：Workflow Runtime Event 与 SSE 实时轨迹。
Graph 仍只展示业务 Node；隐式 LLM/Tool Loop 放在 Execution Panel。
实现统一事件、sequence、SSE API、前端订阅、Canvas 状态和 Timeline。
添加事件顺序和前端 reducer 测试。
完成后更新 T14。
```

### 实施记录

- 主要修改文件：
- 实现说明：
- 测试结果：
- 风险/遗留：

---

## T15 — Cancel、Runtime Limits 与失败态闭环

**状态：** [ ] TODO  
**优先级：** P1  
**依赖：** T14

### 目标

防止隐式 Agent Loop、循环 Graph 或递归 Workflow 无限执行，并允许用户取消 Run。

### 后端实施

统一 Runtime Limits：

```csharp
MaxLlmTurnsPerNode = 10
MaxToolCallsPerNode = 20
MaxNodeExecutions = 100
MaxWorkflowDepth = 8
MaxSchemaRetries = 2
WorkflowTimeout
```

提供：

```text
POST /api/workflow-runs/{runId}/cancel
```

所有 Runtime / LLM / Tool / SubWorkflow 调用透传 `CancellationToken`。

错误码至少：

```text
WORKFLOW_LIMIT_EXCEEDED
WORKFLOW_CANCELLED
NODE_OUTPUT_SCHEMA_MISMATCH
LLM_CALL_FAILED
TOOL_CALL_FAILED
SUB_WORKFLOW_FAILED
```

### 前端实施

- Running 时显示 Cancel。
- 取消后节点状态和 Run 状态明确显示 Cancelled。
- Limit exceeded 显示具体限制类型，不只显示“执行失败”。
- Agent Node Detail 显示 schema retry / tool count / llm turn 失败原因。

### 测试用例

- MaxLlmTurns 超限。
- MaxToolCalls 超限。
- MaxNodeExecutions 超限。
- WorkflowTimeout。
- 子 Workflow Depth 超限。
- Cancel 正在进行的 LLM/Tool 调用。
- Cancel 后不继续调度下一 Node。

### 验收标准

任何隐式循环都有硬上限，用户可停止运行，失败原因可理解。

### Codex 执行 Prompt

```text
实现 T15：Cancellation、Runtime Limits 和统一失败态。
所有异步路径必须透传 CancellationToken。
加入 Agent Loop、Graph Loop、SubWorkflow Depth、Workflow Timeout 的统一检查。
前端支持 Cancel 和可读错误展示。
补齐边界测试并更新 T15。
```

### 实施记录

- 主要修改文件：
- 实现说明：
- 测试结果：
- 风险/遗留：

---

## T16 — Run 持久化、历史详情与调试页面

**状态：** [ ] TODO  
**优先级：** P1  
**依赖：** T14、T15

### 目标

让完成后的 Run 仍可查看完整 NodeResult、Messages、Artifacts 和 Execution Events，为调试和后续恢复能力打基础。

### 后端实施

优先持久化：

```text
workflow_run
workflow_node_execution
workflow_message
workflow_artifact
workflow_execution_event
```

提供：

```text
GET /api/workflow-runs/{runId}
GET /api/workflow-runs/{runId}/nodes
GET /api/workflow-runs/{runId}/messages
GET /api/workflow-runs/{runId}/artifacts
```

要求：

- Message append 有 sequence；
- Event 有 sequence；
- ToolCallId 可追踪；
- 日志/持久化避免记录敏感 Tool 参数原文，必要时脱敏。

### 前端实施

新增 Run Detail / Execution Detail：

- Workflow 信息与版本；
- Node 执行列表；
- Execution Timeline；
- Messages；
- ToolCall / ToolResult；
- NodeResult；
- Artifacts；
- 错误详情。

默认视图不要把所有底层细节塞进聊天区域。

### 测试用例

- Run 完成后刷新仍可查看全过程。
- Message sequence 正确。
- ToolCallId 关联正确。
- NodeResult.Data 与运行时一致。
- Artifact 可从历史 Run 下载。
- Cancelled/Failed Run 仍保留已产生 Trace。

### 验收标准

无需依赖内存状态即可完整查看历史 Run 的执行事实。

### Codex 执行 Prompt

```text
实现 T16：Workflow Run 持久化和历史调试详情。
优先结构化保存 Run、NodeExecution、Message、Artifact、ExecutionEvent；Definition 仍可 JSON 保存。
前端新增历史 Run Detail，区分业务结果和底层 Runtime Trace。
确保 sequence、ToolCallId、错误和 Artifact 可追踪。
完成测试并更新 T16。
```

### 实施记录

- 主要修改文件：
- 实现说明：
- 测试结果：
- 风险/遗留：

---

## T17 — 编辑器 Simple / Advanced 模式与最终 UX 收口

**状态：** [ ] TODO  
**优先级：** P2  
**依赖：** T13、T16

### 目标

把底层能力收敛成普通用户可理解的 Agent Workflow 编辑体验，同时保留高级调试能力。

### 后端实施

原则上不增加新的 Runtime 抽象，只补齐前端需要的元数据/可选配置默认值：

- Tool 元数据；
- Workflow Contract 摘要；
- Schema 描述；
- Runtime limit defaults；
- Node validation details。

避免为了 UI 新建第二套业务模型。

### 前端实施

#### Simple Mode

Agent Node 只显示：

```text
Goal
Output
Tools
Branch/Next
```

#### Advanced Mode

额外显示：

```text
JSON Schema
Retry
Timeout
Context Sources
Message Context Strategy
Runtime detail
```

Node Card 信息密度：

Agent：

```text
Name
Output fields
Tools count
```

Condition：

```text
Source field
Branch count
```

Workflow：

```text
Referenced Workflow
Version
Input/Output summary
```

### 测试用例

- Simple/Advanced 切换不丢配置。
- Simple 模式不出现 `$state`、PromptNode、LlmNode、ToolNode。
- Inspector 信息与保存 DTO 一致。
- Validation Error 可从 Panel 定位到对应 Node/Field。

### 验收标准

普通用户能通过“目标 → 输出 → 工具 → 分支”理解 Workflow，而不是理解 Agent 内部实现细节。

### Codex 执行 Prompt

```text
实现 T17：V2 Workflow Editor 的 Simple/Advanced UX 收口。
不新增复杂 Runtime，只优化配置展示、默认值、NodeCard、Validation 定位和高级设置折叠。
Simple 模式不得暴露 $state、Prompt/LLM/Tool Node 等底层概念。
添加关键 UI 测试并更新 T17。
```

### 实施记录

- 主要修改文件：
- 实现说明：
- 测试结果：
- 风险/遗留：

---

## T18 — V2 端到端样例 Workflow 与回归测试

**状态：** [ ] TODO  
**优先级：** P0（发布前）  
**依赖：** T10～T17

### 目标

用一个真实 Workflow 同时验证 Agent Loop、Condition、Tool、Artifact、SubWorkflow、End Output 和运行追踪。

### 样例 Workflow

建议创建：

```text
Start
  ↓
Analyze Request
  ↓
Condition(category)
  ├─ technical → Technical Research Workflow
  ├─ business  → Business Analysis Agent
  └─ default   → General Agent
          ↓
      Generate Final
          ↓
         End
```

Technical Research Workflow 内部：

```text
Research Agent
  └─ WebSearch Tool (implicit)
        ↓
Generate Report Agent
  └─ FileGenerator Tool (implicit)
        ↓
End
```

### 后端实施

- 加集成测试 Fixture / Seed Definition。
- 使用 Fake LLM + Fake Tool 做确定性自动化测试。
- 如具备测试模型配置，可增加可选真实 LLM smoke test，但不得作为 CI 必选项。

### 前端实施

增加端到端测试覆盖：

1. 新建 Workflow；
2. 配置 Agent Output Schema；
3. 配置 Condition；
4. 配置 Tools；
5. 引用子 Workflow；
6. Publish；
7. Run；
8. 查看 SSE；
9. 下载 Artifact；
10. 查看 Final Result。

### 必测回归

- Legacy Workflow 仍能打开/运行。
- V2 不出现旧 Node。
- `$state` 不出现在普通配置链路。
- ToolCall/ToolResult 成对。
- Condition 不调用 LLM。
- Node Instruction 不污染 persistent history。
- 中间附件不会丢。
- Published Version 不受 Draft 修改影响。

### 验收标准

该样例可作为 V2 Release Gate；只要该端到端测试未通过，不进入 Legacy 清理阶段。

### Codex 执行 Prompt

```text
实现 T18：构建一个覆盖 Agent、Condition、Tool Loop、SubWorkflow、Artifact、End、SSE 的端到端样例 Workflow，并建立自动化回归测试。
Fake LLM/Fake Tool 必须能让 CI 稳定执行。
同时验证 Legacy 不回归。
不要新增架构功能，重点是补齐集成缺口。
全部通过后更新 T18。
```

### 实施记录

- 主要修改文件：
- 实现说明：
- 测试结果：
- 风险/遗留：

---

## T19 — Legacy 迁移入口与废弃代码清理准备

**状态：** [ ] TODO  
**优先级：** P1  
**依赖：** T18

### 目标

在不立即删除 Legacy 的前提下，识别 V1 使用情况、建立迁移边界、标记可删除代码，为最终清理做准备。

### 后端实施

1. 统计/识别仍存在的 V1 Workflow。
2. 明确 V1 → V2 是否自动迁移：
   - 如果旧节点语义无法可靠映射，不做自动迁移；
   - 可提供“复制为 V2 / 手动重建”入口。
3. 对 Legacy API / Runner / DTO 标记 Deprecated。
4. 生成静态引用清单：哪些 V2 代码仍依赖 Legacy；目标应为 0。
5. 数据库旧字段只标记，不删除。

### 前端实施

- Legacy Workflow 显示“Legacy”状态。
- 可选提供“Create V2 Copy”入口；如果转换规则不可靠，则仅创建空 V2 并保留名称/元信息，不伪造语义。
- 新建流程继续只创建 V2。

### 测试用例

- V2 无 Legacy Runtime 依赖。
- V1 仍可运行。
- 新建始终是 V2。
- Deprecated 路径不会被 V2 Editor 调用。

### 验收标准

输出明确的 Legacy 清理清单，且 V2 已经可以独立运行。

### Codex 执行 Prompt

```text
实现 T19：Legacy 清理准备，不实际大规模删除。
统计 V1 使用、标记 Deprecated、确认 V2 对 Legacy 运行时依赖为 0，并提供安全的 V2 Copy/迁移入口（仅在语义可确定时转换）。
数据库旧字段暂不删除。
完成清理清单和测试后更新 T19。
```

### 实施记录

- 主要修改文件：
- 实现说明：
- 测试结果：
- Legacy 清理清单：
- 风险/遗留：

---

## T20 — Legacy 清理与 V2 默认化

**状态：** [ ] TODO  
**优先级：** P2 / 最后执行  
**依赖：** T19 + 清理前置条件全部满足

### 清理前置条件

只有以下全部满足才允许执行：

- [ ] T18 E2E 全通过。
- [ ] 已确认生产/目标环境无必须依赖 Legacy Runner 的 Workflow，或已经完成迁移。
- [ ] V2 新建、编辑、发布、运行、调试均稳定。
- [ ] V2 自动化测试覆盖旧功能中仍需保留的行为。
- [ ] 已完成备份/可回滚方案。

### 目标

删除已经确认无用的旧 Prompt/LLM/Tool 数据流式 Workflow 实现，保留必要历史数据迁移能力。

### 后端清理顺序

建议：

```text
Legacy API 入口
↓
Legacy Runner
↓
Legacy Node Executors
↓
Legacy Prompt/Llm/Tool Node DTO/Domain
↓
旧 State Mapping / $state 解析
↓
无引用兼容代码
↓
最后再处理数据库废弃字段
```

每删除一层都要跑回归测试。

### 前端清理顺序

```text
Legacy Node Palette
↓
Legacy Inspector
↓
Legacy Canvas Components
↓
Legacy DTO / adapters
↓
Legacy routes
```

### 测试用例

- 全量后端测试。
- 全量前端测试。
- T18 E2E。
- V2 样例全部通过。
- 搜索确认不存在 V2 对旧 Node 类型的引用。
- 搜索确认普通 V2 配置路径不存在 `$state.`。

### 验收标准

系统默认且唯一的新 Workflow 模型为 Agent Workflow V2；代码中不再保留无业务价值的旧执行路径。

### Codex 执行 Prompt

```text
执行 T20：在所有清理前置条件满足后删除 Legacy Workflow 无用代码。
严格按“入口→Runner→Executor→DTO/Domain→State Mapping→DB 字段”顺序渐进删除，每一步跑回归。
若仍发现正在使用的 V1 Workflow 或未迁移依赖，立即停止 T20 并将状态标记 BLOCKED，不得强删。
完成后运行全量前后端测试和 T18 E2E，并更新 T20 状态和实施记录。
```

### 实施记录

- 主要删除/修改文件：
- 测试结果：
- 数据迁移结果：
- 回滚点：
- 风险/遗留：

---

# 5. 通用后端测试矩阵

以下能力完成后必须长期保留自动化测试。

## 5.1 AgentNodeExecutor

- 无 ToolCall 直接成功。
- 一次 ToolCall。
- 多次 ToolCall。
- Tool 不允许。
- Tool 参数错误。
- Required Tool 未调用。
- Schema 第一次失败、第二次成功。
- Schema Retry 耗尽。
- Max Tool Calls 超限。
- Max LLM Turns 超限。
- Cancellation。

## 5.2 Condition

- Enum Equals。
- Number Compare。
- String Operator。
- Missing Field。
- Default Branch。
- 非法 Operator / Type 组合。

## 5.3 Sub Workflow

- Inherit Message。
- Isolated Message。
- Input Schema Failure。
- Output Schema Failure。
- Published Version 绑定。
- Depth Limit。
- 子 Workflow Cancellation / Failure。

## 5.4 Artifact

- Tool 创建 Artifact。
- Message 引用 Artifact。
- NodeResult 引用 Artifact。
- FinalResult 自动收集 Visible Artifact。
- Invisible Artifact 不输出。
- 历史 Run 下载。

## 5.5 Definition

- Draft 保存。
- Revision 冲突。
- Publish Freeze。
- Condition Ref 合法性。
- Workflow Ref Contract。
- Tool Policy。
- Graph 拓扑。

---

# 6. 通用前端测试矩阵

建议至少覆盖：

- V1/V2 编辑器路由。
- Graph 添加/删除/连线。
- Agent Inspector。
- Schema Builder round-trip。
- Tool Policy UI。
- Condition schema-driven selector。
- Workflow Input Mapping。
- End Output Binding。
- Schema 变更后的失效引用提示。
- Publish Validation。
- Run 发起。
- SSE reducer。
- Node execution state。
- Tool execution detail。
- Artifact download。
- Cancel。
- Run history detail。
- Simple / Advanced 模式不丢值。

---

# 7. 推荐代码边界

## 7.1 后端

```text
WorkflowV2/
├── Domain/
│   ├── Definitions/
│   ├── Nodes/
│   ├── ValueRefs/
│   └── Results/
├── Application/
│   ├── Definitions/
│   ├── Validation/
│   └── Runs/
├── Runtime/
│   ├── WorkflowRunner/
│   ├── Executors/
│   ├── AgentLoop/
│   ├── Context/
│   ├── Conditions/
│   ├── Events/
│   └── Limits/
├── Tools/
├── Artifacts/
├── Persistence/
└── Api/
```

如果现有项目规模较小，可减少项目层级，但仍建议保持功能目录边界。

## 7.2 前端

```text
src/features/workflow-v2/
├── api/
├── components/
│   ├── canvas/
│   ├── nodes/
│   ├── inspector/
│   ├── schema-builder/
│   └── execution/
├── models/
├── stores/
├── hooks/
├── validators/
└── utils/
```

Legacy 前端代码不要与 `workflow-v2` 节点组件交叉引用。

---

# 8. API 最终目标清单

## Definition

```text
POST   /api/workflows
GET    /api/workflows/{id}
PUT    /api/workflows/{id}/draft
POST   /api/workflows/{id}/validate
POST   /api/workflows/{id}/publish
GET    /api/workflows/{id}/versions
```

## Tool / Contract

```text
GET    /api/workflow-tools
GET    /api/workflows/{id}/versions
```

## Run

```text
POST   /api/workflows/{id}/runs
GET    /api/workflow-runs/{runId}
POST   /api/workflow-runs/{runId}/cancel
GET    /api/workflow-runs/{runId}/events
```

## Runtime Detail

```text
GET /api/workflow-runs/{runId}/nodes
GET /api/workflow-runs/{runId}/messages
GET /api/workflow-runs/{runId}/artifacts
GET /api/workflow-artifacts/{artifactId}/content
```

---

# 9. Definition / Runtime 不变量

实现过程中，以下规则视为架构不变量，不应由单个任务随意修改：

```text
1. Workflow 是 Control Flow Graph。
2. Agent Node 是 Agent Loop 的执行边界。
3. LLM 不负责任意 Graph 跳转。
4. Tool 不参与 Graph 连线。
5. Condition 不调用 LLM。
6. Condition 只读取 NodeResult.Data。
7. Node Instruction 默认 transient。
8. ToolCall / ToolResult 必须配对进入 MessageHistory。
9. Message / NodeResult / Artifact 分离。
10. WorkflowRef 通过明确 Contract 组合。
11. End/FinalResult 不依赖简单的 message_history[-1]。
12. 普通用户不接触 $state.xxx。
13. Published Version 不可原地修改。
14. Runtime 必须具备 Cancellation 和硬限制。
```

如果某个实现需要破坏其中任意一条，Codex 应停止继续扩展，先在任务实施记录中说明原因，而不是静默改变架构。

---

# 10. Codex 每个任务完成时的统一检查模板

完成任意 Txx 后执行：

```text
[ ] 当前任务要求的后端测试全部通过
[ ] 当前任务要求的前端测试全部通过
[ ] 前后端 DTO/Contract 一致
[ ] 没有引入 $state.xxx 普通用户配置
[ ] 没有将 Tool/LLM/Prompt 加回 Graph Node
[ ] 没有破坏 Legacy Workflow
[ ] 没有提前实现大量后续任务
[ ] 代码无明显重复/死代码
[ ] 错误处理和 Cancellation 符合当前任务要求
[ ] 手工验收场景通过
[ ] 已更新任务状态
[ ] 已填写实施记录
```

---

# 11. 推荐首个可交付里程碑

如果希望先快速得到可用版本，可将 **T00～T10** 作为第一个 MVP Release Gate。

完成后系统应至少支持：

```text
Create V2 Workflow
↓
Agent Node
↓
Structured Output
↓
Tool Calling
↓
Condition Routing
↓
Agent Node
↓
End
↓
Final Result
```

T11～T17 再补齐 Artifact、子 Workflow、Schema Registry、SSE、Cancel、持久化和完整 UX。

Legacy 删除必须最后执行。

---

# 12. 最终完成定义（Definition of Done）

Agent Workflow V2 只有在以下全部满足后才视为完成：

1. 新 Workflow 默认使用 V2。
2. 用户画布只操作 Agent / Condition / Workflow / End。
3. Agent Node 内部可以自主进行 LLM/Tool 多轮循环。
4. ToolCall / ToolResult 可追踪且 MessageHistory 成对保存。
5. Condition 只依据结构化 NodeResult 路由。
6. Workflow 可以引用 Published 子 Workflow。
7. Artifact 独立保存且不会因“只取最后一条消息”而丢失。
8. End Node 能明确生成 FinalResult。
9. 前端不要求用户了解 `$state` 结构。
10. Workflow Draft / Publish / Version 行为稳定。
11. Run 支持实时状态、历史详情、取消和 Runtime Limits。
12. T18 端到端样例及回归测试稳定通过。
13. Legacy 是否删除由真实迁移状态决定，而不是为了代码整洁提前删除。
