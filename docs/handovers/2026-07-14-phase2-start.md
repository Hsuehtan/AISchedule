# Phase 2 启动接管快照

## 快照状态

- 日期：2026-07-14
- 分支：`codex/phase2-manual-loop`
- 已完成门禁：H1 视觉方向通过
- 当前阶段：T10-T17 真实手工闭环
- 下一门禁：H2；T17 完成后必须停止
- H1 验证基线：`bdc5b6c test: 完成 H1 交互壳浏览器验收`

本快照记录 Phase 2 启动时状态，不表示 T10-T17 已完成。任务完成状态以 [`tasks/current.md`](../../tasks/current.md) 与 [`tasks/todo.md`](../../tasks/todo.md) 为准。

## H1 结论与遗留

- Electric Ink 视觉方向和主要画面还原通过，可继续真实业务开发。
- H1 使用 Fixture 和 `?screen=` 串联页面，正式跳转未冻结；Phase 2 必须由 Session、`projectId`、`taskId` 和真实 API 状态驱动。
- 个别视觉细节留到后续统一收口，不阻塞 Phase 2。

## Phase 2 不变量

- Task priority 只有 HIGH/MEDIUM/LOW，新任务默认 MEDIUM；右侧固定红/黄/绿。
- 任务左侧项目标签与项目 Chip 使用同一 Project；项目身份色不能表达优先级。
- 昵称保持默认“用户”，不提供昵称修改入口或接口。
- `scheduledAt`、`deadlineAt`、`reminderAt` 分别保存和展示；不实现提醒调度或到期提示。
- 只有软删除生成 3 秒 UndoOperation；创建、完成和恢复不生成撤销。
- 注册、登录、退出不要求 `Idempotency-Key`；Task、Project、Undo 写入仍要求。
- T10 注册事务完成最小新用户 grant；每日补足和完整积分能力留到 T18。

完整理由与覆盖关系见 [`ADR-008`](../decisions/ADR-008-phase2-scope-supersession.md)。

## 实施顺序

```text
T10 认证与 Session
  -> T11 可选手机号与只读资料
  -> T12 管理员改密 CLI
  -> T13-T15 待办 CRUD、完成/恢复、删除撤销
  -> T16 项目管理与真实筛选
  -> T17 时间字段、分组与空状态
  -> 生成 H2 审查包并停止
```

每个切片遵循 Contract -> Schema -> Service/API -> UI -> Test -> Docs，并保持现有 H1 Fixture Gallery 与正式产品入口隔离。

## H2 必须证明

- 注册、登录、刷新恢复、退出和重新登录由真实 Session 工作。
- 当前用户数据跨会话持久化且不能跨用户访问。
- 首页加号只创建手动任务；项目和任务操作由真实 ID 与版本驱动。
- 项目 Chip、任务左侧项目标签、归档保留和项目计数口径一致。
- 优先级只出现红/黄/绿，且不受项目色影响。
- 创建、编辑、完成、已完成区恢复、软删除和 3 秒撤销边界正确。
- 三个时间字段独立持久化和展示，没有到期通知副作用。
- Agent、ASR 和 Smart Inbox 智能处理不可用时，完整手工闭环仍可使用。

## 工作区保护

- `Electric_Ink_UI_review_keyboard_icons.png` 与 `design/` 是用户原有未提交设计资料，不得误纳入提交。
- 不使用真实 DeepSeek、ASR 密钥，不部署生产，不开放公网。
- 未经 H2 明确通过不得开始 T18。
