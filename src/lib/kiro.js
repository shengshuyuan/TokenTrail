/**
 * Kiro CLI session helpers.
 *
 * Kiro CLI persists conversations under ~/.kiro/sessions. Each session dir
 * (named sess_<uuid>) contains:
 *   - session.json       — metadata (id, title, workspacePaths, modelId)
 *   - messages.jsonl     — one event per line { id, timestamp, payload }
 *   - sub-executions/*.jsonl — sub-agent transcripts, same line shape
 *
 * What Kiro records locally, per prompt turn:
 *   - `usage_summary`  → credits billed for the turn (promptTurnSummaries[].usage)
 *   - `session_metadata` key=contextUsage → one event per model request, carrying
 *     the server-reported context usage percentage (`kiro:context_usage_percentage`)
 *   - ~/.kiro/logs/<run>/kiro.log `q.create_response.request` → the concrete model
 *     each request was sent to, keyed by turnId (resolves sessions started on "auto")
 *
 * Kiro never writes raw input/output token counts. Input (context) tokens are
 * derived from the server-reported percentage × the model's official context
 * window (List-Available-Models). Output tokens are unknown and stay 0.
 * Cost uses the official per-credit price (GetUsageLimits overageRate).
 *
 * Plain JS so both the TypeScript sync source and the quota adapter can
 * require() it with a typed shim.
 */

const fs = require('fs')
const path = require('path')

// Used when a turn genuinely ran on "auto" and no concrete model was recorded.
// ("auto" itself is a junk pricing id in db.ts, so keep the kiro- prefix.)
const KIRO_MODEL = 'kiro-auto'

/** Official USD price of one Kiro credit (GetUsageLimits usageBreakdown.overageRate). */
const KIRO_CREDIT_USD = 0.04

/**
 * Context window per model, from Kiro's List-Available-Models tokenLimits.maxInputTokens.
 * The server reports context usage as a percentage of this window.
 */
const KIRO_DEFAULT_MAX_INPUT_TOKENS = 1_000_000
const KIRO_MAX_INPUT_TOKENS = {
  'claude-opus-4.5': 200_000,
  'claude-sonnet-4.5': 200_000,
  'claude-haiku-4.5': 200_000,
  'gpt-5.6-sol': 986_000,
  'gpt-5.6-terra': 986_000,
  'gpt-5.6-luna': 986_000,
  'deepseek-3.2': 164_000,
  'minimax-m2.5': 196_000,
  'minimax-m2.1': 196_000,
  'glm-5': 200_000,
  'qwen3-coder-next': 256_000,
}

function maxInputTokensFor(model) {
  return KIRO_MAX_INPUT_TOKENS[model] ?? KIRO_DEFAULT_MAX_INPUT_TOKENS
}

function pickString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Normalize a raw model label into a billable model id, or undefined when it
 * carries no concrete model. Kiro writes either a bare id ("claude-opus-5.5")
 * or a display string ("Auto (model selected dynamically on the server)").
 * "simple-task" is Kiro's internal title-generation model, never a user turn.
 */
function normalizeKiroModel(raw) {
  const value = pickString(raw)
  if (!value) return undefined
  const lower = value.toLowerCase()
  if (lower === 'auto' || lower.startsWith('auto ') || lower.startsWith('auto(')) return undefined
  if (lower === 'simple-task') return undefined
  const cleaned = value.replace(/\.+$/, '').trim()
  return cleaned || undefined
}

/** ~/.kiro (overridable via KIRO_HOME for tests). */
function kiroHomeDir(home) {
  return process.env.KIRO_HOME || path.join(home || process.env.HOME || '/root', '.kiro')
}

/** ~/.kiro/sessions root (overridable via KIRO_SESSIONS_DIR for tests). */
function kiroSessionsDir(home) {
  if (process.env.KIRO_SESSIONS_DIR) return process.env.KIRO_SESSIONS_DIR
  return path.join(kiroHomeDir(home), 'sessions')
}

/** ~/.kiro/logs root (overridable via KIRO_LOGS_DIR for tests). */
function kiroLogsDir(home) {
  if (process.env.KIRO_LOGS_DIR) return process.env.KIRO_LOGS_DIR
  return path.join(kiroHomeDir(home), 'logs')
}

/**
 * List every messages.jsonl (and sub-execution transcript) under the sessions
 * root: <hash>/sess_<uuid>/messages.jsonl plus <hash>/sess_<uuid>/sub-executions/*.jsonl.
 */
function findKiroTranscripts(fsMod, sessionsDir) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 6) return
    let entries
    try {
      entries = fsMod.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry.name === 'messages.jsonl' || (entry.name.endsWith('.jsonl') && dir.endsWith('sub-executions'))) {
        out.push(full)
      }
    }
  }
  walk(sessionsDir, 0)
  return out.sort()
}

/**
 * Map turnId → concrete model from Kiro's request log. Every model request logs
 * `q.create_response.request {"model":...}` (or `q.converse.dispatch {"modelId":...}`)
 * with the turnId it belongs to. A turn that ran on auto logs "auto"; that value
 * is kept so callers can tell "auto" apart from "not logged".
 */
function readKiroTurnModels(fsMod, home) {
  const logsDir = kiroLogsDir(home)
  const models = new Map()
  let runs
  try {
    runs = fsMod.readdirSync(logsDir, { withFileTypes: true })
  } catch {
    return models
  }
  const files = runs
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(logsDir, entry.name, 'kiro.log'))
    .sort()
  for (const file of files) {
    let text
    try {
      text = fsMod.readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (!line.includes('q.create_response.request') && !line.includes('q.converse.dispatch')) continue
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      const turnId = pickString(entry?.turnId)
      const message = typeof entry?.message === 'string' ? entry.message : ''
      const match = message.match(/"model(?:Id)?":"([^"]+)"/)
      if (!turnId || !match) continue
      const raw = match[1].trim()
      if (raw.toLowerCase() === 'simple-task') continue
      models.set(turnId, raw)
    }
  }
  return models
}

/**
 * Project (workspace basename) and model for the session that owns a
 * transcript. session.json sits beside messages.jsonl, or one level up for a
 * sub-execution transcript.
 */
function readKiroSessionMeta(fsMod, transcriptPath) {
  const candidates = [
    path.join(path.dirname(transcriptPath), 'session.json'),
    path.join(path.dirname(path.dirname(transcriptPath)), 'session.json'),
  ]
  for (const candidate of candidates) {
    let meta
    try {
      meta = JSON.parse(fsMod.readFileSync(candidate, 'utf-8'))
    } catch {
      continue
    }
    const paths = Array.isArray(meta?.workspacePaths) ? meta.workspacePaths : []
    const first = paths.find((p) => typeof p === 'string' && p.trim())
    const project = first ? path.basename(first) : undefined
    const sessionModel =
      normalizeKiroModel(meta?.modelId) ||
      normalizeKiroModel(meta?.contextSnapshotModelDisplay?.display)
    return { project, title: pickString(meta?.title), sessionId: pickString(meta?.id), sessionModel }
  }
  return { project: undefined, title: undefined, sessionId: undefined, sessionModel: undefined }
}

function toMs(timestamp) {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return Math.abs(timestamp) < 1e12 ? Math.round(timestamp * 1000) : Math.round(timestamp)
  }
  if (typeof timestamp === 'string' && timestamp.trim()) {
    const parsed = Date.parse(timestamp)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

/**
 * Parse one transcript line into a credit usage record when it is a
 * `usage_summary` with credits, otherwise null. Several promptTurnSummaries in
 * one turn are summed.
 */
function parseKiroUsageLine(line) {
  if (!line || !line.includes('usage_summary')) return null
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    return null
  }
  const payload = entry?.payload
  if (!payload || payload.type !== 'usage_summary') return null

  const summaries = Array.isArray(payload.promptTurnSummaries) ? payload.promptTurnSummaries : []
  let credits = 0
  for (const summary of summaries) {
    const value = typeof summary?.usage === 'number' ? summary.usage : Number(summary?.usage)
    if (Number.isFinite(value) && value > 0) credits += value
  }
  if (credits <= 0) return null

  return {
    credits,
    timestamp: toMs(entry.timestamp),
    turnId: pickString(payload.turnId) || pickString(payload.executionId),
    executionId: pickString(payload.executionId),
    requestCount: Array.isArray(payload.requestIds) ? payload.requestIds.length : 0,
    status: pickString(payload.status),
  }
}

/** Model named in an agent-authored session_context note ("The current model is X."). */
function agentNoteModel(payload) {
  if (!payload || payload.type !== 'agent_note') return undefined
  const content = typeof payload.content === 'string' ? payload.content : ''
  // Capture to end of line; normalizeKiroModel strips the sentence period
  // (a [^.] class would truncate "claude-opus-5.5").
  const match = content.match(/current model is\s+([^\n]+)/i)
  return match ? normalizeKiroModel(match[1]) : undefined
}

/**
 * Scan one transcript and return every credit-billed turn with its real model
 * and context tokens. `request_id` is the stable turnId so re-syncs dedupe.
 *
 * Model resolution per turn: request log (exact, per turn) → the session_context
 * note in effect when the turn ran → session.json → kiro-auto.
 *
 * Context tokens per turn: Σ over the turn's requests of
 * contextUsagePercentage / 100 × model context window.
 */
function parseKiroTranscript(fsMod, transcriptPath, options = {}) {
  let text
  try {
    text = fsMod.readFileSync(transcriptPath, 'utf-8')
  } catch {
    return []
  }
  const turnModels = options.turnModels instanceof Map ? options.turnModels : new Map()
  const meta = readKiroSessionMeta(fsMod, transcriptPath)

  // contextUsage percentages per executionId, in request order.
  const contextByExecution = new Map()
  const usageLines = []
  let noteModel
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (line.includes('contextUsage') && line.includes('session_metadata')) {
      try {
        const payload = JSON.parse(line)?.payload
        const pct = payload?.value?.usagePercentage
        const executionId = pickString(payload?.executionId)
        if (payload?.type === 'session_metadata' && payload.key === 'contextUsage' && executionId && Number.isFinite(pct) && pct > 0) {
          if (!contextByExecution.has(executionId)) contextByExecution.set(executionId, [])
          contextByExecution.get(executionId).push(pct)
        }
      } catch {
        // ignore malformed metadata lines
      }
      continue
    }
    if (line.includes('current model is') && line.includes('agent_note')) {
      try {
        const model = agentNoteModel(JSON.parse(line)?.payload)
        if (model) noteModel = model
      } catch {
        // ignore
      }
      continue
    }
    const parsed = parseKiroUsageLine(line)
    if (parsed) usageLines.push({ parsed, line: i + 1, noteModel })
  }

  const records = []
  for (const { parsed, line, noteModel: modelAtTurn } of usageLines) {
    const logged = parsed.turnId ? turnModels.get(parsed.turnId) : undefined
    const model =
      normalizeKiroModel(logged) ||
      (logged ? KIRO_MODEL : undefined) || // logged as "auto": genuinely unknown
      modelAtTurn ||
      meta.sessionModel ||
      KIRO_MODEL

    const window = maxInputTokensFor(model)
    const percents = parsed.executionId ? contextByExecution.get(parsed.executionId) || [] : []
    const contextTokens = contextTokensFor(percents, model)

    records.push({
      ...parsed,
      requestId: parsed.turnId ? `kiro:${parsed.turnId}` : `kiro:${transcriptPath}:L${line}`,
      project: meta.project,
      model,
      // true = taken from the request log for this exact turn. Callers keep an
      // already-stored model when this is false (old run logs may be pruned).
      modelFromLog: Boolean(logged),
      contextPercents: percents,
      contextTokens,
      contextWindow: window,
      contextRequests: percents.length,
      costUsd: Math.round(parsed.credits * KIRO_CREDIT_USD * 1e6) / 1e6,
    })
  }
  return records
}

/** Σ server-reported context percentages × the model's context window. */
function contextTokensFor(percents, model) {
  const window = maxInputTokensFor(model)
  return percents.reduce((sum, pct) => sum + Math.round((pct / 100) * window), 0)
}

module.exports = {
  KIRO_MODEL,
  KIRO_CREDIT_USD,
  KIRO_DEFAULT_MAX_INPUT_TOKENS,
  maxInputTokensFor,
  contextTokensFor,
  normalizeKiroModel,
  kiroHomeDir,
  kiroSessionsDir,
  kiroLogsDir,
  findKiroTranscripts,
  readKiroTurnModels,
  readKiroSessionMeta,
  parseKiroUsageLine,
  parseKiroTranscript,
}
