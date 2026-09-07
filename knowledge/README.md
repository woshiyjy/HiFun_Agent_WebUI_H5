# 嗨番知识库本地快照

- 来源：https://github.com/woshiyjy/OSS_Docs
- 原文站：https://docs.wehifun.cn/
- 本次同步 commit：067b33326c3da90123b86beec613f5a55fcacde9
- 同步日期：2026-09-07；仅复制 docs 下 Markdown，不执行上游代码或工作流。
- 79 个概念条目，66 篇正文、13 篇占位；另有目录与日志。
- 上游 README 声明 OKF v0.1。当前官方规范为 v0.2：https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md 。本地读取基础 type/title/description/tags/timestamp，不声称已完成新版信任字段迁移或独立合规认证。

source 是上游只读副本，不人工编辑正文。当前采用内存中文分词及标题/正文加权检索，无向量数据库；短文保留全文，长文按段落截取相关上下文，原文链接沿用 .html 路由。占位条目不给模型提供简介作为业务证据。正文存在不代表专业审核通过，价格资料不是实时行情。

更新：将上游仓库检出到独立临时目录，审查 docs 差异，运行 `node scripts/sync-knowledge.mjs /绝对路径/OSS_Docs`；然后运行测试并重启本地服务。脚本只复制 Markdown，不连接服务器、不推送 GitHub、不执行上游构建。当前没有自动同步任务。

## 发布前检查（2026-09-07）

已检查上游 `6d922f4da2ad10e2f8bb9b0d228195d480034773`，与当前 `067b33326c3da90123b86beec613f5a55fcacde9` 的 docs 无差异，保留现有快照和同步时间，不生成重复快照。

每次正式发布必须先检查上游正文；有变化才审查并同步，随后测试和提交应用。镜像使用提交内固定快照，不在构建时追最新。知识网站 Action 继续独立发布 OSS/CDN，不再同步 ECS。完整步骤见 [发布流程](../RELEASING.md)。
