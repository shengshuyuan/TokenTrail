# TokenTrail

<div align="center">

**本地 AI 编程工具 token 用量统计面板**

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

---

TokenTrail 是一个完全本地运行的 AI token 用量追踪工具，支持从 Claude Code、Codex、VibeCafé 等多个数据源采集用量数据，存储在本地 SQLite 数据库中，并提供实时 Dashboard 展示趋势图表、费用分析和系统健康状态。

**核心优势：**
- 100% 本地运行 — 所有数据留在本机，无需云服务
- 多数据源 — 统一汇总 Claude Code、Codex、VibeCafé（OpenClaw、Hermes 等）的用量
- 自动同步 — macOS LaunchAgent 后台常驻，每 4 小时自动同步数据
- EVA 风格面板 — 暗色/亮色主题，实时图表

## 功能特性

- **多源聚合** — 从 Claude Code 本地 JSONL 日志、Codex 会话文件和 VibeCafé API 同步数据
- **Dashboard** — 交互式图表：费用趋势、模型分布、来源对比、日/月统计
- **系统状态** — 实时服务状态、数据源健康、同步历史、备份监控
- **CLI 工具** — 完整命令行界面：setup、sync、status、backup、doctor
- **macOS 原生服务** — LaunchAgent 后台常驻 + 定时同步
- **手动同步反馈** — 一键 SYNC 按钮，展示每个来源的扫描数/新增数/重复数/错误数
- **备份管理** — 手动和自动数据库备份，带轮转清理
- **费用追踪** — 内置 50+ AI 模型定价表，未知模型自动注册
- **中英双语** — 界面支持中英文切换
- **EVA 风格设计** — 终端美学，绿色/琥珀配色

## 环境要求

- **Node.js** >= 18（已在 v20.x 测试通过）
- **macOS**（LaunchAgent 服务需要 macOS；应用本身可跨平台运行）
- **Claude Code** 和/或 **Codex** 已安装（可选，用于本地数据源采集）
- **VibeCafé API Key**（可选，用于 VibeCafé 数据同步）

## 快速开始

### 1. 克隆并安装

```bash
git clone https://github.com/shengshuyuan/TokenTrail.git
cd TokenTrail
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

Dashboard 地址：**http://localhost:3820**

### 3. 初始化 CLI 配置

```bash
npm run setup
```

创建 `~/.tokentrail/config.json`，测试与本地服务器的连接。

### 4. 首次同步数据

```bash
npm run sync
```

扫描 Claude Code 日志（`~/.claude/projects/`）、Codex 会话（`~/.codex/sessions/`），以及可选的 VibeCafé API。同步结果会展示每个来源的扫描数/新增数/重复数。

### 5. 安装常驻服务（macOS）

```bash
npm run install-service
```

此命令会：
- 在 `~/.tokentrail/runtime/TokenTrail` 创建运行时副本（隔离云同步路径）
- 安装两个 LaunchAgent：
  - **服务** — 端口 3820 常驻服务（崩溃自动重启）
  - **同步** — 每 4 小时自动同步数据
- 自动打开 Dashboard

安装完成后，TokenTrail 会在登录时自动启动，无需手动操作。

### 6. 验证安装

```bash
npm run doctor
```

所有检查项应显示绿色。

## CLI 命令

| 命令 | 说明 |
|------|------|
| `npm run setup` | 初始化配置，测试服务器连接 |
| `npm run sync` | 立即同步所有数据源 |
| `npm run status` | 查看服务器状态和数据统计 |
| `npm run doctor` | 完整系统健康诊断 |
| `npm run open` | 在浏览器中打开 Dashboard |
| `npm run backup` | 手动备份数据库 |
| `npm run restart` | 重启常驻服务 |
| `npm run install-service` | 安装 macOS LaunchAgent 服务 |
| `npm run uninstall-service` | 移除服务（保留数据） |

### 手动上报用量

```bash
# 使用独立参数上报
npx tokentrail report --source my-tool --model gpt-4.1 --input 5000 --output 1200

# 使用 JSON 上报
npx tokentrail report --json '{"source":"my-tool","model":"gpt-4.1","input_tokens":5000,"output_tokens":1200}'
```

## 数据来源

| 来源 | 采集方式 | 说明 |
|------|----------|------|
| **Claude Code** | 本地文件扫描 | 读取 `~/.claude/projects/*/sessions/*.jsonl` |
| **Codex** | 本地文件扫描 | 读取 `~/.codex/sessions/**/*.jsonl` |
| **VibeCafé** | API | 从 `vibecafe.ai/api/usage` 拉取（需要 API Key） |

未知模型会自动注册，价格默认 $0。可通过 `/api/pricing` 端点更新定价。

## 项目结构

```
TokenTrail/
├── bin/tokentrail.js          # CLI 工具
├── scripts/serve.js           # 自定义服务（dev/prod）
├── src/
│   ├── app/
│   │   ├── page.tsx           # 主 Dashboard 页面
│   │   ├── api/
│   │   │   ├── health/        # 健康检查端点
│   │   │   ├── status/        # 系统状态 + 数据源健康
│   │   │   ├── sync/          # 数据同步触发
│   │   │   ├── stats/         # 用量统计
│   │   │   ├── backup/        # 手动备份
│   │   │   ├── pricing/       # 模型定价管理
│   │   │   └── report/        # 手动用量上报
│   │   └── ...
│   ├── components/dashboard/  # UI 组件
│   └── lib/
│       ├── db.ts              # SQLite 数据库层
│       ├── sync.ts            # 多源同步引擎
│       ├── pricing.ts         # 费用计算
│       └── ...
└── data/
    └── token-trail.db         # SQLite 数据库（已 gitignore）
```

## 文件位置

安装后，TokenTrail 数据存储在以下位置：

| 路径 | 说明 |
|------|------|
| `~/.tokentrail/config.json` | CLI 配置文件 |
| `~/.tokentrail/runtime/TokenTrail/` | 运行时副本（隔离于项目目录） |
| `~/.tokentrail/backups/` | 数据库备份 |
| `~/.tokentrail/logs/` | 服务和同步日志 |
| `~/Library/LaunchAgents/*tokentrail*` | macOS 服务定义文件 |
| `data/token-trail.db` | SQLite 数据库（项目根目录） |

## 故障排除

### 服务无法启动

```bash
npm run doctor        # 检查所有组件
npm run restart       # 重启服务
```

### 同步失败

```bash
npm run sync          # 手动同步
# 查看日志
cat ~/.tokentrail/logs/com.shengshuyuan.tokentrail.sync.out.log
```

### 数据不更新

如果 Dashboard 显示陈旧数据：
1. 检查服务是否运行：`npm run doctor`
2. 手动同步：`npm run sync`
3. 检查同步日志：`cat ~/.tokentrail/logs/com.shengshuyuan.tokentrail.sync.err.log`

### 完全重置

```bash
npm run uninstall-service
rm -rf ~/.tokentrail
npm run install-service
```

## 技术栈

- **前端**：Next.js 14、React 18、Recharts、Tailwind CSS
- **数据库**：SQLite（better-sqlite3）
- **服务**：macOS LaunchAgent（常驻进程 + 定时同步）
- **CLI**：Node.js（零外部 CLI 依赖）

## 许可证

MIT
