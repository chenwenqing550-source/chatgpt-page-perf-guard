# Architecture — v1.7.1 Candidate

## 1. 目标

v1.7.1 延续 v1.7.0 的核心原则：**页面越忙，扩展自己的主动工作越少。** 本候选新增诊断黑匣子，但不把页面压力、浏览器缓存或 JS 内存冒充模型上下文占用，也不顺手修改既有 cold-turn 优化算法。

## 2. 模块

- `core.js`：页面压力、90 秒窗口压力、换窗建议、历史深度校准与 UNKNOWN 语义。
- `runtime.js`：纯函数运行状态机与基础 bounded ring buffer。
- `blackbox.js`：固定容量/固定时间窗口的性能事件记录、字段清洗、严重事件簇、发送现场切片与导出 payload。
- `monitor.js`：浏览器性能信号、页面活动感知、自让路采样、远屏冷却管理、黑匣子热路径接线与 quiet checkpoint 调度。
- `background.js`：MV3 service worker；只负责按 tab 保存/读取/清除 `storage.session` 检查点，并对数据二次清洗和限量。
- `handoff.js`：生成结构化换窗交接指令，并仅填入当前输入框。
- `popup.js/html/css`：展示页面压力与黑匣子状态，提供历史校准、优化开关、手动事故标记、本地 JSON 导出和换窗交接入口。

## 3. 自让路生命周期

状态输入包括：页面是否后台、最近滚动、mutation 速率、最近阻塞耗时、稳定时间和最近用户交互年龄。

- `quiet`：允许完整被动观测和必要的低频 fallback；只有这里才允许低频 session checkpoint。
- `generating`：DOM 高频变化；暂停主动帧探针、冷却维护和 checkpoint。
- `scrolling`：滚动活跃；暂停主动布局/冷却维护和 checkpoint。
- `busy`：发送/输入保护窗、高阻塞、生成+滚动等；进入最低干扰模式。
- `background`：非必要页面采样和 checkpoint 休眠。

用户交互后约 2.5 秒内保持保护态，覆盖发送消息、用户消息插入、自动滚动和首轮回复 DOM 建立的高峰。

## 4. 性能信号与黑匣子热路径

优先被动信号：Long Animation Frame、Long Task fallback、Event Timing、timer drift，以及 MutationObserver 的增量计数/计时。

黑匣子直接复用这些既有事件，不新增 recurring monitor timer。发送/submit 只写 O(1) marker；scroll 事件做频率限制后只记录 `scrollX / scrollY` 等不会主动触发布局的值。热路径禁止 storage 写、JSON 序列化、全量 DOM 扫描和强制布局 API。

只有缺少 Long Animation Frame / Long Task 时，才允许在 `quiet` 状态低频运行短 rAF burst fallback。

## 5. 远屏历史冷却

v1.7.1 保持 v1.7.0 算法：不对所有 conversation turn 统一 `content-visibility`。

`IntersectionObserver` 使用较大的 `rootMargin` 形成预热区。只有已确认在预热区外、页面稳定 quiet、turn 稳定至少 5 秒、不是最后两条消息、最近没有 mutation 且用户未关闭优化时，才添加 `data-cgpt-perf-cold="on"`。

进入预热区或发生 mutation 时立即移除 cold 标记。浏览器不支持 IntersectionObserver 时，冷却覆盖保持 UNKNOWN/关闭，不用批量 `getBoundingClientRect()` 强行猜测。

## 6. 诊断黑匣子与 session checkpoint

`blackbox.js` 保存最近约 10 分钟、最多 480 个性能事件。事件包含墙钟时间和页面 `performance` 时间，可记录发送/滚动、LoAF/LongTask 细节、Event Timing、活动状态、页面压力、mutation rate、扩展自耗时和优化状态；不记录聊天正文。

`monitor.js` 从现有 update cycle 里、只在 `quiet` 状态且达到最小间隔时，把快照发给 `background.js`。background 只使用 `storage.session`，每个 tab 一个有界槽位。连续保存失败会暂停可选 checkpoint，避免诊断功能反过来制造压力。

页面刷新后，恢复逻辑用墙钟年龄把旧事件重新映射到新的 `performance.now()` 时间轴，并与页面启动后已经出现的新事件按时间顺序合并。最近一次成功 checkpoint 之后尚未保存的事件仍可能丢失。

## 7. 显式导出

Popup 打开时只额外读取一次黑匣子状态，不把状态查询加入原有 2 秒 metrics 轮询。只有用户点击导出时才执行 `JSON.stringify`、创建 Blob/object URL 并触发本地文件保存；不使用网络或 downloads API。

## 8. 换窗交接

`handoff.js` 只构造结构化 prompt 并写入当前 composer。它不读取完整会话内容来做本地摘要，也不自动提交。交接保护 `CURRENT / VERIFIED / PENDING / BLOCKED / HISTORICAL / REJECTED` 及 exact repo/branch/SHA/version/test result/下一步/Stop Rule。

这是一种 handoff，不是服务端上下文原地压缩。

## 9. Fail-Closed

- 缺失可靠性能信号 → `UNKNOWN`，不写 0。
- 无法识别 ChatGPT 消息结构 → 不做远屏冷却。
- 无法确认远屏 → 保持热状态。
- checkpoint 连续失败 → 暂停可选 session 保存，保留页面内存记录。
- 恢复到不同 conversation ID → 不混入当前窗口。
- 无法匹配导入会话 ID → 不猜。
- 找不到 composer → handoff 返回错误，不尝试其他有副作用路径。
