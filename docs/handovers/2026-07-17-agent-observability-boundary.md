# Phase 3 Agent 可观测性边界接管快照

- 日期：2026-07-17
- 范围：架构与计划文档，不含代码实现
- 当前门禁：H2 未通过，禁止开始 T18
- 决策：[`ADR-009`](../decisions/ADR-009-python-agent-service-boundary.md)、[`ADR-010`](../decisions/ADR-010-agent-observability-data-boundary.md)

## 本次确认

1. “Next.js 业务后端”是笔误，业务后端继续使用 NestJS/Fastify。
2. 客户端到 NestJS 保持异步 `202 + requestId`；pg-boss Worker 到 Python 保持单次同步 execute。
3. Python 永不读写业务数据库，不持久化 AgentRequestRun、结果、积分、幂等或恢复状态。
4. Python 可以向独立可观测性数据面追加模型/工具步骤、数值型 Token usage、延迟和错误分类等白名单算法遥测。
5. 算法遥测是旁路、尽力而为、非权威数据；其成功、失败、缺失、重复、乱序或删除不能改变 execute、dispatch、Run 或积分终态。
6. 2026-07-16 规划中“未来可采用 Python 持久化 Run API”的设想已被废止。透明恢复若成为新产品要求，必须重新立 ADR，且不得复用遥测存储作为恢复依据。

## 数据所有权

| 数据                                            | 唯一所有者                     | Python 权限    |
| ----------------------------------------------- | ------------------------------ | -------------- |
| 用户、Task、Project、Conversation、Proposal     | NestJS/PostgreSQL              | 无             |
| AgentRequestRun、幂等、deadline/lease、结果恢复 | NestJS/PostgreSQL/pg-boss      | 无             |
| 积分预留、结算、释放、退款                      | `Users/AiPointsPort`           | 无             |
| 产品评测与用户行为事件                          | NestJS `AgentEvaluationEvent`  | 无             |
| 模型/工具/Token/延迟算法遥测                    | 独立 Collector/Telemetry Store | 仅追加，不读回 |

## 计划落点

- T19.1：冻结 Trace Context 和“无 Run/回调/回放 API”负向契约。
- T19.2：交付 `AlgorithmTelemetryPort`、字段白名单、有界异步 Exporter、故障 Stub 和 drop counter。
- T19.3：为模型调用、有限结构修复和纯算法工具步骤发射受控遥测。
- T26：接入独立后端、仪表盘、保留/访问/删除策略、Evaluation 离线关联和遥测故障演练。
- T28：验证业务数据库网络隔离、遥测只写凭证、脱敏和生产访问控制。

## 接管时不要做

- 不给 Python 配置业务 PostgreSQL 凭证或网络路径。
- 不增加 Python Run create/status、callback、结果回放或 requestId 执行去重接口。
- 不从遥测后端决定是否重调 Provider、结算/释放/退款、开放结果或恢复 Run。
- 不把原始 Prompt、完整模型/工具正文、私人任务、Chain of Thought、Session、认证 Token、`reservationId` 或业务 ID 写入普通日志。
- H2 未明确通过前，不创建 Python 服务、可观测性后端，不调用 DeepSeek/ASR，也不进入 T18。

## 唯一下一步

等待人类完成 H2 审查并明确回复“通过”。通过后从 T18.1 积分配置与能力注册开始，不越过积分子域直接开发 Agent。
