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

TokenTrail is self-contained. It does not depend on any external platform. How data arrives depends on the tool:

### Local file scan (TokenTrail reads, tool is unaware)

For tools that already store usage data locally, TokenTrail reads directly from their files. The tool does not need to know about TokenTrail.

| Tool | Files scanned |
| --- | --- |
| Claude Code | `~/.claude/projects/*/sessions/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |

### Active reporting (tool must integrate after each model call)

For tools like OpenClaw, Hermes, Lobster, and custom agents, TokenTrail cannot read usage data on its own. **These tools must report usage to TokenTrail after each model API call returns.** Without integration, their data will not appear in the dashboard.

The tool reads `response.usage` from the actual model response and reports it to TokenTrail. Reporting failures must not affect the tool's main flow.

#### Option 1: Write a local JSONL file (simplest, no HTTP needed)

The tool writes one JSONL line per model call to `~/.tool-name/usage/YYYY-MM-DD.jsonl`. TokenTrail scans these files during sync — no HTTP calls, no SDK, no dependencies.

```js
// After each model call, append one line to the daily usage file
const fs = require('fs')
const path = require('path')

function reportUsage(entry) {
  const dir = path.join(process.env.HOME, '.openclaw', 'usage')
  fs.mkdirSync(dir, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  fs.appendFileSync(
    path.join(dir, `${date}.jsonl`),
    JSON.stringify(entry) + '\n'
  )
}

// Call after each model response
const res = await callModel(...)
reportUsage({
  source: 'openclaw',
  provider: 'xiaomi',
  model: res.model,
  input_tokens: res.usage.prompt_tokens,
  output_tokens: res.usage.completion_tokens,
  cached_input_tokens: res.usage.prompt_tokens_details?.cached_tokens || 0,
  request_id: res.id,
  timestamp: Date.now()
})
```

Supported directories (auto-scanned by TokenTrail):
- `~/.openclaw/usage/*.jsonl`
- `~/.hermes/usage/*.jsonl`

#### Option 2: Wrap the OpenAI client (recommended for SDK-based tools)

If the tool uses an OpenAI-compatible SDK, wrap it once. Every `chat.completions.create()` call then reports usage automatically by reading `response.usage`.

```js
const OpenAI = require('openai')
const { wrapOpenAI } = require('tokentrail-report')

// Wrap once at startup
const client = wrapOpenAI(new OpenAI(), { source: 'hermes' })

// All subsequent calls report usage automatically — no other changes needed
const res = await client.chat.completions.create({ model: 'gpt-4.1', messages: [...] })
```

The SDK reads `res.model`, `res.usage.prompt_tokens`, `res.usage.completion_tokens`, and `res.id` from the response.

#### Option 2: HTTP call after each model response

If the tool cannot use the SDK wrapper, add a reporting call after each model API response. Use the real values from `response.usage`, not estimates.

```js
// After model call completes
const res = await callModel(...)

// Report to TokenTrail (fire-and-forget, never block the main flow)
fetch('http://localhost:3820/api/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: 'openclaw',
    model: res.model,                          // actual model from response
    input_tokens: res.usage.prompt_tokens,      // real usage, not estimate
    output_tokens: res.usage.completion_tokens,
    cached_input_tokens: res.usage.prompt_tokens_details?.cached_tokens || 0,
    reasoning_tokens: res.usage.completion_tokens_details?.reasoning_tokens || 0,
    request_id: res.id,
    project: 'my-project',
    timestamp: Date.now()
  })
}).catch(() => {})
```

**Streaming note:** For streaming calls, usage data is in the final chunk. Enable `stream_options: { include_usage: true }` and read `usage` from the last chunk after the stream ends.

#### Option 3: Local OpenAI proxy (zero code changes in the tool)

If the tool supports changing the OpenAI `baseURL`, point it to TokenTrail's local proxy. TokenTrail forwards requests to the real API and records usage from the response.

```bash
OPENAI_BASE_URL=http://localhost:3820/proxy/openai
```

The tool's API key is forwarded to the upstream API. No code changes in the tool.

### Integration requirements summary

| Tool | What must happen | Who does the work |
| --- | --- | --- |
| Claude Code | TokenTrail scans local JSONL | TokenTrail (automatic) |
| Codex | TokenTrail scans local JSONL | TokenTrail (automatic) |
| OpenClaw | Tool reports `response.usage` after each call | OpenClaw (must integrate) |
| Hermes | Tool reports `response.usage` after each call | Hermes (must integrate) |
| Any new tool | Tool reports `response.usage` after each call | The tool (must integrate) |

### Integration instruction (copy-paste for other tools)

Give this to any tool that needs to report usage to TokenTrail:

> After each model call, POST the real `response.usage` to your local TokenTrail:
> `POST http://localhost:3820/api/report`
>
> `source`: your tool name, `provider`: the model provider, `model`: the actual model name,
> `input_tokens`/`output_tokens`: read from `response.usage`. Do not estimate.
> Reporting failures must not affect the main flow.

Minimal payload:

```json
{
  "source": "openclaw",
  "provider": "xiaomi",
  "model": "mimo-v2.5-pro",
  "input_tokens": 5000,
  "output_tokens": 1200
}
```

If using an OpenAI-compatible SDK, wrap the client once instead:

```js
const { wrapOpenAI } = require('tokentrail-report')
const client = wrapOpenAI(new OpenAI(), { source: 'hermes' })
```

`source`, `model`, and `input_tokens` are required. `request_id` is recommended for deduplication. `provider` is optional (e.g. `openai`, `xiaomi`, `anthropic`). Unknown models are created with price `$0` until you update pricing through the pricing API.

#### Option 4: Local OpenAI-compatible proxy (zero code changes)

If the tool supports changing the OpenAI `baseURL`, point it to TokenTrail's local proxy. TokenTrail forwards requests to the real API and records usage automatically — the tool needs zero code changes.

```bash
# Set the base URL in your tool's config
OPENAI_BASE_URL=http://localhost:3820/proxy/openai
```

Or in code:

```js
const openai = new OpenAI({ baseURL: 'http://localhost:3820/proxy/openai' })
```

TokenTrail uses the caller's `Authorization` header to forward to the upstream API. You can also set `OPENAI_API_KEY` in the environment or in `~/.tokentrail/config.json`.

To identify the source, add a custom header:

```bash
curl http://localhost:3820/proxy/openai/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "x-tokentrail-source: hermes" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4.1","messages":[{"role":"user","content":"hello"}]}'
```

#### Environment variable

Set `TOKENTRAIL_URL` so the SDK and tools can auto-discover the TokenTrail endpoint:

```bash
export TOKENTRAIL_URL=http://localhost:3820
```

If not set, the SDK defaults to `http://localhost:3820`.

### Optional: VibeCafé API

If you have a VibeCafé account, TokenTrail can also pull usage data from the VibeCafé API. This is a convenience for existing VibeCafé users — it is not required. Add the API key to `~/.tokentrail/config.json`:

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
