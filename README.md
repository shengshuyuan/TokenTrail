# TokenTrail

<div align="center">

**Local AI token usage dashboard for developers**

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

---

TokenTrail is a local-first tool that tracks and visualizes your AI programming token usage across multiple tools and providers. It reads usage data from Claude Code, Codex, and VibeCafé, stores everything in a local SQLite database, and provides a real-time dashboard with trend charts, cost breakdowns, and system health monitoring.

**Key advantages:**
- 100% local — all data stays on your machine, no cloud services required
- Multi-source — unifies usage from Claude Code, Codex, VibeCafé (OpenClaw, Hermes, etc.)
- Auto-sync — macOS LaunchAgent runs in the background, syncing data every 4 hours
- EVA-themed dashboard — dark/light mode with real-time charts

## Features

- **Multi-source aggregation** — Syncs from Claude Code local JSONL logs, Codex session files, and VibeCafé API
- **Dashboard** — Interactive charts: cost trends, per-model breakdowns, source comparisons, daily/monthly stats
- **System health** — Real-time service status, data source health, sync history, and backup monitoring
- **CLI tool** — Full command-line interface for setup, sync, status, backup, diagnostics
- **macOS native service** — LaunchAgent for persistent background service and scheduled sync
- **Manual sync with feedback** — One-click SYNC button shows scanned/new/duplicate/error counts per source
- **Backup management** — Manual and automatic database backups with rotation
- **Cost tracking** — Built-in pricing table for 50+ AI models, auto-registers unknown models
- **Bilingual UI** — Chinese and English interface with language toggle
- **EVA-inspired design** — Terminal aesthetic with green/amber color scheme

## Prerequisites

- **Node.js** >= 18 (tested with v20.x)
- **macOS** (LaunchAgent service requires macOS; the app itself runs on any OS)
- **Claude Code** and/or **Codex** installed locally (optional, for local data sources)
- **VibeCafé API key** (optional, for VibeCafé data)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/shengshuyuan/TokenTrail.git
cd TokenTrail
npm install
```

### 2. Start the development server

```bash
npm run dev
```

The dashboard is now available at **http://localhost:3820**.

### 3. Configure the CLI

```bash
npm run setup
```

This creates `~/.tokentrail/config.json` and tests the connection to the local server.

### 4. Run initial sync

```bash
npm run sync
```

Scans Claude Code logs (`~/.claude/projects/`), Codex sessions (`~/.codex/sessions/`), and optionally VibeCafé API. Results are displayed with scanned/new/duplicate counts per source.

### 5. Install persistent service (macOS)

```bash
npm run install-service
```

This:
- Creates a runtime copy at `~/.tokentrail/runtime/TokenTrail` (isolated from cloud sync paths)
- Installs two LaunchAgents:
  - **Server** — persistent service on port 3820 (auto-restarts on crash)
  - **Sync** — automatic data sync every 4 hours
- Opens the dashboard in your browser

After installation, TokenTrail runs automatically on login. No manual steps needed.

### 6. Verify everything works

```bash
npm run doctor
```

All checks should show green.

## CLI Commands

| Command | Description |
|---------|-------------|
| `npm run setup` | Configure CLI and test server connection |
| `npm run sync` | Sync all data sources now |
| `npm run status` | Show server status and data statistics |
| `npm run doctor` | Full system health diagnosis |
| `npm run open` | Open dashboard in browser |
| `npm run backup` | Create a manual database backup |
| `npm run restart` | Restart the persistent service |
| `npm run install-service` | Install macOS LaunchAgent service |
| `npm run uninstall-service` | Remove service (data preserved) |

### Reporting usage from other tools

Any tool can report usage via the HTTP API or CLI:

```bash
# CLI
npx tokentrail report --source openclaw --model gpt-4.1 --input 5000 --output 1200

# HTTP API
curl -X POST http://localhost:3820/api/report \
  -H 'Content-Type: application/json' \
  -d '{"source":"openclaw","model":"gpt-4.1","input_tokens":5000,"output_tokens":1200}'
```

See [API Reference](#api-reference) for full field list.

## Data Sources

TokenTrail collects data from multiple sources:

| Source | Method | Description |
|--------|--------|-------------|
| **Claude Code** | Local file scan | Reads `~/.claude/projects/*/sessions/*.jsonl` |
| **Codex** | Local file scan | Reads `~/.codex/sessions/**/*.jsonl` |
| **VibeCafé** | API | Fetches OpenClaw, Hermes, Lobster, and other tools' usage via `vibecafe.ai/api/usage` (requires API key) |
| **Any tool** | HTTP report | POST to `/api/report` or use `tokentrail report` CLI |

Unknown models are auto-registered with price $0. Update pricing via the `/api/pricing` endpoint.

## API Reference

### `POST /api/report`

Report token usage from any tool.

```json
{
  "source": "openclaw",
  "model": "gpt-4.1",
  "input_tokens": 5000,
  "output_tokens": 1200,
  "cached_input_tokens": 0,
  "reasoning_tokens": 0,
  "request_id": "unique-id-for-dedup",
  "project": "my-project",
  "timestamp": 1718000000000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | Yes | Tool name (e.g. `openclaw`, `hermes`, `custom-agent`) |
| `model` | string | Yes | Model ID (e.g. `gpt-4.1`, `claude-sonnet-4-6`) |
| `input_tokens` | number | Yes | Input token count |
| `output_tokens` | number | No | Output token count (default 0) |
| `cached_input_tokens` | number | No | Cached input tokens (default 0) |
| `reasoning_tokens` | number | No | Reasoning tokens (default 0) |
| `request_id` | string | No | Unique ID for deduplication |
| `project` | string | No | Project name |
| `timestamp` | number | No | Unix timestamp in ms (default: now) |

### `GET /api/health`

Health check. Returns record count, source count, model count.

### `GET /api/status`

System status with per-source health, last sync details, and backup info.

### `POST /api/sync`

Trigger data sync. Returns scanned/new/duplicate/error counts per source.

## Architecture

```
TokenTrail/
├── bin/tokentrail.js          # CLI tool
├── scripts/serve.js           # Custom server (dev/prod)
├── src/
│   ├── app/
│   │   ├── page.tsx           # Main dashboard page
│   │   ├── api/
│   │   │   ├── health/        # Health check endpoint
│   │   │   ├── status/        # System status + source health
│   │   │   ├── sync/          # Data sync trigger
│   │   │   ├── stats/         # Usage statistics
│   │   │   ├── backup/        # Manual backup
│   │   │   ├── pricing/       # Model pricing management
│   │   │   └── report/        # Manual usage reporting
│   │   └── ...
│   ├── components/dashboard/  # UI components
│   └── lib/
│       ├── db.ts              # SQLite database layer
│       ├── sync.ts            # Multi-source sync engine
│       ├── pricing.ts         # Cost calculation
│       └── ...
└── data/
    └── token-trail.db         # SQLite database (gitignored)
```

## File Locations

After installation, TokenTrail stores data in these locations:

| Path | Description |
|------|-------------|
| `~/.tokentrail/config.json` | CLI configuration |
| `~/.tokentrail/runtime/TokenTrail/` | Runtime copy (isolated from project) |
| `~/.tokentrail/backups/` | Database backups |
| `~/.tokentrail/logs/` | Service and sync logs |
| `~/Library/LaunchAgents/*tokentrail*` | macOS service definitions |
| `data/token-trail.db` | SQLite database (in project root) |

## Troubleshooting

### Service won't start

```bash
npm run doctor        # Check all components
npm run restart       # Restart the service
```

### Sync not working

```bash
npm run sync          # Manual sync
# Check logs
ls ~/.tokentrail/logs/
cat ~/.tokentrail/logs/*sync.out.log
```

### Data not updating

If the dashboard shows stale data:
1. Check if the service is running: `npm run doctor`
2. Run a manual sync: `npm run sync`
3. Check sync logs for errors: `cat ~/.tokentrail/logs/*sync.err.log`

### Reset everything

```bash
npm run uninstall-service
rm -rf ~/.tokentrail
npm run install-service
```

## Technology Stack

- **Frontend**: Next.js 14, React 18, Recharts, Tailwind CSS
- **Database**: SQLite via better-sqlite3
- **Service**: macOS LaunchAgent (persistent process + scheduled sync)
- **CLI**: Node.js (zero external CLI dependencies)

## License

MIT
