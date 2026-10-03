# ADR-012：Agent 业务持久化与 Python 上下文策略拆分

- 状态：已接受（用户明确批准）；实施停留在 T24
- 日期：2026-10-03
- 部分取代：ADR-009 中由 NestJS 固定选择模型上下文和仅有 v1 execute 的约定
- 不改变：ADR-011 日志范围、唯一公开业务 API、积分事务、确认执行、单次派发和结算恢复

## 决策

`PrismaAgentPersistence` 保留 Admission、Run、Product 三个 Port 入口，委托同目录下 Run Store、Conversation Store、Proposal Store、Context Reader 和 Result Materializer；共享锁、幂等、序列化、错误转换放在内部 support。所有组件使用平台传入的同一个不透明 TransactionScope，不自开嵌套事务。网络调用不持有数据库事务。

Python 负责历史窗口、候选数量、上下文组织、旧草稿注入及各类产品请求的推理指令。初始 `ContextPolicy` 为最近 20 条消息、12 KiB 历史正文、50 个任务、30 个项目；整理初始读取 20 个任务。调整 Python 参数即可改变读取数量，无须修改 TS。单次整理提案最多 20 项仍是 TS/契约校验的产品规则。

新协议真源为 `packages/contracts/internal-agent/v2/openapi.yaml`，生成 Zod/Pydantic，并与 FastAPI execute 和 Context Pydantic Schema 完整规范化比较。v1 规范及 execute 路由保留兼容。

```text
NestJS 原子 admission → Run + 积分预留 + pg-boss
  → Python /internal/v2/agent/execute（仅运行描述）
    → NestJS /internal/v2/agent/context/read（独立服务凭证）
    ← 安全来源、历史消息、候选快照与不透明续页游标
    → Python ContextPolicy → Prompt → Provider（最多一次结构修复）
  ← 结构化结果
NestJS 校验本 Run 引用 → 结果持久化 → 积分幂等结算
用户确认 → 业务写入
```

## 数据与安全边界

- Python 从固定配置 `AGENT_CONTEXT_URL` 读取业务上下文，execute 不接受回调 URL、用户 ID、业务 ID、Session、积分或数据库凭证。
- 独立 `AGENT_CONTEXT_SERVICE_TOKEN` 使用至少 256 位规范 base64url，不能与 execute 凭证相同。无完整配置时公开智能 admission 不可用；手工功能与恢复仍工作。
- Context Reader 从 Run 推导用户、会话、来源消息截止点和整理项目范围，复用已结算消息可见性规则；只输出白名单字段和旧草稿安全快照。
- 消息以从新到旧的顺序分页，Python 重排为模型的时间顺序。TS 不累计裁剪历史或候选。每页最多 128 行且 JSON 约 250 KiB，是 HTTP/数据库单页保护；返回续页游标供 Python 决定继续读取，非算法总量上限。
- 游标采用 AES-256-GCM，绑定 Run 与资源；查询条件来自不可由 Python 改写的 Run 元数据。游标不携带可读数据库 ID。
- 候选读取在 Run 行锁内复用现有引用或保存首次安全快照，沿用候选表和既有有效期。只写运行元数据，不写任务、项目、提案或积分。结果接收再校验引用归属、类型、版本、有效期及 Action 与操作的一致性。
- 上下文读取和 Provider 共用 execute 截止时间。读取失败/超时分别为 `CONTEXT_UNAVAILABLE` / `CONTEXT_TIMEOUT`，终止 execute，不自动重试或重派；公开端继续显示原有服务不可用提示。
- Python 日志仍只输出白名单元数据；上下文、原始响应、Prompt 和凭证不写日志，不新增数据库、日志持久化或队列。

## 存量兼容

- QUEUED 且未派发：认领事务升级至 2.0，`extra.originalContractVersion` 保存原版本，保留积分预留、来源及候选映射。
- RUNNING：不重派、不改版本；原有结果接收或超时恢复继续运行。
- RESULT_PERSISTED / SETTLING：只重试结算；历史消息、澄清、提案继续可读、可编辑和确认。
- 新来源用 `extra.contextSource/contextScope` 存安全结构；旧计划通过 `planSource`、旧来源正文及白名单 Schema 适配，不批量改写历史正文。旧整理范围使用原候选映射。

本轮不增加语义检索、摘要记忆、自主 Agent 循环，不进入 T25–T27，不部署生产或开放公网。
