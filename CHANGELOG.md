# Changelog

遵循 Semantic Versioning。

## [1.6.1] - 2026-09-11

### Fixed

- 修复官方/Context Bridge 历史摘要中 `assetCount = UNKNOWN` 经过运行时消息后被错误转成 `0` 的问题。
- `PerformanceObserver` 完全不可用时不再启动即抛 `ReferenceError`，改为安全降级。
- WebExtension API 从硬编码 `chrome.*` 改为 `browser.* || chrome.*`，提升 Firefox / Safari 源码兼容性。
- 修正 `styles.css` 中滞后的 v1.5.0 版本注释。

### Added

- Node 内置测试：核心解析、浏览器命名空间、PerformanceObserver 降级、Manifest 最小权限、安全能力守卫、版本一致性。
- 公开发布文档：算法原理、兼容矩阵、安全模型、发布检查表。
- README 使用根据真实扩展界面提取并重排的精简示意图。

### Security

- 自动守卫禁止引入 fetch/XHR/WebSocket/EventSource、持久化 Storage、Cookie API、`eval`/`new Function`。

## [1.6.0] - 2026-09-11

- 页面压力、历史深度、模型上下文占用三者分离。
- 模型上下文无可信官方实时数据时固定显示 `UNKNOWN`。
- Popup 只读取采样快照，不因打开面板改变统计结果。
- 无交互样本时不以 0ms 冒充数据。
- Long Animation Frame 优先、Long Task 回退。
- 加入 90 秒窗口压力、持续高压升级与恢复滞回。
- 支持导入 OpenAI 官方会话 JSON 与 Context Bridge JSON 做本机历史深度校准。
