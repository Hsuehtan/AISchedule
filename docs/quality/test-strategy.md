# 测试策略

## 分层原则

- 单元/契约：输入规范化、Schema、排序、时间转换、日期时间 Picker 模型、导航 Reducer、幂等意图和安全原语。
- PostgreSQL 集成：正式 Migration、约束、锁、事务、鉴权、幂等、乐观锁和跨用户隔离。
- E2E：构建后的 Taro H5 + 真实 NestJS + 隔离 PostgreSQL 16 Testcontainer + Chrome。
- 视觉：390 × 844 主基线，补充 320/480px；H1 Fixture 与 H2 正式路径分开。
- 可访问性：axe、44px 命中区、键盘 TaskRow、Sheet 焦点陷阱与关闭后焦点恢复。

外部付费 Provider 不作为 CI 前提。H2 不调用 DeepSeek 或腾讯 ASR；后续 CI 使用确定性 Python Agent/Provider Stub，真实 Provider 只允许在明确批准的受控环境冒烟。

## H2 必测边界与证据

| 边界                                                         | 证据                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 用户名 NFKC/大小写、输入约束、只读资料                       | `packages/contracts/src/contracts.test.ts`                             |
| 并发等价用户名注册、初始 grant 原子性、Session、Origin       | `apps/server/test/auth.integration.test.ts`                            |
| 256-bit Token、SHA-256 Hash、独立 IP/用户名限流、容量上限    | `apps/server/src/modules/users/auth-security.test.ts`                  |
| 隐藏密码输入、禁止明文参数、管理员并发改密和全 Session 撤销  | `apps/server/src/admin/password-set.test.ts`、认证集成测试             |
| 项目配色并发、归档竞态、组合租户外键、稳定排序               | `packages/db/test/database.integration.test.ts`                        |
| 旧通用 Undo 不被伪造回填                                     | `packages/db/test/migration-safety.test.ts`                            |
| Task/Project/Undo API、幂等事务、版本冲突和跨用户隔离        | `apps/server/test/manual-loop.integration.test.ts`                     |
| 三档优先级、项目色、时区格式化、时间清空                     | `apps/client/src/task-presentation.test.ts`、`task-form-model.test.ts` |
| Picker 空值/回填、闰年/月末夹取、00:00/23:59、时区/UTC 往返  | `apps/client/src/components/date-time-picker-model.test.ts`            |
| Picker 取消/确认/清空、真实滚轮、焦点恢复与保存请求次数      | `tests/e2e/phase2.spec.ts`                                             |
| TaskRow disabled 语义、标题颜色与 H2 几何/Textarea 样式      | UI 单测、`tests/e2e/h2-ui-feedback.spec.ts`                            |
| NeutralPressButton 锁定 hoverClass、禁用语义与 ref 透传      | `packages/ui/src/neutral-press-button.test.tsx`                        |
| 项目栏隐藏滚动条、可横滑、6em 名称省略与完整可访问名称       | `tests/e2e/h2-project-strip.spec.ts`                                   |
| 各类按钮 pointerdown 静止色、选中态、焦点轮廓和非灰色回归    | `tests/e2e/h2-press-state.spec.ts`                                     |
| logout/401 账户状态清空、浏览器返回保留筛选                  | `apps/client/src/app-state.test.ts`、`api-client.test.ts`              |
| 同一用户意图重试复用 Idempotency-Key                         | `apps/client/src/write-intent.test.ts`                                 |
| 真实注册到重新登录、项目/任务/时间/撤销、409/401/5xx、响应式 | `tests/e2e/phase2.spec.ts`                                             |

## Phase 2 业务不变量

- 未登录页面不请求或显示真实任务；退出和任意受保护请求 401 会清空 Query 与账户级 UI 状态。
- Task/Project/Undo 每个认证写操作都要求 `Idempotency-Key`；同一用户意图重试复用 key，业务结果与快照原子提交。
- 更新使用表单打开时捕获的版本；后台刷新不能偷偷替换版本，409 后草稿保留。
- 只有删除生成 3 秒 Undo；创建、完成、恢复不生成 Undo，已完成任务可长期恢复。
- 项目标签与 Chip 同源；项目身份色不影响 HIGH/MEDIUM/LOW 的红/黄/绿，新任务默认 MEDIUM。
- 项目栏内容溢出时可横向滚动但不展示滚动条；Chip 仅按 `6em` 视觉宽度省略，完整项目名始终保留在 DOM 和可访问名称中。
- 正式页面、共享组件及 H1 Fixture 的按钮统一禁用 Taro 默认 hoverClass；pointerdown 不得改变各按钮静止态前景/背景色，持久选中、禁用、焦点与 `aria-pressed` 仍保留。
- 归档项目从 Chip 隐藏，但其既有任务仍显示项目摘要并允许编辑非归属字段。
- `scheduledAt`、`deadlineAt`、`reminderAt` 通过五列滚轮独立选择、保存、回填和清空；取消不改表单，提交仍转换为 UTC，且不产生到期通知、调度或已读状态。
- E2E 由真实 Session、projectId、taskId 和 API 驱动，不使用 H1 `?screen=` 证明业务闭环。

## H2 浏览器场景

`tests/e2e/phase2.spec.ts`、`tests/e2e/h2-ui-feedback.spec.ts`、`tests/e2e/h2-project-strip.spec.ts` 与 `tests/e2e/h2-press-state.spec.ts` 合计覆盖：

1. 注册、刷新恢复、退出和重新登录。
2. 顶部加号打开手动创建，不进入 Agent。
3. 无项目/项目筛选、项目标签同源、三档优先级。
4. 创建、编辑、三个 Picker 的打开/取消/确认/回填/清空、完成、恢复、删除及 3 秒内外撤销。
5. 项目创建、重名冲突、改名、归档、归档任务保留和名称复用。
6. 409 保留草稿、5xx 重试、401 清空认证状态。
7. 浏览器返回关闭 Sheet 并保留筛选。
8. H2 六项反馈的文字/分隔/Textarea/标题/左栏几何与 44px、axe。
9. 登录、任务编辑、Picker 打开态截图，以及 390 × 844 主路径和 320/480px 无溢出。
10. 320/390/480px 下至少 8 个项目的隐藏滚动条横滑、滚动到管理入口、项目栏高度与页面无横向溢出。
11. 6 个中文字符完整展示、7 个以上单行省略、中英数字混排按显示宽度省略，且 DOM/可访问名称仍为完整项目名。
12. 项目 Chip、加号、Smart Inbox、任务主体/完成控件、Picker 和 Sheet 按钮的真实 pointerdown 静止色、合法选中态、2px 焦点轮廓及 Picker 焦点恢复。

Playwright 默认使用隔离 H5/API 端口 `11086`/`13000`，不复用本机开发服务；可通过 `H5_PORT`、`API_PORT` 显式覆盖。

## 当前验证记录

| 范围                            | 结果                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| PostgreSQL 数据库集成           | 11/11 通过                                                                   |
| 服务端集成                      | 14/14 通过                                                                   |
| 根单元/契约测试                 | 96/96 通过；其中 UI 9/9，含 NeutralPressButton ref/hoverClass 回归           |
| TypeScript、Lint、Build、Format | 全部通过；Build 7/7，H5 811 modules                                          |
| H2 E2E/视觉                     | E2E 17/17、Visual 3/3 通过；项目栏、按压态、Picker、axe、44px 与三视口已覆盖 |

本节更新到 2026-07-16 H2 项目栏与点击态反馈复验；完整 E2E 首轮 16/17 暴露 `NeutralPressButton` ref 未透传，修复并补回归单测后定向场景与最终全量 17/17 均通过。日期时间 Picker 与按压态仅完成 Chrome H5 验证，不代表微信小程序编译或实机通过。完整命令口径仍以 [`../../tasks/current.md`](../../tasks/current.md) 与 [`h2-manual-loop-review.md`](h2-manual-loop-review.md) 为准。

## 后续阶段

- T18–T24：积分预留/结算、Python Agent 跨语言契约、单次 dispatch、提案确认、重复确认和 Provider 失败释放。
- T25–T27：ASR 权限/编码/临时清理、真实错误降级、真机矩阵、完整无障碍和视觉阈值。
- T28–T30：多副本限流、生产安全头/代理信任、备份恢复、发布回滚和 RC 全量验收。

## Phase 3 跨服务必测矩阵

- `packages/contracts/internal-agent/v1/openapi.yaml` 是唯一规范工件；Node Zod、Python Pydantic 与 FastAPI 实际 Schema 必须生成自它或通过完整规范化等价比较。Golden Fixtures 只补充正反例，任一端新增必填字段、枚举或结果类型都触发兼容性失败。
- Python 进程没有业务数据库凭证，客户端无法路由到内部端点；缺少/错误服务身份、错误契约版本、超大请求均被稳定拒绝。
- 合法 `REPLY/CLARIFICATION/CANDIDATES/PLAN/ACTION_PROPOSAL` 可以持久化；HTTP 2xx 空内容、非法 JSON、未知类型、超长内容、伪造 `candidateRef` 和跨用户引用均不得结算积分。
- 余额不足、能力停用或原子预留失败时不创建 Python 调用；预留与 Run/Job 创建失败时全部回滚。
- 跨模块原子故障注入覆盖：积分 reserve 成功后，Run、幂等记录或 pg-boss Job 任一步失败，预留、余额、Run、幂等和 Job 均无部分提交；`AiPointsPort` 不开启嵌套事务或暴露 Prisma。
- 同一 Idempotency-Key/请求体只得到同一 Run；同 key 不同请求体返回 409；队列重放和客户端断线不重复 dispatch 或扣分。
- Python 4xx/429/5xx、连接失败、超时、进程重启和响应丢失均不产生最终扣分；含糊超时不自动执行第二次 NestJS → Python dispatch。
- 已持久化结果后的结算失败只重试结算，不再次调用 Python；`RESULT_PERSISTED` 不允许被回收为 `RELEASED`。
- 预留回收与迟到结果通过条件更新竞争；释放成功后的迟到响应被丢弃，不开放结果或补扣积分。
- `executeTimeoutAt < runDeadlineAt < reservationExpiresAt < recoveryEligibleAt` 配置校验通过；覆盖排队延迟、dispatch 前预留过期、执行中 lease、卡死 `RUNNING`、回收/结果竞争和宽限期边界。
- 持久化提交或积分结算提交结果不确定时，按 `requestId/resultHash/reservationId` 持续核对；数据库不可查或结果未知时保持预留，不能凭内存状态释放或重复执行。
- 分别断言 `serviceDispatchCount` 与 `providerAttemptCount`：每个 requestId 最多一次 execute dispatch；同一 execute 内允许主调用和最多一次已批准的结构修复，但只结算一次。
- reservation 唯一、同 user/request/capability 有效 debit 唯一、Run/预留同用户关联，以及 `PENDING -> SUCCEEDED/CANCELLED` 互斥 CAS 均由 PostgreSQL 并发集成测试验证。
- T18.3 Migration 验证 H2 grant 保持不变、单条 pending DEBIT 的余额快照可空/成功后必填、旧 `RESERVATION/RELEASE` 无活动写路径，并对无法解释的历史预留数据 fail closed；枚举收缩不得与首次切换同批。
- 用户在结果结算后关闭对话、忽略回复、取消或拒绝 Action 不退款；后续 Action 执行失败也不重复计算 Agent 积分。
- CI 默认使用确定性 Stub 和故障注入；真实 DeepSeek Smoke 不使用生产用户数据，费用、Secret 和输出不进入测试日志。
