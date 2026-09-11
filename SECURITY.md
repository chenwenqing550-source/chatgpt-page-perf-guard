# Security Policy

## 支持版本

当前只维护最新版本。首个公开版本为 v1.6.1 Pre-release。

## 威胁模型

该扩展运行在 `chatgpt.com` 的 Content Script 上，因此理论上具备读取匹配页面 DOM 的技术能力。安全目标不是声称“没有访问能力”，而是把能力限制在最小范围，并让源码可审计。

v1.6.1 的安全约束：

- 无联网 API；
- 无远程代码加载；
- 无 `eval` / `new Function`；
- 无 Cookie API；
- 无持久化浏览器存储；
- 无后台 Service Worker；
- Manifest 不声明额外 permissions / host_permissions；
- JSON 导入只解析本地文件，原始内容不上传；
- 导入上限 32 MiB；
- 多会话导出无法精确匹配当前 conversation ID 时拒绝校准。

## 不应提交的材料

Issue、PR、公开仓库中不要提交真实会话导出、Cookie、Token、API Key、Session、浏览器配置目录或其他敏感内容。若漏洞复现必须依赖真实对话，请先最小化并脱敏。

## 漏洞报告

请优先提交不包含私人数据的最小复现。高风险问题（例如出现联网外传、任意代码执行、意外读取并持久化聊天正文）应在公开披露前先私下联系维护者。
