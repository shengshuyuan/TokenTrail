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
  INCREMENTAL_OVERLAP_MS,
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

  it('keeps grok-bot token usage but forces cost to $0', () => {
    const record = mapCursorUsageEvent({
      ...opusEvent,
      model: 'grok-bot-default',
      tokenUsage: { ...opusEvent.tokenUsage, totalCents: 12.5 },
    })
    assert.equal(record.model, 'grok-bot-default')
    assert.equal(record.provider, 'xai')
    assert.equal(record.input_tokens, 16 + 28753)
    assert.equal(record.cost_usd, 0)
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
