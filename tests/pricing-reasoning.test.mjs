import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'

process.env.TOKENTRAIL_DB_PATH = path.join(os.tmpdir(), `tt-pricing-reasoning-${process.pid}.db`)

const { upsertModelPricing } = await import('../src/lib/db.ts')
const { calculateCost } = await import('../src/lib/pricing.ts')

const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 1_000_000 }

describe('calculateCost reasoning tokens', () => {
  it('bills reasoning at the output rate when no reasoning price is set', () => {
    upsertModelPricing({ model_id: 'rt-unset', display_name: 'rt', provider: 'test', input_price_per_1m: 1, output_price_per_1m: 10 })
    assert.equal(calculateCost({ model: 'rt-unset', ...usage }), 10)
  })

  it('uses an explicit reasoning price when present', () => {
    upsertModelPricing({ model_id: 'rt-set', display_name: 'rt', provider: 'test', input_price_per_1m: 1, output_price_per_1m: 10, reasoning_price_per_1m: 4 })
    assert.equal(calculateCost({ model: 'rt-set', ...usage }), 4)
  })
})
