# Changelog

遵循 Semantic Versioning。

## [1.7.0] - 2026-09-12

### Changed

- 监控生命周期改为自让路状态机：`quiet / generating / scrolling / busy / background`。
- 用户发送、输入、点击等交互后进入短暂保护窗，避免在 ChatGPT 提交消息和重排布局时启动主动探针。
- 固定 5 秒 rAF burst 改为低频 fallback；有 LoAF/LongTask 被动信号时默认不运行主动帧探针。
- 页面繁忙、生成、滚动和后台状态暂停 coverage/布局类主动工作。
- 移除对所有聊天 turn 一刀切的 `content-visibility`；只冷却已确认远屏、稳定且非最近消息的历史 turn。
- 远屏冷却采用 `IntersectionObserver` 预热区，正在增长和最近发生 mutation 的消息保持热状态。
- Popup 刷新频率降低，并显示运行状态、主动探针让路状态、扩展自身主动工作耗时和最近长帧事件。

### Added

- 仅内存 bounded ring buffer，用于关联长帧、mutation、运行状态、页面压力与扩展自耗时；不记录聊天正文。
- 内置“准备换窗交接”：只向当前输入框填入结构化提炼指令，不自动发送、不自动新建聊天。
- 交接模板强制区分 `CURRENT / VERIFIED / PENDING / BLOCKED / HISTORICAL / REJECTED`，并保护 repo/branch/exact SHA/version/test result/下一步/Stop Rule。
- 新增 lifecycle、load shedding、render guard、handoff 与扩展安全边界测试。

### Security

- 继续禁止 fetch/XHR/WebSocket/EventSource、持久化 Storage、Cookie API、`eval`/`new Function`。
- Handoff 额外禁止自动 click/submit/KeyboardEvent/window.open。
- 默认不程序化抽取完整聊天正文做本地压缩。

## Historical / Obsolete

以下版本仅保留历史记录，不再作为推荐安装或开发基线。

## [1.6.1] - 2026-09-11

- 修复历史摘要 UNKNOWN 语义、PerformanceObserver 降级与 WebExtension 命名空间兼容。
- 增加基础安全、结构与版本一致性测试。

## [1.6.0] - 2026-09-11

- 页面压力、历史深度、模型上下文占用三者分离。
- Long Animation Frame 优先、Long Task 回退。
- 加入 90 秒窗口压力与历史深度 JSON 校准。
