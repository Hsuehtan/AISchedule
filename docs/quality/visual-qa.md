# 视觉 QA

真源：Figma `dryFtYbit291732gktHIqZ`，页面 `210:2`，Production V3 画板 `229:2`。

## H1 基线状态

T06-T09 已完成，H1 视觉方向于 2026-07-14 通过。完整审查记录见 [`h1-interaction-review.md`](h1-interaction-review.md)。正式产品跳转未在 H1 冻结，随 T10-T17 真实数据流修正并在 H2 复验。

- Login
- All Todos
- Agent Plan
- Work Project
- Empty State
- Done Expanded
- Toast Undo
- Text Input
- Voice Input
- Candidates
- Agent Clarify
- Agent Confirm
- Task Edit
- Project Management
- Quota Limit

以上 15 个状态均已生成 390 × 844 截图，保存在 [`screenshots/`](screenshots/)；另含 320/480px 响应式和 390 × 560 软键盘压缩截图。

## H2 正式产品状态

T10–T17 已把正式入口改为真实 Login/Register/Task Home 页面。H2 截图由 Session/API 驱动，不使用 `?screen=`：

- [`h2-manual-loop-320x844.png`](screenshots/h2-manual-loop-320x844.png)
- [`h2-manual-loop-390x844.png`](screenshots/h2-manual-loop-390x844.png)
- [`h2-manual-loop-480x844.png`](screenshots/h2-manual-loop-480x844.png)

H2 人工审查重点不是重新做全量视觉精修，而是确认真实数据接入后页面层级、跳转、项目/优先级语义、Sheet/返回和错误反馈没有破坏已经通过的视觉方向。少量图标和像素细节仍按批准结论留到 T27。

## 固定检查

- 390 × 844 与 Figma 对照。
- 320/480px 无溢出或遮挡。
- Sheet Footer 固定，内容独立滚动。
- 点击目标至少 44px。
- 青色仅用于 Agent 能力和主动作。
- 项目身份色不代替优先级；任务左侧项目标签与项目 Chip 使用同一数据。
- 任务右侧优先级仅使用高红、中黄、低绿，新任务默认中。
- 登录展示数据为静态演示，不与真实账户混合。

## 自动化结果

### H1 历史基线

- `pnpm test:e2e`：8/8 通过。
- H1 Fixture 核心状态切换通过；不作为正式认证、筛选、编辑或撤销业务逻辑的验收。
- 15 状态均可通过 URL 直达。
- 登录、全部待办、文字输入和 Agent 确认页面无小于 44px 的交互目标。
- 上述四个关键页面通过 axe WCAG 2 A/AA 与 2.1 AA 扫描。
- 320/480px 均无水平溢出，App Shell 保持完整动态视口高度。
- 390 × 560 输入焦点场景中操作区仍位于可视范围内。
- 浏览器控制台 error/warning、页面异常和失败请求为 0。

### H2 当前门禁

- PostgreSQL 数据库集成：11/11 通过。
- 服务端集成：14/14 通过。
- 正式产品 `pnpm test:e2e`：14/14 通过；包含 H2 主路径、axe、44px、Sheet 焦点/恢复和 320/390/480px。
- `pnpm test:visual`：3/3 通过；H2 正式截图由全量 E2E 主路径重新生成并人工查看。

H1 的历史结果没有被用来替代 H2 正式产品路径；最终命令口径见 [`h2-manual-loop-review.md`](h2-manual-loop-review.md) 和 [`../../tasks/current.md`](../../tasks/current.md)。

## 已确认的实现侧修正

- 青色主按钮使用 Ink 深色文字，避免白字对比度不足。
- 项目色文本使用更深的同色值，颜色不作为唯一信息来源。
- Taro Button 显式提供可访问角色；仅在真正禁用时输出 `disabled` 属性。
- 页面使用 `100dvh` 响应软键盘压缩，不对高度设置会被 Taro 按设计宽缩放的像素上限。

## 人工复核边界

- 当前截图是人工对照基线，不是像素级自动差异阈值；视觉回归阈值在 T27 建立。
- 真机 IME、安全区、地址栏和真实录音兼容矩阵在 T25/T27 验证。
- 系统状态栏、字符占位图标和系统字体的差异记录在 H1 审查包中。
- Smart Inbox、文字 Agent 和语音入口在 H2 只验证明确不可用反馈；不得用 H1 Fixture 截图声称智能功能已实现。
- `reminderAt` 只验证表单与任务行展示，不验证通知或提醒触发。
