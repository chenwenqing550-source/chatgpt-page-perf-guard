# Architecture — v1.7.0

## 1. 目标

v1.7.0 的核心原则是：**页面越忙，扩展自己的主动工作越少。** 扩展只做浏览器页面性能辅助，不把页面压力、浏览器缓存或 JS 内存冒充模型上下文占用。

## 2. 模块

- `core.js`：页面压力、90 秒窗口压力、换窗建议、历史深度校准与 UNKNOWN 语义。
- `runtime.js`：纯函数运行状态机与 bounded ring buffer。
- `monitor.js`：浏览器性能信号、页面活动感知、自让路采样、远屏冷却管理与运行时消息。
- `handoff.js`：生成结构化换窗交接指令，并仅填入当前输入框。
- `popup.js/html/css`：展示页面压力、诊断状态、历史校准、长聊天优化开关和换窗交接入口。

## 3. 自让路生命周期

状态输入包括：页面是否后台、最近滚动、mutation 速率、最近阻塞耗时、稳定时间和最近用户交互年龄。

- `quiet`：允许完整被动观测和必要的低频 fallback。
- `generating`：DOM 高频变化；暂停主动帧探针和冷却维护。
- `scrolling`：滚动活跃；暂停主动布局/冷却维护。
- `busy`：发送/输入保护窗、高阻塞、生成+滚动等；进入最低干扰模式。
- `background`：非必要采样休眠。

用户交互后约 2.5 秒内保持保护态，覆盖发送消息、用户消息插入、自动滚动和首轮回复 DOM 建立的高峰。

## 4. 性能信号

优先被动：

1. Long Animation Frame；
2. Long Task fallback；
3. Event Timing；
4. timer drift；
5. MutationObserver 只计数/计时，不读取正文。

只有缺少 Long Animation Frame / Long Task 时，才允许在 `quiet` 状态低频运行短 rAF burst fallback。

## 5. 远屏历史冷却

v1.7.0 不再给所有 conversation turn 统一 `content-visibility`。

`IntersectionObserver` 使用较大的 `rootMargin` 形成预热区。只有同时满足以下条件才添加 `data-cgpt-perf-cold="on"`：

- 已确认在预热区外；
- 页面为稳定 quiet；
- turn 已稳定至少 5 秒；
- 不是最后两条消息；
- 最近没有发生 mutation；
- 用户没有关闭长聊天优化。

进入预热区或发生 mutation 时立即移除 cold 标记。浏览器不支持 IntersectionObserver 时，冷却覆盖保持 UNKNOWN/关闭，不用批量 `getBoundingClientRect()` 强行猜测。

## 6. 诊断 ring buffer

仅保存在当前页面内存，严格 bounded。记录：

- 时间；
- LoAF/LongTask 类型与耗时；
- activity state；
- page pressure；
- mutation rate；
- 扩展本轮主动工作耗时；
- 优化开关状态。

不记录 message body、innerText、聊天正文、账号信息；不上传；刷新后消失。

## 7. 换窗交接

`handoff.js` 只构造结构化 prompt 并写入当前 composer。它不读取完整会话内容来做本地摘要，也不自动提交。

交接结构保护：`CURRENT / VERIFIED / PENDING / BLOCKED / HISTORICAL / REJECTED`，并要求保留 exact repo/branch/SHA/version/test result/下一步/Stop Rule。

这是一种 handoff，不是服务端上下文原地压缩。

## 8. Fail-Closed

- 缺失可靠性能信号 → `UNKNOWN`，不写 0。
- 无法识别 ChatGPT 消息结构 → 不做远屏冷却。
- 无法确认远屏 → 保持热状态。
- 无法匹配导入会话 ID → 不猜。
- 找不到 composer → handoff 返回错误，不尝试其他有副作用路径。
