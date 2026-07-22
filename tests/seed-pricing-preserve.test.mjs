import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

/**
 * seedPricing must not overwrite custom model prices on restart.
 * Mirrors INSERT OR IGNORE semantics from src/lib/seed-pricing.ts.
 */

function seedLike(db, models) {
  const upsertSeed = db.prepare(`
    INSERT INTO model_pricing (
      model_id, display_name, provider,
      input_price_per_1m, cached_input_price_per_1m,
      output_price_per_1m, reasoning_price_per_1m
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      display_name = excluded.display_name,
      provider = excluded.provider,
      input_price_per_1m = excluded.input_price_per_1m,
      cached_input_price_per_1m = excluded.cached_input_price_per_1m,
      output_price_per_1m = excluded.output_price_per_1m,
      reasoning_price_per_1m = excluded.reasoning_price_per_1m
    WHERE model_pricing.input_price_per_1m = 0
      AND model_pricing.cached_input_price_per_1m = 0
      AND model_pricing.output_price_per_1m = 0
      AND model_pricing.reasoning_price_per_1m = 0
      AND (
        excluded.input_price_per_1m != 0
        OR excluded.cached_input_price_per_1m != 0
        OR excluded.output_price_per_1m != 0
        OR excluded.reasoning_price_per_1m != 0
      )
  `)
  let changed = 0
  const run = db.transaction(() => {
    for (const m of models) {
      const r = upsertSeed.run(
        m.model_id, m.display_name, m.provider,
        m.input_price_per_1m, m.cached_input_price_per_1m ?? 0,
        m.output_price_per_1m, m.reasoning_price_per_1m ?? 0,
      )
      if (r.changes > 0) changed++
    }
  })
  run()
  return changed
}

describe('seedPricing preserve custom prices', () => {
  let db
  let tmpFile

  before(() => {
    tmpFile = path.join(os.tmpdir(), `tokentrail-seed-test-${Date.now()}.db`)
    db = new Database(tmpFile)
    db.exec(`
      CREATE TABLE model_pricing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        input_price_per_1m REAL NOT NULL,
        cached_input_price_per_1m REAL NOT NULL DEFAULT 0,
        output_price_per_1m REAL NOT NULL,
        reasoning_price_per_1m REAL NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
  })

  after(() => {
    db.close()
    try { fs.unlinkSync(tmpFile) } catch {}
  })

  it('inserts missing models but keeps user-customized prices', () => {
    const catalog = [
      { model_id: 'gpt-4o', display_name: 'GPT-4o', provider: 'openai', input_price_per_1m: 2.5, cached_input_price_per_1m: 1.25, output_price_per_1m: 10, reasoning_price_per_1m: 0 },
      { model_id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', provider: 'anthropic', input_price_per_1m: 3, cached_input_price_per_1m: 0.3, output_price_per_1m: 15, reasoning_price_per_1m: 0 },
    ]
    assert.equal(seedLike(db, catalog), 2)

    // User customizes gpt-4o via Excel / API
    db.prepare(`
      UPDATE model_pricing SET input_price_per_1m = 9.99, output_price_per_1m = 19.99 WHERE model_id = 'gpt-4o'
    `).run()

    // Re-seed (server restart) should not clobber custom prices
    const reseedCatalog = [
      ...catalog,
      { model_id: 'o3', display_name: 'o3', provider: 'openai', input_price_per_1m: 2, cached_input_price_per_1m: 0.5, output_price_per_1m: 8, reasoning_price_per_1m: 8 },
    ]
    assert.equal(seedLike(db, reseedCatalog), 1, 'only new model o3 is inserted')

    const gpt4o = db.prepare(`SELECT input_price_per_1m, output_price_per_1m FROM model_pricing WHERE model_id = 'gpt-4o'`).get()
    assert.equal(gpt4o.input_price_per_1m, 9.99)
    assert.equal(gpt4o.output_price_per_1m, 19.99)

    const o3 = db.prepare(`SELECT display_name FROM model_pricing WHERE model_id = 'o3'`).get()
    assert.equal(o3.display_name, 'o3')
  })

  it('upgrades zero-price auto-registered placeholders to seed prices', () => {
    db.prepare(`
      INSERT INTO model_pricing (model_id, display_name, provider, input_price_per_1m, cached_input_price_per_1m, output_price_per_1m, reasoning_price_per_1m)
      VALUES ('new-model-x', 'new-model-x', 'unknown', 0, 0, 0, 0)
    `).run()

    assert.equal(seedLike(db, [
      { model_id: 'new-model-x', display_name: 'New Model X', provider: 'openai', input_price_per_1m: 1.5, cached_input_price_per_1m: 0.3, output_price_per_1m: 6, reasoning_price_per_1m: 0 },
    ]), 1)

    const row = db.prepare(`SELECT display_name, provider, input_price_per_1m, output_price_per_1m FROM model_pricing WHERE model_id = 'new-model-x'`).get()
    assert.equal(row.display_name, 'New Model X')
    assert.equal(row.provider, 'openai')
    assert.equal(row.input_price_per_1m, 1.5)
    assert.equal(row.output_price_per_1m, 6)
  })
})
