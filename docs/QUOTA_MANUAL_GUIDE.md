# TokenTrail 账号额度接入说明

TokenTrail 只展示官方接口、本地官方 CLI 或用户明确手动录入的数据。API Key、OAuth Token 和 Cookie 不会写入额度快照；用户在界面输入的 API 密钥保存在 macOS 钥匙串，SQLite 仅保存 Team ID、Project ID、Base URL 等非敏感配置。

## Provider 能力边界

| Provider | 推荐授权 | 可自动读取 | API Key 的作用 |
| --- | --- | --- | --- |
| Codex | 本地 Codex CLI 登录 | `~/.codex/sessions` 中的 5 小时/每周窗口 | 普通 OpenAI API Key 不等于 ChatGPT/Codex 订阅额度 |
| Gemini | 点击按钮后在可见终端运行 Gemini CLI，并由 CLI 打开 Google 登录页 | 仅在官方 CLI/账号仍提供可读模型额度时 | AI Studio Key 用于调用 Gemini API，不能推导 Google AI Pro/Ultra 剩余额度 |
| Grok | 点击按钮后在可见终端运行 `grok login --oauth` | 复用 Grok CLI OAuth，读取 `cli-chat-proxy.grok.com/v1/billing` 返回的订阅 Credits / 月度用量 | xAI Management Key + Team ID 可查 API 预付余额和月度账单，不是 Grok 网页订阅额度 |
| GLM | Coding Plan Token / `ANTHROPIC_AUTH_TOKEN` | Coding Plan 5 小时额度及官方返回的 MCP 用量 | 只有可访问 Coding Plan monitor 接口的 Token 才能读套餐额度 |
| Kimi | 点击按钮后在可见终端运行 `kimi login`，或填写 Kimi Code 控制台 Key | Kimi Code `/coding/v1/usages` 订阅窗口、加油包 | Kimi Code Key 可读 Coding Plan；Moonshot Open Platform Key 只查开放平台钱包，二者不能混用 |

> 项目中的 `grok` 指 xAI Grok，不是 GroqCloud。若要接入 GroqCloud，需要新增独立 Provider。

## 状态含义

| 状态 | 含义 |
| --- | --- |
| `healthy` | 官方数据，用量未到告警线 |
| `warning` / `critical` / `exhausted` | 窗口大约用到 80% / 95% / 100% |
| `auth_error` | 登录过期或被拒绝，需要重新登录 |
| `not_configured` | 没有 CLI 登录，也没有可用 Key |
| `unsupported` | 已登录，但这个账号没有可读额度（例如 Gemini 没有 GCP 配额项目） |
| `unsupported_version` | 官方返回结构变了，不会编造百分比 |
| `stale` / `network_error` | 保留上次成功快照；刷新失败或数据过旧 |
| `manual` | 用户自己录入的数字 |

## 授权流程

1. 打开「账号额度」→「手动获取 / 配置」。
2. 选择 Provider，点击对应的「打开终端并登录 …」或「发起连接并验证授权」。
3. Codex、Grok、Gemini、Kimi 在未登录时会打开一个可见的 macOS 终端窗口：
   - Codex CLI 会打开 ChatGPT 官方登录页（`codex login`）；
   - Grok CLI 会打开 `auth.x.ai` 浏览器登录页；
   - Gemini CLI 会要求选择 `Sign in with Google`，再打开浏览器；
   - Kimi CLI 会打开或提示官方登录页。
4. TokenTrail 每两秒检查本地官方 CLI 登录态，成功后自动刷新额度；三分钟超时后可重试。

如果 TokenTrail 没有成功打开授权窗口，可以自己在终端执行完全相同的官方命令。登录完成后回到额度中心点击刷新即可：

```bash
codex login
grok login --oauth
gemini
kimi login
```

Gemini 启动后选择 `Sign in with Google`。这些命令只负责登录；TokenTrail 不会接管密码、验证码或浏览器 Cookie。

授权窗口必须保持可见，避免把设备码、浏览器链接或失败原因静默吞掉。TokenTrail 不读取浏览器 Cookie，也不提供伪造数值的“提取脚本”。

## 已知限制

- Grok 订阅读取依赖 Grok CLI 当前使用的 billing 服务；如果服务端改变结构，TokenTrail 会显示“版本待升级”，不会把登录成功误报为额度读取成功。
- Gemini CLI 的 Google 登录和可用套餐由 Google 当前客户端及账号策略决定。账号要求 Cloud Project 时，需填写 Project ID；旧客户端被停用时需先更新官方 CLI。
- Kimi CLI OAuth 过期会明确显示“鉴权失效”；重新执行 `kimi login` 即可。Kimi Code Key 与 Moonshot 开放平台 Key 属于不同产品。
- 普通推理 API Key 通常只能证明 API 可调用。只有 Provider 另行开放余额/账单/套餐接口时，TokenTrail 才能显示“剩余额度”。
- 手动录入始终标记为 `manual`，不会冒充实时官方数据。

## 数据来源

- `local_session`：本地官方会话记录。
- `local_cli`：本地官方 CLI 登录态或本地服务。
- `official_api`：Provider 官方余额、账单或套餐接口。
- `manual`：用户明确输入的快照。
- `unavailable`：未配置或 Provider 未提供可读取接口。
