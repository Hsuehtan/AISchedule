# Pydantic AI Agent 升级与功能验收（2026-10-27）

> 历史记录：以下为 HTTP 402 时的未完成状态，保留当时事实。账号恢复后的修复、完整重跑及人工审阅已完成，最新结论以[最终专项验收](2026-10-27-pydantic-agent-final-acceptance.md)为准。

**结论：代码与确定性回归已通过；真实模型专项验收未完成。** 第三轮 120 Case 评测从第 14 个用例附近开始连续收到 DeepSeek HTTP 402。该轮保留为失败证据，未作为语义通过率计算，也没有自动换模型、提高重试次数或挑选成功轮次。恢复现有账号额度后，须重新执行完整三轮及本报告末尾的未验浏览器场景，才能标记本专项验收完成。T24 人工审查、H3/H4 状态不变。

## 实施范围

- Python 默认 v1/v2 execute 均进入 Pydantic AI Runtime；v2 可按需调用任务、项目、历史三个只读工具，v1 保持原契约形态。`deepseek-v4-flash` 统一使用，Think 关闭，SDK 自动重试为零。
- 保留五类结果与七类 Action。结果工具、引用和业务字段由 Python 校验；NestJS 仍独占 Run、积分、候选引用、确认与原子业务写入。
- v2 扩展安全任务状态、描述、提醒和项目显示名称；支持修改项目归属与多字段整理。Smart Inbox 默认整理检查缺失的项目、计划时间和提醒，已有值不可被自动整理覆盖。
- 运行限额为四次模型请求（含一次结构修复）、六次只读工具调用、4096 输出 token，并与原 execute 截止时间共享预算。
- 固定 120 个合成 Case；Pydantic Evals 组织执行并记录确定性业务分数。报告只保存 Case ID、类别、结果、失败类别、耗时与调用次数，不保存 Prompt、工具正文或模型响应。

## 工程门禁

| 门禁 | 结果 |
|---|---|
| `pnpm agent:contract:check` | 通过；v1/v2 生成工件一致 |
| `pnpm test` | 通过；Python 128/128，Server 127/127，其他包通过 |
| `pnpm test:integration` | 通过；Server 65/65，其他包通过 |
| `pnpm test:e2e` | 通过；正式 H5 Chrome 43/43，含新双标签页确认用例 |
| `pnpm test:visual` | 通过；3/3 |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 最终复跑通过；分别为 8/8、12/12、8/8 |
| `pnpm agent:eval:offline` | 25/25，通过固定语料、评分器和受控 Runtime 测试 |
| `pnpm smoke:deepseek` | 在 HTTP 402 前通过 3/3：回复/计划结算、七类 Action、正式 H5 的计划重生成与关闭恢复 |

完整 E2E 曾因旧整理文案断言和新增测试对提案终态的错误预期失败；两处测试与 Stub 已按现行契约修正，最终 43/43。受限 shell 中 Docker 与 macOS 系统配置不可用时，门禁在本机隔离测试环境复跑；未放宽产品限流或改写真实数据。

## 真实 Flash 评测

采用同一 120 Case 语料、相同合成候选和业务字段评分器。旧流程对新增多字段整理的 10 Case 无实现能力，基线不计入这 10 Case。

| 运行 | 结果 | p95 | 平均模型/工具调用 | 说明 |
|---|---:|---:|---:|---|
| 旧流程统一 Flash 基线 | 91/110（82.7%） | 2.38 秒 | 1.01 / 0 | 一轮；[原始元数据](agent-evals/flash-baseline-final.json) |
| 新 Runtime 第 1 轮 | 118/120（98.3%） | 5.60 秒 | — | 同口径可比 Case 108/110 |
| 新 Runtime 第 2 轮 | 119/120（99.2%） | 4.94 秒 | — | 同口径可比 Case 109/110 |
| 新 Runtime 第 3 轮 | **未完成验收** | 不计 | — | 107 个 `PROVIDER_UNAVAILABLE`；单例诊断确认 HTTP 402 |

前两轮合计 237/240，p95 5.43 秒，计划类 p95 8.08 秒，平均模型调用 2.17、工具调用 1.16，实际单次最大模型调用 4、工具调用 2；各类业务两轮合计均达到 90%。这只是**已完成两轮**的结果，不能代替要求的三轮门槛。第三轮的 107 次 402 均保留在[原始元数据](agent-evals/pydantic-agent-final.json)；[单例状态诊断](agent-evals/provider-status-diagnostic.json)仅输出 HTTP 状态而不含错误正文。原生 16 token 短请求曾返回 200，不能据此判定带完整工具 Schema 的 4096 token 请求已恢复。

评分器会核对卡片类型、Action、候选目标、明确标题/优先级/项目、更新字段集合、项目批量任务内容，以及整理不覆盖非空字段。时间 Case 验证设置或清空的字段语义；对“明天/下周”等具体日历值尚未固定评测时钟逐项精确评分。回复自然度和计划可执行性的人工复核未完成，故真实模型质量结论仍有此限制。

## 正式 H5 与当前 `10087`

使用独立合成账号，在本项目本地 H5、NestJS、Python、原本数据库上完成并核对任务/项目、Run、Flash 模型与积分账本：自然语言创建、上一轮指代修改、回复转计划、计划编辑确认、完成与恢复、删除与三秒撤销、Smart Inbox 多字段整理及移除单项、项目批量任务、澄清回答、同名候选选择。11 阶段的最后一项（同名候选选择）由浏览器执行通过，随后由[脱敏数据库审计](agent-pydantic-acceptance/10087-eleven-phase-audit.json)核对 13 个 Run 均成功、模型均为 Flash、每个收费 Run 仅有一笔结算扣分，且同名任务只有目标对象发生变化；前 [10 阶段浏览器断言](agent-pydantic-acceptance/10087-ten-phase-result.json)也保留。后续扩展运行因 402 在第一项中断，记录为[失败尝试](agent-pydantic-acceptance/current-10087-result.json)，不能计作新场景通过。

正式页面截图：[Action 确认前](agent-pydantic-acceptance/action-before-confirm-390.png)、[Action 执行后](agent-pydantic-acceptance/action-after-confirm-390.png)、[多字段整理](agent-pydantic-acceptance/organize-before-confirm-390.png)、计划浮层 [320](agent-pydantic-acceptance/plan-before-confirm-320.png) / [390](agent-pydantic-acceptance/plan-before-confirm-390.png) / [480](agent-pydantic-acceptance/plan-before-confirm-480.png)。三宽度截图已人工查看，关键文本、编辑和确认入口可见。收口时 `10087` 页面、NestJS `/api/v1/health/live` 与 Python `/internal/health/ready` 均返回 HTTP 200，本地服务保持可用。

计划重生成、处理中关闭与恢复，以及确认响应丢失、刷新失败、重复确认、双标签页竞争，在可重复的 Stub Chrome E2E 中通过；真实 Flash Chrome Smoke 已覆盖计划重生成后关闭恢复。第三方故障注入与跨标签竞争在当前 `10087` 的真实模型组合验收仍需补齐。自动化不变量覆盖确认前不写入、归属/版本复验、重复确认不重复写入或扣分、结果持久化后只重试结算。

## 仍需完成

1. 检查现有 DeepSeek 账号的 HTTP 402 原因并恢复可用额度；不要更换模型、启用 Think 或改变评分规则。
2. 在恢复后重新执行完整 120 Case × 3 轮，并保留此前的 402 记录；每轮 ≥95%，各类三轮合计 ≥90%，性能与预算门槛均须满足。
3. 完成当前 `10087` 的真实模型确认响应丢失、列表刷新失败、刷新/切换会话、双标签页，以及失败计划重生成与旧 Inbox 入口消失场景。使用新合成账号，不接触真实用户数据。
4. 人工复核回复自然度、计划可执行性和相对时间精确值；再把本专项标记为完成。不得据此推进 T25–T27、H3/H4 或生产发布。
