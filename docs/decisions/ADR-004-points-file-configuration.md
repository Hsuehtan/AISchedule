# ADR-004：积分文件配置

- 状态：已接受；T18 已实施
- 日期：2026-07-13

## 决策

积分赠送和能力成本以 `config/product/points.yaml` v2 为唯一配置真源，服务启动时通过 Zod 校验并加载，修改后重启生效。Grant 保存 `points + ruleVersion`；能力保存 code、endpoint、名称、是否调用模型、成本、成本规则版本与 enabled。每笔交易保存配置版本、Hash 和适用规则快照。

启动时在 PostgreSQL advisory lock 和事务中同步派生的不可变 `AiCapability` 版本。同一规则版本内容不一致时拒绝启动；同一能力与端点最多一个 ACTIVE 版本。数据库只用于历史关联，不能覆盖 YAML。

预留使用一条 `DEBIT/PENDING`，结算原地转为 `SUCCEEDED` 并扣减余额，释放原地转为 `CANCELLED`。调用方不能提交成本；`Users/AiPointsPort` 从 ACTIVE 能力解析并在 User 行锁下处理余额。

新用户 grant 与注册事务原子提交；每日补足从注册次日起按用户本地日期懒执行，即使差额为 0 也写唯一审计流水。配置修改只影响未来 Grant、预留和调账，不改变已有 pending 请求的成本快照。

管理员调账只通过 CLI 产生 `ADJUSTMENT` 流水和 `ADMIN_ADJUSTMENT` 审计事件，不直接覆盖余额或修改历史流水。add/subtract/set 支持 `--dry-run`；负向操作不得让可用余额为负或侵占 pending 预留。

旧积分枚举值在 Phase 3 expand Migration 中暂时保留以支持回滚，但新代码停止写入；物理删除必须由后续独立收缩 Migration 完成。
