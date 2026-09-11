# 兼容性说明

最后复核：2026-09-11。

## 浏览器 API 命名空间

v1.6.0 直接引用 `chrome.*`。v1.6.1 改为运行时选择：

```js
const WebExt = globalThis.browser || globalThis.chrome;
```

因此 Firefox / Safari 优先使用 `browser.*`，旧版 Chromium 继续使用 `chrome.*`。异步 `tabs.query()` 与 `tabs.sendMessage()` 使用 Promise 形式。

参考：
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension

## PerformanceObserver

`PerformanceObserver` 本身已广泛支持，但具体 entry type 不一致。v1.6.1 不再假设 `PerformanceObserver` 一定存在，而是在启动时防御性检测。阻塞观测顺序：

1. `long-animation-frame`
2. `longtask`
3. 都没有 -> `UNKNOWN`

`event` 类型同样只在浏览器报告支持时启用。

参考：
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/supportedEntryTypes_static
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming

## content-visibility

现代浏览器已经普遍支持 `content-visibility: auto`，但旧版本可能忽略该 CSS。忽略时扩展仍可监控性能，只是“长聊天优化”不会产生预期收益。

参考：
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility

## Chromium / Windows / macOS / Linux

扩展没有本机二进制、文件系统 API 或 OS 专属调用。理论上，同一 Chromium API 版本下操作系统差异很小。仍需注意 GPU、节能策略、后台调度会改变性能数据，所以不同机器上的压力数值不能直接横向比较。

## Firefox

运行时代码已做 `browser.*` 兼容，但正式发布到 AMO 还有**分发层要求**：Manifest V3 签名需要 `browser_specific_settings.gecko.id`；从 2025-11-03 起新提交还需要 `data_collection_permissions`。本项目的声明应为 `required: ["none"]`，因为扩展不把数据传出扩展环境。

示例（正式 Firefox 包构建时合入，不放进 Chromium 基础 manifest）：

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "chatgpt-page-perf-guard@chenwenqing550-source",
      "data_collection_permissions": {
        "required": ["none"]
      }
    }
  }
}
```

参考：
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings

## Safari

Safari Web Extension 需要 Apple 的打包/签名流程，不应把 Chromium ZIP 宣称为 Safari 安装包。Apple 当前提供 `safari-web-extension-packager`，可把现有 WebExtension 源码转换成 Xcode 项目。

示例：

```bash
xcrun safari-web-extension-packager /path/to/extension
```

参考：
- https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari

## 尚未完成的实机矩阵

首个公开版本建议标 Pre-release，至少补齐以下真实证据后再改 Stable：

- Chrome 最新稳定版：Windows
- Edge 最新稳定版：Windows
- Firefox 最新稳定版：Windows 或 macOS
- Chromium：macOS 或 Linux 至少一项
- ChatGPT DOM 主结构与 fallback 各一次
- LoAF 支持 / Long Task 回退 / 无阻塞 entry type 三条路径
