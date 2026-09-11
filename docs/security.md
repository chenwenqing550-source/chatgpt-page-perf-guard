# Security & Privacy — v1.7.1 Candidate

## Hard constraints

本扩展保持本机、最小权限设计：

- 不发起网络请求；
- 不使用 fetch / XHR / WebSocket / EventSource；
- 不使用 Cookie API；
- 不使用页面 localStorage / sessionStorage / IndexedDB；
- 不使用 `storage.local` / `storage.sync`；
- Manifest 唯一扩展权限为 `storage`，用途限定为 `storage.session` 会话级性能检查点；
- 不使用 `eval` / `new Function`；
- MV3 background service worker 只负责本地 session checkpoint，不联网、不分析聊天正文；
- content script 仅匹配 `https://chatgpt.com/*`，无额外 host permission。

## Diagnostic black box

黑匣子主记录保存在页面内固定容量 ring buffer 中。记录范围只包含性能元数据：时间、发送/滚动标记、LoAF/LongTask、Event Timing、mutation 数、页面状态/压力、扩展自耗时和优化状态。

为了避免页面刷新后立即丢失全部证据，background worker 可将**最近一次 quiet 检查点**写入 `storage.session`。每个标签页只有一个有界槽位，最多 480 个事件；写入前会再次执行字段白名单/正文类字段剥离。检查点连续失败后，monitor 会暂停可选 checkpoint，页面内存记录继续运行。

刷新/重载后只能恢复最近一次成功检查点；尚未检查点的最后一段事件仍可能丢失。浏览器会话结束、扩展禁用/更新/重载后 session 数据也可能消失。

明确禁止记录或持久化：

- 聊天正文、prompt、assistant 正文；
- `innerText`、message body、DOM HTML；
- 剪贴板内容；
- 账号 Cookie；
- 凭据、Token、Authorization header；
- 网络请求/响应载荷；
- 可用于重建聊天内容的完整 DOM 快照。

## Hot-path safety

发送、scroll、PerformanceObserver 等热路径不得：

- 写 extension storage；
- `JSON.stringify` 大对象；
- 全量扫描聊天 DOM；
- 读取 `scrollHeight` / `getBoundingClientRect()` / `offset*` / `getComputedStyle()` 等可能造成同步布局的 API。

黑匣子不新增 monitor recurring timer；checkpoint 复用现有 update 路径，只在 quiet 状态低频执行。

## Explicit export

Popup 只有用户显式点击“导出最近发送现场”或“导出最近10分钟”时才在本地执行 JSON 序列化并创建 Blob/object URL 下载。无需 `downloads` 权限，不上传文件。

## Handoff

“准备换窗交接”只向当前 ChatGPT composer 写入一条结构化提炼指令。明确禁止自动点击发送、`form.submit()` / `requestSubmit()`、模拟 Enter / KeyboardEvent、自动 `window.open()` 新聊天，以及默认程序化遍历完整聊天 DOM 做本地压缩。用户仍需检查输入框内容并手动发送。

## Imported history JSON

用户显式导入的 OpenAI 官方会话 JSON / Context Bridge JSON 仅在本机解析结构元数据。多会话导出无法准确定位当前 conversation ID 时 Fail-Closed。

## Supply chain / automated guards

项目无运行时第三方依赖。开发测试使用 Node.js 内置 `node:test`。自动化门禁检查网络/持久化存储/正文采集/动态代码能力、Manifest 最小权限、handoff 无自动发送、session checkpoint 隔离和黑匣子热路径约束。
