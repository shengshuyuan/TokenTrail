import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const kiro = require('../src/lib/kiro.js')
const kiroQuota = require('../src/lib/quotas/providers/kiro.js')

/**
 * Kiro CLI records credits per turn, the concrete model per request (kiro.log),
 * and the server-reported context usage per request. These tests pin how the
 * sync source turns that into usage rows, and how the quota adapter maps the
 * official GetUsageLimits response.
 */

function usageLine({ turnId, usage, ts, requestIds = [] }) {
  return JSON.stringify({
    id: `${turnId}-usage`,
    timestamp: ts,
    payload: {
      type: 'usage_summary',
      promptTurnSummaries: usage.map((u) => ({ unit: 'credit', usage: u, usedTools: [] })),
      turnId,
      executionId: turnId,
      requestIds,
      status: 'success',
    },
  })
}

function contextLine(executionId, pct) {
  return JSON.stringify({
    id: `ctx-${executionId}-${pct}`,
    timestamp: '2026-10-27T03:00:00.000Z',
    payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: pct }, executionId },
  })
}

function noteLine(model) {
  return JSON.stringify({
    id: `note-${model}`,
    timestamp: '2026-10-27T03:00:00.000Z',
    payload: { type: 'agent_note', content: `<session_context>\nThe current model is ${model}.\n</session_context>` },
  })
}

function logLine(turnId, model) {
  return JSON.stringify({
    timestamp: '2026-10-27T03:00:00.000Z',
    level: 'info',
    message: `q.create_response.request {"endpoint":"https://runtime.us-east-1.kiro.dev","bodyLength":1,"origin":"KIRO_CLI","model":"${model}"}`,
    conversationId: 'sess_x',
    turnId,
  })
}

function mockFs(files, dirs = {}) {
  return {
    existsSync: (p) => p in files || p in dirs,
    readFileSync: (p) => {
      if (files[p] == null) throw new Error('ENOENT')
      return files[p]
    },
    readdirSync: (dir) => dirs[dir] || [],
  }
}

const TRANSCRIPT = '/home/u/.kiro/sessions/h/sess_x/messages.jsonl'
const SESSION = '/home/u/.kiro/sessions/h/sess_x/session.json'

describe('parseKiroUsageLine', () => {
  it('parses a usage_summary turn into credits', () => {
    const r = kiro.parseKiroUsageLine(usageLine({ turnId: 't1', usage: [0.88], ts: '2026-10-27T03:37:14.892Z' }))
    assert.equal(r.credits, 0.88)
    assert.equal(r.turnId, 't1')
    assert.equal(r.timestamp, Date.parse('2026-10-27T03:37:14.892Z'))
  })

  it('sums multiple promptTurnSummaries in one turn', () => {
    assert.equal(kiro.parseKiroUsageLine(usageLine({ turnId: 't2', usage: [1.5, 2.5], ts: 1 })).credits, 4)
  })

  it('ignores non usage_summary lines and zero credits', () => {
    assert.equal(kiro.parseKiroUsageLine(JSON.stringify({ payload: { type: 'assistant' } })), null)
    assert.equal(kiro.parseKiroUsageLine('not json at all'), null)
    assert.equal(kiro.parseKiroUsageLine(usageLine({ turnId: 't3', usage: [0], ts: 1 })), null)
  })
})

describe('normalizeKiroModel', () => {
  it('keeps concrete ids and drops auto / internal models', () => {
    assert.equal(kiro.normalizeKiroModel('claude-opus-5.5.'), 'claude-opus-5.5')
    assert.equal(kiro.normalizeKiroModel('Auto (model selected dynamically on the server)'), undefined)
    assert.equal(kiro.normalizeKiroModel('auto'), undefined)
    assert.equal(kiro.normalizeKiroModel('simple-task'), undefined)
  })
})

describe('readKiroTurnModels', () => {
  it('maps turnId to the model each request was sent to, skipping title generation', () => {
    const logsDir = '/home/u/.kiro/logs'
    const fsMock = mockFs(
      {
        [`${logsDir}/run1/kiro.log`]: [
          logLine('turnA', 'claude-opus-5.5'),
          logLine('turnB', 'auto'),
          logLine('turnB', 'simple-task'),
          'garbage',
        ].join('\n'),
      },
      { [logsDir]: [{ name: 'run1', isDirectory: () => true }] },
    )
    const models = kiro.readKiroTurnModels(fsMock, '/home/u')
    assert.equal(models.get('turnA'), 'claude-opus-5.5')
    assert.equal(models.get('turnB'), 'auto')
  })
})

describe('parseKiroTranscript', () => {
  const files = {
    [TRANSCRIPT]: [
      noteLine('Auto (model selected dynamically on the server)'),
      contextLine('t1', 3.5),
      contextLine('t1', 4.5),
      usageLine({ turnId: 't1', usage: [10], ts: 10, requestIds: ['a', 'b'] }),
      noteLine('claude-opus-5.5'),
      contextLine('t2', 10),
      usageLine({ turnId: 't2', usage: [2], ts: 20, requestIds: ['c'] }),
      usageLine({ turnId: 't3', usage: [1], ts: 30 }),
    ].join('\n'),
    [SESSION]: JSON.stringify({ id: 'sess_x', workspacePaths: ['/work/MyProject'], modelId: 'auto' }),
  }

  it('uses the request-log model per turn, then the session context in effect', () => {
    const turnModels = new Map([['t1', 'claude-sonnet-5.5'], ['t3', 'auto']])
    const recs = kiro.parseKiroTranscript(mockFs(files), TRANSCRIPT, { turnModels })
    assert.deepEqual(recs.map((r) => r.model), ['claude-sonnet-5.5', 'claude-opus-5.5', 'kiro-auto'])
    assert.equal(recs[0].requestId, 'kiro:t1')
    assert.equal(recs[0].project, 'MyProject')
  })

  it('does not relabel turns that ran before a mid-session model switch', () => {
    const recs = kiro.parseKiroTranscript(mockFs(files), TRANSCRIPT)
    // t1 ran while the session context said Auto; only t2/t3 ran after the switch.
    assert.deepEqual(recs.map((r) => r.model), ['kiro-auto', 'claude-opus-5.5', 'claude-opus-5.5'])
  })

  it('derives context tokens from server-reported context usage × context window', () => {
    const recs = kiro.parseKiroTranscript(mockFs(files), TRANSCRIPT, { turnModels: new Map([['t1', 'claude-opus-5.5']]) })
    assert.equal(recs[0].contextTokens, 35_000 + 45_000) // 3.5% + 4.5% of 1M
    assert.equal(recs[1].contextTokens, 100_000)
    assert.equal(recs[2].contextTokens, 0) // no context events recorded
  })

  it('prices credits at the official per-credit rate', () => {
    const recs = kiro.parseKiroTranscript(mockFs(files), TRANSCRIPT)
    assert.equal(recs[0].costUsd, 10 * kiro.KIRO_CREDIT_USD)
  })
})

describe('kiro quota adapter', () => {
  const limitsResponse = {
    nextDateReset: 1793491200,
    subscriptionInfo: { subscriptionTitle: 'KIRO PRO' },
    usageBreakdownList: [
      {
        resourceType: 'CREDIT',
        currentUsageWithPrecision: 470.62,
        usageLimitWithPrecision: 1000,
        nextDateReset: 1793491200,
        bonuses: [{ status: 'ACTIVE', displayName: 'Launch bonus', currentUsage: 5, usageLimit: 50, expiresAt: 1793491200 }],
      },
    ],
    userInfo: { email: 'someone@example.com', userId: 'u-123' },
  }

  it('maps GetUsageLimits to used / limit / remaining with reset time', () => {
    const snap = kiroQuota.mapUsageLimits(limitsResponse, 1)
    const main = snap.windows.find((w) => w.id === 'kiro-credit')
    assert.equal(snap.planLabel, 'KIRO PRO')
    assert.equal(snap.source, 'official_api')
    assert.equal(main.used, 470.62)
    assert.equal(main.limit, 1000)
    assert.equal(main.remaining, 529.38)
    assert.equal(main.usedPercent, 47.1)
    assert.equal(main.resetsAt, 1793491200 * 1000)
    assert.equal(snap.wallets[0].balance, 529.38)
    assert.ok(snap.windows.some((w) => w.id === 'kiro-credit-bonus-0' && w.limit === 50))
  })

  it('never copies account identity into the snapshot', () => {
    const json = JSON.stringify(kiroQuota.mapUsageLimits(limitsResponse, 1))
    assert.ok(!json.includes('someone@example.com'))
    assert.ok(!json.includes('u-123'))
  })

  it('treats the unlimited sentinel as no limit', () => {
    const snap = kiroQuota.mapUsageLimits({ usageBreakdownList: [{ resourceType: 'CREDIT', currentUsage: 3, usageLimit: 999999 }] }, 1)
    assert.equal(snap.windows[0].limit, undefined)
    assert.equal(snap.wallets.length, 0)
  })

  it('rejects an unexpected response shape', () => {
    assert.throws(() => kiroQuota.mapUsageLimits({}, 1), (e) => e.code === 'unsupported_version')
  })

  it('calls the regional endpoint with the bearer token and adds today\'s local credits', async () => {
    let seen
    const now = Date.parse('2026-10-27T12:00:00.000Z')
    const sessionsDir = '/home/u/.kiro/sessions'
    const fsMock = mockFs(
      { [TRANSCRIPT]: usageLine({ turnId: 'x', usage: [7], ts: now - 1000 }), [SESSION]: '{}' },
      {
        [sessionsDir]: [{ name: 'h', isDirectory: () => true }],
        [`${sessionsDir}/h`]: [{ name: 'sess_x', isDirectory: () => true }],
        [`${sessionsDir}/h/sess_x`]: [{ name: 'messages.jsonl', isDirectory: () => false }],
      },
    )
    const snap = await kiroQuota.fetchQuota({
      fs: fsMock,
      home: '/home/u',
      now: () => now,
      timeoutMs: 1000,
      kiroResolveAuth: async () => ({ accessToken: 'tok', profileArn: 'arn:aws:codewhisperer:eu-central-1:1:profile/P' }),
      fetchImpl: async (url, opts) => {
        seen = { url, auth: opts.headers.Authorization }
        return { ok: true, status: 200, text: async () => JSON.stringify(limitsResponse), headers: { get: () => null } }
      },
    })
    assert.ok(seen.url.startsWith('https://management.eu-central-1.kiro.dev/Get-Usage-Limits?'))
    assert.ok(seen.url.includes('origin=KIRO_CLI'))
    assert.equal(seen.auth, 'Bearer tok')
    assert.equal(snap.windows.find((w) => w.id === 'kiro-today').used, 7)
  })

  it('maps 401 to an auth error so the row asks to log in again', async () => {
    await assert.rejects(
      () => kiroQuota.fetchQuota({
        fs: mockFs({}),
        home: '/home/u',
        now: () => 1,
        timeoutMs: 1000,
        kiroResolveAuth: async () => ({ accessToken: 'tok', profileArn: 'arn:aws:codewhisperer:us-east-1:1:profile/P' }),
        fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{}', headers: { get: () => null } }),
      }),
      (e) => e.code === 'auth',
    )
  })
})

describe('kiro quota adapter · credentials', () => {
  const okResponse = {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ usageBreakdownList: [{ resourceType: 'CREDIT', currentUsage: 1, usageLimit: 10 }] }),
    headers: { get: () => null },
  }
  const unauthorized = { ok: false, status: 401, text: async () => '{}', headers: { get: () => null } }
  const arn = 'arn:aws:codewhisperer:us-east-1:1:profile/P'
  const baseDeps = { fs: mockFs({}), home: '/home/u', now: () => 1, timeoutMs: 1000 }

  it('retries once through the Kiro CLI when the stored token is rejected', async () => {
    const tokens = []
    let cliCalls = 0
    const snap = await kiroQuota.fetchQuota({
      ...baseDeps,
      kiroStoredToken: () => ({ accessToken: 'stale', profileArn: arn }),
      kiroCliToken: async () => { cliCalls++; return { accessToken: 'fresh', profileArn: arn } },
      fetchImpl: async (_url, opts) => {
        tokens.push(opts.headers.Authorization)
        return opts.headers.Authorization === 'Bearer stale' ? unauthorized : okResponse
      },
    })
    assert.deepEqual(tokens, ['Bearer stale', 'Bearer fresh'])
    assert.equal(cliCalls, 1)
    assert.equal(snap.windows[0].limit, 10)
  })

  it('does not loop when a CLI-issued token is rejected', async () => {
    let calls = 0
    await assert.rejects(
      () => kiroQuota.fetchQuota({
        ...baseDeps,
        kiroStoredToken: () => null,
        kiroCliToken: async () => ({ accessToken: 'fresh', profileArn: arn }),
        fetchImpl: async () => { calls++; return unauthorized },
      }),
      (e) => e.code === 'auth',
    )
    assert.equal(calls, 1)
  })

  it('reports CLI failures with their real cause, not always "login expired"', async () => {
    for (const failure of ['timeout', 'malformed', 'auth', 'not_configured']) {
      await assert.rejects(
        () => kiroQuota.fetchQuota({ ...baseDeps, kiroStoredToken: () => null, kiroCliToken: async () => ({ failure }) }),
        (e) => e.code === failure,
      )
    }
    await assert.rejects(
      () => kiroQuota.fetchQuota({ ...baseDeps, kiroStoredToken: () => null, kiroCliToken: async () => null }),
      (e) => e.code === 'not_configured',
    )
  })

  it('maps execFile errors from the token helper', async () => {
    const run = (err, stdout = '') =>
      kiroQuota.tokenFromKiroCli({
        home: '/home/u',
        fsMod: { existsSync: () => true },
        env: {},
        execFileImpl: (_bin, _args, _opts, cb) => cb(err, stdout),
      })
    assert.deepEqual(await run(Object.assign(new Error('t'), { killed: true, signal: 'SIGTERM' })), { failure: 'timeout' })
    assert.deepEqual(await run(Object.assign(new Error('x'), { code: 'ENOENT' })), { failure: 'not_configured' })
    assert.deepEqual(await run(Object.assign(new Error('exit'), { code: 1 })), { failure: 'auth' })
    assert.deepEqual(await run(null, 'not json'), { failure: 'malformed' })
    assert.deepEqual(
      await run(null, JSON.stringify({ kind: 'getKasToken', data: { accessToken: 'a', profileArn: arn } })),
      { accessToken: 'a', profileArn: arn },
    )
  })
})
