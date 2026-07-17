# AI 项目待办 P0 实施计划

- 状态：H2 已通过；T18–T24 及全部完成证据已通过，停在 T24 等待人工审查；H3 未通过
- 产品真源：`product_doc/prd.md` v1.11
- UI 真源：Figma Production V3 `229:2`
- 分支前缀：`codex/`

## 交付方式

```text
契约先行 -> 风险验证 -> 前端交互壳 -> 纵向切片 -> 测试/文档/提交 -> 人类门禁
```

每个切片按 Schema/Contract -> API/Service -> UI -> Test -> Docs 顺序交付。任务控制为 XS/S/M，超过一次专注会话或约 5 个主要文件时继续拆分。

## 固定架构

- Taro 4 + React 18 + TypeScript 客户端。
- NestJS 11 + Fastify 业务模块化单体；Python Agent 是唯一内部服务例外。
- PostgreSQL 16 + Prisma 7 + pg-boss。
- Users、Tasks、Projects、Agent 四个业务模块。
- Python Agent 服务使用 FastAPI/Pydantic，通过私有 HTTP 调用 DeepSeek；腾讯云 SpeechProvider 仍由后续语音适配器隔离。
- YAML 积分配置，管理员 CLI 改密和调账。
- Docker/Caddy/托管 PostgreSQL，云厂商中立。

详细边界见 `docs/architecture/` 和 `docs/decisions/`。

## Phase 0：基础与风险验证

- T01：冻结 PRD、ADR、API、数据模型、文档入口和追踪矩阵。
- T02：创建 pnpm Monorepo、工具链和统一命令。
- T03：建立共享 Contract、错误模型、ID 类型和配置校验。
- T04：建立 PostgreSQL、Prisma Migration 和 Repository 基线。
- T05：验证 Taro H5、DeepSeek JSON、pg-boss 和腾讯 ASR 接口边界。

验收：工程可安装、构建、测试；配置缺失时失败明确；所有风险验证有可复现记录。

## Phase 1：前端交互壳

- T06：实现 Electric Ink Token、App Shell 和基础组件。
- T07：实现页面状态路由、Bottom Sheet、Dialog、Toast。
- T08：实现 Production V3 Fixture、主要页面和状态导航。
- T09：完成 Figma 对照、响应式、键盘和无障碍基线。

验收：可运行 H5 覆盖 H1 状态；390 × 844 对照，320/480px 无溢出；不伪装真实后端成功。

## Phase 2：真实手工闭环

- [x] T10：用户名注册、登录、退出和 Session。
- [x] T11：可选手机号和只读个人资料；昵称保持默认“用户”，不提供修改入口。
- [x] T12：管理员改密 CLI 与审计。
- [x] T13：待办创建与列表纵向切片。
- [x] T14：待办编辑、完成和恢复。
- [x] T15：软删除和 3 秒撤销。
- [x] T16：项目创建、改名、归档和筛选。
- [x] T17：时间字段保存/展示、完成分组和空状态；不交付站内到期提示。

验收：无 Agent 时产品可用；跨用户隔离、版本冲突、撤销边界和持久化通过。

实施状态：上述切片已经实现，并于 2026-07-17 获得 H2 人工明确通过；审查材料见 [`docs/quality/h2-manual-loop-review.md`](../docs/quality/h2-manual-loop-review.md)。

Phase 2 的固定实现口径：

- H1 只冻结视觉方向；正式路由必须由真实 Session、当前项目 ID 和业务对象 ID 驱动，不沿用 `?screen=` 交互壳。
- 优先级仅 HIGH/MEDIUM/LOW，新任务默认 MEDIUM；红/黄/绿优先级色与项目身份色分离。
- 只有软删除生成服务端 3 秒 UndoOperation；创建、完成和恢复不生成撤销。
- 注册、登录和退出不要求 `Idempotency-Key`；Task、Project、Undo 写接口仍必须提供。
- T10 先交付新用户初始 grant 的最小原子流水，T18 再补齐每日补足、完整账本与管理员调账。
- T17 完成并生成 H2 审查包后已暂停；收到 H2“通过”后才进入 T18。

## Phase 3：积分与 Agent

> H2 已通过，T18–T24 的实现、Stub 全量自动化、三视口截图和真实 DeepSeek Smoke 均已完成。当前停在 T24 等待人工审查；H3 未通过，T25–T27、ASR、提醒触发和生产部署均未进入。

- [x] T18：在 NestJS `Users` 模块内完成积分子域；该子域不依赖 Python Agent，并通过公开 `AiPointsPort` 成为唯一扣费决策者：
  - [x] T18.1：积分 YAML、能力注册、配置版本/Hash、启动校验和规则快照。
  - [x] T18.2：完整账本、新用户 grant 对账、每日补足、余额不变量和并发测试；复用 T10 初始 grant。
  - [x] T18.3：原子预留、结算、释放、退款与故障回收；以 PRD 的单条 `DEBIT: PENDING -> SUCCEEDED | CANCELLED` 为最终真源，采用 expand/contract 增加 `CANCELLED`、放宽 pending 的余额快照字段、停止新写 `RESERVATION/RELEASE`，并增加唯一 reservation、同用户/请求/能力有效 debit 唯一和互斥 CAS 硬约束；提供接受平台不透明 `TransactionScope` 的 `AiPointsPort`，不得自开事务。确认 Agent 历史数据为零后，旧枚举值只在独立收缩迁移中移除。
  - [x] T18.4：管理员积分 add/subtract/set/history CLI、dry-run 和脱敏审计。
- [x] T19：建立 Python Agent 内部服务与跨语言运行链路：
  - [x] T19.1：以 `packages/contracts/internal-agent/v1/openapi.yaml` 为唯一规范工件，冻结 OpenAPI 3.1 / JSON Schema、稳定错误码和结果联合类型；生成或严格比对 Node Zod/Python Pydantic/FastAPI Schema，Golden Fixtures 只作行为补充，并用负向契约证明不存在 Run create/status、callback、结果回放、算法日志上传或查询 API。
  - [x] T19.2：创建私有、无业务数据库权限的 FastAPI 服务骨架，完成服务身份认证、健康检查、请求大小/超时限制和最小结构化 stdout/stderr；固定日志字段白名单、关闭生产 DEBUG/Uvicorn 全量 access log，并验证 logger 失败不影响 execute 或 readiness。不得引入文件日志、远程 Exporter、Collector 或日志数据库。
  - [x] T19.3：完成 Python DeepSeek Adapter、Prompt/模型/Provider Schema 版本和同 execute 内最多一次结构修复；Stub 自动化与 Node.js 24 下的真实 Smoke 均已通过。
  - [x] T19.4：完成 NestJS Agent 编排、Admission 原子链路、单次 execute dispatch、结果持久化、结算和恢复状态机。
- [x] T20：普通文本对话。
- [x] T21：澄清与候选消歧。
- [x] T22：计划生成和可编辑计划。
- [x] T23：提案确认、幂等和批量原子执行。
- [x] T24：Smart Inbox 和额度不足状态。

Phase 3 当前完成口径：以上勾选表示代码与文档实现完成，不表示阶段验收完成。以下三项全部完成并录入 [`docs/quality/phase3-agent-review.md`](../docs/quality/phase3-agent-review.md) 前，不得宣告 Phase 3 完成：

- [x] 最终全量自动化命令及准确结果录入。
- [x] 320/390/480px Phase 3 截图与无障碍结果录入。
- [x] 使用合成数据完成真实 DeepSeek 普通回复 + 计划生成 Smoke。

Phase 3 固定边界：

- 客户端只调用 NestJS `/api/v1/agent/*`，不得直接访问 Python 服务。
- NestJS 独占鉴权、积分、pg-boss、会话/消息/提案持久化、候选查询、确认和业务写入。其中积分账本属于 `Users`，Agent 编排只能调用 `AiPointsPort`，不能直写积分表；Python 只负责 Prompt、模型调用和结构化推理。
- Python 不接收 Session、`reservationId` 或可信业务 ID，不访问业务 PostgreSQL，也不返回或决定 `billable`。MVP 只输出不落库的最小白名单运行日志；日志可以完全丢失。
- 调用前先原子预留积分。只有结果类型受支持、跨语言契约有效、对象引用可解析且已在 NestJS PostgreSQL 持久化后，才按 `reservationId` 幂等结算一次。
- HTTP 2xx 本身、Provider 已产生费用、空内容、非法 Schema、5xx、超时或断连都不等于可扣费结果；没有持久化可用结果时释放预留。
- `RESULT_PERSISTED` 后只能重试结算，不能释放预留或再次调用 Python；结果在 `SUCCEEDED` 前不向客户端开放。
- 同一产品请求最多一次 NestJS → Python execute dispatch。Python 在该次 execute 内可执行主调用和最多一次已批准的结构修复，仍只结算一次；含糊跨服务超时不自动重派，可能的 Provider 成本由平台承担，用户主动重试使用新的 `requestId`。
- Worker dispatch 前必须在一个已提交的 CAS 中确认 pending 预留、写入截止时间并延长 lease；时间满足 `executeTimeoutAt < runDeadlineAt < reservationExpiresAt < recoveryEligibleAt`，过期预留不得 dispatch。
- P0 保持同一 Monorepo、同一发布版本和 Compose 入口，不新增 Python 业务/Run 数据库、算法日志持久化后端、远程 Exporter、Redis、Kubernetes、服务网格或第二套任务队列。
- Python 日志缺失、写入失败或随进程退出丢失均不得改变 execute 响应、dispatch 次数、Run 状态或积分终态；stdout success 不能证明结果已交付。

验收：确认是唯一 Agent 写入网关；Python 无业务数据和积分权限；规范工件与两端运行 Schema 等价；失败不扣分；有效结果持久化并结算后才开放；队列重放、网络重试和结算重试不产生第二次 execute dispatch、重复扣分或重复 Action。Python 同 execute 内的受控结构修复单独计数和审计。

## Phase 4：语音与质量

- T25：语音采集、腾讯 ASR、转写确认和临时音频清理。
- T26：Agent Evaluation、运行日志边界和失败恢复：
  - T26.1：补齐 NestJS `AgentEvaluationEvent` 与业务审计，覆盖输入、最终 resolved 版本、草稿、用户修正、确认/取消、执行和撤销结果；不复制 Python per-attempt 日志或 Token usage。
  - T26.2：验收 NestJS/Python 结构化日志白名单、脱敏、生产日志级别和 logger 故障隔离；确认没有文件日志、OTLP/Collector、Trace/Metrics 后端、持久化算法日志或查询入口。
  - T26.3：完成 Provider 故障、卡死 Run、结算对账、迟到响应和恢复演练；所有判断只读取 NestJS/PostgreSQL/pg-boss 业务状态，不解析 Python 日志。
- MVP 后候选：如需持久化模型/工具调用、Token usage、Trace/Metrics 或算法仪表盘，必须新立 ADR、任务和人工门禁，不占用 T01–T30。
- T27：错误状态、视觉回归和无障碍收口。

## Phase 5：安全与发布

- T28：权限隔离、限流、CSRF、Session 和日志脱敏。
- T29：Docker、部署、备份恢复和 Runbook。
- T30：全量验收、接管演练和 Release Candidate。

## 人类门禁

| 门禁 | 时机   | 审查                                          |
| ---- | ------ | --------------------------------------------- |
| H0   | T01 前 | 架构、账户、积分、模块和计划；已批准          |
| H1   | T09 后 | 视觉方向已通过；正式跳转在 Phase 2 修正       |
| H2   | T17 后 | 登录、待办、项目、时间和撤销；已通过          |
| H3   | T27 后 | Agent、确认、积分、语音和 Smart Inbox；未通过 |
| H4   | T30 后 | 安全、部署、备份、CLI、文档和生产批准         |

到达门禁必须暂停。不可逆数据操作、新付费服务、安全降级、明显偏离 Figma 或生产部署也必须提前暂停。

T24 审查包是 Phase 3 阶段检查点，不提前改变 H3 的 T27 门禁定义。T24 审查完成后仍需暂停，未经用户继续指示不得进入 T25–T27。

## 每任务完成定义

- 验收条件满足，相关测试先失败后通过。
- lint、typecheck、build 和受影响测试通过。
- API/Schema/配置/UI 行为文档同步。
- `tasks/todo.md`、`tasks/current.md` 更新。
- 原子 Conventional Commit，无 Secret 或未说明改动。
