# 当前任务

- 任务：Phase 2（T10–T17）真实手工闭环 H2 收口
- 状态：T10–T17、H2 首轮六项反馈及项目栏/点击态反馈已修复，待人工复审
- 分支：`codex/phase2-manual-loop`
- 当前门禁：H2（未通过）
- Phase 2 认证基础提交：`d60dce9 feat: 建立认证安全基础能力`
- T10–T17 实现提交：`f6dec8e`、`55e9e62`、`2dd3673`、`9b9f622`
- H2 对齐/显示修复提交：`b7e0d65`
- H2 日期时间 Picker 与复验提交：运行 `git log -1 -- apps/client/src/components/date-time-picker-field.tsx` 查询
- H2 项目栏滚动与名称展示提交：`127cba3 fix: 优化项目栏滚动与名称展示`
- H2 默认灰色按压态修复提交：本次提交（完成后运行 `git log -1 -- packages/ui/src/neutral-press-button.tsx` 查询）
- H2 文档提交：运行 `git log -1 -- tasks/current.md` 查询本快照所在提交
- Phase 3 Agent 服务规划：[`ADR-009`](../docs/decisions/ADR-009-python-agent-service-boundary.md)；仅更新文档，尚未实施
- H2 审查包：[`docs/quality/h2-manual-loop-review.md`](../docs/quality/h2-manual-loop-review.md)
- 最新 H2 接管快照：[`docs/handovers/2026-07-16-h2-project-strip-and-press-state.md`](../docs/handovers/2026-07-16-h2-project-strip-and-press-state.md)
- 最新规划快照：[`docs/handovers/2026-07-17-python-algorithm-logging-deferred.md`](../docs/handovers/2026-07-17-python-algorithm-logging-deferred.md)
- 已取代的遥测规划快照：[`docs/handovers/2026-07-17-agent-observability-boundary.md`](../docs/handovers/2026-07-17-agent-observability-boundary.md)
- 初次 Phase 3 服务规划：[`docs/handovers/2026-07-16-phase3-python-agent-planning.md`](../docs/handovers/2026-07-16-phase3-python-agent-planning.md)
- Phase 2 初次 H2 快照：[`docs/handovers/2026-07-14-h2-manual-loop.md`](../docs/handovers/2026-07-14-h2-manual-loop.md)

## 本阶段锁定决策

- H1 视觉方向通过；H1 `?screen=` 仅保留为隔离 Fixture Gallery，正式跳转由真实 Session、`projectId`、`taskId` 和对象版本驱动。
- 优先级只有 HIGH/MEDIUM/LOW，新任务默认 MEDIUM；右侧只显示红/黄/绿，且与项目身份色分离。
- 任务左侧项目名称与项目 Chip 来自同一 Project；归档项目任务仍保留原项目名称、颜色和归档状态摘要。
- 昵称保持默认“用户”，不实现昵称修改入口或 API。
- `reminderAt` 只保存、编辑、清空和展示，不实现到期提醒、通知表、轮询或 Push。
- 只有软删除生成服务端 3 秒 UndoOperation；创建、完成和恢复不生成撤销。
- 注册、登录、退出不要求 `Idempotency-Key`；认证后的 Task、Project、Undo 写入仍要求。
- T10 随注册事务交付最小 `NEW_USER_GRANT`；每日补足、完整积分网关和管理员调账仍属于 T18。
- Phase 3 目标采用私有 Python Agent 推理服务；NestJS 继续独占业务数据、pg-boss、提案确认和最终写入，积分账本由 `Users/AiPointsPort` 独占。只有契约有效且由 NestJS 持久化的可用结果才结算积分，HTTP 2xx 本身不构成扣分。
- Python 永不读写业务数据库或持久化 Run/结果/幂等/恢复状态。MVP 也不持久化 Python 算法日志，只输出最小白名单 stdout/stderr；日志存在、缺失或异常均不得改变 Agent 响应、dispatch、业务状态和积分。
- 项目栏可横向滚动但隐藏可见滚动条；Chip 项目名只按 CSS `6em` 显示宽度省略，完整名称保留在 DOM/可访问名称和业务数据中。
- 按钮统一关闭 Taro 默认 hoverClass，H5 pointerdown 复用各控件静止色；持久选中、禁用、2px 焦点轮廓和 Picker 焦点恢复语义不变。

## 2026-07-17 MVP 日志范围收缩

- ADR-011 将 Python 算法日志持久化、Collector、Trace/Metrics、Token/工具明细、保留策略和仪表盘全部移出 MVP；ADR-010 只保留未来数据边界参考。
- PRD 更新为 v1.9；T19 只交付非持久化结构化 stdout，T26 保留 NestJS 业务 Evaluation、日志脱敏和业务状态恢复演练。
- 只修改文档，没有创建 Python 服务、日志持久化后端、Migration、依赖或 Provider 调用。
- 验证：受影响文档 Prettier、Markdown 本地链接、`git diff --check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`（96/96）和 `pnpm build`（7/7）通过；因无运行代码变化，未重跑数据库集成或浏览器 E2E。
- H2 仍未通过，唯一下一步仍是等待人工 H2 结论。

## T10–T17 完成项

- [x] T10：用户名注册、登录、退出、刷新恢复、Session 安全与注册原子 grant。
- [x] T11：默认昵称和选填未验证手机号的只读用户资料。
- [x] T12：隐藏式管理员改密、凭证并发保护、全 Session 撤销和脱敏审计。
- [x] T13：待办创建、详情、分页列表、真实筛选计数和 Project 摘要。
- [x] T14：待办编辑、完成、已完成折叠、恢复和乐观锁冲突。
- [x] T15：软删除、服务端 3 秒单次撤销及到期/重复/版本冲突保护。
- [x] T16：项目创建、自动配色、改名、归档、名称复用和真实 ID 筛选。
- [x] T17：三个时间字段保存/清空/时区展示、当前范围分组和空状态。

## 实施摘要

- Users：Argon2id Password Hash、256-bit Session Token、数据库 SHA-256 Token Hash、30 天绝对过期、Origin 校验和独立 IP/用户名限流。
- Admin：通过用户名或 UUID 定位；密码只从交互式 TTY 隐藏双输入；并发改密只允许一个凭证版本提交。
- Tasks：确定性排序、租户隔离、版本化写入、24 小时业务幂等记录，以及业务结果与响应快照同事务提交。
- Projects：服务端最少使用配色；同用户创建配色串行化；任务归属与归档竞态由数据库锁保护。
- Undo：Migration 不伪造旧通用撤销历史；只有 `TASK_DELETE`，服务端生成 3 秒有效期。
- Client：正式 Taro 页面与 H1 Gallery 分离；logout/401 清空 Query 和账户级 UI 状态；失败/409 保留表单草稿。
- H2 反馈：StatusBar/登录输入/任务左栏垂直居中，项目管理入口增加唯一分隔，Textarea 去除白框，TaskRow 启用态标题恢复 Ink 前景色。
- 时间录入：三个字段使用 Taro 五列滚轮，支持动态月末/闰年、取消不改、确认回填和 44px 独立清空；仍只保存/展示，不触发提醒。
- 项目栏：隐藏 Chrome/Safari/Firefox 横纵滚动条但保留触摸/触控板/鼠标横滑；项目名 `6em` 单行省略，6 个中文字符完整、超出约前 5 字加 `…`，混排按实际显示宽度，完整 DOM/可访问名称不变。
- 点击态：`NeutralPressButton` 固定 `hoverClass="none"` 并透传 ref；正式页面、共享组件和 H1 Fixture 已统一迁移，H5 通过按钮级 CSS 变量保持按下前、中、后静止色，不破坏项目选中、禁用或焦点恢复。
- 测试隔离：Playwright 默认使用 H5 `11086`、API `13000`，不复用本机 `pnpm dev`，避免测试数据进入开发库。
- 智能入口：H2 只显示“智能处理暂不可用”，没有 DeepSeek、ASR、提醒触发或 Fixture 假成功。
- 本地开发：Turbo 开发任务透传后端运行环境变量；Taro H5 在 `h5.devServer` 中仅代理 `/api/v1`，避免拦截 `/api-client.ts` 导致白屏；根目录 `pnpm dev` 可同时启动真实前后端。
- 接口文档：`product_doc/backend-api.md` 记录 H2 当前 18 个真实端点、请求响应模型、错误码、认证、幂等和本地调用示例。

## 验证记录

| 范围                    | 结果                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| PostgreSQL 数据库集成   | 11/11 通过                                                         |
| 服务端集成              | 14/14 通过                                                         |
| `pnpm test`             | 96/96 通过；其中 UI 9/9，含 NeutralPressButton ref/hoverClass 回归 |
| `pnpm typecheck`        | 11/11 Workspace 任务通过                                           |
| `pnpm lint`             | 7/7 Workspace 包及根 E2E/Playwright Lint 通过                      |
| `pnpm build`            | 7/7 Workspace 任务通过；H5 811 modules，约 9.38s                   |
| `pnpm test:integration` | 11 项数据库、14 项服务端集成通过                                   |
| `pnpm test:e2e`         | 17/17 通过；项目栏、按压态、Picker、axe、44px 和三视口             |
| `pnpm test:visual`      | 3/3 通过                                                           |
| `pnpm format:check`     | 通过                                                               |

## 当前风险与非范围

- 当前认证限流是有容量上限的单进程内存实现；多副本生产前必须在 T28/T29 迁移到网关或共享存储。
- Taro/Rspack 在受限 macOS 沙箱内可能因 system-configuration `dynamic_store` NULL panic 挂起；同一 Node.js 24 命令在受控沙箱外成功，属于已知环境限制。
- Chrome 视口验证不能替代 iOS/Android 真机 IME、安全区、地址栏和录音权限；真机矩阵在 T25/T27 完成。
- 三个 Picker 同时挂载的 1970–2999 年选项在 Chrome H5 正常，但低端设备首次渲染成本和快速跨 Picker 焦点竞争尚未完成真机量化，留在 T27 复验。
- 项目栏滚动、pointerdown 静止色和 `NeutralPressButton` ref 目前只完成 Chrome H5 自动化；微信小程序编译及真机触摸反馈仍在 T27 跨端矩阵复验。
- 图标归一和少量 Figma 细节留到 T27，不阻断 H2 手工闭环审查。
- DeepSeek、腾讯 ASR 和真实 Provider Secret 均未连接。
- Python Agent 服务、内部 HTTP 契约和运行时尚未创建；本次只完成 Phase 3 架构与计划修订。
- 未实现提醒触发、通知、Push、昵称修改、C 端改密或手机号验证码登录。
- 未部署生产、未开放公网、未使用真实用户数据。
- `Electric_Ink_UI_review_keyboard_icons.png` 与 `design/` 是用户本地设计资料，不得误纳入提交。

## 唯一下一步

把更新后的 [`H2 审查包`](../docs/quality/h2-manual-loop-review.md) 交给人类复验并停止开发。只有收到明确回复“通过”才可勾选 H2 并开始 T18；若收到修改清单，只修正清单内的 H2 问题并重新提交审查。
