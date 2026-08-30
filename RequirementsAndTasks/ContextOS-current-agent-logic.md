下面只基于当前代码实现，不基于设计文档推断；本次没有修改代码。

**1. 当前 Agent 整体实现方案**  
当前系统里有两条容易混淆的链路：

1. **Chat Agent 主链路**：自研 `ChatOrchestrator`，不是 LangGraph tool-calling agent。
2. **Template / Workflow 链路**：使用 `langgraph.graph.StateGraph` 编译 manifest，但目前只是通用节点状态流转，不是 Chat Agent 的 LLM + Tool loop。

关键入口：

* 前端发送：[studio/src/main.js (line 940)](C:/Users/Administrator/Documents/Projects/ContextOS/studio/src/main.js:940) `handleChatSubmit`
* 创建 User Message：[backend/src/contextos/api/server.py (line 432)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/api/server.py:432) `POST /api/sessions/{id}/messages`
* SSE Chat：[backend/src/contextos/api/server.py (line 357)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/api/server.py:357) `GET /sse/sessions/{id}/chat`
* Agent runtime：[orchestrator.py (line 24)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/runtime/conversation/orchestrator.py:24) `ChatOrchestrator.stream_runtime_events`
* LLM client：[deepseek_anthropic.py (line 65)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/provider/deepseek_anthropic.py:65) `stream_complete`

**2. Agent 完整调用链**  
真实 Chat 流程是：
    Frontend composer
    → POST /api/sessions/{sessionId}/messages
    → 校验 session/timeline
    → post_session_message()
    → role=user 时创建 ConversationGroup
    → MessageService.create_message(user)
    → 前端连接 GET /sse/sessions/{sessionId}/chat?timelineId=...
    → ChatOrchestrator.stream_runtime_events()
    → ConversationContextBuilder.build_llm_messages()
    → DeepSeekAnthropicClient.stream_complete() 或本地 fallback
    → token events
    → checkpoint event
    → done event
    → iter_chat_event_frames() 在 done 时创建 Assistant Message
    → append Assistant 到当前 ConversationGroup
    → TraceCollector.record_model_call()
    → SSE 返回前端
    → 前端增量渲染 Assistant

流程图：
    User Message
      ↓
    Session.current_timeline_id / request timelineId
      ↓
    ConversationGroup.start_turn()
      ↓
    MessageService: user message
      ↓
    SSE /chat
      ↓
    ConversationContextBuilder
      ↓
    LLM provider messages [{role, content}]
      ↓
    DeepSeek stream_complete / fallback
      ↓
    token → checkpoint → done
      ↓
    MessageService: assistant message
      ↓
    CheckpointStore + TraceCollector
      ↓
    Frontend message list render

**3. 当前已注册的 Tools 列表**  
结论：**当前没有真正注册到 Chat Agent、可被 LLM 自动调用的 Tool。**

| Tool | 作用                                    | 输入  | 输出  | 注册位置 | 调用方式 |
| ---- | ------------------------------------- | --- | --- | ---- | ---- |
| 无    | 当前 ChatOrchestrator 未接入 Tool executor | 无   | 无   | 无    | 无    |

存在但不是“已接入 Chat Agent 的 Tool”的内容：

| 名称                         | 当前真实状态                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `send_report_email`        | 只在 demo seed 里作为 trace/message 示例出现：[server.py (line 260)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/api/server.py:260)，没有实现和注册为可执行 Tool |
| `weather_lookup`           | 只在测试伪造 runtime event 中出现，不是实际注册 Tool                                                                                                                                     |
| `web_search`               | 只在 manifest validator 测试里作为 `ToolMetadata` 示例；默认 API 的 `ToolRegistry()` 是空的                                                                                              |
| `send_email`               | 只在 replay policy/manager 测试里通过注入 `ToolMetadata` 和 `tool_executor` 使用                                                                                                     |
| `orders.lookup` / `lookup` | 测试用例或 provider IR 示例，不是 runtime 注册 Tool                                                                                                                                  |

**4. Tool 注册机制**  
当前有 `ToolRegistry`，但它只是 metadata registry：

* [registry.py (line 5)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/tool/registry/registry.py:5)
* 支持 `register()` / `has()` / `get()`
* 未注册 tool 时，`get()` 会返回默认高风险写操作 metadata
* `RuntimeServices.tool_registry` 每次返回空 `ToolRegistry()`：[server.py (line 107)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/api/server.py:107)

Template validator 会检查 manifest node `config.tools` 是否存在于 registry，但默认 API registry 为空，所以这不是实际可调用工具注册。

**5. 是否使用 LangGraph**  
使用了，但范围有限：

* 依赖在 [backend/pyproject.toml (line 1)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/pyproject.toml:1)
* 实际使用在 [langgraph_compiler.py (line 4)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/template/compiler/langgraph_compiler.py:4)
* Chat 主链路没有使用 LangGraph
* 没有使用 LangGraph `ToolNode`
* 没有 LangGraph checkpointer
* 没有 `thread_id`

**6. LangGraph Graph 拓扑**  
真实拓扑不是固定 Agent loop，而是完全由 manifest edges 决定：
    manifest.graph.nodes
    → graph.add_node(node.id, _node_handler(node))

    manifest.graph.edges:
      if no condition:
        add_edge(source, target)
      if condition:
        add_conditional_edges(source, router, path_map)

    START / END:
      仅由 _endpoint() 映射到 LangGraph START / END

也就是说，当前没有固定的：
    Agent → ToolNode → Agent

真实编译逻辑：

* [langgraph_compiler.py (line 12)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/template/compiler/langgraph_compiler.py:12) `StateGraph(dict)`
* [langgraph_compiler.py (line 16)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/template/compiler/langgraph_compiler.py:16) `add_node`
* [langgraph_compiler.py (line 23)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/template/compiler/langgraph_compiler.py:23) `add_edge`
* [langgraph_compiler.py (line 28)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/template/compiler/langgraph_compiler.py:28) `add_conditional_edges`

**7. Graph Node / Edge 说明**

| Node             | 作用                                             | 输入 State | 输出 State                                 | 下一跳              |
| ---------------- | ---------------------------------------------- | -------- | ---------------------------------------- | ---------------- |
| 普通 node          | 记录 visited_nodes；如果配置 `output_key`，写入 `output` | `dict`   | `{...state, visited_nodes, output_key?}` | manifest edge 决定 |
| `human_approval` | 写入一个 `interrupt` 字段                            | `dict`   | `{...state, visited_nodes, interrupt}`   | manifest edge 决定 |
| START            | LangGraph 起点                                   | state    | state                                    | manifest edge    |
| END              | LangGraph 终点                                   | state    | final state                              | 无                |

条件路由：
    _router_for(node)
    → 读取 node.config.state_key，默认 "route"
    → 返回 state[state_key]
    → 匹配 edge.condition 到目标节点

**8. LangGraph State 结构**  
当前 LangGraph State 是裸 `dict`，没有强类型 schema。

实际字段来源：

* 调用方传入的 `graph_state`
* `CompiledManifestGraph.run()` 临时注入 `_runtime_context`
* 普通节点追加 `visited_nodes`
* 普通节点可能写入 `node.config.output_key`
* `human_approval` 写入 `interrupt`
* `ContinueService` 会加入 `message_revisions`

相关代码：

* [langgraph_compiler.py (line 37)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/template/compiler/langgraph_compiler.py:37)
* [continue_service.py (line 56)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/runtime/timeline/continue_service.py:56)
* [executor.py (line 36)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/runtime/graph/executor.py:36)

Chat 的 LLM messages 不在 LangGraph State 中；Chat 用的是 `ConversationContextBuilder.build_llm_messages()` 生成 provider messages。

**9. Checkpointer / Thread 机制**  
没有 LangGraph Checkpointer，也没有 `thread_id`。

当前是自研 checkpoint：

* Model：[checkpoint/model.py (line 5)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/runtime/checkpoint/model.py:5)
* Save：[checkpoint/service.py (line 16)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/runtime/checkpoint/service.py:16)
* Store：[checkpoint/store.py (line 7)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/runtime/checkpoint/store.py:7)

Checkpoint 字段：
    id
    session_id
    timeline_id
    graph_state
    message_cursor
    context_revision
    created_at
    parent_checkpoint_id

Chat 中 checkpoint 在 `ChatOrchestrator` 产出 `checkpoint` event 后，由 [routes/chat.py (line 82)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/api/routes/chat.py:82) 保存。

**10. Session / Timeline 与 Agent 的关系**  
`Session` 是对话容器，持有：
    id
    agent_template_id
    current_timeline_id
    title
    metadata

`Timeline` 是对话分支，持有：
    id
    session_id
    parent_timeline_id
    fork_checkpoint_id
    fork_message_id
    status
    title

Chat Agent 执行时：

* `session_id` 决定属于哪个 Session
* `timeline_id` 决定使用哪个分支的 groups/messages
* Context 构造只看当前 timeline 的 active groups：[context_builder.py (line 15)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/runtime/conversation/context_builder.py:15)

**11. 一个完整 ToolCall 示例**  
当前没有真实 LLM → Tool Executor → Tool → ToolResult → LLM 的完整执行链。

代码里能展示的是“如果 runtime_events 外部提供了 tool_call/tool_result，系统如何记录”：
    runtime_events yields tool_call
    → routes/chat.py 收集 call_id
    → TraceCollector.record_tool_call()
    → runtime_events yields tool_result
    → 收集 result_id
    → TraceCollector.record_tool_result()
    → done
    → Assistant Message 保存 tool_call_ids/tool_result_ids

关键位置：

* tool_call 处理：[routes/chat.py (line 56)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/api/routes/chat.py:56)
* tool_result 处理：[routes/chat.py (line 69)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/api/routes/chat.py:69)
* assistant 保存 tool ids：[routes/chat.py (line 96)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/api/routes/chat.py:96)
* trace 记录：[trace/collector.py (line 40)](C:/Users/Administrator/Documents/Projects/ContextOS/backend/src/contextos/runtime/trace/collector.py:40)

但当前 `ChatOrchestrator` 自身不会产生 tool_call/tool_result，也不会执行 tool。

**12. 当前明确存在的架构问题**  
明确存在的问题：

* **Chat Agent 与 LangGraph 是两套运行模型**：Chat 用 `ChatOrchestrator`，Workflow/Template 用 `LangGraphManifestCompiler`，两者没有统一 agent runtime。
* **没有真实 Tool execution loop**：有 ToolCall/ToolResult 的数据结构、trace、测试事件处理，但没有注册到 Chat Agent 的可执行 Tool。
* **Tool 注册逻辑未接入默认 runtime**：`RuntimeServices.tool_registry` 返回空 registry，API 层没有加载实际工具。
* **LLM Context 与 ToolResult 没有完整 provider 序列**：`ConversationContextBuilder` 只输出 user/assistant `{role, content}`，不会输出 tool role 或 tool_call payload。
* **Checkpoint 不是 LangGraph checkpoint**：当前 checkpoint 是自研持久化快照，和 LangGraph thread/checkpointer 没有绑定。
* **ChatOrchestrator 职责偏集中**：它同时负责构造 provider messages、调用 LLM、生成 token/checkpoint/done event，但还没抽象出 agent step/tool step。
* **ToolCall / ToolResult 原子性有限**：route 能把 tool ids 记录到 assistant message 和 trace，但没有真正的 tool executor 事务边界。
