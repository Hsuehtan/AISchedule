# 创建草稿与 Action 卡职责分离（2026-10-27）

本次修复通过。按用户明确的新规则，创建类草稿统一进入 Plan 浮层；Action 卡仅展示修改、完成、恢复、删除和整理。当前本项目 `10087` 已更新，真实 Flash 合成验收通过，保留本地数据库和现有数据；T24/H3/H4 状态不变。

## 原因与修复

原实现将 `Run.resultType=ACTION_PROPOSAL` 一律展示为 Action 卡，普通对话又只允许此类型表达创建，导致六项旅行规划挤进长确认卡。这是业务展示与推理协议耦合。

新增统一业务映射 `proposalPresentation`：

| 持久化 actionCode | 公开 presentation / 产品展示 |
| --- | --- |
| CREATE_TASK | PLAN / 可编辑计划草稿浮层 |
| CREATE_PROJECT_TASKS | PLAN / 可编辑计划草稿浮层 |
| UPDATE_TASK、COMPLETE_TASK、RESTORE_TASK、DELETE_TASK、ORGANIZE_TASKS | ACTION / 对话中的确认卡 |

映射同时用于提案查询、Run 结果、编辑/关闭/取消的幂等重放与确认执行回执。历史创建提案直接按新规则展示，不迁移或改写正文。模型不能通过选择另一种结果类型绕过展示规则。

内部仍保留五类结果与七类操作。普通对话的创建可继续使用 `ACTION_PROPOSAL` 结构表达，业务服务返回 `proposal.presentation=PLAN`；这不是第二次计划生成，不增加派发、不改变入口计费。原计划生成入口继续使用其原能力与计费。所有写入仍需用户确认。

Prompt 更新为 v6，明确旅行/目标拆解生成具体创建草稿，标题与 summary 简洁；新增待办/项目的展示是 Plan，Action 仅用于现有待办操作。复用既有 Plan 组件，无新增布局或公开 API/数据库结构。

## 自动化验证

- 新增 15 项服务端分类测试。先以旧 resultType 映射运行，8 项失败；修复后全部通过。
- 全仓单测通过：Server 142，Python 153，12/12 workspace 任务。
- 全仓隔离集成通过：Server 65，DB 21，Python 1，12/12 workspace 任务；包含 v1 ACTION_PROPOSAL 创建提案确认及重复确认均返回 PLAN 的断言。
- 完整 Chrome E2E 最终 46/46。新增普通单待办、济州岛六项行程、已有项目新增三个场景；均验证直接打开 Plan、没有 Action 卡、确认前无任务写入、关闭刷新恢复及确认数量。
- 同会话创建→修改→完成→恢复→删除→新建项目任务，以及冲突、响应丢失、失败后重生成、双标签确认等既有回归通过。创建使用 Plan，四类现有任务操作仍保留 Action。
- 契约检查、lint、typecheck、build 均通过；完整 E2E 包含既有 3 项 @visual 基线，未把原型视觉当作正式页验收。

完整 E2E 首轮 45/46，唯一失败为旧浮层触控目标断言读到 `43.99998474121094px`。按 0.01px 精度比较后完整复跑 46/46；没有修改产品尺寸或降低 44px 要求。最终历史截图恢复，新增正式证据另存新目录。

## 当前页面真实 Flash 验收

使用独立合成账号 `creation_accept_5886841212e1`，实际经过当前 Python Pydantic AI Runtime v6，模型均为 deepseek-v4-flash。通过 `pnpm agent:accept:creation` 执行：

1. 无项目单待办：自动打开 Plan，确认创建 1 项。
2. 自然语言“我要去济州岛旅游，请帮我规划六天行程，拆成6个待办，每天一项”：自动打开六项 Plan，关闭、刷新、重新进入仍为 Plan，确认创建 6 项。
3. 已有项目新增“订机票/订酒店/准备行李”：自动打开 Plan，3 项均写入指定项目。
4. 修改第一项优先级为高：显示 Action 卡，确认后准确修改，任务总数保持 10。

三次创建均核对确认前无写入，重复确认返回 PLAN 回执且任务不增加。4 个 Run 全部成功，4 笔成功 DEBIT 合计 4 点，所有预留已结算；没有因为显示 Plan 而额外触发第二个请求或多扣分。

[脱敏断言与账本核对](agent-creation-plan/creation_accept_5886841212e1/result.json)。正式六项 Plan 截图：[320px](agent-creation-plan/creation_accept_5886841212e1/jeju-six-320.png)、[390px](agent-creation-plan/creation_accept_5886841212e1/jeju-six-390.png)、[480px](agent-creation-plan/creation_accept_5886841212e1/jeju-six-480.png)；[修改仍为 Action](agent-creation-plan/creation_accept_5886841212e1/update-action-390.png)。390px 截图已目视检查：六项任务分行、编辑入口、创建 6 项与取消可见。

## 范围与历史

此次覆盖创建展示策略、七类动作映射、历史/幂等兼容及受影响浏览器闭环。原 v5 的 120 Case × 3 轮与 20 阶段验收保留为[历史架构验收](2026-10-27-pydantic-agent-final-acceptance.md)，本次未重跑 v6 的全量 360 次真实模型评测，也不把 v5 分数记为 v6 结果。长流程验收脚本已适配新分流，但本次真实执行的是新增四场景专项脚本。

不部署公网或生产，不推进 T25–T27，不使用真实用户数据，不修改未跟踪的 apps/miniprogram/。
