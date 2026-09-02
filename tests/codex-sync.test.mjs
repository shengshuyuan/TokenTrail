import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createCodexSessionUsageParser, isCodexInternalModel } from '../src/lib/codex.js'

describe('Codex usage parsing', () => {
  it('ignores token events before the session has declared a model', () => {
    const parser = createCodexSessionUsageParser()

    const record = parser.parse({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 1_000,
            cached_input_tokens: 800,
            output_tokens: 100,
            reasoning_output_tokens: 60,
          },
        },
      },
    })

    assert.equal(record, null)
  })

  it('uses the declared model and keeps Codex token categories mutually exclusive', () => {
    const parser = createCodexSessionUsageParser()

    parser.parse({ type: 'turn_context', payload: { model: 'gpt-5.5' } })
    const record = parser.parse({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 1_000,
            cached_input_tokens: 800,
            output_tokens: 100,
            reasoning_output_tokens: 60,
            total_tokens: 1_100,
          },
        },
      },
    })

    assert.deepEqual(record, {
      model: 'gpt-5.5',
      input_tokens: 200,
      cached_input_tokens: 800,
      output_tokens: 40,
      reasoning_tokens: 60,
    })
    assert.equal(
      record.input_tokens + record.cached_input_tokens + record.output_tokens + record.reasoning_tokens,
      1_100,
    )
  })

  it('identifies Codex automatic review as internal rather than a user-selectable model', () => {
    assert.equal(isCodexInternalModel('codex-auto-review'), true)
    assert.equal(isCodexInternalModel('gpt-5.6-sol'), false)
  })
})
