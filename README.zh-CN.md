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
npm run daemon-install
npm run daemon-status
```

服务会在 `~/.tokentrail/runtime/TokenTrail` 创建运行副本，让 Dashboard 常驻在 `3820` 端口，并在后台定时同步数据。

> 旧命令 `npm run install-service`、`npm run uninstall-service`、`npm run restart`、`npm run doctor` 仍然可用，`daemon-*` 系列只是更易读的别名。

## 数据来源

TokenTrail 完全自包含，不依赖外部平台。

### 本地扫描（自动，无需接入）

| 工具 | 扫描路径 |
| --- | --- |
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

### 其他工具（需要接入）

OpenClaw、Hermes 及其他工具，必须在每次模型调用完成后写一行 JSONL 到 `~/.<工具名>/usage/YYYY-MM-DD.jsonl`。TokenTrail 同步时自动扫描。

**核心规则：** 在模型响应完成后读取真实 `response.usage`。没有 usage 数据就跳过，不要写 0。

标准格式：

```json
{"source":"openclaw","provider":"xiaomi","model":"mimo-v2.5-pro","input_tokens":5000,"output_tokens":1200,"request_id":"id","timestamp":1718000000000}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `source` | 是 | 工具名（`openclaw`、`hermes` 等） |
| `provider` | 是 | 模型服务商（`openai`、`anthropic`、`xiaomi` 等） |
| `model` | 是 | 响应中的实际模型 ID，不要写死 |
| `input_tokens` | 是 | 真实输入 token 数 |
| `output_tokens` | 是 | 真实输出 token 数 |
| `cached_input_tokens` | 否 | 默认 0 |
| `reasoning_tokens` | 否 | 默认 0 |
| `request_id` | 建议 | 用于去重，优先用 provider response ID |
| `project` | 否 | 项目/工作区名称 |
| `timestamp` | 否 | Unix 毫秒，默认当前时间 |

Node.js 辅助函数：

```js
const fs = require('fs')
const path = require('path')

function reportUsage(toolName, data) {
  if (!data.input_tokens && !data.output_tokens) return
  const dir = path.join(process.env.HOME, `.${toolName}`, 'usage')
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(
    path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`),
    JSON.stringify(data) + '\n'
  )
}

// 模型响应完成后
reportUsage('openclaw', {
  source: 'openclaw',
  provider: 'xiaomi',
  model: response.model,
  input_tokens: response.usage.prompt_tokens,
  output_tokens: response.usage.completion_tokens,
  request_id: response.id,
  timestamp: Date.now()
})
```

Hermes 用 `reportUsage('hermes', { ... })`。

### 替代方式（适用于 SDK 工具）

OpenAI 兼容 SDK 可以直接包装：

```js
const { wrapOpenAI } = require('tokentrail-report')
const client = wrapOpenAI(new OpenAI(), { source: 'hermes' })
```

或把 `baseURL` 指向本地代理（零代码改动）：

```bash
OPENAI_BASE_URL=http://localhost:3820/proxy/openai
```

### 总结

| 工具 | 方式 |
| --- | --- |
| Claude Code | TokenTrail 扫描本地 JSONL（自动） |
| Codex | TokenTrail 扫描本地 JSONL（自动） |
| OpenClaw / Hermes / 其他 | 每次调用后写 `~/.工具名/usage/*.jsonl` |

### 可选：VibeCafé API

给已有 VibeCafé 账号的用户提供的便利功能，不是主要接入方式。在 `~/.tokentrail/config.json` 添加 API Key：

```json
{ "server_url": "http://localhost:3820", "vibecafe_api_key": "your-api-key" }
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
