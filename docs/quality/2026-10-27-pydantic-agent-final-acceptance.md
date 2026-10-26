# Pydantic AI Agent 最终功能验收（2026-10-27）

**本专项验收通过。** Runtime v5 完成三轮固定真实 Flash 评测 356/360（98.89%）、全部工程门禁、真实 Smoke 和当前 `10087` 正式 H5 的 20 阶段闭环；用户已明确通过回复自然度与计划可执行性样本审阅。通过指本次用户批准的架构与功能专项，不改变 T24 人工审查、H3/H4 或其他阶段状态。未进入 T25–T27，未更新公网或生产。

## 最终实现与修复

- 默认 v1/v2 execute 进入 Pydantic AI 2.61.0 Runtime，统一 `deepseek-v4-flash`、Think 关闭、SDK 自动重试为零。五类结果、七类 Action 和能力计费保持；Python 只读上下文、生成提案，NestJS 复验并在用户确认后原子写入。
- 三个只读工具按 Run 隔离；初始历史、分页和累计上下文预算由 Python 管理。支持修改项目归属、多字段整理及逐字段展示；自动整理只补缺失值，最多 20 项，移除建议后不修改该任务。
- 必要条件缺失生成澄清卡，项目筛选不构成修改授权。可信日历计算保留用户 IANA 时区，覆盖未来 DST 偏移与 UTC 输出。
- 实际模型边界限定最多四次请求、三次常规响应、全 Run 一次结构/引用修复。第三次常规请求及修复不发送读取工具定义；工具串行执行，最多六次，非法参数不进入额外模型重试。
- 空/空白/仅 Thinking 响应、429/5xx、上下文失败和超时明确结束，不误触发结构修复。`repairAttempts` 包括 Schema 修复。单产品请求最多一次派发，持久化结果之后只重试结算。
- 所有计数与依赖均为本 Run 内存状态；不增加数据库、公开接口、持久化 Trace、Logfire 上传或第三方连接器。

生产 Runtime 冻结于 `d25411f`，本次最终评测及浏览器验收均为 `pydantic-agent-v5`；`71615a3` 仅增加测试/验收脚本及实际工具计数，未变更生产 Runtime。契约仍以 v2 OpenAPI 为真源，v1 保留兼容。

## 工程门禁

| 检查 | 最终结果 |
| --- | --- |
| `pnpm agent:contract:check` | v1/v2 生成工件通过 |
| `pnpm test` | 12/12 workspace 任务；Python 153、Server 127，其他包通过 |
| `pnpm test:integration` | 12/12 workspace 任务；Server 65、DB 21、Python 1，其他包通过 |
| `pnpm test:e2e` | 正式 H5 Chrome 完整重跑 43/43；受控 Stub，独立于真实模型分数 |
| `pnpm test:visual` | 3/3 既有视觉基线；不以 H1 原型替代正式产品证明 |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | 分别 8/8、12/12、8/8 |
| `pnpm agent:eval:offline` | 50/50；模型请求禁止 |
| `pnpm smoke:deepseek` | 最终 Runtime 真实 Flash 3/3，实际经过 Python Runtime |
| 隔离旧版本兼容演练 | 24/24 契约与 FastAPI 受控测试，真实模型禁止 |
| 正式产品响应式检查 | 12 项；Action、计划、整理分别在 320/390/480px 与 390×560px 检查 |

[门禁元数据](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/engineering-gates.json)、[真实 Smoke](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/deepseek-smoke-summary.json)。不受影响的 workspace 任务可使用缓存；完整 E2E、真实 Smoke、真实评测及当前页面验收均为本轮实际执行。受限 shell 的缓存/Docker 权限问题在授权的本机隔离测试环境解决，没有改变产品限流。

## 固定真实 Flash 评测

同一 120 个合成 Case、固定时钟 `2026-10-27T10:00:00+08:00`、`Asia/Shanghai`、评分版本 `business-v2-calendar`、默认并发 2。旧流程统一 Flash/关闭 Think 跑一轮，新流程三轮；不把基线与新实现轮数不同隐去。基线不具备多字段整理与修改项目的 14 个场景，公共能力分母 106，新增能力另计。多轮场景内部调用单独计数。

| 新实现 | 语义通过 | p95（失败计入） | 模型 / 工具尝试 / 上下文读取 |
| --- | ---: | ---: | ---: |
| 第 1 轮 | 119/120（99.17%） | 6.76 秒 | 262 / 127 / 120 |
| 第 2 轮 | 118/120（98.33%） | 5.39 秒 | 258 / 126 / 117 |
| 第 3 轮 | 119/120（99.17%） | 6.43 秒 | 263 / 130 / 121 |
| 合计 | 356/360（98.89%） | 6.48 秒 | 783 / 383 / 358 |

| 对比维度 | 旧统一 Flash 一轮 | 新 Runtime 三轮 |
| --- | ---: | ---: |
| 共同能力 | 98/106（92.45%） | 314/318（98.74%） |
| 共同能力 p95 | 3.10 秒 | 6.61 秒 |
| 增量能力 | 不计分 | 42/42（100.00%） |

普通请求 p95 **3.76 秒**；计划请求 p95 **8.82 秒**。实际每 Run 最大模型请求 **4**、工具尝试 **3**，符合 4/6 次上限。`toolCalls` 包含重复、缓存及已读完页面的工具尝试，`contextReadCalls` 只表示底层上下文访问，二者不能互换。输出工具不计入只读工具次数。

| 业务类别 | 三轮合计 |
| --- | ---: |
| REPLY | 24/24（100.00%） |
| CLARIFICATION | 30/30（100.00%） |
| CANDIDATES | 30/30（100.00%） |
| PLAN | 48/48（100.00%） |
| CREATE_TASK | 24/24（100.00%） |
| CREATE_PROJECT_TASKS | 24/24（100.00%） |
| ORGANIZE_TASKS | 30/30（100.00%） |
| UPDATE_TASK | 42/42（100.00%） |
| COMPLETE_TASK | 18/18（100.00%） |
| RESTORE_TASK | 18/18（100.00%） |
| DELETE_TASK | 18/18（100.00%） |
| MULTITURN | 50/54（92.59%） |

全部比较门槛通过：每轮 ≥95%、每类 ≥90%、普通/计划 p95 ≤30/60 秒、模型/工具 ≤4/6 次，且无 Provider/网络/上下文失败造成的证据缺口。额外上海、UTC、洛杉矶三时区各 5/5，通过今天、明天、下周及未来 DST 等日期校验；不并入 360 次正式评分。

仍有以下失败，原样计分与保留，没有静默重跑覆盖：

- 第 1 轮 `MULTITURN-14`：`SEMANTIC`；3 次模型、1 次工具尝试。
- 第 2 轮 `MULTITURN-08`：`EXECUTION_BUDGET_EXCEEDED`；3 次模型、3 次工具尝试。
- 第 2 轮 `MULTITURN-14`：`SEMANTIC`；3 次模型、1 次工具尝试。
- 第 3 轮 `MULTITURN-14`：`SEMANTIC`；4 次模型、2 次工具尝试。

`MULTITURN-14` 是“把它的说明改短一些”的不必要澄清，属于语义退化而非错误执行。`MULTITURN-08` 在无法继续读取时受预算保护明确失败，没有越过限制、伪造成功或卡在处理中。此类受控失败计入质量分母，属于当前允许失败率内的剩余限制；不宣称语义正确率 100%。

证据：[基线](agent-evals/flash-baseline-v2-fixed-clock.json)、[最终三轮](agent-evals/pydantic-agent-v5-final-3-rounds.json)、[自动比较门槛](agent-evals/pydantic-agent-v5-comparison.json)、[上海](agent-evals/pydantic-v5-time-shanghai.json)/[UTC](agent-evals/pydantic-v5-time-utc.json)/[洛杉矶](agent-evals/pydantic-v5-time-los-angeles.json)。

## 当前 10087 正式页面验收

使用独立合成账号 `pydantic_accept_5aa226dc1eb1`、真实 Flash、本项目 H5/NestJS/Python 和原本地数据库；未使用真实用户数据。页面闭环与数据库/提案/Run/积分审计一并断言。

| 要求的闭环 | 本轮实际结果 |
| --- | --- |
| 自然语言创建与上一轮指代修改 | 卡片确认前不写入，确认后精确对象及字段一致 |
| 同名候选与澄清回答 | 指定项目下准确目标改变；澄清后继续生成确认卡 |
| 创建项目及批量任务 | 确认后项目与任务匹配；失败无部分写入 |
| 回复转计划、编辑保存确认 | 回复、草稿和已执行状态区分；编辑内容实际落库 |
| 失败计划与重生成 | 构造项目名冲突，确认失败无写入；重新生成后关闭、刷新、进入并确认成功 |
| 多字段整理与移除一项 | 多类缺失字段补齐；移除项及无关任务完全不变 |
| 完成、恢复、删除与撤销 | 状态及对象核对，删除经过既有三秒撤销机制 |
| 确认成功但响应丢失 | 查询恢复成功，安全重试无重复执行 |
| 成功后列表刷新失败 | 卡片保留已执行状态 |
| 刷新、切换会话和项目 | 历史正确恢复，旧请求不覆盖新浮层 |
| Action 与 Plan 双标签页竞争 | 均只执行一次；重复确认无额外写入或扣分 |
| 旧失败提案被替代 | 不再占 Inbox，历史 FAILED 执行记录仍可读取 |

[20 阶段与 12 视口断言](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/current-10087-result.json)核对 **19 个 admission = 19 个成功 Run = 19 笔成功 DEBIT**，所有模型为 Flash、所有版本为 v5、所有预留已结算。合计扣 22 点；新用户 grant 20、现有管理员服务增加合成夹具 20，最终账本与账户均为 18 点，Pending 为零，见[账本核对](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/balance-reconciliation.json)。没有修改产品积分或限流规则。

已失败执行后来被替代时，重放确认按现有契约返回 HTTP 200 与原 FAILED 回执；脚本核对同一执行记录及零写入。没有执行记录的失效提案拒绝确认。HTTP 200 本身不能等同于执行成功。

Action、计划、整理的触控目标均至少 44px，三宽度无横向溢出，缩小至 390×560 后滚动可达关键控件。此处为 Chrome 压缩视口验证，不冒充真机软键盘或微信容器验证。正式页面截图包括 [Action](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/action-before-confirm-390.png)、[计划](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/plan-before-confirm-390.png)、[多字段整理](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/organize-before-confirm-390.png)、[恢复后的计划](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/regenerated-plan-recovered-390.png)。

人工审阅已完成：用户对[普通回复](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/reply-before-plan-390.png)和[计划草稿](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/plan-before-confirm-390.png)明确回复“通过，内容自然且可执行”。仅代表这两个主观样本，不以此声称所有 120 Case 均经人工语义审阅。见[评审记录](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/manual-review.json)。

本项目当前 H5 `10087`、公开 API 健康、Python readiness 均 200；H5 对私有 context 请求返回 404，本地数据库与现有数据保留，见[服务核对](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/local-services.json)。只更新了本项目本地服务。

## 安全、恢复与兼容

确定性测试覆盖字段投影、跨用户/Run/会话隔离、来源消息截止点、未结算消息不可见、稳定引用、分页、超限、并发和伪造引用；覆盖五类输出、七类 Action、确认前零写入、归属与版本复验、批量原子性、幂等积分、单次派发和持久化后仅结算。工具模型输入不接收用户 ID、真实业务 ID、任意 URL 或回调地址。Prompt 注入作为不可信数据处理，不授予写入权限。

前端故障矩阵通过 43 项受控产品 E2E，包括保存失败保留编辑、未保存禁止确认、过期预检/执行中失效、轮询失败、刷新、页面可见性切换、迟到响应及跨标签操作；真实页面覆盖见上表。v1/v2 生成契约、旧快照/草稿、QUEUED/RUNNING/RESULT_PERSISTED 恢复保持兼容，没有批量改写历史正文。

[隔离回退演练](agent-pydantic-acceptance/final-2026-10-27/pydantic_accept_5aa226dc1eb1/rollback-compatibility.json)针对前一完整版本 `99953fb` 与最终生产源码 `d25411f`，先验证 TS 业务、契约、数据库与锁定依赖完全相同，再解压并断言实际加载旧 Python 源码，禁止真实模型并移除数据库凭证，24 项契约/FastAPI 测试通过。它验证该前版本兼容，不表示已在本地运行服务上执行回退，也不宣称升级前旧推理器具备新增能力。需要回退时按运行说明切换完整代码和锁文件、整体重启服务；不得在单请求失败后重新派发旧实现。既有 Run 按状态恢复，RESULT_PERSISTED 仅结算，不改写或删除业务数据。

## 历史证据与剩余范围

HTTP 402 中断的[原专项报告](2026-10-27-pydantic-agent-acceptance.md)保留历史事实。恢复后的开发轮次、日期夹具校准、预算边界失败和旧调用统计见[开发评测索引](agent-evals/development-2026-10-27/README.md)；合成积分不足、脚本 HTTP 断言及 admission 观察器错误见[页面证据索引](agent-pydantic-acceptance/README.md)。这些失败均未替换最终轮次中的失败记录。

报告仅保存合成 Case 标识、版本、评分、失败分类、时延与计数；不保存 Secret、生产 Prompt、Provider 原始响应或算法 Trace。合成产品截图仅用于本地验收。保护未跟踪 `apps/miniprogram/`，未将其提交。

本轮没有接入微信/飞书/MCP、真机小程序、语音或远程观测，不对此类能力给出通过结论。确定性门禁、真实模型阈值、核心浏览器闭环及人工样本均已完成；零错用户、零错误执行对象、零未确认写入、零重复扣分，未观察到无限循环、超预算继续调用或不可恢复处理中。剩余低频语义澄清/受控失败如上披露，本专项阻断项已关闭。
