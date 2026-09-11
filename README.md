# ChatGPT 页面性能助手

当前候选版本：**v1.7.1**

这是一个本机运行的 ChatGPT 长聊天页面性能辅助扩展。目标不是“测模型还剩多少上下文”，而是尽量减少扩展自身对繁忙页面的干扰、记录偶发卡顿附近的可验证性能证据，并在窗口持续变重时提供安全的换窗交接路径。

> 页面压力 ≠ 模型上下文占用。ChatGPT 没有向网页提供可验证的实时模型上下文占用数据；无法可靠获得时，本扩展始终显示 `UNKNOWN`，不会伪造百分比。

## v1.7.1：诊断黑匣子候选

v1.7.1 在 v1.7.0 自让路与远屏冷却基线上增加低开销 **诊断黑匣子**。本候选不修改 v1.7.0 的 cold-turn 优化阈值或推荐策略，目的是先把“发送瞬间 / 流式生成 / 滚动恢复”附近的性能时间线抓完整，再依据证据做后续修复。

黑匣子记录的是固定容量、固定时间窗口的性能元数据，包括：

- 发送标记：Enter / submit；Shift+Enter 和输入正文不会被记录；
- Long Animation Frame / Long Task 的耗时和浏览器已提供的布局/脚本归因；
- Event Timing、DOM mutation 速率、页面压力、运行状态和扩展自耗时；
- 节流后的滚动位置事件，用于关联“拖右侧滚动条后恢复”的现场；
- 严重长帧事件簇，而不是只保留最后一个长帧。

它**不记录聊天正文、输入内容、助手正文、DOM HTML、剪贴板或网络载荷**。

### 一键抓取

Popup 的「诊断黑匣子」提供三个显式动作：

- **导出最近发送现场**：以最近发送标记为中心导出前后事件窗口；
- **导出最近10分钟**：导出当前 bounded timeline；
- **标记刚才卡顿**：恢复后手动留下事故标记，便于后续分析。

JSON 只在用户点击导出时本地序列化成 Blob；扩展不自动上传，也不申请 `downloads` 权限。

## 会话级检查点

v1.7.1 新增 MV3 service worker，只负责会话级诊断检查点。它使用扩展的 **`storage.session`**，而不是 `storage.local` / `storage.sync`、页面 localStorage/sessionStorage 或 IndexedDB。

检查点具有以下边界：

- 每个标签页只保留一个 bounded checkpoint，事件上限与内存黑匣子一致；
- 只在页面回到 `quiet` 后，从现有低频 update 路径异步保存；
- 发送、滚动、PerformanceObserver 回调里不做 storage 写入或 JSON 序列化；
- 刷新后可恢复已经保存的会话证据，并按墙钟时间把旧事件重映射到新的 `performance.now()` 时间轴；
- 如果旧 checkpoint 异步返回时页面已经产生新事件，恢复逻辑会按时间重新排序，避免时间线倒置；
- 连续检查点失败达到保护阈值后，自动暂停可选保存，但页面内存记录继续工作。

**已保存到 session checkpoint 的事件可以跨页面刷新恢复，但尚未进入检查点的事件仍可能丢失。** 因此硬卡死后立刻重载页面，不能保证保存最后几秒；Popup 不会把这种情况误报成“完整现场已保存”。扩展禁用、重载、更新或浏览器会话结束后，`storage.session` 数据也会按浏览器会话语义清除。

## 性能硬约束

为了避免“诊断工具本身制造卡顿”，v1.7.1 把以下规则做成自动化回归门禁：

- 发送 / scroll / PerformanceObserver 热路径只做 bounded 内存记录；
- 热路径禁止 `JSON.stringify`、extension storage 写、DOM 全量扫描以及强制布局读取；
- 黑匣子 recorder 使用固定容量环形结构，热追加不使用 front `shift/splice`；
- 不新增 recurring monitor timer，仍保持原有 3 个 interval；
- popup 黑匣子状态只在打开时读取一次，不能塞入原有 2 秒页面指标轮询；
- session checkpoint 只能在安静状态低频执行，并带失败熔断。

这些自动化门禁能证明实现没有明显违反设计约束，但**不能替代真实浏览器性能验收**。

## v1.7.0 基线能力保持不变

### 页面越忙，扩展自己越让路

运行状态分为 `quiet / generating / scrolling / busy / background`。发送、输入等交互后有保护窗；生成、滚动和高 mutation/长帧期间，主动布局工作让路。

### 远屏历史消息只在安全条件下冷却

只有经 `IntersectionObserver` 确认远屏、已稳定、不是最近消息、最近未 mutation 且页面不繁忙的历史 turn 才能进入 cold 状态。浏览器无法可靠判断时宁可不冷却，不做批量布局扫描。

## 换窗交接

Popup 中的 **准备换窗交接** 会把结构化提炼指令填入当前 ChatGPT 输入框，由当前模型基于它已经持有的会话上下文生成新窗口交接包。

交接模板要求显式区分 `CURRENT / VERIFIED / PENDING / BLOCKED / HISTORICAL / REJECTED`，并优先保护 repo、branch、exact SHA、version、test result、下一步和 Stop Rule。

**它不会压缩当前服务端上下文本体。** 这是“旧窗口提炼 → 用户确认 → 新窗口继续”的 handoff，不是把当前会话的服务端 token 原地缩小。扩展不会自动点击发送、模拟 Enter 或新建聊天。

## 安全与隐私

v1.7.1 候选保持：

- 零网络请求、零遥测；
- 不读取或持久化聊天正文；
- 仅新增 `storage` 权限，用途严格限定为 `storage.session` 诊断检查点；
- 无 `storage.local` / `storage.sync` / localStorage / sessionStorage / IndexedDB；
- 无 Cookie API；
- 无 `eval` / `new Function`；
- 内容脚本仍只注入 `https://chatgpt.com/*`。

service worker 的职责仅是接收经过清洗、固定上限的性能 checkpoint；内容脚本不直接访问 extension storage。

## 历史深度校准

可选导入 OpenAI 官方 `conversations.json` / 单会话 JSON 或 Context Bridge JSON。扩展只在本机提取结构元数据做历史深度工程估算。多会话文件无法按当前 conversation ID 精确定位时会 Fail-Closed，不猜测“最像哪个会话”。历史深度仍然不等于模型上下文占用。

## 安装开发版

1. 获取仓库的 `extension/` 目录。
2. Chrome / Edge / Brave 打开扩展管理页。
3. 开启开发者模式。
4. 选择“加载已解压的扩展程序”。
5. 指向 `extension/` 目录。
6. 已经打开的 ChatGPT 标签页需要刷新一次，让新版 content script 生效。

## 自动化验证

需要 Node.js 20+：

```bash
npm test
npm run check
```

测试覆盖 recorder 边界、发送/滚动热路径、LoAF 归因、异步恢复排序、session checkpoint、安全权限、popup 一键导出、原有运行状态/远屏冷却/handoff 以及版本一致性。

## 浏览器验收状态

**PENDING。** v1.7.1 当前是诊断候选，不等于“卡屏已经修复”。必须做同一长窗口、相近输出长度和相近持续时间的 **v1.7.0 vs v1.7.1 A/B**，确认黑匣子没有让真实浏览器性能明显变差；之后还要用下一次真实卡屏导出的 send-centered timeline 验证证据质量。

因此当前状态是：自动化安全/性能门禁可以 GREEN，真实浏览器性能结论仍保持 PENDING。PR 在完成 A/B 前保持 Draft，不合并 `main`。

## 兼容与边界

主要目标浏览器：Chrome / Edge / Brave（Chromium）。Firefox/Safari 保留 WebExtension 命名空间兼容，但性能 API 与 `storage.session` 支持程度可能不同；缺少可靠能力时安全降级或显示 `UNKNOWN`。

ChatGPT DOM 不是稳定公开 API。页面结构变化后，扩展优先失效为“少做/不做”，而不是猜测操作错误节点。

本项目不是 OpenAI 官方产品。
