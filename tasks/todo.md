# P0 任务清单

> 2026-10-03：Agent 业务/算法拆分专项进行中。切片 1 已完成 TS 业务组件提取；切片 2 已建立 v2 规范、生成模型、独立认证的分页读取接口和 Python 上下文客户端。游标/认证单测 3/3、Python 客户端 5/5、v2 契约 2/2 及生成漂移检查通过；切片 3 的算法迁移及全仓验证进行中。T24 人工审查状态不变。

> 2026-09-27 独立验收发现的 D01–D03 已按用户授权修复并复验；完整 E2E 19/19、无缓存工程门禁 40/40。原始失败记录见[独立验收](../docs/quality/2026-09-27-phase0-3-acceptance.md)，最新结论见[修复复验](../docs/quality/2026-09-27-d01-d03-revalidation.md)。不得据此自动进入 T25。

## 当前验收事项

- [x] 对话 Action 确认卡与计划草稿浮层分离：Run 分类契约、历史/幂等兼容、对话内确认与追问发送前取消、整理单项移除、删除撤销及四视口正式页证据；见[专项复验](../docs/quality/2026-09-30-action-card-plan-separation.md)。T24 人工审查状态不变。
- [x] 移动端 V01：修复计划草稿与 Action 确认区文字层级、任务行宽度和编辑文字换行；证据见[专项复验](../docs/quality/2026-09-30-mobile-v01-revalidation.md)，T24 人工审查状态不变。
- [x] 正式 Agent 对话浮层：固定底部输入与独立滚动消息区、统一候选字体、同会话多轮问答及 409 草稿保留；证据见[对话浮层专项](../docs/quality/2026-09-29-agent-conversation-review.md)，T24 人工审查状态不变。

- [x] 正式产品 UX 动效专项：轻快克制的按压、弹层、折叠、任务与 Agent 状态反馈；不改变静态 UI 和业务逻辑。证据见[动效专项](../docs/quality/2026-09-28-production-motion-review.md)，T24 人工审查状态不变。

- [x] 正式 Agent 文字输入弹层：修复字号、重复边框、textarea 白底/缩放手柄及热区；补齐正式路由三视口回归。
- [x] D01：H1 文本输入真实点击热区与边缘聚焦修复。
- [x] D02：数据库集成夹具改为相对到期时间，DB 21/21。
- [x] D03：H2 日期 E2E 改用受控时钟和真实 Picker 确认，完整浏览器回归 19/19。
- [ ] 人工审查最新复验、原报告的覆盖深度限制及 T24 Phase 3 审查包。

## Phase 0

- [x] T01 冻结 PRD、ADR、API、数据模型和追踪矩阵
- [x] T02 创建 Monorepo、工具链和统一命令
- [x] T03 建立共享 Contract、错误模型、ID 和配置校验
- [x] T04 建立 PostgreSQL、Prisma Migration 和 Repository 基线
- [x] T05 验证 Taro、DeepSeek、pg-boss 和腾讯 ASR 边界

## Phase 1

- [x] T06 Electric Ink Token、App Shell 和基础组件
- [x] T07 页面状态、Bottom Sheet、Dialog 和 Toast
- [x] T08 Production V3 Fixture、主要页面和状态导航
- [x] T09 Figma 对照、响应式、键盘和无障碍基线

## Phase 2

- [x] T10 用户名认证与 Session
- [x] T11 可选手机号和只读资料
- [x] T12 管理员改密 CLI 与审计
- [x] T13 待办创建与列表
- [x] T14 待办编辑、完成和恢复
- [x] T15 软删除和 3 秒撤销
- [x] T16 项目创建、改名、归档和筛选
- [x] T17 时间字段保存/展示、完成分组和空状态

## Phase 3

> T18–T24 的代码、文档、Stub 全量验证、三视口截图和真实 DeepSeek Smoke 已完成；当前停在 T24 等待人工审查。

- [x] T18 Users 积分子域
  - [x] T18.1 配置、能力注册、版本/Hash 和启动校验
  - [x] T18.2 账本、新用户 grant 对账、每日补足和余额不变量
  - [x] T18.3 单条 pending DEBIT 预留/结算/释放、Schema 迁移、硬约束和回收
  - [x] T18.4 管理员调账/历史 CLI、dry-run 和审计
- [x] T19 Python Agent 内部服务、跨语言契约、请求状态机和 Worker
  - [x] T19.1 唯一 OpenAPI 规范、Schema 等价与无 Run/回调/日志 API 负向契约
  - [x] T19.2 FastAPI 骨架、服务认证、边界限制与非持久化结构化 stdout
  - [x] T19.3 Python DeepSeek Adapter、版本化 Prompt/Schema、结构修复与最小运行事件
  - [x] T19.4 Nest Agent 编排与单次 execute dispatch
    - [x] T19.4a Run Migration、resolved 元数据、resultHash 与状态 CAS
    - [x] T19.4b Admission UnitOfWork、AiPointsPort、AgentRuntimePort、事务入队与 Worker
    - [x] T19.4c 截止时间、预留 lease、卡死 Run 回收与故障注入
    - [x] T19.4d 切换唯一活动实现并移除零引用的 Node 旧 Provider/配置
- [x] T20 普通文本对话
- [x] T21 澄清和候选消歧
- [x] T22 计划生成和编辑
- [x] T23 提案确认、幂等和批量原子执行
- [x] T24 Smart Inbox 和额度不足
- [x] Phase 3 最终全量自动化结果录入
- [x] Phase 3 320/390/480px 截图与无障碍结果录入
- [x] 真实 DeepSeek 普通回复 + 计划生成 Smoke
- [ ] T24 Phase 3 审查包人工检查

## Phase 4

- [ ] T25 语音采集、识别和清理
- [ ] T26 Evaluation、运行日志边界和失败恢复
  - [ ] T26.1 AgentEvaluationEvent、resolved 版本与用户行为业务审计
  - [ ] T26.2 日志白名单/脱敏/logger 故障隔离与无持久化依赖验收
  - [ ] T26.3 Provider 故障、Run/结算对账、迟到响应与恢复演练
- [ ] T27 错误状态、视觉回归和无障碍

## Phase 5

- [ ] T28 安全加固
- [ ] T29 部署、备份和 Runbook
- [ ] T30 全量验收和 Release Candidate

## 门禁

- [x] H0 架构冻结
- [x] H1 交互冻结（视觉方向通过；正式跳转留在 Phase 2 修正）
- [x] H2 手工闭环（2026-07-17 人工明确通过，允许开始 T18）
- [ ] H3 Agent 闭环
- [ ] H4 发布批准
