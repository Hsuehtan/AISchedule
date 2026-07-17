# Phase 3 T18–T24 实施接管快照

> 日期：2026-07-17。此文件是不可覆盖快照；后续状态变化请新建 handover，不要改写本文件。

## 快照结论

- 分支：`codex/phase3-agent`
- H2：已通过
- T18–T24：代码、Migration、契约、客户端和文档已实现
- Phase 3：尚未完成；Stub 全量验证和三视口截图已通过，仍待真实 DeepSeek Smoke
- H3：未通过，仍在 T27 后
- T25–T27：未开始
- 生产/公网/真实用户数据：未进入

当前环境没有 `DEEPSEEK_API_KEY`，因此 `pnpm smoke:deepseek` 尚未执行。不要用 Stub、单元测试或历史 H1 截图替代真实 Provider 证据。

## 接管入口

- 当前任务：[`../../tasks/current.md`](../../tasks/current.md)
- 任务清单：[`../../tasks/todo.md`](../../tasks/todo.md)
- 实施计划：[`../../tasks/plan.md`](../../tasks/plan.md)
- PRD：[`../../product_doc/prd.md`](../../product_doc/prd.md) v1.10
- Phase 3 审查包：[`../quality/phase3-agent-review.md`](../quality/phase3-agent-review.md)
- 验收追踪：[`../quality/acceptance-traceability.md`](../quality/acceptance-traceability.md)
- Agent 架构：[`../architecture/agent.md`](../architecture/agent.md)
- 服务边界：[`../decisions/ADR-009-python-agent-service-boundary.md`](../decisions/ADR-009-python-agent-service-boundary.md)
- 日志边界：[`../decisions/ADR-011-defer-agent-log-persistence.md`](../decisions/ADR-011-defer-agent-log-persistence.md)

## 已落地架构

```text
Taro H5
  -> NestJS /api/v1
       -> Users/AiPointsPort + PostgreSQL + pg-boss
       -> Agent 会话 / Run / Proposal / Execution 持久化
       -> 私网 HTTP /internal/v1/agent/execute
            -> Python FastAPI Agent
                 -> DeepSeek MAAS API
```

- NestJS 是客户端唯一入口，独占认证、积分、业务数据、队列、候选查询、确认和最终写入。
- Python Agent 无业务数据库依赖，不接收 Session、用户 ID、业务数据库 ID、余额、成本或 reservation。
- Python 只负责 Prompt、模型调用和结构化结果，不返回计费决定。
- Python MVP 不持久化算法日志；白名单 stdout/stderr 可丢失且不参与业务决策。
- 内部协议唯一真源为 `packages/contracts/internal-agent/v1/openapi.yaml`。
- 每个产品请求最多一次 NestJS → Python execute；同一 execute 最多追加一次结构修复。
- 只有双端校验通过且由 NestJS 持久化的产品结果才能结算；HTTP 2xx 本身不扣分。
- 所有 Agent 写操作必须形成 Proposal 并由用户确认；最终写入通过 Tasks/Projects transaction-scoped Port 完成。

## T18–T24 功能快照

| 任务 | 已实现                                                                          |
| ---- | ------------------------------------------------------------------------------- |
| T18  | YAML v2、能力版本、正式积分账本、懒补足、UoW/Port、管理员积分 CLI               |
| T19  | Python FastAPI、OpenAPI/生成模型、DeepSeek Adapter、Admission/Worker/恢复状态机 |
| T20  | 普通文字对话、异步轮询、Conversation/Message、关闭后恢复                        |
| T21  | 澄清、候选临时引用、确定性推进、服务端 option/版本复验                          |
| T22  | 二阶段 1+2 点计费、计划生成/编辑/重做/过期、Proposal                            |
| T23  | 七类 Action、幂等确认、批量原子执行、批量删除单个 3 秒 Undo                     |
| T24  | 派生 Smart Inbox、无项目整理、额度/服务降级、语音延期                           |

## 关键工件

- 积分配置：`config/product/points.yaml`
- 内部契约：`packages/contracts/internal-agent/v1/openapi.yaml`
- Python 服务：`apps/agent-service/`
- Nest Agent：`apps/server/src/modules/agent/`
- Points：`apps/server/src/modules/users/points/`
- Prisma：`packages/db/prisma/schema.prisma` 与 Phase 3 Migration
- 客户端产品模型：`apps/client/src/agent-product-model.ts`
- 客户端交互：`apps/client/src/components/use-agent-product.tsx`
- Phase 3 E2E：`tests/e2e/phase3-agent.spec.ts`
- 真实 Smoke：`apps/server/test/deepseek.smoke.test.ts`

## 验证状态

| 范围                        | 快照状态                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Node/Python 契约            | 通过；生成工件无 diff                                                                                                       |
| Python Ruff / mypy / pytest | 通过；pytest 87/87                                                                                                          |
| Unit / Integration          | 通过；Unit：Server 126、Client 79、Contracts 51、DB 10、UI 10、Config 5、Python 87；Integration：Server 56、DB 21、Python 1 |
| Typecheck / Lint / Build    | 全部通过                                                                                                                    |
| E2E / Visual / axe          | E2E 18/18；Visual 3/3；Agent 对话 axe 通过                                                                                  |
| DeepSeek Smoke              | 未执行：当前环境缺少 `DEEPSEEK_API_KEY`                                                                                     |

已提交关键切片：`40b9213`、`560d46c`、`e086a1b`、`5d89450`、`f6478cf`、`cb0803c`。T21–T24 收口提交在本快照形成后追加。

## 已生成证据与唯一缺口

- `docs/quality/screenshots/phase3-agent-clarification-320x844.png`：已生成并复核
- `docs/quality/screenshots/phase3-agent-clarification-390x844.png`：已生成并复核
- `docs/quality/screenshots/phase3-agent-clarification-480x844.png`：已生成并复核
- `pnpm smoke:deepseek` 的脱敏通过/失败、实际模型和耗时摘要

## 工作区保护

接管者必须先执行 `git status --short --branch`，并保留以下用户状态：

- `assets/README.md` 是用户已删除文件：不得恢复、不得提交。
- `Electric_Ink_UI_review_keyboard_icons.png` 是用户未跟踪素材：不得修改、不得提交。
- `design/` 是用户未跟踪设计目录：不得修改、不得提交。

不得把 Secret、Prompt、模型响应正文、私人待办或原始音频写入 Git、聊天或日志。

## 稳定命令

使用 Node.js 24、pnpm 11、Python 3.11.15 与 uv：

```bash
pnpm agent:contract:check
pnpm test
pnpm test:integration
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
pnpm test:visual
pnpm format:check
```

真实 Provider 验证只在用户本地安全注入 `DEEPSEEK_API_KEY` 后运行：

```bash
pnpm smoke:deepseek
```

Smoke 只使用合成数据和隔离测试用户；输出不得包含 Prompt、响应正文或 Secret。

## 已知风险

- DeepSeek 真实网络、账号、模型权限、空内容和 JSON 修复路径尚未由 Smoke 验证。
- 受控 Agent Stub 能证明业务链路可重复，不能证明外部 Provider 可用。
- T26 的完整 Evaluation、恢复演练和最终日志验收尚未开始。
- T27 的微信小程序/真机、IME、安全区、最终视觉回归和无障碍收口尚未开始。
- 尚未完成生产网络隔离、Secret Manager、容量、备份恢复或上线审批。

## 唯一下一步

1. 由用户在本地安全注入 `DEEPSEEK_API_KEY`，运行真实普通回复 + 计划生成 Smoke。
2. Smoke 通过后补齐提交列表、脱敏结果和审查结论，暂停等待用户下一步指示。

不得进入 T25–T27，也不得把 T24 审查包误标为 H3 通过。
