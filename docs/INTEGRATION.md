# TokenTrail 接入指南

TokenTrail 是本地部署的 AI 编程工具 token 用量统计面板。数据存在你自己的机器上，不上传到任何云服务。

---

## 快速开始

### 1. 启动服务

```bash
cd TokenTrail
npm install
npm run dev
```

服务将在 http://localhost:3820 启动。

### 2. 配置 CLI

```bash
npm run setup
# 或
node bin/tokentrail.js setup
```

配置保存到 `~/.tokentrail/config.json`。

### 3. 安装 Skill（推荐）

把 Skill 文件安装到 AI 工具目录，这样 AI 工具就能自动识别并调用 TokenTrail：

```bash
# Claude Code
mkdir -p ~/.claude/skills/tokentrail
cp docs/SKILL.md ~/.claude/skills/tokentrail/SKILL.md

# Cursor
mkdir -p ~/.cursor/skills/tokentrail
cp docs/SKILL.md ~/.cursor/skills/tokentrail/SKILL.md

# Windsurf
mkdir -p ~/.codeium/windsurf/skills/tokentrail
cp docs/SKILL.md ~/.codeium/windsurf/skills/tokentrail/SKILL.md
```

安装后，用户对 AI 工具说"看看用量"、"同步数据"等，AI 工具会自动调用对应的 CLI 命令。

---

## 数据上报方式

TokenTrail 支持两种数据通道：

### 通道 A：自动同步（SYNC）

点击 Dashboard 上的 **SYNC** 按钮，或运行：

```bash
tokentrail sync
```

**自动同步的数据源：**

| 数据源 | 数据位置 | 说明 |
|--------|----------|------|
| Claude Code | `~/.claude/projects/` | 扫描所有 JSONL 日志文件 |
| Codex | `~/.codex/sessions/` | 扫描所有 JSONL 会话文件 |
| VibeCafé | VibeCafé API | 拉取 OpenClaw、Hermes 等来源数据 |

**VibeCafé 同步（OpenClaw/Hermes）需要配置 API Key：**

```bash
# 首次 SYNC 时传入 API Key，会自动保存
curl -X POST http://localhost:3820/api/sync \
  -H "Content-Type: application/json" \
  -d '{"vibecafe_api_key": "your-key-here"}'
```

### 通道 B：实时上报（report）

任何工具都可以通过 HTTP 或 CLI 实时上报用量。

**CLI 方式：**

```bash
tokentrail report --source <来源> --model <模型ID> --input <输入token> [--output <输出token>]
```

**HTTP 方式：**

```bash
curl -X POST http://localhost:3820/api/report \
  -H "Content-Type: application/json" \
  -d '{
    "source": "my-tool",
    "model": "gpt-4.1",
    "input_tokens": 12500,
    "output_tokens": 3200
  }'
```

**JSON 模式（适合脚本集成）：**

```bash
tokentrail report --json '{"source":"openclaw","model":"gpt-4.1","input_tokens":5000,"output_tokens":1200}'
```

---

## 各工具接入方法

### Claude Code

Claude Code 的数据通过 SYNC 自动同步（扫描 `~/.claude/projects/` 本地日志），**不需要额外配置**。

Skill 安装后，Claude Code 会自动识别：
- 用户说"看看用量" → 运行 `tokentrail status`
- 用户说"同步数据" → 运行 `tokentrail sync`

### Codex

Codex 的数据通过 SYNC 自动同步（扫描 `~/.codex/sessions/` 本地日志），**不需要额外配置**。

### OpenClaw

OpenClaw 的数据存储在 VibeCafé 平台上，本地不存 token 数据。

**接入方式 1：VibeCafé 自动同步（推荐）**

1. 获取 VibeCafé API Key
2. 首次 SYNC 时传入：
   ```bash
   curl -X POST http://localhost:3820/api/sync \
     -H "Content-Type: application/json" \
     -d '{"vibecafe_api_key": "your-key"}'
   ```
3. 之后每次 `tokentrail sync` 或点击 SYNC 按钮都会自动拉取

**接入方式 2：代码集成实时上报**

在 OpenClaw 的会话结束 hook 中：

```javascript
async function reportUsage(session) {
  await fetch('http://localhost:3820/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'openclaw',
      model: session.model,
      input_tokens: session.usage.input_tokens,
      output_tokens: session.usage.output_tokens,
      cached_input_tokens: session.usage.cached_input_tokens || 0,
      request_id: `openclaw-${session.id}`,
    }),
  })
}
```

### Hermes

Hermes 有本地 `~/.hermes/state.db`，同时也通过 VibeCafé 同步。

**接入方式 1：VibeCafé 自动同步（推荐）**

同 OpenClaw，配置 VibeCafé API Key 后 SYNC 即可。

**接入方式 2：代码集成实时上报**

```python
import requests

def report_to_tokentrail(model, input_tokens, output_tokens, cached=0):
    requests.post('http://localhost:3820/api/report', json={
        'source': 'hermes',
        'model': model,
        'input_tokens': input_tokens,
        'output_tokens': output_tokens,
        'cached_input_tokens': cached,
    })
```

### 其他工具

任何工具都可以通过 HTTP POST 上报：

```bash
curl -X POST http://localhost:3820/api/report \
  -H "Content-Type: application/json" \
  -d '{
    "source": "your-tool-name",
    "model": "model-id",
    "input_tokens": 1000,
    "output_tokens": 500
  }'
```

---

## CLI 命令参考

### tokentrail setup

初始化配置，测试服务器连接。

```bash
tokentrail setup
```

### tokentrail status

查看服务器状态和数据统计。

```bash
tokentrail status
```

输出示例：
```
  TokenTrail 状态
  ─────────────────
  服务器:     http://localhost:3820 ✓
  记录数:     11871
  数据来源:   5 个
  模型数量:   68 个
  VibeCafé:   已配置
  数据跨度:   102 天 (2025-02-19 ~ 2025-05-31)
  Dashboard:  http://localhost:3820
```

### tokentrail sync

同步所有数据源（本地文件 + VibeCafé）。

```bash
tokentrail sync
```

输出示例：
```
  同步结果
  ────────
  ✓ claude-code     扫描 5234  新增 12  重复 5222
  ✓ codex           扫描 1890  新增 5   重复 1885
  ✓ vibecafe        扫描 230   新增 0   重复 230
```

### tokentrail report

上报用量数据。

```bash
# 基本用法
tokentrail report --source openclaw --model gpt-4.1 --input 5000 --output 1200

# 完整参数
tokentrail report \
  --source hermes \
  --model claude-sonnet-4-20250514 \
  --input 50000 \
  --output 8000 \
  --cached 20000 \
  --reasoning 1500 \
  --request-id hermes-session-123

# JSON 模式
tokentrail report --json '{"source":"my-agent","model":"deepseek-v3","input_tokens":3000}'
```

**report 参数说明：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `--source` | 是 | 工具标识，如 `openclaw`、`hermes`、`my-tool` |
| `--model` | 是 | 模型 ID，如 `gpt-4.1`、`claude-sonnet-4-20250514` |
| `--input` | 是 | 输入 token 数 |
| `--output` | 否 | 输出 token 数（默认 0） |
| `--cached` | 否 | 缓存输入 token 数（默认 0） |
| `--reasoning` | 否 | 推理 token 数（默认 0） |
| `--request-id` | 否 | 请求唯一 ID，防重复上报 |
| `--json` | 否 | 直接传 JSON 格式数据 |

### tokentrail health

健康检查，返回 `healthy` 或 `unhealthy`。适合监控脚本。

```bash
tokentrail health
```

---

## 自动定时同步

### 方式 1：cron 定时任务

```bash
# 编辑 crontab
crontab -e

# 每 30 分钟同步一次
*/30 * * * * node /path/to/TokenTrail/bin/tokentrail.js sync >> ~/.tokentrail/sync.log 2>&1
```

### 方式 2：Dashboard SYNC 按钮

Dashboard 每 60 秒自动刷新数据。点击 SYNC 按钮手动触发全量同步。

---

## API 端点参考

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/report` | 上报单条用量 |
| `POST` | `/api/sync` | 触发数据同步 |
| `GET` | `/api/stats` | 获取统计数据 |
| `GET` | `/api/usage` | 获取用量记录 |
| `GET` | `/api/pricing` | 查看模型价格 |
| `POST` | `/api/pricing` | 添加/更新模型价格 |

---

## 模型价格管理

TokenTrail 内置了常见模型的价格（Claude、GPT、DeepSeek、Gemini、Qwen、GLM 等）。

如果需要添加新模型：

```bash
curl -X POST http://localhost:3820/api/pricing \
  -H "Content-Type: application/json" \
  -d '{
    "model_id": "your-model-id",
    "display_name": "Your Model Name",
    "provider": "your-provider",
    "input_price_per_1m": 3.00,
    "output_price_per_1m": 15.00,
    "reasoning_price_per_1m": 0
  }'
```

---

## 排错

### 服务无法启动

```bash
cd TokenTrail
rm -rf .next
npm run dev
```

### CLI 无法连接

```bash
# 检查服务是否在运行
curl http://localhost:3820/api/health

# 重新配置
tokentrail setup
```

### 同步没有数据

1. 确认本地日志文件存在：
   ```bash
   ls ~/.claude/projects/     # Claude Code
   ls ~/.codex/sessions/      # Codex
   ```
2. 确认 VibeCafé API Key 已配置（OpenClaw/Hermes 数据）
3. 运行 `tokentrail sync` 查看详细同步结果

---

## 数据存储

所有数据存储在本地 `data/token-trail.db`（SQLite 文件）。

- 备份：直接复制 `data/token-trail.db` 文件
- 重置：删除 `data/token-trail.db`，重启服务会自动创建新数据库

默认端口 `3820`，可在 `package.json` 的 `scripts.dev` 中修改。
