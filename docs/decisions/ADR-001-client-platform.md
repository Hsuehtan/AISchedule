# ADR-001：客户端平台

- 状态：已批准
- 日期：2026-07-13

## 决策

使用 Taro 4.x + React 18 + TypeScript，先发布移动端 H5，后续适配微信小程序。样式使用 SCSS Modules 和 Electric Ink Token，不引入通用 UI 组件库。

## 结果

浏览器和小程序能力必须经过平台 Adapter；设计以 390 × 844 为基线并覆盖 320-480px。
