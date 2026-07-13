# 视觉 QA

真源：Figma `dryFtYbit291732gktHIqZ`，页面 `210:2`，Production V3 画板 `229:2`。

## H1 基线状态

T06-T09 已完成，当前等待 H1 人类审查。完整审查路径见 [`h1-interaction-review.md`](h1-interaction-review.md)。

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

## 固定检查

- 390 × 844 与 Figma 对照。
- 320/480px 无溢出或遮挡。
- Sheet Footer 固定，内容独立滚动。
- 点击目标至少 44px。
- 青色仅用于 Agent 能力和主动作。
- 项目色不代替优先级。
- 登录展示数据为静态演示，不与真实账户混合。

## 自动化结果

- `pnpm test:e2e`：8/8 通过。
- 核心交互与完成/撤销路径通过。
- 15 状态均可通过 URL 直达。
- 登录、全部待办、文字输入和 Agent 确认页面无小于 44px 的交互目标。
- 上述四个关键页面通过 axe WCAG 2 A/AA 与 2.1 AA 扫描。
- 320/480px 均无水平溢出，App Shell 保持完整动态视口高度。
- 390 × 560 输入焦点场景中操作区仍位于可视范围内。
- 浏览器控制台 error/warning、页面异常和失败请求为 0。

## 已确认的实现侧修正

- 青色主按钮使用 Ink 深色文字，避免白字对比度不足。
- 项目色文本使用更深的同色值，颜色不作为唯一信息来源。
- Taro Button 显式提供可访问角色；仅在真正禁用时输出 `disabled` 属性。
- 页面使用 `100dvh` 响应软键盘压缩，不对高度设置会被 Taro 按设计宽缩放的像素上限。

## 人工复核边界

- 当前截图是人工对照基线，不是像素级自动差异阈值；视觉回归阈值在 T27 建立。
- 真机 IME、安全区、地址栏和真实录音兼容矩阵在 T25/T27 验证。
- 系统状态栏、字符占位图标和系统字体的差异记录在 H1 审查包中。
