import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import {
  extractLatestRateLimits,
  mapRateLimitsToWindows,
  mapCreditsToWallet,
  planLabelFromRateLimits,
  readCodexCliSession,
  fetchQuota,
} from '../src/lib/quotas/providers/codex.js'
import { runAdapter } from '../src/lib/quotas/refresh.js'
import { createFakeFs } from './helpers/quota-mock.mjs'

const HOME = '/home/test'

function rateLimitLine(overrides = {}, ts = '2026-09-01T10:00:00.000Z') {
  return JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { last_token_usage: {} },
      rate_limits: {
        limit_id: 'codex',
        primary: { used_percent: 6, window_minutes: 300, resets_at: 1788279327 },
        secondary: { used_percent: 22, window_minutes: 10080, resets_at: 1788749093 },
        credits: { has_credits: false, unlimited: false, balance: null },
        plan_type: 'plus',
        ...overrides,
      },
    },
  })
}

function sessionsFs(lines, extra = {}) {
  return createFakeFs({
    [`${HOME}/.codex/sessions/2026/09/01/rollout-a.jsonl`]: lines.join('\n'),
    ...extra,
  })
}

function fakeJwt(expSec) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url')
  return `${header}.${payload}.sig`
}

function authJson(overrides = {}) {
  return JSON.stringify({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    last_refresh: '2026-09-01T12:00:00.000Z',
    tokens: {
      access_token: fakeJwt(Math.floor(Date.parse('2026-09-02T00:00:00.000Z') / 1000)),
      refresh_token: 'codex-refresh-secret',
      id_token: 'codex-id-secret',
      account_id: 'acct_hidden_123',
    },
    ...overrides,
  })
}

describe('Codex quota adapter', () => {
  it('picks the latest rate_limits event by real event time, not line order of mtime', () => {
    const older = rateLimitLine({}, '2026-09-01T08:00:00.000Z')
    const newer = rateLimitLine({ primary: { used_percent: 42, window_minutes: 300, resets_at: 1788279327 } }, '2026-09-01T11:30:00.000Z')
    const best = extractLatestRateLimits([older, newer, 'not json', '', '{"broken": true'])
    assert.equal(best.timestamp, Date.parse('2026-09-01T11:30:00.000Z'))
    assert.equal(best.rate_limits.primary.used_percent, 42)
  })

  it('maps primary/secondary windows with official used_percent and local resets', () => {
    const windows = mapRateLimitsToWindows({
      primary: { used_percent: 6, window_minutes: 300, resets_at: 1788279327 },
      secondary: { used_percent: 22, window_minutes: 10080, resets_at: 1788749093 },
    })
    assert.equal(windows.length, 2)
    assert.equal(windows[0].id, 'primary')
    assert.equal(windows[0].windowMinutes, 300)
    assert.equal(windows[0].usedPercent, 6)
    assert.equal(windows[0].resetsAt, 1788279327 * 1000) // 秒 → 毫秒
    assert.equal(windows[1].windowMinutes, 10080)
    // 官方没有给出 used/limit，只有 used_percent —— 不构造数值
    assert.equal(windows[0].used, undefined)
    assert.equal(windows[0].limit, undefined)
  })

  it('keeps windows without reset time or percent readable instead of crashing', () => {
    const windows = mapRateLimitsToWindows({
      primary: { used_percent: 10 },
      secondary: { window_minutes: 10080 },
    })
    assert.equal(windows[0].resetsAt, undefined)
    assert.equal(windows[1].usedPercent, undefined)
  })

  it('maps credits balance to a wallet and plan_type to plan label', () => {
    const wallet = mapCreditsToWallet({ has_credits: true, unlimited: false, balance: 12.5 })
    assert.deepEqual(wallet, { label: 'credits', balance: 12.5, currency: 'USD' })
    assert.equal(mapCreditsToWallet({ has_credits: false, unlimited: false, balance: null }), null)
    assert.equal(planLabelFromRateLimits({ plan_type: 'pro' }), 'pro')
    assert.equal(planLabelFromRateLimits({}), undefined)
  })

  it('reports not_configured when Codex CLI has no sessions directory', async () => {
    const deps = { fs: createFakeFs({}), home: HOME, now: () => Date.now() }
    await assert.rejects(fetchQuota(deps), (err) => err.code === 'not_configured')
  })

  it('shows 尚无额度记录 state when sessions exist but no rate_limits event', async () => {
    const deps = {
      fs: sessionsFs(['{"type":"session_meta","payload":{}}']),
      home: HOME,
      now: () => Date.now(),
    }
    await assert.rejects(fetchQuota(deps), (err) => err.code === 'no_data')
  })

  it('derives provider status from the worst window (95%+ critical, 100% exhausted)', async () => {
    const critical = await runAdapter('codex', fetchQuota, {
      fs: sessionsFs([rateLimitLine({ primary: { used_percent: 96, window_minutes: 300, resets_at: 1788279327 } })]),
      home: HOME,
      now: () => Date.now(),
    })
    assert.equal(critical.status, 'critical')
    assert.equal(critical.source, 'local_session')
    assert.equal(critical.planLabel, 'plus')

    const exhausted = await runAdapter('codex', fetchQuota, {
      fs: sessionsFs([rateLimitLine({ primary: { used_percent: 100, window_minutes: 300, resets_at: 1788279327 } })]),
      home: HOME,
      now: () => Date.now(),
    })
    assert.equal(exhausted.status, 'exhausted')
  })

  it('still finds events when the session file was written across a truncated tail', async () => {
    // 文件远大于 TAIL_BYTES 时只读尾部；首行截断应被丢弃而非误读
    const filler = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count' } }) + '\n'
    const lines = new Array(4000).fill(filler.trim())
    lines.push(rateLimitLine({ primary: { used_percent: 12, window_minutes: 300, resets_at: 1788279327 } }))
    const bigFs = createFakeFs({ [`${HOME}/.codex/sessions/2026/09/01/rollout-big.jsonl`]: lines.join('\n') })
    const snap = await runAdapter('codex', fetchQuota, { fs: bigFs, home: HOME, now: () => Date.now() })
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.windows[0].usedPercent, 12)
  })

  it('never includes credentials or raw account identifiers in the snapshot', async () => {
    const snap = await runAdapter('codex', fetchQuota, {
      fs: sessionsFs([rateLimitLine({})], { [`${HOME}/.codex/auth.json`]: authJson() }),
      home: HOME,
      now: () => Date.now(),
    })
    const json = JSON.stringify(snap)
    assert.ok(!json.includes('codex-refresh-secret'))
    assert.ok(!json.includes('acct_hidden_123'))
    assert.ok(!json.includes(path.join(HOME, '.codex')))
    assert.equal(snap.accountLabel, 'ChatGPT')
  })

  it('distinguishes missing login from an expired ChatGPT session', () => {
    const missing = readCodexCliSession(createFakeFs({}), HOME, Date.now())
    assert.deepEqual(missing, { loggedIn: false, hasCredentials: false, expired: false, authMode: null })

    const expired = readCodexCliSession(
      createFakeFs({
        [`${HOME}/.codex/auth.json`]: authJson({
          tokens: { access_token: fakeJwt(1_700_000_000), refresh_token: '', id_token: '', account_id: 'acct_hidden_123' },
        }),
      }),
      HOME,
      Date.parse('2026-09-01T12:00:00.000Z')
    )
    assert.equal(expired.loggedIn, false)
    assert.equal(expired.hasCredentials, true)
    assert.equal(expired.expired, true)
    assert.equal('access_token' in expired, false)
    assert.equal('account_id' in expired, false)
  })

  it('treats a ChatGPT login without rate_limits as connected, not unauthorized', async () => {
    const snap = await runAdapter('codex', fetchQuota, {
      fs: createFakeFs({ [`${HOME}/.codex/auth.json`]: authJson() }),
      home: HOME,
      now: () => Date.parse('2026-09-01T12:00:00.000Z'),
    })
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.source, 'local_cli')
    assert.equal(snap.error?.code, 'no_data')
    assert.equal(snap.windows.length, 0)
    assert.equal(snap.accountLabel, 'ChatGPT')
  })

  it('maps expired Codex login to auth_error when no quota events exist', async () => {
    const snap = await runAdapter('codex', fetchQuota, {
      fs: createFakeFs({
        [`${HOME}/.codex/auth.json`]: authJson({
          tokens: { access_token: fakeJwt(1_700_000_000), refresh_token: '' },
        }),
      }),
      home: HOME,
      now: () => Date.parse('2026-09-01T12:00:00.000Z'),
    })
    assert.equal(snap.status, 'auth_error')
    assert.equal(snap.error.code, 'auth')
  })

  it('accepts OPENAI_API_KEY as a separate API-key login, not a ChatGPT session', () => {
    const session = readCodexCliSession(createFakeFs({}), HOME, Date.now(), { OPENAI_API_KEY: 'sk-test-openai' })
    assert.equal(session.loggedIn, true)
    assert.equal(session.authMode, 'api_key')
  })
})
