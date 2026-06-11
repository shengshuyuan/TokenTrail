---
name: tokentrail
description: TokenTrail — 本地 AI 编程工具 token 用量统计。查询用量、同步数据、上报会话消耗。
---

# TokenTrail

本地部署的 AI 编程工具 token 用量统计面板。数据存在你自己的机器上，不上传到任何云服务。

## 查询用量（默认行为）

当用户问以下问题时，运行命令并**原样展示输出**：

| 用户说... | 运行 |
|---|---|
| 看看用量 / 状态 / 有多少数据 | `tokentrail status` |
| 同步数据 / 拉取最新 / 数据没更新 | `tokentrail sync` |
| 健康检查 / 服务还在吗 | `tokentrail health` |
| 上报当前会话 | `tokentrail report --source <来源> --model <模型> --input <token数>` |

## 上报当前会话用量

当 AI 工具完成一次会话后，主动上报本次消耗：

```bash
tokentrail report \
  --source <工具名> \
  --model <模型ID> \
  --input <输入token数> \
  --output <输出token数> \
  --cached <缓存token数> \
  --reasoning <推理token数>
```

**参数说明：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `--source` | 是 | 工具标识，如 `openclaw`、`hermes`、`codex`、`my-tool` |
| `--model` | 是 | 模型 ID，如 `gpt-4.1`、`claude-sonnet-4-20250514`、`deepseek-v3` |
| `--input` | 是 | 输入 token 数 |
| `--output` | 否 | 输出 token 数（默认 0） |
| `--cached` | 否 | 缓存输入 token 数（默认 0） |
| `--reasoning` | 否 | 推理 token 数（默认 0） |
| `--request-id` | 否 | 请求唯一 ID，防重复上报 |

**示例：**
```bash
tokentrail report --source openclaw --model gpt-4.1 --input 12500 --output 3200
tokentrail report --source hermes --model claude-sonnet-4-20250514 --input 50000 --output 8000 --cached 20000
tokentrail report --source my-agent --model o4-mini --input 8000 --output 2000 --reasoning 1500
```

## 首次使用

用户没配置过？提示运行：
```bash
tokentrail setup
```

这会测试服务器连接并保存配置到 `~/.tokentrail/config.json`。

## 注意事项

- TokenTrail 服务必须在运行（`npm run dev` 在 TokenTrail 目录下）
- `tokentrail sync` 会同步 Claude Code、Codex 的本地日志、OpenClaw/Hermes 本地 JSONL 用量文件，以及可选 VibeCafé 数据
- `tokentrail report` 是实时上报，`tokentrail sync` 是批量拉取
- 所有数据存在本地 SQLite，不上传到任何云服务
- `status` 输出是 markdown 格式，**原样展示，不要复述**

## 持续同步（可选）

如果希望自动定期同步，可以用 cron：

```bash
# 每 30 分钟同步一次
*/30 * * * * /usr/local/bin/node /path/to/TokenTrail/bin/tokentrail.js sync >> ~/.tokentrail/sync.log 2>&1
```
