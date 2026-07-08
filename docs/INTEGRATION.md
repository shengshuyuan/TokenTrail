# TokenTrail Integration Guide

TokenTrail is a local AI token usage dashboard. All data stays on your machine — no cloud dependency.

Current version: **V0.2.0**

## How data flows into TokenTrail

| Tool | Method | What happens |
| --- | --- | --- |
| Claude Code | Local scan | TokenTrail reads `~/.claude/projects/*/sessions/*.jsonl` during sync |
| Codex | Local scan | TokenTrail reads `~/.codex/sessions/**/*.jsonl` during sync |
| OpenClaw | Local JSONL | OpenClaw writes `~/.openclaw/usage/YYYY-MM-DD.jsonl` after each model call |
| Hermes | Local JSONL | Hermes writes `~/.hermes/usage/YYYY-MM-DD.jsonl` after each model call |
| Any tool | Local JSONL | Tool writes `~/.tool/usage/YYYY-MM-DD.jsonl` after each model call |
| Any tool | HTTP API | `POST /api/report` after each model call |

**Core rule for OpenClaw / Hermes / other tools:** Read real `response.usage` after the model responds. If no usage data is available, skip — do not write zeros.

## Quick start

```bash
# 1. Install and start
cd TokenTrail && npm install && npm run dev

# 2. Configure CLI
npm run setup

# 3. First sync (scans Claude Code + Codex local files)
npm run sync

# 4. (macOS) Install persistent service
npm run install-service
npm run doctor
```

## Codex integration

### Method 1: zero-configuration local scan (recommended)

Codex already stores real incremental usage events under `~/.codex/sessions/**/*.jsonl`. TokenTrail reads `event_msg → token_count → last_token_usage` without modifying those files.

```bash
# Confirm Codex session files exist
find ~/.codex/sessions -type f -name '*.jsonl' | head

# Run from the TokenTrail project directory
node bin/tokentrail.js sync
```

### Method 2: standalone preflight and import

Use the dedicated scanner to inspect what TokenTrail will import. The dry run is read-only.

```bash
node scripts/sync-codex.js --dry-run
node scripts/sync-codex.js --host=http://localhost:3820
```

Records use `codex:<relative-session-path>:L<event-line>` as `request_id`, so repeated imports are safely deduplicated.

### Method 3: install the Codex Skill (optional)

```bash
mkdir -p ~/.codex/skills/tokentrail
cp docs/SKILL.md ~/.codex/skills/tokentrail/SKILL.md
```

Then ask Codex: `同步 TokenTrail 数据并汇报 Codex 用量`.

## OpenClaw / Hermes integration

After each model call, write one JSONL line to `~/.<tool>/usage/YYYY-MM-DD.jsonl`:

```json
{"source":"openclaw","provider":"xiaomi","model":"mimo-v2.5-pro","input_tokens":5000,"output_tokens":1200,"request_id":"id","timestamp":1718000000000}
```

| Field | Required | Note |
| --- | --- | --- |
| `source` | Yes | Tool name (`openclaw`, `hermes`) |
| `provider` | Yes | Model provider (`openai`, `xiaomi`, `anthropic`, etc.) |
| `model` | Yes | Actual model ID from response, never hardcoded |
| `input_tokens` | Yes | Real input token count |
| `output_tokens` | Yes | Real output token count |
| `cached_input_tokens` | No | Default 0 |
| `reasoning_tokens` | No | Default 0 |
| `request_id` | Recommended | For deduplication |
| `project` | No | Project/workspace name |
| `timestamp` | No | Unix ms |

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

For Hermes: `reportUsage('hermes', { source: 'hermes', ... })`.

### SDK alternative

If the tool uses an OpenAI-compatible SDK:

```bash
npm install tokentrail-report
```

```js
const { wrapOpenAI } = require('tokentrail-report')
const client = wrapOpenAI(new OpenAI(), { source: 'hermes' })
```

### Proxy alternative

If the tool supports changing the OpenAI `baseURL`:

```bash
OPENAI_BASE_URL=http://localhost:3820/proxy/openai
```

## CLI commands

| Command | Description |
| --- | --- |
| `npm run setup` | Configure CLI, test server connection |
| `npm run sync` | Sync all data sources now |
| `npm run status` | Show server status and data statistics |
| `npm run doctor` | Full local health diagnosis |
| `npm run open` | Open dashboard in browser |
| `npm run backup` | Manual SQLite backup |
| `npm run restart` | Restart persistent service |
| `npm run install-service` | Install macOS LaunchAgent |
| `npm run uninstall-service` | Remove service (preserve data) |
| `npm run daemon-install` | Alias for `install-service` |
| `npm run daemon-status` | Alias for `doctor` |
| `npm run daemon-restart` | Alias for `restart` |
| `npm run daemon-uninstall` | Alias for `uninstall-service` |

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/status` | System status, source health, sync info |
| `POST` | `/api/sync` | Trigger data sync |
| `POST` | `/api/report` | Report a single usage record |
| `GET` | `/api/stats` | Aggregated usage statistics |
| `GET` | `/api/usage` | Usage records with filtering |
| `GET` | `/api/pricing` | Model pricing table |
| `POST` | `/api/pricing` | Add/update model pricing |
| `POST` | `/api/backup` | Create manual backup |

## VibeCafé (optional)

Convenience for existing VibeCafé users. Not a primary integration method.

```json
// ~/.tokentrail/config.json
{ "server_url": "http://localhost:3820", "vibecafe_api_key": "your-api-key" }
```

## Troubleshooting

```bash
npm run doctor      # Check all components
npm run sync        # Manual sync
npm run restart     # Restart service
```

Logs: `~/.tokentrail/logs/`
