# 测试策略

## 分层原则

- 单元/契约：输入规范化、Schema、排序、时间转换、日期时间 Picker 模型、导航 Reducer、幂等意图和安全原语。
- PostgreSQL 集成：正式 Migration、约束、锁、事务、鉴权、幂等、乐观锁和跨用户隔离。
- E2E：构建后的 Taro H5 + 真实 NestJS + 隔离 PostgreSQL 16 Testcontainer + Chrome。
- 视觉：390 × 844 主基线，补充 320/480px；H1 Fixture 与 H2 正式路径分开。
- 可访问性：axe、44px 命中区、键盘 TaskRow、Sheet 焦点陷阱与关闭后焦点恢复。

外部付费 Provider 不作为 CI 前提。H2 不调用 DeepSeek 或腾讯 ASR；后续 CI 使用确定性 Stub，真实 Provider 只允许在受控环境冒烟。

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
| logout/401 账户状态清空、浏览器返回保留筛选                  | `apps/client/src/app-state.test.ts`、`api-client.test.ts`              |
| 同一用户意图重试复用 Idempotency-Key                         | `apps/client/src/write-intent.test.ts`                                 |
| 真实注册到重新登录、项目/任务/时间/撤销、409/401/5xx、响应式 | `tests/e2e/phase2.spec.ts`                                             |

## Phase 2 业务不变量

- 未登录页面不请求或显示真实任务；退出和任意受保护请求 401 会清空 Query 与账户级 UI 状态。
- Task/Project/Undo 每个认证写操作都要求 `Idempotency-Key`；同一用户意图重试复用 key，业务结果与快照原子提交。
- 更新使用表单打开时捕获的版本；后台刷新不能偷偷替换版本，409 后草稿保留。
- 只有删除生成 3 秒 Undo；创建、完成、恢复不生成 Undo，已完成任务可长期恢复。
- 项目标签与 Chip 同源；项目身份色不影响 HIGH/MEDIUM/LOW 的红/黄/绿，新任务默认 MEDIUM。
- 归档项目从 Chip 隐藏，但其既有任务仍显示项目摘要并允许编辑非归属字段。
- `scheduledAt`、`deadlineAt`、`reminderAt` 通过五列滚轮独立选择、保存、回填和清空；取消不改表单，提交仍转换为 UTC，且不产生到期通知、调度或已读状态。
- E2E 由真实 Session、projectId、taskId 和 API 驱动，不使用 H1 `?screen=` 证明业务闭环。

## H2 浏览器场景

`tests/e2e/phase2.spec.ts` 与 `tests/e2e/h2-ui-feedback.spec.ts` 合计覆盖：

1. 注册、刷新恢复、退出和重新登录。
2. 顶部加号打开手动创建，不进入 Agent。
3. 无项目/项目筛选、项目标签同源、三档优先级。
4. 创建、编辑、三个 Picker 的打开/取消/确认/回填/清空、完成、恢复、删除及 3 秒内外撤销。
5. 项目创建、重名冲突、改名、归档、归档任务保留和名称复用。
6. 409 保留草稿、5xx 重试、401 清空认证状态。
7. 浏览器返回关闭 Sheet 并保留筛选。
8. H2 六项反馈的文字/分隔/Textarea/标题/左栏几何与 44px、axe。
9. 登录、任务编辑、Picker 打开态截图，以及 390 × 844 主路径和 320/480px 无溢出。

Playwright 默认使用隔离 H5/API 端口 `11086`/`13000`，不复用本机开发服务；可通过 `H5_PORT`、`API_PORT` 显式覆盖。

## 当前验证记录

| 范围                            | 结果                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| PostgreSQL 数据库集成           | 11/11 通过                                                  |
| 服务端集成                      | 14/14 通过                                                  |
| 根单元/契约测试                 | 93/93 通过；含 Picker 模型、TaskRow disabled 与 H5 代理回归 |
| TypeScript、Lint、Build、Format | 全部通过；Build 7/7，H5 810 modules                         |
| H2 E2E/视觉                     | E2E 15/15、视觉命令 3/3；Picker、axe、44px 与三视口通过     |

本节更新到 2026-07-15 H2 首轮反馈复验；日期时间 Picker 仅完成 Chrome H5 验证，不代表微信小程序编译或实机通过。完整命令口径仍以 [`../../tasks/current.md`](../../tasks/current.md) 与 [`h2-manual-loop-review.md`](h2-manual-loop-review.md) 为准。

## 后续阶段

- T18–T24：积分预留/结算、Agent 状态机、提案确认、重复确认和 Provider 失败释放。
- T25–T27：ASR 权限/编码/临时清理、真实错误降级、真机矩阵、完整无障碍和视觉阈值。
- T28–T30：多副本限流、生产安全头/代理信任、备份恢复、发布回滚和 RC 全量验收。
