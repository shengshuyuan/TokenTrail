import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

// 每个用例都在自己的临时 HOME 下跑，绝不碰真实 ~/.workbuddy
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-workbuddy-sync-'))
process.env.HOME = home
process.env.WORKBUDDY_HOME = path.join(home, '.workbuddy')

const root = process.env.WORKBUDDY_HOME
const pid = '4242'
const traceFile = path.join(root, 'traces', pid, 'trace_aaaa.jsonl')
const sessionId = 'sess-1'
const projectDir = path.join(root, 'projects', 'Users-me-Desktop-Work-TokenTrail')
const convoFile = path.join(projectDir, `${sessionId}.jsonl`)

const TURN_REQUEST_ID = 'req-01'
const CALL_TS = '2026-10-29T14:00:00.000Z'

/** 一条 generation span：toolOutput 就是官方 chat.completion 响应。 */
function generationSpan({ id, model, prompt, cached, completion, reasoning, startedAt }) {
  const response = [{
    id,
    model,
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      prompt_tokens_details: { cached_tokens: cached },
      completion_tokens_details: { reasoning_tokens: reasoning },
    },
  }]
  return JSON.stringify({
    type: 'span_end',
    span: {
      traceId: 'trace_aaaa',
      spanId: `span_${id}`,
      name: 'generation',
      type: 'generation',
      startedAt,
      endedAt: startedAt,
      status: 'ok',
      toolOutput: JSON.stringify(response),
    },
  })
}

function setup() {
  fs.mkdirSync(path.dirname(traceFile), { recursive: true })
  fs.mkdirSync(projectDir, { recursive: true })

  fs.writeFileSync(
    traceFile,
    [
      generationSpan({ id: '01aTESTCALL0001', model: 'deep-model', prompt: 20000, cached: 15000, completion: 700, reasoning: 120, startedAt: CALL_TS }),
      generationSpan({ id: '01aTESTCALL0002', model: 'deep-model', prompt: 21000, cached: 16000, completion: 500, reasoning: 0, startedAt: '2026-10-29T14:01:00.000Z' }),
      // 被截断的响应（没有 usage）：必须跳过，不许估算
      JSON.stringify({ type: 'span_end', span: { type: 'generation', spanId: 'span_broken', startedAt: '2026-10-29T14:02:00.000Z', toolOutput: '{"id":"x","usa' } }),
      // 非 generation span：直接忽略
      JSON.stringify({ type: 'span_end', span: { type: 'function', spanId: 'span_f1', startedAt: '2026-10-29T14:02:00.000Z' } }),
      '',
    ].join('\n'),
    'utf8'
  )

  // 会话记录：cwd 决定项目名，conversationRequestId 用来给积分定时间和模型
  fs.writeFileSync(
    convoFile,
    [
      JSON.stringify({ type: 'session-meta', sessionId, timestamp: 1793280000000 }),
      JSON.stringify({ type: 'message', role: 'user', timestamp: 1793282400000, cwd: '/Users/me/Desktop/Work/TokenTrail', providerData: { conversationRequestId: TURN_REQUEST_ID, model: 'deep-model' } }),
      '',
    ].join('\n'),
    'utf8'
  )

  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'sessions', `${pid}.json`),
    JSON.stringify({ sessionId, cwd: '/Users/me/Desktop/Work/TokenTrail' }),
    'utf8'
  )

  const db = new Database(path.join(root, 'workbuddy.db'))
  db.exec('CREATE TABLE session_usage (session_id TEXT PRIMARY KEY, used INTEGER, size INTEGER, updated_at INTEGER, credit_json TEXT)')
  db.prepare('INSERT INTO session_usage VALUES (?, ?, ?, ?, ?)').run(
    sessionId,
    45004,
    600000,
    1793285000000,
    JSON.stringify({ [TURN_REQUEST_ID]: 0.67 })
  )
  db.close()
}

describe('syncWorkBuddy', () => {
  it('writes real traced tokens and official credits, attributing the project', async () => {
    setup()
    const { syncWorkBuddy } = await import('../src/lib/sync/sources/workbuddy.ts')
    const { getDb } = await import('../src/lib/db.ts')

    const result = syncWorkBuddy()
    assert.equal(result.errors, 0)
    assert.equal(result.scanned, 3, '2 traced calls + 1 credit row; broken span skipped')

    const db = getDb()
    const first = db.prepare('SELECT * FROM usage_records WHERE request_id = ?').get('workbuddy:01aTESTCALL0001')
    assert.ok(first, 'traced call stored')
    assert.equal(first.source, 'workbuddy')
    assert.equal(first.model, 'deep-model')
    assert.equal(first.project, 'TokenTrail')
    // prompt_tokens 含 cached，必须拆开：input = prompt - cached
    assert.equal(first.input_tokens, 5000)
    assert.equal(first.cached_input_tokens, 15000)
    assert.equal(first.output_tokens, 580)
    assert.equal(first.reasoning_tokens, 120)
    assert.equal(first.estimated, 0, '真实 usage 不能被标成估算')

    const credit = db.prepare('SELECT * FROM usage_records WHERE request_id = ?').get(`workbuddy-credit:${TURN_REQUEST_ID}`)
    assert.ok(credit, 'credit row stored')
    assert.equal(credit.credits, 0.67)
    assert.equal(credit.input_tokens + credit.output_tokens, 0)
    assert.equal(credit.project, 'TokenTrail')
    assert.equal(credit.timestamp, 1793282400000, 'credit row uses the turn timestamp')

    const broken = db.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE request_id LIKE '%span_broken%'").get()
    assert.equal(broken.n, 0, 'no usage means no row')
  })

  it('is idempotent: a second sync only produces duplicates', async () => {
    const { syncWorkBuddy } = await import('../src/lib/sync/sources/workbuddy.ts')
    const { getDb } = await import('../src/lib/db.ts')

    const before = getDb().prepare('SELECT COUNT(*) AS n FROM usage_records WHERE source = ?').get('workbuddy').n
    syncWorkBuddy()
    const after = getDb().prepare('SELECT COUNT(*) AS n FROM usage_records WHERE source = ?').get('workbuddy').n
    assert.equal(after, before)
  })

  it('raises an existing credit row when the conversation total grows', async () => {
    const { syncWorkBuddy } = await import('../src/lib/sync/sources/workbuddy.ts')
    const { getDb } = await import('../src/lib/db.ts')
    const requestId = `workbuddy-credit:${TURN_REQUEST_ID}`
    const db = getDb()

    // 首次同步写入的累计值（0.67），随后 WorkBuddy 把同一回合涨到 11.98
    db.prepare('UPDATE usage_records SET credits = ? WHERE request_id = ?').run(0.67, requestId)
    const rotateCredits = (value) => {
      const handle = new Database(path.join(root, 'workbuddy.db'))
      handle.prepare('UPDATE session_usage SET credit_json = ?').run(JSON.stringify({ [TURN_REQUEST_ID]: value }))
      handle.close()
    }
    rotateCredits(11.98)

    const result = syncWorkBuddy()
    assert.equal(result.errors, 0)
    assert.equal(result.raised, 1, 'the grown total counts as a raise, not a plain duplicate')

    const row = db.prepare('SELECT credits FROM usage_records WHERE request_id = ?').get(requestId)
    assert.equal(row.credits, 11.98, 'row keeps the latest official total')

    // 同一个值再同步一次：不该再抬，也不该回退
    rotateCredits(11.98)
    const again = syncWorkBuddy()
    assert.equal(again.raised ?? 0, 0)
    assert.equal(db.prepare('SELECT credits FROM usage_records WHERE request_id = ?').get(requestId).credits, 11.98)
  })
})
