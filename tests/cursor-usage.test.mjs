import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  readCursorSession,
  mapCursorUsageEvent,
  projectFromCursorSlug,
  collectCursorUsageRecords,
  collectCursorLocalModelRecords,
  conversationIdFromOfficialRequestId,
  projectFromCwd,
  INCREMENTAL_OVERLAP_MS,
  CURSOR_GROK_BOT_SOURCE,
  isCursorAutoRequestId,
  isCursorAutoDerivedRequestId,
  isCursorAutoRouted,
  inferAutoModels,
  planCursorAutoResolution,
  readCursorChatModels,
} from '../src/lib/cursor.js'
import { mapUsageSummary, fetchQuota } from '../src/lib/quotas/providers/cursor.js'

/**
 * Tests for the Cursor integration: local session reading, usage-event
 * mapping/pagination (src/lib/cursor.js) and the quota adapter
 * (src/lib/quotas/providers/cursor.js). No network: fetch is stubbed.
 */

const NOW = 1791363200000

function fakeJwt(payload) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${enc({ alg: 'HS256' })}.${enc(payload)}.sig`
}

function createStateDb(dbPath, token) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)')
  if (token) db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('cursorAuth/accessToken', token)
  db.close()
}

function jsonResponse(body, status = 200) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, text: async () => JSON.stringify(body) }
}

const opusEvent = {
  timestamp: String(NOW - 1000),
  model: 'claude-opus-5-5-medium',
  kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO',
  tokenUsage: { inputTokens: 16, outputTokens: 3487, cacheWriteTokens: 28753, cacheReadTokens: 318648, totalCents: 27.73 },
  conversationId: 'conv-a',
}

describe('cursor session', () => {
  let tmp
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cursor-')) })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('reads user id and expiry from the access token', () => {
    const dbPath = path.join(tmp, 'state.vscdb')
    createStateDb(dbPath, fakeJwt({ sub: 'google-oauth2|user_123', exp: NOW / 1000 + 3600 }))
    const session = readCursorSession({ dbPath, now: NOW })
    assert.equal(session.ok, true)
    assert.equal(session.userId, 'user_123')
    assert.equal(session.expiresAt, NOW + 3600 * 1000)
  })

  it('reports not_installed / not_logged_in / expired', () => {
    assert.equal(readCursorSession({ dbPath: path.join(tmp, 'missing.vscdb') }).reason, 'not_installed')
    const empty = path.join(tmp, 'empty.vscdb')
    createStateDb(empty, null)
    assert.equal(readCursorSession({ dbPath: empty }).reason, 'not_logged_in')
    const expired = path.join(tmp, 'expired.vscdb')
    createStateDb(expired, fakeJwt({ sub: 'auth0|user_1', exp: NOW / 1000 - 1 }))
    assert.equal(readCursorSession({ dbPath: expired, now: NOW }).reason, 'expired')
  })

  it('falls back to the CLI keychain token when the desktop database is missing', () => {
    const session = readCursorSession({
      home: tmp,
      now: NOW,
      readKeychain: () => fakeJwt({ sub: 'google-oauth2|user_cli', exp: NOW / 1000 + 60 }),
    })
    assert.equal(session.ok, true)
    assert.equal(session.userId, 'user_cli')
    assert.equal(readCursorSession({ home: tmp, now: NOW, readKeychain: () => '' }).reason, 'not_installed')
  })
})

describe('cursor usage events', () => {
  it('maps token buckets like Claude Code and keeps the billed cost', () => {
    const record = mapCursorUsageEvent(opusEvent, new Map([['conv-a', 'TokenTrail']]))
    assert.deepEqual(record, {
      source: 'cursor',
      provider: 'anthropic',
      model: 'claude-opus-5-5-medium',
      input_tokens: 16 + 28753,
      cached_input_tokens: 318648,
      output_tokens: 3487,
      reasoning_tokens: 0,
      cost_usd: 0.2773,
      request_id: `cursor:${NOW - 1000}:conv-a:claude-opus-5-5-medium`,
      timestamp: NOW - 1000,
      project: 'TokenTrail',
    })
  })

  it('shows Auto mode ("default" in the API) as auto but keeps the raw id for dedupe', () => {
    const record = mapCursorUsageEvent({ ...opusEvent, model: 'default' })
    assert.equal(record.model, 'auto')
    assert.equal(record.provider, 'cursor')
    assert.equal(record.request_id, `cursor:${NOW - 1000}:conv-a:default`)
  })

  it('puts grok-bot usage in its own source, keeps tokens but forces cost to $0', () => {
    const record = mapCursorUsageEvent({
      ...opusEvent,
      model: 'grok-bot-default',
      tokenUsage: { ...opusEvent.tokenUsage, totalCents: 12.5 },
    })
    assert.equal(record.source, CURSOR_GROK_BOT_SOURCE)
    assert.equal(record.source, 'cursor-grok-bot')
    assert.equal(record.model, 'grok-bot-default')
    assert.equal(record.provider, 'xai')
    assert.equal(record.input_tokens, 16 + 28753)
    assert.equal(record.cost_usd, 0)
    // request_id 仍用官方前缀，和历史记录去重不受来源改名影响
    assert.equal(record.request_id, `cursor:${NOW - 1000}:conv-a:grok-bot-default`)
  })

  it('skips events without token usage instead of writing zeros', () => {
    assert.equal(mapCursorUsageEvent({ timestamp: String(NOW), model: 'x', isTokenBasedCall: false }), null)
    assert.equal(mapCursorUsageEvent({ timestamp: String(NOW), model: 'x', tokenUsage: {} }), null)
  })

  it('derives project names from ~/.cursor/projects slugs', () => {
    assert.equal(projectFromCursorSlug('Users-me-Desktop-VIbe-coding-TokenTrail'), 'TokenTrail')
    assert.equal(projectFromCursorSlug('Users-me-Desktop-VIbe-cod-d14e093'), undefined)
    assert.equal(projectFromCursorSlug('1787126702686'), undefined)
    assert.equal(projectFromCursorSlug('empty-window'), undefined)
  })

  it('paginates, dedupes and fetches incrementally from the latest synced record', async () => {
    const bodies = []
    const pages = [
      [opusEvent, { ...opusEvent }],
      [{ ...opusEvent, timestamp: String(NOW - 5000), conversationId: 'conv-b', model: 'grok-bot-default' }],
    ]
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body)
      bodies.push(body)
      return jsonResponse({ totalUsageEventsCount: 3, usageEventsDisplay: pages[body.page - 1] ?? [] })
    }
    const result = await collectCursorUsageRecords({
      session: { ok: true, userId: 'u', accessToken: 't' },
      latestSyncedAt: NOW - 60_000,
      now: NOW,
      home: os.tmpdir(),
      fetchImpl,
      pageSize: 2,
    })
    assert.equal(result.ok, true)
    assert.equal(bodies[0].startDate, String(NOW - 60_000 - INCREMENTAL_OVERLAP_MS))
    assert.equal(result.records.length, 2)
    assert.equal(result.records[1].provider, 'xai')
  })

  it('surfaces auth failures with a readable message', async () => {
    const result = await collectCursorUsageRecords({
      session: { ok: true, userId: 'u', accessToken: 't' },
      now: NOW,
      fetchImpl: async () => jsonResponse({}, 401),
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'auth')
    assert.match(result.message, /重新登录/)
  })
})

describe('cursor local model supplement', () => {
  let home
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-cursor-local-')) })
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }) })

  const TS = new Date(2026, 10, 6, 21, 0, 0).getTime()
  const NEXT_DAY = TS + 24 * 3600 * 1000

  const transcript = [
    { role: 'user', message: { content: [{ type: 'text', text: 'x'.repeat(300) }] } },
    { role: 'assistant', message: { content: [{ type: 'text', text: 'y'.repeat(900) }] } },
  ]

  /** 造一个 Cursor 命令行对话存储：parts 是 [模型名, 段数, 每段文字长度]，blob 里每段回复带 providerOptions.cursor.modelName。 */
  function seedChat(conv, parts, { updatedAtMs = TS, encrypted = false } = {}) {
    const dir = path.join(home, '.cursor', 'chats', 'workspace-hash', conv)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ updatedAtMs }))
    const db = new Database(path.join(dir, 'store.db'))
    db.exec('CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)')
    const ins = db.prepare('INSERT INTO blobs (id, data) VALUES (?, ?)')
    let n = 0
    for (const [model, count, textLen = 2] of parts) {
      for (let i = 0; i < count; i++) {
        const blob = { role: 'assistant', id: `m${n}`, content: [{ type: 'text', text: 'a'.repeat(textLen), providerOptions: { cursor: { modelName: model } } }] }
        ins.run(`b${n++}`, Buffer.from(JSON.stringify(blob)))
      }
    }
    if (encrypted) ins.run('enc', Buffer.from([0x01, 0x02, 0x03, 0x04]))
    db.close()
  }

  function seedTranscript(conv, lines = transcript) {
    const dir = path.join(home, '.cursor', 'projects', 'Users-me-Desktop-Folotoy', 'agent-transcripts', conv)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${conv}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'))
  }

  function seedTracking(rows) {
    const dbPath = path.join(home, '.cursor', 'ai-tracking', 'ai-code-tracking.db')
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const db = new Database(dbPath)
    db.exec('CREATE TABLE ai_code_hashes (hash TEXT PRIMARY KEY, source TEXT NOT NULL, requestId TEXT, conversationId TEXT, timestamp INTEGER, createdAt INTEGER NOT NULL, model TEXT)')
    const ins = db.prepare('INSERT INTO ai_code_hashes (hash, source, requestId, conversationId, timestamp, createdAt, model) VALUES (?, ?, ?, ?, ?, ?, ?)')
    rows.forEach((r, i) => ins.run(`h${i}`, 'composer', r.req, r.conv, r.ts ?? TS, r.ts ?? TS, r.model ?? 'claude-opus-5-5'))
    db.close()
  }

  it('uses the real model from the chat store and estimates tokens from the transcript', () => {
    seedChat('conv-sonnet', [['claude-sonnet-5-5-high', 4]], { encrypted: true })
    seedTranscript('conv-sonnet')
    const records = collectCursorLocalModelRecords({ home })
    assert.equal(records.length, 1)
    assert.equal(records[0].model, 'claude-sonnet-5-5-high')
    assert.equal(records[0].estimated, true)
    assert.equal(records[0].cost_usd, 0) // 没把握的金额不报，只留用量
    assert.equal(records[0].project, 'Folotoy')
    // 900 助手字符 ÷ 1.6 ≈ 563 输出；常规输入 6.4×、缓存读取 133× 来自官方账单反推
    assert.equal(records[0].output_tokens, 563)
    assert.equal(records[0].input_tokens, 3603)
    assert.equal(records[0].cached_input_tokens, 74879)
    assert.match(records[0].request_id, /^cursor-local:conv-sonnet:claude-sonnet-5-5-high:2026-11-06$/)
  })

  it('does not trust the tracking database model when it disagrees with the chat store', () => {
    seedChat('conv-a', [['claude-sonnet-5-5-high', 2]])
    seedTranscript('conv-a')
    seedTracking([{ req: 'r1', conv: 'conv-a', model: 'claude-opus-5-5' }])
    const records = collectCursorLocalModelRecords({ home })
    assert.deepEqual(records.map((r) => r.model), ['claude-sonnet-5-5-high'])
  })

  it('splits a conversation that used several models by output size, not reply count', () => {
    // 文字 275/75 字符 + 25 字符的 JSON 外壳 = 300/100 → 75% / 25%（Opus 只有 1 段、Grok 有 3 段短回复也不影响）
    seedChat('conv-mix', [['claude-opus-5-5-medium', 1, 275], ['grok-4.7-high', 1, 75]])
    seedTranscript('conv-mix')
    const byModel = Object.fromEntries(collectCursorLocalModelRecords({ home }).map((r) => [r.model, r.output_tokens]))
    assert.deepEqual(byModel, { 'claude-opus-5-5-medium': 422, 'grok-4.7-high': 141 })
  })

  it('splits one conversation across days using the tracking request distribution', () => {
    seedChat('c', [['claude-opus-5-5-medium', 4]])
    seedTranscript('c')
    seedTracking([
      { req: 'r1', conv: 'c' },
      { req: 'r2', conv: 'c', ts: NEXT_DAY },
      { req: 'r3', conv: 'c', ts: NEXT_DAY },
      { req: 'r4', conv: 'c', ts: NEXT_DAY },
    ])
    const records = collectCursorLocalModelRecords({ home }).sort((a, b) => a.timestamp - b.timestamp)
    assert.deepEqual(records.map((r) => r.output_tokens), [141, 422])
  })

  it('skips covered conversations, chats without model parts and chats without a transcript', () => {
    seedChat('covered', [['claude-opus-5-5-medium', 2]])
    seedChat('no-parts', [])
    seedChat('no-transcript', [['claude-opus-5-5-medium', 2]])
    seedTranscript('covered')
    seedTranscript('no-parts')
    const records = collectCursorLocalModelRecords({ home, coveredConversationIds: new Set(['covered']) })
    assert.deepEqual(records, [])
  })

  it('returns nothing when Cursor has no chat store', () => {
    assert.deepEqual(collectCursorLocalModelRecords({ home }), [])
  })

  it('names the project from the chat cwd and skips generic folder names', () => {
    assert.equal(projectFromCwd('/Users/me/VIbe coding/TokenTrail'), 'TokenTrail')
    assert.equal(projectFromCwd('/Users/me/VIbe coding/Boss Think Twice/repo'), 'Boss Think Twice')
    assert.equal(projectFromCwd(''), undefined)
  })

  it('extracts the conversation id from an official request_id', () => {
    assert.equal(conversationIdFromOfficialRequestId('cursor:1789995323280:5fdc0e8a-0764:grok-bot-default'), '5fdc0e8a-0764')
    assert.equal(conversationIdFromOfficialRequestId('cursor-local:abc:claude-opus-5-5:2026-11-06'), '')
    // 拆分出的派生记录仍能取到对话 id，官方补全时才不会把它当成「未覆盖」
    assert.equal(conversationIdFromOfficialRequestId('cursor:1:conv-x:default/grok-4.7-high'), 'conv-x')
  })

  // ── Auto 模式底层模型识别 ──
  const autoRow = (conv, ts, extra = {}) => ({
    id: extra.id ?? 1,
    request_id: `cursor:${ts}:${conv}:default`,
    model: 'auto',
    provider: 'cursor',
    project: 'TokenTrail',
    timestamp: ts,
    input_tokens: 1000,
    cached_input_tokens: 100000,
    output_tokens: 101,
    reasoning_tokens: 0,
    cost_usd: 0,
    is_internal: 0,
    ...extra,
  })

  it('recognises Auto request ids (original, derived, routed)', () => {
    assert.equal(isCursorAutoRequestId('cursor:1:conv:default'), true)
    assert.equal(isCursorAutoRequestId('cursor:1:conv:default/grok-4.7-high'), false)
    assert.equal(isCursorAutoRequestId('cursor:1:conv:claude-opus-5-5-medium'), false)
    assert.equal(isCursorAutoDerivedRequestId('cursor:1:conv:default/grok-4.7-high'), true)
    assert.equal(isCursorAutoDerivedRequestId('cursor:1:conv:default'), false)
    assert.equal(isCursorAutoRouted('cursor:1:conv:default'), true)
    assert.equal(isCursorAutoRouted('cursor:1:conv:default/x'), true)
    assert.equal(isCursorAutoRouted('cursor-local:conv:x:2026-11-06'), false)
  })

  it('infers the single underlying model and ignores noise below 2%', () => {
    assert.deepEqual(inferAutoModels(new Map([['grok-4.7-high', 5000]])), [{ model: 'grok-4.7-high', share: 1 }])
    // 103 段 Opus-fast 对 1 段 Grok：Grok 是噪音，不单独拆
    assert.deepEqual(
      inferAutoModels(new Map([['claude-opus-5-5-medium-fast', 20600], ['cursor-grok-4.5-high', 200]])),
      [{ model: 'claude-opus-5-5-medium-fast', share: 1 }],
    )
    assert.deepEqual(inferAutoModels(new Map()), [])
    assert.deepEqual(inferAutoModels(undefined), [])
  })

  it('excludes models the user picked explicitly in the same conversation', () => {
    // 官方已有 sonnet 的具名记录，所以 Auto 背后只能是 opus-fast
    const resolved = inferAutoModels(
      new Map([['claude-sonnet-5-5-high', 1400], ['claude-opus-5-5-medium-fast', 700]]),
      new Set(['claude-sonnet-5-5-high']),
    )
    assert.deepEqual(resolved, [{ model: 'claude-opus-5-5-medium-fast', share: 1 }])
    // 本机全部模型都被具名记录覆盖时，退回全部候选，而不是什么都识别不出
    assert.equal(inferAutoModels(new Map([['a', 1]]), new Set(['a'])).length, 1)
  })

  it('relabels a single-model Auto conversation in place without touching request_id', () => {
    const chats = new Map([['conv-1', { models: new Map([['grok-4.7-high', 9000]]) }]])
    const plan = planCursorAutoResolution([autoRow('conv-1', TS)], chats)
    assert.deepEqual(plan.updates, [{ id: 1, model: 'grok-4.7-high', provider: 'xai', is_internal: false }])
    assert.deepEqual(plan.derived, [])
    // 已经改好的记录不再出现在 updates 里（幂等）
    const again = planCursorAutoResolution([autoRow('conv-1', TS, { model: 'grok-4.7-high', provider: 'xai' })], chats)
    assert.deepEqual(again.updates, [])
  })

  it('hides and splits an Auto row when the conversation mixed several models', () => {
    const chats = new Map([['conv-mix', { models: new Map([['grok-4.7-high', 7500], ['claude-opus-5-5-medium', 2500]]) }]])
    const plan = planCursorAutoResolution([autoRow('conv-mix', TS, { id: 7 })], chats)
    assert.deepEqual(plan.updates, [{ id: 7, model: 'auto', provider: 'cursor', is_internal: true }])
    assert.equal(plan.derived.length, 2)
    const [grok, opus] = plan.derived
    assert.equal(grok.request_id, `cursor:${TS}:conv-mix:default/grok-4.7-high`)
    assert.equal(opus.request_id, `cursor:${TS}:conv-mix:default/claude-opus-5-5-medium`)
    assert.equal(grok.source, 'cursor')
    assert.equal(grok.project, 'TokenTrail')
    assert.equal(grok.estimated, false)
    // 75% / 25%，最后一条拿余数：每列之和等于原记录
    assert.equal(grok.output_tokens, 76)
    assert.equal(opus.output_tokens, 25)
    assert.equal(grok.input_tokens + opus.input_tokens, 1000)
    assert.equal(grok.cached_input_tokens + opus.cached_input_tokens, 100000)
  })

  it('keeps Auto rows unchanged when no local chat matches, and ignores explicit rows', () => {
    const rows = [
      autoRow('conv-unknown', TS),
      { ...autoRow('conv-unknown', TS, { id: 2 }), request_id: `cursor:${TS}:conv-unknown:claude-opus-5-5-medium`, model: 'claude-opus-5-5-medium' },
    ]
    const plan = planCursorAutoResolution(rows, new Map())
    assert.deepEqual(plan, { updates: [], derived: [] })
  })

  it('reads chat store models for the planner (same source as the estimate supplement)', () => {
    seedChat('conv-store', [['grok-4.7-high', 3, 40], ['claude-opus-5-5-medium', 1, 40]])
    const chats = readCursorChatModels(home)
    assert.ok(chats.has('conv-store'))
    const plan = planCursorAutoResolution([autoRow('conv-store', TS)], chats)
    assert.equal(plan.updates[0].is_internal, true)
    assert.deepEqual(plan.derived.map((r) => r.model), ['grok-4.7-high', 'claude-opus-5-5-medium'])
  })
})

describe('cursor quota adapter', () => {
  const summary = {
    billingCycleStart: '2026-10-07T08:46:14.000Z',
    billingCycleEnd: '2026-11-07T08:46:14.000Z',
    membershipType: 'pro',
    isUnlimited: false,
    individualUsage: {
      plan: { enabled: true, used: 102, limit: 2000, remaining: 1898, apiPercentUsed: 4.5333, totalPercentUsed: 0.2159 },
      onDemand: { enabled: false, used: 0, limit: null },
    },
  }

  it('maps the monthly plan into API and total windows', () => {
    const snap = mapUsageSummary(summary, NOW)
    assert.equal(snap.provider, 'cursor')
    assert.equal(snap.planLabel, 'Cursor Pro')
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.windows.length, 2)
    const api = snap.windows[0]
    assert.equal(api.id, 'cursor-api')
    assert.equal(api.used, undefined)
    assert.equal(api.limit, undefined)
    assert.equal(api.usedPercent, 4.5)
    assert.equal(api.resetsAt, Date.parse('2026-11-07T08:46:14.000Z'))
    assert.equal(snap.windows[1].usedPercent, 0.2)
  })

  it('turns warning when the included usage is almost spent and shows on-demand', () => {
    const snap = mapUsageSummary({
      ...summary,
      individualUsage: {
        plan: { enabled: true, used: 1900, limit: 2000, apiPercentUsed: 95, autoPercentUsed: 10, totalPercentUsed: 96 },
        onDemand: { enabled: true, used: 500, limit: 1000 },
      },
    }, NOW)
    assert.equal(snap.status, 'critical')
    assert.equal(snap.windows.find((w) => w.id === 'cursor-on-demand').usedPercent, 50)
    assert.equal(snap.windows.find((w) => w.id === 'cursor-auto').usedPercent, 10)
  })

  it('rejects unknown response shapes and missing logins', async () => {
    assert.throws(() => mapUsageSummary({ foo: 1 }, NOW), { code: 'unsupported_version' })
    await assert.rejects(
      fetchQuota({ home: '/x', now: () => NOW, readCursorSession: () => ({ ok: false, reason: 'not_logged_in' }) }),
      { code: 'not_configured' },
    )
    await assert.rejects(
      fetchQuota({ home: '/x', now: () => NOW, readCursorSession: () => ({ ok: false, reason: 'expired' }) }),
      { code: 'auth' },
    )
  })
})
