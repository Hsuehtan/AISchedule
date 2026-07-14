# 本地开发

## 前置条件

- Node.js 24（推荐 `mise install` 后在仓库目录自动激活）
- pnpm 11
- Docker Desktop 或 OrbStack

## 初始化

```bash
pnpm install
docker compose -f compose.yaml up -d postgres
cp .env.example .env
pnpm db:generate
pnpm db:migrate:deploy
```

`compose.yaml` 只提供本地 PostgreSQL 16 开发依赖，不是 T29 的部署资产。也可以不使用容器，但必须把 `.env` 中的 `DATABASE_URL` 指向由开发者自行提供的 PostgreSQL 16 实例。

`.env.example` 只包含本地开发默认值和空 Provider 占位，真实 Secret 不进入 Git。H2 不需要 DeepSeek 或腾讯 ASR Secret。

## 日常命令

```bash
set -a
source ./.env
set +a
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm build
```

`pnpm dev` 会通过 Turbo 同时启动后端 `http://127.0.0.1:3000` 和 H5 `http://127.0.0.1:10086`。Turbo 的开发任务显式透传服务端运行环境变量；H5 的 `/api` 请求由 Taro 开发服务器代理到后端。修改 `.env` 后必须停止并重新运行上述命令。

数据库集成测试使用独立的 PostgreSQL 16 Testcontainer，自动执行正式 Migration，不读取或修改本地开发库。

默认 Node.js 不是 24 时，使用：

```bash
mise exec -- corepack pnpm <command>
```

`pnpm test:e2e` 同样使用隔离 Testcontainer，并启动真实 NestJS API、构建后的 H5 和 Chrome；它不要求先启动本地 `postgres` 服务。

停止本地数据库：

```bash
docker compose -f compose.yaml stop postgres
```

不要在日常清理中执行 `down -v`；它会删除本地开发数据卷。确需重置未发布开发库时，先依据数据库迁移 Runbook 明确确认数据可丢弃。

## 修改 Schema

1. 修改 `packages/db/prisma/schema.prisma`。
2. 执行 `pnpm db:validate` 和 `pnpm db:generate`。
3. 使用 Prisma Migrate 生成新的不可覆盖 Migration；禁止修改已发布 Migration。
4. 检查 SQL 中的锁表、数据回填和回滚风险。
5. 运行 `pnpm test:integration`。

初始 Migration 中有 Prisma Schema 无法表达的 CHECK；后续差异迁移不得误删这些约束。
