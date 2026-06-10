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

TokenTrail 完全自包含。数据采集有两种方式：本地文件自动扫描，和通过 SDK 或 HTTP API 主动上报。不需要依赖任何外部服务。

### 本地文件自动扫描

TokenTrail 直接读取本地用量记录文件，来源工具不需要知道 TokenTrail 的存在。

| 工具 | 扫描路径 |
| --- | --- |
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

### SDK 和 API 集成（用于其他工具）

对于用量数据不在本地文件中的工具（OpenClaw、Hermes、Lobster、自定义 Agent 等），TokenTrail 提供轻量 SDK 和 HTTP API，由来源工具直接上报 — 不经过任何第三方服务。

#### 方式 1：`tokentrail-report` npm 包（推荐）

零依赖 SDK，通过 `TOKENTRAIL_URL` 环境变量自动发现 TokenTrail 端点（默认 `http://localhost:3820`）。

```bash
npm install tokentrail-report
```

```js
const { report } = require('tokentrail-report')

await report({
  source: 'openclaw',
  model: 'gpt-4.1',
  input_tokens: 5000,
  output_tokens: 1200,
  project: 'my-project',
})
```

#### 方式 2：包装 OpenAI 兼容客户端

如果工具使用 OpenAI 兼容 SDK，包装一次后每次 `chat.completions.create()` 调用都会自动上报用量。

```js
const OpenAI = require('openai')
const { wrapOpenAI } = require('tokentrail-report')

const openai = wrapOpenAI(new OpenAI(), { source: 'openclaw' })

// 之后每次调用自动上报
const res = await openai.chat.completions.create({ model: 'gpt-4.1', messages: [...] })
```

#### 方式 3：HTTP API

任何能发 HTTP 请求的工具都可以直接上报。

```bash
curl -X POST http://localhost:3820/api/report \
  -H 'Content-Type: application/json' \
  -d '{"source":"openclaw","model":"gpt-4.1","input_tokens":5000,"output_tokens":1200}'
```

最小 API 数据结构：

```json
{
  "source": "custom-agent",
  "model": "gpt-4.1",
  "input_tokens": 5000,
  "output_tokens": 1200,
  "request_id": "unique-id-for-dedup",
  "project": "my-project",
  "timestamp": 1718000000000
}
```

`source`、`model`、`input_tokens` 为必填。建议传入 `request_id` 用于去重。未知模型会先以 `$0` 价格创建，之后可以通过定价接口补充价格。

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
│   ├── app/                   # Next.js Dashboard 和 API 路由
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
