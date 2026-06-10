# TokenTrail 本机长期使用手册

TokenTrail 默认作为本机常驻仪表盘使用。数据保存在当前项目的 `data/token-trail.db`，不会上传到云端。

## 首次安装常驻服务

```bash
npm run install-service
```

这个命令会完成三件事：

- 准备本机运行副本 `~/.tokentrail/runtime/TokenTrail`
- 安装 macOS LaunchAgent 常驻服务
- 安装每 30 分钟运行一次的自动同步任务

常驻服务从本机运行副本启动，避免云同步桌面对 Next.js 模块读取造成干扰；数据库仍使用项目里的 `data/token-trail.db`。需要单独验证生产构建时，可以运行：

```bash
npm run install-service -- --build
```

安装后访问：

```bash
npm run open
```

## 日常命令

```bash
npm run doctor
npm run open
npm run sync
npm run restart
npm run backup
npm run verify-local
```

命令说明：

| 命令 | 用途 |
| --- | --- |
| `npm run doctor` | 检查服务、数据库、LaunchAgent、同步任务和备份状态 |
| `npm run open` | 打开 `http://localhost:3820` |
| `npm run sync` | 手动同步 Claude Code、Codex、VibeCafe 等数据 |
| `npm run restart` | 重启本机常驻服务 |
| `npm run backup` | 备份 SQLite 数据库 |
| `npm run verify-local` | 一次性验收所有组件（服务、数据库、同步、备份） |

## 文件位置

| 类型 | 位置 |
| --- | --- |
| CLI 配置 | `~/.tokentrail/config.json` |
| 同步状态 | `~/.tokentrail/sync-status.json` |
| 日志目录 | `~/.tokentrail/logs/` |
| 备份目录 | `~/.tokentrail/backups/` |
| 运行副本 | `~/.tokentrail/runtime/TokenTrail/` |
| 服务配置 | `~/Library/LaunchAgents/com.shengshuyuan.tokentrail.server.plist` |
| 同步配置 | `~/Library/LaunchAgents/com.shengshuyuan.tokentrail.sync.plist` |
| 数据库 | `data/token-trail.db` |

## 故障恢复

### 服务打不开

**症状**：浏览器访问 `http://localhost:3820` 无响应。

```bash
npm run doctor
```

如果"服务连接"项为 ✗，尝试重启：

```bash
npm run restart
```

重启后等待几秒再访问。如果仍然不可用，查看错误日志：

```bash
cat ~/.tokentrail/logs/com.shengshuyuan.tokentrail.server.err.log
```

如果常驻服务没有安装：

```bash
npm run install-service
```

### 同步失败

**症状**：Dashboard 数据不更新，SYNC 按钮报错。

先确认服务可用：

```bash
npm run doctor
npm run sync
```

如果 `npm run sync` 报 "无法连接"，说明服务未启动，参考上方"服务打不开"处理。

如果 `npm run sync` 执行成功但数据显示有错误，查看各数据源的错误详情：

```bash
cat ~/.tokentrail/sync-status.json
```

常见原因：
- Claude Code 数据目录不存在（未安装 Claude Code）
- VibeCafé API key 未配置或已失效
- Codex sessions 目录格式变更

查看同步日志：

```bash
cat ~/.tokentrail/logs/com.shengshuyuan.tokentrail.sync.out.log
cat ~/.tokentrail/logs/com.shengshuyuan.tokentrail.sync.err.log
```

### 数据不更新

**症状**：Dashboard 有数据但长时间没有新记录。

1. 检查自动同步任务是否在运行：

```bash
launchctl print gui/$(id -u)/com.shengshuyuan.tokentrail.sync
```

2. 手动触发同步：

```bash
npm run sync
```

3. 如果 LaunchAgent 未加载：

```bash
npm run restart
```

4. 如果 LaunchAgent plist 不存在：

```bash
npm run install-service
```

### 数据备份

手动备份数据库：

```bash
npm run backup
```

备份文件保存在 `~/.tokentrail/backups/`，文件名包含时间戳。

也可以在 Dashboard 的"系统状态"面板中点击"手动备份"按钮。

Dashboard 会显示最近备份时间和备份数量。

### 完全重装

如果需要彻底重置：

```bash
# 1. 移除服务（不删数据）
npm run uninstall-service

# 2. 如需清除所有本地数据（谨慎！）
rm -rf ~/.tokentrail

# 3. 重新安装
npm run install-service
npm run doctor
```

## 自动同步

LaunchAgent 每 30 分钟执行一次 `npm run sync`。

同步结果记录在 `~/.tokentrail/sync-status.json`，Dashboard 的"系统状态"面板会展示：
- 最近同步时间
- 各数据源扫描/新增/重复/错误数
- 如果超过 4 小时没有新数据，会显示警告提示

## Dashboard 功能

Dashboard（`http://localhost:3820`）顶部有"系统状态"面板，展示：

- **服务状态**：运行中 / 需要关注
- **最近同步**：时间、成功/失败、各数据源详情
- **备份状态**：最近备份时间、备份数量、手动备份按钮
- **数据源健康**：Claude Code / Codex / VibeCafé 各自最近数据时间和记录数

SYNC 按钮点击后会展示详细的同步结果表格，包含每个数据源的扫描数、新增数、重复数和错误数。

## 移除常驻服务

```bash
npm run uninstall-service
```

这个命令只移除 LaunchAgent，不删除数据库、配置、日志或备份。
