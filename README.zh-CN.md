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
- **适配 AI 编程工作流**：支持 Claude Code、Codex、VibeCafe 类工具，以及任何能调用 API/CLI 的本地工具。
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

TokenTrail 有三种采集方式。前两种在同步时自动执行；第三种需要来源工具主动调用 API。

### 本地文件自动扫描（无需工具配合）

TokenTrail 直接读取本地用量记录文件，开箱即用 — Claude Code 和 Codex 本身不需要做任何配置。

| 工具 | 扫描路径 |
| --- | --- |
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

### VibeCafé API（需要 VibeCafé 账号）

OpenClaw、Hermes、Lobster 等 VibeCafé 兼容工具会自动向 VibeCafé 上报用量，TokenTrail 再从 VibeCafé API 拉取 — 来源工具本身不需要做额外配置。

| 工具 | 说明 |
| --- | --- |
| OpenClaw | 自动上报到 VibeCafé；TokenTrail 从 API 拉取 |
| Hermes | 自动上报到 VibeCafé；TokenTrail 从 API 拉取 |
| Lobster | 自动上报到 VibeCafé；TokenTrail 从 API 拉取 |

**前提条件：** 需要 VibeCafé 账号和 API Key，添加到 `~/.tokentrail/config.json`：

```json
{
  "server_url": "http://localhost:3820",
  "vibecafe_api_key": "your-api-key"
}
```

**没有 VibeCafé 账号：** OpenClaw、Hermes 等工具的数据不会出现在 Dashboard 中，除非它们直接向 TokenTrail 上报（见下文）。

### HTTP / CLI 直接上报（工具需主动调用）

任何工具都可以通过 HTTP API 或 CLI 命令直接向 TokenTrail 上报用量。适用于本地扫描不支持、也没有接入 VibeCafé 的工具。

```bash
# CLI
npx tokentrail report --source openclaw --model gpt-4.1 --input 5000 --output 1200

# HTTP API
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
