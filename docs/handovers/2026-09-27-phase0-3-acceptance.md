# 2026-09-27 Phase 0–3 独立验收接管快照

此快照不可覆盖。详细任务/AC 状态、证据和缺陷见[独立验收报告](../quality/2026-09-27-phase0-3-acceptance.md)，当前唯一入口见[`tasks/current.md`](../../tasks/current.md)。

## 固定状态

- 受验基线：`dev` / `f178d673112a8b54cb1c84da390384b204ade614`，验收前工作区干净。
- 结论：**Phase 0–3 未全部通过**。T09 失败；T17、AC-06、AC-20 因完整浏览器主链路中断而阻塞。原始 Integration 为 DB 19/21，原始 E2E 为 16/18。7 月历史审查包保留，不替代本轮运行结果。
- 本轮不修改产品实现。所有运行在 Git 归档临时副本 `/private/tmp/ai-schedule-acceptance.Fq9fkW` 与一次性 PostgreSQL/Testcontainers 中。临时副本中为归因仅改变测试夹具的固定到期日期、添加浏览器探针；这些改动没有回写仓库。
- 空库 8 Migration、Contract 检查、Lint、Typecheck、Build、全部 Unit、真实 DeepSeek Smoke 1/1 通过。调整临时夹具后全量 Integration 通过，但原始失败保留。管理员 CLI 实调成功，合成数据容器已删除。
- H2 历史人工通过；H3 尚未通过。T25–T30、生产部署、开放公网、真实用户数据仍未授权。

## 必须保留的失败与解释

1. `tests/e2e/prototype.spec.ts:73`：H1 文本输入 `taro-textarea-core` 约 30×43px，小于 44px；点击外框左上 5px 不聚焦。产品可用性缺陷，只定位到 H1 Fixture。
2. `packages/db/test/agent-schema.integration.test.ts:283`、`:475`：候选引用/提案测试到期值写死为 2026 年 7 月，当前 9 月运行违反合法 DB 约束。临时改成 2099 年后 21/21，通过仅证明归因，不改变基线失败。
3. `tests/e2e/phase2.spec.ts:133–151`：测试直接设置 Picker 宿主 DOM `value`，确定按钮仍回填 2024-01-01，而非期望 2024-01-31；后续闰年、三时间字段与完整手工闭环未执行。临时真实点击日期列可正常更新，但不能替代完整主链路。
4. 基线 `tasks/current.md` 曾把 `codex/phase3-agent` 和历史 18/18 当作当前状态。本轮文档修订已重定向至验收报告；旧快照仍按历史保留。

## 接管后唯一下一步

先请人类决定 D01–D03 的修复清单及复验范围。取得新指示前只可阅读证据、讨论结论，不修复产品代码，不启动 T25–T27。若获准修复，先在 `dev` 上核对新 HEAD 和工作区改动；按需求最小化修复并重跑原始未改断言的 Contract/Unit/Integration/E2E/视觉/真实 Smoke 必需范围，不能以临时归因副本的通过结果替代正式复验。复验结束另建新的不可覆盖快照。
