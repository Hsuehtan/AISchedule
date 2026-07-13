# ADR-006：语音与提醒

- 状态：已批准
- 日期：2026-07-13

## 决策

定义 SpeechProvider；P0 使用腾讯云一句话识别，限制短音频并不持久化原始音频。P0 保存 scheduledAt、deadlineAt、reminderAt，并提供站内提醒，不做系统 Push。

腾讯接口不接收浏览器常见的 WebM。H5 适配器必须输出/编码 16k 单声道 PCM/WAV；小程序使用平台 mp3/aac/m4a。`maxBytes` 按 Base64 后请求数据计算，完整可行性记录见 [`../architecture/provider-feasibility.md`](../architecture/provider-feasibility.md)。
