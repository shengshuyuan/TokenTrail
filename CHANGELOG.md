# Changelog

## 0.3.0 — 2026-09-02

Account Quotas is now a first-class panel next to usage tracking.

### Added

- Local **Account Quotas** dashboard for Codex, Gemini, Grok, GLM Coding Plan, and Kimi Code
- Official CLI login in a visible macOS Terminal: `codex login`, `gemini`, `grok login --oauth`, `kimi login`
- Unified snapshot model: 5-hour / weekly windows, booster packs, reset countdowns, source, and status
- macOS Keychain storage for API keys; SQLite snapshots never store tokens, emails, or account IDs
- Operator guide: [docs/QUOTA_MANUAL_GUIDE.md](./docs/QUOTA_MANUAL_GUIDE.md)

### Provider rules

- **Codex**: ChatGPT CLI session + `~/.codex/sessions` `rate_limits`. A normal OpenAI API key is not ChatGPT quota
- **Gemini**: Gemini CLI Google login. Logged in without a GCP quota project is shown as signed-in, not 0%
- **Grok**: `grok login --oauth` for subscription credits. Management Key + Team ID is xAI API billing
- **GLM**: Coding Plan token / monitor API only
- **Kimi**: `kimi login` or Kimi Code console key. Moonshot Open Platform keys are wallet-only and must not be mixed

### Docs

- README (EN / ZH): product story, two pipelines (usage vs quotas), status table, privacy, architecture
- Quota login flow and product boundaries in `docs/QUOTA_MANUAL_GUIDE.md`
