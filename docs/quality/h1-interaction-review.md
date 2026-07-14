# H1 交互冻结审查包

状态：2026-07-14 已通过视觉方向审查，带 Phase 2 跳转修正项。代码基线：`bdc5b6c test: 完成 H1 交互壳浏览器验收`。

## 人类审查结论

- Electric Ink 视觉与主要画面还原获准进入 Phase 2；个别视觉细节留待后续统一调整。
- H1 的 Fixture 状态跳转不作为正式产品逻辑。T10-T17 必须使用真实 Session、项目筛选和任务 ID 重建跳转并在 H2 复验。
- 任务行左侧文案是项目归属，必须与上方项目 Chip 使用同一项目数据；项目身份色不得复用为优先级色。
- 任务右侧优先级只有高/中/低，固定使用红/黄/绿，新任务默认中。
- 产品已授权进入 T10-T17；完成 T17 后必须在 H2 暂停。

## 本阶段完成项

- T06：Electric Ink Design Token、App Shell、Smart Inbox、待办行和基础控件。
- T07：15 个类型安全页面状态、可复现 URL、Bottom Sheet、Dialog 和撤销 Toast。
- T08：使用共享 Contract Fixture 实现 Production V3 全状态和核心跳转路径。
- T09：真实 H5 构建、390 × 844 截图、320/480px 响应式、44px 热区、WCAG A/AA、动态视口和软键盘压缩场景。

当前是交互壳，不包含 T10 之后的认证、数据库持久化或真实 Agent/语音调用。

## 启动与复现

```bash
pnpm --filter @ai-schedule/client build
python3 -m http.server 4173 --directory apps/client/dist
```

打开 `http://127.0.0.1:4173/?screen=login`。任意状态均可通过 `?screen=<id>` 直接访问。

| 页面状态   | screen               | Figma Node |
| ---------- | -------------------- | ---------- |
| 登录       | `login`              | `230:7`    |
| 全部待办   | `all-todos`          | `230:10`   |
| Agent 计划 | `agent-plan`         | `230:13`   |
| 工作项目   | `work-project`       | `231:4`    |
| 空状态     | `empty-state`        | `231:7`    |
| 已完成展开 | `done-expanded`      | `231:10`   |
| 完成与撤销 | `toast-undo`         | `231:13`   |
| 文字输入   | `text-input`         | `232:4`    |
| 语音输入   | `voice-input`        | `232:7`    |
| 候选消歧   | `candidates`         | `232:10`   |
| Agent 澄清 | `agent-clarify`      | `232:13`   |
| Agent 确认 | `agent-confirm`      | `232:16`   |
| 编辑待办   | `task-edit`          | `232:19`   |
| 项目管理   | `project-management` | `232:22`   |
| 额度不足   | `quota-limit`        | `232:25`   |

## 建议审查路径

1. `login`：点击“登录”，进入全部待办。
2. `all-todos`：点击 Smart Inbox 的“一键整理”，进入计划草稿；点击“创建 5 项”，进入 Agent 确认。
3. `all-todos`：点击“写周报”的完成圆圈，检查 Toast，再点击“撤销”。
4. 点击底部文字入口，检查文字输入、候选消歧、澄清和确认；点击语音入口检查录音态。
5. 点击“工作”筛选和待办行，检查项目状态与编辑 Sheet。
6. 直接访问 `project-management` 和 `quota-limit`，检查管理与异常态。

## 截图与自动化结果

- 15 个 Figma 状态的 390 × 844 截图：[`screenshots/`](screenshots/)
- 响应式边界：[`all-todos-320x844.png`](screenshots/all-todos-320x844.png)、[`all-todos-480x844.png`](screenshots/all-todos-480x844.png)
- 软键盘压缩模拟：[`text-input-keyboard-390x560.png`](screenshots/text-input-keyboard-390x560.png)
- `pnpm test:e2e`：8/8 通过。
- 覆盖：核心路径、3 秒撤销交互、15 状态直达、44px 点击目标、axe WCAG A/AA、320/480px、动态视口、输入焦点和浏览器运行时异常。
- 浏览器控制台 error/warning、页面异常和失败请求：0。

## Figma 差异清单

1. Figma 中部分青色主按钮使用白字；实现改为 Ink 深色字，以通过 WCAG AA 对比度。需要在 H1 确认该视觉差异。
2. 顶部系统状态栏是 H5 内的视觉模拟，不等同于 iOS/Android 原生状态栏。
3. 键盘、麦克风、文件夹等图标目前使用轻量字符占位；正式 SVG/Icon 归一安排在 T27，不改变页面层级或操作路径。
4. 字体使用系统中文字体栈，没有引入网络字体，跨系统的字形细节会略有差异。
5. Figma 未提供变量；颜色、圆角、间距和阴影已在代码 Token 中固化为单一真源。

## 已知风险与未实现边界

- Chrome 通过 390 × 560 视口模拟软键盘压缩，并不能替代真实 iOS/Android 的 IME、安全区和地址栏测试；设备矩阵在 T25/T27 完成。
- Sheet 已具备可访问名称和滚动区，但完整焦点陷阱、关闭后的焦点恢复在 T27 补齐。
- 当前 Fixture 不实现真实分页、鉴权、积分、异步 Agent 状态、网络错误恢复或数据持久化。
- DeepSeek 与腾讯 ASR 未使用真实密钥；受控 Provider Smoke 延后到 H3 前。
- Taro/Vite 4 构建仍输出 Dart Sass legacy JS API 上游弃用警告，不影响产物或浏览器运行时。

## 原审查问题

请确认以下内容：

- 页面导航、层级、Bottom Sheet/Dialog、核心文案和 3 秒撤销方向可冻结。
- Electric Ink 的视觉方向可冻结。
- 接受青色主按钮使用 Ink 深色文字的无障碍差异。
- 接受图标精修和真实设备兼容测试按计划在 T27/T25 完成。

上述问题已于 2026-07-14 收到人类反馈；正式跳转和业务口径以 ADR-008 与 H2 验收为准。
