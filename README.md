# 嗨番小智 · HiFun Agent H5

嗨番集团是一家专注于口感番茄的产业运营商。

嗨番小智采用 React/Vite H5、Express 后端和 Pi Agent。用户请求先进入 Agent，由其选择图像诊断、知识检索或澄清。诊断引擎通过独立服务的契约复用。

## 本地运行

需要 Node.js >=22.19.0，建议与 Docker 一致使用 Node 24。

```sh
npm ci
cp .env.example .env
npm run dev
```

默认 demo 模式不调用云服务，访问 http://127.0.0.1:1842。`npm run check` 执行离线测试与生产构建。真实模式需配置经授权的服务端凭据；浏览器不持有密钥，真实图片联调须明确授权具体图片和目的地。

## 产品与目录

匿名临时会话，两小时无有效交互过期；有效期内支持同浏览器恢复、单图、补图和追问。不提供账号登录或长期会话数据库。

- `src/`：聊天界面与主题。
- `server/`：会话、Pi 编排、受控工具与清理任务。
- `skills/`：身份和业务技能规则。
- `knowledge/`：公开知识库的固定 Markdown 快照。
- `contracts/`、`tests/`：诊断契约和合成数据回归测试。
- `deploy/`、`Dockerfile`：应用打包和部署工具。

## 维护与发布

应用仓库：https://github.com/woshiyjy/HiFun_Agent_WebUI_H5 。知识维护源：https://github.com/woshiyjy/OSS_Docs 。

知识网站独立发布。应用正式发布前检查知识源，审查并固定快照，随后测试、提交，再用同一提交构建镜像。详见 [发布流程](RELEASING.md) 和 [知识更新说明](knowledge/README.md)。

内部项目记忆、运维记录、凭据、会话、原图与历史验证材料仅在本地保留，不属于公开仓库。临时对象清理依赖应用运行和失败重试，目前没有独立于应用的 OSS 生命周期兜底。
