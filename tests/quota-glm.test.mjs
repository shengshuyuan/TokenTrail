import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  hostAllowed,
  pickCredentials,
  resolveCredentials,
  mapLimitEntries,
  planLabelFromResponse,
  fetchQuota,
} from '../src/lib/quotas/providers/glm.js'
import { runAdapter } from '../src/lib/quotas/refresh.js'
import { createFakeFs, createFakeFetch } from './helpers/quota-mock.mjs'

const HOME = '/home/test'
const NOW = () => Date.parse('2026-09-01T12:00:00.000Z')
const SECRET = 'glm-secret-token-xyz'

function limitsResponse(overrides = []) {
  return {
    plan: 'GLM Coding Pro',
    limits: [
      { type: 'TOKENS_LIMIT', percentage: 82, nextResetTime: '2026-09-01T17:00:00Z' },
      { type: 'TIME_LIMIT', percentage: 30, currentValue: 120, usage: 400 },
      ...overrides,
    ],
  }
}

const ZAI_ENV = { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: SECRET }

describe('GLM Coding Plan adapter', () => {
  it('only trusts official GLM base URLs', () => {
    assert.equal(hostAllowed('https://api.z.ai/api/anthropic'), true)
    assert.equal(hostAllowed('https://open.bigmodel.cn/api/anthropic'), true)
    assert.equal(hostAllowed('http://127.0.0.1:15721'), false)
    assert.equal(hostAllowed('https://evil.example.com'), false)
    assert.equal(hostAllowed('not a url'), false)
  })

  it('discovers credentials from env, then Claude settings, then helper config', () => {
    const fromEnv = resolveCredentials({ env: ZAI_ENV, fs: createFakeFs({}), home: HOME })
    assert.equal(fromEnv.token, SECRET)

    // 本地代理地址不算 GLM 配置 → 回落到 ~/.claude/settings.json
    const settingsFs = createFakeFs({
      [`${HOME}/.claude/settings.json`]: JSON.stringify({
        env: { ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic', ANTHROPIC_AUTH_TOKEN: 'settings-token' },
      }),
    })
    const fromSettings = resolveCredentials({
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721', ANTHROPIC_AUTH_TOKEN: 'ignored' },
      fs: settingsFs,
      home: HOME,
    })
    assert.equal(fromSettings.baseUrl, 'https://open.bigmodel.cn/api/anthropic')
    assert.equal(fromSettings.token, 'settings-token')

    // 无任何配置 → 未配置
    assert.equal(resolveCredentials({ env: {}, fs: createFakeFs({}), home: HOME }), null)
  })

  it('rejects non-GLM base URLs even when a token exists', async () => {
    const snap = await runAdapter('glm', fetchQuota, {
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721', ANTHROPIC_AUTH_TOKEN: SECRET },
      fs: createFakeFs({}),
      home: HOME,
      now: NOW,
      fetchImpl: async () => {
        throw new Error('must not call a non-GLM host')
      },
    })
    assert.equal(snap.status, 'not_configured')
  })

  it('maps the 5-hour token window and keeps MCP usage as detail notice', async () => {
    const { windows, notices, hasUnreadable } = mapLimitEntries(limitsResponse().limits)
    assert.equal(windows.length, 1)
    assert.equal(windows[0].id, 'tokens-5h')
    assert.equal(windows[0].windowMinutes, 300)
    assert.equal(windows[0].usedPercent, 82)
    assert.equal(windows[0].resetsAt, Date.parse('2026-09-01T17:00:00Z'))
    assert.deepEqual(notices, ['mcp|120|400|30'])
    assert.equal(hasUnreadable, false)
  })

  it('handles missing reset time and missing percentage without fabricating values', () => {
    const { windows } = mapLimitEntries([{ type: 'TOKENS_LIMIT' }])
    assert.equal(windows[0].resetsAt, undefined) // UI 显示“重置时间未提供”
    assert.equal(windows[0].usedPercent, undefined) // 不构造 0%/100%

    const weekly = mapLimitEntries([{ type: 'WEEKLY_TOKENS_LIMIT', percentage: 15 }])
    assert.equal(weekly.windows[0].id, 'tokens-week')
  })

  it('ignores unknown limit types but flags partial readability', () => {
    const { windows, hasUnreadable } = mapLimitEntries([
      { type: 'TOKENS_LIMIT', percentage: 10 },
      { type: 'BRAND_NEW_LIMIT', percentage: 50 },
    ])
    assert.equal(windows.length, 1)
    assert.equal(hasUnreadable, true)
  })

  it('calls the official endpoint with the raw-token Authorization header', async () => {
    const { fetchImpl, calls } = createFakeFetch([
      { match: '/api/monitor/usage/quota/limit', status: 200, json: limitsResponse() },
    ])
    const snap = await runAdapter('glm', fetchQuota, { env: ZAI_ENV, fs: createFakeFs({}), home: HOME, now: NOW, fetchImpl })
    assert.equal(snap.status, 'warning') // 82% 黄色
    assert.equal(snap.planLabel, 'GLM Coding Pro')
    assert.equal(snap.source, 'official_api')
    const call = calls[0]
    assert.ok(call.url.startsWith('https://api.z.ai/api/monitor/usage/quota/limit'))
    // 官方脚本使用裸 token，无 Bearer 前缀
    assert.equal(call.opts.headers.Authorization, SECRET)
    assert.ok(!JSON.stringify(snap).includes(SECRET))
  })

  it('accepts the current official data.limits envelope', async () => {
    const { fetchImpl } = createFakeFetch([
      { match: '/api/monitor/usage/quota/limit', status: 200, json: { data: limitsResponse() } },
    ])
    const snap = await runAdapter('glm', fetchQuota, { env: ZAI_ENV, fs: createFakeFs({}), home: HOME, now: NOW, fetchImpl })
    assert.equal(snap.status, 'warning')
    assert.equal(snap.planLabel, 'GLM Coding Pro')
    assert.equal(snap.windows[0].id, 'tokens-5h')
    assert.equal(snap.notices[0], 'mcp|120|400|30')
  })

  it('falls back to healthy when only MCP detail exists', async () => {
    const { fetchImpl } = createFakeFetch([
      { match: '/quota/limit', status: 200, json: { limits: [{ type: 'TIME_LIMIT', percentage: 10, currentValue: 1, usage: 10 }] } },
    ])
    const snap = await runAdapter('glm', fetchQuota, { env: ZAI_ENV, fs: createFakeFs({}), home: HOME, now: NOW, fetchImpl })
    assert.equal(snap.status, 'partial')
    assert.equal(snap.windows.length, 0)
  })

  it('maps 401/403 and 429 safely', async () => {
    const unauthorized = createFakeFetch([{ match: '/quota/limit', status: 401, json: {} }])
    const snap401 = await runAdapter('glm', fetchQuota, { env: ZAI_ENV, fs: createFakeFs({}), home: HOME, now: NOW, fetchImpl: unauthorized.fetchImpl })
    assert.equal(snap401.status, 'auth_error')

    const forbidden = createFakeFetch([{ match: '/quota/limit', status: 403, json: {} }])
    const snap403 = await runAdapter('glm', fetchQuota, { env: ZAI_ENV, fs: createFakeFs({}), home: HOME, now: NOW, fetchImpl: forbidden.fetchImpl })
    assert.equal(snap403.status, 'auth_error')

    const limited = createFakeFetch([{ match: '/quota/limit', status: 429, json: {} }])
    const snap429 = await runAdapter('glm', fetchQuota, { env: ZAI_ENV, fs: createFakeFs({}), home: HOME, now: NOW, fetchImpl: limited.fetchImpl })
    assert.equal(snap429.error.code, 'rate_limited')
  })

  it('maps timeout, malformed JSON and structural changes', async () => {
    const hang = createFakeFetch([{ match: '/quota/limit', hang: true }])
    const timeoutSnap = await runAdapter('glm', fetchQuota, { env: ZAI_ENV, fs: createFakeFs({}), home: HOME, now: NOW, fetchImpl: hang.fetchImpl, timeoutMs: 50 })
    assert.equal(timeoutSnap.error.code, 'timeout')

    const malformed = createFakeFetch([{ match: '/quota/limit', status: 200, text: '{oops' }])
    const malformedSnap = await runAdapter('glm', fetchQuota, { env: ZAI_ENV, fs: createFakeFs({}), home: HOME, now: NOW, fetchImpl: malformed.fetchImpl })
    assert.equal(malformedSnap.error.code, 'malformed')

    const changed = createFakeFetch([{ match: '/quota/limit', status: 200, json: { newFormat: true } }])
    const versionSnap = await runAdapter('glm', fetchQuota, { env: ZAI_ENV, fs: createFakeFs({}), home: HOME, now: NOW, fetchImpl: changed.fetchImpl })
    assert.equal(versionSnap.status, 'unsupported_version')
  })

  it('tolerates unknown fields and picks plan labels defensively', () => {
    assert.equal(planLabelFromResponse({ plan: 'Pro' }), 'Pro')
    assert.equal(planLabelFromResponse({ planLevel: 'max' }), 'max')
    assert.equal(planLabelFromResponse({ unknown: true }), undefined)
    const { windows } = mapLimitEntries([{ type: 'TOKENS_LIMIT', percentage: 5, brandNewField: { nested: 1 } }])
    assert.equal(windows[0].usedPercent, 5)
  })
})
