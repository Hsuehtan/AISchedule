# 当前任务

- 任务：Phase 0–3（T01–T24）独立功能验收后的人工决策
- 状态：2026-09-27 验收**未全部通过**；只记录缺陷与证据，不修改产品实现；停在 T24
- 受验分支/提交：`dev` / `f178d673112a8b54cb1c84da390384b204ade614`（本轮文档提交前）
- 当前门禁：H2 历史人工通过；T24 等待人工审查；H3 仍未通过
- 本轮验收报告：[`docs/quality/2026-09-27-phase0-3-acceptance.md`](../docs/quality/2026-09-27-phase0-3-acceptance.md)
- 可视化概览：[`docs/quality/show-me-phase0-3-acceptance.html`](../docs/quality/show-me-phase0-3-acceptance.html)
- 历史 Phase 3 审查包：[`docs/quality/phase3-agent-review.md`](../docs/quality/phase3-agent-review.md)
- 本轮接管快照：[`docs/handovers/2026-09-27-phase0-3-acceptance.md`](../docs/handovers/2026-09-27-phase0-3-acceptance.md)
- PRD：[`product_doc/prd.md`](../product_doc/prd.md) v1.11
- Python 服务边界：[`ADR-009`](../docs/decisions/ADR-009-python-agent-service-boundary.md)
- Python 日志边界：[`ADR-011`](../docs/decisions/ADR-011-defer-agent-log-persistence.md)

## 当前结论

- H2 已于 2026-07-17 获得人类明确通过，允许实施 T18–T24。
- T18–T24 的实现存在，真实 DeepSeek Smoke 本轮通过，覆盖 standard reply/plan generation 的持久化和 1 点/2 点结算。
- 本轮重新运行 Contract、Unit、Typecheck、Lint、Build、空库迁移、Integration、完整 E2E 与三视口视觉证据。原始 Integration 和 E2E **未全通过**，不可沿用 7 月的通过状态。
- 失败/阻塞：H1 文本输入真实热区约 30×43px；数据库集成夹具 7 月到期值失效；H2 日期 E2E 直接改 DOM 值造成主流程中断。仅临时副本的夹具日期归因复跑全量 Integration 通过；产品代码未修改。
- 本轮文档只补充 AC-19 追踪与当前事实，不改动 PRD、契约、Schema、API 或产品实现。
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

## 2026-09-27 重新验收记录

| 范围                        | 当前结果                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm agent:contract:check` | 通过；生成工件无 diff                                                                        |
| Python Ruff / mypy / pytest | 通过；pytest 87/87                                                                           |
| `pnpm test`                 | 通过；Server 126、Client 79、Contracts 51、DB 10、UI 10、Config 5，Python 87                 |
| `pnpm test:integration`     | 原始 DB 19/21，2 处过期日期夹具失败；临时副本仅调整夹具后 DB 21/21、Server 56/56、Python 1/1 |
| `pnpm typecheck`            | 通过                                                                                         |
| `pnpm lint`                 | 通过                                                                                         |
| `pnpm build`                | 通过                                                                                         |
| `pnpm test:e2e`             | 原始完整套件 16/18；H1 44px、H2 Picker 主链路失败，定向复跑稳定重现                          |
| 视觉用例                    | 已包含在完整 E2E 中，不重复运行；截图与 Figma 抽样对照见验收报告                             |
| 管理员 CLI                  | 一次性数据库实调积分 dry-run/add/subtract/set/history、交互改密与 2 Session 撤销均通过       |
| `pnpm smoke:deepseek`       | 通过；1/1，flash/pro、1/2 点真实结算，约 25 秒                                               |

阶段提交从 `40b9213` 启动；关键切片为 `560d46c`（积分与能力注册）、`e086a1b`（持久化模型）、`5d89450`（Python 推理服务）、`f6478cf`（异步运行链路）、`cb0803c`（产品交互）、`9bccba2`（T21–T24 产品闭环收口）和 `77ddd38`（Node 24 脚本运行时）。

## Phase 3 截图

历史 Phase 3 E2E 生成并人工复核；本轮截图另见[独立验收报告](../docs/quality/2026-09-27-phase0-3-acceptance.md)：

- `docs/quality/screenshots/phase3-agent-clarification-320x844.png`
- `docs/quality/screenshots/phase3-agent-clarification-390x844.png`
- `docs/quality/screenshots/phase3-agent-clarification-480x844.png`

三张截图无水平溢出，已回答候选项保持可读，Agent 对话区通过 axe；320/390/480px 的可见交互目标均不小于真实 44 CSS px。H1 Fixture 或旧 Agent 截图不作为 Phase 3 实现证据。

## 工作区保护

- 用户删除的 `assets/README.md` 保持删除状态，不恢复、不纳入 Phase 3 提交。
- `Electric_Ink_UI_review_keyboard_icons.png` 与 `design/` 是用户未跟踪设计素材，不修改、不纳入提交。
- Secret 只允许通过本地环境变量注入，不进入聊天、Git、NestJS、Python日志或审查包。

## 当前风险与非范围

- 真实 Smoke 已证明当前账号、网络、flash/pro 模型、普通回复和计划生成可用；生产环境仍需在 T28–T30 复核网络、Secret Manager、容量和成本。
- Phase 3 浏览器用例使用受控内部 Stub 提供确定性产品回归；真实 Smoke 独立证明当前 Provider 链路，两者都不能替代生产耐久性和容量验证。
- Python/NestJS 当前处于同一 Monorepo 与 Compose 发布单元，不代表已经完成云网络、生产 Secret 或生产容量验证。
- T25 语音/腾讯 ASR、T26 Evaluation 收口、T27 最终错误状态/视觉回归/无障碍仍未实现；T19 必需的 Run 恢复协调器已经覆盖队列重放和结算恢复。
- 不提供完整历史会话列表、积分余额/成本展示、充值入口、提醒触发或昵称修改。

## 唯一下一步

由人类审查[本轮验收报告](../docs/quality/2026-09-27-phase0-3-acceptance.md)的 D01–D03 与覆盖深度限制，决定修复清单及是否重新验收。未经新指示，不修改产品实现、不进入 T25–T27、不部署生产。
