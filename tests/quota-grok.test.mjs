import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CLI_BILLING_BASE,
  subscriptionNotice,
  resolveManagementConfig,
  parseCents,
  mapPrepaidBalance,
  mapMonthlyWindow,
  mapCliCreditsWindow,
  mapCliMonthlyWindow,
  readGrokCliSession,
  grokCliSessionIsFresh,
  resolveGrokBinary,
  resetGrokLoginState,
  startGrokOAuthLogin,
  fetchQuota,
} from '../src/lib/quotas/providers/grok.js'
import { runAdapter } from '../src/lib/quotas/refresh.js'
import { createFakeFetch, createFakeFs, assertNoSecrets } from './helpers/quota-mock.mjs'

const NOW = () => Date.parse('2026-09-01T12:00:00.000Z')
const SECRET_KEY = 'xai-mgmt-secret-abc123'
const TEAM_ID = 'team-987654'

const CONFIGURED_ENV = { XAI_MANAGEMENT_KEY: SECRET_KEY, XAI_TEAM_ID: TEAM_ID }

function billingRoutes(overrides = {}) {
  return [
    { match: '/prepaid/balance', status: 200, json: { total: { val: '20000' }, changes: [] }, ...overrides.balance },
    { match: '/postpaid/spending-limits', status: 200, json: { hardLimit: 100, softLimit: 80 }, ...overrides.limits },
    { match: '/postpaid/invoice/preview', status: 200, json: { expectedAmount: 42.5 }, ...overrides.invoice },
  ]
}

const HOME = '/home/test'
const CLI_TOKEN = 'grok-oauth-secret-token-xyz'
const CLI_EMAIL = 'user@example.com'
const CLI_TEAM = 'team-cli-hidden'

function grokAuthJson(overrides = {}) {
  return JSON.stringify({
    'https://auth.x.ai::client-id': {
      auth_mode: 'oidc',
      email: CLI_EMAIL,
      team_id: CLI_TEAM,
      key: CLI_TOKEN,
      refresh_token: 'refresh-secret',
      expires_at: '2026-09-01T19:00:00.000Z',
      ...overrides,
    },
  })
}

describe('Grok quota adapter', () => {
  it('never fabricates subscription data without Management API config or CLI login', async () => {
    const snap = await runAdapter('grok', fetchQuota, { env: {}, now: NOW, fetchImpl: async () => { throw new Error('no fetch expected') } })
    assert.equal(snap.status, 'not_configured')
    assert.equal(snap.windows.length, 0)
    assert.equal(snap.wallets.length, 0)
    assert.equal(snap.error?.code, 'not_configured')
    assert.equal(snap.action?.kind, 'open_url')
    assert.equal(snap.action?.url, 'https://grok.com/settings')
    const json = JSON.stringify(snap)
    assert.ok(!json.includes('Team ID') && !json.includes('team'), 'team id must not leak')
  })

  it('reads Grok CLI OAuth subscription billing without leaking credentials', async () => {
    const fsMod = createFakeFs({ [`${HOME}/.grok/auth.json`]: grokAuthJson() })
    const session = readGrokCliSession(fsMod, HOME)
    assert.equal(session.loggedIn, true)
    assert.equal(grokCliSessionIsFresh(session, NOW()), true)
    assert.equal('key' in session, false)
    assert.equal('email' in session, false)
    assert.equal('team_id' in session, false)

    const { fetchImpl, calls } = createFakeFetch([
      { match: '?format=credits', status: 200, json: { creditUsagePercent: 37.5, resetsAt: '2026-09-08T00:00:00Z' } },
      { match: /\/v1\/billing$/, status: 200, json: { config: { monthlyLimit: 100, used: 45 } } },
    ])
    const snap = await runAdapter('grok', fetchQuota, {
      env: {},
      now: NOW,
      home: HOME,
      fs: fsMod,
      fetchImpl,
    })
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.source, 'local_cli')
    assert.equal(snap.accountLabel, 'Grok CLI')
    assert.equal(snap.windows.length, 2)
    assert.equal(snap.windows[0].usedPercent, 37.5)
    assert.equal(snap.windows[0].label, 'week')
    assert.equal(snap.windows[0].windowMinutes, 10080)
    assert.equal(snap.windows[0].resetsAt, Date.parse('2026-09-08T00:00:00Z'))
    assert.equal(snap.windows[1].usedPercent, 45)
    assert.equal(snap.windows[1].windowMinutes, 43200)
    assert.ok(calls.every((c) => c.url.startsWith(CLI_BILLING_BASE)))
    assert.ok(calls.every((c) => c.opts.headers.Authorization === `Bearer ${CLI_TOKEN}`))
    assert.ok(calls.every((c) => c.opts.headers['X-XAI-Token-Auth'] === 'xai-grok-cli'))
    const json = JSON.stringify(snap)
    assertNoSecrets(json, [CLI_TOKEN, CLI_EMAIL, CLI_TEAM, 'refresh-secret'], 'grok cli snapshot')
  })

  it('treats an expired Grok CLI session as not logged in', async () => {
    const fsMod = createFakeFs({
      [`${HOME}/.grok/auth.json`]: grokAuthJson({ expires_at: '2026-08-01T00:00:00.000Z' }),
    })
    const snap = await runAdapter('grok', fetchQuota, {
      env: {},
      now: NOW,
      home: HOME,
      fs: fsMod,
      fetchImpl: async () => { throw new Error('no fetch expected') },
    })
    assert.equal(snap.status, 'not_configured')
    assert.equal(snap.source, 'unavailable')
  })

  it('starts grok login --oauth and does not spawn twice', () => {
    resetGrokLoginState()
    const calls = []
    const child = { exitCode: null, killed: false, unref() {}, on() {} }
    const spawnImpl = (bin, args, opts) => {
      calls.push({ bin, args, opts })
      return child
    }
    const fsMod = createFakeFs({ [`${HOME}/.local/bin/grok`]: '#!/bin/sh' })
    const first = startGrokOAuthLogin({ home: HOME, fs: fsMod, spawnImpl })
    const second = startGrokOAuthLogin({ home: HOME, fs: fsMod, spawnImpl })
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(second.alreadyRunning, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].bin, '/usr/bin/osascript')
    assert.ok(calls[0].args.join(' ').includes(`${HOME}/.local/bin/grok`))
    assert.ok(calls[0].args.join(' ').includes('login'))
    assert.ok(calls[0].args.join(' ').includes('--oauth'))
    resetGrokLoginState()
  })

  it('falls back when Grok CLI binary is missing', () => {
    resetGrokLoginState()
    const started = startGrokOAuthLogin({
      home: HOME,
      fs: createFakeFs({}),
      execFileSyncImpl: () => { throw new Error('missing') },
      spawnImpl: () => { throw new Error('should not spawn') },
    })
    assert.equal(started.ok, false)
    assert.equal(started.reason, 'grok_cli_missing')
    assert.equal(resolveGrokBinary({ home: HOME, fs: createFakeFs({}), execFileSyncImpl: () => { throw new Error('missing') } }), null)
  })

  it('requires both Management Key and Team ID', () => {
    assert.equal(resolveManagementConfig({ XAI_MANAGEMENT_KEY: 'k' }), null)
    assert.equal(resolveManagementConfig({ XAI_TEAM_ID: 't' }), null)
    assert.ok(resolveManagementConfig(CONFIGURED_ENV))
  })

  it('parses USD-cents amounts and monthly windows from billing APIs', () => {
    assert.equal(parseCents({ val: '20000' }), 200)
    assert.equal(parseCents({ val: 'abc' }), null)
    assert.deepEqual(mapPrepaidBalance({ total: { val: '20000' } }), {
      label: 'prepaid',
      balance: 200,
      currency: 'USD',
    })
    assert.equal(mapPrepaidBalance({ unexpected: true }), null)

    const win = mapMonthlyWindow({ hardLimit: 100 }, { expectedAmount: 42.5 })
    assert.equal(win.limit, 100)
    assert.equal(win.used, 42.5)
    assert.equal(win.usedPercent, 42.5)
    // 没有上限就没有百分比，绝不构造 0%/100%
    const noLimit = mapMonthlyWindow({}, { expectedAmount: 42.5 })
    assert.equal(noLimit.usedPercent, undefined)
    assert.equal(noLimit.used, 42.5)

    const credits = mapCliCreditsWindow({ creditUsagePercent: 12.5, nextResetTime: '2026-09-08T00:00:00Z' })
    assert.equal(credits.id, 'credits')
    assert.equal(credits.label, 'week')
    assert.equal(credits.unit, 'credit')
    assert.equal(credits.windowMinutes, 10080)
    assert.equal(credits.usedPercent, 12.5)
    assert.equal(credits.resetsAt, Date.parse('2026-09-08T00:00:00Z'))
    assert.equal(mapCliCreditsWindow({}), null)
    assert.equal(mapCliMonthlyWindow({ monthlyLimit: 200, used: 50 }).usedPercent, 25)
    assert.equal(mapCliMonthlyWindow({ config: { monthlyLimit: 200, used: 50 } }).usedPercent, 25)
  })

  it('prefers fresh Grok CLI OAuth subscription quota over Management API config', async () => {
    const fsMod = createFakeFs({ [`${HOME}/.grok/auth.json`]: grokAuthJson() })
    const { fetchImpl, calls } = createFakeFetch([
      { match: '?format=credits', status: 200, json: { config: { creditUsagePercent: 20, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2026-09-08T00:00:00Z' } } } },
      { match: /\/v1\/billing$/, status: 200, json: { config: { monthlyLimit: 100, used: 45 } } },
      ...billingRoutes(),
    ])
    const snap = await runAdapter('grok', fetchQuota, {
      env: CONFIGURED_ENV,
      now: NOW,
      home: HOME,
      fs: fsMod,
      fetchImpl,
    })
    assert.equal(snap.product, 'subscription')
    assert.equal(snap.source, 'local_cli')
    assert.ok(calls.every((c) => c.url.startsWith(CLI_BILLING_BASE)))
  })

  it('maps unrecognized Grok CLI billing structure to unsupported_version', async () => {
    const fsMod = createFakeFs({ [`${HOME}/.grok/auth.json`]: grokAuthJson() })
    const { fetchImpl } = createFakeFetch([
      { match: '?format=credits', status: 200, json: { changed: true } },
      { match: /\/v1\/billing$/, status: 200, json: { changed: true } },
    ])
    const snap = await runAdapter('grok', fetchQuota, {
      env: {},
      now: NOW,
      home: HOME,
      fs: fsMod,
      fetchImpl,
    })
    assert.equal(snap.status, 'unsupported_version')
  })

  it('reads prepaid balance and monthly spend when configured', async () => {
    const { fetchImpl, calls } = createFakeFetch(billingRoutes())
    const snap = await runAdapter('grok', fetchQuota, { env: CONFIGURED_ENV, now: NOW, fetchImpl })
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.product, 'mixed')
    assert.deepEqual(snap.wallets, [{ label: 'prepaid', balance: 200, currency: 'USD' }])
    assert.equal(snap.windows[0].usedPercent, 42.5)
    assert.equal(snap.source, 'official_api')
    assert.ok(calls.every((c) => c.url.startsWith('https://management-api.x.ai/')))
    assert.ok(calls.every((c) => c.opts.headers.Authorization === `Bearer ${SECRET_KEY}`))
    assertNoSecrets(JSON.stringify(snap), [SECRET_KEY, TEAM_ID], 'grok snapshot')
  })

  it('maps 401 to auth_error without deleting stored credentials', async () => {
    const { fetchImpl } = createFakeFetch(billingRoutes({ balance: { status: 401, json: {} } }))
    const snap = await runAdapter('grok', fetchQuota, { env: CONFIGURED_ENV, now: NOW, fetchImpl })
    assert.equal(snap.status, 'auth_error')
    assert.equal(snap.error.code, 'auth')
  })

  it('maps 429 and timeouts to keep-old-data errors', async () => {
    const { fetchImpl: limitedFetch } = createFakeFetch(billingRoutes({ balance: { status: 429, json: {} } }))
    const limited = await runAdapter('grok', fetchQuota, {
      env: CONFIGURED_ENV,
      now: NOW,
      fetchImpl: limitedFetch,
    })
    assert.equal(limited.error.code, 'rate_limited')

    const { fetchImpl } = createFakeFetch([billingRoutes()[0], { match: '/postpaid', hang: true }])
    const timedOut = await runAdapter('grok', fetchQuota, { env: CONFIGURED_ENV, now: NOW, fetchImpl, timeoutMs: 50 })
    assert.equal(timedOut.error.code, 'timeout')
  })

  it('maps malformed billing responses to a safe error', async () => {
    const { fetchImpl } = createFakeFetch(billingRoutes({ balance: { status: 200, text: 'oops{' } }))
    const snap = await runAdapter('grok', fetchQuota, { env: CONFIGURED_ENV, now: NOW, fetchImpl })
    assert.equal(snap.error.code, 'malformed')
  })

  it('maps unrecognized billing structure to unsupported_version', async () => {
    const { fetchImpl } = createFakeFetch(billingRoutes({
      balance: { json: { somethingNew: 1 } },
      limits: { json: { somethingNew: true } },
      invoice: { json: { somethingNew: null } },
    }))
    const snap = await runAdapter('grok', fetchQuota, { env: CONFIGURED_ENV, now: NOW, fetchImpl })
    assert.equal(snap.status, 'unsupported_version')
  })

  it('tolerates unknown fields in billing payloads', async () => {
    const { fetchImpl } = createFakeFetch(billingRoutes({
      balance: { json: { total: { val: '500' }, newField: { x: 1 } } },
    }))
    const snap = await runAdapter('grok', fetchQuota, { env: CONFIGURED_ENV, now: NOW, fetchImpl })
    assert.equal(snap.wallets[0].balance, 5)
  })
})
