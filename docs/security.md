# Security & Privacy — v1.7.0

## Hard constraints

本扩展保持本机、最小权限设计：

- 不发起网络请求；
- 不使用 fetch / XHR / WebSocket / EventSource；
- 不使用 Cookie API；
- 不使用 localStorage / sessionStorage / IndexedDB / extension storage；
- 不使用 `eval` / `new Function`；
- 无 background service；
- content script 仅匹配 `https://chatgpt.com/*`。

## Performance diagnostics

诊断 ring buffer 仅在当前页面内存中存在，刷新后清除。只记录时间、状态、耗时、mutation 数、页面压力、扩展自耗时和优化状态。

禁止记录：

- 聊天正文；
- `innerText` / message body；
- 账号 Cookie；
- 凭据、Token、Authorization header；
- 可用于重建聊天内容的完整 DOM 快照。

## Handoff

“准备换窗交接”只向当前 ChatGPT composer 写入一条结构化提炼指令。

明确禁止：

- 自动点击发送；
- `form.submit()` / `requestSubmit()`；
- 模拟 Enter / KeyboardEvent；
- 自动 `window.open()` 新聊天；
- 默认程序化遍历完整聊天 DOM 做本地压缩。

用户仍需检查输入框内容并手动发送。

## Imported history JSON

用户显式导入的 OpenAI 官方会话 JSON / Context Bridge JSON 仅在本机解析结构元数据。多会话导出无法准确定位当前 conversation ID 时 Fail-Closed。

## Supply chain

项目无运行时第三方依赖。开发测试使用 Node.js 内置 `node:test`，降低依赖供应链面。

## Automated guards

`tests/security.test.js` 对运行时代码扫描禁止能力，并单独检查 handoff 不包含自动发送/新开聊天路径。
