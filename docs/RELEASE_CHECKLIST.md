# 发布检查表

每次 Tag / Release 前逐项完成：

- [ ] `manifest.json`、Popup 页脚、CSS 注释、CHANGELOG 版本一致。
- [ ] `npm test` 全绿。
- [ ] `npm run check` 全绿。
- [ ] 安全守卫确认无联网、持久化存储、Cookie、动态代码执行能力。
- [ ] 检查 `git diff`，确认没有会话导出、Token、Cookie、私钥、`.env` 等敏感材料。
- [ ] Chromium 实机加载已解压扩展，打开/刷新 ChatGPT 后 Popup 正常连接。
- [ ] 长聊天优化开/关均可恢复，且不会删除正文。
- [ ] 至少验证主 DOM 选择器；结构变化时 fallback/UNKNOWN 行为符合 Fail-Closed。
- [ ] 安装 ZIP 仅包含：`manifest.json core.js monitor.js styles.css popup.html popup.css popup.js`。
- [ ] 对安装 ZIP 计算 SHA-256 并写入 Release notes。
- [ ] Tag、Release 标题、CHANGELOG 版本一致。
- [ ] 兼容证据不足时使用 Pre-release，不标 Stable。

## v1.6.1 首发额外验收

- [ ] Chrome / Edge 最新稳定版至少一项真实运行。
- [ ] Firefox 最新稳定版做 browser namespace / Popup 消息实测。
- [ ] 若发 Firefox AMO 包，使用专用 manifest 补 `gecko.id` 与 `data_collection_permissions`。
- [ ] Safari 只有完成 Xcode 打包和实机验收后才声明支持。
