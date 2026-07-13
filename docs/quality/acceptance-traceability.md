# 验收追踪

状态：T09 已建立交互壳浏览器基线。交互壳测试证明页面方向，不替代 T10-T27 的真实业务验收。

| PRD                         | Figma/行为                         | 实施任务     | 自动化测试                                 |
| --------------------------- | ---------------------------------- | ------------ | ------------------------------------------ |
| AC-06                       | 登录、All Todos、Task Edit         | T10-T17      | 待实现                                     |
| AC-07                       | Project Management                 | T16          | 待实现                                     |
| AC-13                       | 用户数据隔离                       | T10、T28     | 待实现                                     |
| AC-14-18、21、26            | Quota Limit/积分网关               | T18-T24      | 待实现                                     |
| AC-01-05、10-12             | Agent Plan/Clarify/Confirm         | T19-T24、T26 | 待实现                                     |
| AC-08                       | Voice Input                        | T25          | 待实现                                     |
| AC-20、22-25                | 列表、撤销、Smart Inbox、项目入口  | T13-T24      | 待实现                                     |
| 身份输入约束                | 登录/注册                          | T03、T10     | `packages/contracts/src/contracts.test.ts` |
| Task/Project/Agent 数据边界 | 全部交互状态                       | T03、T06-T24 | `packages/contracts/src/domain.test.ts`    |
| 积分文件格式                | Quota Limit/积分网关               | T03、T18     | `packages/config/src/config.test.ts`       |
| H1 页面状态完整性           | Production V3 15 状态              | T06-T09      | E2E：全部状态可直接访问                    |
| H1 核心导航                 | Login → All Todos → Plan → Confirm | T07-T09      | E2E：核心交互路径可复现                    |
| H1 撤销方向                 | Toast Undo                         | T07-T09、T15 | E2E：完成后可撤销；真实 3 秒边界待 T15     |
| H1 响应式                   | 320/390/480px                      | T09、T27     | E2E：响应式边界与全状态截图                |
| H1 软键盘                   | Text Input                         | T09、T27     | E2E：390 × 560 输入焦点与操作区            |
| H1 无障碍                   | 四个关键页面                       | T09、T27     | E2E：44px 热区与 axe WCAG A/AA             |

任务完成时必须将“待实现”替换为具体测试文件或用例 ID。
