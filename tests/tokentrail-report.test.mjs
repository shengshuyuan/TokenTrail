import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { wrapOpenAI, report, getEndpoint } = require('../packages/tokentrail-report/index.js')

/** Fake OpenAI client whose chat.completions.create resolves the given response. */
function fakeClient(response) {
  return {
    chat: {
      completions: {
        create: async () => response,
      },
    },
  }
}

describe('tokentrail-report SDK', () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.TOKENTRAIL_URL

  beforeEach(() => {
    process.env.TOKENTRAIL_URL = 'http://localhost:3820'
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.TOKENTRAIL_URL
    else process.env.TOKENTRAIL_URL = originalUrl
  })

  it('getEndpoint strips trailing slashes and honors TOKENTRAIL_URL', () => {
    process.env.TOKENTRAIL_URL = 'http://localhost:3820///'
    assert.equal(getEndpoint(), 'http://localhost:3820')
  })

  it('report rejects payloads with all-zero tokens', async () => {
    const result = await report({ source: 'x', model: 'gpt-4.1', input_tokens: 0 })
    assert.equal(result.success, false)
    assert.match(result.error, /zero/i)
  })

  it('wrapOpenAI reports mutually exclusive buckets from inclusive OpenAI usage', async () => {
    let captured = null
    globalThis.fetch = async (_url, opts) => {
      captured = JSON.parse(opts.body)
      return { ok: true, json: async () => ({ success: true, cost_usd: 0, id: 1 }) }
    }

    const client = fakeClient({
      id: 'chatcmpl-9',
      model: 'gpt-4.1',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 60 },
        completion_tokens_details: { reasoning_tokens: 8 },
      },
    })
    wrapOpenAI(client, { source: 'test-agent' })
    await client.chat.completions.create({ model: 'gpt-4.1', messages: [] })
    // wait for the fire-and-forget report to land
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(captured.source, 'test-agent')
    assert.equal(captured.model, 'gpt-4.1')
    assert.equal(captured.request_id, 'chatcmpl-9')
    assert.equal(captured.input_tokens, 40)
    assert.equal(captured.cached_input_tokens, 60)
    assert.equal(captured.output_tokens, 12)
    assert.equal(captured.reasoning_tokens, 8)
  })

  it('wrapOpenAI invokes onError when the report fails and still returns the response', async () => {
    globalThis.fetch = async () => {
      throw new Error('connection refused')
    }
    const errors = []
    const client = fakeClient({
      id: 'chatcmpl-10',
      model: 'gpt-4.1',
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    })
    wrapOpenAI(client, { source: 'test-agent', onError: err => errors.push(err) })

    const response = await client.chat.completions.create({})
    assert.equal(response.id, 'chatcmpl-10')
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /connection refused/)
  })

  it('wrapOpenAI requires a source and a chat.completions client', () => {
    assert.throws(() => wrapOpenAI(fakeClient({}), {}), /source is required/)
    assert.throws(() => wrapOpenAI({}, { source: 'x' }), /chat\.completions\.create/)
  })
})
