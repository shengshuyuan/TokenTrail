# TokenTrail

<div align="center">

**面向 Claude Code、Codex 和自定义 AI 工具的本地 token 用量统计面板。**

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

---

TokenTrail 帮你看清 AI 编程工具的 token 消耗流向。它可以读取 Claude Code 和 Codex 的本地用量记录，也支持其他工具通过 HTTP API 或 CLI 上报数据；所有数据保存在本机 SQLite 中，并在 Dashboard 里展示费用趋势、模型分布、来源健康、项目归因和原始记录。

![TokenTrail Dashboard](./docs/assets/tokentrail-dashboard.png)

## 为什么需要 TokenTrail

- **默认本地优先**：用量数据留在你的电脑上，不需要云账号。
- **适配 AI 编程工作流**：支持 Claude Code、Codex，以及任何通过 SDK 或 HTTP API 接入的本地工具。
- **费用和 token 可见**：按日期、模型、来源、项目查看消耗，不再只靠账单猜测。
- **数据可检查**：可以查看原始记录、同步结果、重复数、错误数和来源健康状态。
- **macOS 后台常驻**：通过 LaunchAgent 登录后自动启动服务和定时同步。
- **隐私友好的项目展示**：需要录屏或共享屏幕时，可以隐藏项目名称。

## 你能看到什么

| 模块 | 展示内容 |
| --- | --- |
| 用量 Dashboard | 日/月 token 和费用趋势、模型分布、来源对比 |
| 项目统计 | 按项目查看消耗，并支持隐藏项目名称 |
| 来源健康 | Claude Code、Codex、API 同步状态、最近同步结果、重复/错误数量 |
| 原始记录 | 可追溯的用量明细，方便审计和排查 |
| 模型定价 | 内置常见模型价格，未知模型自动注册 |
| API 和 CLI | 让脚本、Agent、本地服务或其他工具主动上报用量 |

## 快速开始

### 1. 安装并本地运行

```bash
git clone https://github.com/shengshuyuan/TokenTrail.git
cd TokenTrail
npm install
npm run dev
```

打开 **http://localhost:3820**。

### 2. 初始化并同步

```bash
npm run setup
npm run sync
```

这会扫描 Claude Code 日志（`~/.claude/projects/`）、Codex 会话（`~/.codex/sessions/`），以及可选的 VibeCafe 兼容用量数据。

### 3. 安装 macOS 后台服务

```bash
npm run install-service
npm run doctor
```

服务会在 `~/.tokentrail/runtime/TokenTrail` 创建运行副本，让 Dashboard 常驻在 `3820` 端口，并在后台定时同步数据。

## 数据来源

TokenTrail 完全自包含，不依赖任何外部平台。数据如何到达取决于工具类型：

### 本地文件扫描（TokenTrail 主动读取，工具无需配合）

对于已经在本地存储用量数据的工具，TokenTrail 直接读取文件，工具本身不需要知道 TokenTrail 的存在。

| 工具 | 扫描路径 |
| --- | --- |
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

### 主动上报（工具必须在每次模型调用后接入）

对于 OpenClaw、Hermes、Lobster 和自定义 Agent，TokenTrail 无法自行获取用量数据。**这些工具必须在每次模型 API 调用返回后，把真实的 `response.usage` 上报给 TokenTrail。** 不接入就没有数据。

工具从模型响应中读取 `response.usage`，POST 到 TokenTrail。上报失败不能影响主业务。

#### 方式 1：包装 OpenAI 客户端（推荐，自动上报）

如果工具使用 OpenAI 兼容 SDK，启动时包装一次即可。之后每次 `chat.completions.create()` 调用自动从 `response.usage` 读取真实用量并上报。

```js
const OpenAI = require('openai')
const { wrapOpenAI } = require('tokentrail-report')

// 启动时包装一次
const client = wrapOpenAI(new OpenAI(), { source: 'hermes' })

// 后续调用无需任何改动，用量自动上报
const res = await client.chat.completions.create({ model: 'gpt-4.1', messages: [...] })
```

SDK 从响应中读取 `res.model`、`res.usage.prompt_tokens`、`res.usage.completion_tokens`、`res.id`。

#### 方式 2：每次模型调用后 HTTP 上报

如果无法使用 SDK 包装，在模型 API 响应返回后手动上报。使用 `response.usage` 中的真实值，不要估算。

```js
// 模型调用完成后
const res = await callModel(...)

// 上报到 TokenTrail（fire-and-forget，不阻塞主流程）
fetch('http://localhost:3820/api/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: 'openclaw',
    model: res.model,                          // 响应中的实际模型名
    input_tokens: res.usage.prompt_tokens,      // 真实用量，非估算
    output_tokens: res.usage.completion_tokens,
    cached_input_tokens: res.usage.prompt_tokens_details?.cached_tokens || 0,
    reasoning_tokens: res.usage.completion_tokens_details?.reasoning_tokens || 0,
    request_id: res.id,
    project: 'my-project',
    timestamp: Date.now()
  })
}).catch(() => {})
```

**流式调用注意：** 用量数据在最后一个 chunk 中。需要开启 `stream_options: { include_usage: true }`，在流结束后从最后一个 chunk 读取 `usage`。

#### 方式 3：本地 OpenAI 代理（工具零代码改动）

如果工具支持修改 OpenAI `baseURL`，指向 TokenTrail 本地代理即可。TokenTrail 转发请求到真实 API，并从响应中记录用量。

```bash
OPENAI_BASE_URL=http://localhost:3820/proxy/openai
```

工具的 API Key 会透传给上游 API，不需要改代码。

### 集成责任说明

| 工具 | 谁负责采集数据 | 是否需要工具接入 |
| --- | --- | --- |
| Claude Code | TokenTrail 扫描本地 JSONL | 不需要 |
| Codex | TokenTrail 扫描本地 JSONL | 不需要 |
| OpenClaw | OpenClaw 读取 `response.usage` 并上报 | **必须接入** |
| Hermes | Hermes 读取 `response.usage` 并上报 | **必须接入** |
| 任意新工具 | 工具读取 `response.usage` 并上报 | **必须接入** |

### 接入指令（可直接复制给其他工具）

把这段话发给需要接入的工具：

> 每次模型调用完成后，把模型返回的真实 `response.usage` 上报到本机 TokenTrail：
> `POST http://localhost:3820/api/report`
>
> `source` 填你的工具名，`provider` 填实际模型服务商，`model` 填实际模型名，
> `input_tokens`/`output_tokens` 从 `response.usage` 读取。不要估算，上报失败不能影响主流程。

最小请求体：

```json
{
  "source": "openclaw",
  "provider": "xiaomi",
  "model": "mimo-v2.5-pro",
  "input_tokens": 5000,
  "output_tokens": 1200
}
```

如果用 OpenAI 兼容 SDK，包装一次客户端即可：

```js
const { wrapOpenAI } = require('tokentrail-report')
const client = wrapOpenAI(new OpenAI(), { source: 'hermes' })
```

`source`、`model`、`input_tokens` 为必填。建议传入 `request_id` 用于去重。`provider` 可选（如 `openai`、`xiaomi`、`anthropic`）。未知模型会先以 `$0` 价格创建，之后可以通过定价接口补充价格。

#### 环境变量

设置 `TOKENTRAIL_URL` 让 SDK 和工具自动发现 TokenTrail 端点：

```bash
export TOKENTRAIL_URL=http://localhost:3820
```

未设置时 SDK 默认使用 `http://localhost:3820`。

### 可选：VibeCafé API

如果你有 VibeCafé 账号，TokenTrail 也可以从 VibeCafé API 拉取用量数据。这是为现有 VibeCafé 用户提供的便利功能，不是必须的。在 `~/.tokentrail/config.json` 中添加 API Key：

```json
{
  "server_url": "http://localhost:3820",
  "vibecafe_api_key": "your-api-key"
}
```

## CLI 命令

| 命令 | 说明 |
| --- | --- |
| `npm run setup` | 初始化 CLI 配置并测试服务器连接 |
| `npm run sync` | 立即同步所有数据源 |
| `npm run status` | 查看服务器状态和数据统计 |
| `npm run doctor` | 运行完整本地健康诊断 |
| `npm run open` | 在浏览器中打开 Dashboard |
| `npm run backup` | 手动备份 SQLite 数据库 |
| `npm run restart` | 重启 macOS 常驻服务 |
| `npm run install-service` | 安装 macOS LaunchAgent 服务 |
| `npm run uninstall-service` | 移除服务但保留数据 |

## 项目结构

```text
TokenTrail/
├── bin/tokentrail.js          # CLI
├── scripts/serve.js           # 本地服务入口
├── packages/
│   └── tokentrail-report/     # 轻量 SDK，供其他工具上报用量
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── proxy/openai/  # 本地 OpenAI 兼容代理
│   │   │   ├── report/        # 用量上报端点
│   │   │   ├── sync/          # 数据同步触发
│   │   │   └── ...            # health, status, stats, backup, pricing
│   │   └── ...
│   ├── components/dashboard/  # Dashboard UI
│   └── lib/
│       ├── db.ts              # SQLite 数据层
│       ├── sync.ts            # 多来源同步引擎
│       └── pricing.ts         # 费用计算
└── data/token-trail.db        # 本地 SQLite 数据库，已 gitignore
```

## 本地文件位置

| 路径 | 说明 |
| --- | --- |
| `~/.tokentrail/config.json` | CLI 配置文件 |
| `~/.tokentrail/runtime/TokenTrail/` | 与项目/云同步目录隔离的运行副本 |
| `~/.tokentrail/backups/` | 数据库备份 |
| `~/.tokentrail/logs/` | 服务和同步日志 |
| `~/Library/LaunchAgents/*tokentrail*` | macOS 服务定义文件 |
| `data/token-trail.db` | 项目本地 SQLite 数据库 |

## 故障排查

```bash
npm run doctor      # 检查服务、数据库、常驻任务、同步和配置
npm run sync        # 手动同步一次
npm run restart     # 重启 macOS 常驻服务
```

如果数据看起来不对，优先查看原始记录和同步结果。TokenTrail 会展示重复数和错误数，方便区分数据缺失、重复导入和模型定价缺口。

## 技术栈

- Next.js 14、React 18、Recharts、Tailwind CSS
- SQLite（better-sqlite3）
- macOS LaunchAgent 可选常驻服务
- Node.js CLI，无外部 CLI 框架依赖

## 许可证

MIT
