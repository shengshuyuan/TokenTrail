import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Must run before importing db.ts: each node --test file gets its own process,
// so this sandbox DB never touches the real one.
process.env.TOKENTRAIL_DB_PATH = path.join(os.tmpdir(), `tt-migration-test-${process.pid}.db`)

const { insertUsageRecord, upsertModelPricing, getDb, getAggregatedStats } = await import('../src/lib/db.ts')
const { runMigrations } = await import('../src/lib/migrations.ts')

const NOW = Date.now()
let seq = 0

function insert(source, model, buckets, extra = {}) {
  seq += 1
  return insertUsageRecord({
    source,
    model,
    input_tokens: buckets.input,
    cached_input_tokens: buckets.cached ?? 0,
    output_tokens: buckets.output,
    reasoning_tokens: buckets.reason ?? 0,
    cost_usd: 999,
    timestamp: NOW + seq,
    ...extra,
  })
}

function rowByRequestId(requestId) {
  return getDb().prepare('SELECT * FROM usage_records WHERE request_id = ?').get(requestId)
}

// Test-price for recompute assertions: in 1.0 / cached 0.25 / out 2.0 / reason 2.0 per 1M.
function seedTestPricing(model) {
  upsertModelPricing({
    model_id: model,
    display_name: model,
    provider: 'test',
    input_price_per_1m: 1.0,
    cached_input_price_per_1m: 0.25,
    output_price_per_1m: 2.0,
    reasoning_price_per_1m: 2.0,
  })
}

describe('normalize_inclusive_v1 migration (hermes/grok)', () => {
  before(() => {
    seedTestPricing('gpt-4.1')

    // hermes inclusive row: input 100 (60 cached), output 20 (8 reasoning)
    insert('hermes', 'gpt-4.1', { input: 100, cached: 60, output: 20, reason: 8 }, { request_id: 'mig-hermes-1' })
    // grok inclusive row
    insert('grok', 'gpt-4.1', { input: 50, cached: 10, output: 30, reason: 0 }, { request_id: 'mig-grok-1' })
    // anomalous hermes row (cached > input) must be skipped
    insert('hermes', 'gpt-4.1', { input: 10, cached: 99, output: 10, reason: 0 }, { request_id: 'mig-hermes-anomaly' })
    // VibeCafé aggregate row must be skipped
    insert('hermes', 'gpt-4.1', { input: 100, cached: 60, output: 20, reason: 0 }, { request_id: 'vc:mig-agg', is_aggregate: true })
    // openclaw exclusive row must never be touched
    insert('openclaw', 'gpt-4.1', { input: 90, cached: 337, output: 10, reason: 0 }, { request_id: 'mig-openclaw-1' })
    // fully-subsetted row (cached == input) → input becomes 0, valid
    insert('grok', 'gpt-4.1', { input: 40, cached: 40, output: 10, reason: 10 }, { request_id: 'mig-grok-2' })

    runMigrations()
  })

  it('subtracts cached/reasoning from hermes/grok totals and recomputes cost', () => {
    const row = rowByRequestId('mig-hermes-1')
    assert.equal(row.input_tokens, 40)
    assert.equal(row.cached_input_tokens, 60)
    assert.equal(row.output_tokens, 12)
    assert.equal(row.reasoning_tokens, 8)
    // 40*1 + 60*0.25 + 12*2 + 8*2 = 95 / 1M
    assert.equal(row.cost_usd, 0.000095)

    const grok = rowByRequestId('mig-grok-1')
    assert.equal(grok.input_tokens, 40)
    assert.equal(grok.output_tokens, 30)
    assert.notEqual(grok.cost_usd, 999)
  })

  it('handles rows whose subsets equal their totals', () => {
    const row = rowByRequestId('mig-grok-2')
    assert.equal(row.input_tokens, 0)
    assert.equal(row.output_tokens, 0)
    assert.ok(row.cost_usd > 0)
  })

  it('skips anomalous, aggregate, and foreign-source rows', () => {
    assert.equal(rowByRequestId('mig-hermes-anomaly').input_tokens, 10)
    assert.equal(rowByRequestId('mig-hermes-anomaly').cost_usd, 999)
    assert.equal(rowByRequestId('vc:mig-agg').input_tokens, 100)
    const openclaw = rowByRequestId('mig-openclaw-1')
    assert.equal(openclaw.input_tokens, 90)
    assert.equal(openclaw.cached_input_tokens, 337)
  })

  it('is idempotent: re-running changes nothing', () => {
    const before = getDb().prepare('SELECT id, input_tokens, cost_usd FROM usage_records ORDER BY id').all()
    runMigrations()
    const after = getDb().prepare('SELECT id, input_tokens, cost_usd FROM usage_records ORDER BY id').all()
    assert.deepEqual(after, before)
  })

  it('exclusive buckets aggregate without double counting', () => {
    // Only this window: filter to a range that covers exactly the six rows.
    const stats = getAggregatedStats({ startDate: NOW, endDate: NOW + seq + 1 })
    const hermes = stats.by_source.find(s => s.source === 'hermes')
    const openclaw = stats.by_source.find(s => s.source === 'openclaw')
    // hermes sums: mig-hermes-1 (40+60+12+8) + anomaly (10+99+10) + vc agg (100+60+20)
    assert.equal(hermes.total_tokens, 419)
    // openclaw row keeps its inclusive-looking raw values as recorded
    assert.equal(openclaw.total_tokens, 90 + 337 + 10)
  })

  it('writes the app_config marker', () => {
    const marker = getDb().prepare('SELECT value FROM app_config WHERE key = ?').get('migration.normalize_inclusive_v1')
    assert.ok(marker?.value)
  })
})

describe('estimated backfill on boot', () => {
  it('marks antigravity session rows and traework scan rows, not vc aggregates or proxy rows', () => {
    // Rows inserted after this process' first getDb() are not backfilled in
    // process — boot in a child process (fresh getDb) to exercise the real
    // startup backfill path.
    insert('antigravity', 'gemini-3.8-flash', { input: 10, output: 10 }, { request_id: 'antigravity-conv-1' })
    insert('antigravity', 'gemini-3.8-flash', { input: 10, output: 10 }, { request_id: 'vc:agy-agg', is_aggregate: true })
    insert('traework', 'glm-5', { input: 10, output: 10 }, { request_id: 'traework:chat:1:sess:f.json', provider: 'trae' })
    insert('traework', 'glm-5', { input: 10, output: 10 }, { request_id: 'chatcmpl-xyz' })
    insert('codex', 'gpt-5.2', { input: 10, output: 10 }, { request_id: 'codex:real-1' })

    const childScript = `
      const { getDb } = await import(${JSON.stringify(pathToFileURL(path.resolve('src/lib/db.ts')).href)})
      const rows = getDb().prepare('SELECT request_id, estimated FROM usage_records WHERE request_id LIKE ? OR request_id LIKE ? OR request_id LIKE ? OR request_id = ? OR request_id = ?')
        .all('antigravity-%', 'vc:%', 'traework:%', 'chatcmpl-xyz', 'codex:real-1')
      console.log(JSON.stringify(rows))
    `
    const stdout = execFileSync(process.execPath, ['--input-type=module', '--eval', childScript], {
      env: { ...process.env, TOKENTRAIL_DB_PATH: process.env.TOKENTRAIL_DB_PATH },
      encoding: 'utf8',
    })
    const rows = JSON.parse(stdout.trim().split('\n').pop())
    const byId = Object.fromEntries(rows.map(r => [r.request_id, r.estimated]))

    assert.equal(byId['antigravity-conv-1'], 1, 'antigravity session row is estimated')
    assert.equal(byId['vc:agy-agg'], 0, 'VibeCafé aggregate is not estimated')
    assert.equal(byId['traework:chat:1:sess:f.json'], 1, 'TraeWork scan row is estimated')
    assert.equal(byId['chatcmpl-xyz'], 0, 'TraeWork proxy row (real usage) is not estimated')
    assert.equal(byId['codex:real-1'], 0, 'codex row is not estimated')
  })
})
