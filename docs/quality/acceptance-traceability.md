# 验收追踪

状态：T03 已建立共享契约测试，随每个纵向切片继续补齐测试 ID。

| PRD | Figma/行为 | 实施任务 | 自动化测试 |
|---|---|---|---|
| AC-06 | 登录、All Todos、Task Edit | T10-T17 | 待实现 |
| AC-07 | Project Management | T16 | 待实现 |
| AC-13 | 用户数据隔离 | T10、T28 | 待实现 |
| AC-14-18、21、26 | Quota Limit/积分网关 | T18-T24 | 待实现 |
| AC-01-05、10-12 | Agent Plan/Clarify/Confirm | T19-T24、T26 | 待实现 |
| AC-08 | Voice Input | T25 | 待实现 |
| AC-20、22-25 | 列表、撤销、Smart Inbox、项目入口 | T13-T24 | 待实现 |
| 身份输入约束 | 登录/注册 | T03、T10 | `packages/contracts/src/contracts.test.ts` |
| Task/Project/Agent 数据边界 | 全部交互状态 | T03、T06-T24 | `packages/contracts/src/domain.test.ts` |
| 积分文件格式 | Quota Limit/积分网关 | T03、T18 | `packages/config/src/config.test.ts` |

任务完成时必须将“待实现”替换为具体测试文件或用例 ID。
