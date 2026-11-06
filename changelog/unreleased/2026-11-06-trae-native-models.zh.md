# TRAE 原生模型

- **Date:** 2026-11-06
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`

[English](2026-11-06-trae-native-models.md)

新增 TRAE 模型分组，使用服务端机器已有的 TRAE CLI 登录凭据直接调用 CN TRAE 模型服务，无需单独的模型代理。

## 细节

- 新增显式模型同步入口，读取 CLI 模型目录，导入账号可用的 Standard 和 Max 版本，保留已有模型编辑和 Project 的默认模型。
- 在模型库展示 CLI 登录状态，并在对话模型选择器中提供登录有效的模型。凭据保留在服务端，每次请求重新读取；登录过期时提示重新执行 `traecli login`。
- 新增原生流式文本、思考、工具调用、工具结果回放和区分缓存的 Token 统计。在发送完成事件前释放请求，使下一次携带工具结果的请求能够启动。
- 新增宿主模型客户端注册机制，在多个 core 模块副本间共享，并为 SDK 用户提供 `@prismshadow/penguin-server/trae` 入口。
- CLI 新增模型时，若分组尚未配置协议，则采用分组声明的原生传输协议。
- 补充双语模型与配置说明。TRAE 模型价格留空，导入的模型默认关闭视觉能力。
