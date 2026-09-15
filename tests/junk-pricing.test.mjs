import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'

process.env.TOKENTRAIL_DB_PATH = path.join(os.tmpdir(), `tt-junk-pricing-${process.pid}.db`)

const { getDb, upsertModelPricing, insertUsageRecord, isJunkAutoPricingModel, getAllPricing } = await import('../src/lib/db.ts')
const { runMigrations } = await import('../src/lib/migrations.ts')

describe('junk test pricing cleanup', () => {
  before(() => {
    upsertModelPricing({
      model_id: 'test-model',
      display_name: 'test-model',
      provider: 'unknown',
      input_price_per_1m: 0,
      output_price_per_1m: 0,
    })
    upsertModelPricing({
      model_id: 'claude-3-haiku',
      display_name: 'Claude 3 Haiku',
      provider: 'anthropic',
      input_price_per_1m: 0.25,
      output_price_per_1m: 1.25,
    })
    insertUsageRecord({
      source: 'hermes',
      model: 'test-model',
      project: 'unknown',
      input_tokens: 100,
      cached_input_tokens: 0,
      output_tokens: 50,
      reasoning_tokens: 0,
      cost_usd: 0,
      timestamp: Date.now(),
      request_id: 'hermes:junk-test-1',
    })
    insertUsageRecord({
      source: 'dsh',
      model: 'stealth/ox-alpha',
      project: 'DSH',
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 1,
      reasoning_tokens: 0,
      cost_usd: 0,
      timestamp: Date.now(),
      request_id: 'dsh-keep-stealth',
    })
    upsertModelPricing({
      model_id: 'stealth/ox-alpha',
      display_name: 'stealth/ox-alpha',
      provider: 'unknown',
      input_price_per_1m: 0,
      output_price_per_1m: 0,
    })
    runMigrations()
  })

  it('recognizes fixture model ids', () => {
    assert.equal(isJunkAutoPricingModel('test'), true)
    assert.equal(isJunkAutoPricingModel('test-jsonl-model'), true)
    assert.equal(isJunkAutoPricingModel('auto'), true)
    assert.equal(isJunkAutoPricingModel('claude-3-haiku'), false)
  })

  it('removes junk pricing rows and hermes test usage, keeps real usage', () => {
    const models = getAllPricing().map((row) => row.model_id)
    assert.equal(models.includes('test-model'), false)
    assert.equal(models.includes('stealth/ox-alpha'), false)
    assert.equal(models.includes('claude-3-haiku'), true)

    const db = getDb()
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE model = 'test-model'").get().n, 0)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE request_id = 'dsh-keep-stealth'").get().n, 1)
  })
})
