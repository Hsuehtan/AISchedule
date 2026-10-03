# Agent 业务/算法职责拆分复验

日期：2026-10-03。范围：用户批准的 TS 业务组件拆分、v2 私有上下文读取、Python 上下文策略迁移。阶段仍为 T24，未进入 T25–T27。

## 交付边界

- `PrismaAgentPersistence` 保留三个原有 Port，委托 Run Store、Conversation Store、Proposal Store、Context Reader、Result Materializer；共享事务锁、幂等、序列化与错误转换留在内部 support。
- Python `context_client.py` 在同一次 execute 内按需读取；`context.py` 管理消息、候选及 UTF-8 字节预算。旧草稿注入最新模型历史位置并纳入同一 Python 预算，不在 Prompt 中重复绕过预算。
- 初始策略为最近 20 条消息、12 KiB、50 个任务、30 个项目；整理初始读取 20 个任务。TS 不再预选候选或裁剪模型历史；一次整理提案最多 20 项仍为产品规则。
- v2 双端模型生成自唯一 OpenAPI；公开 `/api/v1`、五类结果、七类 Action、积分事务和用户确认流程保持兼容。
- 新 Run 使用 v2；未派发旧 Run 在认领事务中升级并保留原版本。已派发旧 Run 不重派，已持久化结果只结算；旧草稿不批量改写。

## 验证结果

| 验证                                                           | 结果                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| v1/v2 契约生成漂移检查                                         | 通过；v1 生成物未变                                                              |
| FastAPI v1/v2 execute 与 v2 context Pydantic Schema 规范化等价 | 通过                                                                             |
| 全仓 lint / typecheck / build / test 联合门禁                  | 32/32 任务通过（最终轮 28 项命中未变代码缓存）                                   |
| 根目录 Playwright/E2E 文件 ESLint                              | 通过                                                                             |
| 单测                                                           | Server 126、Python 101、Contracts 54、Client 83、DB 10、Config 5、UI 10 全部通过 |
| 全仓集成                                                       | 12/12 任务通过；该轮 Server 57、DB 21 项通过                                     |
| 最后补充的 Run/存量兼容集成                                    | Runtime 18 + Recovery 5，共 23/23 通过                                           |
| 正式 Agent 输入 + Phase 3 浏览器回归                           | 5/5 通过，Chrome、隔离数据库和 v2 上下文回调 Stub                                |
| 真实 DeepSeek Smoke                                            | **补验通过 1/1：真实 Flash/Pro 回复与计划、结果持久化及积分结算闭环**            |

工程命令均使用仓库规定的 Node.js 24 / pnpm 11。最终联合门禁使用 `pnpm exec turbo run lint typecheck build test`，并独立执行根目录 E2E ESLint、`pnpm agent:contract:check`、`pnpm test:integration` 和定向 Playwright。集成使用临时 PostgreSQL 测试容器。

## 关键证据

- 仅调 Python `ContextPolicy` 即可选择 25 条历史、60 个任务、35 个项目；默认 UTF-8 历史预算对中文和 Emoji 生效，保留完整消息，过大的最新消息由 Python 拒绝。
- 大于 12 KiB 的旧草稿在 Python 默认策略下拒绝；只调 Python 字节预算即可完整注入。TS 不按算法字节数阻止来源持久化或读取。
- 私有 HTTP 接口实际返回 140 个任务的 128 + 12 分页、35 个项目以及 26 条超过 12 KiB 的历史。并发相同读取只保存 140 条任务引用；重复读取保留首次快照。
- 错误凭证、调用方业务 ID、跨 Run/跨资源/篡改游标、过期 Run 被拒绝。公开代理路径 `/api/v1/internal/...` 返回 404。
- 历史截止于来源消息，后续并发输入和未结算 Assistant 消息不进入本次上下文；候选不包含真实业务 ID、其他用户对象或任务详细描述。
- 任务版本变更后接收结果时复验失败；伪造候选引用无法持久化。整理请求不能返回其他 Action 类型。
- 旧 QUEUED Run 升级为 2.0 并保留预留；旧 RUNNING 不再推理；旧 RESULT_PERSISTED/SETTLING 恢复只结算。旧草稿通过白名单适配且原消息正文未改写，夹带非规范业务字段的快照被拒绝。
- Python 上下文读取失败不重试；Provider 仍最多一次结构修复；v2 使用原 execute 截止时间，结果持久化后只允许结算恢复。
- 确定性澄清回答、计划重生成/编辑/确认、Action 追问与删除撤销等既有业务回归通过。

## 运行配置与限制

新增独立 `AGENT_CONTEXT_SERVICE_TOKEN`；Python 配置固定 `AGENT_CONTEXT_URL`。两个服务方向的凭证不可相同，Python 不接收数据库、Session 或积分凭证。详见 [ADR-012](../decisions/ADR-012-agent-context-ownership.md) 与[本地运行说明](../runbooks/local-development.md)。

首次 Smoke 进程未继承 `DEEPSEEK_API_KEY`，在预检阶段停止；用户指出凭证已配置后，确认根目录 `.env` 中已有配置，原因是 Smoke 命令不会自动加载 `.env`。补验仅将所需配置注入测试进程，未输出、复制到临时文件或提交密钥。真实 Smoke 1/1 通过，模型为 `deepseek-v4-flash` / `deepseek-v4-pro`，核心流程 36,561 ms，测试总耗时 42.60 秒；验证普通回复、计划生成、结果持久化及 1 点/2 点结算。本结论来自本次 v2 实测，不沿用历史 Smoke。未部署生产、未开放公网、未使用真实用户数据。原未跟踪的移动端审查材料与 `visual-sweep.spec.ts` 保留且不纳入提交；本次 E2E 自动改写的已有截图已恢复，静态 UI 不属于本轮变更。
