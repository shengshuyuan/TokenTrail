# Changelog

## Unreleased

Usage-accounting credibility and local-access hardening.

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

- **Estimated vs measured usage separated**: new `estimated` column marks
  Antigravity session rows and TraeWork scan rows (char-based estimates).
  Dashboard totals, charts, and source/model/project breakdowns exclude
  estimated rows; the totals card shows "另有估算 +N" alongside.
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
