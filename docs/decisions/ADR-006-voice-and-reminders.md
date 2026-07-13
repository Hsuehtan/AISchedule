# ADR-006：语音与提醒

- 状态：已批准
- 日期：2026-07-13

## 决策

定义 SpeechProvider；P0 使用腾讯云一句话识别，限制短音频并不持久化原始音频。P0 保存 scheduledAt、deadlineAt、reminderAt，并提供站内提醒，不做系统 Push。
