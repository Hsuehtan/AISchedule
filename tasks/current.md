# 当前任务

- 任务：T04 建立 PostgreSQL、Prisma Migration 和 Repository 基线
- 状态：进行中（T03 已完成）
- 分支：`codex/t01-foundation`
- 当前门禁：H1（T09 后暂停）
- 最后验证提交：`dac76a1 chore: 建立 pnpm Monorepo 工程骨架`

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

## 验证记录

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过。
- `pnpm test:integration`：通过，服务端健康接口 1 项集成测试。
- `pnpm build`：通过，H5 和服务端均成功构建。

## 当前风险

- 当前机器默认 Node.js 为 26.3.1；项目已固定 Node.js 24，T04 Prisma 迁移前需使用 Node.js 24 执行。
- 仓库原有设计图片仍为用户未提交文件，提交时不得误纳入。
- Figma Production V3 没有变量；Token 必须由代码侧固化。

## 唯一下一步

在 Node.js 24 下建立完整 Prisma Schema、初始 Migration、PostgreSQL 本地环境和 Repository 基线测试。
