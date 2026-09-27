# 正式 Agent 文字输入弹层修复

日期：2026-09-27。入口为登录后的待办首页 → 底部文字输入；组件为 `AgentTextInputSheet`。本报告的截图均来自正式产品路由和真实 Session。

## 问题与修复

此前 D01 的修复及截图仅覆盖 H1 Gallery，没有覆盖正式输入弹层。正式页独立使用 `agentExamplePrompt` / `agentCommandInput`，因此仍存在以下问题：示例按钮继承 Taro 默认 18px 字号与默认边框，输入框高 84px，原生 textarea 保留白底和缩放手柄，内外框尺寸不一致。

本次修改 `apps/client/src/components/agent-panels.scss`：

- 示例文字明确为 12px / 18px 行高，按钮保持真实 44px 高度，文字垂直居中并消除重复边框。
- 输入框保持真实 52px 高度；原生 textarea 充满外框、背景透明、继承字体与圆角，并关闭拖动缩放。
- 按压颜色由现有 Design Token 控制；空内容禁用发送、示例填入后启用发送等业务规则保持有效。
- 真实 CSS px 保证窄屏下热区不会随 Taro rem 缩小至 44px 以下。

## 正式页面证据

| 视口    | 截图                                                           |
| ------- | -------------------------------------------------------------- |
| 390×844 | [正式输入弹层](screenshots/production-agent-input-390x844.png) |
| 320×844 | [窄屏输入弹层](screenshots/production-agent-input-320x844.png) |
| 480×844 | [宽屏输入弹层](screenshots/production-agent-input-480x844.png) |

新增 `tests/e2e/agent-input.spec.ts` 从正式入口验证：字号、尺寸、原生背景与缩放样式、输入边缘聚焦、三视口无横向溢出、空内容禁用、示例填入、取消、390×560 压缩视口操作区及 axe。修复前该用例在实际 18px 字号处失败，修复后通过。

运行结果：正式输入专项 E2E 1/1；原有 Phase 3 发送/计划/澄清/确认闭环 E2E 1/1；客户端单元测试 79/79，相关 Lint、Typecheck 与构建通过。Phase 3 闭环在隔离副本运行，既有截图保留。未重新执行与样式无关的数据库和真实 Provider 测试。

此前 19/19 全套结果是上一提交的运行记录；本次采用受影响范围回归，不将旧结果表述为当前提交全量重跑。此次修复只涉及正式产品输入弹层，T24 仍待人工审查，H3 未通过。
