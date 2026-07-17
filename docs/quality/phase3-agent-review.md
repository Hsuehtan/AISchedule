# Phase 3（T18–T24）积分与 Agent 审查包

## 审查状态

- 分支：`codex/phase3-agent`
- 范围：T18–T24
- 实施状态：代码、数据库迁移、契约、客户端和文档已实现
- 验证状态：Stub 全量自动化、三视口截图、axe 与人工截图复核已通过
- 真实 Provider：DeepSeek Smoke 尚未执行，当前环境缺少 `DEEPSEEK_API_KEY`
- 门禁：H2 已通过；H3 仍未通过
- 明确未进入：T25–T27、腾讯 ASR、生产部署、公网开放、真实用户数据

以上状态意味着“已形成 Phase 3 审查候选”，不表示 Phase 3 已完成或 H3 已通过。当前唯一缺失的完成证据是真实 DeepSeek Smoke；Stub 自动化不能替代它。

## 本阶段完成项

### T18 积分

- YAML v2 是 Grant 与能力成本的唯一配置真源；数据库能力版本只保留不可变历史快照。
- `AiPointsPort` 通过平台 `UnitOfWork` 完成预留、lease、结算、释放和退款，Agent 不直写积分表。
- 预留使用单条 `DEBIT/PENDING`；成功原地结算，失败原地取消。
- 注册初始赠送、用户本地日期懒执行每日补足、零差额日标记和管理员调账已接入统一账本。
- 管理员提供 add/subtract/set/history CLI，负向调账不侵占有效预留。

### T19 Python Agent 与跨服务链路

- `apps/agent-service` 使用 Python 3.11、FastAPI、Pydantic v2 和 HTTPX，无数据库依赖或业务数据库凭证。
- `packages/contracts/internal-agent/v1/openapi.yaml` 是 Node/Python 唯一内部协议真源。
- 私有 execute 使用 256-bit Bearer Service Token、256 KiB 请求上限和有界并发。
- DeepSeek Adapter 支持普通/计划 Profile、JSON Output 和同一 execute 内最多一次结构修复。
- NestJS Admission 在同一事务中完成每日补足、积分预留、幂等、Run 和 pg-boss Job。
- Worker 每个产品请求最多派发一次 Python execute；结果持久化后只重试积分结算。

### T20–T22 对话、澄清与计划

- 普通文字输入、异步轮询、Conversation/Message 持久化、关闭后恢复和未读结果已接入正式客户端。
- 候选对象使用随机临时引用；Python 不接收或返回可信业务 ID。
- 确定性澄清回答不调用模型、不扣分；继续推理创建新请求并重新预留。
- 普通理解 1 点、计划生成 2 点采用二阶段计费。
- 计划以可编辑 `CREATE_PROJECT_TASKS` Proposal 保存；本地编辑不调用模型，重新生成才创建新的 2 点请求。

### T23 Action 确认

- 支持创建任务、创建项目及任务、整理、修改、完成、恢复和软删除七类 Action。
- 确认时重新检查用户归属、Proposal/Task/Project 版本和项目状态。
- 批量 Mutation 在一个事务中全部成功或全部回滚；一个 Proposal 最多一个 Execution。
- 重复确认返回相同结果；批量软删除只生成一个服务端 3 秒 UndoOperation。

### T24 Smart Inbox 与降级

- Smart Inbox 由业务状态实时派生，不建主表、不调用模型、不扣分。
- 固定优先级为待确认 → 待澄清 → 处理中 → 执行失败 → 未读回复 → 无项目整理 → 当前范围入口 → 默认入口。
- 整理只针对无项目的未完成任务，每次最多 20 项，生成 Proposal 后仍需确认。
- 额度不足、能力停用和服务异常使用不同的对外降级文案，不展示积分数字、模型、Token 或成本。
- 语音入口继续暂不可用，T25 前不连接腾讯 ASR。

## 可复现演示路径

### 自动化产品闭环

运行 `pnpm test:e2e`，其中 `tests/e2e/phase3-agent.spec.ts` 使用隔离 PostgreSQL、真实 NestJS 和受控私有 Agent Stub 执行：

1. 注册隔离用户并创建一个项目及两个无项目任务。
2. 从首页打开文字 Agent，提交普通目标并收到纯文本回复。
3. 从回复进入“生成计划”，检查两项计划并确认原子创建。
4. 从 Smart Inbox 发起无项目任务整理，检查 Proposal 并确认执行。
5. 发起完成任务 Action，确认后验证业务状态改变。
6. 发起澄清请求，选择一个服务端 option，并验证确定性推进。
7. 扫描 Agent 对话区 axe，验证 44px 热区、无水平溢出和三视口截图。

### 真实 DeepSeek Smoke

用户在本地 Shell 安全注入 `DEEPSEEK_API_KEY` 后运行：

```bash
pnpm smoke:deepseek
```

Harness 使用合成数据和隔离测试用户，覆盖一条 standard reply 与一次 plan generation，并检查 NestJS 持久化、`resultHash`、1 点/2 点结算和结构修复总调用上限。输出不得包含 Prompt、响应正文或 Secret。

当前结果：**未执行；当前环境缺少 `DEEPSEEK_API_KEY`。**

### 管理员积分 CLI

在隔离测试数据库中按 [`../runbooks/admin-cli.md`](../runbooks/admin-cli.md) 复核：

```bash
pnpm admin:points-add
pnpm admin:points-subtract
pnpm admin:points-set
pnpm admin:points-history
```

检查点：操作者与原因必填、dry-run 不写库、负向调账不侵占预留、账本和 `ADMIN_ADJUSTMENT` 审计一致。

## 截图与可访问性

最终 E2E 已生成并人工复核：

- `docs/quality/screenshots/phase3-agent-clarification-320x844.png`
- `docs/quality/screenshots/phase3-agent-clarification-390x844.png`
- `docs/quality/screenshots/phase3-agent-clarification-480x844.png`

复核结论：三种宽度无水平溢出；候选内容在回答后仍清晰可读；Agent 对话区 axe 无违规；所有可见按钮热区不小于真实 44 CSS px。H1 Fixture 截图没有被用作正式 Phase 3 证据。

## 自动化结果

| 命令/范围                   | 结果                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| `pnpm agent:contract:check` | 通过；生成工件无 diff                                                        |
| Python Ruff / mypy / pytest | 通过；pytest 87/87                                                           |
| `pnpm test`                 | 通过；Server 126、Client 79、Contracts 51、DB 10、UI 10、Config 5，Python 87 |
| `pnpm test:integration`     | 通过；Server 56、DB 21、Python 1                                             |
| `pnpm typecheck`            | 通过                                                                         |
| `pnpm lint`                 | 通过                                                                         |
| `pnpm build`                | 通过                                                                         |
| `pnpm test:e2e`             | 通过；18/18                                                                  |
| `pnpm test:visual`          | 通过；3/3                                                                    |
| Phase 3 文件 Prettier       | 通过；未改写用户未跟踪设计素材                                               |
| `pnpm smoke:deepseek`       | 未执行：当前环境缺少 `DEEPSEEK_API_KEY`                                      |

## 提交与关键变更

阶段提交从 `40b9213`（记录 H2 通过并启动 Phase 3）开始；已提交的关键切片包含 `560d46c`（积分与能力注册）、`e086a1b`（持久化模型）、`5d89450`（Python 推理服务）、`f6478cf`（异步运行链路）和 `cb0803c`（产品交互）。T21–T24 最终收口提交将在真实 Smoke 前形成并追加到本节。

关键工件：

- `config/product/points.yaml`
- `packages/contracts/internal-agent/v1/openapi.yaml`
- `apps/agent-service/`
- `apps/server/src/modules/agent/`
- `apps/server/src/modules/users/points/`
- `packages/db/prisma/schema.prisma`
- `apps/client/src/components/use-agent-product.tsx`
- `tests/e2e/phase3-agent.spec.ts`
- `apps/server/test/deepseek.smoke.test.ts`

## PRD 追踪状态

详细矩阵见 [`acceptance-traceability.md`](acceptance-traceability.md)。T18–T24 已覆盖 AC-01–05、AC-10–11、AC-13–18、AC-21、AC-23、AC-26–29 的相应实现范围；Stub 自动化结果已录入，真实 Smoke 尚未录入。

以下仍不属于 T24 完成项：

- AC-08 语音/腾讯 ASR：T25。
- AC-12 完整 Evaluation 与审计收口：T26。
- Provider 恢复演练、最终错误状态、视觉与无障碍收口：T26–T27。
- 生产安全、部署、备份和 Release Candidate：T28–T30。

## 已知风险

- DeepSeek 当前账号权限、网络可达性、模型返回和真实 JSON 修复路径尚未由 Smoke 证明。
- Stub E2E 证明产品业务链路和 UI 可重复，但不能证明外部 Provider 可用。
- DeepSeek Smoke 之外的最终全量测试、构建、三视口截图和 axe 已通过；它们不能证明外部 Provider 当前可用。
- T26 尚未完成完整 Evaluation、业务恢复演练与最终日志脱敏验收。
- T27 尚未完成微信小程序/真机、IME、安全区、地址栏、最终视觉回归与完整无障碍收口。
- 未进行生产网络隔离、Secret Manager、容量、备份或恢复验证。

## 需要人类介入

1. 在本地环境安全注入 `DEEPSEEK_API_KEY`，允许执行合成数据 Smoke；不要把密钥粘贴到聊天或文件。
2. Smoke 通过并回填后，审查 T18–T24 演示与已知风险。

在上述证据齐全前无其他产品决策项，但不得宣告 Phase 3 完成。审查结束后仍须暂停；H3 仍在 T27 后，未经下一步明确指示不得进入 T25–T27。
