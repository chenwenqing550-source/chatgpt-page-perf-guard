# ChatGPT 页面性能助手

当前版本：**v1.7.0**

这是一个本机运行的 ChatGPT 长聊天页面性能辅助扩展。目标不是“测模型还剩多少上下文”，而是尽量减少长页面自身的渲染与监控开销、识别短时卡顿，并在窗口持续变重时提供安全的换窗交接路径。

> 页面压力 ≠ 模型上下文占用。ChatGPT 没有向网页提供可验证的实时模型上下文占用数据；无法可靠获得时，本扩展始终显示 `UNKNOWN`，不会伪造百分比。

## v1.7.0 核心变化

### 1. 页面越忙，扩展自己越让路

运行状态分为：

- `quiet`：正常被动监控；必要时允许很低频的 fallback 探针。
- `generating`：页面高频增长时暂停 coverage / 布局类主动工作。
- `scrolling`：滚动时停止主动布局工作。
- `busy`：发送、生成、滚动或长帧高峰时进入最低干扰模式。
- `background`：后台标签页仅保留恢复所需的最小状态。

发送/输入等用户交互后还有约 2.5 秒保护窗，避免扩展在 ChatGPT 正在提交消息、插入新 DOM 和自动滚动时参与主线程竞争。

### 2. 不再对整个聊天一刀切 `content-visibility`

v1.7.0 只会冷却：

- 已由 `IntersectionObserver` 确认远离视口；
- 已稳定一段时间；
- 不是最后两条消息；
- 最近没有发生内容变化；
- 当前页面不处于滚动/生成/繁忙状态。

近视口采用较大的预热区，正在增长的消息会立即保持正常渲染。浏览器不支持可靠的可见性观察时，宁可不启用这项冷却，也不强行做批量布局扫描。

### 3. 更精准的短期诊断

优先使用浏览器被动性能信号：

- Long Animation Frame / Long Task；
- Event Timing 交互样本；
- timer drift；
- DOM mutation 速率；
- 当前 `quiet / generating / scrolling / busy / background` 状态；
- 扩展自身本轮主动工作耗时。

最近诊断只保存在页面内存的 bounded ring buffer 中，只记录时间、耗时、状态和数值，不记录聊天正文，不上传，不持久化。刷新页面后自动消失。

### 4. 内置「换窗交接」

Popup 中的 **准备换窗交接** 会把一条结构化提炼指令填入当前 ChatGPT 输入框，由当前模型基于它已经持有的会话上下文生成新窗口交接包。

交接模板要求显式区分：

- `CURRENT`
- `VERIFIED`
- `PENDING`
- `BLOCKED`
- `HISTORICAL`
- `REJECTED`

并优先保护 `repo / branch / exact SHA / version / test result / 下一步 / Stop Rule` 等工程身份。

**它不会压缩当前服务端上下文本体。** 这是“旧窗口提炼 → 用户确认 → 新窗口继续”的 handoff，不是把当前会话的服务端 token 原地缩小。

扩展不会：

- 自动抓取完整聊天正文做本地压缩；
- 自动点击发送；
- 自动模拟 Enter；
- 自动新建聊天。

## 安全与隐私

v1.7.0 继续保持：

- 零网络请求；
- 零遥测；
- 零聊天正文持久化；
- 无 background service；
- 无 Cookie API；
- 无 localStorage / sessionStorage / IndexedDB / extension storage；
- 无 `eval` / `new Function`。

内容脚本仅注入 `https://chatgpt.com/*`。

## 历史深度校准

可选导入：

- OpenAI 官方 `conversations.json` / 单会话 JSON；
- Context Bridge JSON。

扩展只在本机提取结构元数据做历史深度工程估算。多会话文件无法按当前 conversation ID 精确定位时会 Fail-Closed，不猜测“最像哪个会话”。

历史深度仍然不等于模型上下文占用。

## 安装开发版

1. 获取仓库的 `extension/` 目录。
2. Chrome / Edge / Brave 打开扩展管理页。
3. 开启开发者模式。
4. 选择“加载已解压的扩展程序”。
5. 指向 `extension/` 目录。
6. 已经打开的 ChatGPT 标签页需要刷新一次，让新版 content script 生效。

## 本地验证

需要 Node.js 20+：

```bash
npm test
npm run check
```

测试覆盖：运行状态与让路、交互保护窗、远屏冷却守卫、handoff 安全边界、浏览器兼容降级、Manifest 最小权限、版本一致性和安全能力守卫。

## 如何理解“刷新后又顺了”

刷新会重建页面 DOM、脚本状态和布局状态，因此可能暂时恢复顺滑。v1.7.0 的目标不是宣称“永远不需要刷新”，而是：

1. ChatGPT 正忙时扩展不再额外抢主线程；
2. 避免全量屏外渲染优化造成布局修正；
3. 用短期诊断记录判断卡顿附近扩展自身是否参与；
4. 如果长窗口仍持续变重，提供高保真换窗交接，而不是无限死磕一个页面。

## 兼容与边界

主要目标浏览器：Chrome / Edge / Brave（Chromium）。Firefox/Safari 保留 WebExtension 命名空间兼容，但性能 API 支持程度可能不同；缺少可靠信号时显示 `UNKNOWN` 或安全降级。

ChatGPT DOM 不是稳定公开 API。页面结构变化后，扩展会优先失效为“少做/不做”，而不是猜测操作错误节点。

## 项目状态

**v1.7.0 是唯一当前版本和推荐基线。** 安装说明、功能说明与开发验证均以 v1.7.0 为准。

本项目不是 OpenAI 官方产品。
