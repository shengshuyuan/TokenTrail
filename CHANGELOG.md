# Changelog

## Unreleased

Usage-accounting credibility and local-access hardening.

- **Cursor Auto rows now show the model that actually ran.** The official API reports Auto mode as `default` and never names the underlying model, but the Cursor CLI chat store (`~/.cursor/chats/*/<conversation>/store.db`) records `providerOptions.cursor.modelName` on every assistant part. After the official import, `syncCursor` runs `planCursorAutoResolution` over all official Cursor rows: when a conversation's local store names a single underlying model (after excluding models the user picked explicitly in that conversation and ignoring models under 2% of output), the Auto row is relabelled in place (`request_id` untouched, so dedupe is unchanged). When Auto switched between several models, the original row is hidden (`is_internal = 1`, kept as the dedupe anchor) and split into derived rows `cursor:<ts>:<conversation>:default/<model>` proportional to each model's output share; the last row takes the remainder so every token column sums exactly to the original. Derived rows are recomputed on every sync and stale ones deleted. Rows whose conversation has no local store stay `auto`. On this machine 112 of 119 Auto rows resolve (82 relabelled, 30 split). Costs are not touched (Cursor bills Auto at $0 in the plan). The records table shows an `Auto` tag on these rows; the "Cursor model groups" panel counts them under Auto by `request_id`, not model name.
- **Grok Bot is its own source: `cursor-grok-bot`.** `grok-bot-*` events are Cursor's bundled Grok Bot, not IDE/CLI chats; they have no local chat store or transcript (0 of 428 conversations), so the underlying model is genuinely unknowable, and mixing 9,200 of them into `cursor` buried the models you actually used. `mapCursorUsageEvent` writes them to `cursor-grok-bot`; `normalizeSource(source, model)` routes any writer (VibeCafé aggregates, manual reports) the same way, and `hasRawUsageOnLocalDay` applies it before matching; `migration.cursor_grok_bot_source_v1` moves historical rows (request_ids unchanged). The incremental cursor for the official import spans both sources. Display name "Cursor Grok Bot", Grok icon, listed on the connections page; the groups panel still includes it so the three Cursor buckets add up to the bill. `cursor-grok-*` models you pick yourself are now counted as named models, not Grok Bot.
- **Cursor Auto resolution is sticky when local chats are unavailable.** If `~/.cursor/chats` is empty or a conversation is missing this sync, previously relabelled Auto rows and multi-model derived rows are left alone instead of being reset to `auto` and deleted. Chat stores are read once per sync (shared by Auto resolve and local estimates). Auto attribution writes run in one SQLite transaction. Migration / stats bind `cursor-grok-bot` as a query parameter. Connections page lists Kiro and WorkBuddy.
- **Usage page: merge model variants and click-to-filter.** "By model" gains a *Merge variants* toggle backed by `modelFamily()` in `src/lib/format.ts`: trailing effort/speed words (`fast`, `high`, `medium`, `low`, `thinking`, `highspeed`, …) are dropped, names are lower-cased, `provider/` prefixes removed and split versions (`5-5`) normalised to `5.5`, so `claude-opus-5-5-medium-fast` and `claude-opus-5.5` collapse into one row tagged "4 variants". Tier words (`flash`, `mini`, `pro`, `turbo`) are not merged. Rows in the source/model breakdown and the source/model cells of the records table are buttons that toggle the matching filter (a family toggles all of its variants); project rows stay inert because there is no project filter. Hardcoded Chinese on the usage, connections (tool descriptions, guide tabs) and shell footer now follows the language setting.
- **Sync result no longer counts re-attributed Cursor Auto rows as inserted.** Derived `…:default/<model>` rows only re-label usage already in the table.
- **Sync sources import only what they use.** Removed ~130 copy-pasted unused imports across `src/lib/sync/sources/*.ts`; `tsc --noUnusedLocals` is clean for that directory.
- **Cursor: real model for conversations the official API omits.** Selecting Claude Opus/Sonnet in Cursor can leave a conversation with zero events in `get-filtered-usage-events` (only Grok Bot / Auto appear). `syncCursor` now reads the Cursor CLI chat store (`~/.cursor/chats/*/<conversation>/store.db`), where every assistant part carries `providerOptions.cursor.modelName`, plus the transcript, and writes **estimated** rows per conversation, model and local day (`request_id = cursor-local:<conversation>:<model>:<day>`). `ai-tracking/ai-code-tracking.db` `model` is no longer trusted (it tagged a Sonnet chat as Opus); it only supplies the per-day request distribution. A conversation that used several models is split by reply share. Tokens are derived from assistant output characters with ratios fitted on 23 conversations that have a full official bill: output ≈ chars ÷ 1.6 (includes hidden thinking), cache read ≈ 133 × output, fresh input ≈ 6.4 × output; expect roughly ±40%. Conversations already present in official events and chats without a transcript are skipped. Estimated rows are recomputed from scratch each sync and stale `cursor-local:` rows are deleted. The official incremental cursor ignores `estimated = 1` rows. Seeded prices for `claude-opus-5-5`, `claude-opus-5-5-medium-fast`, `claude-sonnet-5-5` and `grok-4.7-high` so these rows are not auto-registered at $0.
- **Estimated rows are visible by model.** `/api/stats` returns `estimated_by_model` (top 6, tokens and cost) and the usage page lists them under the “measured only” note, so estimated Opus/Sonnet/Grok usage is readable without opening the records table. Estimated Cursor rows take the project from the chat `cwd` (generic folder names such as `repo` fall back to the parent folder).
- **Estimated Cursor rows report volume only.** `cost_usd` is always 0 for `cursor-local:` rows: the token figures are reconstructed from characters and the cache-read multiple dominates any price-table cost, so no dollar amount is claimed. A conversation that used several models is split by each model's output size rather than reply count. The usage page shows an estimated cost next to a model only when it is above zero.

- **`npm run deploy` for local updates.** Incremental redeploy to the LaunchAgent runtime copy: rsync sources (never deletes `node_modules`, `.next`, or `data/*.db`), rebuild only when a source file is newer than `.next/BUILD_ID`, then kickstart the service and verify `/api/health` plus the WorkBuddy quota card. `daemon-install` stays the way to create the runtime copy the first time.
- **WorkBuddy source.** New local scanner (`src/lib/sync/sources/workbuddy.ts`) reads `~/.workbuddy/traces/**` generation spans, where each span carries the provider's real `usage`, and stores one row per model call with `input = prompt − cached` and `output = completion − reasoning` so the buckets stay additive. Spans without usage are skipped, never estimated. A second row per user request carries the official credits from `~/.workbuddy/workbuddy.db` `session_usage.credit_json` (`credits` column, no tokens). Project attribution uses the live `sessions/<pid>.json` mapping first, then the conversation time window; a trace whose project cannot be determined is stored as `workbuddy` rather than guessed.
- **WorkBuddy quota card.** `workbuddy` provider under `src/lib/quotas/providers/workbuddy.js` shows credits already spent today / last 7 days / this month from the same official charge records. WorkBuddy exposes no local balance API (the official `POST /billing/meter/get-user-resource-summary` needs a user token stored in an encrypted keyblob), so remaining credits are shown **as-is from `WORKBUDDY_CREDITS_BALANCE`** — the value you confirm on the official page, with no local roll-down. Local spend records (`credit_json`) are incomplete (WorkBuddy prunes them per session), so any "baseline − local spend" formula diverges from the official number within a day. `npm run calibrate [value]` writes the number you read on the web and is the intended update path; the UI also offers a balance input in the quota modal. Because WorkBuddy prunes `credit_json`, months before the first sync under-report; TokenTrail's own `usage_records` remain the durable ledger.

- **Measured totals exclude estimates.** Dashboard and chart totals count `estimated = 0` only. The token card says “另有估算 N（来源）” and a high Antigravity/TraeWork share shows a short note. The earlier changelog line that already described this behavior now matches the query.
- **Sync is split by source** under `src/lib/sync/sources/`. `syncAll` starts Cursor and VibeCafé first, then local scanners, each with a time budget. `POST /api/sync` accepts `{ "sources": ["cursor"] }`.
- **VibeCafé** skips a daily bucket when that source, model, and local day already has a raw row.
- **Cursor pagination** records a warning on the connections page when the import stops before `totalUsageEventsCount`.
- **Stats** responses are cached in memory for about two minutes and cleared after sync.
- **Daily buckets** follow the machine timezone. Set `TOKENTRAIL_TZ_OFFSET_MINUTES` to override.
- **Proxy GET** uses the same local-origin check as POST. With `TOKENTRAIL_ALLOW_REMOTE=1`, a GET still cannot borrow the stored API key.
- **`install-service` builds production by default.** Pass `--dev` to keep Next dev mode. `doctor` warns when the project tree is newer than `~/.tokentrail/runtime/TokenTrail`.
- **LaunchAgent is macOS-only.** Linux and Windows run `npm run dev` or `npm start` in the foreground.
- **Quota preview polls with the quotas page.** Both use one request sequence, so a late poll cannot overwrite a newer manual refresh, and a failed read keeps the previous snapshot.
- **Single-source sync** scans only the named local usage directory. `openclaw` and `hermes` no longer skip the scanner, and `zcode` no longer scans the other usage directories. ZCode export runs only when that source is included.
- **Dependencies.** Next.js is 15.5.27 (patched 15.5 line, with React 19). Pricing spreadsheets use ExcelJS instead of SheetJS `xlsx` 0.18.5.
- **Model prices** follow the current OpenRouter list price (USD per 1M tokens). Historical `usage_records.cost_usd` was recalculated with the existing formula. Models with no public rate, including Grok Bot and Grok Build, were left unchanged.
- **Grok quota refresh** reads the weekly credits payload again when `creditUsagePercent` is missing. A percent-less response no longer replaces the last good weekly window with a monthly `used / 0` row.

### Fixed

- **Token double-counting**: cached input and reasoning output were stored as
  *additive* buckets on top of the inclusive OpenAI totals (input 100 incl. 60
  cached + output 20 incl. 8 reasoning counted as 188 instead of 120) and
  priced twice. The OpenAI proxies, `tokentrail-report` `wrapOpenAI`, the Grok
  scanner, and `scripts/sync-codex.js` now store mutually exclusive buckets
  before insert. `POST /api/report` stays pass-through by contract.
- **One-time backfill migration** (`migration.normalize_inclusive_v1`): the
  hermes and grok rows that were recorded inclusively are rewritten
  (input −= cached, output −= reasoning) with recomputed cost, in a single
  transaction. Other sources were verified mutually exclusive in data and are
  never touched. Runs once on first boot via `ensureInit`.
- **Long streaming responses were dropped entirely**: usage extraction kept
  only the last 64K of SSE, so a usage-only final chunk without a model name
  was discarded when the model appeared only in the first chunk. Replaced by
  an incremental `SseUsageTracker` (O(1) state); a stream that ends without
  usage now logs a warning instead of failing silently.
- **History attribution drift**: Antigravity conversations were stored as one
  row (chars ÷ 3.5 estimate) attributed to the *last* timestamp and *last*
  detected model, so cross-day sessions migrated old usage to the newest day
  and model switches rewrote history. Transcripts are now parsed into
  per-event rows (`antigravity:<conv>:<entry>`) with per-entry timestamps and
  a model state machine; the legacy whole-session row is removed only after
  its events are stored.

### Changed

- **Workbench UI redesign**: reimplemented the frontend presentation layer according
  to the personal AI usage workbench specification (`docs/design/2026-09-07-redesign/方案.md`):
  - Five dedicated routes: Overview (`/`), Usage Analysis (`/usage`), Account Quotas (`/quotas`), Data Connections (`/connections`), and Settings (`/settings`).
  - Fixed sidebar with clean Quiet Workbench design (`#FCFCFD` surface, `#157F68` brand green).
  - Unbordered MetricStrip for Total Tokens, Estimated Cost, and Total Calls.
  - Single-metric area trend chart with Tokens/Cost switcher.
  - Interactive source distribution list and account quota preview with remaining percentage indicators.
  - Full backward compatibility for existing retro themes, privacy mode, and custom model pricing.
- **Estimated vs measured usage separated**: new `estimated` column marks
  Antigravity session rows and TraeWork scan rows (char-based estimates).
  Headline totals count measured rows only. The token card shows the
  excluded estimate beside them (“另有估算 N”).
- **`npm start` binds `127.0.0.1`** (`-H ${HOST:-127.0.0.1}`), matching
  `scripts/serve.js` and the documented local-only boundary; docs now state
  both launch paths explicitly.
- **Local mutation guard closes gaps**: `POST /api/quotas/config`,
  `/api/quotas/auth` (can launch Terminal login processes), and
  `/api/quotas/manual` now enforce `rejectUnsafeLocalMutation()` like the
  other state-changing routes; the guard is decoupled from `next/server` and
  unit-tested (malicious Origin / cross-site rejected, CLI requests pass).
- **Tests import real modules**: node:test now loads actual `src/lib/*.ts`
  via a test-only resolve loader (Node 22 type stripping) instead of mirrored
  copies; every test process gets an isolated throwaway DB by default, so
  tests can no longer touch `data/token-trail.db`.

## 0.3.0 — 2026-09-02

Account Quotas is now a first-class panel next to usage tracking.

### Added

- Local **Account Quotas** dashboard for Codex, Gemini, Grok, GLM Coding Plan, and Kimi Code
- Official CLI login in a visible macOS Terminal: `codex login`, `agy`, `grok login --oauth`, `kimi login`
- Unified snapshot model: 5-hour / weekly windows, booster packs, reset countdowns, source, and status
- macOS Keychain storage for API keys; SQLite snapshots never store tokens, emails, or account IDs
- Operator guide: [docs/QUOTA_MANUAL_GUIDE.md](./docs/QUOTA_MANUAL_GUIDE.md)

### Provider rules

- **Codex**: ChatGPT CLI session + `~/.codex/sessions` `rate_limits`. A normal OpenAI API key is not ChatGPT quota
- **Gemini**: Antigravity CLI (`agy`) Google login, then official `agy -p "/usage"` windows
- **Grok**: `grok login --oauth` for subscription credits. Management Key + Team ID is xAI API billing
- **GLM**: Coding Plan token / monitor API only
- **Kimi**: `kimi login` or Kimi Code console key. Moonshot Open Platform keys are wallet-only and must not be mixed

### Docs

- README (EN / ZH): product story, two pipelines (usage vs quotas), status table, privacy, architecture
- Quota login flow and product boundaries in `docs/QUOTA_MANUAL_GUIDE.md`
