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
- [`h2-login-390x844.png`](screenshots/h2-login-390x844.png)
- [`h2-task-form-390x844.png`](screenshots/h2-task-form-390x844.png)
- [`h2-datetime-picker-390x844.png`](screenshots/h2-datetime-picker-390x844.png)
- [`h2-project-strip-scrolled-390x844.png`](screenshots/h2-project-strip-scrolled-390x844.png)

H2 人工审查重点不是重新做全量视觉精修，而是确认真实数据接入后页面层级、跳转、项目/优先级语义、Sheet/返回和错误反馈没有破坏已经通过的视觉方向。少量图标和像素细节仍按批准结论留到 T27。

H2 已于 2026-07-17 获得人类明确通过。

## Phase 3 Agent 状态

T18–T24 已把 H2 的“智能处理暂不可用”替换为真实 NestJS Agent 产品链路，并以受控 Python Stub 驱动浏览器闭环。Phase 3 最终 E2E 已生成以下截图：

- `docs/quality/screenshots/phase3-agent-clarification-320x844.png`
- `docs/quality/screenshots/phase3-agent-clarification-390x844.png`
- `docs/quality/screenshots/phase3-agent-clarification-480x844.png`

三张截图已人工复核：候选项在回答后仍可读，320/390/480px 无水平溢出或遮挡，可见按钮热区均不小于真实 44 CSS px。H1 的 `agent-clarify-390x844.png`、`agent-plan-390x844.png` 和 `agent-confirm-390x844.png` 没有被用作 Phase 3 正式实现证据。

Phase 3 浏览器复核路径固定覆盖：普通回复 → 生成计划 → 编辑/确认创建 → Smart Inbox 整理 → Action 确认 → 澄清选择。还需验证：

- Agent Panel 关闭和浏览器返回不取消请求，重新打开可恢复结果。
- 所有可见模型内容按纯文本展示，不渲染 HTML，也不泄露 Stub、模型、积分或 Token 信息。
- Smart Inbox 的待确认/待澄清/处理中/失败/未读优先级不因项目筛选隐藏。
- 额度不足显示“明天可继续”，Provider/能力/内部错误显示“智能处理暂不可用”。
- 语音入口保持暂不可用，不触发权限或腾讯 ASR 请求。

## 固定检查

- 390 × 844 与 Figma 对照。
- 320/480px 无溢出或遮挡。
- Sheet Footer 固定，内容独立滚动。
- 点击目标至少 44px。
- 青色仅用于 Agent 能力和主动作。
- 项目身份色不代替优先级；任务左侧项目标签与项目 Chip 使用同一数据。
- 任务右侧优先级仅使用高红、中黄、低绿，新任务默认中。
- 登录展示数据为静态演示，不与真实账户混合。
- StatusBar 和登录/注册输入文字垂直居中，不改变既有高度和 44px 热区。
- 项目与“管理项目”入口之间只有一条 1 × 20px 分隔线。
- 项目栏在项目超出一行时仍可左右滑动，但 Chrome/Safari 与 Firefox 均不展示横向或纵向滚动条，项目栏本身不产生纵向溢出。
- 项目 Chip 标签最大宽度为 `6em`：6 个中文字符完整显示，超出后约为前 5 个中文字符加 `…`；中英数字混排按实际显示宽度省略，DOM 文本与可访问名称保持完整。
- 任务描述输入区内外底色一致，无原生白框和缩放手柄。
- 启用态任务标题使用 Ink 前景色并具有非零绘制区域；左侧时间/项目组合相对任务行垂直居中。
- 三个时间字段通过五列滚轮录入，Picker 打开态、取消、确认、回填和清空均可复验。
- 项目 Chip、加号、Smart Inbox、任务主体/完成控件、表单 Picker 和 Sheet 按钮在 pointerdown 前、中、后保持各自静止态颜色，不出现 Taro 默认灰色块；持久选中、禁用和 `aria-pressed` 语义不变。
- 键盘焦点继续使用 2px Electric Ink 轮廓，日期时间 Picker 关闭后焦点返回原触发按钮。

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

### H2 已通过门禁

- PostgreSQL 数据库集成：11/11 通过。
- 服务端集成：14/14 通过。
- 正式产品 `pnpm test:e2e`：17/17 通过；包含六项 H2 首轮反馈、隐藏滚动条横滑、项目名省略、按压静止色、日期时间 Picker、主路径、axe、44px、Sheet 焦点/恢复和 320/390/480px。
- `pnpm test:visual`：3/3 通过；H2 正式截图由全量 E2E 主路径重新生成，新增项目栏滚动后截图。

H1 的历史结果没有被用来替代 H2 正式产品路径；最终命令口径见 [`h2-manual-loop-review.md`](h2-manual-loop-review.md) 和 [`../../tasks/current.md`](../../tasks/current.md)。

### Phase 3 T24 检查点

- `tests/e2e/phase3-agent.spec.ts` 使用真实 NestJS + PostgreSQL + 私有 Agent Stub 完成产品闭环。
- `pnpm test:e2e`：18/18 通过，其中 Phase 3 路径覆盖普通回复、计划、确认、Smart Inbox、Action 与澄清。
- `pnpm test:visual`：3/3 通过；H1/H2 历史基线同步重生成。
- 320/390/480px 水平溢出断言、真实 44 CSS px 热区和 Agent 对话区 axe 均通过。
- 三张 `phase3-agent-clarification-*x844.png` 已生成并人工复核。
- 真实 DeepSeek Smoke 不属于视觉测试，已在独立合成数据链路中通过；Stub 视觉结果只作为确定性 UI 回归证据。

## 已确认的实现侧修正

- 青色主按钮使用 Ink 深色文字，避免白字对比度不足。
- 项目色文本使用更深的同色值，颜色不作为唯一信息来源。
- Taro Button 显式提供可访问角色；仅在真正禁用时输出 `disabled` 属性。
- 页面使用 `100dvh` 响应软键盘压缩，不对高度设置会被 Taro 按设计宽缩放的像素上限。
- Taro Textarea 内层使用透明背景并关闭浏览器缩放手柄；任务描述仍由原有表单提交和持久化链路处理。
- 时间字段使用 Taro `multiSelector`，不再暴露自由文本录入；客户端选择本地时间并沿用既有 UTC 转换。
- 项目栏使用原有 Flex 横向滚动和跨浏览器隐藏滚动条样式；名称省略完全由 CSS 显示宽度处理，不截断业务数据或可访问名称。
- 所有 Taro Button 统一经 `NeutralPressButton` 固定 `hoverClass="none"`；H5 通过按钮级 CSS 变量复用静止色，不用全局透明背景覆盖彩色控件。组件透传 ref，保留 Sheet/Picker 既有焦点恢复链路。
- Agent 候选按钮在回答后禁用交互但保持 Ink 文字与完整不透明度，便于用户回看选择上下文。
- Taro H5 宽屏会把普通 `px` 转成受 `maxRootSize` 限制的 `rem`；按钮最小热区改用不参与转换的 `44PX`，确保 480px 视口下仍是实际 44 CSS px。

## 人工复核边界

- 当前截图是人工对照基线，不是像素级自动差异阈值；视觉回归阈值在 T27 建立。
- 日期时间 Picker 本轮只完成 Chrome H5 验证；微信小程序编译/实机、真机 IME、安全区、地址栏和真实录音兼容矩阵在 T25/T27 验证。
- 系统状态栏、字符占位图标和系统字体的差异记录在 H1 审查包中。
- H2 中 Smart Inbox、文字 Agent 和语音入口只验证了明确不可用反馈；Phase 3 必须使用新的正式 E2E 和 `phase3-agent-clarification-*` 截图证明文字 Agent/Smart Inbox 已接入。
- T25–T27 尚未开始：语音、微信小程序/真机、最终错误状态、像素级视觉回归阈值和完整无障碍收口不属于本次 T24 审查完成项。
- H3 仍在 T27 后，当前未通过；Phase 3 截图通过也不会提前改变 H3 状态。
- `reminderAt` 只验证表单与任务行展示，不验证通知或提醒触发。
