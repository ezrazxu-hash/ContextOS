# Agent Workflow 前端技术设计文档

> 版本：v1.0  
> 目标：实现面向 Agent Control Flow Graph 的可视化 Workflow 编辑器，隐藏 `$state.xxx`、LLM ToolLoop 等底层复杂度。

---

# 1. 前端设计目标

前端核心目标不是“让用户拼 LLM / Tool 调用”，而是让用户描述：

```text
当前阶段做什么
↓
输出什么结构
↓
根据输出走哪里
```

核心原则：

1. 不向普通用户暴露 State Path。
2. 不把 LLM、Tool、Prompt 作为普通可连线节点。
3. Agent Node 是画布核心节点。
4. Condition 基于 Schema 字段可视化配置。
5. Workflow Node 通过 Contract 引用子 Workflow。
6. 隐式 ToolCall / LLM Call 只在运行详情中展示。

---

# 2. 推荐技术栈

结合现有 Web 场景，建议：

```text
React
TypeScript
Vite
React Flow / XYFlow
Zustand
TanStack Query
React Hook Form
Zod
Monaco Editor（高级 JSON Schema 编辑，可选）
```

其中：

- React Flow：Graph 编辑。
- Zustand：当前 Workflow 编辑状态。
- TanStack Query：服务端状态。
- React Hook Form：节点表单。
- Zod：前端表单模型校验。

---

# 3. 页面结构

```text
┌─────────────────────────────────────────────┐
│ Toolbar                                     │
├──────────┬──────────────────────┬───────────┤
│ NodeList │      Canvas          │ Inspector │
│          │                      │           │
│ Agent    │                      │ Node Form │
│ Condition│                      │           │
│ Workflow │                      │           │
│ End      │                      │           │
├──────────┴──────────────────────┴───────────┤
│ Execution / Validation Panel                │
└─────────────────────────────────────────────┘
```

---

# 4. 节点类型

前端仅暴露：

```ts
type WorkflowNodeType =
  | 'agent'
  | 'condition'
  | 'workflow'
  | 'end';
```

Start 可作为特殊固定节点实现。

---

# 5. Agent Node UI

Agent Node 配置面板建议分为：

## 5.1 Basic

- Name
- Description
- Visibility

## 5.2 Goal / Instruction

一个主文本框：

```text
描述这个阶段需要 Agent 完成的任务
```

不要求用户写 MessageRole、PromptTemplate 等底层概念。

## 5.3 Context

建议采用选择器：

```text
Context Sources
☑ Conversation History
☑ User Input
☑ AnalyzeRequirement.summary
☐ AnalyzeRequirement.confidence
☑ Uploaded Files
```

默认只展示兼容的上游字段。

不显示：

```text
$state.node_results.xxx
```

## 5.4 Output Schema

提供可视化 Schema Builder。

示例：

```text
Field        Type        Required      Description
category     Enum        ✓             需求类型
summary      String      ✓             摘要
confidence   Number      -             置信度
```

Enum：

```text
technical
business
other
```

高级模式可切换 JSON Schema Editor。

## 5.5 Tools

```text
Tool Policy: [Auto ▼]

Allowed Tools
☑ Web Search
☑ Knowledge Base
☐ Database
☐ File Generator
```

Required 模式下：

```text
Required Tool: [Web Search ▼]
```

## 5.6 Retry

高级设置：

- Schema Retry Count
- Node Retry Count
- Timeout

普通模式折叠。

---

# 6. Condition Node UI

Condition Node 应完全 Schema Driven。

用户先选择 Source Node：

```text
Source Node
[Analyze Requirement ▼]
```

然后 Field 列表由 Output Schema 自动生成：

```text
Field
[category ▼]
```

再根据字段类型限制 Operator。

例如 Enum：

```text
Operator
[equals ▼]

Value
[technical ▼]
```

Number：

```text
confidence [>=] [0.8]
```

String：

```text
summary [contains] [Docker]
```

---

# 7. Condition 多分支

支持多个 Branch：

```text
Branch 1
category == technical
 -> Technical Research

Branch 2
category == business
 -> Business Analysis

Default
 -> General Response
```

画布上每个 Branch 独立 Handle。

---

# 8. Workflow Node UI

## 8.1 选择子 Workflow

```text
Workflow
[Research Workflow ▼]

Version
[Latest Published ▼]
```

## 8.2 Input Mapping

前端通过子 Workflow Input Schema 自动生成。

例如：

```text
topic: string
```

UI：

```text
Parameter: topic
Source:
[AnalyzeRequirement.summary ▼]
```

来源类型：

- User Input
- Upstream Node Field
- Constant
- Artifact

不允许普通模式手写 State Path。

## 8.3 Message Context

```text
Message Context
○ Inherit
○ Isolated
```

---

# 9. End Node UI

默认：

```text
Final Message
[Last visible assistant message]

Artifacts
[All visible artifacts]

Structured Data
[None]
```

高级配置：

```text
Message Source
[GenerateFinalAnswer.message ▼]

Artifacts
[GenerateReport.artifacts ▼]

Data
[EvaluateResult.data ▼]
```

---

# 10. Connection Rule

前端需要限制非法连线。

规则建议：

1. End Node 无出边。
2. Start Node 无入边。
3. Condition Node 每个 Branch 仅允许一个目标节点。
4. Workflow Node / Agent Node 默认单 Success 出边。
5. 可选 Failure 出边。
6. 禁止节点连接自身。
7. 循环允许，但需显式开启或检测提示。

---

# 11. Schema Registry

前端应维护当前 Graph 的 Schema Registry：

```ts
interface NodeSchemaRegistry {
  [nodeId: string]: JsonSchema;
}
```

当某节点 Output Schema 改变时：

1. 找出引用该 Node 字段的 Condition。
2. 找出引用该字段的 Workflow Input Mapping。
3. 标记失效引用。
4. 页面显示 Validation Error。

---

# 12. 数据引用模型

前端不要使用字符串：

```text
"$state.nodeA.output.category"
```

建议使用强类型 Ref：

```ts
interface NodeOutputRef {
  kind: 'node_output';
  nodeId: string;
  path: string[];
}
```

例如：

```json
{
  "kind": "node_output",
  "nodeId": "analyze_requirement",
  "path": ["category"]
}
```

UI 可以显示：

```text
Analyze Requirement / category
```

---

# 13. Artifact Ref UI

Artifact 字段在 Mapping UI 中显示为特殊类型：

```text
Generated Report / report.pdf
```

不向用户暴露真实文件 URI。

---

# 14. 编辑器状态模型

建议 Zustand：

```ts
interface WorkflowEditorState {
  workflowId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId?: string;
  dirty: boolean;
  validationErrors: ValidationError[];
}
```

服务端发布态与本地编辑态分离。

---

# 15. 自动保存

建议：

- 本地即时更新。
- 500~1000ms debounce 保存 Draft。
- Publish 显式操作。
- 后端使用 revision / version 做并发控制。

---

# 16. Workflow 校验

保存 / 发布前执行前端快速校验：

- Start 是否存在。
- End 是否存在。
- 是否有悬空节点。
- 是否有未连接 Branch。
- Condition 引用字段是否存在。
- Workflow Node 输入是否全部满足。
- Required Tool 是否属于 Workflow Tool Registry。
- Schema 是否合法。

最终以后端校验为准。

---

# 17. 运行体验

## 17.1 Run

点击 Run：

1. 保存当前 Draft。
2. 请求 Run API。
3. 获取 RunId。
4. 订阅 Run Event Stream。

建议 SSE 优先，WebSocket 可后续扩展。

---

## 17.2 Canvas Execution State

节点显示：

- Pending
- Running
- Succeeded
- Failed
- Skipped

运行时当前 Node 高亮。

---

# 18. 隐式 Agent Loop 展示

不要把 ToolCall 变成 Graph Node。

点击某个 Running / Succeeded Agent Node 后，在 Execution Panel 展开：

```text
Analyze Requirement

LLM Call #1
  ↓
Web Search
  ↓
Tool Result
  ↓
LLM Call #2
  ↓
Schema Validation
  ↓
Node Result
```

这样既保留可观测性，又不污染 Graph。

---

# 19. Execution Timeline

建议数据结构：

```ts
type ExecutionEvent =
  | NodeStartedEvent
  | LlmCallStartedEvent
  | LlmCallCompletedEvent
  | ToolCallStartedEvent
  | ToolCallCompletedEvent
  | SchemaValidationEvent
  | NodeCompletedEvent
  | NodeFailedEvent
  | WorkflowCompletedEvent;
```

UI 以 Timeline 展示。

---

# 20. 用户模式

建议支持：

### Simple Mode

只显示：

- Goal
- Output
- Tools
- Branch

### Advanced Mode

额外显示：

- JSON Schema
- Retry
- Timeout
- Context Source
- Message Context Strategy

默认 Simple Mode。

---

# 21. Node Card 信息密度

Agent Node 卡片建议只展示：

```text
Analyze Requirement
Agent

Output:
category, summary, confidence

Tools: 2
```

不要把完整 Prompt 展示在卡片。

Condition：

```text
Category?
category
3 branches
```

Workflow Node：

```text
Research Workflow
v3
Input: topic
Output: summary, sources
```

---

# 22. API 模型建议

前端 Graph DTO：

```ts
interface WorkflowDefinitionDto {
  id: string;
  name: string;
  version: number;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  tools: ToolRef[];
  nodes: WorkflowNodeDto[];
  edges: WorkflowEdgeDto[];
}
```

Node：

```ts
type WorkflowNodeDto =
  | AgentNodeDto
  | ConditionNodeDto
  | WorkflowRefNodeDto
  | EndNodeDto;
```

---

# 23. 前端目录建议

```text
src/
└── features/
    └── workflow/
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

---

# 24. MVP 前端任务边界

MVP 建议优先实现：

1. Graph Canvas
2. Agent Node
3. Condition Node
4. Workflow Node
5. End Node
6. Output Schema Builder
7. Tool Selector
8. Schema Driven Condition
9. Workflow Contract Mapping
10. Validation
11. Run
12. SSE Runtime Trace
13. Node Execution Detail

---

# 25. 前端关键原则

> 前端需要隐藏执行复杂度，而不是隐藏运行事实。

画布隐藏：

```text
Prompt -> LLM -> Tool -> LLM -> Parser
```

运行详情仍允许查看：

```text
LLM Call
ToolCall
ToolResult
Schema Retry
NodeResult
```

这样可以同时兼顾低认知成本和可调试性。
