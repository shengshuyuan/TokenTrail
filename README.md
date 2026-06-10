# TokenTrail

<div align="center">

**Local-first AI token usage dashboard for Claude Code, Codex, and custom AI tools.**

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

---

TokenTrail helps developers understand where their AI coding tokens go. It reads local usage data from Claude Code and Codex, accepts usage reports from other tools, stores everything in SQLite on your machine, and turns it into a dashboard for cost trends, model breakdowns, source health, project attribution, and raw-record inspection.

![TokenTrail dashboard](./docs/assets/tokentrail-dashboard.png)

## Why TokenTrail

- **Local-first by default** — usage data stays on your machine; no cloud account is required.
- **Built for AI coding workflows** — tracks Claude Code, Codex, VibeCafe-style tools, and any tool that can call an HTTP API or CLI.
- **Cost and token visibility** — compare spend by day, model, source, and project instead of guessing from provider bills.
- **Inspectable data** — review raw records, sync results, duplicate counts, and source health when numbers look suspicious.
- **Background sync on macOS** — LaunchAgent keeps the dashboard and sync job running after login.
- **Privacy-friendly project display** — project names can be hidden in the dashboard when you want a safer screen-share view.

## What You Get

| Area | What it shows |
| --- | --- |
| Usage dashboard | Daily/monthly token and cost trends, model mix, source comparison |
| Project stats | Usage by project, with optional project-name hiding |
| Source health | Claude Code, Codex, API sync status, last sync result, duplicate/error counts |
| Raw records | Searchable usage records for auditing and debugging |
| Pricing | Built-in model pricing table and auto-registration for unknown models |
| API and CLI | Report custom usage from scripts, agents, local services, or other tools |

## Quick Start

### 1. Install and run locally

```bash
git clone https://github.com/shengshuyuan/TokenTrail.git
cd TokenTrail
npm install
npm run dev
```

Open **http://localhost:3820**.

### 2. Configure and sync

```bash
npm run setup
npm run sync
```

This scans Claude Code logs (`~/.claude/projects/`), Codex sessions (`~/.codex/sessions/`), and optional VibeCafe-compatible usage data.

### 3. Install the macOS background service

```bash
npm run install-service
npm run doctor
```

The service creates a runtime copy under `~/.tokentrail/runtime/TokenTrail`, keeps the dashboard available on port `3820`, and runs scheduled sync in the background.

## Data Sources

TokenTrail has three ways to collect data. The first two run automatically during sync; the third requires the source tool to actively call an API.

### Automatic local scan (no setup needed from the tool)

TokenTrail reads usage records directly from local files. This works out of the box — Claude Code and Codex do not need to know about TokenTrail.

| Tool | Files scanned |
| --- | --- |
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

### VibeCafé API (requires a VibeCafé account)

OpenClaw, Hermes, Lobster, and other VibeCafé-compatible tools already report their usage to VibeCafé. TokenTrail pulls this data from the VibeCafé API — the source tools do not need any extra configuration.

| Tool | How it works |
| --- | --- |
| OpenClaw | Reports to VibeCafé automatically; TokenTrail fetches from API |
| Hermes | Reports to VibeCafé automatically; TokenTrail fetches from API |
| Lobster | Reports to VibeCafé automatically; TokenTrail fetches from API |

**Prerequisites:** a VibeCafé account with an API key, added to `~/.tokentrail/config.json`:

```json
{
  "server_url": "http://localhost:3820",
  "vibecafe_api_key": "your-api-key"
}
```

**Without a VibeCafé account:** OpenClaw, Hermes, and similar tools will not appear in the dashboard unless they report usage directly (see below).

### Direct HTTP / CLI report (tool must actively call TokenTrail)

Any tool can report usage directly to TokenTrail by calling the HTTP API or the CLI command. This is the fallback when a tool is not supported by local scan and does not report to VibeCafé.

```bash
# CLI
npx tokentrail report --source openclaw --model gpt-4.1 --input 5000 --output 1200

# HTTP API
curl -X POST http://localhost:3820/api/report \
  -H 'Content-Type: application/json' \
  -d '{"source":"openclaw","model":"gpt-4.1","input_tokens":5000,"output_tokens":1200}'
```

Minimal API payload:

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

`source`, `model`, and `input_tokens` are required. `request_id` is recommended for deduplication. Unknown models are created with price `$0` until you update pricing through the pricing API.

## CLI Commands

| Command | Description |
| --- | --- |
| `npm run setup` | Configure CLI and test server connection |
| `npm run sync` | Sync all data sources now |
| `npm run status` | Show server status and data statistics |
| `npm run doctor` | Run full local health diagnosis |
| `npm run open` | Open the dashboard in your browser |
| `npm run backup` | Create a manual SQLite database backup |
| `npm run restart` | Restart the persistent service |
| `npm run install-service` | Install macOS LaunchAgent service |
| `npm run uninstall-service` | Remove service while preserving data |

## Architecture

```text
TokenTrail/
├── bin/tokentrail.js          # CLI
├── scripts/serve.js           # Local server entry
├── src/
│   ├── app/                   # Next.js dashboard and API routes
│   ├── components/dashboard/  # Dashboard UI
│   └── lib/
│       ├── db.ts              # SQLite data layer
│       ├── sync.ts            # Multi-source sync engine
│       └── pricing.ts         # Cost calculation
└── data/token-trail.db        # Local SQLite database, gitignored
```

## Local Files

| Path | Description |
| --- | --- |
| `~/.tokentrail/config.json` | CLI configuration |
| `~/.tokentrail/runtime/TokenTrail/` | Runtime copy isolated from project/cloud-sync paths |
| `~/.tokentrail/backups/` | Database backups |
| `~/.tokentrail/logs/` | Service and sync logs |
| `~/Library/LaunchAgents/*tokentrail*` | macOS service definitions |
| `data/token-trail.db` | Project-local SQLite database |

## Troubleshooting

```bash
npm run doctor      # Check server, database, service, sync, and config
npm run sync        # Run a manual sync
npm run restart     # Restart the persistent macOS service
```

If data looks wrong, check the raw records and sync result first. TokenTrail keeps duplicate/error counts visible so you can distinguish missing data, duplicate imports, and pricing gaps.

## Tech Stack

- Next.js 14, React 18, Recharts, Tailwind CSS
- SQLite via better-sqlite3
- macOS LaunchAgent for the optional persistent service
- Node.js CLI with no external CLI framework dependency

## License

MIT
