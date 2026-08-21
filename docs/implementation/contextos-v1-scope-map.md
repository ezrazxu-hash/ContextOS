# ContextOS V1 Scope Map

This document maps the PRD V1 scope to the implementation task plan. It is a planning contract only; it does not introduce runtime behavior.

## P0 Coverage Map

| PRD Item | PRD Scope | Implementation Tasks |
|---|---|---|
| P0-1 | Runtime 基础：Session、Timeline、Checkpoint、LangGraph Runtime、Trace | M01-T01, M01-T02, M01-T03, M01-T04, M01-T05, M01-T06 |
| P0-2 | Context Core：ContextItem、ContextGroup、状态、Placeholder、Revision | M02-T01, M02-T02, M02-T03, M02-T04, M02-T05, M02-T06, M02-T07, M02-T08 |
| P0-3 | Context Compiler：IR、ToolCall/ToolResult 验证、Provider Adapter、Token Budget | M03-T01, M03-T02, M03-T03, M03-T04, M03-T05, M03-T06, M03-T07 |
| P0-4 | Chat：Chat UI、Stream、ToolCall、ToolResult、Context Panel | M04-T01, M04-T02, M04-T03, M04-T04, M04-T05, M04-T06 |
| P0-5 | Editable Message：Edit、Revision、Timeline Fork、三种后续动作 | M05-T01, M05-T02, M05-T03, M05-T04, M05-T05 |
| P0-6 | Safety：Impact Analyzer、Tool Risk、Replay Confirmation | M06-T01, M06-T02, M06-T03, M06-T04, M06-T05 |
| P0-7 | Restore：context.search、context.restore、Auto/Ask/Manual、Reallocation | M07-T01, M07-T02, M07-T03, M07-T04, M07-T05, M07-T06, M07-T07 |
| P0-8 | Workflow：Manifest、LangGraph Compiler、Basic Builder、Template | M08-T01, M08-T02, M08-T03, M08-T04, M08-T05, M08-T06, M08-T07 |
| P0-9 | Debug：Trace、State、Timeline、Checkpoint、Context、Tool | M09-T01, M09-T02, M09-T03, M09-T04 |

## MVP Scenario Map

| Scenario | PRD Scenario | Implementation Tasks |
|---|---|---|
| MVP-1 | 正常 Agent 对话 | M10-T01 |
| MVP-2 | 淘汰 Tool Interaction | M10-T02 |
| MVP-3 | 恢复淘汰内容 | M10-T03 |
| MVP-4 | 编辑历史回复 | M10-T04 |
| MVP-5 | ToolResult 冲突 | M10-T04 |
| MVP-6 | 副作用 Replay | M10-T05 |
| MVP-7 | 编辑 Abstract | M10-T06 |

## V1 Success Criteria Map

| Success Criterion | PRD Success Statement | Implementation Tasks |
|---|---|---|
| SC-1 | 用户可以看到 Agent 当前真正记住什么 | M02-T08, M04-T05, M10-T01, M10-T02 |
| SC-2 | 用户可以主动 Pin、Abstract、Evict、Restore | M02-T07, M02-T08, M07-T05, M07-T06 |
| SC-3 | Context 被淘汰后可以恢复 | M07-T05, M07-T06, M07-T07, M10-T03 |
| SC-4 | 用户可以修改历史 AI 回复，且修改影响后续 Agent | M05-T03, M05-T04, M10-T04 |
| SC-5 | 修改历史不会静默破坏 ToolCall / ToolResult 结构 | M02-T04, M03-T02, M03-T07, M10-T02, M10-T04 |
| SC-6 | Agent 可以主动找回之前被移出的上下文 | M07-T07, M10-T03 |
| SC-7 | 开发者可以从 Graph、State、Checkpoint、Trace、Context 理解执行 | M09-T01, M09-T02, M09-T03 |
| SC-8 | Web 刷新或重连后可从后端恢复 Session、Timeline、Checkpoint、Message Revision、Context 状态 | M01-T06, M04-T02, M04-T03, M10-T08 |

## V1 Exclusion Map

| Excluded Capability | PRD Handling | Implementation Task | V1 Handling |
|---|---|---|---|
| Semantic Restore | P1 后续增强 | 无 | 不实现业务能力 |
| Partial Restore | P1 后续增强 | 无 | 不实现业务能力 |
| Context 语义搜索 | P1 后续增强 | 无 | 不实现业务能力 |
| Context Priority 自动评分 | P1 后续增强 | 无 | 不实现业务能力 |
| Branch Compare | P1 后续增强 | 无 | 不实现业务能力 |
| Prompt Diff | P1 后续增强 | 无 | 不实现业务能力 |
| State Diff | P1 后续增强 | 无 | 不实现业务能力 |
| Timeline Compare | P1 后续增强 | 无 | 不实现业务能力 |
| Agent A/B Run | P1 后续增强 | 无 | 不实现业务能力 |
| Context Cost Analysis | P1 后续增强 | 无 | 不实现业务能力 |
| Context Restore Ranking | P1 后续增强 | 无 | 不实现业务能力 |
| 自定义 ContextGroup | P1 后续增强 | 无 | 不实现业务能力 |
| 更多 Provider | P1 后续增强 | 无 | 不实现业务能力 |
| 模板导入导出 | P1 后续增强 | 无 | 不实现业务能力 |
| 模板版本管理增强 | P1 后续增强 | 无 | 不实现业务能力 |
| Context Snapshot | P1 后续增强 | 无 | 不实现业务能力 |
| Context Replay Sandbox | P1 后续增强 | 无 | 不实现业务能力 |
| 多租户 SaaS | 明确不进入 V1 | 无 | 仅保留 workspace_id 等扩展字段，不实现租户业务 |
| Workspace 管理后台 | 明确不进入 V1 | 无 | 不实现业务能力 |
| 企业组织架构 | 明确不进入 V1 | 无 | 不实现业务能力 |
| 复杂 RBAC | 明确不进入 V1 | 无 | 不实现业务能力 |
| 计费系统 | 明确不进入 V1 | 无 | 不实现业务能力 |
| Marketplace | 明确不进入 V1 | 无 | 不实现业务能力 |
| 插件市场 | 明确不进入 V1 | 无 | 不实现业务能力 |
| Branch Merge | 明确不进入 V1 | 无 | 不实现业务能力 |
| Cherry-pick | 明确不进入 V1 | 无 | 不实现业务能力 |
| 多人实时协作 | 明确不进入 V1 | 无 | 不实现业务能力 |
| 完整发布审批流 | 明确不进入 V1 | 无 | 不实现业务能力 |
| 大型 Agent Evaluation 平台 | 明确不进入 V1 | 无 | 不实现业务能力 |
| 真正物理删除历史数据 | 明确不进入 V1 | 无 | V1 不提供物理删除历史业务 API |
| Desktop Client | 明确不进入 V1 | 无 | V1 不实现客户端；后端 API 与领域模型保持未来可复用 |
