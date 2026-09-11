# Compatibility — v1.7.1 Candidate

## Primary target

主要目标：Chrome / Edge / Brave 等 Chromium 浏览器。

## WebExtension namespace

运行时代码使用 `browser.* || chrome.*`，因此 Firefox/Safari 源码层保留命名空间兼容，但 Performance API、MV3 background、`storage.session` 与 ChatGPT DOM 的实际支持程度可能不同。缺少能力时优先安全降级，不猜测等价行为。

## Performance API fallback

### PerformanceObserver

优先 Long Animation Frame，其次 Long Task。两者都不可用时页面阻塞保持 `UNKNOWN`，只允许在 `quiet` 状态低频使用短 rAF burst fallback，不把缺数据伪装成 0。

### Event Timing

不可用时交互响应保持 `UNKNOWN`；不冒充官方 INP。

### MutationObserver

用于增量计数和活动时间，不读取聊天正文。不可用时生成态识别能力降低，但扩展继续安全运行。

### IntersectionObserver

用于远屏历史冷却和近视口预热。不可用时不添加 cold 标记、冷却覆盖显示 `UNKNOWN`，并且不退化成大批量 `getBoundingClientRect()` 扫描。

## Session checkpoint compatibility

v1.7.1 使用 Manifest V3 background service worker + `storage.session` 保存最近一次低频诊断检查点。主要 Chromium 目标浏览器应支持这条路径；如果扩展运行环境没有 `storage.session`、background worker 不可用或消息发送失败：

- 黑匣子仍可在当前页面内存中运行；
- checkpoint 状态显示降级/异常；
- 连续保存失败后可选 session checkpoint 自动暂停；
- 不回退到 `storage.local`、`storage.sync`、localStorage 或 IndexedDB；
- 刷新后可能无法恢复旧证据，但页面核心监控不因此失败。

`storage.session` 是会话级辅助取证，不是永久日志。浏览器会话结束、扩展重载/更新/禁用后数据可能消失；最近一次成功 checkpoint 之后的事件也可能尚未保存。

## ChatGPT DOM compatibility

首选消息选择器：`article[data-testid^="conversation-turn-"]`；兼容 fallback：`[data-message-author-role]`。如果两者都失效，页面结构显示 `UNKNOWN`，并停止依赖消息结构的渲染优化。

Composer 交接依次尝试 `#prompt-textarea` / `data-testid=prompt-textarea` / contenteditable textbox。找不到输入框就返回错误，不自动搜索聊天正文或触发发送。

## Background tabs

`document.hidden` 时进入 `background` 状态，跳过非必要页面采样、布局维护和 session checkpoint；重新可见后先进入交互保护窗，再逐步恢复。

## Known boundaries

- ChatGPT DOM 不是公开稳定 API，站点更新可能需要调整选择器。
- 浏览器页面压力会受机器整体 CPU/GPU/内存负载影响，不能单独证明 ChatGPT 或扩展是唯一根因。
- Long Animation Frame 的脚本归因字段取决于浏览器实现；没有浏览器提供的字段时保持缺失/0，不主动通过布局读取补测。
- v1.7.1 的黑匣子提高偶发卡顿取证能力，但不能保证每一次冻结都在刷新前成功 checkpoint。
- v1.7.1 Candidate 仍需对 v1.7.0 做真实浏览器 A/B；自动化通过不代表卡屏根因已解决。
