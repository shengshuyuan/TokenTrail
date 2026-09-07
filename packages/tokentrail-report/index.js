/**
 * tokentrail-report — Zero-dependency SDK for reporting token usage to TokenTrail.
 *
 * Auto-discovers the TokenTrail endpoint via environment variable:
 *   TOKENTRAIL_URL=http://localhost:3820
 *
 * Usage:
 *   // 1. Direct report
 *   const { report } = require('tokentrail-report')
 *   await report({ source: 'my-agent', model: 'gpt-4.1', input_tokens: 1000, output_tokens: 200 })
 *
 *   // 2. Wrap an OpenAI-compatible client to auto-report
 *   const { wrapOpenAI } = require('tokentrail-report')
 *   const client = wrapOpenAI(openai, { source: 'my-agent' })
 *   // Now every chat.completions.create() call automatically reports usage
 */

// ─── Endpoint discovery ────────────────────────────────────

const DEFAULT_URL = 'http://localhost:3820'

function getEndpoint() {
  const url = process.env.TOKENTRAIL_URL || DEFAULT_URL
  return url.replace(/\/+$/, '') // strip trailing slashes
}

// ─── Core report function ──────────────────────────────────

/**
 * Report a single usage record to TokenTrail.
 *
 * @param {Object} record
 * @param {string} record.source       - Tool name (e.g. 'openclaw', 'hermes', 'my-agent')
 * @param {string} record.model        - Model ID (e.g. 'gpt-4.1', 'claude-sonnet-4-6')
 * @param {number} record.input_tokens - Input token count
 * @param {number} [record.output_tokens]       - Output token count (default 0)
 * @param {number} [record.cached_input_tokens] - Cached input tokens (default 0)
 * @param {number} [record.reasoning_tokens]    - Reasoning tokens (default 0)
 * @param {string} [record.request_id]          - Unique ID for deduplication
 * @param {string} [record.project]             - Project name
 * @param {number} [record.timestamp]           - Unix timestamp in ms (default: now)
 * @param {string} [record.url]                 - Override TokenTrail URL
 * @returns {Promise<{success: boolean, cost_usd?: number, id?: number, error?: string}>}
 */
async function report(record) {
  if (!record || !record.source || !record.model || record.input_tokens == null) {
    return { success: false, error: 'Missing required fields: source, model, input_tokens' }
  }

  const input = Number(record.input_tokens) || 0
  const output = Number(record.output_tokens) || 0
  const cached = Number(record.cached_input_tokens) || 0
  const reasoning = Number(record.reasoning_tokens) || 0

  // Skip zero-token records — TokenTrail rejects them to prevent data pollution
  if (input === 0 && output === 0 && cached === 0 && reasoning === 0) {
    return { success: false, error: 'All token counts are zero. Report real response.usage values.' }
  }

  const url = (record.url || getEndpoint()) + '/api/report'
  const payload = {
    source: String(record.source),
    provider: record.provider ? String(record.provider) : undefined,
    model: String(record.model),
    input_tokens: input,
    output_tokens: output,
    cached_input_tokens: cached,
    reasoning_tokens: reasoning,
    request_id: record.request_id || undefined,
    project: record.project || undefined,
    timestamp: record.timestamp || Date.now(),
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.error || `HTTP ${res.status}` }
    return { success: true, cost_usd: data.cost_usd, id: data.id }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

// ─── OpenAI-compatible client wrapper ───────────────────────

/**
 * OpenAI reports cached input within prompt_tokens and reasoning output within
 * completion_tokens. Convert to mutually exclusive buckets so TokenTrail totals
 * and pricing do not count either category twice. Mirrors the server-side
 * normalize in src/lib/proxy-usage.ts; this package stays dependency-free, so
 * the logic is intentionally inlined here.
 */
function normalizeOpenAIUsage(usage) {
  function toCount(value) {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return 0
    return Math.floor(n)
  }
  const prompt = toCount(usage?.prompt_tokens)
  const completion = toCount(usage?.completion_tokens)
  const cached = Math.min(toCount(usage?.prompt_tokens_details?.cached_tokens), prompt)
  const reasoning = Math.min(toCount(usage?.completion_tokens_details?.reasoning_tokens), completion)
  return {
    input_tokens: prompt - cached,
    cached_input_tokens: cached,
    output_tokens: completion - reasoning,
    reasoning_tokens: reasoning,
  }
}

/**
 * Wrap an OpenAI-compatible client so every chat.completions.create() call
 * automatically reports token usage to TokenTrail.
 *
 * Works with: openai, @anthropic-ai/sdk (with compat layer), or any
 * client that returns { usage: { prompt_tokens, completion_tokens } }.
 * Reported buckets are mutually exclusive (input excludes cached, output
 * excludes reasoning), matching OpenAI's inclusive wire semantics.
 *
 * @param {Object} client       - An OpenAI SDK client instance
 * @param {Object} defaults     - Default fields for every report
 * @param {string} defaults.source - Tool name (required)
 * @param {string} [defaults.provider] - Model provider
 * @param {string} [defaults.project] - Project name
 * @param {(err: Error) => void} [defaults.onError] - Invoked when a report
 *   fails; reports are fire-and-forget and never block the caller.
 * @returns {Object} The wrapped client (same interface)
 */
function wrapOpenAI(client, defaults) {
  if (!client?.chat?.completions?.create) {
    throw new Error('tokentrail-report: client must have chat.completions.create()')
  }
  if (!defaults?.source) {
    throw new Error('tokentrail-report: defaults.source is required')
  }

  const originalCreate = client.chat.completions.create.bind(client.chat.completions)

  client.chat.completions.create = async function (...args) {
    const response = await originalCreate(...args)
    const usage = response?.usage
    if (usage) {
      // report() resolves (never rejects) with { success: false, error } on
      // failure, so both paths must surface to onError.
      report({
        source: defaults.source,
        provider: defaults.provider,
        project: defaults.project,
        model: response.model || args[0]?.model || 'unknown',
        ...normalizeOpenAIUsage(usage),
        request_id: response.id || undefined,
      }).then(result => {
        if (!result?.success) {
          notifyError(new Error(result?.error || 'tokentrail-report: unknown failure'))
        }
      }).catch(notifyError)
    }
    return response
  }

  function notifyError(err) {
    if (typeof defaults.onError !== 'function') return
    try {
      defaults.onError(err)
    } catch {
      // a throwing callback must not break the caller either
    }
  }

  return client
}

// ─── Exports ────────────────────────────────────────────────

module.exports = { report, wrapOpenAI, getEndpoint }
