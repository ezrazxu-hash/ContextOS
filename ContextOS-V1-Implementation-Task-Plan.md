
# ContextOS V1 Implementation Plan & Task Breakdown

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行。每个任务都必须形成独立的测试闭环并单独评审。

**Goal:** 把 ContextOS V1 PRD 拆成可以按顺序执行、测试、评审和跟踪状态的模块与子任务，最终通过 PRD 的 7 个 MVP 场景和 8 条 V1 成功标准。

**Architecture:** Web First、前后端分离、多客户端共享 Runtime；LangGraph 负责图执行，ContextOS 负责 Context Virtualization、ContextGroup、Allocator、Compiler、Restore、Revision、Replay Safety、Provider Adapter 和 Trace。Persistent History 是事实来源，Working Context 是当前模型真正使用的信息集合。

**Spec:** `ContextOS 产品需求与系统设计文档 V1.1 Draft`

## 实施默认技术栈（PRD 未锁死部分的计划假设）

- Backend：Python + LangGraph；HTTP 层按 FastAPI 风格组织 REST/SSE。
- Persistence：关系型持久化 + Repository/Service 抽象；真实仓库已有方案时优先沿用。
- Studio：React + TypeScript 作为默认实现；若真实仓库已选 Vue，只映射文件路径，不改变任务边界。
- Testing：pytest + 前端组件测试 + E2E；性能测试单独分层。
- Provider：V1 完整实现 OpenAI-compatible Adapter；其他 Provider 只保留扩展接口。

> 本文没有拿到实际代码仓库，因此 `Files / Touch Points` 是**建议的新项目路径**。执行 M00-T01 时应先和真实仓库对齐；如果已有既定目录/框架，沿用现有结构，不要为了匹配本文路径做无意义重构。

---

# 0. 状态与执行规则

| 状态 | 含义 |
|---|---|
| ⬜ Not Started | 尚未开始 |
| 🟨 In Progress | 正在实现/测试 |
| 🟦 Review | 实现完成，等待复核 |
| ✅ Done | 测试、验收、自审通过 |
| 🟥 Blocked | 被依赖、环境或设计决策阻塞 |

每个任务执行时遵循：

- [ ] 先读 PRD 对应章节、全局约束和本任务依赖。
- [ ] 先写能够证明目标行为的失败测试。
- [ ] 运行测试并确认失败来自缺失能力，而不是环境错误。
- [ ] 做满足本任务的最小实现，不顺手扩展相邻任务。
- [ ] 运行本任务测试并修到通过。
- [ ] 运行受影响模块回归测试。
- [ ] 检查 Revision / Trace / Persistence / Compiler / Replay 等全局不变量。
- [ ] 自审后状态改为 `🟦 Review`；评审与验收通过改为 `✅ Done`。
- [ ] 每个任务单独提交，避免把多个任务混入一个 commit。

# 1. 全局约束

- **G-01 Full History != LLM Context**：Persistent History 与 Working Context 是两个概念。
- **G-02 原始历史不可静默覆盖**：用户编辑、摘要、淘汰、恢复都必须保留原始内容并产生 Revision。
- **G-03 上下文压缩默认可逆**：Evict 不是 Delete；V1 不提供真正物理删除历史的业务能力。
- **G-04 ContextGroup 优先于 Message**：ToolCall/ToolResult、Agent Step、Human Approval 等逻辑单元必须保持完整。
- **G-05 Allocator 与 Compiler 分离**：Allocator 决定“模型看什么”；Compiler 决定“如何合法发给 Provider”。
- **G-06 Provider-neutral**：ContextOS 核心 IR 不直接绑定某一家 Provider Schema。
- **G-07 Context Compiler 唯一出口**：任何 Provider 调用前都必须完成 Group、Tool、Role、Placeholder、Provider Constraint、Token 校验。
- **G-08 Backend Source of Truth**：Session/Timeline/Checkpoint/Message Revision/Context/LangGraph State/Tool/Replay Policy 等事实状态必须在后端。
- **G-09 REST/SSE/WS 按场景使用**：CRUD=REST；LLM Stream=SSE；双向 Interrupt/Debug 才按需 WS。
- **G-10 Replay 保守策略**：未知 Tool 默认 WRITE；WRITE/EXTERNAL_WRITE/DESTRUCTIVE/FINANCIAL 未二次确认不得重新调用。
- **G-11 V1 YAGNI**：不实现 Semantic Restore、Branch Merge、复杂 RBAC、Marketplace、多租户 SaaS、Desktop Client 等 P1/V1 外业务。
- **G-12 Client Rehydrate**：刷新、断线、重启客户端后，必须从后端恢复 Session/Timeline/Checkpoint/Revision/Context 状态。
- **G-13 幂等**：Replay、Restore、Checkpoint 等写操作支持 request_id/idempotency_key。
- **G-14 Trace**：所有 Agent 执行都有 Trace ID，关键 Context/Tool/Replay/Checkpoint 行为可观察。

# 2. 推荐里程碑

| 里程碑 | 模块 | 阶段性结果 |
|---|---|---|
| M0 | M00 | 工程、API、测试基线稳定 |
| M1 | M01 | Session/Timeline/Checkpoint/Trace 可执行和恢复 |
| M2 | M02 | ContextItem/Group/Revision/Placeholder 可逆操作 |
| M3 | M03 | Provider Payload 只能经 ContextCompiler 合法生成 |
| M4 | M04 | Chat/Stream/Tool/Context Panel 可用 |
| M5 | M05 | 历史 AI Message 可编辑并产生新 Timeline |
| M6 | M06 | Impact + Replay Safety 闭环 |
| M7 | M07 | Agent 可 Search/Restore，超预算可 Reallocate |
| M8 | M08 | Manifest/Template/Workflow 可编译运行 |
| M9 | M09 | Debug 能解释 Runtime 行为并有性能基线 |
| RC | M10 | 7 个 MVP 场景 + 8 条成功标准通过 |

# 3. 建议目录边界

```text
backend/src/contextos/
├── runtime/{graph,session,timeline,checkpoint,trace,debug}
├── context/{model,group,allocator,compiler,restore,revision,policy}
├── provider/{base,openai_compatible}
├── tool/{executor,registry,risk,replay}
├── template/{manifest,validator,compiler,extension}
└── api/

backend/tests/{unit,integration,e2e,performance}

studio/src/
├── pages/{Chat,Workflow,Template,Debug}
├── features/{conversation,context-panel,message-editor,impact-analyzer,replay,timeline,workflow-builder,trace}
└── shared/
```

# 4. 单任务 Agent Prompt 组合方式

执行某个任务时，使用“**全局 Prompt 头 + 任务专属 Prompt**”。

```text
你正在实现 ContextOS V1，只完成当前任务，不顺手扩展 P1/V1 外能力。

必须遵守：
1. Persistent History 是事实来源，Working Context 只是模型当前工作集；不得静默覆盖原始历史。
2. ContextGroup 是默认操作原子，ToolCall/ToolResult 必须保持逻辑完整。
3. Context Allocator 与 Context Compiler 分离。
4. 任意 Provider 调用必须经过 Context Compiler。
5. 后端是 Session/Timeline/Checkpoint/Revision/Context/Tool/Replay 的唯一事实来源。
6. 未知 Tool 按 WRITE 处理，高风险 Replay 未确认不得执行。
7. 先写失败测试，确认失败，再做最小实现，最后运行相关回归测试。
8. 不做无关重构；发现超出本任务的问题只记录，不直接实现。

完成后输出：修改文件、核心设计、测试命令和结果、风险/依赖、建议任务状态。
```

---

# M00 · 工程基线与实施约束

**模块状态：** ✅ Done  
**依赖：** 无  
**模块目标：** 锁定 P0 范围、模块边界、建议目录、API 约定和测试门禁，为后续所有开发提供统一地基。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M00-T01 · PRD→实施范围映射

**状态：** ✅ Done  
**目标：** 把 P0-1～P0-9、MVP 场景、成功标准映射到模块与任务，明确 P1/V1 外范围。  
**依赖：** 无

**Files / Touch Points**

- `docs/implementation/contextos-v1-scope-map.md`
- `docs/implementation/architecture-decisions.md`

**交付物 / 验收标准**

- [x] 每个 P0 条目至少映射到一个实施任务
- [x] 多租户、Branch Merge、Desktop Client 等明确标记为 V1 不实现
- [x] 记录本文建议技术栈属于实施默认值，真实仓库已有约定时优先沿用

**测试用例**

- [x] `M00-T01-TC01`：逐条核对 P0-1～P0-9 无遗漏
- [x] `M00-T01-TC02`：抽查 V1 明确不实现项未出现在实施任务中

**任务专属 Prompt**

```text
实现任务 M00-T01《PRD→实施范围映射》。
目标：把 P0-1～P0-9、MVP 场景、成功标准映射到模块与任务，明确 P1/V1 外范围。
依赖：无。
仅在以下建议触点或真实仓库对应职责文件内工作：docs/implementation/contextos-v1-scope-map.md、docs/implementation/architecture-decisions.md。
必须满足的验收条件：每个 P0 条目至少映射到一个实施任务；多租户、Branch Merge、Desktop Client 等明确标记为 V1 不实现；记录本文建议技术栈属于实施默认值，真实仓库已有约定时优先沿用。
至少覆盖这些测试：逐条核对 P0-1～P0-9 无遗漏；抽查 V1 明确不实现项未出现在实施任务中。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M00-T02 · 后端包结构骨架

**状态：** ✅ Done  
**目标：** 按 runtime/context/provider/tool/template/api 建立后端模块边界，核心 Runtime 不依赖 Web。  
**依赖：** M00-T01

**Files / Touch Points**

- `backend/pyproject.toml`
- `backend/src/contextos/runtime/`
- `backend/src/contextos/context/`
- `backend/src/contextos/provider/`
- `backend/src/contextos/tool/`
- `backend/src/contextos/template/`
- `backend/src/contextos/api/`

**交付物 / 验收标准**

- [x] 各包职责单一且可独立导入
- [x] context/runtime 不引用 studio/browser 代码
- [x] Provider SDK 不成为 ContextOS 核心领域模型依赖

**测试用例**

- [x] `M00-T02-TC01`：import contextos 成功
- [x] `M00-T02-TC02`：核心包循环依赖检查通过
- [x] `M00-T02-TC03`：不启动 Web Server 也可运行 runtime/context 单测

**任务专属 Prompt**

```text
实现任务 M00-T02《后端包结构骨架》。
目标：按 runtime/context/provider/tool/template/api 建立后端模块边界，核心 Runtime 不依赖 Web。
依赖：M00-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/pyproject.toml、backend/src/contextos/runtime/、backend/src/contextos/context/、backend/src/contextos/provider/、backend/src/contextos/tool/、backend/src/contextos/template/、backend/src/contextos/api/。
必须满足的验收条件：各包职责单一且可独立导入；context/runtime 不引用 studio/browser 代码；Provider SDK 不成为 ContextOS 核心领域模型依赖。
至少覆盖这些测试：import contextos 成功；核心包循环依赖检查通过；不启动 Web Server 也可运行 runtime/context 单测。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M00-T03 · Studio Web 骨架

**状态：** ✅ Done  
**目标：** 建立 Chat/Workflow/Template/Debug 四个 V1 页面，并区分 UI 临时状态与后端事实状态。  
**依赖：** M00-T01

**Files / Touch Points**

- `studio/package.json`
- `studio/src/pages/Chat/`
- `studio/src/pages/Workflow/`
- `studio/src/pages/Template/`
- `studio/src/pages/Debug/`
- `studio/src/features/`

**交付物 / 验收标准**

- [x] 四个页面可路由
- [x] selectedMessageId/currentPanel/graphViewport 可本地维护
- [x] Timeline/Checkpoint/Context 不以 localStorage 作为唯一事实来源

**测试用例**

- [x] `M00-T03-TC01`：四路由可加载
- [x] `M00-T03-TC02`：清空浏览器本地缓存后仍能从后端投影恢复核心状态

**任务专属 Prompt**

```text
实现任务 M00-T03《Studio Web 骨架》。
目标：建立 Chat/Workflow/Template/Debug 四个 V1 页面，并区分 UI 临时状态与后端事实状态。
依赖：M00-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/package.json、studio/src/pages/Chat/、studio/src/pages/Workflow/、studio/src/pages/Template/、studio/src/pages/Debug/、studio/src/features/。
必须满足的验收条件：四个页面可路由；selectedMessageId/currentPanel/graphViewport 可本地维护；Timeline/Checkpoint/Context 不以 localStorage 作为唯一事实来源。
至少覆盖这些测试：四路由可加载；清空浏览器本地缓存后仍能从后端投影恢复核心状态。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M00-T04 · REST/SSE/幂等与错误契约

**状态：** ✅ Done  
**目标：** 定义普通 CRUD、流式输出、双向调试的协议边界及 request_id/idempotency_key。  
**依赖：** M00-T02

**Files / Touch Points**

- `backend/src/contextos/api/contracts/common.py`
- `backend/src/contextos/api/errors.py`
- `backend/src/contextos/api/idempotency.py`
- `docs/implementation/api-conventions.md`

**交付物 / 验收标准**

- [x] CRUD 使用 REST
- [x] LLM 流式输出使用 SSE
- [x] WebSocket 仅按需用于 Interrupt/双向调试
- [x] Replay/Restore/Checkpoint 类写操作具有幂等入口

**测试用例**

- [x] `M00-T04-TC01`：同一 idempotency_key 重复请求不产生第二次写入
- [x] `M00-T04-TC02`：request_id 能关联 Trace
- [x] `M00-T04-TC03`：REST/SSE 错误可统一解析

**任务专属 Prompt**

```text
实现任务 M00-T04《REST/SSE/幂等与错误契约》。
目标：定义普通 CRUD、流式输出、双向调试的协议边界及 request_id/idempotency_key。
依赖：M00-T02。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/api/contracts/common.py、backend/src/contextos/api/errors.py、backend/src/contextos/api/idempotency.py、docs/implementation/api-conventions.md。
必须满足的验收条件：CRUD 使用 REST；LLM 流式输出使用 SSE；WebSocket 仅按需用于 Interrupt/双向调试；Replay/Restore/Checkpoint 类写操作具有幂等入口。
至少覆盖这些测试：同一 idempotency_key 重复请求不产生第二次写入；request_id 能关联 Trace；REST/SSE 错误可统一解析。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M00-T05 · 测试分层与 CI 门禁

**状态：** ✅ Done  
**目标：** 建立 unit/integration/e2e/performance 测试入口，保证后续任务可按 TDD 交付。  
**依赖：** M00-T02,M00-T03

**Files / Touch Points**

- `backend/tests/unit/`
- `backend/tests/integration/`
- `backend/tests/e2e/`
- `backend/tests/performance/`
- `studio/e2e/`
- `.github/workflows/ci.yml`

**交付物 / 验收标准**

- [x] 后端单元/集成可独立执行
- [x] 前端组件/E2E 有统一命令
- [x] CI 至少运行 lint/typecheck/unit/integration

**测试用例**

- [x] `M00-T05-TC01`：故意失败断言能使 CI 失败
- [x] `M00-T05-TC02`：正常基线全部测试通过
- [x] `M00-T05-TC03`：E2E 可一条命令启动测试依赖并运行

**任务专属 Prompt**

```text
实现任务 M00-T05《测试分层与 CI 门禁》。
目标：建立 unit/integration/e2e/performance 测试入口，保证后续任务可按 TDD 交付。
依赖：M00-T02,M00-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/tests/unit/、backend/tests/integration/、backend/tests/e2e/、backend/tests/performance/、studio/e2e/、.github/workflows/ci.yml。
必须满足的验收条件：后端单元/集成可独立执行；前端组件/E2E 有统一命令；CI 至少运行 lint/typecheck/unit/integration。
至少覆盖这些测试：故意失败断言能使 CI 失败；正常基线全部测试通过；E2E 可一条命令启动测试依赖并运行。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


# M01 · Runtime Foundation：Session / Timeline / Checkpoint / Trace

**模块状态：** ✅ Done  
**依赖：** M00  
**模块目标：** 形成可恢复、可追踪的 LangGraph 执行底座，后端成为 Agent 运行状态唯一事实来源。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M01-T01 · Session 模型、Repository、Service、API

**状态：** ✅ Done  
**目标：** 实现 Session 创建/读取及 agent_template/current_timeline/status 等基础字段。  
**依赖：** M00-T04

**Files / Touch Points**

- `backend/src/contextos/runtime/session/model.py`
- `backend/src/contextos/runtime/session/repository.py`
- `backend/src/contextos/runtime/session/service.py`
- `backend/src/contextos/api/routes/sessions.py`

**交付物 / 验收标准**

- [x] 支持 id/workspace_id/agent_template_id/current_timeline_id/created_at/status
- [x] workspace_id 只做预留，不实现多租户
- [x] 提供 POST/GET Session API

**测试用例**

- [x] `M01-T01-TC01`：创建后读取字段一致
- [x] `M01-T01-TC02`：不存在 Session 返回稳定 404
- [x] `M01-T01-TC03`：workspace_id 为空不触发租户逻辑

**任务专属 Prompt**

```text
实现任务 M01-T01《Session 模型、Repository、Service、API》。
目标：实现 Session 创建/读取及 agent_template/current_timeline/status 等基础字段。
依赖：M00-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/session/model.py、backend/src/contextos/runtime/session/repository.py、backend/src/contextos/runtime/session/service.py、backend/src/contextos/api/routes/sessions.py。
必须满足的验收条件：支持 id/workspace_id/agent_template_id/current_timeline_id/created_at/status；workspace_id 只做预留，不实现多租户；提供 POST/GET Session API。
至少覆盖这些测试：创建后读取字段一致；不存在 Session 返回稳定 404；workspace_id 为空不触发租户逻辑。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M01-T02 · Timeline 轻量分叉

**状态：** ✅ Done  
**目标：** 实现 parent_timeline/fork_checkpoint/fork_message 和激活，不引入 Git Merge/Cherry-pick。  
**依赖：** M01-T01

**Files / Touch Points**

- `backend/src/contextos/runtime/timeline/model.py`
- `backend/src/contextos/runtime/timeline/repository.py`
- `backend/src/contextos/runtime/timeline/service.py`
- `backend/src/contextos/api/routes/timelines.py`

**交付物 / 验收标准**

- [x] 支持列表/读取/激活
- [x] fork 后父 Timeline 不变
- [x] Session.current_timeline_id 可切换

**测试用例**

- [x] `M01-T02-TC01`：A→B fork 关系正确
- [x] `M01-T02-TC02`：激活 B 后 Session 指针更新
- [x] `M01-T02-TC03`：原 A 数据仍可查看

**任务专属 Prompt**

```text
实现任务 M01-T02《Timeline 轻量分叉》。
目标：实现 parent_timeline/fork_checkpoint/fork_message 和激活，不引入 Git Merge/Cherry-pick。
依赖：M01-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/timeline/model.py、backend/src/contextos/runtime/timeline/repository.py、backend/src/contextos/runtime/timeline/service.py、backend/src/contextos/api/routes/timelines.py。
必须满足的验收条件：支持列表/读取/激活；fork 后父 Timeline 不变；Session.current_timeline_id 可切换。
至少覆盖这些测试：A→B fork 关系正确；激活 B 后 Session 指针更新；原 A 数据仍可查看。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M01-T03 · LangGraph Checkpoint 适配

**状态：** ✅ Done  
**目标：** 复用 LangGraph Checkpoint 保存可恢复 graph_state，并附带 message_cursor/context_revision。  
**依赖：** M01-T02

**Files / Touch Points**

- `backend/src/contextos/runtime/checkpoint/model.py`
- `backend/src/contextos/runtime/checkpoint/store.py`
- `backend/src/contextos/runtime/checkpoint/service.py`

**交付物 / 验收标准**

- [x] Checkpoint 与 session/timeline 绑定
- [x] 保存 graph_state/message_cursor/context_revision/parent_checkpoint_id
- [x] 可按 checkpoint_id 恢复

**测试用例**

- [x] `M01-T03-TC01`：运行一步生成 Checkpoint
- [x] `M01-T03-TC02`：恢复得到相同 graph_state
- [x] `M01-T03-TC03`：读取旧 Checkpoint 不修改快照

**任务专属 Prompt**

```text
实现任务 M01-T03《LangGraph Checkpoint 适配》。
目标：复用 LangGraph Checkpoint 保存可恢复 graph_state，并附带 message_cursor/context_revision。
依赖：M01-T02。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/checkpoint/model.py、backend/src/contextos/runtime/checkpoint/store.py、backend/src/contextos/runtime/checkpoint/service.py。
必须满足的验收条件：Checkpoint 与 session/timeline 绑定；保存 graph_state/message_cursor/context_revision/parent_checkpoint_id；可按 checkpoint_id 恢复。
至少覆盖这些测试：运行一步生成 Checkpoint；恢复得到相同 graph_state；读取旧 Checkpoint 不修改快照。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M01-T04 · Runtime Executor

**状态：** ✅ Done  
**目标：** 建立统一 run/continue 执行入口，把 Session/Timeline/Checkpoint 接到 LangGraph。  
**依赖：** M01-T03

**Files / Touch Points**

- `backend/src/contextos/runtime/graph/executor.py`
- `backend/src/contextos/runtime/graph/runtime_context.py`

**交付物 / 验收标准**

- [x] 每次执行携带 session_id/timeline_id/trace_id
- [x] 正常完成产生 Checkpoint
- [x] 异常不污染已完成 Checkpoint
- [x] 预留 ContextCompiler 接口且不直接构造 Provider Payload

**测试用例**

- [x] `M01-T04-TC01`：最小两节点图完整执行
- [x] `M01-T04-TC02`：运行上下文含 session/timeline/trace
- [x] `M01-T04-TC03`：异常执行状态可恢复

**任务专属 Prompt**

```text
实现任务 M01-T04《Runtime Executor》。
目标：建立统一 run/continue 执行入口，把 Session/Timeline/Checkpoint 接到 LangGraph。
依赖：M01-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/graph/executor.py、backend/src/contextos/runtime/graph/runtime_context.py。
必须满足的验收条件：每次执行携带 session_id/timeline_id/trace_id；正常完成产生 Checkpoint；异常不污染已完成 Checkpoint；预留 ContextCompiler 接口且不直接构造 Provider Payload。
至少覆盖这些测试：最小两节点图完整执行；运行上下文含 session/timeline/trace；异常执行状态可恢复。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M01-T05 · Trace Collector

**状态：** ✅ Done  
**目标：** 记录 Model/Tool/State/Context/Checkpoint/Replay/User Override 等事件。  
**依赖：** M01-T04

**Files / Touch Points**

- `backend/src/contextos/runtime/trace/model.py`
- `backend/src/contextos/runtime/trace/collector.py`
- `backend/src/contextos/runtime/trace/repository.py`
- `backend/src/contextos/api/routes/trace.py`

**交付物 / 验收标准**

- [x] Trace 字段覆盖 PRD 24 章要求
- [x] 按 Session/Message/Trace 查询
- [x] 大输入默认摘要而非复制全文

**测试用例**

- [x] `M01-T05-TC01`：模型调用产生 Model Call Trace
- [x] `M01-T05-TC02`：Tool 产生 Call+Result Trace
- [x] `M01-T05-TC03`：失败事件记录 failed 与 duration

**任务专属 Prompt**

```text
实现任务 M01-T05《Trace Collector》。
目标：记录 Model/Tool/State/Context/Checkpoint/Replay/User Override 等事件。
依赖：M01-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/trace/model.py、backend/src/contextos/runtime/trace/collector.py、backend/src/contextos/runtime/trace/repository.py、backend/src/contextos/api/routes/trace.py。
必须满足的验收条件：Trace 字段覆盖 PRD 24 章要求；按 Session/Message/Trace 查询；大输入默认摘要而非复制全文。
至少覆盖这些测试：模型调用产生 Model Call Trace；Tool 产生 Call+Result Trace；失败事件记录 failed 与 duration。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M01-T06 · 客户端 Rehydrate Snapshot

**状态：** ✅ Done  
**目标：** 提供 Web 刷新/重连后从后端恢复 Runtime 状态的聚合读取。  
**依赖：** M01-T05

**Files / Touch Points**

- `backend/src/contextos/runtime/session/snapshot_service.py`
- `backend/src/contextos/api/routes/runtime_snapshot.py`

**交付物 / 验收标准**

- [x] Snapshot 返回当前 Session/Timeline/Checkpoint 指针/消息索引/Trace 摘要
- [x] 不复制出第二份事实状态

**测试用例**

- [x] `M01-T06-TC01`：清空浏览器状态后可恢复当前 Session
- [x] `M01-T06-TC02`：服务端重启后持久化状态仍可读取

**任务专属 Prompt**

```text
实现任务 M01-T06《客户端 Rehydrate Snapshot》。
目标：提供 Web 刷新/重连后从后端恢复 Runtime 状态的聚合读取。
依赖：M01-T05。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/session/snapshot_service.py、backend/src/contextos/api/routes/runtime_snapshot.py。
必须满足的验收条件：Snapshot 返回当前 Session/Timeline/Checkpoint 指针/消息索引/Trace 摘要；不复制出第二份事实状态。
至少覆盖这些测试：清空浏览器状态后可恢复当前 Session；服务端重启后持久化状态仍可读取。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


# M02 · Context Core：Item / Group / Revision / Placeholder

**模块状态：** ✅ Done  
**依赖：** M01  
**模块目标：** 建立可逆、可审计、以 ContextGroup 为默认原子的上下文核心。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M02-T01 · ContextItem 与状态枚举

**状态：** ✅ Done  
**目标：** 实现 type/state/raw/generated/user_override/effective_content/token/priority/restorable 等字段。  
**依赖：** M01-T01

**Files / Touch Points**

- `backend/src/contextos/context/model/item.py`
- `backend/src/contextos/context/model/enums.py`

**交付物 / 验收标准**

- [x] type 覆盖 MESSAGE/TOOL_CALL/TOOL_RESULT/SUMMARY/MEMORY/RESOURCE/SYSTEM/PLACEHOLDER
- [x] state 覆盖 RAW/ABSTRACT/REFERENCE/EVICTED/PINNED
- [x] effective_content=user_override??generated_content??raw_content

**测试用例**

- [x] `M02-T01-TC01`：user_override 优先级最高
- [x] `M02-T01-TC02`：generated_content 次之
- [x] `M02-T01-TC03`：任何状态切换不覆盖 raw_content

**任务专属 Prompt**

```text
实现任务 M02-T01《ContextItem 与状态枚举》。
目标：实现 type/state/raw/generated/user_override/effective_content/token/priority/restorable 等字段。
依赖：M01-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/model/item.py、backend/src/contextos/context/model/enums.py。
必须满足的验收条件：type 覆盖 MESSAGE/TOOL_CALL/TOOL_RESULT/SUMMARY/MEMORY/RESOURCE/SYSTEM/PLACEHOLDER；state 覆盖 RAW/ABSTRACT/REFERENCE/EVICTED/PINNED；effective_content=user_override??generated_content??raw_content。
至少覆盖这些测试：user_override 优先级最高；generated_content 次之；任何状态切换不覆盖 raw_content。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M02-T02 · ContextRevision 审计链

**状态：** ✅ Done  
**目标：** 所有 User Edit/Abstract/Evict/Restore/Pin/Unpin 以追加 Revision 的方式记录。  
**依赖：** M02-T01

**Files / Touch Points**

- `backend/src/contextos/context/revision/model.py`
- `backend/src/contextos/context/revision/repository.py`
- `backend/src/contextos/context/revision/service.py`

**交付物 / 验收标准**

- [x] revision_type 覆盖 PRD 27 章
- [x] 记录 old/new/operator/reason/created_at
- [x] 恢复系统版本不删除旧 Revision

**测试用例**

- [x] `M02-T02-TC01`：连续编辑 Revision 链完整
- [x] `M02-T02-TC02`：恢复后仍可读取所有历史版本

**任务专属 Prompt**

```text
实现任务 M02-T02《ContextRevision 审计链》。
目标：所有 User Edit/Abstract/Evict/Restore/Pin/Unpin 以追加 Revision 的方式记录。
依赖：M02-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/revision/model.py、backend/src/contextos/context/revision/repository.py、backend/src/contextos/context/revision/service.py。
必须满足的验收条件：revision_type 覆盖 PRD 27 章；记录 old/new/operator/reason/created_at；恢复系统版本不删除旧 Revision。
至少覆盖这些测试：连续编辑 Revision 链完整；恢复后仍可读取所有历史版本。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M02-T03 · ContextGroup 与原子性不变量

**状态：** ✅ Done  
**目标：** 实现 group_type/item_ids/atomic/state/summary/tokens/restorable/dependencies。  
**依赖：** M02-T01

**Files / Touch Points**

- `backend/src/contextos/context/group/model.py`
- `backend/src/contextos/context/group/invariants.py`

**交付物 / 验收标准**

- [x] group_type 覆盖 V1 七类
- [x] V1 不开放自由拆分/合并
- [x] atomic Group 状态操作整体执行

**测试用例**

- [x] `M02-T03-TC01`：atomic Tool Group 不允许只修改单成员
- [x] `M02-T03-TC02`：引用不存在 ContextItem 时校验失败

**任务专属 Prompt**

```text
实现任务 M02-T03《ContextGroup 与原子性不变量》。
目标：实现 group_type/item_ids/atomic/state/summary/tokens/restorable/dependencies。
依赖：M02-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/group/model.py、backend/src/contextos/context/group/invariants.py。
必须满足的验收条件：group_type 覆盖 V1 七类；V1 不开放自由拆分/合并；atomic Group 状态操作整体执行。
至少覆盖这些测试：atomic Tool Group 不允许只修改单成员；引用不存在 ContextItem 时校验失败。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M02-T04 · Tool Interaction 自动分组

**状态：** ✅ Done  
**目标：** 按 tool_call_id 将 Assistant ToolCall、ToolResult、相关 continuation 组成完整 Group。  
**依赖：** M02-T03

**Files / Touch Points**

- `backend/src/contextos/context/group/tool_interaction_grouper.py`

**交付物 / 验收标准**

- [x] 单 ToolCall 完整成组
- [x] 多 ToolCall 结果乱序仍正确配对
- [x] 缺 Result 时标记 incomplete 且不可作为合法完成序列发送

**测试用例**

- [x] `M02-T04-TC01`：A→ResultA→continuation 成组
- [x] `M02-T04-TC02`：Call A/B + Result B/A 映射正确
- [x] `M02-T04-TC03`：缺 Result B 时不静默丢弃 B

**任务专属 Prompt**

```text
实现任务 M02-T04《Tool Interaction 自动分组》。
目标：按 tool_call_id 将 Assistant ToolCall、ToolResult、相关 continuation 组成完整 Group。
依赖：M02-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/group/tool_interaction_grouper.py。
必须满足的验收条件：单 ToolCall 完整成组；多 ToolCall 结果乱序仍正确配对；缺 Result 时标记 incomplete 且不可作为合法完成序列发送。
至少覆盖这些测试：A→ResultA→continuation 成组；Call A/B + Result B/A 映射正确；缺 Result B 时不静默丢弃 B。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M02-T05 · Agent Step / Human Approval 分组

**状态：** ✅ Done  
**目标：** 按 node execution 与 approval lifecycle 形成逻辑完整 Group。  
**依赖：** M02-T03

**Files / Touch Points**

- `backend/src/contextos/context/group/agent_step_grouper.py`
- `backend/src/contextos/context/group/approval_grouper.py`

**交付物 / 验收标准**

- [x] AGENT_STEP 可关联 Model/Tool/State/Assistant
- [x] HUMAN_APPROVAL 保持 request/approve-or-reject/related execution 完整

**测试用例**

- [x] `M02-T05-TC01`：同一 Node 事件成组
- [x] `M02-T05-TC02`：不同 Node 不误合并
- [x] `M02-T05-TC03`：Approval Request/Reject 不可分别 Evict

**任务专属 Prompt**

```text
实现任务 M02-T05《Agent Step / Human Approval 分组》。
目标：按 node execution 与 approval lifecycle 形成逻辑完整 Group。
依赖：M02-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/group/agent_step_grouper.py、backend/src/contextos/context/group/approval_grouper.py。
必须满足的验收条件：AGENT_STEP 可关联 Model/Tool/State/Assistant；HUMAN_APPROVAL 保持 request/approve-or-reject/related execution 完整。
至少覆盖这些测试：同一 Node 事件成组；不同 Node 不误合并；Approval Request/Reject 不可分别 Evict。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M02-T06 · Placeholder 一级领域对象

**状态：** ✅ Done  
**目标：** 为 EVICTED/REFERENCE Group 生成结构化、可反查来源的 Placeholder。  
**依赖：** M02-T03

**Files / Touch Points**

- `backend/src/contextos/context/model/placeholder.py`
- `backend/src/contextos/context/group/placeholder_service.py`

**交付物 / 验收标准**

- [x] 字段包含 id/group_id/type/summary/source_count/original_tokens/current_tokens/restorable/reason
- [x] 能反查原 Group
- [x] 可供 Compiler 渲染

**测试用例**

- [x] `M02-T06-TC01`：Evict 后 Placeholder source_count/token 正确
- [x] `M02-T06-TC02`：group_id 可恢复原 Group

**任务专属 Prompt**

```text
实现任务 M02-T06《Placeholder 一级领域对象》。
目标：为 EVICTED/REFERENCE Group 生成结构化、可反查来源的 Placeholder。
依赖：M02-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/model/placeholder.py、backend/src/contextos/context/group/placeholder_service.py。
必须满足的验收条件：字段包含 id/group_id/type/summary/source_count/original_tokens/current_tokens/restorable/reason；能反查原 Group；可供 Compiler 渲染。
至少覆盖这些测试：Evict 后 Placeholder source_count/token 正确；group_id 可恢复原 Group。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M02-T07 · ContextGroup 状态机与 Service

**状态：** ✅ Done  
**目标：** 实现 Pin/Unpin/Abstract/Evict/Restore/Edit/ViewRaw，所有修改记录 Revision。  
**依赖：** M02-T02,M02-T06

**Files / Touch Points**

- `backend/src/contextos/context/policy/state_machine.py`
- `backend/src/contextos/context/group/service.py`

**交付物 / 验收标准**

- [x] Evict 不删除 Persistent History
- [x] Abstract 写 generated_content
- [x] Restore 可重新进入 Working Context
- [x] atomic 操作事务整体提交或回滚

**测试用例**

- [x] `M02-T07-TC01`：Evict 后 raw 仍可 View Raw
- [x] `M02-T07-TC02`：Abstract 后 effective 内容正确
- [x] `M02-T07-TC03`：失败时不存在半个 Group 已修改

**任务专属 Prompt**

```text
实现任务 M02-T07《ContextGroup 状态机与 Service》。
目标：实现 Pin/Unpin/Abstract/Evict/Restore/Edit/ViewRaw，所有修改记录 Revision。
依赖：M02-T02,M02-T06。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/policy/state_machine.py、backend/src/contextos/context/group/service.py。
必须满足的验收条件：Evict 不删除 Persistent History；Abstract 写 generated_content；Restore 可重新进入 Working Context；atomic 操作事务整体提交或回滚。
至少覆盖这些测试：Evict 后 raw 仍可 View Raw；Abstract 后 effective 内容正确；失败时不存在半个 Group 已修改。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M02-T08 · Context REST API 与 Projection

**状态：** ✅ Done  
**目标：** 实现 Context 列表、Group 操作、Item Edit/Raw/Revisions API。  
**依赖：** M02-T07

**Files / Touch Points**

- `backend/src/contextos/api/routes/context.py`
- `backend/src/contextos/context/projection.py`

**交付物 / 验收标准**

- [x] 覆盖 PRD 32.4 API
- [x] 返回 state/token/group/restorable 等 UI 投影
- [x] API 只调用 Context Service

**测试用例**

- [x] `M02-T08-TC01`：Evict atomic Group 整体成功或失败
- [x] `M02-T08-TC02`：Raw 永远读 Persistent History
- [x] `M02-T08-TC03`：修改后 revisions API 可见新记录

**任务专属 Prompt**

```text
实现任务 M02-T08《Context REST API 与 Projection》。
目标：实现 Context 列表、Group 操作、Item Edit/Raw/Revisions API。
依赖：M02-T07。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/api/routes/context.py、backend/src/contextos/context/projection.py。
必须满足的验收条件：覆盖 PRD 32.4 API；返回 state/token/group/restorable 等 UI 投影；API 只调用 Context Service。
至少覆盖这些测试：Evict atomic Group 整体成功或失败；Raw 永远读 Persistent History；修改后 revisions API 可见新记录。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


# M03 · Context Compiler / Provider Adapter

**模块状态：** ✅ Done  
**依赖：** M02  
**模块目标：** 建立唯一 Provider 出口，保证 Working Context 在完整性、角色、Tool、Placeholder、Provider 和 Token 层面合法。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M03-T01 · Provider-neutral ContextOS IR

**状态：** ✅ Done  
**目标：** 定义 SystemInstruction/UserMessage/AssistantMessage/ToolCall/ToolResult/ContextPlaceholder/ContextReference。  
**依赖：** M02-T01

**Files / Touch Points**

- `backend/src/contextos/provider/base/ir.py`

**交付物 / 验收标准**

- [x] IR 不依赖具体厂商 SDK
- [x] Tool Call/Result 保留稳定关联 ID
- [x] Placeholder/Reference 是一等类型

**测试用例**

- [x] `M03-T01-TC01`：IR 可序列化
- [x] `M03-T01-TC02`：无 OpenAI/Anthropic SDK 类型依赖
- [x] `M03-T01-TC03`：ToolResult 缺 call id 时构造失败

**任务专属 Prompt**

```text
实现任务 M03-T01《Provider-neutral ContextOS IR》。
目标：定义 SystemInstruction/UserMessage/AssistantMessage/ToolCall/ToolResult/ContextPlaceholder/ContextReference。
依赖：M02-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/provider/base/ir.py。
必须满足的验收条件：IR 不依赖具体厂商 SDK；Tool Call/Result 保留稳定关联 ID；Placeholder/Reference 是一等类型。
至少覆盖这些测试：IR 可序列化；无 OpenAI/Anthropic SDK 类型依赖；ToolResult 缺 call id 时构造失败。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M03-T02 · Group / Tool Dependency Validator

**状态：** ✅ Done  
**目标：** 编译前拒绝不完整 ToolCall/Result、atomic Group 部分选择、缺失依赖。  
**依赖：** M03-T01,M02-T04

**Files / Touch Points**

- `backend/src/contextos/context/compiler/group_validator.py`
- `backend/src/contextos/context/compiler/tool_validator.py`

**交付物 / 验收标准**

- [x] ToolCall/Result 成对
- [x] 多 ToolCall 映射完整
- [x] 每个 ToolResult 找到对应 ToolCall
- [x] 错误输出结构化 validation issue

**测试用例**

- [x] `M03-T02-TC01`：完整 Tool Interaction 通过
- [x] `M03-T02-TC02`：缺 Result 被拒绝
- [x] `M03-T02-TC03`：错误 tool_call_id 被拒绝
- [x] `M03-T02-TC04`：atomic Group 部分选择被拒绝

**任务专属 Prompt**

```text
实现任务 M03-T02《Group / Tool Dependency Validator》。
目标：编译前拒绝不完整 ToolCall/Result、atomic Group 部分选择、缺失依赖。
依赖：M03-T01,M02-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/compiler/group_validator.py、backend/src/contextos/context/compiler/tool_validator.py。
必须满足的验收条件：ToolCall/Result 成对；多 ToolCall 映射完整；每个 ToolResult 找到对应 ToolCall；错误输出结构化 validation issue。
至少覆盖这些测试：完整 Tool Interaction 通过；缺 Result 被拒绝；错误 tool_call_id 被拒绝；atomic Group 部分选择被拒绝。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M03-T03 · Context State Resolver / Placeholder Renderer

**状态：** ✅ Done  
**目标：** 把 RAW/ABSTRACT/REFERENCE/EVICTED/PINNED 解析成最终 IR。  
**依赖：** M03-T02,M02-T06

**Files / Touch Points**

- `backend/src/contextos/context/compiler/state_resolver.py`
- `backend/src/contextos/context/compiler/placeholder_renderer.py`

**交付物 / 验收标准**

- [x] EVICTED 不发送 raw 原文
- [x] ABSTRACT 使用 effective abstraction
- [x] PINNED 强制进入
- [x] REFERENCE/Placeholder 合法渲染

**测试用例**

- [x] `M03-T03-TC01`：EVICTED payload 不含 raw_content
- [x] `M03-T03-TC02`：user_override 优先
- [x] `M03-T03-TC03`：Placeholder 不携带原始大内容

**任务专属 Prompt**

```text
实现任务 M03-T03《Context State Resolver / Placeholder Renderer》。
目标：把 RAW/ABSTRACT/REFERENCE/EVICTED/PINNED 解析成最终 IR。
依赖：M03-T02,M02-T06。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/compiler/state_resolver.py、backend/src/contextos/context/compiler/placeholder_renderer.py。
必须满足的验收条件：EVICTED 不发送 raw 原文；ABSTRACT 使用 effective abstraction；PINNED 强制进入；REFERENCE/Placeholder 合法渲染。
至少覆盖这些测试：EVICTED payload 不含 raw_content；user_override 优先；Placeholder 不携带原始大内容。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M03-T04 · Token Counter / Budget Validator

**状态：** ✅ Done  
**目标：** 统一计算 token 并在 Provider 调用前拒绝超模型上限的最终 Payload。  
**依赖：** M03-T03

**Files / Touch Points**

- `backend/src/contextos/provider/base/token_counter.py`
- `backend/src/contextos/context/compiler/token_budget.py`

**交付物 / 验收标准**

- [x] 模型 limit 来自 Adapter capability
- [x] 返回 current/max/remaining diagnostics
- [x] Context Panel 与 Compiler 共用同一计数源

**测试用例**

- [x] `M03-T04-TC01`：低于预算通过
- [x] `M03-T04-TC02`：超过预算不调用 Provider
- [x] `M03-T04-TC03`：Context Panel token 与 Compiler 一致

**任务专属 Prompt**

```text
实现任务 M03-T04《Token Counter / Budget Validator》。
目标：统一计算 token 并在 Provider 调用前拒绝超模型上限的最终 Payload。
依赖：M03-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/provider/base/token_counter.py、backend/src/contextos/context/compiler/token_budget.py。
必须满足的验收条件：模型 limit 来自 Adapter capability；返回 current/max/remaining diagnostics；Context Panel 与 Compiler 共用同一计数源。
至少覆盖这些测试：低于预算通过；超过预算不调用 Provider；Context Panel token 与 Compiler 一致。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M03-T05 · ProviderAdapter Protocol

**状态：** ✅ Done  
**目标：** 定义 compile_message/tool_call/tool_result/placeholder/validate_sequence/count_tokens/capability。  
**依赖：** M03-T04

**Files / Touch Points**

- `backend/src/contextos/provider/base/adapter.py`

**交付物 / 验收标准**

- [x] Adapter 协议稳定
- [x] Provider-specific 逻辑留在 provider 包
- [x] 不实现多 Provider 业务

**测试用例**

- [x] `M03-T05-TC01`：假 Adapter 可完整实现协议
- [x] `M03-T05-TC02`：Runtime 只依赖 Protocol 而非具体 Provider

**任务专属 Prompt**

```text
实现任务 M03-T05《ProviderAdapter Protocol》。
目标：定义 compile_message/tool_call/tool_result/placeholder/validate_sequence/count_tokens/capability。
依赖：M03-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/provider/base/adapter.py。
必须满足的验收条件：Adapter 协议稳定；Provider-specific 逻辑留在 provider 包；不实现多 Provider 业务。
至少覆盖这些测试：假 Adapter 可完整实现协议；Runtime 只依赖 Protocol 而非具体 Provider。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M03-T06 · OpenAI-compatible Adapter

**状态：** ✅ Done  
**目标：** 完整实现 V1 首个 Provider Adapter 及流式输出转换。  
**依赖：** M03-T05

**Files / Touch Points**

- `backend/src/contextos/provider/openai_compatible/adapter.py`

**交付物 / 验收标准**

- [x] 普通消息转换
- [x] ToolCall/Result 映射
- [x] Placeholder 合法映射
- [x] Role/sequence validation

**测试用例**

- [x] `M03-T06-TC01`：system/user/assistant 序列正确
- [x] `M03-T06-TC02`：Tool 关联正确
- [x] `M03-T06-TC03`：非法 role/tool sequence 失败

**任务专属 Prompt**

```text
实现任务 M03-T06《OpenAI-compatible Adapter》。
目标：完整实现 V1 首个 Provider Adapter 及流式输出转换。
依赖：M03-T05。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/provider/openai_compatible/adapter.py。
必须满足的验收条件：普通消息转换；ToolCall/Result 映射；Placeholder 合法映射；Role/sequence validation。
至少覆盖这些测试：system/user/assistant 序列正确；Tool 关联正确；非法 role/tool sequence 失败。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M03-T07 · ContextCompiler 统一流水线

**状态：** ✅ Done  
**目标：** 串联 Group Validation→State Resolution→Placeholder→Tool→Provider→Token→Adapter，并改造 Runtime 只走 Compiler。  
**依赖：** M03-T06

**Files / Touch Points**

- `backend/src/contextos/context/compiler/compiler.py`
- `backend/src/contextos/runtime/graph/executor.py`

**交付物 / 验收标准**

- [x] Provider 调用前只能使用 ContextCompiler.compile
- [x] 输出 provider payload + diagnostics
- [x] 禁止内部 Message 绕过 Compiler

**测试用例**

- [x] `M03-T07-TC01`：完整对话编译成功
- [x] `M03-T07-TC02`：坏 Tool Group 调用 Provider 前失败
- [x] `M03-T07-TC03`：超 token 不发网络请求
- [x] `M03-T07-TC04`：集成测试能证明唯一 Provider 出口经过 Compiler

**任务专属 Prompt**

```text
实现任务 M03-T07《ContextCompiler 统一流水线》。
目标：串联 Group Validation→State Resolution→Placeholder→Tool→Provider→Token→Adapter，并改造 Runtime 只走 Compiler。
依赖：M03-T06。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/compiler/compiler.py、backend/src/contextos/runtime/graph/executor.py。
必须满足的验收条件：Provider 调用前只能使用 ContextCompiler.compile；输出 provider payload + diagnostics；禁止内部 Message 绕过 Compiler。
至少覆盖这些测试：完整对话编译成功；坏 Tool Group 调用 Provider 前失败；超 token 不发网络请求；集成测试能证明唯一 Provider 出口经过 Compiler。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


# M04 · Chat 工作台

**模块状态：** ✅ Done  
**依赖：** M01-M03  
**模块目标：** 交付流式 Agent Chat、Tool Interaction 展示、Context Panel、Token 与 Developer Mode。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M04-T01 · Message 持久化与分页 API

**状态：** ✅ Done  
**目标：** 保存 User/Assistant 消息及 Context/Group/Checkpoint/Trace 关联。  
**依赖：** M02-T01,M01-T01

**Files / Touch Points**

- `backend/src/contextos/runtime/session/message.py`
- `backend/src/contextos/runtime/session/message_service.py`
- `backend/src/contextos/api/routes/sessions.py`

**交付物 / 验收标准**

- [x] POST/GET Session Messages
- [x] 分页读取
- [x] 消息顺序由服务端 cursor 决定

**测试用例**

- [x] `M04-T01-TC01`：User Message 保存/读取
- [x] `M04-T01-TC02`：Assistant Message 元数据完整
- [x] `M04-T01-TC03`：分页顺序稳定

**任务专属 Prompt**

```text
实现任务 M04-T01《Message 持久化与分页 API》。
目标：保存 User/Assistant 消息及 Context/Group/Checkpoint/Trace 关联。
依赖：M02-T01,M01-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/session/message.py、backend/src/contextos/runtime/session/message_service.py、backend/src/contextos/api/routes/sessions.py。
必须满足的验收条件：POST/GET Session Messages；分页读取；消息顺序由服务端 cursor 决定。
至少覆盖这些测试：User Message 保存/读取；Assistant Message 元数据完整；分页顺序稳定。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M04-T02 · SSE Chat Stream

**状态：** ✅ Done  
**目标：** 输出 token/tool_call/tool_result/context/checkpoint/done/error 等 Runtime 事件。  
**依赖：** M03-T07,M04-T01

**Files / Touch Points**

- `backend/src/contextos/api/streaming/sse.py`
- `backend/src/contextos/api/routes/chat.py`

**交付物 / 验收标准**

- [x] SSE 只是 Runtime 事件投影
- [x] 断线不丢持久化 Message/Trace
- [x] 完成事件后 Checkpoint 可读取

**测试用例**

- [x] `M04-T02-TC01`：普通回复按 token 流式
- [x] `M04-T02-TC02`：Tool 时收到 call/result
- [x] `M04-T02-TC03`：中途断线后可 Rehydrate

**任务专属 Prompt**

```text
实现任务 M04-T02《SSE Chat Stream》。
目标：输出 token/tool_call/tool_result/context/checkpoint/done/error 等 Runtime 事件。
依赖：M03-T07,M04-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/api/streaming/sse.py、backend/src/contextos/api/routes/chat.py。
必须满足的验收条件：SSE 只是 Runtime 事件投影；断线不丢持久化 Message/Trace；完成事件后 Checkpoint 可读取。
至少覆盖这些测试：普通回复按 token 流式；Tool 时收到 call/result；中途断线后可 Rehydrate。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M04-T03 · ChatPage / MessageCard

**状态：** ✅ Done  
**目标：** 实现基础 Chat UI 与 role/timestamp/status/token/context state/group/tool relation 展示。  
**依赖：** M04-T02,M00-T03

**Files / Touch Points**

- `studio/src/pages/Chat/ChatPage.tsx`
- `studio/src/features/conversation/MessageCard.tsx`
- `studio/src/features/conversation/useChatStream.ts`

**交付物 / 验收标准**

- [x] User/Assistant 消息正确显示
- [x] 服务端 message id 作为稳定 key
- [x] 刷新后从 API 还原

**测试用例**

- [x] `M04-T03-TC01`：流式 token 更新同一 Message
- [x] `M04-T03-TC02`：刷新页面消息不丢

**任务专属 Prompt**

```text
实现任务 M04-T03《ChatPage / MessageCard》。
目标：实现基础 Chat UI 与 role/timestamp/status/token/context state/group/tool relation 展示。
依赖：M04-T02,M00-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/src/pages/Chat/ChatPage.tsx、studio/src/features/conversation/MessageCard.tsx、studio/src/features/conversation/useChatStream.ts。
必须满足的验收条件：User/Assistant 消息正确显示；服务端 message id 作为稳定 key；刷新后从 API 还原。
至少覆盖这些测试：流式 token 更新同一 Message；刷新页面消息不丢。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M04-T04 · ToolInteractionCard

**状态：** ✅ Done  
**目标：** 按 ContextGroup 展示 ToolCall/ToolResult，支持多 ToolCall 和异常状态。  
**依赖：** M04-T03,M02-T04

**Files / Touch Points**

- `studio/src/features/conversation/ToolInteractionCard.tsx`

**交付物 / 验收标准**

- [x] Call/Result 通过 tool_call_id 关联
- [x] 多 Tool 可展开
- [x] UI 不提供只删除 Call 或 Result 的能力

**测试用例**

- [x] `M04-T04-TC01`：单 Tool 展示完整
- [x] `M04-T04-TC02`：乱序多 Tool 映射正确
- [x] `M04-T04-TC03`：incomplete Group 显示异常

**任务专属 Prompt**

```text
实现任务 M04-T04《ToolInteractionCard》。
目标：按 ContextGroup 展示 ToolCall/ToolResult，支持多 ToolCall 和异常状态。
依赖：M04-T03,M02-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/src/features/conversation/ToolInteractionCard.tsx。
必须满足的验收条件：Call/Result 通过 tool_call_id 关联；多 Tool 可展开；UI 不提供只删除 Call 或 Result 的能力。
至少覆盖这些测试：单 Tool 展示完整；乱序多 Tool 映射正确；incomplete Group 显示异常。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M04-T05 · Context Panel

**状态：** ✅ Done  
**目标：** 展示 PINNED/RAW/ABSTRACT/EVICTED、token 使用和 Group 操作入口。  
**依赖：** M02-T08,M03-T04

**Files / Touch Points**

- `studio/src/features/context-panel/ContextPanel.tsx`
- `studio/src/features/context-panel/contextApi.ts`

**交付物 / 验收标准**

- [x] 操作先调用 Runtime API 再刷新服务端投影
- [x] 支持 Pin/Unpin/Abstract/Evict/Restore/ViewRaw
- [x] 显示 current/max token

**测试用例**

- [x] `M04-T05-TC01`：Evict 后状态/token 正确变化
- [x] `M04-T05-TC02`：失败操作不在本地假装成功
- [x] `M04-T05-TC03`：View Raw 显示原始内容

**任务专属 Prompt**

```text
实现任务 M04-T05《Context Panel》。
目标：展示 PINNED/RAW/ABSTRACT/EVICTED、token 使用和 Group 操作入口。
依赖：M02-T08,M03-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/src/features/context-panel/ContextPanel.tsx、studio/src/features/context-panel/contextApi.ts。
必须满足的验收条件：操作先调用 Runtime API 再刷新服务端投影；支持 Pin/Unpin/Abstract/Evict/Restore/ViewRaw；显示 current/max token。
至少覆盖这些测试：Evict 后状态/token 正确变化；失败操作不在本地假装成功；View Raw 显示原始内容。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M04-T06 · Developer Mode

**状态：** ✅ Done  
**目标：** 显示 message_id/checkpoint_id/context_group_id/trace_id 并支持跳转 Debug。  
**依赖：** M04-T03,M01-T05

**Files / Touch Points**

- `studio/src/features/conversation/DeveloperMeta.tsx`

**交付物 / 验收标准**

- [x] 普通模式隐藏内部 ID
- [x] Developer Mode 显示 PRD 指定 ID
- [x] ID 来自后端

**测试用例**

- [x] `M04-T06-TC01`：开关显示正确
- [x] `M04-T06-TC02`：点击 trace_id 导航到 Debug 过滤视图

**任务专属 Prompt**

```text
实现任务 M04-T06《Developer Mode》。
目标：显示 message_id/checkpoint_id/context_group_id/trace_id 并支持跳转 Debug。
依赖：M04-T03,M01-T05。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/src/features/conversation/DeveloperMeta.tsx。
必须满足的验收条件：普通模式隐藏内部 ID；Developer Mode 显示 PRD 指定 ID；ID 来自后端。
至少覆盖这些测试：开关显示正确；点击 trace_id 导航到 Debug 过滤视图。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


# M05 · Editable Conversation

**模块状态：** ✅ Done  
**依赖：** M01-M04  
**模块目标：** 允许用户修改历史 AI Message，保留原版本，并通过轻量 Timeline 支持仅修改上下文/从这里继续。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M05-T01 · MessageRevision 模型与 Service

**状态：** ✅ Done  
**目标：** 历史 AI Message 编辑必须追加 Revision，原 Message 永久保留。  
**依赖：** M04-T01,M02-T02

**Files / Touch Points**

- `backend/src/contextos/runtime/session/message_revision.py`
- `backend/src/contextos/runtime/session/message_revision_service.py`

**交付物 / 验收标准**

- [x] original 永久保留
- [x] 多次编辑形成 Revision chain
- [x] Revision 可关联 Timeline/ContextRevision

**测试用例**

- [x] `M05-T01-TC01`：第一次编辑保留 original
- [x] `M05-T01-TC02`：第二次编辑不覆盖第一次 Revision

**任务专属 Prompt**

```text
实现任务 M05-T01《MessageRevision 模型与 Service》。
目标：历史 AI Message 编辑必须追加 Revision，原 Message 永久保留。
依赖：M04-T01,M02-T02。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/session/message_revision.py、backend/src/contextos/runtime/session/message_revision_service.py。
必须满足的验收条件：original 永久保留；多次编辑形成 Revision chain；Revision 可关联 Timeline/ContextRevision。
至少覆盖这些测试：第一次编辑保留 original；第二次编辑不覆盖第一次 Revision。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M05-T02 · Message Edit / Impact API 契约

**状态：** ✅ Done  
**目标：** 实现 PATCH /api/messages/{id} 与 GET impact；编辑提交本身不重放 Agent。  
**依赖：** M05-T01

**Files / Touch Points**

- `backend/src/contextos/api/routes/messages.py`
- `backend/src/contextos/api/contracts/message_edit.py`

**交付物 / 验收标准**

- [x] PATCH 返回 revision_id
- [x] 原始版本可读取
- [x] 编辑后仅触发影响分析

**测试用例**

- [x] `M05-T02-TC01`：PATCH 不调用历史 Tool
- [x] `M05-T02-TC02`：保存后 original 不变

**任务专属 Prompt**

```text
实现任务 M05-T02《Message Edit / Impact API 契约》。
目标：实现 PATCH /api/messages/{id} 与 GET impact；编辑提交本身不重放 Agent。
依赖：M05-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/api/routes/messages.py、backend/src/contextos/api/contracts/message_edit.py。
必须满足的验收条件：PATCH 返回 revision_id；原始版本可读取；编辑后仅触发影响分析。
至少覆盖这些测试：PATCH 不调用历史 Tool；保存后 original 不变。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M05-T03 · 仅修改上下文

**状态：** ✅ Done  
**目标：** 编辑后创建新 Timeline，edited message 成为有效版本，旧后续消息不默认进入新 Working Context。  
**依赖：** M05-T02,M01-T02

**Files / Touch Points**

- `backend/src/contextos/runtime/timeline/edit_fork_service.py`
- `backend/src/contextos/api/routes/message_actions.py`

**交付物 / 验收标准**

- [x] 创建新 Timeline
- [x] 不运行 Agent
- [x] 旧 Timeline 完整保留

**测试用例**

- [x] `M05-T03-TC01`：timeline 数量+1
- [x] `M05-T03-TC02`：新 Working Context 使用编辑版本
- [x] `M05-T03-TC03`：旧 Timeline 后续历史仍可查看

**任务专属 Prompt**

```text
实现任务 M05-T03《仅修改上下文》。
目标：编辑后创建新 Timeline，edited message 成为有效版本，旧后续消息不默认进入新 Working Context。
依赖：M05-T02,M01-T02。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/timeline/edit_fork_service.py、backend/src/contextos/api/routes/message_actions.py。
必须满足的验收条件：创建新 Timeline；不运行 Agent；旧 Timeline 完整保留。
至少覆盖这些测试：timeline 数量+1；新 Working Context 使用编辑版本；旧 Timeline 后续历史仍可查看。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M05-T04 · 从这里继续

**状态：** ✅ Done  
**目标：** 基于编辑点最近 Checkpoint 建新 Timeline 并继续 LangGraph，不 replay 旧后续流程。  
**依赖：** M05-T03,M01-T03,M01-T04

**Files / Touch Points**

- `backend/src/contextos/runtime/timeline/continue_service.py`

**交付物 / 验收标准**

- [x] 恢复最近 Checkpoint
- [x] 应用 Message Revision
- [x] 新输出只写新 Timeline
- [x] 旧 ToolCall 不自动重放

**测试用例**

- [x] `M05-T04-TC01`：从正确 checkpoint 继续
- [x] `M05-T04-TC02`：旧 Timeline 后续 Tool 未执行
- [x] `M05-T04-TC03`：新 Trace/Checkpoint 归属新 Timeline

**任务专属 Prompt**

```text
实现任务 M05-T04《从这里继续》。
目标：基于编辑点最近 Checkpoint 建新 Timeline 并继续 LangGraph，不 replay 旧后续流程。
依赖：M05-T03,M01-T03,M01-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/timeline/continue_service.py。
必须满足的验收条件：恢复最近 Checkpoint；应用 Message Revision；新输出只写新 Timeline；旧 ToolCall 不自动重放。
至少覆盖这些测试：从正确 checkpoint 继续；旧 Timeline 后续 Tool 未执行；新 Trace/Checkpoint 归属新 Timeline。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M05-T05 · Message Editor / 三动作 UI

**状态：** ✅ Done  
**目标：** 保存编辑后显示 Impact 摘要和“仅修改上下文 / 从这里继续 / 重放后续流程”。  
**依赖：** M05-T02,M05-T04

**Files / Touch Points**

- `studio/src/features/message-editor/MessageEditor.tsx`
- `studio/src/features/message-editor/EditActions.tsx`

**交付物 / 验收标准**

- [x] 显示 User Modified
- [x] 可查看原始版本
- [x] 三动作语义分离
- [x] 取消编辑不写 Revision

**测试用例**

- [x] `M05-T05-TC01`：编辑后标识正确
- [x] `M05-T05-TC02`：从这里继续切换新 Timeline
- [x] `M05-T05-TC03`：取消不产生 Revision

**任务专属 Prompt**

```text
实现任务 M05-T05《Message Editor / 三动作 UI》。
目标：保存编辑后显示 Impact 摘要和“仅修改上下文 / 从这里继续 / 重放后续流程”。
依赖：M05-T02,M05-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/src/features/message-editor/MessageEditor.tsx、studio/src/features/message-editor/EditActions.tsx。
必须满足的验收条件：显示 User Modified；可查看原始版本；三动作语义分离；取消编辑不写 Revision。
至少覆盖这些测试：编辑后标识正确；从这里继续切换新 Timeline；取消不产生 Revision。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


# M06 · Impact Analyzer / Replay Safety

**模块状态：** ✅ Done  
**依赖：** M05  
**模块目标：** 识别历史编辑对 Tool/State/Graph 的影响，强制副作用 Tool 安全重放。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M06-T01 · Tool Metadata / Risk Registry

**状态：** ✅ Done  
**目标：** 声明 tool_id/name/side_effect/idempotent/replay_policy/risk_level；未知 Tool 默认 WRITE。  
**依赖：** M02-T04

**Files / Touch Points**

- `backend/src/contextos/tool/registry/metadata.py`
- `backend/src/contextos/tool/registry/registry.py`
- `backend/src/contextos/tool/risk/policy.py`

**交付物 / 验收标准**

- [x] side_effect 覆盖 NONE/READ/WRITE/EXTERNAL_WRITE/DESTRUCTIVE/FINANCIAL
- [x] 未知 Tool 默认 WRITE
- [x] READ 可自动，其余默认 Ask

**测试用例**

- [x] `M06-T01-TC01`：未声明 Tool 注册为 WRITE
- [x] `M06-T01-TC02`：FINANCIAL 必须确认

**任务专属 Prompt**

```text
实现任务 M06-T01《Tool Metadata / Risk Registry》。
目标：声明 tool_id/name/side_effect/idempotent/replay_policy/risk_level；未知 Tool 默认 WRITE。
依赖：M02-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/tool/registry/metadata.py、backend/src/contextos/tool/registry/registry.py、backend/src/contextos/tool/risk/policy.py。
必须满足的验收条件：side_effect 覆盖 NONE/READ/WRITE/EXTERNAL_WRITE/DESTRUCTIVE/FINANCIAL；未知 Tool 默认 WRITE；READ 可自动，其余默认 Ask。
至少覆盖这些测试：未声明 Tool 注册为 WRITE；FINANCIAL 必须确认。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M06-T02 · Message / ToolResult 语义冲突检测

**状态：** ✅ Done  
**目标：** 输出 issue type/severity/evidence/related ids，优先覆盖 PRD shipped→refunded 场景。  
**依赖：** M05-T02,M06-T01

**Files / Touch Points**

- `backend/src/contextos/tool/risk/impact_models.py`
- `backend/src/contextos/tool/risk/impact_analyzer.py`

**交付物 / 验收标准**

- [x] 冲突输出结构化证据
- [x] 允许不确定但不能默认为安全
- [x] 能定位相关 ToolResult

**测试用例**

- [x] `M06-T02-TC01`：status=shipped + 编辑“订单已退款”产生告警
- [x] `M06-T02-TC02`：普通无冲突文本不制造高风险假阳性

**任务专属 Prompt**

```text
实现任务 M06-T02《Message / ToolResult 语义冲突检测》。
目标：输出 issue type/severity/evidence/related ids，优先覆盖 PRD shipped→refunded 场景。
依赖：M05-T02,M06-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/tool/risk/impact_models.py、backend/src/contextos/tool/risk/impact_analyzer.py。
必须满足的验收条件：冲突输出结构化证据；允许不确定但不能默认为安全；能定位相关 ToolResult。
至少覆盖这些测试：status=shipped + 编辑“订单已退款”产生告警；普通无冲突文本不制造高风险假阳性。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M06-T03 · Tool 参数 / State / Graph Dependency Analyzer

**状态：** ✅ Done  
**目标：** 分析后续 ToolCall 参数、State Update、Graph Node 对编辑内容的依赖。  
**依赖：** M06-T02,M01-T05

**Files / Touch Points**

- `backend/src/contextos/tool/risk/dependency_analyzer.py`

**交付物 / 验收标准**

- [x] 输出 Tool/State/Graph dependency issue
- [x] 关联 Trace/Checkpoint/Message ids
- [x] 无依赖节点不误报为必须重放

**测试用例**

- [x] `M06-T03-TC01`：编辑影响 tool arg 时定位 ToolCall
- [x] `M06-T03-TC02`：state update 引用编辑数据时产生 issue

**任务专属 Prompt**

```text
实现任务 M06-T03《Tool 参数 / State / Graph Dependency Analyzer》。
目标：分析后续 ToolCall 参数、State Update、Graph Node 对编辑内容的依赖。
依赖：M06-T02,M01-T05。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/tool/risk/dependency_analyzer.py。
必须满足的验收条件：输出 Tool/State/Graph dependency issue；关联 Trace/Checkpoint/Message ids；无依赖节点不误报为必须重放。
至少覆盖这些测试：编辑影响 tool arg 时定位 ToolCall；state update 引用编辑数据时产生 issue。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M06-T04 · Replay Decision Model

**状态：** ✅ Done  
**目标：** 显式建模 USE_HISTORY / REINVOKE / SKIP / CANCEL 和 confirmation。  
**依赖：** M06-T03

**Files / Touch Points**

- `backend/src/contextos/tool/replay/decision.py`
- `backend/src/contextos/tool/replay/policy.py`

**交付物 / 验收标准**

- [x] 高风险 REINVOKE 需要 confirmation token
- [x] USE_HISTORY 保留 provenance
- [x] CANCEL 不产生执行

**测试用例**

- [x] `M06-T04-TC01`：WRITE 未确认 REINVOKE 被拒绝
- [x] `M06-T04-TC02`：USE_HISTORY 零 Tool 外部调用

**任务专属 Prompt**

```text
实现任务 M06-T04《Replay Decision Model》。
目标：显式建模 USE_HISTORY / REINVOKE / SKIP / CANCEL 和 confirmation。
依赖：M06-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/tool/replay/decision.py、backend/src/contextos/tool/replay/policy.py。
必须满足的验收条件：高风险 REINVOKE 需要 confirmation token；USE_HISTORY 保留 provenance；CANCEL 不产生执行。
至少覆盖这些测试：WRITE 未确认 REINVOKE 被拒绝；USE_HISTORY 零 Tool 外部调用。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M06-T05 · ReplayManager / API / 幂等

**状态：** ✅ Done  
**目标：** 按 replay plan 创建新 Timeline，并对 WRITE 及以上副作用强制二次确认。  
**依赖：** M06-T04,M05-T03

**Files / Touch Points**

- `backend/src/contextos/tool/replay/manager.py`
- `backend/src/contextos/api/routes/replay.py`

**交付物 / 验收标准**

- [x] 先 Impact Analyze 再执行 plan
- [x] 高风险未确认不得调用
- [x] Replay 写新 Timeline/Trace/Checkpoint
- [x] 支持 idempotency_key

**测试用例**

- [x] `M06-T05-TC01`：send_email 未确认=0 次调用
- [x] `M06-T05-TC02`：确认后=1 次
- [x] `M06-T05-TC03`：相同 idempotency_key 重复请求仍=1 次

**任务专属 Prompt**

```text
实现任务 M06-T05《ReplayManager / API / 幂等》。
目标：按 replay plan 创建新 Timeline，并对 WRITE 及以上副作用强制二次确认。
依赖：M06-T04,M05-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/tool/replay/manager.py、backend/src/contextos/api/routes/replay.py。
必须满足的验收条件：先 Impact Analyze 再执行 plan；高风险未确认不得调用；Replay 写新 Timeline/Trace/Checkpoint；支持 idempotency_key。
至少覆盖这些测试：send_email 未确认=0 次调用；确认后=1 次；相同 idempotency_key 重复请求仍=1 次。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M06-T06 · Impact / Replay UI

**状态：** ✅ Done  
**目标：** 展示冲突、依赖、side effect、四种选择与二次确认。  
**依赖：** M06-T05,M05-T05

**Files / Touch Points**

- `studio/src/features/impact-analyzer/ImpactPanel.tsx`
- `studio/src/features/replay/ReplayPlanDialog.tsx`

**交付物 / 验收标准**

- [x] 风险可解释
- [x] 高风险重新调用不是默认选择
- [x] 确认前按钮不能触发 reinvoke

**测试用例**

- [x] `M06-T06-TC01`：shipped/refunded 告警可见
- [x] `M06-T06-TC02`：send_email 未确认不发送 reinvoke API

**任务专属 Prompt**

```text
实现任务 M06-T06《Impact / Replay UI》。
目标：展示冲突、依赖、side effect、四种选择与二次确认。
依赖：M06-T05,M05-T05。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/src/features/impact-analyzer/ImpactPanel.tsx、studio/src/features/replay/ReplayPlanDialog.tsx。
必须满足的验收条件：风险可解释；高风险重新调用不是默认选择；确认前按钮不能触发 reinvoke。
至少覆盖这些测试：shipped/refunded 告警可见；send_email 未确认不发送 reinvoke API。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


# M07 · Context Allocator / Search / Restore

**模块状态：** ✅ Done  
**依赖：** M02-M03,M06  
**模块目标：** 实现可解释的 Working Set 管理、主动恢复和超预算 Reallocation。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M07-T01 · V1 Context Search（非语义）

**状态：** ✅ Done  
**目标：** 按 keyword/type/state/timeline 搜索历史 ContextGroup，不提前实现 P1 Semantic Search。  
**依赖：** M02-T08

**Files / Touch Points**

- `backend/src/contextos/context/restore/search.py`

**交付物 / 验收标准**

- [x] EVICTED Group 可检索
- [x] 结果含 group_id/summary/state/token/restorable
- [x] 不引入 Vector DB/Embedding

**测试用例**

- [x] `M07-T01-TC01`：Kingbase SQL 关键词可命中已 Evict Group
- [x] `M07-T01-TC02`：state=EVICTED 过滤有效

**任务专属 Prompt**

```text
实现任务 M07-T01《V1 Context Search（非语义）》。
目标：按 keyword/type/state/timeline 搜索历史 ContextGroup，不提前实现 P1 Semantic Search。
依赖：M02-T08。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/restore/search.py。
必须满足的验收条件：EVICTED Group 可检索；结果含 group_id/summary/state/token/restorable；不引入 Vector DB/Embedding。
至少覆盖这些测试：Kingbase SQL 关键词可命中已 Evict Group；state=EVICTED 过滤有效。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M07-T02 · Allocator 基础优先级

**状态：** ✅ Done  
**目标：** 实现 System/current user/current node input/PINNED/recent 优先，旧低价值/重复/已总结内容优先压缩或淘汰。  
**依赖：** M03-T04,M02-T07

**Files / Touch Points**

- `backend/src/contextos/context/allocator/policy.py`
- `backend/src/contextos/context/allocator/allocator.py`

**交付物 / 验收标准**

- [x] Allocator 输出 plan 而不直接写状态
- [x] PINNED 不自动淘汰
- [x] 大 Tool Result/搜索/RAG/日志/文件全文优先压缩

**测试用例**

- [x] `M07-T02-TC01`：PINNED 永远保留
- [x] `M07-T02-TC02`：当前 User Message 永远保留
- [x] `M07-T02-TC03`：已被 Summary 覆盖旧 Group 优先 Evict

**任务专属 Prompt**

```text
实现任务 M07-T02《Allocator 基础优先级》。
目标：实现 System/current user/current node input/PINNED/recent 优先，旧低价值/重复/已总结内容优先压缩或淘汰。
依赖：M03-T04,M02-T07。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/allocator/policy.py、backend/src/contextos/context/allocator/allocator.py。
必须满足的验收条件：Allocator 输出 plan 而不直接写状态；PINNED 不自动淘汰；大 Tool Result/搜索/RAG/日志/文件全文优先压缩。
至少覆盖这些测试：PINNED 永远保留；当前 User Message 永远保留；已被 Summary 覆盖旧 Group 优先 Evict。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M07-T03 · High/Target Watermark

**状态：** ✅ Done  
**目标：** Context 超 high_watermark 后一次计划压缩到 target_watermark，默认 0.8/0.65 可配置。  
**依赖：** M07-T02

**Files / Touch Points**

- `backend/src/contextos/context/allocator/watermark.py`

**交付物 / 验收标准**

- [x] 低于 high 不触发
- [x] 触发后不是只缩一个 Group
- [x] 无法达到 target 时明确返回 budget pressure

**测试用例**

- [x] `M07-T03-TC01`：79% 不触发
- [x] `M07-T03-TC02`：81% 触发并规划降到约 65%
- [x] `M07-T03-TC03`：PINNED 过多时返回无法满足预算

**任务专属 Prompt**

```text
实现任务 M07-T03《High/Target Watermark》。
目标：Context 超 high_watermark 后一次计划压缩到 target_watermark，默认 0.8/0.65 可配置。
依赖：M07-T02。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/allocator/watermark.py。
必须满足的验收条件：低于 high 不触发；触发后不是只缩一个 Group；无法达到 target 时明确返回 budget pressure。
至少覆盖这些测试：79% 不触发；81% 触发并规划降到约 65%；PINNED 过多时返回无法满足预算。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M07-T04 · Abstractor

**状态：** ✅ Done  
**目标：** 对大 Tool Result/搜索/RAG/日志/文件/已完成子任务生成 abstraction，同时永久保留 raw。  
**依赖：** M07-T03,M02-T07

**Files / Touch Points**

- `backend/src/contextos/context/allocator/abstractor.py`

**交付物 / 验收标准**

- [x] 生成内容写 generated_content
- [x] 失败不改变状态
- [x] user_override 不被系统摘要覆盖

**测试用例**

- [x] `M07-T04-TC01`：摘要后 raw 可查看
- [x] `M07-T04-TC02`：摘要失败 Group 状态不变
- [x] `M07-T04-TC03`：已有 user_override 仍是 effective_content

**任务专属 Prompt**

```text
实现任务 M07-T04《Abstractor》。
目标：对大 Tool Result/搜索/RAG/日志/文件/已完成子任务生成 abstraction，同时永久保留 raw。
依赖：M07-T03,M02-T07。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/allocator/abstractor.py。
必须满足的验收条件：生成内容写 generated_content；失败不改变状态；user_override 不被系统摘要覆盖。
至少覆盖这些测试：摘要后 raw 可查看；摘要失败 Group 状态不变；已有 user_override 仍是 effective_content。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M07-T05 · Restore Policy：AUTO / ASK / MANUAL

**状态：** ✅ Done  
**目标：** 实现模板级恢复模式和 max_tokens_per_restore/max_restore_per_turn。  
**依赖：** M07-T01,M07-T02

**Files / Touch Points**

- `backend/src/contextos/context/restore/policy.py`
- `backend/src/contextos/context/restore/service.py`

**交付物 / 验收标准**

- [x] USER_RESTORE/AGENT_RESTORE Revision 区分
- [x] AUTO/ASK/MANUAL 行为明确
- [x] 每轮次数/token 限制

**测试用例**

- [x] `M07-T05-TC01`：MANUAL 不自动恢复
- [x] `M07-T05-TC02`：ASK 进入 pending approval
- [x] `M07-T05-TC03`：AUTO 在额度内直接执行
- [x] `M07-T05-TC04`：超次数被拒绝

**任务专属 Prompt**

```text
实现任务 M07-T05《Restore Policy：AUTO / ASK / MANUAL》。
目标：实现模板级恢复模式和 max_tokens_per_restore/max_restore_per_turn。
依赖：M07-T01,M07-T02。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/restore/policy.py、backend/src/contextos/context/restore/service.py。
必须满足的验收条件：USER_RESTORE/AGENT_RESTORE Revision 区分；AUTO/ASK/MANUAL 行为明确；每轮次数/token 限制。
至少覆盖这些测试：MANUAL 不自动恢复；ASK 进入 pending approval；AUTO 在额度内直接执行；超次数被拒绝。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M07-T06 · Restore Reallocator

**状态：** ✅ Done  
**目标：** Restore 超预算时先计算缺口、淘汰低价值非 PINNED Group，再恢复目标 Group。  
**依赖：** M07-T05,M07-T03

**Files / Touch Points**

- `backend/src/contextos/context/restore/reallocator.py`

**交付物 / 验收标准**

- [x] 先 plan 后 apply
- [x] 不得淘汰当前输入/PINNED
- [x] 失败事务回滚
- [x] 操作有 Trace/Revision

**测试用例**

- [x] `M07-T06-TC01`：110K/128K + 30K Restore 先 Evict
- [x] `M07-T06-TC02`：无可 Evict 空间时不破坏现有 Context
- [x] `M07-T06-TC03`：成功后 Compiler payload 不超预算

**任务专属 Prompt**

```text
实现任务 M07-T06《Restore Reallocator》。
目标：Restore 超预算时先计算缺口、淘汰低价值非 PINNED Group，再恢复目标 Group。
依赖：M07-T05,M07-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/restore/reallocator.py。
必须满足的验收条件：先 plan 后 apply；不得淘汰当前输入/PINNED；失败事务回滚；操作有 Trace/Revision。
至少覆盖这些测试：110K/128K + 30K Restore 先 Evict；无可 Evict 空间时不破坏现有 Context；成功后 Compiler payload 不超预算。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M07-T07 · Agent-driven context.search / restore

**状态：** ✅ Done  
**目标：** 把受 Policy 保护的 context.search/context.restore 注入 Runtime Context。  
**依赖：** M07-T06,M01-T04

**Files / Touch Points**

- `backend/src/contextos/context/restore/agent_api.py`
- `backend/src/contextos/runtime/graph/runtime_context.py`

**交付物 / 验收标准**

- [x] Agent 不能直接改 Group state
- [x] ASK 可产生 interrupt/approval
- [x] 所有 Agent Restore 写 Trace

**测试用例**

- [x] `M07-T07-TC01`：AUTO 可恢复并继续当前 run
- [x] `M07-T07-TC02`：ASK 在 Restore 前暂停
- [x] `M07-T07-TC03`：per-turn limit 生效

**任务专属 Prompt**

```text
实现任务 M07-T07《Agent-driven context.search / restore》。
目标：把受 Policy 保护的 context.search/context.restore 注入 Runtime Context。
依赖：M07-T06,M01-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/context/restore/agent_api.py、backend/src/contextos/runtime/graph/runtime_context.py。
必须满足的验收条件：Agent 不能直接改 Group state；ASK 可产生 interrupt/approval；所有 Agent Restore 写 Trace。
至少覆盖这些测试：AUTO 可恢复并继续当前 run；ASK 在 Restore 前暂停；per-turn limit 生效。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


# M08 · Template / Manifest / Workflow Builder

**模块状态：** ✅ Done  
**依赖：** M01-M07  
**模块目标：** 以声明式 Manifest 编译基础 LangGraph Workflow，同时保留受控 Custom Extension。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M08-T01 · Manifest Schema / Parser

**状态：** ✅ Done  
**目标：** 实现 template/graph/nodes/edges/context/checkpoint/ui 的 V1 解析。  
**依赖：** M00-T02

**Files / Touch Points**

- `backend/src/contextos/template/manifest/schema.py`
- `backend/src/contextos/template/manifest/parser.py`

**交付物 / 验收标准**

- [x] PRD research-agent 示例可解析
- [x] 仅覆盖 V1 字段
- [x] 错误定位到具体字段

**测试用例**

- [x] `M08-T01-TC01`：golden manifest 解析成功
- [x] `M08-T01-TC02`：缺 node id 明确失败

**任务专属 Prompt**

```text
实现任务 M08-T01《Manifest Schema / Parser》。
目标：实现 template/graph/nodes/edges/context/checkpoint/ui 的 V1 解析。
依赖：M00-T02。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/template/manifest/schema.py、backend/src/contextos/template/manifest/parser.py。
必须满足的验收条件：PRD research-agent 示例可解析；仅覆盖 V1 字段；错误定位到具体字段。
至少覆盖这些测试：golden manifest 解析成功；缺 node id 明确失败。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M08-T02 · Manifest Validator / Extension Registry

**状态：** ✅ Done  
**目标：** 校验图引用、Tool、Extension，并显式注册 CustomNode/Router/Reducer/ContextPolicy。  
**依赖：** M08-T01,M06-T01

**Files / Touch Points**

- `backend/src/contextos/template/validator/validator.py`
- `backend/src/contextos/template/extension/registry.py`

**交付物 / 验收标准**

- [x] 未知 Extension 编译失败
- [x] 禁止用户字符串任意 dynamic import
- [x] Tool 绑定必须存在

**测试用例**

- [x] `M08-T02-TC01`：边指向不存在 Node 失败
- [x] `M08-T02-TC02`：未注册 CustomNode 失败

**任务专属 Prompt**

```text
实现任务 M08-T02《Manifest Validator / Extension Registry》。
目标：校验图引用、Tool、Extension，并显式注册 CustomNode/Router/Reducer/ContextPolicy。
依赖：M08-T01,M06-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/template/validator/validator.py、backend/src/contextos/template/extension/registry.py。
必须满足的验收条件：未知 Extension 编译失败；禁止用户字符串任意 dynamic import；Tool 绑定必须存在。
至少覆盖这些测试：边指向不存在 Node 失败；未注册 CustomNode 失败。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M08-T03 · Manifest→LangGraph Compiler

**状态：** ✅ Done  
**目标：** 直接利用 StateGraph/Node/Edge/Command/Checkpoint/Interrupt/SubGraph/Reducer/ToolNode 等 LangGraph 能力。  
**依赖：** M08-T02,M01-T04

**Files / Touch Points**

- `backend/src/contextos/template/compiler/langgraph_compiler.py`

**交付物 / 验收标准**

- [x] 支持 V1 节点 Agent/LLM/Prompt/Tool/Condition/Router/SubGraph/HumanApproval/ContextOperator/Memory/Output/CustomNode
- [x] 不实现平行状态机

**测试用例**

- [x] `M08-T03-TC01`：START→Agent→END 可运行
- [x] `M08-T03-TC02`：Router 分支正确
- [x] `M08-T03-TC03`：HumanApproval 产生可恢复 Interrupt

**任务专属 Prompt**

```text
实现任务 M08-T03《Manifest→LangGraph Compiler》。
目标：直接利用 StateGraph/Node/Edge/Command/Checkpoint/Interrupt/SubGraph/Reducer/ToolNode 等 LangGraph 能力。
依赖：M08-T02,M01-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/template/compiler/langgraph_compiler.py。
必须满足的验收条件：支持 V1 节点 Agent/LLM/Prompt/Tool/Condition/Router/SubGraph/HumanApproval/ContextOperator/Memory/Output/CustomNode；不实现平行状态机。
至少覆盖这些测试：START→Agent→END 可运行；Router 分支正确；HumanApproval 产生可恢复 Interrupt。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M08-T04 · ContextOperator Node

**状态：** ✅ Done  
**目标：** 实现 PIN/UNPIN/ABSTRACT/EVICT/RESTORE/SEARCH/SUMMARIZE 的 Workflow 适配。  
**依赖：** M08-T03,M07-T07

**Files / Touch Points**

- `backend/src/contextos/template/compiler/context_operator.py`

**交付物 / 验收标准**

- [x] 只调用 Context/Restore Service
- [x] 操作产生 Trace
- [x] 不复制状态机逻辑

**测试用例**

- [x] `M08-T04-TC01`：Search→Abstract→Writer 流可运行
- [x] `M08-T04-TC02`：Evict atomic Group 保持整体

**任务专属 Prompt**

```text
实现任务 M08-T04《ContextOperator Node》。
目标：实现 PIN/UNPIN/ABSTRACT/EVICT/RESTORE/SEARCH/SUMMARIZE 的 Workflow 适配。
依赖：M08-T03,M07-T07。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/template/compiler/context_operator.py。
必须满足的验收条件：只调用 Context/Restore Service；操作产生 Trace；不复制状态机逻辑。
至少覆盖这些测试：Search→Abstract→Writer 流可运行；Evict atomic Group 保持整体。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M08-T05 · Template CRUD / Validate / Compile / Run API

**状态：** ✅ Done  
**目标：** 覆盖 PRD 32.5 并保证 run 走统一 Runtime/Compiler。  
**依赖：** M08-T04

**Files / Touch Points**

- `backend/src/contextos/template/service.py`
- `backend/src/contextos/api/routes/templates.py`

**交付物 / 验收标准**

- [x] POST/GET/PUT Template
- [x] POST validate/compile/run
- [x] validate 无执行副作用

**测试用例**

- [x] `M08-T05-TC01`：保存读取 Manifest 一致
- [x] `M08-T05-TC02`：compile 错误定位节点
- [x] `M08-T05-TC03`：run 不直接调用 Provider

**任务专属 Prompt**

```text
实现任务 M08-T05《Template CRUD / Validate / Compile / Run API》。
目标：覆盖 PRD 32.5 并保证 run 走统一 Runtime/Compiler。
依赖：M08-T04。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/template/service.py、backend/src/contextos/api/routes/templates.py。
必须满足的验收条件：POST/GET/PUT Template；POST validate/compile/run；validate 无执行副作用。
至少覆盖这些测试：保存读取 Manifest 一致；compile 错误定位节点；run 不直接调用 Provider。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M08-T06 · Workflow Builder 基础 Canvas

**状态：** ✅ Done  
**目标：** 实现 Node Library/Canvas/Edge/Node Config/Validation/Save/Preview/Publish。  
**依赖：** M08-T05,M00-T03

**Files / Touch Points**

- `studio/src/pages/Workflow/WorkflowPage.tsx`
- `studio/src/features/workflow-builder/`

**交付物 / 验收标准**

- [x] 节点库仅 V1 节点
- [x] 保存格式为 Manifest
- [x] 前端校验用于体验，后端 Validator 为最终权威

**测试用例**

- [x] `M08-T06-TC01`：Agent/Tool/Output 连线可序列化
- [x] `M08-T06-TC02`：非法图前后端都拒绝
- [x] `M08-T06-TC03`：保存后重开图一致

**任务专属 Prompt**

```text
实现任务 M08-T06《Workflow Builder 基础 Canvas》。
目标：实现 Node Library/Canvas/Edge/Node Config/Validation/Save/Preview/Publish。
依赖：M08-T05,M00-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/src/pages/Workflow/WorkflowPage.tsx、studio/src/features/workflow-builder/。
必须满足的验收条件：节点库仅 V1 节点；保存格式为 Manifest；前端校验用于体验，后端 Validator 为最终权威。
至少覆盖这些测试：Agent/Tool/Output 连线可序列化；非法图前后端都拒绝；保存后重开图一致。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M08-T07 · Template 页面

**状态：** ✅ Done  
**目标：** 编辑 Manifest/Model/Prompt/Tools/Context Policy/Workflow/UI Config，并查看 Validate/Compile 结果。  
**依赖：** M08-T05,M08-T06

**Files / Touch Points**

- `studio/src/pages/Template/TemplatePage.tsx`
- `studio/src/features/template-editor/`

**交付物 / 验收标准**

- [x] 不实现 Marketplace/复杂版本管理
- [x] 可发起测试 Run
- [x] 字段错误可定位

**测试用例**

- [x] `M08-T07-TC01`：restore.mode 修改保存一致
- [x] `M08-T07-TC02`：Compile 成功后测试 Run 可启动

**任务专属 Prompt**

```text
实现任务 M08-T07《Template 页面》。
目标：编辑 Manifest/Model/Prompt/Tools/Context Policy/Workflow/UI Config，并查看 Validate/Compile 结果。
依赖：M08-T05,M08-T06。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/src/pages/Template/TemplatePage.tsx、studio/src/features/template-editor/。
必须满足的验收条件：不实现 Marketplace/复杂版本管理；可发起测试 Run；字段错误可定位。
至少覆盖这些测试：restore.mode 修改保存一致；Compile 成功后测试 Run 可启动。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


# M09 · Debug / Observability / Performance

**模块状态：** ✅ Done  
**依赖：** M01-M08  
**模块目标：** 让开发者从 Graph、State、Checkpoint、Trace、Context、Tool 等维度解释执行，并满足建议性能目标。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M09-T01 · Debug Read Model / API

**状态：** ✅ Done  
**目标：** 聚合 Graph/Timeline/Checkpoint/Message/State/Trace/Tool/Context/Prompt/Inputs，只读不成为新事实源。  
**依赖：** M01-T05,M02-T08,M08-T05

**Files / Touch Points**

- `backend/src/contextos/runtime/debug/projection.py`
- `backend/src/contextos/api/routes/debug.py`

**交付物 / 验收标准**

- [x] 按 trace/checkpoint/message 过滤
- [x] 大列表分页
- [x] Debug Projection 不持久化第二份业务事实

**测试用例**

- [x] `M09-T01-TC01`：给定 Session 可获取 Debug index
- [x] `M09-T01-TC02`：大 Trace 分页有效

**任务专属 Prompt**

```text
实现任务 M09-T01《Debug Read Model / API》。
目标：聚合 Graph/Timeline/Checkpoint/Message/State/Trace/Tool/Context/Prompt/Inputs，只读不成为新事实源。
依赖：M01-T05,M02-T08,M08-T05。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/src/contextos/runtime/debug/projection.py、backend/src/contextos/api/routes/debug.py。
必须满足的验收条件：按 trace/checkpoint/message 过滤；大列表分页；Debug Projection 不持久化第二份业务事实。
至少覆盖这些测试：给定 Session 可获取 Debug index；大 Trace 分页有效。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M09-T02 · Debug Graph / Timeline / State UI

**状态：** ✅ Done  
**目标：** 实现 Graph、Timeline、Conversation、State Inspector 联动。  
**依赖：** M09-T01

**Files / Touch Points**

- `studio/src/pages/Debug/DebugPage.tsx`
- `studio/src/features/trace/GraphView.tsx`
- `studio/src/features/timeline/TimelineView.tsx`
- `studio/src/features/trace/StateInspector.tsx`

**交付物 / 验收标准**

- [x] 按稳定 ID 联动
- [x] Checkpoint 显示 graph_state
- [x] 从 Chat trace_id 可跳转定位

**测试用例**

- [x] `M09-T02-TC01`：切 Timeline 不串数据
- [x] `M09-T02-TC02`：Checkpoint state 与后端一致

**任务专属 Prompt**

```text
实现任务 M09-T02《Debug Graph / Timeline / State UI》。
目标：实现 Graph、Timeline、Conversation、State Inspector 联动。
依赖：M09-T01。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/src/pages/Debug/DebugPage.tsx、studio/src/features/trace/GraphView.tsx、studio/src/features/timeline/TimelineView.tsx、studio/src/features/trace/StateInspector.tsx。
必须满足的验收条件：按稳定 ID 联动；Checkpoint 显示 graph_state；从 Chat trace_id 可跳转定位。
至少覆盖这些测试：切 Timeline 不串数据；Checkpoint state 与后端一致。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M09-T03 · Trace / Tool / Context / Prompt Inputs UI

**状态：** ✅ Done  
**目标：** 展示执行时间线、ToolCall/Result、Context Edit/Evict/Restore、Compiler diagnostics。  
**依赖：** M09-T02

**Files / Touch Points**

- `studio/src/features/trace/ExecutionTrace.tsx`
- `studio/src/features/trace/ToolTracePanel.tsx`
- `studio/src/features/trace/ContextTracePanel.tsx`
- `studio/src/features/trace/PromptInputsPanel.tsx`

**交付物 / 验收标准**

- [x] 默认显示摘要，Raw 显式加载
- [x] Compiler validation failure 可见
- [x] Context Revision 可定位

**测试用例**

- [x] `M09-T03-TC01`：Tool run 显示 duration/status
- [x] `M09-T03-TC02`：Restore 可定位 group/revision
- [x] `M09-T03-TC03`：Compiler 错误在 Debug 可见

**任务专属 Prompt**

```text
实现任务 M09-T03《Trace / Tool / Context / Prompt Inputs UI》。
目标：展示执行时间线、ToolCall/Result、Context Edit/Evict/Restore、Compiler diagnostics。
依赖：M09-T02。
仅在以下建议触点或真实仓库对应职责文件内工作：studio/src/features/trace/ExecutionTrace.tsx、studio/src/features/trace/ToolTracePanel.tsx、studio/src/features/trace/ContextTracePanel.tsx、studio/src/features/trace/PromptInputsPanel.tsx。
必须满足的验收条件：默认显示摘要，Raw 显式加载；Compiler validation failure 可见；Context Revision 可定位。
至少覆盖这些测试：Tool run 显示 duration/status；Restore 可定位 group/revision；Compiler 错误在 Debug 可见。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M09-T04 · 性能基准与懒加载

**状态：** ✅ Done  
**目标：** 测量并优化 Context Panel、Message edit、Compiler、Timeline、ContextGroup 操作。  
**依赖：** M09-T01,M04-T05

**Files / Touch Points**

- `backend/tests/performance/test_runtime_targets.py`

**交付物 / 验收标准**

- [x] 目标：Panel<500ms、Edit<300ms、Compiler P95<100ms(不含模型)、Timeline<200ms、Group op<300ms
- [x] 10k+ history 分页/懒加载
- [x] 未达标时报告真实数据

**测试用例**

- [x] `M09-T04-TC01`：基准报告包含 P50/P95
- [x] `M09-T04-TC02`：10k+ messages 不全量加载

**任务专属 Prompt**

```text
实现任务 M09-T04《性能基准与懒加载》。
目标：测量并优化 Context Panel、Message edit、Compiler、Timeline、ContextGroup 操作。
依赖：M09-T01,M04-T05。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/tests/performance/test_runtime_targets.py。
必须满足的验收条件：目标：Panel<500ms、Edit<300ms、Compiler P95<100ms(不含模型)、Timeline<200ms、Group op<300ms；10k+ history 分页/懒加载；未达标时报告真实数据。
至少覆盖这些测试：基准报告包含 P50/P95；10k+ messages 不全量加载。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


# M10 · MVP E2E / 安全 / RC 门禁

**模块状态：** ✅ Done  
**依赖：** M01-M09  
**模块目标：** 用 7 个 MVP 场景和 8 条成功标准证明 V1 核心产品假设。

## 模块验收门槛

- [x] 本模块全部任务达到 `✅ Done`，或存在明确且不阻塞 V1 的延期项。
- [x] 本模块集成测试通过，并未破坏已完成模块。
- [x] 没有引入 PRD 明确排除的 V1 外能力。
- [x] 涉及状态变化的路径具备 Persistence / Revision / Trace 证据。

### M10-T01 · MVP 1：正常 Agent 对话

**状态：** ✅ Done  
**目标：** 端到端验证 Session→Chat→Tool→ToolResult→Checkpoint→Trace。  
**依赖：** M04-T06,M03-T07

**Files / Touch Points**

- `backend/tests/e2e/test_mvp_01_normal_chat.py`
- `studio/e2e/mvp-01-normal-chat.spec.ts`

**交付物 / 验收标准**

- [x] Session 可创建
- [x] ToolCall/Result 可见
- [x] Checkpoint 与 Trace 可读取

**测试用例**

- [x] `M10-T01-TC01`：普通模型回复成功
- [x] `M10-T01-TC02`：Tool 调用成功且 UI 可见
- [x] `M10-T01-TC03`：回合后 Checkpoint 存在

**任务专属 Prompt**

```text
实现任务 M10-T01《MVP 1：正常 Agent 对话》。
目标：端到端验证 Session→Chat→Tool→ToolResult→Checkpoint→Trace。
依赖：M04-T06,M03-T07。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/tests/e2e/test_mvp_01_normal_chat.py、studio/e2e/mvp-01-normal-chat.spec.ts。
必须满足的验收条件：Session 可创建；ToolCall/Result 可见；Checkpoint 与 Trace 可读取。
至少覆盖这些测试：普通模型回复成功；Tool 调用成功且 UI 可见；回合后 Checkpoint 存在。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M10-T02 · MVP 2：淘汰 Tool Interaction

**状态：** ✅ Done  
**目标：** 整体 Evict Tool Group，生成 Placeholder，下一轮 Compiler 仍输出合法序列。  
**依赖：** M02-T08,M03-T07

**Files / Touch Points**

- `backend/tests/e2e/test_mvp_02_evict_tool_group.py`

**交付物 / 验收标准**

- [x] 禁止只 Evict Call 或 Result
- [x] raw history 保留
- [x] 下一轮 Provider 调用成功

**测试用例**

- [x] `M10-T02-TC01`：只 Evict Call 被拒绝
- [x] `M10-T02-TC02`：Evict 后 Compiler PASS
- [x] `M10-T02-TC03`：Raw 仍可读取

**任务专属 Prompt**

```text
实现任务 M10-T02《MVP 2：淘汰 Tool Interaction》。
目标：整体 Evict Tool Group，生成 Placeholder，下一轮 Compiler 仍输出合法序列。
依赖：M02-T08,M03-T07。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/tests/e2e/test_mvp_02_evict_tool_group.py。
必须满足的验收条件：禁止只 Evict Call 或 Result；raw history 保留；下一轮 Provider 调用成功。
至少覆盖这些测试：只 Evict Call 被拒绝；Evict 后 Compiler PASS；Raw 仍可读取。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M10-T03 · MVP 3：恢复淘汰内容

**状态：** ✅ Done  
**目标：** Agent 搜索 Evicted Group，预算不足时 Reallocate 后 Restore 并继续。  
**依赖：** M07-T07

**Files / Touch Points**

- `backend/tests/e2e/test_mvp_03_restore.py`

**交付物 / 验收标准**

- [x] 正常 Restore 与超预算 Restore 都覆盖
- [x] 最终 Payload 不超限
- [x] Revision/Trace 完整

**测试用例**

- [x] `M10-T03-TC01`：搜索命中
- [x] `M10-T03-TC02`：预算足够直接 Restore
- [x] `M10-T03-TC03`：预算不足先 Evict 低价值 Group

**任务专属 Prompt**

```text
实现任务 M10-T03《MVP 3：恢复淘汰内容》。
目标：Agent 搜索 Evicted Group，预算不足时 Reallocate 后 Restore 并继续。
依赖：M07-T07。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/tests/e2e/test_mvp_03_restore.py。
必须满足的验收条件：正常 Restore 与超预算 Restore 都覆盖；最终 Payload 不超限；Revision/Trace 完整。
至少覆盖这些测试：搜索命中；预算足够直接 Restore；预算不足先 Evict 低价值 Group。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M10-T04 · MVP 4/5：编辑历史 + ToolResult 冲突

**状态：** ✅ Done  
**目标：** 验证 original/revision/timeline/三动作及 shipped→refunded 告警。  
**依赖：** M05-T05,M06-T03

**Files / Touch Points**

- `backend/tests/e2e/test_mvp_04_05_edit_impact.py`
- `studio/e2e/mvp-04-edit-message.spec.ts`

**交付物 / 验收标准**

- [x] 原始版本永久可见
- [x] 旧 Timeline 可查看
- [x] 冲突 issue 指向历史 ToolResult
- [x] 仅编辑不执行旧 Tool

**测试用例**

- [x] `M10-T04-TC01`：编辑生成 Revision
- [x] `M10-T04-TC02`：新 Timeline 创建
- [x] `M10-T04-TC03`：shipped/refunded 告警出现

**任务专属 Prompt**

```text
实现任务 M10-T04《MVP 4/5：编辑历史 + ToolResult 冲突》。
目标：验证 original/revision/timeline/三动作及 shipped→refunded 告警。
依赖：M05-T05,M06-T03。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/tests/e2e/test_mvp_04_05_edit_impact.py、studio/e2e/mvp-04-edit-message.spec.ts。
必须满足的验收条件：原始版本永久可见；旧 Timeline 可查看；冲突 issue 指向历史 ToolResult；仅编辑不执行旧 Tool。
至少覆盖这些测试：编辑生成 Revision；新 Timeline 创建；shipped/refunded 告警出现。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M10-T05 · MVP 6：副作用 Replay

**状态：** ✅ Done  
**目标：** 用可计数 send_email Tool 验证未确认不调用、确认一次、幂等不重复。  
**依赖：** M06-T06

**Files / Touch Points**

- `backend/tests/e2e/test_mvp_06_replay_side_effect.py`

**交付物 / 验收标准**

- [x] 四种选择可用
- [x] 高风险二次确认
- [x] 幂等保护

**测试用例**

- [x] `M10-T05-TC01`：未确认=0 次
- [x] `M10-T05-TC02`：USE_HISTORY=0 次
- [x] `M10-T05-TC03`：确认=1 次
- [x] `M10-T05-TC04`：相同幂等键重复仍=1 次

**任务专属 Prompt**

```text
实现任务 M10-T05《MVP 6：副作用 Replay》。
目标：用可计数 send_email Tool 验证未确认不调用、确认一次、幂等不重复。
依赖：M06-T06。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/tests/e2e/test_mvp_06_replay_side_effect.py。
必须满足的验收条件：四种选择可用；高风险二次确认；幂等保护。
至少覆盖这些测试：未确认=0 次；USE_HISTORY=0 次；确认=1 次；相同幂等键重复仍=1 次。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M10-T06 · MVP 7：编辑 Abstract

**状态：** ✅ Done  
**目标：** 用 PostgreSQL→MySQL 固定案例验证 generated_content 保留、user_override 生效、可恢复系统版本。  
**依赖：** M02-T08,M04-T05

**Files / Touch Points**

- `backend/tests/e2e/test_mvp_07_edit_abstract.py`

**交付物 / 验收标准**

- [x] generated_content 不被覆盖
- [x] effective_content 使用 override
- [x] 恢复系统版本后回退 generated_content

**测试用例**

- [x] `M10-T06-TC01`：Working Context 使用 MySQL
- [x] `M10-T06-TC02`：Debug 仍能看到 PostgreSQL 系统版本
- [x] `M10-T06-TC03`：恢复后 effective 回到 PostgreSQL

**任务专属 Prompt**

```text
实现任务 M10-T06《MVP 7：编辑 Abstract》。
目标：用 PostgreSQL→MySQL 固定案例验证 generated_content 保留、user_override 生效、可恢复系统版本。
依赖：M02-T08,M04-T05。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/tests/e2e/test_mvp_07_edit_abstract.py。
必须满足的验收条件：generated_content 不被覆盖；effective_content 使用 override；恢复系统版本后回退 generated_content。
至少覆盖这些测试：Working Context 使用 MySQL；Debug 仍能看到 PostgreSQL 系统版本；恢复后 effective 回到 PostgreSQL。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M10-T07 · 安全不变量门禁

**状态：** ✅ Done  
**目标：** 验证恢复来源标识、未知 Tool 默认 WRITE、Compiler 唯一出口、V1 无物理删除。  
**依赖：** M03-T07,M06-T01,M02-T07

**Files / Touch Points**

- `backend/tests/e2e/test_security_invariants.py`
- `docs/implementation/security-invariants.md`

**交付物 / 验收标准**

- [x] 恢复内容带 source/type/trust 基础元数据
- [x] 未知 Tool 不自动 replay
- [x] 任何 Provider 调用都经过 Compiler
- [x] 没有 PURGE 业务 API

**测试用例**

- [x] `M10-T07-TC01`：外部恢复内容有来源标识
- [x] `M10-T07-TC02`：未声明 Tool 不能自动 replay
- [x] `M10-T07-TC03`：Provider gateway 断言均由 Compiler 调用
- [x] `M10-T07-TC04`：API 无物理删除端点

**任务专属 Prompt**

```text
实现任务 M10-T07《安全不变量门禁》。
目标：验证恢复来源标识、未知 Tool 默认 WRITE、Compiler 唯一出口、V1 无物理删除。
依赖：M03-T07,M06-T01,M02-T07。
仅在以下建议触点或真实仓库对应职责文件内工作：backend/tests/e2e/test_security_invariants.py、docs/implementation/security-invariants.md。
必须满足的验收条件：恢复内容带 source/type/trust 基础元数据；未知 Tool 不自动 replay；任何 Provider 调用都经过 Compiler；没有 PURGE 业务 API。
至少覆盖这些测试：外部恢复内容有来源标识；未声明 Tool 不能自动 replay；Provider gateway 断言均由 Compiler 调用；API 无物理删除端点。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```

### M10-T08 · 成功标准 1-8 验收矩阵 / RC Script

**状态：** ✅ Done  
**目标：** 把 8 条成功标准映射到自动测试、UI/API 证据，形成一键 RC 门禁。  
**依赖：** M10-T01..T07

**Files / Touch Points**

- `docs/implementation/v1-acceptance-matrix.md`
- `scripts/verify-v1.sh`

**交付物 / 验收标准**

- [x] 8 条成功标准都有 test/evidence
- [x] 任一 MVP 失败即 RC 失败
- [x] 性能报告纳入结果
- [x] V1 外能力不作为 RC 阻塞项

**测试用例**

- [x] `M10-T08-TC01`：verify-v1.sh 能跑核心后端与前端 E2E
- [x] `M10-T08-TC02`：每条成功标准能定位具体 Test ID

**任务专属 Prompt**

```text
实现任务 M10-T08《成功标准 1-8 验收矩阵 / RC Script》。
目标：把 8 条成功标准映射到自动测试、UI/API 证据，形成一键 RC 门禁。
依赖：M10-T01..T07。
仅在以下建议触点或真实仓库对应职责文件内工作：docs/implementation/v1-acceptance-matrix.md、scripts/verify-v1.sh。
必须满足的验收条件：8 条成功标准都有 test/evidence；任一 MVP 失败即 RC 失败；性能报告纳入结果；V1 外能力不作为 RC 阻塞项。
至少覆盖这些测试：verify-v1.sh 能跑核心后端与前端 E2E；每条成功标准能定位具体 Test ID。
严格按 TDD：先补失败测试并确认失败，再做最小实现；完成后运行本任务测试及受影响模块回归。不要实现下一任务或 P1 能力。
```


---

# 5. 模块依赖与并行建议

```text
M00 Engineering Baseline
  ↓
M01 Runtime Foundation
  ↓
M02 Context Core
  ↓
M03 Context Compiler / Provider
  ↓
M04 Chat
  ↓
M05 Editable Conversation
  ↓
M06 Impact / Replay Safety
  ↓
M07 Restore / Allocator
  ↓
M08 Template / Workflow
  ↓
M09 Debug / Performance
  ↓
M10 MVP / Release Candidate
```

允许的有限并行：

- M00-T02 后端骨架与 M00-T03 Studio 骨架可并行。
- M02-T04 Tool Interaction 与 M02-T05 Agent Step/Human Approval 在 M02-T03 完成后可并行。
- M04 的前端组件可在对应 API contract 稳定后并行，但不能用前端假状态替代未完成后端事实状态。
- M08 的 Workflow UI 应等待 Manifest Schema/Validator 基本稳定后再展开，避免反复改 UI Schema。
- M10 的 E2E 测试骨架可以在对应模块完成时提前创建，但最终 RC 必须在 M01-M09 集成完成后执行。

# 6. 单任务 Definition of Done

- [ ] 只实现本任务和必要依赖，不包含 P1/V1 外扩展。
- [ ] 先出现能证明缺失能力的失败测试，随后因实现而转绿。
- [ ] 本任务测试全部通过。
- [ ] 受影响模块回归测试通过。
- [ ] 涉及 Context/Message/Replay/Checkpoint 的修改具有 Revision/Trace/Persistence 证据。
- [ ] 不存在绕过 ContextCompiler、Context Service、Replay Policy 的捷径。
- [ ] 错误/事务失败不会产生半写入状态。
- [ ] API/字段/类型与前序任务一致。
- [ ] 文档/契约在需要时同步更新。
- [ ] 代码 Review 通过，任务状态改为 `✅ Done`。

# 7. V1 成功标准映射

| PRD 成功标准 | 主要模块 | 关键任务 |
|---|---|---|
| 1. 用户看到 Agent 当前真正记住什么 | M02/M04 | M02-T08, M04-T05, M10-T01/T02 |
| 2. 用户可 Pin / Abstract / Evict / Restore | M02/M07 | M02-T07/T08, M07-T05/T06 |
| 3. Context 淘汰后可恢复 | M02/M07 | M07-T05/T06/T07, M10-T03 |
| 4. 修改历史 AI 回复影响后续 Agent | M05 | M05-T03/T04, M10-T04 |
| 5. 历史修改不破坏 ToolCall / ToolResult | M02/M03/M06 | M02-T04, M03-T02/T07, M10-T02/T04 |
| 6. Agent 主动找回被移出 Context | M07 | M07-T07, M10-T03 |
| 7. 开发者可从 Graph/State/Checkpoint/Trace/Context 理解执行 | M01/M09 | M09-T01/T02/T03 |
| 8. Web 刷新/重连可从后端恢复核心状态 | M01/M04 | M01-T06, M04-T02/T03, M10-T08 |

# 8. 明确不进入 V1 实施计划

- Semantic Restore / Partial Restore / Context 语义搜索 / Context Priority 自动评分
- Branch Compare / Prompt Diff / State Diff / Timeline Compare / Branch Merge / Cherry-pick
- Agent A/B Run / Context Cost Analysis / Restore Ranking / Replay Sandbox
- 模板导入导出 / 复杂模板版本管理
- 多租户 SaaS / Workspace 管理后台 / 企业组织架构 / 复杂 RBAC / Billing
- Marketplace / 插件市场 / 多人实时协作 / 完整发布审批流 / 大型 Agent Evaluation 平台
- Desktop Client（只要求 V1 Runtime API 和领域模型未来可复用）
- 真正物理删除历史数据

# 9. 推荐执行方式

**推荐：按模块 + 单任务执行。** 每个模块使用独立工作上下文，每个 Task 使用“全局 Prompt 头 + 任务专属 Prompt”。完成一个 Task 后先 Review 再进入下一个 Task；完成一个模块后跑一次从 M00 到当前模块的集成回归。

不要把 M00-M10 一次性交给一个编码 Agent。ContextOS 的难点不是代码量，而是跨模块不变量：History/Working Context 分离、ContextGroup 原子性、Compiler 唯一出口、Replay Safety 和 Timeline/Checkpoint 一致性。把任务切小，反而更容易守住这些边界。

# 10. 计划自审

- **覆盖度：** 已覆盖 P0-1～P0-9、7 个 MVP 场景、8 条 V1 成功标准、客户端恢复、Trace、幂等、性能与安全约束。
- **范围控制：** P1/V1 外功能没有拆成实施任务，只保留边界与扩展接口要求。
- **关键不变量：** Persistent History 可恢复、ContextGroup 原子操作、Allocator/Compiler 分离、Provider 只能经 Compiler、未知 Tool 默认 WRITE、Backend Source of Truth 均进入全局门槛和 E2E 门禁。
- **可执行性：** 每个子任务包含状态、目标、依赖、文件触点、验收标准、测试用例和可直接复制的 Prompt。
- **真实仓库适配：** 因未提供代码仓库，文件路径是建议值；执行 M00-T01 时先对齐实际结构，后续任务保持职责不变。
