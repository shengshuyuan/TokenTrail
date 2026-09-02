import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  CLIENT_METADATA,
  TIER_FREE,
  buildLoadMetadata,
  buildOnboardRequest,
  getDefaultOnboardTier,
  mapQuotaBuckets,
  credsLookLoggedIn,
  fetchQuota,
  resetGeminiMem,
} from '../src/lib/quotas/providers/gemini.js'
import { runAdapter } from '../src/lib/quotas/refresh.js'
import { createFakeFs, createFakeFetch } from './helpers/quota-mock.mjs'

const HOME = '/home/test'
const NOW = () => Date.parse('2026-09-01T12:00:00.000Z')

function quotaBucketsResponse(extra = []) {
  return {
    buckets: [
      { modelId: 'gemini-3-pro', remainingFraction: 0.6, resetTime: '2026-09-01T18:00:00Z' },
      { modelId: 'gemini-3-flash', remainingFraction: 0.8, remainingAmount: '40' },
      ...extra,
    ],
  }
}

function loggedInFs(tokenExpiry = NOW() + 3600_000) {
  return createFakeFs({
    [`${HOME}/.gemini/oauth_creds.json`]: JSON.stringify({
      access_token: 'ya29.fresh',
      refresh_token: '1//refresh',
      expiry_date: tokenExpiry,
      token_type: 'Bearer',
    }),
  })
}

function quotaRoute() {
  return {
    match: 'cloudcode-pa.googleapis.com',
    status: 200,
    json: { cloudaicompanionProject: 'gen-lang-client-000', buckets: quotaBucketsResponse().buckets },
  }
}

describe('Gemini quota adapter', () => {
  beforeEach(() => {
    resetGeminiMem()
  })

  it('maps model buckets to per-model windows, keeping official remaining values', () => {
    const { windows, hasUnreadable } = mapQuotaBuckets(quotaBucketsResponse().buckets)
    assert.equal(windows.length, 2)
    assert.equal(windows[0].label, 'gemini-3-pro')
    assert.equal(windows[0].usedPercent, 40) // 1 - 0.6
    assert.equal(windows[0].resetsAt, Date.parse('2026-09-01T18:00:00Z'))
    // remainingAmount=40, fraction=0.8 → remaining 40, limit 50
    assert.equal(windows[1].remaining, 40)
    assert.equal(windows[1].limit, 50)
    assert.equal(windows[1].usedPercent, 20)
    assert.equal(hasUnreadable, false)
  })

  it('marks unreadable buckets as partial instead of inventing numbers', () => {
    const { windows, hasUnreadable } = mapQuotaBuckets([
      { modelId: 'gemini-3-pro', remainingFraction: 0.9 },
      { modelId: 'mystery-model' },
      { remainingFraction: 0.5 },
    ])
    assert.equal(windows.length, 1)
    assert.equal(hasUnreadable, true)
  })

  it('tolerates unknown fields in bucket payloads', () => {
    const { windows } = mapQuotaBuckets([{ modelId: 'm', remainingFraction: 0.5, someNewField: { nested: true } }])
    assert.equal(windows[0].usedPercent, 50)
  })

  it('reports not_configured when Gemini CLI is not logged in', async () => {
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: createFakeFs({}),
      home: HOME,
      now: NOW,
      fetchImpl: async () => {
        throw new Error('must not fetch')
      },
    })
    assert.equal(snap.status, 'not_configured')
  })

  it('uses the stored fresh access token and reads quota via the official endpoint', async () => {
    const { fetchImpl, calls } = createFakeFetch([quotaRoute()])
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      fetchImpl,
    })
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.windows.length, 2)
    assert.equal(snap.source, 'official_api')
    const quotaCall = calls.find((c) => c.url.includes('retrieveUserQuota'))
    assert.ok(quotaCall, 'retrieveUserQuota should be called')
    assert.equal(quotaCall.opts.headers.Authorization, 'Bearer ya29.fresh')
    assert.ok(!calls.some((c) => c.url.includes('oauth2.googleapis.com/token')), 'fresh token must not trigger refresh')
  })

  it('sends loadCodeAssist with project metadata matching Gemini CLI', async () => {
    const { fetchImpl, calls } = createFakeFetch([quotaRoute()])
    await runAdapter('gemini', fetchQuota, {
      env: { GOOGLE_CLOUD_PROJECT: 'my-project-123' },
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      fetchImpl,
    })
    const loadCall = calls.find((c) => c.url.includes('loadCodeAssist'))
    const body = JSON.parse(loadCall.opts.body)
    assert.equal(body.cloudaicompanionProject, 'my-project-123')
    assert.deepEqual(body.metadata, buildLoadMetadata('my-project-123'))
  })

  it('refreshes an expired token in memory and retries after 401, without writing credentials back', async () => {
    const base = createFakeFetch([
      quotaRoute(),
      { match: 'oauth2.googleapis.com/token', status: 200, json: { access_token: 'ya29.refreshed', expires_in: 3600 } },
    ])
    // 第一次 retrieveUserQuota 401，刷新后重试应成功
    let quotaCalls = 0
    const fetchImpl = async (url, opts) => {
      if (String(url).includes('retrieveUserQuota') && quotaCalls === 0) {
        quotaCalls += 1
        return { ok: false, status: 401, text: async () => '{"error":{"message":"x"}}' }
      }
      return base.fetchImpl(url, opts)
    }
    const fsMod = loggedInFs(NOW() - 1000) // token 已过期
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: fsMod,
      home: HOME,
      now: NOW,
      fetchImpl,
      timeoutMs: 2000,
    })
    assert.equal(snap.status, 'healthy')
    assert.ok(quotaCalls === 1, 'retry should hit the success route')
    // 刷新结果不落盘
    assert.ok(!fsMod.readFileSync(`${HOME}/.gemini/oauth_creds.json`).includes('ya29.refreshed'))
  })

  it('maps persistent auth failure to auth_error', async () => {
    const { fetchImpl } = createFakeFetch([
      { match: /retrieveUserQuota/, status: 403, json: {} },
      quotaRoute(),
      { match: 'oauth2.googleapis.com/token', status: 400, json: { error: 'invalid_grant' } },
    ])
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      fetchImpl,
      timeoutMs: 2000,
    })
    assert.equal(snap.status, 'auth_error')
  })

  it('maps malformed JSON to a safe error snapshot', async () => {
    const { fetchImpl } = createFakeFetch([{ match: 'cloudcode-pa', status: 200, text: '<html>gateway</html>' }])
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      fetchImpl,
      timeoutMs: 2000,
    })
    assert.equal(snap.status, 'network_error')
    assert.equal(snap.error.code, 'malformed')
    assert.ok(!JSON.stringify(snap).includes('gateway'))
  })

  it('maps structural quota changes to unsupported_version', async () => {
    const { fetchImpl } = createFakeFetch([
      { match: 'loadCodeAssist', status: 200, json: { cloudaicompanionProject: 'gen-lang-client-000' } },
      { match: 'retrieveUserQuota', status: 200, json: { totallyNewShape: true } },
    ])
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      fetchImpl,
      timeoutMs: 2000,
    })
    assert.equal(snap.status, 'unsupported_version')
  })

  it('treats a timed-out provider request as network_error', async () => {
    const { fetchImpl } = createFakeFetch([{ match: 'cloudcode-pa', hang: true }])
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      fetchImpl,
      timeoutMs: 60,
    })
    assert.equal(snap.status, 'network_error')
    assert.equal(snap.error.code, 'timeout')
  })

  it('validates the login check helper', () => {
    assert.equal(credsLookLoggedIn({ refresh_token: 'x' }), true)
    assert.equal(credsLookLoggedIn({}), false)
    assert.equal(credsLookLoggedIn(null), false)
  })

  it('reports unsupported (not fake data) when no quota project can be resolved', async () => {
    const { fetchImpl, calls } = createFakeFetch([
      { match: 'loadCodeAssist', status: 200, json: { allowedTiers: [{ id: 'standard-tier', name: 'Gemini Code Assist', userDefinedCloudaicompanionProject: true }] } },
      { match: 'onboardUser', status: 200, json: { done: true, response: { cloudaicompanionProject: {} } } },
    ])
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      fetchImpl,
      timeoutMs: 2000,
    })
    assert.equal(snap.status, 'unsupported')
    assert.equal(snap.windows.length, 0)
    // 走过完整的 loadCodeAssist → onboardUser 解析链路后才放弃
    assert.ok(calls.some((c) => c.url.includes('loadCodeAssist')))
    assert.ok(calls.some((c) => c.url.includes('onboardUser')))
  })

  it('selects the default allowed tier and polls onboarding operations before reading quota', async () => {
    const { fetchImpl, calls } = createFakeFetch([
      {
        match: 'loadCodeAssist',
        status: 200,
        json: {
          allowedTiers: [
            { id: 'standard-tier', name: 'Standard' },
            { id: TIER_FREE, name: 'Free', isDefault: true },
          ],
        },
      },
      { match: 'onboardUser', status: 200, json: { done: false, name: 'operations/setup-123' } },
      { match: /v1internal\/operations\/setup-123$/, status: 200, json: { done: true, response: { cloudaicompanionProject: { id: 'gen-lang-client-999' } } } },
      { match: 'retrieveUserQuota', status: 200, json: quotaBucketsResponse() },
    ])
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      fetchImpl,
      timeoutMs: 2000,
      operationPollIntervalMs: 0,
      operationMaxPolls: 2,
    })
    assert.equal(snap.status, 'healthy')
    const onboardCall = calls.find((c) => c.url.includes('onboardUser'))
    const onboardBody = JSON.parse(onboardCall.opts.body)
    assert.deepEqual(onboardBody, buildOnboardRequest(getDefaultOnboardTier({
      allowedTiers: [
        { id: 'standard-tier', name: 'Standard' },
        { id: TIER_FREE, name: 'Free', isDefault: true },
      ],
    }), undefined))
    assert.deepEqual(onboardBody.metadata, CLIENT_METADATA)
    assert.ok(calls.some((c) => c.url.endsWith('/v1internal/operations/setup-123')))
    const quotaCall = calls.find((c) => c.url.includes('retrieveUserQuota'))
    assert.equal(JSON.parse(quotaCall.opts.body).project, 'gen-lang-client-999')
  })

  it('times out onboarding operations after a bounded number of polls', async () => {
    const { fetchImpl } = createFakeFetch([
      { match: 'loadCodeAssist', status: 200, json: { allowedTiers: [{ id: TIER_FREE, isDefault: true }] } },
      { match: 'onboardUser', status: 200, json: { done: false, name: 'operations/slow' } },
      { match: /v1internal\/operations\/slow$/, status: 200, json: { done: false, name: 'operations/slow' } },
    ])
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      fetchImpl,
      timeoutMs: 2000,
      operationPollIntervalMs: 0,
      operationMaxPolls: 1,
    })
    assert.equal(snap.status, 'network_error')
    assert.equal(snap.error.code, 'timeout')
  })

  it('sends retrieveUserQuota without metadata (server rejects unknown fields)', async () => {
    const { fetchImpl, calls } = createFakeFetch([quotaRoute()])
    await runAdapter('gemini', fetchQuota, { fs: loggedInFs(), home: HOME, now: NOW, fetchImpl, timeoutMs: 2000 })
    const quotaCall = calls.find((c) => c.url.includes('retrieveUserQuota'))
    const body = JSON.parse(quotaCall.opts.body)
    assert.deepEqual(Object.keys(body), ['project'])
  })
})
