import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Imports the real src/lib/proxy-usage.ts (Node 22+ strips types natively),
 * so the tests track production logic instead of a mirrored copy.
 */
import {
  SseUsageTracker,
  extractUsageFromSSE,
  normalizeOpenAIUsage,
  appendSseTail,
} from '../src/lib/proxy-usage.ts'

function track(...chunks) {
  const tracker = new SseUsageTracker()
  for (const chunk of chunks) tracker.push(chunk)
  return tracker.finalize()
}

describe('proxy SSE usage extraction', () => {
  it('prefers the last usage event (cumulative)', () => {
    const result = track(
      'data: {"id":"chatcmpl-1","model":"gpt-4.1","choices":[{"delta":{"content":"hi"}}]}\n',
      'data: {"id":"chatcmpl-1","model":"gpt-4.1","usage":{"prompt_tokens":10,"completion_tokens":2}}\n',
      'data: {"id":"chatcmpl-1","usage":{"prompt_tokens":10,"completion_tokens":5}}\n',
      'data: [DONE]\n'
    )
    assert.equal(result.model, 'gpt-4.1')
    assert.equal(result.id, 'chatcmpl-1')
    assert.equal(result.usage.completion_tokens, 5)
  })

  it('falls back to last seen model when usage chunk omits model', () => {
    const result = track(
      'data: {"id":"chatcmpl-2","model":"o3-mini","choices":[{"delta":{}}]}\n',
      'data: {"id":"chatcmpl-2","usage":{"prompt_tokens":100,"completion_tokens":20,"completion_tokens_details":{"reasoning_tokens":8}}}\n',
      'data: [DONE]\n'
    )
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

  it('keeps the model announced in the first chunk of a stream longer than the old 64K tail', () => {
    // Regression: tail-buffer parsing dropped the model when it only appeared
    // before the 64K cutoff and the final usage chunk omitted it.
    const filler = 'data: {"id":"chatcmpl-4","model":"gpt-4.1","choices":[{"delta":{"content":"' + 'x'.repeat(200) + '"}}]}\n'
    const result = track(
      'data: {"id":"chatcmpl-4","model":"gpt-4.1","choices":[{"delta":{"role":"assistant"}}]}\n',
      filler.repeat(400), // ~86KB of delta chunks without any model field
      'data: {"id":"chatcmpl-4","usage":{"prompt_tokens":100,"completion_tokens":20}}\n',
      'data: [DONE]\n'
    )
    assert.equal(result.model, 'gpt-4.1')
    assert.equal(result.usage.prompt_tokens, 100)
  })

  it('reassembles a data line split across two pushes', () => {
    const first = 'data: {"id":"chatcmpl-5","mod'
    const second = 'el":"gpt-4o","usage":{"prompt_tokens":7,"completion_tokens":3}}\n'
    const result = track(first, second)
    assert.equal(result.model, 'gpt-4o')
    assert.equal(result.usage.prompt_tokens, 7)
  })

  it('skips malformed lines without losing later usage', () => {
    const result = track(
      'data: {broken json\n',
      'data: {"id":"chatcmpl-6","model":"gpt-4.1","usage":{"prompt_tokens":9,"completion_tokens":1}}\n',
      'data: [DONE]\n'
    )
    assert.equal(result.model, 'gpt-4.1')
    assert.equal(result.usage.prompt_tokens, 9)
  })

  it('captures a partial trailing line in finalize', () => {
    const tracker = new SseUsageTracker()
    tracker.push('data: {"id":"chatcmpl-7","model":"gpt-4.1","usage":{"prompt_tokens":5,"completion_tokens":2}}')
    assert.equal(tracker.finalize().usage.prompt_tokens, 5)
  })

  it('caps the deprecated SSE tail helper', () => {
    const limited = appendSseTail('a'.repeat(100), 'b'.repeat(50), 80)
    assert.equal(limited.length, 80)
    assert.ok(limited.endsWith('b'.repeat(50)))
  })
})

describe('normalizeOpenAIUsage (mutually exclusive buckets)', () => {
  it('subtracts cached and reasoning subsets from their totals', () => {
    assert.deepEqual(
      normalizeOpenAIUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 60 },
        completion_tokens_details: { reasoning_tokens: 8 },
      }),
      { input_tokens: 40, cached_input_tokens: 60, output_tokens: 12, reasoning_tokens: 8 }
    )
  })

  it('is a no-op when no subsets are reported', () => {
    assert.deepEqual(
      normalizeOpenAIUsage({ prompt_tokens: 100, completion_tokens: 20 }),
      { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, reasoning_tokens: 0 }
    )
  })

  it('clamps subsets that exceed their totals and coerces bad values', () => {
    assert.deepEqual(
      normalizeOpenAIUsage({
        prompt_tokens: 10,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 99 },
        completion_tokens_details: { reasoning_tokens: Number.NaN },
      }),
      { input_tokens: 0, cached_input_tokens: 10, output_tokens: 5, reasoning_tokens: 0 }
    )
  })

  it('treats missing or empty usage as zeros', () => {
    assert.deepEqual(
      normalizeOpenAIUsage(undefined),
      { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }
    )
  })
})
