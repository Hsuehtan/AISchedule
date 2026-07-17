# 当前任务

- 任务：Phase 3（T18–T24）积分与 Agent 产品闭环收口
- 状态：T18–T24 已实现；Stub 全量验证和三视口截图已通过，待真实 DeepSeek Smoke
- 分支：`codex/phase3-agent`
- 当前门禁：H2 已通过；T24 后提交 Phase 3 审查包并暂停；H3 仍未通过
- 审查包：[`docs/quality/phase3-agent-review.md`](../docs/quality/phase3-agent-review.md)
- 接管快照：[`docs/handovers/2026-07-17-phase3-agent-implementation.md`](../docs/handovers/2026-07-17-phase3-agent-implementation.md)
- PRD：[`product_doc/prd.md`](../product_doc/prd.md) v1.10
- Python 服务边界：[`ADR-009`](../docs/decisions/ADR-009-python-agent-service-boundary.md)
- Python 日志边界：[`ADR-011`](../docs/decisions/ADR-011-defer-agent-log-persistence.md)

## 当前结论

- H2 已于 2026-07-17 获得人类明确通过，允许实施 T18–T24。
- T18–T24 的代码、迁移、契约、客户端和文档实现已经完成。
- 当前环境没有 `DEEPSEEK_API_KEY`，真实 DeepSeek Smoke 尚未执行；Stub 自动化不能替代该完成条件。
- Node/Python 契约、Unit、Integration、Typecheck、Lint、Build、E2E、Visual 和三视口截图均已完成最终验证。
- Phase 3 相关文件已通过 Prettier 检查；根级 `format:check` 不用于改写用户未跟踪的 `design/` 素材。
- T25–T27 尚未进入；H3 仍在 T27 后，未通过。
- 未连接腾讯 ASR、未部署生产、未开放公网、未使用真实用户数据。

## T18–T24 实施摘要

- T18：YAML v2 能力与成本真源、不可变 `AiCapability` 版本、正式积分账本状态机、懒执行每日补足、`AiPointsPort`/`UnitOfWork` 和管理员调账 CLI。
- T19：无业务数据库权限的 Python 3.11/FastAPI Agent 服务、唯一内部 OpenAPI、Node/Python Schema 等价、Bearer 服务认证、DeepSeek Adapter，以及 NestJS Admission/pg-boss/Worker 单次派发状态机。
- T20：真实文字 Agent 对话、异步轮询、Conversation/Message 持久化、关闭后恢复和纯文本回复。
- T21：临时候选引用、澄清/候选卡、服务端 option 校验、确定性零扣分推进和需要继续推理时的新请求。
- T22：1 点理解 + 2 点计划的二阶段计费、可编辑计划草稿、重新生成、惰性过期和 `CREATE_PROJECT_TASKS` 提案。
- T23：七类 Action、确认时归属/版本复验、单事务批量执行、重复确认复用结果，以及批量软删除的单个 3 秒 UndoOperation。
- T24：纯业务派生 Smart Inbox、固定优先级、最多 20 项无项目待办整理、额度不足/服务不可用降级，以及语音入口继续延期。

## 固定安全与计费边界

- 客户端只访问 NestJS；Python Agent 是私有无状态推理服务，不接收用户 ID、业务数据库 ID、Session、余额、成本或 reservation。
- 积分由 `Users/AiPointsPort` 独占；调用 Python 前原子预留，只有通过双端契约与业务校验且由 NestJS 持久化的可用结果才结算。
- 同一产品请求最多一次 NestJS → Python execute dispatch；含糊超时不自动重派。
- `RESULT_PERSISTED` 后只重试结算，不释放预留、不重新调用 Provider。
- 所有 Agent 写入必须经过用户确认；Python 不能直接读写 Task、Project 或积分表。
- Python MVP 不持久化算法日志，不增加 Redis、第二套队列、Agent 数据库、Kubernetes 或远程 Exporter。

## 最终验证记录

| 范围                        | 当前结果                                                                     |
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
| Phase 3 文件 Prettier       | 通过；保护用户未跟踪设计素材                                                 |
| `pnpm smoke:deepseek`       | 未执行：当前环境缺少 `DEEPSEEK_API_KEY`                                      |

阶段提交从 `40b9213` 启动；已提交的关键切片为 `560d46c`（积分与能力注册）、`e086a1b`（持久化模型）、`5d89450`（Python 推理服务）、`f6478cf`（异步运行链路）和 `cb0803c`（产品交互）。T21–T24 收口提交将在真实 Smoke 前追加。

## Phase 3 截图

最终 E2E 已生成并人工复核：

- `docs/quality/screenshots/phase3-agent-clarification-320x844.png`
- `docs/quality/screenshots/phase3-agent-clarification-390x844.png`
- `docs/quality/screenshots/phase3-agent-clarification-480x844.png`

三张截图无水平溢出，已回答候选项保持可读，Agent 对话区通过 axe；320/390/480px 的可见交互目标均不小于真实 44 CSS px。H1 Fixture 或旧 Agent 截图不作为 Phase 3 实现证据。

## 工作区保护

- 用户删除的 `assets/README.md` 保持删除状态，不恢复、不纳入 Phase 3 提交。
- `Electric_Ink_UI_review_keyboard_icons.png` 与 `design/` 是用户未跟踪设计素材，不修改、不纳入提交。
- Secret 只允许通过本地环境变量注入，不进入聊天、Git、NestJS、Python日志或审查包。

## 当前风险与非范围

- 真实 DeepSeek 返回仍可能为空或与 Schema 不符；必须用真实 Smoke 验证一次普通回复和一次计划生成，结构修复时 Provider 总调用仍受上限约束。
- Phase 3 浏览器用例使用受控内部 Stub 验证产品闭环；它不能证明 DeepSeek 当前账号、网络和模型权限可用。
- Python/NestJS 当前处于同一 Monorepo 与 Compose 发布单元，不代表已经完成云网络、生产 Secret 或生产容量验证。
- T25 语音/腾讯 ASR、T26 Evaluation 收口、T27 最终错误状态/视觉回归/无障碍仍未实现；T19 必需的 Run 恢复协调器已经覆盖队列重放和结算恢复。
- 不提供完整历史会话列表、积分余额/成本展示、充值入口、提醒触发或昵称修改。

## 唯一下一步

由用户在本地安全注入 `DEEPSEEK_API_KEY`，再运行 `pnpm smoke:deepseek`。Smoke 通过后补录脱敏结果、提交最终 Phase 3 审查结论并暂停；不得进入 T25–T27。
