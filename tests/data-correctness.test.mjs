/**
 * Data-correctness regressions:
 * - "today" / "N days" are local calendar days, shared by /api/stats and /api/usage
 * - measured vs estimated rows can be filtered and reconciled with the totals
 * - every usage write invalidates the stats cache (not only sync)
 * - transient line write failures keep a file eligible for the next sync
 * - remote proxy calls of any method must bring their own credentials
 * - a single-provider quota refresh does not throttle "refresh all"
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-correctness-home-'))
process.env.HOME = home
// China time, fixed so the day boundary is deterministic on any host.
process.env.TOKENTRAIL_TZ_OFFSET_MINUTES = '480'
// Long TTL: the invalidation test must prove writes clear the cache.
process.env.TOKENTRAIL_STATS_CACHE_MS = '600000'

const { insertUsageRecord, localDayWindow } = await import('../src/lib/db.ts')
const { GET: statsGet } = await import('../src/app/api/stats/route.ts')
const { GET: usageGet } = await import('../src/app/api/usage/route.ts')
const { recordLineError, emptySyncResult } = await import('../src/lib/sync/shared.ts')
const { rejectUnsafeProxyRequest } = await import('../src/lib/local-request.ts')
const { markManualRefreshResult, canManualRefresh, getLastManualRefreshAt } = await import('../src/lib/quotas/refresh.js')
const manualRefreshThrottled = (provider, now) => !canManualRefresh(getLastManualRefreshAt(provider), now)

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const OFFSET = 480 * 60 * 1000

function startOfLocalToday(now = Date.now()) {
  return Math.floor((now + OFFSET) / DAY) * DAY - OFFSET
}

async function json(handler, url) {
  const res = await handler(new NextRequest(url))
  return { status: res.status, body: await res.json() }
}

let seq = 0
function insert(fields) {
  seq++
  return insertUsageRecord({
    source: 'claude-code',
    model: 'claude-sonnet',
    input_tokens: 10,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cost_usd: 0,
    request_id: `correctness-${seq}`,
    timestamp: Date.now(),
    ...fields,
  })
}

describe('local calendar-day window', () => {
  it('days=1 starts at local midnight, not 24 hours ago', () => {
    // 2026-10-13 11:00 in UTC+8
    const now = Date.parse('2026-10-13T03:00:00.000Z')
    const today = localDayWindow(1, now)
    assert.equal(new Date(today.startDate).toISOString(), '2026-10-12T16:00:00.000Z')
    assert.equal(today.endDate, now)

    const week = localDayWindow(7, now)
    assert.equal(new Date(week.startDate).toISOString(), '2026-10-06T16:00:00.000Z')
  })

  it('stats and usage both exclude yesterday from "today" and agree on the count', async () => {
    const midnight = startOfLocalToday()
    const now = Date.now()
    insert({ source: 'day-test', timestamp: midnight - HOUR, input_tokens: 1000 })
    insert({ source: 'day-test', timestamp: Math.max(midnight, now - 1000), input_tokens: 7 })

    const stats = await json(statsGet, 'http://127.0.0.1:3820/api/stats?days=1&source=day-test')
    assert.equal(stats.status, 200)
    assert.equal(stats.body.total_tokens, 7)
    assert.equal(stats.body.total_requests, 1)

    const usage = await json(usageGet, 'http://127.0.0.1:3820/api/usage?days=1&source=day-test&kind=measured')
    assert.equal(usage.body.total, stats.body.total_requests)
  })
})

describe('measured vs estimated records', () => {
  it('filters by kind and returns the estimated flag', async () => {
    insert({ source: 'kind-test', input_tokens: 5 })
    insert({ source: 'kind-test', input_tokens: 500, estimated: true })

    const base = 'http://127.0.0.1:3820/api/usage?days=1&source=kind-test'
    const measured = await json(usageGet, `${base}&kind=measured`)
    const estimated = await json(usageGet, `${base}&kind=estimated`)
    const all = await json(usageGet, base)
    assert.equal(measured.body.total, 1)
    assert.equal(estimated.body.total, 1)
    assert.equal(estimated.body.records[0].estimated, 1)
    assert.equal(all.body.total, 2)

    const stats = await json(statsGet, 'http://127.0.0.1:3820/api/stats?days=1&source=kind-test')
    assert.equal(stats.body.total_requests, measured.body.total)
    assert.equal(stats.body.estimated_requests, estimated.body.total)
  })

  it('rejects an unknown kind', async () => {
    const res = await json(usageGet, 'http://127.0.0.1:3820/api/usage?kind=guess')
    assert.equal(res.status, 400)
  })
})

describe('stats cache invalidation', () => {
  it('a direct insert (report / proxy path) shows up immediately', async () => {
    const url = 'http://127.0.0.1:3820/api/stats?days=1&source=cache-test'
    insert({ source: 'cache-test', input_tokens: 3 })
    const first = await json(statsGet, url)
    assert.equal(first.body.total_tokens, 3)

    insert({ source: 'cache-test', input_tokens: 4 })
    const second = await json(statsGet, url)
    assert.equal(second.body.total_tokens, 7)
  })

  it('a duplicate insert does not need to clear the cache but still returns consistent totals', async () => {
    const url = 'http://127.0.0.1:3820/api/stats?days=1&source=dup-test'
    insert({ source: 'dup-test', input_tokens: 2, request_id: 'dup-fixed' })
    insert({ source: 'dup-test', input_tokens: 2, request_id: 'dup-fixed' })
    const res = await json(statsGet, url)
    assert.equal(res.body.total_tokens, 2)
  })
})

describe('sync line errors', () => {
  it('bad JSON is permanent: counted as a bad line, file may be checkpointed', () => {
    const result = emptySyncResult('test')
    let parseError
    try { JSON.parse('{oops') } catch (err) { parseError = err }
    assert.deepEqual(recordLineError(result, parseError), { retryFile: false })
    assert.equal(result.bad_lines, 1)
    assert.equal(result.errors, 1)
  })

  it('a write failure is transient: the file must be read again next sync', () => {
    const result = emptySyncResult('test')
    assert.deepEqual(recordLineError(result, new Error('SQLITE_BUSY: database is locked')), { retryFile: true })
    assert.equal(result.bad_lines, undefined)
    assert.equal(result.errors, 1)
  })
})

describe('remote proxy credential boundary', () => {
  function proxyRequest(method, headers = {}) {
    return new Request('http://127.0.0.1:3820/proxy/openai/chat/completions', {
      method,
      headers: { host: '127.0.0.1:3820', origin: 'https://other.example', ...headers },
    })
  }

  it('refuses a remote POST without the caller\'s own key', () => {
    process.env.TOKENTRAIL_ALLOW_REMOTE = '1'
    try {
      assert.equal(rejectUnsafeProxyRequest(proxyRequest('POST'))?.status, 403)
      assert.equal(rejectUnsafeProxyRequest(proxyRequest('POST', { authorization: 'Basic abc' }))?.status, 403)
      assert.equal(rejectUnsafeProxyRequest(proxyRequest('POST', { authorization: 'Bearer caller-key' })), null)
    } finally {
      delete process.env.TOKENTRAIL_ALLOW_REMOTE
    }
  })

  it('local POST without Authorization may still use the stored key', () => {
    const req = new Request('http://127.0.0.1:3820/proxy/openai/chat/completions', {
      method: 'POST',
      headers: { host: '127.0.0.1:3820' },
    })
    assert.equal(rejectUnsafeProxyRequest(req), null)
  })
})

describe('manual quota refresh throttle', () => {
  it('a single-provider refresh does not block "refresh all"', () => {
    const now = Date.parse('2030-01-01T00:00:00.000Z')
    markManualRefreshResult('gemini', ['gemini'], now)
    assert.equal(manualRefreshThrottled('gemini', now + 1000), true)
    assert.equal(manualRefreshThrottled('all', now + 1000), false)

    markManualRefreshResult(undefined, ['codex'], now)
    assert.equal(manualRefreshThrottled('all', now + 1000), true)
    assert.equal(manualRefreshThrottled('codex', now + 1000), true)
  })

  it('nothing is throttled when no provider succeeded', () => {
    const now = Date.parse('2031-01-01T00:00:00.000Z')
    markManualRefreshResult('kimi', [], now)
    assert.equal(manualRefreshThrottled('kimi', now + 1000), false)
  })
})
