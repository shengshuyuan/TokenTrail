import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  discoverLocalServers,
  readKimiCliSession,
  windowMinutesFromKimi,
  mapLocalUsagePayload,
  mapDirectUsage,
  mapExtraUsage,
  unwrapLocalUsageEnvelope,
  fetchMoonshotWallet,
  fetchQuota,
} from '../src/lib/quotas/providers/kimi.js'
import { runAdapter } from '../src/lib/quotas/refresh.js'
import { resolveCliBinary } from '../src/lib/quotas/cli-login.js'
import { createFakeFs, createFakeFetch } from './helpers/quota-mock.mjs'

const HOME = '/home/test'
const NOW = () => Date.parse('2026-09-01T12:00:00.000Z')
const MOONSHOT_KEY = 'sk-moonshot-secret'
const KIMI_CODE_KEY = 'sk-kimi-code-secret'

/** 本地 Server API wire 格式（真实结构）。 */
function localUsagePayload() {
  return {
    kind: 'ok',
    summary: { window: { duration: '1', unit: 'week' }, used: '39', limit: '100', reset_at: '2026-09-07T00:00:00Z' },
    limits: [
      { window: { duration: '300', unit: 'minute' }, used: '0', limit: '100', reset_at: '2026-09-01T17:00:00Z' },
    ],
    extra_usage: {
      balance_cents: 1500,
      total_cents: 5000,
      monthly_charge_limit_enabled: true,
      monthly_charge_limit_cents: 10000,
      monthly_used_cents: 1500,
      currency: 'CNY',
    },
  }
}

/** 直连 /usages 真实响应结构（字段值为字符串，含必须排除的账号字段）。 */
function directUsageResponse() {
  return {
    user: { userId: 'cm5naag3qff45op1n9n0', region: 'REGION_CN', membership: { level: 'LEVEL_BASIC' }, businessId: '' },
    usage: { limit: '100', used: '39', remaining: '61', resetTime: '2026-09-07T00:00:00.000Z' },
    limits: [
      {
        window: { duration: '300', timeUnit: 'TIME_UNIT_MINUTE' },
        detail: { limit: '100', remaining: '100', resetTime: '2026-09-01T17:00:00.000Z' },
      },
    ],
    parallel: { limit: '10' },
    totalQuota: {},
    authentication: { method: 'METHOD_ACCESS_TOKEN', scope: 'FEATURE_CODING' },
    subType: 'TYPE_PURCHASE',
    domain: 'DOMAIN_NEXUS',
  }
}

function instancesFs(entries = {}) {
  return createFakeFs({
    [`${HOME}/.kimi-code/server/instances/inst-1.json`]: JSON.stringify({ port: 58627, bearerToken: 'local-token' }),
    ...entries,
  })
}

function noLocalFs(credExpiry = 0) {
  return createFakeFs({
    [`${HOME}/.kimi-code/credentials/kimi-code.json`]: JSON.stringify({
      access_token: 'stored-access-token',
      refresh_token: 'stored-refresh',
      expires_at: credExpiry,
    }),
  })
}

describe('Kimi Code quota adapter', () => {
  it('discovers local server instances with tolerant field names', () => {
    const servers = discoverLocalServers(instancesFs({
      [`${HOME}/.kimi-code/server/instances/inst-2.json`]: JSON.stringify({ serverPort: 58700, serverToken: 'tok2' }),
      [`${HOME}/.kimi-code/server/instances/inst-3.json`]: JSON.stringify({ port: 58701, host: '127.0.0.1', started_at: 1 }),
      [`${HOME}/.kimi-code/server/instances/inst-4.json`]: 'not json',
    }), HOME)
    // inst-3 是真实 kimi web 的格式：无 token → 跳过，不得猜测凭证
    assert.equal(servers.length, 2)
    assert.equal(servers[0].url, 'http://127.0.0.1:58627/api/v1/oauth/usage')
    assert.equal(servers[1].url, 'http://127.0.0.1:58700/api/v1/oauth/usage')
  })

  it('converts kimi window units to minutes across both wire formats', () => {
    assert.equal(windowMinutesFromKimi({ duration: '5', unit: 'hour' }), 300)
    assert.equal(windowMinutesFromKimi({ duration: '1', unit: 'week' }), 10080)
    assert.equal(windowMinutesFromKimi({ duration: '300', timeUnit: 'TIME_UNIT_MINUTE' }), 300)
    assert.equal(windowMinutesFromKimi({ duration: '30', unit: 'minute' }), 30)
    assert.equal(windowMinutesFromKimi({ duration: '3', unit: 'fortnight' }), null)
  })

  it('maps the local Server API payload: summary as weekly window plus limits', () => {
    const { windows, wallet } = mapLocalUsagePayload(localUsagePayload())
    assert.equal(windows.length, 2)
    assert.equal(windows[0].id, 'kimi-10080')
    assert.equal(windows[0].usedPercent, 39) // 字符串数值也要正确计算
    assert.equal(windows[0].resetsAt, Date.parse('2026-09-07T00:00:00Z'))
    assert.equal(windows[1].usedPercent, 0)
    assert.equal(wallet.balance, 15)
    assert.equal(wallet.currency, 'CNY')
    assert.equal(wallet.monthlyLimit, 100)
  })

  it('maps the direct /usages response and never leaks account fields', () => {
    const { windows, wallet } = mapDirectUsage(directUsageResponse())
    assert.equal(windows.length, 2)
    assert.equal(windows[0].label, 'week')
    assert.equal(windows[0].usedPercent, 39)
    assert.equal(windows[0].resetsAt, Date.parse('2026-09-07T00:00:00.000Z'))
    // limits[].detail 只给 remaining → used = limit - remaining
    assert.equal(windows[1].label, '5h')
    assert.equal(windows[1].used, 0)
    assert.equal(windows[1].usedPercent, 0)
    assert.equal(wallet, null)

    const json = JSON.stringify(windows)
    assert.ok(!json.includes('cm5naag3qff45op1n9n0'), 'userId must not leak')
    assert.ok(!json.includes('REGION_CN'), 'region must not leak')
    assert.ok(!json.includes('LEVEL_BASIC'), 'membership must not leak')
  })

  it('rejects unexpected direct shapes instead of inventing windows', () => {
    assert.throws(() => mapDirectUsage({ limits: [] }), (e) => e.code === 'unsupported_version')
    assert.throws(() => mapDirectUsage(null), (e) => e.code === 'unsupported_version')
  })

  it('maps extra_usage to the booster-pack wallet', () => {
    const wallet = mapExtraUsage(localUsagePayload().extra_usage)
    assert.equal(wallet.balance, 15)
    assert.equal(wallet.currency, 'CNY')
    assert.equal(wallet.monthlyUsed, 15)
    assert.equal(mapExtraUsage(null), null)
  })

  it('unwraps local envelopes and maps in-band upstream errors', () => {
    assert.equal(unwrapLocalUsageEnvelope({ code: '0', data: localUsagePayload() }).limits.length, 1)
    assert.equal(unwrapLocalUsageEnvelope(localUsagePayload()).summary.used, '39')

    assert.throws(() => unwrapLocalUsageEnvelope({ data: { kind: 'error', message: 'x', status: 401 } }), (e) => e.code === 'auth')
    assert.throws(() => unwrapLocalUsageEnvelope({ data: { kind: 'error', status: 429 } }), (e) => e.code === 'rate_limited')
  })

  it('prefers the local server when an instance carries a token', async () => {
    const { fetchImpl, calls } = createFakeFetch([
      { match: '127.0.0.1:58627', status: 200, json: { code: '0', msg: 'success', data: localUsagePayload() } },
    ])
    const snap = await runAdapter('kimi', fetchQuota, { fs: instancesFs(), home: HOME, now: NOW, fetchImpl })
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.windows.length, 2)
    assert.equal(snap.wallets[0].label, 'extra')
    assert.equal(snap.source, 'local_cli')
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer local-token')
  })

  it('distinguishes missing credentials from an expired Kimi Code login', async () => {
    const { fetchImpl, calls } = createFakeFetch([])
    const snap = await runAdapter('kimi', fetchQuota, { fs: createFakeFs({}), home: HOME, now: NOW, fetchImpl })
    assert.equal(snap.status, 'not_configured')
    assert.equal(calls.length, 0)

    // 凭证存在但已过期：不得带旧 token 直接调用远端，且必须提示重新登录。
    const expired = await runAdapter('kimi', fetchQuota, {
      fs: noLocalFs(NOW() / 1000 - 3600),
      home: HOME,
      now: NOW,
      fetchImpl,
    })
    assert.equal(expired.status, 'auth_error')
    assert.equal(expired.error.code, 'auth')
    assert.equal(calls.length, 0)

    assert.deepEqual(readKimiCliSession(noLocalFs(NOW() / 1000 - 3600), HOME, NOW()), {
      loggedIn: false,
      hasCredentials: true,
      expired: true,
    })
  })

  it('accepts a Kimi Code console key for the subscription /usages endpoint', async () => {
    const { fetchImpl, calls } = createFakeFetch([
      { match: 'api.kimi.com/coding/v1/usages', status: 200, json: directUsageResponse() },
    ])
    const snap = await runAdapter('kimi', fetchQuota, {
      env: { KIMI_CODE_API_KEY: KIMI_CODE_KEY },
      fs: createFakeFs({}),
      home: HOME,
      now: NOW,
      fetchImpl,
    })
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.product, 'subscription')
    assert.equal(calls[0].opts.headers.Authorization, `Bearer ${KIMI_CODE_KEY}`)
    assert.ok(!JSON.stringify(snap).includes(KIMI_CODE_KEY))
  })

  it('falls back to the official /usages endpoint with a fresh stored token', async () => {
    const { fetchImpl, calls } = createFakeFetch([
      { match: 'api.kimi.com/coding/v1/usages', status: 200, json: directUsageResponse() },
    ])
    const snap = await runAdapter('kimi', fetchQuota, {
      fs: noLocalFs(NOW() / 1000 + 600),
      home: HOME,
      now: NOW,
      fetchImpl,
    })
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.windows.length, 2)
    assert.equal(snap.source, 'official_api')
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer stored-access-token')
    const json = JSON.stringify(snap)
    assert.ok(!json.includes('stored-access-token'), 'token must not leak into snapshot')
    assert.ok(!json.includes('cm5naag3qff45op1n9n0'), 'userId must not leak into snapshot')
  })

  it('adds the Moonshot open-platform wallet only when separately configured', async () => {
    const withKey = await fetchMoonshotWallet({
      env: { MOONSHOT_API_KEY: MOONSHOT_KEY },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { available_balance: '88.5' } }),
      }),
    })
    assert.deepEqual(withKey, { label: 'moonshot-platform', balance: 88.5, currency: 'CNY' })

    const withoutKey = await fetchMoonshotWallet({ env: {}, fetchImpl: async () => { throw new Error('x') } })
    assert.equal(withoutKey, null)

    const failing = await fetchMoonshotWallet({
      env: { MOONSHOT_API_KEY: MOONSHOT_KEY },
      fetchImpl: async () => { throw new Error('network') },
    })
    assert.equal(failing, null)
  })

  it('supports a Moonshot API wallet without pretending it is a Kimi Code subscription', async () => {
    const { fetchImpl } = createFakeFetch([
      { match: 'api.moonshot.cn/v1/users/me/balance', status: 200, json: { data: { available_balance: '23.5' } } },
    ])
    const snap = await runAdapter('kimi', fetchQuota, {
      env: { MOONSHOT_API_KEY: MOONSHOT_KEY },
      fs: createFakeFs({}),
      home: HOME,
      now: NOW,
      fetchImpl,
    })
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.product, 'api')
    assert.equal(snap.windows.length, 0)
    assert.deepEqual(snap.wallets, [{ label: 'moonshot-platform', balance: 23.5, currency: 'CNY' }])
  })

  it('maps auth/rate-limit/timeout/malformed failures to safe snapshots', async () => {
    // 本地实例 401 → 跳过；无凭证 → 未配置
    const auth = createFakeFetch([{ match: '127.0.0.1:58627', status: 401, json: {} }])
    const snap401 = await runAdapter('kimi', fetchQuota, { fs: instancesFs(), home: HOME, now: NOW, fetchImpl: auth.fetchImpl, timeoutMs: 2000 })
    assert.equal(snap401.status, 'not_configured')

    // 本地实例超时 → 跳过 → 未配置（外层兜底超时大于内部请求超时）
    const hang = createFakeFetch([{ match: '127.0.0.1:58627', hang: true }])
    const timeoutSnap = await runAdapter('kimi', fetchQuota, { fs: instancesFs(), home: HOME, now: NOW, fetchImpl: hang.fetchImpl, timeoutMs: 60 })
    assert.equal(timeoutSnap.status, 'not_configured')

    // 本地实例返回坏 JSON → 跳过 → 未配置
    const malformed = createFakeFetch([{ match: '127.0.0.1:58627', status: 200, text: '<html>' }])
    const malformedSnap = await runAdapter('kimi', fetchQuota, { fs: instancesFs(), home: HOME, now: NOW, fetchImpl: malformed.fetchImpl, timeoutMs: 2000 })
    assert.equal(malformedSnap.status, 'not_configured')

    // 直连 401 → auth_error（凭证确实失效）
    const directAuth = createFakeFetch([{ match: 'api.kimi.com', status: 401, json: {} }])
    const direct401 = await runAdapter('kimi', fetchQuota, {
      fs: noLocalFs(NOW() / 1000 + 600),
      home: HOME,
      now: NOW,
      fetchImpl: directAuth.fetchImpl,
      timeoutMs: 2000,
    })
    assert.equal(direct401.status, 'auth_error')

    // 直连限流 → 保留旧数据语义
    const directLimited = createFakeFetch([{ match: 'api.kimi.com', status: 429, json: {} }])
    const direct429 = await runAdapter('kimi', fetchQuota, {
      fs: noLocalFs(NOW() / 1000 + 600),
      home: HOME,
      now: NOW,
      fetchImpl: directLimited.fetchImpl,
      timeoutMs: 2000,
    })
    assert.equal(direct429.error.code, 'rate_limited')
  })
})

describe('CLI login binary resolution', () => {
  it('finds Kimi at ~/.kimi-code/bin/kimi, not ~/.kimi/bin/kimi', () => {
    const fsMod = createFakeFs({ [`${HOME}/.kimi-code/bin/kimi`]: '#!/bin/sh' })
    assert.equal(resolveCliBinary('kimi', { home: HOME, fs: fsMod, execFileSyncImpl: () => { throw new Error('no PATH') } }), `${HOME}/.kimi-code/bin/kimi`)
    assert.equal(resolveCliBinary('kimi', { home: HOME, fs: createFakeFs({}), execFileSyncImpl: () => { throw new Error('no PATH') } }), null)
  })
})
