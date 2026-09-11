# Workflow Node Input Binding Design

## Goal

让相连 Workflow V2 Node 之间通过现有结构化 `ValueRef` 传递参数。下游 Node 的输入 Schema 决定输入字段，上游 Node 的 Output Schema 提供可选来源；用户不需要编辑 `$state`。

## Current Boundary

- V2 Graph 的节点类型是 `agent`、`condition`、`workflow`、`end`。
- LLM 和 Tool 是 Agent Node 内部 Runtime 能力，不新增独立 Graph Node。
- Agent 当前有 `instruction`、`outputSchema`、`toolPolicy` 等配置，没有 Agent 级 `inputSchema`/`inputBindings`。
- 现有 `ValueRef` 已用于 Workflow Ref 的 `inputBindings` 和 End 的最终数据绑定，Runtime 已有解析和基础类型校验。
- Edge 只表示执行拓扑；Condition 的 branch handle 仍负责分支路由。

## Minimal Extension

Agent Node 的 `config` 增加可选 `inputSchema` 和 `inputBindings`。缺少 `inputSchema` 的旧 Agent 保持现有消息历史行为；声明了输入 Schema 的 Agent 在执行前解析绑定并获得结构化输入。

Canonical binding shapes:

```json
{
  "kind": "nodeOutput",
  "nodeId": "upstream-agent",
  "path": ["response"]
}
```

```json
{ "kind": "workflowInput", "path": ["message"] }
```

```json
{ "kind": "constant", "value": 10 }
```

The existing snake-case aliases remain accepted for backward compatibility, but V2 UI writes the canonical camel-case form.

## Binding Rules

- A missing binding may be suggested automatically by exact input/output name, then by a unique type-compatible output.
- Automatic suggestions never overwrite an existing binding.
- Manual choices are limited to Workflow Input, reachable upstream Node Output, and Constant.
- Basic compatibility allows equal JSON Schema types and integer-to-number widening.
- Edge creation does not bind every output automatically. It only makes a source Node eligible for an explicit binding.
- Removing a Node or an Edge does not silently rewrite bindings; invalid references are reported by validation.

## Runtime

The existing ValueRef resolver is reused. For a configured Agent, Runtime resolves each declared input field from workflow input, previously executed node outputs, or a constant, validates the resolved object against `inputSchema`, and includes only that resolved object as the Agent input context. The internal runtime state remains private; execution trace records the resolved Node input.

## UI

The Agent Inspector exposes an Inputs section generated from `config.inputSchema`. Each field has source type and a picker for the selected source Node/output or a typed Constant value. Existing Condition, Workflow Ref, End, Output Schema, and Tool Policy controls remain in place.

## Compatibility and Risks

- Existing workflows without Agent `inputSchema` are unchanged.
- Existing Workflow Ref and End bindings continue to use their current model.
- A binding to an upstream node that is skipped by a Condition can fail at runtime as an unavailable value; validation only checks graph reachability and schema compatibility.
- Real-time runtime streaming is outside this change.

## Acceptance

Agent input binding is persisted in drafts and restored after reload; UI never requires `$state`; incompatible or unreachable sources cannot be saved as valid; Runtime passes the resolved values to the downstream Agent; legacy Workflow V2 tests and runtime behavior remain green.
