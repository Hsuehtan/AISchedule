# 正式 H5 真实模型验收证据

最终通过记录为 [20 阶段断言](final-2026-10-27/pydantic_accept_5aa226dc1eb1/current-10087-result.json)、[账本守恒](final-2026-10-27/pydantic_accept_5aa226dc1eb1/balance-reconciliation.json)、[人工样本评审](final-2026-10-27/pydantic_accept_5aa226dc1eb1/manual-review.json)及 [Smoke](final-2026-10-27/pydantic_accept_5aa226dc1eb1/deepseek-smoke-summary.json)。均使用独立合成账号。

开发过程失败没有覆盖或删除：

- `recovered-2026-10-27/`：长流程消耗完新用户默认 20 点，未预留或派发重生成；见其 diagnosis.json。后续通过现有管理员服务补充合成夹具积分。
- `final-2026-10-27/pydantic_accept_7a1ebf37a99d/`：脚本错误要求已失败执行历史只能返回 409；现有契约允许 200＋不可变 FAILED 回执。已改为核对同一历史执行及零写入。
- `final-2026-10-27/pydantic_accept_a264116202d3/`：20 个页面阶段通过，最终观察器漏计一键整理 admission，审计断言失败；数据库独立核对 19 个 Run 与 19 笔扣分正常。

根目录既有 8/10 阶段、11 阶段独立审计与 HTTP 402 中断记录属于此前阶段，保留历史事实，不代替最终通过记录。

每次新的脚本运行默认使用含合成账号的新目录；不保存 Session、Secret、完整系统 Prompt 或 Provider 响应。
