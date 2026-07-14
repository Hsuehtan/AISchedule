# 数据库迁移

## 原则

- Migration 文件提交后不可覆盖或重排。
- 生产只执行 `pnpm db:migrate:deploy`，不得执行 `migrate dev` 或 `db push`。
- 结构收缩遵循 expand -> backfill -> switch reads -> contract，并跨至少两个发布完成。
- 涉及删除、类型收缩或大表重写时触发人工强制暂停。

## 发布检查

1. 在空 PostgreSQL 16 实例执行全部 Migration。
2. 在生产数据快照的脱敏副本演练并记录耗时。
3. 确认备份与恢复点。
4. 先发布兼容旧结构的应用，再执行扩展迁移。
5. 验证健康检查、关键查询和账实一致性。

## Phase 2 Undo Migration

`20260714120000_phase2_manual_loop` 把通用 Undo 收敛为可审计的 `TASK_DELETE`。旧 payload 无法无损推导目标引用、逆向变化或期望版本，因此 Migration 在 `undo_operations` 已有记录时主动拒绝执行，绝不伪造历史回填。

- 对未发布、确认可丢弃的开发库：先记录决定并显式重置数据库，再从头执行正式 Migration。
- 对任何需要保留数据的环境：立即暂停，先设计独立的可验证迁移/人工映射方案；不得删除旧行绕过保护。
- H2 没有生产部署授权，不能把本地重置步骤用于生产。

## 回滚

Prisma Migration 不自动生成 down SQL。应用回滚优先保持向后兼容；若数据库必须回退，使用评审过的独立补偿 Migration，禁止手工改生产 Schema。
