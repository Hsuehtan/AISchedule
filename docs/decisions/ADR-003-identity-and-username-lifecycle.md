# ADR-003：身份与用户名生命周期

- 状态：已批准
- 日期：2026-07-13

## 决策

P0 使用用户名 + 密码；手机号选填但未验证前不参与登录；昵称是非唯一展示身份。身份、密码、联系方式与 User 主体分表，业务只引用 userId。

密码输入接受 8-128 个 Unicode 字符且不做隐式 trim，避免用户输入与实际凭证不一致。密码只在 TLS 请求中短暂出现，落库仅保存 Argon2id Hash。

## 迁移

手机号验证上线后按 expand -> bind/backfill -> switch reads -> deprecate username -> contract 的顺序迁移。用户名 API 使用明确 `/auth/username/*` 路径，未来手机号使用 `/auth/phone/*`。
