#!/usr/bin/env node
/**
 * 修正国产模型价格至 VibeCafe 实际价格，并重新计算受影响记录的费用。
 */
const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = path.join(__dirname, '..', 'data', 'token-trail.db')
const db = new Database(DB_PATH)

// VibeCafe 实际价格 (USD per 1M tokens)
const priceUpdates = [
  { model_id: 'glm-5.1', input_price_per_1m: 0.60, cached_input_price_per_1m: 0.11, output_price_per_1m: 2.20 },
  { model_id: 'MiniMax-M2.7', input_price_per_1m: 0.30, cached_input_price_per_1m: 0.03, output_price_per_1m: 1.20 },
  { model_id: 'mimo-v2.5-pro', input_price_per_1m: 0.40, cached_input_price_per_1m: 0.08, output_price_per_1m: 2.00 },
]

const updatePricing = db.prepare(`
  UPDATE model_pricing
  SET input_price_per_1m = ?, cached_input_price_per_1m = ?, output_price_per_1m = ?, updated_at = CURRENT_TIMESTAMP
  WHERE model_id = ?
`)

const getRecords = db.prepare(`SELECT id, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens FROM usage_records WHERE model = ?`)

const updateCost = db.prepare(`UPDATE usage_records SET cost_usd = ? WHERE id = ?`)

const recalAll = db.transaction(() => {
  for (const p of priceUpdates) {
    updatePricing.run(p.input_price_per_1m, p.cached_input_price_per_1m, p.output_price_per_1m, p.model_id)

    const records = getRecords.all(p.model_id)
    console.log(`\n${p.model_id}: ${records.length} records to recalculate`)
    console.log(`  Old price: (check above)`)
    console.log(`  New price: in=$${p.input_price_per_1m}, cached=$${p.cached_input_price_per_1m}, out=$${p.output_price_per_1m}`)

    let oldTotal = 0
    let newTotal = 0
    for (const r of records) {
      const oldCost = r.input_tokens / 1e6 * p.input_price_per_1m  // This is wrong - we need old prices too
        + r.cached_input_tokens / 1e6 * p.cached_input_price_per_1m
        + r.output_tokens / 1e6 * p.output_price_per_1m

      // Actually we need to get old cost first. Let me query differently.
    }
  }
})

// Let me get before/after comparison
console.log('=== Price Update & Cost Recalculation ===\n')

// Get current total cost
const beforeTotal = db.prepare('SELECT SUM(cost_usd) as total FROM usage_records').get()
console.log(`Before: total cost = $${beforeTotal.total.toFixed(2)}`)

// Per-model before
for (const p of priceUpdates) {
  const before = db.prepare('SELECT SUM(cost_usd) as cost, COUNT(*) as cnt FROM usage_records WHERE model = ?').get(p.model_id)
  console.log(`  ${p.model_id}: ${before.cnt} records, $${before.cost.toFixed(2)}`)
}

// Update pricing and recalculate
const doUpdate = db.transaction(() => {
  for (const p of priceUpdates) {
    updatePricing.run(p.input_price_per_1m, p.cached_input_price_per_1m, p.output_price_per_1m, p.model_id)

    const records = getRecords.all(p.model_id)
    for (const r of records) {
      const newCost = Math.round((
        r.input_tokens / 1e6 * p.input_price_per_1m
        + r.cached_input_tokens / 1e6 * p.cached_input_price_per_1m
        + r.output_tokens / 1e6 * p.output_price_per_1m
        + (r.reasoning_tokens || 0) / 1e6 * 0  // no reasoning price for these
      ) * 1e6) / 1e6
      updateCost.run(newCost, r.id)
    }
  }
})

doUpdate()

// Get after total cost
const afterTotal = db.prepare('SELECT SUM(cost_usd) as total FROM usage_records').get()
console.log(`\nAfter: total cost = $${afterTotal.total.toFixed(2)}`)
console.log(`Difference: $${(afterTotal.total - beforeTotal.total).toFixed(2)}`)

for (const p of priceUpdates) {
  const after = db.prepare('SELECT SUM(cost_usd) as cost, COUNT(*) as cnt FROM usage_records WHERE model = ?').get(p.model_id)
  console.log(`  ${p.model_id}: ${after.cnt} records, $${after.cost.toFixed(2)}`)
}

db.close()
console.log('\nDone!')
