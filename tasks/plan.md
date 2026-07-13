# AI 项目待办 P0 实施计划

- 状态：H0 已批准，实施中
- 产品真源：`product_doc/prd.md` v1.3
- UI 真源：Figma Production V3 `229:2`
- 分支前缀：`codex/`

## 交付方式

```text
契约先行 -> 风险验证 -> 前端交互壳 -> 纵向切片 -> 测试/文档/提交 -> 人类门禁
```

每个切片按 Schema/Contract -> API/Service -> UI -> Test -> Docs 顺序交付。任务控制为 XS/S/M，超过一次专注会话或约 5 个主要文件时继续拆分。

## 固定架构

- Taro 4 + React 18 + TypeScript 客户端。
- NestJS 11 + Fastify 模块化单体。
- PostgreSQL 16 + Prisma 7 + pg-boss。
- Users、Tasks、Projects、Agent 四个业务模块。
- DeepSeek AgentProvider、腾讯云 SpeechProvider。
- YAML 积分配置，管理员 CLI 改密和调账。
- Docker/Caddy/托管 PostgreSQL，云厂商中立。

详细边界见 `docs/architecture/` 和 `docs/decisions/`。

## Phase 0：基础与风险验证

- T01：冻结 PRD、ADR、API、数据模型、文档入口和追踪矩阵。
- T02：创建 pnpm Monorepo、工具链和统一命令。
- T03：建立共享 Contract、错误模型、ID 类型和配置校验。
- T04：建立 PostgreSQL、Prisma Migration 和 Repository 基线。
- T05：验证 Taro H5、DeepSeek JSON、pg-boss 和腾讯 ASR 接口边界。

验收：工程可安装、构建、测试；配置缺失时失败明确；所有风险验证有可复现记录。

## Phase 1：前端交互壳

- T06：实现 Electric Ink Token、App Shell 和基础组件。
- T07：实现页面状态路由、Bottom Sheet、Dialog、Toast。
- T08：实现 Production V3 Fixture、主要页面和状态导航。
- T09：完成 Figma 对照、响应式、键盘和无障碍基线。

验收：可运行 H5 覆盖 H1 状态；390 × 844 对照，320/480px 无溢出；不伪装真实后端成功。

## Phase 2：真实手工闭环

- T10：用户名注册、登录、退出和 Session。
- T11：昵称、可选手机号和个人资料。
- T12：管理员改密 CLI 与审计。
- T13：待办创建与列表纵向切片。
- T14：待办编辑、完成和恢复。
- T15：软删除和 3 秒撤销。
- T16：项目创建、改名、归档和筛选。
- T17：时间字段、站内提醒、完成分组和空状态。

验收：无 Agent 时产品可用；跨用户隔离、版本冲突、撤销边界和持久化通过。

## Phase 3：积分与 Agent

- T18：积分 YAML、账本、赠送、预留/结算和管理员调账。
- T19：AgentProvider、请求状态机和 pg-boss Worker。
- T20：普通文本对话。
- T21：澄清与候选消歧。
- T22：计划生成和可编辑计划。
- T23：提案确认、幂等和批量原子执行。
- T24：Smart Inbox 和额度不足状态。

验收：确认是唯一 Agent 写入网关；失败不扣分，结果结算后开放，重试不重复执行。

## Phase 4：语音与质量

- T25：语音采集、腾讯 ASR、转写确认和临时音频清理。
- T26：Agent Evaluation、结构化日志、指标和失败恢复。
- T27：错误状态、视觉回归和无障碍收口。

## Phase 5：安全与发布

- T28：权限隔离、限流、CSRF、Session 和日志脱敏。
- T29：Docker、部署、备份恢复和 Runbook。
- T30：全量验收、接管演练和 Release Candidate。

## 人类门禁

| 门禁 | 时机 | 审查 |
|---|---|---|
| H0 | T01 前 | 架构、账户、积分、模块和计划；已批准 |
| H1 | T09 后 | 页面导航、视觉方向、交互和文案 |
| H2 | T17 后 | 登录、待办、项目、时间和撤销 |
| H3 | T27 后 | Agent、确认、积分、语音和 Smart Inbox |
| H4 | T30 后 | 安全、部署、备份、CLI、文档和生产批准 |

到达门禁必须暂停。不可逆数据操作、新付费服务、安全降级、明显偏离 Figma 或生产部署也必须提前暂停。

## 每任务完成定义

- 验收条件满足，相关测试先失败后通过。
- lint、typecheck、build 和受影响测试通过。
- API/Schema/配置/UI 行为文档同步。
- `tasks/todo.md`、`tasks/current.md` 更新。
- 原子 Conventional Commit，无 Secret 或未说明改动。
