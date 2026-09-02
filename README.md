# TokenTrail

<div align="center">

**Local-first AI coding usage dashboard: token spend, plus live account quotas for Codex, Gemini, Grok, GLM, and Kimi.**

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

---

TokenTrail is a local dashboard for AI coding work. It does two jobs on your machine, without a cloud account:

1. **Usage tracking** — read real token counts from Claude Code, Codex, Kimi Code, Grok, and any tool that reports via JSONL / CLI / HTTP; store them in SQLite; show cost trends, model mix, project attribution, source health, and raw records.
2. **Account quotas** — show official remaining limits (5-hour / weekly windows, booster packs, reset countdowns) for Codex, Gemini, Grok, GLM Coding Plan, and Kimi Code. Login prefers each provider’s official CLI in a visible Terminal window; API keys are a fallback and are never mixed across products.

![TokenTrail dashboard](./docs/assets/tokentrail-dashboard.png)

## What's new in 0.3.0

Account Quotas is now a first-class panel next to usage tracking.

- One dashboard for **tokens already spent** and **official remaining subscription limits**
- Codex / Gemini / Grok / Kimi login opens a visible macOS Terminal running the official CLI (`codex login`, `gemini`, `grok login --oauth`, `kimi login`). GLM uses a Coding Plan token
- API keys are fallback only, stored in the macOS Keychain, never in SQLite snapshots
- Product boundaries stay explicit: ChatGPT login ≠ OpenAI API key; Grok OAuth ≠ Management Key; Kimi Code ≠ Moonshot wallet; Gemini without a GCP quota project is shown as signed-in, not as a fake 0%

Full release notes: [CHANGELOG.md](./CHANGELOG.md).

## Why TokenTrail

- **Local-first by default** — usage data stays on your machine; no cloud account is required.
- **Usage and quotas together** — see what you already spent, and how much official subscription quota is left, in one dashboard.
- **Official login first** — Codex / Gemini / Grok / Kimi authorization opens the real CLI (`codex login`, `gemini`, `grok login --oauth`, `kimi login`). TokenTrail does not scrape cookies or invent numbers.
- **Keys stay off the snapshot** — API keys go to the macOS Keychain; SQLite only keeps Team ID, Project ID, Base URL, and normalized quota snapshots.
- **Inspectable data** — review raw records, sync results, duplicate counts, and source health when numbers look suspicious.
- **Background sync on macOS** — LaunchAgent keeps the dashboard and sync job running after login.
- **Privacy-friendly project display** — project names can be hidden when you share or record the screen.

## What You Get

| Area | What it shows |
| --- | --- |
| Account Quotas | Official remaining limits for Codex, Gemini, Grok, GLM, and Kimi: 5h/weekly windows, booster packs, reset countdowns, CLI login, and Keychain-stored keys |
| Usage dashboard | Daily/monthly token and cost trends, model mix, source comparison |
| Project stats | Usage by project, with optional project-name hiding |
| Source health | Claude Code, Codex, API sync status, last sync result, duplicate/error counts |
| Raw records | Searchable usage records for auditing and debugging |
| Pricing | Built-in model pricing table and auto-registration for unknown models |
| API and CLI | Report custom usage from scripts, agents, local services, or other tools |

## How it works

TokenTrail keeps two pipelines on the same machine. They share the dashboard, not the data model.

**Usage** answers “what did I already spend?”
Local JSONL scans (Claude Code, Codex, Kimi Code), optional JSONL from other tools, HTTP `POST /api/report`, and an OpenAI-compatible local proxy. Records land in SQLite `usage_records` with pricing applied.

**Quotas** answers “how much official plan is left?”
Each provider has an adapter under `src/lib/quotas/providers/`. Adapters read official CLI sessions or official APIs, then write a normalized snapshot (`windows`, `boosters`, `status`, `source`) to `quota_snapshots`. Tokens never go into that table.

Statuses you may see:

| Status | Meaning |
| --- | --- |
| `healthy` | Official data, usage below warning |
| `warning` / `critical` / `exhausted` | About 80% / 95% / 100% of a window |
| `auth_error` | Login expired or rejected — sign in again |
| `not_configured` | No CLI login and no usable key |
| `unsupported` | Logged in, but this account has no readable quota (for example Gemini without a GCP project) |
| `unsupported_version` | Official response shape changed — TokenTrail will not invent percentages |
| `stale` / `network_error` | Last good snapshot kept; refresh failed or is old |
| `manual` | You typed the numbers yourself |

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

This scans Claude Code logs (`~/.claude/projects/`), Codex sessions (`~/.codex/sessions/`), Kimi Code sessions (`~/.kimi-code/sessions/` and legacy `~/.kimi/sessions/`), and optional VibeCafe-compatible usage data.

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
| Kimi Code | `~/.kimi-code/sessions/**/wire.jsonl` and `~/.kimi/sessions/**/wire.jsonl` |

### Other tools (must integrate)

OpenClaw, Hermes, and any other tool must write one JSONL line per model call to `~/.<tool>/usage/YYYY-MM-DD.jsonl`. TokenTrail scans these files during sync.

> **No server URL / email / API key needed.** TokenTrail is fully local. Writing the JSONL file is zero-config and zero-network. The CLI (`tokentrail report`) and HTTP (`POST /api/report`) alternatives are also auth-free — there is no account to register and no credential to provide.

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
| Kimi Code | TokenTrail scans local wire usage events (automatic) |
| OpenClaw / Hermes / others | Tool writes `~/.tool/usage/*.jsonl` after each call |

### Optional: VibeCafé API

Convenience for existing VibeCafé users. Not a primary method. **`vibecafe_api_key` is only for pulling VibeCafé history — Hermes / OpenClaw / Codex / Claude Code never need any API key.** Add it to `~/.tokentrail/config.json`:

```json
{ "server_url": "http://localhost:3820", "vibecafe_api_key": "your-api-key" }
```

## Account Quotas

Open **Account Quotas** in the dashboard header. TokenTrail never fabricates remaining limits: it only shows official CLI/session data, official APIs, or a snapshot you typed in yourself.

| Provider | How you sign in | What can be read automatically | What an API key is for |
| --- | --- | --- | --- |
| **Codex** | Visible Terminal: `codex login` (ChatGPT) | 5h / weekly windows from `~/.codex/sessions` `rate_limits` | A normal OpenAI API key is not a ChatGPT/Codex subscription quota |
| **Gemini** | Visible Terminal: `gemini` → Sign in with Google | Official Code Assist quota buckets when the account has a readable GCP project | An AI Studio key cannot derive Google AI Pro/Ultra remaining quota |
| **Grok** | Visible Terminal: `grok login --oauth` | Subscription credits / monthly usage via Grok CLI OAuth | Management Key + Team ID is xAI API prepaid/billing, not the Grok web subscription |
| **GLM** | Coding Plan token / `ANTHROPIC_AUTH_TOKEN` | Coding Plan 5h window and official MCP usage | Only a token that can call the Coding Plan monitor API works |
| **Kimi** | Visible Terminal: `kimi login`, or a **Kimi Code** console key | Kimi Code `/coding/v1/usages` windows and booster pack | Moonshot Open Platform keys only read the open-platform wallet — do not mix the two |

If TokenTrail cannot open the login window, run the same official command yourself, then refresh:

```bash
codex login
gemini          # then choose Sign in with Google
grok login --oauth
kimi login
```

Expired Kimi OAuth is shown as auth failure and asks you to sign in again. Logged-in Gemini without a GCP quota project is shown as signed-in, not as a fake 0%. Grok CLI billing structure changes surface as “update required”, not as invented percentages.

API keys entered in the UI are stored in the **macOS Keychain**. SQLite keeps Team ID / Project ID / Base URL and normalized snapshots only. Snapshots never include tokens, emails, or account IDs.

Full operator notes: [docs/QUOTA_MANUAL_GUIDE.md](./docs/QUOTA_MANUAL_GUIDE.md).

## Privacy

- No TokenTrail cloud account
- Usage stays in local SQLite (`data/token-trail.db`)
- Quota API keys live in the macOS Keychain only
- Quota snapshots store remaining limits and status — not tokens, emails, or account IDs
- CLI login is the provider’s own process in a visible Terminal; TokenTrail does not scrape cookies or invent numbers

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
│   │   │   ├── quotas/        # Account quota read / refresh / auth
│   │   │   ├── proxy/openai/  # Local OpenAI-compatible proxy
│   │   │   ├── report/        # Usage report endpoint
│   │   │   ├── sync/          # Data sync trigger
│   │   │   └── ...            # health, status, stats, backup, pricing
│   │   └── ...
│   ├── components/dashboard/  # Dashboard UI (including Quota Center)
│   └── lib/
│       ├── db.ts              # SQLite data layer
│       ├── sync.ts            # Multi-source usage sync
│       ├── quotas/            # Quota adapters, status machine, CLI login, Keychain
│       │   ├── providers/     # codex / gemini / grok / glm / kimi
│       │   ├── cli-login.js   # Visible macOS Terminal for official login
│       │   └── secret-store.ts
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
