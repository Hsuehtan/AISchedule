# Phase 3 Python Agent 服务规划接管快照

- 日期：2026-07-16
- 范围：架构评估、ADR、PRD 与计划修订；未执行代码开发
- 当前分支：`codex/phase2-manual-loop`
- 当前门禁：H2 未通过，禁止开始 T18/T19
- 决策真源：[`ADR-009`](../decisions/ADR-009-python-agent-service-boundary.md)

## 本次结论

接受将 Agent 推理运行时拆为 Python 私有服务，但不把产品 Agent 业务域迁出 NestJS。

- NestJS 仍是客户端唯一入口和业务事实源；`Users/AiPointsPort` 独占积分账本，Agent 模块负责编排 AgentRequestRun、pg-boss、会话/消息/提案、候选查询、人工确认与最终写入。
- Python 只负责 Prompt、模型路由、DeepSeek 调用和结构化输出；不访问业务数据库，不接收 Session/积分信息，不决定扣费或执行 Action。
- 公开请求保持 `202 + requestId` 异步；NestJS Worker 对 Python 使用一次有界同步 HTTP 调用。
- Agent admission 通过平台 `UnitOfWork` 让 transaction-scoped `AiPointsPort`、Run/幂等 Repository 和 pg-boss Adapter 共享不透明事务作用域；任何一步失败整体回滚，Agent 不直写积分表。
- P0 保持同一 Monorepo、同一发布版本和 Compose 入口，不增加 Python 数据库、Redis、Kubernetes、服务网格或第二套队列。

## 积分结算口径

调用 Agent 前必须由 NestJS 原子预留积分。只有 Python 返回值满足当前协议、结果类型、候选引用和业务规则，且可用产品结果已由 NestJS 成功持久化，才按 `reservationId` 幂等结算一次。

以下情况不扣积分：HTTP 2xx 但空/非法结果、未知类型、伪造引用、超时、断连、5xx 或没有成功持久化。已持久化结果后的结算失败只能重试结算；不得释放预留或再次调用模型。用户在结果结算后关闭、忽略或拒绝 Action 不退款。

## P0 故障取舍

同一产品请求最多一次 NestJS → Python execute dispatch。Python 在该 execute 内可执行主调用和最多一次已批准的结构修复，仍只结算一次。Worker 调用 Python/DeepSeek 后出现含糊超时或断连时不自动重派 execute；达到回收时间且确认没有持久化结果后才释放用户预留，平台承担可能已经产生的 Provider 成本。未来只有在真实故障数据证明必要时，才另立 ADR 为 Python 增加持久化幂等 Run API。

执行时限固定满足 `executeTimeoutAt < runDeadlineAt < reservationExpiresAt < recoveryEligibleAt`；dispatch 前必须在同一条件事务中确认并延长 pending 预留。数据库提交结果未知时保持预留并持续核对，不能按失败释放。

## Phase 3 计划

1. T18.1–T18.4：先在 NestJS Users 模块完成积分配置、账本、每日补足、数据库硬约束、原子预留/结算/释放/回收和管理员调账；T18.3 以单条 pending DEBIT 为真源，通过 expand/contract 取代尚未使用的 RESERVATION/RELEASE 基线。
2. T19.1：以 `packages/contracts/internal-agent/v1/openapi.yaml` 为唯一规范工件，完成 Zod/Pydantic/FastAPI Schema 等价校验和补充 Fixtures。
3. T19.2：建立 FastAPI 私有服务、安全边界与健康检查。
4. T19.3：先实现并验证 Python DeepSeek Adapter、版本化 Prompt/Schema 和有限结构修复，冻结旧 Node 风险验证代码。
5. T19.4a–T19.4d：实现 Run Migration、AgentRuntimePort/HTTP Adapter、pg-boss、执行/预留截止时间、单次 execute dispatch 和跨服务故障测试；替代路径验证通过且旧路径零活动引用后，再移除 Node Provider/配置。
6. T20–T24：按文本、澄清/候选、计划、提案确认、Smart Inbox 继续纵向切片。

## 尚未实施

- 仓库中没有 `apps/agent-service`、Python 依赖或内部 OpenAPI 文件。
- 没有修改 Prisma Schema、Migration、NestJS、客户端、Compose、CI 或部署配置。
- 没有连接 DeepSeek、使用真实 Secret、产生 Provider 费用或使用生产数据。
- `product_doc/backend-api.md` 仍只描述 H2 当前真实接口，未写入未来端点。

## 唯一下一步

继续等待人类完成 H2 手工闭环审查。只有收到明确回复“通过”，才可以勾选 H2 并从 T18 开始实施；不得因本次 Phase 3 文档已确认而跳过门禁。
