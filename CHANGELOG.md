# Changelog

遵循 Semantic Versioning。

## [1.7.1] - 2026-09-12

### Added

- 新增低开销「诊断黑匣子」：固定容量、固定时间窗口地记录发送标记、滚动、Long Animation Frame / Long Task、Event Timing、mutation 与页面状态等性能元数据。
- 新增严重长帧事件簇识别，导出时可围绕最近发送标记保留卡顿前后时间线，而不是只显示最后一个长帧。
- Popup 新增「导出最近发送现场」「导出最近10分钟」「标记刚才卡顿」；JSON 只在显式点击时本地生成，不自动上传。
- 新增 MV3 service worker 和 `storage.session` 会话检查点；已保存证据可在页面刷新后恢复。
- 恢复逻辑使用墙钟时间重映射新的 `performance.now()` 时间轴，并处理 checkpoint 异步晚到时的事件排序。

### Performance / Safety

- 本候选不修改 v1.7.0 的 cold-turn 优化阈值或推荐策略。
- 发送、scroll、PerformanceObserver 热路径禁止 storage 写、JSON 序列化、DOM 全量扫描与强制布局读取。
- recorder 使用固定容量环形结构，热追加不使用 front `shift/splice`；10 分钟后旧事件被裁剪。
- 不新增 recurring monitor timer，仍保持原有 3 个 interval。
- session checkpoint 只从现有 update 路径在 `quiet` 状态低频执行，连续失败后暂停可选 checkpoint，但页面内存记录继续。
- popup 黑匣子状态只在打开时读取一次，不加入原有 2 秒 metrics 轮询。

### Security

- Manifest 仅新增 `storage` 权限，实际只允许 `storage.session`；仍无 host scope 扩张、network/cookie/downloads 权限。
- 不记录聊天正文、prompt、assistant 正文、DOM HTML、剪贴板或网络载荷。
- 继续禁止 fetch/XHR/WebSocket/EventSource、`storage.local` / `storage.sync`、页面 localStorage/sessionStorage、IndexedDB、Cookie API、`eval` / `new Function`。

### Status

- 自动化回归可以验证设计约束和安全边界，但真实浏览器性能验收仍为 **PENDING**。
- 必须完成同一窗口条件下的 **v1.7.0 vs v1.7.1 A/B**，确认诊断候选没有造成可测性能回退后，才能考虑结束 Draft 状态。
- 本条不宣称既有 ChatGPT 卡屏根因已经修复；下一次真实冻结仍需用黑匣子导出证据确认。
- 硬卡后若在下一次 quiet checkpoint 前立即刷新，尚未保存的最后几秒事件仍可能丢失。

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
