# 本地开发

## 前置条件

- Node.js 24（推荐 `mise install` 后在仓库目录自动激活）
- pnpm 11
- Docker Desktop 或 OrbStack

## 初始化

```bash
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm db:generate
pnpm db:migrate:deploy
```

`.env.example` 只包含本地开发默认值和空 Provider 占位，真实 Secret 不进入 Git。

## 日常命令

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

数据库集成测试使用独立的 PostgreSQL 16 Testcontainer，自动执行正式 Migration，不读取或修改本地开发库。

## 修改 Schema

1. 修改 `packages/db/prisma/schema.prisma`。
2. 执行 `pnpm db:validate` 和 `pnpm db:generate`。
3. 使用 Prisma Migrate 生成新的不可覆盖 Migration；禁止修改已发布 Migration。
4. 检查 SQL 中的锁表、数据回填和回滚风险。
5. 运行 `pnpm test:integration`。

初始 Migration 中有 Prisma Schema 无法表达的 CHECK；后续差异迁移不得误删这些约束。
