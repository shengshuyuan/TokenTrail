import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { refreshAll, getQuotas, canManualRefresh, runAdapter } from '../src/lib/quotas/refresh.js'
import { rowsToSnapshots, withPreviousFallback } from '../src/lib/quotas/cache.js'
import {
  aggregateQuotaStatus,
  deriveProviderStatus,
  windowStatusFromPercent,
  isDataStale,
  isCacheFresh,
} from '../src/lib/quotas/status.js'
import { createFakeStore } from './helpers/quota-mock.mjs'

const NOW = () => Date.parse('2026-09-01T12:00:00.000Z')
const MIN = 60_000

function makeAdapters(overrides = {}) {
  const counts = { codex: 0, gemini: 0, grok: 0, glm: 0, kimi: 0 }
  const base = {
    codex: async () => {
      counts.codex += 1
      return { provider: 'codex', status: 'healthy', windows: [{ id: '5h', label: '5h', unit: 'request', usedPercent: 6 }], source: 'local_session', stale: false }
    },
    gemini: async () => {
      counts.gemini += 1
      return { provider: 'gemini', status: 'warning', windows: [{ id: 'm', label: 'm', unit: 'request', usedPercent: 82 }], source: 'official_api', stale: false }
    },
    grok: async () => {
      counts.grok += 1
      return { provider: 'grok', status: 'unsupported', windows: [], source: 'unavailable', stale: false, notices: ['subscription'] }
    },
    glm: async () => {
      counts.glm += 1
      return { provider: 'glm', status: 'not_configured', windows: [], source: 'unavailable', stale: false }
    },
    kimi: async () => {
      counts.kimi += 1
      return { provider: 'kimi', status: 'network_error', windows: [], source: 'unavailable', stale: false, error: { code: 'network', safeMessage: 'provider request failed' } }
    },
  }
  return { adapters: { ...base, ...overrides }, counts }
}

function baseDeps(overrides = {}) {
  const store = overrides.store ?? createFakeStore()
  const { adapters, counts } = makeAdapters(overrides.adapterOverrides)
  const { adapters: _, store: _s, ...rest } = overrides
  return {
    adapters,
    store,
    now: NOW,
    home: '/home/test',
    fs: {},
    env: {},
    inflight: new Map(), // 每个用例独立，避免用例间互相去重
    fetchImpl: async () => {
      throw new Error('no fetch in core tests')
    },
    ...rest,
    counts,
  }
}

describe('quota orchestration (API semantics)', () => {
  it('one provider failing never fails the whole round', async () => {
    const deps = baseDeps({
      adapterOverrides: {
        codex: async () => {
          const err = new Error('boom with stack')
          err.code = 'network'
          throw err
        },
      },
    })
    const result = await refreshAll(deps)
    const byProvider = new Map(result.providers.map((p) => [p.provider, p]))
    assert.equal(byProvider.get('codex').status, 'network_error')
    assert.equal(byProvider.get('gemini').status, 'warning')
    assert.equal(byProvider.get('grok').status, 'unsupported')
    assert.equal(byProvider.get('glm').status, 'not_configured')
    const codexJson = JSON.stringify(byProvider.get('codex'))
    assert.ok(!codexJson.includes('boom with stack'), 'stack/error text must not leak')
    assert.deepEqual(Object.keys(byProvider.get('codex').error ?? {}).sort(), ['code', 'safeMessage'])
  })

  it('merges concurrent refresh rounds into one (dedup)', async () => {
    const inflight = new Map()
    const depsA = baseDeps({ inflight })
    const depsB = baseDeps({ inflight })
    const [a, b] = await Promise.all([refreshAll(depsA), refreshAll(depsB)])
    assert.equal(a.deduped, undefined)
    assert.equal(b.deduped, true)
    // 每个 adapter 只真正执行了一次
    assert.equal(depsA.counts.codex + depsB.counts.codex, 1)
    assert.equal(depsA.counts.gemini + depsB.counts.gemini, 1)
  })

  it('GET returns cache immediately when fresh, without touching providers', async () => {
    const freshRow = {
      provider: 'codex',
      snapshot_json: JSON.stringify({ provider: 'codex', status: 'healthy', windows: [{ id: '5h', label: '5h', unit: 'request', usedPercent: 6 }], wallets: [], source: 'local_session', stale: false, fetchedAt: NOW() - 2 * MIN }),
      fetched_at: NOW() - 2 * MIN,
      last_success_at: NOW() - 2 * MIN,
      last_error_code: null,
    }
    // 其余四家无缓存 → 仍会触发后台刷新，但 codex 本身保持命中
    const deps = baseDeps({ store: createFakeStore([freshRow]) })
    const res = await getQuotas(deps)
    const codex = res.providers.find((p) => p.provider === 'codex')
    assert.equal(codex.status, 'healthy')
    assert.equal(codex.stale, false)
    assert.equal(res.attention_count, 0) // codex 健康绿色，其余四家尚未加载（灰色）
    // 无缓存的两家会在后台刷新
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(deps.counts.kimi, 1)
  })

  it('marks data stale after 15 minutes and keeps it readable', async () => {
    const old = NOW() - 16 * MIN
    const row = {
      provider: 'codex',
      snapshot_json: JSON.stringify({ provider: 'codex', status: 'healthy', windows: [{ id: '5h', label: '5h', unit: 'request', usedPercent: 6 }], wallets: [], source: 'local_session', stale: false }),
      fetched_at: old,
      last_success_at: old,
      last_error_code: null,
    }
    const store = createFakeStore([row, ...['gemini', 'grok', 'glm', 'kimi'].map((p) => ({
      provider: p,
      snapshot_json: JSON.stringify({ provider: p, status: 'healthy', windows: [], wallets: [], source: 'official_api', stale: false }),
      fetched_at: NOW(),
      last_success_at: NOW(),
      last_error_code: null,
    }))])
    const deps = baseDeps({ store })
    const res = await getQuotas(deps)
    const codex = res.providers.find((p) => p.provider === 'codex')
    assert.equal(codex.stale, true)
    assert.equal(codex.windows.length, 1) // 旧数据仍可读
    assert.equal(res.status, 'stale') // 健康但过期 → 黄色 stale，不伪装实时
  })

  it('falls back to the previous snapshot on network failures, but not on auth failures', async () => {
    const previous = {
      provider: 'codex',
      status: 'healthy',
      windows: [{ id: '5h', label: '5h', unit: 'request', usedPercent: 6 }],
      wallets: [],
      source: 'local_session',
      stale: false,
      fetchedAt: NOW() - 10 * MIN,
      lastSuccessAt: NOW() - 10 * MIN,
    }
    const now = NOW()

    const networkNext = { provider: 'codex', status: 'network_error', windows: [], wallets: [], source: 'unavailable', stale: false, error: { code: 'timeout', safeMessage: 'provider request failed' }, fetchedAt: now }
    const kept = withPreviousFallback(networkNext, previous, now)
    assert.equal(kept.windows.length, 1)
    assert.equal(kept.status, 'stale')
    assert.equal(kept.lastSuccessAt, NOW() - 10 * MIN)
    assert.equal(kept.error.code, 'timeout')

    const authNext = { provider: 'codex', status: 'auth_error', windows: [], wallets: [], source: 'unavailable', stale: false, error: { code: 'auth', safeMessage: 'provider request failed' }, fetchedAt: now }
    const authKept = withPreviousFallback(authNext, previous, now)
    assert.equal(authKept.status, 'auth_error')
    assert.equal(authKept.windows.length, 0)
  })

  it('never persists credentials and never exposes stacks through the store', async () => {
    const secret = 'super-secret-api-key-001'
    const deps = baseDeps({
      env: { XAI_MANAGEMENT_KEY: secret, XAI_TEAM_ID: 'team-1' },
      adapterOverrides: {
        grok: async () => {
          const err = new Error(`upstream rejected ${secret}`)
          err.code = 'auth'
          throw err
        },
      },
    })
    const result = await refreshAll(deps)
    const allJson = result.providers.map((p) => JSON.stringify(p)).join('')
    assert.ok(!allJson.includes(secret))
    assert.ok(!allJson.includes('upstream rejected'))
    const storeJson = JSON.stringify(deps.store.rows)
    assert.ok(!storeJson.includes(secret))
    assert.ok(!storeJson.includes('stack'))
  })

  it('throttles manual refresh to once per 30 seconds', () => {
    const now = NOW()
    assert.equal(canManualRefresh(undefined, now), true)
    assert.equal(canManualRefresh(now - 29_000, now), false)
    assert.equal(canManualRefresh(now - 30_000, now), true)
  })

  it('enforces per-adapter timeouts', async () => {
    const snap = await runAdapter('codex', async () => new Promise(() => {}), { now: NOW, timeoutMs: 30 })
    assert.equal(snap.status, 'network_error')
    assert.equal(snap.error.code, 'timeout')
  })
})

describe('quota status derivation', () => {
  it('classifies window usage thresholds', () => {
    assert.equal(windowStatusFromPercent(6), 'healthy')
    assert.equal(windowStatusFromPercent(82), 'warning')
    assert.equal(windowStatusFromPercent(96), 'critical')
    assert.equal(windowStatusFromPercent(100), 'exhausted')
    assert.equal(windowStatusFromPercent(undefined), null)
  })

  it('derives provider status from the worst window', () => {
    assert.equal(deriveProviderStatus({ windows: [{ usedPercent: 10 }, { usedPercent: 96 }] }), 'critical')
    assert.equal(deriveProviderStatus({ windows: [{ usedPercent: 82 }] }), 'warning')
    assert.equal(deriveProviderStatus({ windows: [], fallback: 'not_configured' }), 'not_configured')
    assert.equal(deriveProviderStatus({ windows: [{ usedPercent: 10 }], hasUnreadable: true }), 'partial')
  })

  it('aggregates global status and attention count', () => {
    const allGrey = aggregateQuotaStatus([
      { status: 'not_configured', stale: false },
      { status: 'unsupported', stale: false },
    ])
    assert.equal(allGrey.status, 'not_configured')
    assert.equal(allGrey.attention_count, 0)

    const mixed = aggregateQuotaStatus([
      { status: 'healthy', stale: false },
      { status: 'warning', stale: false },
      { status: 'exhausted', stale: false },
      { status: 'not_configured', stale: false },
    ])
    assert.equal(mixed.status, 'exhausted')
    assert.equal(mixed.attention_count, 2) // warning + exhausted

    const staleHealthy = aggregateQuotaStatus([{ status: 'healthy', stale: true, lastSuccessAt: 1 }])
    assert.equal(staleHealthy.status, 'stale')
    assert.equal(staleHealthy.attention_count, 1)
  })

  it('computes freshness boundaries', () => {
    const now = NOW()
    assert.equal(isCacheFresh(now - 4 * MIN, now), true)
    assert.equal(isCacheFresh(now - 6 * MIN, now), false)
    assert.equal(isDataStale(now - 14 * MIN, now), false)
    assert.equal(isDataStale(now - 16 * MIN, now), true)
    assert.equal(isDataStale(undefined, now), true)
  })

  it('parses store rows defensively', () => {
    const now = NOW()
    const map = rowsToSnapshots([
      { provider: 'codex', snapshot_json: '{bad json', fetched_at: now, last_success_at: now, last_error_code: null },
      { provider: 'glm', snapshot_json: JSON.stringify({ provider: 'glm', status: 'warning', windows: [] }), fetched_at: now, last_success_at: now - 20 * MIN, last_error_code: null },
    ], now)
    assert.equal(map.has('codex'), false) // 损坏行等价于无缓存
    assert.equal(map.get('glm').stale, true)
    assert.equal(map.get('glm').lastSuccessAt, now - 20 * MIN)
  })
})
