# P0 任务清单

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

- [ ] T18 Users 积分子域
  - [ ] T18.1 配置、能力注册、版本/Hash 和启动校验
  - [ ] T18.2 账本、新用户 grant 对账、每日补足和余额不变量
  - [ ] T18.3 单条 pending DEBIT 预留/结算/释放、Schema 迁移、硬约束和回收
  - [ ] T18.4 管理员调账/历史 CLI、dry-run 和审计
- [ ] T19 Python Agent 内部服务、跨语言契约、请求状态机和 Worker
  - [ ] T19.1 唯一 OpenAPI 规范、Trace Context、Schema 等价与无 Run/回调 API 负向契约
  - [ ] T19.2 FastAPI 骨架、服务认证、边界限制与非阻塞 AlgorithmTelemetryPort
  - [ ] T19.3 Python DeepSeek Adapter、版本化 Prompt/Schema、结构修复与算法 spans/metrics
  - [ ] T19.4 Nest Agent 编排与单次 execute dispatch
    - [ ] T19.4a Run Migration、resolved 元数据、resultHash 与状态 CAS
    - [ ] T19.4b Admission UnitOfWork、AiPointsPort、AgentRuntimePort、事务入队与 Worker
    - [ ] T19.4c 截止时间、预留 lease、卡死 Run 回收与故障注入
    - [ ] T19.4d 切换唯一活动实现并移除零引用的 Node 旧 Provider/配置
- [ ] T20 普通文本对话
- [ ] T21 澄清和候选消歧
- [ ] T22 计划生成和编辑
- [ ] T23 提案确认、幂等和批量原子执行
- [ ] T24 Smart Inbox 和额度不足

## Phase 4

- [ ] T25 语音采集、识别和清理
- [ ] T26 Evaluation、独立可观测性数据面和失败恢复
  - [ ] T26.1 Collector/遥测后端、Trace、RED 指标、仪表盘与丢失告警
  - [ ] T26.2 脱敏、只写凭证、访问审计、保留/删除和样本默认关闭
  - [ ] T26.3 Evaluation 离线关联、遥测故障矩阵、Run 对账与恢复演练
- [ ] T27 错误状态、视觉回归和无障碍

## Phase 5

- [ ] T28 安全加固
- [ ] T29 部署、备份和 Runbook
- [ ] T30 全量验收和 Release Candidate

## 门禁

- [x] H0 架构冻结
- [x] H1 交互冻结（视觉方向通过；正式跳转留在 Phase 2 修正）
- [ ] H2 手工闭环（T10–T17、首轮六项反馈及项目栏隐藏滚动条/名称省略/点击静止色反馈已修复；待人工明确通过）
- [ ] H3 Agent 闭环
- [ ] H4 发布批准
