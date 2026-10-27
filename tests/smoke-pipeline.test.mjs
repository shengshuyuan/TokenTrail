import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-smoke-home-'))
process.env.HOME = home
process.env.TOKENTRAIL_STATS_CACHE_MS = '0'

const { insertUsageRecord, getAggregatedStats, hasRawUsageOnLocalDay } = await import('../src/lib/db.ts')
const { syncAll } = await import('../src/lib/sync/index.ts')
const { GET: healthGet } = await import('../src/app/api/health/route.ts')
const { GET: statsGet } = await import('../src/app/api/stats/route.ts')

describe('health → sync → stats', () => {
  it('returns the measured-total shape and ignores character estimates', async () => {
    const health = await healthGet()
    assert.equal(health.status, 200)
    const healthBody = await health.json()
    assert.equal(healthBody.status, 'ok')
    assert.equal(typeof healthBody.records, 'number')

    const results = await syncAll({ only: ['claude-code'] })
    assert.ok(Array.isArray(results))
    assert.equal(results.length, 1)
    assert.equal(results[0].source, 'claude-code')
    for (const key of ['scanned', 'inserted', 'duplicates', 'errors', 'skipped_files', 'duration_ms']) {
      assert.equal(typeof results[0][key], 'number')
    }

    const at = Date.now()
    insertUsageRecord({
      source: 'claude-code',
      model: 'claude-sonnet',
      input_tokens: 100,
      output_tokens: 20,
      cost_usd: 1,
      request_id: `smoke-real-${at}`,
      timestamp: at,
    })
    insertUsageRecord({
      source: 'antigravity',
      model: 'gemini-2.5-pro',
      input_tokens: 700,
      output_tokens: 0,
      cost_usd: 0,
      estimated: true,
      request_id: `smoke-est-${at}`,
      timestamp: at,
    })

    const stats = getAggregatedStats({ startDate: at - 1, endDate: at + 1 })
    assert.equal(stats.total_tokens, 120)
    assert.equal(stats.estimated_tokens, 700)
    assert.equal(stats.estimated_by_source[0].source, 'antigravity')
    assert.ok(stats.cursor_groups)

    const response = await statsGet(new NextRequest(`http://127.0.0.1:3820/api/stats?days=7`))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(typeof body.total_tokens, 'number')
    assert.ok(Array.isArray(body.by_source))
    assert.ok(Array.isArray(body.daily))
    assert.ok(Array.isArray(body.available_sources))
    assert.ok(body.total_tokens >= 120)
    assert.ok(body.estimated_tokens >= 700)
  })

  it('skips a VibeCafé bucket when the same local day already has a raw row', () => {
    const at = Date.now()
    insertUsageRecord({
      source: 'openclaw',
      model: 'gpt-4.1',
      input_tokens: 5,
      output_tokens: 5,
      cost_usd: 0,
      request_id: `smoke-raw-${at}`,
      timestamp: at,
    })
    assert.equal(hasRawUsageOnLocalDay('openclaw', 'gpt-4.1', at), true)
    assert.equal(hasRawUsageOnLocalDay('openclaw', 'gpt-4.1', at - 10 * 24 * 3600 * 1000), false)
  })
})
