# 当前任务

- 任务：T05 验证 Taro、DeepSeek、pg-boss 和腾讯 ASR 边界
- 状态：进行中（T04 已完成）
- 分支：`codex/t01-foundation`
- 当前门禁：H1（T09 后暂停）
- 最后验证提交：`4445949 feat: 建立共享业务契约与配置校验`

## 已完成

- H0 决策写入 PRD v1.3。
- 建立根 README、AGENTS、资产索引。
- 建立架构、API、数据模型、安全、ADR 和积分配置基线。
- 建立 T01-T30 任务与 H0-H4 门禁。
- 完成 T01 文档一致性检查。
- 建立 pnpm Workspace、Turbo、TypeScript、ESLint 和 Prettier 基线。
- 建立 Taro H5、NestJS Fastify 和四个共享包的可构建骨架。
- 以集成测试驱动实现 `/api/v1/health/live` 健康接口。
- 固定 Node.js 24 目标版本，并将 Vitest 固定到与 Taro Vite 4 兼容的 1.6.1。
- 建立用户名/昵称/密码/手机号、品牌 ID 和统一 API 错误结构。
- 建立 Task、Project、Agent 状态和 Action Mutation 共享契约。
- 建立严格的积分 YAML Schema、解析与 SHA-256 指纹。
- 建立 18 张业务表、17 个枚举、条件唯一索引、组合租户外键和 CHECK 约束。
- 建立 Prisma 7 `prisma-client`、PostgreSQL Driver Adapter 与初始 Migration。
- 建立 Project/Task Repository 基线和本地 Docker Compose PostgreSQL。
- 使用 Testcontainers 在空 PostgreSQL 16 上验证 Migration、活跃项目重名复用、跨用户外键和非负积分约束。

## 验证记录

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过。
- `pnpm test:integration`：通过，服务端健康接口 1 项集成测试。
- `pnpm build`：通过，H5 和服务端均成功构建。
- `mise x node@24 -- corepack pnpm test:integration`：通过，17 项契约/配置/健康测试及 2 项真实数据库测试。
- `mise x node@24 -- corepack pnpm build`：通过。

## 当前风险

- 当前机器默认 Node.js 为 26.3.1；已安装 Node.js 24.18.0，质量命令使用 `mise x node@24 -- corepack pnpm ...`。
- 仓库原有设计图片仍为用户未提交文件，提交时不得误纳入。
- Figma Production V3 没有变量；Token 必须由代码侧固化。

## 唯一下一步

用本地 Stub/Mock 验证 Taro H5、DeepSeek JSON、pg-boss 作业持久化和腾讯 ASR 适配器边界，不调用付费 Provider。
