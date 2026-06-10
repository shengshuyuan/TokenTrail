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

TokenTrail 完全自包含，不依赖 VibeCafé 或任何外部平台。数据如何到达取决于工具类型：

### 本地文件扫描（TokenTrail 主动读取，工具无需配合）

对于已经在本地存储用量数据的工具，TokenTrail 直接读取文件，工具本身不需要知道 TokenTrail 的存在。

| 工具 | 扫描路径 |
| --- | --- |
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

### OpenClaw / Hermes 接入

**核心原则：** TokenTrail 不负责猜测 token 用量。OpenClaw / Hermes 必须在模型响应完成后，读取模型服务商返回的真实 usage，再交给 TokenTrail。拿不到真实 usage 时，不要写 0，不要估算，直接跳过本次用量记录。

#### 推荐方式：本地 JSONL 文件

OpenClaw 每次模型调用完成后，追加一行 JSON 到 `~/.openclaw/usage/YYYY-MM-DD.jsonl`。
Hermes 每次模型调用完成后，追加一行 JSON 到 `~/.hermes/usage/YYYY-MM-DD.jsonl`。
TokenTrail 在执行同步时会扫描这些文件并导入数据。

标准 JSONL 字段：

```json
{
  "source": "openclaw",
  "provider": "xiaomi",
  "model": "mimo-v2.5-pro",
  "input_tokens": 5000,
  "output_tokens": 1200,
  "cached_input_tokens": 0,
  "reasoning_tokens": 0,
  "request_id": "provider-response-id-or-generated-id",
  "project": "optional-project-name",
  "timestamp": 1718000000000
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `source` | 是 | 工具名：`openclaw` 或 `hermes` |
| `provider` | 是 | 模型服务商：`openai`、`anthropic`、`xiaomi`、`zhipu`、`deepseek`、`qwen`、`google`、`minimax` 等 |
| `model` | 是 | 实际请求或响应中的模型 ID，不要写死 |
| `input_tokens` | 是 | 真实输入 token 数 |
| `output_tokens` | 是 | 真实输出 token 数 |
| `cached_input_tokens` | 否 | 缓存输入 token 数，没有则 0 |
| `reasoning_tokens` | 否 | 推理 token 数，没有则 0 |
| `request_id` | 强烈建议 | 用于去重；优先使用 provider response ID |
| `project` | 否 | 当前项目或工作区名称 |
| `timestamp` | 否 | 调用完成时间，Unix 毫秒时间戳 |

**重要要求：**

1. 必须在模型响应完成后写入，不要在请求前写入。
2. 必须使用真实 usage，不要估算。
3. 如果 response 中没有 usage，跳过本次写入，不要写 `input_tokens=0`。
4. 写入失败不能影响模型调用主流程。
5. JSONL 每行必须是一个完整 JSON 对象。
6. 多 provider 需要在 OpenClaw / Hermes 内部把不同字段归一化成 TokenTrail 标准字段。
7. streaming 调用需要在流结束后读取最终 usage；如果 OpenAI-compatible provider 支持，请开启 `stream_options.include_usage`。
8. TokenTrail 只扫描和导入标准记录，不依赖 VibeCafé 或任何外部服务。

#### 替代方式：包装 OpenAI 客户端（适用于使用 SDK 的工具）

如果工具使用 OpenAI 兼容 SDK，包装一次后每次调用自动上报用量。

```js
const OpenAI = require('openai')
const { wrapOpenAI } = require('tokentrail-report')

const client = wrapOpenAI(new OpenAI(), { source: 'hermes' })
const res = await client.chat.completions.create({ model: 'gpt-4.1', messages: [...] })
```

#### 替代方式：本地 OpenAI 代理（工具零代码改动）

如果工具支持修改 OpenAI `baseURL`，指向 TokenTrail 本地代理即可：

```bash
OPENAI_BASE_URL=http://localhost:3820/proxy/openai
```

工具的 API Key 会透传给上游 API，不需要改代码。

#### Node.js 示例

```js
const fs = require('fs')
const path = require('path')

function writeTokenTrailUsage(entry, toolName) {
  const home = process.env.HOME || process.env.USERPROFILE
  if (!home) return
  const dir = path.join(home, `.${toolName}`, 'usage')
  fs.mkdirSync(dir, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  fs.appendFileSync(path.join(dir, `${date}.jsonl`), JSON.stringify(entry) + '\n')
}

// 模型响应完成后调用
const usage = response.usage
if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
  writeTokenTrailUsage({
    source: 'openclaw',
    provider: providerName,
    model: response.model || requestedModel,
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cached_input_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    request_id: response.id || generatedRequestId,
    project: projectName,
    timestamp: Date.now()
  }, 'openclaw')
}
```

Hermes 只需要把 `source` 和 `toolName` 改成 `hermes`。

### 集成总结

| 工具 | 接入方式 | 谁负责 |
| --- | --- | --- |
| Claude Code | TokenTrail 扫描本地 JSONL | TokenTrail（自动） |
| Codex | TokenTrail 扫描本地 JSONL | TokenTrail（自动） |
| OpenClaw | 每次调用后写入 `~/.openclaw/usage/*.jsonl` | OpenClaw（必须接入） |
| Hermes | 每次调用后写入 `~/.hermes/usage/*.jsonl` | Hermes（必须接入） |
| 任意新工具 | 每次调用后写入 `~/.工具名/usage/*.jsonl` | 工具（必须接入） |

### 可选：VibeCafé API

如果你有 VibeCafé 账号，TokenTrail 也可以从 VibeCafé API 拉取用量数据。这是为现有 VibeCafé 用户提供的便利功能，不是主要接入方式。在 `~/.tokentrail/config.json` 中添加 API Key：

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
