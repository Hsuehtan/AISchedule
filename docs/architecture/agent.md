# Agent 架构

> 当前业务/算法边界及存量兼容见 [ADR-012](../decisions/ADR-012-agent-context-ownership.md)。TS 不设置模型上下文总量；Context Reader 只做授权、脱敏、传输分页与引用映射。

状态：T18–T24 核心链路已在 Phase 3 分支实现，H3 仍未通过。真实 DeepSeek Smoke 必须使用本地环境变量与合成数据单独验证；T25 语音、T26 可观测性增强和 T27 质量收口不属于当前实现。服务边界见 [`ADR-009`](../decisions/ADR-009-python-agent-service-boundary.md)，MVP 日志范围见 [`ADR-011`](../decisions/ADR-011-defer-agent-log-persistence.md)。

## 能力与计费

- `agent.standardTurn`：普通回复、澄清和动作提案，默认 1 点。
- `agent.planGeneration`：计划拆解，默认 2 点。
- `speech.transcription`：语音转写，默认 1 点。

实际成本由 `config/product/points.yaml` 决定。一次产品级请求共享同一个 `requestId` 和预留；Python 内部结构修复不重复扣分。积分规则、余额和 `reservationId` 只存在于 NestJS 业务边界。

## 服务边界

| 能力                                  | NestJS 业务侧所有者                         | Python Agent 服务         |
| ------------------------------------- | ------------------------------------------- | ------------------------- |
| 客户端 API、Session、用户归属         | Users/Agent 公开边界                        | 不接收                    |
| 积分补足、预留、结算、释放、退款      | `Users/AiPointsPort` 独占                   | 不感知                    |
| 积分调用时机编排                      | Agent 只调用 `AiPointsPort`，不直写积分表   | 不感知                    |
| AgentRequestRun、pg-boss、业务幂等    | Agent 独占                                  | 不持久化                  |
| Conversation、Message、ActionProposal | Agent 独占持久化                            | 只返回草稿                |
| AgentEvaluationEvent、产品行为审计    | Agent 独占持久化                            | 不访问                    |
| Task/Project 候选查询和真实 ID 映射   | Agent 调用 Tasks/Projects 公开查询          | 只使用临时 `candidateRef` |
| Prompt、模型路由、DeepSeek 调用       | 不感知具体实现                              | 独占                      |
| Provider 输出解析和结构修复           | Agent 最终二次校验                          | 首次校验与有限修复        |
| 最小结构化运行日志                    | 不依赖或解析 Python 日志                    | 只输出到 stdout/stderr    |
| Action 确认和业务写入                 | Agent 编排，Tasks/Projects 执行公开业务操作 | 禁止                      |

Python 服务保持业务和执行状态无状态，不拥有业务 PostgreSQL 凭证或网络路径。NestJS 每次只发送完成当前推理所需的有界对话、最小业务快照和请求内不可猜测的候选引用；不得发送密码、Session、手机号、积分余额、`reservationId` 或与本次推理无关的私人待办。Python 运行日志可以全部丢失，不能用于结果回放、requestId 去重、积分或恢复。

## 调用链

```text
POST /api/v1/agent/turns
  -> NestJS 原子创建积分预留、AgentRequestRun、幂等记录和 pg-boss Job
  <- 202 + requestId

pg-boss Worker
  -> 认领 QUEUED Run，并在 dispatch 前提交 dispatchAttemptedAt
  -> POST /internal/v2/agent/execute
       -> Python 按需调用 NestJS 私有 context/read，应用上下文策略
       -> Python 构造 Prompt、选择模型、调用 DeepSeek
       -> Python 校验/修复结构化输出
       <- 契约结果或稳定错误
  -> NestJS 二次校验结果、候选引用和业务限制
  -> NestJS 持久化 Message/Clarification/Plan/ActionProposal
  -> NestJS 幂等结算积分
  -> GET /api/v1/agent/requests/:id 才可返回 SUCCEEDED 结果
```

公开请求保持异步，内部 Python 执行端点保持同步。P0 不在 Python 中再建队列、回调协议或业务状态机。

## MVP 日志边界

P0 只有业务/控制平面和推理平面，不建设持久化可观测性数据面：

1. **业务/控制平面**：NestJS + PostgreSQL + pg-boss，独占 Run、结果、积分、幂等、deadline、lease、产品评测和恢复决策。
2. **推理平面**：Python 在一次同步 execute 内完成 Prompt、Provider、校验和有限结构修复；请求结束后不保留可回放结果或算法日志。

Python 只输出少量结构化 JSON 到 stdout/stderr，包含稳定事件名、级别、服务版本、`requestId`、`capabilityCode`、`contractVersion`、最终 resolved Provider/模型/Prompt/Schema 版本、结果类型、稳定错误分类、结构修复次数和总耗时。日志写入是 best-effort；格式化或输出失败不得改变 HTTP 响应、readiness、Provider 调用次数或积分语义。

P0 不引入文件日志、日志数据库、对象存储、远程 Exporter、OTLP/Collector、Metrics/Trace 后端、durable spool、日志查询 API、保留策略或仪表盘。Python 不记录 Token usage、工具调用明细、`userId`、`reservationId`、Session、真实 Task/Project ID、`candidateRef`、积分、完整对话/任务、原始 Prompt、模型正文、Chain of Thought、Secret 或 Provider 原始错误正文。

`AgentRequestRun` 保存最终 resolved 版本与稳定错误。`AgentEvaluationEvent` 是 T26 的产品评测扩展点，启用后也只能由 NestJS 记录用户修正、确认、取消和执行结果；T18–T24 不依赖该表。这些业务事实不等于 Python 算法日志。未来如需算法日志持久化，必须新立任务和人工门禁，且仍不得成为业务事实源。

## 请求状态机

```text
QUEUED
  -> RUNNING
       -> RESULT_PERSISTED
            -> SETTLING
                 -> SUCCEEDED
       -> FAILED
            -> RELEASED
```

不变量：

1. Agent admission 通过平台 `UnitOfWork` 开启唯一事务；transaction-scoped `AiPointsPort.reserve(...)`、AgentRequestRun/Idempotency Repository 和 pg-boss Prisma Adapter 共享不透明 `TransactionScope`，使 `QUEUED`、有效积分预留、幂等记录和 Job 原子创建。Agent 不直写积分表，`AiPointsPort` 不自行开启事务或创建 AgentRun。
2. Worker 使用同一条件事务确认预留仍为 pending 且未过期、写入 Run 截止时间、延长预留 lease，并提交 `QUEUED -> RUNNING` 与 `dispatchAttemptedAt`；CAS 失败或预留已过期的 Worker 不得发送 HTTP，同一产品请求最多一次 NestJS → Python execute dispatch。
3. `RUNNING -> RESULT_PERSISTED` 必须在业务 PostgreSQL 中原子写入一个通过验证的产品结果及其 `resultHash`；`resultHash` 由 NestJS 对规范化后的已验证结果计算，不能信任 Python 提供值。
4. `RESULT_PERSISTED` 已形成计费义务；之后只能重试结算，不能释放预留或再次调用 Python。
5. `FAILED -> RELEASED` 只允许在没有持久化可用结果时发生；`FAILED` 不得与 `resultPersistedAt` 同时存在。
6. 结果持久化与预留回收通过条件更新竞争：结果只有在预留仍有效时可提交；回收只有在 Run 已过截止时间、预留已过期且无结果时可提交，先成功者决定最终状态。
7. `SUCCEEDED` 必须同时具备已持久化结果和唯一成功 debit；此前结果不向客户端开放。
8. 队列重放遇到 `RUNNING` 且已记录 dispatch、`RESULT_PERSISTED`、`SETTLING` 或 `SUCCEEDED` 时不得再次调用 Python。

## 内部契约

新 Run 的唯一规范工件是 `packages/contracts/internal-agent/v2/openapi.yaml`；v1 规范与路由保留兼容，使用 OpenAPI 3.1 与 JSON Schema 2020-12。仓库生成并提交 Node Zod 与 Python Pydantic 模型；`pnpm agent:contract:check` 重新生成并检查漂移，FastAPI 实际 Schema 做完整规范化等价比较。Golden Fixtures 只补充正反例行为，不能作为唯一一致性证明。任一端产生不兼容变更时 CI 失败。

P0 端点：

```text
POST /internal/v2/agent/execute
POST /internal/v2/agent/context/read # NestJS，独立认证
POST /internal/v1/agent/execute # 存量兼容
GET  /internal/health/live
GET  /internal/health/ready
```

执行请求至少包含：

```text
requestId
capabilityCode
contractVersion
locale / timezone
allowedResultTypes
deadlineAt
```

NestJS 不指定具体 Provider、模型或 Prompt。执行响应必须回显 `requestId` 和 `contractVersion`，返回实际使用的 `provider/model/promptVersion/providerSchemaVersion` 元数据，并只返回以下联合类型之一：

```text
REPLY
CLARIFICATION
CANDIDATES
PLAN
ACTION_PROPOSAL
```

结果引用只能取自本 Run 上下文读取保存的 `candidateRef`；NestJS 负责映射回当前用户的真实对象并重新检查归属和版本。Python 或模型返回的数据库 ID、额外字段、未知结果类型和超出限制的内容一律视为无效外部输入。

`contractVersion` 是 Node/Python 共同冻结的内部 HTTP 协议版本；`providerSchemaVersion` 是 Python 内部 Provider 输出与 Prompt 配套版本。两者不得混用，后者只作为结果审计元数据返回，不控制 NestJS 业务分支。

稳定错误至少区分契约错误、未授权、请求过大、Provider 限流、Provider 超时、Provider 不可用、空结果和结果 Schema 无效。错误响应不包含 Prompt、原始 Provider 正文、Secret 或完整用户上下文。

## 什么情况下扣积分

“Agent 正常返回结果”同时满足以下条件才构成扣分：

1. Python 返回成功响应；
2. `requestId` 和契约版本匹配；
3. 结果通过共享 Schema 与 NestJS 二次校验；
4. 结果类型属于本次能力允许列表；
5. 候选引用来自本次请求且仍可解析到当前用户对象；
6. 内容通过长度、安全和业务规则；
7. 对应 Message、澄清卡、候选卡、计划或 ActionProposal 已在 NestJS PostgreSQL 持久化。

满足后由 NestJS 按 `reservationId` 幂等结算一次。Python 不返回 `billable`，也不能影响积分决策。HTTP 2xx、DeepSeek 已产生费用、空内容、非法 JSON、未知结果、伪造引用、超时、断连或持久化失败都不能单独触发扣分。

用户在有效结果结算后关闭对话、忽略回复、取消 Action 或拒绝写入，不退款；因为本次购买的是已经交付的推理结果，而不是后续业务写入成功。

## 产品闭环

### 普通对话与上下文

- `POST /api/v1/agent/turns` 接受 1–500 字纯文本；新输入创建 Conversation，对话内输入复用 Conversation。
- 普通请求固定绑定 `agent.standardTurn` 和 1 点成本，客户端不能选择能力、模型或价格。
- Python 按需读取授权历史，自行选择最近 20 条、合计不超过 12 KiB 的模型历史（初始算法参数）；Python 的 REPLY 最终按纯文本展示，不渲染 HTML。
- 公开请求只有在积分结算完成并进入 `SUCCEEDED` 后才开放 Message/Proposal。关闭 Panel 不取消 Run，Smart Inbox 可以恢复处理中、待处理或未读结果。
- P0 不提供完整历史会话列表，只提供当前 Conversation 的游标消息读取。

### 澄清与候选消歧

- Python 初始策略读取 50 个 Task、30 个活跃 Project，数量只由 Python 配置；每个对象只以随机临时 `candidateRef` 进入 Python。
- 问题卡保存为带版本的 QUESTION Message。客户端只提交服务端 optionId 或 1–500 字补充文本；NestJS 重新检查消息、对象归属和目标版本。
- 可以由确定性规则推进的答案不调用模型、不扣分。需要继续推理时必须创建新的 `requestId` 并按服务端保存的 `nextStep` 预留。
- “都不是”只打开补充输入；用户真正提交文本时才形成新请求。

### 二阶段计划

- 普通理解或计划澄清按 1 点；用户点击“生成计划”或完成计划澄清后，另建 `agent.planGeneration` 请求并按 2 点计费。
- PLAN 直接持久化为 `CREATE_PROJECT_TASKS` ActionProposal，不建立 Plan 表。单个计划 1–10 项，可引用已有项目或使用新项目名称。
- 项目、标题、优先级、三个时间字段和计划项删除由本地白名单编辑完成，不调用模型、不扣分。
- “再改一下”产生新的 2 点 Run；待确认草稿与执行失败的计划均可作为重生成来源；新草稿成功持久化后才 supersede 旧草稿，失败执行记录保留。关闭只 dismiss，明确取消才进入 CANCELLED；草稿 7 天后惰性过期。

### 提案确认

- 公开提案的 `presentation` 来自关联 Run 的 `resultType`：`PLAN` 使用可编辑的计划草稿浮层，`ACTION_PROPOSAL` 使用对话内 Action 确认卡；操作码不能充当展示分类。同一对话的历史消息与 Smart Inbox 恢复均按该字段分流。
- Action 卡展示持久化 Mutation 的操作对象、字段前后值与界面影响。用户确认后对话保持打开，原卡按同一提案 ID 更新为已执行。整理建议可移除单项任务草稿；通用 Action 的修正通过对话完成。
- 支持创建任务、创建项目及任务、整理、修改、完成、恢复和软删除七类 Action。
- Python 只返回草稿；NestJS 在确认时重新校验 Proposal、Task、Project 版本、用户归属、项目状态和名称唯一性。
- 全部 Mutation 通过 transaction-scoped Tasks/Projects Port 在一个事务中执行；一个 Proposal 最多一个 ActionExecution，重复确认返回同一结果。
- 确认、取消、草稿编辑和数据库写入不再扣分。创建、完成和恢复无短时撤销；软删除生成一个服务端 3 秒有效的批量 UndoOperation。

计划浮层按真实 Proposal 状态显示：只有待确认计划可以创建，失败计划提供重新生成，已执行、取消、过期和替代计划只读。编辑未保存时禁止直接确认，保存失败保留本地输入。确认响应丢失时重新读取提案状态，不重新派发推理；关闭后的异步结果不主动重开浮层。重生成或确认尚未返回时，关闭只离开界面，不提交会改变来源版本的 dismiss；后台处理继续。

### Smart Inbox

Smart Inbox 是 NestJS 派生读模型，不建主表、不调用 Python、不扣分。优先级固定为：待确认、待澄清、处理中、执行失败、未读回复、无项目待办整理、当前项目/空状态入口、默认入口。前五类是账户全局状态，不因项目筛选隐藏；已 dismiss 的失败 Proposal 不再持续置顶。

客户端在页面可见且 Inbox 为 PROCESSING 时每 2 秒刷新业务进度；关闭对话后也能更新到待确认或未读回复，不触发新推理。

只有无项目未完成任务触发“一键整理”，每次最多 20 项；点击后按普通能力新建 1 点 Run，结果仍须用户确认。额度耗尽与服务不可用分别映射为稳定 429/503，不向客户端展示积分数字、Token、模型或充值入口。语音入口在 T25 前保持不可用。

## 失败与重试

| 场景                                   | 用户积分       | 是否自动再次调用 Python/模型 | 处理                                                 |
| -------------------------------------- | -------------- | ---------------------------- | ---------------------------------------------------- |
| 余额不足或配置非法                     | 不变           | 否                           | 不入队，返回不可用                                   |
| 同幂等键、同请求重试                   | 至多结算一次   | 否                           | 返回原 Run                                           |
| 预留与入队事务失败                     | 不变           | 否                           | 全部回滚                                             |
| Worker 在记录 dispatch 前崩溃          | 保持预留       | 可以                         | Job 重放后首次调用                                   |
| 排队至预留已过期                       | 释放           | 否                           | 禁止 dispatch，条件更新为失败并回收                  |
| 已记录 dispatch 后崩溃/断连/超时       | 到期后释放     | 否                           | 宽限期后核对为无结果才释放，平台承担可能成本         |
| HTTP 2xx 但空内容/非法 Schema/伪造引用 | 释放           | 否                           | 拒绝结果并记录稳定错误                               |
| 合法结果持久化成功                     | 结算一次       | 否                           | 只重试结算，成功后开放                               |
| 持久化提交结果不确定                   | 保持预留       | 否                           | 持续按 `requestId/resultHash` 核对，未知期间禁止释放 |
| 结果已持久化但结算失败                 | 保持预留       | 否                           | 幂等重试结算                                         |
| 释放后收到迟到响应                     | 不变           | 否                           | 丢弃，不重新进入结算                                 |
| 用户主动重试已失败请求                 | 新请求重新预留 | 新 `requestId` 可调用一次    | 不复用失败 Run                                       |

Node HTTP Client 不自动重试执行端点。Python 对一次主调用只允许在已明确收到内容、但结构可修复时进行同请求内最多一次结构修复；Provider 超时、连接重置和其他执行结果不确定的错误不自动重放。

持久化事务结果不确定时必须持续保留预留并核对，不能把数据库暂时不可查询或“暂未查到”解释为失败。确认事务已提交则进入结算；确认未提交且 Worker 仍持有已验证响应时可重试持久化；只有明确没有持久化结果且超过 Run 截止时间，才可进入释放流程。

## 截止时间与回收

时间配置必须满足：

```text
executeTimeoutAt < runDeadlineAt < reservationExpiresAt < recoveryEligibleAt
```

- `executeTimeoutAt`：NestJS 等待 Python 响应的最晚时间。
- `runDeadlineAt`：本 Run 不再接受新推理结果的时间。
- `reservationExpiresAt`：积分预留进入故障核对的时间，必须晚于 Run 截止时间。
- `recoveryEligibleAt`：预留过期并经过宽限期后，回收器可以尝试处理的时间。

批准的默认值：admission lease 5 分钟；standard/plan 的 NestJS 内部 HTTP 超时分别为 35/65 秒，Run deadline 分别为 40/70 秒；预留至少晚于 Run deadline 60 秒，恢复再等待 60 秒。调整这些值时必须保持上述严格顺序并同步积分与故障测试。

恢复协调器按独立保底配额轮转扫描 `QUEUED / RUNNING / RESULT_PERSISTED / SETTLING / FAILED`，并把空闲配额回收给仍有积压的状态，最终结果不超过配置批次；它只把现有 Run 重新交给同一个幂等 Worker。`RUNNING` 只在 `recoveryEligibleAt` 之后回收；有持久化结果则继续结算，无结果且事务状态已明确时，通过互斥条件更新执行 `FAILED -> RELEASED`。即使 Python URL/Token 缺失、Agent 新请求 admission 已停用，pg-boss Worker 与恢复协调器仍必须运行，以释放历史 pending debit 或完成既有结果结算；不得因此重新调用模型。发现查询中途失败时重置本轮全部内存游标；任一候选入队失败时仍尝试本批其他候选，再重置游标，确保没有实际入队的 Run 在下一轮重新发现。Python 响应在 Run 截止或预留释放后到达时必须丢弃。恢复批量配置最少为 5，保证五类状态都有独立扫描配额。

Python 不得提供持久化 Run 查询、结果回放、callback recovery 或 requestId 执行去重。含糊超时继续按上述保守语义处理；未来若产品必须透明恢复，需要重新设计执行所有权与计费并另立 ADR，且不得复用任何日志存储作为恢复依据。

## Provider 与安全

Python 内部定义 Provider Port，P0 默认 DeepSeek：普通能力使用 `deepseek-v4-flash`、30 秒、thinking disabled、temperature 0.2、max tokens 2048；计划能力使用 `deepseek-v4-pro`、60 秒、thinking enabled、reasoning effort high、temperature 0.2、max tokens 4096。模型、Base URL、超时、Prompt 和 Schema 版本均配置化；DeepSeek Secret 只注入 Python 服务。

内部服务只在私有网络开放并校验服务身份；限制请求体、并发和超时，并贯穿稳定 `requestId`。Python 只输出 ADR-011 允许的非持久化结构化日志；生产 DEBUG 和 Uvicorn 全量 access log 默认关闭。

DeepSeek JSON Output 可能出现空内容，因此 Provider 成功响应仍需执行产品 Schema 校验：[官方 JSON Output 说明](https://api-docs.deepseek.com/guides/json_mode)。

## 写入边界

1. NestJS 查询当前用户允许操作的候选对象，并生成请求内临时引用。
2. Python 只做语义判断，返回引用和结构化草稿，不持有 Repository。
3. NestJS 校验结果后生成 ActionProposal，不修改业务数据。
4. 用户确认时再次校验归属、对象版本、提案状态和幂等键。
5. ActionMutation 在一个业务事务中原子执行。
6. ActionExecution 和评测事件记录实际结果。

手工 CRUD 不经过 Agent 确认，也不调用 Python 或扣积分。

## 验证入口

- `pnpm agent:contract:check`：检查 OpenAPI、Node Zod、Python Pydantic 与 FastAPI Schema 一致性。
- `pnpm test` / `pnpm test:integration`：覆盖积分、Python 故障、Run 状态机、产品对话与 Action 原子执行。
- `pnpm smoke:deepseek`：非默认 CI 的真实链路 Smoke；要求本地 `DEEPSEEK_API_KEY`，只用合成数据，覆盖一次 standard reply 和一次 plan generation。输出只允许通过/失败、模型和耗时，不打印 Prompt、响应正文或 Secret。

缺少真实密钥或 Smoke 未通过时，不得以 Stub 结果宣告 Phase 3 完成。H3 仍需在 T27 后单独人工批准。
