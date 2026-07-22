import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Unit tests for Kimi Code wire.jsonl usage.record parsing used by syncKimiCode().
 * Keeps the request_id / field mapping stable so historical re-syncs dedupe correctly.
 */

function parseKimiUsageLine(line, filePath, lineNo) {
  if (!line || !line.includes('"usage.record"')) return null
  const entry = JSON.parse(line)
  if (entry.type !== 'usage.record' || !entry.usage) return null
  if (entry.usageScope && entry.usageScope !== 'turn') return null

  const usage = entry.usage
  const inputOther = Number(usage.inputOther) || 0
  const cacheCreation = Number(usage.inputCacheCreation) || 0
  const cached_input_tokens = Number(usage.inputCacheRead) || 0
  const output_tokens = Number(usage.output) || 0
  const input_tokens = inputOther + cacheCreation
  if (input_tokens === 0 && output_tokens === 0 && cached_input_tokens === 0) return null

  return {
    source: 'kimi-code',
    model: typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim() : 'unknown',
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_tokens: 0,
    request_id: `kimi:${filePath}:L${lineNo}`,
    timestamp: entry.time,
  }
}

function normalizeKimiProjectName(workDirKey) {
  const m = /^wd_(.+)_[0-9a-f]{12}$/.exec(workDirKey)
  return m ? m[1] : workDirKey
}

describe('parseKimiUsageLine', () => {
  const file = '/Users/x/.kimi-code/sessions/wd_tokentrail_11bc1fca2b68/session_abc/agents/main/wire.jsonl'

  it('parses a turn-scoped usage.record', () => {
    const line = JSON.stringify({
      type: 'usage.record',
      model: 'kimi-code/k3',
      usage: { inputOther: 4507, output: 257, inputCacheRead: 39680, inputCacheCreation: 0 },
      usageScope: 'turn',
      time: 1784690944568,
    })
    const r = parseKimiUsageLine(line, file, 42)
    assert.equal(r.source, 'kimi-code')
    assert.equal(r.model, 'kimi-code/k3')
    assert.equal(r.input_tokens, 4507)
    assert.equal(r.cached_input_tokens, 39680)
    assert.equal(r.output_tokens, 257)
    assert.equal(r.reasoning_tokens, 0)
    assert.equal(r.request_id, `kimi:${file}:L42`)
    assert.equal(r.timestamp, 1784690944568)
  })

  it('folds cache creation into input_tokens', () => {
    const line = JSON.stringify({
      type: 'usage.record',
      model: 'kimi-code/k3',
      usage: { inputOther: 100, output: 10, inputCacheRead: 0, inputCacheCreation: 50 },
      usageScope: 'turn',
      time: 1,
    })
    const r = parseKimiUsageLine(line, file, 1)
    assert.equal(r.input_tokens, 150)
  })

  it('skips non-turn usageScope to avoid double counting', () => {
    const line = JSON.stringify({
      type: 'usage.record',
      model: 'kimi-code/k3',
      usage: { inputOther: 100, output: 10, inputCacheRead: 0, inputCacheCreation: 0 },
      usageScope: 'session',
      time: 1,
    })
    assert.equal(parseKimiUsageLine(line, file, 1), null)
  })

  it('skips all-zero usage', () => {
    const line = JSON.stringify({
      type: 'usage.record',
      model: 'kimi-code/k3',
      usage: { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 },
      usageScope: 'turn',
      time: 1,
    })
    assert.equal(parseKimiUsageLine(line, file, 1), null)
  })

  it('skips unrelated line types fast', () => {
    assert.equal(parseKimiUsageLine(JSON.stringify({ type: 'llm.request', model: 'k3' }), file, 1), null)
    assert.equal(parseKimiUsageLine('', file, 1), null)
  })

  it('falls back to unknown model', () => {
    const line = JSON.stringify({
      type: 'usage.record',
      usage: { inputOther: 5, output: 5, inputCacheRead: 0, inputCacheCreation: 0 },
      usageScope: 'turn',
      time: 1,
    })
    assert.equal(parseKimiUsageLine(line, file, 1).model, 'unknown')
  })
})

describe('normalizeKimiProjectName', () => {
  it('extracts slug from workDirKey', () => {
    assert.equal(normalizeKimiProjectName('wd_tokentrail_11bc1fca2b68'), 'tokentrail')
    assert.equal(normalizeKimiProjectName('wd_shuyuanstation_9502b7dafedf'), 'shuyuanstation')
  })

  it('passes through unexpected formats', () => {
    assert.equal(normalizeKimiProjectName('something-else'), 'something-else')
  })
})
