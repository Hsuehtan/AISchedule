# H2 项目栏与点击态修复接管快照

## 快照状态

- 日期：2026-07-16
- 分支：`codex/phase2-manual-loop`
- 当前门禁：H2（未通过）
- 已完成范围：T10–T17、H2 首轮六项 UI 修复、项目栏与默认灰色按压态修复
- 首个提交：`127cba3 fix: 优化项目栏滚动与名称展示`
- 第二个提交：本次提交（完成后运行 `git log -1 -- packages/ui/src/neutral-press-button.tsx` 查询）
- 审查入口：[`../quality/h2-manual-loop-review.md`](../quality/h2-manual-loop-review.md)

本快照不可覆盖。后续发生新的 H2 修改时应新增日期化 handover，不得回写本文件表达新的当前状态。

## 本轮授权边界

本轮只修改客户端 UI、自动化测试、正式 H2 截图和接管文档，没有修改 API、数据库、Prisma、服务端或公开 Contract，也没有进入 T18。

明确未做：

- 不连接 DeepSeek、腾讯 ASR 或真实 Provider Secret。
- 不实现积分完整账本、Agent 状态机、Smart Inbox 真实整理或提醒触发。
- 不部署生产、不开放公网、不使用真实用户数据。
- 不把 H1 Fixture 当作 H2 正式业务闭环证据。

## 已实现行为

### 项目栏滚动与名称展示

- 保留原 Flex 项目栏和 `overflow-x: auto`，增加纵向裁切并隐藏 Chrome/Safari、Firefox 的可见滚动条。
- 项目超出一行时仍支持触摸拖动、触控板和鼠标横向滚动，能够滚动到末端并打开“管理项目”。
- Project Chip 禁止 Flex 压缩和换行；标签最大显示宽度为 `6em`，使用 CSS 单行省略：
  - 6 个中文字符完整显示；
  - 超出时约显示前 5 个中文字符加 `…`；
  - 中英数字混排按实际显示宽度占位，不做 JavaScript 字符截断；
  - DOM 文本、可访问名称、API 数据和项目管理中的名称始终完整。
- “管理项目”分隔线、44px 点击区、项目选中态与过滤逻辑保持不变。

### 中性按压态

- `@ai-schedule/ui` 新增 `NeutralPressButton`，类型层禁止调用方传入 `hoverClass`，运行时固定 `hoverClass="none"`，并自动附加 `ei-press-neutral`。
- 正式页面、共享 Electric Ink 组件及隔离 H1 Fixture 中的 Taro Button 已统一迁移。
- H5 由各按钮 CSS 变量保存原本前景色和背景色，pointerdown/active 时复用静止色；没有使用会抹掉彩色控件背景的全局透明覆盖。
- 项目持久选中、`aria-pressed`、真实禁用态和 2px Electric Ink `focus-visible` 轮廓保持不变。
- 包装组件使用 `forwardRef` 透传 Taro Button ref，日期时间 Picker 取消/确认后仍能恢复焦点到触发按钮。

## 测试证据与调试记录

- `packages/ui/src/neutral-press-button.test.tsx`：锁定 hoverClass、class/事件/禁用语义和 ref 透传。
- `tests/e2e/h2-project-strip.spec.ts`：覆盖 320/390/480px、至少 8 个项目、隐藏滚动条、横向滚动、项目栏几何、6/7 字与混排、完整可访问名称及滚动后截图。
- `tests/e2e/h2-press-state.spec.ts`：覆盖项目 Chip、顶部加号、Smart Inbox、任务主体/完成控件、表单 Picker 与 Sheet 按钮的真实 pointerdown 静止色、非 `rgb(222, 222, 222)`、合法选中态和 2px 焦点轮廓。
- 完整 E2E 首轮 16/17 暴露 `NeutralPressButton` 未透传 ref，导致日期时间 Picker 关闭后的焦点恢复失败；补 `forwardRef` 和单元回归后，失败场景定向复验及最终全量 17/17 均通过。

截至此快照的验证：

| 门禁                    | 结果                          |
| ----------------------- | ----------------------------- |
| `pnpm test`             | 96/96；其中 UI 9/9            |
| `pnpm lint`             | 通过                          |
| `pnpm typecheck`        | 11/11 Workspace 任务通过      |
| `pnpm build`            | 7/7；H5 811 modules，约 9.38s |
| `pnpm test:integration` | 数据库 11/11、服务端 14/14    |
| `pnpm test:e2e`         | 17/17                         |
| `pnpm test:visual`      | 3/3                           |
| `pnpm format:check`     | 通过                          |

截图：

- [`../quality/screenshots/h2-manual-loop-320x844.png`](../quality/screenshots/h2-manual-loop-320x844.png)
- [`../quality/screenshots/h2-manual-loop-390x844.png`](../quality/screenshots/h2-manual-loop-390x844.png)
- [`../quality/screenshots/h2-manual-loop-480x844.png`](../quality/screenshots/h2-manual-loop-480x844.png)
- [`../quality/screenshots/h2-project-strip-scrolled-390x844.png`](../quality/screenshots/h2-project-strip-scrolled-390x844.png)

## 已知边界

- 项目栏、pointerdown 静止色和 ref/焦点恢复只完成 Chrome H5 自动化；Taro 标准属性不等于微信小程序已编译或真机通过，跨端触摸反馈在 T27 复验。
- 项目名是视觉宽度省略，不承诺按 Unicode 字符数精确截断；这是显式产品决策，中英数字混排按实际字形宽度展示。
- H1 历史截图不是本轮正式证据；正式 H2 截图由真实 Session/API 路径生成。
- 用户本地 `Electric_Ink_UI_review_keyboard_icons.png` 和 `design/` 未被修改或纳入提交。

## 唯一下一步

把更新后的 [`H2 审查包`](../quality/h2-manual-loop-review.md) 交给人类复验并停止开发。只有收到人类明确回复“通过”后，才可以勾选 H2 并开始 T18；若收到新的修改清单，只修复清单内 H2 问题并新增不可覆盖的 handover。
