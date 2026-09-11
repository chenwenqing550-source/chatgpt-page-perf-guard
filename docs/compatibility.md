# Compatibility — v1.7.0

## Primary target

主要目标：Chrome / Edge / Brave 等 Chromium 浏览器。

## WebExtension namespace

运行时代码使用：

```text
browser.* || chrome.*
```

因此 Firefox/Safari 源码层保留命名空间兼容，但性能 API 与 ChatGPT DOM 兼容程度可能不同。

## Performance API fallback

### PerformanceObserver

优先：Long Animation Frame；其次：Long Task。

两者都不可用时：

- 页面阻塞保持 `UNKNOWN`；
- 只允许在 `quiet` 状态低频使用短 rAF burst fallback；
- 不因为缺数据把值伪装成 0。

### Event Timing

不可用时交互响应保持 `UNKNOWN`；不冒充官方 INP。

### MutationObserver

用于增量计数和活动时间，不读取聊天正文。不可用时生成态识别能力降低，但扩展继续安全运行。

### IntersectionObserver

用于远屏历史冷却和近视口预热。不可用时：

- 不给消息添加 cold 标记；
- 冷却覆盖显示 `UNKNOWN`；
- 不退化成大批量 `getBoundingClientRect()` 扫描。

## ChatGPT DOM compatibility

首选消息选择器：

```text
article[data-testid^="conversation-turn-"]
```

兼容 fallback：

```text
[data-message-author-role]
```

如果两者都失效：页面结构显示 `UNKNOWN`，并停止依赖消息结构的渲染优化。

Composer 交接依次尝试 `#prompt-textarea` / `data-testid=prompt-textarea` / contenteditable textbox。找不到输入框就返回错误，不自动搜索聊天正文或触发发送。

## Background tabs

`document.hidden` 时进入 `background` 状态，跳过非必要页面采样和布局维护；重新可见后先进入交互保护窗，再逐步恢复。

## Known boundaries

- ChatGPT DOM 不是公开稳定 API，站点更新可能需要调整选择器。
- 浏览器页面压力也会受机器整体 CPU/GPU/内存负载影响，不能单独证明 ChatGPT 或扩展是唯一根因。
- v1.7.0 能减少扩展自身参与卡顿的概率，但无法保证消除 ChatGPT 页面本身的所有长期运行问题。
