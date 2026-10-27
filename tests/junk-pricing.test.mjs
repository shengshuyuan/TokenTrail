import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'

process.env.TOKENTRAIL_DB_PATH = path.join(os.tmpdir(), `tt-junk-pricing-${process.pid}.db`)

const {
  getDb,
  upsertModelPricing,
  insertUsageRecord,
  isJunkAutoPricingModel,
  isCursorGrokBotModel,
  shouldZeroUsageCost,
  getAllPricing,
} = await import('../src/lib/db.ts')
const { calculateCost } = await import('../src/lib/pricing.ts')
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
    assert.equal(isJunkAutoPricingModel('test-model'), true)
    assert.equal(isJunkAutoPricingModel('verify-model'), true)
    assert.equal(isJunkAutoPricingModel('seed_m8'), true)
    assert.equal(isJunkAutoPricingModel('unknown-codex'), true)
    assert.equal(isJunkAutoPricingModel('auto'), true)
    assert.equal(isJunkAutoPricingModel('claude-3-haiku'), false)
  })

  it('calculateCost and insertUsageRecord reject charging junk models', () => {
    assert.equal(calculateCost({ model: 'auto', input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 1_000_000, reasoning_tokens: 0 }), 0)
    assert.equal(calculateCost({ model: 'test-model', input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 1_000_000, reasoning_tokens: 0 }), 0)

    const insertRes = insertUsageRecord({
      source: 'cursor',
      model: 'auto',
      project: 'test-proj',
      input_tokens: 1000,
      cached_input_tokens: 0,
      output_tokens: 1000,
      reasoning_tokens: 0,
      cost_usd: 12.345, // should be forced to 0
      timestamp: Date.now(),
      request_id: 'cursor:auto-test-reject',
    })
    assert.equal(insertRes.cost_usd, 0)
    const db = getDb()
    const stored = db.prepare('SELECT cost_usd FROM usage_records WHERE request_id = ?').get('cursor:auto-test-reject')
    assert.equal(stored.cost_usd, 0)
  })

  it('keeps Cursor grok-bot usage but never bills dollars', () => {
    assert.equal(isCursorGrokBotModel('grok-bot-default'), true)
    assert.equal(isCursorGrokBotModel('grok-bot-automation'), true)
    assert.equal(shouldZeroUsageCost('grok-bot-default'), true)
    assert.equal(calculateCost({
      model: 'grok-bot-automation',
      input_tokens: 1_000_000,
      cached_input_tokens: 0,
      output_tokens: 1_000_000,
      reasoning_tokens: 0,
    }), 0)

    const db = getDb()
    db.prepare(`
      INSERT INTO usage_records (source, provider, project, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, cost_usd, request_id, timestamp)
      VALUES ('cursor', 'xai', 'unknown', 'grok-bot-default', 100, 0, 50, 0, 9.99, 'cursor:grok-bot-hist', ?)
    `).run(Date.now() - 1000)
    upsertModelPricing({
      model_id: 'grok-bot-default',
      display_name: 'Grok Bot Default',
      provider: 'xai',
      input_price_per_1m: 2,
      cached_input_price_per_1m: 0.5,
      output_price_per_1m: 6,
      reasoning_price_per_1m: 0,
    })
    // Clear marker so the migration can run again in this isolated DB
    db.prepare("DELETE FROM app_config WHERE key = 'migration.cursor_grok_bot_zero_cost_v1'").run()
    runMigrations()

    const hist = db.prepare('SELECT cost_usd FROM usage_records WHERE request_id = ?').get('cursor:grok-bot-hist')
    assert.equal(hist.cost_usd, 0)
    const price = db.prepare('SELECT input_price_per_1m, output_price_per_1m FROM model_pricing WHERE model_id = ?').get('grok-bot-default')
    assert.equal(price.input_price_per_1m, 0)
    assert.equal(price.output_price_per_1m, 0)

    const insertRes = insertUsageRecord({
      source: 'cursor',
      model: 'grok-bot-automation',
      project: 'TokenTrail',
      input_tokens: 1000,
      cached_input_tokens: 0,
      output_tokens: 100,
      reasoning_tokens: 0,
      cost_usd: 3.21,
      timestamp: Date.now(),
      request_id: 'cursor:grok-bot-new',
    })
    assert.equal(insertRes.cost_usd, 0)
    const stored = db.prepare('SELECT cost_usd FROM usage_records WHERE request_id = ?').get('cursor:grok-bot-new')
    assert.equal(stored.cost_usd, 0)
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
