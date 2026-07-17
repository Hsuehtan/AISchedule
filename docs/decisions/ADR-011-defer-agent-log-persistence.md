# ADR-011：MVP 延后 Agent 算法日志持久化

- 状态：Accepted；T19 已实施
- 日期：2026-07-17
- 取代范围：[`ADR-010`](ADR-010-agent-observability-data-boundary.md) 中关于 P0/T19/T26 建设算法遥测持久化、Collector、保留策略和仪表盘的计划
- 保留范围：ADR-010 关于 Python 永不访问业务数据库、算法日志不得参与业务正确性判断的长期边界继续有效

## 背景

ADR-010 为未来改进 Agent 算法设计了独立可观测性数据面，并一度把日志/Trace 持久化后端纳入 P0 的 T26。最新产品决策明确：MVP 只验证 Agent 产品闭环，不建设 Python 算法日志持久化；模型调用记录、工具调用记录、Token 使用量和算法性能数据的长期保存属于后续迭代可能，不是当前交付范围。

对个人开发者而言，提前引入 Collector、遥测存储、保留策略、访问控制和仪表盘会增加部署与隐私成本，却不直接帮助验证 P0 的用户价值。MVP 仍需要最小运行日志来定位即时故障，但这不等于建设日志产品或持久化数据面。

## 决策

### MVP Python 日志边界

Python Agent 只向标准输出/标准错误输出最小、结构化、经过白名单处理的运行日志。应用代码不得：

- 把算法日志写入本地文件、数据库、对象存储或远程日志服务。
- 引入 OTLP Exporter、Collector、Trace/Metrics 后端、算法日志查询 API 或仪表盘。
- 为日志实现 durable queue、落盘缓冲、重放、保留期、索引或备份。
- 持久化模型/工具调用明细、Token 使用量、原始 Prompt、模型响应、工具参数/结果或 Chain of Thought。

MVP 最小日志仅用于当前进程的开发和故障定位，允许字段为：

- 稳定事件名、日志级别、时间和服务版本。
- `requestId`、`capabilityCode`、`contractVersion`。
- 最终 resolved Provider/模型/Prompt/Schema 版本、结果类型和结构修复次数。
- 最终 outcome、稳定错误分类和 `durationMs`。

不得记录用户 ID、Session、手机号、`reservationId`、`candidateRef`、业务对象 ID、积分、私人正文、Secret 或任何认证 Token。P0 不承诺这些 stdout/stderr 日志在进程或容器退出后仍可查询；即使运行平台短暂接管标准输出，也不把它视为产品级算法日志持久化能力，部署和业务正确性均不得依赖其保留。

### 仍在 MVP 持久化的业务事实

以下数据继续由 NestJS 写入业务 PostgreSQL，因为它们属于产品正确性和审计，而不是 Python 算法日志：

- `AgentRequestRun`、Conversation、Message、ActionProposal、ActionExecution 和积分状态。
- NestJS 已校验并持久化的可用结果。
- 成功结果实际使用的 Provider、模型、Prompt、Provider Schema 和内部契约版本。
- T26 启用 `AgentEvaluationEvent` 后，由 NestJS 记录的用户修正、确认、取消、执行与撤销等产品行为事实。

Python 不直接写入上述数据，只通过同步 execute 响应返回契约允许的结果和最终 resolved 版本元数据。P0 不把每次模型尝试、结构修复尝试、工具调用明细或 Token usage 复制进业务数据库。

### 未来扩展

算法日志持久化不属于 T01–T30，也不属于 H3/H4 的 MVP 验收条件。未来确有算法优化需求时，重新提出独立任务并经过人工评审，再决定：

- 需要回答的算法问题与最小事件集合。
- 是否使用 Collector/OTLP，以及具体存储后端。
- 抽样、脱敏、访问、保留、删除、费用和合规策略。
- 是否需要模型/工具调用明细和 Token usage。

未来方案仍不得访问或复用业务数据库，也不得让算法日志参与 dispatch、Run、积分、幂等、结果开放、迟到响应或恢复判断。

## 结果

### 正面

- 缩小 MVP 工程、部署和隐私范围，优先验证 Agent 用户闭环。
- Python 继续保持业务/执行状态无状态，不产生第二套事实源。
- NestJS 业务审计仍足以支持结果追溯、积分和 Action 安全。

### 代价

- MVP 不能跨进程长期分析模型延迟、Token 成本、结构修复率或工具失败率。
- 进程退出后可能无法复盘 Python 运行细节；必要时依赖可复现输入、业务状态和 Stub/故障测试定位。

## 验证要求

- Python 依赖和配置中不存在日志数据库、对象存储、OTLP/Collector、Trace/Metrics 后端或远程日志 Exporter。
- Python 不创建算法日志文件、日志表、持久队列或查询端点。
- stdout/stderr 日志 Schema 只包含白名单字段，敏感数据和正文不出现。
- 删除或完全丢失 Python 运行日志后，NestJS 的结果、Run、积分、幂等和恢复终态不变。

## 实施记录

- Python 使用 best-effort 白名单结构化 logger；logger 故障测试证明日志异常不改变 execute 响应或 Provider 调用次数。
- 依赖中没有数据库、文件日志、OTLP/Collector、远程 Exporter 或日志查询后端。
- 生产模式关闭 Uvicorn access log；Compose 对 Python 设置 `logging.driver: none`，不把 stdout/stderr 变成 MVP 持久化数据面。
- NestJS 不解析 Python stdout/stderr，也不将其用于 Run、积分、幂等、dispatch、结果开放或恢复。
