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
npm run install-service
npm run doctor
```

The service creates a runtime copy under `~/.tokentrail/runtime/TokenTrail`, keeps the dashboard available on port `3820`, and runs scheduled sync in the background.

## Data Sources

TokenTrail is self-contained. It does not depend on VibeCafé or any external platform. How data arrives depends on the tool:

### Local file scan (TokenTrail reads, tool is unaware)

For tools that already store usage data locally, TokenTrail reads directly from their files. The tool does not need to know about TokenTrail.

| Tool | Files scanned |
| --- | --- |
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

### OpenClaw / Hermes integration

**Core principle:** TokenTrail does not guess token usage. OpenClaw and Hermes must read the real `response.usage` from the model provider after each call, then hand it to TokenTrail. If real usage is not available, skip — do not write zeros, do not estimate.

#### Recommended: local JSONL file

OpenClaw writes one JSONL line per call to `~/.openclaw/usage/YYYY-MM-DD.jsonl`.
Hermes writes one JSONL line per call to `~/.hermes/usage/YYYY-MM-DD.jsonl`.
TokenTrail scans these files during sync.

Standard JSONL fields:

```json
{
  "source": "openclaw",
  "provider": "xiaomi",
  "model": "mimo-v2.5-pro",
  "input_tokens": 5000,
  "output_tokens": 1200,
  "cached_input_tokens": 0,
  "reasoning_tokens": 0,
  "request_id": "provider-response-id-or-generated-id",
  "project": "optional-project-name",
  "timestamp": 1718000000000
}
```

| Field | Required | Description |
| --- | --- | --- |
| `source` | Yes | Tool name: `openclaw` or `hermes` |
| `provider` | Yes | Model provider: `openai`, `anthropic`, `xiaomi`, `zhipu`, `deepseek`, `qwen`, `google`, `minimax`, etc. |
| `model` | Yes | Actual model ID from request or response — do not hardcode |
| `input_tokens` | Yes | Real input token count |
| `output_tokens` | Yes | Real output token count |
| `cached_input_tokens` | No | Cached input tokens (default 0) |
| `reasoning_tokens` | No | Reasoning tokens (default 0) |
| `request_id` | Recommended | For deduplication; prefer provider response ID |
| `project` | No | Current project or workspace name |
| `timestamp` | No | Call completion time, Unix ms |

**Requirements:**

1. Write after the model response completes — never before the request.
2. Use real usage values — never estimate.
3. If the response has no usage data, skip writing. Do not write `input_tokens=0`.
4. Write failures must not affect the model call.
5. Each JSONL line must be a complete JSON object.
6. Multi-provider tools must normalize different field names to the standard format.
7. For streaming calls, read usage after the stream ends. Enable `stream_options.include_usage` for OpenAI-compatible providers.
8. TokenTrail only scans and imports standard records — no VibeCafé or external service dependency.

#### Alternative: wrap OpenAI client (for SDK-based tools)

If the tool uses an OpenAI-compatible SDK, wrap it once and every call reports usage automatically.

```js
const OpenAI = require('openai')
const { wrapOpenAI } = require('tokentrail-report')

const client = wrapOpenAI(new OpenAI(), { source: 'hermes' })
const res = await client.chat.completions.create({ model: 'gpt-4.1', messages: [...] })
```

#### Alternative: local OpenAI proxy (zero code changes)

If the tool supports changing the OpenAI `baseURL`, point it to TokenTrail's local proxy:

```bash
OPENAI_BASE_URL=http://localhost:3820/proxy/openai
```

The tool's API key is forwarded to the upstream API. No code changes in the tool.

#### Node.js example for OpenClaw / Hermes

```js
const fs = require('fs')
const path = require('path')

function writeTokenTrailUsage(entry, toolName) {
  const home = process.env.HOME || process.env.USERPROFILE
  if (!home) return
  const dir = path.join(home, `.${toolName}`, 'usage')
  fs.mkdirSync(dir, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  fs.appendFileSync(path.join(dir, `${date}.jsonl`), JSON.stringify(entry) + '\n')
}

// After model response
const usage = response.usage
if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
  writeTokenTrailUsage({
    source: 'openclaw',
    provider: providerName,
    model: response.model || requestedModel,
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cached_input_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    request_id: response.id || generatedRequestId,
    project: projectName,
    timestamp: Date.now()
  }, 'openclaw')
}
```

For Hermes, change `source: 'hermes'` and `toolName: 'hermes'`.

### Integration summary

| Tool | Method | Who does the work |
| --- | --- | --- |
| Claude Code | TokenTrail scans local JSONL | TokenTrail (automatic) |
| Codex | TokenTrail scans local JSONL | TokenTrail (automatic) |
| OpenClaw | Writes `~/.openclaw/usage/*.jsonl` after each call | OpenClaw (must integrate) |
| Hermes | Writes `~/.hermes/usage/*.jsonl` after each call | Hermes (must integrate) |
| Any new tool | Writes to `~/.tool/usage/*.jsonl` after each call | The tool (must integrate) |

### Optional: VibeCafé API

If you have a VibeCafé account, TokenTrail can also pull usage data from the VibeCafé API. This is a convenience for existing VibeCafé users — not a primary integration method. Add the API key to `~/.tokentrail/config.json`:

```json
{
  "server_url": "http://localhost:3820",
  "vibecafe_api_key": "your-api-key"
}
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
