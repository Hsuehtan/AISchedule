# 当前任务

> 2026-10-04：正式 H5 已移除登录/注册页和任务首页顶部的模拟手机系统状态栏，并回收任务滚动区原先预留的 28px 高度；H1 历史原型保持不变。客户端单测 89/89、lint、typecheck、build 及定向正式 H5 E2E 1/1 通过，页面实测无横向溢出。详见[专项验收](../docs/quality/2026-10-04-remove-simulated-status-bar.md)。仍停留 T24。

> 2026-10-04：Agent 状态恢复专项收口：关闭 Proposal 不再推进业务版本；Smart Inbox 不再复活已替代的历史失败记录；FAILED 计划统一执行七天过期预检；完整 E2E 改用真实业务 Service 创建隔离 Session，消除注册限流对全量运行的干扰；明确写操作的 Prompt 选择规则。全仓集成 12/12、完整 E2E 34/34、真实 DeepSeek 3/3 与当前 `10087` 页面数据核对均通过。详见[专项验收](../docs/quality/2026-10-04-agent-state-recovery-acceptance.md)。仍停留 T24。

> 2026-10-03：按用户反馈扩展 Agent 多轮与异常恢复测试，修复计划状态失真、失败重生成、未保存确认、编辑失败丢输入、关闭后重开、首页进度不刷新及关闭重生成导致版本冲突。真实模型七类 Action 与回复/计划 Smoke 2/2 通过；复验详见[多轮与异常恢复专项](../docs/quality/2026-10-03-agent-multiturn-resilience.md)。仍停留 T24。

> 2026-10-03：Agent 业务/算法拆分已完成。TS 保留五个业务组件，Python 接管上下文预算与推理输入，新 Run 使用 v2 按需读取；旧 Run/草稿兼容。联合工程门禁 32/32、全仓集成 12/12、末轮兼容集成 23/23、正式 Agent E2E 5/5 通过。真实 DeepSeek Smoke 补验 1/1 通过（从已有 `.env` 向测试进程注入凭证），Flash/Pro 回复与计划及积分结算闭环通过。详见[专项复验](../docs/quality/2026-10-03-agent-context-split.md)。仍停留 T24 等待人工审查。

> 2026-09-30：通用 Action 确认卡已回到对话消息区，专门 PLAN 保留计划草稿浮层。提案分类来自关联 Run；追问仅在发送时取消旧 Action；确认后留在对话并显示“已执行”。复验和四视口截图见[Action／计划分离专项](../docs/quality/2026-09-30-action-card-plan-separation.md)。T24 人工审查仍待完成。

> 2026-09-30：正式 H5 的移动端 V01（计划草稿与 Action 确认区文字层级）已修复。定向 Phase 3 闭环 1/1、客户端单测 79/79、lint 8/8、typecheck 12/12、build 8/8；复验及截图见[移动端 V01 专项](../docs/quality/2026-09-30-mobile-v01-revalidation.md)。T24 人工审查仍待完成，V02–V12 未纳入本次。

> 2026-09-29：正式 Agent 对话浮层已按 Production V3 与 PRD 4.7 修正，固定底部输入、统一候选字体，并支持同浮层多轮问答。完整 H5 E2E 两片各 10/10，定向 Phase 3 E2E 1/1；验收证据见[对话浮层专项](../docs/quality/2026-09-29-agent-conversation-review.md)。T24 人工审查仍待完成。

> 2026-09-28：正式产品 UX 动效专项已实施，完整 H5 E2E 分两片运行各 10/10；保留 T24 人工审查门禁。动效规格与运行复验见[专项报告](../docs/quality/2026-09-28-production-motion-review.md)；本节原有 Phase 3 历史记录继续保留。

- 任务：Agent 多轮对话状态恢复与完整功能验收，等待 T24 人工审查
- 状态：最新结果以 2026-10-04 Agent 状态恢复专项验收为准；T24 人工审查状态不变。
- 工作分支：`dev`；原独立验收基线为 `f178d673112a8b54cb1c84da390384b204ade614`
- 当前门禁：H2 历史人工通过；T24 等待人工审查；H3 仍未通过
- 最新修复复验：[`docs/quality/2026-09-27-production-agent-input-review.md`](../docs/quality/2026-09-27-production-agent-input-review.md)
- 原独立验收快照：[`docs/quality/2026-09-27-phase0-3-acceptance.md`](../docs/quality/2026-09-27-phase0-3-acceptance.md)
- 原可视化快照：[`docs/quality/show-me-phase0-3-acceptance.html`](../docs/quality/show-me-phase0-3-acceptance.html)
- 历史 Phase 3 审查包：[`docs/quality/phase3-agent-review.md`](../docs/quality/phase3-agent-review.md)
- 最新接管快照：[`docs/handovers/2026-09-27-production-agent-input-fixed.md`](../docs/handovers/2026-09-27-production-agent-input-fixed.md)
- PRD：[`product_doc/prd.md`](../product_doc/prd.md) v1.11
- Python 服务边界：[`ADR-009`](../docs/decisions/ADR-009-python-agent-service-boundary.md)
- Python 日志边界：[`ADR-011`](../docs/decisions/ADR-011-defer-agent-log-persistence.md)

## 当前结论

- 正式登录/注册页和任务首页不再渲染 `StatusBar`；任务内容区使用完整动态视口，加号同步上移，未改变 H1 历史原型组件和业务逻辑。
- 前轮 V01 只修正了文字层级，没有解决 Action 与 PLAN 的展示结构混淆。本轮已将通用 Action 放入对话卡；PLAN 独立浮层保留编辑、重试和直接创建。Action 追问取消、确认回执、整理单项移除、删除三秒撤销及关闭重开草稿已经过正式 H5 用例验证。
- V01 中提案摘要、任务、序号及状态的异常字号已修复；计划行中间标题获得主要宽度，“编辑”文字保持 44px 热区且不再竖排。对照 Production V3 保留文字编辑入口；详见[专项复验](../docs/quality/2026-09-30-mobile-v01-revalidation.md)。
- 用户反馈正式 Agent 输入页与 H1 原型样式不同。已修复正式页示例按钮、输入框与内层 textarea，并补齐正式入口三视口、边缘聚焦、禁用与示例填入、压缩视口及 axe 证据；本次不修改原型。

- H2 已于 2026-07-17 获得人类明确通过，允许实施 T18–T24。
- T18–T24 的实现存在，真实 DeepSeek Smoke 本轮通过，覆盖 standard reply/plan generation 的持久化和 1 点/2 点结算。
- 原独立验收发现 D01–D03，记录保持不变；用户随后授权修复。现在 H1 输入真实热区、DB 夹具和 H2 Picker 测试方式均已修复，相关阻断证据已解除。
- 原仓库无缓存重新运行 Build、Lint、Typecheck、Unit、Integration 40/40；隔离副本完整 E2E 19/19。原仓库根级 Lint 和 Agent 契约检查另行通过。详见[修复复验](../docs/quality/2026-09-27-d01-d03-revalidation.md)。
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

## 2026-09-27 原独立验收记录（修复前）

下表保留基线 `f178d673` 的历史结果；修复后的运行结论以[最新复验](../docs/quality/2026-09-27-d01-d03-revalidation.md)为准。

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

由人类审查[正式输入弹层修复](../docs/quality/2026-09-27-production-agent-input-review.md)和 T24 审查包，决定阶段结论及后续开发。未经新指示，不进入 T25–T27、不部署生产。
