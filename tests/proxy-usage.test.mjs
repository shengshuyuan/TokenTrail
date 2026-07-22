import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Mirrors src/lib/proxy-usage.ts so plain node --test can validate SSE extraction
 * without a TypeScript loader.
 */

function extractUsageFromSSE(chunk) {
  let lastModel
  let lastId
  let lastUsage = null

  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
    try {
      const obj = JSON.parse(line.slice(6))
      if (typeof obj.model === 'string' && obj.model.trim()) lastModel = obj.model.trim()
      if (typeof obj.id === 'string' && obj.id.trim()) lastId = obj.id.trim()
      if (obj.usage) {
        const model = (typeof obj.model === 'string' && obj.model.trim()) || lastModel
        if (!model) continue
        lastUsage = {
          model,
          id: (typeof obj.id === 'string' && obj.id.trim()) || lastId,
          usage: obj.usage,
        }
      }
    } catch {}
  }
  return lastUsage
}

function appendSseTail(existing, next, limit = 64 * 1024) {
  const combined = existing + next
  return combined.length > limit ? combined.slice(-limit) : combined
}

describe('proxy SSE usage extraction', () => {
  it('prefers the last usage event (cumulative)', () => {
    const stream = [
      'data: {"id":"chatcmpl-1","model":"gpt-4.1","choices":[{"delta":{"content":"hi"}}]}',
      'data: {"id":"chatcmpl-1","model":"gpt-4.1","usage":{"prompt_tokens":10,"completion_tokens":2}}',
      'data: {"id":"chatcmpl-1","usage":{"prompt_tokens":10,"completion_tokens":5}}',
      'data: [DONE]',
    ].join('\n')

    const result = extractUsageFromSSE(stream)
    assert.equal(result.model, 'gpt-4.1')
    assert.equal(result.id, 'chatcmpl-1')
    assert.equal(result.usage.completion_tokens, 5)
  })

  it('falls back to last seen model when usage chunk omits model', () => {
    const stream = [
      'data: {"id":"chatcmpl-2","model":"o3-mini","choices":[{"delta":{}}]}',
      'data: {"id":"chatcmpl-2","usage":{"prompt_tokens":100,"completion_tokens":20,"completion_tokens_details":{"reasoning_tokens":8}}}',
      'data: [DONE]',
    ].join('\n')

    const result = extractUsageFromSSE(stream)
    assert.equal(result.model, 'o3-mini')
    assert.equal(result.usage.prompt_tokens, 100)
    assert.equal(result.usage.completion_tokens_details.reasoning_tokens, 8)
  })

  it('returns null when no usage is present', () => {
    const stream = [
      'data: {"id":"chatcmpl-3","model":"gpt-4o","choices":[{"delta":{"content":"x"}}]}',
      'data: [DONE]',
    ].join('\n')
    assert.equal(extractUsageFromSSE(stream), null)
  })

  it('caps SSE tail buffer size', () => {
    const limited = appendSseTail('a'.repeat(100), 'b'.repeat(50), 80)
    assert.equal(limited.length, 80)
    assert.ok(limited.endsWith('b'.repeat(50)))
  })
})
