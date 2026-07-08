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
- **Built for AI coding workflows** — tracks Claude Code, Codex, and any tool that integrates via the included SDK or HTTP API.
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
npm run daemon-install
npm run daemon-status
```

The service creates a runtime copy under `~/.tokentrail/runtime/TokenTrail`, keeps the dashboard available on port `3820`, and runs scheduled sync in the background.

> Legacy commands `npm run install-service`, `npm run uninstall-service`, `npm run restart`, and `npm run doctor` still work; the `daemon-*` aliases are the recommended, more readable form.

## Data Sources

TokenTrail is self-contained. No external platform dependency.

### Local scan (automatic, no integration needed)

| Tool | Scanned path |
| --- | --- |
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

### Other tools (must integrate)

OpenClaw, Hermes, and any other tool must write one JSONL line per model call to `~/.<tool>/usage/YYYY-MM-DD.jsonl`. TokenTrail scans these files during sync.

**Core rule:** Read real `response.usage` after the model responds. If no usage data is available, skip — do not write zeros.

Standard line format:

```json
{"source":"openclaw","provider":"xiaomi","model":"mimo-v2.5-pro","input_tokens":5000,"output_tokens":1200,"request_id":"id","timestamp":1718000000000}
```

| Field | Required | Note |
| --- | --- | --- |
| `source` | Yes | Tool name (`openclaw`, `hermes`, etc.) |
| `provider` | Yes | Model provider (`openai`, `anthropic`, `xiaomi`, etc.) |
| `model` | Yes | Actual model ID from response, never hardcoded |
| `input_tokens` | Yes | Real input token count |
| `output_tokens` | Yes | Real output token count |
| `cached_input_tokens` | No | Default 0 |
| `reasoning_tokens` | No | Default 0 |
| `request_id` | Recommended | For deduplication, prefer provider response ID |
| `project` | No | Project/workspace name |
| `timestamp` | No | Unix ms, defaults to current time |

Node.js helper:

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

// After model response
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

For Hermes, use `reportUsage('hermes', { ... })`.

### Alternatives (for SDK-based tools)

If the tool uses an OpenAI-compatible SDK, wrap the client instead:

```js
const { wrapOpenAI } = require('tokentrail-report')
const client = wrapOpenAI(new OpenAI(), { source: 'hermes' })
```

Or point `baseURL` to TokenTrail's local proxy (zero code changes):

```bash
OPENAI_BASE_URL=http://localhost:3820/proxy/openai
```

### Summary

| Tool | Method |
| --- | --- |
| Claude Code | TokenTrail scans local JSONL (automatic) |
| Codex | TokenTrail scans local JSONL (automatic) |
| OpenClaw / Hermes / others | Tool writes `~/.tool/usage/*.jsonl` after each call |

### Optional: VibeCafé API

Convenience for existing VibeCafé users. Not a primary method. Add API key to `~/.tokentrail/config.json`:

```json
{ "server_url": "http://localhost:3820", "vibecafe_api_key": "your-api-key" }
```

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
├── packages/
│   └── tokentrail-report/     # Lightweight SDK for tools to report usage
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── proxy/openai/  # Local OpenAI-compatible proxy
│   │   │   ├── report/        # Usage report endpoint
│   │   │   ├── sync/          # Data sync trigger
│   │   │   └── ...            # health, status, stats, backup, pricing
│   │   └── ...
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
