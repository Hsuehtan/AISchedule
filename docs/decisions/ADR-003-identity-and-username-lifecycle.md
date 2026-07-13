# ADR-003：身份与用户名生命周期

- 状态：已批准
- 日期：2026-07-13

## 决策

P0 使用用户名 + 密码；手机号选填但未验证前不参与登录；昵称是非唯一展示身份。身份、密码、联系方式与 User 主体分表，业务只引用 userId。

## 迁移

手机号验证上线后按 expand -> bind/backfill -> switch reads -> deprecate username -> contract 的顺序迁移。用户名 API 使用明确 `/auth/username/*` 路径，未来手机号使用 `/auth/phone/*`。
