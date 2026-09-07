import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Imports the real src/lib/local-request.ts (the module is intentionally free
 * of next/server imports so plain node --test can exercise it).
 */
import { rejectUnsafeLocalMutation } from '../src/lib/local-request.ts'

function localRequest(headers = {}) {
  return new Request('http://localhost:3820/api/quotas/config', {
    method: 'POST',
    headers,
  })
}

async function statusOf(result) {
  return result === null ? null : result.status
}

describe('rejectUnsafeLocalMutation', () => {
  describe('cross-site browser requests are rejected', () => {
    it('rejects a foreign Origin header', async () => {
      const res = rejectUnsafeLocalMutation(
        localRequest({ origin: 'https://evil.example', host: 'localhost:3820' })
      )
      assert.equal(await statusOf(res), 403)
    })

    it('rejects sec-fetch-site: cross-site even without Origin', async () => {
      const res = rejectUnsafeLocalMutation(
        localRequest({ 'sec-fetch-site': 'cross-site' })
      )
      assert.equal(await statusOf(res), 403)
    })

    it('rejects a malformed Origin header', async () => {
      const res = rejectUnsafeLocalMutation(
        localRequest({ origin: 'not-a-url', host: 'localhost:3820' })
      )
      assert.equal(await statusOf(res), 403)
    })

    it('rejects a local Origin aimed at a non-local Host header', async () => {
      const res = rejectUnsafeLocalMutation(
        localRequest({ origin: 'http://localhost:3820', host: '192.168.1.5:3820' })
      )
      assert.equal(await statusOf(res), 403)
    })
  })

  describe('CLI and same-origin requests pass', () => {
    it('allows requests without Origin (CLI / curl / SDK)', () => {
      assert.equal(rejectUnsafeLocalMutation(localRequest()), null)
    })

    it('allows a local Origin on a local Host', () => {
      assert.equal(
        rejectUnsafeLocalMutation(
          localRequest({ origin: 'http://localhost:3820', host: '127.0.0.1:3820' })
        ),
        null
      )
    })

    it('allows same-origin browser requests', () => {
      assert.equal(
        rejectUnsafeLocalMutation(
          localRequest({
            origin: 'http://localhost:3820',
            host: 'localhost:3820',
            'sec-fetch-site': 'same-origin',
          })
        ),
        null
      )
    })
  })

  describe('TOKENTRAIL_ALLOW_REMOTE=1 escape hatch', () => {
    let original
    beforeEach(() => {
      original = process.env.TOKENTRAIL_ALLOW_REMOTE
      process.env.TOKENTRAIL_ALLOW_REMOTE = '1'
    })
    afterEach(() => {
      if (original === undefined) delete process.env.TOKENTRAIL_ALLOW_REMOTE
      else process.env.TOKENTRAIL_ALLOW_REMOTE = original
    })

    it('allows cross-site requests when explicitly enabled', () => {
      assert.equal(
        rejectUnsafeLocalMutation(localRequest({ origin: 'https://evil.example' })),
        null
      )
    })
  })
})
