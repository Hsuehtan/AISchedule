# H2 UI 首轮反馈修复接管快照

## 状态

- 日期：2026-07-15
- 分支：`codex/phase2-manual-loop`
- 门禁：H2 未通过，等待人类复审
- 范围：只修复 H2 六项客户端 UI/交互反馈；没有进入 T18
- 上一快照：[`2026-07-14-h2-manual-loop.md`](2026-07-14-h2-manual-loop.md)
- 审查入口：[`../quality/h2-manual-loop-review.md`](../quality/h2-manual-loop-review.md)

## 本轮交付

1. StatusBar、登录/注册输入文字和任务左侧时间/项目组合完成垂直居中。
2. 项目列表与“管理项目”入口之间增加唯一的 1 × 20px 分隔线。
3. Taro Textarea 内层改为透明、填满外层并关闭浏览器缩放手柄。
4. TaskRow 仅在真实禁用时传递 `disabled`，启用任务标题使用 Ink 前景色并恢复可见。
5. 三个时间字段改为 Taro `multiSelector` 五列滚轮，支持 1970–2999 年、闰年/月末动态天数、1 分钟精度、取消不改、确认回填和 44px 显式清空。
6. Playwright 改用隔离 H5/API 端口 `11086`/`13000`，不复用开发服务，也不读取开发数据库。

日期时间组件继续使用现有用户时区本地字符串与 UTC 的转换边界；没有新增字段先后约束、提醒调度、通知或服务端改动。

## 提交边界

- `b7e0d65 fix: 修复 H2 表单与任务行显示问题`
- Picker、E2E、截图和文档：运行 `git log -1 -- apps/client/src/components/date-time-picker-field.tsx` 查询第二个原子提交

两个提交可分别回滚。用户本地的 `Electric_Ink_UI_review_keyboard_icons.png` 与 `design/` 未纳入提交。

## 自动化与浏览器证据

- PostgreSQL 数据库集成：11/11
- 服务端集成：14/14
- 单元/契约：93/93
- TypeScript：11/11 Workspace 任务
- Lint：7/7 Workspace 包及根 E2E/Playwright
- Build：7/7 Workspace 任务；H5 810 modules，约 8.47s
- E2E：15/15
- 视觉命令：3/3
- Format 与 `git diff --check`：通过
- 独立代码审查：无 P0/P1；真实滚轮覆盖 2024-01-31 → 2024-02-29 → 2025-02-28，天数列由 29 动态收敛为 28

正式 H2 截图：

- [`../quality/screenshots/h2-login-390x844.png`](../quality/screenshots/h2-login-390x844.png)
- [`../quality/screenshots/h2-task-form-390x844.png`](../quality/screenshots/h2-task-form-390x844.png)
- [`../quality/screenshots/h2-datetime-picker-390x844.png`](../quality/screenshots/h2-datetime-picker-390x844.png)
- [`../quality/screenshots/h2-manual-loop-320x844.png`](../quality/screenshots/h2-manual-loop-320x844.png)
- [`../quality/screenshots/h2-manual-loop-390x844.png`](../quality/screenshots/h2-manual-loop-390x844.png)
- [`../quality/screenshots/h2-manual-loop-480x844.png`](../quality/screenshots/h2-manual-loop-480x844.png)

## 已知边界

- Picker 只在 Chrome H5 验证；微信小程序编译/实机和 iOS/Android 真机焦点、IME、安全区仍待 T25/T27。
- 三个 Picker 当前同时挂载约 3471 个隐藏选项节点，Chrome 正常，但低端设备首次渲染性能尚未量化。
- Picker 关闭后使用 400ms 延迟恢复焦点；正常路径已通过 E2E，极快连续切换不同 Picker 的焦点竞争留待真机复验。
- Taro/Rspack 在受限 macOS 沙箱内可能因 `dynamic_store` NULL panic 挂起；相同 Node.js 24 构建在受控沙箱外通过。
- DeepSeek、ASR、完整积分、提醒触发、生产部署、公网和真实用户数据均未接入。

## 唯一下一步

依据更新后的 H2 审查包进行人工复验并停止开发。只有人类明确回复“通过”后，才可勾选 H2 并开始 T18；否则只处理新的 H2 修改清单。
