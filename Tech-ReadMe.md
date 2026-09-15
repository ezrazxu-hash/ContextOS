# Workflow Node 数据传递与交互分析

> 本文基于当前代码实现整理，不以设计文档作为唯一依据。本文描述 Workflow V2 主页面和后端 Runtime 的实际行为，同时说明仍保留的 Legacy Runtime。

## 结论

当前 /workflow 页面实际使用 Workflow V2：

- 画布 Node 类型为 agent、condition、workflow、end。
- LLM 和 Tool 不再是独立画布 Node，而是 Agent Node 内部 Runtime。
- 同一次 Run 内，结构化 Node 输出保存在 node_outputs 中。
- Edge 主要负责执行路径和 Condition 分支路由，不会自动完成数据绑定。
- V2 使用结构化 ValueRef，不使用 $state.xxx。
- $state.xxx 属于旧版 Legacy Manifest/Graph Runtime。
- 如果前端使用 Mock Client，运行结果是模拟数据，不代表真实 Graph 执行结果。

关键位置：

- studio/src/main.js:436：Workflow 页面渲染入口。
- studio/src/features/workflow-v2/WorkflowV2Builder.js:1：V2 Node 类型。
- backend/src/contextos/workflow_v2/runtime/runs.py:105：V2 Run Service。
- backend/src/contextos/workflow_v2/runtime/runs.py:217：实际执行循环。

## 1. Node 之间的数据流

真实执行链路：

~~~text
POST /api/workflows/{workflowId}/runs
        ↓
WorkflowV2RunService.start()
        ↓
_execute_single_agent_run()
        ↓
START Edge
        ↓
Agent / Condition / Workflow
        ↓
End Node
        ↓
finalResult
~~~

运行 API 要求显式传入已发布版本：

~~~json
{
  "version": 1,
  "input": {
    "message": "请分析这个请求"
  }
}
~~~

实现位置：

- backend/src/contextos/api/routes/workflow_runs.py:7
- backend/src/contextos/workflow_v2/runtime/runs.py:126

### Workflow Input 进入第一个 Node

Runtime 将输入保存为 input_payload，并通过 _user_message() 转换为初始消息：

~~~json
{
  "role": "user",
  "content": "请分析这个请求"
}
~~~

数据链路：

~~~text
workflow input.message
        ↓
message_history[0]
        ↓
第一个 Agent 的 LLM 上下文
~~~

如果输入中没有 message，Runtime 会回退读取 input，否则使用空字符串。

实现位置：

- backend/src/contextos/workflow_v2/runtime/runs.py:231
- backend/src/contextos/workflow_v2/runtime/runs.py:910
- studio/src/main.js:3022

### Node 输出保存位置

Agent 或 Workflow Ref 执行成功后，Runtime 会写入：

~~~python
node_outputs[node_id] = output
~~~

例如：

~~~python
node_outputs["analyze-request"] = {
    "category": "technical",
    "topic": "API",
    "confidence": 0.95,
    "summary": "..."
}
~~~

同时会记录到：

- run.nodeResults
- run.executionDetails
- run.messages
- run.events

实现位置：

- backend/src/contextos/workflow_v2/runtime/runs.py:430
- backend/src/contextos/workflow_v2/runtime/runs.py:330

### 下一个 Node 读取前序输出

V2 通过结构化引用读取：

~~~json
{
  "kind": "nodeOutput",
  "nodeId": "analyze-request",
  "path": ["topic"]
}
~~~

实际读取：

~~~text
node_outputs["analyze-request"]["topic"]
~~~

如果目标 Agent 配置了 inputSchema 和 inputBindings，Runtime 会调用 _resolve_agent_inputs() 解析并校验绑定。

实现位置：

- backend/src/contextos/workflow_v2/runtime/runs.py:625
- backend/src/contextos/workflow_v2/runtime/runs.py:645

## 2. 当前共享 State

### V2 Runtime

V2 不是通过一个统一的 AgentGraphState 对象传递所有数据，而是在一次执行中维护以下运行时变量：

~~~python
workflow_input
message_history
node_outputs
node_results
execution_details
events
artifacts
last_output
~~~

其中：

- workflow_input：本次 Workflow 的原始输入。
- message_history：用户消息、Agent 消息、ToolCall 和 ToolResult。
- node_outputs：{nodeId: 结构化输出}。
- node_results：每个 Node 的执行状态、输入和输出。
- execution_details：LLM、Tool、Schema 校验等执行步骤。
- last_output：最近一次 Agent 或 Workflow Node 的输出。

生命周期：

~~~text
Workflow Run 开始
    ↓
初始化 node_outputs = {}
    ↓
各 Node 执行并持续写入
    ↓
End 生成 finalResult
    ↓
本次 Run 结束，运行时变量不用于下一次 Run
~~~

因此：

- 同一次 Run 中的 Node 可以共享 node_outputs。
- 不同 Run 之间不会共享 node_outputs。
- Run Store 会保存运行结果，但不会自动变成下一次执行的输入 State。
- Workflow Ref 子 Workflow 有自己的运行上下文。
- 子 Workflow 可根据 messageContextMode 选择是否继承父级消息历史。

### Legacy Runtime State

旧版 Runtime 仍定义了共享的 AgentGraphState：

~~~python
{
    "session_id": "...",
    "timeline_id": "...",
    "run_id": "...",
    "input": "...",
    "messages": [],
    "variables": {},
    "node_outputs": {},
    "tool_results": [],
    "output": "...",
    "visited_nodes": []
}
~~~

实现位置：

- backend/src/contextos/runtime/graph/state.py:6
- backend/src/contextos/runtime/graph/executor.py:25

这套 State 属于旧版 Manifest/Graph Runtime，不是当前 /workflow V2 页面主要使用的 State。

## 3. 当前 Node 类型的输入输出

### Workflow V2

| Node 类型 | 默认输入 | 默认输出 | 写入位置 | 下一节点读取方式 |
|---|---|---|---|---|
| Input | 当前 V2 不存在 | 不存在 | 不存在 | Workflow Input 直接进入 message_history |
| Prompt | 当前 V2 不存在 | 不存在 | 不存在 | 旧版 Prompt Node 才支持 |
| Agent | message_history，可选 inputBindings | LLM 返回的 JSON | node_outputs[nodeId]、nodeResults | nodeOutput ValueRef 或消息历史 |
| Condition | 指定 Agent 输出字段 | 分支名和目标 Node | nodeResult.data，不写 node_outputs | 通过 sourceHandle 选择 Edge |
| Workflow | inputBindings | 子 Workflow 的 output | node_outputs[nodeId] | 通过 nodeOutput ValueRef |
| Tool | 当前 V2 不存在独立 Tool Node | 不存在独立 Tool 输出 | Tool 结果进入 message_history | 由 Agent 后续 LLM 读取 |
| LLM | 当前 V2 不存在独立 LLM Node | 不存在独立 LLM 输出 | 作为 Agent 内部步骤 | Agent 结束后形成 Agent 输出 |
| Output | 当前 V2 不存在独立 Output Node | End 的 finalResult | finalResult | 由 End 配置决定 |
| End | 前序运行结果 | message、data、artifacts | Run Record 的 finalResult | Workflow 结束 |

V2 画布类型定义在：

studio/src/features/workflow-v2/WorkflowV2Builder.js:1

### Agent 的实际行为

Agent 执行时，LLM 会收到：

- Agent instruction
- Output Schema
- Available Tools
- Resolved Agent Inputs（如果存在）
- 当前 message_history

LLM 必须返回 JSON。Runtime 会：

1. 如果返回 ToolCall，校验并执行 Tool。
2. 将 ToolResult 追加到 message_history。
3. 再次调用 LLM。
4. 没有 ToolCall 时校验最终 JSON。
5. 将最终 JSON 写入 node_outputs[nodeId]。

实现位置：

- backend/src/contextos/workflow_v2/runtime/runs.py:340
- backend/src/contextos/workflow_v2/runtime/runs.py:890

## 4. 当前系统默认逻辑

| 行为 | V2 当前实现 |
|---|---|
| 从 START 找第一个 Node | 是，通过 START Edge |
| 普通 Edge 决定下一个 Node | 是 |
| Condition Edge 根据分支选择 | 是，通过 sourceHandle |
| 自动把上一个 Node 输出绑定到下一个 Node 输入 | 否 |
| Agent 输出自动写入 node_outputs | 是 |
| Agent 输出自动写入 nodeResults | 是 |
| Agent 消息自动进入 message_history | 是 |
| ToolCall / ToolResult 自动进入消息历史 | 是 |
| Agent 输出自动追加为 Assistant 消息 | 是，默认可见，可用 visibility 隐藏 |
| {{xxx}} Prompt Template 自动解析 | V2 否，Legacy 是 |
| $state.xxx 自动解析 | V2 否，Legacy 是 |
| Agent 输出自动生成 output_key | V2 没有 output_key，使用 Node ID |
| Tool 参数自动从前序 Node 映射 | V2 否，由 LLM 生成并经 Schema 校验 |
| run.output 自动取最后输出 | 是，取最后一次 Agent/Workflow 输出 |
| finalResult.data 自动取最后输出 | 否，由 End 配置决定 |
| START / END 自动创建 | 否，需要在定义中配置 |

Edge 实现位置：

backend/src/contextos/workflow_v2/runtime/runs.py:866

## 5. 固定格式

### V2 ValueRef

Workflow Input：

~~~json
{
  "kind": "workflowInput",
  "path": ["message"]
}
~~~

Node 输出：

~~~json
{
  "kind": "nodeOutput",
  "nodeId": "analyze-request",
  "path": ["category"]
}
~~~

常量：

~~~json
{
  "kind": "constant",
  "value": "technical"
}
~~~

End 读取 Node 输出：

~~~json
{
  "data": {
    "kind": "nodeOutput",
    "nodeId": "generate-final",
    "path": ["summary"]
  }
}
~~~

解析与校验位置：

- backend/src/contextos/workflow_v2/runtime/runs.py:645
- backend/src/contextos/workflow_v2/runtime/runs.py:782
- backend/src/contextos/workflow_v2/application/validation.py:394

### $state.xxx

这是 Legacy 格式，例如：

~~~json
{
  "query": "$state.plan"
}
~~~

解析位置：

backend/src/contextos/runtime/graph/nodes/references.py:47

V2 校验会拒绝包含 $state. 的配置，并返回 state_path_not_allowed。V2 必须使用结构化 ValueRef。

### Legacy Prompt Template

旧版 Prompt Node 支持：

~~~text
Plan the PRD review answer for {{topic}}
~~~

配合：

~~~json
{
  "input_mapping": {
    "topic": "$state.topic"
  }
}
~~~

实现位置：

- backend/src/contextos/runtime/graph/nodes/prompt.py:10
- backend/src/contextos/runtime/graph/nodes/llm.py:21

### V2 Agent 输出格式

Agent LLM 输出必须是合法 JSON，并满足 outputSchema：

~~~json
{
  "category": "technical",
  "topic": "API",
  "confidence": 0.95,
  "summary": "这是一个技术问题"
}
~~~

解析失败或 Schema 不匹配时，运行失败；如果配置了 maxSchemaRetries，则可能重试。

### V2 ToolCall 格式

~~~json
{
  "toolCalls": [
    {
      "id": "call-1",
      "name": "context.echo",
      "arguments": {
        "query": "..."
      }
    }
  ]
}
~~~

Runtime 会校验 Tool 是否存在、Agent 是否允许调用以及参数是否满足 Tool Schema。

## 6. 可自定义字段与内部字段

### 用户可配置字段

- Workflow ID、名称
- Workflow Input/Output Schema
- Agent 名称、instruction、visibility
- Agent inputSchema、inputBindings、outputSchema
- Agent toolPolicy
- Condition 分支、source、operator、value、target
- Workflow Ref 的 Workflow ID、版本、inputBindings、消息上下文模式
- End 的 finalResult
- Edge 的 source、target、sourceHandle

前端相关位置：

- studio/src/pages/Workflow/WorkflowV2Workbench.js:715
- studio/src/pages/Workflow/WorkflowV2Workbench.js:1028
- studio/src/pages/Workflow/WorkflowV2Workbench.js:1112

当前 V2 Agent Runtime 没有看到 Legacy LLM Node 那种独立且有效的 provider、model、temperature、max_tokens 配置，不应将 Legacy 字段直接推断为 V2 Agent 字段。

### 系统生成或间接配置

系统运行时生成：

- node_outputs
- message_history
- nodeResults
- executionDetails
- events
- last_output
- run_id
- ToolCall ID
- Message sequence
- Artifact ID
- Child Workflow run ID

用户可以通过 Binding、Schema、Condition source、End finalResult.data 和 Edge sourceHandle 间接影响这些结果。

前端连接 Edge 时有有限的自动绑定辅助逻辑：目标 Agent 存在 inputSchema，且只有一个兼容的前序 Agent 输出时，前端可能自动写入 nodeOutput binding。它不是 Edge Runtime 的通用数据绑定能力。

实现位置：

studio/src/pages/Workflow/WorkflowV2Workbench.js:1053

### 完全内部字段

普通用户不应直接填写：

- node_outputs
- last_output
- execution_details
- events
- run_id
- childRunId
- createdAt
- Legacy 的 __nodeId_port 状态 key
- checkpoint ID

## 7. Node Input / Output Schema

当前 V2 确实使用结构化 Schema。

Workflow 层：

~~~json
{
  "inputSchema": {},
  "outputSchema": {}
}
~~~

Agent 层：

~~~json
{
  "config": {
    "inputSchema": {},
    "outputSchema": {}
  }
}
~~~

Schema 实现：

backend/src/contextos/workflow_v2/application/json_schema.py:8

Runtime 实际校验：

- Agent 的 LLM 输出
- Agent 的 inputBindings
- Workflow Ref 的子 Workflow 输入
- Workflow Ref 的子 Workflow 输出
- ToolCall arguments

校验层还会检查：

- Condition source 是否来自 Agent 输出 Schema 的有效字段
- NodeOutput Binding 的 path 是否存在
- Source 和 target 类型是否兼容
- Workflow Ref 输入绑定类型是否兼容

Schema 不会自动完成 A.output → B.input，只提供字段、类型和校验依据。

## 8. Edge 与数据绑定

核心关系是：

~~~text
Edge = 控制流
ValueRef / inputBindings = 数据流
~~~

~~~text
A → B
~~~

只表示 A 执行完后继续执行 B，不自动表示：

~~~text
A.output → B.input
~~~

如果 B 需要读取 A 的字段，必须配置：

~~~json
{
  "inputBindings": {
    "topic": {
      "kind": "nodeOutput",
      "nodeId": "A",
      "path": ["topic"]
    }
  }
}
~~~

Agent B 还可以通过 message_history 看到前序 Agent 的 Assistant 消息，但这属于对话上下文，不等同于结构化数据绑定。

## 9. 完整执行示例

当前页面的 Starter Workflow 定义在：

studio/src/pages/Workflow/index.js:32

结构：

~~~text
START
  ↓
analyze-request
  ↓
route-category
  ├── technical-answer
  ├── business-answer
  └── general-answer
        ↓
generate-final
        ↓
end-1
~~~

### 初始状态

输入：

~~~json
{
  "message": "这个 API 请求为什么返回 401？"
}
~~~

Runtime 内部：

~~~json
{
  "workflow_input": {
    "message": "这个 API 请求为什么返回 401？"
  },
  "message_history": [
    {
      "role": "user",
      "content": "这个 API 请求为什么返回 401？"
    }
  ],
  "node_outputs": {},
  "node_results": []
}
~~~

### analyze-request

该 Agent 当前没有配置 inputSchema，因此 inputs 默认是 {}，但 LLM 能看到 instruction、Output Schema、Tools 和 User Message。

假设模型返回：

~~~json
{
  "category": "technical",
  "topic": "API authentication",
  "confidence": 0.98,
  "summary": "这是一个 API 鉴权相关的技术问题"
}
~~~

写入：

~~~json
{
  "node_outputs": {
    "analyze-request": {
      "category": "technical",
      "topic": "API authentication",
      "confidence": 0.98,
      "summary": "这是一个 API 鉴权相关的技术问题"
    }
  }
}
~~~

同时追加一条 Assistant 消息。

### route-category

Condition 配置读取：

~~~json
{
  "nodeId": "analyze-request",
  "path": ["category"]
}
~~~

实际读取：

~~~text
node_outputs["analyze-request"]["category"]
~~~

结果为 technical，所以选择：

~~~text
sourceHandle = technical
target = technical-answer
~~~

Condition 不写入 node_outputs，只在 nodeResults 中记录分支结果。

### technical-answer

该 Agent 可以：

1. 通过 message_history 看到前序 Agent 的消息。
2. 通过 inputBindings 显式读取前序 Agent 的结构化字段。

假设输出：

~~~json
{
  "summary": "401 通常表示请求未通过鉴权，需要检查 Token、权限范围和请求头。",
  "category": "technical"
}
~~~

### generate-final

假设输出：

~~~json
{
  "summary": "请检查 Authorization 请求头、Token 有效期及权限范围。",
  "category": "technical"
}
~~~

写入：

~~~json
{
  "node_outputs": {
    "generate-final": {
      "summary": "请检查 Authorization 请求头、Token 有效期及权限范围。",
      "category": "technical"
    }
  }
}
~~~

### End

Starter Workflow 的 End 配置将：

~~~json
{
  "kind": "nodeOutput",
  "nodeId": "generate-final",
  "path": ["summary"]
}
~~~

解析为最终 finalResult.data。

最终结果中：

- output 是最后一个 Agent 的完整输出对象。
- finalResult.data 是 End 指定的 summary 字段。
- finalResult.message 来自最后一个可见 Assistant Message。
- finalResult.artifacts 是可见 Artifact。

## 10. 代码与设计文档的差异

当前代码与 V2 设计原则总体一致：

- V2 只有 Agent、Condition、Workflow、End。
- Graph 主要负责控制流。
- LLM / ToolCall 属于 Agent 内部。
- 数据引用使用结构化 ValueRef。
- Condition 读取结构化 Agent 输出。

设计文档位置：

RequirementsAndTasks/workflow-design/AgentWorkflow-Codex-Implementation-Plan-v1.0.md:44

实际代码需要注意：

1. WorkflowV2Runner 目前主要负责入口验证，完整执行循环在 runtime/runs.py，不是独立的完整 Runner 类。
2. 旧版 Prompt、LLM、Tool、Output Node 仍存在，因此项目中仍能搜索到 $state.xxx，但这些不属于当前 V2 画布模型。
3. V2 校验层接受 artifact ValueRef，但当前 _resolve_value_ref() 没有对应的运行时解析分支；将其用于 Agent 或 Workflow 输入绑定时可能运行失败。
4. V2 运行入口会保存 input_payload，但 _execute_single_agent_run() 没有先对整个 Workflow inputSchema 做统一运行时校验；Agent 输入和子 Workflow 输入会校验。
5. 如果前端使用 mockClient，运行结果是固定模拟数据。实现位置为 studio/src/main.js:3682。

## 最终总结

1. Node 间数据传递的核心机制是一次 Run 内的 node_outputs 加结构化 ValueRef。
2. V2 有共享运行上下文，但不是旧版统一 AgentGraphState；主要由 workflow_input、message_history、node_outputs 等变量组成。
3. Edge 主要参与执行顺序和 Condition 路由，不负责自动数据映射。
4. 默认运行字段包括 node_outputs、message_history、nodeResults、events、last_output 和 Run 元数据。
5. V2 固定格式是 workflowInput、nodeOutput、constant 等 ValueRef；$state.xxx 只属于 Legacy。
6. 用户可以配置 Agent 指令、Schema、Binding、Tool Policy、Condition、Workflow Ref 和 End 输出选择。
7. node_outputs、Run ID、事件、执行详情、Child Run ID 等属于内部字段，不应要求普通用户填写。
8. V2 没有过度依赖 $state.xxx，但项目同时保留 Legacy Runtime，容易造成概念混淆；V2 结构化 Binding 仍需显式配置。
9. 未来改成可视化 Binding 时，现有 node_outputs、ValueRef Resolver、Schema 校验、Condition Resolver、Tool Loop、Message History 和 End Result Builder 均可继续复用。

