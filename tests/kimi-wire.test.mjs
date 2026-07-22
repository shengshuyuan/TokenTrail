import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createKimiHomeContext, parseKimiWireLine, resolveKimiWireContext } = require('../src/lib/kimi.js')

test('parses current Kimi Code usage.record events', () => {
  const parsed = parseKimiWireLine(JSON.stringify({
    type: 'usage.record',
    model: 'kimi-k2.5',
    usage: { inputOther: 120, output: 30, inputCacheRead: 80, inputCacheCreation: 10 },
    usageScope: 'turn',
    time: 1779256800302,
  }))

  assert.deepEqual(parsed.records, [{
    model: 'kimi-k2.5',
    input_tokens: 130,
    cached_input_tokens: 80,
    output_tokens: 30,
    reasoning_tokens: 0,
    timestamp: 1779256800302,
  }])
})

test('skips current Kimi Code session-scope aggregate events', () => {
  const parsed = parseKimiWireLine(JSON.stringify({
    type: 'usage.record',
    model: 'kimi-code',
    usage: { inputOther: 120, output: 30, inputCacheRead: 0, inputCacheCreation: 0 },
    usageScope: 'session',
    time: 1779256800302,
  }))
  assert.deepEqual(parsed.records, [])
})

test('parses legacy StatusUpdate usage and converts unix seconds to milliseconds', () => {
  const parsed = parseKimiWireLine(JSON.stringify({
    timestamp: 1718000000.25,
    message: {
      type: 'StatusUpdate',
      payload: {
        token_usage: { input_other: 50, output: 12, input_cache_read: 20, input_cache_creation: 5 },
        message_id: 'msg-1',
      },
    },
  }))

  assert.equal(parsed.records[0].model, 'kimi-code')
  assert.equal(parsed.records[0].input_tokens, 55)
  assert.equal(parsed.records[0].cached_input_tokens, 20)
  assert.equal(parsed.records[0].output_tokens, 12)
  assert.equal(parsed.records[0].timestamp, 1718000000250)
})

test('uses the current session index for exact project attribution', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tokentrail-kimi-'))
  try {
    const sessionDir = path.join(home, 'sessions', 'wd_token-trail_0123456789ab', 'session-1')
    const wireFile = path.join(sessionDir, 'agents', 'main', 'wire.jsonl')
    fs.mkdirSync(path.dirname(wireFile), { recursive: true })
    fs.writeFileSync(wireFile, '')
    fs.writeFileSync(path.join(home, 'session_index.jsonl'), JSON.stringify({
      sessionId: 'session-1',
      sessionDir,
      workDir: '/Users/example/projects/TokenTrail',
    }) + '\n')

    const context = createKimiHomeContext(home)
    assert.equal(resolveKimiWireContext(context, wireFile).project, 'TokenTrail')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
