# ChatGPT 页面性能助手

当前候选版本：**v1.7.2**。真实 Windows / ChatGPT 长会话验收仍为 **PENDING**，不是稳定发布。

本机长聊天页面性能辅助扩展：减少自身干扰、优化稳定历史消息的渲染，并提供诊断黑匣子和换窗交接。**页面压力不等于模型上下文占用**；没有可验证的实时上下文数据时始终显示 `UNKNOWN`。

## v1.7.2：滚动几何修复

v1.7.0 / v1.7.1 会在历史消息已经远离视口后才启用 `content-visibility: auto`，并使用固定 720px / 640px 占位；此时浏览器未必记住该元素的真实高度。滚动观察回调又移除冷却标记，造成内容高度反复收缩、展开。

本候选改为：

- 通过 `ResizeObserver` 缓存未冷却消息的自然内容尺寸；没有有效尺寸时不冷却。
- 在安静维护阶段，先设置实测高度，再启用 `contain-intrinsic-block-size`；不使用固定占位猜测。
- `IntersectionObserver` 只更新内存状态，不在滚动回调中移除样式；由浏览器自动呈现相关内容，并保留 remembered size。
- 宽度变化后在安静阶段释放过期尺寸、重新测量；最近消息、正在修改的消息仍受保护。
- 不写 `scrollTop` 补偿，不删除聊天 DOM，不读取聊天正文；没有必要浏览器能力时安全降级为不冷却。

本地 Chromium 的 25 条合成消息复现：旧版页面高度从 44,425px 变成 22,897px；修复后初始、冷却和滚动后的高度均为 44,425px。这证明了该布局缺陷及定向修复，**不证明视频中所有冻结只有这一个原因，也不是实机提速百分比**。复现与验收边界见 `docs/scroll-geometry-validation.md`。

## 诊断黑匣子与会话检查点

保留 v1.7.1 的诊断黑匣子，未因合成测试通过就删除取证能力。它记录固定容量、固定时间窗口的性能元数据：Enter / submit 发送标记、LoAF / Long Task 耗时与归因、Event Timing、mutation 速率、页面状态、节流滚动事件和严重长帧簇。

**不记录聊天正文、输入内容、助手正文、DOM HTML、剪贴板或网络载荷。** Popup 只在用户选择「导出最近发送现场」「导出最近10分钟」时生成本地 JSON；「标记刚才卡顿」用于恢复后留标记。不自动上传，不申请 downloads 权限。

MV3 service worker 只负责 `storage.session` 会话级检查点：每个标签页一个有界检查点；quiet 时从已有低频 update 路径保存；异步恢复按墙钟时间重新排序。连续失败会暂停可选保存，内存记录继续。

**刷新只能恢复已经保存的检查点，尚未检查点的事件可能丢失。** 扩展禁用、重载、更新或浏览器会话结束也可能清除会话记录；不保证硬卡死前最后几秒已保存。

## 性能与隐私边界

- 发送、scroll、PerformanceObserver 热路径不序列化、不写 storage、不全量扫描 DOM、不主动读取强制布局属性。
- 尺寸观察回调只更新缓存；维护仍服从 quiet / scrolling / generating / busy / background 状态机。
- 仍只有原有 3 个 monitor interval；诊断追加使用固定容量 ring buffer，Popup 不在指标轮询中重复读取整个黑匣子。
- 零网络请求、零遥测；仅匹配 `https://chatgpt.com/*`。
- 权限仍仅为 `storage`，只使用扩展 `storage.session`；无 Cookie、storage.local / sync、页面 localStorage / sessionStorage、IndexedDB、eval 或 new Function。
- 内容脚本技术上具有页面 DOM 访问能力；不采集正文依赖实际源码和验证，不宣称浏览器权限层完全禁止读取。
- `selfWorkMs` 不等于浏览器的全部渲染、观察回调和页面脚本成本，不能仅凭该值小就判定无性能问题。

## 换窗交接与历史校准

「准备换窗交接」只向输入框填入结构化提炼指令，由用户确认后发送；不自动发送、不新建聊天，**不会压缩当前服务端上下文**。交接保护当前身份、已验证/待处理状态、下一步及停点。

可选导入 OpenAI conversations.json / 单会话 JSON 或 Context Bridge JSON，在本地提取结构元数据；多会话文件按当前 conversation ID 精确匹配，失败不猜。历史深度也不等于模型上下文占用。

## 安装候选与验证

使用安装 ZIP，或仓库 `extension/` 目录。在 Chrome / Edge 扩展管理页开启开发者模式并加载该目录；更新原安装位置，不同时启用两份。保存未发送内容后刷新已有 ChatGPT 标签页，核对 Popup 版本。

Node.js 20+：

```bash
npm test
npm run check
```

既有自动化测试之外，新增滚动几何行为测试，覆盖未测量降级、尺寸保持、热回调无样式写入、宽度失效、关闭清理和观察器释放。

**真实浏览器验收 PENDING：** 保留 v1.7.0 vs v1.7.1 A/B 对诊断负担的验收债务；再以同一长会话、相近机器负载比较 v1.7.1 vs v1.7.2 的拖动滚动条、上下往返、选择/复制、发送/生成、缩放/窗口改宽与关闭优化。分别检查布局跳动、长帧、输入响应和诊断负担。合成环境通过不升级为用户机器已解决，不合并 main、不发布 Stable，直至相应授权与验收成立。

主要目标是 Chromium 桌面浏览器。Firefox / Safari 的 API 和打包支持须分别验证。ChatGPT DOM 不是稳定公开 API；缺少可靠识别时宁可少做。本项目不是 OpenAI 官方产品。
