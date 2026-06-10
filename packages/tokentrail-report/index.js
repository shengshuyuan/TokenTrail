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
  return process.env.TOKENTRAIL_URL || DEFAULT_URL
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

  const url = (record.url || getEndpoint()) + '/api/report'
  const payload = {
    source: String(record.source),
    model: String(record.model),
    input_tokens: Number(record.input_tokens) || 0,
    output_tokens: Number(record.output_tokens) || 0,
    cached_input_tokens: Number(record.cached_input_tokens) || 0,
    reasoning_tokens: Number(record.reasoning_tokens) || 0,
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
 * Wrap an OpenAI-compatible client so every chat.completions.create() call
 * automatically reports token usage to TokenTrail.
 *
 * Works with: openai, @anthropic-ai/sdk (with compat layer), or any
 * client that returns { usage: { prompt_tokens, completion_tokens } }.
 *
 * @param {Object} client       - An OpenAI SDK client instance
 * @param {Object} defaults     - Default fields for every report
 * @param {string} defaults.source - Tool name (required)
 * @param {string} [defaults.project] - Project name
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
      report({
        source: defaults.source,
        project: defaults.project,
        model: response.model || args[0]?.model || 'unknown',
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0,
        cached_input_tokens: usage.prompt_tokens_details?.cached_tokens || 0,
        request_id: response.id || undefined,
      }).catch(() => {}) // fire-and-forget, never block the caller
    }
    return response
  }

  return client
}

// ─── Exports ────────────────────────────────────────────────

module.exports = { report, wrapOpenAI, getEndpoint }
