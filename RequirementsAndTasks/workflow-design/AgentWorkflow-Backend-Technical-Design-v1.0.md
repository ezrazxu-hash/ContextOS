# Agent Workflow 后端技术设计文档

> 版本：v1.0  
> 目标：实现以 Agent Node 为执行边界、以 Graph 为控制流、以 Agent Loop 为隐式 Runtime 的 Workflow 后端。

---

# 1. 后端设计目标

核心原则：

1. Graph 决定控制流。
2. AgentNodeExecutor 管理单个节点内部 Agent Loop。
3. LLM 负责 Tool Calling，不负责任意 Graph 跳转。
4. ToolCall / ToolResult 自动维护 MessageHistory。
5. Condition 基于 NodeResult.data 确定性执行。
6. Workflow 可以递归调用子 Workflow。
7. Message、NodeResult、Artifact 分离存储。
8. 用户不可直接操作 Runtime State Path。

---

# 2. 推荐模块划分

```text
Workflow.Application
Workflow.Domain
Workflow.Runtime
Workflow.Persistence
Workflow.Tools
Workflow.Llm
Workflow.Api
```

如果当前项目规模较小，也可以先落在单项目的独立目录：

```text
/Workflow
  /Domain
  /Runtime
  /Application
  /Infrastructure
  /Api
```

---

# 3. 核心领域模型

## 3.1 WorkflowDefinition

```csharp
public sealed class WorkflowDefinition
{
    public string Id { get; init; }
    public string Name { get; set; }
    public int Version { get; set; }
    public JsonSchema? InputSchema { get; set; }
    public JsonSchema? OutputSchema { get; set; }
    public IReadOnlyList<ToolRef> Tools { get; set; }
    public IReadOnlyList<WorkflowNode> Nodes { get; set; }
    public IReadOnlyList<WorkflowEdge> Edges { get; set; }
    public WorkflowRuntimeLimits Limits { get; set; }
}
```

---

## 3.2 WorkflowNode

```csharp
public abstract record WorkflowNode(
    string Id,
    string Name,
    WorkflowNodeType Type);
```

类型：

```csharp
public enum WorkflowNodeType
{
    Agent,
    Condition,
    Workflow,
    End
}
```

---

## 3.3 AgentNode

```csharp
public sealed record AgentNode : WorkflowNode
{
    public string Instruction { get; init; }
    public JsonSchema OutputSchema { get; init; }
    public NodeContextPolicy ContextPolicy { get; init; }
    public NodeToolPolicy ToolPolicy { get; init; }
    public NodeRetryPolicy RetryPolicy { get; init; }
    public NodeVisibility Visibility { get; init; }
}
```

---

## 3.4 ConditionNode

```csharp
public sealed record ConditionNode : WorkflowNode
{
    public IReadOnlyList<ConditionBranch> Branches { get; init; }
    public string DefaultTargetNodeId { get; init; }
}
```

---

## 3.5 WorkflowRefNode

```csharp
public sealed record WorkflowRefNode : WorkflowNode
{
    public string WorkflowId { get; init; }
    public int? Version { get; init; }
    public IReadOnlyDictionary<string, ValueRef> InputBindings { get; init; }
    public MessageContextMode MessageContextMode { get; init; }
}
```

---

## 3.6 EndNode

```csharp
public sealed record EndNode : WorkflowNode
{
    public FinalOutputBinding OutputBinding { get; init; }
}
```

---

# 4. Runtime State

建议：

```csharp
public sealed class WorkflowRunState
{
    public string RunId { get; init; }
    public string WorkflowId { get; init; }
    public string CurrentNodeId { get; set; }

    public List<AgentMessage> Messages { get; } = new();
    public Dictionary<string, NodeResult> NodeResults { get; } = new();
    public List<ArtifactRef> Artifacts { get; } = new();

    public ExecutionCounters Counters { get; } = new();
    public Stack<WorkflowFrame> WorkflowStack { get; } = new();
}
```

注意：

`WorkflowRunState` 是 Runtime 内部模型，不直接映射给用户表单。

---

# 5. Runtime 总体执行器

核心服务：

```csharp
public interface IWorkflowRunner
{
    Task<WorkflowRunResult> RunAsync(
        WorkflowRunRequest request,
        CancellationToken cancellationToken);
}
```

主循环：

```text
Load Workflow
↓
Validate
↓
Create RunState
↓
Current = Start
↓
Execute Node
↓
Resolve Transition
↓
Next Node
↓
...
↓
End
↓
Build FinalResult
```

---

# 6. Node Executor 抽象

```csharp
public interface INodeExecutor
{
    WorkflowNodeType NodeType { get; }

    Task<NodeExecutionResult> ExecuteAsync(
        WorkflowNode node,
        WorkflowExecutionContext context,
        CancellationToken cancellationToken);
}
```

实现：

```text
AgentNodeExecutor
ConditionNodeExecutor
WorkflowRefNodeExecutor
EndNodeExecutor
```

---

# 7. AgentNodeExecutor

AgentNodeExecutor 是整个后端最核心模块。

伪代码：

```csharp
while (true)
{
    CheckNodeLimits();

    var llmContext = contextBuilder.Build(...);

    var response = await llmClient.SendAsync(llmContext);

    if (response.HasToolCalls)
    {
        foreach (var toolCall in response.ToolCalls)
        {
            ValidateToolPermission(toolCall);
            ValidateToolArguments(toolCall);

            AppendToolCallMessage(toolCall);

            var toolResult = await toolExecutor.ExecuteAsync(toolCall);

            AppendToolResultMessage(toolResult);
        }

        continue;
    }

    var parseResult = outputParser.Parse(response);

    if (!schemaValidator.Validate(parseResult.Data, node.OutputSchema))
    {
        if (schemaRetryCount >= maxSchemaRetries)
            return Failed(...);

        AddTransientSchemaCorrection(...);
        continue;
    }

    return Success(nodeResult);
}
```

---

# 8. ContextBuilder

接口：

```csharp
public interface IAgentContextBuilder
{
    AgentContext Build(
        AgentNode node,
        WorkflowExecutionContext context);
}
```

构造内容：

```text
Persistent Messages
+ Current Node Instruction
+ Output Schema Instruction
+ Relevant Node Results
+ Available Tools
+ Runtime System Rules
```

不要将 Node Instruction 永久追加到 MessageHistory。

---

# 9. Message 模型

建议统一：

```csharp
public sealed record AgentMessage
{
    public string Id { get; init; }
    public MessageRole Role { get; init; }
    public IReadOnlyList<MessageContent> Content { get; init; }
    public IReadOnlyList<ToolCall>? ToolCalls { get; init; }
    public string? ToolCallId { get; init; }
    public bool Visible { get; init; }
}
```

角色：

```text
System
User
Assistant
Tool
```

Node Instruction 不建议作为 Persistent System Message 进入 Messages。

---

# 10. ToolCall / ToolResult

ToolCall：

```csharp
public sealed record ToolCall(
    string Id,
    string ToolName,
    JsonElement Arguments);
```

ToolResult：

```csharp
public sealed record ToolResult(
    string ToolCallId,
    bool Success,
    JsonElement? Data,
    IReadOnlyList<ArtifactRef> Artifacts,
    string? Error);
```

必须通过 `ToolCallId` 强关联。

---

# 11. Tool Registry

```csharp
public interface IToolRegistry
{
    ToolDefinition Get(string toolName);
    IReadOnlyList<ToolDefinition> GetAvailableTools(...);
}
```

Tool Definition：

```csharp
public sealed record ToolDefinition
{
    public string Name { get; init; }
    public string Description { get; init; }
    public JsonSchema InputSchema { get; init; }
    public JsonSchema? OutputSchema { get; init; }
}
```

---

# 12. Tool Executor

```csharp
public interface IToolExecutor
{
    Task<ToolResult> ExecuteAsync(
        ToolCall toolCall,
        ToolExecutionContext context,
        CancellationToken cancellationToken);
}
```

Runtime 负责：

- Tool 权限校验
- 参数校验
- Timeout
- Retry（如允许）
- Trace
- Error 包装

---

# 13. Tool Policy

```csharp
public enum ToolPolicyMode
{
    Auto,
    Required,
    Disabled
}
```

```csharp
public sealed record NodeToolPolicy
{
    public ToolPolicyMode Mode { get; init; }
    public IReadOnlySet<string> AllowedTools { get; init; }
    public IReadOnlySet<string> RequiredTools { get; init; }
}
```

Node 完成前，若 `RequiredTools` 未被调用，则 Runtime 不接受最终结果。

可自动注入提示：

```text
You must use tool X before completing this task.
```

---

# 14. Output Parser

LLM 最终返回应被解析为两部分：

```text
Assistant Message
Structured NodeResult
```

推荐 LLM 使用 structured output / JSON schema 能力时优先直接使用。

否则使用统一 Parser。

---

# 15. NodeResult

```csharp
public sealed record NodeResult
{
    public string NodeId { get; init; }
    public NodeExecutionStatus Status { get; init; }
    public JsonElement? Data { get; init; }
    public IReadOnlyList<string> MessageIds { get; init; }
    public IReadOnlyList<ArtifactRef> Artifacts { get; init; }
    public NodeExecutionMetadata Metadata { get; init; }
}
```

Condition 永远读取 `Data`。

---

# 16. Condition Evaluator

不要执行脚本。

MVP 使用明确的 Operator Model：

```csharp
public sealed record ConditionExpression
{
    public NodeOutputRef Left { get; init; }
    public ConditionOperator Operator { get; init; }
    public JsonElement? Right { get; init; }
}
```

Operator：

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

---

# 17. ValueRef

避免使用：

```text
$state.node.output.xxx
```

使用结构化 Ref：

```csharp
public abstract record ValueRef;

public sealed record NodeOutputValueRef(
    string NodeId,
    IReadOnlyList<string> Path) : ValueRef;

public sealed record ConstantValueRef(
    JsonElement Value) : ValueRef;

public sealed record WorkflowInputValueRef(
    IReadOnlyList<string> Path) : ValueRef;
```

Runtime 提供统一 `IValueResolver`。

---

# 18. WorkflowRefNodeExecutor

执行步骤：

1. Resolve InputBindings。
2. 校验子 Workflow Input Schema。
3. 检查 `max_workflow_depth`。
4. 根据 MessageContextMode 构造子 Workflow Context。
5. 执行子 Workflow。
6. 校验子 Workflow Output Schema。
7. 将子 Workflow FinalResult 转换为当前 NodeResult。

---

# 19. MessageContextMode

```csharp
public enum MessageContextMode
{
    Inherit,
    Isolated
}
```

### Inherit

子 Workflow 共享父 Workflow Messages。

### Isolated

创建独立 MessageHistory。

MVP 默认 Inherit。

---

# 20. Artifact Store

接口：

```csharp
public interface IArtifactStore
{
    Task<ArtifactRef> SaveAsync(...);
    Task<Stream> OpenReadAsync(...);
}
```

ArtifactRef：

```csharp
public sealed record ArtifactRef
{
    public string Id { get; init; }
    public string Name { get; init; }
    public string MimeType { get; init; }
    public string CreatedByNodeId { get; init; }
    public bool Visible { get; init; }
}
```

Message 只保留 Ref，不直接塞二进制内容。

---

# 21. FinalResultBuilder

```csharp
public interface IFinalResultBuilder
{
    WorkflowRunResult Build(
        EndNode endNode,
        WorkflowRunState state);
}
```

默认：

```text
message = last visible assistant message
artifacts = all visible artifacts
data = null
```

---

# 22. Runtime Limits

```csharp
public sealed record WorkflowRuntimeLimits
{
    public int MaxLlmTurnsPerNode { get; init; } = 10;
    public int MaxToolCallsPerNode { get; init; } = 20;
    public int MaxNodeExecutions { get; init; } = 100;
    public int MaxWorkflowDepth { get; init; } = 8;
    public int MaxSchemaRetries { get; init; } = 2;
    public TimeSpan WorkflowTimeout { get; init; }
}
```

每个执行入口必须统一检查。

---

# 23. 运行事件

为了前端 SSE / 调试，Runtime 应发布事件：

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

---

# 24. Event Stream

建议接口：

```text
GET /api/workflow-runs/{runId}/events
Content-Type: text/event-stream
```

事件应包含：

- runId
- nodeId
- timestamp
- sequence
- eventType
- payload

---

# 25. Persistence

建议实体：

```text
workflow_definition
workflow_version
workflow_run
workflow_node_execution
workflow_message
workflow_artifact
workflow_execution_event
```

如果需要快速落地，Workflow Definition 可先 JSON 存储，Execution 重点结构化存储。

---

# 26. Definition Version

发布时冻结：

```text
WorkflowDefinitionVersion
```

Run 必须绑定明确版本。

不要让运行中的 Run 读取可变 Draft。

---

# 27. Draft / Published

```text
Draft
  ↓ Publish
Version N
```

Draft 可持续编辑。

Published Version 不可原地修改，只能生成新版本。

---

# 28. 校验服务

```csharp
public interface IWorkflowDefinitionValidator
{
    ValidationResult Validate(WorkflowDefinition definition);
}
```

校验：

- 节点 ID 唯一
- Start / End 合法
- Edge 合法
- 无非法悬空 Branch
- Schema 合法
- Condition Ref 合法
- Workflow Ref Contract 合法
- Tool Policy 合法
- 循环风险

---

# 29. API 建议

## Definition

```text
POST   /api/workflows
GET    /api/workflows/{id}
PUT    /api/workflows/{id}/draft
POST   /api/workflows/{id}/validate
POST   /api/workflows/{id}/publish
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
```

---

# 30. Run Request

```json
{
  "version": 3,
  "input": {
    "message": "帮我分析这个需求",
    "data": {},
    "artifacts": []
  }
}
```

---

# 31. Run Result

```json
{
  "runId": "run_001",
  "status": "Succeeded",
  "message": {
    "id": "msg_100"
  },
  "artifacts": [
    {
      "id": "artifact_01",
      "name": "report.pdf"
    }
  ],
  "data": null
}
```

---

# 32. 错误模型

建议统一：

```csharp
public sealed record WorkflowError
{
    public string Code { get; init; }
    public string Message { get; init; }
    public string? NodeId { get; init; }
    public bool Retryable { get; init; }
    public object? Details { get; init; }
}
```

错误码示例：

```text
LLM_CALL_FAILED
TOOL_CALL_FAILED
TOOL_NOT_ALLOWED
TOOL_ARGUMENT_INVALID
NODE_SCHEMA_INVALID
NODE_OUTPUT_SCHEMA_MISMATCH
CONDITION_EVALUATION_FAILED
SUB_WORKFLOW_FAILED
WORKFLOW_LIMIT_EXCEEDED
WORKFLOW_CANCELLED
```

---

# 33. 并发与一致性

同一个 WorkflowRun：

- 默认单控制流串行执行。
- ToolCall 可根据模型返回是否允许并行。
- Message append 必须有 sequence。
- Event stream 必须有 sequence。

未来支持 Parallel Node 时再扩展 Graph Scheduler。

MVP 不建议一开始引入复杂 DAG 并发调度。

---

# 34. Cancellation

所有 Runtime / LLM / Tool / Sub Workflow 调用必须透传 `CancellationToken`。

Cancel Run 后：

1. 更新 Run 状态。
2. 触发 CancellationToken。
3. 停止后续 Node。
4. 记录 WorkflowCancelled Event。

---

# 35. 日志与 Trace

建议所有日志至少包含：

```text
WorkflowId
WorkflowVersion
RunId
NodeId
ExecutionId
ToolCallId(optional)
```

不要记录敏感 Tool 参数原文，必要时做脱敏。

---

# 36. 测试策略

建议优先 TDD 覆盖：

## AgentNodeExecutor

- 无 ToolCall 直接成功。
- 一次 ToolCall 后成功。
- 多次 ToolCall 后成功。
- Tool 不允许。
- Tool 参数错误。
- Required Tool 未调用。
- Schema 第一次失败、第二次成功。
- Schema 重试耗尽。
- Max Tool Calls 超限。
- Max LLM Turns 超限。

## Condition

- Enum Equals。
- Number Compare。
- Missing Field。
- Default Branch。

## Sub Workflow

- Inherit Message。
- Isolated Message。
- Input Schema Failure。
- Output Schema Failure。
- Depth Limit。

## Artifact

- Tool 创建 Artifact。
- Message 引用 Artifact。
- FinalResult 自动收集 Visible Artifact。

---

# 37. 推荐实现顺序

```text
1. Domain Models
2. Workflow Definition Validator
3. RunState
4. Message + NodeResult
5. AgentNodeExecutor（无Tool）
6. Structured Output + Schema Validation
7. Tool Registry + Tool Executor
8. Agent Loop
9. ConditionNodeExecutor
10. FinalResultBuilder
11. Artifact Store
12. WorkflowRefNodeExecutor
13. Runtime Events
14. SSE
15. Persistence
16. Cancel / Limits
```

---

# 38. 后端关键边界总结

最重要的三层：

```text
Graph Layer
决定：执行哪个 Node

Agent Runtime Layer
决定：当前 Node 内 LLM / Tool 如何循环

State Layer
保存：Messages / NodeResults / Artifacts / Trace
```

严格保持：

```text
LLM 不控制 Graph 任意跳转
Tool 不参与 Graph 连线
Condition 不调用 LLM
Node Instruction 不污染 Persistent MessageHistory
```

这是整个架构稳定性的关键。
