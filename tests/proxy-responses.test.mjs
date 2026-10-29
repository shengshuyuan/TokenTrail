import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { getDb } from '../src/lib/db.ts'
import { POST as openaiPost } from '../src/app/api/proxy/openai/[...path]/route.ts'
import { POST as traeworkPost } from '../src/app/api/proxy/openai-traework/[...path]/route.ts'

describe('Responses API proxy recording', () => {
  for (const [name, post] of [['openai', openaiPost], ['openai-traework', traeworkPost]]) {
    for (const streaming of [false, true]) {
      it(`${name} records ${streaming ? 'streaming' : 'JSON'} Responses usage and preserves the response`, async (t) => {
        const response = {
          id: `resp-${name}-${streaming}`,
          model: 'gpt-4.1',
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            input_tokens_details: { cached_tokens: 60 },
            output_tokens_details: { reasoning_tokens: 8 },
          },
        }
        const upstreamBody = streaming
          ? `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`
          : JSON.stringify(response)
        t.mock.method(globalThis, 'fetch', async () => new Response(upstreamBody, {
          headers: { 'Content-Type': streaming ? 'text/event-stream' : 'application/json' },
        }))
        const request = new NextRequest(`http://localhost:3820/api/proxy/${name}/responses`, {
          method: 'POST',
          headers: { authorization: 'Bearer test-caller-key', host: 'localhost:3820' },
          body: JSON.stringify({ model: response.model, input: 'test', stream: streaming }),
        })
        const result = await post(request, { params: Promise.resolve({ path: ['responses'] }) })
        assert.equal(result.status, 200)
        assert.equal(await result.text(), upstreamBody)
        const row = getDb().prepare('SELECT * FROM usage_records WHERE request_id = ?').get(response.id)
        assert.ok(row, 'usage must be inserted after consuming the proxy response')
        assert.equal(row.input_tokens, 40)
        assert.equal(row.cached_input_tokens, 60)
        assert.equal(row.output_tokens, 12)
        assert.equal(row.reasoning_tokens, 8)
      })
    }
  }
})
